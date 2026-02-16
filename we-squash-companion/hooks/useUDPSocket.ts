import { useCallback, useEffect, useRef, useState } from 'react';
import dgram from 'react-native-udp';
import { Buffer } from 'buffer';
import { encodeHeartbeatPacket, decodeHeartbeatResponse } from '@/utils/binaryProtocol';

type ConnectionState = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

const TAG = '[UDP]';
const HEARTBEAT_INTERVAL = 5000;
const HEARTBEAT_TIMEOUT = 15000;
const DEBUG_UDP_LOGS = false;

function debugLog(...args: unknown[]) {
  if (DEBUG_UDP_LOGS) {
    console.log(...args);
  }
}

interface UseUDPSocketReturn {
  isConnected: boolean;
  connect: (ip: string, port: number) => void;
  disconnect: () => void;
  send: (data: Buffer) => boolean;
  connectionState: ConnectionState;
  latency: number | undefined;
}

interface UseUDPSocketOptions {
  enableHeartbeat?: boolean;
}

export function useUDPSocket({
  enableHeartbeat = true,
}: UseUDPSocketOptions = {}): UseUDPSocketReturn {
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
  const [latency, setLatency] = useState<number | undefined>(undefined);

  const socketRef = useRef<ReturnType<typeof dgram.createSocket> | null>(null);
  const destIpRef = useRef<string>('');
  const destPortRef = useRef<number>(0);
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const heartbeatTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isConnectingRef = useRef(false);
  const manualDisconnectRef = useRef(false);

  const isConnected = connectionState === 'open';

  const clearHeartbeatTimers = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
    if (heartbeatTimeoutRef.current) {
      clearTimeout(heartbeatTimeoutRef.current);
      heartbeatTimeoutRef.current = null;
    }
  }, []);

  const cleanupSocket = useCallback(() => {
    if (socketRef.current) {
      try {
        socketRef.current.close();
      } catch (error) {
        debugLog(TAG, 'Error closing socket:', error);
      }
      socketRef.current = null;
    }
  }, []);

  const handleHeartbeatResponse = useCallback((buf: Buffer) => {
    const response = decodeHeartbeatResponse(buf);
    if (response) {
      const rtt = Date.now() - response.timestamp;
      setLatency(rtt);

      if (connectionState !== 'open') {
        setConnectionState('open');
      }

      if (heartbeatTimeoutRef.current) {
        clearTimeout(heartbeatTimeoutRef.current);
      }
      heartbeatTimeoutRef.current = setTimeout(() => {
        debugLog(TAG, 'Heartbeat timeout - no response from server');
        setConnectionState('closed');
        clearHeartbeatTimers();
      }, HEARTBEAT_TIMEOUT);
    }
  }, [connectionState, clearHeartbeatTimers]);

  const startHeartbeat = useCallback(() => {
    if (!enableHeartbeat) return;

    clearHeartbeatTimers();

    heartbeatIntervalRef.current = setInterval(() => {
      if (socketRef.current) {
        const timestamp = Date.now();
        const heartbeatPacket = encodeHeartbeatPacket(timestamp);
        
        try {
          socketRef.current.send(
            heartbeatPacket,
            0,
            heartbeatPacket.length,
            destPortRef.current,
            destIpRef.current
          );
        } catch (error) {
          console.error(TAG, 'Failed to send heartbeat:', error);
        }
      }
    }, HEARTBEAT_INTERVAL);

    heartbeatTimeoutRef.current = setTimeout(() => {
      debugLog(TAG, 'Heartbeat timeout - no response from server');
      setConnectionState('closed');
      clearHeartbeatTimers();
    }, HEARTBEAT_TIMEOUT);
  }, [enableHeartbeat, clearHeartbeatTimers]);

  const performConnect = useCallback((ip: string, port: number) => {
    if (isConnectingRef.current) {
      debugLog(TAG, 'performConnect SKIPPED - already connecting');
      return;
    }

    if (socketRef.current) {
      debugLog(TAG, 'performConnect SKIPPED - socket already exists');
      return;
    }

    debugLog(TAG, `performConnect -> ${ip}:${port}`);
    isConnectingRef.current = true;
    manualDisconnectRef.current = false;
    setConnectionState('connecting');
    setLatency(undefined);

    try {
      const socket = dgram.createSocket({ type: 'udp4' });
      socketRef.current = socket;
      destIpRef.current = ip;
      destPortRef.current = port;

      socket.on('message', (msg: Buffer) => {
        if (msg.length >= 9 && msg.readUInt8(0) === 0x03) {
          handleHeartbeatResponse(msg);
        }
      });

      socket.on('error', (error) => {
        console.error(TAG, 'Socket error:', error);
        setConnectionState('error');
        isConnectingRef.current = false;
      });

      socket.on('close', () => {
        debugLog(TAG, 'Socket closed');
        clearHeartbeatTimers();
        isConnectingRef.current = false;
        
        if (!manualDisconnectRef.current) {
          setConnectionState('closed');
        }
      });

      socket.bind(0, (err: Error | null | undefined) => {
        if (err) {
          console.error(TAG, 'Failed to bind socket:', err);
          setConnectionState('error');
          isConnectingRef.current = false;
          cleanupSocket();
          return;
        }

        debugLog(TAG, 'Socket bound successfully');
        isConnectingRef.current = false;

        if (enableHeartbeat) {
          startHeartbeat();
        } else {
          setConnectionState('open');
        }
      });
    } catch (err) {
      console.error(TAG, 'Failed to create socket:', err);
      setConnectionState('error');
      isConnectingRef.current = false;
      cleanupSocket();
    }
  }, [enableHeartbeat, startHeartbeat, handleHeartbeatResponse, cleanupSocket, clearHeartbeatTimers]);

  const connect = useCallback((ip: string, port: number) => {
    if (!ip || !port) {
      debugLog(TAG, 'connect() called with invalid ip/port');
      return;
    }

    debugLog(TAG, `connect() -> ${ip}:${port}`);
    clearHeartbeatTimers();
    cleanupSocket();
    performConnect(ip, port);
  }, [performConnect, clearHeartbeatTimers, cleanupSocket]);

  const disconnect = useCallback(() => {
    debugLog(TAG, 'disconnect() called');
    manualDisconnectRef.current = true;
    clearHeartbeatTimers();
    cleanupSocket();
    setConnectionState('closed');
    setLatency(undefined);
  }, [clearHeartbeatTimers, cleanupSocket]);

  const send = useCallback((data: Buffer): boolean => {
    if (socketRef.current && connectionState === 'open') {
      try {
        socketRef.current.send(data, 0, data.length, destPortRef.current, destIpRef.current);
        return true;
      } catch (error) {
        console.error(TAG, 'Failed to send data:', error);
        return false;
      }
    }
    return false;
  }, [connectionState]);

  useEffect(() => {
    return () => {
      clearHeartbeatTimers();
      cleanupSocket();
    };
  }, [clearHeartbeatTimers, cleanupSocket]);

  return {
    isConnected,
    connect,
    disconnect,
    send,
    connectionState,
    latency,
  };
}
