# Meknow P2P 适配层（电脑端）

把家里电脑/NAS 上运行的 Meknow（默认 `127.0.0.1:3000`）通过 iroh QUIC 暴露到 P2P 网络，
手机在外网（4G/5G/异地 WiFi）无需公网 IP、端口映射，即可直接访问家里的笔记。

手机端 App（Android，Kotlin + `computer.iroh:iroh-android`）在本机 `127.0.0.1` 起一个
HTTP 代理，把 WebView 的每个请求通过 iroh QUIC 双向流（ALPN: `iroh-http/2`）转发到本适配层，
适配层再反向代理到本地 Meknow。**Meknow 本身零改动**。

## 架构

```
手机 WebView (http://127.0.0.1:8080)
   │ 本地回环
手机本地代理 (Kotlin, iroh-ffi)
   │ iroh QUIC (ALPN iroh-http/2, NAT 打洞/中继)
电脑 p2p.js (iroh-http-node serve)
   │ Peer-Id 白名单校验
   │ fetch 反代
Meknow (127.0.0.1:3000)
```

## 安全（两层）

1. **Peer-Id 白名单**：iroh 在 QUIC 握手后注入 `Peer-Id` 头（传输层注入，不可伪造），
   只允许 `allow.json` 登记过的节点，其余一律 403。
2. **Meknow 登录认证**：手机端仍需登录 admin 后台，未登录拿不到 cookie。

## 使用

```sh
cd p2p
npm install

# 1. 启动（首次自动生成节点身份，ID 固定不变）
node p2p.js
# 控制台输出: 本节点 ID: xxxxx

# 2. 手机 App 里填入上面的节点 ID；App 会显示自己的节点 ID

# 3. 把手机节点 ID 登记到白名单，完成配对
node pair.js --add <手机节点ID>

# 之后正常访问；移除/查看：
node pair.js --remove <手机节点ID>
node pair.js              # 查看白名单与本节点 ID
```

环境变量：
- `P2P_TARGET`：本地 Meknow 地址，默认 `http://127.0.0.1:3000`
- `P2P_ALLOW`：临时白名单（逗号分隔节点 ID），不改文件快速授权

## 测试

```sh
node test-e2e.mjs
# 首次跑会提示 403，按提示 node pair.js --add <client ID> 后重跑，
# 出现 "✓ 端到端转发验证通过" 即正常。
```

## 文件说明

| 文件 | 用途 |
|---|---|
| `p2p.js` | 适配层主程序：iroh serve + Peer-Id 白名单 + 反代到本地 Meknow |
| `pair.js` | 配对工具：查看节点 ID / 管理白名单 |
| `data/p2p-key.bin` | 节点身份密钥（持久化，节点 ID 稳定） |
| `allow.json` | 白名单（已 gitignore） |
| `test-e2e.mjs` | 端到端验证脚本（客户端密钥持久化，可反复跑） |

## 部署建议

- 与 Meknow 主服务分开跑：`pm2 start p2p.js --name meknow-p2p` 或宝塔进程守护。
- NAS 上部署同理（支持 linux x64/arm64）。
- 电脑端无需开放任何入站端口 —— iroh 通过中继/打洞出站建连。
