import { useState, useCallback, useMemo } from 'react';
import { StyleSheet, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConnectionPanel } from '@/components/ConnectionPanel';
import { useSensorStream } from '@/hooks/useSensorStream';
import { useDiscovery } from '@/hooks/useDiscovery';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';

export type TransportMode = 'udp' | 'websocket';

export default function Index() {
  const colorScheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const [ipAddress, setIpAddress] = useState('');
  const [port, setPort] = useState('9080');
  const [transportMode, setTransportMode] = useState<TransportMode>('udp');

  const { discoveredServer } = useDiscovery();

  const serverIp = useMemo(() => {
    if (transportMode === 'udp' && discoveredServer) {
      return discoveredServer.ip;
    }
    return ipAddress;
  }, [transportMode, discoveredServer, ipAddress]);

  const serverPort = useMemo(() => {
    if (transportMode === 'udp' && discoveredServer) {
      return discoveredServer.port;
    }
    return parseInt(port, 10) || 9080;
  }, [transportMode, discoveredServer, port]);

  const {
    sensorData,
    isConnected,
    connect,
    disconnect,
    packetsSent,
    connectionState,
    latency,
  } = useSensorStream({
    transport: transportMode,
    serverIp,
    serverPort,
    wsUrl: `ws://${ipAddress}:${port}`,
  });

  const handleConnect = useCallback((wsUrl: string) => {
    connect(wsUrl);
  }, [connect]);

  const handleTransportModeChange = useCallback((mode: TransportMode) => {
    if (isConnected) {
      disconnect();
    }
    setTransportMode(mode);
  }, [isConnected, disconnect]);

  const backgroundColor = Colors[colorScheme ?? 'light'].background;

  return (
    <ScrollView
      style={[styles.container, { backgroundColor }]}
      contentContainerStyle={[
        styles.contentContainer,
        {
          paddingTop: insets.top + 16,
          paddingBottom: insets.bottom + 16,
          paddingHorizontal: 16,
        },
      ]}
      contentInsetAdjustmentBehavior="automatic"
      showsVerticalScrollIndicator={false}
    >
      <ConnectionPanel
        ipAddress={ipAddress}
        port={port}
        onIpAddressChange={setIpAddress}
        onPortChange={setPort}
        sensorData={sensorData}
        isConnected={isConnected}
        onConnect={handleConnect}
        onDisconnect={disconnect}
        packetsSent={packetsSent}
        connectionState={connectionState}
        latency={latency}
        transportMode={transportMode}
        onTransportModeChange={handleTransportModeChange}
        discoveredServer={discoveredServer}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    flexGrow: 1,
  },
});
