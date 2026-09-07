const {Controller} = require('jj.js');

class Base extends Controller
{
    tokenInfo = null;
    userInfo = null;

    async _init() {
        // 先检查 Cookie 认证（管理后台）
        const userId = this.$cookie.get('user');
        if(userId) {
            const user = await this.$db.table('user').where({id: userId}).find();
            if(user) {
                this.userInfo = user;
                return; // Cookie 认证成功，跳过 token 认证
            }
        }

        // 再检查 Token 认证（外部 API）
        let tokenStr = this.$request.get('token', '');
        if(!tokenStr) {
            const authHeader = this.$request.header('authorization') || '';
            if(authHeader.startsWith('Bearer ')) {
                tokenStr = authHeader.substring(7);
            }
        }

        if(!tokenStr) {
            return this.$error('未登录或Token缺失');
        }

        // 查询 token
        const token = await this.$db.table('token')
            .where({token: tokenStr})
            .find();
        
        if(!token) {
            return this.$error('Token无效');
        }

        // 检查是否过期（expire_time 为 0 表示永不过期）
        const now = Math.floor(Date.now() / 1000);
        if(token.expire_time > 0 && token.expire_time < now) {
            return this.$error('Token已过期');
        }

        this.tokenInfo = token;
    }
}

module.exports = Base;
