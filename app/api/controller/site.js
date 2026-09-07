const Base = require('./base');

class Site extends Base
{
    async get() {
        const config = await this.$model.site.db.select();
        this.$success('success', config);
    }

    async save() {
        if(!this.$request.isPost()) return this.$error('请使用POST请求');

        const data = this.$request.postAll();
        if(!data.items || !Array.isArray(data.items)) {
            return this.$error('参数错误');
        }

        try {
            for(const item of data.items) {
                await this.$model.site.saveConfig(item.key, item.value);
            }
            this.$success('保存成功');
        } catch(e) {
            this.$error('保存失败：' + e.message);
        }
    }
}

module.exports = Site;
