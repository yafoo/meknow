const Base = require('./base');

class Cate extends Base
{
    async list() {
        const list = await this.$model.cate.db.order('sort', 'asc').select();
        this.$success('success', list);
    }

    async tree() {
        const tree = await this.$model.cate.getCateTree();
        this.$success('success', tree);
    }

    async create() {
        if(!this.$request.isPost()) return this.$error('请使用POST请求');

        const data = this.$request.postAll();
        if(!data.name) return this.$error('分类名称不能为空');

        const id = await this.$model.cate.saveCate(data);
        if(id) {
            this.$success('创建成功', {id});
        } else {
            this.$error('创建失败');
        }
    }

    async edit() {
        if(!this.$request.isPost()) return this.$error('请使用POST请求');

        const data = this.$request.postAll();
        if(!data.id) return this.$error('缺少id参数');

        const result = await this.$model.cate.saveCate(data);
        if(result) {
            this.$success('保存成功');
        } else {
            this.$error('保存失败');
        }
    }

    async delete() {
        const id = this.$request.get('id', 0);
        if(!id) return this.$error('缺少id参数');

        // 检查是否有子分类
        const children = await this.$model.cate.db.where({pid: id}).count();
        if(children > 0) return this.$error('请先删除子分类');

        // 检查是否有笔记
        const notes = await this.$db.table('note').where({cate_id: id}).count();
        if(notes > 0) return this.$error('请先移除该分类下的笔记');

        const result = await this.$model.cate.db.delete({id});
        if(result) {
            this.$success('删除成功');
        } else {
            this.$error('删除失败');
        }
    }

    async sort() {
        if(!this.$request.isPost()) return this.$error('请使用POST请求');

        const items = this.$request.post('items', []);
        if(!Array.isArray(items) || items.length === 0) {
            return this.$error('参数错误');
        }

        const result = await this.$model.cate.batchSort(items);
        if(result) {
            this.$success('排序已保存');
        } else {
            this.$error('保存失败');
        }
    }
}

module.exports = Cate;
