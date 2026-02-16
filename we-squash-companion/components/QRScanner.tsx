import { useCallback, useEffect, useState } from 'react';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { StyleSheet, TouchableOpacity, View, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ThemedText } from './themed-text';

interface QRScannerProps {
  isVisible: boolean;
  onClose: () => void;
  onScan: (data: string) => void;
}

export function QRScanner({ isVisible, onClose, onScan }: QRScannerProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);

  useEffect(() => {
    if (isVisible && !permission?.granted) {
      void requestPermission();
    }
  }, [isVisible, permission?.granted, requestPermission]);

  useEffect(() => {
    if (!isVisible) {
      setScanned(false);
    }
  }, [isVisible]);

  const handleBarCodeScanned = useCallback(
    ({ data }: { data: string }) => {
      if (!scanned) {
        setScanned(true);
        onScan(data);
        onClose();
      }
    },
    [scanned, onScan, onClose]
  );

  if (!permission?.granted) {
    return (
      <Modal visible={isVisible} animationType="slide" transparent={false}>
        <View style={styles.container}>
          <View style={styles.permissionContainer}>
            <ThemedText style={styles.permissionText}>
              Camera permission is required to scan QR codes
            </ThemedText>
            <TouchableOpacity style={styles.button} onPress={requestPermission}>
              <ThemedText style={styles.buttonText}>Grant Permission</ThemedText>
            </TouchableOpacity>
            <TouchableOpacity style={styles.closeButton} onPress={onClose}>
              <ThemedText style={styles.closeButtonText}>Cancel</ThemedText>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <Modal visible={isVisible} animationType="slide" transparent={false}>
      <View style={styles.container}>
        <CameraView
          style={styles.camera}
          facing="back"
          barcodeScannerSettings={{
            barcodeTypes: ['qr'],
          }}
          onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
        >
          <View style={styles.overlay}>
            <View style={styles.header}>
              <TouchableOpacity style={styles.closeIcon} onPress={onClose}>
                <Ionicons name="close" size={28} color="#FFFFFF" />
              </TouchableOpacity>
              <ThemedText style={styles.title}>Scan QR Code</ThemedText>
              <View style={styles.placeholder} />
            </View>

            <View style={styles.scanArea}>
              <View style={styles.scanFrame}>
                <View style={[styles.corner, styles.cornerTL]} />
                <View style={[styles.corner, styles.cornerTR]} />
                <View style={[styles.corner, styles.cornerBL]} />
                <View style={[styles.corner, styles.cornerBR]} />
              </View>
              <ThemedText style={styles.instructions}>
                Point camera at the QR code displayed in the game
              </ThemedText>
            </View>

            <View style={styles.footer} />
          </View>
        </CameraView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  camera: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 60,
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  closeIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  placeholder: {
    width: 44,
  },
  scanArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scanFrame: {
    width: 250,
    height: 250,
    borderRadius: 12,
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderColor: '#007AFF',
    borderWidth: 4,
  },
  cornerTL: {
    top: 0,
    left: 0,
    borderRightWidth: 0,
    borderBottomWidth: 0,
    borderTopLeftRadius: 12,
  },
  cornerTR: {
    top: 0,
    right: 0,
    borderLeftWidth: 0,
    borderBottomWidth: 0,
    borderTopRightRadius: 12,
  },
  cornerBL: {
    bottom: 0,
    left: 0,
    borderRightWidth: 0,
    borderTopWidth: 0,
    borderBottomLeftRadius: 12,
  },
  cornerBR: {
    bottom: 0,
    right: 0,
    borderLeftWidth: 0,
    borderTopWidth: 0,
    borderBottomRightRadius: 12,
  },
  instructions: {
    marginTop: 40,
    fontSize: 16,
    color: '#FFFFFF',
    textAlign: 'center',
    paddingHorizontal: 40,
  },
  footer: {
    height: 100,
  },
  permissionContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  permissionText: {
    fontSize: 18,
    textAlign: 'center',
    marginBottom: 30,
    color: '#FFFFFF',
  },
  button: {
    backgroundColor: '#007AFF',
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 12,
    marginBottom: 16,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
  },
  closeButton: {
    paddingVertical: 12,
  },
  closeButtonText: {
    color: '#8E8E93',
    fontSize: 17,
  },
});
