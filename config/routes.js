const routes = [
    // 前台（SSR）
    {url: '/', path: 'app/index/index'},
    {url: '/note/:id.html', path: 'app/note/note', name: 'note'},
    {url: '/cate/:id', path: 'app/cate/cate', name: 'cate'},
    {url: '/search', path: 'app/search/search', name: 'search'},
    {url: '/graph', path: 'app/graph/graph', name: 'graph'},

    // 管理后台（Vue3 SPA 入口）
    {url: '/admin', path: 'admin/index/index'},
    {url: '/admin/login', path: 'admin/login/index'},

    // 安装向导
    {url: '/install', path: 'install/index/index'},
    {url: '/install/install', path: 'install/index/install'},
];

module.exports = routes;
