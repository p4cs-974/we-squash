extends CanvasLayer

@onready var waiting_label: Label = $Panel/VBox/WaitingLabel
@onready var ip_label: Label = $Panel/VBox/IPLabel
@onready var status_label: Label = $Panel/VBox/StatusLabel
@onready var qr_texture_rect: TextureRect = $Panel/VBox/QRTextureRect

var _peer_count := 0
var _local_ip := ""
var _ws_port := 0
var _udp_port := 0
var _calibrating := false
var _is_calibrated := false
var _qr_displayed := false


func setup(local_ip: String, ws_port: int, udp_port: int) -> void:
	_local_ip = local_ip
	_ws_port = ws_port
	_udp_port = udp_port
	_generate_qr_code()
	_update_display()


func on_peer_connected(_peer_id: int) -> void:
	_peer_count += 1
	_update_display()


func on_peer_disconnected(_peer_id: int) -> void:
	_peer_count = max(0, _peer_count - 1)
	_calibrating = false
	_is_calibrated = false
	_update_display()


func on_device_detected() -> void:
	_is_calibrated = false
	_update_display()


func on_calibration_started() -> void:
	_calibrating = true
	_is_calibrated = false
	_update_display()


func on_calibration_finished() -> void:
	_calibrating = false
	_is_calibrated = true
	_update_display()


func _generate_qr_code() -> void:
	if _local_ip.is_empty() or _qr_displayed:
		return
	
	# Generate the deep link URL for the companion app
	# Format: wesquashcompanion://connect?ip=xxx.xxx.xxx.xxx&ws=9080&udp=9081
	var qr_url := "wesquashcompanion://connect?ip=%s&ws=%d&udp=%d" % [_local_ip, _ws_port, _udp_port]
	
	print("[ConnectionUI] Generating QR code for: ", qr_url)
	
	# Generate QR code texture
	var qr_texture := QRCodeGenerator.generate_qr_texture(qr_url)
	
	if qr_texture_rect:
		qr_texture_rect.texture = qr_texture
		_qr_displayed = true


func _update_display() -> void:
	if not is_node_ready():
		return

	ip_label.text = "WS: %s:%d | UDP: %s:%d" % [_local_ip, _ws_port, _local_ip, _udp_port]
	
	# Show/hide QR code based on connection state
	if qr_texture_rect:
		qr_texture_rect.visible = _peer_count == 0

	if _calibrating:
		waiting_label.text = "Calibrating..."
		waiting_label.modulate = Color(1.0, 0.8, 0.2)
		status_label.text = "Hold right side pose, keep phone side up, and point phone back to Godot camera"
		status_label.modulate = Color(1.0, 0.8, 0.2)
	elif _peer_count > 0:
		if _is_calibrated:
			waiting_label.text = "iPhone Calibrated!"
			waiting_label.modulate = Color(0.3, 1.0, 0.3)
			status_label.text = "Acceleration + rotation controller active"
			status_label.modulate = Color(0.3, 1.0, 0.3)
		else:
			waiting_label.text = "iPhone Connected!"
			waiting_label.modulate = Color(1.0, 0.85, 0.2)
			status_label.text = "Press and hold Calibrate on the companion app"
			status_label.modulate = Color(1.0, 0.85, 0.2)
	else:
		waiting_label.text = "Scan QR code with your iPhone"
		waiting_label.modulate = Color.WHITE
		status_label.text = "Or enter manually: %s" % _local_ip
		status_label.modulate = Color(0.7, 0.7, 0.7)
