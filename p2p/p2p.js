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
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
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

// ---------- 白名单 ----------
function loadAllow() {
    if(!existsSync(CONFIG_FILE)) return { allowedPeers: [] };
    try {
        return JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
    } catch(e) {
        console.error('[meknow-p2p] allow.json 解析失败:', e.message);
        process.exit(1);
    }
}

// 环境变量追加白名单（逗号分隔），便于临时授权
const envPeers = (process.env.P2P_ALLOW || '')
    .split(',').map(s => s.trim()).filter(Boolean);

const allow = loadAllow();
const allowedPeers = new Set([...(allow.allowedPeers || []), ...envPeers]);

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

// ---------- 启动 ----------
console.log(`[meknow-p2p] 代理目标: ${TARGET_BASE}`);

const node = await createNode({ key: keyBytes });
console.log('[meknow-p2p] 本节点 ID:', node.publicKey.toString());

if(allowedPeers.size === 0) {
    console.log('[meknow-p2p] ⚠ 白名单为空：所有节点将被拒绝。');
    console.log('[meknow-p2p]   运行 node pair.js --add <手机节点ID> 完成配对。');
} else {
    console.log('[meknow-p2p] 白名单节点 (' + allowedPeers.size + '):', [...allowedPeers].join(', '));
}

try {
    const di = node.discoveryInfo();
    if(di?.relayUrl) console.log('[meknow-p2p] 中继:', di.relayUrl);
    if(di?.directAddress) console.log('[meknow-p2p] 直连地址:', di.directAddress);
} catch(e) { /* 旧版本无 discoveryInfo，忽略 */ }

await node.serve({}, async (req) => {
    // ---- 第一层：Peer-Id 白名单 ----
    const peerId = req.headers.get('Peer-Id');
    if(!peerId || !allowedPeers.has(peerId)) {
        console.warn(`[meknow-p2p] 拒绝来自 ${peerId || '未知节点'} 的 ${req.method} ${req.url}`);
        return new Response('Forbidden', { status: 403 });
    }

    // ---- 第二层：转发到本地 Meknow（登录认证由 Meknow 自身处理）----
    // req.url 是完整 URL（httpi://<peer-id>/path?query），提取 path+query 拼到本地目标
    let pathQuery;
    try {
        const u = new URL(req.url);
        pathQuery = u.pathname + u.search;
    } catch(e) {
        // 非 URL 形态（版本差异兜底），当作裸路径用
        pathQuery = req.url;
    }
    const url = TARGET_BASE + pathQuery;

    try {
        const res = await fetch(url, {
            method: req.method,
            headers: filterHeaders(req.headers),
            body: ['GET', 'HEAD'].includes(req.method) ? undefined : req.body,
            redirect: 'manual'
        });
        return res;
    } catch(e) {
        console.error('[meknow-p2p] 转发失败:', req.method, url, e.message);
        return new Response('Bad Gateway: 本地服务不可达 (' + e.message + ')', { status: 502 });
    }
});

console.log('[meknow-p2p] 已启动，等待手机节点连接...');

// 优雅退出
for(const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, async () => {
        console.log(`\n[meknow-p2p] 收到 ${sig}，正在关闭...`);
        try { await node.close(); } catch(e) {}
        process.exit(0);
    });
}
