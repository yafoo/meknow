const {join} = require('path');
const database = join(__dirname, '..', 'data', 'menote.db');

/**
 * @module db
 * @type {import('jj.js/types').DbConfig}
 */
module.exports = {
    default: {
        type      : 'sqlite',  // 数据库类型
        database  : database,  // 数据库文件绝对地址
        optimize  : false,     // 是否启用性能优化
        prefix    : 'menote_'  // 数据库表前缀
    }
};
