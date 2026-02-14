class_name WebSocketServer
extends Node

## Emitted when a client connects. Provides the peer ID.
signal peer_connected(peer_id: int)
## Emitted when a client disconnects. Provides the peer ID.
signal peer_disconnected(peer_id: int)
## Emitted when a text message is received from a peer.
signal message_received(peer_id: int, message: String)

const PORT := 9080

var _tcp_server := TCPServer.new()
var _peers: Dictionary = {} # peer_id -> WebSocketPeer
var _pending: Array = [] # Array of PendingPeer
var _next_peer_id := 1
var _is_listening := false

class PendingPeer:
	var tcp: StreamPeerTCP
	var ws: WebSocketPeer
	var connect_time: int

	func _init(p_tcp: StreamPeerTCP) -> void:
		tcp = p_tcp
		ws = null
		connect_time = Time.get_ticks_msec()


func start_server() -> Error:
	var err := _tcp_server.listen(PORT)
	if err == OK:
		_is_listening = true
		print("[WS Server] Listening on port %d" % PORT)
	else:
		push_error("[WS Server] Failed to listen on port %d, error: %s" % [PORT, err])
	return err


func stop_server() -> void:
	for peer_id in _peers.keys():
		_peers[peer_id].close()
	_peers.clear()
	_pending.clear()
	_tcp_server.stop()
	_is_listening = false
	print("[WS Server] Stopped.")


func is_listening() -> bool:
	return _is_listening


func get_peer_count() -> int:
	return _peers.size()


func send_to(peer_id: int, message: String) -> void:
	if _peers.has(peer_id):
		_peers[peer_id].send_text(message)


func broadcast(message: String) -> void:
	for peer_id in _peers.keys():
		_peers[peer_id].send_text(message)


func poll() -> void:
	if not _is_listening:
		return

	# Accept new TCP connections
	while _tcp_server.is_connection_available():
		var tcp_conn := _tcp_server.take_connection()
		if tcp_conn:
			_pending.append(PendingPeer.new(tcp_conn))

	# Process pending connections (WebSocket handshake)
	var to_remove_pending: Array = []
	for p: PendingPeer in _pending:
		if p.ws == null:
			# Start WebSocket handshake
			if p.tcp.get_status() != StreamPeerTCP.STATUS_CONNECTED:
				to_remove_pending.append(p)
				continue
			p.ws = WebSocketPeer.new()
			p.ws.accept_stream(p.tcp)

		p.ws.poll()
		var state := p.ws.get_ready_state()

		if state == WebSocketPeer.STATE_OPEN:
			# Handshake complete - promote to active peer
			_next_peer_id += 1
			_peers[_next_peer_id] = p.ws
			to_remove_pending.append(p)
			print("[WS Server] Peer %d connected." % _next_peer_id)
			peer_connected.emit(_next_peer_id)
		elif state == WebSocketPeer.STATE_CLOSED:
			to_remove_pending.append(p)
		elif Time.get_ticks_msec() - p.connect_time > 5000:
			# Handshake timeout (5 seconds)
			p.ws.close()
			to_remove_pending.append(p)

	for p in to_remove_pending:
		_pending.erase(p)

	# Poll active peers
	var to_remove_peers: Array = []
	for peer_id in _peers.keys():
		var peer: WebSocketPeer = _peers[peer_id]
		peer.poll()

		var state := peer.get_ready_state()
		if state == WebSocketPeer.STATE_OPEN:
			while peer.get_available_packet_count():
				var packet := peer.get_packet()
				if peer.was_string_packet():
					var text := packet.get_string_from_utf8()
					message_received.emit(peer_id, text)
				# Ignore binary packets
		elif state == WebSocketPeer.STATE_CLOSED:
			to_remove_peers.append(peer_id)
			print("[WS Server] Peer %d disconnected." % peer_id)
			peer_disconnected.emit(peer_id)

	for peer_id in to_remove_peers:
		_peers.erase(peer_id)


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
