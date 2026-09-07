const {Model} = require('jj.js');

class Cate extends Model {
    /**
     * 获取分类树（后台用，包含所有分类）
     */
    async getCateTree() {
        const list = await this.db.order('sort', 'asc').select();
        return this.buildTree(list, 0);
    }
    
    /**
     * 获取公开分类树（前台用）
     */
    async getPublicCateTree() {
        const list = await this.db.where({is_public: 1, is_show: 1})
            .order('sort', 'asc').select();
        return this.buildTree(list, 0);
    }
    
    /**
     * 构建树形结构
     */
    buildTree(list, pid) {
        const tree = [];
        for(const item of list) {
            if(item.pid === pid) {
                item.children = this.buildTree(list, item.id);
                tree.push(item);
            }
        }
        return tree;
    }
    
    /**
     * 批量更新排序
     */
    async batchSort(items) {
        for(const item of items) {
            await this.db.where({id: item.id}).update({
                sort: item.sort,
                pid: item.pid
            });
        }
        return true;
    }
    
    /**
     * 保存分类
     */
    async saveCate(data) {
        if(data.id) {
            return await this.db.where({id: data.id}).update(data);
        } else {
            data.add_time = Math.floor(Date.now() / 1000);
            return await this.db.insert(data);
        }
    }
}

module.exports = Cate;
