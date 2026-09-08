/**
 * 端到端测试：启动 p2p 适配层（子进程），从另一节点走 QUIC fetch 打 Meknow。
 * 验证：白名单放行、HTTP 转发、HTML 返回。
 *
 * 客户端密钥持久化在 data/test-client-key.bin（节点 ID 稳定），
 * 首次跑完需 node pair.js --add <client ID> 配对，之后可反复验证。
 */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pkg from '@momics/iroh-http-node';
import native from '@momics/iroh-http-node/index.js';

const { createNode } = pkg;
const { generateSecretKey } = native;

const __dirname = dirname(fileURLToPath(import.meta.url));
const KEY_FILE = resolve(__dirname, 'data', 'test-client-key.bin');

mkdirSync(dirname(KEY_FILE), { recursive: true });
let clientKey;
if(existsSync(KEY_FILE)) {
    clientKey = new Uint8Array(readFileSync(KEY_FILE));
    if(clientKey.length !== 32) clientKey = null;
}
if(!clientKey) {
    clientKey = generateSecretKey();
    writeFileSync(KEY_FILE, Buffer.from(clientKey));
}

// 1. 启动 p2p 适配层
const child = spawn(process.execPath, ['p2p.js'], {
    cwd: __dirname,
    stdio: ['ignore', 'pipe', 'pipe']
});

let nodeId = '';
child.stdout.on('data', (d) => {
    const text = d.toString();
    process.stdout.write('[p2p] ' + text);
    const m = text.match(/ID:\s*([a-z0-9]+)/);
    if(m) nodeId = m[1];
});

await new Promise((resolve) => {
    const timer = setInterval(() => {
        if(nodeId) { clearInterval(timer); resolve(); }
    }, 200);
    setTimeout(() => { clearInterval(timer); resolve(); }, 10000);
});

if(!nodeId) {
    console.error('✗ 未拿到 p2p 节点 ID');
    child.kill();
    process.exit(1);
}

// 2. 客户端节点 fetch
const client = await createNode({ key: clientKey });
console.log('\n[client] 节点 ID:', client.publicKey.toString());

try {
    const res = await client.fetch(`httpi://${nodeId}/admin/login`);
    console.log(`[client] /admin/login → ${res.status}`);
    const text = await res.text();
    console.log('[client] 响应长度:', text.length, '| 含 <html:', text.includes('<html'));
    if(res.status === 200 && text.includes('<html')) {
        console.log('\n✓ 端到端转发验证通过');
    } else if(res.status === 403) {
        console.log('\n✗ 403：把上面的 [client] 节点 ID 加白名单后重跑:');
        console.log('  node pair.js --add ' + client.publicKey.toString());
    } else {
        console.log('\n? 非预期状态:', res.status);
    }
} catch(e) {
    console.error('[client] fetch 失败:', e.message);
}

await client.close();
child.kill('SIGTERM');
process.exit(0);
