#!/usr/bin/env node
// 分模块 git 提交脚本
// 用法：node scripts/commit-all.cjs
// 核心改进：
//   - 用 porcelain=v1 + 同时看索引区/工作区，不丢任何改动
//   - 用 git diff -U0 提取每个文件的 export 名称、新增 import 符号、Vue 组件标签等实际语义
//   - commit body 是【新增/修改/删除/重命名】+ 内容描述，不是纯文件列表

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
function run(cmd, opts = {}) {
  try {
    return execSync(cmd, { cwd: REPO, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], ...opts }).trim();
  } catch (e) {
    throw new Error(`[${cmd}] 失败: ${e.stderr || e.message}`);
  }
}
function runOK(cmd) { try { run(cmd); return true; } catch { return false; } }

// ------- 硬过滤 -------
const IGNORED_PREFIXES = [
  'node_modules/', '.pnpm-store/', '.git/', 'dist/', 'dist-ssr/',
  'server/data/', '.vite/', '.cache/', '.turbo/', '.next/',
  'coverage/', '.workbuddy/', '.dev/',
  // AI 编码工具本地配置
  '.trae/', '.trae-cn/', '.cursor/', '.windsurf/', '.continue/', '.roo/', '.aider/',
];
function isIgnored(f) {
  const n = f.replace(/\\/g, '/');
  return IGNORED_PREFIXES.some(p => n.startsWith(p));
}

// ------- porcelain=v1 抓每个文件的 { op, add, del } -------
function collectFileStatusMap() {
  const map = new Map();
  const statusLines = runOK('git status --porcelain=v1')
    ? run('git status --porcelain=v1').split('\n').filter(Boolean) : [];
  const numstatLines = runOK('git diff --numstat HEAD')
    ? run('git diff --numstat HEAD').split('\n').filter(Boolean) : [];
  const numstatMap = new Map();
  for (const line of numstatLines) {
    const parts = line.split('\t');
    if (parts.length >= 3) {
      const [add, del, ...rest] = parts;
      numstatMap.set(rest.join('\t').replace(/\\/g, '/'), {
        add: add === '-' ? 0 : parseInt(add, 10) || 0,
        del: del === '-' ? 0 : parseInt(del, 10) || 0,
      });
    }
  }
  for (const line of statusLines) {
    const x = line[0], y = line[1];
    let p = line.slice(2).trim(); // XY + path，Y 是空格时没有额外分隔，slice(2) 最稳
    if (x === '?' && y === '?') { if (!isIgnored(p)) map.set(p, { op: '新增', add: 0, del: 0 }); continue; }
    if (x === 'U' || y === 'U') { if (!isIgnored(p)) map.set(p, { op: '修改', add: 0, del: 0 }); continue; }
    if (p.includes(' -> ')) {
      const parts = p.split(' -> ');
      const opPath = parts[parts.length - 1];
      const op = x === 'R' || x === 'C' ? '重命名' : '修改';
      if (!isIgnored(opPath)) map.set(opPath, { op, add: 0, del: 0 });
      continue;
    }
    const stateX = x === ' ' ? null : x, stateY = y === ' ' ? null : y;
    const activeState = stateX || stateY;
    let op = '修改';
    switch (activeState) {
      case 'A': op = '新增'; break;
      case 'D': op = '删除'; break;
      case 'R': case 'C': op = '重命名'; break;
      case 'M': case 'T': op = '修改'; break;
    }
    if (isIgnored(p)) continue;
    const ns = numstatMap.get(p) || { add: 0, del: 0 };
    map.set(p, { op, add: ns.add, del: ns.del });
  }
  return map;
}

// ------- 用 git diff 或文件内容 提取每个文件的语义描述 -------
// 返回：{ desc: string }，尽量用中文描述内容而不是路径
function extractFileDescription(filePath, op) {
  const ext = path.extname(filePath);
  const stem = path.basename(filePath, ext);
  const dir = path.dirname(filePath).replace(/\\/g, '/');
  const parts = dir.split('/').filter(Boolean);
  const topDir = parts[0] || '';
  const subDir = parts.slice(1).join('/');

  // ---- 按路径类型猜文件的"角色" ----
  function guessRole() {
    if (filePath === 'PROGRESS.md') return '项目开发进度文档';
    if (filePath.startsWith('scripts/')) return 'Git 脚本工具';
    if (filePath.startsWith('.trae/')) return 'AI 维护 Skill 定义';
    if (filePath.startsWith('server/')) {
      if (filePath.endsWith('.ts')) {
        // 后端某个具体模块
        const name = path.basename(filePath, '.ts');
        const label = {
          'routes': '主路由装配',
          'features': '功能路由聚合',
          'auth': '认证中间件',
          'account': '账号功能',
          'share': '公开分享',
          'members': '成员协作',
          'ai': 'AI 代理',
          'mcp': 'MCP 服务',
          'webhooks': 'Webhook 投递',
          'notify': '站内通知',
          'mailer': '邮件发送',
          'templates': '模板种子',
          'totp': '两步验证',
          'db': 'SQLite 连接',
          'http': 'HTTP 工具',
          'index': '服务入口',
        }[name];
        return label ? `后端 ${label}` : `后端模块 (${name})`;
      }
      return '后端文件';
    }
    // 前端路径
    if (topDir === 'src') {
      if (parts[1] === 'editor') return '编辑器内核';
      if (parts[1] === 'blocks') return 'TipTap 高级块';
      if (parts[1] === 'components') return '通用组件';
      if (parts[1] === 'views') return '路由页面';
      if (parts[1] === 'i18n') return '国际化词条';
      if (parts[1] === 'utils') return '导入导出工具';
      if (parts[1] === 'api') return 'API 接口层';
      if (parts[1] === 'db') return '前端数据仓储';
      return '前端文件';
    }
    return '项目文件';
  }

  const role = guessRole();

  // ---- 对新增文件：直接读文件提取主 export 名称 ----
  if (op === '新增') {
    let body = '';
    try { body = fs.readFileSync(path.join(REPO, filePath), 'utf-8'); } catch { body = ''; }
    const names = [];
    if (ext === '.ts' || ext === '.tsx' || ext === '.js') {
      // 提取 export function / export class / export const / export interface 名
      const re = /export\s+(?:default\s+)?(?:function|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g;
      let m; while ((m = re.exec(body)) !== null) names.push(m[1]);
      // 也抓 export default class XXX / export default function XXX
      const re2 = /export\s+default\s+(?:class|function)\s+([A-Za-z_$][\w$]*)/g;
      while ((m = re2.exec(body)) !== null) names.push(m[1]);
      // Vue SFC 的 export default defineComponent({ name: 'Xxx' })
      const nameMatch = body.match(/name:\s*['"]([^'"]+)['"]/);
      if (nameMatch) names.push(nameMatch[1]);
    }
    if (ext === '.vue') {
      // Vue SFC：export default { name: 'Xxx' } 或 defineComponent
      const nameMatch = body.match(/name:\s*['"]([^'"]+)['"]/);
      if (nameMatch) names.push(nameMatch[1]);
      const compMatch = body.match(/defineComponent\(\s*\{[^}]*name:\s*['"]([^'"]+)['"]/s);
      if (compMatch) names.push(compMatch[1]);
    }
    const unique = [...new Set(names)].slice(0, 3);
    const namesStr = unique.length > 0 ? unique.join(' / ') : '';
    const componentWord = ext === '.vue' ? '组件' : (ext === '.md' ? '文档' : '模块');
    if (namesStr) return `${role}：新增 ${namesStr} ${componentWord}`;
    return `${role}：新增 ${stem} ${componentWord}`;
  }

  // ---- 对删除文件：直接说删了什么 ----
  if (op === '删除') {
    if (ext === '.vue') return `${role}：删除 ${stem} 组件`;
    return `${role}：删除 ${stem} 文件`;
  }
  if (op === '重命名') {
    return `${role}：重命名 ${stem}`;
  }

  // ---- 对修改文件：跑 git diff -U0 提取实际变动内容 ----
  let patch = '';
  try {
    // 用 --diff-filter=M 不关心，就跑普通 diff
    patch = run(`git diff HEAD -U0 -- "${filePath.replace(/\\/g, '/')}"`);
  } catch {
    patch = '';
  }
  const added = [], removed = [];
  for (const line of patch.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) continue;
    if (line.startsWith('+')) added.push(line.slice(1));
    else if (line.startsWith('-')) removed.push(line.slice(1));
  }

  // ---- 从 +/- 行里提取有意义的标识符 ----
  const extractedAdded = extractSymbols(filePath, added, ext, role);
  const extractedRemoved = extractSymbols(filePath, removed, ext, role);
  const summary = summarizeChanges(filePath, ext, role, stem, patch, extractedAdded, extractedRemoved);

  return summary;
}

// 从若干 +/- 行里提取关键标识符
function extractSymbols(filePath, lines, ext, role) {
  const names = new Set();

  // 1) TS/JS：export function/class/const/let/interface/type/enum/变量赋值
  if (['.ts', '.tsx', '.js'].includes(ext)) {
    const reExport = /export\s+(?:default\s+)?(?:function|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g;
    for (const l of lines) { let m; while ((m = reExport.exec(l)) !== null) names.add(m[1]); }
  }

  // 2) TS/JS：import 里的新增符号
  if (['.ts', '.tsx', '.js'].includes(ext)) {
    // import { A, B, C } from 'xxx'
    for (const l of lines) {
      const m = l.match(/import\s*\{([^}]+)\}\s*from/);
      if (m) {
        const items = m[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
        items.forEach(n => names.add(n));
      }
    }
  }

  // 3) Vue：template 里新增/修改的 <Component> 标签
  if (ext === '.vue') {
    for (const l of lines) {
      const m = l.match(/<([A-Z][A-Za-z0-9]+)(?:\s|\/|>)/);
      if (m) names.add(m[1]);
      const m2 = l.match(/name:\s*['"]([^'"]+)['"]/);
      if (m2) names.add(m2[1]);
    }
  }

  // 4) TipTap 特殊：addNode, mergeConfig, commands 名称
  for (const l of lines) {
    const m = l.match(/addNode\(\s*['"]([^'"]+)['"]/);
    if (m) names.add(`TipTap 节点: ${m[1]}`);
    const m2 = l.match(/insert\w+Block|insert\w+|delete\w+|update\w+/);
    if (m2) names.add(m2[0]);
  }

  // 5) CSS/style：颜色变量、class 名
  if (['.css', '.scss', '.less'].includes(ext)) {
    for (const l of lines) {
      const m = l.match(/\.([a-zA-Z_-][a-zA-Z0-9_-]*)\s*\{/);
      if (m) names.add(`CSS 类: .${m[1]}`);
    }
  }

  // 6) i18n：新增词条 key
  if (role === '国际化词条') {
    for (const l of lines) {
      const m = l.match(/^\s*['"]([A-Za-z0-9_.]+)['"]\s*:/);
      if (m) names.add(`词条: ${m[1]}`);
    }
  }

  // 7) HTTP API：新增/修改路由
  if (filePath === 'server/routes.ts' || filePath === 'server/features.ts') {
    for (const l of lines) {
      const m = l.match(/\.(get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)['"]/);
      if (m) names.add(`${m[1].toUpperCase()} ${m[2]}`);
    }
  }

  return [...names];
}

// 综合描述一个修改文件改了什么
function summarizeChanges(filePath, ext, role, stem, patch, addedNames, removedNames) {
  const summary = [];

  if (removedNames.length > 0) {
    const list = removedNames.slice(0, 3).join('、');
    summary.push(`移除 ${list}${removedNames.length > 3 ? ` 等 ${removedNames.length}` : ''}`);
  }
  if (addedNames.length > 0) {
    const list = addedNames.slice(0, 3).join('、');
    summary.push(`新增 ${list}${addedNames.length > 3 ? ` 等 ${addedNames.length}` : ''}`);
  }

  // 如果名字都没抓到（比如改的是 CSS 值、或大型 template 改动没有 export 变化）
  if (summary.length === 0) {
    // 看 hunk 数量（行数变化点）
    const hunks = (patch.match(/^@@/gm) || []).length;
    if (hunks > 5) summary.push(`多处重构`);
    else summary.push(`微调 ${stem}`);
  }

  return `${role}：${summary.join('，')}`;
}

// ------- 模块分组 -------
const MODULES = [
  { name: 'infra',               label: '基础设施',                            type: 'chore',        globList: ['scripts/', 'run.bat', 'package.json', 'pnpm-lock.yaml', 'vite.config.ts', 'tsconfig.json', 'server/tsconfig.json', 'index.html', '.gitattributes', '.gitignore'] },
  { name: 'server-core',         label: '后端核心（DB/认证/HTTP）',           type: 'feat(server)', globList: ['server/db.ts', 'server/http.ts', 'server/auth.ts', 'server/totp.ts', 'server/index.ts'] },
  { name: 'server-api',          label: '后端 API 路由',                      type: 'feat(server)', globList: ['server/routes.ts', 'server/features.ts', 'server/account.ts'] },
  { name: 'server-integrations', label: '后端集成（共享/协作/AI/MCP/Webhook/通知）', type: 'feat(server)', globList: ['server/share.ts', 'server/members.ts', 'server/ai.ts', 'server/mcp.ts', 'server/webhooks.ts', 'server/notify.ts', 'server/mailer.ts', 'server/templates.ts'] },
  { name: 'editor-kernel',       label: '编辑器内核',                          type: 'feat(editor)', globList: ['src/editor/'] },
  { name: 'blocks',              label: '高级块（代码/图表/多维表格/页面卡片）', type: 'feat(blocks)', globList: ['src/blocks/'] },
  { name: 'components',          label: '通用组件（侧栏/搜索/分享/目录等）',   type: 'feat(ui)',     globList: ['src/components/'] },
  { name: 'views',               label: '路由页面',                            type: 'feat(ui)',     globList: ['src/views/'] },
  { name: 'i18n',                label: '国际化',                              type: 'feat(i18n)',   globList: ['src/i18n/'] },
  { name: 'utils',               label: '导入导出与只读渲染',                  type: 'feat(utils)',  globList: ['src/utils/'] },
  { name: 'api-db',              label: '前端 API 层与数据仓储',               type: 'feat(data)',   globList: ['src/api/', 'src/db/'] },
  { name: 'app-shell',           label: '应用外壳与全局状态',                  type: 'feat(core)',   globList: ['src/App.vue', 'src/main.ts', 'src/store.ts', 'src/types.ts', 'src/style.css', 'src/env.d.ts', 'src/shortcuts.ts', 'src/userState.ts', 'src/pinLock.ts', 'src/directives/'] },
  { name: 'docs',                label: '开发文档',                            type: 'docs',         globList: ['PROGRESS.md', 'AGENTS.md'] },
  { name: 'skill',               label: '开发文档维护 skill',                   type: 'chore',        globList: ['.trae/'] },
];
function matchPattern(f, pat) { return f === pat || f.startsWith(pat); }

// ------- 主流程 -------
const statusMap = collectFileStatusMap();
const allFiles = [...statusMap.keys()];

console.log('=== 检查 git 状态 ===\n');
const statusShort = runOK('git status --short') ? run('git status --short') : '';
if (!statusShort) { console.log('✅ 工作区干净。'); process.exit(0); }
console.log('当前未提交改动：'); console.log(statusShort); console.log();
if (allFiles.length === 0) { console.log('✅ 过滤后没有需要提交的文件。'); process.exit(0); }

// 诊断（这次也用 description，而不是纯路径）
console.log(`📋 待提交文件语义预览（共 ${allFiles.length} 个）：\n`);
const descCache = new Map();
for (const [f, info] of statusMap) {
  const desc = extractFileDescription(f, info.op);
  descCache.set(f, desc);
}
for (const op of ['新增', '修改', '删除', '重命名']) {
  const filesOfOp = allFiles.filter(f => statusMap.get(f).op === op);
  if (filesOfOp.length > 0) {
    console.log(`  【${op}】${filesOfOp.length} 个：`);
    for (const f of filesOfOp) console.log(`    ${descCache.get(f)}`);
  }
}
console.log();

// ------- 模块分组 -------
const commits = [];
const committed = new Set();

for (const mod of MODULES) {
  const files = [];
  for (const f of allFiles) {
    if (committed.has(f)) continue;
    if (mod.globList.some(pat => matchPattern(f, pat))) files.push(f);
  }
  if (files.length === 0) continue;

  // 按操作类型分组，用已经生成好的语义描述
  const groups = { '新增': [], '修改': [], '删除': [], '重命名': [] };
  for (const f of files) {
    const info = statusMap.get(f) || { op: '修改' };
    groups[info.op].push({ f, desc: descCache.get(f) });
  }

  const bodyLines = [];
  for (const op of ['新增', '修改', '删除', '重命名']) {
    for (const item of groups[op]) bodyLines.push(`【${op}】${item.desc}`);
  }

  const commitMsg = `${mod.type}: ${mod.label}\n\n${bodyLines.join('\n')}`;
  commits.push({ module: mod.label, type: mod.type, files, msg: commitMsg });
  files.forEach(f => committed.add(f));
}

// ------- 未分类处理 -------
const remaining = allFiles.filter(f => !committed.has(f));
if (remaining.length > 0) {
  console.log(`⚠️  发现 ${remaining.length} 个未分类文件：`);
  remaining.forEach(f => console.log(`   ${f}（${descCache.get(f)}）`));
  if (commits.length === 0) {
    const body = remaining.map(f => {
      const info = statusMap.get(f) || { op: '修改' };
      return `【${info.op}】${descCache.get(f)}`;
    });
    commits.push({ module: '其它未分类文件', type: 'chore', files: remaining, msg: `chore: 提交剩余文件\n\n${body.join('\n')}` });
  } else {
    const last = commits[commits.length - 1];
    last.files.push(...remaining);
    for (const f of remaining) {
      const info = statusMap.get(f) || { op: '修改' };
      last.msg += `\n【${info.op}】${descCache.get(f)}`;
    }
  }
}
if (commits.length === 0) { console.log('✅ 没有任何模块有改动。'); process.exit(0); }

const anyFileMissing = allFiles.some(f => !committed.has(f));
if (anyFileMissing) {
  console.log('\n❌ 仍有文件没有被任何模块认领。');
  process.exit(1);
}

// ------- 执行提交 -------
console.log(`将按 ${commits.length} 个模块提交：\n`);
commits.forEach((c, i) => {
  const ops = {};
  for (const f of c.files) { const op = statusMap.get(f)?.op || '修改'; ops[op] = (ops[op] || 0) + 1; }
  const opStr = Object.entries(ops).map(([k, v]) => `${k}${v}`).join(' / ');
  console.log(`  ${i + 1}. [${c.type}] ${c.module}（${c.files.length} 个文件，${opStr}）`);
});
console.log();

const results = [];
for (const c of commits) {
  console.log(`\n--- 提交：${c.module} ---`);
  const addArgs = c.files.map(f => `"${f.replace(/\\/g, '/')}"`).join(' ');
  try { run(`git add -- ${addArgs}`); console.log(`  ✅ git add ${c.files.length} 个文件`); }
  catch (e) { console.log(`  ❌ git add 失败：${e.message}`); continue; }

  const msgFile = path.join(os.tmpdir(), `gn-commit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`);
  try {
    fs.writeFileSync(msgFile, c.msg, 'utf-8');
    run(`git commit -F "${msgFile}"`);
    const shortHash = run('git rev-parse --short HEAD');
    console.log(`  ✅ git commit  ${shortHash}`);
    try {
      const fullMsg = run(`git log -1 --format=%B`);
      console.log('  ┌─ 提交信息 ──────────────────');
      fullMsg.split('\n').forEach(line => console.log(`  │  ${line}`));
      console.log('  └────────────────────────────');
    } catch { /* noop */ }
    results.push({ module: c.module, type: c.type, hash: shortHash, ok: true });
  } catch (e) {
    console.log(`  ❌ git commit 失败：${e.message}`);
    results.push({ module: c.module, ok: false });
  } finally {
    try { fs.unlinkSync(msgFile); } catch { /* noop */ }
  }
}

console.log('\n=== 提交汇总 ===\n');
results.forEach(r => console.log(`  ${r.ok ? '✅' : '❌'} ${r.hash || '----'}  [${r.type || '----'}] ${r.module}`));
const okCount = results.filter(r => r.ok).length;
console.log(`\n成功 ${okCount}/${results.length} 个。`);
if (okCount === 0) { process.exit(1); }
console.log('\n最近提交：');
console.log(run('git log --oneline -5'));
