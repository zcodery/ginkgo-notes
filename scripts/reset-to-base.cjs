// 把 commit-all.cjs 之前产生的 commit 全部撤回
// HEAD 回退到 origin/main，所有改动保留在工作区（mixed reset）
// 然后重新执行 node scripts/commit-all.cjs
const { execSync } = require('child_process');
const path = require('path');
const REPO = path.resolve(__dirname, '..');
function run(cmd) {
  try { return execSync(cmd, { cwd: REPO, encoding: 'utf-8' }).trim(); }
  catch(e) { throw new Error(`[${cmd}] 失败: ${e.stderr || e.message}`); }
}

// 1. 看看现在 origin/main 和 HEAD 之间差了多少 commit
console.log('=== 当前 origin/main 与 HEAD 的差异 ===\n');
try {
  const ahead = run('git log origin/main..HEAD --oneline');
  if (!ahead) {
    console.log('✅ HEAD 已经和 origin/main 一致，没有要撤回的 commit。');
    process.exit(0);
  }
  console.log(ahead);
  console.log();
} catch(e) {
  // origin/main 可能还没 fetch，先 fetch 一下
  run('git fetch origin main');
  const ahead = run('git log origin/main..HEAD --oneline');
  if (!ahead) {
    console.log('✅ HEAD 已经和 origin/main 一致。');
    process.exit(0);
  }
  console.log(ahead);
  console.log();
}

// 2. 执行 mixed reset —— HEAD 回到 origin/main，工作区保留改动、暂存区清空
console.log('执行: git reset --mixed origin/main');
run('git reset --mixed origin/main');
console.log('✅ reset 完成。\n');

// 3. 确认当前状态
console.log('=== reset 后的状态 ===\n');
console.log(run('git log --oneline -3'));
console.log();
const status = run('git status --short');
console.log(status || '(干净)');
console.log();

console.log('现在可以重新执行: node scripts/commit-all.cjs');
