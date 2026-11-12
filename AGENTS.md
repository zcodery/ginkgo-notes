# AGENTS.md — 银杏笔记 AI 协作上下文

> 任何 AI 编码工具（Trae / Cursor / Windsurf / Continue / Copilot ...）在本项目上工作时，先读这份文件。
> 这份文件 **唯一放根目录一份**，git 管理，跨电脑跨工具同步。

## 1. 项目身份

**银杏笔记**（GinkgoNotes）是一个 Markdown-first 的个人笔记应用。
- 后端：Node.js + Hono + SQLite + Better-SQLite3
- 前端：Vue 3 + Vite + TipTap (ProseMirror) + Pinia + Naive UI
- 实时同步：Yjs + WebSocket
- 特性：多层块引用、Mermaid/Code 高亮、多维表格、AI 代理（OpenAI 兼容）、MCP 服务器、Webhook、SMTP 邮件、公开分享、成员协作

## 2. 核心事实源

- **进度与架构真相** → `PROGRESS.md`（根目录）
- **提交与模块规范** → 本文件 §4 和 `scripts/commit-all.cjs`
- **数据库表结构** → `server/db.ts`（运行时建表）+ PROGRESS.md §8

## 3. PROGRESS.md 维护规范

### 什么时候更新

- 用户显式说"更新/同步 PROGRESS.md"、"维护进度文档"
- 大范围代码变动后（分模块提交前跑一次）
- 功能闭环完成后

### 执行流程（必须按顺序）

**Step 1 — 采集 Git 现状**

```bash
git status --short
git diff --stat
git log --oneline -30
git log origin/main..HEAD --oneline   # 未推送提交
```

shell 不可用时，退读 `.git/logs/HEAD`，跳过 diff 并报告。

**Step 2 — 扫描新增文件**

```bash
find server -name '*.ts' | sort
find src -name '*.ts' -o -name '*.vue' | sort
grep -E "\.(get|post|put|patch|delete)\(" server/routes.ts server/features.ts
```

重点关注：`server/` 新业务文件、`src/editor/nodes/` 新 TipTap 节点、`src/blocks/` 新 NodeView、`src/components/` 大型组件、`src/views/` 新路由页。

**Step 3 — 增量更新 PROGRESS.md（不要重写整个文件）**

| Section | 规则 |
|---|---|
| §1 项目概览 | 版本变才改；设计原则除非推翻不动 |
| §2 目录与分层 | 新增文件追加；用途变化改描述 |
| §3 已实现功能 | 闭环完成时追加；P1→P0 时移动行 |
| §4 API 路由 | 新增路由按模块追加 |
| §5 Git 历史 | 倒序追加；HEAD 行 hash 和 subject 必须精确等于 `git log -1 --format='%h %s'` |
| §6 模块规范 | 不动 |
| §7 构建 | scripts / env 变了才改 |
| §8 DB | 跟 server/db.ts 同步 |
| §9 陷阱 | 新坑追加；修复时加 "(已修复 YYYY-MM-DD)" |
| §10 维护 | 不动 |

**Step 4 — 不要自动 commit**

改完报告改了哪些 section，让用户决定。

### PROGRESS.md 结构（必须匹配，所有 AI 按此定位 section）

```
PROGRESS.md
├── §1  项目概览（技术栈 + 设计原则）
├── §2  目录与分层（server/ + src/ 逐文件说明）
├── §3  已实现功能清单（P0/P1/P2 三张表）
├── §4  API 路由速查
├── §5  Git 提交历史（倒序表格 + HEAD 指向）
├── §6  模块分层规范
├── §7  构建与启动
├── §8  数据库表结构
├── §9  常见陷阱
└── §10 维护说明
```

### 硬约束

1. **绝不重写整个 PROGRESS.md**，只 delta 编辑。
2. **绝不猜**，文件没读就不知道它干嘛的。
3. **表格格式严格一致**，新增行列数和对齐必须和现有行一样。
4. **HEAD 行精确**，hash 和 subject 必须和 `git log -1` 完全一致。
5. **shell 失败时不伪造**，直说哪些部分采不到。
6. **尊重手动标记**：如果 PROGRESS.md 里有 `<!-- 手动维护 -->` 或 `[待 AI 核对]`，AI 不去覆盖。

## 4. Commit 规范

### 格式

```
<type>(<scope>): <subject>

【新增】<语义描述，不是路径>
【修改】<语义描述，不是路径>
【删除】<语义描述，不是路径>
```

### 类型

- `feat` — 新功能
- `feat(server)` — 后端改动
- `feat(editor)` — TipTap / 编辑器内核
- `feat(blocks)` — 高级块
- `feat(ui)` — 组件 / 页面
- `feat(i18n)` — 国际化
- `feat(core)` — App 外壳 / 全局状态
- `docs` — 文档
- `chore` — 构建、脚本、配置

### 操作标签

commit body 每行内联一个操作标签，用于后续自动生成 CHANGELOG：
- `【新增】` — 新增文件 / 新增 export / 新增组件
- `【修改】` — 改动内容（用语义描述，不要写路径 + 行数）
- `【删除】` — 删除文件或移除功能
- `【重命名】` — 重命名 / 移动文件

描述要讲"改了什么"，不要"改了哪个文件"：

**❌ 坏**：`【修改】src/editor/BlockEditor.vue`
**✅ 好**：`【修改】TipTap 编辑器：新增 PageLinkBlock、PageToc 组件`

### 模块分层顺序（自底向上，每个 commit 自身可编译运行）

1. 基础设施（脚本 / 配置）
2. 后端核心（DB / 认证 / HTTP）
3. 后端 API 路由
4. 后端集成（共享 / 协作 / AI / MCP / Webhook / 通知）
5. 编辑器内核
6. 高级块
7. 通用组件
8. 路由页面
9. 国际化
10. 导入导出与只读渲染
11. 前端 API 层与数据仓储
12. 应用外壳与全局状态
13. 文档
14. Skill / AI 配置

### 分模块提交脚本

```bash
# 从 origin/main 撤回全部 commit，保留工作区改动
node scripts/reset-to-base.cjs

# 按模块分组 + 生成语义描述 + 逐个 commit
node scripts/commit-all.cjs
```

脚本自动：
- 用 `git status --porcelain=v1` 同时抓索引区和工作区改动
- 用 `git diff HEAD -U0` 提取 export 名称、新增 import 符号、Vue 组件标签、TipTap API 调用等语义
- 生成带 `【新增/修改/删除/重命名】` 内联标签的 commit body
- 自动过滤 `node_modules/`、`.pnpm-store/`、`dist/`、`.trae-cn/` 等

## 5. 安全与硬规则

- 绝不把 node_modules 或 .pnpm-store 提交进仓库（Windows junction 需要脚本硬过滤）
- 绝不伪造 git 数据（shell 不可用时直说）
- 绝不硬覆盖 PROGRESS.md 的手动标记区域
- commit body 的语义描述要讲"改了什么功能"，不是"改了哪个文件"
