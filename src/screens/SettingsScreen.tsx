/**
 * Settings screen — app configuration, account management,
 * data management and about info.
 *
 * Layout notes
 * ------------
 *  - Every settings row places a flexible label block beside a fixed control.
 *    The label blocks declare `flex: 1, minWidth: 0` so a long value (an email,
 *    a server URL, "Hi3863 / WS63 Sensor Hub") wraps instead of shoving the
 *    switch or value off the card.
 *  - The scan-duration picker became a segmented control: four fixed-width
 *    buttons competing with the label text for horizontal space was the one row
 *    that could still overflow on a narrow device.
 *  - The change-password sheet is wrapped in a KeyboardAvoidingView and respects
 *    the bottom inset, so the save button stays reachable with the keyboard up.
 *  - The version now comes from `app.json` via `src/version.ts` instead of the
 *    stale hard-coded "1.3.0".
 */
import React, { useState, useEffect } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearAllData } from '../storage';
import { bioHubAPI } from '../api';
import { authStore, AuthUser } from '../auth';
import { APP_BUILD, APP_VERSION } from '../version';
import Icon from '../components/Icon';
import {
  Button,
  Card,
  Divider,
  Pill,
  Screen,
  ScreenHeader,
  SectionTitle,
  SegmentedControl,
} from '../components/ui';
import { radius, space, tabularNums, type, type Palette } from '../theme';
import { useTheme, useThemedStyles, type ThemeMode } from '../theme-context';

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

const DURATION_OPTIONS = [5, 10, 15, 30].map((sec) => ({
  value: String(sec),
  label: `${sec}s`,
}));

interface Props {
  /** 访客（未登录）模式下点击「登录 / 注册」时回调，由 App 切换登录页 */
  onRequireLogin?: () => void;
}

/** One settings row: label block on the left, control on the right. */
const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'system', label: '跟随系统' },
];

function SettingRow({
  label,
  description,
  control,
  onPress,
}: {
  label: string;
  description?: string;
  control?: React.ReactNode;
  onPress?: () => void;
}) {
  const { color } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const body = (
    <View style={styles.settingRow}>
      <View style={styles.settingInfo}>
        <Text style={[type.h2, styles.settingLabel]}>{label}</Text>
        {description ? (
          <Text style={[type.label, styles.settingDesc]}>{description}</Text>
        ) : null}
      </View>
      {control ?? (onPress ? <Icon name="chevronRight" size={18} color={color.textMuted} /> : null)}
    </View>
  );

  if (!onPress) return body;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [pressed && styles.rowPressed]}
    >
      {body}
    </Pressable>
  );
}

export default function SettingsScreen({ onRequireLogin }: Props) {
  const { color, mode, setMode } = useTheme();
  const styles = useThemedStyles(makeStyles);
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
    try {
      const result = await bioHubAPI.changePassword(curPwd, newPwd);
      if (result.ok) {
        setShowChangePwd(false);
        setCurPwd('');
        setNewPwd('');
        setNewPwd2('');
        Alert.alert('已更新', '密码修改成功');
      } else {
        setPwdError(result.error || '修改失败');
      }
    } finally {
      setPwdSubmitting(false);
    }
  };

  const closePwdModal = () => {
    setShowChangePwd(false);
    setPwdError(null);
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

  const serverUrl = bioHubAPI.isConfigured() ? bioHubAPI.getConfig().baseUrl : '未配置';

  return (
    <Screen>
      <ScreenHeader title="设置" subtitle="应用配置与数据管理" />

      <ScrollView contentContainerStyle={styles.body}>
        <SectionTitle first>外观</SectionTitle>
        <Card>
          <Text style={[type.h2, styles.settingLabel]}>显示主题</Text>
          <Text style={[type.label, styles.settingDesc]}>浅色便于阅读，深色适合暗处看波形</Text>
          <View style={styles.durationPicker}>
            <SegmentedControl options={THEME_OPTIONS} value={mode} onChange={setMode} />
          </View>
        </Card>

        {/* Account */}
        <SectionTitle>账户</SectionTitle>
        <Card padded={false}>
          {user ? (
            <>
              <View style={styles.accountRow}>
                <View style={styles.avatar}>
                  <Icon name="user" size={20} color={color.accentText} />
                </View>
                <View style={styles.settingInfo}>
                  <Text style={[type.h2, styles.settingLabel]} numberOfLines={1}>
                    {user.displayName || user.email}
                  </Text>
                  {user.displayName ? (
                    <Text style={[type.label, styles.settingDesc]} numberOfLines={1}>
                      {user.email}
                    </Text>
                  ) : null}
                  {user.isAdmin ? (
                    <View style={styles.adminTag}>
                      <Pill label="管理员" tone="violet" />
                    </View>
                  ) : null}
                </View>
              </View>
              <Divider />
              <SettingRow label="修改密码" description="更改登录密码" onPress={() => setShowChangePwd(true)} />
              <Divider />
              <Pressable
                onPress={handleLogout}
                style={({ pressed }) => [styles.settingRow, pressed && styles.rowPressed]}
                accessibilityRole="button"
              >
                <View style={styles.settingInfo}>
                  <Text style={[type.h2, styles.dangerLabel]}>退出登录</Text>
                  <Text style={[type.label, styles.dangerDesc]}>
                    退出后需要重新登录才能查看云端数据
                  </Text>
                </View>
                <Icon name="logout" size={18} color={color.dangerText} />
              </Pressable>
            </>
          ) : (
            <SettingRow
              label="登录 / 注册"
              description="登录后可上传数据到云端并查看分析报告"
              onPress={onRequireLogin}
            />
          )}
        </Card>

        {/* Recording */}
        <SectionTitle>数据记录</SectionTitle>
        <Card padded={false}>
          <SettingRow
            label="自动记录"
            description="连接设备后自动开始记录传感器数据"
            control={
              <Switch
                value={settings.autoRecord}
                onValueChange={(v) => updateSetting('autoRecord', v)}
                trackColor={{ false: color.borderStrong, true: color.accent }}
                thumbColor={settings.autoRecord ? color.onAccent : color.textMuted}
                accessibilityLabel="自动记录"
              />
            }
          />
          <Divider />
          <SettingRow
            label="连接时显示调试面板"
            description="连接设备后默认显示 BLE 调试日志"
            control={
              <Switch
                value={settings.showDebugOnConnect}
                onValueChange={(v) => updateSetting('showDebugOnConnect', v)}
                trackColor={{ false: color.borderStrong, true: color.accent }}
                thumbColor={settings.showDebugOnConnect ? color.onAccent : color.textMuted}
                accessibilityLabel="连接时显示调试面板"
              />
            }
          />
        </Card>

        {/* Connection */}
        <SectionTitle>连接设置</SectionTitle>
        <Card padded={false}>
          <SettingRow
            label="优先星闪 (SLE)"
            description="扫描时优先匹配星闪 SparkLink 设备"
            control={
              <Switch
                value={settings.preferSLE}
                onValueChange={(v) => updateSetting('preferSLE', v)}
                trackColor={{ false: color.borderStrong, true: color.violetBorder }}
                thumbColor={settings.preferSLE ? color.onAccent : color.textMuted}
                accessibilityLabel="优先星闪"
              />
            }
          />
          <Divider />
          <View style={styles.blockRow}>
            <Text style={[type.h2, styles.settingLabel]}>扫描时长</Text>
            <Text style={[type.label, styles.settingDesc]}>单次自动扫描的持续时间</Text>
            <View style={styles.durationPicker}>
              <SegmentedControl
                options={DURATION_OPTIONS}
                value={String(settings.scanDuration)}
                onChange={(v) => updateSetting('scanDuration', Number(v))}
              />
            </View>
          </View>
        </Card>

        {/* Server */}
        <SectionTitle>云服务</SectionTitle>
        <Card padded={false}>
          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Text style={[type.h2, styles.settingLabel]}>服务器地址</Text>
              <Text style={[type.label, styles.settingDesc]}>{serverUrl}</Text>
              <Text style={[type.caption, styles.settingHint]}>可在「云服务」页面修改</Text>
            </View>
          </View>
        </Card>

        {/* Data management */}
        <SectionTitle>数据管理</SectionTitle>
        <Card padded={false}>
          <Pressable
            onPress={handleClearData}
            style={({ pressed }) => [styles.settingRow, pressed && styles.rowPressed]}
            accessibilityRole="button"
          >
            <View style={styles.settingInfo}>
              <Text style={[type.h2, styles.dangerLabel]}>清除所有数据</Text>
              <Text style={[type.label, styles.dangerDesc]}>
                删除所有历史记录和传感器数据
              </Text>
            </View>
            <Icon name="trash" size={18} color={color.dangerText} />
          </Pressable>
          <Divider />
          <SettingRow label="重置设置" description="恢复所有配置为默认值" onPress={handleResetSettings} />
        </Card>

        {/* About */}
        <SectionTitle>关于</SectionTitle>
        <Card padded={false}>
          <View style={styles.aboutRow}>
            <Text style={[type.body, styles.aboutLabel]}>应用名称</Text>
            <Text style={[type.body, styles.aboutValue]} numberOfLines={2}>
              BIO HUB
            </Text>
          </View>
          <Divider />
          <View style={styles.aboutRow}>
            <Text style={[type.body, styles.aboutLabel]}>版本</Text>
            <Text style={[type.body, styles.aboutValue, tabularNums]} numberOfLines={2}>
              {APP_VERSION} ({APP_BUILD})
            </Text>
          </View>
          <Divider />
          <View style={styles.aboutRow}>
            <Text style={[type.body, styles.aboutLabel]}>运行环境</Text>
            <Text style={[type.body, styles.aboutValue]} numberOfLines={2}>
              Expo SDK 57 / React Native
            </Text>
          </View>
          <Divider />
          <View style={styles.aboutRow}>
            <Text style={[type.body, styles.aboutLabel]}>通信协议</Text>
            <Text style={[type.body, styles.aboutValue]} numberOfLines={2}>
              BLE + SLE (NearLink)
            </Text>
          </View>
          <Divider />
          <View style={styles.aboutRow}>
            <Text style={[type.body, styles.aboutLabel]}>硬件平台</Text>
            <Text style={[type.body, styles.aboutValue]} numberOfLines={2}>
              Hi3863 / WS63 Sensor Hub
            </Text>
          </View>
        </Card>

        <Text style={styles.footer}>
          {'BIO HUB Sensor App\n蓝牙 / 星闪 生物传感器数据采集与分析'}
        </Text>
      </ScrollView>

      {/* Change-password sheet */}
      <Modal
        visible={showChangePwd}
        animationType="slide"
        transparent
        onRequestClose={closePwdModal}
      >
        <KeyboardAvoidingView
          style={styles.sheetOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView contentContainerStyle={styles.sheetScroll} keyboardShouldPersistTaps="handled">
            <Card style={styles.sheetPanel}>
              <Text style={[type.h1, styles.sheetTitle]}>修改密码</Text>

              <Text style={[type.label, styles.inputLabel]}>当前密码</Text>
              <TextInput
                style={[type.body, styles.input]}
                value={curPwd}
                onChangeText={setCurPwd}
                placeholder="输入当前密码"
                placeholderTextColor={color.textFaint}
                secureTextEntry
                autoCapitalize="none"
                accessibilityLabel="当前密码"
              />

              <Text style={[type.label, styles.inputLabel]}>新密码</Text>
              <TextInput
                style={[type.body, styles.input]}
                value={newPwd}
                onChangeText={setNewPwd}
                placeholder="至少 6 位"
                placeholderTextColor={color.textFaint}
                secureTextEntry
                autoCapitalize="none"
                accessibilityLabel="新密码"
              />

              <Text style={[type.label, styles.inputLabel]}>确认新密码</Text>
              <TextInput
                style={[type.body, styles.input]}
                value={newPwd2}
                onChangeText={setNewPwd2}
                placeholder="再次输入新密码"
                placeholderTextColor={color.textFaint}
                secureTextEntry
                autoCapitalize="none"
                accessibilityLabel="确认新密码"
              />

              {pwdError ? <Text style={[type.label, styles.pwdError]}>{pwdError}</Text> : null}

              <View style={styles.sheetActions}>
                <Button
                  label="取消"
                  variant="secondary"
                  disabled={pwdSubmitting}
                  style={styles.sheetBtn}
                  onPress={closePwdModal}
                />
                <Button
                  label="保存"
                  variant="primary"
                  loading={pwdSubmitting}
                  style={styles.sheetBtn}
                  onPress={submitChangePwd}
                />
              </View>
            </Card>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </Screen>
  );
}

function makeStyles(color: Palette) {
  return StyleSheet.create({
  body: { padding: space.lg, paddingBottom: space.huge },

  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.lg,
  },
  rowPressed: { backgroundColor: color.raisedHigh },
  settingInfo: { flex: 1, minWidth: 0 },
  settingLabel: { color: color.text },
  settingDesc: { color: color.textMuted, marginTop: space.xxs, fontWeight: '400', lineHeight: 22 },
  settingHint: { color: color.textFaint, marginTop: space.xxs },

  accountRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: color.accentSurface,
    borderWidth: 1,
    borderColor: color.accentBorder,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  adminTag: { marginTop: space.sm, flexDirection: 'row' },

  blockRow: { padding: space.lg, gap: space.xxs },
  durationPicker: { marginTop: space.md },

  dangerLabel: { color: color.dangerText },
  dangerDesc: { color: color.textMuted, marginTop: space.xxs, fontWeight: '400', lineHeight: 22 },

  aboutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.lg,
    padding: space.lg,
  },
  aboutLabel: { color: color.textMuted, flexShrink: 0 },
  aboutValue: { color: color.text, fontWeight: '600', flexShrink: 1, minWidth: 0, textAlign: 'right' },

  footer: {
    ...type.caption,
    color: color.textFaint,
    textAlign: 'center',
    marginTop: space.xxl,
    lineHeight: 22,
  },

  /* Sheets */
  sheetOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)' },
  sheetScroll: { flexGrow: 1, justifyContent: 'center', padding: space.xl },
  sheetPanel: { gap: space.sm, padding: space.xl },
  sheetTitle: { color: color.text, marginBottom: space.xs },
  inputLabel: { color: color.textSecondary, marginTop: space.sm },
  input: {
    backgroundColor: color.sunken,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.borderStrong,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    color: color.text,
    minHeight: 48,
  },
  pwdError: { color: color.dangerText, marginTop: space.sm, fontWeight: '400' },
  sheetActions: { flexDirection: 'row', gap: space.sm, marginTop: space.lg },
  sheetBtn: { flex: 1 },
});
}
