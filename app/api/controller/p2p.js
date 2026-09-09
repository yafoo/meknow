/**
 * P2P 管理 API —— 仅限 Cookie 登录（admin 后台）操作
 *
 * 路由（jj.js 自动映射 /api/p2p/<action>）：
 *   GET  /api/p2p/status    状态：本节点 ID + 白名单 + 在线 + 待授权配对
 *   GET  /api/p2p/qrcode    本节点 ID 二维码（dataURL，供前端弹窗展示）
 *   POST /api/p2p/authorize 授权配对请求 {id, name} → 写入白名单
 *   POST /api/p2p/dismiss   忽略配对请求 {id}
 *   POST /api/p2p/add       手动添加节点 {id, name}（扫码或粘贴手机节点 ID）
 *   POST /api/p2p/remove    移除白名单节点 {id}
 */
const Base = require('./base');
const P2P = require('../../../lib/p2p');

class P2p extends Base
{
    async _init() {
        // P2P 管理仅限 admin 登录（cookie），不开放 token 权限
        const userId = this.$cookie.get('user');
        if(!userId) {
            return this.$error('未登录');
        }
        const user = await this.$db.table('user').where({id: userId}).find();
        if(!user) {
            return this.$error('未登录');
        }
        this.userInfo = user;
    }

    /** 状态总览（前端轮询此接口发现新配对请求） */
    async status() {
        const st = P2P.status();
        this.$success('success', st);
    }

    /** 本节点 ID 二维码（服务端 qrcode 库生成 dataURL） */
    async qrcode() {
        if(!P2P.nodeId) return this.$error('P2P 服务未启动');
        const QRCode = require('qrcode');
        const dataUrl = await QRCode.toDataURL(P2P.nodeId, {
            margin: 1,
            width: 240,
            color: {dark: '#000000', light: '#ffffff'}
        });
        this.$success('success', {nodeId: P2P.nodeId, qrcode: dataUrl});
    }

    /** 授权配对请求（弹窗「确定」） */
    async authorize() {
        if(!this.$request.isPost()) return this.$error('请使用POST请求');
        const id = P2P.toBase32Id(this.$request.post('id', ''));
        const name = this.$request.post('name', '').trim();
        if(!id) return this.$error('缺少id参数');

        // 校验节点 ID 格式（统一 base32 52 字符）
        if(!/^[a-z2-7]{52}$/.test(id)) {
            return this.$error('节点 ID 格式不正确');
        }

        P2P.authorizePeer(id, name);
        this.$success('已授权，手机端将自动连接');
    }

    /** 忽略配对请求（弹窗「取消」） */
    async dismiss() {
        if(!this.$request.isPost()) return this.$error('请使用POST请求');
        const id = P2P.toBase32Id(this.$request.post('id', ''));
        if(!id) return this.$error('缺少id参数');
        P2P.dismissPairing(id);
        this.$success('已忽略');
    }

    /** 手动添加节点（不经过配对请求流程） */
    async add() {
        if(!this.$request.isPost()) return this.$error('请使用POST请求');
        const id = P2P.toBase32Id(this.$request.post('id', ''));
        const name = this.$request.post('name', '').trim();
        if(!id) return this.$error('缺少id参数');
        if(!/^[a-z2-7]{52}$/.test(id)) {
            return this.$error('节点 ID 格式不正确（需 base32 52 字符或 hex 64 字符）');
        }
        P2P.authorizePeer(id, name);
        this.$success('已添加到白名单');
    }

    /** 移除节点 */
    async remove() {
        if(!this.$request.isPost()) return this.$error('请使用POST请求');
        const id = P2P.toBase32Id(this.$request.post('id', ''));
        if(!id) return this.$error('缺少id参数');
        const removed = P2P.removePeer(id);
        if(removed) {
            this.$success('已从白名单移除（若该节点在线将被断开）');
        } else {
            this.$error('该节点不在白名单中');
        }
    }
}

module.exports = P2p;
