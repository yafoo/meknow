const {App, Logger} = require('jj.js');

// 忽略客户端提前断开连接的错误：
//   - ERR_STREAM_PREMATURE_CLOSE：手机端 QUIC 流半关闭时 http.Server 的正常反应
//   - P2P 传输层 NAPI 错误（ClosedStream/GenericFailure 等）：手机断网/切网时
//     iroh 流关闭的连锁反应，lib/p2p.js 的 shim 已本地消化，此处兜底防逃逸。
//     不匹配的未知错误仍向上抛（保持对真 bug 的可见性）。
process.on('uncaughtException', (err) => {
    const known = err.code === 'ERR_STREAM_PREMATURE_CLOSE'
        || /ClosedStream|StreamClosed|LocallyClosed|stopped|closed stream|unknown handle/i
            .test(String(err?.message || err));
    if(known) {
        Logger.warning('[p2p] 忽略传输层断开错误: ' + (err.message || err));
        return;
    }
    throw err;
});

// server
const port = 3107;
const app = new App();
// 保留监听句柄：优雅退出时 p2p.shutdown() 第一步就解绑端口，
// 避免 iroh 关闭慢/卡住期间（0~3s 或更久）新进程 bind 不到端口
const listenServer = app.listen(port, async function(err){
    !err && Logger.system('MeNote server is ready on http://localhost:' + port);
    // P2P 服务（lib/p2p.js，官方 @number0/iroh）：随主服务启动
    if(!err) {
        try {
            const p2p = require('./lib/p2p');
            await p2p.init(app, {listenServer});
        } catch(e) {
            Logger.error('[p2p] 启动失败: ' + e.message);
        }
    }
});
