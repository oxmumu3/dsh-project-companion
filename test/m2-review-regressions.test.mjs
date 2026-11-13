import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {createDotSources,migrateLegacySources,dotAuthorization,dotSourceState} from '../src/dot-sources.js';
import {createDotSourceReader} from '../src/dot-source-reader.js';
import {createTodayController} from '../src/today-route.js';
import {projectPublicId} from '../src/session-ledger.js';

const KEY_A = 'a'.repeat(64);
const KEY_B = 'b'.repeat(64);
const NOW = new Date('2026-11-11T08:00:00.000Z');
const DAY = 86400000;
const iso = ms => new Date(ms).toISOString();
const cardIdOf = row => createHash('sha256').update(`${row.sessionId}\n${row.revision}\n${row.state}`).digest('hex').slice(0, 32);
const root = '/Users/synthetic/projects/finder';
const projectId = projectPublicId(root);

function memoryStore(initial = null) {
  let value = initial;
  return {async get() { return value === null ? null : structuredClone(value); }, async put(_k, next) { value = structuredClone(next); }, peek() { return value; }};
}

function ledgerOf(sessions) {
  let state = {sessions, projects: [], revision: 1};
  return {
    async internal() { return structuredClone(state); },
    async setState(sessionId, next) { const row = state.sessions.find(item => item.sessionId === sessionId); if (!row) return {changed: false}; row.state = next; row.revision += 1; return {changed: true}; },
    peek() { return state; },
  };
}

function session(overrides = {}) {
  return {sessionId: 'session-a', root, projectLabel: 'Finder', title: '测试', state: 'needs_you', what: '等你批准', needs: {kind: 'approval', askedAt: '2026-11-11T06:00:00.000Z', id: 'approval-1'}, startedAt: '2026-11-11T05:00:00.000Z', lastEventAt: '2026-11-11T06:00:00.000Z', revision: 3, ...overrides};
}

// 025-1: the migrated grant belongs to the account that granted it.
test('migration preserves the original account fingerprint and binding; account B must reconnect', () => {
  const row = migrateLegacySources({
    legacySources: [{source: 'dida', sessionId: 'session-old', credentialKey: KEY_A, bindingKey: 'c'.repeat(64), grantId: 'grant-old'}],
    now: NOW,
  });
  const dida = row.sources.find(item => item.source === 'dida');
  assert.equal(dida.credentialKey, KEY_A);
  assert.equal(dida.bindingKey, 'c'.repeat(64));
  assert.equal(dida.grantId, 'grant-old');
  assert.equal(dida.allowedSessions[0].credentialKey, KEY_A);
  assert.equal(dida.allowedSessions[0].bindingKey, 'c'.repeat(64));
  // Same account still works; a different current account does not inherit it.
  assert.equal(dotAuthorization(dida, {credentialKey: KEY_A, configured: true, background: true}).allowed, true);
  const other = dotAuthorization(dida, {credentialKey: KEY_B, configured: true, background: true});
  assert.equal(other.allowed, false);
  assert.equal(other.state, 'needs_authorization');
  assert.equal(dotSourceState(dida, {credentialKey: KEY_B, configured: true}), 'needs_authorization');
});

test('a stored new-domain row is never followed by a second legacy migration read', async () => {
  const store = memoryStore({id: 'profile', version: 1, revision: 2, sources: [], decisions: [], links: []});
  let reads = 0;
  const sources = createDotSources({store, clock: () => NOW, legacyReader: async () => { reads += 1; return {sources: [{source: 'dida', sessionId: 'session-old', credentialKey: KEY_A}], digest: 'd'.repeat(64)}; }});
  await sources.ready();
  await sources.ready();
  assert.equal(reads, 0, 'an existing new domain means migration already happened');
});

// 025-2: revocation/close must not leave a cached title visible.
test('revoking a source drops its cached promise immediately', async () => {
  const sources = createDotSources({store: memoryStore(), clock: () => NOW});
  await sources.enable('dida', KEY_A);
  await sources.enable('calendar', KEY_A);
  let revoked = false;
  const reader = createDotSourceReader({
    sources, clock: () => NOW, hostTimeZone: () => 'Asia/Shanghai',
    read: async (source, request) => {
      if (revoked) throw Object.assign(new Error('revoked'), {code: 'CONTEXT_AUTH_REQUIRED'});
      if (source === 'dida') return request.operation === 'projects' ? {items: [], truncated: false} : {items: [], truncated: false};
      return {items: [{id: 'evt-1', title: '评审', startAt: iso(NOW.getTime() + DAY)}], truncated: false};
    },
  });
  await reader.refreshNow();
  assert.equal(reader.snapshot().promises.length, 1);
  revoked = true;
  const cache = await reader.refreshNow();
  assert.equal(cache.promises.length, 0, 'a revoked calendar must not leave yesterday’s title');
  assert.equal(cache.sources.find(row => row.id === 'calendar').state, 'needs_authorization');
});

test('closing the reader clears its cached promises', async () => {
  const sources = createDotSources({store: memoryStore(), clock: () => NOW});
  await sources.enable('calendar', KEY_A);
  await sources.enable('dida', KEY_A);
  const reader = createDotSourceReader({sources, clock: () => NOW, read: async (source) => ({items: source === 'calendar' ? [{id: 'e', title: 't', startAt: iso(NOW.getTime() + DAY)}] : [], truncated: false})});
  await reader.refreshNow();
  assert.equal(reader.snapshot().promises.length, 1);
  reader.stop();
  assert.deepEqual(reader.snapshot().promises, []);
});

// 025-4: a stale card cannot act on a newer session.
test('a card from an older revision cannot retry a newer session', async () => {
  const ledger = ledgerOf([session({sessionId: 'session-new', revision: 9})]);
  const prompts = [];
  const controller = createTodayController({ledger, reader: {snapshot: () => ({promises: []})}, promptSession: async (...args) => prompts.push(args)});
  const oldCard = cardIdOf(session({sessionId: 'session-old', revision: 4}));
  const result = await controller.item({action: 'retry', projectId, cardId: oldCard});
  assert.equal(result.ok, false);
  assert.equal(result.stale, true);
  assert.equal(prompts.length, 0);
  const fresh = await controller.item({action: 'retry', projectId, cardId: cardIdOf(ledger.peek().sessions[0])});
  assert.equal(fresh.ok, true);
  assert.equal(prompts[0][0], 'session-new');
});

// 025-4: concurrent dispatch creates one session and records root/session.
test('dispatch is atomic per source item and records the workspace and session', async () => {
  const sources = createDotSources({store: memoryStore(), clock: () => NOW});
  const reader = {snapshot: () => ({promises: [{id: 'p1', source: 'dida', sourceItemId: 'task-1', what: '交稿'}]})};
  let creates = 0;
  const controller = createTodayController({
    ledger: ledgerOf([session()]), reader, links: sources, promptSession: async () => {},
    createSession: async ({root: granted, text}) => { creates += 1; await new Promise(resolve => setTimeout(resolve, 10)); return `session-${creates}`; },
    defaultRoot: async () => root,
  });
  const [a, b] = await Promise.all([
    controller.item({action: 'dispatch', promiseId: 'p1'}),
    controller.item({action: 'dispatch', promiseId: 'p1'}),
  ]);
  assert.equal(creates, 1, 'two concurrent clicks create one session');
  assert.equal([a, b].filter(row => row.ok).length, 1);
  assert.equal([a, b].filter(row => row.duplicate).length, 1);
  const link = await sources.linkOf('dida:task-1');
  assert.equal(link.state, 'ok');
  assert.equal(link.root, root);
  assert.match(link.sessionId, /^session-\d+$/);
});

test('a failed dispatch releases its claim so a later retry can run', async () => {
  const sources = createDotSources({store: memoryStore(), clock: () => NOW});
  const reader = {snapshot: () => ({promises: [{id: 'p1', source: 'dida', sourceItemId: 'task-1', what: '交稿'}]})};
  let attempts = 0;
  const controller = createTodayController({
    ledger: ledgerOf([session()]), reader, links: sources, promptSession: async () => {},
    createSession: async () => { attempts += 1; if (attempts === 1) throw new Error('host create failed'); return 'session-ok'; },
    defaultRoot: async () => root,
  });
  const failed = await controller.item({action: 'dispatch', promiseId: 'p1'});
  assert.equal(failed.ok, false);
  assert.equal(await sources.linkOf('dida:task-1'), null);
  const retried = await controller.item({action: 'dispatch', promiseId: 'p1'});
  assert.equal(retried.ok, true);
  assert.equal(attempts, 2);
});

// 025-3: Dida covers Inbox even when the project list omits it.
test('dida explicitly reads Inbox when the project list does not return it', async () => {
  const sources = createDotSources({store: memoryStore(), clock: () => NOW});
  await sources.enable('dida', KEY_A);
  await sources.enable('calendar', KEY_A);
  const reads = [];
  const reader = createDotSourceReader({
    sources, clock: () => NOW,
    read: async (source, request) => {
      reads.push({source, ...request});
      if (source === 'calendar') return {items: [], truncated: false};
      if (request.operation === 'projects') return {items: [{id: 'list-1', name: '工作'}], truncated: false};
      if (request.operation === 'inboxWindow') return {items: [{id: 'inbox-1', projectId: 'inbox-69a85785', title: '收件箱任务', dueAt: iso(NOW.getTime() + DAY), status: 'open'}], truncated: false};
      return {items: [], truncated: false};
    },
  });
  const cache = await reader.refreshNow();
  assert.ok(reads.some(read => read.operation === 'inboxWindow'));
  assert.deepEqual(cache.promises.map(row => row.sourceItemId), ['inbox-1']);
  assert.equal(reader.metrics().dida.lists, 1, 'the Inbox window is not counted as a named list');
  assert.equal(reader.metrics().dida.requests, 3, 'projects + list + Inbox window');
});

// 025-3: a truncated source is partial, and another source still works.
test('a truncated calendar is marked partial while dida still returns its items', async () => {
  const sources = createDotSources({store: memoryStore(), clock: () => NOW});
  await sources.enable('dida', KEY_A);
  await sources.enable('calendar', KEY_A);
  const reader = createDotSourceReader({
    sources, clock: () => NOW,
    read: async (source, request) => {
      if (source === 'calendar') return {items: [{id: 'e1', title: '评审', startAt: iso(NOW.getTime() + DAY)}], truncated: true};
      if (request.operation === 'projects') return {items: [{id: 'list-1', name: '工作'}], truncated: false};
      if (request.operation === 'inboxWindow' || request.projectId === 'inbox') return {items: [], truncated: false};
      return {items: [{id: 't1', projectId: 'list-1', title: '交稿', dueAt: iso(NOW.getTime() + DAY), status: 'open'}], truncated: false};
    },
  });
  const cache = await reader.refreshNow();
  const calendar = cache.sources.find(row => row.id === 'calendar');
  assert.equal(calendar.partial, true);
  assert.equal(cache.promises.map(row => row.sourceItemId).sort().join(','), 'e1,t1');
});

test('five calendar pages with a next page keep pages/hasMore/partial in metrics', async () => {
  const sources = createDotSources({store: memoryStore(), clock: () => NOW});
  await sources.enable('calendar', KEY_A);
  await sources.enable('dida', KEY_A);
  const reader = createDotSourceReader({
    sources, clock: () => NOW,
    read: async (source, request) => {
      if (source === 'dida') return request.operation === 'projects' ? {items: [], truncated: false} : {items: [], truncated: false};
      return {items: [{id: 'e1', title: '评审', startAt: iso(NOW.getTime() + DAY)}], truncated: true, coverage: {pages: 5, hasMore: true}};
    },
  });
  const cache = await reader.refreshNow();
  const stats = reader.metrics().calendar;
  assert.equal(stats.pages, 5);
  assert.equal(stats.requests, 5, 'one request per page');
  assert.equal(stats.lastPageHasMore, true);
  assert.equal(stats.truncated, true);
  assert.equal(cache.sources.find(row => row.id === 'calendar').partial, true);
});

test('a dida request failure records the request, failure and 429 without claiming completeness', async () => {
  const sources = createDotSources({store: memoryStore(), clock: () => NOW});
  await sources.enable('dida', KEY_A);
  let calls = 0;
  const reader = createDotSourceReader({
    sources, clock: () => NOW,
    read: async (source, request) => {
      calls += 1;
      if (request.operation === 'projects') return {items: [{id: 'list-1', name: '工作'}], truncated: false};
      throw Object.assign(new Error('upstream 429'), {code: 'CONTEXT_HTTP_ERROR', status: 429});
    },
  });
  const cache = await reader.refreshNow();
  const stats = reader.metrics().dida;
  assert.equal(stats.requests, 2, 'projects + the failing list attempt');
  assert.equal(stats.failed, 1);
  assert.equal(stats.rateLimited, true);
  assert.ok(stats.ms >= 0);
  assert.equal(cache.sources.find(row => row.id === 'dida').state, 'unavailable');
  assert.equal(cache.promises.length, 0);
  assert.equal(calls, 2);
});
