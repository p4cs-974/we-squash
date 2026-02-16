import { useCallback, useEffect, useRef, useState } from 'react';
import dgram from 'react-native-udp';
import { parseDiscoveryBeacon } from '@/utils/binaryProtocol';

const TAG = '[Discovery]';
const DISCOVERY_PORT = 9079;
const BEACON_TIMEOUT = 10000;

export interface DiscoveredServer {
  ip: string;
  port: number;
  version: number;
}

interface UseDiscoveryReturn {
  discoveredServer: DiscoveredServer | null;
  isListening: boolean;
}

export function useDiscovery(): UseDiscoveryReturn {
  const [discoveredServer, setDiscoveredServer] = useState<DiscoveredServer | null>(null);
  const [isListening, setIsListening] = useState(false);

  const socketRef = useRef<ReturnType<typeof dgram.createSocket> | null>(null);
  const beaconTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearBeaconTimeout = useCallback(() => {
    if (beaconTimeoutRef.current) {
      clearTimeout(beaconTimeoutRef.current);
      beaconTimeoutRef.current = null;
    }
  }, []);

  const cleanupSocket = useCallback(() => {
    if (socketRef.current) {
      try {
        socketRef.current.close();
      } catch (error) {
        console.log(TAG, 'Error closing socket:', error);
      }
      socketRef.current = null;
    }
  }, []);

  const resetBeaconTimeout = useCallback(() => {
    clearBeaconTimeout();
    beaconTimeoutRef.current = setTimeout(() => {
      console.log(TAG, 'Beacon timeout - clearing discovered server');
      setDiscoveredServer(null);
    }, BEACON_TIMEOUT);
  }, [clearBeaconTimeout]);

  useEffect(() => {
    console.log(TAG, 'Starting discovery listener on port', DISCOVERY_PORT);

    try {
      const socket = dgram.createSocket({ type: 'udp4' });
      socketRef.current = socket;

      socket.on('message', (msg: Buffer, rinfo: { address: string; port: number }) => {
        try {
          const message = msg.toString('utf-8');
          const beacon = parseDiscoveryBeacon(message);

          if (beacon) {
            const serverIp = rinfo.address;
            console.log(TAG, `Discovered server: ${serverIp}:${beacon.port} (v${beacon.version})`);

            setDiscoveredServer({
              ip: serverIp,
              port: beacon.port,
              version: beacon.version,
            });

            resetBeaconTimeout();
          }
        } catch (error) {
          console.log(TAG, 'Error processing message:', error);
        }
      });

      socket.on('error', (error: Error) => {
        console.error(TAG, 'Socket error:', error);
        setIsListening(false);
      });

      socket.on('close', () => {
        console.log(TAG, 'Discovery socket closed');
        setIsListening(false);
      });

      socket.bind(DISCOVERY_PORT, (err: Error | null | undefined) => {
        if (err) {
          console.error(TAG, 'Failed to bind discovery socket:', err);
          setIsListening(false);
          return;
        }

        console.log(TAG, 'Discovery socket bound successfully');
        setIsListening(true);
      });
    } catch (err) {
      console.error(TAG, 'Failed to create discovery socket:', err);
      setIsListening(false);
    }

    return () => {
      clearBeaconTimeout();
      cleanupSocket();
    };
  }, [clearBeaconTimeout, cleanupSocket, resetBeaconTimeout]);

  return {
    discoveredServer,
    isListening,
  };
}
