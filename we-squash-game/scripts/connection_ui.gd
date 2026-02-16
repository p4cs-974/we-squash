extends CanvasLayer

@onready var waiting_label: Label = $Panel/VBox/WaitingLabel
@onready var ip_label: Label = $Panel/VBox/IPLabel
@onready var status_label: Label = $Panel/VBox/StatusLabel

var _peer_count := 0
var _local_ip := ""
var _ws_port := 0
var _udp_port := 0
var _calibrating := false


func setup(local_ip: String, ws_port: int, udp_port: int) -> void:
	_local_ip = local_ip
	_ws_port = ws_port
	_udp_port = udp_port
	_update_display()


func on_peer_connected(_peer_id: int) -> void:
	_peer_count += 1
	_update_display()


func on_peer_disconnected(_peer_id: int) -> void:
	_peer_count = max(0, _peer_count - 1)
	_calibrating = false
	_update_display()


func on_device_detected() -> void:
	_update_display()


func on_calibration_started() -> void:
	_calibrating = true
	_update_display()


func on_calibration_finished() -> void:
	_calibrating = false
	_update_display()


func _update_display() -> void:
	if not is_node_ready():
		return

	ip_label.text = "WS: %s:%d | UDP: %s:%d" % [_local_ip, _ws_port, _local_ip, _udp_port]

	if _calibrating:
		waiting_label.text = "Calibrating..."
		waiting_label.modulate = Color(1.0, 0.8, 0.2)
		status_label.text = "Hold your phone upright and still"
		status_label.modulate = Color(1.0, 0.8, 0.2)
	elif _peer_count > 0:
		waiting_label.text = "iPhone Connected!"
		waiting_label.modulate = Color(0.3, 1.0, 0.3)
		status_label.text = "iPhone controller active"
		status_label.modulate = Color(0.3, 1.0, 0.3)
	else:
		waiting_label.text = "Waiting for connection..."
		waiting_label.modulate = Color.WHITE
		status_label.text = "Open the companion app and connect via WebSocket or UDP"
		status_label.modulate = Color(0.7, 0.7, 0.7)
