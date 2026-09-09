/**
 * 端到端测试（duplex 流模式，与 Android IrohProxy 完全一致的路径）：
 *   dial 服务器节点 → 双向流 → 写手写 HTTP/1.1 → 读响应。
 *
 * 客户端密钥持久化 data/test-client-key.bin（节点 ID 稳定），
 * 首次跑 403 后按提示 pair.js --add 配对，之后可反复验证。
 */
import pkg from '@momics/iroh-http-node';
const { createNode } = pkg;
import native from '@momics/iroh-http-node/index.js';
const { generateSecretKey } = native;
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KEY_FILE = resolve(__dirname, 'data', 'test-client-key.bin');
const ALPN = 'iroh-http/2-duplex';

mkdirSync(dirname(KEY_FILE), { recursive: true });
let clientKey = existsSync(KEY_FILE) ? new Uint8Array(readFileSync(KEY_FILE)) : null;
if(!clientKey || clientKey.length !== 32) {
    clientKey = generateSecretKey();
    writeFileSync(KEY_FILE, Buffer.from(clientKey));
}

// 从 allow.json 读服务器 ID（自连测试），或命令行指定
const args = process.argv.slice(2);
let serverId = args[0];
if(!serverId) {
    const allow = JSON.parse(readFileSync(resolve(__dirname, 'allow.json'), 'utf8'));
    serverId = allow.allowedPeers[0];   // 默认第一个（p2p 自身）
}

const node = await createNode({ key: clientKey });
const myId = node.publicKey.toString();
console.log('[client] 节点 ID:', myId);

const session = await node.dial(serverId);
console.log('[client] 已 dial（duplex）');

// 与 Android forwardOverQuic 相同的请求字节
const request =
    'GET /admin/login HTTP/1.1\r\n' +
    'Host: 127.0.0.1:8080\r\n' +
    'Connection: close\r\n' +
    'User-Agent: MeknowP2P-e2e\r\n' +
    'Accept: text/html\r\n' +
    '\r\n';

const stream = await session.createBidirectionalStream();
const writer = stream.writable.getWriter();
await writer.write(new TextEncoder().encode(request));
await writer.close();
console.log('[client] 已写请求', request.length, 'B');

const reader = stream.readable.getReader();
const chunks = [];
let total = 0;
try {
    while(true) {
        const { done, value } = await reader.read();
        if(done) break;
        total += value.length;
        chunks.push(Buffer.from(value));
    }
} catch(e) {
    console.error('[client] 读失败:', e.message);
}

console.log('[client] 响应', total, '字节');
if(total > 0) {
    const text = Buffer.concat(chunks).toString('utf8');
    const statusLine = text.split('\r\n')[0];
    console.log('[client] 状态行:', statusLine);
    console.log('[client] 含 <html>:', text.includes('<html'));
    if(statusLine.includes('403')) {
        console.log('\n✗ 403：把上面的 [client] 节点 ID 配对后重跑：');
        console.log('  node pair.js --add ' + myId);
    } else if(statusLine.includes('200')) {
        console.log('\n✓ 端到端 duplex 转发验证通过（与 Android 同路径）');
    }
} else {
    console.log('\n✗ 空响应');
}

await node.close();
process.exit(0);
