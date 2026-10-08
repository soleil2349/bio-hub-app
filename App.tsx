/**
 * BIO HUB App — main entry component.
 *
 * Flow:
 *   Not authenticated → AuthScreen (login / register)
 *   Not connected     → Bottom tabs: 扫描 | 云服务 | 历史 | 设置
 *   Connected         → DeviceScreen (with its own internal tabs)
 *
 * Initializes SQLite database, API client and auth store on startup.
 *
 * `SafeAreaProvider` wraps everything: the tab bar and every screen header read
 * their insets from it, which is what stops the system gesture bar from drawing
 * over the bottom labels on Android edge-to-edge devices.
 */
import React, { useState, useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
import { APP_VERSION } from './src/version';
import { color, space, type } from './src/theme';

type MainTab = 'scan' | 'cloud' | 'history' | 'settings';

/** 访客（离线）模式标记：未登录也可使用蓝牙采集与本地分析 */
const GUEST_KEY = '@biohub_guest_mode';

export default function App() {
  const [connectedDevice, setConnectedDevice] = useState<Device | null>(null);
  const [activeTab, setActiveTab] = useState<MainTab>('scan');
  const [dbReady, setDbReady] = useState(false);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);
  /** 用户选择了「跳过登录，离线使用」（持久化，下次启动不再拦在登录页） */
  const [guestMode, setGuestMode] = useState(false);
  /** 访客模式下主动点「登录」时临时展示登录页 */
  const [showAuth, setShowAuth] = useState(false);

  useEffect(() => {
    Promise.all([
      initDatabase(),
      loadSettings(),
      bioHubAPI.init(),
      AsyncStorage.getItem(GUEST_KEY).catch(() => null),
    ]).then(([_, s, __, guest]) => {
      setSettings(s);
      setSession(authStore.getSession());
      setGuestMode(guest === '1');
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

  const handleAuthed = () => {
    setShowAuth(false);
    setGuestMode(false);
    AsyncStorage.removeItem(GUEST_KEY).catch(() => {});
    setSession(authStore.getSession());
  };

  const enterGuestMode = () => {
    setShowAuth(false);
    setGuestMode(true);
    AsyncStorage.setItem(GUEST_KEY, '1').catch(() => {});
  };

  let content: React.ReactNode;

  if (!dbReady) {
    content = (
      <View style={styles.splash}>
        <Text style={styles.splashTitle}>BIO HUB</Text>
        <Text style={styles.splashVersion}>v{APP_VERSION}</Text>
        <ActivityIndicator color={color.accent} size="large" style={styles.splashSpinner} />
        <Text style={styles.splashText}>正在初始化本地数据库…</Text>
      </View>
    );
  } else if (!session && (!guestMode || showAuth)) {
    // 未登录且未选择离线模式（或访客主动去登录）→ 登录页；登录页提供「跳过登录」入口
    content = <AuthScreen onAuthed={handleAuthed} onSkip={enterGuestMode} />;
  } else if (connectedDevice) {
    content = (
      <DeviceScreen
        device={connectedDevice}
        onDisconnect={() => {
          setConnectedDevice(null);
          setActiveTab('scan');
        }}
        autoRecord={settings?.autoRecord ?? true}
      />
    );
  } else {
    content = (
      <View style={styles.container}>
        <View style={styles.content}>
          {activeTab === 'scan' && (
            <ScanScreen
              onConnected={(dev) => setConnectedDevice(dev)}
              scanDuration={settings?.scanDuration ?? 10}
            />
          )}
          {activeTab === 'cloud' && <CloudScreen onRequireLogin={() => setShowAuth(true)} />}
          {activeTab === 'history' && <HistoryScreen />}
          {activeTab === 'settings' && <SettingsScreen onRequireLogin={() => setShowAuth(true)} />}
        </View>
        <TabBar
          tabs={[
            { id: 'scan', label: '扫描', icon: 'bluetooth' },
            { id: 'cloud', label: '云服务', icon: 'cloud' },
            { id: 'history', label: '历史', icon: 'clock' },
            { id: 'settings', label: '设置', icon: 'sliders' },
          ]}
          activeTab={activeTab}
          onSelect={(id) => setActiveTab(id as MainTab)}
        />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      {/* Headers now extend under the status bar, so the bar's own icons must
          be light — otherwise Android draws dark icons on the dark header. */}
      <StatusBar style="light" />
      {content}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: color.bg,
  },
  content: {
    flex: 1,
  },
  splash: {
    flex: 1,
    backgroundColor: color.bg,
    justifyContent: 'center',
    alignItems: 'center',
    padding: space.xxl,
  },
  splashTitle: {
    fontSize: 32,
    lineHeight: 40,
    fontWeight: '700',
    color: color.text,
    letterSpacing: 4,
  },
  splashVersion: {
    ...type.body,
    color: color.textMuted,
    marginTop: space.xs,
  },
  splashSpinner: { marginTop: space.xxl },
  splashText: {
    ...type.body,
    color: color.textMuted,
    marginTop: space.md,
  },
});
