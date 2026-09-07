const {Model} = require('jj.js');

class Site extends Model {
    /**
     * 获取站点配置
     */
    async getConfig() {
        const list = await this.db.select();
        const config = {};
        for(const item of list) {
            config[item.key] = item.value;
        }
        return config;
    }
    
    /**
     * 保存配置
     */
    async saveConfig(key, value) {
        const item = await this.db.where({key}).find();
        if(item) {
            return await this.db.where({key}).update({value});
        } else {
            return await this.db.insert({key, value, group: 'basic', type: 'input', title: key});
        }
    }
}

module.exports = Site;
