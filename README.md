# BIO HUB 移动端 App（BLE 生理数据监测 + 云端分析）

连接自绘板 **sensor_hub 固件**（BLE 广播名 `BIO_HUB`）的 React Native / Expo App：
实时显示 **心率 / 血氧 / 温度 / 灌注指数 / 血压 / ECG 心率 / ECG 波形 / PPG 波形**，
支持向开发板发送控制命令（暂停推送、心跳），并可将采集数据上传到 **BIO HUB 云服务器**做分析报告。

## 架构

```
┌──────────────┐   BLE (GATT Notify)   ┌──────────────┐
│  手机 App     │ ◄──────────────────── │  自绘板       │
│  Expo / RN    │    bio_pkt_t (20B)    │  sensor_hub  │
│  ble-plx      │    ECG 流 (0xEC 前缀)  │  (Hi3863)    │
│              │ ────────────────────►  │              │
│              │    ctrl_pkt_t (4B)     │              │
└──────┬───────┘                        └──────────────┘
       │  HTTPS (REST)
       ▼
┌──────────────┐
│  云服务器     │  FastAPI + PostgreSQL + Redis + Nginx
│  bio_hub_server│  auth / sessions / reports
└──────────────┘
```

## 技术栈

- **框架**：Expo 57 + React Native 0.86 + TypeScript
- **蓝牙**：`react-native-ble-plx`，支持标准 BLE 与星闪 SLE（NearLink）双协议
- **本地存储**：expo-sqlite（会话/样本）+ AsyncStorage（配置/会话）
- **云端**：对接 `bio_hub_server`（FastAPI），登录注册(JWT)、会话上传、分析报告
- **离线分析**：本地生成基础健康报告（服务器不可用时兜底）

## 目录结构

```
bio_hub_app/
├── src/
│   ├── ble-manager.ts      # BLE/SLE 扫描、连接、Notify 订阅、命令写入
│   ├── protocol.ts         # BLE 协议定义（与固件 bio_pkt.h 对齐）
│   ├── api.ts              # 云服务器 REST 客户端 + 本地报告生成
│   ├── auth.ts             # JWT 会话持久化
│   ├── storage.ts          # SQLite 会话/样本存储
│   ├── analysis.ts         # 分析辅助
│   ├── screens/            # Scan/Device/Cloud/History/Settings/Auth 六屏
│   └── components/         # TabBar / Waveform
├── .github/workflows/      # build-apk.yml / build-ios.yml 云构建
├── BUILD_README.md         # 构建详细说明（EAS / 本地 / GitHub Actions）
└── app.json / App.tsx / package.json
```

## 构建 APK

三种方式，详见 `BUILD_README.md`：

1. **GitHub Actions（推荐，免本地 Android SDK）**：push 到 `main` 或手动触发
   `.github/workflows/build-apk.yml`，产出 release APK artifact
2. **EAS 云构建**：`eas build --platform android --profile preview`
3. **本地构建**：`npx expo prebuild --platform android` + `cd android && ./gradlew assembleRelease`

## BLE 协议要点（与固件对齐）

固件源码：`fbb_ws63_v2/src/application/samples/text63/sensor_hub/`

- 广播名：`BIO_HUB`（BLE）/ `BIO_HUB_SLE`（星闪）
- 下行 Notify：`bio_pkt_t`（20 字节，HR/SpO2/IR/温度/PI/血压/flags/PTT/ECG_HR/SIG/ECG_raw/RR）+ ECG 流包（0xEC 前缀）
- 上行 Write：`ctrl_pkt_t`（4 字节：cmd/seq/uptime_s），`CMD_HEARTBEAT`=0 / `CMD_TOGGLE`=1
- 特征自动发现 4 级兜底，兼容 BLE 与 SLE 两种 UUID

## 服务器

后端 `bio_hub_server/`（FastAPI）部署于云服务器，配置与 API 见 `../bio_hub_server/SERVER.md`。
App 默认服务器地址 `http://156.226.176.22`（可在设置页修改）。
