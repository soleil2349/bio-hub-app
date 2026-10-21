# Expo HAS CHANGED

Read the exact versioned docs at [https://docs.expo.dev/versions/v57.0.0/](https://docs.expo.dev/versions/v57.0.0/) before writing any code.

## 版本号规则（每次构建必守）

**每次构建 APK / 发布前必须递增版本号。** 否则手机端无法区分新旧版本
（曾因所有构建都是 `1.3.0` 而误判「装了新版却没生效」，浪费排查时间）。

需要同步更新三处（都在 `app.json`）：

| 字段 | 规则 |
|------|------|
| `expo.version` | 语义化版本：新增功能 `+0.1.0`，仅修 bug `+0.0.1` |
| `expo.android.versionCode` | 整数，**每次构建 +1**（Android 靠它判断"是升级"） |
| `expo.ios.buildNumber` | 字符串整数，与 versionCode 保持一致 |

版本号由本地 `app.json` 控制（`eas.json` 已设 `"appVersionSource": "local"`）。

提交信息里带上版本号，例如：

```
chore(release): v1.4.0 (versionCode 4)
```

## 本地开发（Cloud Agent）

Expo SDK 57 的最低 Node.js 是 **22.13.x**。本环境镜像已带 Node 22，直接装依赖即可，不要改回 Node 20。

```bash
npm ci
npx tsc --noEmit
npx expo start --localhost --port 8081
```

- `.npmrc` 里有 `ignore-scripts=true`，`npm ci` 不会跑依赖的 postinstall。
- Metro 监听 `http://localhost:8081`（IPv6 `::1`）。就绪：`curl -sf http://localhost:8081/status`。不要设 `CI=1`，否则热更新会关掉。
- 虚拟机里没有手机和 BLE 设备。改完 TypeScript 后跑 `npx tsc --noEmit`，再用 `curl "http://localhost:8081/index.bundle?platform=android&dev=true"` 确认能打包。传感器包解析在 `src/protocol.ts`。
- `react-native-ble-plx` 不在 Expo Go 里。真机连传感器要走 EAS 或 GitHub Actions 打出来的开发包，扫码进 Expo Go 连不上板子。

## 构建产物签名提醒

- **GitHub Actions**（`.github/workflows/build-apk.yml`）用 **debug keystore** 签名
- **EAS** 用 Expo 托管的 release keystore 签名
- 两者**签名不同，不能互相覆盖安装**：换来源安装前必须先卸载旧 App
