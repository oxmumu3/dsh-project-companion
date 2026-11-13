import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createTodayController} from '../src/today-route.js';
import {projectPublicId} from '../src/session-ledger.js';

const root = '/Users/synthetic/projects/finder';
const other = '/Users/synthetic/projects/writing';
const projectId = projectPublicId(root);
const cardIdOf = row => createHash('sha256').update(`${row.sessionId}\n${row.revision}\n${row.state}`).digest('hex').slice(0, 32);
const cardOf = (extra = {}) => cardIdOf({sessionId: 'session-a', revision: 3, state: 'needs_you', ...extra});

function ledgerOf(sessions) {
  let state = {sessions, projects: [], revision: 1};
  return {
    async internal() { return structuredClone(state); },
    async setState(sessionId, next) {
      const row = state.sessions.find(item => item.sessionId === sessionId);
      if (!row) return {changed: false};
      row.state = next;
      return {changed: true};
    },
    peek() { return state; },
  };
}

function row(overrides = {}) {
  return {sessionId: 'session-a', root, projectLabel: 'Finder', title: '测试', state: 'needs_you', what: '等你批准', needs: {kind: 'approval', askedAt: '2026-11-11T06:00:00.000Z', id: 'approval-1'}, startedAt: '2026-11-11T05:00:00.000Z', lastEventAt: '2026-11-11T06:00:00.000Z', revision: 3, ...overrides};
}

test('say rejects empty text and stages a draft with no foreground session', async () => {
  const prompts = [];
  const controller = createTodayController({
    ledger: ledgerOf([row()]),
    reader: {snapshot: () => ({promises: []})},
    foregroundSession: async () => null,
    promptSession: async (...args) => prompts.push(args),
  });
  assert.equal((await controller.say({text: '   '})).ok, false);
  const value = await controller.say({text: '看看各项目什么情况'});
  assert.equal(value.ok, false);
  assert.equal(value.fallback, 'stage_draft');
  assert.equal(prompts.length, 0);
});

test('say delivers to the foreground session when one exists', async () => {
  const prompts = [];
  const controller = createTodayController({
    ledger: ledgerOf([row()]),
    reader: {snapshot: () => ({promises: []})},
    foregroundSession: async () => 'session-foreground',
    promptSession: async (sessionId, text) => prompts.push([sessionId, text]),
  });
  const value = await controller.say({text: ' 看看各项目什么情况 '});
  assert.equal(value.ok, true);
  assert.deepEqual(prompts, [['session-foreground', '看看各项目什么情况']]);
});

test('handled and snooze change only that card and are scoped to the project', async () => {
  const ledger = ledgerOf([row(), row({sessionId: 'session-b', root: other})]);
  const controller = createTodayController({ledger, reader: {snapshot: () => ({promises: []})}, promptSession: async () => {}});
  const handled = await controller.item({action: 'handled', projectId, cardId: cardOf({})});
  assert.equal(handled.ok, true);
  assert.equal(ledger.peek().sessions.find(item => item.sessionId === 'session-a').state, 'handled');
  assert.equal(ledger.peek().sessions.find(item => item.sessionId === 'session-b').state, 'needs_you');
  const snooze = await controller.item({action: 'snooze', projectId, cardId: cardOf({})});
  // The same old card cannot act twice: after handled, that card is stale.
  assert.equal(snooze.ok, false);
  assert.equal(snooze.stale, true);
  const wrong = await controller.item({action: 'handled', projectId: 'project_ffffffffffffffffffffffff'});
  assert.equal(wrong.ok, false);
});

test('approve never pretends to decide without a host approval path', async () => {
  const ledger = ledgerOf([row()]);
  const controller = createTodayController({ledger, reader: {snapshot: () => ({promises: []})}, promptSession: async () => {}});
  const value = await controller.item({action: 'approve', projectId, cardId: cardOf({})});
  assert.equal(value.ok, false);
  assert.equal(value.fallback, 'open_session');
  assert.equal(value.sessionId, 'session-a');
});

test('approve uses an explicit host decision when it exists', async () => {
  let decided = null;
  const controller = createTodayController({
    ledger: ledgerOf([row()]),
    reader: {snapshot: () => ({promises: []})},
    promptSession: async () => {},
    approvals: {decide: async (id, outcome) => { decided = [id, outcome]; return {ok: true}; }},
  });
  const value = await controller.item({action: 'approve', projectId, cardId: cardOf({})});
  assert.equal(value.ok, true);
  assert.equal(value.pending, true);
  assert.deepEqual(decided, ['approval-1', 'allow-once']);
});

test('retry steers only the stuck or waiting session', async () => {
  const prompts = [];
  const ledger = ledgerOf([row({state: 'stuck', needs: null, title: '出错了'})]);
  const controller = createTodayController({ledger, reader: {snapshot: () => ({promises: []})}, promptSession: async (sessionId, text, options) => prompts.push([sessionId, text, options])});
  const value = await controller.item({action: 'retry', projectId, cardId: cardOf({state: 'stuck'})});
  assert.equal(value.ok, true);
  assert.equal(prompts[0][0], 'session-a');
  assert.equal(prompts[0][2]?.steer, false);
  ledger.peek().sessions[0].state = 'done';
  const refused = await controller.item({action: 'retry', projectId, cardId: cardOf({state: 'stuck'})});
  assert.equal(refused.ok, false);
});

test('dispatch requires a known promise and a granted root', async () => {
  const reader = {snapshot: () => ({promises: [{id: 'promise-1', what: '交稿'}]})};
  const created = [];
  const controller = createTodayController({
    ledger: ledgerOf([row()]), reader, promptSession: async () => {},
    createSession: async ({root: granted, text}) => { created.push([granted, text]); return 'session-new'; },
    defaultRoot: async () => '/Users/synthetic/projects/finder',
  });
  const ok = await controller.item({action: 'dispatch', promiseId: 'promise-1'});
  assert.equal(ok.ok, true);
  assert.equal(ok.sessionId, 'session-new');
  assert.match(created[0][1], /交稿/);
  const missing = await controller.item({action: 'dispatch', promiseId: 'nope'});
  assert.equal(missing.ok, false);
});

test('unknown actions and a closed controller fail closed', async () => {
  const controller = createTodayController({ledger: ledgerOf([row()]), reader: {snapshot: () => ({promises: []})}, promptSession: async () => {}});
  assert.equal((await controller.item({action: 'approve-everything', projectId})).ok, false);
  const closed = createTodayController({ledger: ledgerOf([row()]), reader: {snapshot: () => ({promises: []})}, promptSession: async () => {}, isClosed: () => true});
  assert.equal((await closed.say({text: 'hi'})).ok, false);
});

test('the metrics entry exposes counts and explicitly marks unextended cursors', async () => {
  let refreshed = 0;
  const controller = createTodayController({
    ledger: ledgerOf([row()]),
    reader: {
      async refreshNow() { refreshed += 1; },
      metrics: () => ({dida: {lists: 2, undone: 4, inWindow: 2, requests: 3, ms: 12, truncated: false}}),
      snapshot: () => ({promises: [], sources: [{id: 'dida', state: 'ok'}]}),
    },
    promptSession: async () => {},
  });
  const value = await controller.metrics();
  assert.equal(value.ok, true);
  assert.equal(refreshed, 1, 'the entry performs one authorized refresh');
  assert.equal(value.metrics.dida.lists, 2);
  assert.equal(value.metrics.dida.requests, 3);
  assert.equal(value.probes.calendar.nextSyncToken, false);
  assert.equal(value.probes.calendar.updatedMin.available, false);
  assert.equal(value.probes.calendar.updatedMin.code, 'no_diagnose');
  assert.equal(value.probes.gmail.available, false);
  assert.equal(value.probes.accountId.available, false);
  assert.equal(JSON.stringify(value).includes('title'), false);
});

test('authorized one-shot diagnostics surface numbers and booleans only', async () => {
  const seen = [];
  const controller = createTodayController({
    ledger: ledgerOf([row()]),
    reader: {
      async refreshNow() {},
      metrics: () => ({calendar: {pages: 1, lastPageHasNextSyncToken: true, requests: 1, events: 0, ms: 2, truncated: false}}),
      snapshot: () => ({promises: [], sources: [{id: 'calendar', state: 'ok'}]}),
    },
    diagnose: async (source, name) => {
      seen.push([source, name]);
      if (source === 'calendar') return {available: true, ok: true, httpStatus: 200, count: 0, sampleLimit: 1, hasMore: false};
      return {available: true, historyId: true, historyList: true, count: 1, hasMore: false, profileStatus: 200, historyStatus: 200};
    },
    promptSession: async () => {},
  });
  const value = await controller.metrics();
  assert.deepEqual(seen, [['calendar', 'updated_min'], ['gmail', 'history']]);
  assert.equal(value.probes.calendar.nextSyncToken, true);
  assert.deepEqual(value.probes.calendar.updatedMin, {ok: true, httpStatus: 200, count: 0, sampleLimit: 1, hasMore: false});
  assert.equal(value.probes.gmail.historyId, true);
  assert.equal(value.probes.gmail.historyList, true);
  assert.equal(value.probes.gmail.count, 1);
  assert.equal(value.probes.gmail.hasMore, false);
  assert.equal(JSON.stringify(value).includes('startAt'), false);
});
