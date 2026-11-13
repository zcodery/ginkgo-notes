# 银杏笔记 (Ginkgo Notes) — 开发进度

> 版本 0.3.0 | 更新于 2026-11-13
> 本文档面向**下一个接手开发的 AI**，按依赖顺序记录项目架构、已实现功能与 Git 提交分块。
> 每次有新的可编译功能合并后，请执行文末的维护 skill 来更新此文件。

---

## 一、项目概览

一个基于 **Vue 3 + TipTap (ProseMirror) + Express + SQLite** 的自托管 Markdown 笔记应用，支持多维表格、Mermaid 图表、代码块、公开分享、成员协作、AI 助手、Webhook 和 MCP 协议接入。

| 维度 | 选择 |
|---|---|
| 前端 | Vue 3.5 + TipTap 3.33 + Vite 8 + TailwindCSS 4 + lucide-vue-next |
| 后端 | Express 5 + Node.js `node:sqlite` (DatabaseSync, WAL 模式) |
| 通信 | 统一 fetch 封装 (`src/api/client.ts`)，JWT 会话 + Bearer 个人令牌 |
| 序列化 | TipTap JSON ↔ Markdown **块级 1:1 映射** (`src/editor/markdown.ts`) |
| 存储 | 服务端 SQLite 为主；IndexedDB 仅作旧版迁移 (`src/db/legacy.ts`) |
| 构建 | pnpm + concurrently（开发时前后端同时起） |

### 关键设计原则

1. **Markdown 是唯一事实来源**：正文存 Markdown 字符串，TipTap 仅编辑期存在。保证 .md 可被 GitHub/Obsidian/Typora 直接渲染。
2. **引用式高级块**：多维表格是独立实体（`server/db.ts` 里的 `databases` + `db_rows` 表），正文只写 ` ```ginkgo-db <id>` fence，支持跨页复用与同步。
3. **写操作串行化**：`src/db/repo.ts` 的 `serial('page:<id>')` / `serial('db:<id>')` 防止标题/正文两路保存交错导致旧快照覆盖。
4. **只读内容走 HTML 渲染**：公开分享页用 `src/utils/renderMarkdown.ts` 白名单清洗后输出 HTML，不加载 TipTap，也不暴露任何编辑路径。
5. **编辑器状态随 Markdown 持久化**：折叠状态写成 `<!-- gn-li collapsed -->` / `<details open>`，解析时经 token 预处理还原；只读页按白名单回填，保证编辑态与分享态一致。

---

## 二、目录与分层

```
ginkgoNotes/
├── server/              # Express + node:sqlite 后端 (TS, tsx watch)
│   ├── index.ts         # 入口：种子数据 + Express 挂载
│   ├── routes.ts        # 主路由 + 认证入口 + 页面/表格/资源 CRUD
│   ├── features.ts      # 功能路由聚合（共享/成员/AI/MCP/通知/Webhook/反馈）
│   ├── auth.ts          # JWT + scrypt + 会话 + API 令牌 + 中间件
│   ├── account.ts       # 会话管理 / 2FA / PIN / GitHub OAuth / 令牌管理
│   ├── totp.ts          # RFC 6238 TOTP
│   ├── db.ts            # SQLite 建表/连接/通用 CRUD/设置
│   ├── http.ts          # HttpError / 参数校验 / IP 归一化
│   ├── templates.ts     # 公共原稿种子 + 新用户模板拷贝
│   ├── share.ts         # 公开分享链接（密码/有效期/子页）
│   ├── members.ts       # 成员协作（viewer/editor 角色）
│   ├── ai.ts            # OpenAI 兼容转发 + SSE 流式
│   ├── mcp.ts           # MCP Streamable HTTP 服务（JSON-RPC 2.0，个人令牌认证）
│   ├── webhooks.ts      # 页面事件 Webhook（HMAC-SHA256 签名）
│   ├── notify.ts        # 站内通知 + 可选 SMTP 邮件
│   └── mailer.ts        # nodemailer 懒加载封装
├── src/
│   ├── App.vue          # 路由外壳 + 公开分享页 gn-standalone 滚动模式
│   ├── main.ts
│   ├── store.ts         # Pinia 全局状态
│   ├── types.ts         # 前后端共用类型
│   ├── api/             # fetch 封装 + 按领域分组的接口清单
│   │   ├── client.ts    # Bearer 头 / 401 清理 / 空间切换头 / SSE 手写解析
│   │   └── features.ts
│   ├── db/              # 数据访问层
│   │   ├── repo.ts      # 页面/资源仓储 + serial() 写保护
│   │   ├── databases.ts # 多维表格仓储（表/字段/视图/行）
│   │   ├── legacy.ts    # 旧 IndexedDB → 新后端迁移
│   │   └── index.ts     # 旧 IndexedDB schema（只剩迁移时用）
│   ├── editor/          # TipTap 编辑器内核
│   │   ├── BlockEditor.vue   # 主编排：扩展装配、防抖保存、Slash/块/表格/AI 面板
│   │   ├── extensions.ts    # 扩展清单（含自定义 GnTableCell/Diagram/Database/PageLink）
│   │   ├── markdown.ts      # Markdown ↔ ProseMirror 块级 1:1 映射
│   │   ├── nodes/           # database / diagram / pageLink / codeBlock / tableCell / columns
│   │   │   ├── details.ts  # <details> 折叠块（open 属性 + 箭头交互）
│   │   │   ├── listFold.ts # 列表与任务项逐层折叠（collapsed 属性 + widget）
│   │   │   └── columns.ts  # 多栏分栏节点（columns/column、width 属性、Markdown 双向）
│   │   ├── foldAnim.ts     # WAAPI 折叠动画（grid 轨道 / 任务项 height / 淡入淡出）
│   │   ├── codeLanguages.ts # 语言别名归一化、显示名与 highlight id
│   │   ├── marks/colors.ts  # FontColor / BgColor + 18 预设色
│   │   ├── SlashMenu.vue    # / 命令菜单
│   │   ├── BlockMenu.vue    # 块级手柄菜单（类型转换、颜色、上下移动、生成子页）
│   │   ├── TableControls.vue # 仿飞书表格交互（行/列手柄、标题、背景色、对齐、拷贝）
│   │   ├── AiPanel.vue + ai.ts # 13 个内置 AI 动作 + SSE 流式渲染
│   │   ├── searchReplace.ts # 自建查找替换插件
│   │   ├── highlight.ts     # lowlight + import.meta.glob 按需加载 192 种语言
│   │   ├── format.ts        # 浏览器端 prettier 动态 import
│   │   ├── assets.ts        # asset:<id> 协议（blob URL ↔ data URL ↔ 清理）
│   │   └── codePrefs.ts     # 代码块行号开关（localStorage 持久化）
│   ├── blocks/          # NodeView Vue 实现
│   │   ├── DatabaseBlock.vue   # 多维表格宿主 + 表格/看板/行详情视图
│   │   ├── DbTableView.vue     # 表格视图（可拖列宽、字段过滤）
│   │   ├── DbBoardView.vue     # 看板视图（按 select 字段分组、卡片拖拽）
│   │   ├── DbRowSheet.vue      # 行详情侧滑面板（Teleport body）
│   │   ├── DbCell.vue          # 七种字段类型输入控件
│   │   ├── DbFieldMenu.vue     # 字段列头菜单
│   │   ├── dbFields.ts         # 字段元数据 + 视图计算
│   │   ├── exportDatabases.ts   # 导出 .md 时展开成真实 Markdown 表格
│   │   ├── DiagramBlock.vue    # Mermaid 图表块
│   │   ├── diagramTemplates.ts # 8 个图表模板
│   │   ├── mermaid.ts          # Mermaid 封装（动态 import + 明暗配色）
│   │   ├── CodeBlockView.vue   # 代码块工具栏（语言选择、文件名、复制、prettier、折叠、行号）
│   │   ├── PageLinkBlock.vue    # 子页面卡片
│   │   └── ColumnsView.vue      # 多栏分栏 NodeView（栏数 stepper + 宽度比例预设 + 增删栏）
│   ├── components/      # 编辑器外部通用 UI
│   │   ├── Sidebar.vue         # 侧栏（搜索、新建、收藏、回收站、主题、空间切换）
│   │   ├── PageTree.vue / Item.vue # 页面树（拖拽、重命名、右键菜单）
│   │   ├── SearchModal.vue     # 全局搜索（打分排序、关键词高亮）
│   │   ├── PageToc.vue         # 右侧目录（IntersectionObserver 跟踪）
│   │   ├── FindReplaceBar.vue  # 页内查找替换条
│   │   ├── ShareDialog.vue     # 分享（公开链接 Tab + 成员授权 Tab）
│   │   ├── NotificationBell.vue # 通知铃铛（静默时段、按类型图标）
│   │   ├── ImageExportModal.vue # 笔记导出图片预览弹层
│   │   ├── IconPicker.vue      # 页面图标（emoji / Lucide / 上传 / 外链）
│   │   ├── CoverPicker.vue     # 页面封面（渐变预设 / 图库 / 上传 / Unsplash / AI）
│   │   ├── PinLock.vue         # PIN 锁屏层
│   │   └── GnSelect.vue        # 项目自定义下拉
│   ├── views/           # 路由级页面
│   │   ├── NoteView.vue        # 主笔记页（最重文件，布局偏好 50-90%、字号、字体、疏密）
│   │   ├── HomeView.vue        # 首页仪表盘
│   │   ├── TrashView.vue       # 回收站
│   │   ├── AuthView.vue        # 登录/注册/2FA/GitHub OAuth
│   │   ├── ProfileView.vue     # 个人中心
│   │   ├── SharedNoteView.vue  # 共享给我（只读/可编辑按角色）
│   │   ├── SharedPublicView.vue # 公开分享（密码门、无登录、只读代码块工具栏）
│   │   └── settings/           # 10 个设置子组件
│   ├── utils/           # 通用工具、导入导出与只读渲染
│   │   ├── clipboard.ts        # 统一复制入口（安全上下文 + execCommand 降级）
│   │   ├── importExport.ts     # Markdown/Notion/Zip/JSON 全链路迁移
│   │   ├── exportPage.ts       # html2canvas → 图片 / jsPDF → PDF
│   │   └── renderMarkdown.ts   # 只读 Markdown→HTML（白名单清洗 + 结构化代码块）
│   ├── i18n/            # 简 / 繁 / 英三套界面语言
│   ├── shortcuts.ts     # 快捷键定义
│   ├── userState.ts    # 登录态 / 用户信息
│   └── pinLock.ts      # PIN 状态机
├── package.json
├── vite.config.ts       # @tailwindcss/vite + vue-tsc
└── run.bat              # Windows 一键启动脚本
```

---

## 三、已实现功能清单

### P0 — 核心闭环（均可编译运行）

| # | 模块 | 状态 | 说明 |
|---|---|---|---|
| 1 | 鉴权注册登录 | ✅ | 用户名规则、scrypt 密码哈希、JWT 会话 |
| 2 | 两步验证 (2FA) | ✅ | RFC 6238 TOTP，Google/Microsoft 验证器兼容 |
| 3 | GitHub OAuth | ✅ | 绑定已有账号 + 免注册登录 |
| 4 | 会话管理 | ✅ | 列表查看、远程撤销、"踢出其它会话" |
| 5 | PIN 锁屏 | ✅ | 已登录态下的额外保护层，支持退出登录绕开 |
| 6 | 个人访问令牌 | ✅ | `gn_` 前缀、SHA256 存库、只读 scope 禁止写操作（`/mcp` 例外）、上限 30 |
| 7 | 页面 CRUD | ✅ | 新建、重命名、删除、回收站（单页 + 永久 + 清空）、父子层级、拖拽移动、同级重排 |
| 8 | TipTap 编辑器 | ✅ | StarterKit + Placeholder + Image + TableKit + TaskList/Item + 自定义节点 |
| 9 | Markdown 双向 | ✅ | 块级 1:1 映射，三种 fence 扩展 (`mermaid` / `ginkgo-db` / `ginkgo-page`) |
| 10 | 撤销/重做 | ✅ | 显式拦截，不被浏览器监听抢走 |
| 11 | Slash (`/`) 命令 | ✅ | 基础块、表格、图片、多维表格、页面卡片、图表模板、AI 动作；中文 + 拼音首字母过滤 |
| 12 | 块级手柄菜单 | ✅ | 类型转换（段落 ↔ H1-H4 ↔ 列表 ↔ 引用 ↔ 代码）、颜色、上下移动、生成子页、删除 |
| 13 | 表格精细控制 | ✅ | 仿飞书交互：行/列悬停手柄、标题行/列开关、背景色（10 种）、列对齐、两侧插入、拷贝副本（Ctrl+D）、清除、删除、均分列宽 |
| 14 | 代码块增强 | ✅ | 192 种语言选择、文件名 (`title` 属性)、复制、prettier 格式化、折叠、换行开关、行号（全局偏好） |
| 15 | 代码高亮 | ✅ | lowlight + import.meta.glob 按需加载，未知语言降级为纯文本 |
| 16 | 多维表格块 | ✅ | 表格视图（可拖列宽、字段过滤）+ 看板视图（按 select 分组、卡片拖拽）+ 七种字段类型 + 行详情侧滑面板 |
| 17 | Mermaid 图表块 | ✅ | 动态 import、明暗两套配色、主题切换后重绘；8 个开箱模板 |
| 18 | 页面卡片 | ✅ | 正文中的子页面卡片，点击跳转，页面被删时显示"已删除或不存在" |
| 19 | 全局搜索 | ✅ | 标题/摘要打分排序、关键词片段高亮、空查询显示最近 12 篇 |
| 20 | 右侧目录 (TOC) | ✅ | IntersectionObserver 跟踪当前章节、点击平滑滚动 |
| 21 | 页内查找替换 | ✅ | 大小写敏感、全词匹配，锁定页禁用替换 |
| 22 | 页面锁定 | ✅ | 锁定后只读，编辑器浮条自动隐藏 |
| 23 | 布局偏好 | ✅ | 页面宽度 50-90% 滑块、字号、字体风格、疏密 |
| 24 | 主题切换 | ✅ | 明/暗主题，点击处圆形扩散过渡动画 |
| 25 | 页面图标/封面 | ✅ | emoji / Lucide / 上传 / 外链 / Unsplash / AI 生成封面 |
| 26 | AI 助手 | ✅ | OpenAI 兼容转发 + SSE 流式透传；13 个内置动作（润色、续写、总结、翻译、提炼要点、生成大纲、改写风格、修复语法、扩写、缩短、添加示例、生成表格、生成代码）；选区改写 / 光标续写 / 整页总结三种模式 |
| 27 | 公开分享链接 | ✅ | 密码门、有效期、是否含子页、重新生成 token；访客端免登录 Markdown 只读渲染 + Mermaid 异步渲染 |
| 28 | 成员协作 | ✅ | 作者按用户名邀请 viewer/editor；editor 且页面未锁定时可编辑；双向资源可见性 |
| 29 | MCP 服务 | ✅ | Streamable HTTP `/api/mcp`、JSON-RPC 2.0、个人令牌认证；工具 `search_pages` / `list_pages` / `read_page` / `create_page` / `update_page` (含 `mode=append`) / `trash_page`；只读令牌禁止写工具 |
| 30 | Webhook | ✅ | 页面事件 `page.created/updated/trashed/restored/deleted`；HMAC-SHA256 签名投递；自动保存场景 5 秒防抖合并；8s 超时；失败通知 |
| 31 | 站内通知 | ✅ | 6 种类型（security/share/member/feedback/webhook/system）、按类型图标、静默时段（`inQuietHours`）、每人最多 500 条、安全类不可关闭 |
| 32 | 邮件通知 (SMTP) | ✅ | 懒加载 nodemailer；`SMTP_URL` + `SMTP_FROM` 配置；未配置时静默跳过 |
| 33 | Markdown 导入导出 | ✅ | 单文件 / 文件夹 / zip / Notion 导出包（剥掉 32 位 id 后缀）；还原父子层级；导出时多维表格展开成真实 Markdown 表格快照 |
| 34 | JSON 全库备份 | ✅ | `importBackupJson` / `exportBackupJson` 完整往返 |
| 35 | 空间 zip 导出 | ✅ | 含资源，多维表格展开，带进度回调 |
| 36 | 笔记导出图片 | ✅ | html2canvas-pro（scale ≤2）、纸张样式（白纸/米纸/横线/方格）、深浅主题、平铺旋转水印、下载 + 复制到剪贴板 |
| 37 | 笔记导出 PDF | ✅ | jsPDF A4 纵向、按页切片 `addImage` |
| 38 | 设置弹窗 | ✅ | 10 个 section（account/account-security/general/notify/space/members/share/data/integrations/ai/about），Esc 捕获阶段拦截只关自己 |
| 39 | 个人资料 + 修改密码 | ✅ | 改密后踢掉其它会话 |
| 40 | 存储用量统计 | ✅ | 资源/页面/多维表格分项、最大 5 个图片 |
| 41 | 快捷键 | ✅ | 录制、冲突检测、恢复默认 |
| 42 | i18n 三语 | ✅ | 简体 / 繁体 / 英文；全部 UI 文案覆盖 |
| 43 | 公共原稿 | ✅ | 首次启动自动生成（欢迎页 + Markdown 速查页 + 示例多维表格）；管理员可切到公共空间；新用户注册时深拷贝独立副本 |
| 44 | 旧数据迁移 | ✅ | 旧版 IndexedDB（v2）一键导入到后端，图片保持原 id |
| 45 | 意见反馈 | ✅ | 提交到 `feedback` 表 + 通知所有管理员；管理员可见全部、可回复 |
| 46 | 版本检测 | ✅ | 设置页 About 区域 |
| 47 | 折叠动画与裁切 | ✅ | WAAPI 300ms 过渡（首行轨道钉为实测像素、内容淡入淡出）；`::details-content` / 列表子项 `align-self:stretch` 保证轨道归零后内容真正隐藏；细线 chevron 箭头统一编辑器与只读页 |
| 48 | 任意层级列表折叠 | ✅ | 普通列表深层与任务列表项均可逐层展开收起；深层装订区可独立命中并只点亮对应层箭头；块手柄自动让位；折叠状态经 `<!-- gn-li collapsed -->` 注释往返持久化 |
| 49 | 剪贴板兼容 | ✅ | 统一 `copyText()`；局域网 HTTP 等非安全上下文降级 `execCommand('copy')`，复制后恢复焦点与选区；覆盖分享、集成、代码块、图表、AI 全部复制入口 |
| 50 | 公开分享页滚动 | ✅ | 路由级 `gn-standalone` 放开 body 原生滚动，离开路由自动移除 |
| 51 | 只读代码块工具栏 | ✅ | 语言显示名、文件名、行数/字符统计、行号 gutter、行号/换行/折叠/复制、hljs 高亮；`v-html` 事件委托实现交互 |
| 52 | 只读折叠块状态 | ✅ | `<details open>` 进入 sanitize 白名单并按 `data-open` 回填，避免展开态分享出去变收起 |
| 53 | 列表与编号颜色 | ✅ | 自定义 `gn-ol` 计数器修复 `display:grid` 的 `li` 让 `counter(list-item)` 恒为 `0.` 的问题；顶层 1./2./3.、嵌套重新从 1 数起；`@supports` + 类型化 `attr()` 支持 `<ol start>`；只读页 sanitize 白名单放行并校验 `start`；所有编号/标记类（有序数字、无序圆点、代码行号）统一用 `--gn-text-strong`（亮色近黑 `#0f0f0e` / 暗色纯白 `#ffffff`）强化对比，只读页代码行号去掉 `opacity:0.75` 淡化 |
| 54 | 多栏分栏布局 | ✅ | 正文插入 1–4 栏，栏数 stepper（1–4 限制）+ 宽度比例预设（均分/1:2/2:1 等，按栏数动态）；每栏独立编辑；Markdown 以 `<!-- gn-columns[ widths="..."] -->` + `<!-- gn-col -->` 注释双向往返（含嵌套分栏与等宽省略）；公开分享页静态渲染 `.sv-columns/.sv-column`，`flex-grow` 实现列宽比例，窄屏（≤640px）纵向堆叠 |

### P1 — 部分完成 / 待完善

| # | 模块 | 状态 | 缺失项 |
|---|---|---|---|
| — | 无 | — | 当前所有已开始的模块都已闭环 |

### P2 — 尚未开始

| # | 模块 | 说明 |
|---|---|---|
| — | 无 | — |

---

## 四、API 路由速查

所有接口挂在 `/api` 前缀下（Express `app.use('/api', api)`）。

### 认证 (`server/auth.ts` + `server/account.ts` + `server/routes.ts`)
| 方法 | 路径 | 说明 | 认证 |
|---|---|---|---|
| POST | `/auth/register` | 注册 | 无 |
| POST | `/auth/login` | 登录 | 无 |
| POST | `/auth/login/2fa` | 2FA 二次验证 | 票据 |
| GET | `/auth/me` | 当前用户信息 | 会话/令牌 |
| PATCH | `/auth/profile` | 修改资料 | 会话 |
| POST | `/auth/password` | 修改密码（踢其它会话） | 会话 + 旧密码 |
| GET | `/auth/sessions` | 设备会话列表 | 会话 |
| DELETE | `/auth/sessions/:id` | 撤销设备 | 会话 |
| POST | `/auth/sessions/revoke-others` | 踢出其它设备 | 会话 |
| POST | `/auth/2fa/setup` / `/enable` / `/disable` | 两步验证 | 会话 |
| PUT / DELETE | `/auth/pin` | PIN 管理 | 会话 |
| POST | `/auth/pin/verify` | PIN 验证 | 会话 |
| GET/POST/DELETE | `/tokens` | 个人访问令牌管理（上限 30） | 会话 |
| DELETE | `/auth/account` | 注销账号（级联删除） | 会话 + 密码 |
| GET | `/auth/providers` | 可用 OAuth 提供商 | 无 |
| GET | `/auth/github/login` → callback | GitHub OAuth | 无 |

### 页面与资源 (`server/routes.ts`)
| 方法 | 路径 | 说明 | 认证 |
|---|---|---|---|
| GET | `/pages` | 列出全部页面（含删除态） | 会话/令牌 |
| GET / PUT / DELETE | `/pages/:id` | 单页 CRUD | 会话/令牌 |
| POST | `/pages/batch` | 批量 upsert/删除 + 触发 Webhook | 会话/令牌 |
| GET | `/databases` | 列出多维表格 | 会话/令牌 |
| GET / PUT / DELETE | `/databases/:id` | 单表 CRUD | 会话/令牌 |
| GET | `/databases/:id/rows` | 表格行列表 | 会话/令牌 |
| GET / PUT / DELETE | `/rows/:id` | 单行 CRUD | 会话/令牌 |
| POST | `/rows/batch` | 批量行 CRUD | 会话/令牌 |
| POST | `/assets` | 上传图片（`X-Asset-Name` 头 + 原始字节） | 会话/令牌 |
| GET | `/assets/:id` | 读取图片（私有/公共/协作可见性） | 视情况 |

### 功能路由 (`server/features.ts`)
| 方法 | 路径 | 说明 | 认证 |
|---|---|---|---|
| GET | `/version` | 版本信息 | 无 |
| GET/POST/PATCH/DELETE | `/shares` | 公开分享管理 | 会话/令牌 |
| GET | `/shares/page/:pageId` | 查询页的分享 | 会话/令牌 |
| POST | `/public/shares/:token` | 访客读分享内容 | 密码/票据 |
| GET | `/public/shares/:token/assets/:id` | 访客读分享图片 | `?k=` 票据 |
| GET/POST/PATCH/DELETE | `/grants` | 成员授权管理 | 会话/令牌 |
| GET | `/shared` | 共享给我的页面 | 会话/令牌 |
| GET / PUT | `/shared/pages/:id` | 读/写共享页 | 按角色 |
| GET | `/ai/config` / PUT `/ai/config` | AI 配置读写 | 会话（写需会话） |
| POST | `/ai/chat` | SSE 流式 AI 对话 | 会话/令牌 |
| POST | `/mcp` | MCP JSON-RPC 2.0 入口 | 个人令牌 |
| GET/POST/PATCH/DELETE | `/webhooks` | Webhook 管理 | 会话/令牌 |
| POST | `/webhooks/:id/test` | 测试投递 | 会话/令牌 |
| GET/POST/DELETE | `/notifications` | 通知管理 | 会话/令牌 |
| GET / PUT | `/settings/:key` | 用户设置（space/notify/shortcuts，20KB） | 会话/令牌 |
| GET | `/storage` | 存储用量统计 | 会话/令牌 |
| GET/POST | `/feedback` | 意见反馈 | 会话/令牌 |
| GET/POST | `/admin/feedback[/:id/reply]` | 管理员看全部/回复 | requireAdmin |
| POST | `/admin/import` | 导入公共原稿 | requireAdmin |

### `X-Space: public` 头
管理员可在任意请求中加此头，切换读写到公共空间（`owner = 'public'`）。

---

## 五、Git 提交历史（按模块分层）

> 已完成的提交按依赖顺序排列，每个提交自身可编译运行。

| # | Hash | 类型 | 说明 |
|---|---|---|---|
| 1 | `6139389f` | chore | 初始化项目骨架与构建配置 |
| 2 | `ba52dcd8` | feat(server) | 实现后端服务、鉴权与数据层 |
| 3 | `da98fb91` | feat(core) | 新增数据模型、IndexedDB 仓储与全局状态 |
| 4 | `ec40d620` | feat(editor) | 实现 TipTap 编辑器内核与 Markdown 双向转换 |
| 5 | `fc342929` | feat(blocks) | 实现代码块工具栏、图表块与多维表格块 |
| 6 | `7f90cb0b` | feat(ui) | 实现应用外壳、页面视图与全局样式 |
| 7 | `ee8a9771` | chore | 添加 .gitattributes 统一跨端行尾符 |
| 8 | `68307025` | feat(server) | 支持个人资料与修改密码 |
| 9 | `0b9e8545` | feat(ui) | 完善笔记能力与设置弹窗 |
| 10 | `021566bc` | feat(i18n) | 搭建简繁英三套界面语言 |
| 11 | `188e3895` | （合并） | — |
| 12 | `583ebe97` | feat(editor) | 表格精细控制、代码块行号与多端适配 |
| 13 | `ac56efe0` | merge | 合并 origin/main，保留本地表格、行号与多端改动 |
| 14 | `c92fef65` | feat(theme) | 主题切换增加从点击处圆形扩散的过渡效果 |
| 15 | `c9e737de` | feat(server) | 新增会话、令牌、分享、集成、AI、通知、反馈与成员协作接口 |
| 16 | `eacab0b5` | fix(server) | 已登录时密码/PIN输错改返回 400，避免被前端当成登录失效而登出 |
| 17 | `9302a945` | feat(ui) | 实现设置中全部「即将上线」模块与分享、协作、AI、PIN 锁屏等前端功能 |
| 18 | `cfe7ba02` | fix(editor) | 混合列表中的 [ ] 不再被吞掉；版本号升至 0.3.0 |
| 19 | `3b8d15f5` | feat(notify) | 通知支持同步发送到绑定邮箱（SMTP） |
| 20 | `c11df82f` | feat(i18n) | 笔记页、侧栏、通知、锁屏等界面接入繁体与英文 |
| 21 | `5265b8df` | feat(table) | 表格改为行列手柄 + 菜单操作，支持单元格颜色、列对齐与拷贝副本 |
| 22 | `a879619` | chore | 基础设施 |
| 23 | `7a3d2c1` | feat(editor) | 编辑器内核 |
| 24 | `ad2f9db` | feat(blocks) | 高级块（代码/图表/多维表格/页面卡片） |
| 25 | `a0f7b3d` | feat(ui) | 通用组件（侧栏/搜索/分享/目录等） |
| 26 | `d16f123` | feat(ui) | 路由页面 |
| 27 | `28e0be0` | feat(i18n) | 国际化 |
| 28 | `eb65d46` | feat(core) | 应用外壳与全局状态 |
| 29 | `ad46ad7` | docs | 开发文档 |
| 30 | `2043cd6` | chore | 基础设施 |
| 31 | `b2c63d7` | docs | 开发文档 |
| 32 | `6d9c6f0` | chore | 基础设施 |
| 33 | `b1e3a04` | feat(editor) | 编辑器内核 |
| 34 | `c067aaf` | feat(blocks) | 高级块（代码/图表/多维表格/页面卡片） |
| 35 | `ebf1a54` | feat(ui) | 路由页面 |
| 36 | `f95e9e2` | feat(i18n) | 国际化 |
| 37 | `faa274d` | feat(utils) | 导入导出与只读渲染 |
| 38 | `f045c75` | feat(core) | 应用外壳与全局状态 |
| 39 | `1e8dfd7` | fix(utils) | 统一剪贴板复制入口，兼容非安全上下文 |
| 40 | `01c366d` | refactor(style) | 折叠交互与只读页样式整合 |
| 41 | `8cfe565` | feat(editor) | 折叠动画改用 WAAPI，支持嵌套任务项逐层折叠 |
| 42 | `36d8097` | feat(share) | 公开分享页放开滚动并补齐代码块工具栏 |
| 43 | `b6b75ce` | fix(editor) | 深层嵌套列表的折叠箭头不再被父级 overflow 裁掉 |
| 44 | `6adc7e2` | fix(editor) | 有序列表编号从 1 开始，嵌套层重新计数 |
| 45 | `9e1327b` | fix(share) | 只读页保留有序列表的起始编号 |
| 46 | `242d4a2` | feat(editor) | 正文支持多栏分栏布局（columns/column 节点 + NodeView 工具栏 + Markdown 双向 + 只读页渲染） |
| 47 | `35e7ee9` | fix(editor) | 有序列表编号颜色加深（`--gn-text-muted` → `--gn-text`） |
| 48 | `a49e22d` | fix(editor) | 有序列表编号改用 `--gn-text-strong` 更强对比（亮色近黑/暗色纯白） |
| 49 | `c9e3249` | fix(editor) | 其余编号类颜色一并改深（无序圆点 + 代码行号），只读页行号去淡化 |

> 表格按时间正序只记录**功能提交**；纯文档维护提交（docs-only）不列入本表，因此 HEAD 行指向最新的功能提交。若 `git log -1` 为 docs 提交，请以该提交为准。

**HEAD**: `c9e3249` — fix(editor): 其余编号类颜色一并改深（无序圆点 + 代码行号）

---

## 六、新建提交的模块分层规范

未来提交必须遵循**自底向上的依赖顺序**，每个提交自身可编译运行：

```
基础设施 → 数据层 → 后端路由 → 编辑器内核 → 高级块 → UI 外壳 → 集成功能
   ├─ config          ├─ db.ts         ├─ routes.ts   ├─ extensions.ts  ├─ blocks/   ├─ App.vue    ├─ ai/mcp/webhook
   ├─ http.ts         ├─ auth.ts       └─ features.ts └─ markdown.ts   └─ ...       ├─ views/     └─ notify/mail
   └─ package.json    └─ templates.ts                                └─ components/
```

提交信息格式：`<type>(<scope>): <subject>`，body 分点说明关键改动。

---

## 七、构建与启动

```bash
# 开发
pnpm dev              # concurrently 起 api (3101) + web (3100)
# Windows 一键
run.bat               # 同上 + 自动开浏览器

# 生产
pnpm build            # vue-tsc --noEmit + vite build
pnpm start            # node server/index.ts  (Express 同时托管 dist)

# 类型检查
pnpm typecheck        # vue-tsc + tsc -p server
```

环境变量（全部可选）：
- `PORT` 默认 3101
- `ADMIN_USERNAME` / `ADMIN_PASSWORD` 默认 admin / admin123
- `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` 服务端 AI 默认值
- `SMTP_URL` / `SMTP_FROM` 邮件通知

---

## 八、数据库表结构（摘要）

SQLite，WAL 模式（`PRAGMA journal_mode = WAL`）。核心表：

| 表 | 说明 |
|---|---|
| `users` | 用户名（唯一）、密码哈希、role、profile、totpSecret、pinHash、githubId |
| `sessions` | 用户会话（token 哈希、UA、创建/过期时间） |
| `api_tokens` | 个人访问令牌（sha256 哈希、scope、最后使用时间） |
| `pages` | id / owner / title / content(Markdown) / excerpt / icon / cover / parent / order / locked / deleted |
| `databases` | id / owner / title / fields(JSON) / views(JSON) |
| `db_rows` | id / databaseId / owner / values(JSON) / order |
| `assets` | id / owner / name / mime / size / blob |
| `settings` | 全局设置（键值） |
| `user_settings` | 用户级设置（键值） |
| `shares` | token / pageId / password / expiresAt / includeChildren |
| `page_grants` | pageId / userId / role(viewer/editor) |
| `webhooks` | url / secret / events(JSON) / lastEvent / lastStatus |
| `notifications` | userId / type / title / body / link / createdAt / read |
| `feedback` | userId / content / reply / createdAt |

---

## 九、常见陷阱

1. **多维表格导出**：导出 .md 时 `exportDatabases.ts` 会把 ` ```ginkgo-db` fence 展开成真实 Markdown 表格快照，但正文里仍保留原 fence 以备再次导入。
2. **asset: 协议清理**：切账号或登出时必须调用 `assets.resetCache()` 释放 blob URL，否则会泄漏内存。
3. **serial() 保护范围**：所有"先读后写"路径都必须加 `serial(key)`，否则防抖保存的两路请求可能交错。已有 `page:<id>` 和 `db:<id>` 两个 key。
4. **只读场景**：公开分享页绝不能走 TipTap 编辑器，必须用 `renderMarkdown.ts` + 白名单清洗 + `asset:` 换 `?k=` 票据。
5. **代码高亮**：未知语言（不在 lowlight 注册表的）会降级为纯文本，不要自己瞎写 fallback。
6. **PIN 与 2FA 的错误码**：已登录态下密码/PIN 输错返回 **400**，不是 401。401 仅用于"未登录"，这样前端不会误触发登出流程。
7. **Webhook 防抖**：`page.updated` 在自动保存路径上有 5 秒防抖合并，不要为每次字符修改都触发 Webhook。
8. **折叠动画不能写 DOM 属性**：ProseMirror `setNodeMarkup()` 会走 ReplaceStep 重建节点（`view.nodeDOM(pos)` 不再是同一节点），`DOMObserver` 也会清掉 inline style / class；必须在 `dispatch` 之后用 WAAPI 对重建节点补动画。
9. **`auto 0fr` 不会收缩**：`0fr` 的自动最小值仍取 min-content，收起终态必须写 `minmax(0, 0fr)`。WAAPI keyframes 里也不能把首行写成 `auto`——Chromium 会连首行一起插值，标题行鼓起、文字漂移；首行要钉成 `getComputedStyle()` 读出的实测像素值。
10. **轨道归零 ≠ 内容隐藏**：grid item 需要 `align-self: stretch` 才会跟着轨道收缩；`<details>` 在现代 Chromium/Safari 会把内容包进 `::details-content`，真正要裁的是这个伪元素而不是内层 div。
11. **共享 CSS 变量必须放 `:root`**：`--gn-chevron` 之类若定义在 `.note-editor` 局部变量块，公开分享页不在该作用域，`var()` 解析为空会让整条 `mask` 失效、图标变成实心方块。
12. **局域网 HTTP 不是安全上下文**：`navigator.clipboard` 可能缺失或被拒绝，所有复制必须走 `copyText()` 的 `execCommand` 降级，并恢复焦点/选区以免抢走编辑器光标。
13. **任务项 DOM 特殊**：`taskItem` 是 `<li><label/><div><p/><ul/></div></li>`，子列表不在 li 的直接子级；折叠 widget、块手柄让位判断、CSS 选择器都要兼容 `> div >`。折叠注释是独立 `html_block` 且总在 `list_item_open` 之前，必须在 token 预处理阶段挂到紧随其后的列表项。
14. **折叠动画回归要测四件事**：轨道单调变化、首行尺寸恒定、内层 padding/border 全程不变、内容真的被裁掉。只断言「轨道归零」会出现「数字全绿但视觉是坏的」。
15. **嵌套列表的 `overflow:hidden` 会裁掉折叠箭头**：箭头是 `position:absolute; left:-26px`，落在父级 `ul` 的左边界之外；为折叠裁切给 `li > ul/ol` 加 `overflow:hidden` 会把深层箭头一起裁没，表现为「只有顶层有箭头、子级全空白」。改用 `overflow:visible` + `clip-path: inset(0 -9999px 0 -9999px)` 只裁垂直方向，并让 widget 与 gutter 色带保持 `pointer-events:auto`，鼠标进入装订区才能触发 `li:hover` 淡入。回归必须断言 widget 中心的 `elementFromPoint` 命中自身——只测 `opacity` 会完全漏掉裁剪问题。
17. **分栏 Markdown 往返的 `splitColumns` 必须只取分隔符之间**：序列化用 `<!-- gn-columns -->` 包整体、每列用 `<!-- gn-col -->` 分隔；反序列化切分时若从位置 0 起切，首个分隔符前的填充换行会生成一个空列 chunk，导致左列内容错位到第二列。修复：仅当遇到顶层分隔符且已有一个起始点时才收尾上一段，`start` 始终指向当前分隔符之后；嵌套分栏靠 `gn-columns` 开合深度计数，不参与顶层切分。
16. **`display:grid` 的 `li` 会让 `counter(list-item)` 失效**：`list-item` 是内建计数器，只有 `display:list-item` 才会隐式递增；列表项为了两列布局改成 grid 后，它只保留初值（默认 0，`<ol start="5">` 则是 4）不再递增，于是每一项都渲染成 `0.`。改用自定义 counter（每个 `ol` 上 `counter-reset` 建独立作用域、`li` 上 `counter-increment`），并用 `@supports (counter-reset: x calc(attr(start number, 1) - 1))` 渐进支持 `start`。注意 `getComputedStyle(li,'::before').content` 返回的是**未求值的表达式**，不能用来断言实际编号，需配合 counter 计算值与截图视觉确认。

---

## 十、维护说明

本文档的权威更新方式：**运行维护 skill**。维护 skill 会：
1. 读取最新的 `git log --oneline --all`
2. 扫描 `server/` 新路由
3. 扫描 `src/` 新目录/新组件
4. 自动更新本文档的**第五节（Git 提交历史）**和**第三节（功能清单）**
5. 如发现新的模块分层异常，在文末追加提醒

手动修改后，请把修改合并到 skill 的输出流程中，保证下次 skill 运行不会覆盖你的手写补充。
