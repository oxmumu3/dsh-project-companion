import test from 'node:test';
import assert from 'node:assert/strict';
import { createPersonalReviewService } from '../src/personal-review.js';
import { createPersonalReviewCollector } from '../src/personal-review-collect.js';
import { createPersonalReviewModel } from '../src/personal-review-model.js';

const owner = { sessionId: 'synthetic-attention-wiring', cwd: '/synthetic/project' };
const binding = 'a'.repeat(64), grant = 'b'.repeat(64);
const dueAt = '2026-10-30T17:00:00.000Z'; // 11:00 in Mexico City.

async function fixture(t, { sourceFailure = false, revokeDuringRead = false, onlyNormal = false } = {}) {
  let stored, now = new Date('2026-10-30T16:30:00.000Z'), authorized = true;
  const queries = [], modelInputs = [], sends = [];
  const collect = createPersonalReviewCollector({
    query: async (_caller, input) => {
      queries.push(input);
      if (revokeDuringRead) authorized = false;
      if (sourceFailure) throw new Error('synthetic source unavailable');
      if (input.source === 'calendar') return { items: [] };
      return { items: [{ id: 'synthetic-mail', title: '合成访问政策通知', text: '访问政策即将变化，需要核对；另有一项常规更新。', createdAt: '2026-10-30T16:00:00.000Z' }] };
    },
    readProject: async () => { throw new Error('no projects are authorized by this fixture'); },
  });
  const model = createPersonalReviewModel({ get(name) {
    if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'synthetic', model: 'synthetic' }) };
    if (name === 'llm') return { prepareCall: async config => ({ config, stream: async function* (request) {
      const material = JSON.parse(request.messages[0].content[0].text);
      modelInputs.push(material);
      const evidenceIds = [material.evidence.find(row => row.source === 'gmail').id];
      const normal = { key: 'routine-update', kind: 'change', title: '常规更新', summary: '来源提到一项常规更新。', why: '可在常规回顾中查看。', action: '查看原通知。', unknown: '', evidenceIds, priority: 'normal', confidence: 'source' };
      const risk = { key: 'access-policy', kind: 'risk', title: '访问政策变化', summary: '来源提示访问政策即将变化。', why: '需及时核对访问影响。', action: '查看原通知。', unknown: '实际影响待核对。', evidenceIds, priority: 'high', confidence: 'source' };
      yield { type: 'text-delta', index: 0, text: JSON.stringify({ items: onlyNormal ? [normal] : [normal, risk] }) };
      yield { type: 'finish', reason: { kind: 'stop' } };
    } }) };
  } });
  const service = createPersonalReviewService({
    store: { get: async () => structuredClone(stored), put: async (_key, value) => { stored = structuredClone(value); } },
    clock: () => now,
    readBinding: async () => ({ bound: true, bindingKey: binding }),
    readBindingSync: () => ({ bound: true, bindingKey: binding }),
    authorization: async () => authorized ? grant : 'c'.repeat(64),
    authorizationSync: () => authorized,
    collect,
    summarize: input => model.summarize(input),
    send: async input => {
      assert.equal(await input.authorizeAsync(), true);
      assert.equal(input.authorizeSync(), true);
      sends.push(input);
      return { status: 'reported_sent' };
    },
  });
  t.after(async () => { model.close(); await service.close(); });
  await service.act(owner, { action: 'configure', sources: ['gmail', 'calendar'], projects: [], schedule: { dailyTime: '09:00', timeZone: 'America/Mexico_City' }, requestId: 'configure', userRequested: true });
  await service.act(owner, { action: 'attention', enabled: true, requestId: 'attention', userRequested: true });
  assert.equal(queries.length, 0, 'configuration must not read sources');
  now = new Date(dueAt);
  return { service, queries, modelInputs, sends, state: () => structuredClone(stored) };
}

test('11:00 attention reaches real collector and model, filters ordinary items and does not resend', async t => {
  const f = await fixture(t);
  const results = await f.service.tick();
  assert.equal(results[0]?.status, 'reported_sent', JSON.stringify(f.state().jobs));
  assert.equal(results[0].kind, 'attention');
  assert.equal(results[0].items.length, 1);
  assert.equal(results[0].items[0].key, 'access-policy');
  assert.equal(f.state().items.length, 2, 'the attention selector must retain but not send the ordinary item');
  assert.equal(f.modelInputs.length, 1);
  assert.equal(f.modelInputs[0].kind, 'daily');
  assert.equal(f.queries.find(row => row.source === 'calendar').to, '2026-10-31T17:00:00.000Z', 'attention uses the daily calendar horizon');
  assert.equal(f.sends.length, 1);
  assert.doesNotMatch(f.sends[0].text, /常规更新/);
  const saved = f.state();
  assert.equal(saved.jobs[0].kind, 'attention');
  assert.deepEqual(saved.occurrences, ['attention:2026-10-30:11:00']);
  assert.equal(saved.attentionClaims.length, 1);
  assert.deepEqual(saved.watermarks.gmail, { attention: dueAt });
  assert.deepEqual(saved.watermarks.calendar, { attention: dueAt });
  assert.equal((await f.service.snapshot(owner)).attention.remaining, 1);
  const readCount = f.queries.length;
  assert.deepEqual(await f.service.tick(), []);
  assert.equal(f.queries.length, readCount);
  assert.equal(f.modelInputs.length, 1);
  assert.equal(f.sends.length, 1);
});

test('real attention pipeline stays quiet for ordinary changes without consuming its budget', async t => {
  const f = await fixture(t, { onlyNormal: true });
  assert.equal((await f.service.tick())[0]?.status, 'quiet', JSON.stringify(f.state().jobs));
  assert.equal(f.modelInputs.length, 1);
  assert.equal(f.state().items.length, 1);
  assert.equal(f.sends.length, 0);
  assert.equal(f.state().attentionClaims.length, 0);
});

test('source failures through the real collector leave attention unknown without model or delivery', async t => {
  const f = await fixture(t, { sourceFailure: true });
  assert.equal((await f.service.tick())[0]?.status, 'unknown', JSON.stringify(f.state().jobs));
  assert.equal(f.queries.length, 2);
  assert.equal(f.modelInputs.length, 0);
  assert.equal(f.sends.length, 0);
  assert.deepEqual(f.state().watermarks, {});
  assert.equal(f.state().attentionClaims.length, 0);
});

test('revocation during a real source read blocks attention before model and delivery', async t => {
  const f = await fixture(t, { revokeDuringRead: true });
  await f.service.tick();
  assert.equal(f.queries.length, 1);
  assert.equal(f.state().jobs[0].status, 'failed');
  assert.equal(f.state().jobs[0].diagnostic.stage, 'authorization');
  assert.equal(f.modelInputs.length, 0);
  assert.equal(f.sends.length, 0);
  assert.deepEqual(f.state().watermarks, {});
});
