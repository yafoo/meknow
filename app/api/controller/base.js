const {Controller} = require('jj.js');
const TokenModel = require('../../model/token');

// 控制器+方法 -> 所需权限 映射表
// 新增控制器时在此扩展即可；token 管理本身仅限 Cookie 登录（admin后台）操作
const PERM_MAP = {
    cate: {
        tree:   TokenModel.PERM_CATE_READ,
        list:   TokenModel.PERM_CATE_READ,
        create: TokenModel.PERM_CATE_CREATE,
        edit:   TokenModel.PERM_CATE_EDIT,
        sort:   TokenModel.PERM_CATE_EDIT,
        delete: TokenModel.PERM_CATE_DELETE,
    },
    note: {
        list:   TokenModel.PERM_NOTE_READ,
        detail: TokenModel.PERM_NOTE_READ,
        create: TokenModel.PERM_NOTE_CREATE,
        edit:   TokenModel.PERM_NOTE_EDIT,
        pin:    TokenModel.PERM_NOTE_EDIT,
        sort:   TokenModel.PERM_NOTE_EDIT,
        delete: TokenModel.PERM_NOTE_DELETE,
    }
};

class Base extends Controller
{
    tokenInfo = null;
    userInfo = null;

    async _init() {
        // 先检查 Cookie 认证（管理后台）：不受 token 权限限制，拥有全部权限
        const userId = this.$cookie.get('user');
        if(userId) {
            const user = await this.$db.table('user').where({id: userId}).find();
            if(user) {
                this.userInfo = user;
                return; // Cookie 认证成功，跳过 token 认证
            }
        }

        // 再检查 Token 认证（外部 API）
        let tokenStr = this.$request.get('token', '');
        if(!tokenStr) {
            const authHeader = this.$request.header('authorization') || '';
            if(authHeader.startsWith('Bearer ')) {
                tokenStr = authHeader.substring(7);
            }
        }

        if(!tokenStr) {
            return this.$error('未登录或Token缺失');
        }

        // 查询 token（含过期检查）
        const token = await this.$model.token.getTokenByValue(tokenStr);

        if(!token) {
            return this.$error('Token无效或已过期');
        }

        // 根据控制器+方法查权限映射并校验
        const ctrl = this.ctx.CONTROLLER;
        const action = this.ctx.ACTION;
        const requiredPerm = PERM_MAP[ctrl]?.[action] || 0;

        if(requiredPerm && !this.$model.token.hasPermission(token, requiredPerm)) {
            return this.$error('权限不足');
        }

        this.tokenInfo = token;
    }
}

module.exports = Base;
