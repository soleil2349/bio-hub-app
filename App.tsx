/**
 * BIO HUB App — main entry component.
 *
 * Flow:
 *   Not authenticated → AuthScreen (login / register)
 *   Not connected     → Bottom tabs: 扫描 | 云服务 | 历史 | 设置
 *   Connected         → DeviceScreen (with its own internal tabs)
 *
 * Initializes SQLite database, API client and auth store on startup.
 */
import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ActivityIndicator, Text } from 'react-native';
import { Device } from 'react-native-ble-plx';
import ScanScreen from './src/screens/ScanScreen';
import DeviceScreen from './src/screens/DeviceScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import CloudScreen from './src/screens/CloudScreen';
import SettingsScreen, { loadSettings, AppSettings } from './src/screens/SettingsScreen';
import AuthScreen from './src/screens/AuthScreen';
import TabBar from './src/components/TabBar';
import { initDatabase } from './src/storage';
import { bioHubAPI } from './src/api';
import { authStore, AuthSession } from './src/auth';

type MainTab = 'scan' | 'cloud' | 'history' | 'settings';

export default function App() {
  const [connectedDevice, setConnectedDevice] = useState<Device | null>(null);
  const [activeTab, setActiveTab] = useState<MainTab>('scan');
  const [dbReady, setDbReady] = useState(false);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);

  useEffect(() => {
    Promise.all([
      initDatabase(),
      loadSettings(),
      bioHubAPI.init(),
    ]).then(([_, s]) => {
      setSettings(s);
      setSession(authStore.getSession());
      setDbReady(true);
    }).catch((err) => {
      console.error('Init error:', err);
      setDbReady(true);
    });

    const unsubscribe = authStore.subscribe((s) => {
      setSession(s);
      // If auth got cleared (logout / 401) drop the current device connection
      // so the app returns cleanly to the login screen.
      if (!s) {
        setConnectedDevice(null);
        setActiveTab('scan');
      }
    });
    return unsubscribe;
  }, []);

  if (!dbReady) {
    return (
      <View style={styles.splash}>
        <Text style={styles.splashTitle}>BIO HUB</Text>
        <Text style={styles.splashVersion}>v1.3.0</Text>
        <ActivityIndicator color="#4A90D9" size="large" style={{ marginTop: 24 }} />
        <Text style={styles.splashText}>初始化中...</Text>
      </View>
    );
  }

  if (!session) {
    return <AuthScreen onAuthed={() => setSession(authStore.getSession())} />;
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
        {activeTab === 'cloud' && <CloudScreen />}
        {activeTab === 'history' && <HistoryScreen />}
        {activeTab === 'settings' && <SettingsScreen />}
      </View>
      <TabBar
        tabs={[
          { id: 'scan', label: '扫描' },
          { id: 'cloud', label: '云服务' },
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
  splashVersion: {
    fontSize: 13,
    color: '#4B5563',
    marginTop: 4,
  },
  splashText: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 12,
  },
});
