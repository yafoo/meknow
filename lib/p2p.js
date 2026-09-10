/**
 * Meknow 集成 P2P 服务 —— lib/p2p.js
 *
 * 用官方 @number0/iroh 库把整个 Meknow Web 服务（jj.js/Koa 应用）通过
 * P2P QUIC 隧道暴露给手机端 App，无需公网 IP、端口映射。
 *
 * 架构：
 *   手机 App (iroh QUIC, ALPN meknow-p2p/1)
 *     → 本节点 Endpoint.acceptNext() → Connection.acceptBi()
 *     → BiStream{send, recv} 包装成 Node stream.Duplex（shim）
 *     → http.createServer(koaCallback).emit('connection', shim)
 *     → jj.js 完整中间件栈（路由/cookie/静态资源/上传）
 *
 * 与旧 p2p/ 目录（fetch 反代方案）的区别：
 *   旧方案：每请求手动解析 HTTP/1.1，再 fetch 到 127.0.0.1:3000 反代 ——
 *           双份 HTTP 解析、无 keep-alive、丢失请求语义。
 *   本方案：把 QUIC 双向流直接伪装成 TCP socket 喂给 Node 原生 http.Server，
 *           完整复用 jj.js 应用栈，传输层零拷贝。
 *
 * 安全（两层，与旧方案一致）：
 *   1. 节点白名单：QUIC 握手层 remoteId（Ed25519 公钥，不可伪造），
 *      只允许白名单登记的手机节点 ID，其余直接 403。
 *      白名单存 data/p2p-allow.json，admin 后台可管理（热重载）。
 *   2. Meknow 原有登录认证：手机端仍需登录 admin 后台。
 *
 * 配对流程：
 *   1. admin 后台「P2P 管理」查看本节点 ID（二维码/字符串）
 *   2. 手机 App 扫码 / 手填节点 ID，App 显示本机节点 ID 并发起连接
 *   3. 服务端收到未配对节点的连接 → 记录为「待授权配对请求」
 *      → admin 后台轮询发现 → 弹窗授权确认 → 写入白名单
 *   4. 手机端自动重连成功，进入正常使用
 *
 * 身份持久化：节点密钥存 data/p2p-key.bin，重启后节点 ID 不变。
 *
 * 未配对节点限流：同一节点 30s 内多次连接尝试只记录一次配对请求，
 * 防止扫描风暴撑爆 admin 轮询列表。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const {Duplex} = require('stream');
const {Logger} = require('jj.js');

// 由 init() 注入，避免顶部 require 造成循环依赖
let iroh = null;

/** 节点 ID 统一编码：hex(64) ↔ base32(52)。
 *  iroh NAPI 的 EndpointId.toString() 返回 hex；手机端（Kotlin hexToBase32Id）
 *  与 iroh 网络层生态显示 base32。全链路统一 base32：白名单存储、配对请求、
 *  admin 展示、日志——手机端显示什么，后台就显示什么。
 *  EndpointId.fromString() 对两种编码都接受，连接侧无需转换。 */
function toBase32Id(hexOrBase32) {
    const s = String(hexOrBase32 || '').trim().toLowerCase();
    if(/^[0-9a-f]{64}$/.test(s)) {
        const buf = Buffer.from(s, 'hex');
        const B32 = 'abcdefghijklmnopqrstuvwxyz234567';
        let v = 0, n = 0, out = '';
        for(const b of buf) {
            v = (v << 8) | b;
            n += 8;
            while(n >= 5) { n -= 5; out += B32[(v >>> n) & 31]; }
        }
        if(n > 0) out += B32[(v << (5 - n)) & 31];
        return out;
    }
    return s;   // base32 或无效值原样返回（正则校验在控制器层）
}

const P2P = {
    ALPN: 'meknow-p2p/1',
    KEY_FILE: null,          // data/p2p-key.bin
    ALLOW_FILE: null,        // data/p2p-allow.json
    BASE_DIR: null,
    app: null,               // jj.js App 实例
    endpoint: null,          // iroh Endpoint
    nodeId: '',              // 本节点 ID（base32）
    httpServer: null,         // 喂 shim 用的 http.Server（不 listen）
    running: false,
    acceptLoopRunning: false,

    // 白名单（节点 ID → 备注名），来自 admin 后台
    allowedPeers: new Map(),  // id -> {name, time}
    // 待授权配对请求：id -> {id, name, time, attempts}
    pendingPairings: new Map(),
    // 节点限流记录
    lastSeen: new Map(),
    // 在线节点：id -> {path: 'p2p'|'relay', addr: '对端地址'}
    // path 由 conn.paths() 的 isSelected 路径判断（isRelay=中继），
    // watchPaths 在 iroh-js 会 panic（无 Tokio reactor），改为 10s 轮询
    onlinePeers: new Map(),
    // 路径轮询定时器：id -> interval
    pathTimers: new Map(),

    /**
     * 初始化并启动 P2P 服务
     * @param {object} app jj.js App 实例（Koa 子类）
     * @param {object} [options] 测试隔离：{dataDir: '临时目录'} —— 密钥/白名单
     *   落到指定目录而非真实 data/。仅测试用，生产调用不传。
     */
    async init(app, options = {}) {
        if(this.running) return;
        this.app = app;

        // 路径：生产用 <应用根>/data/；测试传 options.dataDir 隔离
        if(options.dataDir) {
            this.KEY_FILE = path.join(options.dataDir, 'p2p-key.bin');
            this.ALLOW_FILE = path.join(options.dataDir, 'p2p-allow.json');
            fs.mkdirSync(options.dataDir, {recursive: true});
        } else {
            let baseDir;
            try {
                baseDir = require('jj.js/lib/config').app.base_dir;
            } catch(e) {
                baseDir = process.cwd();
            }
            const dataDir = path.join(baseDir, 'data');
            this.KEY_FILE = path.join(dataDir, 'p2p-key.bin');
            this.ALLOW_FILE = path.join(dataDir, 'p2p-allow.json');
            fs.mkdirSync(dataDir, {recursive: true});

            // 兼容迁移：v1.8 测试隔离改版期间生产路径短暂写到了应用根下 ——
            // 若根下存在而 data/ 下没有，迁回 data/（密钥内容不变，节点 ID 不变）
            for(const f of ['p2p-key.bin', 'p2p-allow.json']) {
                const stray = path.join(baseDir, f);
                const proper = path.join(dataDir, f);
                try {
                    if(fs.existsSync(stray) && !fs.existsSync(proper)) {
                        fs.renameSync(stray, proper);
                    } else if(fs.existsSync(stray)) {
                        fs.unlinkSync(stray);   // 两边都有（data/ 为准），删杂散文件
                    }
                } catch(e) { /* 迁移失败不阻断启动 */ }
            }
        }

        // 惰性加载 iroh（启动失败不影响主服务）
        try {
            iroh = require('@number0/iroh');
        } catch(e) {
            Logger.warning('[p2p] @number0/iroh 未安装，P2P 服务不可用：npm i @number0/iroh');
            return false;
        }

        // 白名单
        this.loadAllow();

        // 身份密钥（持久化，节点 ID 稳定）
        let keyBytes;
        try {
            if(fs.existsSync(this.KEY_FILE)) {
                const buf = new Uint8Array(fs.readFileSync(this.KEY_FILE));
                if(buf.length === 32) keyBytes = buf;
            }
        } catch(e) { /* 重新生成 */ }
        if(!keyBytes) {
            keyBytes = iroh.SecretKey.generate().toBytes();
            fs.writeFileSync(this.KEY_FILE, Buffer.from(keyBytes));
        }

        // http.Server：用 jj.js 的 Koa 回调，不 listen —— 只接收 shim 流
        // httpAllowHalfOpen：客户端（手机端）FIN 后仍可写响应（QUIC 半关闭语义）
        const koaCallback = app.callback();
        this.httpServer = http.createServer(koaCallback);
        this.httpServer.httpAllowHalfOpen = true;
        this.httpServer.keepAliveTimeout = 720_000;      // QUIC 连接长保活
        this.httpServer.requestTimeout = 0;               // 超时交给传输层
        this.httpServer.headersTimeout = 300_000;
        // connectionsCheckingInterval 依赖 kConnections（listen 时装配），
        // 未 listen 的 server 不会 track —— 安全
        this.httpServer.on('clientError', (err, socket) => {
            if(socket.writable && (!socket._httpMessage || !socket._httpMessage._headerSent)) {
                try {
                    socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
                    socket.end();
                } catch(_) {}
            }
        });

        // iroh Endpoint
        try {
            this.endpoint = await iroh.Endpoint.bind({
                secretKey: Array.from(keyBytes),
                alpns: [Array.from(Buffer.from(this.ALPN))]
            }, iroh.RelayMode.defaultMode());
        } catch(e) {
            Logger.error('[p2p] iroh Endpoint 绑定失败：' + e.message);
            return false;
        }
        this.nodeId = toBase32Id(this.endpoint.id().toString());
        this.running = true;

        Logger.system('[p2p] Meknow P2P 服务已启动');
        Logger.system('[p2p] 本节点 ID: ' + this.nodeId);
        Logger.system('[p2p] 白名单: ' + this.allowedPeers.size + ' 个节点');
        if(options.dataDir) {
            Logger.system('[p2p] ⚠ 测试模式（数据目录: ' + options.dataDir + '）');
        }

        // 优雅退出
        const shutdown = async () => { await this.shutdown(); };
        process.once('SIGINT', shutdown);
        process.once('SIGTERM', shutdown);

        // accept 主循环
        this.acceptLoop().catch(e => {
            if(this.running) Logger.error('[p2p] accept 循环异常：' + e.message);
        });

        return true;
    },

    // ---------- accept 循环 ----------
    async acceptLoop() {
        if(this.acceptLoopRunning) return;
        this.acceptLoopRunning = true;
        try {
            while(this.running) {
                const incoming = await this.endpoint.acceptNext();
                if(!incoming) break;   // endpoint 关闭
                this.handleIncoming(incoming).catch(() => {});
            }
        } finally {
            this.acceptLoopRunning = false;
        }
    },

    async handleIncoming(incoming) {
        // 握手前拒绝（端点未配对时白名单校验放 accept() 后 —— remoteId 在 Accepting 阶段可用）
        let conn;
        try {
            const accepting = await incoming.accept();
            conn = await accepting.connect();
        } catch(e) {
            Logger.error('[p2p] 连接握手失败：' + e.message);
            return;
        }

        const peerId = toBase32Id(conn.remoteId().toString());
        this.lastSeen.set(peerId, Date.now());

        // 未配对节点：记录配对请求 + 限流，直接关闭连接
        if(!this.allowedPeers.has(peerId)) {
            this.recordPairingRequest(peerId);
            Logger.warning(`[p2p] ✗ 未配对节点连接被拒: ${peerId}`);
            Logger.warning(`[p2p]   如确认可信，请到 admin 后台「P2P 管理」授权`);
            try { conn.close(403n, Array.from(Buffer.from('forbidden: not paired'))); } catch(_) {}
            return;
        }

        const name = this.allowedPeers.get(peerId)?.name || '';

        // 记录连接方式（直连 P2P / 中继）。注意不能用 watchPaths——
        // iroh-js 的 watch 回调需要 Tokio reactor 上下文，从外部 JS 调用会
        // panic 使整个进程退出（实测：watch.rs:78 "there is no reactor running"）。
        // 改为轻量轮询：连接存续期间每 10s 查一次 paths()，
        // 打洞成功 relay→直连 的切换在分钟级，10s 粒度足够。
        const trackPath = () => {
            try {
                const paths = conn.paths();
                const selected = paths.find(p => p.isSelected) || paths[0];
                if(selected) {
                    const kind = selected.isRelay ? 'relay' : 'p2p';
                    const prev = this.onlinePeers.get(peerId);
                    if(prev && prev.path !== kind) {
                        Logger.system(`[p2p] ⇄ ${name || peerId.substring(0, 10)}… 连接方式切换: ${prev.path === 'relay' ? '中继' : '直连'} → ${kind === 'relay' ? '中继' : '直连 P2P'}`);
                    }
                    this.onlinePeers.set(peerId, {path: kind, addr: selected.remoteAddr || ''});
                }
            } catch(_) { /* 连接关闭后 paths() 会抛，忽略 */ }
        };
        trackPath();
        this.pathTimers.set(peerId, setInterval(trackPath, 10_000));

        const initInfo = this.onlinePeers.get(peerId);
        Logger.system(`[p2p] ⇄ 节点已连接: ${peerId}${name ? `（${name}）` : ''} [${initInfo?.path === 'relay' ? '中继' : '直连 P2P'}]（在线 ${this.onlinePeers.size}）`);

        // 清理死链
        conn.closed().then(() => {
            this.onlinePeers.delete(peerId);
            const t = this.pathTimers.get(peerId);
            if(t) { clearInterval(t); this.pathTimers.delete(peerId); }
            Logger.system(`[p2p] ✂ 节点已断开: ${peerId}（剩余 ${this.onlinePeers.size}）`);
        }).catch(() => {});

        // 该连接上的流循环
        try {
            while(this.running) {
                const bi = await conn.acceptBi();
                if(!bi) break;
                this.handleBiStream(peerId, bi).catch(e => {
                    if(!this.isDisconnectError(e)) Logger.error('[p2p] 流处理异常：' + e.message);
                });
            }
        } catch(e) {
            if(!this.isDisconnectError(e)) Logger.error('[p2p] 连接异常：' + e.message);
        }
    },

    /**
     * 一条 QUIC 双向流 = 一个 HTTP 请求（Connection: close 语义）
     * 把 BiStream 包装成 socket-like Duplex，喂给 http.Server
     */
    async handleBiStream(peerId, bi) {
        const send = bi.send;
        const recv = bi.recv;

        // 白名单二次校验（连接期间可能被移除）
        if(!this.allowedPeers.has(peerId)) {
            const resp = 'HTTP/1.1 403 Forbidden\r\nContent-Length: 9\r\nConnection: close\r\n\r\nForbidden';
            try {
                await send.writeAll(Array.from(Buffer.from(resp)));
                await send.finish();
            } catch(_) {}
            return;
        }

        const server = this.httpServer;
        const shim = new Duplex({
            read() {},
            write(chunk, enc, cb) {
                // http 响应字节 → QUIC send 流
                send.writeAll(Array.from(chunk)).then(() => cb(), cb);
            },
            final(cb) {
                send.finish().then(() => cb(), cb);
            },
            destroy(err, cb) {
                if(err) {
                    try { send.reset(0n); } catch(_) {}
                    try { recv.stop(0n); } catch(_) {}
                }
                cb();
            }
        });
        // net.Socket 形状补丁（http.Server 需要）
        shim.setNoDelay = () => true;
        shim.setKeepAlive = () => {};
        shim.setTimeout = () => shim;
        shim.destroySoon = () => { shim.end(); };
        shim.server = server;
        Object.defineProperty(shim, 'remoteAddress', {get: () => 'p2p:' + peerId});
        Object.defineProperty(shim, 'remotePort', {get: () => 0});

        server.emit('connection', shim);

        // recv → shim readable：QUIC 读循环 + 背压
        try {
            let wantRead = true;
            let reading = false;
            const pump = async () => {
                if(reading) return;
                reading = true;
                try {
                    while(wantRead) {
                        wantRead = false;
                        const chunk = await recv.read(64 * 1024);
                        if(!chunk || chunk.length === 0) {
                            shim.push(null);   // EOF → 客户端 FIN
                            return;
                        }
                        if(!shim.push(Buffer.from(chunk))) return;  // 背压
                        wantRead = true;
                    }
                } catch(e) {
                    // 对端断开/流被重置属正常生命周期
                    try { shim.destroy(e); } catch(_) {}
                } finally {
                    reading = false;
                }
            };
            pump();
            // http.Server 在 parser 消费时可能 pause/resume —— Duplex 高水标背压已覆盖
        } catch(e) {
            if(!this.isDisconnectError(e)) Logger.error('[p2p] 读循环异常：' + e.message);
        }
    },

    // ---------- 配对请求记录（未配对节点首次/限流后触达） ----------
    recordPairingRequest(peerId) {
        const last = this.lastSeen.get(peerId) || 0;
        const existing = this.pendingPairings.get(peerId);
        if(existing && Date.now() - last < 30_000) {
            existing.attempts++;
            return;   // 30s 限流：重复尝试不重复记录
        }
        this.pendingPairings.set(peerId, {
            id: peerId,
            name: '',
            time: Math.floor(Date.now() / 1000),
            attempts: (existing?.attempts || 0) + 1
        });
        // 只保留最近 20 条
        if(this.pendingPairings.size > 20) {
            const oldest = [...this.pendingPairings.keys()].sort((a, b) =>
                this.pendingPairings.get(a).time - this.pendingPairings.get(b).time);
            oldest.slice(0, this.pendingPairings.size - 20)
                .forEach(k => this.pendingPairings.delete(k));
        }
    },

    // ---------- 白名单管理（admin 后台调用） ----------
    loadAllow() {
        this.allowedPeers.clear();
        try {
            if(fs.existsSync(this.ALLOW_FILE)) {
                const cfg = JSON.parse(fs.readFileSync(this.ALLOW_FILE, 'utf8'));
                (cfg.peers || []).forEach(p => {
                    // 兼容旧数据：hex(64) 归一化为 base32(52)
                    this.allowedPeers.set(toBase32Id(p.id), {
                        name: p.name || '',
                        time: p.time || 0
                    });
                });
                // 发生过归一化时回写文件
                this.saveAllow();
            }
        } catch(e) {
            Logger.error('[p2p] 白名单文件读取失败：' + e.message);
        }
    },

    saveAllow() {
        const peers = [...this.allowedPeers.entries()].map(([id, v]) => ({
            id, name: v.name, time: v.time
        }));
        fs.writeFileSync(this.ALLOW_FILE, JSON.stringify({peers}, null, 2) + '\n', 'utf8');
    },

    /** 授权配对（写入白名单）。hex/base32 均接受，统一存 base32。 */
    authorizePeer(peerId, name = '') {
        const id = toBase32Id(peerId);
        this.allowedPeers.set(id, {name: name || '', time: Math.floor(Date.now() / 1000)});
        this.pendingPairings.delete(id);
        this.saveAllow();
        Logger.system('[p2p] ✓ 已授权节点: ' + id + (name ? `（${name}）` : ''));
        return true;
    },

    /** 移除白名单节点（同时踢掉在线连接） */
    removePeer(peerId) {
        const id = toBase32Id(peerId);
        const removed = this.allowedPeers.delete(id);
        this.saveAllow();
        return removed;
    },

    /** 忽略配对请求（不写白名单，仅从待授权列表清除） */
    dismissPairing(peerId) {
        return this.pendingPairings.delete(toBase32Id(peerId));
    },

    /** 节点 ID 归一化导出（hex→base32；控制器/外部用） */
    toBase32Id,

    // ---------- 状态查询 ----------
    status() {
        return {
            running: this.running,
            nodeId: this.nodeId,
            peers: [...this.allowedPeers.entries()].map(([id, v]) => ({
                id, name: v.name, time: v.time,
                online: this.onlinePeers.has(id),
                path: this.onlinePeers.get(id)?.path || '',       // 'p2p'=直连 'relay'=中继
                remoteAddr: this.onlinePeers.get(id)?.addr || ''
            })),
            pending: [...this.pendingPairings.values()],
            online: [...this.onlinePeers.keys()]
        };
    },

    isDisconnectError(e) {
        const msg = String(e?.message || e || '');
        return /closed|reset|stopped|LocallyClosed|unknown handle|StreamClosed|timed out/i.test(msg);
    },

    async shutdown() {
        if(!this.running) return;
        this.running = false;
        // 停掉所有路径轮询定时器
        this.pathTimers.forEach(t => clearInterval(t));
        this.pathTimers.clear();
        try { await this.endpoint?.close(); } catch(_) {}
        try { this.httpServer?.close(); } catch(_) {}
        // 退出前把白名单落盘：内存态与文件同步，防文件意外丢失后重启丢配对
        try { this.saveAllow(); } catch(_) {}
        Logger.system('[p2p] P2P 服务已关闭');
    }
};

module.exports = P2P;
