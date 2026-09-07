const Base = require('./base');

class Note extends Base
{
    async note() {
        const id = this.$request.get('id', 0);
        if(!id) return this.$error('参数错误');
        
        const note = await this.$model.note.getPublicNote(id);
        if(!note) return this.$error('笔记不存在或未公开');
        
        // 获取反向链接
        const backlinks = await this.$model.note.getBacklinks(id);
        
        this.$assign('note', note);
        this.$assign('backlinks', backlinks);
        this.$assign('title', note.title);
        await this.$fetch();
    }
}

module.exports = Note;
