class_name UDPServer
extends Node

## Emitted when a UDP client is first seen. Provides the peer ID.
signal peer_connected(peer_id: int)
## Emitted when a UDP client times out. Provides the peer ID.
signal peer_disconnected(peer_id: int)
## Emitted when sensor data is received from a peer (decoded binary).
signal sensor_data_received(peer_id: int, data: Dictionary)

const PORT := 9081
const MAX_CONNECTIONS := 10
const PEER_TIMEOUT_MS := 15000  # Consider peer dead after 15s of no packets
const HEARTBEAT_INTERVAL_MS := 5000  # Phone sends heartbeat every 5s

# Packet types (must match React Native encoder)
const PACKET_TYPE_SENSOR := 0x01
const PACKET_TYPE_HEARTBEAT := 0x02
const PACKET_TYPE_HEARTBEAT_RESPONSE := 0x03

const DEVICE_TYPE_PHONE := 0x01

var _udp_server := UDPServer.new()
var _packet_peer := PacketPeerUDP.new()
var _peers: Dictionary = {}  # peer_id -> {address, port, last_activity}
var _address_to_peer_id: Dictionary = {}  # "ip:port" -> peer_id
var _next_peer_id := 1000  # Start at 1000 to avoid collision with WebSocket peer IDs
var _is_listening := false


func start_server() -> Error:
	var err := _udp_server.listen(PORT)
	if err == OK:
		_is_listening = true
		print("[UDP Server] Listening on port %d (max connections: %d)" % [PORT, MAX_CONNECTIONS])
	else:
		push_error("[UDP Server] Failed to listen on port %d, error: %s" % [PORT, err])
	return err


func stop_server() -> void:
	for peer_id in _peers.keys():
		_disconnect_peer(peer_id, "server_shutdown")
	_peers.clear()
	_address_to_peer_id.clear()
	_udp_server.stop()
	_is_listening = false
	print("[UDP Server] Stopped.")


func is_listening() -> bool:
	return _is_listening


func get_peer_count() -> int:
	return _peers.size()


func get_stats() -> Dictionary:
	return {
		"active_peers": _peers.size(),
		"max_connections": MAX_CONNECTIONS,
		"is_listening": _is_listening,
		"port": PORT
	}


func poll() -> void:
	if not _is_listening:
		return

	_udp_server.poll()

	# Check for timeouts
	_check_timeouts()

	# Process incoming packets
	while _udp_server.is_connection_available():
		var conn := _udp_server.take_connection()
		if conn == null:
			continue

		while conn.get_available_packet_count() > 0:
			var packet := conn.get_packet()
			var addr := conn.get_packet_ip()
			var port := conn.get_packet_port()
			_process_packet(packet, addr, port)


func _process_packet(packet: PackedByteArray, addr: String, port: int) -> void:
	if packet.size() < 1:
		return

	var packet_type := packet.decode_u8(0)
	var addr_key := "%s:%d" % [addr, port]

	match packet_type:
		PACKET_TYPE_SENSOR:
			_process_sensor_packet(packet, addr_key, addr, port)
		PACKET_TYPE_HEARTBEAT:
			_process_heartbeat_packet(packet, addr_key, addr, port)
		_:
			push_warning("[UDP Server] Unknown packet type: %d from %s" % [packet_type, addr_key])


func _process_sensor_packet(packet: PackedByteArray, addr_key: String, addr: String, port: int) -> void:
	# Sensor packet must be exactly 46 bytes
	if packet.size() != 46:
		push_warning("[UDP Server] Invalid sensor packet size: %d (expected 46) from %s" % [packet.size(), addr_key])
		return

	# Get or create peer
	var peer_id := _get_or_create_peer(addr_key, addr, port)
	if peer_id == -1:
		return  # Max connections reached

	# Update activity
	_peers[peer_id].last_activity = Time.get_ticks_msec()

	# Decode binary data (little-endian)
	# Offset 0: u8 packet_type (already read)
	# Offset 1: u8 device_type
	var device_type := packet.decode_u8(1)

	# Offsets 2-37: f32 sensor values (little-endian, Godot default)
	var ra := packet.decode_float(2)   # Euler alpha (yaw)
	var rb := packet.decode_float(6)   # Euler beta (pitch)
	var rg := packet.decode_float(10)  # Euler gamma (roll)
	var ga := packet.decode_float(14)  # Gyro alpha
	var gb := packet.decode_float(18)  # Gyro beta
	var gg := packet.decode_float(22)  # Gyro gamma
	var ax := packet.decode_float(26)  # Accel X
	var ay := packet.decode_float(30)  # Accel Y
	var az := packet.decode_float(34)  # Accel Z

	# Offsets 38-45: f64 timestamp
	var ts := packet.decode_double(38)

	# Build data dictionary with same keys as JSON protocol
	var data := {
		"type": "sensor",
		"device": "phone" if device_type == DEVICE_TYPE_PHONE else "unknown",
		"ra": ra,
		"rb": rb,
		"rg": rg,
		"ga": ga,
		"gb": gb,
		"gg": gg,
		"ax": ax,
		"ay": ay,
		"az": az,
		"ts": int(ts)
	}

	sensor_data_received.emit(peer_id, data)


func _process_heartbeat_packet(packet: PackedByteArray, addr_key: String, addr: String, port: int) -> void:
	# Heartbeat packet must be exactly 9 bytes
	if packet.size() != 9:
		push_warning("[UDP Server] Invalid heartbeat packet size: %d (expected 9) from %s" % [packet.size(), addr_key])
		return

	# Get or create peer
	var peer_id := _get_or_create_peer(addr_key, addr, port)
	if peer_id == -1:
		return  # Max connections reached

	# Update activity
	_peers[peer_id].last_activity = Time.get_ticks_msec()

	# Decode timestamp
	var timestamp := packet.decode_double(1)

	# Send heartbeat response
	_send_heartbeat_response(addr, port, timestamp)


func _get_or_create_peer(addr_key: String, addr: String, port: int) -> int:
	if _address_to_peer_id.has(addr_key):
		return _address_to_peer_id[addr_key]

	# New peer - check connection limit
	if _peers.size() >= MAX_CONNECTIONS:
		push_warning("[UDP Server] Connection limit reached, rejecting %s" % addr_key)
		return -1

	# Assign new peer ID
	_next_peer_id += 1
	var peer_id := _next_peer_id

	_peers[peer_id] = {
		"address": addr,
		"port": port,
		"last_activity": Time.get_ticks_msec()
	}
	_address_to_peer_id[addr_key] = peer_id

	print("[UDP Server] Peer %d connected from %s (%d/%d)" % [peer_id, addr_key, _peers.size(), MAX_CONNECTIONS])
	peer_connected.emit(peer_id)

	return peer_id


func _send_heartbeat_response(addr: String, port: int, timestamp: float) -> void:
	# Build heartbeat response packet (9 bytes)
	var response := PackedByteArray()
	response.resize(9)
	response.encode_u8(0, PACKET_TYPE_HEARTBEAT_RESPONSE)
	response.encode_double(1, timestamp)

	# Send response
	_packet_peer.set_dest_address(addr, port)
	_packet_peer.put_packet(response)


func _check_timeouts() -> void:
	var current_time := Time.get_ticks_msec()
	var timed_out_peers := []

	for peer_id in _peers.keys():
		var peer_data = _peers[peer_id]
		var inactive_time: int = current_time - peer_data.last_activity

		if inactive_time > PEER_TIMEOUT_MS:
			print("[UDP Server] Peer %d timed out (inactive for %dms)" % [peer_id, inactive_time])
			timed_out_peers.append(peer_id)

	for peer_id in timed_out_peers:
		_disconnect_peer(peer_id, "timeout")


func _disconnect_peer(peer_id: int, reason: String) -> void:
	if not _peers.has(peer_id):
		return

	var peer_data = _peers[peer_id]
	var addr_key := "%s:%d" % [peer_data.address, peer_data.port]

	_peers.erase(peer_id)
	_address_to_peer_id.erase(addr_key)

	peer_disconnected.emit(peer_id)
	print("[UDP Server] Peer %d disconnected: %s" % [peer_id, reason])


func get_local_ip() -> String:
	var addresses := IP.get_local_addresses()
	for address in addresses:
		if address == "127.0.0.1":
			continue
		if address.begins_with("192.168.") or address.begins_with("10.") or address.begins_with("172."):
			return address
	return "127.0.0.1"


func _exit_tree() -> void:
	stop_server()
