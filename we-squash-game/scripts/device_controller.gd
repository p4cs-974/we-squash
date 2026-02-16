extends Node3D

signal calibration_started
signal calibration_finished
signal swing_detected(power: float)

@export_range(1.0, 60.0) var smoothing_speed: float = 12.0
@export var calibration_duration: float = 3.0
@export var swing_threshold_dps: float = 400.0
@export_range(0.1, 40.0) var accel_translation_gain: float = 6.8
@export_range(0.0, 2.0) var accel_deadzone: float = 0.18
@export_range(0.1, 30.0) var accel_filter_speed: float = 18.0
@export_range(0.1, 4.0) var accel_response_curve: float = 1.35
@export_range(0.1, 20.0) var max_linear_speed: float = 2.2
@export_range(0.1, 30.0) var translation_damping: float = 14.0
@export_range(0.1, 20.0) var translation_recenter_speed: float = 6.5
@export var max_position_offset := Vector3(0.42, 0.3, 0.48)
@export_range(-180.0, 180.0) var anchor_yaw_deg: float = 180.0
@export_range(-180.0, 180.0) var anchor_pitch_deg: float = 0.0
@export_range(-180.0, 180.0) var anchor_roll_deg: float = 90.0

# --- Quaternion-based state ---
var _target_quat := Quaternion.IDENTITY
var _relative_quat := Quaternion.IDENTITY
var _anchor_quat := Quaternion.IDENTITY
var _has_data := false
var _last_sensor_timestamp := 0

# Gyroscope / accelerometer (device-local frame)
var _gyro_rate := Vector3.ZERO       # deg/s in device frame
var _user_accel := Vector3.ZERO      # m/s^2 in device frame
var _swing_cooldown := 0.0
var _filtered_accel := Vector3.ZERO
var _linear_velocity := Vector3.ZERO
var _position_offset := Vector3.ZERO

# Calibration state
var _calibrating := false
var _calibration_timer := 0.0
var _calibration_samples: Array[Quaternion] = []
var _calibration_quat := Quaternion.IDENTITY
var _is_calibrated := false


## Build a Godot quaternion from W3C DeviceOrientation Euler angles.
##
## Expo iOS sends CMAttitude values mapped as:
##   alpha = attitude.yaw   (rotation around vertical / Z in W3C frame)
##   beta  = attitude.pitch (rotation around lateral  / X in W3C frame)
##   gamma = attitude.roll  (rotation around longitudinal / Y in W3C frame)
## Values are in radians.
##
## The W3C spec defines orientation as intrinsic Z-X'-Y'' rotations:
##   R = Rz(alpha) * Rx(beta) * Ry(gamma)
##
## The W3C device coordinate frame (X=right, Y=up-screen, Z=out-of-screen)
## matches Godot's frame (X=right, Y=up, Z=toward-viewer) when the phone is
## in portrait orientation. So no coordinate-system transform is needed --
## we just need to compose the rotation in the correct W3C order using Godot's
## Basis API, then convert to a quaternion.
static func w3c_to_godot_quat(alpha: float, beta: float, gamma: float) -> Quaternion:
	var rz := Basis(Vector3.BACK, alpha)   # Rz(alpha) -- around Z axis
	var rx := Basis(Vector3.RIGHT, beta)   # Rx(beta)  -- around X axis
	var ry := Basis(Vector3.UP, gamma)     # Ry(gamma) -- around Y axis
	var combined := rz * rx * ry
	return combined.get_rotation_quaternion().normalized()


func _ready() -> void:
	_rebuild_anchor_quat()


func start_calibration() -> void:
	_rebuild_anchor_quat()
	_calibrating = true
	_calibration_timer = 0.0
	_calibration_samples.clear()
	_calibration_quat = Quaternion.IDENTITY
	_is_calibrated = false
	_has_data = false
	_last_sensor_timestamp = 0
	_target_quat = _anchor_quat
	_relative_quat = Quaternion.IDENTITY
	quaternion = _anchor_quat
	_filtered_accel = Vector3.ZERO
	_linear_velocity = Vector3.ZERO
	_position_offset = Vector3.ZERO
	position = Vector3.ZERO
	calibration_started.emit()
	print("[Controller] Calibration started -- hold pose for %.0fs" % calibration_duration)


func apply_sensor_data(data: Dictionary) -> void:
	if not data.has("ra"):
		return

	var sample_ts := int(data.get("ts", 0))
	if sample_ts > 0:
		if sample_ts <= _last_sensor_timestamp:
			return
		_last_sensor_timestamp = sample_ts

	# Build orientation quaternion from W3C DeviceOrientation Euler angles (radians)
	var alpha: float = float(data.get("ra", 0.0))  # yaw   (around Z)
	var beta: float  = float(data.get("rb", 0.0))  # pitch (around X)
	var gamma: float = float(data.get("rg", 0.0))  # roll  (around Y)
	var current_quat := w3c_to_godot_quat(alpha, beta, gamma)

	# Gyroscope rotation rate (deg/s)
	var ga: float = float(data.get("ga", 0.0))
	var gb: float = float(data.get("gb", 0.0))
	var gg: float = float(data.get("gg", 0.0))
	_gyro_rate = Vector3(gg, gb, ga)

	# User acceleration (m/s^2) -- device-local frame
	var ax: float = float(data.get("ax", 0.0))
	var ay: float = float(data.get("ay", 0.0))
	var az: float = float(data.get("az", 0.0))
	_user_accel = Vector3(ax, ay, az)

	if _calibrating:
		_calibration_samples.append(current_quat)
		return

	_has_data = true

	# Relative rotation: undo calibration pose, apply current pose.
	_relative_quat = (_calibration_quat.inverse() * current_quat).normalized()
	_target_quat = (_anchor_quat * _relative_quat).normalized()


func _process(delta: float) -> void:
	if _calibrating:
		_calibration_timer += delta
		if _calibration_timer >= calibration_duration:
			_finish_calibration()
		return

	if not _has_data:
		# Idle animation
		var t := Time.get_ticks_msec() / 1000.0
		rotation.y = sin(t * 0.5) * 0.1
		rotation.x = cos(t * 0.3) * 0.05
		_position_offset = _position_offset.lerp(Vector3.ZERO, 1.0 - exp(-translation_recenter_speed * delta))
		position = _position_offset
		return

	# Frame-rate-independent exponential smoothing via slerp.
	# smoothing_speed controls convergence rate (~1/s). Higher = snappier.
	var blend := 1.0 - exp(-smoothing_speed * delta)
	quaternion = quaternion.slerp(_target_quat, blend)
	_update_translation(delta)

	# Swing detection via gyroscope magnitude (deg/s)
	_swing_cooldown = maxf(0.0, _swing_cooldown - delta)
	var gyro_magnitude := _gyro_rate.length()
	if gyro_magnitude > swing_threshold_dps and _swing_cooldown <= 0.0:
		_swing_cooldown = 0.3
		var power := gyro_magnitude / swing_threshold_dps
		swing_detected.emit(power)
		print("[Controller] Swing! power=%.1f (%.0f deg/s)" % [power, gyro_magnitude])


func _finish_calibration() -> void:
	_calibrating = false

	if _calibration_samples.is_empty():
		_calibration_quat = Quaternion.IDENTITY
		print("[Controller] Calibration finished -- no samples, using identity")
	else:
		_calibration_quat = _average_quaternions(_calibration_samples)
		print("[Controller] Calibration finished -- baseline quat: %s (%d samples)" \
			% [_calibration_quat, _calibration_samples.size()])

	_is_calibrated = true
	_calibration_samples.clear()
	_filtered_accel = Vector3.ZERO
	_linear_velocity = Vector3.ZERO
	_position_offset = Vector3.ZERO
	position = Vector3.ZERO
	calibration_finished.emit()


func _update_translation(delta: float) -> void:
	var accel_input := _apply_deadzone(_user_accel, accel_deadzone)
	accel_input = _shape_accel(accel_input, accel_response_curve)
	var accel_blend := 1.0 - exp(-accel_filter_speed * delta)
	_filtered_accel = _filtered_accel.lerp(accel_input, accel_blend)

	# Acceleration is reported in device-local coordinates; rotate into world space
	# so translational movement follows phone orientation.
	var accel_world := _relative_quat * _filtered_accel
	accel_world.z = -accel_world.z

	_linear_velocity += accel_world * accel_translation_gain * delta
	if _linear_velocity.length() > max_linear_speed:
		_linear_velocity = _linear_velocity.normalized() * max_linear_speed

	var damping_blend := 1.0 - exp(-translation_damping * delta)
	_linear_velocity = _linear_velocity.lerp(Vector3.ZERO, damping_blend)
	_position_offset += _linear_velocity * delta

	_position_offset.x = clampf(_position_offset.x, -max_position_offset.x, max_position_offset.x)
	_position_offset.y = clampf(_position_offset.y, -max_position_offset.y, max_position_offset.y)
	_position_offset.z = clampf(_position_offset.z, -max_position_offset.z, max_position_offset.z)

	var recenter_blend := 1.0 - exp(-translation_recenter_speed * delta)
	_position_offset = _position_offset.lerp(Vector3.ZERO, recenter_blend)
	position = _position_offset


func _rebuild_anchor_quat() -> void:
	var yaw := Quaternion(Vector3.UP, deg_to_rad(anchor_yaw_deg))
	var pitch := Quaternion(Vector3.RIGHT, deg_to_rad(anchor_pitch_deg))
	var roll := Quaternion(Vector3.BACK, deg_to_rad(anchor_roll_deg))
	_anchor_quat = (yaw * pitch * roll).normalized()


static func _apply_deadzone(value: Vector3, deadzone: float) -> Vector3:
	var output := value
	if absf(output.x) < deadzone:
		output.x = 0.0
	if absf(output.y) < deadzone:
		output.y = 0.0
	if absf(output.z) < deadzone:
		output.z = 0.0
	return output


static func _shape_accel(value: Vector3, curve: float) -> Vector3:
	return Vector3(
		_signed_pow(value.x, curve),
		_signed_pow(value.y, curve),
		_signed_pow(value.z, curve)
	)


static func _signed_pow(value: float, p: float) -> float:
	if is_zero_approx(value):
		return 0.0
	return signf(value) * pow(absf(value), p)


## Iterative slerp averaging of quaternions.
## Handles the q == -q hemisphere ambiguity.
static func _average_quaternions(quats: Array[Quaternion]) -> Quaternion:
	if quats.is_empty():
		return Quaternion.IDENTITY

	var avg := quats[0].normalized()
	for i in range(1, quats.size()):
		var q := quats[i]
		# Flip to same hemisphere (q and -q represent the same rotation)
		if avg.dot(q) < 0.0:
			q = -q
		avg = avg.slerp(q, 1.0 / float(i + 1))

	return avg.normalized()


func get_gyro_rate() -> Vector3:
	return _gyro_rate


func get_user_acceleration() -> Vector3:
	return _user_accel


func is_calibrated() -> bool:
	return _is_calibrated
