const {Middleware} = require('jj.js');

class Install extends Middleware
{
    // 安装验证
    async check() {
        if(!this.$config.lock) {
            this.$redirect('/install');
        } else {
            await this.$next();
        }
    }
}

module.exports = Install;
