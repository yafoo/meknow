const Base = require('./base');

class Token extends Base
{
    async list() {
        const tokens = await this.$model.token.getTokenList();
        // 附加权限分组结构（含勾选态，供前端渲染）
        const list = tokens.map(t => ({
            ...t,
            perm_groups: this.$model.token.permGroups(t.permissions)
        }));
        this.$success('success', list);
    }

    async create() {
        if(!this.$request.isPost()) return this.$error('请使用POST请求');

        const data = this.$request.postAll();
        if(!data.name) return this.$error('名称不能为空');

        // permissions_arr: ['cate_read', 'note_edit', ...]（兼容单个值）
        if(!Array.isArray(data.permissions_arr)) {
            data.permissions_arr = data.permissions_arr ? [data.permissions_arr] : [];
        }
        if(data.permissions_arr.length === 0) {
            return this.$error('请至少勾选一项权限');
        }

        const id = await this.$model.token.saveToken(data);
        if(id) {
            // 返回完整 token 供创建时展示
            const row = await this.$model.token.get({id});
            this.$success('创建成功', { id, token: row.token });
        } else {
            this.$error('创建失败');
        }
    }

    async edit() {
        if(!this.$request.isPost()) return this.$error('请使用POST请求');

        const data = this.$request.postAll();
        if(!data.id) return this.$error('缺少id参数');
        if(!data.name) return this.$error('名称不能为空');

        const exists = await this.$model.token.get({id: data.id});
        if(!exists) return this.$error('Token不存在');

        if(!Array.isArray(data.permissions_arr)) {
            data.permissions_arr = data.permissions_arr ? [data.permissions_arr] : [];
        }
        if(data.permissions_arr.length === 0) {
            return this.$error('请至少勾选一项权限');
        }

        // 过期时间：未传则保留原值（不覆盖），传 0 表示永不过期
        if(data.expire_time !== undefined && data.expire_time !== '') {
            data.expire_time = parseInt(data.expire_time) || 0;
        } else {
            delete data.expire_time;
        }

        const result = await this.$model.token.saveToken(data);
        if(result) {
            this.$success('保存成功');
        } else {
            this.$error('保存失败');
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
