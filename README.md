# WeSquash

A motion-controlled squash game where your phone or Apple Watch becomes the racket. The device's orientation sensors drive a 3D model in real time inside a Godot 4.6 game engine.

```
                          WiFi (WebSocket)
  iPhone / Apple Watch  ──────────────────►  Godot Game Server
   sensor data @ 50-60Hz     ws://IP:9080      3D racket model
```

## Project structure

```
we-squash/
├── we-squash-game/              # Godot 4.6 game (receives sensor data, renders 3D)
└── we-squash-companion/         # Expo React Native app (iPhone + Apple Watch controller)
    └── targets/watch/           # SwiftUI watchOS app (embedded via @bacons/apple-targets)
```

## we-squash-game

Godot 4.6 project using Forward Plus rendering and Jolt Physics. Runs a WebSocket server on port `9080` and waits for a device to connect.

**No 3D model is shown until a controller connects.** On the first sensor message, the game reads the `device` field (`"phone"` or `"watch"`) and dynamically spawns the corresponding model (iPhone 17 Pro or Apple Watch Ultra 2). When the device disconnects, the model is removed and the game returns to the waiting state.

### Key scripts

| Script | Role |
|---|---|
| `websocket_server.gd` | TCP listener on port 9080 with WebSocket handshake via `WebSocketPeer` |
| `main.gd` | Orchestrator. Spawns/destroys device models, routes sensor messages |
| `device_controller.gd` | Converts incoming sensor data to Godot quaternions, handles calibration and smoothing |
| `connection_ui.gd` | HUD showing IP address, connection status, and device type |

### Running

Open the project in Godot 4.6 and press F5. The game displays its LAN IP address and waits for a WebSocket connection.

---

## we-squash-companion

Expo React Native app that serves as both the iPhone controller and the iOS companion app for the Apple Watch. The watchOS target is embedded inside the Expo project using [`@bacons/apple-targets`](https://github.com/EvanBacon/expo-apple-targets).

### iPhone controller

Captures device motion via `expo-sensors` and streams it over WebSocket.

### Apple Watch controller

SwiftUI watchOS app (watchOS 26+) living in `targets/watch/`. Captures device motion via CoreMotion and streams it over WebSocket.

Uses an `HKWorkoutSession` to keep sensors alive when the screen dims. The WebSocket connection is handled by `URLSessionWebSocketTask`, which works reliably when the paired iPhone is nearby (watchOS routes traffic through the iPhone's network stack via Bluetooth companion proxy).

| File | Role |
|---|---|
| `WeSquashWatchApp.swift` | SwiftUI app entry point |
| `ContentView.swift` | Connection UI with IP/port input and status |
| `SensorManager.swift` | CoreMotion capture at 50Hz, JSON payload formatting |
| `WebSocketClient.swift` | `URLSessionWebSocketTask` wrapper with auto-reconnect |
| `WorkoutManager.swift` | `HKWorkoutSession` for background sensor access |

### Running

```bash
cd we-squash-companion
bun install
npx expo prebuild -p ios --clean
npx expo run:ios
```

Enter the IP address shown by the game and tap Connect.

To build the watch app, open the generated Xcode project and select the `watch` target:

```bash
cd we-squash-companion
open ios/wesquashcompanion.xcodeproj
```

Build to your Apple Watch from Xcode (requires Developer Mode enabled on the watch: Settings > Privacy & Security > Developer Mode). Enter the game's IP address and tap Connect.

After modifying Swift files in `targets/watch/`, changes are picked up automatically by Xcode. Only re-run `npx expo prebuild -p ios --clean` if you change `app.json` or `expo-target.config.js`.

---

## Orientation mapping

The core challenge is converting sensor orientation data from a phone or watch into a rotation that Godot can apply to a 3D model. Each platform reports orientation differently, and the coordinate systems don't match.

### Coordinate systems

```
W3C / Expo DeviceMotion              Godot 4
(phone in portrait)                  (3D scene)
─────────────────────                ──────────
X = right of screen                  X = right
Y = top of screen                    Y = up
Z = out of screen (toward user)      Z = toward viewer (out of screen)
Right-handed                         Right-handed, Y-up

CoreMotion (Apple Watch)
────────────────────────
X = arbitrary horizontal
Y = perpendicular horizontal
Z = vertical (up toward sky)
Right-handed, Z-up
```

### Phone: W3C Euler angles to Godot quaternion

The iPhone companion app uses Expo's `DeviceMotion` API, which reports orientation as three Euler angles following the W3C DeviceOrientation spec:

| Angle | W3C name | Axis | Range |
|---|---|---|---|
| `alpha` | Yaw | Z (vertical) | 0 to 2pi |
| `beta` | Pitch | X (lateral) | -pi to pi |
| `gamma` | Roll | Y (longitudinal) | -pi/2 to pi/2 |

The W3C spec defines the rotation as **intrinsic Z-X'-Y''** (Tait-Bryan angles):

```
R = Rz(alpha) * Rx(beta) * Ry(gamma)
```

Since the W3C device coordinate frame (X=right, Y=up, Z=out) matches Godot's frame for a phone in portrait orientation, no coordinate system transform is needed. The rotation is composed directly using Godot's `Basis` API:

```gdscript
static func w3c_to_godot_quat(alpha: float, beta: float, gamma: float) -> Quaternion:
    var rz := Basis(Vector3.BACK, alpha)   # Rz(alpha)
    var rx := Basis(Vector3.RIGHT, beta)   # Rx(beta)
    var ry := Basis(Vector3.UP, gamma)     # Ry(gamma)
    var combined := rz * rx * ry
    return combined.get_rotation_quaternion().normalized()
```

**Godot APIs used:**
- `Basis(axis: Vector3, angle: float)` constructs a rotation matrix around an arbitrary axis. Each call creates one of the three elemental rotations.
- Multiplying `Basis` objects composes rotations in the correct order (right-to-left: gamma is applied first, then beta, then alpha).
- `Basis.get_rotation_quaternion()` extracts the equivalent unit quaternion from the composed rotation matrix, avoiding Euler angle ambiguities and gimbal lock.

### Watch: CoreMotion quaternion to Godot quaternion

The Apple Watch sends the `CMAttitude.quaternion` directly, which avoids Euler decomposition entirely. CoreMotion uses a Z-up reference frame (`xArbitraryCorrectedZVertical`), so a coordinate transform is needed.

The mapping from CoreMotion (Z-up) to Godot (Y-up) swaps the Y and Z axes:

```
CoreMotion (x, y, z) --> Godot (x, z, -y)
```

For a quaternion's imaginary part (which is an axis vector), the same transform applies:

```gdscript
static func cm_quat_to_godot_quat(qx: float, qy: float, qz: float, qw: float) -> Quaternion:
    return Quaternion(qx, qz, -qy, qw).normalized()
```

**Why the watch sends quaternions directly:** Expo's DeviceMotion API only exposes Euler angles (alpha/beta/gamma), and the phone is typically held at beta ~= 90 degrees (upright), which is exactly the gimbal lock position for the W3C Euler decomposition. The watch has direct access to CoreMotion's `CMQuaternion`, which has no gimbal lock. Sending the raw quaternion preserves full rotational precision.

### Calibration

When a device connects, the game runs a 3-second calibration phase. During calibration, quaternion samples are collected and averaged using iterative slerp (with hemisphere correction to handle the q/-q ambiguity). The resulting baseline quaternion represents the device's rest pose.

After calibration, every incoming rotation is expressed relative to the baseline:

```gdscript
_target_quat = _calibration_quat.inverse() * current_quat
```

`Quaternion.inverse()` computes the conjugate of the unit quaternion (the reverse rotation). Multiplying the inverse calibration by the current orientation yields only the delta from the rest pose. This is mathematically correct, unlike subtracting Euler angles, which breaks for large rotations.

### Smoothing

Raw sensor data is noisy. The game applies frame-rate-independent exponential smoothing via quaternion slerp:

```gdscript
var blend := 1.0 - exp(-smoothing_speed * delta)
quaternion = quaternion.slerp(_target_quat, blend)
```

- `Node3D.quaternion` is Godot's property for getting/setting a node's orientation as a quaternion, bypassing Euler angle conversion entirely.
- `Quaternion.slerp(to, weight)` interpolates along the shortest great-circle arc on the unit sphere, guaranteeing constant angular velocity and no path distortion (unlike `Vector3.lerp` on Euler angles).
- The `1 - e^(-speed * dt)` formula makes the smoothing behave identically regardless of frame rate.

---

## Communication protocol

Both devices connect to the game via WebSocket at `ws://<game-ip>:9080` and exchange JSON text frames. The protocol is identical in structure, but the data sources and contents differ.

### Shared protocol

On connection, the game sends a welcome message:

```json
{"type": "welcome", "message": "Connected to WeSquash!"}
```

The device then streams sensor data at 50-60Hz:

```json
{"type": "sensor", "device": "phone|watch", ...sensor fields..., "ts": 1234567890123}
```

The `device` field determines which 3D model to spawn and which orientation conversion to use.

### Phone payload

```json
{
  "type": "sensor",
  "device": "phone",
  "ra": 1.2345, "rb": 0.5678, "rg": -0.1234,
  "ga": 12.3, "gb": -4.5, "gg": 8.7,
  "ax": 0.12, "ay": -0.34, "az": 0.56,
  "ts": 1707868800000
}
```

| Field | Source | Unit | Description |
|---|---|---|---|
| `ra` | `DeviceMotion.rotation.alpha` | radians | Yaw (rotation around Z) |
| `rb` | `DeviceMotion.rotation.beta` | radians | Pitch (rotation around X) |
| `rg` | `DeviceMotion.rotation.gamma` | radians | Roll (rotation around Y) |
| `ga` | `DeviceMotion.rotationRate.alpha` | deg/s | Gyroscope Z-axis rate |
| `gb` | `DeviceMotion.rotationRate.beta` | deg/s | Gyroscope Y-axis rate |
| `gg` | `DeviceMotion.rotationRate.gamma` | deg/s | Gyroscope X-axis rate |
| `ax` | `DeviceMotion.acceleration.x` | m/s^2 | User acceleration X |
| `ay` | `DeviceMotion.acceleration.y` | m/s^2 | User acceleration Y |
| `az` | `DeviceMotion.acceleration.z` | m/s^2 | User acceleration Z |

**Data pipeline:** Expo `DeviceMotion.addListener()` fires at 60Hz. Under the hood, Expo iOS maps `CMAttitude.yaw/pitch/roll` to `alpha/beta/gamma` and converts `CMRotationRate` from rad/s to deg/s. The values are rounded to 4 decimal places and sent as JSON over a native `WebSocket` object.

### Watch payload

```json
{
  "type": "sensor",
  "device": "watch",
  "qx": 0.1234, "qy": -0.5678, "qz": 0.3456, "qw": 0.7890,
  "ra": 1.2345, "rb": 0.5678, "rg": -0.1234,
  "ga": 12.3, "gb": -4.5, "gg": 8.7,
  "ax": 1.18, "ay": -3.34, "az": 5.49,
  "ts": 1707868800000
}
```

| Field | Source | Unit | Description |
|---|---|---|---|
| `qx/qy/qz/qw` | `CMAttitude.quaternion` | unitless | Raw orientation quaternion (Z-up frame) |
| `ra` | `CMAttitude.yaw` | radians | Yaw (around vertical) |
| `rb` | `CMAttitude.pitch` | radians | Pitch (around lateral) |
| `rg` | `CMAttitude.roll` | radians | Roll (around longitudinal) |
| `ga` | `CMRotationRate.z * 180/pi` | deg/s | Gyroscope Z-axis rate |
| `gb` | `CMRotationRate.y * 180/pi` | deg/s | Gyroscope Y-axis rate |
| `gg` | `CMRotationRate.x * 180/pi` | deg/s | Gyroscope X-axis rate |
| `ax` | `CMAcceleration.x * 9.81` | m/s^2 | User acceleration X |
| `ay` | `CMAcceleration.y * 9.81` | m/s^2 | User acceleration Y |
| `az` | `CMAcceleration.z * 9.81` | m/s^2 | User acceleration Z |

**Key differences from the phone:**

1. **Quaternion fields (qx/qy/qz/qw):** The watch sends the raw `CMQuaternion` in addition to Euler angles. The game uses the quaternion (via `cm_quat_to_godot_quat`) because it avoids gimbal lock and preserves full precision. The Euler fields are included as a fallback.

2. **Gyroscope conversion:** CoreMotion reports `rotationRate` in rad/s. The watch converts to deg/s (`* 180/pi`) to match the phone's format, since swing detection thresholds are calibrated in deg/s.

3. **Acceleration conversion:** CoreMotion reports `userAcceleration` in G's (1G = 9.81 m/s^2). The watch converts to m/s^2 (`* 9.81`) to match the phone, which uses Expo's already-converted values.

4. **Networking layer:** The phone uses a browser-standard `WebSocket` object. The watch uses `URLSessionWebSocketTask`, which relies on the paired iPhone's Bluetooth companion proxy to reach the LAN. Both connect to the same Godot `WebSocketPeer` server. Since the watch app is embedded as a companion inside the Expo iOS app, the companion proxy is available whenever the iPhone app is installed.

### How the game routes data

```
sensor message arrives
        |
        v
  device == "watch" && has "qx" field?
       / \
     yes   no
      |     |
      v     v
  cm_quat_to_godot_quat(qx,qy,qz,qw)    w3c_to_godot_quat(ra,rb,rg)
      |     |
      v     v
   current_quat (Godot Y-up frame)
        |
        v
  calibration_quat.inverse() * current_quat
        |
        v
     target_quat
        |
        v
  quaternion.slerp(target_quat, blend)
        |
        v
     Node3D.quaternion (rendered)
```
