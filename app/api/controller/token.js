const Base = require('./base');
const crypto = require('crypto');

class Token extends Base
{
    async list() {
        const tokens = await this.$db.table('token')
            .order('add_time', 'desc')
            .select();
        this.$success('success', tokens);
    }

    async create() {
        if(!this.$request.isPost()) return this.$error('请使用POST请求');

        const name = this.$request.post('name', '');
        const expire_time = this.$request.post('expire_time', 0);

        if(!name) return this.$error('名称不能为空');

        // 生成随机 token
        const token = crypto.randomBytes(32).toString('hex');
        const now = Math.floor(Date.now() / 1000);

        const id = await this.$db.table('token').insert({
            name: name,
            token: token,
            expire_time: expire_time || 0,
            add_time: now
        });

        if(id) {
            this.$success('创建成功', { id, token });
        } else {
            this.$error('创建失败');
        }
    }

    async delete() {
        const id = this.$request.get('id', 0);
        if(!id) return this.$error('缺少id参数');

        const result = await this.$db.table('token').delete({ id });
        if(result) {
            this.$success('删除成功');
        } else {
            this.$error('删除失败');
        }
    }
}

module.exports = Token;
