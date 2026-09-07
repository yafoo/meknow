const {Controller} = require('jj.js');

class Index extends Controller
{
    // 管理后台入口，需要登录
    middleware = [
        {middleware: 'admin/auth/index'}
    ];

    async index() {
        // Vue3 SPA 入口页面
        await this.$fetch();
    }
}

module.exports = Index;
