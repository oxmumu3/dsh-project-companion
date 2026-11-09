import test from 'node:test';
import assert from 'node:assert/strict';

const api = () => import('../src/project-pulse.js');
const FIXED = new Date('2026-11-09T10:00:00Z');

function fakeRepo({branch = 'main', head = 'abc1234', log = '', status = '', fail = []} = {}) {
  const calls = [];
  const run = async args => {
    calls.push(args);
    const command = args.slice(2).join(' ');
    if (command === 'rev-parse --is-inside-work-tree') return 'true\n';
    if (fail.includes(command.split(' ')[0])) throw new Error('git failed');
    if (command.startsWith('symbolic-ref')) return `${branch}\n`;
    if (command.startsWith('rev-parse')) return `${head}\n`;
    if (command.startsWith('log')) return log;
    if (command.startsWith('status')) return status;
    throw new Error(`unexpected git command: ${command}`);
  };
  return {run, calls};
}

test('项目脉搏只跑本机只读 git 命令并压成一段摘要', async () => {
  const {createProjectPulse} = await api();
  const {run, calls} = fakeRepo({
    log: 'abc1234\x1f2026-11-08\x1f补齐推送\n1234567\x1f2026-11-07\x1f修状态页',
    status: ' M src/a.js\n?? notes.md\n M b.js\n',
  });
  const pulse = createProjectPulse({run, clock: () => FIXED});
  const value = await pulse.capture('/synthetic/project');
  assert.equal(value.repo, true);
  assert.equal(value.branch, 'main');
  assert.equal(value.head, 'abc1234');
  assert.deepEqual(value.commits.map(row => row.short), ['abc1234', '1234567']);
  assert.deepEqual(value.dirty, {total: 3, modified: 2, untracked: 1, truncated: false});
  assert.equal(value.at, FIXED.toISOString());
  assert.ok(calls.every(args => args[0] === '-C' && args[1] === '/synthetic/project'));
  assert.deepEqual(calls.map(args => args.slice(2).join(' ')), [
    'rev-parse --is-inside-work-tree', 'symbolic-ref --short HEAD', 'rev-parse --short HEAD',
    'log -5 --date=short --pretty=format:%h%x1f%ad%x1f%s', 'status --porcelain',
  ]);
});

test('摘要说清分支、提交与未提交改动，不凑字数', async () => {
  const {createProjectPulse, summarize} = await api();
  const pulse = createProjectPulse({run: fakeRepo({
    log: 'abc1234\x1f2026-11-08\x1f补齐推送',
    status: ' M src/a.js\n',
  }).run, clock: () => FIXED});
  const text = summarize(await pulse.capture('/synthetic/project'));
  assert.match(text, /分支 main/);
  assert.match(text, /最近 1 次提交：abc1234 补齐推送/);
  assert.match(text, /未提交改动 1 个文件/);
  assert.equal(summarize({repo: true, branch: 'main', commits: [], dirty: {total: 0, modified: 0, untracked: 0, truncated: false}}), '分支 main；工作区没有未提交改动');
  assert.equal(summarize({repo: false, reason: 'not_a_repository'}), '');
});

test('不是仓库时说清楚原因，不猜成干净', async () => {
  const {createProjectPulse} = await api();
  const run = async () => { throw new Error('not a git repository (or any parent)'); };
  const pulse = createProjectPulse({run, clock: () => FIXED});
  assert.deepEqual(await pulse.capture('/synthetic/plain-folder'), {at: FIXED.toISOString(), repo: false, reason: 'not_a_repository'});
});

test('单个 git 子命令失败时标记不可用，不让整次脉搏失败', async () => {
  const {createProjectPulse, summarize} = await api();
  const {run} = fakeRepo({log: 'abc1234\x1f2026-11-08\x1f提交', status: ' M a.js\n', fail: ['symbolic-ref', 'status']});
  const pulse = createProjectPulse({run, clock: () => FIXED});
  const value = await pulse.capture('/synthetic/project');
  assert.equal(value.repo, true);
  assert.equal(value.branch, null);
  assert.deepEqual(value.unavailable.sort(), ['branch', 'status']);
  assert.equal(value.dirty, null);
  assert.match(summarize(value), /未能读取：branch、status/);
});

test('未提交改动超过上限时截断并明说', async () => {
  const {createProjectPulse} = await api();
  const status = Array.from({length: 260}, (_, i) => ` M file-${i}.js`).join('\n') + '\n';
  const pulse = createProjectPulse({run: fakeRepo({status}).run, clock: () => FIXED});
  const value = await pulse.capture('/synthetic/project');
  assert.equal(value.dirty.total, 260);
  assert.equal(value.dirty.truncated, true);
  assert.equal(value.dirty.modified, 200);
});

test('拒绝空根目录，避免在错误位置执行 git', async () => {
  const {createProjectPulse} = await api();
  const pulse = createProjectPulse({run: async () => 'true', clock: () => FIXED});
  await assert.rejects(pulse.capture(''), /project root/);
  await assert.rejects(pulse.capture(undefined), /project root/);
});
