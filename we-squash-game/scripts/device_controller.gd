extends Node3D

signal calibration_started
signal calibration_finished
signal swing_detected(power: float)

@export_range(1.0, 60.0) var smoothing_speed: float = 12.0
@export var calibration_duration: float = 3.0
@export var swing_threshold_dps: float = 400.0

# Device identification
var device_type := "phone"  # "phone" or "watch"

# --- Quaternion-based state ---
var _target_quat := Quaternion.IDENTITY
var _has_data := false

# Gyroscope / accelerometer (device-local frame)
var _gyro_rate := Vector3.ZERO       # deg/s in device frame
var _user_accel := Vector3.ZERO      # m/s^2 in device frame
var _swing_cooldown := 0.0

# Calibration state
var _calibrating := false
var _calibration_timer := 0.0
var _calibration_samples: Array[Quaternion] = []
var _calibration_quat := Quaternion.IDENTITY
var _is_calibrated := false


## Convert a CoreMotion quaternion (Z-up) to Godot (Y-up).
##
## CoreMotion reference frame (xArbitraryCorrectedZVertical):
##   X = arbitrary horizontal, Y = perpendicular horizontal, Z = vertical (up)
## Godot frame:
##   X = right, Y = up, Z = toward viewer
## Mapping: CM(x,y,z) -> Godot(x, z, -y)
## For quaternion imaginary part: (x,y,z) -> (x, z, -y)
static func cm_quat_to_godot_quat(qx: float, qy: float, qz: float, qw: float) -> Quaternion:
	return Quaternion(qx, qz, -qy, qw).normalized()


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


func start_calibration() -> void:
	_calibrating = true
	_calibration_timer = 0.0
	_calibration_samples.clear()
	_calibration_quat = Quaternion.IDENTITY
	_is_calibrated = false
	_has_data = false
	_target_quat = Quaternion.IDENTITY
	quaternion = Quaternion.IDENTITY
	calibration_started.emit()
	var hold_msg := "hold device steady" if device_type == "watch" else "hold phone upright"
	print("[Controller] Calibration started -- %s for %.0fs" % [hold_msg, calibration_duration])


func apply_sensor_data(data: Dictionary) -> void:
	if not data.has("ra") and not data.has("qx"):
		return

	# Build orientation quaternion based on device type
	var current_quat: Quaternion
	var dev: String = data.get("device", "phone")

	if dev == "watch" and data.has("qx"):
		# Apple Watch sends CMAttitude quaternion directly
		var qx: float = float(data.get("qx", 0.0))
		var qy: float = float(data.get("qy", 0.0))
		var qz: float = float(data.get("qz", 0.0))
		var qw: float = float(data.get("qw", 1.0))
		current_quat = cm_quat_to_godot_quat(qx, qy, qz, qw)
	else:
		# Phone sends W3C DeviceOrientation Euler angles (radians)
		var alpha: float = float(data.get("ra", 0.0))  # yaw   (around Z)
		var beta: float  = float(data.get("rb", 0.0))  # pitch (around X)
		var gamma: float = float(data.get("rg", 0.0))  # roll  (around Y)
		current_quat = w3c_to_godot_quat(alpha, beta, gamma)

	# Gyroscope rotation rate (deg/s) -- same field layout for both devices
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
	_target_quat = _calibration_quat.inverse() * current_quat


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
		return

	# Frame-rate-independent exponential smoothing via slerp.
	# smoothing_speed controls convergence rate (~1/s). Higher = snappier.
	var blend := 1.0 - exp(-smoothing_speed * delta)
	quaternion = quaternion.slerp(_target_quat, blend)

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
	calibration_finished.emit()


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
