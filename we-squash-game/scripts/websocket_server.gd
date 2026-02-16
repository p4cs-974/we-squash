class_name GameWebSocketServer
extends Node

## Emitted when a client connects. Provides the peer ID.
signal peer_connected(peer_id: int)
## Emitted when a client disconnects. Provides the peer ID.
signal peer_disconnected(peer_id: int)
## Emitted when a text message is received from a peer.
signal message_received(peer_id: int, message: String)

const PORT := 9080
const MAX_CONNECTIONS := 10
const HANDSHAKE_TIMEOUT_MS := 5000
const PING_INTERVAL_MS := 30000
const CONNECTION_TIMEOUT_MS := 60000

var _tcp_server := TCPServer.new()
var _peers: Dictionary = {} # peer_id -> {socket, last_activity, state}
var _pending: Array = [] # Array of PendingPeer
var _next_peer_id := 1
var _is_listening := false
var _last_ping_time := 0

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
		_last_ping_time = Time.get_ticks_msec()
		print("[WS Server] Listening on port %d (max connections: %d)" % [PORT, MAX_CONNECTIONS])
	else:
		push_error("[WS Server] Failed to listen on port %d, error: %s" % [PORT, err])
	return err


func stop_server() -> void:
	for peer_id in _peers.keys():
		_disconnect_peer(peer_id, "server_shutdown")
	_peers.clear()
	_pending.clear()
	_tcp_server.stop()
	_is_listening = false
	print("[WS Server] Stopped.")


func is_listening() -> bool:
	return _is_listening


func get_peer_count() -> int:
	return _peers.size()


## Send message to a specific peer with error handling
func send_to(peer_id: int, message: String) -> Error:
	if not _peers.has(peer_id):
		push_warning("[WS Server] Cannot send to peer %d: not found" % peer_id)
		return ERR_INVALID_PARAMETER
	
	var peer_data = _peers[peer_id]
	var socket: WebSocketPeer = peer_data.socket
	
	if peer_data.state != WebSocketPeer.STATE_OPEN:
		push_warning("[WS Server] Cannot send to peer %d: not connected" % peer_id)
		return ERR_CONNECTION_ERROR
	
	var err := socket.send_text(message)
	if err != OK:
		push_error("[WS Server] Failed to send to peer %d: error %d" % [peer_id, err])
		# Mark peer for disconnection on send failure
		_disconnect_peer(peer_id, "send_error")
	else:
		# Update last activity on successful send
		peer_data.last_activity = Time.get_ticks_msec()
	
	return err


## Broadcast message to all connected peers
func broadcast(message: String) -> Dictionary:
	var results := {}
	var failed_peers := []
	
	for peer_id in _peers.keys():
		var err := send_to(peer_id, message)
		results[peer_id] = err
		if err != OK:
			failed_peers.append(peer_id)
	
	# Clean up failed peers
	for peer_id in failed_peers:
		_disconnect_peer(peer_id, "broadcast_failure")
	
	return results


## Send ping to all connected peers
func _send_pings() -> void:
	var current_time := Time.get_ticks_msec()
	if current_time - _last_ping_time < PING_INTERVAL_MS:
		return
	
	_last_ping_time = current_time
	
	for peer_id in _peers.keys():
		var ping_message := JSON.stringify({
			"type": "ping",
			"timestamp": current_time
		})
		send_to(peer_id, ping_message)


## Check for peer timeouts
func _check_timeouts() -> void:
	var current_time := Time.get_ticks_msec()
	var timed_out_peers := []
	
	for peer_id in _peers.keys():
		var peer_data = _peers[peer_id]
		var inactive_time: int = current_time - peer_data.last_activity
		
		if inactive_time > CONNECTION_TIMEOUT_MS:
			print("[WS Server] Peer %d timed out (inactive for %dms)" % [peer_id, inactive_time])
			timed_out_peers.append(peer_id)
	
	for peer_id in timed_out_peers:
		_disconnect_peer(peer_id, "timeout")


## Disconnect a specific peer
func _disconnect_peer(peer_id: int, reason: String) -> void:
	if not _peers.has(peer_id):
		return
	
	var peer_data = _peers[peer_id]
	var socket: WebSocketPeer = peer_data.socket
	
	# Close socket gracefully
	if socket.get_ready_state() == WebSocketPeer.STATE_OPEN:
		socket.close(1000, reason)
	
	_peers.erase(peer_id)
	peer_disconnected.emit(peer_id)
	print("[WS Server] Peer %d disconnected: %s" % [peer_id, reason])


func poll() -> void:
	if not _is_listening:
		return
	
	# Accept new TCP connections (with connection limit)
	while _tcp_server.is_connection_available() and _peers.size() + _pending.size() < MAX_CONNECTIONS:
		var tcp_conn := _tcp_server.take_connection()
		if tcp_conn:
			_pending.append(PendingPeer.new(tcp_conn))
			print("[WS Server] New connection pending (%d/%d slots used)" % [_peers.size() + _pending.size(), MAX_CONNECTIONS])
	
	# Reject excess connections
	while _tcp_server.is_connection_available():
		var rejected_conn := _tcp_server.take_connection()
		if rejected_conn:
			print("[WS Server] Rejected connection: server at capacity")
			rejected_conn.disconnect_from_host()
	
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
			_peers[_next_peer_id] = {
				"socket": p.ws,
				"last_activity": Time.get_ticks_msec(),
				"state": WebSocketPeer.STATE_OPEN
			}
			to_remove_pending.append(p)
			print("[WS Server] Peer %d connected. (%d/%d)" % [_next_peer_id, _peers.size(), MAX_CONNECTIONS])
			peer_connected.emit(_next_peer_id)
		elif state == WebSocketPeer.STATE_CLOSED:
			to_remove_pending.append(p)
		elif Time.get_ticks_msec() - p.connect_time > HANDSHAKE_TIMEOUT_MS:
			# Handshake timeout
			print("[WS Server] Handshake timeout for pending peer")
			p.ws.close()
			to_remove_pending.append(p)
	
	for p in to_remove_pending:
		_pending.erase(p)
	
	# Poll active peers
	var to_remove_peers: Array = []
	for peer_id in _peers.keys():
		var peer_data = _peers[peer_id]
		var peer: WebSocketPeer = peer_data.socket
		peer.poll()
		
		var state := peer.get_ready_state()
		if state == WebSocketPeer.STATE_OPEN:
			peer_data.state = WebSocketPeer.STATE_OPEN
			peer_data.last_activity = Time.get_ticks_msec()
			
			while peer.get_available_packet_count() > 0:
				var packet := peer.get_packet()
				if peer.was_string_packet():
					var text := packet.get_string_from_utf8()
					# Handle pong messages
					if text.find('"type":"ping"') != -1:
						# Respond with pong
						var response := JSON.stringify({"type": "pong", "timestamp": Time.get_ticks_msec()})
						send_to(peer_id, response)
					else:
						message_received.emit(peer_id, text)
				# Silently ignore binary packets but count them
				else:
					peer_data.last_activity = Time.get_ticks_msec()
		elif state == WebSocketPeer.STATE_CLOSED:
			to_remove_peers.append(peer_id)
			print("[WS Server] Peer %d disconnected (socket closed)" % peer_id)
			peer_disconnected.emit(peer_id)
	
	for peer_id in to_remove_peers:
		_peers.erase(peer_id)
	
	# Send pings and check timeouts
	_send_pings()
	_check_timeouts()


func get_local_ip() -> String:
	var addresses := IP.get_local_addresses()
	for address in addresses:
		if address == "127.0.0.1":
			continue
		if address.begins_with("192.168.") or address.begins_with("10.") or address.begins_with("172."):
			return address
	return "127.0.0.1"


func get_stats() -> Dictionary:
	return {
		"active_peers": _peers.size(),
		"pending_peers": _pending.size(),
		"max_connections": MAX_CONNECTIONS,
		"is_listening": _is_listening,
		"port": PORT
	}


func _exit_tree() -> void:
	stop_server()
