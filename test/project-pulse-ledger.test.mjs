import test from 'node:test';
import assert from 'node:assert/strict';
import {createProjectPulseLedger} from '../src/project-pulse-ledger.js';

const pulse = (overrides = {}) => ({
  at: '2026-11-09T10:00:00.000Z', repo: true, branch: 'main', head: 'abc1234',
  commits: [{short: 'abc1234', date: '2026-11-09', subject: '补齐推送'}],
  dirty: {total: 1, modified: 1, untracked: 0, truncated: false}, unavailable: [],
  ...overrides,
});

async function fixture() {
  let saved;
  const ledger = createProjectPulseLedger({store: {get: async () => structuredClone(saved), put: async (_k, v) => { saved = structuredClone(v); }}});
  return {ledger, persisted: () => saved};
}

test('第一次看到项目只记账，不报变化', async () => {
  const {ledger, persisted} = await fixture();
  const first = await ledger.observe({root: '/p/one', label: '项目一', pulse: pulse()});
  assert.equal(first.firstSeen, true);
  assert.equal(first.changed, false);
  assert.equal(persisted().projects.length, 1);
  assert.equal(persisted().projects[0].head, 'abc1234');
  assert.equal(persisted().projects[0].dirty, 1);
});

test('提交、分支、未提交改动变化时分别报出来', async () => {
  const {ledger} = await fixture();
  await ledger.observe({root: '/p/one', label: '项目一', pulse: pulse()});
  const moved = await ledger.observe({root: '/p/one', label: '项目一', pulse: pulse({
    head: 'def5678', branch: 'feat/x',
    commits: [{short: 'def5678', date: '2026-11-09', subject: '新增推送'}],
    dirty: {total: 4, modified: 3, untracked: 1, truncated: false},
  })});
  assert.equal(moved.changed, true);
  assert.equal(moved.changes.length, 3);
  assert.match(moved.changes.join('；'), /HEAD abc1234 → def5678（def5678 新增推送）/);
  assert.match(moved.changes.join('；'), /分支 main → feat\/x/);
  assert.match(moved.changes.join('；'), /未提交改动 1 → 4（\+3）/);
});

test('没有变化时不产生噪音', async () => {
  const {ledger} = await fixture();
  await ledger.observe({root: '/p/one', label: '项目一', pulse: pulse()});
  const same = await ledger.observe({root: '/p/one', label: '项目一', pulse: pulse()});
  assert.equal(same.changed, false);
  assert.equal(same.changes, null);
  assert.equal(same.firstSeen, false);
});

test('读取失败的项目保留旧记录，不记成没有变化', async () => {
  const {ledger, persisted} = await fixture();
  await ledger.observe({root: '/p/one', label: '项目一', pulse: pulse()});
  const failed = await ledger.observe({root: '/p/one', label: '项目一', pulse: {at: '2026-11-09T11:00:00.000Z', repo: false, reason: 'not_a_repository'}});
  assert.equal(failed.changed, false);
  assert.equal(persisted().projects[0].head, 'abc1234');
});

test('不同项目分开记账，最多保留 200 条', async () => {
  const {ledger, persisted} = await fixture();
  await ledger.observe({root: '/p/a', label: 'A', pulse: pulse()});
  await ledger.observe({root: '/p/b', label: 'B', pulse: pulse({head: 'bbb2222'})});
  assert.equal(persisted().projects.length, 2);
  assert.deepEqual(persisted().projects.map(row => row.label).sort(), ['A', 'B']);
  for (let i = 0; i < 205; i += 1) await ledger.observe({root: `/p/many-${i}`, label: `M${i}`, pulse: pulse({head: `h${i}`})});
  assert.equal(persisted().projects.length, 200);
});

test('状态页只说记了多少，不泄露路径', async () => {
  const {ledger} = await fixture();
  await ledger.observe({root: '/p/one', label: '项目一', pulse: pulse()});
  const view = await ledger.status();
  assert.equal(view.projects.length, 1);
  assert.equal(JSON.stringify(view).includes('/p/one'), false);
  assert.match(view.text, /已记录 1 个项目/);
});

test('开启盯项目后按间隔检查，只在真有变化时发一条', async () => {
  let saved; const sent = [];
  const start = new Date('2026-11-09T10:00:00Z');
  const ledger = createProjectPulseLedger({store: {get: async () => structuredClone(saved), put: async (_k, v) => { saved = structuredClone(v); }}, clock: () => start});
  let head = 'abc1234';
  const capture = async () => ({repo: true, branch: 'main', head, commits: [{short: head, subject: '改动'}], dirty: {total: 0, modified: 0, untracked: 0}, at: start.toISOString()});
  await ledger.enable({sessionId: 'session-a', bindingKey: 'a'.repeat(64), projects: [{root: '/p/one', label: '项目一'}], intervalMinutes: 30, capture});
  assert.equal(ledger.needsTimer(), true);
  const notify = async item => { sent.push(item); return {status: 'reported_sent'}; };

  const first = await ledger.tick({capture, notify, now: start});
  assert.equal(first.checked, 0, '刚开启时还没到间隔，不检查');
  assert.equal(sent.length, 0);

  head = 'def5678';
  const early = await ledger.tick({capture, notify, now: new Date(start.getTime() + 60000)});
  assert.equal(early.changed, 0, '没到间隔不检查');
  const second = await ledger.tick({capture, notify, now: new Date(start.getTime() + 31 * 60000)});
  assert.equal(second.changed, 1);
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /项目有变化/);
  assert.match(sent[0].text, /项目一：HEAD abc1234 → def5678/);
  assert.match(sent[0].text, /建议：/);
  assert.equal(sent[0].sessionId, 'session-a');

  const quiet = await ledger.tick({capture, notify, now: new Date(start.getTime() + 62 * 60000)});
  assert.equal(quiet.changed, 0);
  assert.equal(sent.length, 1, '没有变化不再发');
});

test('关闭盯项目后不再检查，换绑要求重新授权', async () => {
  let saved;
  const ledger = createProjectPulseLedger({store: {get: async () => structuredClone(saved), put: async (_k, v) => { saved = structuredClone(v); }}});
  await assert.rejects(ledger.enable({sessionId: 's', bindingKey: 'not-a-binding', projects: [{root: '/p', label: 'p'}]}), /binding/);
  await assert.rejects(ledger.enable({sessionId: 's', bindingKey: 'a'.repeat(64), projects: []}), /projects/);
  await ledger.enable({sessionId: 's', bindingKey: 'a'.repeat(64), projects: [{root: '/p', label: 'p'}]});
  assert.equal(ledger.needsTimer(), true);
  await ledger.disable();
  assert.equal(ledger.needsTimer(), false);
  const result = await ledger.tick({capture: async () => ({repo: true}), notify: async () => ({status: 'reported_sent'}), now: new Date('2026-11-10T00:00:00Z')});
  assert.equal(result.changed, 0);
});
