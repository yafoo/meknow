const Base = require('./base');

class User extends Base
{
    async info() {
        if(!this.userInfo) {
            return this.$error('未登录');
        }
        this.$success('success', {
            id: this.userInfo.id,
            username: this.userInfo.username
        });
    }

    async edit() {
        if(!this.$request.isPost()) return this.$error('请使用POST请求');
        if(!this.userInfo) return this.$error('未登录');

        const data = this.$request.postAll();
        const id = this.userInfo.id;

        const result = await this.$model.user.saveUser({
            id: id,
            username: data.username,
            password: data.password
        });

        if(result) {
            this.$success('保存成功');
        } else {
            this.$error('保存失败');
        }
    }
}

module.exports = User;
