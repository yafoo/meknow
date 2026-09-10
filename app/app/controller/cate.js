const Base = require('./base');

class Cate extends Base
{
    async cate() {
        const id = this.$request.param('id', 0);
        if(!id) return this.$error('参数错误');
        
        const cate = await this.$model.cate.get({id, is_public: 1});
        if(!cate) return this.$error('分类不存在或未公开');
        
        const notes = await this.$model.note.getPublicNotes({
            cate_id: id,
            order: 'add_time desc',
            limit: 50
        });
        
        this.$assign('cate', cate);
        this.$assign('notes', notes);
        this.$assign('title', cate.name);
        await this.$fetch();
    }
}

module.exports = Cate;
