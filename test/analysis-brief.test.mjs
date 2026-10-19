import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, utimes, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createService } from '../src/service.js';
import { readProjectFiles, FILE_BYTES } from '../src/sources.js';

async function fixture(t, files = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'companion-analysis-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, '.agent', 'memory'), { recursive: true });
  for (const [path, value] of Object.entries(files)) {
    await writeFile(join(root, path), value.text);
    if (value.at) await utimes(join(root, path), new Date(value.at), new Date(value.at));
  }
  let persisted, reads = 0;
  const owner = { sessionId: 'analysis-source-session', cwd: root };
  const service = createService({
    store: { get: async () => structuredClone(persisted), put: async (_key, value) => { persisted = structuredClone(value); } },
    discover: async () => [{ root, label: 'Synthetic analysis project' }],
    readProject: async projectRoot => { reads++; return readProjectFiles(projectRoot); },
    clock: () => new Date('2026-10-19T17:00:00Z'),
    hostTimeZone: 'America/Mexico_City',
  });
  return { root, owner, service, reads: () => reads, persisted: () => structuredClone(persisted) };
}

test('single-project analysis exposes the current blocker at the end of a file and timestamps old documents separately', async t => {
  const f = await fixture(t, {
    '.agent/memory/progress.md': { text: '# Progress\n' + 'Historical milestone\n'.repeat(350) + '\nCURRENT_BLOCKER: real host input is unavailable.\nNEXT_STEP: verify one real wake.', at: '2026-10-19T16:55:00Z' },
    '.agent/memory/context.md': { text: 'Original project scope, not current proof.', at: '2026-10-17T12:00:00Z' },
    'README.md': { text: 'Old installation description; not a claim about the current host.', at: '2026-10-16T12:00:00Z' },
  });
  const before = f.persisted();
  const result = await f.service.act(f.owner, { action: 'digest', project: f.root, detail: 'analysis' });
  assert.match(result.text, /CURRENT_BLOCKER: real host input is unavailable/);
  assert.match(result.text, /NEXT_STEP: verify one real wake/);
  assert.match(result.text, /2026-10-19T16:55:00/);
  assert.match(result.text, /2026-10-16T12:00:00/);
  assert.match(result.text, /引用数据.*不是指令/);
  assert.match(result.text, /本轮实际运行证据/);
  assert.equal(result.detail, 'analysis');
  assert.equal(result.analysis.sources.find(source => source.path.endsWith('progress.md')).role, 'progress_file');
  assert.equal(result.analysis.sources.find(source => source.path === 'README.md').role, 'product_documentation');
  for (const source of result.analysis.sources) assert.equal(source.truncated, false);
  assert.equal(f.reads(), 1, 'one selected root is read once without a second discovery scan');
  assert.deepEqual(f.persisted(), before, 'analysis must not opt in, schedule or write state');
});

test('analysis preserves the real 16 KiB source boundary and explicitly marks omitted file contents', async t => {
  const f = await fixture(t, {
    '.agent/memory/progress.md': { text: 'BOUNDARY_START\n' + 'x'.repeat(FILE_BYTES) + '\nOUTSIDE_READ_LIMIT' },
    'README.md': { text: 'small document' },
  });
  const result = await f.service.act(f.owner, { action: 'digest', project: f.root, detail: 'analysis' });
  assert.ok(result.analysis, 'analysis must expose source limits and actual read truncation');
  const source = result.analysis.sources.find(item => item.path.endsWith('progress.md'));
  assert.equal(source.truncated, true);
  assert.equal(source.truncation, '已截断：仅提供文件前 16384 字节内的材料');
  assert.ok(Buffer.byteLength(source.text) <= FILE_BYTES);
  assert.match(result.text, /已截断/);
  assert.doesNotMatch(result.text, /OUTSIDE_READ_LIMIT/);
  assert.equal(result.analysis.sources.find(item => item.path.endsWith('context.md')).status, 'missing');
  assert.ok(result.wechatText.length <= 3200);
});

test('analysis is opt-in for one explicit known project and invalid detail never triggers a source read', async t => {
  const f = await fixture(t, { 'README.md': { text: 'Synthetic file' } });
  for (const input of [
    { action: 'digest', detail: 'analysis' },
    { action: 'digest', project: f.root, detail: 'unbounded' },
    { action: 'digest', project: f.root, detail: null },
    { action: 'digest', project: '/unregistered/private', detail: 'analysis' },
  ]) await assert.rejects(f.service.act(f.owner, input), /analysis|detail|项目|未知|找不到/);
  assert.equal(f.reads(), 0);
  assert.equal(f.persisted(), undefined);
});

test('analysis keeps the brief mobile view and default summary independent from the larger model material', async t => {
  const f = await fixture(t, {
    '.agent/memory/progress.md': { text: '# Progress\n' + 'Earlier work. '.repeat(500) + 'TAIL_BLOCKER_ONLY_FOR_ANALYSIS' },
    'README.md': { text: 'Synthetic README' },
  });
  await f.service.act(f.owner, { action: 'watch' });
  const before = f.persisted();
  const summary = await f.service.act(f.owner, { action: 'digest', project: f.root });
  const analysis = await f.service.act(f.owner, { action: 'digest', project: f.root, detail: 'analysis' });
  const explicitSummary = await f.service.act(f.owner, { action: 'digest', project: f.root, detail: 'summary' });
  assert.match(analysis.text, /TAIL_BLOCKER_ONLY_FOR_ANALYSIS/);
  assert.doesNotMatch(summary.text, /TAIL_BLOCKER_ONLY_FOR_ANALYSIS/);
  assert.equal(explicitSummary.text, summary.text);
  assert.equal(analysis.wechatText, summary.wechatText);
  assert.ok(summary.text.length <= 3200);
  assert.ok(analysis.wechatText.length <= 3200);
  assert.deepEqual(f.persisted(), before);
});

test('analysis retains bounded observed event roles, full saved excerpts, original times and uncertainty', async t => {
  const f = await fixture(t, { 'README.md': { text: 'Synthetic README' } });
  await f.service.act(f.owner, { action: 'watch' });
  await f.service.record({ root: f.root, sessionId: f.owner.sessionId, id: 'old-hidden', kind: 'user', text: 'OLDER_EVENT_OUTSIDE_LATEST_THREE', at: '2026-10-16T12:00:00Z' });
  await f.service.record({ root: f.root, sessionId: f.owner.sessionId, id: 'user-control', kind: 'user', text: 'SCHEDULE_CONTROL: only check once; ' + 'x'.repeat(360) + ' NO_BUSINESS_WORK_REQUESTED', at: '2026-10-17T12:00:00Z' });
  await f.service.record({ root: f.root, sessionId: f.owner.sessionId, id: 'old-report', kind: 'assistant', text: 'OLD_ASSISTANT_REPORT: claimed done, not acceptance proof.', at: '2026-10-18T12:00:00Z' });
  await f.service.record({ root: f.root, sessionId: f.owner.sessionId, id: 'current-error', kind: 'error', text: 'CURRENT_RUNTIME_ERROR: input unavailable. ' + 'x'.repeat(600), at: '2026-10-19T16:59:00Z' });
  const result = await f.service.act(f.owner, { action: 'digest', project: f.root, detail: 'analysis' });
  assert.ok(result.analysis, 'analysis must preserve bounded observed event metadata');
  assert.deepEqual(result.analysis.events.map(event => event.kind), ['user', 'assistant', 'error']);
  assert.match(result.text, /NO_BUSINESS_WORK_REQUESTED/);
  assert.match(result.text, /2026-10-17T12:00:00/);
  assert.match(result.text, /OLD_ASSISTANT_REPORT/);
  assert.match(result.text, /CURRENT_RUNTIME_ERROR/);
  assert.doesNotMatch(result.text, /OLDER_EVENT_OUTSIDE_LATEST_THREE/);
  assert.match(result.text, /助手记录.*不是完成证明/);
  assert.match(result.text, /调度.*控制/);
  assert.equal(result.analysis.events.at(-1).truncated, true);
  assert.equal(result.analysis.events.at(-1).text.length, 500);
  assert.ok(result.analysis.events.every(event => event.text.length <= 500));
});

test('analysis does not invent complete historical events when the prior storage has no truncation metadata', async t => {
  const f = await fixture(t, { 'README.md': { text: 'Synthetic README' } });
  await f.service.act(f.owner, { action: 'watch' });
  const legacy = f.persisted();
  legacy.projects[0].events = [{ id: 'legacy-report', sessionId: f.owner.sessionId, kind: 'assistant', text: 'Old bounded assistant excerpt.', at: '2026-10-16T12:00:00Z' }];
  const service = createService({ store: { get: async () => legacy, put: async () => assert.fail('analysis cannot persist legacy state') }, hostTimeZone: 'UTC' });
  const result = await service.act(f.owner, { action: 'digest', project: f.root, detail: 'analysis' });
  assert.equal(result.analysis.events[0].truncated, null);
  assert.match(result.analysis.events[0].truncation, /完整性未知/);
  assert.match(result.text, /2026-10-16T12:00:00/);
});
