# MeknowP2P（Android）

通过 iroh P2P 隧道在手机上访问家里电脑/NAS 上的 Meknow，无需公网 IP、端口映射。

- 电脑端跑 [meknow/p2p](../wwwroot/zzz/meknow/p2p)（iroh-http-node 适配层）
- 本 App 在手机本地 `127.0.0.1:8080` 起 HTTP 代理，WebView 加载本地代理
- 每个请求经 iroh QUIC 双向流（ALPN `iroh-http/2`）转发到电脑端，再反代到 Meknow
- Meknow 的 Vue SPA **零改动**

## 配对流程

1. 电脑端启动 `node p2p.js`，控制台显示**服务器节点 ID**
2. 手机装本 App，填入服务器节点 ID，点「启动隧道」
3. App 显示**本机节点 ID**
4. 电脑端执行 `node pair.js --add <本机节点ID>` 完成配对（Peer-Id 白名单）
5. 手机点「打开 Meknow」→ 登录 admin → 用笔记

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

## 结构

| 文件 | 职责 |
|---|---|
| `IrohProxy.kt` | 核心：iroh Endpoint + QUIC 连接复用 + 本地 ServerSocket + HTTP/1.1 字节级转发 |
| `ProxyService.kt` | 前台服务：保活隧道（Android 后台限制） |
| `MainActivity.kt` | 配置页：服务器 ID 输入、本机节点 ID 展示、启停 |
| `WebActivity.kt` | WebView：加载 `http://127.0.0.1:8080/admin/login`，拦截非本地 URL |

## 已知设计取舍

- 响应一次性缓冲（上限 64MB/请求）：`readToEnd` 简化实现，笔记场景够用
- 每请求一条 QUIC 流：`Connection: close` 语义，与电脑端 iroh-http/2 服务对齐
- QUIC 连接级复用：一次握手多流并发，网络切换自动重建
