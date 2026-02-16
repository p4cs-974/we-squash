import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useColorScheme,
} from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeInUp,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';

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
const CALIBRATION_PROGRESS_TICK_MS = 90;

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

interface Palette {
  pageBackground: string;
  cardBackground: string;
  cardBackgroundSecondary: string;
  border: string;
  textPrimary: string;
  textSecondary: string;
  accentBlue: string;
  accentGreen: string;
  accentOrange: string;
  accentRed: string;
}

interface ConnectionHeaderViewModel {
  statusColor: string;
  statusText: string;
  pulseAnimation: boolean;
}

interface ConnectionControlSectionProps {
  palette: Palette;
  header: ConnectionHeaderViewModel;
  ipAddress: string;
  port: string;
  onIpAddressChange: (value: string) => void;
  onPortChange: (value: string) => void;
  isConnected: boolean;
  packetsSent: number;
  latency?: number;
  transportMode: TransportMode;
  discoveredServer: DiscoveredServer | null;
  onToggleConnection: () => void;
  onTransportChange: (mode: TransportMode) => void;
  onScanQRCode?: () => void;
  canRequestCalibration: boolean;
  calibrationButtonText: string;
  calibrationStatusText: string;
  calibrationProgressPercent: number;
  calibrationProgressValue: { value: number };
  onCalibrationPressIn: () => void;
  onCalibrationPressOut: () => void;
}

interface TelemetrySectionProps {
  palette: Palette;
  rotation: SensorData['rotation'];
  gyro: SensorData['gyro'];
  accel: SensorData['accel'];
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
  const [isCalibrationHolding, setIsCalibrationHolding] = useState(false);
  const [isCalibrationSubmitting, setIsCalibrationSubmitting] = useState(false);
  const [calibrationProgressPercent, setCalibrationProgressPercent] = useState(0);

  const holdStartedAtRef = useRef(0);
  const holdTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdHapticTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdProgressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const holdActiveRef = useRef(false);
  const holdCompletedRef = useRef(false);

  const calibrationProgressValue = useSharedValue(0);

  const palette = useMemo<Palette>(
    () =>
      isDark
        ? {
            pageBackground: '#070B10',
            cardBackground: '#121922',
            cardBackgroundSecondary: '#182331',
            border: '#28384B',
            textPrimary: '#F5F8FC',
            textSecondary: '#8FA1B8',
            accentBlue: '#0A84FF',
            accentGreen: '#32D74B',
            accentOrange: '#FF9F0A',
            accentRed: '#FF453A',
          }
        : {
            pageBackground: '#F3F7FB',
            cardBackground: '#FFFFFF',
            cardBackgroundSecondary: '#E9F1F9',
            border: '#D3DFEB',
            textPrimary: '#0C1621',
            textSecondary: '#5B6D82',
            accentBlue: '#006FE5',
            accentGreen: '#1FAD38',
            accentOrange: '#D67A00',
            accentRed: '#CC2F24',
          },
    [isDark],
  );

  const header = useMemo<ConnectionHeaderViewModel>(() => {
    switch (connectionState) {
      case 'idle':
      case 'closed':
        return {
          statusColor: palette.textSecondary,
          statusText: 'Ready to Sprint',
          pulseAnimation: false,
        };
      case 'connecting':
        return {
          statusColor: palette.accentOrange,
          statusText: 'Connecting...',
          pulseAnimation: true,
        };
      case 'open':
        return {
          statusColor: palette.accentGreen,
          statusText: 'Live Tracking',
          pulseAnimation: false,
        };
      case 'error':
      case 'closing':
        return {
          statusColor: palette.accentRed,
          statusText: connectionState === 'error' ? 'Connection Error' : 'Disconnecting...',
          pulseAnimation: false,
        };
      default:
        return {
          statusColor: palette.textSecondary,
          statusText: 'Unknown',
          pulseAnimation: false,
        };
    }
  }, [connectionState, palette]);

  const handleToggleConnection = useCallback(() => {
    if (Platform.OS === 'ios') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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

  const handleTransportChange = useCallback(
    (mode: TransportMode) => {
      if (Platform.OS === 'ios') {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      onTransportModeChange(mode);
    },
    [onTransportModeChange],
  );

  const clearCalibrationTimers = useCallback(() => {
    if (holdTimeoutRef.current) {
      clearTimeout(holdTimeoutRef.current);
      holdTimeoutRef.current = null;
    }
    if (holdHapticTimeoutRef.current) {
      clearTimeout(holdHapticTimeoutRef.current);
      holdHapticTimeoutRef.current = null;
    }
    if (holdProgressIntervalRef.current) {
      clearInterval(holdProgressIntervalRef.current);
      holdProgressIntervalRef.current = null;
    }
    cancelAnimation(calibrationProgressValue);
  }, [calibrationProgressValue]);

  const runCalibrationHaptics = useCallback(() => {
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
  }, []);

  const completeCalibrationHold = useCallback(async () => {
    if (holdCompletedRef.current) {
      return;
    }

    holdCompletedRef.current = true;
    holdActiveRef.current = false;
    clearCalibrationTimers();
    setIsCalibrationHolding(false);
    calibrationProgressValue.value = 1;
    setCalibrationProgressPercent(100);
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
        calibrationProgressValue.value = withTiming(0, { duration: 280, easing: Easing.out(Easing.quad) });
        setCalibrationProgressPercent(0);
      }, 500);
    } else {
      calibrationProgressValue.value = withTiming(0, { duration: 220, easing: Easing.out(Easing.quad) });
      setCalibrationProgressPercent(0);
    }
  }, [calibrationProgressValue, clearCalibrationTimers, onRequestCalibration]);

  const handleCalibrationPressIn = useCallback(() => {
    if (!isConnected || !onRequestCalibration || isCalibrationSubmitting) {
      return;
    }

    holdCompletedRef.current = false;
    holdActiveRef.current = true;
    holdStartedAtRef.current = Date.now();
    setCalibrationProgressPercent(0);
    calibrationProgressValue.value = 0;
    setIsCalibrationHolding(true);

    if (Platform.OS === 'ios') {
      void Haptics.selectionAsync();
    }

    calibrationProgressValue.value = withTiming(1, {
      duration: CALIBRATION_HOLD_DURATION_MS,
      easing: Easing.linear,
    });

    holdProgressIntervalRef.current = setInterval(() => {
      if (!holdActiveRef.current) {
        return;
      }
      const elapsed = Date.now() - holdStartedAtRef.current;
      setCalibrationProgressPercent(Math.min(100, Math.round((elapsed / CALIBRATION_HOLD_DURATION_MS) * 100)));
    }, CALIBRATION_PROGRESS_TICK_MS);

    runCalibrationHaptics();
    holdTimeoutRef.current = setTimeout(() => {
      void completeCalibrationHold();
    }, CALIBRATION_HOLD_DURATION_MS);
  }, [
    calibrationProgressValue,
    completeCalibrationHold,
    isCalibrationSubmitting,
    isConnected,
    onRequestCalibration,
    runCalibrationHaptics,
  ]);

  const handleCalibrationPressOut = useCallback(() => {
    if (!holdActiveRef.current) {
      return;
    }

    holdActiveRef.current = false;
    clearCalibrationTimers();
    setIsCalibrationHolding(false);

    if (!holdCompletedRef.current) {
      calibrationProgressValue.value = withTiming(0, { duration: 220, easing: Easing.out(Easing.quad) });
      setCalibrationProgressPercent(0);
      if (Platform.OS === 'ios') {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
      }
    }
  }, [calibrationProgressValue, clearCalibrationTimers]);

  useEffect(() => {
    if (!isConnected) {
      holdActiveRef.current = false;
      holdCompletedRef.current = false;
      clearCalibrationTimers();
      calibrationProgressValue.value = 0;
      setCalibrationProgressPercent(0);
      setIsCalibrationHolding(false);
      setIsCalibrationSubmitting(false);
    }
  }, [calibrationProgressValue, clearCalibrationTimers, isConnected]);

  useEffect(() => {
    return () => {
      clearCalibrationTimers();
    };
  }, [clearCalibrationTimers]);

  const canRequestCalibration = isConnected && Boolean(onRequestCalibration) && !isCalibrationSubmitting;
  const calibrationButtonText = isCalibrationSubmitting
    ? 'Starting calibration...'
    : isCalibrationHolding
      ? 'Hold steady...'
      : 'Hold to Calibrate (3s)';
  const calibrationStatusText = isCalibrationSubmitting
    ? 'Calibration request sent to game.'
    : isCalibrationHolding
      ? 'Keep posture fixed. Haptics accelerate near completion.'
      : 'Right-side pose, side of phone up, back of phone facing camera.';

  const rotation = sensorData?.rotation ?? FALLBACK_EULER;
  const gyro = sensorData?.gyro ?? FALLBACK_EULER;
  const accel = sensorData?.accel ?? FALLBACK_VEC3;

  return (
    <Animated.View entering={FadeInUp.duration(420)} style={styles.container}>
      <View
        pointerEvents="none"
        style={[styles.glowOrb, styles.glowOrbTop, { backgroundColor: isDark ? '#0A84FF33' : '#0A84FF1F' }]}
      />
      <View
        pointerEvents="none"
        style={[styles.glowOrb, styles.glowOrbBottom, { backgroundColor: isDark ? '#32D74B2B' : '#32D74B1F' }]}
      />

      <ConnectionControlSection
        palette={palette}
        header={header}
        ipAddress={ipAddress}
        port={port}
        onIpAddressChange={onIpAddressChange}
        onPortChange={onPortChange}
        isConnected={isConnected}
        packetsSent={packetsSent}
        latency={latency}
        transportMode={transportMode}
        discoveredServer={discoveredServer}
        onToggleConnection={handleToggleConnection}
        onTransportChange={handleTransportChange}
        onScanQRCode={onScanQRCode}
        canRequestCalibration={canRequestCalibration}
        calibrationButtonText={calibrationButtonText}
        calibrationStatusText={calibrationStatusText}
        calibrationProgressPercent={calibrationProgressPercent}
        calibrationProgressValue={calibrationProgressValue}
        onCalibrationPressIn={handleCalibrationPressIn}
        onCalibrationPressOut={handleCalibrationPressOut}
      />

      <SensorTelemetrySection palette={palette} rotation={rotation} gyro={gyro} accel={accel} />
    </Animated.View>
  );
}

const ConnectionControlSection = memo(function ConnectionControlSection({
  palette,
  header,
  ipAddress,
  port,
  onIpAddressChange,
  onPortChange,
  isConnected,
  packetsSent,
  latency,
  transportMode,
  discoveredServer,
  onToggleConnection,
  onTransportChange,
  onScanQRCode,
  canRequestCalibration,
  calibrationButtonText,
  calibrationStatusText,
  calibrationProgressPercent,
  calibrationProgressValue,
  onCalibrationPressIn,
  onCalibrationPressOut,
}: ConnectionControlSectionProps) {
  const isUDPDiscovered = transportMode === 'udp' && discoveredServer !== null;
  const pulseStyle = useAnimatedStyle(() => ({
    transform: [
      {
        scale: header.pulseAnimation ? withTiming(1.15, { duration: 480 }) : withSpring(1),
      },
    ],
    opacity: header.pulseAnimation ? withTiming(0.5, { duration: 480 }) : withTiming(1),
  }));

  const calibrationFillStyle = useAnimatedStyle(() => ({
    width: `${Math.max(0, Math.min(1, calibrationProgressValue.value)) * 100}%`,
  }));

  return (
    <>
      <View style={[styles.heroCard, { backgroundColor: palette.cardBackground, borderColor: palette.border }]}>
        <Text style={[styles.heroLabel, { color: palette.textSecondary }]}>MOTION TRAINING</Text>
        <Text style={[styles.heroTitle, { color: palette.textPrimary }]}>WeSquash Fitness Controller</Text>
        <View style={styles.statusRow}>
          <Animated.View
            style={[
              styles.statusDot,
              {
                backgroundColor: header.statusColor,
                shadowColor: header.statusColor,
              },
              pulseStyle,
            ]}
          />
          <Text style={[styles.statusText, { color: header.statusColor }]}>{header.statusText}</Text>
        </View>
      </View>

      <View style={[styles.card, { backgroundColor: palette.cardBackground, borderColor: palette.border }]}>
        <Text style={[styles.cardTitle, { color: palette.textPrimary }]}>Connection</Text>

        <View style={[styles.transportSelector, { backgroundColor: palette.cardBackgroundSecondary }]}>
          <TouchableOpacity
            style={[
              styles.transportButton,
              transportMode === 'udp' && { backgroundColor: palette.accentBlue },
            ]}
            onPress={() => onTransportChange('udp')}
            activeOpacity={0.82}
            disabled={isConnected}
          >
            <Text
              style={[
                styles.transportButtonText,
                { color: transportMode === 'udp' ? '#FFFFFF' : palette.textPrimary },
              ]}
            >
              Auto (UDP)
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.transportButton,
              transportMode === 'websocket' && { backgroundColor: palette.accentBlue },
            ]}
            onPress={() => onTransportChange('websocket')}
            activeOpacity={0.82}
            disabled={isConnected}
          >
            <Text
              style={[
                styles.transportButtonText,
                { color: transportMode === 'websocket' ? '#FFFFFF' : palette.textPrimary },
              ]}
            >
              Manual (WS)
            </Text>
          </TouchableOpacity>
        </View>

        {isUDPDiscovered && discoveredServer && (
          <View style={[styles.discoveryBadge, { backgroundColor: palette.accentGreen }]}>
            <Ionicons name="flash" size={16} color="#FFFFFF" />
            <Text style={styles.discoveryBadgeText}>
              Auto-discovered: {discoveredServer.ip}:{discoveredServer.port}
            </Text>
          </View>
        )}

        {!isUDPDiscovered && !isConnected && onScanQRCode && (
          <TouchableOpacity
            style={[styles.qrButton, { backgroundColor: palette.cardBackgroundSecondary }]}
            onPress={onScanQRCode}
            activeOpacity={0.8}
          >
            <Ionicons name="qr-code-outline" size={24} color={palette.accentBlue} />
            <Text style={[styles.qrButtonText, { color: palette.textPrimary }]}>Scan Court QR Code</Text>
            <Ionicons name="chevron-forward" size={20} color={palette.textSecondary} />
          </TouchableOpacity>
        )}

        {transportMode === 'websocket' && (
          <View style={styles.inputRow}>
            <View style={[styles.inputContainer, { flex: 1 }]}>
              <Text style={[styles.inputLabel, { color: palette.textSecondary }]}>IP Address</Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: palette.cardBackgroundSecondary,
                    color: palette.textPrimary,
                    borderColor: palette.border,
                  },
                ]}
                placeholder="192.168.1.100"
                placeholderTextColor={palette.textSecondary}
                value={ipAddress}
                onChangeText={onIpAddressChange}
                keyboardType="numbers-and-punctuation"
                autoCapitalize="none"
                autoCorrect={false}
                editable={!isConnected}
                selectionColor={palette.accentBlue}
              />
            </View>

            <View style={styles.inputContainer}>
              <Text style={[styles.inputLabel, { color: palette.textSecondary }]}>Port</Text>
              <TextInput
                style={[
                  styles.input,
                  styles.portInput,
                  {
                    backgroundColor: palette.cardBackgroundSecondary,
                    color: palette.textPrimary,
                    borderColor: palette.border,
                  },
                ]}
                placeholder="9080"
                placeholderTextColor={palette.textSecondary}
                value={port}
                onChangeText={onPortChange}
                keyboardType="number-pad"
                editable={!isConnected}
                selectionColor={palette.accentBlue}
              />
            </View>
          </View>
        )}

        <TouchableOpacity
          style={[
            styles.actionButton,
            { backgroundColor: isConnected ? palette.accentRed : palette.accentBlue },
          ]}
          onPress={onToggleConnection}
          activeOpacity={0.84}
        >
          <Text style={styles.actionButtonText}>{isConnected ? 'End Session' : 'Start Session'}</Text>
        </TouchableOpacity>
      </View>

      {isConnected && (
        <Animated.View entering={FadeIn.duration(250)} style={[styles.card, { backgroundColor: palette.cardBackground, borderColor: palette.border }]}>
          <Text style={[styles.cardTitle, { color: palette.textPrimary }]}>Live Stats</Text>
          <View style={styles.statsRow}>
            <StatPuck label="Packets" value={packetsSent.toString()} color={palette.accentBlue} />
            {latency !== undefined && (
              <StatPuck label="Latency" value={`${latency}ms`} color={palette.accentGreen} />
            )}
            <StatPuck label="Mode" value={transportMode === 'udp' ? 'UDP' : 'WS'} color={palette.accentOrange} />
          </View>
        </Animated.View>
      )}

      {isConnected && (
        <Animated.View entering={FadeIn.duration(250)} style={[styles.card, { backgroundColor: palette.cardBackground, borderColor: palette.border }]}>
          <Text style={[styles.cardTitle, { color: palette.textPrimary }]}>Calibration Drill</Text>
          <Text style={[styles.calibrationHint, { color: palette.textSecondary }]}>
            Hold your arm extended right, phone side up, and point the back of the phone toward the Godot camera.
          </Text>

          <Pressable
            style={({ pressed }) => [
              styles.calibrationButton,
              {
                backgroundColor: palette.cardBackgroundSecondary,
                borderColor: palette.border,
                opacity: canRequestCalibration ? 1 : 0.6,
              },
              pressed && canRequestCalibration && styles.calibrationButtonPressed,
            ]}
            onPressIn={onCalibrationPressIn}
            onPressOut={onCalibrationPressOut}
            onTouchCancel={onCalibrationPressOut}
            disabled={!canRequestCalibration}
          >
            <View style={styles.calibrationProgressTrack}>
              <Animated.View
                style={[
                  styles.calibrationProgressFill,
                  { backgroundColor: palette.accentBlue },
                  calibrationFillStyle,
                ]}
              />
            </View>
            <Text style={[styles.calibrationButtonText, { color: palette.textPrimary }]}>{calibrationButtonText}</Text>
            <Text style={[styles.calibrationProgressText, { color: palette.textSecondary }]}>
              {calibrationProgressPercent}%
            </Text>
          </Pressable>

          <Text style={[styles.calibrationStatus, { color: palette.textSecondary }]}>{calibrationStatusText}</Text>
        </Animated.View>
      )}
    </>
  );
});

const SensorTelemetrySection = memo(function SensorTelemetrySection({
  palette,
  rotation,
  gyro,
  accel,
}: TelemetrySectionProps) {
  const orientationLoad = useMemo(() => {
    const sum = Math.abs(rotation.alpha) + Math.abs(rotation.beta) + Math.abs(rotation.gamma);
    return Math.min(1, sum / (Math.PI * 2));
  }, [rotation.alpha, rotation.beta, rotation.gamma]);

  const gyroLoad = useMemo(() => {
    const sum = Math.abs(gyro.alpha) + Math.abs(gyro.beta) + Math.abs(gyro.gamma);
    return Math.min(1, sum / 1200);
  }, [gyro.alpha, gyro.beta, gyro.gamma]);

  const accelLoad = useMemo(() => {
    const sum = Math.abs(accel.x) + Math.abs(accel.y) + Math.abs(accel.z);
    return Math.min(1, sum / 20);
  }, [accel.x, accel.y, accel.z]);

  return (
    <View style={[styles.card, { backgroundColor: palette.cardBackground, borderColor: palette.border }]}>
      <Text style={[styles.cardTitle, { color: palette.textPrimary }]}>Motion Vitals</Text>

      <TelemetryCard
        title="Orientation"
        color={palette.accentBlue}
        load={orientationLoad}
        palette={palette}
        metrics={[
          { label: 'α', value: rotation.alpha.toFixed(3), unit: 'rad' },
          { label: 'β', value: rotation.beta.toFixed(3), unit: 'rad' },
          { label: 'γ', value: rotation.gamma.toFixed(3), unit: 'rad' },
        ]}
      />

      <TelemetryCard
        title="Gyroscope"
        color={palette.accentOrange}
        load={gyroLoad}
        palette={palette}
        metrics={[
          { label: 'X', value: gyro.alpha.toFixed(1), unit: '°/s' },
          { label: 'Y', value: gyro.beta.toFixed(1), unit: '°/s' },
          { label: 'Z', value: gyro.gamma.toFixed(1), unit: '°/s' },
        ]}
      />

      <TelemetryCard
        title="Acceleration"
        color={palette.accentGreen}
        load={accelLoad}
        palette={palette}
        metrics={[
          { label: 'X', value: accel.x.toFixed(2), unit: 'm/s²' },
          { label: 'Y', value: accel.y.toFixed(2), unit: 'm/s²' },
          { label: 'Z', value: accel.z.toFixed(2), unit: 'm/s²' },
        ]}
      />
    </View>
  );
});

interface TelemetryCardProps {
  title: string;
  color: string;
  load: number;
  palette: Palette;
  metrics: { label: string; value: string; unit: string }[];
}

const TelemetryCard = memo(function TelemetryCard({
  title,
  color,
  load,
  palette,
  metrics,
}: TelemetryCardProps) {
  return (
    <View style={[styles.telemetryCard, { backgroundColor: palette.cardBackgroundSecondary }]}>
      <View style={styles.telemetryHeaderRow}>
        <Text style={[styles.telemetryTitle, { color: palette.textPrimary }]}>{title}</Text>
        <Text style={[styles.telemetryLoad, { color }]}>Load {Math.round(load * 100)}%</Text>
      </View>
      <View style={styles.loadTrack}>
        <View style={[styles.loadFill, { width: `${load * 100}%`, backgroundColor: color }]} />
      </View>
      <View style={styles.metricRow}>
        {metrics.map((metric) => (
          <SensorMetric
            key={`${title}-${metric.label}`}
            label={metric.label}
            value={metric.value}
            unit={metric.unit}
            color={color}
            textColor={palette.textPrimary}
            secondaryTextColor={palette.textSecondary}
          />
        ))}
      </View>
    </View>
  );
});

interface SensorMetricProps {
  label: string;
  value: string;
  unit: string;
  color: string;
  textColor: string;
  secondaryTextColor: string;
}

const SensorMetric = memo(function SensorMetric({
  label,
  value,
  unit,
  color,
  textColor,
  secondaryTextColor,
}: SensorMetricProps) {
  return (
    <View style={styles.metricCard}>
      <View style={[styles.metricBadge, { backgroundColor: color }]}>
        <Text style={styles.metricBadgeText}>{label}</Text>
      </View>
      <Text style={[styles.metricValue, { color: textColor }]}>{value}</Text>
      <Text style={[styles.metricUnit, { color: secondaryTextColor }]}>{unit}</Text>
    </View>
  );
});

interface StatPuckProps {
  label: string;
  value: string;
  color: string;
}

const StatPuck = memo(function StatPuck({ label, value, color }: StatPuckProps) {
  return (
    <View style={[styles.statPuck, { borderColor: color }]}>
      <Text style={[styles.statPuckValue, { color }]}>{value}</Text>
      <Text style={styles.statPuckLabel}>{label}</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    gap: 14,
    position: 'relative',
    overflow: 'hidden',
  },
  glowOrb: {
    position: 'absolute',
    width: 240,
    height: 240,
    borderRadius: 999,
  },
  glowOrbTop: {
    top: -120,
    right: -80,
  },
  glowOrbBottom: {
    bottom: -120,
    left: -80,
  },
  heroCard: {
    borderRadius: 18,
    borderWidth: 1,
    paddingVertical: 18,
    paddingHorizontal: 16,
    gap: 8,
  },
  heroLabel: {
    fontSize: 12,
    letterSpacing: 1,
    fontWeight: '700',
  },
  heroTitle: {
    fontSize: 30,
    lineHeight: 34,
    fontWeight: '800',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    shadowOpacity: 0.55,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  statusText: {
    fontSize: 14,
    fontWeight: '700',
  },
  card: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
    gap: 14,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  transportSelector: {
    flexDirection: 'row',
    borderRadius: 12,
    padding: 4,
    gap: 4,
  },
  transportButton: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  transportButtonText: {
    fontSize: 14,
    fontWeight: '700',
  },
  discoveryBadge: {
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  discoveryBadgeText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    flex: 1,
  },
  qrButton: {
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  qrButtonText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
  },
  inputRow: {
    flexDirection: 'row',
    gap: 12,
  },
  inputContainer: {
    gap: 6,
  },
  inputLabel: {
    fontSize: 12,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    fontWeight: '600',
  },
  input: {
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 17,
  },
  portInput: {
    width: 92,
  },
  actionButton: {
    borderRadius: 12,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
  },
  statPuck: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    gap: 2,
  },
  statPuckValue: {
    fontSize: 23,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  statPuckLabel: {
    color: '#8E8E93',
    fontSize: 12,
    fontWeight: '600',
  },
  calibrationHint: {
    fontSize: 13,
    lineHeight: 19,
  },
  calibrationButton: {
    borderRadius: 12,
    borderWidth: 1,
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
  },
  calibrationButtonText: {
    fontSize: 16,
    fontWeight: '700',
  },
  calibrationProgressText: {
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  calibrationStatus: {
    fontSize: 12,
    lineHeight: 18,
  },
  telemetryCard: {
    borderRadius: 14,
    padding: 12,
    gap: 10,
  },
  telemetryHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  telemetryTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  telemetryLoad: {
    fontSize: 12,
    fontWeight: '700',
  },
  loadTrack: {
    height: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(142, 142, 147, 0.25)',
    overflow: 'hidden',
  },
  loadFill: {
    height: '100%',
    borderRadius: 999,
  },
  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  metricCard: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.08)',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  metricBadge: {
    minWidth: 24,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    alignItems: 'center',
  },
  metricBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },
  metricValue: {
    fontSize: 17,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  metricUnit: {
    fontSize: 11,
    fontWeight: '600',
  },
});
