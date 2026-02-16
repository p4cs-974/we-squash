import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';

type ConnectionState = 'idle' | 'connecting' | 'open' | 'closing' | 'closed' | 'error';

interface UseWebSocketReturn {
  isConnected: boolean;
  connect: (explicitUrl?: string) => void;
  disconnect: () => void;
  send: (data: string | ArrayBuffer | Blob) => boolean;
  lastMessage: string | null;
  connectionState: ConnectionState;
  latency: number | undefined;
}

interface UseWebSocketOptions {
  url?: string;
  maxReconnectAttempts?: number;
  baseReconnectDelay?: number;
  maxReconnectDelay?: number;
  connectionTimeout?: number;
  pingInterval?: number;
  enableAppStateAwareness?: boolean;
}

const TAG = '[WS]';
const DEFAULT_PING_INTERVAL = 30000; // 30 seconds
const DEFAULT_CONNECTION_TIMEOUT = 10000; // 10 seconds
const DEBUG_WS_LOGS = false;

function debugLog(...args: unknown[]) {
  if (DEBUG_WS_LOGS) {
    console.log(...args);
  }
}

export function useWebSocket({
  url: initialUrl = '',
  maxReconnectAttempts = 5,
  baseReconnectDelay = 1000,
  maxReconnectDelay = 30000,
  connectionTimeout = DEFAULT_CONNECTION_TIMEOUT,
  pingInterval = DEFAULT_PING_INTERVAL,
  enableAppStateAwareness = true,
}: UseWebSocketOptions): UseWebSocketReturn {
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
  const [lastMessage, setLastMessage] = useState<string | null>(null);
  const [latency, setLatency] = useState<number | undefined>(undefined);
  
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isConnectingRef = useRef(false);
  const activeUrlRef = useRef(initialUrl);
  const manualDisconnectRef = useRef(false);
  const lastPingTimeRef = useRef<number>(0);
  const appStateRef = useRef<AppStateStatus>('active');

  const isConnected = connectionState === 'open';

  // Validate WebSocket URL
  const isValidWebSocketUrl = useCallback((url: string): boolean => {
    try {
      const wsUrl = new URL(url);
      return wsUrl.protocol === 'ws:' || wsUrl.protocol === 'wss:';
    } catch {
      return false;
    }
  }, []);

  const clearAllTimers = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (connectionTimeoutRef.current) {
      clearTimeout(connectionTimeoutRef.current);
      connectionTimeoutRef.current = null;
    }
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
  }, []);

  const cleanupWebSocket = useCallback(() => {
    if (wsRef.current) {
      const ws = wsRef.current;
      ws.onopen = null;
      ws.onclose = null;
      ws.onerror = null;
      ws.onmessage = null;
      
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close(1000, 'Cleanup');
      }
      wsRef.current = null;
    }
  }, []);

  const startPingInterval = useCallback(() => {
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
    }
    
    pingIntervalRef.current = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        lastPingTimeRef.current = Date.now();
        wsRef.current.send(JSON.stringify({ type: 'ping', timestamp: lastPingTimeRef.current }));
      }
    }, pingInterval);
  }, [pingInterval]);

  const stopPingInterval = useCallback(() => {
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
  }, []);

  const getNextReconnectDelay = useCallback((): number => {
    // Exponential backoff with jitter
    const delay = Math.min(
      baseReconnectDelay * Math.pow(2, reconnectAttemptsRef.current),
      maxReconnectDelay
    );
    // Add random jitter (±25%) to prevent thundering herd
    return Math.floor(delay * (0.75 + Math.random() * 0.5));
  }, [baseReconnectDelay, maxReconnectDelay]);

  const performConnect = useCallback((targetUrl: string) => {
    if (isConnectingRef.current) {
      debugLog(TAG, 'performConnect SKIPPED — already connecting');
      return;
    }

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      debugLog(TAG, 'performConnect SKIPPED — already open');
      return;
    }

    // Validate URL before attempting connection
    if (!isValidWebSocketUrl(targetUrl)) {
      console.error(TAG, `Invalid WebSocket URL: ${targetUrl}`);
      setConnectionState('error');
      return;
    }

    debugLog(TAG, `performConnect → ${targetUrl}`);
    isConnectingRef.current = true;
    manualDisconnectRef.current = false;
    setConnectionState('connecting');

    // Set connection timeout
    connectionTimeoutRef.current = setTimeout(() => {
      debugLog(TAG, 'Connection timeout');
      if (wsRef.current) {
        wsRef.current.close(1000, 'Connection timeout');
      }
      isConnectingRef.current = false;
      setConnectionState('error');
    }, connectionTimeout);

    try {
      debugLog(TAG, 'Creating WebSocket instance...');
      const ws = new WebSocket(targetUrl);
      wsRef.current = ws;
      debugLog(TAG, `WebSocket created, readyState=${ws.readyState} (0=CONNECTING, 1=OPEN)`);

      ws.onopen = () => {
        debugLog(TAG, '✓ onopen — connection established');
        clearTimeout(connectionTimeoutRef.current!);
        connectionTimeoutRef.current = null;
        isConnectingRef.current = false;
        reconnectAttemptsRef.current = 0;
        setConnectionState('open');
        setLatency(undefined);
        startPingInterval();
      };

      ws.onclose = (event) => {
        debugLog(
          TAG,
          `✗ onclose — code=${event.code} reason="${event.reason}" wasClean=${event.wasClean}`,
        );
        clearTimeout(connectionTimeoutRef.current!);
        connectionTimeoutRef.current = null;
        isConnectingRef.current = false;
        stopPingInterval();
        cleanupWebSocket();
        
        if (manualDisconnectRef.current) {
          debugLog(TAG, 'Manual disconnect — not reconnecting');
          setConnectionState('closed');
        } else {
          setConnectionState('closed');
          
          if (reconnectAttemptsRef.current < maxReconnectAttempts) {
            const delay = getNextReconnectDelay();
            reconnectAttemptsRef.current += 1;
            debugLog(
              TAG,
              `Scheduling reconnect #${reconnectAttemptsRef.current}/${maxReconnectAttempts} in ${delay}ms`,
            );
            
            reconnectTimeoutRef.current = setTimeout(() => {
              performConnect(activeUrlRef.current);
            }, delay);
          } else {
            debugLog(TAG, `Max reconnect attempts (${maxReconnectAttempts}) reached — giving up`);
            setConnectionState('error');
          }
        }
      };

      ws.onerror = (event) => {
        debugLog(TAG, '✗ onerror:', event);
        // onerror is always followed by onclose in the WebSocket spec
      };

      ws.onmessage = (event) => {
        if (typeof event.data === 'string') {
          // Handle pong messages for latency calculation
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'pong' && data.timestamp) {
              const roundTripTime = Date.now() - data.timestamp;
              setLatency(roundTripTime);
              return;
            }
          } catch {
            // Not a JSON message or not a pong
          }
          setLastMessage(event.data);
        }
      };
    } catch (err) {
      debugLog(TAG, '✗ WebSocket constructor threw:', err);
      clearTimeout(connectionTimeoutRef.current!);
      connectionTimeoutRef.current = null;
      isConnectingRef.current = false;
      setConnectionState('error');
      
      if (reconnectAttemptsRef.current < maxReconnectAttempts) {
        const delay = getNextReconnectDelay();
        reconnectAttemptsRef.current += 1;
        debugLog(
          TAG,
          `Scheduling reconnect #${reconnectAttemptsRef.current}/${maxReconnectAttempts} in ${delay}ms (after throw)`,
        );
        
        reconnectTimeoutRef.current = setTimeout(() => {
          performConnect(activeUrlRef.current);
        }, delay);
      }
    }
  }, [connectionTimeout, maxReconnectAttempts, getNextReconnectDelay, cleanupWebSocket, isValidWebSocketUrl, startPingInterval, stopPingInterval]);

  const connect = useCallback((explicitUrl?: string) => {
    const targetUrl = explicitUrl ?? activeUrlRef.current;
    if (!targetUrl) {
      debugLog(TAG, 'connect() called with no URL — ignoring');
      return;
    }
    
    debugLog(TAG, `connect() → url="${targetUrl}"`);
    activeUrlRef.current = targetUrl;
    clearAllTimers();
    reconnectAttemptsRef.current = 0;
    isConnectingRef.current = false;
    cleanupWebSocket();
    performConnect(targetUrl);
  }, [performConnect, clearAllTimers, cleanupWebSocket]);

  const disconnect = useCallback(() => {
    debugLog(TAG, 'disconnect() called');
    clearAllTimers();
    manualDisconnectRef.current = true;
    stopPingInterval();
    setConnectionState('closing');
    
    if (wsRef.current) {
      wsRef.current.close(1000, 'User disconnected');
    }
    
    reconnectAttemptsRef.current = 0;
  }, [clearAllTimers, stopPingInterval]);

  const send = useCallback((data: string | ArrayBuffer | Blob): boolean => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(data);
        return true;
      } catch (error) {
        console.error(TAG, 'Failed to send message:', error);
        return false;
      }
    }
    return false;
  }, []);

  // App state awareness
  useEffect(() => {
    if (!enableAppStateAwareness) return;

    const subscription = AppState.addEventListener('change', (nextAppState) => {
      const previousState = appStateRef.current;
      appStateRef.current = nextAppState;

      if (previousState === 'background' && nextAppState === 'active') {
        // App came to foreground - check connection
        if (connectionState === 'closed' || connectionState === 'error') {
          debugLog(TAG, 'App returned to foreground, attempting reconnect');
          reconnectAttemptsRef.current = 0;
          performConnect(activeUrlRef.current);
        }
      }
    });

    return () => {
      subscription.remove();
    };
  }, [enableAppStateAwareness, connectionState, performConnect]);

  useEffect(() => {
    return () => {
      clearAllTimers();
      cleanupWebSocket();
    };
  }, [clearAllTimers, cleanupWebSocket]);

  return {
    isConnected,
    connect,
    disconnect,
    send,
    lastMessage,
    connectionState,
    latency,
  };
}
