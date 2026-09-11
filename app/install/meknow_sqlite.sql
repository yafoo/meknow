-- MeNote 数据库建表脚本 (SQLite)

-- 笔记表
CREATE TABLE IF NOT EXISTS `menote_note` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT,
  `cate_id` INTEGER NOT NULL DEFAULT 0,        -- 分类 ID
  `title` VARCHAR(200) NOT NULL DEFAULT '',    -- 标题
  `content` TEXT NOT NULL DEFAULT '',          -- Markdown 内容
  `keywords` VARCHAR(200) NOT NULL DEFAULT '', -- 标签（逗号分隔）
  `is_pinned` INTEGER NOT NULL DEFAULT 0,      -- 是否置顶
  `sort` INTEGER NOT NULL DEFAULT 0,           -- 排序
  `add_time` INTEGER NOT NULL DEFAULT 0,       -- 创建时间
  `update_time` INTEGER NOT NULL DEFAULT 0     -- 更新时间
);

CREATE INDEX IF NOT EXISTS `idx_note_cate_id` ON `menote_note` (`cate_id`);
CREATE INDEX IF NOT EXISTS `idx_note_add_time` ON `menote_note` (`add_time`);

-- 分类表（树形）
CREATE TABLE IF NOT EXISTS `menote_cate` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT,
  `pid` INTEGER NOT NULL DEFAULT 0,            -- 父分类 ID，0=顶级
  `name` VARCHAR(100) NOT NULL DEFAULT '',     -- 分类名称
  `icon` VARCHAR(20) NOT NULL DEFAULT '',      -- emoji 图标
  `sort` INTEGER NOT NULL DEFAULT 0,           -- 排序
  `is_show` INTEGER NOT NULL DEFAULT 1,        -- 是否显示
  `is_public` INTEGER NOT NULL DEFAULT 0,      -- 是否公开（0=私密 1=公开），默认私密
  `add_time` INTEGER NOT NULL DEFAULT 0        -- 创建时间
);

CREATE INDEX IF NOT EXISTS `idx_cate_pid` ON `menote_cate` (`pid`);

-- 双向链接表
CREATE TABLE IF NOT EXISTS `menote_note_link` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT,
  `source_id` INTEGER NOT NULL DEFAULT 0,      -- 来源笔记 ID
  `target_id` INTEGER NOT NULL DEFAULT 0,      -- 目标笔记 ID
  `add_time` INTEGER NOT NULL DEFAULT 0        -- 创建时间
);

CREATE INDEX IF NOT EXISTS `idx_link_source` ON `menote_note_link` (`source_id`);
CREATE INDEX IF NOT EXISTS `idx_link_target` ON `menote_note_link` (`target_id`);

-- 附件表
CREATE TABLE IF NOT EXISTS `menote_attach` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT,
  `note_id` INTEGER NOT NULL DEFAULT 0,        -- 关联笔记 ID
  `filename` VARCHAR(200) NOT NULL DEFAULT '', -- 文件名
  `filepath` VARCHAR(500) NOT NULL DEFAULT '', -- 文件路径
  `filesize` INTEGER NOT NULL DEFAULT 0,       -- 文件大小（字节）
  `filetype` VARCHAR(50) NOT NULL DEFAULT '',  -- 文件类型
  `add_time` INTEGER NOT NULL DEFAULT 0        -- 上传时间
);

CREATE INDEX IF NOT EXISTS `idx_attach_note_id` ON `menote_attach` (`note_id`);

-- 用户表
CREATE TABLE IF NOT EXISTS `menote_user` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT,
  `username` VARCHAR(50) NOT NULL DEFAULT '',
  `password` VARCHAR(50) NOT NULL DEFAULT '',
  `salt` VARCHAR(20) NOT NULL DEFAULT '',
  `add_time` INTEGER NOT NULL DEFAULT 0,
  `login_time` INTEGER NOT NULL DEFAULT 0,
  `is_lock` INTEGER NOT NULL DEFAULT 0
);

-- API Token 表
CREATE TABLE IF NOT EXISTS `menote_token` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT,
  `user_id` INTEGER NOT NULL DEFAULT 0,
  `name` VARCHAR(100) NOT NULL DEFAULT '',
  `token` VARCHAR(128) NOT NULL DEFAULT '',
  `permissions` INTEGER NOT NULL DEFAULT 0,
  `expire_time` INTEGER NOT NULL DEFAULT 0,
  `add_time` INTEGER NOT NULL DEFAULT 0,
  `update_time` INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS `idx_token` ON `menote_token` (`token`);

-- 站点配置表（KV）
CREATE TABLE IF NOT EXISTS `menote_site` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT,
  `group` VARCHAR(20) NOT NULL DEFAULT '',
  `type` VARCHAR(20) NOT NULL DEFAULT '',
  `key` VARCHAR(50) NOT NULL DEFAULT '',
  `title` VARCHAR(100) NOT NULL DEFAULT '',
  `value` TEXT NOT NULL DEFAULT '',
  `tips` VARCHAR(200) NOT NULL DEFAULT '',
  `sort` INTEGER NOT NULL DEFAULT 0
);
