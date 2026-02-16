# LAN-Based Multiplayer & Companion App Research Summary

## Research Goal
Find real-world examples and best practices for phone-to-PC direct connection for a squash game companion app, avoiding router hops for lowest latency.

---

## 1. REAL-WORLD IMPLEMENTATIONS

### Major Platforms

#### Steam Link / Steam Remote Play
- **Protocol**: Custom protocol over UDP (reverse-engineered by security researchers)
- **Architecture**: Client-server with encrypted channels
- **Discovery**: Uses Valve's matchmaking servers for initial handshake, then local connection when possible
- **Ports**: UDP 27031-27036, TCP 27036-27037
- **Latency**: <16ms on LAN possible with "Low Latency Networking" option
- **Key Feature**: Falls back to local network automatically when available

#### PlayStation Remote Play (PS4/PS5)
- **Protocol**: UDP-based with custom framing (ports 9295-9297)
- **Discovery**: 
  - Initial handshake uses Sony servers (ps5.np.playstation.net)
  - After auth, switches to **local UDP on ports 9295-9297**
  - Can work entirely offline once connected
- **Latency**: 8-20ms typical on same WiFi
- **Architecture**: UDP for video/audio, separate control channel
- **Chiaki** (open-source reimplementation): Confirms protocol is UDP-based with local discovery

#### Xbox Game Streaming
- **Protocol**: UDP-based proprietary protocol
- **Discovery**: Uses Xbox Live for auth, then local discovery
- **Latency**: 10-25ms typical
- **Touch Controls**: GCVirtualController API on iOS for mapping touch to controller input
- **Architecture**: Similar to PS Remote Play - cloud auth, local streaming

#### Nintendo Switch Online
- **Protocol**: PRUDP (Reliable UDP) - Nintendo's custom reliable UDP implementation
- **NEX Protocol**: Quazal Rendez-Vous based matchmaking
- **LAN Mode**: Uses LDN protocol for local wireless
- **Latency**: 5-15ms in local wireless mode
- **Companion App**: Uses WebSocket on Switch (instead of UDP) with protobuf

### Indie/Specialized Implementations

#### Jackbox Party Pack
- **Architecture**: Web-based controller (jackbox.tv)
- **Protocol**: WebSocket over HTTPS
- **Discovery**: Room code system (manual entry)
- **Latency**: 50-150ms (acceptable for party games)
- **Limitation**: Requires internet connection even for LAN play
- **Key Insight**: Phone browsers connect to cloud servers, not directly to game

#### WebRTC Controller Projects
- **Repository**: `mhb8898/webrtc-controller`
- **Protocol**: WebRTC DataChannels (SCTP-based)
- **Signaling**: WebSocket server for initial handshake
- **Latency**: 10-30ms achievable
- **Advantage**: Works through NAT/firewall, browser-based

#### TV-Chat (Godot-based)
- **Repository**: `Unprecedented-Studios/TV-Chat`
- **Pattern**: Similar to Jackbox - phone as controller, PC as display
- **Protocol**: WebSocket-based

---

## 2. TECHNICAL APPROACHES & PROTOCOLS

### Protocol Comparison

| Protocol | Latency | Reliability | Use Case |
|----------|---------|-------------|----------|
| Raw UDP | Lowest (~1-5ms) | Unreliable | Controller input, position updates |
| Reliable UDP (RUDP) | Low (~5-10ms) | Configurable | Important game events |
| WebRTC DataChannel | Low (~10-30ms) | Optional reliable | P2P browser apps |
| WebSocket | Medium (~20-50ms) | Reliable | Turn-based, party games |
| TCP | Higher (~20-100ms) | Guaranteed | File transfer, chat |

### Production-Proven Patterns

#### Steam/Valve Approach
- Use UDP for time-critical data
- Implement custom reliability layer on top
- Encrypt everything with session keys
- Support both local and remote seamlessly

#### Sony PlayStation Approach
- **Two-phase connection**:
  1. Cloud auth/account verification (TCP 443)
  2. Local UDP streaming (ports 9295-9297)
- Fallback to relay servers if direct fails

#### Nintendo Approach
- PRUDP: Custom reliable UDP with:
  - Sequence numbers
  - Acknowledgments
  - Retransmission
  - Checksums
- Optimized for low-latency game networking

---

## 3. LOCAL NETWORK DISCOVERY PATTERNS

### Method Comparison

| Method | Pros | Cons | Best For |
|--------|------|------|----------|
| **mDNS/Bonjour** | Standard, cross-platform, human-readable | Requires multicast support | Apple ecosystem, Spotify Connect |
| **UDP Broadcast** | Simple, fast, no deps | Blocked on some networks, not routable | Simple LAN games |
| **UDP Multicast** | Efficient for many devices | Complex, network dependent | Multiple controller scenarios |
| **QR Code** | 100% reliable, no network deps | Manual step, user friction | Secure pairing |
| **WebSocket Signaling** | Works through internet | Requires server, higher latency | Remote + local hybrid |
| **WiFi Direct** | True P2P, no router | Limited support, complex | Android-only scenarios |

### Production Examples

#### mDNS Implementation (Spacedrive, Flutter apps)
```
Service Type: _http._tcp.local.
Format: {device-id}._sd._udp.local
Properties: name, os, version, capabilities
```

**Libraries**:
- **Flutter**: `multicast_dns` package
- **Node.js**: `bonjour` or `mdns`
- **Unity**: `Zeroconf` asset or custom implementation
- **React Native**: `react-native-zeroconf`

#### UDP Broadcast Pattern
- Send discovery packet to `255.255.255.255` on fixed port
- Include device name, service type, port
- Listen for responses
- **iOS 14+**: Requires `NSLocalNetworkUsageDescription` permission

#### QR Code Pattern (Nintendo Switch, some indie games)
- Display IP:Port or connection token on screen
- User scans with phone camera
- Eliminates discovery complexity
- 100% reliable on any network

---

## 4. LATENCY BENCHMARKS

### Controller Input Latency (Real-world measurements)

| Connection Type | Typical Latency | Best Case | Notes |
|----------------|-----------------|-----------|-------|
| USB Wired (1000Hz) | 1-4ms | 0.5ms | Gold standard |
| 2.4GHz Dongle | 2-8ms | 1ms | Gaming controllers |
| Bluetooth LE | 10-20ms | 5ms | Modern gamepads |
| Bluetooth Classic | 20-40ms | 10ms | Older devices |
| WiFi 5/6 (same room) | 2-10ms | 1ms | Low contention |
| WiFi (through router) | 5-20ms | 2ms | Router adds hop |
| WiFi (congested) | 20-100ms | - | Bufferbloat |

### Router Hop Impact

| Scenario | Added Latency |
|----------|---------------|
| Same subnet, direct | Baseline |
| Through router (no NAT) | +1-3ms |
| Through router (NAT) | +2-5ms |
| Through router (QoS enabled) | +1-10ms (variable) |
| Powerline adapter | +5-20ms |

### Key Insights
- **WiFi can be faster than Bluetooth**: Bluetooth interrupt-driven vs USB polling
- **Router adds minimal latency** on modern hardware: 1-3ms typical
- **Bufferbloat is the enemy**: Upload saturation causes 100ms+ spikes
- **5GHz/6GHz bands**: Lower latency, less interference than 2.4GHz

### Real-World Gaming Latency Study (RTINGS)
- WiFi 6 routers: 2-5ms typical ping
- WiFi 6E (6GHz): 1-3ms typical
- Ethernet: <1ms

---

## 5. FRAMEWORK COMPARISONS

### Companion App Development

| Framework | Pros | Cons | Best For |
|-----------|------|------|----------|
| **Unity** | Proven for games, built-in networking | Heavy, slower iteration | Full game + companion |
| **React Native** | Fast dev, large ecosystem | UDP requires native modules | Cross-platform apps |
| **Flutter** | Fast, modern, good UI | UDP support limited | UI-heavy companion apps |
| **Electron** | Web tech, easy prototyping | Heavy, IPC overhead | Desktop game companion |
| **Native (Swift/Kotlin)** | Best performance, full API access | Two codebases | Premium performance |
| **Web (PWA)** | Universal, easy updates | Limited hardware access | Simple controllers |

### React Native Networking Limitations

**Issue**: `react-native-udp` performance
- Reported: 80-550ms response times (vs 40ms native Android)
- Cause: Bridge overhead between JS and native
- **Solutions**:
  1. Use TurboModules (new architecture) for better performance
  2. Implement critical path in native code
  3. Use WebRTC DataChannels (better JS performance)

**iOS 14+ Local Network Privacy**:
- Requires `NSLocalNetworkUsageDescription` in Info.plist
- User prompted on first local network access
- App Store review requires justification

### Electron for Gaming Companion Apps

**Pros**:
- Direct access to Node.js networking (dgram, net)
- Can use native modules (NAPI-RS for performance)
- Cross-platform builds

**Cons**:
- IPC overhead between main/renderer processes
- Memory usage (100-300MB typical)
- Not suitable for mobile

**Optimization**:
- Use contextIsolation: true
- Offload networking to main process
- Use SharedArrayBuffer for zero-copy data transfer

### Unity Networking for Companion Apps

**Unity Transport Package**:
- Custom UDP implementation
- Supports reliable and unreliable channels
- Cross-platform (desktop, mobile, console)

**Pattern**:
- Desktop game as server
- Mobile app as client
- Unity Relay for fallback (if needed)

---

## 6. RECOMMENDED ARCHITECTURE FOR SQUASH GAME

### Goal: Lowest Latency Phone-to-PC

#### Option A: UDP with mDNS Discovery (Recommended)

```
┌─────────────┐      mDNS Broadcast      ┌─────────────┐
│   Phone     │  ──────────────────────> │   PC Game   │
│  (React     │  <──────────────────────  │  (Unity/    │
│   Native)   │      Discovery Response    │   Node)     │
└─────────────┘                           └─────────────┘
       │                                         │
       │         Direct UDP (ports 9000-9100)    │
       │         ━━━━━━━━━━━━━━━━━━━━━━━━━━━>   │
       │         <━━━━━━━━━━━━━━━━━━━━━━━━━━    │
       │              Input State (60Hz)         │
       │              Game State (30Hz)          │
```

**Why this works**:
1. **UDP**: Lowest possible latency for controller input
2. **mDNS**: Zero-config discovery, works on all platforms
3. **Direct connection**: No router hop for same-subnet devices
4. **React Native**: Fast development, can use `react-native-udp`

#### Option B: WebRTC DataChannel (If Behind NAT/Firewall)

```
┌─────────┐  WS Signaling  ┌─────────┐  WS Signaling  ┌─────────┐
│  Phone  │ <────────────> │ Server  │ <────────────> │   PC    │
│ Browser │                │ (Cloud) │                │  Game   │
└─────────┘                └─────────┘                └─────────┘
     │                                                    │
     │<═════════════════ WebRTC P2P ════════════════════>│
     │              (STUN/TURN if needed)                 │
```

**Why this works**:
1. **Browser-based**: No app store required
2. **P2P after signaling**: Low latency once connected
3. **NAT traversal**: Built-in STUN/TURN support
4. **Trade-off**: Requires signaling server (can be minimal)

### Discovery Implementation

```javascript
// Simplified mDNS discovery pattern
// Phone (React Native)
import Zeroconf from 'react-native-zeroconf';

const zeroconf = new Zeroconf();
zeroconf.scan('squash-game', 'tcp', 'local.');

zeroconf.on('found', (service) => {
  console.log('Found game at:', service.addresses[0], service.port);
  connectToGame(service.addresses[0], service.port);
});
```

```javascript
// PC (Node.js)
import bonjour from 'bonjour';

const bonjourService = bonjour();
bonjourService.publish({
  name: 'Squash Game - ' + hostname,
  type: 'squash-game',
  port: 9000,
  txt: { version: '1.0', players: '0/4' }
});
```

### Protocol Design

```protobuf
// input.proto - Controller input (unreliable UDP)
message ControllerInput {
  uint32 sequence = 1;
  uint64 timestamp = 2;
  float move_x = 3;
  float move_y = 4;
  uint32 buttons = 5;  // Bitmask
}

// game_state.proto - Important events (reliable UDP)
message GameEvent {
  uint32 sequence = 1;
  EventType type = 2;
  bytes data = 3;
}
```

---

## 7. KEY TAKEAWAYS

### What Major Platforms Do
1. **UDP for time-critical data** (input, position)
2. **Custom reliability layer** on top of UDP (don't use raw TCP)
3. **Two-phase auth**: Cloud for account, local for gameplay
4. **Fallback gracefully**: Local → Router → Relay

### Proven Patterns
1. **mDNS/Bonjour** for zero-config discovery
2. **QR codes** as foolproof fallback
3. **Separate channels** for input (fast, unreliable) and events (reliable)
4. **60Hz input polling** minimum for responsive feel

### Latency Targets
- **Target**: <20ms end-to-end (phone to game response)
- **Achievable**: <10ms on same WiFi with UDP
- **Avoid**: Bluetooth (20-40ms), Internet round-trips (50-200ms)

### Framework Recommendation
- **Phone App**: React Native with `react-native-udp` or native modules
- **PC Game**: Unity with custom UDP or Node.js for prototyping
- **Discovery**: mDNS + QR code fallback
- **Protocol**: Custom UDP with sequence numbers, not raw TCP

---

## 8. REFERENCES

### Protocol Research
- Steam Remote Play reverse engineering: blog.thalium.re
- PlayStation Remote Play ports: r/PlaystationPortal
- Nintendo PRUDP: github.com/kinnay/NintendoClients
- WebRTC DataChannel: webrtchacks.com

### Latency Studies
- RTINGS WiFi gaming latency: rtings.com/router/learn/research/router-latency
- Controller latency benchmarks: gamepadtest.app
- WiFi hop analysis: dl.ifip.org (CNSM 2025)

### Implementation Examples
- mhb8898/webrtc-controller
- Unprecedented-Studios/TV-Chat
- jackbox-int (unofficial Jackbox research)

### Libraries
- React Native: react-native-udp, react-native-zeroconf
- Node.js: bonjour, dgram
- Unity: Unity Transport Package
- Flutter: multicast_dns
