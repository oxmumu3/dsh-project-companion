import test from 'node:test';
import assert from 'node:assert/strict';
import {createPersonalContext} from '../src/context-service.js';
import {createDidaRest} from '../src/dida-rest.js';
import {createDotSources,legacyDigest} from '../src/dot-sources.js';
import {createDotSourceReader} from '../src/dot-source-reader.js';
import {createTodayController,registerTodayRoutes} from '../src/today-route.js';

const KEY = 'a'.repeat(64);
const BIND = 'b'.repeat(64);
const OWNER = sessionId => ({sessionId, cwd: '/Users/synthetic/project'});

function stores(legacyRows) {
  let legacy = {id: 'profile', version: 1, sources: legacyRows};
  let dot = null;
  const legacyPuts = [];
  return {
    legacy: {
      async get() { return structuredClone(legacy); },
      async put(key, value) { legacyPuts.push(key); legacy = structuredClone(value); },
    },
    dot: {
      async get() { return dot === null ? null : structuredClone(dot); },
      async put(_key, value) { dot = structuredClone(value); },
    },
    legacyPuts,
    dotPeek: () => structuredClone(dot),
    legacyPeek: () => structuredClone(legacy),
  };
}

function makeContext(state, {foreground = 'dot'} = {}) {
  const dotSources = createDotSources({
    store: state.dot,
    legacyReader: async () => ({sources: state.legacyPeek().sources, digest: legacyDigest(state.legacyPeek().sources)}),
    clock: () => new Date('2026-11-11T09:00:00.000Z'),
  });
  const transport = {
    async catalog() { return {tools: [{name: 'search_threads'}, {name: 'get_message'}]}; },
    async call() { return {value: {items: []}}; },
    async close() {},
  };
  const context = createPersonalContext({
    store: state.legacy,
    transport,
    readConfig: () => ({}),
    readBinding: async () => ({kind: 'bound', bindingKey: BIND}),
    credentialState: () => ({configured: true, key: KEY}),
    canRun: async () => true,
    dotSources,
    foregroundSession: async sessionId => sessionId === foreground,
    foregroundSessionSync: sessionId => sessionId === foreground,
    clock: () => new Date('2026-11-11T09:00:00.000Z'),
    hostTimeZone: () => 'Asia/Shanghai',
  });
  return {context, dotSources};
}

test('authenticated metrics distinguish a malformed Inbox window from a scoped owner response', async t => {
  const state = stores([{source: 'dida', sessionId: 'prior', bindingKey: BIND, credentialKey: KEY, grantId: 'legacy-dida'}]);
  const clock = () => new Date('2026-11-11T09:00:00.000Z');
  const dotSources = createDotSources({store: state.dot, legacyReader: async () => ({
    sources: state.legacyPeek().sources, digest: legacyDigest(state.legacyPeek().sources),
  }), clock});
  const lists = Array.from({length: 11}, (_, index) => ({id: `synthetic-list-${index}`, name: 'fixture-list-title'}));
  const requests = [];
  let windowReply = {project: {id: 'fixture-canonical-inbox-id'}, tasks: []};
  const transport = createDidaRest({getToken: async () => 'fixture-token', fetch: async (value, init) => {
    const path = new URL(value).pathname;
    requests.push(path);
    if (path === '/open/v1/project') return Response.json(lists);
    if (path === '/open/v1/task/undone') {
      assert.equal(init.method, 'POST');
      assert.deepEqual(JSON.parse(init.body).projectIds, ['inbox']);
      return Response.json(windowReply);
    }
    const project = lists.find(list => path === `/open/v1/project/${list.id}/data`);
    assert.ok(project);
    return Response.json({project, tasks: Array.from({length: 48}, (_, index) => ({
      id: `${project.id}-${index}`, projectId: project.id, title: 'fixture-task-title', status: 0, dueDate: clock().toISOString(),
    }))});
  }, clock});
  const context = createPersonalContext({store: state.legacy, transport, dotSources,
    readConfig: () => ({}), readBinding: async () => ({kind: 'bound', bindingKey: BIND}),
    credentialState: () => ({configured: true, key: KEY}), clock});
  t.after(() => context.close());
  await context.ready();
  const reader = createDotSourceReader({sources: dotSources, read: context.readDot, clock});
  const controller = createTodayController({reader, ledger: {internal: async () => ({}), setState: async () => {}}, promptSession: async () => {}});
  const routes = new Map();
  const stop = registerTodayRoutes({get: () => ({fetch: {register: route => {
    routes.set(route.path, route);
    return () => routes.delete(route.path);
  }}})}, {controller});
  t.after(stop);
  const path = '/api/project_companion/metrics';
  const response = await routes.get(path).fetch(new Request(`http://fixture.invalid${path}`, {method: 'POST'}));
  assert.equal(response.status, 200);
  const text = await response.text();
  const value = JSON.parse(text);
  assert.deepEqual(requests, ['/open/v1/project', ...lists.map(list => `/open/v1/project/${list.id}/data`), '/open/v1/task/undone']);
  const {requests: attempts, lists: namedLists, undone, failed, code, inboxWindow, inboxProtocolStage} = value.metrics.dida;
  assert.deepEqual({attempts, namedLists, undone, inboxWindow, failed, code}, {attempts: 13, namedLists: 11, undone: 528, inboxWindow: 0, failed: 1, code: null});
  assert.equal(value.sources[0].state, 'ok');
  assert.equal(value.sources[0].partial, true);
  assert.equal(value.sources[0].partialReason, 'inbox_window');
  assert.equal(reader.snapshot().promises.length, 60, 'named-list tasks stay visible after the window batch is dropped');
  assert.equal(inboxProtocolStage, 'window_array');
  assert.equal(JSON.stringify(value.sources).includes('inboxProtocolStage'), false);
  assert.doesNotMatch(text, /fixture-canonical-inbox-id|synthetic-list|fixture-(list|task)-title|fixture-token/);

  requests.length = 0;
  windowReply = [{id: 'fixture-inbox-row', projectId: 'fixture-inbox-owner', title: 'fixture-inbox-title', status: 0, dueDate: clock().toISOString()}];
  const success = await routes.get(path).fetch(new Request(`http://fixture.invalid${path}`, {method: 'POST'}));
  assert.equal(success.status, 200);
  const successText = await success.text();
  const successValue = JSON.parse(successText);
  const dida = successValue.metrics.dida;
  assert.equal(successValue.sources[0].state, 'ok');
  assert.equal(successValue.sources[0].partial, undefined);
  assert.deepEqual({requests: dida.requests, lists: dida.lists, undone: dida.undone, inboxWindow: dida.inboxWindow, failed: dida.failed, code: dida.code},
    {requests: 13, lists: 11, undone: 528, inboxWindow: 1, failed: 0, code: null});
  assert.equal(requests.at(-1), '/open/v1/task/undone');
  assert.equal(dida.inboxProtocolStage, undefined);
  assert.doesNotMatch(successText, /fixture-inbox-(row|title)|synthetic-list|fixture-(list|task)-title|fixture-token/);
  assert.deepEqual(state.legacyPuts, []);
});

test('production wiring: ordinary connect writes only the new domain and records its session', async () => {
  const state = stores([{source: 'gmail', sessionId: 'prior', bindingKey: BIND, credentialKey: KEY, grantId: 'legacy-grant'}]);
  const {context} = makeContext(state);
  await context.ready();
  const before = state.dotPeek();
  // Legacy row migrates as an enabled switch with the prior session grant.
  const migrated = before.sources.find(row => row.source === 'gmail');
  assert.equal(migrated.enabled, true);
  assert.equal(migrated.grantId, 'legacy-grant');
  assert.deepEqual(migrated.allowedSessions.map(row => row.sessionId), ['prior']);
  assert.equal(migrated.allowedSessions[0].bindingKey, BIND);

  await context.act(OWNER('ordinary'), {action: 'connect', source: 'gmail', userRequested: true});
  assert.deepEqual(state.legacyPuts, [], 'the legacy domain must receive zero writes');
  const row = state.dotPeek().sources.find(item => item.source === 'gmail');
  assert.deepEqual(row.allowedSessions.map(item => item.sessionId).sort(), ['ordinary', 'prior']);
  assert.equal(row.allowedSessions.find(item => item.sessionId === 'ordinary').bindingKey, BIND);
  assert.deepEqual(state.legacyPeek().sources, [{source: 'gmail', sessionId: 'prior', bindingKey: BIND, credentialKey: KEY, grantId: 'legacy-grant'}], 'legacy rows stay untouched');
  await context.close();
});

test('production wiring: Dot and sessions A/B coexist, and revoking B leaves the others', async () => {
  const state = stores([{source: 'gmail', sessionId: 'prior', bindingKey: BIND, credentialKey: KEY, grantId: 'g'}]);
  const {context} = makeContext(state);
  await context.ready();
  await context.act(OWNER('session-a'), {action: 'connect', source: 'gmail', userRequested: true});
  await context.act(OWNER('session-b'), {action: 'connect', source: 'gmail', userRequested: true});
  await context.act(OWNER('dot'), {action: 'connect', source: 'gmail', userRequested: true});
  let row = state.dotPeek().sources.find(item => item.source === 'gmail');
  assert.deepEqual(row.allowedSessions.map(item => item.sessionId).sort(), ['dot', 'prior', 'session-a', 'session-b']);
  assert.equal(row.enabled, true, 'the foreground connect turns the Dot switch on');
  assert.equal(state.legacyPuts.length, 0);

  await context.act(OWNER('session-b'), {action: 'disconnect', source: 'gmail', userRequested: true});
  row = state.dotPeek().sources.find(item => item.source === 'gmail');
  assert.deepEqual(row.allowedSessions.map(item => item.sessionId).sort(), ['dot', 'prior', 'session-a']);
  assert.equal(row.enabled, true, 'disconnecting B does not turn Dot off');
  assert.equal(state.legacyPuts.length, 0);
  await context.close();
});

test('production wiring: the new domain survives a restart and the legacy domain is never written', async () => {
  const state = stores([{source: 'gmail', sessionId: 'prior', bindingKey: BIND, credentialKey: KEY, grantId: 'g'}]);
  const first = makeContext(state);
  await first.context.ready();
  await first.context.act(OWNER('ordinary'), {action: 'connect', source: 'gmail', userRequested: true});
  await first.context.close();

  const second = makeContext(state);
  await second.context.ready();
  const row = await second.dotSources.rowOf('gmail');
  assert.deepEqual(row.allowedSessions.map(item => item.sessionId).sort(), ['ordinary', 'prior']);
  // A second start must not read/rewrite the legacy domain at all.
  assert.equal(state.legacyPuts.length, 0);
  await second.context.close();
});

test('production wiring: a session without its own row is denied even when the switch is on', async () => {
  const state = stores([{source: 'gmail', sessionId: 'prior', bindingKey: BIND, credentialKey: KEY, grantId: 'g'}]);
  const {context} = makeContext(state);
  await context.ready();
  await assert.rejects(context.act(OWNER('intruder'), {action: 'query', source: 'gmail', operation: 'search', query: 'x', userRequested: true}), error => error.code === 'CONTEXT_NOT_ENABLED');
  assert.equal(state.legacyPuts.length, 0);
  await context.close();
});

test('ordinary session queries keep the original result scope and limit check', async () => {
  const state = stores([{source: 'gmail', sessionId: 'ordinary', bindingKey: BIND, credentialKey: KEY, grantId: 'g'}]);
  const dotSources = createDotSources({store: state.dot, legacyReader: async () => ({sources: state.legacyPeek().sources, digest: legacyDigest(state.legacyPeek().sources)})});
  const transport = {
    async catalog() { return {tools: [
      {name: 'search_threads', inputSchema: {type: 'object', additionalProperties: false, required: ['query', 'pageSize', 'includeTrash', 'view'], properties: {query: {type: 'string'}, pageSize: {type: 'integer'}, includeTrash: {type: 'boolean'}, view: {type: 'string'}}}},
      {name: 'get_message', inputSchema: {type: 'object', additionalProperties: false, required: ['messageId', 'messageFormat'], properties: {messageId: {type: 'string'}, messageFormat: {type: 'string'}}}},
    ]}; },
    async call() { return {value: {items: [{id: 'm1', title: 'One', snippet: 'a', internalDate: '1'}, {id: 'm2', title: 'Two', snippet: 'b', internalDate: '2'}]}}; },
    async close() {},
  };
  const context = createPersonalContext({
    store: state.legacy, transport, readConfig: () => ({}),
    readBinding: async () => ({kind: 'bound', bindingKey: BIND}),
    credentialState: () => ({configured: true, key: KEY}), canRun: async () => true,
    dotSources, foregroundSession: async () => false, foregroundSessionSync: () => false,
    clock: () => new Date('2026-11-11T09:00:00.000Z'), hostTimeZone: () => 'Asia/Shanghai',
  });
  await context.ready();
  await assert.rejects(
    context.act(OWNER('ordinary'), {action: 'query', source: 'gmail', operation: 'search', query: 'x', limit: 1, userRequested: true}),
    error => error.code === 'CONTEXT_SCOPE_VIOLATION',
  );
  assert.equal(state.legacyPuts.length, 0);
  await context.close();
});

test('reconnecting the same account changes the manifest digest, so an old approval fails', async () => {
  const state = stores([{source: 'gmail', sessionId: 'ordinary', bindingKey: BIND, credentialKey: KEY, grantId: 'g'}]);
  const {context} = makeContext(state);
  await context.ready();
  const owner = OWNER('ordinary');
  const first = await context.authorization(owner, ['gmail']);
  assert.equal(context.assertAuthorization(owner, ['gmail'], first), true);
  await context.act(owner, {action: 'connect', source: 'gmail', userRequested: true});
  const second = await context.authorization(owner, ['gmail']);
  assert.notEqual(second, first, 'a reconnect must change the grant generation');
  assert.equal(context.assertAuthorization(owner, ['gmail'], first), false, 'the old manifest cannot verify');
  assert.equal(context.assertAuthorization(owner, ['gmail'], second), true);
  assert.equal(state.legacyPuts.length, 0);
  await context.close();
});

test('an ordinary conversation reads with its own grant while Dot’s switch is off', async () => {
  const state = stores([{source: 'gmail', sessionId: 'ordinary', bindingKey: BIND, credentialKey: KEY, grantId: 'g'}]);
  const {context} = makeContext(state);
  await context.ready();
  // Turn Dot's own switch off; the conversation's grant is untouched.
  await context.act(OWNER('dot'), {action: 'disconnect', source: 'gmail', userRequested: true});
  const row = await context.snapshot(OWNER('ordinary'));
  assert.equal(row.sources.find(item => item.id === 'gmail').enabled, true, 'the ordinary grant still enables this conversation');
  assert.equal(context.assertAuthorization(OWNER('ordinary'), ['gmail'], await context.authorization(OWNER('ordinary'), ['gmail'])), true);
  await context.close();
});

test('session B changing its grant never changes A’s or Dot’s manifest', async () => {
  const state = stores([{source: 'gmail', sessionId: 'prior', bindingKey: BIND, credentialKey: KEY, grantId: 'g'}]);
  const {context} = makeContext(state);
  await context.ready();
  await context.act(OWNER('session-a'), {action: 'connect', source: 'gmail', userRequested: true});
  await context.act(OWNER('dot'), {action: 'connect', source: 'gmail', userRequested: true});
  const a1 = await context.authorization(OWNER('session-a'), ['gmail']);
  const dot1 = await context.authorization(OWNER('dot'), ['gmail']);
  await context.act(OWNER('session-b'), {action: 'connect', source: 'gmail', userRequested: true});
  assert.equal(await context.authorization(OWNER('session-a'), ['gmail']), a1, 'B join does not invalidate A');
  assert.equal(await context.authorization(OWNER('dot'), ['gmail']), dot1, 'B join does not invalidate Dot');
  await context.act(OWNER('session-b'), {action: 'disconnect', source: 'gmail', userRequested: true});
  assert.equal(await context.authorization(OWNER('session-a'), ['gmail']), a1, 'B leave does not invalidate A');
  // A's own reconnect does invalidate A's old summary.
  await context.act(OWNER('session-a'), {action: 'connect', source: 'gmail', userRequested: true});
  assert.notEqual(await context.authorization(OWNER('session-a'), ['gmail']), a1);
  await context.close();
});

test('a calendar event outside the requested window is a scope violation', async () => {
  const state = stores([{source: 'calendar', sessionId: 'ordinary', bindingKey: BIND, credentialKey: KEY, grantId: 'g'}]);
  const dotSources = createDotSources({store: state.dot, legacyReader: async () => ({sources: state.legacyPeek().sources, digest: legacyDigest(state.legacyPeek().sources)})});
  const transport = {
    async catalog() { return {tools: [{name: 'list_events', inputSchema: {type: 'object', additionalProperties: false, required: ['calendarId', 'startTime', 'endTime', 'orderBy', 'pageSize'], properties: {calendarId: {type: 'string'}, startTime: {type: 'string'}, endTime: {type: 'string'}, orderBy: {type: 'string'}, pageSize: {type: 'integer'}}}}]}; },
    async call() { return {value: {items: [{id: 'far', summary: 'Later', start: {dateTime: '2026-11-22T10:00:00+08:00', timeZone: 'Asia/Shanghai'}, end: {dateTime: '2026-11-22T11:00:00+08:00', timeZone: 'Asia/Shanghai'}}]}}; },
    async close() {},
  };
  const context = createPersonalContext({
    store: state.legacy, transport, readConfig: () => ({}),
    readBinding: async () => ({kind: 'bound', bindingKey: BIND}),
    credentialState: () => ({configured: true, key: KEY}), canRun: async () => true,
    dotSources, foregroundSession: async () => false, foregroundSessionSync: () => false,
    clock: () => new Date('2026-11-11T09:00:00.000Z'), hostTimeZone: () => 'Asia/Shanghai',
  });
  await context.ready();
  await assert.rejects(
    context.act(OWNER('ordinary'), {action: 'query', source: 'calendar', operation: 'upcoming', from: '2026-11-11T00:00:00+08:00', to: '2026-11-12T00:00:00+08:00', userRequested: true}),
    error => error.code === 'CONTEXT_SCOPE_VIOLATION' && error.scopeRule === 'calendar_outside_window',
  );
  await context.close();
});

test('disconnect then reconnect the same account cannot revive the old manifest', async () => {
  const state = stores([{source: 'gmail', sessionId: 'ordinary', bindingKey: BIND, credentialKey: KEY, grantId: 'g'}]);
  const {context} = makeContext(state);
  await context.ready();
  const owner = OWNER('ordinary');
  const first = await context.authorization(owner, ['gmail']);
  assert.equal(context.assertAuthorization(owner, ['gmail'], first), true);
  await context.act(owner, {action: 'disconnect', source: 'gmail', userRequested: true});
  await context.act(owner, {action: 'connect', source: 'gmail', userRequested: true});
  const second = await context.authorization(owner, ['gmail']);
  assert.notEqual(second, first, 'a reconnect must not reproduce the revoked digest');
  assert.equal(context.assertAuthorization(owner, ['gmail'], first), false);
  assert.equal(context.assertAuthorization(owner, ['gmail'], second), true);
  await context.close();
});

test('a credential/grant identity change drops the source cache now and advances revision', async () => {
  const sources = createDotSources({store: stores([]).dot, clock: () => new Date('2026-11-11T09:00:00.000Z')});
  await sources.enable('calendar', KEY);
  const reader = createDotSourceReader({
    sources, clock: () => new Date('2026-11-11T09:00:00.000Z'),
    read: async (source) => ({items: source === 'calendar' ? [{id: 'old-title', title: 'Old account', startAt: '2026-11-12T09:00:00+08:00'}] : [], truncated: false}),
  });
  await reader.refreshNow();
  const before = reader.snapshot();
  assert.equal(before.promises.length, 1);
  const readerWithIdentity = createDotSourceReader({
    sources, clock: () => new Date('2026-11-11T09:00:00.000Z'),
    identity: source => { const row = sources.stateOf(source); return `${row?.credentialKey ?? ''}:${row?.generation ?? 0}`; },
    read: async (source) => ({items: source === 'calendar' ? [{id: 'old-title', title: 'Old account', startAt: '2026-11-12T09:00:00+08:00'}] : [], truncated: false}),
  });
  await readerWithIdentity.refreshNow();
  // Account B replaces the credential before the first snapshot ever runs.
  await sources.enable('calendar', 'b'.repeat(64));
  const after = readerWithIdentity.snapshot();
  assert.equal(after.promises.length, 0, 'the old identity’s title must never be labelled as B');
  assert.ok(after.revision > 0, 'the projection revision advances with the identity change');
  await reader.stop();
  await readerWithIdentity.stop();
});

test('a read that crosses an account change is discarded, not cached under the new identity', async () => {
  const sources = createDotSources({store: stores([]).dot, clock: () => new Date('2026-11-11T09:00:00.000Z')});
  await sources.enable('calendar', KEY);
  const reader = createDotSourceReader({
    sources, clock: () => new Date('2026-11-11T09:00:00.000Z'),
    identity: source => { const row = sources.stateOf(source); return `${row?.credentialKey ?? ''}:${row?.generation ?? 0}`; },
    read: async source => {
      if (source === 'calendar') {
        // The account changes while the provider request is in flight.
        await sources.enable('calendar', 'b'.repeat(64));
        return {items: [{id: 'cross', title: 'Crossed account', startAt: '2026-11-12T09:00:00+08:00'}], truncated: false};
      }
      return {items: [], truncated: false};
    },
  });
  const cache = await reader.refreshNow();
  assert.equal(cache.promises.length, 0);
  assert.equal(cache.sources.find(row => row.id === 'calendar').state, 'unavailable');
  assert.equal(cache.sources.find(row => row.id === 'calendar').code, 'CONTEXT_BINDING_CHANGED');
  await reader.stop();
});
