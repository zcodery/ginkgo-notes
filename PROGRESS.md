# 银杏笔记 (Ginkgo Notes) — 开发进度

> 版本 0.3.0 | 更新于 2026-11-16
> 本文档面向**下一个接手开发的 AI**，按依赖顺序记录项目架构、已实现功能与 Git 提交分块。
> 每次有新的可编译功能合并后，请执行文末的维护 skill 来更新此文件。

---

## 一、项目概览

一个基于 **Vue 3 + TipTap (ProseMirror) + Express + SQLite** 的自托管 Markdown 笔记应用，支持多维表格、Mermaid 图表、代码块、公开分享、成员协作、好友关系、团队空间与组织树、实时在线状态、AI 助手、Webhook 和 MCP 协议接入。

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
6. **空间即数据边界**：`owner` 字段收敛为空间 id（个人空间 id 复用用户 id，团队空间 `sp_*`），所有业务表按 `owner` 物理隔离；资源访问再经统一 ACL（deny 优先 → 资源显式 → 组织节点继承 → 空间基线）。

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
│   ├── members.ts       # 个人笔记分享（数据源 acl_entries；viewer/editor）
│   ├── acl.ts           # 统一 ACL：有效角色计算 / deny 优先 / 组织继承 / 授权接口
│   ├── friends.ts       # 好友关系（申请/同意/拒绝/拉黑/搜索）
│   ├── spaces.ts        # 团队空间 / 组织树 / 成员 / 邀请 / 组织架构导入
│   ├── presence.ts      # 文档在线状态（SSE + 心跳）与编辑占用
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
│   │   ├── Sidebar.vue         # 侧栏（搜索、新建、收藏、回收站、主题、空间/好友/团队入口）
│   │   ├── PageTree.vue / Item.vue # 页面树（拖拽、重命名、右键菜单）
│   │   ├── SearchModal.vue     # 全局搜索（打分排序、关键词高亮）
│   │   ├── PageToc.vue         # 右侧目录（IntersectionObserver 跟踪）
│   │   ├── FindReplaceBar.vue  # 页内查找替换条
│   │   ├── ShareDialog.vue     # 分享（公开链接 Tab + 人员下拉邀请）
│   │   ├── PeoplePicker.vue    # 人员多选下拉（好友/团队成员分组、团队切换、去重）
│   │   ├── PresenceAvatars.vue # 文档右上角在线头像（过滤自己）
│   │   ├── OrgTree.vue         # 组织架构树（折叠 / 增删改 / 移动 / 导入入口由 TeamsView 承载）
│   │   ├── NotificationBell.vue # 通知铃铛（静默时段、按类型图标）
│   │   ├── ImageExportModal.vue # 笔记导出图片预览弹层
│   │   ├── IconPicker.vue      # 页面图标（emoji / Lucide / 上传 / 外链）
│   │   ├── CoverPicker.vue     # 页面封面（渐变预设 / 图库 / 上传 / Unsplash / AI）
│   │   ├── PinLock.vue         # PIN 锁屏层
│   │   └── GnSelect.vue        # 项目自定义下拉（空间不足自动上翻）
│   ├── views/           # 路由级页面
│   │   ├── NoteView.vue        # 主笔记页（最重文件，布局偏好 50-90%、字号、字体、疏密）
│   │   ├── HomeView.vue        # 首页仪表盘
│   │   ├── TrashView.vue       # 回收站
│   │   ├── AuthView.vue        # 登录/注册/2FA/GitHub OAuth
│   │   ├── ProfileView.vue     # 个人中心
│   │   ├── SharedNoteView.vue  # 共享给我（只读/可编辑按角色）
│   │   ├── FriendsView.vue     # 好友中心（搜索 / 申请 / 好友列表 / 行内确认）
│   │   ├── TeamsView.vue       # 团队空间（左侧竖向空间导航 + 组织树 + 成员）
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
| 54 | 多栏分栏布局 | ✅ | 正文插入 1–4 栏，栏数 stepper（1–4 限制）+ 宽度比例预设（均分/1:2/2:1 等，按栏数动态）；每栏独立编辑；**现有内容可一键转多栏**——选中多行后 /分栏 或块菜单「转为分栏」即把选区顶层块就地包成分栏，块依次轮流入列（列多补空段、块多轮流分配，支持嵌套）；Markdown 以 `<!-- gn-columns[ widths="..."] -->` + `<!-- gn-col -->` 注释双向往返（含嵌套分栏与等宽省略）；公开分享页静态渲染 `.sv-columns/.sv-column`，`flex-grow` 实现列宽比例，窄屏（≤640px）纵向堆叠 |
| 55 | 拖拽建栏 / 入栏 / 空栏自动消失 | ✅ | 拖动任意块（左侧 ⠿）到分栏行：**行左右边缘或列间空隙→新建一列**（按指针 x 定位插入位，达 4 栏上限自动降级为追加末列），**落在某列内容区→并入该列**（空列则替换空段）；拖动内容须为合法 `block+`（`column.validContent` 校验，否则回退普通重排）；源块始终删除（移动语义，`tr.mapping` 校正删除坐标）；指示：新建栏竖线 + 「新建栏」徽标、入栏虚线高亮；**空栏动态清理**——某列由有内容变为空自动删除，删到仅剩 1 空列/0 列时整行退化为段落（用则有，不用则无），初始创建与「+」显式空栏不误清 |
| 56 | 拖到普通行即并排开栏 | ✅ | 拖块到**任何还没有分栏的行**都能就地开一栏，落点模型为「**按 Y 锁定行、按 X 判左右侧带**」：遍历正文顶层行 DOM 找行带包住指针 y 的行（多行交界取离指针最近的一行，并跳过与拖拽范围重叠的行），行左右各 22%（夹取 48–200px）为侧带 → 与目标并排成两栏，中间区域返回 null 交回普通重排（上下换位），两种手势互不抢占；指针允许落在行的**外侧**（装订线 / 行尾留白），不要求 `posAtCoords` 命中正文；目标自动提升到「顶层块」（清单条目命中时按整张清单算）；拖动清单条目时按原列表类型与属性回包（`toColumnContent`，有序列表保留 `start`）才能成为合法一列；与目标范围重叠（如拖回同一张清单）、目标为空段落时回退普通重排；目标本身是已存在的分栏时，落在其左右外侧改为「在该侧新建一列」（不嵌套分栏）；命令返回 false 时兜底按普通移动落位，避免「松手回到原位」 |
| 57 | 拖拽交互修复（自绘指针拖拽） | ✅ | **原生 HTML5 拖拽在 `dragstart` 里隐藏手柄（拖拽源）会被浏览器直接取消整个拖拽** → 改为 `mousedown` + document `mousemove/mouseup` 自绘拖拽，不依赖 dragstart/dragover/drop；5px 阈值区分「点击开菜单」与「拖动」；拖拽中跟随指针显示「并排成栏/新建栏/移入此栏/上下移动」胶囊，靠近上下边缘自动滚动。**`target instanceof HTMLElement` 对 SVG 手柄恒为 false**（SVGElement 不是 HTMLElement），指针移到手柄就会把手柄隐藏、mousedown 落到 `.nv-inner` → 改用 `Element`。分栏落点改从 columns 节点 DOM 取 `.gn-columns-row`（指针在容器边框/内边距上时 `elementFromPoint` 命中的是 `.gn-columns` 本身）。栏内块有独立手柄（`tryResolveColumnChild`），可单独拖出/拖到另一栏，源栏空了自动消失；删除统一走 `safeDeleteRange`（覆盖整列内容时扩大为整列，避免 `column` 变空导致 schema 非法） |
| 58 | 拖拽落点改「侧带」判定 | ✅ | 修掉「拖到另一行的左侧/右侧分不了栏」：旧实现要求指针必须**压在正文上**（`posAtCoords` 能命中）且 y 落在行的中间 63%，真实拖动时指针常在行的外侧（装订线/行尾留白）或贴住行的上下沿 → 判定落空、退回排序。改为 ①`columnsPosAtPoint` 用 `elementFromPoint` 找最内层 `.gn-columns`，指针在分栏边框/内边距上也能正确入栏；②`computeRowColumnDrop` 完全脱离 `posAtCoords`，按 y 遍历 `pm.children` 锁定行、按 x 侧带决定左/右，指针允许在行外 ±96px；③交界处按「离指针垂直中心最近」选行并跳过与拖拽范围重叠的行（原来取最矮会选中拖拽源自己）；④目标是已存在分栏且指针在其外侧时新建一列。拖拽胶囊细分为「在左侧成栏 / 在右侧成栏 / 新建栏 / 移入此栏 / 上下移动」 |
| 59 | 清单条目级并排成栏 | ✅ | 拖待办/列表里的**某一条**到另一条的左侧或右侧即可分栏：目标条目从原清单切出单独成列，原清单按位置拆成「前面的条目 + 分栏 + 后面的条目」（`makeColumnsWithListItem`），两列各自按原列表类型与属性回包、`taskItem` 的 `checked` 保留；列表只剩一条时天然退化为整体替换，不留空列表。落点先按 y 用 `posAtCoords` 锁定具体条目，再用该条目的矩形做左右侧带（22%，夹取 48–200px），中间区域仍走上下重排。此前整张清单被当作目标、与拖拽源重叠而被跳过，表现为「怎么拖都是上下移动」 |
| 60 | 好友关系 | ✅ | 申请/同意/拒绝/拉黑/用户搜索；好友只是「可被邀请」白名单，不自动获得任何文档权限 |
| 61 | 个人空间与团队空间 | ✅ | `owner` 提升为空间 id：个人空间 id 复用用户 id（存量零迁移）、团队空间 `sp_*`；`X-Space` 头切换个人/团队/公共 |
| 62 | 团队组织树 | ✅ | 部门/团队多层、物化路径 `path` + `depth`、成员挂节点并向子树继承角色；节点改名/移动（防环）/删除（成员与授权迁回上级） |
| 63 | 组织架构导入 | ✅ | CSV（`部门路径,用户名,角色`，支持 `/ \ > ＞` 分隔）与 JSON（扁平 `key/parentKey` 或嵌套 `children`）；同父同名复用、重复导入幂等、错误清单不中断整批 |
| 64 | 统一 ACL | ✅ | `acl_entries` 支持 user / org_node / space 三种主体；优先级 deny → 资源显式 → 组织继承 → 空间基线；个人笔记可邀请好友或同团队成员 |
| 65 | 实时在线状态 | ✅ | SSE 下行 + 25s 心跳；同用户多窗口合并、60s 过期剔除；文档右上角只显示他人（过滤自己）；按当前空间隔离 |
| 66 | 并发编辑 | ✅ | 编辑占用 `doc_locks`（60s 租约 + 30s 清理）+ `pages.version` 乐观锁 CAS；冲突返回 `409 version_conflict`，前端转只读提示 |
| 67 | 分享人员多选 | ✅ | `PeoplePicker` 单一人员下拉：**好友 / 各团队横向 tab 切换**（每个 tab 独立列表，团队再多也不用向下滚）、打开时预加载各 tab 成员数、搜索、多选、标签删除、同人去重、下方空间不足自动上翻；点击输入框不再「开→关」抖动（`onBoxClick` 跳过 input/chip） |
| 68 | 好友页 / 团队页布局重构 | ✅ | 好友页：标题带待处理角标 + 右侧搜索，主体「好友列表（1fr）+ 申请/已发出（330px sticky）」两列，行内操作按钮常显、申请行按钮换行到姓名下方；团队页：空间导航（宽屏左侧竖排 / 窄屏顶部横排，断点 1180）+ 标题徽章 + 「组织架构 / 成员」两列（断点 1024），成员卡内邀请区固定在卡底、卡片不再 `overflow:hidden` 以放行下拉面板 |
| 69 | 组织节点就地编辑 | ✅ | 重命名不再在节点下方多占一行：标题（`.ot-name`）就地变成输入框，保存/取消与之同行，进入编辑自动聚焦并全选；回车提交、Esc 取消、失焦按「有改动才提交」落定，编辑态隐藏类型/人数/行内按钮避免跳动。**新建下级**同理：输入行插在父节点正下方并缩进一级（与子节点名称精确对齐，前缀「└」虚线标明归属），父节点折叠时自动展开、打开即聚焦；根级新增贴在整棵树末尾、不缩进。两种行都由 `rows` 计算属性在节点之间插入，不再固定渲染在列表顶部 |
| 70 | 协作页控件尺寸与 tooltip 统一 | ✅ | 组织树行内控件统一 26px 高（标题输入/新增输入/部门下拉/保存-取消），不再出现按钮比输入框矮一截；行内图标按钮、折叠箭头、成员角色下拉、邀请角色/部门下拉、好友页「清空搜索」「解除」「拉黑」、选择器标签删除、在线头像、分享弹层角色下拉全部补上 `v-tooltip`（替换原生 `title`，提示更快更清楚），删除节点等有副作用的操作在提示里写明后果 |
| 71 | 组织架构拖拽调层级 | ✅ | 节点行可拖拽：丢到行**中间**→成为它的下级（自动展开该上级），丢到行**上/下沿**（10px 或行高 30%）→同级换位（上方绿色插入线指示），丢到列表底部条带→**移到最外层**（根节点）；拖到自己或自己的下级时 `dropEffect=none` 直接拒绝。后端新增 `POST /spaces/:id/org/nodes/:nodeId/move`，按 `beforeId` 定位插入点，事务内重排兄弟 `sort` 并同步子树 `path/depth`。同时去掉节点名右侧的「部门/团队」字样 |
| 72 | 折叠展开高度动画 | ✅ | `TransitionGroup` + 进入/离开前置高度（`before-enter` 写 0、`leave` 先锁当前高度再归 0），收起最外层时整段下级是滑上去而不是瞬间消失；同时加了 `.otk-move` 让换位有位移过渡 |
| 73 | 下拉面板改挂 body（修分享成员列表被裁） | ✅ | `GnSelect` 下拉原来 `position: absolute` 挂在触发器旁边，被 `.pf-list`（`max-height:360 + overflow-y:auto`）裁掉：列表只剩一位成员时点「可查看」，面板只露出一条浅色边，同时因为绝对定位的溢出撑出竖向滚动条、把行内权限下拉和删除按钮挤到一起。改为 `<Teleport to="body">` + `position: fixed`：打开前按触发器矩形算 `top/bottom`（下方不足且上方更宽裕就上翻）、宽度取 `max(触发器宽, 150)`、右对齐触发器再夹到视口内 8px，`max-height` 取可用空间；滚动/缩放时跟随重算，关闭时移除监听；面板内点击算「内部」（否则 mousedown 会先关掉面板、选项点不中）。成员列表换 `gn-scroll` 细滚动条，提示文字与列表之间补 10px 留白 |

### P1 — 部分完成 / 待完善
| # | 模块 | 状态 | 缺失项 |
|---|---|---|---|
| 1 | 好友页 / 团队页视觉 | ⚠️ | 已按第 68 项重构布局骨架（顶部空间切换、两列卡片、紧凑列表），待用户确认；若仍有问题按「UI 一致性」约定继续调结构，不要只调 padding |
| 2 | 新页面 i18n | ⚠️ | `FriendsView` / `TeamsView` / `OrgTree` / `PeoplePicker` / `PresenceAvatars` 文案仍是中文硬编码，未接三语 |
| 3 | 好友共享页在线状态 | ⚠️ | presence 按当前空间隔离，`/shared` 个人笔记共享页暂不显示在线头像 |

### P2 — 尚未开始

| # | 模块 | 说明 |
|---|---|---|
| 1 | Yjs 实时协同（P3） | 需先确认「多人实时同敲」是否为硬需求；与「Markdown 是唯一事实源」冲突，不能直接替换现有写保护 |
| 2 | 多实例协作广播 | presence 房间与编辑占用目前在单进程内存 + `doc_locks`；多实例部署需要 Redis pub/sub 或独立 presence 服务 |

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

### 好友 (`server/friends.ts`)
| 方法 | 路径 | 说明 | 认证 |
|---|---|---|---|
| GET | `/friends` | 已接受的好友列表 | 会话/令牌 |
| GET | `/friends/search?q=` | 搜索用户（附带关系状态） | 会话/令牌 |
| GET | `/friends/requests` | 收到的待处理申请 | 会话/令牌 |
| GET | `/friends/requests/sent` | 已发出的申请 | 会话/令牌 |
| POST | `/friends/requests` | 发起申请（互相申请自动成为好友） | 会话/令牌 |
| POST | `/friends/requests/:id/accept` / `decline` | 处理申请 | 会话/令牌 |
| DELETE | `/friends/:id` | 解除好友 | 会话/令牌 |
| POST | `/friends/:id/block` | 拉黑 | 会话/令牌 |

### 团队空间 (`server/spaces.ts`)
| 方法 | 路径 | 说明 | 认证 |
|---|---|---|---|
| GET | `/spaces` | 我的空间（个人 + 已加入团队） | 会话/令牌 |
| POST | `/spaces` | 创建团队（自动建根节点「全员」） | 会话/令牌 |
| GET / PATCH | `/spaces/:id` | 详情 / 改名 | 空间成员 / admin |
| GET | `/spaces/:id/org` | 组织树 + 成员 | 空间成员 |
| POST | `/spaces/:id/org/nodes` | 新建部门 / 团队 | 空间 admin |
| PATCH / DELETE | `/spaces/:id/org/nodes/:nodeId` | 移动/改名 / 删除（成员与授权迁回上级） | 空间 admin |
| POST | `/spaces/:id/org/import` | 组织架构导入（CSV / JSON） | 空间 admin |
| GET / POST | `/spaces/:id/members` | 成员列表 / 直接添加 | 成员 / admin |
| PATCH / DELETE | `/spaces/:id/members/:userId` | 改角色或部门 / 移出 | 空间 admin |
| GET / POST | `/spaces/:id/invites` | 邀请列表 / 发起邀请 | 空间 admin |
| GET | `/spaces/invites` | 我收到的团队邀请 | 会话/令牌 |
| POST | `/spaces/invites/:id/accept` / `decline` | 处理邀请 | 被邀请人 |

### 统一 ACL (`server/acl.ts`)
| 方法 | 路径 | 说明 | 认证 |
|---|---|---|---|
| GET | `/acl/:type/:id` | 资源授权列表 + 我的有效角色（page/database） | 有读权限 |
| PUT | `/acl/:type/:id` | 新增/更新授权（user / org_node / space，支持 deny、inherit） | 资源 admin |
| DELETE | `/acl/:type/:id/:entryId` | 撤销授权（作者或被授权人自己） | 资源 admin / 本人 |

### 在线状态与编辑占用 (`server/presence.ts`)
| 方法 | 路径 | 说明 | 认证 |
|---|---|---|---|
| GET | `/presence/page/:id` | 当前在线快照 | 有读权限 |
| GET | `/presence/page/:id/stream` | SSE 在线状态流（`event: hello / presence`） | 有读权限 |
| POST | `/presence/page/:id/heartbeat` | 心跳上报（25s 一次，60s 过期） | 有读权限 |
| POST / DELETE | `/presence/page/:id/claim-edit` | 申请 / 释放编辑占用 | 有写权限 |

### `X-Space` 空间头
请求头 `X-Space` 决定本次请求读写的空间（即 `authOf(res).owner`）：
- 不传：个人空间（`owner = 当前用户 id`）
- `sp_xxx`：团队空间，要求在该空间 `space_members` 中存在且 `status = active`
- `public`：公共原稿，仅管理员可写

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
| 50 | `05f081b` | feat(editor) | 现有内容可一键转为多栏（convertToColumns + 斜杠 + 块菜单，支持选中多行批量并排） |
| 51 | `b72931d` | feat(editor) | 拖块建栏 / 拖入栏 / 空栏动态消失（moveBlocksToColumn + removeColumnsAt + unwrapColumns + 拖拽落点识别） |
| 52 | `d86e097` | feat(editor) | 拖到任意普通行中间即并排开一栏（makeColumnsWithBlock + 清单条目回包 + 落点分区） |
| 53 | `0af3d08` | fix(editor) | 拖拽建栏彻底修好：自绘指针拖拽替代原生 HTML5 拖拽、SVG 手柄命中修复、栏内块独立手柄、safeDeleteRange |
| 54 | `7ff049d` | fix(editor) | 拖到任意行的左右侧都能并排成栏：落点改按 Y 锁行 + X 侧带，指针可在行外、交界处取最近行 |
| 55 | `15d6563` | feat(editor) | 清单条目级并排成栏（makeColumnsWithListItem + 按条目矩形判左右侧带） |
| 56 | `57f24e9` | feat(server) | 空间/组织/ACL/好友/在线状态数据模型 + pages 版本列与存量迁移 |
| 57 | `c9e225e` | feat(server) | ACL、好友、团队空间、组织架构导入与在线状态接口 |
| 58 | `005aee9` | feat(server) | 页面与表格接入资源级权限、baseVersion 冲突检测与同团队分享 |
| 59 | `4514e2a` | feat(core) | 协作域接口、SSE 订阅与前端仓储版本冲突 |
| 60 | `f52de15` | feat(ui) | 人员选择/组织树/在线头像组件 + 分享弹窗人员多选 |
| 61 | `0c1a731` | feat(core) | 侧栏空间切换与好友、团队入口 |
| 62 | `c904780` | feat(ui) | 好友中心与团队空间页面 |
| 63 | `2845d88` | feat(ui) | 笔记页在线成员与编辑占用 |
| 64 | `aa88494` | feat(ui) | 好友页/团队页布局重构 + 人员选择器横向 tab |
| 65 | `b87e30e` | feat(ui) | 新建下级按节点就地插入并缩进一级 |
| 66 | `659706f` | fix(ui) | 行内控件统一 26px 高 + 协作页补齐 tooltip |
| 67 | `e7c3594` | feat(ui) | 组织架构拖拽调整层级 + 折叠展开高度动画 |

> 表格按时间正序只记录**功能提交**；纯文档维护提交（docs-only）与脚本类 chore 不列入本表，因此 HEAD 行指向最新的功能提交。若 `git log -1` 为 docs 提交，请以该提交为准。

**HEAD**: `2845d88` — feat(ui): 笔记页展示在线成员并处理编辑占用

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

# 本地演示数据（幂等，不改已有账号密码）
node scripts/seed-demo-friends.mjs   # 为管理员建 5 个演示好友，并加入首个团队 AMTeam
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
| `pages` | id / owner(空间 id) / title / content(Markdown) / excerpt / icon / cover / parent / order / locked / deleted / version(乐观锁) |
| `databases` | id / owner / title / fields(JSON) / views(JSON) |
| `db_rows` | id / databaseId / owner / values(JSON) / order |
| `assets` | id / owner / name / mime / size / blob |
| `settings` | 全局设置（键值） |
| `user_settings` | 用户级设置（键值） |
| `shares` | token / pageId / password / expiresAt / includeChildren |
| `page_grants` | pageId / userId / role(viewer/editor)；旧表，启动时迁移进 `acl_entries`，新写入走 `acl_entries` |
| `spaces` | id / type(personal/team/public) / name / ownerUserId；个人空间 id = 用户 id |
| `org_nodes` | spaceId / parentId / type(department/team) / name / path(物化路径) / depth / sort / leadUserId |
| `space_members` | spaceId / userId / orgNodeId / role(owner/admin/editor/viewer/guest) / status |
| `acl_entries` | spaceId / resourceType(page/database) / resourceId / subjectType(user/org_node/space) / subjectId / role / deny / inherit |
| `friendships` | userLow / userHigh（归一化用户对，唯一）/ status / requestedBy / message |
| `invites` | spaceId / orgNodeId / role / inviteeId / token / status / expiresAt |
| `doc_locks` | pageId / spaceId / userId / sessionId / expiresAt（编辑占用，30s 清理过期） |
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
18. **拖块入栏的两个坐标坑**：①追加到分栏末尾时 `colStarts[idx]` 在 `idx === childCount` 处是 `undefined`，必须用 `columnsPos + node.nodeSize - 1`（分栏内容末尾）作为插入位；②同一事务里先 `tr.insert` 新列再删除源块，源块坐标必须用 `tr.mapping.map(from/to)` 映射后再 `tr.delete`，否则源在插入点之前时删除位置错位。另外 `.gn-column` 是 NodeView 渲染的跨组件元素，`scoped` 样式加不上，入栏高亮类（`.gn-col-drop-into`）必须写在全局 `style.css`。
16. **`display:grid` 的 `li` 会让 `counter(list-item)` 失效**：`list-item` 是内建计数器，只有 `display:list-item` 才会隐式递增；列表项为了两列布局改成 grid 后，它只保留初值（默认 0，`<ol start="5">` 则是 4）不再递增，于是每一项都渲染成 `0.`。改用自定义 counter（每个 `ol` 上 `counter-reset` 建独立作用域、`li` 上 `counter-increment`），并用 `@supports (counter-reset: x calc(attr(start number, 1) - 1))` 渐进支持 `start`。注意 `getComputedStyle(li,'::before').content` 返回的是**未求值的表达式**，不能用来断言实际编号，需配合 counter 计算值与截图视觉确认。
19. **普通行拖拽不能只走重排**：`updateDropLine` 的落点由指针在目标块上下半区决定（取 `block.from` / `block.to`），当目标块紧邻被拖块时，落点恰好等于块自身边界（`target >= from && target <= to`）→ 直接 return，表现就是「松手后又回到原位」。要实现「拖到某一行就开一栏」，必须先在 `onDragOver` 里按 y 分区（中间区 → `cols-with`，上下窄边仍留给重排），并把落点目标提升到**顶层块**。另一个坑：拖清单条目时 `resolveBlock` 返回的是 `taskItem`/`listItem`，它们不在 `block` 组里，`column.validContent` 直接为 false——必须按原列表类型与属性回包成 `taskList`/`bulletList`/`orderedList` 才是合法列内容；而孤立的 `listItem` 不能作为目标被换成块级 `columns`（会破坏列表结构），只能先提升到整张清单。
20. **原生 HTML5 拖拽 + 自绘手柄 = 拖不动**：在 `dragstart` 里把拖拽源（块手柄）隐藏，浏览器会判定拖拽被取消，`dragover`/`drop` 全部不再触发，表现就是「拖了没反应、松手弹回原位」，而且**不会报错**，极难排查。块拖拽一律用 `mousedown` + document `mousemove/mouseup` 自绘，别在 `dragstart` 里动拖拽源的 DOM。
21. **`instanceof HTMLElement` 会漏掉 SVG**：lucide 图标是 `SVGElement`，`svg instanceof HTMLElement === false`。`updateBlockHandleFromPointer` 曾用它判断「指针是否在手柄上」，导致指针移到手柄那一刻就被当成悬停在正文 → 手柄被隐藏 → 随后的 `mousedown` 落到 `.nv-inner`，拖拽永远无法开始（同样不报错）。判断 DOM 归属统一用 `instanceof Element`。
22. **删除范围可能让 `column` 变空**：`column` 的 content 是 `block+`，把某列唯一内容删掉会留下非法空列，ProseMirror 直接抛错。所有「移动/删除块」的位置都要先过 `safeDeleteRange(doc, from, to)`：范围覆盖整列内容时扩大为整列，只剩这一列时扩大为整个 `columns`。
23. **拖拽落点别依赖「指针压在正文上」**：用 `view.posAtCoords()` 或 `resolveBlock()` 判定拖拽目标行，会隐含要求指针命中正文元素与文本位置。用户「拖到某行的左侧/右侧」时，指针往往已经在行的外面（左侧装订线、行尾留白），`posAtCoords` 直接返回 null → 整条分栏判定链断开 → 退回普通重排，表现为「怎么拖都只是换位置」。正确做法：**按 y 遍历 `view.dom.children` 的矩形锁行，按 x 判左右侧带**，两者都不依赖命中。另外两条随之而来的坑：①行与行是紧贴的，指针停在交界处会同时命中上下两行，按「高度最小」选会选中拖拽源自己，必须按「离指针垂直中心最近」选并跳过与拖拽范围重叠的行；②分栏内的判定也别用 `closest('.gn-column')` 反查 pos，改用 `elementFromPoint` 拿到 `.gn-columns` 元素后与 `view.nodeDOM(pos)` 比对，这样指针落在容器边框/内边距上也能正确入栏。
24. **清单行是「一个块」，但分栏要按「条目」粒度**：`view.dom.children` 里整张 `ul/ol` 只占一行 DOM，`resolveRowBlockPos` 对列表永远返回**第一条**的 pos。若直接把这行当目标，会得到「整张清单」——它必然与拖拽源重叠（源就在同一张清单里）而被跳过，表现就是拖待办项时怎么拖都只显示「上下移动」。正确做法：先用 `posAtCoords({left: 列表左侧, top: 指针 y})` 定位到**具体那一条**，再用这一条的 `li` 矩形做左右侧带判定；落位时不能把整张清单换成一列（那会把所有条目塞进同一列），要把目标条目从清单里切出来单独成列，原清单按位置拆成「前面的条目 + 分栏 + 后面的条目」（见 `makeColumnsWithListItem`），拆分前必须先删除拖拽源并用 `tr.mapping.map` 重新定位目标条目——源和目标常常在同一张清单里，删掉源之后索引会变。
25. **`owner` 现在是空间 id，不再是用户 id**：个人空间 id 复用用户 id，团队空间是 `sp_*`。所有读写必须用 `authOf(res).owner` / `auth.spaceId`，不要再假设 owner 一定对应某个用户；跨空间的 `ginkgo-db` / `ginkgo-page` / asset 引用会被 ACL 拒绝。
26. **ACL 计算顺序不能改**：deny 优先短路 → 资源显式 → 组织节点继承（用 `org_nodes.path` 前缀判断祖先）→ 空间基线；`owner/admin` 不会被降级成 editor。新增资源类型时必须同时接入 `assertAccess`，否则团队 viewer 可以绕过接口写入。
27. **页面写入只有带 `baseVersion` 才走 CAS**：不传时仍走 `putPage`（版本递增但属于后写覆盖）；前端 `savePage/saveContent` 传 `cur.version`，冲突会抛 `VersionConflictError`，`NoteView` 捕获后转只读。不要在服务端把 409 吞成 200。
28. **presence 按空间隔离**：SSE `/presence/page/:id/stream` 用当前 `X-Space` 校验；`/shared` 个人笔记共享页不在该空间上下文，所以暂时没有在线头像。编辑占用由 `doc_locks` 维护，心跳同时续租，30s 定时清理过期锁。
29. **协作页面 UI 约定（交接重点）**：下拉一律 `GnSelect`（空间不足自动上翻）、确认用行内二次确认而非 `window.confirm`、内容上限 1560px、好友/团队两列断点 1024px、滚动条走 `gn-scroll` 细条、团队切换用左侧竖向导航（208px、sticky）、人员选择只用 `PeoplePicker`（好友/团队分组 + 同人去重）。好友页/团队页目前仍有用户未认可的视觉问题，接手时优先重排布局骨架，不要继续微调 padding。
30. **祖先 `overflow: hidden` 会裁掉绝对定位下拉**：团队页为了圆角给 `.tm-card` 加了 `overflow: hidden`，结果 `PeoplePicker` 的 `.pp-panel`（`position: absolute`）整块被裁掉，点开只看到 tab 栏一行、列表消失。弹层/下拉的祖先链上不能有 `overflow: hidden`；圆角改由内部区块自己写 `border-radius: 0 0 11px 11px` 实现。
31. **「容器 click 开合 + 内部 input focus 开合」会双切换**：点输入框时先触发 `focus` 打开，紧接着 click 冒泡到容器又关掉，表现为「点了没反应」。容器的 click 处理必须先 `if (e.target.closest('input, .pp-chip')) return`，只让 focus 负责打开。
32. **`flex-direction: column` 时 `align-items: flex-start` 会让子项缩成内容宽度**：团队页窄屏断点切成纵向堆叠后，卡片只剩约 490px 宽、右侧大片空白。切纵向必须同时把 `align-items` 改成 `stretch`。另外 `PeoplePicker` 根节点带 `flex: 1 1 220px`（为横向排布设计），放进纵向容器会被撑成 220px 高，需要在容器里 `:deep(.pp) { flex: 0 0 auto }` 收掉。
33. **就地编辑不要在下方再开一行表单**：组织节点重命名原来在行下面插一条 `ot-inline` 输入框，同一份信息出现两处、行高还会跳。改成把标题 `span` 直接换成 `input`（同一个 flex 行内），配合 `nextTick` 后 `focus() + select()`；`保存/取消` 必须加 `@mousedown.prevent`，否则点击时 input 先 blur 触发失焦提交，取消永远点不掉。
34. **树形结构里的「新增」是按节点插入，不是一个全局表单**：组织架构的「新增下级」原来渲染在列表顶部，点任何节点的 + 都跑到最上面，看不出是谁的下级。做法是把可见行做成带类型的扁平数组（`{kind:'node'} | {kind:'add'}`），在父节点 push 之后、递归子节点之前插入 add 行，缩进直接用 `depth + 1`；模板里用 `row.kind` 判别渲染，`vue-tsc` 才能对 `row.node` 正确收窄。根级新增（`parentId === null`）要单独在 walk 结束后追加，否则永远插不进去。
35. **TransitionGroup 的每个子节点必须是一个元素**：`<template v-for :key>` 产出的是 fragment，动画会静默失效。要给每个 key 套一层包裹元素（这里是 `.ot-slot`），并把 `v-if/v-else` 放进包裹内。另外 `height` 过渡必须有具体数值：`before-enter` 里先写 `height:0`、`enter` 里读 `scrollHeight` 再写回，`leave` 里先锁 `getBoundingClientRect().height` 再归 0；只写 CSS 类不做这两步，高度不会动。
36. **拖拽换位别用「sort 数值」做接口**：前端算不出稳定的中间值（并列、浮点精度都会出问题）。让服务端接 `beforeId`（插到哪个兄弟之前，空表示末尾），在事务里把该父节点下的兄弟整体重排成 1..n，同时只在父节点真的变了时才更新子树 `path/depth`。前端还要挡「拖到自己的下级」——原生 DnD 在不调 `preventDefault` 时不会触发 drop，正好可以当作拒绝态。
37. **`overflow-y: auto` 的列表会同时「裁掉」和「撑开」绝对定位下拉**：`.pf-list` 这类滚动容器里放 `position: absolute` 的浮层，面板超出底部会被裁掉（只露出一条边），而且它计入 scrollable overflow，哪怕只有一行成员也会冒出滚动条、把行宽压掉十几像素，表现为「下拉框和滚动条挤在一起」。下拉/菜单一律 `Teleport to="body"` + `position: fixed`，坐标由触发器 `getBoundingClientRect()` 算（下方不够就上翻、右对齐后夹进视口）。两个连带问题：①判断「点击在面板外」必须把 teleport 出去的 panel 也纳入判断，否则 mousedown 先关面板、click 落不到选项上；②滚动/窗口缩放要重算位置，否则浮层会与触发器脱开。

---

## 十、维护说明

本文档的权威更新方式：**运行维护 skill**。维护 skill 会：
1. 读取最新的 `git log --oneline --all`
2. 扫描 `server/` 新路由
3. 扫描 `src/` 新目录/新组件
4. 自动更新本文档的**第五节（Git 提交历史）**和**第三节（功能清单）**
5. 如发现新的模块分层异常，在文末追加提醒

手动修改后，请把修改合并到 skill 的输出流程中，保证下次 skill 运行不会覆盖你的手写补充。
