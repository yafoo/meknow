const {Controller} = require('jj.js');

class Index extends Controller
{
    async _init() {
        if(!this.$cookie.get('user')) {
            return this.$redirect('login/index');
        }
    }
    async index() {
        // Vue3 SPA 入口页面
        await this.$fetch();
    }
}

module.exports = Index;
