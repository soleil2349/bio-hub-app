/**
 * Authentication screen: login + register, with an inline server-URL editor.
 *
 * Shown by ``App.tsx`` whenever the user is not authenticated. On success
 * the auth store is populated via ``bioHubAPI`` and the parent re-renders
 * into the main app.
 */
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { bioHubAPI } from '../api';

type Mode = 'login' | 'register';

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
    const status = await bioHubAPI.checkServer();
    setServerOk(status.online);
    setChecking(false);
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

  const switchMode = () => {
    setError(null);
    setMode((m) => (m === 'login' ? 'register' : 'login'));
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.branding}>
          <Text style={styles.brandTitle}>BIO HUB</Text>
          <Text style={styles.brandSubtitle}>生物传感器数据采集与分析</Text>
        </View>

        {/* Server status */}
        <TouchableOpacity
          style={styles.serverBar}
          onPress={() => setShowServerEdit((v) => !v)}
          activeOpacity={0.7}
        >
          <View
            style={[
              styles.serverDot,
              {
                backgroundColor: checking
                  ? '#FBBF24'
                  : serverOk === true
                  ? '#4ADE80'
                  : serverOk === false
                  ? '#EF4444'
                  : '#6B7280',
              },
            ]}
          />
          <Text style={styles.serverText} numberOfLines={1}>
            {checking
              ? '正在测试服务器...'
              : serverOk === true
              ? `服务器可用 · ${serverUrl}`
              : serverOk === false
              ? `服务器不可用 · ${serverUrl}`
              : serverUrl || '未配置服务器'}
          </Text>
          <Text style={styles.serverAction}>{showServerEdit ? '收起' : '修改'}</Text>
        </TouchableOpacity>

        {showServerEdit && (
          <View style={styles.serverEditor}>
            <TextInput
              style={styles.input}
              value={serverUrl}
              onChangeText={setServerUrl}
              placeholder="http://156.226.176.22"
              placeholderTextColor="#4B5563"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <View style={styles.serverEditActions}>
              <TouchableOpacity style={styles.smallBtnSecondary} onPress={pingServer}>
                <Text style={styles.smallBtnSecondaryText}>测试</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.smallBtnPrimary} onPress={saveServerUrl}>
                <Text style={styles.smallBtnPrimaryText}>保存</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Mode switch */}
        <View style={styles.modeSwitch}>
          <TouchableOpacity
            style={[styles.modeBtn, mode === 'login' && styles.modeBtnActive]}
            onPress={() => mode !== 'login' && switchMode()}
          >
            <Text style={[styles.modeBtnText, mode === 'login' && styles.modeBtnTextActive]}>
              登录
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modeBtn, mode === 'register' && styles.modeBtnActive]}
            onPress={() => mode !== 'register' && switchMode()}
          >
            <Text style={[styles.modeBtnText, mode === 'register' && styles.modeBtnTextActive]}>
              注册
            </Text>
          </TouchableOpacity>
        </View>

        {/* Form */}
        <View style={styles.form}>
          <Text style={styles.label}>邮箱</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor="#4B5563"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
          />

          <Text style={styles.label}>密码</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            placeholder={mode === 'register' ? '至少 6 位' : '输入密码'}
            placeholderTextColor="#4B5563"
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            textContentType={mode === 'login' ? 'password' : 'newPassword'}
          />

          {mode === 'register' && (
            <>
              <Text style={styles.label}>昵称（可选）</Text>
              <TextInput
                style={styles.input}
                value={displayName}
                onChangeText={setDisplayName}
                placeholder="用于显示"
                placeholderTextColor="#4B5563"
                autoCorrect={false}
                maxLength={32}
              />
            </>
          )}

          {error && <Text style={styles.errorText}>{error}</Text>}

          <TouchableOpacity
            style={[styles.primaryBtn, submitting && styles.primaryBtnDisabled]}
            onPress={handleSubmit}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color="#E0E7FF" />
            ) : (
              <Text style={styles.primaryBtnText}>
                {mode === 'login' ? '登录' : '注册并登录'}
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity onPress={switchMode} style={styles.switchLink}>
            <Text style={styles.switchLinkText}>
              {mode === 'login' ? '还没有账户？点此注册' : '已有账户？点此登录'}
            </Text>
          </TouchableOpacity>

          {/* 离线模式入口：无网络 / 服务器不可用时也能使用蓝牙采集与本地分析 */}
          {onSkip && (
            <TouchableOpacity onPress={onSkip} style={styles.skipBtn} activeOpacity={0.7}>
              <Text style={styles.skipBtnText}>跳过登录，离线使用</Text>
              <Text style={styles.skipBtnHint}>
                蓝牙采集与本地分析无需登录，随时可在「设置」中登录
              </Text>
            </TouchableOpacity>
          )}
        </View>

        <Text style={styles.footer}>
          注册即表示同意在此服务器上存储你的采集数据{'\n'}
          仅登录后的用户可访问自己的历史与报告
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0E1A' },
  scroll: { padding: 24, paddingTop: 64, paddingBottom: 48 },
  branding: { alignItems: 'center', marginBottom: 24 },
  brandTitle: {
    fontSize: 36,
    fontWeight: '800',
    color: '#E0E7FF',
    letterSpacing: 4,
  },
  brandSubtitle: { fontSize: 13, color: '#6B7280', marginTop: 4 },
  serverBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111827',
    borderColor: '#1F2937',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  serverDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  serverText: { flex: 1, color: '#9CA3AF', fontSize: 12 },
  serverAction: { color: '#60A5FA', fontSize: 12, fontWeight: '600' },
  serverEditor: {
    backgroundColor: '#111827',
    borderColor: '#1F2937',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  serverEditActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
    justifyContent: 'flex-end',
  },
  smallBtnSecondary: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#1F2937',
  },
  smallBtnSecondaryText: { color: '#93C5FD', fontWeight: '600' },
  smallBtnPrimary: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#1D4ED8',
  },
  smallBtnPrimaryText: { color: '#E0E7FF', fontWeight: '700' },
  modeSwitch: {
    flexDirection: 'row',
    backgroundColor: '#111827',
    borderRadius: 10,
    padding: 4,
    marginBottom: 16,
    marginTop: 8,
  },
  modeBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
  },
  modeBtnActive: { backgroundColor: '#1D4ED8' },
  modeBtnText: { color: '#9CA3AF', fontWeight: '600' },
  modeBtnTextActive: { color: '#E0E7FF' },
  form: {},
  label: {
    color: '#9CA3AF',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 12,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  input: {
    backgroundColor: '#1F2937',
    borderRadius: 10,
    borderColor: '#374151',
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#E5E7EB',
    fontSize: 15,
  },
  errorText: {
    color: '#F87171',
    marginTop: 12,
    fontSize: 13,
    textAlign: 'center',
  },
  primaryBtn: {
    backgroundColor: '#1D4ED8',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 20,
  },
  primaryBtnDisabled: { opacity: 0.7 },
  primaryBtnText: { color: '#E0E7FF', fontWeight: '700', fontSize: 15 },
  switchLink: { marginTop: 16, alignItems: 'center' },
  switchLinkText: { color: '#60A5FA', fontSize: 13 },
  skipBtn: {
    marginTop: 22,
    borderColor: '#374151',
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  skipBtnText: { color: '#9CA3AF', fontSize: 14, fontWeight: '600' },
  skipBtnHint: {
    color: '#4B5563',
    fontSize: 11,
    marginTop: 4,
    textAlign: 'center',
  },
  footer: {
    color: '#4B5563',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 32,
    lineHeight: 18,
  },
});
