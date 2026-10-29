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
  assert.match(result.text, /邮件.*未知/);
  assert.match(result.text, /不代表全账号没有待办或进展/);
  assert.doesNotMatch(result.text, /已全部处理|邮件 0 条/);
  assert.equal(f.sends.length, 1);
});

test('audit: rejected configure leaves no latent plan for a later background tick', async () => {
  let rejections = 0;
  for (let denyAt = 1; denyAt <= 8; denyAt++) {
    let reads = 0, checks = 0;
    const f = fixture({ collect: async () => { reads++; return { evidence: [], coverage: [{ source: 'gmail', status: 'ok', count: 0 }] }; } });
    try {
      await f.service.act(caller, intent('configure', { sources: ['gmail'], projects: [], schedule: { dailyTime: '09:00', timeZone: 'UTC' }, authorizeSync: () => ++checks < denyAt }));
    } catch {
      rejections++;
      assert.equal((await f.service.snapshot(caller)).status, 'off', `rejected authorization checkpoint ${denyAt} must not publish a plan`);
      await f.service.tick();
      assert.equal(reads, 0);
      assert.equal(f.stored()?.subscription ?? null, null);
    }
    await f.service.close();
  }
  assert.ok(rejections > 0);
});

test('audit: rejected resume cannot enable a paused plan in memory', async () => {
  let rejections = 0;
  for (let denyAt = 1; denyAt <= 8; denyAt++) {
    let checks = 0;
    const f = fixture();
    await f.service.act(caller, intent('configure', { sources: ['gmail'], projects: [], schedule: { dailyTime: '09:00', timeZone: 'UTC' } }));
    await f.service.act(caller, intent('pause'));
    try { await f.service.act(caller, intent('resume', { authorizeSync: () => ++checks < denyAt })); }
    catch { rejections++; assert.equal((await f.service.snapshot(caller)).status, 'paused', `rejected authorization checkpoint ${denyAt} must preserve pause`); assert.equal(f.stored().subscription.paused, true); }
    await f.service.close();
  }
  assert.ok(rejections > 0);
});

test('audit: rejected feedback cannot silently acknowledge a source item', async () => {
  let rejections = 0;
  for (let denyAt = 1; denyAt <= 9; denyAt++) {
    let checks = 0;
    const f = fixture();
    await f.service.act(caller, intent('run_now', { sources: ['gmail'], projects: [] }));
    const id = f.stored().items[0].id;
    try { await f.service.act(caller, intent('feedback', { itemId: id, feedback: 'handled', authorizeSync: () => ++checks < denyAt })); }
    catch { rejections++; assert.equal((await f.service.snapshot(caller)).items[0].status, 'open', `rejected authorization checkpoint ${denyAt} must preserve feedback`); assert.equal(f.stored().items[0].status, 'open'); }
    await f.service.close();
  }
  assert.ok(rejections > 0);
});

test('audit: rejected pause and cancel preserve the authorized subscription', async () => {
  for (const action of ['pause', 'cancel']) {
    let rejections = 0;
    for (let denyAt = 1; denyAt <= 6; denyAt++) {
      let checks = 0;
      const f = fixture();
      await f.service.act(caller, intent('configure', { sources: ['gmail'], projects: [], schedule: { dailyTime: '09:00', timeZone: 'UTC' } }));
      try { await f.service.act(caller, intent(action, { authorizeSync: () => ++checks < denyAt })); }
      catch { rejections++; assert.equal((await f.service.snapshot(caller)).status, 'enabled', `rejected ${action} checkpoint ${denyAt} must preserve subscription`); assert.equal(f.stored().subscription.paused, false); }
      await f.service.close();
    }
    assert.ok(rejections > 0);
  }
});

test('audit: a configuration awaiting durable persistence does not expose an enabled scheduler', async () => {
  let entered, release, stored;
  const writing = new Promise(resolve => { entered = resolve; }), pending = new Promise(resolve => { release = resolve; });
  const f = fixture({ store: { get: async () => stored, put: async (_key, value) => { entered(); await pending; stored = structuredClone(value); } } });
  const configure = f.service.act(caller, intent('configure', { sources: ['gmail'], projects: [], schedule: { dailyTime: '09:00', timeZone: 'UTC' } }));
  await writing;
  assert.equal(f.service.needsTimer(), false);
  release();
  await configure;
  assert.equal(f.service.needsTimer(), true);
  assert.equal(stored.subscription.paused, false);
  await f.service.close();
});

test('audit: a rejected manual run cannot seed an unconfirmed scope for a later preview', async () => {
  let checks = 0, reads = 0;
  const f = fixture({ collect: async () => { reads++; return { evidence: [], coverage: [{ source: 'gmail', status: 'ok', count: 0 }] }; } });
  await assert.rejects(f.service.act(caller, intent('run_now', { sources: ['gmail'], projects: [], authorizeSync: () => ++checks < 2 })), /授权|取消|失效/);
  assert.equal(reads, 0);
  assert.equal(f.stored()?.scope ?? null, null);
  assert.deepEqual((await f.service.snapshot(caller)).sources, []);
  await assert.rejects(f.service.act(caller, { action: 'preview' }));
  assert.equal(reads, 0);
  await f.service.close();
});

test('audit: Gmail URL fragments identify different messages even when their action titles match', () => {
  const first = { ...evidence, id: 'gmail:first', url: 'https://mail.google.com/mail/u/0/#all/first' };
  const second = { ...evidence, id: 'gmail:second', url: 'https://mail.google.com/mail/u/0/#all/second' };
  const items = mergeReviewItems([], [{ ...candidate, evidenceIds: [first.id] }, { ...candidate, key: 'independent-second-invitation', evidenceIds: [second.id] }], [first, second], { now: '2026-10-29T09:00:00.000Z', scopeKey: binding });
  assert.equal(items.length, 2);
  assert.notEqual(items[0].id, items[1].id);
});

test('audit: repeated invalid model formats preserve old feedback and complete coverage watermarks', async () => {
  let malformed = false;
  const f = fixture({ summarize: async () => malformed ? { items: 'invalid model format' } : { items: [candidate] } });
  await f.service.act(caller, intent('run_now', { sources: ['gmail'], projects: [] }));
  const id = f.stored().items[0].id;
  await f.service.act(caller, intent('feedback', { itemId: id, feedback: 'handled' }));
  const before = structuredClone({ items: f.stored().items, watermarks: f.stored().watermarks });
  malformed = true;
  for (let n = 0; n < 3; n++) {
    await assert.rejects(f.service.act(caller, intent('run_now', { sources: ['gmail'], projects: [], requestId: `bad-model-${n}` })));
    assert.deepEqual(f.stored().items, before.items);
    assert.deepEqual(f.stored().watermarks, before.watermarks);
    assert.equal(f.stored().jobs.at(-1).status, 'failed');
  }
  assert.equal(f.sends.length, 1);
  assert.doesNotMatch((await f.service.snapshot(caller)).text, /没有.*(?:变化|事项)|已全部处理/);
  await f.service.close();
});
