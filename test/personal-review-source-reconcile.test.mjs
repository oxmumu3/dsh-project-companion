import test from 'node:test';
import assert from 'node:assert/strict';
import { createPersonalReviewCollector } from '../src/personal-review-collect.js';
import { createPersonalReviewService } from '../src/personal-review.js';

const caller = { sessionId: 'source-close-owner', cwd: '/synthetic/project' };
const taskScopeKey = 'c'.repeat(64), task = { source: 'dida', projectId: 'project-one', taskId: 'task-one', scopeKey: taskScopeKey };
const base = { caller, sources: ['dida'], projects: [], kind: 'daily', from: '2026-10-29T17:00:00.000Z', to: '2026-10-30T17:00:00.000Z', taskScopeKey, trackedTasks: [task], guard: async () => true };
const collectWith = query => createPersonalReviewCollector({ query, readProject: async () => [] });

test('collector reads only the exact previously tracked task and accepts an explicit complete response', async () => {
  const calls = [];
  const collect = collectWith(async (_owner, input) => {
    calls.push(input);
    if (input.operation === 'read') return { items: [{ id: task.taskId, projectId: task.projectId, status: 'completed' }] };
    return { items: [] };
  });
  const result = await collect(base);
  const read = calls.find(input => input.operation === 'read');
  assert.equal(read?.id, task.taskId);
  assert.equal(read.projectId, task.projectId);
  assert.deepEqual(result.taskChecks, [{ task, status: 'completed', checkedAt: base.to }]);
});

test('missing, truncated, failed and mismatched task reads remain unknown', async () => {
  const completed = { id: task.taskId, projectId: task.projectId, status: 'completed' };
  for (const response of [null, { items: [] }, { items: [completed], truncated: true }, { items: [completed], coverage: { hasMore: true } }, { items: [{ ...completed, id: 'foreign-task' }] }, { items: [{ ...completed, projectId: 'foreign-project' }] }, { items: [{ ...completed, status: undefined }] }, { items: [completed, completed] }]) {
    const collect = collectWith(async (_owner, input) => {
      if (input.operation !== 'read') return { items: [] };
      if (response === null) throw new Error('404 or transport failure');
      return response;
    });
    assert.equal((await collect(base)).taskChecks?.[0]?.status, 'unknown');
  }
});

test('foreign task scopes and a disabled source never authorize a targeted read', async () => {
  const calls = [], collect = collectWith(async (_owner, input) => { calls.push(input); return { items: [] }; });
  await assert.rejects(collect({ ...base, taskScopeKey: 'd'.repeat(64) }));
  await assert.rejects(collect({ ...base, sources: ['gmail'] }));
  assert.equal(calls.length, 0);
});

test('revocation while checking a task aborts collection instead of recording completion', async () => {
  let allowed = true;
  const collect = collectWith(async (_owner, input) => {
    if (input.operation === 'read') { allowed = false; return { items: [{ id: task.taskId, projectId: task.projectId, status: 'completed' }] }; }
    return { items: [] };
  });
  await assert.rejects(collect({ ...base, guard: async () => allowed }), /revoked/);
});

async function serviceFixture(t) {
  let stored, currentTime = base.to, mode = 'open', grant = 'b'.repeat(64), round = 0;
  const queries = [], sends = [];
  const collect = collectWith(async (_owner, input) => {
    queries.push(input);
    if (input.operation === 'read') {
      if (mode === 'unknown') throw new Error('synthetic unavailable');
      return { items: [{ id: task.taskId, projectId: task.projectId, status: mode.startsWith('complete') ? 'completed' : 'open' }] };
    }
    if (input.operation === 'projects') { if(mode==='complete-list-failed')throw new Error('synthetic list unavailable'); return { items: [{ id: task.projectId, title: '已授权清单' }] }; }
    return { items: mode === 'open' ? [{ id: task.taskId, projectId: task.projectId, title: '任务', text: '一项需要处理的任务。', status: 'open' }] : [] };
  });
  const dependencies = {
    store: { get: async () => structuredClone(stored), put: async (_key, value) => { stored = structuredClone(value); } },
    clock: () => new Date(currentTime), readBinding: async () => ({ bound: true, bindingKey: 'a'.repeat(64) }), authorization: async () => grant,
    collect, summarize: async ({ evidence }) => ({ items: evidence.map(row => ({ key: `model-key-${round++}`, kind: 'risk', title: `任务表述${round}`, summary: '任务需要处理。', why: '应及时查看。', action: '查看任务。', unknown: '', priority: 'high', confidence: 'source', evidenceIds: [row.id] })) }),
    send: async input => { sends.push(input); return { status: 'reported_sent' }; },
  };
  let service = createPersonalReviewService(dependencies);
  t.after(() => service.close());
  await service.act(caller, { action: 'configure', sources: ['dida'], projects: [], schedule: { dailyTime: '09:00', timeZone: 'UTC' }, requestId: 'configure', userRequested: true });
  return {
    get service() { return service; }, queries, sends, state: () => structuredClone(stored),
    mode: value => { mode = value; }, time: value => { currentTime = value; }, grant: () => { grant = 'e'.repeat(64); },
    run: requestId => service.act(caller, { action: 'run_now', kind: 'weekly', requestId, userRequested: true }),
    restart: async () => { await service.close(); service = createPersonalReviewService(dependencies); },
  };
}

test('real service and collector persist source completion and stop old weekly reminders after restart', async t => {
  const f = await serviceFixture(t);
  await f.run('first');
  assert.equal(f.sends.length, 1);
  assert.equal(f.state().items[0].sourceTask?.taskId, task.taskId);
  f.mode('complete'); f.time('2026-10-31T17:00:00.000Z');
  assert.equal((await f.run('complete')).status, 'quiet');
  const closed = f.state().items[0];
  assert.equal(closed.status, 'handled');
  assert.equal(closed.sourceResolution.status, 'completed');
  assert.equal(f.sends.length, 1);
  await f.restart(); f.time('2026-11-01T17:00:00.000Z');
  assert.equal((await f.run('restart')).status, 'quiet');
  assert.equal(f.queries.filter(input => input.operation === 'read').length, 1, 'closed tasks are not repeatedly read');
});

test('failed source reconciliation preserves the open item and does not advance complete coverage', async t => {
  const f = await serviceFixture(t);
  await f.run('first'); const before = f.state().watermarks;
  f.mode('unknown'); f.time('2026-10-31T17:00:00.000Z');
  await f.run('unknown');
  assert.equal(f.state().items[0].status, 'open');
  assert.equal(f.state().items[0].sourceResolution?.status, 'unknown');
  assert.deepEqual(f.state().watermarks, before);
});

test('a new grant never receives targeted reads for old scoped task ids', async t => {
  const f = await serviceFixture(t);
  await f.run('first'); f.mode('complete'); f.grant();
  await f.service.act(caller, { action: 'configure', sources: ['dida'], projects: [], schedule: { dailyTime: '09:00', timeZone: 'UTC' }, requestId: 'new-grant', userRequested: true });
  assert.equal((await f.run('after-grant')).status, 'quiet');
  assert.equal(f.queries.filter(input => input.operation === 'read').length, 0);
  assert.equal(f.state().items[0].status, 'open');
  assert.equal(f.sends.length, 1, 'old-grant task content must not be reused for a new authorized run');
});

test('explicit task completion survives unavailable discovery without pretending full coverage', async t => {
  const f = await serviceFixture(t);
  await f.run('first'); const before = f.state().watermarks;
  f.mode('complete-list-failed'); f.time('2026-10-31T17:00:00.000Z');
  assert.equal((await f.run('completed-without-list')).status, 'unknown');
  assert.equal(f.state().items[0].status, 'handled');
  assert.deepEqual(f.state().watermarks, before);
  assert.equal(f.sends.length, 1);
});
