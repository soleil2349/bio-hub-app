# BIO HUB App - 构建说明

生物传感器蓝牙助手 App，通过 BLE 连接 WS63 开发板的 sensor_hub 固件。

## 功能

- 扫描并连接 BIO_HUB 蓝牙设备
- 实时显示传感器数据：心率、血氧、体温、血压、灌注指数、ECG 等
- 发送控制命令：暂停/恢复数据采集
- 自动心跳保活（每 2 秒）

## 环境准备

### 方式一：EAS 云端构建（推荐，无需本地 Android SDK）

1. 安装依赖：
```bash
npm install --registry=https://registry.npmmirror.com
```

2. 安装 EAS CLI：
```bash
npm install -g eas-cli
```

3. 登录 Expo 账号（没有可免费注册 https://expo.dev）：
```bash
eas login
```

4. 构建 APK：
```bash
eas build --platform android --profile preview
```

构建完成后会给出下载链接，直接下载 APK 安装到手机。

### 方式二：本地构建

需要先安装：
- [JDK 17+](https://adoptium.net/)
- [Android SDK](https://developer.android.com/studio) (Build Tools 34+, API 34)

设置环境变量：
```bash
set ANDROID_HOME=C:\Users\你的用户名\AppData\Local\Android\Sdk
set JAVA_HOME=C:\Program Files\Eclipse Adoptium\jdk-17...
```

然后：
```bash
npx expo prebuild --platform android
cd android
.\gradlew assembleRelease
```

APK 位于 `android/app/build/outputs/apk/release/app-release.apk`

## 通信协议

| 方向 | 数据包 | 大小 | 频率 |
|------|--------|------|------|
| 设备→App | bio_pkt_t | 20 字节 | 500ms |
| App→设备 | ctrl_pkt_t | 4 字节 | 按需/2s心跳 |

### bio_pkt_t 字段

| 偏移 | 类型 | 含义 |
|------|------|------|
| 0 | uint8 | PPG 心率 BPM |
| 1 | uint8 | 血氧 SpO2 % |
| 2-5 | uint32 | IR 原始值 |
| 6 | int8 | 温度整数部分 °C |
| 7 | uint8 | 温度小数 (低4位×0.0625) |
| 8 | uint8 | 灌注指数 ×10 |
| 9 | uint8 | 收缩压 mmHg |
| 10 | uint8 | 舒张压 mmHg |
| 11 | uint8 | 状态标志位 |
| 12-13 | uint16 | PTT ms |
| 14 | uint8 | ECG 心率 BPM |
| 15 | uint8 | ECG 信号质量 |
| 16-17 | int16 | ECG 原始采样 |
| 18-19 | uint16 | R-R 间期 |

### ctrl_pkt_t 命令

| cmd | 含义 |
|-----|------|
| 0 | 心跳保活 |
| 1 | 暂停/恢复切换 |

## BLE 连接参数

- 设备名：`BIO_HUB`
- Service UUID：`0000abcd-0000-1000-8000-00805f9b34fb`
- Characteristic UUID：`0000bcde-0000-1000-8000-00805f9b34fb`
