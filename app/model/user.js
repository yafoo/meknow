const {Model} = require('jj.js');
const crypto = require('crypto');

class User extends Model {
    /**
     * 保存用户（新增或更新）
     */
    async saveUser(data) {
        if(data.id) {
            const updateData = {username: data.username};
            if(data.password) {
                updateData.salt = crypto.randomBytes(8).toString('hex');
                updateData.password = crypto.createHash('md5')
                    .update(data.password + updateData.salt).digest('hex');
            }
            return await this.db.where({id: data.id}).update(updateData);
        } else {
            const salt = crypto.randomBytes(8).toString('hex');
            const pwd = crypto.createHash('md5').update(data.password + salt).digest('hex');
            return await this.db.insert({
                username: data.username,
                password: pwd,
                salt: salt,
                add_time: Math.floor(Date.now() / 1000)
            });
        }
    }
    
    /**
     * 登录
     */
    async login(username, password) {
        const user = await this.db.where({username}).find();
        if(!user) return '用户不存在';
        if(user.is_lock > 0) return '账号已被锁定';
        
        const pwd = crypto.createHash('md5').update(password + user.salt).digest('hex');
        if(pwd !== user.password) return '密码错误';
        
        await this.db.where({id: user.id}).update({
            login_time: Math.floor(Date.now() / 1000),
            is_lock: 0
        });
        
        return null;
    }
    
    /**
     * 退出
     */
    async logout() {
        this.$cookie.set('user', null);
    }
}

module.exports = User;
