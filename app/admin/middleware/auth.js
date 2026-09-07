const {Middleware} = require('jj.js');

class Auth extends Middleware
{
    async index() {
        if(!this.$cookie.get('user')) {
            return this.$redirect('/admin/login');
        }
        await this.$next();
    }
}

module.exports = Auth;
