const Base = require('./base');

class Search extends Base
{
    async search() {
        const q = this.$request.get('q', '');
        const cateId = this.$request.get('cate_id', 0);
        
        let notes = [];
        if(q) {
            notes = await this.$model.note.searchNotes(q, cateId);
        }
        
        this.$assign('q', q);
        this.$assign('cateId', cateId);
        this.$assign('notes', notes);
        this.$assign('title', '搜索: ' + q);
        await this.$fetch();
    }
}

module.exports = Search;
