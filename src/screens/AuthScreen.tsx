/**
 * Authentication screen: login + register, with an inline server-URL editor.
 *
 * Shown by `App.tsx` whenever the user is not authenticated. On success
 * the auth store is populated via `bioHubAPI` and the parent re-renders
 * into the main app.
 *
 * Layout notes
 * ------------
 *  - The form sits inside `Screen` (real top/bottom insets) and a
 *    `KeyboardAvoidingView`, so the submit button is reachable with the
 *    keyboard open instead of being covered by it.
 *  - Hero padding is capped: the old `paddingTop: 64` combined with a notched
 *    device's safe-area inset pushed the form far enough down that the primary
 *    action fell below the fold on shorter phones.
 *  - Labels sit above their inputs (never placeholder-as-label), and the
 *    placeholder colour was raised from #4B5563 — which measured 1.9:1 on this
 *    background and was effectively unreadable — to a legible muted tone.
 */
import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { bioHubAPI } from '../api';
import Icon from '../components/Icon';
import {
  Button,
  Card,
  ErrorNote,
  Screen,
  SegmentedControl,
  StatusDot,
} from '../components/ui';
import { color, radius, space, type } from '../theme';

type Mode = 'login' | 'register';

const MODE_OPTIONS = [
  { value: 'login' as const, label: '登录' },
  { value: 'register' as const, label: '注册' },
];

interface Props {
  onAuthed: () => void;
  /** 跳过登录，直接以离线（访客）模式使用 App */
  onSkip?: () => void;
}

export default function AuthScreen({ onAuthed, onSkip }: Props) {
  const [mode, setMode] = useState<Mode>('login');
  const [serverUrl, setServerUrl] = useState('');
  const [showServerEdit, setShowServerEdit] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serverOk, setServerOk] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    (async () => {
      await bioHubAPI.init();
      setServerUrl(bioHubAPI.getConfig().baseUrl);
      pingServer();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pingServer = async () => {
    setChecking(true);
    try {
      const status = await bioHubAPI.checkServer();
      setServerOk(status.online);
    } finally {
      setChecking(false);
    }
  };

  const saveServerUrl = async () => {
    const trimmed = serverUrl.trim().replace(/\/+$/, '');
    if (!trimmed) {
      setError('服务器地址不能为空');
      return;
    }
    await bioHubAPI.setConfig({ baseUrl: trimmed });
    setShowServerEdit(false);
    setError(null);
    pingServer();
  };

  const validate = (): string | null => {
    if (!email.trim()) return '请输入邮箱';
    if (!password.trim()) return '请输入密码';
    if (password.length < 6) return '密码至少 6 位';
    if (mode === 'register' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      return '邮箱格式不正确';
    }
    return null;
  };

  const handleSubmit = async () => {
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const result =
        mode === 'login'
          ? await bioHubAPI.login(email.trim(), password)
          : await bioHubAPI.register(email.trim(), password, displayName.trim() || undefined);
      if (result.ok) {
        onAuthed();
      } else {
        setError(result.error || (mode === 'login' ? '登录失败' : '注册失败'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const switchMode = (next: Mode) => {
    setError(null);
    setMode(next);
  };

  const serverTone = checking ? 'warn' : serverOk === true ? 'ok' : serverOk === false ? 'bad' : 'idle';
  const serverLabel = checking
    ? '正在测试服务器…'
    : serverOk === true
    ? '服务器可用'
    : serverOk === false
    ? '服务器不可用'
    : '未测试';

  return (
    <Screen edges={['top', 'bottom', 'left', 'right']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.branding}>
            <Text style={styles.brandTitle}>BIO HUB</Text>
            <Text style={[type.body, styles.brandSubtitle]}>生物传感器数据采集与分析</Text>
          </View>

          {/* Server status */}
          <Pressable
            style={({ pressed }) => [styles.serverBar, pressed && styles.serverBarPressed]}
            onPress={() => setShowServerEdit((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel={`服务器状态：${serverLabel}，点击修改地址`}
          >
            <StatusDot tone={serverTone} />
            <View style={styles.serverTextWrap}>
              <Text style={[type.label, styles.serverLabel]} numberOfLines={1}>
                {serverLabel}
              </Text>
              <Text style={[type.caption, styles.serverUrl]} numberOfLines={1} ellipsizeMode="middle">
                {serverUrl || '未配置服务器地址'}
              </Text>
            </View>
            <Text style={[type.label, styles.serverAction]}>
              {showServerEdit ? '收起' : '修改'}
            </Text>
          </Pressable>

          {showServerEdit ? (
            <Card style={styles.serverEditor}>
              <Text style={[type.label, styles.inputLabel]}>服务器地址</Text>
              <TextInput
                style={[type.body, styles.input]}
                value={serverUrl}
                onChangeText={setServerUrl}
                placeholder="http://156.226.176.22"
                placeholderTextColor={color.textFaint}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                accessibilityLabel="服务器地址"
              />
              <View style={styles.serverEditActions}>
                <Button
                  label="测试"
                  variant="secondary"
                  size="sm"
                  loading={checking}
                  style={styles.serverEditBtn}
                  onPress={pingServer}
                />
                <Button
                  label="保存"
                  variant="primary"
                  size="sm"
                  style={styles.serverEditBtn}
                  onPress={saveServerUrl}
                />
              </View>
            </Card>
          ) : null}

          {/* Mode switch */}
          <View style={styles.modeSwitch}>
            <SegmentedControl options={MODE_OPTIONS} value={mode} onChange={switchMode} />
          </View>

          {/* Form */}
          <View style={styles.form}>
            <Text style={[type.label, styles.inputLabel]}>邮箱</Text>
            <TextInput
              style={[type.body, styles.input]}
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={color.textFaint}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              accessibilityLabel="邮箱"
            />

            <Text style={[type.label, styles.inputLabel]}>密码</Text>
            <TextInput
              style={[type.body, styles.input]}
              value={password}
              onChangeText={setPassword}
              placeholder={mode === 'register' ? '至少 6 位' : '输入密码'}
              placeholderTextColor={color.textFaint}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              textContentType={mode === 'login' ? 'password' : 'newPassword'}
              accessibilityLabel="密码"
            />

            {mode === 'register' ? (
              <>
                <Text style={[type.label, styles.inputLabel]}>昵称（可选）</Text>
                <TextInput
                  style={[type.body, styles.input]}
                  value={displayName}
                  onChangeText={setDisplayName}
                  placeholder="用于在账户中显示"
                  placeholderTextColor={color.textFaint}
                  autoCorrect={false}
                  maxLength={32}
                  accessibilityLabel="昵称"
                />
              </>
            ) : null}

            {error ? (
              <View style={styles.errorWrap}>
                <ErrorNote message={error} />
              </View>
            ) : null}

            <Button
              label={mode === 'login' ? '登录' : '注册并登录'}
              variant="primary"
              block
              loading={submitting}
              style={styles.submit}
              onPress={handleSubmit}
            />

            <Pressable
              onPress={() => switchMode(mode === 'login' ? 'register' : 'login')}
              style={styles.switchLink}
              hitSlop={8}
            >
              <Text style={[type.label, styles.switchLinkText]}>
                {mode === 'login' ? '还没有账户？点此注册' : '已有账户？点此登录'}
              </Text>
            </Pressable>
          </View>

          {/* 离线模式入口：无网络 / 服务器不可用时也能使用蓝牙采集与本地分析 */}
          {onSkip ? (
            <Pressable
              onPress={onSkip}
              style={({ pressed }) => [styles.skipBtn, pressed && styles.skipBtnPressed]}
              accessibilityRole="button"
            >
              <Icon name="bluetooth" size={16} color={color.accentText} />
              <Text style={[type.label, styles.skipBtnText]}>跳过登录，离线使用</Text>
            </Pressable>
          ) : null}

          <Text style={[type.caption, styles.footer]}>
            {'注册即表示同意在此服务器上存储你的采集数据。\n仅登录后的用户可访问自己的历史与报告。'}
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: space.xxl,
    paddingTop: space.xxxl,
    paddingBottom: space.xxxl,
  },

  branding: { alignItems: 'center', marginBottom: space.xxl },
  brandTitle: {
    fontSize: 30,
    lineHeight: 38,
    fontWeight: '700',
    color: color.text,
    letterSpacing: 4,
  },
  brandSubtitle: { color: color.textMuted, marginTop: space.xs, textAlign: 'center' },

  serverBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: color.surface,
    borderColor: color.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    marginBottom: space.md,
  },
  serverBarPressed: { opacity: 0.75 },
  serverTextWrap: { flex: 1, minWidth: 0 },
  serverLabel: { color: color.textSecondary },
  serverUrl: { color: color.textMuted, marginTop: space.xxs },
  serverAction: { color: color.accentText, flexShrink: 0 },

  serverEditor: { marginBottom: space.lg, gap: space.sm },
  serverEditActions: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
  serverEditBtn: { flex: 1 },

  modeSwitch: { marginTop: space.sm, marginBottom: space.lg },

  form: { gap: space.xs },
  inputLabel: { color: color.textSecondary, marginTop: space.md },
  input: {
    backgroundColor: color.raised,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.borderStrong,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    color: color.text,
    minHeight: 50,
  },

  errorWrap: { marginTop: space.lg },
  submit: { marginTop: space.xl },
  switchLink: { marginTop: space.lg, alignItems: 'center' },
  switchLinkText: { color: color.accentText },

  skipBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    marginTop: space.xxl,
    borderColor: color.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    minHeight: 48,
  },
  skipBtnPressed: { opacity: 0.7 },
  skipBtnText: { color: color.accentText },

  footer: {
    color: color.textFaint,
    textAlign: 'center',
    marginTop: space.xxl,
    lineHeight: 18,
  },
});
