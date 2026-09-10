// Meknow Vue3 管理后台应用

const { createApp, ref, reactive, computed, onMounted, onUnmounted, watch, nextTick } = Vue;
const { createRouter, createWebHashHistory } = VueRouter;

// ==================== 统一请求封装 ====================
async function request(url, options = {}) {
    const defaultHeaders = { 'Content-Type': 'application/json' };
    const config = {
        ...options,
        headers: { ...defaultHeaders, ...(options.headers || {}) }
    };
    if(config.body && typeof config.body === 'object') {
        config.body = JSON.stringify(config.body);
    }
    const res = await fetch(url, config);
    const text = await res.text();
    try {
        return JSON.parse(text);
    } catch(e) {
        console.error('JSON parse error:', text.substring(0, 200));
        return { state: 0, msg: '响应解析失败' };
    }
}

// ==================== 状态管理 ====================
const store = reactive({
    // 用户信息
    user: null,
    username: '',

    // 分类数据（树形）
    categories: [],
    currentCateId: null,

    // Tab 管理
    tabs: [],
    activeTabId: null,

    // 未保存提示弹窗（关闭 Tab 时）
    unsavedDialogVisible: false,
    unsavedTabId: null,

    // 笔记列表
    notes: [],
    notesTotal: 0,
    notesLoading: false,
    // 分页（后端 /api/note/list 已支持 page/rows）
    notesPage: 1,
    notesPageSize: 20,

    // 笔记数据缓存
    notesCache: {},

    // 移动端：笔记列表是否隐藏
    noteListHidden: false,

    // 移动端状态：是否手机、当前单栏视图（list=笔记列表 / editor=编辑器）、分类抽屉
    isMobile: false,
    mobileView: 'list',
    mobileSidebarOpen: false,

    // 打开分类抽屉（移动端）
    openSidebar() {
        if(this.isMobile) {
            if(!this.mobileSidebarOpen) {
                this.mobileSidebarOpen = true;
                history.pushState({ mekSidebar: true }, '');
            }
        } else {
            this.mobileSidebarOpen = true;
        }
    },

    // 关闭分类抽屉（移动端；consumeHistory=true 由返回手势触发，避免二次 back）
    closeSidebar(consumeHistory = true) {
        if(this.mobileSidebarOpen) {
            this.mobileSidebarOpen = false;
            if(this.isMobile && consumeHistory && history.state && history.state.mekSidebar) {
                history.back();
            }
        }
    },

    // 进入编辑器视图（移动端单栏模式）
    // 同时压入一个历史记录，让安卓返回手势先回列表而不是退出页面
    enterEditor() {
        if(this.isMobile) {
            if(this.mobileView !== 'editor') {
                history.pushState({ mekEditor: true }, '');
            }
            this.mobileView = 'editor';
        }
    },

    // 返回列表视图（移动端单栏模式）
    backToList() {
        if(this.isMobile) {
            this.mobileView = 'list';
            // 若历史栈里有编辑器标记，回退消费掉它（返回手势触发时走 popstate 分支）
            if(history.state && history.state.mekEditor) {
                history.back();
            }
        }
    },

    // 响应移动端状态变化（窗口尺寸切换）
    updateMobileState() {
        const wasMobile = this.isMobile;
        this.isMobile = window.innerWidth <= 768;
        if(wasMobile && !this.isMobile) {
            // 切回桌面：重置单栏状态
            this.mobileView = 'list';
            this.mobileSidebarOpen = false;
        }
    },

    // 初始化
    async init() {
        this.updateMobileState();
        window.addEventListener('resize', () => this.updateMobileState());

        // 安卓返回手势拦截：优先关分类抽屉，其次回列表，不退出页面
        window.addEventListener('popstate', () => {
            if(!this.isMobile) return;
            if(this.mobileSidebarOpen) {
                this.mobileSidebarOpen = false;
            } else if(this.mobileView === 'editor') {
                this.mobileView = 'list';
            }
        });

        await this.loadUserInfo();
        await this.loadCategories();
        await this.loadNotes(this.currentCateId);
    },

    // 加载用户信息
    async loadUserInfo() {
        try {
            const data = await request('/api/user/info');
            if(data.state === 1) {
                this.user = data.data;
                this.username = data.data.username || '';
            }
        } catch(e) {
            console.error('加载用户信息失败', e);
        }
    },

    // 加载分类（树形）
    async loadCategories() {
        try {
            const data = await request('/api/cate/tree');
            if(data.state === 1) {
                const tree = data.data || [];
                // 在头部插入"全部笔记"虚拟节点
                this.categories = [
                    { id: null, name: '全部笔记', icon: '📁', is_virtual: true, children: [] },
                    ...tree
                ];
            }
        } catch(e) {
            console.error('加载分类失败', e);
        }
    },

    // 加载笔记列表（分页；resetPage=true 时回到第 1 页——搜索/切分类/建笔记）
    async loadNotes(cateId, keyword = '', page = null, resetPage = false) {
        this.notesLoading = true;
        try {
            if(resetPage || page === null) {
                page = 1;
            }
            const params = new URLSearchParams();
            if(cateId !== null && cateId !== undefined) {
                params.set('cate_id', cateId);
            }
            params.set('rows', this.notesPageSize);
            params.set('page', page);
            if(keyword) params.set('q', keyword);
            const data = await request(`/api/note/list?${params}`);
            if(data.state === 1) {
                this.notes = data.data.list || [];
                this.notesTotal = data.data.total || 0;
                this.notesPage = page;
            }
        } catch(e) {
            console.error('加载笔记列表失败', e);
        } finally {
            this.notesLoading = false;
        }
    },

    // 打开笔记（从列表点击）
    async openNote(id) {
        // 如果已在 Tab 中，直接切换
        const existing = this.tabs.find(t => t.id === id);
        if(existing) {
            this.activeTabId = id;
            this.enterEditor();
            return;
        }

        // 加载笔记详情
        const note = await this.loadNote(id);
        if(note) {
            this.addTab({ id: note.id, title: note.title });
        }
    },

    // 加载笔记详情
    async loadNote(id) {
        if(this.notesCache[id]) {
            return this.notesCache[id];
        }

        try {
            const data = await request(`/api/note/detail?id=${id}`);
            if(data.state === 1) {
                // 将 cate_id 为 0 转为 null，避免 el-select 显示 0
                if(data.data.cate_id === 0) {
                    data.data.cate_id = null;
                }
                this.notesCache[id] = data.data;
                return data.data;
            }
        } catch(e) {
            console.error('加载笔记失败', e);
        }
        return null;
    },
    
    // 添加 Tab
    addTab(note) {
        const existing = this.tabs.find(t => t.id === note.id);
        if(existing) {
            this.activeTabId = existing.id;
            return;
        }
        
        this.tabs.push({
            id: note.id,
            title: note.title || '无标题',
            modified: false
        });

        this.activeTabId = note.id;
        this.enterEditor();

        // 加载笔记数据
        this.loadNote(note.id);
    },
    
    // 关闭 Tab
    // skipConfirm: 跳过未保存确认（内部复用：先保存再关闭）
    async closeTab(id, skipConfirm = false) {
        const index = this.tabs.findIndex(t => t.id === id);
        if(index === -1) return;

        // 如果有修改，提示用户
        const tab = this.tabs[index];
        if(tab.modified && !skipConfirm) {
            this.unsavedTabId = id;
            this.unsavedDialogVisible = true;
            return;
        }

        this.tabs.splice(index, 1);

        // 如果关闭的是当前激活的 Tab
        if(this.activeTabId === id) {
            if(this.tabs.length > 0) {
                const newIndex = Math.max(0, index - 1);
                this.activeTabId = this.tabs[newIndex].id;
            } else {
                this.activeTabId = null;
                // 移动端：最后一个 Tab 关闭后回到列表
                this.backToList();
            }
        }
    },

    // 取消关闭（留在当前页）
    cancelUnsavedClose() {
        this.unsavedDialogVisible = false;
        this.unsavedTabId = null;
    },

    // 放弃修改并关闭
    discardUnsavedClose() {
        const id = this.unsavedTabId;
        this.unsavedDialogVisible = false;
        if(id === null) return;
        this.unsavedTabId = null;
        // 清掉缓存，下次打开重新拉服务端数据
        delete this.notesCache[id];
        this.closeTab(id, true);
    },

    // 保存修改并关闭（保存失败则留在当前页）
    async saveUnsavedClose() {
        const id = this.unsavedTabId;
        if(id === null) return;
        const note = this.notesCache[id];
        if(!note) {
            // 无缓存数据，只能放弃
            this.discardUnsavedClose();
            return;
        }
        if(!note.title) {
            ElementPlus.ElMessage.warning('请输入标题');
            return;
        }
        const noteData = {
            id: note.id,
            title: note.title,
            cate_id: note.cate_id,
            content: note.content,
            keywords: note.keywords,
            is_pinned: note.is_pinned
        };
        try {
            const res = await api.updateNote(noteData);
            if(res.state === 1) {
                this.unsavedDialogVisible = false;
                this.unsavedTabId = null;
                const tab = this.tabs.find(t => t.id === id);
                if(tab) {
                    tab.title = note.title;
                    tab.modified = false;
                }
                this.loadNotes(this.currentCateId);
                ElementPlus.ElMessage.success('已保存并关闭');
                this.closeTab(id, true);
            } else {
                ElementPlus.ElMessage.error(res.msg);
            }
        } catch(e) {
            ElementPlus.ElMessage.error('保存失败，请重试');
        }
    },
    
    // 标记 Tab 已修改
    markModified(id) {
        const tab = this.tabs.find(t => t.id === id);
        if(tab) {
            tab.modified = true;
        }
    },

    // ---- 编辑器内容强制同步钩子 ----
    // Vditor 的 input 事件在输入法组合中/防抖窗口内可能未触发，content 停留旧值；
    // 保存前必须强制从编辑器拉取最新内容（否则出现"保存成功但内容没变"）。
    // NoteEditor 挂载时注册，卸载时清除。
    editorSync: null,   // (noteId) => void：把 vditorInstance 当前值写回 note.content
    registerEditorSync(fn) {
        this.editorSync = fn;
    },
    /** 保存前调用：同步当前编辑器内容到 store（未注册或笔记未打开时静默跳过） */
    syncEditorContent() {
        try {
            this.editorSync && this.editorSync();
        } catch(e) {
            console.error('编辑器内容同步失败', e);
        }
    },
    
    // 获取当前 Tab
    get activeTab() {
        return this.tabs.find(t => t.id === this.activeTabId);
    },
    
    // 获取当前笔记数据
    get currentNote() {
        if(!this.activeTabId) return null;
        return this.notesCache[this.activeTabId];
    },

    // 未保存弹窗展示的标题（取实时缓存值，编辑过也能正确显示）
    get unsavedNoteTitle() {
        if(this.unsavedTabId === null) return '';
        return this.notesCache[this.unsavedTabId]?.title || '无标题';
    },

    // 当前分类名（移动端 header 展示用）
    get currentCateName() {
        if(this.currentCateId === null || this.currentCateId === undefined) {
            return '全部笔记';
        }
        let found = null;
        const walk = (items) => {
            for(const item of items) {
                if(item.id === this.currentCateId) { found = item; return; }
                if(item.children?.length) walk(item.children);
            }
        };
        walk(this.categories);
        return found ? (found.icon ? found.icon + ' ' + found.name : found.name) : '笔记';
    }
});

// ==================== API 调用 ====================
const api = {
    // 创建分类
    async createCate(data) {
        return await request('/api/cate/create', { method: 'POST', body: data });
    },

    // 更新分类
    async updateCate(data) {
        return await request('/api/cate/edit', { method: 'POST', body: data });
    },

    // 分类排序
    async sortCate(items) {
        return await request('/api/cate/sort', { method: 'POST', body: { items } });
    },

    // 删除分类
    async deleteCate(id) {
        return await request(`/api/cate/delete?id=${id}`);
    },

    // 创建笔记
    async createNote(data) {
        return await request('/api/note/create', { method: 'POST', body: data });
    },

    // 更新笔记
    async updateNote(data) {
        return await request('/api/note/edit', { method: 'POST', body: data });
    },

    // 删除笔记
    async deleteNote(id) {
        return await request(`/api/note/delete?id=${id}`);
    },

    // 置顶/取消置顶笔记
    async pinNote(id, isPinned) {
        return await request('/api/note/pin', {
            method: 'POST',
            body: { id, is_pinned: isPinned }
        });
    },

    // 笔记排序
    async sortNotes(items) {
        return await request('/api/note/sort', {
            method: 'POST',
            body: { items }
        });
    }
};

// ==================== 组件定义 ====================

// 分类树组件
const CategoryTree = {
    template: `
        <div class="category-tree">
            <div class="tree-header">
                <span class="tree-title">分类</span>
                <el-button size="small" text class="tree-add-btn" @click="showAddDialog">
                    <el-icon><Plus /></el-icon>
                </el-button>
            </div>
            <el-tree
                :data="categories"
                :props="treeProps"
                node-key="id"
                highlight-current
                default-expand-all
                :indent="20"
                draggable
                :allow-drop="allowDrop"
                :allow-drag="allowDrag"
                @node-drop="handleDrop"
                @node-click="handleNodeClick"
            >
                <template #default="{ node, data }">
                    <div class="tree-node">
                        <span class="node-content">
                            <span v-if="data.icon" class="node-icon">{{ data.icon }}</span>
                            <span class="node-name">{{ data.name }}</span>
                            <el-tag v-if="data.is_public" size="small" type="success">公开</el-tag>
                        </span>
                        <span v-if="!data.is_virtual" class="node-actions" @click.stop>
                            <el-button size="small" text class="node-addnote-btn" @click="createNoteInCate(data.id)">
                                <el-icon><Plus /></el-icon>
                            </el-button>
                            <el-dropdown trigger="click" @command="(cmd) => handleCommand(cmd, data)">
                                <el-icon class="action-icon"><MoreFilled /></el-icon>
                                <template #dropdown>
                                    <el-dropdown-menu>
                                        <el-dropdown-item command="add">新建子分类</el-dropdown-item>
                                        <el-dropdown-item command="edit">编辑分类</el-dropdown-item>
                                        <el-dropdown-item command="delete" divided>删除分类</el-dropdown-item>
                                    </el-dropdown-menu>
                                </template>
                            </el-dropdown>
                        </span>
                    </div>
                </template>
            </el-tree>

            <!-- 添加/编辑分类对话框 -->
            <el-dialog v-model="dialogVisible" :title="dialogTitle" width="400px" append-to-body>
                <el-form :model="cateForm" label-width="80px">
                    <el-form-item label="图标">
                        <div class="icon-selector">
                            <el-popover trigger="click" placement="bottom" :width="260">
                                <template #reference>
                                    <el-button>
                                        <span class="selected-icon">{{ cateForm.icon || '📁' }}</span>
                                        <el-icon style="margin-left: 4px;"><ArrowDown /></el-icon>
                                    </el-button>
                                </template>
                                <template #default>
                                    <div class="icon-grid">
                                        <span
                                            v-for="emoji in emojiList"
                                            :key="emoji"
                                            class="icon-item"
                                            :class="{ active: cateForm.icon === emoji }"
                                            @click="selectIcon(emoji)"
                                        >{{ emoji }}</span>
                                    </div>
                                </template>
                            </el-popover>
                            <span class="icon-preview">{{ cateForm.icon || '📁' }}</span>
                        </div>
                    </el-form-item>
                    <el-form-item label="上级分类">
                        <el-select v-model="cateForm.pid" placeholder="无（作为顶级分类）" clearable filterable>
                            <el-option
                                v-for="cate in selectableParents"
                                :key="cate.id"
                                :label="cate.name"
                                :value="cate.id"
                            />
                        </el-select>
                    </el-form-item>
                    <el-form-item label="名称">
                        <el-input v-model="cateForm.name" placeholder="分类名称" />
                    </el-form-item>
                    <el-form-item label="公开性">
                        <el-switch v-model="cateForm.is_public" active-text="公开" inactive-text="私密" />
                    </el-form-item>
                </el-form>
                <template #footer>
                    <el-button @click="dialogVisible = false">取消</el-button>
                    <el-button type="primary" @click="saveCate">保存</el-button>
                </template>
            </el-dialog>

            <div class="tree-footer">
                <div class="user-info" @click="$router.push('/admin/profile')">
                    <el-icon><User /></el-icon>
                    <span class="username">{{ store.username || '未登录' }}</span>
                </div>
                <div class="tree-footer-actions">
                    <el-button size="small" text @click="$router.push('/admin/settings')" title="站点设置">
                        <el-icon><Setting /></el-icon>
                    </el-button>
                    <el-button size="small" text @click="$router.push('/admin/tokens')" title="Token 管理">
                        <el-icon><Key /></el-icon>
                    </el-button>
                    <el-button size="small" text @click="$router.push('/admin/p2p')" title="P2P 管理">
                        <el-icon><Connection /></el-icon>
                    </el-button>
                    <el-button size="small" text @click="logout" title="退出登录">
                        <el-icon><SwitchButton /></el-icon>
                    </el-button>
                </div>
            </div>
        </div>
    `,
    setup() {
        const dialogVisible = ref(false);
        const dialogTitle = ref('添加分类');

        // 常用emoji列表
        const emojiList = [
            '📁', '📚', '📝', '💼', '🎯', '💡', '🔬', '🎨', '🎵', '📷',
            '🏠', '🌟', '🔥', '💎', '🎁', '📖', '💻', '📊', '📈', '🎓',
            '🌈', '☕', '🍎', '🚀', '⚡', '🎪', '🎭', '🎲', '🏆', '🔔'
        ];

        const cateForm = reactive({
            id: null,
            pid: 0,
            icon: '📁',
            name: '',
            is_public: false
        });

        // 上级分类可选项：排除自身及其后代（防循环引用）
        const selectableParents = computed(() => {
            const result = [{ id: 0, name: '无（顶级分类）' }];
            if(!cateForm.id) {
                // 新建：所有真实分类均可作上级
                const walk = (items, prefix = '') => {
                    for(const item of items) {
                        if(item.is_virtual) continue;
                        const label = prefix + (item.icon ? item.icon + ' ' : '') + item.name;
                        result.push({ id: item.id, name: label });
                        if(item.children?.length) walk(item.children, label + ' / ');
                    }
                };
                walk(store.categories);
            } else {
                const walk = (items, prefix = '', skipBranch = false) => {
                    for(const item of items) {
                        if(item.is_virtual) continue;
                        const isSelf = item.id === cateForm.id;
                        const label = prefix + (item.icon ? item.icon + ' ' : '') + item.name;
                        if(!isSelf && !skipBranch) {
                            result.push({ id: item.id, name: label });
                        }
                        if(item.children?.length) {
                            walk(item.children, label + ' / ', skipBranch || isSelf);
                        }
                    }
                };
                walk(store.categories);
            }
            return result;
        });

        const handleNodeClick = (data) => {
            if(data.is_virtual) {
                // 点击"全部笔记"虚拟节点
                store.currentCateId = null;
            } else {
                store.currentCateId = data.id;
            }
            // 移动端：选择分类后收起抽屉
            if(store.isMobile) {
                store.closeSidebar();
            }
        };

        // 分类树配置
        const treeProps = {
            label: 'name',
            children: 'children'
        };

        // 拖拽控制：虚拟节点不允许拖拽
        const allowDrag = (draggingNode) => {
            return !draggingNode.data.is_virtual;
        };

        // 拖拽控制：不允许放到虚拟节点内部
        const allowDrop = (draggingNode, dropNode, type) => {
            if(dropNode.data.is_virtual) {
                return false;
            }
            // 不允许拖到"全部笔记"下面成为子节点
            return true;
        };

        // 拖拽结束：保存排序
        const handleDrop = (draggingNode, dropNode, dropType, ev) => {
            // 收集所有分类的排序数据
            const items = [];
            const collectItems = (nodes, pid, sortBase) => {
                let sort = sortBase;
                for(const node of nodes) {
                    if(node.is_virtual) continue;
                    items.push({ id: node.id, sort: sort, pid: pid });
                    sort++;
                    if(node.children && node.children.length > 0) {
                        sort = collectItems(node.children, node.id, sort);
                    }
                }
                return sort;
            };

            // 遍历分类树（跳过虚拟节点"全部笔记"）
            const realCats = store.categories.filter(c => !c.is_virtual);
            collectItems(realCats, 0, 0);

            // 调用后端保存排序
            api.sortCate(items).then(res => {
                if(res.state === 1) {
                    ElementPlus.ElMessage.success('排序已保存');
                } else {
                    ElementPlus.ElMessage.error(res.msg);
                    // 刷新恢复
                    store.loadCategories();
                }
            });
        };

        const selectIcon = (emoji) => {
            cateForm.icon = emoji;
        };

        const showAddDialog = () => {
            dialogTitle.value = '添加分类';
            cateForm.id = null;
            cateForm.pid = store.currentCateId || 0;
            cateForm.icon = '📁';
            cateForm.name = '';
            cateForm.is_public = false;
            dialogVisible.value = true;
        };

        const handleCommand = async(command, data) => {
            if(command === 'add') {
                dialogTitle.value = '添加子分类';
                cateForm.id = null;
                cateForm.pid = data.id;
                cateForm.icon = '📁';
                cateForm.name = '';
                cateForm.is_public = false;
                dialogVisible.value = true;
            } else if(command === 'edit') {
                dialogTitle.value = '编辑分类';
                cateForm.id = data.id;
                cateForm.pid = data.pid;
                cateForm.icon = data.icon || '📁';
                cateForm.name = data.name;
                cateForm.is_public = data.is_public === 1;
                dialogVisible.value = true;
            } else if(command === 'delete') {
                try {
                    await ElementPlus.ElMessageBox.confirm(
                        `确定删除分类「${data.name}」吗？`,
                        '删除确认',
                        {
                            confirmButtonText: '确定删除',
                            cancelButtonText: '取消',
                            type: 'warning'
                        }
                    );
                    const res = await api.deleteCate(data.id);
                    if(res.state === 1) {
                        ElementPlus.ElMessage.success('删除成功');
                        store.loadCategories();
                    } else {
                        ElementPlus.ElMessage.error(res.msg);
                    }
                } catch(e) {
                    // 用户取消
                }
            }
        };

        const saveCate = async () => {
            if(!cateForm.name) {
                ElementPlus.ElMessage.warning('请输入分类名称');
                return;
            }

            const data = {
                ...cateForm,
                icon: cateForm.icon || '📁',
                is_public: cateForm.is_public ? 1 : 0
            };

            let res;
            if(cateForm.id) {
                res = await api.updateCate(data);
            } else {
                res = await api.createCate(data);
            }

            if(res.state === 1) {
                ElementPlus.ElMessage.success('保存成功');
                dialogVisible.value = false;
                store.loadCategories();
            } else {
                ElementPlus.ElMessage.error(res.msg);
            }
        };

        const createNote = async () => {
            // 不再检查分类，直接创建笔记
            const res = await api.createNote({
                title: '无标题笔记',
                cate_id: store.currentCateId || null,
                content: ''
            });

            if(res.state === 1) {
                const newNote = {
                    id: res.data.id,
                    title: '无标题笔记',
                    cate_id: store.currentCateId || null,
                    content: '',
                    keywords: '',
                    is_pinned: 0
                };

                store.notesCache[newNote.id] = newNote;
                store.addTab(newNote);
                ElementPlus.ElMessage.success('笔记已创建');
            } else {
                ElementPlus.ElMessage.error(res.msg);
            }
        };

        const createNoteInCate = async (cateId) => {
            // 设置当前分类
            store.currentCateId = cateId;

            const res = await api.createNote({
                title: '无标题笔记',
                cate_id: cateId,
                content: ''
            });

            if(res.state === 1) {
                const newNote = {
                    id: res.data.id,
                    title: '无标题笔记',
                    cate_id: cateId,
                    content: '',
                    keywords: '',
                    is_pinned: 0
                };

                store.notesCache[newNote.id] = newNote;
                store.addTab(newNote);
                store.loadNotes(cateId);
                ElementPlus.ElMessage.success('笔记已创建');
            } else {
                ElementPlus.ElMessage.error(res.msg);
            }
        };

        const logout = async () => {
            try {
                await ElementPlus.ElMessageBox.confirm(
                    '确定要退出登录吗？',
                    '退出确认',
                    {
                        confirmButtonText: '确定退出',
                        cancelButtonText: '取消',
                        type: 'warning'
                    }
                );
                // AJAX 退出（复用统一 request 封装）：成功后 location.replace
                // 替换历史——返回键不会回到已退出的 admin 页
                const res = await request('/admin/login/logout');
                if(res.state === 1) {
                    location.replace(res.data || '/admin/login');
                } else {
                    ElementPlus.ElMessage.error(res.msg || '退出失败');
                }
            } catch(e) {
                // 用户取消确认框 / 网络异常：留在当前页
            }
        };

        return {
            store,
            categories: computed(() => store.categories),
            treeProps,
            handleNodeClick,
            allowDrag,
            allowDrop,
            handleDrop,
            dialogVisible,
            dialogTitle,
            cateForm,
            selectableParents,
            emojiList,
            selectIcon,
            showAddDialog,
            handleCommand,
            saveCate,
            createNote,
            createNoteInCate,
            logout
        };
    }
};

// 笔记列表组件
const NoteList = {
    template: `
        <div class="note-list">
            <div class="note-list-header">
                <div class="note-list-title-wrap">
                    <span class="note-list-title">{{ store.currentCateName }}</span>
                    <span class="note-list-count">{{ store.notesTotal }}</span>
                </div>
                <div class="note-list-header-actions">
                    <el-button size="small" text @click="createNote" title="新建笔记">
                        <el-icon><Plus /></el-icon>
                    </el-button>
                    <el-button size="small" text class="toggle-note-list-btn" @click="store.noteListHidden = !store.noteListHidden" title="收起笔记列表">
                        <el-icon><DArrowLeft /></el-icon>
                    </el-button>
                </div>
            </div>
            <div class="note-list-search">
                <el-input
                    v-model="searchKeyword"
                    placeholder="搜索笔记..."
                    size="small"
                    clearable
                    @input="onSearch"
                    @clear="onSearch"
                >
                    <template #prefix>
                        <el-icon><Search /></el-icon>
                    </template>
                </el-input>
            </div>
            <div class="note-list-body" ref="noteListBody" v-loading="store.notesLoading">
                <div v-if="store.notes.length === 0 && !store.notesLoading" class="note-list-empty">
                    <span>暂无笔记</span>
                </div>
                <div
                    v-for="note in store.notes"
                    :key="note.id"
                    class="note-item"
                    :class="{ active: store.activeTabId === note.id, pinned: note.is_pinned }"
                    @click="store.openNote(note.id)"
                >
                    <div class="note-item-title">
                        <el-icon v-if="note.is_pinned" class="pin-icon"><Top /></el-icon>
                        <span class="note-item-name">{{ note.title || '无标题' }}</span>
                        <span class="note-item-time">{{ formatTime(note.update_time || note.add_time) }}</span>
                        <span class="note-item-actions" @click.stop>
                            <el-button size="small" text class="note-delete-btn" @click="deleteNote(note)">
                                <el-icon><Delete /></el-icon>
                            </el-button>
                            <el-dropdown trigger="click" @command="(cmd) => handleCommand(cmd, note)">
                                <el-icon class="action-icon"><MoreFilled /></el-icon>
                                <template #dropdown>
                                    <el-dropdown-menu>
                                        <el-dropdown-item command="rename">重命名</el-dropdown-item>
                                        <el-dropdown-item command="edit">编辑笔记</el-dropdown-item>
                                        <el-dropdown-item command="pin">{{ note.is_pinned ? '取消置顶' : '置顶' }}</el-dropdown-item>
                                        <el-dropdown-item command="delete" divided>删除笔记</el-dropdown-item>
                                    </el-dropdown-menu>
                                </template>
                            </el-dropdown>
                        </span>
                    </div>
                </div>
            </div>
            <!-- 底部分页条（总数超过每页条数才显示；el-pagination small 模式） -->
            <div class="note-list-pagination" v-if="totalPages > 1">
                <el-pagination
                    size="small"
                    layout="prev, pager, next"
                    :page-size="store.notesPageSize"
                    :total="store.notesTotal"
                    :current-page="store.notesPage"
                    :pager-count="5"
                    :disabled="store.notesLoading"
                    @current-change="goPage"
                />
            </div>
        </div>
    `,
    setup() {
        const searchKeyword = ref('');
        const noteListBody = ref(null);
        let searchTimer = null;
        let sortableInstance = null;

        // 总页数（Math.max 防 total=0 时显示 0 页）
        const totalPages = computed(() => Math.max(1, Math.ceil(store.notesTotal / store.notesPageSize)));

        // 翻页（el-pagination @current-change 直传页码）：重新加载指定页（保持当前分类与搜索词）
        const goPage = (page) => {
            if(!page || page < 1 || page > totalPages.value || page === store.notesPage) return;
            store.loadNotes(store.currentCateId, searchKeyword.value, page);
            // 翻页后列表滚回顶部
            nextTick(() => {
                if(noteListBody.value) noteListBody.value.scrollTop = 0;
            });
        };

        const initSortable = () => {
            if(!noteListBody.value) return;

            // 移动端禁用拖拽排序（避免滚动列表时误触）
            if(store.isMobile) {
                if(sortableInstance) {
                    sortableInstance.destroy();
                    sortableInstance = null;
                }
                return;
            }

            // 销毁旧实例
            if(sortableInstance) {
                sortableInstance.destroy();
            }

            sortableInstance = Sortable.create(noteListBody.value, {
                animation: 150,
                handle: '.note-item',
                filter: '.note-list-empty',
                onEnd: (evt) => {
                    if(evt.oldIndex === evt.newIndex) return;

                    // 更新 store.notes 数组顺序
                    const moved = store.notes.splice(evt.oldIndex, 1)[0];
                    store.notes.splice(evt.newIndex, 0, moved);

                    // 收集排序数据并保存
                    const items = store.notes.map((note, index) => ({
                        id: note.id,
                        sort: index
                    }));

                    api.sortNotes(items).then(res => {
                        if(res.state === 1) {
                            ElementPlus.ElMessage.success('排序已保存');
                        } else {
                            ElementPlus.ElMessage.error(res.msg);
                            store.loadNotes(store.currentCateId);
                        }
                    });
                }
            });
        };

        const onSearch = () => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => {
                store.loadNotes(store.currentCateId, searchKeyword.value);
            }, 300);
        };

        const formatTime = (timestamp) => {
            if(!timestamp) return '';
            const d = new Date(timestamp * 1000);
            const now = new Date();
            const isToday = d.toDateString() === now.toDateString();
            if(isToday) {
                return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
            }
            const yesterday = new Date(now);
            yesterday.setDate(yesterday.getDate() - 1);
            if(d.toDateString() === yesterday.toDateString()) {
                return '昨天';
            }
            if(d.getFullYear() === now.getFullYear()) {
                return (d.getMonth() + 1) + '/' + d.getDate();
            }
            return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate();
        };

        const handleCommand = async (command, note) => {
            if(command === 'rename') {
                try {
                    const { value } = await ElementPlus.ElMessageBox.prompt('请输入新的标题', '重命名', {
                        inputValue: note.title || '无标题',
                        confirmButtonText: '确定',
                        cancelButtonText: '取消',
                        inputValidator: (val) => {
                            if(!val) return '标题不能为空';
                            return true;
                        }
                    });

                    const res = await api.updateNote({ id: note.id, title: value });
                    if(res.state === 1) {
                        note.title = value;
                        ElementPlus.ElMessage.success('重命名成功');
                        // 更新缓存和 Tab
                        if(store.notesCache[note.id]) {
                            store.notesCache[note.id].title = value;
                        }
                        const tab = store.tabs.find(t => t.id === note.id);
                        if(tab) {
                            tab.title = value;
                        }
                    } else {
                        ElementPlus.ElMessage.error(res.msg);
                    }
                } catch(e) {
                    // 用户取消
                }
            } else if(command === 'edit') {
                store.openNote(note.id);
            } else if(command === 'pin') {
                const newPinned = note.is_pinned ? 0 : 1;
                const res = await api.pinNote(note.id, newPinned);
                if(res.state === 1) {
                    note.is_pinned = newPinned;
                    ElementPlus.ElMessage.success(newPinned ? '已置顶' : '已取消置顶');
                    // 更新缓存
                    if(store.notesCache[note.id]) {
                        store.notesCache[note.id].is_pinned = newPinned;
                    }
                    // 刷新笔记列表以更新排序
                    store.loadNotes(store.currentCateId);
                } else {
                    ElementPlus.ElMessage.error(res.msg);
                }
            } else if(command === 'delete') {
                try {
                    await ElementPlus.ElMessageBox.confirm('确定要删除这篇笔记吗？删除后无法恢复。', '删除确认', {
                        confirmButtonText: '确定删除',
                        cancelButtonText: '取消',
                        type: 'warning'
                    });

                    const res = await api.deleteNote(note.id);
                    if(res.state === 1) {
                        ElementPlus.ElMessage.success('删除成功');
                        store.closeTab(note.id, true);
                        // 刷新列表
                        store.loadNotes(store.currentCateId, searchKeyword.value);
                    } else {
                        ElementPlus.ElMessage.error(res.msg);
                    }
                } catch(e) {
                    // 用户取消
                }
            }
        };

        const deleteNote = async (note) => {
            try {
                await ElementPlus.ElMessageBox.confirm('确定要删除这篇笔记吗？删除后无法恢复。', '删除确认', {
                    confirmButtonText: '确定删除',
                    cancelButtonText: '取消',
                    type: 'warning'
                });

                const res = await api.deleteNote(note.id);
                if(res.state === 1) {
                    ElementPlus.ElMessage.success('删除成功');
                    store.closeTab(note.id, true);
                    // 刷新列表
                    store.loadNotes(store.currentCateId, searchKeyword.value);
                } else {
                    ElementPlus.ElMessage.error(res.msg);
                }
            } catch(e) {
                // 用户取消
            }
        };

        // 新建笔记（列表头部加号）
        const createNote = async () => {
            const res = await api.createNote({
                title: '无标题笔记',
                cate_id: store.currentCateId || null,
                content: ''
            });

            if(res.state === 1) {
                const newNote = {
                    id: res.data.id,
                    title: '无标题笔记',
                    cate_id: store.currentCateId || null,
                    content: '',
                    keywords: '',
                    is_pinned: 0
                };

                store.notesCache[newNote.id] = newNote;
                store.addTab(newNote);
                store.loadNotes(store.currentCateId);
                ElementPlus.ElMessage.success('笔记已创建');
            } else {
                ElementPlus.ElMessage.error(res.msg);
            }
        };

        // 监听分类切换，重新加载笔记
        watch(() => store.currentCateId, (newVal) => {
            store.loadNotes(newVal, searchKeyword.value);
        });

        // 初始加载
        onMounted(async () => {
            await store.loadNotes(store.currentCateId);
            // 等待 DOM 更新后初始化 SortableJS
            nextTick(() => {
                initSortable();
            });
        });

        // 监听笔记列表变化，重新初始化 SortableJS
        watch(() => store.notes.length, () => {
            nextTick(() => {
                initSortable();
            });
        });

        // 移动端状态切换时重新初始化/销毁拖拽
        watch(() => store.isMobile, () => {
            nextTick(() => {
                initSortable();
            });
        });

        return {
            store,
            searchKeyword,
            noteListBody,
            totalPages,
            goPage,
            onSearch,
            formatTime,
            handleCommand,
            deleteNote,
            createNote
        };
    }
};

// 笔记编辑器组件
const NoteEditor = {
    template: `
        <div class="note-editor" :class="{ 'meta-collapsed': store.isMobile && !metaExpanded }" v-if="note">
            <div class="editor-header">
                <input
                    v-model="note.title"
                    class="title-input"
                    placeholder="笔记标题"
                    @input="markModified"
                />
                <el-button
                    class="mobile-meta-toggle"
                    size="small"
                    text
                    @click="metaExpanded = !metaExpanded"
                    :title="metaExpanded ? '收起属性与工具栏' : '展开属性与工具栏'"
                >
                    <el-icon><InfoFilled /></el-icon>
                </el-button>
            </div>
            <div class="editor-meta" v-show="!store.isMobile || metaExpanded">
                <div class="meta-item">
                    <label>分类</label>
                    <el-select v-model="note.cate_id" size="small" placeholder="选择分类" @change="markModified" clearable>
                        <el-option
                            v-for="cate in flatCategories"
                            :key="cate.id"
                            :label="cate.name"
                            :value="cate.id"
                        />
                    </el-select>
                </div>
                <div class="meta-item">
                    <label>标签</label>
                    <el-input
                        v-model="note.keywords"
                        size="small"
                        placeholder="逗号分隔，如：python,编程"
                        @input="markModified"
                    />
                </div>
                <div class="meta-item">
                    <el-switch v-model="note.is_pinned" :active-value="1" :inactive-value="0" active-text="置顶" @change="markModified" />
                </div>
            </div>
            <div class="editor-content">
                <div id="vditor"></div>
            </div>
            <div class="backlinks-panel" v-if="backlinks && backlinks.length > 0">
                <div class="backlinks-header">
                    <el-icon><Connection /></el-icon>
                    <span>反向链接 ({{backlinks.length}})</span>
                </div>
                <div class="backlinks-list">
                    <a v-for="link in backlinks" :key="link.id" class="backlink-item" @click.prevent="openBacklink(link)">
                        {{link.title || '无标题'}}
                    </a>
                </div>
            </div>
        </div>
    `,
    setup() {
        const vditor = ref(null);
        const metaExpanded = ref(false);
        let vditorInstance = null;

        const note = computed(() => store.currentNote);

        const flatCategories = computed(() => {
            const flat = [];
            const flatten = (items, prefix = '') => {
                for(const item of items) {
                    flat.push({
                        id: item.id,
                        name: prefix + (item.icon ? item.icon + ' ' : '') + item.name
                    });
                    if(item.children?.length) {
                        flatten(item.children, prefix + (item.icon ? item.icon + ' ' : '') + item.name + ' / ');
                    }
                }
            };
            flatten(store.categories);
            return flat;
        });

        // Vditor 工具栏：
        // - PC 端不配置 = Vditor 官方默认全量工具栏
        // - 移动端基于默认清单排除低频/遮挡项：emoji、语音(record)、更多(more)、缩进(outdent/indent)
        const getToolbar = () => {
            if(!store.isMobile) {
                return undefined; // 默认工具栏
            }
            return [
                'headings', 'bold', 'italic', 'strike', 'link', '|',
                'list', 'ordered-list', 'check', '|',
                'quote', 'line', 'code', 'inline-code', '|',
                'insert-before', 'insert-after', 'upload', 'table', '|',
                'undo', 'redo', '|',
                'fullscreen', 'edit-mode'
            ];
        };

        const initVditor = () => {
            if(vditorInstance) {
                vditorInstance.destroy();
            }

            const toolbar = getToolbar();

            vditorInstance = new Vditor('vditor', {
                height: '100%',
                mode: 'wysiwyg',
                ...(toolbar ? { toolbar } : {}),
                toolbarConfig: {
                    pin: true
                },
                placeholder: '开始写作...',
                cache: { enable: false },
                cdn: '/static/common/vditor',
                lang: 'zh_CN',
                upload: {
                    url: '/api/upload/index',
                    fieldName: 'file',
                    maxFileSize: 10 * 1024 * 1024,
                    accept: 'image/*, .pdf, .doc, .docx, .xls, .xlsx, .ppt, .pptx, .txt, .zip, .rar, .7z',
                    format: (files, responseText) => {
                        const res = typeof responseText === 'string' ? JSON.parse(responseText) : responseText;
                        if(res.state === 1 && res.data && res.data.url) {
                            const succMap = {};
                            succMap[res.data.filename || files[0].name] = res.data.url;
                            return JSON.stringify({ code: 0, msg: '', data: { succMap, errFiles: [] } });
                        }
                        return JSON.stringify({ code: 1, msg: res.msg || '上传失败', data: { succMap: {}, errFiles: [files[0].name] } });
                    },
                    headers: {
                        'X-Requested-With': 'XMLHttpRequest'
                    }
                },
                after: () => {
                    if(note.value) {
                        vditorInstance.setValue(note.value.content || '');
                    }
                },
                input: () => {
                    if(note.value) {
                        note.value.content = vditorInstance.getValue();
                        store.markModified(note.value.id);
                    }
                }
            });
        };

        const markModified = () => {
            if(note.value) {
                store.markModified(note.value.id);
            }
        };

        // 注册「保存前强制同步」钩子：从 vditorInstance 拉最新内容写回 note.content。
        // input 事件在输入法组合中/防抖窗口内可能未触发，直接读 note.content 会保存旧值。
        store.registerEditorSync(() => {
            if(note.value && vditorInstance) {
                const latest = vditorInstance.getValue();
                if(latest !== (note.value.content || '')) {
                    note.value.content = latest;
                }
            }
        });
        onUnmounted(() => {
            if(store.editorSync) store.registerEditorSync(null);
        });

        watch(() => store.activeTabId, async () => {
            await nextTick();
            if(note.value && vditorInstance) {
                vditorInstance.setValue(note.value.content || '');
            }
        });

        onMounted(() => {
            // 编辑器容器在 v-if="note" 内，note 已就绪才初始化
            if(note.value) {
                initVditor();
            }
        });

        // note 异步加载到达后再初始化 Vditor（容器此时才存在）
        watch(note, (val) => {
            if(val && !vditorInstance) {
                nextTick(() => {
                    if(!vditorInstance) {
                        initVditor();
                    }
                });
            }
        });

        const backlinks = computed(() => {
            if(note.value && note.value.backlinks) {
                return note.value.backlinks;
            }
            return [];
        });

        const openBacklink = (link) => {
            store.openNote(link.id);
        };

        return {
            store,
            note,
            flatCategories,
            backlinks,
            openBacklink,
            markModified,
            metaExpanded
        };
    }
};

// 工作区主组件
const Workspace = {
    components: { CategoryTree, NoteList, NoteEditor },
    template: `
        <div class="workspace">
            <!-- 移动端顶栏 -->
            <div class="mobile-header">
                <el-button v-if="store.mobileView === 'editor'" text @click="store.backToList()" class="mobile-back-btn">
                    <el-icon><ArrowLeft /></el-icon>
                </el-button>
                <el-button v-else text @click="store.mobileSidebarOpen ? store.closeSidebar() : store.openSidebar()" class="mobile-menu-btn">
                    <el-icon><Menu /></el-icon>
                </el-button>
                <span class="mobile-title">
                    <span class="mobile-title-text">{{ store.mobileView === 'editor' ? (store.activeTab ? store.activeTab.title : '编辑笔记') : store.currentCateName }}</span>
                    <span v-if="store.mobileView !== 'editor'" class="note-list-count">{{ store.notesTotal }}</span>
                </span>
                <div class="mobile-header-actions">
                    <el-button v-if="store.mobileView === 'editor' && store.tabs.length > 0" :text="store.activeTab && store.activeTab.modified ? false : true" :type="store.activeTab && store.activeTab.modified ? 'primary' : 'default'" @click="saveNote" class="mobile-save-btn" :title="store.activeTab && store.activeTab.modified ? '有未保存修改，点击保存' : '保存'" :icon="Check">
                    </el-button>
                    <el-button v-else text @click="createNote" class="mobile-add-btn" title="新建笔记">
                        <el-icon><Plus /></el-icon>
                    </el-button>
                </div>
            </div>

            <!-- 遮罩层 -->
            <div class="sidebar-overlay" v-if="store.mobileSidebarOpen" @click="store.closeSidebar()"></div>

            <el-container>
                <el-aside width="200px" class="workspace-aside" :class="{ 'sidebar-visible': store.mobileSidebarOpen }">
                    <CategoryTree />
                </el-aside>
                <el-aside width="280px" class="note-list-aside" :class="{ 'note-list-hidden': store.noteListHidden, 'mobile-list-view': store.isMobile && store.mobileView === 'list', 'mobile-editor-behind': store.isMobile && store.mobileView === 'editor' }">
                    <NoteList />
                </el-aside>
                <el-container class="workspace-main" :class="{ 'mobile-editor-view': store.isMobile && store.mobileView === 'editor' }">
                    <el-main class="workspace-content">
                        <div class="tabs-container" v-if="store.tabs.length > 0">
                            <div class="tabs-bar">
                                <el-tabs
                                    v-model="store.activeTabId"
                                    type="card"
                                    closable
                                    @tab-remove="handleTabRemove"
                                >
                                    <el-tab-pane
                                        v-for="tab in store.tabs"
                                        :key="tab.id"
                                        :label="tab.title"
                                        :name="tab.id"
                                    >
                                        <template #label>
                                            <span class="tab-label">
                                                <span v-if="tab.modified" class="modified-dot"></span>
                                                <span class="tab-title" :title="tab.title">{{ tab.title }}</span>
                                            </span>
                                        </template>
                                    </el-tab-pane>
                                </el-tabs>
                                <div class="tabs-actions">
                                    <el-button size="small" @click="deleteNote" :disabled="!store.activeTabId">
                                        <el-icon><Delete /></el-icon> 删除
                                    </el-button>
                                    <el-button size="small" type="primary" :plain="store.activeTab && store.activeTab.modified ? false : true" @click="saveNote" :disabled="!store.activeTabId" :class="{ 'has-modified': store.activeTab && store.activeTab.modified }">
                                        <el-icon><Check /></el-icon> 保存<span v-if="store.activeTab && store.activeTab.modified" class="modified-hint">●</span>
                                    </el-button>
                                </div>
                            </div>

                            <NoteEditor />
                        </div>

                        <div v-else class="empty-state">
                            <el-empty description="点击「新建笔记」开始创作">
                                <el-button type="primary" @click="createNote">
                                    <el-icon><Plus /></el-icon> 新建笔记
                                </el-button>
                            </el-empty>
                        </div>
                    </el-main>
                </el-container>
            </el-container>

            <!-- 未保存提示弹窗（关闭 Tab 时） -->
            <el-dialog
                v-model="store.unsavedDialogVisible"
                title="未保存的修改"
                width="360px"
                append-to-body
                :close-on-click-modal="false"
                @close="store.unsavedTabId = null"
            >
                <div class="unsaved-tip">笔记「{{ store.unsavedNoteTitle }}」有未保存的修改，是否保存？</div>
                <template #footer>
                    <el-button @click="store.cancelUnsavedClose()">取消</el-button>
                    <el-button @click="store.discardUnsavedClose()">放弃</el-button>
                    <el-button type="primary" @click="store.saveUnsavedClose()">保存</el-button>
                </template>
            </el-dialog>
        </div>
    `,
    setup() {
        const Check = ElementPlusIconsVue.Check;

        const createNote = async () => {
            // 不再检查分类，直接创建笔记
            const res = await api.createNote({
                title: '无标题笔记',
                cate_id: store.currentCateId || null,
                content: ''
            });

            if(res.state === 1) {
                const newNote = {
                    id: res.data.id,
                    title: '无标题笔记',
                    cate_id: store.currentCateId || null,
                    content: '',
                    keywords: '',
                    is_pinned: 0
                };

                store.notesCache[newNote.id] = newNote;
                store.addTab(newNote);
                store.loadNotes(store.currentCateId);
                ElementPlus.ElMessage.success('笔记已创建');
            } else {
                ElementPlus.ElMessage.error(res.msg);
            }
        };

        const handleTabRemove = (id) => {
            store.closeTab(id);
        };

        const saveNote = async () => {
            if(!store.currentNote || !store.currentNote.title) {
                ElementPlus.ElMessage.warning('请输入标题');
                return;
            }

            // 强制从编辑器拉取最新内容（input 事件可能未触发完，防"保存成功但内容没变"）
            store.syncEditorContent();

            // 过滤掉虚拟字段（来自 JOIN 查询）
            const noteData = {
                id: store.currentNote.id,
                title: store.currentNote.title,
                cate_id: store.currentNote.cate_id,
                content: store.currentNote.content,
                keywords: store.currentNote.keywords,
                is_pinned: store.currentNote.is_pinned
            };

            const res = await api.updateNote(noteData);
            if(res.state === 1) {
                ElementPlus.ElMessage.success('保存成功');
                // 更新 Tab 标题
                const tab = store.tabs.find(t => t.id === store.currentNote.id);
                if(tab) {
                    tab.title = store.currentNote.title;
                    tab.modified = false;
                }
                store.loadNotes(store.currentCateId);
            } else {
                ElementPlus.ElMessage.error(res.msg);
            }
        };

        const deleteNote = async () => {
            if(!store.currentNote) return;

            try {
                await ElementPlus.ElMessageBox.confirm(
                    '确定要删除这篇笔记吗？删除后无法恢复。',
                    '删除确认',
                    {
                        confirmButtonText: '确定删除',
                        cancelButtonText: '取消',
                        type: 'warning'
                    }
                );

                const res = await api.deleteNote(store.currentNote.id);
                if(res.state === 1) {
                    ElementPlus.ElMessage.success('删除成功');
                    const deletedId = store.currentNote.id;
                    store.closeTab(deletedId, true);
                    store.loadNotes(store.currentCateId);
                } else {
                    ElementPlus.ElMessage.error(res.msg);
                }
            } catch(e) {
                // 用户取消操作
            }
        };

        return {
            store,
            Check,
            createNote,
            handleTabRemove,
            saveNote,
            deleteNote
        };
    }
};


// ==================== 站点设置页面 ====================
const SiteSettings = {
    template: `
        <div class="settings-page">
            <div class="page-header">
                <el-button class="page-header-back" text @click="$router.push('/admin')">
                    <el-icon><ArrowLeft /></el-icon>
                </el-button>
                <span class="page-header-title">站点设置</span>
                <div class="page-header-actions"></div>
            </div>
            <div class="settings-content" v-loading="loading">
                <el-form label-width="100px" class="settings-form">
                    <el-form-item v-for="item in configItems" :key="item.key" :label="item.title">
                        <el-input v-if="item.type === 'input'" v-model="item.value" />
                        <el-input v-else-if="item.type === 'textarea'" v-model="item.value" type="textarea" :rows="3" />
                        <el-input v-else v-model="item.value" />
                        <div v-if="item.tips" class="form-tips">{{item.tips}}</div>
                    </el-form-item>
                    <el-form-item>
                        <el-button type="primary" @click="saveSettings" :loading="saving">保存设置</el-button>
                    </el-form-item>
                </el-form>
            </div>
        </div>
    `,
    setup() {
        const loading = ref(true);
        const saving = ref(false);
        const configItems = ref([]);

        const loadConfig = async () => {
            loading.value = true;
            try {
                const res = await request('/api/site/get');
                if(res.state === 1) {
                    configItems.value = res.data;
                }
            } catch(e) {
                ElementPlus.ElMessage.error('加载配置失败');
            } finally {
                loading.value = false;
            }
        };

        const saveSettings = async () => {
            saving.value = true;
            try {
                const items = configItems.value.map(item => ({
                    key: item.key,
                    value: item.value
                }));
                const res = await request('/api/site/save', {
                    method: 'POST',
                    body: { items }
                });
                if(res.state === 1) {
                    ElementPlus.ElMessage.success('保存成功');
                } else {
                    ElementPlus.ElMessage.error(res.msg || '保存失败');
                }
            } catch(e) {
                ElementPlus.ElMessage.error('保存失败');
            } finally {
                saving.value = false;
            }
        };

        onMounted(() => {
            loadConfig();
        });

        return {
            loading,
            saving,
            configItems,
            saveSettings
        };
    }
};

// ==================== Token 管理页面 ====================
// 权限分组定义（与后端 app/model/token.js 保持一致）
const TOKEN_PERM_GROUPS = [
    {
        name: '分类管理',
        items: [
            {key: 'cate_read',   label: '查看'},
            {key: 'cate_create', label: '新增'},
            {key: 'cate_edit',   label: '编辑'},
            {key: 'cate_delete', label: '删除'},
        ]
    },
    {
        name: '笔记管理',
        items: [
            {key: 'note_read',   label: '查看'},
            {key: 'note_create', label: '新增'},
            {key: 'note_edit',   label: '编辑'},
            {key: 'note_delete', label: '删除'},
        ]
    }
];

const TokenManage = {
    template: `
        <div class="token-page">
            <div class="page-header">
                <el-button class="page-header-back" text @click="$router.push('/admin')">
                    <el-icon><ArrowLeft /></el-icon>
                </el-button>
                <span class="page-header-title">API Token 管理</span>
                <div class="page-header-actions">
                    <el-button size="small" text @click="showCreateDialog" title="创建 Token">
                        <el-icon><Plus /></el-icon>
                    </el-button>
                </div>
            </div>
            <div class="token-list v-loading-parent" v-loading="loading">
                <div class="table-scroll-wrapper">
                <el-table :data="tokens" stripe>
                    <el-table-column prop="name" label="名称" min-width="100" />
                    <el-table-column label="权限" min-width="200">
                        <template #default="{ row }">
                            <div class="token-perm-tags">
                                <template v-for="group in permSummary(row)" :key="group.name">
                                    <el-tag v-for="perm in group.items" :key="perm" size="small" :type="group.type" class="token-perm-tag">{{ perm }}</el-tag>
                                </template>
                                <el-tag v-if="permSummary(row).length === 0" size="small" type="danger">无权限</el-tag>
                            </div>
                        </template>
                    </el-table-column>
                    <el-table-column prop="token" label="Token" min-width="180">
                        <template #default="{ row }">
                            <span class="token-value">{{ maskToken(row.token) }}</span>
                            <el-button size="small" text @click="copyToken(row.token)">
                                <el-icon><CopyDocument /></el-icon>
                            </el-button>
                        </template>
                    </el-table-column>
                    <el-table-column label="过期时间" width="160">
                        <template #default="{ row }">
                            <span v-if="row.expire_time === 0">永不过期</span>
                            <span v-else>{{ formatTime(row.expire_time) }}</span>
                        </template>
                    </el-table-column>
                    <el-table-column label="操作" width="120" fixed="right">
                        <template #default="{ row }">
                            <el-button size="small" text @click="showEditDialog(row)">编辑</el-button>
                            <el-button size="small" type="danger" text @click="deleteToken(row)">删除</el-button>
                        </template>
                    </el-table-column>
                </el-table>
                </div>
                <div v-if="tokens.length === 0 && !loading" class="token-empty">
                    暂无 Token，点击上方按钮创建
                </div>
            </div>

            <!-- 创建/编辑 Token 对话框 -->
            <el-dialog v-model="dialogVisible" :title="editingId ? '编辑 Token' : '创建 Token'" width="450px">
                <el-form :model="tokenForm" label-width="80px">
                    <el-form-item label="名称">
                        <el-input v-model="tokenForm.name" placeholder="如：手机端API" />
                    </el-form-item>
                    <el-form-item label="过期时间">
                        <el-select v-model="tokenForm.expire_type" style="width: 100%" :disabled="!!editingId && keepExpire">
                            <el-option label="永不过期" value="0" />
                            <el-option label="30天" value="30" />
                            <el-option label="90天" value="90" />
                            <el-option label="1年" value="365" />
                            <el-option label="自定义" value="custom" />
                        </el-select>
                        <el-checkbox v-model="keepExpire" v-if="!!editingId" class="keep-expire-check">保持原过期时间不变</el-checkbox>
                    </el-form-item>
                    <el-form-item v-if="tokenForm.expire_type === 'custom' && !(!!editingId && keepExpire)" label="自定义天数">
                        <el-input-number v-model="tokenForm.custom_days" :min="1" :max="3650" />
                    </el-form-item>
                    <el-form-item label="权限">
                        <div class="perm-groups">
                            <div v-for="group in TOKEN_PERM_GROUPS" :key="group.name" class="perm-group">
                                <div class="perm-group-header">
                                    <span>{{ group.name }}</span>
                                    <el-checkbox v-model="groupAll[group.name]" @change="toggleGroup(group)" class="perm-group-all">全选</el-checkbox>
                                </div>
                                <el-checkbox-group v-model="tokenForm.permissions_arr" class="perm-group-items">
                                    <el-checkbox v-for="item in group.items" :key="item.key" :value="item.key">{{ item.label }}</el-checkbox>
                                </el-checkbox-group>
                            </div>
                        </div>
                    </el-form-item>
                </el-form>
                <template #footer>
                    <el-button @click="dialogVisible = false">取消</el-button>
                    <el-button type="primary" @click="submitToken" :loading="creating">{{ editingId ? '保存' : '创建' }}</el-button>
                </template>
            </el-dialog>
        </div>
    `,
    setup() {
        const loading = ref(true);
        const creating = ref(false);
        const dialogVisible = ref(false);
        const tokens = ref([]);
        const editingId = ref(null);
        const keepExpire = ref(true);

        const tokenForm = reactive({
            name: '',
            expire_type: '0',
            custom_days: 30,
            permissions_arr: []
        });

        // 分组全选状态
        const groupAll = reactive({});

        const loadTokens = async () => {
            loading.value = true;
            try {
                const res = await request('/api/token/list');
                if(res.state === 1) {
                    tokens.value = res.data;
                }
            } catch(e) {
                ElementPlus.ElMessage.error('加载 Token 失败');
            } finally {
                loading.value = false;
            }
        };

        // 列表权限摘要：[{name, type, items:['查看','新增']}]
        const permSummary = (row) => {
            const result = [];
            TOKEN_PERM_GROUPS.forEach(group => {
                const items = [];
                group.items.forEach(item => {
                    if(row.permissions_arr && row.permissions_arr.includes(item.key)) {
                        items.push(item.label);
                    } else if(row.perm_groups) {
                        // 后端返回的勾选态
                        const g = row.perm_groups.find(pg => pg.name === group.name);
                        const it = g && g.items.find(i => i.key === item.key);
                        if(it && it.checked) items.push(item.label);
                    }
                });
                if(items.length) {
                    result.push({name: group.name, type: group.name === '分类管理' ? 'primary' : 'success', items});
                }
            });
            return result;
        };

        const refreshGroupAll = () => {
            TOKEN_PERM_GROUPS.forEach(group => {
                groupAll[group.name] = group.items.every(item => tokenForm.permissions_arr.includes(item.key));
            });
        };

        const toggleGroup = (group) => {
            if(groupAll[group.name]) {
                // 全选：加上缺失项
                group.items.forEach(item => {
                    if(!tokenForm.permissions_arr.includes(item.key)) {
                        tokenForm.permissions_arr.push(item.key);
                    }
                });
            } else {
                // 取消全选：移除该组全部
                const groupKeys = group.items.map(item => item.key);
                tokenForm.permissions_arr = tokenForm.permissions_arr.filter(k => !groupKeys.includes(k));
            }
        };

        // 监听权限勾选变化，同步全选框
        watch(() => tokenForm.permissions_arr, refreshGroupAll, {deep: true});

        const showCreateDialog = () => {
            editingId.value = null;
            keepExpire.value = true;
            tokenForm.name = '';
            tokenForm.expire_type = '0';
            tokenForm.custom_days = 30;
            tokenForm.permissions_arr = [];
            refreshGroupAll();
            dialogVisible.value = true;
        };

        const showEditDialog = (row) => {
            editingId.value = row.id;
            keepExpire.value = true;
            tokenForm.name = row.name;

            // 过期时间回显：0=永不过期，否则算剩余天数
            if(row.expire_time === 0) {
                tokenForm.expire_type = '0';
            } else {
                const remainDays = Math.ceil((row.expire_time * 1000 - Date.now()) / 86400000);
                tokenForm.expire_type = remainDays > 0 ? String(remainDays) : '0';
            }
            tokenForm.custom_days = 30;

            // 权限回显：优先后端 perm_groups 勾选态
            tokenForm.permissions_arr = [];
            if(row.perm_groups) {
                row.perm_groups.forEach(g => g.items.forEach(item => {
                    if(item.checked) tokenForm.permissions_arr.push(item.key);
                }));
            }
            refreshGroupAll();
            dialogVisible.value = true;
        };

        const submitToken = async () => {
            if(!tokenForm.name) {
                ElementPlus.ElMessage.warning('请输入名称');
                return;
            }
            if(tokenForm.permissions_arr.length === 0) {
                ElementPlus.ElMessage.warning('请至少勾选一项权限');
                return;
            }

            creating.value = true;
            try {
                // 过期时间计算：编辑+保持原值 → 传 -1 让后端不动（后端按 0 处理会覆盖！改为不传字段由后端保留）
                let expire_time;
                if(editingId.value && keepExpire.value) {
                    expire_time = undefined; // 不更新过期时间
                } else if(tokenForm.expire_type === 'custom') {
                    expire_time = Math.floor(Date.now() / 1000) + tokenForm.custom_days * 86400;
                } else if(tokenForm.expire_type !== '0') {
                    expire_time = Math.floor(Date.now() / 1000) + parseInt(tokenForm.expire_type) * 86400;
                } else {
                    expire_time = 0;
                }

                const body = {
                    name: tokenForm.name,
                    permissions_arr: [...tokenForm.permissions_arr]
                };
                if(editingId.value) body.id = editingId.value;
                if(expire_time !== undefined) body.expire_time = expire_time;

                const res = await request(editingId.value ? '/api/token/edit' : '/api/token/create', {
                    method: 'POST',
                    body
                });

                if(res.state === 1) {
                    ElementPlus.ElMessage.success(editingId.value ? '保存成功' : '创建成功');
                    dialogVisible.value = false;
                    loadTokens();
                } else {
                    ElementPlus.ElMessage.error(res.msg || '操作失败');
                }
            } catch(e) {
                ElementPlus.ElMessage.error('操作失败');
            } finally {
                creating.value = false;
            }
        };

        const deleteToken = async (token) => {
            try {
                await ElementPlus.ElMessageBox.confirm(
                    `确定删除 Token「${token.name}」吗？删除后使用此 Token 的客户端将无法访问。`,
                    '删除确认',
                    { type: 'warning' }
                );

                const res = await request(`/api/token/delete?id=${token.id}`);
                if(res.state === 1) {
                    ElementPlus.ElMessage.success('删除成功');
                    loadTokens();
                } else {
                    ElementPlus.ElMessage.error(res.msg || '删除失败');
                }
            } catch(e) {
                // 用户取消
            }
        };

        const maskToken = (token) => {
            if(!token || token.length < 16) return token;
            return token.substring(0, 8) + '...' + token.substring(token.length - 8);
        };

        const copyToken = (token) => {
            navigator.clipboard.writeText(token).then(() => {
                ElementPlus.ElMessage.success('已复制到剪贴板');
            }).catch(() => {
                ElementPlus.ElMessage.error('复制失败');
            });
        };

        const formatTime = (timestamp) => {
            if(!timestamp) return '';
            const d = new Date(timestamp * 1000);
            return d.toLocaleString('zh-CN');
        };

        onMounted(() => {
            loadTokens();
        });

        return {
            TOKEN_PERM_GROUPS,
            loading,
            creating,
            dialogVisible,
            tokens,
            tokenForm,
            editingId,
            keepExpire,
            groupAll,
            permSummary,
            toggleGroup,
            showCreateDialog,
            showEditDialog,
            submitToken,
            deleteToken,
            maskToken,
            copyToken,
            formatTime
        };
    }
};

// ==================== 账户信息页面 ====================
const UserProfile = {
    template: `
        <div class="profile-page">
            <div class="page-header">
                <el-button class="page-header-back" text @click="$router.push('/admin')">
                    <el-icon><ArrowLeft /></el-icon>
                </el-button>
                <span class="page-header-title">账户信息</span>
                <div class="page-header-actions"></div>
            </div>
            <div class="profile-content" v-loading="loading">
                <el-form :model="userForm" label-width="90px" class="profile-form">
                    <el-form-item label="用户名">
                        <el-input v-model="userForm.username" placeholder="用户名" />
                    </el-form-item>
                    <el-form-item label="新密码">
                        <el-input v-model="userForm.password" type="password" placeholder="留空则不修改" show-password />
                    </el-form-item>
                    <el-form-item label="确认密码">
                        <el-input v-model="userForm.confirmPassword" type="password" placeholder="再次输入新密码" show-password />
                    </el-form-item>
                    <el-form-item>
                        <el-button type="primary" @click="saveUser" :loading="saving">保存修改</el-button>
                    </el-form-item>
                </el-form>
            </div>
        </div>
    `,
    setup() {
        const loading = ref(true);
        const saving = ref(false);
        const userForm = reactive({
            username: '',
            password: '',
            confirmPassword: ''
        });

        onMounted(async () => {
            try {
                const data = await request('/api/user/info');
                if(data.state === 1) {
                    userForm.username = data.data.username || '';
                }
            } catch(e) {
                console.error('加载用户信息失败', e);
            } finally {
                loading.value = false;
            }
        });

        const saveUser = async () => {
            if(!userForm.username) {
                ElementPlus.ElMessage.warning('用户名不能为空');
                return;
            }

            if(userForm.password && userForm.password !== userForm.confirmPassword) {
                ElementPlus.ElMessage.warning('两次输入的密码不一致');
                return;
            }

            saving.value = true;
            try {
                const res = await request('/api/user/edit', {
                    method: 'POST',
                    body: {
                        username: userForm.username,
                        password: userForm.password || undefined
                    }
                });

                if(res.state === 1) {
                    ElementPlus.ElMessage.success('保存成功');
                    store.username = userForm.username;
                } else {
                    ElementPlus.ElMessage.error(res.msg || '保存失败');
                }
            } catch(e) {
                ElementPlus.ElMessage.error('保存失败');
            } finally {
                saving.value = false;
            }
        };

        return {
            userForm,
            loading,
            saving,
            saveUser
        };
    }
};

// ==================== P2P 管理页面 ====================
const P2pManage = {
    template: `
        <div class="p2p-page">
            <div class="page-header">
                <el-button class="page-header-back" text @click="$router.push('/admin')">
                    <el-icon><ArrowLeft /></el-icon>
                </el-button>
                <span class="page-header-title">P2P 管理</span>
                <div class="page-header-actions">
                    <el-button size="small" text @click="showIdDialog" title="本节点 ID 与二维码">
                        <el-icon class="p2p-icon-qr"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 3h7v7H3V3zm2 2v3h3V5H5zM14 3h7v7h-7V3zm2 2v3h3V5h-3zM3 14h7v7H3v-7zm2 2v3h3v-3H5zM14 14h3v3h-3v-3zM18 14h3v3h-3v-3zM14 18h3v3h-3v-3zM18 18h3v3h-3v-3z"/></svg></el-icon>
                    </el-button>
                </div>
            </div>

            <div class="p2p-content v-loading-parent" v-loading="loading">
                <!-- 本节点 ID 卡片 -->
                <div class="p2p-node-card">
                    <div class="p2p-node-label">本节点 ID（手机端填这个，或扫右侧二维码）</div>
                    <div class="p2p-node-id-row" v-if="status.nodeId">
                        <span class="p2p-node-id-main">{{ shortNodeId }}</span>
                        <span class="p2p-node-id-toggle" @click="idExpanded = !idExpanded" title="点击展开/收起完整 ID">
                            {{ idExpanded ? '收起 ▲' : '完整 ID ▼' }}
                        </span>
                    </div>
                    <div class="p2p-node-id" v-if="status.nodeId && idExpanded" style="margin-top: 4px">{{ status.nodeId }}</div>
                    <div class="p2p-node-id" :class="{offline: !status.running}" v-if="!status.nodeId">P2P 服务未启动</div>
                    <div class="p2p-node-id-actions" v-if="status.nodeId">
                        <el-button size="small" text @click="copyNodeId" title="复制完整 ID">
                            <el-icon><CopyDocument /></el-icon> 复制
                        </el-button>
                        <el-button size="small" text @click="showIdDialog" title="显示二维码">
                            <el-icon class="p2p-icon-qr"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 3h7v7H3V3zm2 2v3h3V5H5zM14 3h7v7h-7V3zm2 2v3h3V5h-3zM3 14h7v7H3v-7zm2 2v3h3v-3H5zM14 14h3v3h-3v-3zM18 14h3v3h-3v-3zM14 18h3v3h-3v-3zM18 18h3v3h-3v-3z"/></svg></el-icon> 二维码
                        </el-button>
                    </div>
                </div>

                <!-- 待授权配对请求 -->
                <div v-if="status.pending && status.pending.length" class="p2p-pending-section">
                    <div class="p2p-section-title">
                        待授权配对请求
                        <el-badge :value="status.pending.length" type="warning" />
                    </div>
                    <div v-for="p in status.pending" :key="p.id" class="p2p-pending-item">
                        <div class="p2p-pending-info">
                            <span class="p2p-pending-id">{{ p.id }}</span>
                            <span class="p2p-pending-time">{{ formatTime(p.time) }} 尝试 {{ p.attempts }} 次</span>
                        </div>
                        <div class="p2p-pending-actions">
                            <el-button size="small" type="primary" @click="authorize(p)">授权</el-button>
                            <el-button size="small" @click="dismiss(p)">忽略</el-button>
                        </div>
                    </div>
                </div>

                <!-- 白名单 -->
                <div class="p2p-section-title">已配对设备（白名单）</div>
                <div class="table-scroll-wrapper">
                <el-table :data="status.peers" stripe>
                    <el-table-column prop="name" label="名称" min-width="100">
                        <template #default="{ row }">
                            <span v-if="row.name">{{ row.name }}</span>
                            <span v-else class="p2p-unnamed">未命名</span>
                        </template>
                    </el-table-column>
                    <el-table-column prop="id" label="节点 ID" min-width="140">
                        <template #default="{ row }">
                            <el-tooltip :content="row.id" placement="top" :show-after="300">
                                <span class="p2p-peer-id">{{ row.id.substring(0, 10) }}…</span>
                            </el-tooltip>
                        </template>
                    </el-table-column>
                    <el-table-column label="状态" width="90">
                        <template #default="{ row }">
                            <el-tag v-if="row.online" type="success" size="small">在线</el-tag>
                            <el-tag v-else type="info" size="small">离线</el-tag>
                        </template>
                    </el-table-column>
                    <el-table-column label="配对时间" width="150">
                        <template #default="{ row }">
                            <span>{{ formatTime(row.time) }}</span>
                        </template>
                    </el-table-column>
                    <el-table-column label="操作" width="120" fixed="right">
                        <template #default="{ row }">
                            <el-button size="small" type="danger" text @click="removePeer(row)">移除</el-button>
                        </template>
                    </el-table-column>
                </el-table>
                </div>
                <div v-if="status.peers && status.peers.length === 0 && !loading" class="p2p-empty">
                    暂无配对设备。手机端 App 填入本节点 ID 并连接后，会在这里出现配对请求。
                </div>

                <!-- 手动添加 -->
                <div class="p2p-manual-add">
                    <div class="p2p-section-title">手动添加</div>
                    <div class="p2p-manual-row">
                        <el-input v-model="manualId" placeholder="手机节点 ID（App 里显示/扫码获得）" size="default" clearable />
                        <el-input v-model="manualName" placeholder="名称（如：我的手机）" size="default" style="width: 200px" />
                        <el-button type="primary" @click="addManual" :disabled="!manualId">添加</el-button>
                    </div>
                </div>
            </div>

            <!-- 节点 ID 二维码弹窗（手机扫码用） -->
            <el-dialog v-model="idDialogVisible" title="本节点 ID" width="360px" class="p2p-qrcode-dialog">
                <div class="p2p-qrcode-body" v-loading="qrcodeLoading">
                    <img v-if="qrcodeData" :src="qrcodeData" class="p2p-qrcode-img" alt="节点 ID 二维码" />
                    <div class="p2p-qrcode-id" v-if="status.nodeId">{{ status.nodeId }}</div>
                    <div class="p2p-qrcode-tip">手机端 App 扫此码即可填入节点 ID</div>
                </div>
            </el-dialog>

            <!-- 授权确认弹窗（新配对请求） -->
            <el-dialog v-model="authorizeDialogVisible" title="P2P 配对请求" width="420px">
                <div class="p2p-authorize-body">
                    <p>检测到新设备连接：</p>
                    <div class="p2p-authorize-id">{{ authorizeTarget ? authorizeTarget.id : '' }}</div>
                    <p class="p2p-authorize-tip">请确认这是你自己的设备（ID 来自加密握手，不可伪造）。</p>
                    <el-input v-model="authorizeName" placeholder="设备名称（如：我的手机，可留空）" style="margin-top: 12px" />
                </div>
                <template #footer>
                    <el-button @click="dismissAuthorize">拒绝</el-button>
                    <el-button type="primary" @click="confirmAuthorize">授权</el-button>
                </template>
            </el-dialog>
        </div>
    `,
    setup() {
        const loading = ref(true);
        const status = ref({running: false, nodeId: '', peers: [], pending: [], online: []});
        const idDialogVisible = ref(false);
        const qrcodeData = ref('');
        const qrcodeLoading = ref(false);
        const authorizeDialogVisible = ref(false);
        const authorizeTarget = ref(null);
        const authorizeName = ref('');
        const manualId = ref('');
        const manualName = ref('');
        const idExpanded = ref(false);
        const shortNodeId = computed(() => (status.value.nodeId || '').substring(0, 10));

        let pollTimer = null;
        // 已弹窗提醒过的配对请求（避免轮询期间重复弹）
        const notifiedPairings = new Set();

        const loadStatus = async () => {
            try {
                const res = await request('/api/p2p/status');
                if(res.state === 1) {
                    const prevPendingIds = new Set(status.value.pending.map(p => p.id));
                    status.value = res.data;
                    // 新配对请求到达 → 自动弹授权窗
                    res.data.pending.forEach(p => {
                        if(!prevPendingIds.has(p.id) && !notifiedPairings.has(p.id)) {
                            notifiedPairings.add(p.id);
                            authorizeTarget.value = p;
                            authorizeName.value = '';
                            authorizeDialogVisible.value = true;
                        }
                    });
                }
            } catch(e) { /* 轮询失败静默 */ }
        };

        const startPoll = () => {
            pollTimer = setInterval(loadStatus, 3000);
        };
        const stopPoll = () => {
            if(pollTimer) { clearInterval(pollTimer); pollTimer = null; }
        };

        const copyNodeId = () => {
            navigator.clipboard.writeText(status.value.nodeId).then(() => {
                ElementPlus.ElMessage.success('已复制到剪贴板');
            }).catch(() => {
                ElementPlus.ElMessage.error('复制失败');
            });
        };

        const showIdDialog = async () => {
            idDialogVisible.value = true;
            if(!qrcodeData.value) {
                qrcodeLoading.value = true;
                try {
                    const res = await request('/api/p2p/qrcode');
                    if(res.state === 1) {
                        qrcodeData.value = res.data.qrcode;
                    } else {
                        ElementPlus.ElMessage.error(res.msg || '生成二维码失败');
                    }
                } catch(e) {
                    ElementPlus.ElMessage.error('生成二维码失败');
                } finally {
                    qrcodeLoading.value = false;
                }
            }
        };

        // 列表上的「授权」按钮（与弹窗共用逻辑）
        const authorize = (p) => {
            authorizeTarget.value = p;
            authorizeName.value = p.name || '';
            authorizeDialogVisible.value = true;
        };

        const confirmAuthorize = async () => {
            if(!authorizeTarget.value) return;
            try {
                const res = await request('/api/p2p/authorize', {
                    method: 'POST',
                    body: { id: authorizeTarget.value.id, name: authorizeName.value }
                });
                if(res.state === 1) {
                    ElementPlus.ElMessage.success(res.msg || '已授权');
                    notifiedPairings.delete(authorizeTarget.value.id);
                    authorizeDialogVisible.value = false;
                    authorizeTarget.value = null;
                    loadStatus();
                } else {
                    ElementPlus.ElMessage.error(res.msg || '操作失败');
                }
            } catch(e) {
                ElementPlus.ElMessage.error('操作失败');
            }
        };

        const dismissAuthorize = async () => {
            if(authorizeTarget.value) {
                try {
                    await request('/api/p2p/dismiss', { method: 'POST', body: { id: authorizeTarget.value.id } });
                } catch(e) { /* 忽略 */ }
                notifiedPairings.delete(authorizeTarget.value.id);
            }
            authorizeDialogVisible.value = false;
            authorizeTarget.value = null;
            loadStatus();
        };

        const dismiss = async (p) => {
            try {
                const res = await request('/api/p2p/dismiss', { method: 'POST', body: { id: p.id } });
                if(res.state === 1) {
                    notifiedPairings.delete(p.id);
                    ElementPlus.ElMessage.success('已忽略');
                    loadStatus();
                }
            } catch(e) { /* 忽略 */ }
        };

        const addManual = async () => {
            if(!manualId.value.trim()) return;
            try {
                const res = await request('/api/p2p/add', {
                    method: 'POST',
                    body: { id: manualId.value.trim(), name: manualName.value.trim() }
                });
                if(res.state === 1) {
                    ElementPlus.ElMessage.success(res.msg || '已添加');
                    manualId.value = '';
                    manualName.value = '';
                    loadStatus();
                } else {
                    ElementPlus.ElMessage.error(res.msg || '添加失败');
                }
            } catch(e) {
                ElementPlus.ElMessage.error('操作失败');
            }
        };

        const removePeer = async (peer) => {
            try {
                await ElementPlus.ElMessageBox.confirm(
                    `确定移除设备「${peer.name || peer.id.substring(0, 16) + '…'}」吗？移除后该设备将无法连接。`,
                    '移除确认',
                    { type: 'warning' }
                );
                const res = await request('/api/p2p/remove', { method: 'POST', body: { id: peer.id } });
                if(res.state === 1) {
                    ElementPlus.ElMessage.success('已移除');
                    loadStatus();
                } else {
                    ElementPlus.ElMessage.error(res.msg || '移除失败');
                }
            } catch(e) { /* 用户取消 */ }
        };

        const formatTime = (timestamp) => {
            if(!timestamp) return '';
            const d = new Date(timestamp * 1000);
            return d.toLocaleString('zh-CN');
        };

        onMounted(() => {
            loadStatus().then(() => { loading.value = false; });
            startPoll();
        });

        onUnmounted(() => {
            stopPoll();
        });

        return {
            status,
            loading,
            idDialogVisible,
            qrcodeData,
            qrcodeLoading,
            authorizeDialogVisible,
            authorizeTarget,
            authorizeName,
            manualId,
            manualName,
            idExpanded,
            shortNodeId,
            copyNodeId,
            showIdDialog,
            authorize,
            confirmAuthorize,
            dismissAuthorize,
            dismiss,
            addManual,
            removePeer,
            formatTime
        };
    }
};

// ==================== 路由配置 ====================
const routes = [
    { path: '/', redirect: '/admin' },
    { path: '/admin', component: Workspace },
    { path: '/admin/settings', component: SiteSettings },
    { path: '/admin/tokens', component: TokenManage },
    { path: '/admin/p2p', component: P2pManage },
    { path: '/admin/profile', component: UserProfile }
];

const router = createRouter({
    history: createWebHashHistory(),
    routes
});

// ==================== 创建应用 ====================
const app = createApp({
    template: '<router-view/>',
    mounted() {
        store.init();
    }
});

app.use(ElementPlus);
app.use(ElementPlusLocaleZhCn);
app.use(router);

// 注册 Element Plus 图标
for(const [key, component] of Object.entries(ElementPlusIconsVue)) {
    app.component(key, component);
}

app.mount('#app');
