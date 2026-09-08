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
const { createNode } = pkg;
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

// ---------- 白名单操作 ----------
const args = process.argv.slice(2);
const cmd = args[0] || 'show';

const allow = loadAllow();
const peers = new Set(allow.allowedPeers || []);

if(cmd === '--add') {
    const id = (args[1] || '').trim().toLowerCase();
    if(!id) { console.error('用法: node pair.js --add <手机节点ID>'); process.exit(1); }
    peers.add(id);
    saveAllow({ allowedPeers: [...peers] });
    console.log(`✓ 已添加手机节点: ${id}`);
    console.log(`  当前白名单 ${peers.size} 个节点`);
} else if(cmd === '--remove') {
    const id = (args[1] || '').trim().toLowerCase();
    if(!id) { console.error('用法: node pair.js --remove <手机节点ID>'); process.exit(1); }
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

// ---------- 展示本节点 ID（与 p2p.js 同一密钥） ----------
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

const node = await createNode({ key: keyBytes });
console.log('\n本节点 ID:', node.publicKey.toString());
if(needNew) console.log('(首次生成，已存入 data/p2p-key.bin — 节点 ID 固定不变)');
console.log('把这个 ID 填到手机 App 的「服务器节点 ID」里；手机节点 ID 用 --add 登记即可。');
await node.close();
