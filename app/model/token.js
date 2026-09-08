const {Model} = require('jj.js');
const crypto = require('crypto');

// 权限位定义（位掩码，方便扩展）
// 分类：bit 0-3
const PERM_CATE_READ   = 1 << 0;  // 1
const PERM_CATE_CREATE = 1 << 1;  // 2
const PERM_CATE_EDIT   = 1 << 2;  // 4
const PERM_CATE_DELETE = 1 << 3;  // 8
// 笔记：bit 4-7
const PERM_NOTE_READ   = 1 << 4;  // 16
const PERM_NOTE_CREATE = 1 << 5;  // 32
const PERM_NOTE_EDIT   = 1 << 6;  // 64
const PERM_NOTE_DELETE = 1 << 7;  // 128

// 权限分组（用于管理端表单展示）
const PERM_GROUPS = [
    {
        name: '分类管理',
        items: [
            {bit: PERM_CATE_READ,   key: 'cate_read',   label: '查看'},
            {bit: PERM_CATE_CREATE, key: 'cate_create', label: '新增'},
            {bit: PERM_CATE_EDIT,   key: 'cate_edit',   label: '编辑'},
            {bit: PERM_CATE_DELETE, key: 'cate_delete', label: '删除'},
        ]
    },
    {
        name: '笔记管理',
        items: [
            {bit: PERM_NOTE_READ,   key: 'note_read',   label: '查看'},
            {bit: PERM_NOTE_CREATE, key: 'note_create', label: '新增'},
            {bit: PERM_NOTE_EDIT,   key: 'note_edit',  label: '编辑'},
            {bit: PERM_NOTE_DELETE, key: 'note_delete', label: '删除'},
        ]
    }
];

// 全部分类权限 / 全部笔记权限 / 全部权限
const PERM_ALL_CATE = PERM_CATE_READ | PERM_CATE_CREATE | PERM_CATE_EDIT | PERM_CATE_DELETE;
const PERM_ALL_NOTE = PERM_NOTE_READ | PERM_NOTE_CREATE | PERM_NOTE_EDIT | PERM_NOTE_DELETE;
const PERM_ALL = PERM_ALL_CATE | PERM_ALL_NOTE;

class Token extends Model
{
    // 获取 token 列表
    async getTokenList(condition = {}, rows = 100) {
        return await this.db.where(condition).limit(rows).select();
    }

    // 保存 token（新增或更新）
    async saveToken(data) {
        if(!data.id) {
            data.add_time = Math.floor(Date.now() / 1000);
            data.token = this.generateToken();
        }
        data.update_time = Math.floor(Date.now() / 1000);

        // 处理权限位
        data.permissions = this.calcPermissions(data.permissions_arr || []);
        delete data.permissions_arr;

        if(data.id) {
            // 更新：返回 true/false
            return await this.db.where({id: data.id}).update(data);
        }
        // 新增：返回新记录 id
        const result = await this.db.insert(data);
        return result.insertId !== undefined ? result.insertId : result;
    }

    // 根据token字符串获取有效token记录（过期返回null）
    async getTokenByValue(tokenStr) {
        const token = await this.db.where({token: tokenStr}).find();
        if(!token) return null;

        if(token.expire_time > 0 && token.expire_time < Math.floor(Date.now() / 1000)) {
            return null;
        }
        return token;
    }

    // 生成随机 token 字符串
    generateToken() {
        return 'mk_' + crypto.randomBytes(32).toString('hex');
    }

    // 根据权限 key 数组计算权限位掩码
    calcPermissions(permArr) {
        let perms = 0;
        const permMap = {};
        PERM_GROUPS.forEach(group => {
            group.items.forEach(item => {
                permMap[item.key] = item.bit;
            });
        });
        permArr.forEach(key => {
            if(permMap[key]) {
                perms |= permMap[key];
            }
        });
        return perms;
    }

    // 检查 token 是否拥有指定权限
    hasPermission(token, requiredPerm) {
        return (token.permissions & requiredPerm) === requiredPerm;
    }

    // 权限位掩码转 key 数组（用于表单回显）
    permToArray(perms) {
        const arr = [];
        PERM_GROUPS.forEach(group => {
            group.items.forEach(item => {
                if(perms & item.bit) {
                    arr.push(item.key);
                }
            });
        });
        return arr;
    }

    // 获取权限分组结构（含勾选态，用于前端渲染）
    permGroups(perms = 0) {
        return PERM_GROUPS.map(group => ({
            name: group.name,
            items: group.items.map(item => ({
                ...item,
                checked: !!(perms & item.bit)
            }))
        }));
    }
}

module.exports = Token;
module.exports.PERM_GROUPS = PERM_GROUPS;
module.exports.PERM_ALL = PERM_ALL;
module.exports.PERM_CATE_READ = PERM_CATE_READ;
module.exports.PERM_CATE_CREATE = PERM_CATE_CREATE;
module.exports.PERM_CATE_EDIT = PERM_CATE_EDIT;
module.exports.PERM_CATE_DELETE = PERM_CATE_DELETE;
module.exports.PERM_NOTE_READ = PERM_NOTE_READ;
module.exports.PERM_NOTE_CREATE = PERM_NOTE_CREATE;
module.exports.PERM_NOTE_EDIT = PERM_NOTE_EDIT;
module.exports.PERM_NOTE_DELETE = PERM_NOTE_DELETE;
module.exports.PERM_ALL_CATE = PERM_ALL_CATE;
module.exports.PERM_ALL_NOTE = PERM_ALL_NOTE;
