const Base = require('./base');

class Graph extends Base
{
    async data() {
        // 获取所有笔记节点
        const nodes = await this.$db.table('note n')
            .field('n.id, n.title, n.cate_id')
            .select();
        
        // 获取所有链接边
        const edges = await this.$db.table('note_link')
            .field('source_id as from, target_id as to')
            .select();
        
        this.$success('success', {nodes, edges});
    }
}

module.exports = Graph;
