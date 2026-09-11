const {Controller, loader} = require('jj.js');
const {version: VERSION} = require('../../../package.json');
const {readFile, writeFile} = require('fs').promises;
const {join} = require('path');
const crypto = require('crypto');

class Index extends Controller
{
    async _init() {
        this.base_dir = this.$config.app.base_dir;
        this.lockFile = this.base_dir + '/config/lock.js';
        this.sqlFile = this.base_dir + '/app/install/menote_sqlite.sql';

        if(await this._isInstalled()) {
            return this.$error('系统已安装！', '/');
        }

        this.$assign('VERSION', VERSION);
        this.$assign('APP_TIME', this.ctx.APP_TIME);
    }

    async _isInstalled() {
        if(this.$config.lock) {
            return true;
        }
        if(await this.$.utils.fs.isFile(this.lockFile)) {
            return true;
        }
        return false;
    }

    async index() {
        await this.$fetch();
    }

    async install() {
        if(!this.$request.isPost()) {
            return this.$error('非法请求！');
        }

        const username = this.$request.post('username');
        const password = this.$request.post('password');
        if(!username || !password) {
            return this.$error('用户名或密码不能为空！');
        }

        try {
            await this._initDatabase(username, password);
            await this._writeLockFile();
            loader.clearPathCache();
            this.$success('安装成功！', '/admin');
        } catch(e) {
            this.$logger.debug(e);
            this.$error(e.message || '安装出错！');
        }
    }

    /**
     * 初始化数据库
     */
    async _initDatabase(username, password) {
        const sql = await readFile(this.sqlFile, 'utf8');
        // 使用更健壮的分隔方式
        const statements = sql.split(/;\s*\n/).filter(s => s.trim());
        const db = this.$db;

        await db.startTrans(async () => {
            // 执行建表语句
            for(const stmt of statements) {
                const s = stmt.trim();
                if(s) await db.query(s);
            }

            // 创建管理员用户
            const salt = crypto.randomBytes(8).toString('hex');
            const pwd = crypto.createHash('md5').update(password + salt).digest('hex');
            await db.table('user').insert({
                username: username,
                password: pwd,
                salt: salt,
                add_time: Math.floor(Date.now() / 1000)
            });

            // 插入默认站点配置
            const siteData = [
                {group: 'basic', type: 'input', key: 'sitename', title: '站点名称', value: 'MeNote', tips: '', sort: 0},
                {group: 'basic', type: 'textarea', key: 'description', title: '站点描述', value: '我的个人知识库', tips: '', sort: 1},
                {group: 'display', type: 'input', key: 'list_rows', title: '列表条数', value: '20', tips: '', sort: 0},
            ];
            for(const item of siteData) {
                await db.table('site').insert(item);
            }
        });
    }

    /**
     * 写入锁定文件
     */
    async _writeLockFile() {
        const lock_content = `// 本文件标识系统已安装，不可删除。
module.exports = {
    install: true,
    version: '${VERSION}'
};`;
        await writeFile(this.lockFile, lock_content);
    }
}

module.exports = Index;
