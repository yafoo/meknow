const {Model} = require('jj.js');

class Note extends Model {
    /**
     * 获取笔记列表
     */
    async getNoteList(condition = {}, rows = 20, page = 1) {
        return await this.db.table('note n')
            .field('n.*, c.name as cate_name, c.is_public')
            .join('cate c', 'n.cate_id=c.id', 'left')
            .where(condition)
            .order('n.is_pinned', 'desc')
            .order('n.sort', 'asc')
            .order('n.add_time', 'desc')
            .paginate({page, page_size: rows});
    }
    
    /**
     * 获取公开笔记列表（前台用）
     */
    async getPublicNotes(options = {}) {
        let query = this.db.table('note n')
            .field('n.*, c.name as cate_name')
            .join('cate c', 'n.cate_id=c.id')
            .where({'c.is_public': 1});
        
        if(options.cate_id) {
            query = query.where({'n.cate_id': options.cate_id});
        }
        
        if(options.order) {
            const [field, sort] = options.order.split(' ');
            query = query.order('n.' + field, sort);
        }
        
        if(options.limit) {
            query = query.limit(options.limit);
        }
        
        return await query.select();
    }
    
    /**
     * 获取单篇公开笔记（前台用）
     */
    async getPublicNote(id) {
        return await this.db.table('note n')
            .field('n.*, c.name as cate_name')
            .join('cate c', 'n.cate_id=c.id')
            .where({'n.id': id, 'c.is_public': 1})
            .find();
    }
    
    /**
     * 保存笔记（新增或更新），同时解析双向链接
     */
    async saveNote(data) {
        if(data.id) {
            data.update_time = Math.floor(Date.now() / 1000);
            const result = await this.db.where({id: data.id}).update(data);
            await this.parseLinks(data.id, data.content || '');
            return result;
        } else {
            data.add_time = Math.floor(Date.now() / 1000);
            data.update_time = Math.floor(Date.now() / 1000);
            const id = await this.db.insert(data);
            await this.parseLinks(id, data.content || '');
            return id;
        }
    }
    
    /**
     * 解析 [[标题]] 双向链接
     */
    async parseLinks(noteId, content) {
        // 清除旧链接
        await this.$db.table('note_link').delete({source_id: noteId});
        
        // 匹配 [[标题]]
        const regex = /\[\[([^\]]+)\]\]/g;
        let match;
        while((match = regex.exec(content)) !== null) {
            const title = match[1].trim();
            const target = await this.$db.table('note')
                .where({title}).find();
            if(target && target.id !== noteId) {
                const exists = await this.$db.table('note_link')
                    .where({source_id: noteId, target_id: target.id}).find();
                if(!exists) {
                    await this.$db.table('note_link').insert({
                        source_id: noteId,
                        target_id: target.id,
                        add_time: Math.floor(Date.now() / 1000)
                    });
                }
            }
        }
    }
    
    /**
     * 获取反向链接
     */
    async getBacklinks(noteId) {
        return await this.db.table('note n')
            .field('n.id, n.title')
            .join('note_link l', 'l.source_id=n.id')
            .where({'l.target_id': noteId})
            .select();
    }
    
    /**
     * 搜索笔记
     */
    async searchNotes(q, cateId = 0) {
        let query = this.db.table('note n')
            .field('n.id, n.title, n.keywords, n.add_time, c.name as cate_name')
            .join('cate c', 'n.cate_id=c.id')
            .where({'c.is_public': 1});
        
        if(cateId > 0) {
            query = query.where({'n.cate_id': cateId});
        }
        
        // 搜索标题、内容、标签
        return await query
            .where('(n.title like ? OR n.content like ? OR n.keywords like ?)',
                ['%' + q + '%', '%' + q + '%', '%' + q + '%'], 'or')
            .order('n.add_time', 'desc')
            .select();
    }
}

module.exports = Note;
