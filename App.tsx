import React, { useState } from 'react';
import { Device } from 'react-native-ble-plx';
import ScanScreen from './src/screens/ScanScreen';
import DeviceScreen from './src/screens/DeviceScreen';

export default function App() {
  const [connectedDevice, setConnectedDevice] = useState<Device | null>(null);

  if (connectedDevice) {
    return (
      <DeviceScreen
        device={connectedDevice}
        onDisconnect={() => setConnectedDevice(null)}
      />
    );
  }

  return <ScanScreen onConnected={(dev) => setConnectedDevice(dev)} />;
}
