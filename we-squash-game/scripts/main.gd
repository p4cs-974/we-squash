extends Node3D

const DeviceControllerScript := preload("res://scripts/device_controller.gd")
const IPhoneScene := preload("res://models/iphone_17_pro.glb")
const WatchScene := preload("res://models/apple_watch_ultra.glb")

const MODEL_SCALE := 5.0

@onready var ws_server: WebSocketServer = $WebSocketServer
@onready var connection_ui: CanvasLayer = $ConnectionUI
@onready var world: Node3D = $World

var _active_controller: Node3D = null
var _device_spawned := false
var _active_peer_id := -1


func _ready() -> void:
	ws_server.peer_connected.connect(_on_peer_connected)
	ws_server.peer_disconnected.connect(_on_peer_disconnected)
	ws_server.message_received.connect(_on_message_received)

	var err := ws_server.start_server()
	if err != OK:
		push_error("Failed to start WebSocket server!")
		return

	var local_ip := ws_server.get_local_ip()
	connection_ui.setup(local_ip, WebSocketServer.PORT)


func _process(_delta: float) -> void:
	ws_server.poll()


func _on_peer_connected(peer_id: int) -> void:
	_active_peer_id = peer_id
	connection_ui.on_peer_connected(peer_id)
	ws_server.send_to(peer_id, JSON.stringify({
		"type": "welcome",
		"message": "Connected to WeSquash!"
	}))


func _on_peer_disconnected(peer_id: int) -> void:
	connection_ui.on_peer_disconnected(peer_id)
	if peer_id == _active_peer_id:
		_remove_device()


func _on_calibration_started() -> void:
	connection_ui.on_calibration_started()


func _on_calibration_finished() -> void:
	connection_ui.on_calibration_finished()


func _on_message_received(_peer_id: int, message: String) -> void:
	var data = JSON.parse_string(message)
	if data == null or typeof(data) != TYPE_DICTIONARY:
		return

	var msg_type = data.get("type", "")
	if msg_type == "sensor":
		# Spawn device on first sensor message
		if not _device_spawned:
			var device_type: String = data.get("device", "phone")
			_spawn_device(device_type)

		if _active_controller:
			_active_controller.apply_sensor_data(data)


func _spawn_device(device_type: String) -> void:
	_remove_device()

	# Create controller node
	var controller := Node3D.new()
	controller.name = "DeviceController"
	controller.set_script(DeviceControllerScript)
	controller.transform = Transform3D.IDENTITY.scaled(Vector3.ONE * MODEL_SCALE)

	# Instantiate the correct 3D model as a child
	var model: Node3D
	if device_type == "watch":
		model = WatchScene.instantiate()
	else:
		model = IPhoneScene.instantiate()
	model.name = "Model"
	controller.add_child(model)

	# Add to world
	world.add_child(controller)

	# Set device type and connect signals
	controller.device_type = device_type
	controller.calibration_started.connect(_on_calibration_started)
	controller.calibration_finished.connect(_on_calibration_finished)

	_active_controller = controller
	_device_spawned = true

	connection_ui.on_device_detected(device_type)
	controller.start_calibration()

	print("[Main] Spawned %s controller" % device_type)


func _remove_device() -> void:
	if _active_controller:
		_active_controller.queue_free()
		_active_controller = null
	_device_spawned = false
	_active_peer_id = -1
	print("[Main] Device removed")
