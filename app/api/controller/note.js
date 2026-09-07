const Base = require('./base');

class Note extends Base
{
    async list() {
        const page = parseInt(this.$request.get('page', 1)) || 1;
        const rows = parseInt(this.$request.get('rows', 20)) || 20;
        const cateId = parseInt(this.$request.get('cate_id', 0)) || 0;
        const keyword = this.$request.get('keyword', '');
        const q = this.$request.get('q', '');

        const condition = {};
        if(cateId > 0) condition['n.cate_id'] = cateId;
        if(keyword) condition['n.keywords'] = ['like', '%' + keyword + '%'];
        if(q) condition['n.title'] = ['like', '%' + q + '%'];

        const [list, pagination] = await this.$model.note.getNoteList(condition, rows, page);
        this.$success('success', {list, page, rows, total: pagination.total()});
    }

    async detail() {
        const id = this.$request.get('id', 0);
        if(!id) return this.$error('缺少id参数');

        const note = await this.$db.table('note n')
            .field('n.*, c.name as cate_name')
            .join('cate c', 'n.cate_id=c.id', 'left')
            .where({'n.id': id})
            .find();
        
        if(!note) return this.$error('笔记不存在');

        // 获取反向链接
        const backlinks = await this.$model.note.getBacklinks(id);
        note.backlinks = backlinks;

        this.$success('success', note);
    }

    async create() {
        if(!this.$request.isPost()) return this.$error('请使用POST请求');

        const data = this.$request.postAll();
        if(!data.title) return this.$error('标题不能为空');

        const id = await this.$model.note.saveNote(data);
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

        const note = await this.$db.table('note').where({id: data.id}).find();
        if(!note) return this.$error('笔记不存在');

        const result = await this.$model.note.saveNote(data);
        if(result) {
            this.$success('保存成功');
        } else {
            this.$error('保存失败');
        }
    }

    async delete() {
        const id = this.$request.get('id', 0);
        if(!id) return this.$error('缺少id参数');

        try {
            await this.$db.startTrans(async () => {
                await this.$db.table('note').delete({id});
                await this.$db.table('note_link').delete({source_id: id});
                await this.$db.table('note_link').delete({target_id: id});
            });
            this.$success('删除成功');
        } catch(e) {
            this.$error('删除失败：' + e.message);
        }
    }

    async sort() {
        if(!this.$request.isPost()) return this.$error('请使用POST请求');

        const items = this.$request.post('items', []);
        if(!Array.isArray(items) || items.length === 0) {
            return this.$error('参数错误');
        }

        try {
            for(const item of items) {
                await this.$db.table('note').where({id: item.id}).update({sort: item.sort});
            }
            this.$success('排序已保存');
        } catch(e) {
            this.$error('保存失败：' + e.message);
        }
    }

    async backlinks() {
        const id = this.$request.get('id', 0);
        if(!id) return this.$error('缺少id参数');

        const backlinks = await this.$model.note.getBacklinks(id);
        this.$success('success', backlinks);
    }

    async pin() {
        if(!this.$request.isPost()) return this.$error('请使用POST请求');

        const id = this.$request.post('id', 0);
        const isPinned = this.$request.post('is_pinned', 0);

        if(!id) return this.$error('缺少id参数');

        try {
            await this.$db.table('note').where({id}).update({
                is_pinned: isPinned ? 1 : 0,
                update_time: Math.floor(Date.now() / 1000)
            });
            this.$success(isPinned ? '已置顶' : '已取消置顶');
        } catch(e) {
            this.$error('操作失败：' + e.message);
        }
    }
}

module.exports = Note;
