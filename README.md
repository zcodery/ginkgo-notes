# 银杏笔记（Ginkgo Notes）

> 一个自托管的 Markdown 笔记应用：写作、组织、协作与分享都在自己的服务器上。
>
> <!-- TODO(你改)：把上面这句一句话简介换成你喜欢的措辞；下面 badge 的仓库名按需改。 -->
> [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
> [![version](https://img.shields.io/badge/version-0.4.2-blue.svg)](./package.json)

<!-- TODO(你改)：这里放 1~2 张界面截图。把图片放进 docs/ 目录，然后取消下面注释并替换路径。
![首页仪表盘](docs/screenshot-home.png)
![编辑器](docs/screenshot-editor.png)
-->

## 为什么做这个

市面上的笔记服务很好用，但数据放在别人那里总归不踏实。银杏笔记的目标很简单：**Markdown 是唯一事实来源**——正文以 `.md` 字符串存储，编辑器（TipTap）只在编辑时存在，所以任何一篇笔记拿去 GitHub / Obsidian / Typora 都能直接渲染，不会被私有格式锁住。

在这个基础上，它把「一个人写笔记」扩展成了「一群人协作」：团队空间、好友关系、成员权限、公开分享、AI 助手、Webhook 与 MCP 接入，全部可以在自己的机器上跑起来。

## 功能特性

**写作与编辑**

- TipTap 3 富文本编辑器，但与 Markdown 块级 1:1 双向映射
- 任务列表、表格、代码块（highlight.js 高亮）、Mermaid 图表、折叠列表、图片
- 斜杠命令菜单（基础块 / 布局 / 媒体 / 高级块 / AI 分组）
- 引用式高级块：多维表格作为独立实体存在正文中（```` ```ginkgo-db <id> ````），可跨页复用
- 导入 / 导出：Markdown、Excel / Word / CSV（成员等）

**组织与协作**

- 个人空间 + 团队空间，按空间物理隔离数据
- 好友关系（申请 / 同意 / 新建分组 / 拉黑 / 搜索），好友分组是单边视图
- 团队邀请、成员批量导入、组织架构导入、组织树权限继承
- 统一 ACL：拒绝优先 → 资源显式授权 → 组织继承 → 空间基线
- 实时在线状态（SSE）、编辑占用提示

**分享与开放能力**

- 公开分享链接（可设密码 / 有效期 / 子页），只读页不加载编辑器
- 个人笔记分享给成员，viewer / editor 两级
- AI 助手：OpenAI 兼容接口，SSE 流式响应
- Webhook（HMAC-SHA256 签名）、MCP Streamable HTTP 服务（个人令牌认证）
- 邮件通知（SMTP）、GitHub OAuth 登录、TOTP 两步验证

**其它**

- 三语界面：简体中文 / 繁體中文 / English
- 亮色 / 暗色主题
- 管理员后台：人员统计与使用概览
- 版本号单点管理，前端可提示「发现新版本」

## 技术栈

| 层 | 选型 |
|---|---|
| 前端 | Vue 3.5 + TipTap 3.33 (ProseMirror) + Vite 8 + TailwindCSS 4 + lucide-vue-next |
| 后端 | Express 5 + Node.js 内置 `node:sqlite`（DatabaseSync，WAL 模式），**无第三方数据库驱动** |
| 鉴权 | JWT 会话 + scrypt 密码哈希 + Bearer 个人令牌 + API Token |
| 通信 | 统一 fetch 封装；实时状态走 SSE |
| 存储 | 服务端 SQLite 为主；IndexedDB 仅用于旧版数据迁移 |
| 包管理 | pnpm |

## 快速开始

### 环境要求

- **Node.js ≥ 22.6**（需要 `--experimental-strip-types` 直接运行 TypeScript 与内置 `node:sqlite`；开发验证版本 v22.22）
- **pnpm**

### 本地开发

```bash
# 1. 安装依赖
pnpm install

# 2. 复制环境变量模板（可选，但建议改掉管理员密码）
cp .env.example .env

# 3. 一条命令同时起前后端（前端 http://localhost:3100，后端 http://localhost:3101）
pnpm dev
```

> 前端 Vite 会把 `/api` 代理到后端端口。首次启动如果库里还没有管理员，会用
> `ADMIN_USERNAME` / `ADMIN_PASSWORD` 创建一个；**请务必在 `.env` 里改成自己的密码**。

### 生产运行

```bash
# 类型检查 + 构建前端，然后由 Express 同时托管 dist 与 API
pnpm build
pnpm start

# 或者一步到位
pnpm serve:prod
```

默认监听 `3101` 端口，数据写在 `server/data/`。可以用 `PORT` 和 `GINKGO_DATA_DIR` 覆盖。

## 环境变量

全部可选；完整清单与说明见 [`.env.example`](./.env.example)。常用的几个：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `3101` | 后端端口 |
| `GINKGO_DATA_DIR` | `server/data` | SQLite 库与 JWT 密钥所在目录 |
| `PUBLIC_URL` | 空 | 生成绝对分享链接时使用的对外地址 |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | `admin` / 见模板 | 首个管理员账号，仅初始化时生效 |
| `JWT_SECRET` | 自动生成并落库 | 多副本部署时显式共享同一把密钥 |
| `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` | 空 | OpenAI 兼容 AI 接口 |
| `SMTP_URL` / `SMTP_FROM` | 空 | 邮件通知 |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | 空 | GitHub OAuth |

## 项目结构

```
ginkgoNotes/
├── src/                  # Vue 前端
│   ├── views/            # 页面：首页 / 笔记 / 团队 / 好友 / 设置 / 管理后台 ...
│   ├── editor/           # TipTap 编辑器、斜杠菜单、Markdown 双向映射
│   ├── blocks/           # 多维表格等引用式高级块
│   ├── components/       # 通用 UI 组件
│   ├── api/              # fetch 封装（含鉴权头注入）
│   └── i18n/             # 三语词条
├── server/               # Express + node:sqlite 后端
│   ├── index.ts          # 入口
│   ├── db.ts             # 建表与通用 CRUD
│   ├── routes.ts / features.ts / auth.ts / acl.ts ...  # 分领域路由与中间件
│   └── data/             # 运行时数据（已 gitignore，不会进仓库）
├── scripts/              # 本地开发辅助脚本（种子数据、账号导出等）
├── PROGRESS.md           # 开发进度与架构真相（面向接手开发的 AI）
├── AGENTS.md             # AI 协作上下文与维护规范
└── vite.config.ts        # 前端 dev server 与 API 代理
```

## 开发相关说明

- `PROGRESS.md` 和 `AGENTS.md` 是给 AI 编码助手看的**开发日志与协作规范**，记录了架构决策、提交历史和踩坑清单（陷阱 1~123）。它们是项目文档的一部分，不是用户使用文档；普通使用者忽略即可。
- `scripts/` 下的脚本（如 `export-accounts.mjs`、`probe-passwords.mjs`）只针对**本地开发库**设计，用于切换测试账号、补发种子数据等。它们依赖开发库里账号密码的固定规律，**不要对生产库使用**。
- 数据目录 `server/data/` 已在 `.gitignore` 中，SQLite 库、JWT 密钥、账号清单都不会被提交。
- 想跑端到端测试或看更细的验证记录，参考 `PROGRESS.md` 的功能表与提交表。

## 许可证

[MIT](./LICENSE) © 2026 zcodery

<!-- TODO(你改)：如果这是你个人的项目，把上面的署名换成你自己；也可以顺便加一句致谢/联系方式。 -->
