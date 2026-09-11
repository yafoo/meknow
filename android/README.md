# MeNote（Android）

通过 iroh P2P 隧道在手机上访问家里电脑/NAS 上的 MeNote，无需公网 IP、端口映射。

- 电脑端 MeNote 主服务自带 P2P 网关（`lib/p2p.js`，随 `server.js` 启动）
- 本 App 在手机本地 `127.0.0.1:8080` 起 HTTP 代理，WebView 加载本地代理
- 每个请求经 iroh QUIC 双向流（ALPN `menote-p2p/1`）直连电脑端，进入 MeNote 完整应用栈
- MeNote 的 Vue SPA **零改动**

## 配对流程

1. 电脑端启动 MeNote 服务，控制台打印**服务器节点 ID**（base32）
2. 手机装本 App，填入服务器节点 ID（支持扫码），点「启动隧道」
3. 首次连接会出现在电脑端 admin 后台的待配对列表（管理页 → P2P 管理，3 秒轮询自动弹窗）
4. 在 admin 弹窗中点「授权」，手机自动重连，白名单持久化，之后长期有效
5. 手机点「打开 MeNote」→ 登录 admin → 用笔记

## 构建

```sh
# 本机环境：JDK 20（D:\Program Files\Java\jdk-20），Android SDK 35
set JAVA_HOME=D:\Program Files\Java\jdk-20
gradlew.bat assembleDebug
# 产物: app/build/outputs/apk/debug/app-debug.apk
```

依赖：
- `computer.iroh:iroh-android:1.1.0`（官方 AAR，预编译 4 ABI 的 libiroh_ffi.so）
- `computer.iroh:iroh:1.1.0`（Kotlin 绑定类，来自 iroh-ffi）
- `net.java.dev.jna:5.15.0`（AAR，iroh 绑定依赖）
- `io.ktor:ktor-http:3.5.2`（HTTP 解析/生成纯数据结构）
- `zxing-core` + CameraX（扫码配对）

**签名**：release 构建自动读取根目录 `keystore.properties`（含密钥库路径与密码，已 gitignore）。密钥库不入仓库，自行构建 release 时请自建 keystore 并配置该文件；日常 assembleDebug 无需签名文件。

## 结构

| 文件 | 职责 |
|---|---|
| `IrohProxy.kt` | 核心：iroh Endpoint + QUIC 连接复用 + 本地 ServerSocket + HTTP/1.1 字节级转发 |
| `ProxyService.kt` | 前台服务：保活隧道（Android 后台限制） |
| `MainActivity.kt` | 配置页：服务器 ID 输入、扫码、本机节点 ID 展示、启停、日志 |
| `ScanActivity.kt` | 扫码：zxing + CameraX 识别服务器节点 ID 二维码，结果自动 hex→base32 归一 |
| `WebActivity.kt` | WebView：加载 `http://127.0.0.1:8080/admin/login`，拦截非本地 URL |

## 已知设计取舍

- 响应一次性缓冲（上限 64MB/请求）：`readToEnd` 简化实现，笔记场景够用
- 每请求一条 QUIC 流，连接级复用：一次握手多流并发，网络切换自动重建（指数退避，60s 封顶）
- HTTP 请求转发时跳过 `Connection`/`Content-Length`/`Transfer-Encoding` 头自行生成——避免与 WebView 自带头冲突
