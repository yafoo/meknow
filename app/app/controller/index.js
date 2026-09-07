const Base = require('./base');

class Index extends Base
{
    async index() {
        // 首页：最新公开笔记
        const notes = await this.$model.note.getPublicNotes({
            order: 'add_time desc',
            limit: 20
        });
        
        this.$assign('notes', notes);
        this.$assign('title', '首页');
        await this.$fetch();
    }
}

module.exports = Index;
