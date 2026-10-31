import test from 'node:test';
import assert from 'node:assert/strict';
import { createPersonalReviewService } from '../src/personal-review.js';

const caller = { sessionId: 'synthetic-delivery-audit', cwd: '/synthetic/project' };
const evidence = { id: 'mail:1', source: 'gmail', title: 'Synthetic policy', text: 'A new policy needs review.', at: '2026-10-30T14:00:00.000Z' };
const candidate = { key: 'synthetic-risk', kind: 'risk', title: '合成风险', summary: '有一项待核对的风险。', why: '需及时核对。', action: '查看原通知。', unknown: '实际影响未知。', evidenceIds: ['mail:1'], priority: 'high', confidence: 'source' };

async function fixture(t, firstOutcome) {
  let stored, instant = new Date('2026-10-30T15:00:00.000Z');
  const sends = [];
  const service = createPersonalReviewService({
    store: { get: async () => structuredClone(stored), put: async (_key, value) => { stored = structuredClone(value); } },
    clock: () => instant,
    readBinding: async () => ({ bound: true, bindingKey: 'a'.repeat(64) }),
    authorization: async () => 'b'.repeat(64),
    collect: async () => ({ evidence: [evidence], coverage: [{ source: 'gmail', status: 'ok', count: 1 }] }),
    summarize: async () => ({ items: [candidate] }),
    send: async input => { sends.push(input); return { status: sends.length === 1 ? firstOutcome : 'reported_sent' }; },
  });
  t.after(() => service.close());
  await service.act(caller, { action: 'configure', sources: ['gmail'], projects: [], schedule: { dailyTime: '09:00', timeZone: 'America/Mexico_City' }, requestId: 'configure', userRequested: true });
  return { service, sends, state: () => stored, nextDay: () => { instant = new Date('2026-10-31T15:00:00.000Z'); } };
}

for (const firstOutcome of ['failed', 'blocked']) {
  test(`definite ${firstOutcome} delivery does not consume a new risk notification forever`, async t => {
    const f = await fixture(t, firstOutcome);
    assert.equal((await f.service.tick())[0].status, 'failed');
    assert.equal(f.state().jobs[0].diagnostic.code,'REVIEW_DELIVERY_FAILED');
    assert.equal(f.state().jobs[0].diagnostic.stage,'delivery');
    await f.service.tick();
    assert.equal(f.sends.length, 1, 'same occurrence is not replayed');
    f.nextDay();
    assert.equal((await f.service.tick())[0].status, 'reported_sent', 'a new authorized daily occurrence may retry definitively undelivered facts');
    assert.equal(f.sends.length, 2);
    assert.equal(f.state().items[0].lastNotifiedAt, '2026-10-31T15:00:00.000Z');
  });
}

test('uncertain delivery remains claimed across a fresh daily occurrence', async t => {
  const f = await fixture(t, 'uncertain');
  assert.equal((await f.service.tick())[0].status, 'uncertain');
  f.nextDay();
  assert.equal((await f.service.tick())[0].status, 'quiet');
  assert.equal(f.sends.length, 1, 'ambiguous delivery must not be retried');
});
