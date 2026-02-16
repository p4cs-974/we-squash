import { useCallback, useEffect, useRef, useState } from 'react';
import { Buffer } from 'buffer';
import { DeviceMotion, type DeviceMotionMeasurement } from 'expo-sensors';
import { useWebSocket } from './useWebSocket';
import { useUDPSocket } from './useUDPSocket';
import {
  SENSOR_PACKET_SIZE,
  encodeCalibrationPacket,
  encodeSensorPacketInto,
} from '@/utils/binaryProtocol';

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

interface Euler {
  alpha: number;
  beta: number;
  gamma: number;
}

export interface SensorData {
  rotation: Euler;
  gyro: Euler;
  accel: Vec3;
}

const ZERO_EULER: Euler = { alpha: 0, beta: 0, gamma: 0 };
const ZERO_VEC3: Vec3 = { x: 0, y: 0, z: 0 };
const ZERO_SENSOR: SensorData = { rotation: ZERO_EULER, gyro: ZERO_EULER, accel: ZERO_VEC3 };

const DEFAULT_THROTTLE_INTERVAL = 16;
const SENSOR_UI_UPDATE_INTERVAL_MS = 66;
const PACKET_COUNTER_UPDATE_INTERVAL_MS = 250;
const UDP_PACKET_BUFFER_POOL_SIZE = 4;
const DEBUG_SENSOR_LOGS = false;

type ConnectionState = 'idle' | 'connecting' | 'open' | 'closing' | 'closed' | 'error';
type TransportMode = 'udp' | 'websocket';

interface UseSensorStreamReturn {
  sensorData: SensorData;
  isStreaming: boolean;
  isConnected: boolean;
  connect: (wsUrl?: string) => void;
  disconnect: () => void;
  requestCalibration: () => boolean;
  packetsSent: number;
  connectionState: ConnectionState;
  latency: number | undefined;
  transportMode: TransportMode;
}

interface UseSensorStreamOptions {
  wsUrl?: string;
  updateInterval?: number;
  throttleInterval?: number;
  transport?: TransportMode;
  serverIp?: string;
  serverPort?: number;
}

interface SensorPayload {
  type: 'sensor';
  device: 'phone';
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

interface CalibrationPayload {
  type: 'calibrate';
  device: 'phone';
  ts: number;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export function useSensorStream({
  wsUrl: initialWsUrl = '',
  updateInterval = 16,
  throttleInterval = DEFAULT_THROTTLE_INTERVAL,
  transport = 'udp',
  serverIp = '',
  serverPort = 9081,
}: UseSensorStreamOptions): UseSensorStreamReturn {
  const [sensorData, setSensorData] = useState<SensorData>(ZERO_SENSOR);
  const [packetsSent, setPacketsSent] = useState(0);
  const [isSensorAvailable, setIsSensorAvailable] = useState(false);
  const [transportMode, setTransportMode] = useState<TransportMode>(transport);

  const subscriptionRef = useRef<ReturnType<typeof DeviceMotion.addListener> | null>(null);
  const packetsSentRef = useRef(0);
  const lastSentRef = useRef(0);
  const lastSensorUiUpdateRef = useRef(0);
  const pendingPayloadRef = useRef<SensorPayload>({
    type: 'sensor',
    device: 'phone',
    ra: 0,
    rb: 0,
    rg: 0,
    ga: 0,
    gb: 0,
    gg: 0,
    ax: 0,
    ay: 0,
    az: 0,
    ts: 0,
  });
  const hasPendingPayloadRef = useRef(false);
  const sendTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const packetCounterIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const udpPacketBufferPoolRef = useRef<Buffer[]>(
    Array.from({ length: UDP_PACKET_BUFFER_POOL_SIZE }, () => Buffer.allocUnsafe(SENSOR_PACKET_SIZE)),
  );
  const udpPacketBufferIndexRef = useRef(0);
  const wsUrlRef = useRef(initialWsUrl);
  const serverIpRef = useRef(serverIp);
  const serverPortRef = useRef(serverPort);

  const {
    isConnected: wsIsConnected,
    connect: wsConnect,
    disconnect: wsDisconnect,
    send: wsSend,
    connectionState: wsConnectionState,
    latency: wsLatency,
  } = useWebSocket({
    url: initialWsUrl,
  });

  const {
    isConnected: udpIsConnected,
    connect: udpConnect,
    disconnect: udpDisconnect,
    send: udpSend,
    connectionState: udpConnectionState,
    latency: udpLatency,
  } = useUDPSocket({
    enableHeartbeat: true,
  });

  const isConnected = transportMode === 'udp' ? udpIsConnected : wsIsConnected;
  const connectionState = transportMode === 'udp' ? udpConnectionState : wsConnectionState;
  const latency = transportMode === 'udp' ? udpLatency : wsLatency;

  useEffect(() => {
    let mounted = true;

    async function checkSensor() {
      try {
        const available = await DeviceMotion.isAvailableAsync();
        if (DEBUG_SENSOR_LOGS) {
          console.log('[Sensor] DeviceMotion available:', available);
        }
        if (mounted) {
          setIsSensorAvailable(available);
        }
      } catch (error) {
        console.error('[Sensor] Error checking sensor availability:', error);
        if (mounted) {
          setIsSensorAvailable(false);
        }
      }
    }

    checkSensor();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    DeviceMotion.setUpdateInterval(updateInterval);
  }, [updateInterval]);

  useEffect(() => {
    setTransportMode(transport);
  }, [transport]);

  useEffect(() => {
    wsUrlRef.current = initialWsUrl;
  }, [initialWsUrl]);

  useEffect(() => {
    serverIpRef.current = serverIp;
  }, [serverIp]);

  useEffect(() => {
    serverPortRef.current = serverPort;
  }, [serverPort]);

  const clearSendTimeout = useCallback(() => {
    if (sendTimeoutRef.current !== null) {
      clearTimeout(sendTimeoutRef.current);
      sendTimeoutRef.current = null;
    }
  }, []);

  const clearPacketCounterInterval = useCallback(() => {
    if (packetCounterIntervalRef.current !== null) {
      clearInterval(packetCounterIntervalRef.current);
      packetCounterIntervalRef.current = null;
    }
  }, []);

  const connect = useCallback((explicitWsUrl?: string) => {
    if (DEBUG_SENSOR_LOGS) {
      console.log('[Sensor] connect() called, transport=', transportMode);
    }
    packetsSentRef.current = 0;
    lastSentRef.current = 0;
    lastSensorUiUpdateRef.current = 0;
    hasPendingPayloadRef.current = false;
    clearSendTimeout();
    setPacketsSent(0);

    if (transportMode === 'udp') {
      const ip = serverIpRef.current;
      const port = serverPortRef.current;
      if (ip && port) {
        udpConnect(ip, port);
      } else {
        if (DEBUG_SENSOR_LOGS) {
          console.log('[Sensor] UDP connect skipped - no server IP/port');
        }
      }
    } else {
      const url = explicitWsUrl ?? wsUrlRef.current;
      if (url) {
        wsConnect(url);
      }
    }
  }, [clearSendTimeout, transportMode, udpConnect, wsConnect]);

  const disconnect = useCallback(() => {
    clearSendTimeout();
    hasPendingPayloadRef.current = false;
    if (transportMode === 'udp') {
      udpDisconnect();
    } else {
      wsDisconnect();
    }
  }, [clearSendTimeout, transportMode, udpDisconnect, wsDisconnect]);

  const send = useCallback((data: SensorPayload): boolean => {
    if (transportMode === 'udp') {
      const pool = udpPacketBufferPoolRef.current;
      const index = udpPacketBufferIndexRef.current;
      const packetBuffer = pool[index];
      udpPacketBufferIndexRef.current = (index + 1) % pool.length;

      encodeSensorPacketInto(packetBuffer, {
        ra: data.ra,
        rb: data.rb,
        rg: data.rg,
        ga: data.ga,
        gb: data.gb,
        gg: data.gg,
        ax: data.ax,
        ay: data.ay,
        az: data.az,
        ts: data.ts,
      });
      return udpSend(packetBuffer);
    } else {
      return wsSend(JSON.stringify(data));
    }
  }, [transportMode, udpSend, wsSend]);

  const requestCalibration = useCallback((): boolean => {
    if (!isConnected) {
      return false;
    }

    const now = Date.now();

    if (transportMode === 'udp') {
      const commandPacket = encodeCalibrationPacket(now);
      return udpSend(commandPacket);
    }

    const payload: CalibrationPayload = {
      type: 'calibrate',
      device: 'phone',
      ts: now,
    };
    return wsSend(JSON.stringify(payload));
  }, [isConnected, transportMode, udpSend, wsSend]);

  const flushPendingPayload = useCallback(() => {
    if (!hasPendingPayloadRef.current) {
      return;
    }

    const now = Date.now();
    const elapsed = now - lastSentRef.current;

    if (elapsed < throttleInterval) {
      if (sendTimeoutRef.current === null) {
        sendTimeoutRef.current = setTimeout(() => {
          sendTimeoutRef.current = null;
          flushPendingPayload();
        }, throttleInterval - elapsed);
      }
      return;
    }

    const success = send(pendingPayloadRef.current);
    if (success) {
      hasPendingPayloadRef.current = false;
      packetsSentRef.current += 1;
      lastSentRef.current = now;
    }
  }, [send, throttleInterval]);

  const queueLatestPayload = useCallback((
    ra: number,
    rb: number,
    rg: number,
    ga: number,
    gb: number,
    gg: number,
    ax: number,
    ay: number,
    az: number,
    ts: number,
  ) => {
    const payload = pendingPayloadRef.current;
    payload.ra = ra;
    payload.rb = rb;
    payload.rg = rg;
    payload.ga = ga;
    payload.gb = gb;
    payload.gg = gg;
    payload.ax = ax;
    payload.ay = ay;
    payload.az = az;
    payload.ts = ts;
    hasPendingPayloadRef.current = true;
    flushPendingPayload();
  }, [flushPendingPayload]);

  useEffect(() => {
    if (!isConnected) {
      clearPacketCounterInterval();
      setPacketsSent(packetsSentRef.current);
      return;
    }

    clearPacketCounterInterval();
    packetCounterIntervalRef.current = setInterval(() => {
      setPacketsSent(packetsSentRef.current);
    }, PACKET_COUNTER_UPDATE_INTERVAL_MS);

    return () => {
      clearPacketCounterInterval();
    };
  }, [clearPacketCounterInterval, isConnected]);

  useEffect(() => {
    if (subscriptionRef.current) {
      subscriptionRef.current.remove();
      subscriptionRef.current = null;
    }

    clearSendTimeout();
    hasPendingPayloadRef.current = false;

    if (DEBUG_SENSOR_LOGS) {
      console.log('[Sensor] Streaming effect: isConnected=%s isSensorAvailable=%s transport=%s', isConnected, isSensorAvailable, transportMode);
    }
    
    if (isConnected && isSensorAvailable) {
      if (DEBUG_SENSOR_LOGS) {
        console.log('[Sensor] Starting DeviceMotion listener');
      }
      subscriptionRef.current = DeviceMotion.addListener((measurement: DeviceMotionMeasurement) => {
        const rot = measurement.rotation;
        const gyro = measurement.rotationRate;
        const accel = measurement.acceleration;

        const rotation: Euler = {
          alpha: round4(rot.alpha),
          beta: round4(rot.beta),
          gamma: round4(rot.gamma),
        };

        const gyroData: Euler = gyro
          ? { alpha: round4(gyro.alpha), beta: round4(gyro.beta), gamma: round4(gyro.gamma) }
          : ZERO_EULER;

        const accelData: Vec3 = accel
          ? { x: round4(accel.x), y: round4(accel.y), z: round4(accel.z) }
          : ZERO_VEC3;

        const now = Date.now();
        if (now - lastSensorUiUpdateRef.current >= SENSOR_UI_UPDATE_INTERVAL_MS) {
          setSensorData({ rotation, gyro: gyroData, accel: accelData });
          lastSensorUiUpdateRef.current = now;
        }

        queueLatestPayload(
          rotation.alpha,
          rotation.beta,
          rotation.gamma,
          gyroData.alpha,
          gyroData.beta,
          gyroData.gamma,
          accelData.x,
          accelData.y,
          accelData.z,
          now,
        );
      });
    }

    return () => {
      if (subscriptionRef.current) {
        subscriptionRef.current.remove();
        subscriptionRef.current = null;
      }
      clearSendTimeout();
      hasPendingPayloadRef.current = false;
    };
  }, [clearSendTimeout, isConnected, isSensorAvailable, queueLatestPayload, transportMode]);

  useEffect(() => {
    return () => {
      clearSendTimeout();
      clearPacketCounterInterval();
      hasPendingPayloadRef.current = false;
    };
  }, [clearPacketCounterInterval, clearSendTimeout]);

  return {
    sensorData,
    isStreaming: isConnected && isSensorAvailable,
    isConnected,
    connect,
    disconnect,
    requestCalibration,
    packetsSent,
    connectionState,
    latency,
    transportMode,
  };
}
