import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
  Platform,
  useColorScheme,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  withSpring,
  withTiming,
  FadeIn,
  FadeInUp,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';

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
const CALIBRATION_HOLD_DURATION_MS = 3000;

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
  onScanQRCode?: () => void;
  onRequestCalibration?: () => boolean | Promise<boolean>;
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
  onScanQRCode,
  onRequestCalibration,
}: ConnectionPanelProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const [calibrationProgress, setCalibrationProgress] = useState(0);
  const [isCalibrationHolding, setIsCalibrationHolding] = useState(false);
  const [isCalibrationSubmitting, setIsCalibrationSubmitting] = useState(false);

  const holdStartedAtRef = useRef(0);
  const holdTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdAnimationFrameRef = useRef<number | null>(null);
  const holdHapticTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdActiveRef = useRef(false);
  const holdCompletedRef = useRef(false);

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

  const handleQRPress = useCallback(() => {
    if (Platform.OS === 'ios') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    onScanQRCode?.();
  }, [onScanQRCode]);

  const clearCalibrationTimers = useCallback(() => {
    if (holdTimeoutRef.current) {
      clearTimeout(holdTimeoutRef.current);
      holdTimeoutRef.current = null;
    }
    if (holdHapticTimeoutRef.current) {
      clearTimeout(holdHapticTimeoutRef.current);
      holdHapticTimeoutRef.current = null;
    }
    if (holdAnimationFrameRef.current !== null) {
      cancelAnimationFrame(holdAnimationFrameRef.current);
      holdAnimationFrameRef.current = null;
    }
  }, []);

  const tickCalibrationProgress = () => {
    if (!holdActiveRef.current) {
      return;
    }

    const elapsed = Date.now() - holdStartedAtRef.current;
    const progress = Math.min(1, elapsed / CALIBRATION_HOLD_DURATION_MS);
    setCalibrationProgress(progress);

    if (progress < 1) {
      holdAnimationFrameRef.current = requestAnimationFrame(tickCalibrationProgress);
    }
  };

  const runCalibrationHaptics = () => {
    if (Platform.OS !== 'ios' || !holdActiveRef.current) {
      return;
    }

    const elapsed = Date.now() - holdStartedAtRef.current;
    const progress = Math.min(1, elapsed / CALIBRATION_HOLD_DURATION_MS);

    let style = Haptics.ImpactFeedbackStyle.Soft;
    if (progress > 0.8) {
      style = Haptics.ImpactFeedbackStyle.Heavy;
    } else if (progress > 0.55) {
      style = Haptics.ImpactFeedbackStyle.Medium;
    } else if (progress > 0.3) {
      style = Haptics.ImpactFeedbackStyle.Light;
    }

    void Haptics.impactAsync(style);

    const eased = 1 - Math.pow(1 - progress, 2.2);
    const nextInterval = Math.max(55, Math.round(360 - 300 * eased));
    holdHapticTimeoutRef.current = setTimeout(() => {
      runCalibrationHaptics();
    }, nextInterval);
  };

  const completeCalibrationHold = useCallback(async () => {
    if (holdCompletedRef.current) {
      return;
    }

    holdCompletedRef.current = true;
    holdActiveRef.current = false;
    clearCalibrationTimers();
    setIsCalibrationHolding(false);
    setCalibrationProgress(1);
    setIsCalibrationSubmitting(true);

    const success = onRequestCalibration ? await Promise.resolve(onRequestCalibration()) : false;

    setIsCalibrationSubmitting(false);
    if (Platform.OS === 'ios') {
      void Haptics.notificationAsync(
        success
          ? Haptics.NotificationFeedbackType.Success
          : Haptics.NotificationFeedbackType.Error,
      );
    }

    if (success) {
      setTimeout(() => {
        setCalibrationProgress(0);
      }, 500);
    } else {
      setCalibrationProgress(0);
    }
  }, [clearCalibrationTimers, onRequestCalibration]);

  const handleCalibrationPressIn = () => {
    if (!isConnected || !onRequestCalibration || isCalibrationSubmitting) {
      return;
    }

    holdCompletedRef.current = false;
    holdActiveRef.current = true;
    holdStartedAtRef.current = Date.now();
    setCalibrationProgress(0);
    setIsCalibrationHolding(true);

    if (Platform.OS === 'ios') {
      void Haptics.selectionAsync();
    }

    tickCalibrationProgress();
    runCalibrationHaptics();

    holdTimeoutRef.current = setTimeout(() => {
      void completeCalibrationHold();
    }, CALIBRATION_HOLD_DURATION_MS);
  };

  const handleCalibrationPressOut = () => {
    if (!holdActiveRef.current) {
      return;
    }

    holdActiveRef.current = false;
    clearCalibrationTimers();
    setIsCalibrationHolding(false);

    if (!holdCompletedRef.current) {
      setCalibrationProgress(0);
      if (Platform.OS === 'ios') {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
      }
    }
  };

  useEffect(() => {
    if (!isConnected) {
      holdActiveRef.current = false;
      holdCompletedRef.current = false;
      clearCalibrationTimers();
      setCalibrationProgress(0);
      setIsCalibrationHolding(false);
      setIsCalibrationSubmitting(false);
    }
  }, [clearCalibrationTimers, isConnected]);

  useEffect(() => {
    return () => {
      clearCalibrationTimers();
    };
  }, [clearCalibrationTimers]);

  const calibrationProgressPercent = Math.round(calibrationProgress * 100);
  const canRequestCalibration = isConnected && Boolean(onRequestCalibration) && !isCalibrationSubmitting;
  const calibrationButtonText = isCalibrationSubmitting
    ? 'Starting calibration...'
    : isCalibrationHolding
      ? 'Keep holding...'
      : 'Hold to Calibrate (3s)';
  const calibrationStatusText = isCalibrationSubmitting
    ? 'Calibration requested on game.'
    : isCalibrationHolding
      ? 'Hold steady. Haptics speed up as the timer completes.'
      : 'Press and hold for 3 seconds.';

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

        {!isUDPDiscovered && !isConnected && onScanQRCode && (
          <TouchableOpacity
            style={[styles.qrButton, { backgroundColor: secondaryBackground }]}
            onPress={handleQRPress}
            activeOpacity={0.8}
          >
            <Ionicons name="qr-code-outline" size={24} color="#007AFF" />
            <ThemedText style={[styles.qrButtonText, { color: textColor }]}>
              Scan QR Code
            </ThemedText>
            <Ionicons name="chevron-forward" size={20} color={secondaryTextColor} />
          </TouchableOpacity>
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

      {isConnected && onRequestCalibration && (
        <Animated.View
          entering={FadeIn.duration(300)}
          style={[styles.card, { backgroundColor, borderColor }]}
        >
          <ThemedText style={[styles.cardTitle, { color: textColor }]}>
            Calibration
          </ThemedText>
          <ThemedText style={[styles.calibrationHint, { color: secondaryTextColor }]}>
            Hold your arms fully extended to the right, keep the phone side pointing up,
            and point the back of the phone toward the Godot camera.
          </ThemedText>

          <Pressable
            style={({ pressed }) => [
              styles.calibrationButton,
              {
                backgroundColor: secondaryBackground,
                borderColor,
                opacity: canRequestCalibration ? 1 : 0.65,
              },
              pressed && canRequestCalibration && styles.calibrationButtonPressed,
            ]}
            onPressIn={handleCalibrationPressIn}
            onPressOut={handleCalibrationPressOut}
            onTouchCancel={handleCalibrationPressOut}
            disabled={!canRequestCalibration}
          >
            <View style={styles.calibrationProgressTrack}>
              <View
                style={[
                  styles.calibrationProgressFill,
                  { width: `${calibrationProgressPercent}%` },
                ]}
              />
            </View>
            <ThemedText style={[styles.calibrationButtonText, { color: textColor }]}>
              {calibrationButtonText}
            </ThemedText>
            <ThemedText style={[styles.calibrationProgressText, { color: secondaryTextColor }]}>
              {calibrationProgressPercent}%
            </ThemedText>
          </Pressable>

          <ThemedText style={[styles.calibrationStatus, { color: secondaryTextColor }]}>
            {calibrationStatusText}
          </ThemedText>
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
  qrButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    gap: 12,
  },
  qrButtonText: {
    flex: 1,
    fontSize: 17,
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
  calibrationHint: {
    fontSize: 14,
    lineHeight: 20,
  },
  calibrationButton: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  calibrationButtonPressed: {
    transform: [{ scale: 0.99 }],
  },
  calibrationProgressTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(10, 132, 255, 0.2)',
    overflow: 'hidden',
  },
  calibrationProgressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#0A84FF',
  },
  calibrationButtonText: {
    fontSize: 17,
    fontWeight: '600',
  },
  calibrationProgressText: {
    fontSize: 13,
    fontVariant: ['tabular-nums'],
  },
  calibrationStatus: {
    fontSize: 13,
    lineHeight: 18,
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
