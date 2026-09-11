/**
 * @module app
 * @type {import('jj.js/types').AppConfig}
 */
const app = {
    app_debug: true, //调试模式
    default_deep: 'app', //默认应用深度
    static_dir: {
        static_dir: './public', //静态文件目录，相对于应用根目录，为空或false时，关闭静态访问
        options: {
            maxage: 10 * 24 * 60 * 60 * 1000, //静态文件缓存时间，单位毫秒
        }
    },
    koa_body: {
        multipart: true,
        // 设置请求体大小限制
        jsonLimit: '10mb',      // JSON 请求体限制
        formLimit: '10mb',      // 表单请求体限制
        textLimit: '10mb',      // 文本请求体限制
        formidable: {keepExtensions: true, maxFieldsSize: 10 * 1024 * 1024}
    }
}

module.exports = app;
