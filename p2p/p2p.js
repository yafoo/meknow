/**
 * Meknow P2P 适配层 —— 电脑端
 *
 * 把本地 Meknow Web 服务（默认 127.0.0.1:3000）通过 iroh QUIC 暴露到 P2P 网络。
 * 手机端 App（Kotlin + iroh-ffi）dial 到本节点（ALPN: iroh-http/2-duplex），
 * 在 QUIC 双向流上发送 HTTP/1.1 明文字节；本层解析后反代到本地 Meknow。
 *
 * 协议说明（踩坑记录）：
 *   @momics/iroh-http 有两条互不相通的路径 ——
 *   · node.serve()/node.fetch()：ALPN "iroh-http/2"，hyper 封装的 HTTP/1.1，
 *     请求由 Rust 端构造并注入 Peer-Id 头；外部手写 HTTP/1.1 字节发不进去
 *     （Android 端无 fetch 绑定，曾在 /2 上手写请求 → 服务端收不到）。
 *   · node.dial()/node.incoming()：ALPN "iroh-http/2-duplex"，裸 QUIC 双向流，
 *     字节完全由两端自定义 —— 本项目用这层跑明文 HTTP/1.1。
 *
 * 安全面（两层）：
 *   1. 节点白名单：QUIC 握手层的 remoteId（Ed25519 公钥，不可伪造），
 *      只允许 allow.json 里登记的手机节点 ID，其余直接回 403 关流。
 *   2. 原有 admin 登录认证：手机端仍需登录 admin 后台。
 *
 * 白名单热重载：pair.js --add/--remove 修改 allow.json 后立即生效，无需重启本进程
 * （fs.watchFile 监听 + 每条流 mtime 兜底检查）。
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
const MAX_HEADER_BYTES = 1 << 20;      // 请求头上限 1MB
const MAX_BODY_BYTES = 64 << 20;       // 请求体上限 64MB

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
        if(mtime === allowMtime) return;
        allowMtime = mtime;
        const cfg = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
        const fromFile = (cfg.allowedPeers || []).map(s => /^[0-9a-f]{64}$/.test(s.toLowerCase())
            ? hexToBase32(s.toLowerCase()) : s.toLowerCase());
        const before = allowedPeers.size;
        allowedPeers = new Set([...fromFile, ...envPeers]);
        if(verbose || before !== allowedPeers.size) {
            console.log(`[meknow-p2p] 白名单更新: ${allowedPeers.size} 个节点`);
            [...allowedPeers].forEach(p => console.log(`  · ${p}`));
        }
    } catch(e) {
        console.error('[meknow-p2p] allow.json 读取失败，沿用旧名单:', e.message);
    }
}

refreshAllow(true);
watchFile(CONFIG_FILE, { interval: 1000 }, () => refreshAllow(true));

// ---------- HTTP 头处理 ----------
const HOP_HEADERS = new Set([
    'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
    'te', 'trailer', 'transfer-encoding', 'upgrade', 'host',
    'peer-id',
    'accept-encoding'                            // 避免双层压缩
]);

function filterHeaders(headers) {
    const out = {};
    for(const [k, v] of Object.entries(headers)) {
        if(!HOP_HEADERS.has(k.toLowerCase())) out[k] = v;
    }
    return out;
}

// ---------- HTTP/1.1 请求解析（流式） ----------
/**
 * 从流中解析一个完整 HTTP/1.1 请求（头 + Content-Length 定长 body）。
 * 返回 { method, path, headers, body }；对端关闭/超限返回 null。
 */
async function readHttpRequest(reader) {
    const headResult = await readHead(reader);
    if(!headResult) return null;
    const { headBuf, wrappedReader } = headResult;

    const headStr = headBuf.toString('latin1');
    const nl = headStr.indexOf('\r\n');
    if(nl < 0) return null;
    const requestLine = headStr.substring(0, nl);
    const parts = requestLine.split(' ');
    if(parts.length < 2) return null;
    const method = parts[0];
    const path = parts[1];

    const headers = {};
    for(const line of headStr.substring(nl + 2).split('\r\n')) {
        const c = line.indexOf(':');
        if(c > 0) headers[line.substring(0, c).trim().toLowerCase()] = line.substring(c + 1).trim();
    }

    // body（Content-Length 定长；可能部分数据已在读头时缓冲）
    const contentLength = parseInt(headers['content-length'] || '0', 10) || 0;
    if(contentLength > MAX_BODY_BYTES) return null;
    const body = new Uint8Array(contentLength);
    let bodyOff = 0;
    while(bodyOff < contentLength) {
        const { done, value } = await wrappedReader.read();
        if(done) return null;
        const take = Math.min(value.length, contentLength - bodyOff);
        body.set(value.subarray(0, take), bodyOff);
        bodyOff += take;
    }

    return { method, path, headers, body };
}

/** 跨 chunk 读到 \r\n\r\n（返回头块，可能含其后已缓冲的 body 前缀由调用方继续读） */
async function readHead(reader) {
    const chunks = [];
    let len = 0;
    while(true) {
        const { done, value } = await reader.read();
        if(done) return null;
        chunks.push(Buffer.from(value));
        len += value.length;
        if(len > MAX_HEADER_BYTES) return null;
        const joined = Buffer.concat(chunks);
        const idx = joined.indexOf('\r\n\r\n');
        if(idx >= 0) {
            const headWithBodyPrefix = joined.subarray(0, idx + 4);
            const rest = joined.subarray(idx + 4);
            // body 前缀放回流模拟不必要：直接拼进返回值让调用方从头解析，
            // 但 body 定长读取需要把 rest 计入 —— 把 rest 暂存到 reader 包装层
            if(rest.length > 0) {
                // 用一个待处理队列包装后续读取
                const pending = [rest];
                const wrapped = {
                    async read() {
                        if(pending.length > 0) {
                            return { done: false, value: pending.shift() };
                        }
                        return reader.read();
                    }
                };
                return { headBuf: headWithBodyPrefix, wrappedReader: wrapped };
            }
            return { headBuf: headWithBodyPrefix, wrappedReader: reader };
        }
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
} catch(e) { /* 忽略 */ }

// ---------- 主循环：接受 session → 白名单 → 逐流转发 ----------
const onlinePeers = new Set();

console.log('[meknow-p2p] 已启动（duplex 流模式），等待手机节点连接...');

for await (const session of node.incoming()) {
    const peerId = session.remoteId.toString().toLowerCase();
    refreshAllow(false);
    const paired = allowedPeers.has(peerId);
    onlinePeers.add(peerId);
    console.log(`[meknow-p2p] ⇄ 节点已连接: ${peerId}${paired ? '（已配对 ✓）' : '（未配对！流将被 403）'}`);
    console.log(`[meknow-p2p] 当前在线: ${onlinePeers.size} 个节点`);

    handleSession(session, peerId)
        .finally(() => {
            onlinePeers.delete(peerId);
            console.log(`[meknow-p2p] ✂ 节点已断开: ${peerId}（剩余 ${onlinePeers.size} 个）`);
        });
}

// ---------- 每个 session：循环接受双向流，一请求一流一响应 ----------
async function handleSession(session, peerId) {
    const reader = session.incomingBidirectionalStreams.getReader();
    try {
        while(true) {
            const { done, value: stream } = await reader.read();
            if(done) break;
            handleStream(peerId, stream).catch(e => {
                // 对端断开/流被重置属正常生命周期，不打错误
                if(!isDisconnectError(e)) {
                    console.error('[meknow-p2p] 流处理异常:', e.message);
                }
            });
        }
    } catch(e) {
        if(!isDisconnectError(e)) {
            console.error('[meknow-p2p] session 异常:', e.message);
        }
    } finally {
        reader.releaseLock();
        // 对端已断开/流已尽，不主动 close —— Session::closed 的注册表清理由
        // 库在连接结束时自动完成；主动 close 会与它竞态触发 unknown handle
    }
}

/** 对端断开/句柄失效类错误 —— 生命周期事件，不算故障 */
function isDisconnectError(e) {
    const msg = String(e?.message || '');
    return /unknown handle|connection closed|closed by peer|closed/i.test(msg)
        || e?.code === 'CLOSED' || e?.code === 'INVALID_INPUT';
}

// ---------- 一条双向流 = 一个请求（Connection: close 语义） ----------
async function handleStream(peerId, stream) {
    const reader = stream.readable.getReader();
    const writer = stream.writable.getWriter();

    try {
        // ---- 第一层：节点白名单 ----
        refreshAllow(false);
        if(!allowedPeers.has(peerId)) {
            console.warn(`[meknow-p2p] ✗ 403 拒绝 ${peerId} 的流（未配对）`);
            console.warn(`[meknow-p2p]   如确认该手机可信，配对命令: node pair.js --add ${peerId}`);
            await writer.write(encode(
                'HTTP/1.1 403 Forbidden\r\nContent-Length: 9\r\nConnection: close\r\n\r\nForbidden'
            ));
            await writer.close();
            return;
        }

        // ---- 解析请求 ----
        const parsed = await readHttpRequest(reader);
        if(!parsed) {
            await writer.write(encode(
                'HTTP/1.1 400 Bad Request\r\nContent-Length: 11\r\nConnection: close\r\n\r\nBad Request'
            ));
            await writer.close();
            return;
        }

        const { method, path, headers, body } = parsed;

        // ---- 转发到本地 Meknow ----
        const url = TARGET_BASE + path;
        const t0 = Date.now();
        let res;
        try {
            res = await fetch(url, {
                method,
                headers: filterHeaders(headers),
                body: (method === 'GET' || method === 'HEAD') ? undefined : body,
                redirect: 'manual'
            });
        } catch(e) {
            console.error('[meknow-p2p] 转发失败:', method, url, e.message);
            await writer.write(encode(
                `HTTP/1.1 502 Bad Gateway\r\nContent-Length: ${Buffer.byteLength(e.message) + 30}\r\nConnection: close\r\n\r\nBad Gateway: 本地服务不可达 (${e.message})`
            ));
            await writer.close();
            return;
        }

        // 响应字节原样写回流
        const resBody = new Uint8Array(await res.arrayBuffer());
        let head = `HTTP/1.1 ${res.status} ${res.statusText || ''}\r\n`;
        for(const [k, v] of res.headers) {
            head += `${k}: ${v}\r\n`;
        }
        head += `Content-Length: ${resBody.length}\r\n`;
        head += 'Connection: close\r\n\r\n';

        await writer.write(encode(head));
        if(resBody.length > 0) await writer.write(resBody);
        await writer.close();

        // 访问日志（静态资源不刷屏）
        if(!path.startsWith('/static/')) {
            console.log(`[meknow-p2p] ${method} ${path} → ${res.status} (${Date.now() - t0}ms, ${(resBody.length / 1024).toFixed(1)}KB)`);
        }
    } catch(e) {
        // 对端断开/流重置是正常生命周期（手机杀 App、WebView 停加载、页面跳转）
        if(!isDisconnectError(e)) {
            console.error('[meknow-p2p] 流错误:', e.message);
        }
        try { await writer.abort?.(e); } catch(_) {}
        try { writer.releaseLock(); } catch(_) {}
    }
}

function encode(s) {
    return new TextEncoder().encode(s);
}

// 优雅退出
for(const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, async () => {
        console.log(`\n[meknow-p2p] 收到 ${sig}，正在关闭...`);
        try { await node.close(); } catch(e) {}
        process.exit(0);
    });
}
