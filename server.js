const {App, Logger} = require('jj.js');

// 忽略客户端提前断开连接的错误
process.on('uncaughtException', (err) => {
    // @ts-ignore
    if (err.code === 'ERR_STREAM_PREMATURE_CLOSE') return;
    throw err;
});

// server
const port = 3107;
const app = new App();
app.listen(port, async function(err){
    !err && Logger.system('MeNote server is ready on http://localhost:' + port);
    // P2P 服务（lib/p2p.js，官方 @number0/iroh）：随主服务启动
    if(!err) {
        try {
            const p2p = require('./lib/p2p');
            await p2p.init(app);
        } catch(e) {
            Logger.error('[p2p] 启动失败: ' + e.message);
        }
    }
});
