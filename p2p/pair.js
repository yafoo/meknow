/**
 * 配对工具 —— 管理白名单（手机节点 ID）
 *
 * 用法：
 *   node pair.js                       # 查看本节点 ID 与当前白名单
 *   node pair.js --add <手机节点ID>     # 添加手机节点
 *   node pair.js --remove <手机节点ID>  # 移除手机节点
 *   node pair.js --reset                # 清空白名单
 *
 * 流程：
 *   1. 电脑: node p2p.js 启动，控制台显示本节点 ID
 *   2. 手机: App 内填入本节点 ID，App 显示自己的节点 ID
 *   3. 电脑: node pair.js --add <手机节点ID> 完成配对
 */
import pkg from '@momics/iroh-http-node';
import native from '@momics/iroh-http-node/index.js';
const { SecretKey } = pkg;
const { generateSecretKey } = native;
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = resolve(__dirname, 'allow.json');
const KEY_FILE = resolve(__dirname, 'data', 'p2p-key.bin');

function loadAllow() {
    if(!existsSync(CONFIG_FILE)) return { allowedPeers: [] };
    try {
        return JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
    } catch(e) {
        console.error('allow.json 解析失败:', e.message);
        process.exit(1);
    }
}

function saveAllow(cfg) {
    writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
}

// ---------- 节点 ID 编码归一 ----------
// iroh 节点 ID（32 字节 Ed25519 公钥）有两种常见编码：
//   - base32（52 字符，iroh 网络传输 / Peer-Id 注入用的形态）← 白名单标准形态
//   - hex（64 字符，iroh-ffi Kotlin 绑定 EndpointId.toString() 返回的形态，
//     即 Android App 界面上显示的 ID）
// 配对时用户可能粘贴任意一种 —— 统一转成 base32 存储，p2p.js 校验时双向匹配。
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

/** 归一化节点 ID：hex(64) → base32；base32/其他 → 原样小写 */
function normalizeNodeId(raw) {
    const id = (raw || '').trim().toLowerCase();
    if(/^[0-9a-f]{64}$/.test(id)) {
        const b32 = hexToBase32(id);
        console.log(`  （识别为 hex 编码，已转为 base32: ${b32}）`);
        return b32;
    }
    return id;
}

// ---------- 白名单操作 ----------
const args = process.argv.slice(2);
const cmd = args[0] || 'show';

const allow = loadAllow();
const peers = new Set(allow.allowedPeers || []);

if(cmd === '--add') {
    const raw = (args[1] || '').trim();
    if(!raw) { console.error('用法: node pair.js --add <手机节点ID>'); process.exit(1); }
    const id = normalizeNodeId(raw);
    peers.add(id);
    saveAllow({ allowedPeers: [...peers] });
    console.log(`✓ 已添加手机节点: ${id}`);
    console.log(`  当前白名单 ${peers.size} 个节点`);
} else if(cmd === '--remove') {
    const raw = (args[1] || '').trim();
    if(!raw) { console.error('用法: node pair.js --remove <手机节点ID>'); process.exit(1); }
    const id = normalizeNodeId(raw);
    if(peers.delete(id)) {
        saveAllow({ allowedPeers: [...peers] });
        console.log(`✓ 已移除节点: ${id}`);
    } else {
        console.log(`该节点不在白名单中: ${id}`);
    }
} else if(cmd === '--reset') {
    saveAllow({ allowedPeers: [] });
    console.log('✓ 白名单已清空');
} else {
    console.log(`白名单节点 (${peers.size}):`);
    [...peers].forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
}

// ---------- 展示本节点 ID（与 p2p.js 同一密钥；纯密钥推导，不起 QUIC 节点） ----------
mkdirSync(dirname(KEY_FILE), { recursive: true });
let keyBytes;
if(existsSync(KEY_FILE)) {
    keyBytes = new Uint8Array(readFileSync(KEY_FILE));
    if(keyBytes.length !== 32) keyBytes = null;
}
const needNew = !keyBytes;
if(!keyBytes) {
    keyBytes = generateSecretKey();
    writeFileSync(KEY_FILE, Buffer.from(keyBytes));
}

const sk = SecretKey.fromBytes(keyBytes);
const pk = await sk.derivePublicKey();
console.log('\n本节点 ID:', pk.toString());
if(needNew) console.log('(首次生成，已存入 data/p2p-key.bin — 节点 ID 固定不变)');
console.log('把这个 ID 填到手机 App 的「服务器节点 ID」里；手机节点 ID 用 --add 登记即可。');
console.log('（p2p.js 运行中改动白名单会自动热更新，无需重启）');
