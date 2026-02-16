class_name DiscoveryBeacon
extends Node

## UDP discovery beacon for auto-discovery by React Native companion app.
## Broadcasts server information to allow phones to find the game server automatically.

const BROADCAST_PORT := 9079
const BROADCAST_INTERVAL_MS := 2000  # Broadcast every 2 seconds
const BEACON_MESSAGE := "WESQUASH|9081|1"
const BROADCAST_ADDRESS := "255.255.255.255"

var _udp := PacketPeerUDP.new()
var _is_active := false
var _last_broadcast_time := 0


func start_beacon() -> Error:
	# Close any existing connection
	if _is_active:
		stop_beacon()

	# Create UDP socket
	var err := _udp.create(0)  # Bind to any available port
	if err != OK:
		push_error("[DiscoveryBeacon] Failed to create UDP socket: %d" % err)
		return err

	# Enable broadcast
	_udp.set_broadcast_enabled(true)
	_is_active = true
	_last_broadcast_time = 0  # Force immediate first broadcast

	print("[DiscoveryBeacon] Started broadcasting to %s:%d every %dms" % [BROADCAST_ADDRESS, BROADCAST_PORT, BROADCAST_INTERVAL_MS])

	# Send first beacon immediately
	_broadcast()

	return OK


func stop_beacon() -> void:
	_is_active = false
	_udp.close()
	print("[DiscoveryBeacon] Stopped.")


func poll() -> void:
	if not _is_active:
		return

	var current_time := Time.get_ticks_msec()
	if current_time - _last_broadcast_time >= BROADCAST_INTERVAL_MS:
		_broadcast()
		_last_broadcast_time = current_time


func _broadcast() -> void:
	# Set destination for broadcast
	var err := _udp.set_dest_address(BROADCAST_ADDRESS, BROADCAST_PORT)
	if err != OK:
		push_warning("[DiscoveryBeacon] Failed to set broadcast destination: %d" % err)
		return

	# Send beacon message
	var packet := BEACON_MESSAGE.to_utf8_buffer()
	err = _udp.put_packet(packet)

	if err != OK:
		push_warning("[DiscoveryBeacon] Failed to send beacon: %d" % err)
	else:
		# Only log occasionally to avoid spam
		if Time.get_ticks_msec() % 10000 < BROADCAST_INTERVAL_MS:
			print("[DiscoveryBeacon] Broadcast: %s" % BEACON_MESSAGE)


func is_active() -> bool:
	return _is_active


func _exit_tree() -> void:
	stop_beacon()
