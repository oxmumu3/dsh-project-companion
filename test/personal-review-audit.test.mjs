import test from 'node:test';
import assert from 'node:assert/strict';
import { createPersonalReviewService } from '../src/personal-review.js';
import { mergeReviewItems } from '../src/personal-review-ledger.js';

const caller = { sessionId: 'audit-owner', cwd: '/synthetic/audit' };
const binding = 'a'.repeat(64), grant = 'b'.repeat(64);
const evidence = { id: 'gmail:1', source: 'gmail', title: 'Synthetic evidence', text: 'Two independently actionable synthetic facts.', at: '2026-10-29T08:00:00.000Z' };
const candidate = { key: 'risk-one', kind: 'risk', title: '第一件独立待办', summary: '第一件待办有明确材料。', why: '值得处理。', action: '检查第一件材料。', unknown: '', evidenceIds: [evidence.id], priority: 'high', confidence: 'source' };
const intent = (action, extra = {}) => ({ action, requestId: `audit-${action}`, userRequested: true, ...extra });
function fixture(hooks = {}) {
  let stored, route = binding;
  const sends = [];
  const service = createPersonalReviewService({
    store: { get: async () => structuredClone(stored), put: async (_key, value) => { stored = structuredClone(value); } },
    readBinding: async () => ({ bound: true, bindingKey: route }), authorization: async () => grant,
    collect: async () => ({ evidence: [evidence], coverage: [{ source: 'gmail', status: 'ok', count: 1 }] }),
    summarize: async () => ({ items: [candidate] }),
    send: async value => { sends.push(value); return { status: 'reported_sent' }; },
    clock: () => new Date('2026-10-29T09:00:00.000Z'), ...hooks,
  });
  return { service, sends, stored: () => stored, rebind: () => { route = 'c'.repeat(64); } };
}

test('audit: cancelling a due daily review cannot fall through to a weekly send in the same tick', async () => {
  let entered, reads = 0;
  const started = new Promise(resolve => { entered = resolve; });
  const f = fixture({ collect: async () => {
    if (++reads === 1) { entered(); return new Promise(() => {}); }
    return { evidence: [evidence], coverage: [{ source: 'gmail', status: 'ok', count: 1 }] };
  } });
  await f.service.act(caller, intent('configure', { sources: ['gmail'], projects: [], schedule: { dailyTime: '09:00', weeklyDay: 4, weeklyTime: '09:00', timeZone: 'UTC' } }));
  const tick = f.service.tick();
  await started;
  const cancel = f.service.act(caller, intent('cancel'));
  await Promise.all([tick, cancel]);
  assert.equal(reads, 1);
  assert.equal(f.sends.length, 0);
  assert.equal(f.stored().subscription, null);
  assert.deepEqual(f.stored().jobs.map(job => [job.kind, job.status]), [['daily', 'cancelled']]);
});

test('audit: a changed binding cannot read or acknowledge old-scope review items', async () => {
  const f = fixture();
  await f.service.act(caller, intent('run_now', { sources: ['gmail'], projects: [] }));
  const id = f.stored().items[0].id;
  f.rebind();
  await assert.rejects(f.service.act(caller, intent('feedback', { itemId: id, feedback: 'handled' })), /绑定|授权/);
  await assert.rejects(f.service.act(caller, { action: 'status' }), /绑定|授权/);
  assert.equal(f.stored().items[0].status, 'open');
});

test('audit: two independent actions in one email remain separate ledger items', () => {
  const second = { ...candidate, key: 'risk-two', title: '第二件独立待办', summary: '同一封邮件里的另一件待办。', action: '检查第二件材料。' };
  const items = mergeReviewItems([], [candidate, second], [evidence], { now: '2026-10-29T09:00:00.000Z', scopeKey: binding });
  assert.equal(items.length, 2);
  assert.equal(new Set(items.map(item => item.id)).size, 2);
  assert.deepEqual(items.map(item => item.title), [candidate.title, second.title]);
});

test('audit: partial source failure cannot close an unresolved item or advance that source watermark', async () => {
  let unavailable = false;
  const f = fixture({ collect: async () => unavailable
    ? { evidence: [], coverage: [{ source: 'gmail', status: 'failed', count: null }, { source: 'calendar', status: 'ok', count: 0 }] }
    : { evidence: [evidence], coverage: [{ source: 'gmail', status: 'ok', count: 1 }, { source: 'calendar', status: 'ok', count: 0 }] },
  });
  await f.service.act(caller, intent('run_now', { sources: ['gmail', 'calendar'], projects: [] }));
  const before = structuredClone(f.stored().watermarks.gmail);
  unavailable = true;
  const result = await f.service.act(caller, intent('run_now', { requestId: 'partial-again', sources: ['gmail', 'calendar'], projects: [] }));
  assert.equal(f.stored().items[0].status, 'open');
  assert.deepEqual(f.stored().watermarks.gmail, before);
  assert.match(result.text, /gmail.*未知/);
  assert.match(result.text, /不代表全账号没有待办或进展/);
  assert.doesNotMatch(result.text, /已全部处理|gmail 0 条/);
  assert.equal(f.sends.length, 1);
});
