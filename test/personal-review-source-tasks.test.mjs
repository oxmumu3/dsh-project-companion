import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeReviewItems, reviewItemSchema } from '../src/personal-review-ledger.js';

const scopeKey = 'a'.repeat(64), taskScopeKey = 'b'.repeat(64), now = '2026-10-30T17:00:00.000Z';
const task = (patch = {}) => ({ source: 'dida', projectId: 'project-one', taskId: 'task-one', scopeKey: taskScopeKey, ...patch });
const evidence = (patch = {}) => ({ id: 'task-evidence', source: 'dida', title: '任务', text: '完成待办。', sourceTask: task(), ...patch });
const candidate = (patch = {}) => ({ key: 'first-key', kind: 'deadline', title: '处理任务', summary: '任务尚未完成。', why: '应及时处理。', action: '查看任务。', unknown: '', evidenceIds: ['task-evidence'], priority: 'normal', confidence: 'source', dueAt: '2026-11-01T17:00:00.000Z', ...patch });
const merge = (items, candidates, rows) => mergeReviewItems(items, candidates, rows, { scopeKey, now });

test('one structured task keeps its identity and feedback when both model key and title change', () => {
  const first = merge([], [candidate()], [evidence()]);
  first[0].status = 'snoozed'; first[0].snoozeUntil = '2026-11-02T17:00:00.000Z';
  const second = merge(structuredClone(first), [candidate({ key: 'rewritten-key', title: '换一种说法' })], [evidence({ title: '源端也改名' })]);
  assert.equal(second.length, 1);
  assert.equal(second[0].id, first[0].id);
  assert.equal(second[0].status, 'snoozed');
  assert.equal(second[0].snoozeUntil, first[0].snoozeUntil);
  assert.deepEqual(second[0].sourceTask, task());
  assert.equal(reviewItemSchema.safeParse(second[0]).success, true);
});

test('distinct structured tasks cannot merge through a reused model key or title', () => {
  const rows = [evidence(), evidence({ id: 'task-two-evidence', sourceTask: task({ taskId: 'task-two' }) })];
  const items = merge([], [candidate(), candidate({ evidenceIds: ['task-two-evidence'] })], rows);
  assert.equal(items.length, 2);
  assert.equal(new Set(items.map(item => item.id)).size, 2);
});

test('an ordinary model key cannot collide with a structured task item id', async () => {
  const api = await import('../src/personal-review-source-tasks.js');
  const rows = [evidence(), evidence({ id: 'mail', source: 'gmail', sourceTask: undefined })];
  const items = merge([], [candidate(), candidate({ key: `task:${api.reviewSourceTaskKey(task())}`, evidenceIds: ['mail'] })], rows);
  assert.equal(new Set(items.map(item => item.id)).size, 2);
});

test('a new source grant cannot reuse an old task identity', () => {
  const first = merge([], [candidate()], [evidence()]);
  first[0].status = 'handled';
  const second = merge(first, [candidate()], [evidence({ sourceTask: task({ scopeKey: 'c'.repeat(64) }) })]);
  assert.equal(second.length, 2);
  assert.equal(second.filter(item => item.status === 'handled').length, 1);
  assert.equal(second.filter(item => item.status === 'open').length, 1);
});

test('two tasks in one email and multi-evidence conclusions never gain a single-task identity', () => {
  const mail = evidence({ source: 'gmail', sourceTask: undefined });
  const items = merge([], [candidate(), candidate({ key: 'other-action', title: '第二项独立任务' })], [mail]);
  assert.equal(items.length, 2);
  assert.ok(items.every(item => item.sourceTask === undefined));
  const mixed = merge([], [candidate({ evidenceIds: ['task-evidence', 'mail'] })], [evidence(), { ...mail, id: 'mail' }]);
  assert.equal(mixed[0].sourceTask, undefined);
});

test('explicit reminder association requires the same task, grant and exact deadline', async () => {
  const api = await import('../src/personal-review-source-tasks.js').catch(() => ({}));
  assert.equal(typeof api.linkReviewTaskReminder, 'function');
  const item = merge([], [candidate()], [evidence()])[0];
  const input = { scopeKey, sourceTask: task(), dueAt: item.dueAt };
  const link = api.linkReviewTaskReminder(item, input);
  assert.equal(link.reviewItemId, item.id);
  assert.match(link.notificationKey, /^[a-f0-9]{64}$/);
  assert.deepEqual(api.linkReviewTaskReminder({ ...item, title: '改名' }, input), link);
  for (const patch of [{ scopeKey: 'd'.repeat(64) }, { sourceTask: task({ taskId: 'other-task' }) }, { sourceTask: task({ scopeKey: 'e'.repeat(64) }) }, { dueAt: '2026-11-02T17:00:00.000Z' }]) {
    assert.equal(api.linkReviewTaskReminder(item, { ...input, ...patch }), null);
  }
  assert.equal(api.linkReviewTaskReminder({ ...item, sourceTask: undefined }, input), null);
});

test('bounded task checks rotate and disclose remaining unchecked tasks', async () => {
  const api = await import('../src/personal-review-source-tasks.js');
  const rows = Array.from({ length: 7 }, (_, i) => evidence({ id: `e${i}`, sourceTask: task({ taskId: `t${i}` }) }));
  const items = merge([], rows.map(row => candidate({ key: row.id, evidenceIds: [row.id] })), rows);
  const selection = api.trackedReviewSourceTasks(items, { scopeKey, taskScopeKey, sources: ['dida'] });
  assert.equal(selection.tasks?.length, 5);
  assert.equal(selection.hasMore, true);
  const checked = api.reconcileReviewSourceTasks(items, selection.tasks.map(sourceTask => ({ task: sourceTask, status: 'unknown', checkedAt: '2026-10-31T17:00:00.000Z' })), { scopeKey, taskScopeKey });
  const next = api.trackedReviewSourceTasks(checked, { scopeKey, taskScopeKey, sources: ['dida'] });
  const firstKeys = new Set(selection.tasks.map(api.reviewSourceTaskKey));
  assert.ok(next.tasks.slice(0, 2).every(sourceTask => !firstKeys.has(api.reviewSourceTaskKey(sourceTask))));
});
