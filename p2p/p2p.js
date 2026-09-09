/**
 * Meknow P2P 适配层 —— 电脑端
 *
 * 把本地 Meknow Web 服务（默认 127.0.0.1:3000）通过 iroh QUIC 暴露到 P2P 网络，
 * 手机端 App（Kotlin + iroh-ffi）连上本节点后，在 QUIC 双向流上跑 HTTP/1.1
 * （ALPN: iroh-http/2），本层解析后反向代理到本地 Web 服务。
 *
 * 安全面（两层）：
 *   1. Peer-Id 白名单：iroh 在 QUIC 握手后注入 Peer-Id 头（不可伪造），
 *      只允许 allow.json 里登记的手机节点 ID，其余 403。
 *   2. 原有 admin 登录认证：手机端仍需登录 admin 后台。
 *
 * 白名单热重载：pair.js --add/--remove 修改 allow.json 后立即生效，无需重启本进程
 * （fs.watchFile 监听 + 每笔请求 mtime 兜底检查）。
 *
 * 身份持久化：节点密钥存 data/p2p-key.bin，重启后节点 ID 不变，
 * 手机端配对一次即可长期使用。
 *
 * 用法：
 *   npm install
 *   node p2p.js             # 启动适配层（首次自动生成身份）
 */
import pkg from '@momics/iroh-http-node';
import native from '@momics/iroh-http-node/index.js';
const { createNode } = pkg;
const { generateSecretKey } = native;
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, watchFile } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------- 配置 ----------
const CONFIG_FILE = resolve(__dirname, 'allow.json');
const KEY_FILE = resolve(__dirname, 'data', 'p2p-key.bin');
const TARGET = process.env.P2P_TARGET || 'http://127.0.0.1:3000';
const TARGET_BASE = TARGET.replace(/\/+$/, '');

// ---------- 身份密钥（持久化，节点 ID 稳定） ----------
mkdirSync(dirname(KEY_FILE), { recursive: true });
let keyBytes;
if(existsSync(KEY_FILE)) {
    keyBytes = new Uint8Array(readFileSync(KEY_FILE));
    if(keyBytes.length !== 32) {
        console.error('[meknow-p2p] data/p2p-key.bin 损坏（长度应为 32 字节），已重新生成');
        keyBytes = null;
    }
}
if(!keyBytes) {
    keyBytes = generateSecretKey();
    writeFileSync(KEY_FILE, Buffer.from(keyBytes));
}

// ---------- 白名单（热重载） ----------
// 环境变量白名单：进程内静态，始终叠加
const envPeers = (process.env.P2P_ALLOW || '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

let allowedPeers = new Set(envPeers);
let allowMtime = 0;

// hex(64 字符) → base32(52 字符)：iroh-ffi Android 端显示 hex，网络层用 base32
function hexToBase32(hex) {
    const a = 'abcdefghijklmnopqrstuvwxyz234567';
    let v = 0, n = 0, out = '';
    for(const b of Buffer.from(hex, 'hex')) {
        v = (v << 8) | b;
        n += 8;
        while(n >= 5) { n -= 5; out += a[(v >>> n) & 31]; }
    }
    if(n > 0) out += a[(v << (5 - n)) & 31];
    return out;
}

/** 读取 allow.json；文件有变化时更新内存名单并打印（hex 条目自动转 base32） */
function refreshAllow(verbose = false) {
    try {
        if(!existsSync(CONFIG_FILE)) {
            allowedPeers = new Set(envPeers);
            allowMtime = 0;
            return;
        }
        const mtime = statSync(CONFIG_FILE).mtimeMs;
        if(mtime === allowMtime) return;   // 没变
        allowMtime = mtime;
        const cfg = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
        // 归一化：hex(64) → base32（兼容手工/旧版 pair.js 写入的 hex 条目）
        const fromFile = (cfg.allowedPeers || []).map(s => /^[0-9a-f]{64}$/.test(s.toLowerCase())
            ? hexToBase32(s.toLowerCase()) : s.toLowerCase());
        const before = allowedPeers.size;
        allowedPeers = new Set([...fromFile, ...envPeers]);
        if(verbose || before !== allowedPeers.size) {
            console.log(`[meknow-p2p] 白名单更新: ${allowedPeers.size} 个节点`);
            [...allowedPeers].forEach(p => console.log(`  · ${p}`));
        }
    } catch(e) {
        // 解析失败沿用旧名单（fail-closed：宁可继续拒绝也不放开）
        console.error('[meknow-p2p] allow.json 读取失败，沿用旧名单:', e.message);
    }
}

refreshAllow(true);
// 热重载：pair.js 改文件后 1s 内感知（watchFile 轮询，跨进程/跨设备可靠）
watchFile(CONFIG_FILE, { interval: 1000 }, () => refreshAllow(true));

// ---------- HTTP 头处理 ----------
// hop-by-hop 头与传输层特定头不应被转发
const HOP_HEADERS = new Set([
    'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
    'te', 'trailer', 'transfer-encoding', 'upgrade', 'host',
    'content-encoding', 'content-length',       // 长度/编码由本地 fetch 重算
    'peer-id',                                   // iroh 注入的传输层头
    'accept-encoding'                            // 避免双层压缩
]);

function filterHeaders(headers) {
    const out = [];
    for(const [k, v] of headers) {
        if(!HOP_HEADERS.has(k.toLowerCase())) out.push([k, v]);
    }
    return out;
}

// req.url 是完整 URL（httpi://<peer-id>/path?query），提取 path+query
function extractPath(url) {
    try {
        const u = new URL(url);
        return u.pathname + u.search;
    } catch(e) {
        return url;  // 非 URL 形态（版本差异兜底）
    }
}

// ---------- 启动 ----------
console.log(`[meknow-p2p] 代理目标: ${TARGET_BASE}`);

const node = await createNode({ key: keyBytes });
console.log('[meknow-p2p] 本节点 ID:', node.publicKey.toString());

if(allowedPeers.size === 0) {
    console.log('[meknow-p2p] ⚠ 白名单为空：所有节点将被拒绝。');
    console.log('[meknow-p2p]   运行 node pair.js --add <手机节点ID> 完成配对。');
} else {
    console.log(`[meknow-p2p] 白名单节点 (${allowedPeers.size}):`);
    [...allowedPeers].forEach(p => console.log(`  · ${p}`));
}

try {
    const di = await node.discoveryInfo();
    if(di?.relayUrl) console.log('[meknow-p2p] 中继:', di.relayUrl);
    if(di?.directAddress) console.log('[meknow-p2p] 直连地址:', di.directAddress);
} catch(e) { /* 旧版本无 discoveryInfo，忽略 */ }

// ---------- 连接事件日志 ----------
// 手机端 QUIC 握手成功/断开时实时打印 —— 电脑端可见的连接状态
let connectedPeers = new Set();
node.addEventListener('peerconnect', (ev) => {
    const id = ev.detail?.nodeId || '未知';
    connectedPeers.add(id);
    const paired = allowedPeers.has(id);
    console.log(`[meknow-p2p] ⇄ 节点已连接: ${id}${paired ? '（已配对 ✓）' : '（未配对！请求将被 403）'}`);
    console.log(`[meknow-p2p] 当前在线: ${connectedPeers.size} 个节点`);
});
node.addEventListener('peerdisconnect', (ev) => {
    const id = ev.detail?.nodeId || '未知';
    connectedPeers.delete(id);
    console.log(`[meknow-p2p] ✂ 节点已断开: ${id}（剩余 ${connectedPeers.size} 个）`);
});

// ---------- HTTP 服务 ----------
await node.serve({}, async (req) => {
    // 白名单兜底热查（watch 失效时每笔请求仍能感知变化）
    refreshAllow(false);

    // ---- 第一层：Peer-Id 白名单 ----
    const peerId = (req.headers.get('Peer-Id') || '').toLowerCase();
    if(!peerId || !allowedPeers.has(peerId)) {
        console.warn(`[meknow-p2p] ✗ 403 拒绝 ${peerId || '未知节点'} 的 ${req.method} ${extractPath(req.url)}`);
        if(peerId) {
            console.warn(`[meknow-p2p]   如确认该手机可信，配对命令: node pair.js --add ${peerId}`);
        }
        return new Response('Forbidden', { status: 403 });
    }

    // ---- 第二层：转发到本地 Meknow（登录认证由 Meknow 自身处理）----
    const path = extractPath(req.url);
    const url = TARGET_BASE + path;

    const t0 = Date.now();
    try {
        const res = await fetch(url, {
            method: req.method,
            headers: filterHeaders(req.headers),
            body: ['GET', 'HEAD'].includes(req.method) ? undefined : req.body,
            redirect: 'manual'
        });
        // 访问日志（静资刷屏只打 API/页面，静态资源只计数不打行）
        if(!path.startsWith('/static/')) {
            console.log(`[meknow-p2p] ${req.method} ${path} → ${res.status} (${Date.now() - t0}ms)`);
        }
        return res;
    } catch(e) {
        console.error('[meknow-p2p] 转发失败:', req.method, url, e.message);
        return new Response('Bad Gateway: 本地服务不可达 (' + e.message + ')', { status: 502 });
    }
});

console.log('[meknow-p2p] 已启动，等待手机节点连接...（配对后无需重启，白名单自动热更新）');

// 优雅退出
for(const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, async () => {
        console.log(`\n[meknow-p2p] 收到 ${sig}，正在关闭...`);
        try { await node.close(); } catch(e) {}
        process.exit(0);
    });
}
