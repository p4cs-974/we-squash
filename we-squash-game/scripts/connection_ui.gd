extends CanvasLayer

@onready var waiting_label: Label = $Panel/VBox/WaitingLabel
@onready var ip_label: Label = $Panel/VBox/IPLabel
@onready var status_label: Label = $Panel/VBox/StatusLabel

var _peer_count := 0
var _local_ip := ""
var _port := 0
var _calibrating := false
var _device_type := ""


func setup(local_ip: String, port: int) -> void:
	_local_ip = local_ip
	_port = port
	_update_display()


func on_peer_connected(_peer_id: int) -> void:
	_peer_count += 1
	_update_display()


func on_peer_disconnected(_peer_id: int) -> void:
	_peer_count = max(0, _peer_count - 1)
	_calibrating = false
	_device_type = ""
	_update_display()


func on_device_detected(device_type: String) -> void:
	_device_type = device_type
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

	ip_label.text = "%s:%d" % [_local_ip, _port]

	if _calibrating:
		waiting_label.text = "Calibrating..."
		waiting_label.modulate = Color(1.0, 0.8, 0.2)
		var hold_msg := "Hold your device steady" if _device_type == "watch" else "Hold your phone upright and still"
		status_label.text = hold_msg
		status_label.modulate = Color(1.0, 0.8, 0.2)
	elif _peer_count > 0:
		var device_name := "Apple Watch" if _device_type == "watch" else "iPhone"
		waiting_label.text = "%s Connected!" % device_name
		waiting_label.modulate = Color(0.3, 1.0, 0.3)
		status_label.text = "%s controller active" % device_name
		status_label.modulate = Color(0.3, 1.0, 0.3)
	else:
		waiting_label.text = "Waiting for connection..."
		waiting_label.modulate = Color.WHITE
		status_label.text = "Open the companion app and enter the address above"
		status_label.modulate = Color(0.7, 0.7, 0.7)
