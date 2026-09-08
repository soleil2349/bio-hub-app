/**
 * BIO HUB App — main entry component.
 *
 * Navigation structure:
 *   Not connected → Bottom tabs: 扫描 | 历史 | 设置
 *   Connected     → DeviceScreen (with its own internal tabs)
 *
 * Initializes SQLite database on startup.
 */
import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ActivityIndicator, Text } from 'react-native';
import { Device } from 'react-native-ble-plx';
import ScanScreen from './src/screens/ScanScreen';
import DeviceScreen from './src/screens/DeviceScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import SettingsScreen, { loadSettings, AppSettings } from './src/screens/SettingsScreen';
import TabBar from './src/components/TabBar';
import { initDatabase } from './src/storage';

type MainTab = 'scan' | 'history' | 'settings';

export default function App() {
  const [connectedDevice, setConnectedDevice] = useState<Device | null>(null);
  const [activeTab, setActiveTab] = useState<MainTab>('scan');
  const [dbReady, setDbReady] = useState(false);
  const [settings, setSettings] = useState<AppSettings | null>(null);

  useEffect(() => {
    Promise.all([
      initDatabase(),
      loadSettings(),
    ]).then(([_, s]) => {
      setSettings(s);
      setDbReady(true);
    }).catch((err) => {
      console.error('Init error:', err);
      setDbReady(true);
    });
  }, []);

  if (!dbReady) {
    return (
      <View style={styles.splash}>
        <Text style={styles.splashTitle}>BIO HUB</Text>
        <ActivityIndicator color="#4A90D9" size="large" style={{ marginTop: 24 }} />
        <Text style={styles.splashText}>初始化中...</Text>
      </View>
    );
  }

  if (connectedDevice) {
    return (
      <DeviceScreen
        device={connectedDevice}
        onDisconnect={() => {
          setConnectedDevice(null);
          setActiveTab('scan');
        }}
        autoRecord={settings?.autoRecord ?? true}
      />
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        {activeTab === 'scan' && (
          <ScanScreen
            onConnected={(dev) => setConnectedDevice(dev)}
            scanDuration={settings?.scanDuration ?? 10}
          />
        )}
        {activeTab === 'history' && <HistoryScreen />}
        {activeTab === 'settings' && <SettingsScreen />}
      </View>
      <TabBar
        tabs={[
          { id: 'scan', label: '扫描' },
          { id: 'history', label: '历史' },
          { id: 'settings', label: '设置' },
        ]}
        activeTab={activeTab}
        onSelect={(id) => setActiveTab(id as MainTab)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0E1A',
  },
  content: {
    flex: 1,
  },
  splash: {
    flex: 1,
    backgroundColor: '#0A0E1A',
    justifyContent: 'center',
    alignItems: 'center',
  },
  splashTitle: {
    fontSize: 36,
    fontWeight: '800',
    color: '#E0E7FF',
    letterSpacing: 4,
  },
  splashText: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 12,
  },
});
