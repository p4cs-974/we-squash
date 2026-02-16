import { useCallback, useMemo } from 'react';
import {
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
  Platform,
  useColorScheme,
  ActivityIndicator,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  withSpring,
  withTiming,
  FadeIn,
  FadeInUp,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

import { ThemedText } from '@/components/themed-text';
import type { SensorData } from '@/hooks/useSensorStream';

export type ConnectionState = 'idle' | 'connecting' | 'open' | 'closing' | 'closed' | 'error';
export type TransportMode = 'udp' | 'websocket';

export interface DiscoveredServer {
  ip: string;
  port: number;
}

const FALLBACK_EULER = { alpha: 0, beta: 0, gamma: 0 };
const FALLBACK_VEC3 = { x: 0, y: 0, z: 0 };

interface ConnectionPanelProps {
  ipAddress: string;
  port: string;
  onIpAddressChange: (value: string) => void;
  onPortChange: (value: string) => void;
  sensorData: SensorData;
  isConnected: boolean;
  onConnect: (wsUrl: string) => void;
  onDisconnect: () => void;
  packetsSent: number;
  connectionState: ConnectionState;
  latency?: number;
  transportMode: TransportMode;
  onTransportModeChange: (mode: TransportMode) => void;
  discoveredServer: DiscoveredServer | null;
}

export function ConnectionPanel({
  ipAddress,
  port,
  onIpAddressChange,
  onPortChange,
  sensorData,
  isConnected,
  onConnect,
  onDisconnect,
  packetsSent,
  connectionState,
  latency,
  transportMode,
  onTransportModeChange,
  discoveredServer,
}: ConnectionPanelProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const handleToggleConnection = useCallback(() => {
    if (Platform.OS === 'ios') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }

    if (isConnected) {
      onDisconnect();
    } else if (transportMode === 'udp' && discoveredServer) {
      onConnect(`udp://${discoveredServer.ip}:${discoveredServer.port}`);
    } else {
      const wsUrl = `ws://${ipAddress}:${port}`;
      onConnect(wsUrl);
    }
  }, [isConnected, ipAddress, port, onConnect, onDisconnect, transportMode, discoveredServer]);

  const handleTransportChange = useCallback((mode: TransportMode) => {
    if (Platform.OS === 'ios') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    onTransportModeChange(mode);
  }, [onTransportModeChange]);

  const { statusColor, statusText, pulseAnimation } = useMemo(() => {
    switch (connectionState) {
      case 'idle':
      case 'closed':
        return {
          statusColor: isDark ? '#8E8E93' : '#C7C7CC',
          statusText: 'Ready to connect',
          pulseAnimation: false,
        };
      case 'connecting':
        return {
          statusColor: '#FF9500',
          statusText: 'Connecting...',
          pulseAnimation: true,
        };
      case 'open':
        return {
          statusColor: '#34C759',
          statusText: 'Connected',
          pulseAnimation: false,
        };
      case 'error':
      case 'closing':
        return {
          statusColor: '#FF3B30',
          statusText: connectionState === 'error' ? 'Connection Error' : 'Disconnecting...',
          pulseAnimation: false,
        };
      default:
        return {
          statusColor: isDark ? '#8E8E93' : '#C7C7CC',
          statusText: 'Unknown',
          pulseAnimation: false,
        };
    }
  }, [connectionState, isDark]);

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [
      {
        scale: pulseAnimation
          ? withTiming(1.2, { duration: 500 })
          : withSpring(1),
      },
    ],
    opacity: pulseAnimation
      ? withTiming(0.5, { duration: 500 })
      : withTiming(1),
  }));

  const rotation = sensorData?.rotation ?? FALLBACK_EULER;
  const gyro = sensorData?.gyro ?? FALLBACK_EULER;
  const accel = sensorData?.accel ?? FALLBACK_VEC3;

  const buttonText = isConnected ? 'Disconnect' : 'Connect';
  const buttonColor = isConnected ? '#FF3B30' : '#007AFF';

  const backgroundColor = isDark ? '#1C1C1E' : '#FFFFFF';
  const secondaryBackground = isDark ? '#2C2C2E' : '#F2F2F7';
  const textColor = isDark ? '#FFFFFF' : '#000000';
  const secondaryTextColor = isDark ? '#8E8E93' : '#8E8E93';
  const borderColor = isDark ? '#38383A' : '#E5E5EA';

  const isUDPDiscovered = transportMode === 'udp' && discoveredServer !== null;
  const isUDPSearching = transportMode === 'udp' && discoveredServer === null && !isConnected;

  return (
    <Animated.View entering={FadeInUp.duration(400)} style={styles.container}>
      <View style={[styles.header, { backgroundColor }]}>
        <ThemedText type="title" style={[styles.title, { color: textColor }]}>
          WeSquash
        </ThemedText>
        <ThemedText style={[styles.subtitle, { color: secondaryTextColor }]}>
          Motion Controller
        </ThemedText>

        <View style={styles.statusContainer}>
          <Animated.View
            style={[
              styles.statusDot,
              { backgroundColor: statusColor },
              pulseStyle,
            ]}
          />
          <ThemedText style={[styles.statusText, { color: statusColor }]}>
            {statusText}
          </ThemedText>
        </View>
      </View>

      <View style={[styles.card, { backgroundColor, borderColor }]}>
        <ThemedText style={[styles.cardTitle, { color: textColor }]}>
          Server Connection
        </ThemedText>

        <View style={[styles.transportSelector, { backgroundColor: secondaryBackground }]}>
          <TouchableOpacity
            style={[
              styles.transportButton,
              transportMode === 'udp' && { backgroundColor: '#007AFF' },
            ]}
            onPress={() => handleTransportChange('udp')}
            activeOpacity={0.8}
            disabled={isConnected}
          >
            <ThemedText
              style={[
                styles.transportButtonText,
                { color: transportMode === 'udp' ? '#FFFFFF' : textColor },
              ]}
            >
              UDP (Auto)
            </ThemedText>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.transportButton,
              transportMode === 'websocket' && { backgroundColor: '#007AFF' },
            ]}
            onPress={() => handleTransportChange('websocket')}
            activeOpacity={0.8}
            disabled={isConnected}
          >
            <ThemedText
              style={[
                styles.transportButtonText,
                { color: transportMode === 'websocket' ? '#FFFFFF' : textColor },
              ]}
            >
              Manual (WS)
            </ThemedText>
          </TouchableOpacity>
        </View>

        {isUDPDiscovered && (
          <View style={[styles.discoveryBadge, { backgroundColor: '#34C759' }]}>
            <ThemedText style={styles.discoveryBadgeText}>
              Auto-discovered: {discoveredServer.ip}:{discoveredServer.port}
            </ThemedText>
          </View>
        )}

        {isUDPSearching && (
          <View style={styles.searchingContainer}>
            <ActivityIndicator size="small" color="#007AFF" />
            <ThemedText style={[styles.searchingText, { color: secondaryTextColor }]}>
              Searching for game server...
            </ThemedText>
          </View>
        )}

        {transportMode === 'websocket' && (
          <View style={styles.inputRow}>
            <View style={[styles.inputContainer, { flex: 1 }]}>
              <ThemedText style={[styles.inputLabel, { color: secondaryTextColor }]}>
                IP Address
              </ThemedText>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: secondaryBackground,
                    color: textColor,
                    borderColor,
                  },
                ]}
                placeholder="192.168.1.100"
                placeholderTextColor={secondaryTextColor}
                value={ipAddress}
                onChangeText={onIpAddressChange}
                keyboardType="numbers-and-punctuation"
                autoCapitalize="none"
                autoCorrect={false}
                editable={!isConnected}
                selectionColor="#007AFF"
              />
            </View>

            <View style={styles.inputContainer}>
              <ThemedText style={[styles.inputLabel, { color: secondaryTextColor }]}>
                Port
              </ThemedText>
              <TextInput
                style={[
                  styles.input,
                  styles.portInput,
                  {
                    backgroundColor: secondaryBackground,
                    color: textColor,
                    borderColor,
                  },
                ]}
                placeholder="9080"
                placeholderTextColor={secondaryTextColor}
                value={port}
                onChangeText={onPortChange}
                keyboardType="number-pad"
                editable={!isConnected}
                selectionColor="#007AFF"
              />
            </View>
          </View>
        )}

        <TouchableOpacity
          style={[styles.button, { backgroundColor: buttonColor }]}
          onPress={handleToggleConnection}
          activeOpacity={0.8}
        >
          <ThemedText style={styles.buttonText}>{buttonText}</ThemedText>
        </TouchableOpacity>
      </View>

      {isConnected && (
        <Animated.View
          entering={FadeIn.duration(300)}
          style={[styles.card, { backgroundColor, borderColor }]}
        >
          <ThemedText style={[styles.cardTitle, { color: textColor }]}>
            Connection Stats
          </ThemedText>
          <View style={styles.statsGrid}>
            <StatItem
              label="Packets"
              value={packetsSent.toString()}
              isDark={isDark}
            />
            {latency !== undefined && (
              <StatItem
                label="Latency"
                value={`${latency}ms`}
                isDark={isDark}
              />
            )}
            <StatItem
              label="Transport"
              value={transportMode === 'udp' ? 'UDP' : 'WS'}
              isDark={isDark}
            />
          </View>
        </Animated.View>
      )}

      <View style={[styles.card, { backgroundColor, borderColor }]}>
        <ThemedText style={[styles.cardTitle, { color: textColor }]}>
          Orientation
        </ThemedText>
        <View style={styles.sensorGrid}>
          <SensorValue label="α" value={rotation.alpha.toFixed(3)} unit="rad" isDark={isDark} />
          <SensorValue label="β" value={rotation.beta.toFixed(3)} unit="rad" isDark={isDark} />
          <SensorValue label="γ" value={rotation.gamma.toFixed(3)} unit="rad" isDark={isDark} />
        </View>
      </View>

      <View style={[styles.card, { backgroundColor, borderColor }]}>
        <ThemedText style={[styles.cardTitle, { color: textColor }]}>
          Gyroscope
        </ThemedText>
        <View style={styles.sensorGrid}>
          <SensorValue label="X" value={gyro.alpha.toFixed(1)} unit="°/s" isDark={isDark} />
          <SensorValue label="Y" value={gyro.beta.toFixed(1)} unit="°/s" isDark={isDark} />
          <SensorValue label="Z" value={gyro.gamma.toFixed(1)} unit="°/s" isDark={isDark} />
        </View>
      </View>

      <View style={[styles.card, { backgroundColor, borderColor }]}>
        <ThemedText style={[styles.cardTitle, { color: textColor }]}>
          Acceleration
        </ThemedText>
        <View style={styles.sensorGrid}>
          <SensorValue label="X" value={accel.x.toFixed(2)} unit="m/s²" isDark={isDark} />
          <SensorValue label="Y" value={accel.y.toFixed(2)} unit="m/s²" isDark={isDark} />
          <SensorValue label="Z" value={accel.z.toFixed(2)} unit="m/s²" isDark={isDark} />
        </View>
      </View>
    </Animated.View>
  );
}

function StatItem({
  label,
  value,
  isDark,
}: {
  label: string;
  value: string;
  isDark: boolean;
}) {
  return (
    <View style={styles.statItem}>
      <ThemedText
        style={[styles.statValue, { color: isDark ? '#FFFFFF' : '#000000' }]}
      >
        {value}
      </ThemedText>
      <ThemedText style={[styles.statLabel, { color: '#8E8E93' }]}>{label}</ThemedText>
    </View>
  );
}

function SensorValue({
  label,
  value,
  unit,
  isDark,
}: {
  label: string;
  value: string;
  unit: string;
  isDark: boolean;
}) {
  return (
    <View style={styles.sensorItem}>
      <ThemedText style={[styles.sensorLabel, { color: '#8E8E93' }]}>{label}</ThemedText>
      <ThemedText
        style={[styles.sensorValue, { color: isDark ? '#FFFFFF' : '#000000' }]}
      >
        {value}
      </ThemedText>
      <ThemedText style={[styles.sensorUnit, { color: '#8E8E93' }]}>{unit}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 12,
  },
  header: {
    alignItems: 'center',
    paddingVertical: 20,
    borderRadius: 16,
    marginBottom: 4,
  },
  title: {
    fontSize: 34,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 17,
    marginTop: 4,
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  statusText: {
    fontSize: 15,
    fontWeight: '500',
  },
  card: {
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    gap: 16,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: '600',
  },
  transportSelector: {
    flexDirection: 'row',
    borderRadius: 10,
    padding: 4,
    gap: 4,
  },
  transportButton: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  transportButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  discoveryBadge: {
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  discoveryBadgeText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '500',
  },
  searchingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 8,
  },
  searchingText: {
    fontSize: 14,
    fontWeight: '500',
  },
  inputRow: {
    flexDirection: 'row',
    gap: 12,
  },
  inputContainer: {
    gap: 6,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    height: 44,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 17,
    borderWidth: 1,
  },
  portInput: {
    width: 90,
  },
  button: {
    height: 50,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 4,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
  },
  statsGrid: {
    flexDirection: 'row',
    gap: 24,
  },
  statItem: {
    alignItems: 'center',
    gap: 4,
  },
  statValue: {
    fontSize: 28,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  statLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  sensorGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  sensorItem: {
    alignItems: 'center',
    gap: 4,
  },
  sensorLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  sensorValue: {
    fontSize: 20,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  sensorUnit: {
    fontSize: 12,
  },
});
