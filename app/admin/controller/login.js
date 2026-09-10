const {Controller} = require('jj.js');
const crypto = require('crypto');

class Login extends Controller
{
    async index() {
        if(this.$request.isPost()) {
            const username = this.$request.post('username');
            const password = this.$request.post('password');

            if(!username || !password) {
                return this.$error('用户名和密码不能为空！');
            }

            const user = await this.$db.table('user').where({username}).find();
            if(!user) {
                return this.$error('用户不存在！');
            }

            if(user.is_lock > 0) {
                return this.$error('账号已被锁定！');
            }

            const pwd = crypto.createHash('md5').update(password + user.salt).digest('hex');
            if(pwd !== user.password) {
                // 记录错误次数
                const is_lock = (user.is_lock || 0) - 1;
                await this.$db.table('user').where({id: user.id}).update({is_lock: Math.min(is_lock, -5)});
                return this.$error('密码错误！');
            }

            // 登录成功
            await this.$db.table('user').where({id: user.id}).update({
                login_time: Math.floor(Date.now() / 1000),
                is_lock: 0
            });

            this.$cookie.set('user', user.id, {maxAge: 7 * 24 * 3600 * 1000});
            this.$success('登录成功！', '/admin');
        } else {
            const userId = this.$cookie.get('user');
            if(userId) {
                const user = await this.$db.table('user').where({id: userId}).find();
                if(user) {
                    return this.$redirect('index/index');
                }
            }
            await this.$fetch();
        }
    }

    async logout() {
        this.$cookie.set('user', null);
        this.$success('退出成功！', 'login/index');
    }
}

module.exports = Login;
