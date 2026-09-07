// Meknow Vue3 管理后台应用

const { createApp, ref, reactive, computed, onMounted, watch, nextTick } = Vue;
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

    // 笔记列表
    notes: [],
    notesTotal: 0,
    notesLoading: false,

    // 笔记数据缓存
    notesCache: {},

    // 初始化
    async init() {
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
                    { id: null, name: '全部笔记', icon: '📋', is_virtual: true, children: [] },
                    ...tree
                ];
            }
        } catch(e) {
            console.error('加载分类失败', e);
        }
    },

    // 加载笔记列表
    async loadNotes(cateId, keyword = '') {
        this.notesLoading = true;
        try {
            const params = new URLSearchParams();
            if(cateId !== null && cateId !== undefined) {
                params.set('cate_id', cateId);
            }
            params.set('rows', 200);
            if(keyword) params.set('q', keyword);
            const data = await request(`/api/note/list?${params}`);
            if(data.state === 1) {
                this.notes = data.data.list || [];
                this.notesTotal = data.data.total || 0;
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
        
        // 加载笔记数据
        this.loadNote(note.id);
    },
    
    // 关闭 Tab
    closeTab(id) {
        const index = this.tabs.findIndex(t => t.id === id);
        if(index === -1) return;
        
        // 如果有修改，提示用户
        const tab = this.tabs[index];
        if(tab.modified) {
            if(!confirm('笔记已修改，是否放弃保存？')) {
                return;
            }
        }
        
        this.tabs.splice(index, 1);
        
        // 如果关闭的是当前激活的 Tab
        if(this.activeTabId === id) {
            if(this.tabs.length > 0) {
                const newIndex = Math.max(0, index - 1);
                this.activeTabId = this.tabs[newIndex].id;
            } else {
                this.activeTabId = null;
            }
        }
    },
    
    // 标记 Tab 已修改
    markModified(id) {
        const tab = this.tabs.find(t => t.id === id);
        if(tab) {
            tab.modified = true;
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
    }
};

// ==================== 组件定义 ====================

// 分类树组件
const CategoryTree = {
    template: `
        <div class="category-tree">
            <div class="tree-header">
                <span class="tree-title">分类</span>
                <el-button size="small" text @click="showAddDialog">
                    <el-icon><Plus /></el-icon>
                </el-button>
            </div>
            <el-tree
                :data="categories"
                :props="{ label: 'name', children: 'children' }"
                node-key="id"
                highlight-current
                default-expand-all
                :indent="20"
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
                            <el-button size="small" text @click="createNoteInCate(data.id)">
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
            <el-dialog v-model="dialogVisible" :title="dialogTitle" width="400px">
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
                <div class="user-info" @click="showUserEdit">
                    <el-icon><User /></el-icon>
                    <span class="username">{{ store.username || '未登录' }}</span>
                </div>
                <el-button size="small" text @click="logout">
                    <el-icon><SwitchButton /></el-icon> 退出
                </el-button>
            </div>

            <!-- 用户编辑弹窗 -->
            <el-dialog v-model="userEditVisible" title="编辑用户" width="360px">
                <el-form :model="userForm" label-width="80px">
                    <el-form-item label="用户名">
                        <el-input v-model="userForm.username" placeholder="用户名" />
                    </el-form-item>
                    <el-form-item label="新密码">
                        <el-input v-model="userForm.password" type="password" placeholder="留空则不修改" show-password />
                    </el-form-item>
                    <el-form-item label="确认密码">
                        <el-input v-model="userForm.confirmPassword" type="password" placeholder="再次输入新密码" show-password />
                    </el-form-item>
                </el-form>
                <template #footer>
                    <el-button @click="userEditVisible = false">取消</el-button>
                    <el-button type="primary" @click="saveUser">保存</el-button>
                </template>
            </el-dialog>
        </div>
    `,
    setup() {
        const dialogVisible = ref(false);
        const dialogTitle = ref('添加分类');

        const userEditVisible = ref(false);
        const userForm = reactive({
            username: '',
            password: '',
            confirmPassword: ''
        });

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

        const handleNodeClick = (data) => {
            if(data.is_virtual) {
                // 点击"全部笔记"虚拟节点
                store.currentCateId = null;
            } else {
                store.currentCateId = data.id;
            }
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

        const handleCommand = (command, data) => {
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
                if(confirm(`确定删除分类「${data.name}」吗？`)) {
                    api.deleteCate(data.id).then(res => {
                        if(res.state === 1) {
                            ElementPlus.ElMessage.success('删除成功');
                            store.loadCategories();
                        } else {
                            ElementPlus.ElMessage.error(res.msg);
                        }
                    });
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

        const showUserEdit = () => {
            userForm.username = store.username || '';
            userForm.password = '';
            userForm.confirmPassword = '';
            userEditVisible.value = true;
        };

        const saveUser = async () => {
            if(!userForm.username) {
                ElementPlus.ElMessage.warning('用户名不能为空');
                return;
            }

            if(userForm.password) {
                if(userForm.password !== userForm.confirmPassword) {
                    ElementPlus.ElMessage.warning('两次输入的密码不一致');
                    return;
                }
            }

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
                userEditVisible.value = false;
            } else {
                ElementPlus.ElMessage.error(res.msg || '保存失败');
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
                window.location.href = '/admin/login?logout=1';
            } catch(e) {
                // 用户取消操作
            }
        };

        return {
            store,
            categories: computed(() => store.categories),
            handleNodeClick,
            dialogVisible,
            dialogTitle,
            cateForm,
            emojiList,
            selectIcon,
            showAddDialog,
            handleCommand,
            saveCate,
            createNote,
            createNoteInCate,
            userEditVisible,
            userForm,
            showUserEdit,
            saveUser,
            logout
        };
    }
};

// 笔记列表组件
const NoteList = {
    template: `
        <div class="note-list">
            <div class="note-list-header">
                <span class="note-list-title">笔记</span>
                <span class="note-list-count">{{ store.notesTotal }}</span>
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
            <div class="note-list-body" v-loading="store.notesLoading">
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
                            <el-button size="small" text @click="deleteNote(note)">
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
        </div>
    `,
    setup() {
        const searchKeyword = ref('');
        let searchTimer = null;

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
                        store.closeTab(note.id);
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
                    store.closeTab(note.id);
                    // 刷新列表
                    store.loadNotes(store.currentCateId, searchKeyword.value);
                } else {
                    ElementPlus.ElMessage.error(res.msg);
                }
            } catch(e) {
                // 用户取消
            }
        };

        // 监听分类切换，重新加载笔记
        watch(() => store.currentCateId, (newVal) => {
            store.loadNotes(newVal, searchKeyword.value);
        });

        // 初始加载
        onMounted(() => {
            store.loadNotes(store.currentCateId);
        });

        return {
            store,
            searchKeyword,
            onSearch,
            formatTime,
            handleCommand,
            deleteNote
        };
    }
};

// 笔记编辑器组件
const NoteEditor = {
    template: `
        <div class="note-editor" v-if="note">
            <div class="editor-header">
                <input
                    v-model="note.title"
                    class="title-input"
                    placeholder="笔记标题"
                    @input="markModified"
                />
            </div>
            <div class="editor-meta">
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
        </div>
    `,
    setup() {
        const vditor = ref(null);
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

        const initVditor = () => {
            if(vditorInstance) {
                vditorInstance.destroy();
            }

            vditorInstance = new Vditor('vditor', {
                height: '100%',
                mode: 'wysiwyg',
                placeholder: '开始写作...',
                cache: { enable: false },
                cdn: '/static/common/vditor',
                lang: 'zh_CN',
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

        watch(() => store.activeTabId, async () => {
            await nextTick();
            if(note.value && vditorInstance) {
                vditorInstance.setValue(note.value.content || '');
            }
        });

        onMounted(() => {
            initVditor();
        });

        return {
            note,
            flatCategories,
            markModified
        };
    }
};

// 工作区主组件
const Workspace = {
    components: { CategoryTree, NoteList, NoteEditor },
    template: `
        <div class="workspace">
            <el-container>
                <el-aside width="200px" class="workspace-aside">
                    <CategoryTree />
                </el-aside>
                <el-aside width="280px" class="note-list-aside">
                    <NoteList />
                </el-aside>
                <el-container class="workspace-main">
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
                                                {{ tab.title }}
                                            </span>
                                        </template>
                                    </el-tab-pane>
                                </el-tabs>
                                <el-button size="small" text @click="createNote" class="tab-add-btn">
                                    <el-icon><Plus /></el-icon>
                                </el-button>
                                <div class="tabs-actions">
                                    <el-button size="small" @click="deleteNote" :disabled="!store.activeTabId">
                                        <el-icon><Delete /></el-icon> 删除
                                    </el-button>
                                    <el-button size="small" type="primary" @click="saveNote" :disabled="!store.activeTabId">
                                        <el-icon><Check /></el-icon> 保存
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
        </div>
    `,
    setup() {
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
                    store.closeTab(deletedId);
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
            createNote,
            handleTabRemove,
            saveNote,
            deleteNote
        };
    }
};

// ==================== 路由配置 ====================
const routes = [
    { path: '/', redirect: '/admin' },
    { path: '/admin', component: Workspace }
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
