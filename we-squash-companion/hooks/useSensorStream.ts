import { useCallback, useEffect, useRef, useState } from 'react';
import { DeviceMotion, type DeviceMotionMeasurement } from 'expo-sensors';
import { useWebSocket } from './useWebSocket';
import { useUDPSocket } from './useUDPSocket';
import { encodeSensorPacket } from '@/utils/binaryProtocol';

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

type ConnectionState = 'idle' | 'connecting' | 'open' | 'closing' | 'closed' | 'error';
type TransportMode = 'udp' | 'websocket';

interface UseSensorStreamReturn {
  sensorData: SensorData;
  isStreaming: boolean;
  isConnected: boolean;
  connect: (wsUrl?: string) => void;
  disconnect: () => void;
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
  const pendingSendRef = useRef(false);
  const animationFrameRef = useRef<number | null>(null);
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
        console.log('[Sensor] DeviceMotion available:', available);
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
    serverIpRef.current = serverIp;
  }, [serverIp]);

  useEffect(() => {
    serverPortRef.current = serverPort;
  }, [serverPort]);

  const connect = useCallback((explicitWsUrl?: string) => {
    console.log('[Sensor] connect() called, transport=', transportMode);
    packetsSentRef.current = 0;
    lastSentRef.current = 0;
    pendingSendRef.current = false;
    setPacketsSent(0);

    if (transportMode === 'udp') {
      const ip = serverIpRef.current;
      const port = serverPortRef.current;
      if (ip && port) {
        udpConnect(ip, port);
      } else {
        console.log('[Sensor] UDP connect skipped - no server IP/port');
      }
    } else {
      const url = explicitWsUrl ?? wsUrlRef.current;
      if (url) {
        wsConnect(url);
      }
    }
  }, [transportMode, udpConnect, wsConnect]);

  const disconnect = useCallback(() => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (transportMode === 'udp') {
      udpDisconnect();
    } else {
      wsDisconnect();
    }
  }, [transportMode, udpDisconnect, wsDisconnect]);

  const send = useCallback((data: SensorPayload): boolean => {
    if (transportMode === 'udp') {
      const binaryData = encodeSensorPacket({
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
      return udpSend(binaryData);
    } else {
      return wsSend(JSON.stringify(data));
    }
  }, [transportMode, udpSend, wsSend]);

  const throttledSend = useCallback((payload: SensorPayload) => {
    const now = Date.now();
    
    if (now - lastSentRef.current >= throttleInterval) {
      const success = send(payload);
      if (success) {
        packetsSentRef.current += 1;
        setPacketsSent(packetsSentRef.current);
        lastSentRef.current = now;
      }
      pendingSendRef.current = false;
      return;
    }

    if (!pendingSendRef.current) {
      pendingSendRef.current = true;
      
      const scheduleSend = () => {
        const currentTime = Date.now();
        if (currentTime - lastSentRef.current >= throttleInterval) {
          const success = send(payload);
          if (success) {
            packetsSentRef.current += 1;
            setPacketsSent(packetsSentRef.current);
            lastSentRef.current = currentTime;
          }
          pendingSendRef.current = false;
          animationFrameRef.current = null;
        } else {
          animationFrameRef.current = requestAnimationFrame(scheduleSend);
        }
      };
      
      animationFrameRef.current = requestAnimationFrame(scheduleSend);
    }
  }, [send, throttleInterval]);

  useEffect(() => {
    if (subscriptionRef.current) {
      subscriptionRef.current.remove();
      subscriptionRef.current = null;
    }

    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    console.log('[Sensor] Streaming effect: isConnected=%s isSensorAvailable=%s transport=%s', isConnected, isSensorAvailable, transportMode);
    
    if (isConnected && isSensorAvailable) {
      console.log('[Sensor] Starting DeviceMotion listener');
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

        setSensorData({ rotation, gyro: gyroData, accel: accelData });

        const payload: SensorPayload = {
          type: 'sensor',
          device: 'phone',
          ra: rotation.alpha,
          rb: rotation.beta,
          rg: rotation.gamma,
          ga: gyroData.alpha,
          gb: gyroData.beta,
          gg: gyroData.gamma,
          ax: accelData.x,
          ay: accelData.y,
          az: accelData.z,
          ts: Date.now(),
        };

        throttledSend(payload);
      });
    }

    return () => {
      if (subscriptionRef.current) {
        subscriptionRef.current.remove();
        subscriptionRef.current = null;
      }
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [isConnected, isSensorAvailable, throttledSend, transportMode]);

  return {
    sensorData,
    isStreaming: isConnected && isSensorAvailable,
    isConnected,
    connect,
    disconnect,
    packetsSent,
    connectionState,
    latency,
    transportMode,
  };
}
