const Base = require('./base');

class Graph extends Base
{
    async graph() {
        // 获取所有公开笔记和链接数据
        const nodes = await this.$db.table('note n')
            .field('n.id, n.title, n.cate_id')
            .join('cate c', 'n.cate_id=c.id')
            .where({'c.is_public': 1})
            .select();
        
        const edges = await this.$db.table('note_link').select();
        
        this.$assign('nodes', JSON.stringify(nodes));
        this.$assign('edges', JSON.stringify(edges));
        this.$assign('title', '知识图谱');
        await this.$fetch();
    }
}

module.exports = Graph;
