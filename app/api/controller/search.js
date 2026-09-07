const Base = require('./base');

class Search extends Base
{
    async index() {
        const q = this.$request.get('q', '');
        const cateId = this.$request.get('cate_id', 0);
        
        if(!q) return this.$error('请输入搜索关键词');
        
        const notes = await this.$model.note.searchNotes(q, cateId);
        this.$success('success', notes);
    }
}

module.exports = Search;
