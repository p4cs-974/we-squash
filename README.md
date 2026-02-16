# WeSquash

A motion-controlled squash game where your iPhone becomes the racket. The device's orientation sensors drive a 3D model in real time inside a Godot 4.6 game engine.

```
                      WiFi (UDP primary, WebSocket fallback)
                           ┌─────────────────────┐
   iPhone ─────────────────┤  udp://IP:9081      ├► Godot Game Server
   sensor data @ 50-60Hz   │  ws://IP:9080 (fb)  │    3D racket model
                           └─────────────────────┘
```

## Project structure

```
we-squash/
├── we-squash-game/              # Godot 4.6 game (receives sensor data, renders 3D)
└── we-squash-companion/         # Expo React Native app (iPhone controller)
```

## Transport Modes

WeSquash uses a **dual-transport architecture** optimized for low latency:

1. **UDP (Default)** — Binary protocol on port `9081` with auto-discovery
2. **WebSocket (Fallback)** — JSON protocol on port `9080` if UDP fails

If UDP connection drops, the phone automatically falls back to WebSocket while continuing to attempt UDP reconnection in the background.

## we-squash-game

Godot 4.6 project using Forward Plus rendering and Jolt Physics. Runs two network servers simultaneously:

- **UDP Server** (port `9081`): Binary protocol for 5-12ms latency
- **WebSocket Server** (port `9080`): JSON fallback for reliability
- **Discovery Beacon** (port `9079`): UDP broadcast for auto-discovery

**No 3D model is shown until a controller connects.** On the first sensor message, the game spawns the iPhone 17 Pro model. When the device disconnects, the model is removed and the game returns to the waiting state.

### Key scripts

| Script | Role |
|---|---|
| `websocket_server.gd` | TCP listener on port 9080 with WebSocket handshake via `WebSocketPeer` |
| `udp_server.gd` | UDP listener on port 9081 with binary protocol decoder |
| `discovery_beacon.gd` | UDP broadcast beacon for auto-discovery on port 9079 |
| `main.gd` | Orchestrator. Spawns device model, routes sensor messages from both transports |
| `device_controller.gd` | Converts incoming sensor data to Godot quaternions, handles calibration and smoothing |
| `connection_ui.gd` | HUD showing IP address, connection status, and transport info |

### Running

Open the project in Godot 4.6 and press F5. The game displays its LAN IP address and starts both UDP and WebSocket servers. The discovery beacon automatically broadcasts the server presence for phone auto-discovery.

---

## we-squash-companion

Expo React Native app that serves as the iPhone motion controller. Captures device motion via `expo-sensors` and streams it over UDP with automatic fallback to WebSocket.

### Transport Selection

The app automatically discovers the game server via UDP broadcast and connects via UDP by default. If UDP fails or drops, it seamlessly switches to WebSocket while attempting to reconnect UDP in the background.

| Feature | Implementation |
|---------|---------------|
| Auto-discovery | Listens for UDP broadcasts on port `9079` |
| Primary transport | UDP sockets via `react-native-udp` |
| Fallback transport | WebSocket via native `WebSocket` |
| Binary protocol | `buffer` package for little-endian encoding |
| Heartbeat | Every 5s to maintain connection |

### Key files

| File | Role |
|---|---|
| `hooks/useUDPSocket.ts` | UDP socket management with heartbeat and reconnection |
| `hooks/useDiscovery.ts` | UDP broadcast discovery listener |
| `hooks/useSensorStream.ts` | Dual-transport orchestration (UDP primary, WS fallback) |
| `hooks/useWebSocket.ts` | WebSocket client for fallback transport |
| `utils/binaryProtocol.ts` | Binary encoder for sensor packets and heartbeat |
| `components/ConnectionPanel.tsx` | Connection UI with transport status |
| `app/index.tsx` | Main screen with discovery and connection handling |

### Running

```bash
cd we-squash-companion
bun install
npx expo prebuild -p ios --clean
npx expo run:ios
```

The app will automatically discover the game server on your local network. If discovery fails, you can manually enter the IP address shown by the game.

---

## Binary Protocol Specification

The UDP transport uses a compact binary protocol for minimal latency.

### Sensor Packet (46 bytes, little-endian)

```
Offset  Type    Field           Description
0       u8      packet_type     0x01 = sensor
1       u8      device_type     0x01 = phone
2-5     f32     ra              Euler alpha (radians) - yaw
6-9     f32     rb              Euler beta (radians) - pitch
10-13   f32     rg              Euler gamma (radians) - roll
14-17   f32     ga              Gyro alpha (deg/s)
18-21   f32     gb              Gyro beta (deg/s)
22-25   f32     gg              Gyro gamma (deg/s)
26-29   f32     ax              Accel X (m/s²)
30-33   f32     ay              Accel Y (m/s²)
34-37   f32     az              Accel Z (m/s²)
38-45   f64     timestamp       Unix timestamp (ms)
```

### Heartbeat Packet (9 bytes)

```
Offset  Type    Field           Description
0       u8      packet_type     0x02 = heartbeat
1-8     f64     timestamp       Unix timestamp (ms)
```

### Heartbeat Response (9 bytes, server→phone)

```
Offset  Type    Field           Description
0       u8      packet_type     0x03 = heartbeat response
1-8     f64     timestamp       Echoed from client for RTT calculation
```

### Discovery Beacon (text, server→broadcast)

```
Format: "WESQUASH|{udp_port}|{version}"
Example: "WESQUASH|9081|1"

Broadcast to: 255.255.255.255:9079
Interval: Every 2 seconds
```

### Ports

| Port | Protocol | Purpose |
|------|----------|---------|
| 9079 | UDP | Discovery beacon (broadcast) |
| 9080 | WebSocket | Fallback transport (JSON) |
| 9081 | UDP | Primary transport (binary) |

---

## Orientation mapping

The core challenge is converting sensor orientation data from the phone into a rotation that Godot can apply to a 3D model.

### Coordinate systems

```
W3C / Expo DeviceMotion              Godot 4
(phone in portrait)                  (3D scene)
─────────────────────                ──────────
X = right of screen                  X = right
Y = top of screen                    Y = up
Z = out of screen (toward user)      Z = toward viewer (out of screen)
Right-handed                         Right-handed, Y-up
```

### W3C Euler angles to Godot quaternion

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

## Communication Protocol Comparison

| Feature | UDP (Primary) | WebSocket (Fallback) |
|---------|---------------|---------------------|
| **Latency** | 5-12ms | 15-30ms |
| **Protocol** | Binary (46 bytes) | JSON text |
| **Port** | 9081 | 9080 |
| **Discovery** | Auto via broadcast | Manual IP entry |
| **Reliability** | Fire-and-forget | Guaranteed delivery |
| **Use case** | Gameplay | Fallback/reconnection |

---

## Dependencies

### we-squash-companion

- `expo-sensors` — DeviceMotion API for sensor data
- `react-native-udp` — UDP socket implementation
- `buffer` — Binary encoding/decoding
- `react-native-reanimated` — UI animations
- `expo-haptics` — Haptic feedback

### we-squash-game

- Godot 4.6+
- No external dependencies (uses built-in UDPServer, WebSocketPeer)
