import { Buffer } from 'buffer';

export const PACKET_TYPE = {
  SENSOR: 0x01,
  HEARTBEAT: 0x02,
  HEARTBEAT_RESPONSE: 0x03,
  COMMAND: 0x04,
} as const;

export const DEVICE_TYPE = {
  PHONE: 0x01,
} as const;

export const COMMAND_TYPE = {
  CALIBRATE: 0x01,
} as const;

export const SENSOR_PACKET_SIZE = 46;
export const HEARTBEAT_PACKET_SIZE = 9;
export const COMMAND_PACKET_SIZE = 10;

export interface SensorPacketData {
  ra: number;
  rb: number;
  rg: number;
  ga: number;
  gb: number;
  gg: number;
  ax: number;
  ay: number;
  az: number;
  ts: number;
}

/**
 * Encode sensor data into a 46-byte binary packet.
 * Format (little-endian):
 * - Offset 0: u8 packet_type (0x01)
 * - Offset 1: u8 device_type (0x01 = phone)
 * - Offset 2-5: f32 ra (rotation alpha - yaw, radians)
 * - Offset 6-9: f32 rb (rotation beta - pitch, radians)
 * - Offset 10-13: f32 rg (rotation gamma - roll, radians)
 * - Offset 14-17: f32 ga (gyro alpha, deg/s)
 * - Offset 18-21: f32 gb (gyro beta, deg/s)
 * - Offset 22-25: f32 gg (gyro gamma, deg/s)
 * - Offset 26-29: f32 ax (accel X, m/s²)
 * - Offset 30-33: f32 ay (accel Y, m/s²)
 * - Offset 34-37: f32 az (accel Z, m/s²)
 * - Offset 38-45: f64 timestamp (Unix ms)
 */
export function encodeSensorPacket(data: SensorPacketData): Buffer {
  const buf = Buffer.allocUnsafe(SENSOR_PACKET_SIZE);
  encodeSensorPacketInto(buf, data);
  return buf;
}

/**
 * Encode sensor data into an existing 46-byte buffer.
 * This avoids per-packet allocations in the high-frequency sensor send path.
 */
export function encodeSensorPacketInto(buf: Buffer, data: SensorPacketData): void {
  if (buf.length < SENSOR_PACKET_SIZE) {
    throw new Error(`Sensor packet buffer too small: got ${buf.length}, expected ${SENSOR_PACKET_SIZE}`);
  }
  buf.writeUInt8(PACKET_TYPE.SENSOR, 0);
  buf.writeUInt8(DEVICE_TYPE.PHONE, 1);
  buf.writeFloatLE(data.ra, 2);
  buf.writeFloatLE(data.rb, 6);
  buf.writeFloatLE(data.rg, 10);
  buf.writeFloatLE(data.ga, 14);
  buf.writeFloatLE(data.gb, 18);
  buf.writeFloatLE(data.gg, 22);
  buf.writeFloatLE(data.ax, 26);
  buf.writeFloatLE(data.ay, 30);
  buf.writeFloatLE(data.az, 34);
  buf.writeDoubleLE(data.ts, 38);
}

/**
 * Encode a heartbeat packet (9 bytes).
 * Format (little-endian):
 * - Offset 0: u8 packet_type (0x02)
 * - Offset 1-8: f64 timestamp (Unix ms)
 */
export function encodeHeartbeatPacket(timestamp: number): Buffer {
  const buf = Buffer.alloc(HEARTBEAT_PACKET_SIZE);
  buf.writeUInt8(PACKET_TYPE.HEARTBEAT, 0);
  buf.writeDoubleLE(timestamp, 1);
  return buf;
}

/**
 * Encode a calibration command packet (10 bytes).
 * Format (little-endian):
 * - Offset 0: u8 packet_type (0x04)
 * - Offset 1: u8 command_type (0x01 = calibrate)
 * - Offset 2-9: f64 timestamp (Unix ms)
 */
export function encodeCalibrationPacket(timestamp: number): Buffer {
  const buf = Buffer.alloc(COMMAND_PACKET_SIZE);
  buf.writeUInt8(PACKET_TYPE.COMMAND, 0);
  buf.writeUInt8(COMMAND_TYPE.CALIBRATE, 1);
  buf.writeDoubleLE(timestamp, 2);
  return buf;
}

/**
 * Decode a heartbeat response packet from the server.
 * Format (little-endian):
 * - Offset 0: u8 packet_type (0x03)
 * - Offset 1-8: f64 timestamp (echoed for RTT calculation)
 * 
 * Returns null if the buffer is invalid or not a heartbeat response.
 */
export function decodeHeartbeatResponse(buf: Buffer): { timestamp: number } | null {
  if (buf.length < HEARTBEAT_PACKET_SIZE) return null;
  if (buf.readUInt8(0) !== PACKET_TYPE.HEARTBEAT_RESPONSE) return null;
  return { timestamp: buf.readDoubleLE(1) };
}

/**
 * Parse a discovery beacon message.
 * Format: "WESQUASH|PORT|VERSION"
 * Returns null if the message doesn't match the expected format.
 */
export function parseDiscoveryBeacon(message: string): { port: number; version: number } | null {
  const parts = message.split('|');
  if (parts.length !== 3 || parts[0] !== 'WESQUASH') {
    return null;
  }
  const port = parseInt(parts[1], 10);
  const version = parseInt(parts[2], 10);
  if (isNaN(port) || isNaN(version)) {
    return null;
  }
  return { port, version };
}
