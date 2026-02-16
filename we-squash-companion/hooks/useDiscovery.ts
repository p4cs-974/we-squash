import { useCallback, useEffect, useState } from 'react';
import * as Linking from 'expo-linking';

const TAG = '[Discovery]';
const DEBUG_DISCOVERY_LOGS = false;

function debugLog(...args: unknown[]) {
  if (DEBUG_DISCOVERY_LOGS) {
    console.log(...args);
  }
}

export interface DiscoveredServer {
  ip: string;
  port: number;
  version: number;
}

interface UseDiscoveryReturn {
  discoveredServer: DiscoveredServer | null;
  handleDeepLink: (url: string) => DiscoveredServer | null;
}

export function useDiscovery(): UseDiscoveryReturn {
  const [discoveredServer, setDiscoveredServer] = useState<DiscoveredServer | null>(null);

  const handleDeepLink = useCallback((url: string): DiscoveredServer | null => {
    try {
      debugLog(TAG, 'Processing deep link:', url);
      
      const parsedUrl = new URL(url);
      
      if (parsedUrl.hostname === 'connect') {
        const ip = parsedUrl.searchParams.get('ip');
        const wsPort = parsedUrl.searchParams.get('ws');
        const udpPort = parsedUrl.searchParams.get('udp');
        
        if (ip) {
          const port = udpPort ? parseInt(udpPort, 10) : (wsPort ? parseInt(wsPort, 10) : 9081);
          
          const server = {
            ip,
            port,
            version: 1,
          };
          
          debugLog(TAG, 'Discovered server via deep link:', server);
          setDiscoveredServer(server);
          return server;
        }
      }
      
      return null;
    } catch (error) {
      console.error(TAG, 'Error parsing deep link:', error);
      return null;
    }
  }, []);

  useEffect(() => {
    // Check for initial URL (app opened via deep link)
    const getInitialURL = async () => {
      const initialUrl = await Linking.getInitialURL();
      if (initialUrl) {
        debugLog(TAG, 'App opened with URL:', initialUrl);
        handleDeepLink(initialUrl);
      }
    };
    
    getInitialURL();

    // Listen for deep links while app is running
    const subscription = Linking.addEventListener('url', ({ url }) => {
      debugLog(TAG, 'Received deep link while running:', url);
      handleDeepLink(url);
    });

    return () => {
      subscription.remove();
    };
  }, [handleDeepLink]);

  return {
    discoveredServer,
    handleDeepLink,
  };
}
