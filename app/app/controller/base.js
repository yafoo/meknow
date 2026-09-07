const {Controller} = require('jj.js');

class Base extends Controller
{
    middleware = [
        '/install/check'
    ];

    async _init() {
        // 加载站点配置
        const siteConfig = await this.$model.site.getConfig();
        this.$assign('site', siteConfig);
        
        // 加载分类（公开分类）
        const cates = await this.$model.cate.getPublicCateTree();
        this.$assign('cates', cates);
    }
}

module.exports = Base;
