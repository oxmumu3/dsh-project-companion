#!/usr/bin/env node
// 升级前自查：用当前安装包里的 schema 解析本机已存的状态。
//
// 0.24.2 升级时踩过一次「旧状态多了个字段，插件激活失败」。这个脚本把同样的
// 检查提前到升级之前：只读本机 JSON，不启动 Host、不写任何文件。
//
// 用法：node scripts/validate-state.mjs [状态目录]
// 默认读 $DSH_HOME/storages，未设置时读 ~/.dsh/storages。
import {readFileSync, existsSync, readdirSync} from 'node:fs';
import {homedir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const storages = resolve(process.argv[2] ?? join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'storages'));

// 只有导出了 schema 的域才能在这里核对；其余域在升级后由 Host 自己解析。
const DOMAINS = {
  project_companion_goals: ['goal-board-store.js', 'goalBoardRowSchema'],
  project_companion_news: ['news-service.js', 'newsRowSchema'],
  project_companion_personal_review: ['personal-review.js', 'personalReviewRowSchema'],
  project_companion_context: ['context-service.js', 'contextRowSchema'],
  project_companion_context_loop: ['context-loop.js', 'contextLoopRowSchema'],
  project_companion_task_results: ['task-results.js', 'taskResultsRowSchema'],
  project_companion_workspace_access: ['workspace-access.js', 'workspaceAccessRowSchema'],
  project_companion_pulse: ['project-pulse-ledger.js', 'pulseLedgerRowSchema'],
};

if (!existsSync(storages)) {
  console.error(`找不到状态目录：${storages}`);
  process.exit(2);
}

let checked = 0;
let failed = 0;
for (const [domain, [file, exportName]] of Object.entries(DOMAINS)) {
  const path = join(storages, `${domain}.json`);
  if (!existsSync(path)) continue;
  const data = JSON.parse(readFileSync(path, 'utf8'));
  const record = data?.tables?.state?.profile;
  if (record === undefined) {
    console.log(`${domain}：跳过（没有 profile 记录）`);
    continue;
  }
  let schema;
  try {
    schema = (await import(pathToFileURL(join(root, 'src', file)).href))[exportName];
  } catch (error) {
    console.log(`${domain}：跳过（本包没有 ${exportName}：${error?.code ?? error?.message}）`);
    continue;
  }
  checked += 1;
  const result = schema.safeParse(record);
  if (result.success) {
    console.log(`${domain}：兼容`);
    continue;
  }
  failed += 1;
  console.log(`${domain}：不兼容`);
  for (const issue of result.error.issues.slice(0, 3)) {
    console.log(`  - ${issue.path.join('.') || '(root)'}：${issue.message}`);
  }
}

const unreadable = readdirSync(storages).filter(name => name.startsWith('project_companion') && name.endsWith('.json') && !Object.keys(DOMAINS).includes(name.replace(/\.json$/, '')));
for (const name of unreadable) console.log(`${name.replace(/\.json$/, '')}：未核对（本包不导出该域的 schema）`);

console.log(`\n核对 ${checked} 个域，${failed} 个不兼容。`);
process.exit(failed ? 1 : 0);
