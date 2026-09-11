/**
 * Settings screen — app configuration, account management,
 * data management and about info.
 */
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  Switch,
  Alert,
  Modal,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearAllData } from '../storage';
import { bioHubAPI } from '../api';
import { authStore, AuthUser } from '../auth';

const SETTINGS_KEY = '@biohub_settings';

export interface AppSettings {
  autoRecord: boolean;
  showDebugOnConnect: boolean;
  preferSLE: boolean;
  scanDuration: number;
}

const DEFAULT_SETTINGS: AppSettings = {
  autoRecord: true,
  showDebugOnConnect: false,
  preferSLE: false,
  scanDuration: 10,
};

async function loadSettings(): Promise<AppSettings> {
  try {
    const json = await AsyncStorage.getItem(SETTINGS_KEY);
    if (json) return { ...DEFAULT_SETTINGS, ...JSON.parse(json) };
  } catch {}
  return DEFAULT_SETTINGS;
}

async function saveSettings(settings: AppSettings): Promise<void> {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export { loadSettings };

interface Props {
  /** 访客（未登录）模式下点击「登录 / 注册」时回调，由 App 切换登录页 */
  onRequireLogin?: () => void;
}

export default function SettingsScreen({ onRequireLogin }: Props) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [user, setUser] = useState<AuthUser | null>(authStore.getUser());
  const [showChangePwd, setShowChangePwd] = useState(false);
  const [curPwd, setCurPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [newPwd2, setNewPwd2] = useState('');
  const [pwdError, setPwdError] = useState<string | null>(null);
  const [pwdSubmitting, setPwdSubmitting] = useState(false);

  useEffect(() => {
    loadSettings().then(setSettings);
    const unsub = authStore.subscribe((s) => setUser(s?.user ?? null));
    return unsub;
  }, []);

  const handleLogout = () => {
    Alert.alert('退出登录', '确定要退出当前账户吗？', [
      { text: '取消', style: 'cancel' },
      {
        text: '退出',
        style: 'destructive',
        onPress: async () => {
          await bioHubAPI.logout();
        },
      },
    ]);
  };

  const submitChangePwd = async () => {
    setPwdError(null);
    if (!curPwd) return setPwdError('请输入当前密码');
    if (newPwd.length < 6) return setPwdError('新密码至少 6 位');
    if (newPwd !== newPwd2) return setPwdError('两次输入的新密码不一致');
    setPwdSubmitting(true);
    const result = await bioHubAPI.changePassword(curPwd, newPwd);
    setPwdSubmitting(false);
    if (result.ok) {
      setShowChangePwd(false);
      setCurPwd('');
      setNewPwd('');
      setNewPwd2('');
      Alert.alert('已更新', '密码修改成功');
    } else {
      setPwdError(result.error || '修改失败');
    }
  };

  const updateSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    saveSettings(next);
  };

  const handleClearData = () => {
    Alert.alert('清除所有数据', '确定要删除所有历史记录和传感器数据吗？\n此操作不可撤销。', [
      { text: '取消', style: 'cancel' },
      {
        text: '确认删除',
        style: 'destructive',
        onPress: async () => {
          await clearAllData();
          Alert.alert('已清除', '所有数据已被删除');
        },
      },
    ]);
  };

  const handleResetSettings = () => {
    Alert.alert('重置设置', '恢复所有设置为默认值？', [
      { text: '取消', style: 'cancel' },
      {
        text: '重置',
        onPress: () => {
          setSettings(DEFAULT_SETTINGS);
          saveSettings(DEFAULT_SETTINGS);
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>设置</Text>
        <Text style={styles.subtitle}>应用配置与数据管理</Text>
      </View>

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
        {/* Account */}
        <Text style={styles.sectionTitle}>账户</Text>
        <View style={styles.card}>
          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingLabel}>
                {user?.displayName || user?.email || '未登录（离线模式）'}
              </Text>
              {user?.displayName && (
                <Text style={styles.settingDesc}>{user.email}</Text>
              )}
              {user?.isAdmin && (
                <Text style={[styles.settingDesc, { color: '#A78BFA' }]}>管理员</Text>
              )}
            </View>
          </View>
          {user ? (
            <>
              <View style={styles.divider} />
              <TouchableOpacity
                style={styles.settingRow}
                onPress={() => setShowChangePwd(true)}
              >
                <View style={styles.settingInfo}>
                  <Text style={styles.settingLabel}>修改密码</Text>
                  <Text style={styles.settingDesc}>更改登录密码</Text>
                </View>
                <Text style={{ color: '#6B7280', fontSize: 16 }}>{'\u203A'}</Text>
              </TouchableOpacity>
              <View style={styles.divider} />
              <TouchableOpacity style={styles.dangerRow} onPress={handleLogout}>
                <Text style={styles.dangerLabel}>退出登录</Text>
                <Text style={styles.dangerDesc}>退出后需要重新登录才能查看数据</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <View style={styles.divider} />
              <TouchableOpacity style={styles.settingRow} onPress={onRequireLogin}>
                <View style={styles.settingInfo}>
                  <Text style={styles.settingLabel}>登录 / 注册</Text>
                  <Text style={styles.settingDesc}>
                    登录后可上传数据到云端并查看分析报告
                  </Text>
                </View>
                <Text style={{ color: '#6B7280', fontSize: 16 }}>{'\u203A'}</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        {/* Recording Settings */}
        <Text style={styles.sectionTitle}>数据记录</Text>
        <View style={styles.card}>
          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingLabel}>自动记录</Text>
              <Text style={styles.settingDesc}>
                连接设备后自动开始记录传感器数据
              </Text>
            </View>
            <Switch
              value={settings.autoRecord}
              onValueChange={(v) => updateSetting('autoRecord', v)}
              trackColor={{ false: '#374151', true: '#1D4ED8' }}
              thumbColor={settings.autoRecord ? '#60A5FA' : '#9CA3AF'}
            />
          </View>

          <View style={styles.divider} />

          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingLabel}>连接时显示调试面板</Text>
              <Text style={styles.settingDesc}>
                连接设备后默认显示BLE调试日志
              </Text>
            </View>
            <Switch
              value={settings.showDebugOnConnect}
              onValueChange={(v) => updateSetting('showDebugOnConnect', v)}
              trackColor={{ false: '#374151', true: '#1D4ED8' }}
              thumbColor={settings.showDebugOnConnect ? '#60A5FA' : '#9CA3AF'}
            />
          </View>
        </View>

        {/* Connection Settings */}
        <Text style={styles.sectionTitle}>连接设置</Text>
        <View style={styles.card}>
          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingLabel}>优先星闪 (SLE)</Text>
              <Text style={styles.settingDesc}>
                扫描时优先匹配星闪(SparkLink)设备
              </Text>
            </View>
            <Switch
              value={settings.preferSLE}
              onValueChange={(v) => updateSetting('preferSLE', v)}
              trackColor={{ false: '#374151', true: '#7C3AED' }}
              thumbColor={settings.preferSLE ? '#A78BFA' : '#9CA3AF'}
            />
          </View>

          <View style={styles.divider} />

          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingLabel}>扫描时长</Text>
              <Text style={styles.settingDesc}>
                自动扫描持续时间
              </Text>
            </View>
            <View style={styles.durationPicker}>
              {[5, 10, 15, 30].map((sec) => (
                <TouchableOpacity
                  key={sec}
                  style={[
                    styles.durationBtn,
                    settings.scanDuration === sec && styles.durationBtnActive,
                  ]}
                  onPress={() => updateSetting('scanDuration', sec)}
                >
                  <Text
                    style={[
                      styles.durationBtnText,
                      settings.scanDuration === sec && styles.durationBtnTextActive,
                    ]}
                  >
                    {sec}s
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>

        {/* Server info (read-only summary) */}
        <Text style={styles.sectionTitle}>云服务</Text>
        <View style={styles.card}>
          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingLabel}>服务器地址</Text>
              <Text style={styles.settingDesc}>
                {bioHubAPI.isConfigured()
                  ? bioHubAPI.getConfig().baseUrl
                  : '未配置'}
              </Text>
              <Text style={[styles.settingDesc, { marginTop: 2 }]}>
                在「云服务」页面可以修改
              </Text>
            </View>
          </View>
        </View>

        {/* Data Management */}
        <Text style={styles.sectionTitle}>数据管理</Text>
        <View style={styles.card}>
          <TouchableOpacity style={styles.dangerRow} onPress={handleClearData}>
            <Text style={styles.dangerLabel}>清除所有数据</Text>
            <Text style={styles.dangerDesc}>删除所有历史记录和传感器数据</Text>
          </TouchableOpacity>
          <View style={styles.divider} />
          <TouchableOpacity style={styles.settingRow} onPress={handleResetSettings}>
            <Text style={styles.resetLabel}>重置设置</Text>
          </TouchableOpacity>
        </View>

        {/* About */}
        <Text style={styles.sectionTitle}>关于</Text>
        <View style={styles.card}>
          <View style={styles.aboutRow}>
            <Text style={styles.aboutLabel}>应用名称</Text>
            <Text style={styles.aboutValue}>BIO HUB</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.aboutRow}>
            <Text style={styles.aboutLabel}>版本</Text>
            <Text style={styles.aboutValue}>1.3.0</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.aboutRow}>
            <Text style={styles.aboutLabel}>平台</Text>
            <Text style={styles.aboutValue}>Expo SDK 57 / React Native</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.aboutRow}>
            <Text style={styles.aboutLabel}>通信协议</Text>
            <Text style={styles.aboutValue}>BLE + SLE (NearLink)</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.aboutRow}>
            <Text style={styles.aboutLabel}>硬件平台</Text>
            <Text style={styles.aboutValue}>Hi3863 / WS63 Sensor Hub</Text>
          </View>
        </View>

        <Text style={styles.footer}>
          BIO HUB Sensor App{'\n'}
          蓝牙/星闪 生物传感器数据采集与分析
        </Text>
      </ScrollView>

      {/* Change password modal */}
      <Modal visible={showChangePwd} animationType="slide" transparent>
        <View style={styles.pwdOverlay}>
          <View style={styles.pwdPanel}>
            <Text style={styles.pwdTitle}>修改密码</Text>

            <Text style={styles.pwdLabel}>当前密码</Text>
            <TextInput
              style={styles.pwdInput}
              value={curPwd}
              onChangeText={setCurPwd}
              placeholder="输入当前密码"
              placeholderTextColor="#4B5563"
              secureTextEntry
              autoCapitalize="none"
            />

            <Text style={styles.pwdLabel}>新密码</Text>
            <TextInput
              style={styles.pwdInput}
              value={newPwd}
              onChangeText={setNewPwd}
              placeholder="至少 6 位"
              placeholderTextColor="#4B5563"
              secureTextEntry
              autoCapitalize="none"
            />

            <Text style={styles.pwdLabel}>确认新密码</Text>
            <TextInput
              style={styles.pwdInput}
              value={newPwd2}
              onChangeText={setNewPwd2}
              placeholder="再次输入新密码"
              placeholderTextColor="#4B5563"
              secureTextEntry
              autoCapitalize="none"
            />

            {pwdError && <Text style={styles.pwdError}>{pwdError}</Text>}

            <View style={styles.pwdActions}>
              <TouchableOpacity
                style={[styles.pwdBtn, styles.pwdBtnSecondary]}
                onPress={() => {
                  setShowChangePwd(false);
                  setPwdError(null);
                }}
                disabled={pwdSubmitting}
              >
                <Text style={styles.pwdBtnSecondaryText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.pwdBtn, styles.pwdBtnPrimary]}
                onPress={submitChangePwd}
                disabled={pwdSubmitting}
              >
                {pwdSubmitting ? (
                  <ActivityIndicator color="#E0E7FF" />
                ) : (
                  <Text style={styles.pwdBtnPrimaryText}>保存</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0E1A' },
  header: {
    paddingTop: 48,
    paddingBottom: 16,
    paddingHorizontal: 20,
    backgroundColor: '#111827',
    borderBottomWidth: 1,
    borderBottomColor: '#1F2937',
  },
  title: { fontSize: 24, fontWeight: '800', color: '#E0E7FF' },
  subtitle: { fontSize: 13, color: '#6B7280', marginTop: 4 },
  body: { flex: 1 },
  bodyContent: { padding: 16, paddingBottom: 120 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 20,
    marginBottom: 8,
    marginLeft: 4,
  },
  card: {
    backgroundColor: '#1F2937',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#374151',
    overflow: 'hidden',
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
  },
  settingInfo: { flex: 1, marginRight: 12 },
  settingLabel: { fontSize: 15, fontWeight: '600', color: '#E5E7EB' },
  settingDesc: { fontSize: 12, color: '#6B7280', marginTop: 2, lineHeight: 18 },
  divider: { height: 1, backgroundColor: '#374151', marginHorizontal: 14 },
  durationPicker: { flexDirection: 'row', gap: 6 },
  durationBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#374151',
  },
  durationBtnActive: { backgroundColor: '#1D4ED8' },
  durationBtnText: { fontSize: 12, color: '#9CA3AF', fontWeight: '600' },
  durationBtnTextActive: { color: '#E0E7FF' },
  dangerRow: { padding: 14 },
  dangerLabel: { fontSize: 15, fontWeight: '600', color: '#FCA5A5' },
  dangerDesc: { fontSize: 12, color: '#F87171', marginTop: 2 },
  resetLabel: { fontSize: 15, fontWeight: '600', color: '#93C5FD' },
  aboutRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
  },
  aboutLabel: { fontSize: 14, color: '#9CA3AF' },
  aboutValue: { fontSize: 14, color: '#E5E7EB', fontWeight: '500' },
  footer: {
    textAlign: 'center',
    color: '#4B5563',
    fontSize: 12,
    marginTop: 32,
    lineHeight: 20,
  },
  pwdOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: 20,
  },
  pwdPanel: {
    backgroundColor: '#111827',
    borderRadius: 14,
    borderColor: '#1F2937',
    borderWidth: 1,
    padding: 20,
  },
  pwdTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#E0E7FF',
    marginBottom: 12,
  },
  pwdLabel: {
    color: '#9CA3AF',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 10,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  pwdInput: {
    backgroundColor: '#1F2937',
    borderRadius: 8,
    borderColor: '#374151',
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#E5E7EB',
    fontSize: 14,
  },
  pwdError: { color: '#F87171', marginTop: 12, fontSize: 13, textAlign: 'center' },
  pwdActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
    justifyContent: 'flex-end',
  },
  pwdBtn: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 8,
    minWidth: 90,
    alignItems: 'center',
  },
  pwdBtnSecondary: { backgroundColor: '#1F2937' },
  pwdBtnSecondaryText: { color: '#93C5FD', fontWeight: '600' },
  pwdBtnPrimary: { backgroundColor: '#1D4ED8' },
  pwdBtnPrimaryText: { color: '#E0E7FF', fontWeight: '700' },
});
