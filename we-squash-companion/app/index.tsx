import { useState, useCallback, useMemo } from 'react';
import { StyleSheet, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConnectionPanel } from '@/components/ConnectionPanel';
import { QRScanner } from '@/components/QRScanner';
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
  const [isQRScannerVisible, setIsQRScannerVisible] = useState(false);

  const { discoveredServer, handleDeepLink } = useDiscovery();

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
    requestCalibration,
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

  const handleQRScan = useCallback((data: string) => {
    const server = handleDeepLink(data);
    if (server) {
      setIpAddress(server.ip);
      setPort(server.port.toString());
      setTransportMode('udp');
    }
  }, [handleDeepLink]);

  const handleOpenQRScanner = useCallback(() => {
    setIsQRScannerVisible(true);
  }, []);

  const handleCloseQRScanner = useCallback(() => {
    setIsQRScannerVisible(false);
  }, []);

  const handleRequestCalibration = useCallback(() => {
    return requestCalibration();
  }, [requestCalibration]);

  const backgroundColor = Colors[colorScheme ?? 'light'].background;

  return (
    <>
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
          onScanQRCode={handleOpenQRScanner}
          onRequestCalibration={handleRequestCalibration}
        />
      </ScrollView>
      <QRScanner
        isVisible={isQRScannerVisible}
        onClose={handleCloseQRScanner}
        onScan={handleQRScan}
      />
    </>
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
