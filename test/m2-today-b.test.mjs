import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createTodayHost} from '../src/today-host.js';
import {joinPromiseLinks} from '../src/today-promises.js';
import {createTodayProjection} from '../src/today-projection.js';
import {createDotSources} from '../src/dot-sources.js';
import {createTodayController} from '../src/today-route.js';
import {buildToday} from '../client/today-model.js';
import {afterOverlaySay} from '../client/overlay-state.js';
import {createSessionLedger, projectPublicId} from '../src/session-ledger.js';

const root = '/Users/synthetic/projects/finder';
const other = '/Users/synthetic/projects/writing';
const projectId = projectPublicId(root);
const cardIdOf = row => createHash('sha256').update(`${row.sessionId}\n${row.revision}\n${row.state}`).digest('hex').slice(0, 32);

function row(overrides = {}) {
  return {sessionId: 'session-a', root, projectLabel: 'Finder', title: '测试会话', state: 'needs_you', what: '等你批准', needs: {kind: 'approval', id: 'approval-1', askedAt: '2026-11-11T06:00:00.000Z'}, startedAt: '2026-11-11T05:00:00.000Z', lastEventAt: '2026-11-11T06:00:00.000Z', revision: 3, ...overrides};
}

function ledgerOf(sessions) {
  let state = {sessions, projects: [], revision: 1};
  return {
    async internal() { return structuredClone(state); },
    async setState(sessionId, next) {
      const item = state.sessions.find(session => session.sessionId === sessionId);
      if (!item) return {changed: false};
      item.state = next;
      item.revision += 1;
      return {changed: true};
    },
    peek() { return state; },
  };
}

test('official host contract: agents.status is busy and prompt uses queue/steer with an AbortSignal', async () => {
  const agents = new Map([['session-a', {status: 'idle'}]]);
  const prompts = [];
  const ctx = {
    get(name) {
      if (name === 'agents') return {get: id => agents.get(id)};
      if (name === 'sessionController') return {prompt: async (request, signal) => prompts.push({request, signal})};
      return null;
    },
  };
  const host = createTodayHost({ctx});
  assert.equal(await host.busy('session-a'), false);
  agents.set('session-a', {status: 'running'});
  assert.equal(await host.busy('session-a'), true);
  assert.equal(await host.busy('missing'), null);
  await host.prompt('session-a', '看看现在什么情况');
  await host.prompt('session-a', '插一句', {steer: true});
  assert.equal(prompts.length, 2);
  assert.equal(prompts[0].request.mode, 'queue');
  assert.equal(prompts[1].request.mode, 'steer');
  assert.equal(prompts[0].request.sessionId, 'session-a');
  assert.equal(prompts[0].request.content[0].text, '看看现在什么情况');
  assert.ok(prompts[0].signal instanceof AbortSignal);
  assert.ok(prompts[1].signal instanceof AbortSignal);
});

test('main path: say reads real busy and lands queue when idle, steer when running', async () => {
  for (const [status, mode] of [['idle', 'queue'], ['running', 'steer']]) {
    const agents = new Map([['session-foreground', {status}]]);
    const prompts = [];
    const ctx = {
      get(name) {
        if (name === 'agents') return {get: id => agents.get(id)};
        if (name === 'sessionController') return {prompt: async (request) => prompts.push(request)};
        return null;
      },
    };
    const host = createTodayHost({ctx});
    const controller = createTodayController({
      ledger: ledgerOf([row()]),
      reader: {snapshot: () => ({promises: []})},
      foregroundSession: async () => 'session-foreground',
      foregroundBusy: host.busy,
      promptSession: host.prompt,
    });
    const value = await controller.say({text: '现在各项目什么情况'});
    assert.equal(value.ok, true);
    assert.equal(value.mode, mode);
    assert.equal(prompts[0].mode, mode);
    assert.equal(prompts[0].content[0].text, '现在各项目什么情况');
  }
});

test('promise links are read back only while the root is still granted', async () => {
  const promises = [{id: 'p1', source: 'dida', sourceItemId: 't1', what: '交稿'}];
  const internal = {sessions: [{sessionId: 'session-dispatched', root, state: 'doing', title: '处理交稿', lastEventAt: '2026-11-11T06:00:00.000Z'}]};
  const links = {linkOf: async key => key === 'dida:t1' ? {state: 'ok', sessionId: 'session-dispatched', root} : null};
  const joined = await joinPromiseLinks({promises, internal, links, grants: [{root}]});
  assert.equal(joined[0].handledBy.sessionId, 'session-dispatched');
  assert.equal(joined[0].handledBy.state, 'doing');
  const revoked = await joinPromiseLinks({promises, internal, links, grants: []});
  assert.equal(revoked[0].handledBy, undefined);
  const stale = await joinPromiseLinks({promises, internal: {sessions: []}, links, grants: [{root}]});
  assert.equal(stale[0].handledBy, undefined);
});

test('the right rail keeps the persisted handler and offers to open it', () => {
  const activity = {
    revision: 5,
    reachable: true,
    counts: {done: 0, wait: 0, stuck: 0, run: 1, total: 1},
    sessions: [{projectId, state: 'doing', title: '正在处理', what: '跑着', cardId: 'x', at: '2026-11-11T06:00:00.000Z'}],
    projects: [{id: projectId, name: 'Finder', slot: 0}],
    promises: [{id: 'p1', whenText: '今天', what: '交稿', from: '滴答清单', source: 'dida', sourceItemId: 't1', handledBy: {sessionId: 'session-dispatched', state: 'doing', title: '处理交稿'}}],
    sources: [],
    connection: {wechat: 'bound'},
  };
  const model = buildToday(activity);
  assert.equal(model.promises[0].dispatch, false);
  assert.equal(model.promises[0].handledBy.sessionId, 'session-dispatched');
  assert.match(model.promises[0].note, /处理交稿/);
});

test('open returns the session for an authorized card without changing the ledger', async () => {
  const ledger = ledgerOf([row()]);
  const controller = createTodayController({ledger, reader: {snapshot: () => ({promises: []})}, promptSession: async () => {}});
  const value = await controller.item({action: 'open', projectId, cardId: cardIdOf(row())});
  assert.equal(value.ok, true);
  assert.equal(value.openSession, true);
  assert.equal(value.sessionId, 'session-a');
  assert.equal(ledger.peek().sessions[0].state, 'needs_you');
});

test('a revoked project refuses the card instead of acting on it', async () => {
  const controller = createTodayController({
    ledger: ledgerOf([row()]),
    reader: {snapshot: () => ({promises: []})},
    promptSession: async () => {},
    authorizeRoot: async () => false,
  });
  const value = await controller.item({action: 'handled', projectId, cardId: cardIdOf(row())});
  assert.equal(value.ok, false);
  assert.equal(value.revoked, true);
});

test('handled and snooze are undoable once through an opaque token', async () => {
  const ledger = ledgerOf([row()]);
  const controller = createTodayController({ledger, reader: {snapshot: () => ({promises: []})}, promptSession: async () => {}});
  const handled = await controller.item({action: 'handled', projectId, cardId: cardIdOf(row())});
  assert.equal(handled.ok, true);
  assert.equal(typeof handled.undoId, 'string');
  assert.equal(ledger.peek().sessions[0].state, 'handled');
  const undone = await controller.item({action: 'undo', undoId: handled.undoId});
  assert.equal(undone.ok, true);
  assert.equal(ledger.peek().sessions[0].state, 'needs_you');
  const again = await controller.item({action: 'undo', undoId: handled.undoId});
  assert.equal(again.ok, false);
  assert.equal(again.expired, true);
});

test('approve races the native card through the host decision and reports pending', async () => {
  const decisions = [];
  const controller = createTodayController({
    ledger: ledgerOf([row()]),
    reader: {snapshot: () => ({promises: []})},
    promptSession: async () => {},
    approvals: {decide: async (id, choice) => { decisions.push([id, choice]); return {ok: true}; }},
  });
  const value = await controller.item({action: 'approve', projectId, cardId: cardIdOf(row())});
  assert.equal(value.ok, true);
  assert.equal(value.pending, true);
  assert.deepEqual(decisions, [['approval-1', 'allow-once']]);
  assert.equal(value.text, '已发出，等它接');
});

test('approve falls back to opening the session when the host has no decision path', async () => {
  const controller = createTodayController({ledger: ledgerOf([row()]), reader: {snapshot: () => ({promises: []})}, promptSession: async () => {}});
  const value = await controller.item({action: 'approve', projectId, cardId: cardIdOf(row())});
  assert.equal(value.ok, false);
  assert.equal(value.fallback, 'open_session');
  assert.equal(value.sessionId, 'session-a');
});

test('a dispatch becomes a duplicate once the persisted link exists', async () => {
  const links = {
    linkOf: async () => ({state: 'ok', sessionId: 'session-dispatched', root}),
    claimLink: async () => ({changed: true}),
  };
  const controller = createTodayController({
    ledger: ledgerOf([row(), row({sessionId: 'session-b', root: other})]),
    reader: {snapshot: () => ({promises: [{id: 'p1', source: 'dida', sourceItemId: 't1', what: '交稿'}]})},
    promptSession: async () => {},
    links,
    defaultRoot: async () => root,
    authorizeRoot: async () => true,
    createSession: async () => { throw new Error('must not create'); },
  });
  const value = await controller.promise({promiseId: 'p1'});
  assert.equal(value.ok, false);
  assert.equal(value.duplicate, true);
  assert.equal(value.sessionId, 'session-dispatched');
});

test('revocation after the claim blocks the first external create and releases the claim', async () => {
  const link = {value: null};
  const links = {
    async linkOf() { return link.value ? structuredClone(link.value) : null; },
    async claimLink(key, rootValue, token, {sessionId} = {}) { link.value = {key, state: 'pending', token, sessionId, root: rootValue}; return {changed: true}; },
    async releaseLink() { link.value = null; return true; },
  };
  let checks = 0, created = 0;
  const controller = createTodayController({
    ledger: ledgerOf([row()]),
    reader: {snapshot: () => ({promises: [{id: 'p1', source: 'dida', sourceItemId: 't1', what: '交稿'}]})},
    promptSession: async () => {},
    links,
    defaultRoot: async () => root,
    authorizeRoot: async () => { checks += 1; return checks === 1; },
    createSession: async () => { created += 1; return 'session-new'; },
  });
  const value = await controller.promise({promiseId: 'p1'});
  assert.equal(value.ok, false);
  assert.equal(value.revoked, true);
  assert.equal(created, 0, 'no session is created after the post-claim revocation check');
  assert.equal(link.value, null, 'the claim is released because no external action happened');
});

test('source revocation while claiming prevents dispatch even with an authorized workspace', async () => {
  const promise = {id: 'p1', source: 'dida', sourceItemId: 't1', what: '合成待办'};
  let enabled = true;
  let created = 0;
  let released = 0;
  const controller = createTodayController({
    ledger: ledgerOf([row()]),
    reader: {snapshot: () => ({promises: enabled ? [promise] : []})},
    promptSession: async () => {},
    links: {
      linkOf: async () => null,
      claimLink: async () => { enabled = false; return {changed: true}; },
      releaseLink: async () => { released += 1; },
    },
    defaultRoot: async () => root,
    authorizeRoot: async () => true,
    createSession: async () => { created += 1; return 'session-new'; },
  });
  const result = await controller.promise({promiseId: promise.id});
  assert.equal(result.ok, false);
  assert.equal(created, 0);
  assert.equal(released, 1);
});

test('a settle failure after create leaves an accurate pending id, so a second click creates only once', async () => {
  const table = new Map();
  const links = createDotSources({
    store: {get: key => table.get(key), put: (key, value) => table.set(key, value)},
    legacyReader: async () => ({sources: [], digest: ''}),
    isClosed: () => false,
  });
  const settle = links.settleLink.bind(links);
  let failSettle = true;
  links.settleLink = async (...args) => { if (failSettle) { failSettle = false; throw new Error('disk full'); } return settle(...args); };
  const createdIds = [];
  const controller = createTodayController({
    ledger: ledgerOf([row()]),
    reader: {snapshot: () => ({promises: [{id: 'p1', source: 'dida', sourceItemId: 't1', what: '交稿'}]})},
    promptSession: async () => {},
    links,
    defaultRoot: async () => root,
    authorizeRoot: async () => true,
    createSession: async ({sessionId}) => { createdIds.push(sessionId); return sessionId; },
  });
  const first = await controller.promise({promiseId: 'p1'});
  assert.equal(first.ok, true);
  assert.equal(first.pending, true);
  assert.equal(createdIds.length, 1);
  const persisted = await links.linkOf('dida:t1');
  assert.equal(persisted.state, 'pending');
  assert.equal(persisted.sessionId, createdIds[0], 'the pending link carries the actual session id');
  const second = await controller.promise({promiseId: 'p1'});
  assert.equal(second.ok, false);
  assert.equal(second.duplicate, true);
  assert.equal(second.pending, true);
  assert.equal(second.sessionId, createdIds[0]);
  assert.equal(createdIds.length, 1, 'the second click never creates another session');
});

test('a failed bind after the host returns a different id keeps the reservation and settles the actual id', async () => {
  const table = new Map();
  const links = createDotSources({
    store: {get: key => table.get(key), put: (key, value) => table.set(key, value)},
    legacyReader: async () => ({sources: [], digest: ''}),
  });
  let bindAttempts = 0;
  links.bindLink = async () => { bindAttempts += 1; throw new Error('fixture bind failure'); };
  const requestedIds = [];
  const actualId = 'session-created-by-host';
  const controller = createTodayController({
    ledger: ledgerOf([row()]),
    reader: {snapshot: () => ({promises: [{id: 'p1', source: 'dida', sourceItemId: 't1', what: '合成待办'}]})},
    promptSession: async () => {},
    links,
    defaultRoot: async () => root,
    authorizeRoot: async () => true,
    createSession: async ({sessionId}) => { requestedIds.push(sessionId); return actualId; },
  });
  const first = await controller.promise({promiseId: 'p1'});
  const second = await controller.promise({promiseId: 'p1'});
  assert.equal(bindAttempts, 1);
  assert.equal(requestedIds.length, 1);
  assert.notEqual(requestedIds[0], actualId);
  assert.equal(first.ok, true);
  assert.equal(first.sessionId, actualId);
  assert.equal(second.duplicate, true);
  assert.equal(second.sessionId, actualId);
  assert.equal((await links.linkOf('dida:t1')).sessionId, actualId);
});

test('an older undo token cannot undo a newer snooze on the same row', async () => {
  const ledger = ledgerOf([row()]);
  const controller = createTodayController({ledger, reader: {snapshot: () => ({promises: []})}, promptSession: async () => {}});
  const handled = await controller.item({action: 'handled', projectId, cardId: cardIdOf(row())});
  assert.equal(handled.ok, true);
  const snoozed = await controller.item({action: 'snooze', projectId, cardId: cardIdOf({sessionId: 'session-a', state: 'handled', revision: 4})});
  assert.equal(snoozed.ok, true);
  const old = await controller.item({action: 'undo', undoId: handled.undoId});
  assert.equal(old.ok, false);
  assert.equal(old.stale, true);
  assert.equal(ledger.peek().sessions[0].state, 'snoozed', 'the later snooze stays');
  const current = await controller.item({action: 'undo', undoId: snoozed.undoId});
  assert.equal(current.ok, true);
  assert.equal(ledger.peek().sessions[0].state, 'handled', 'undo restores the exact state the snooze replaced');
});

test('the serialized ledger rejects an undo if the row changes after the route precheck', async () => {
  const seed = {sessionId: 'session-a', root, projectLabel: 'Finder', title: '合成会话'};
  const event = (kind, minute, details = {}) => ({...seed, kind, at: new Date(Date.UTC(2026, 10, 11, 6, minute)).toISOString(), ...details});
  const ledger = createSessionLedger({store: {get: async () => undefined, put: async () => {}}});
  await ledger.apply(event('start', 0));
  await ledger.apply(event('approval-asked', 1, {toolName: 'fixture', reasonText: 'fixture'}));
  const original = (await ledger.internal()).sessions[0];
  let newer;
  const controller = createTodayController({
    ledger: {...ledger, async restoreState(...args) {
      await ledger.apply(event('start', 2));
      await ledger.setState(seed.sessionId, 'snoozed');
      newer = (await ledger.internal()).sessions[0];
      return ledger.restoreState(...args);
    }},
    promptSession: async () => {},
  });
  const handled = await controller.item({action: 'handled', projectId, cardId: cardIdOf(original)});
  assert.equal(handled.ok, true);
  const undo = await controller.item({action: 'undo', undoId: handled.undoId});
  assert.equal(undo.stale, true);
  assert.equal(newer.state, 'snoozed');
  assert.deepEqual((await ledger.internal()).sessions[0], newer);
});

test('the projection revalidates authorization after the link await and retries with fresh grants', async () => {
  let revision = 'workspace-a';
  let grants = [{root}];
  let revoked = false;
  const ledger = {
    async snapshot({grants: current}) {
      return {revision: 7, reachable: true, counts: {done: 0, wait: 0, stuck: 0, run: 0, total: current.length}, sessions: [], projects: current.length ? [{id: projectId, name: 'Finder', slot: 0}] : [], promises: [], noticed: [], sources: [], connection: {wechat: 'bound'}, sample: false};
    },
    async internal() { return {sessions: []}; },
  };
  const access = {
    async capture() { return {revision, grants}; },
    authorizeSync() { return true; },
    async assertCurrent(captured) { if (captured.revision !== revision) throw Object.assign(new Error('changed'), {code: 'WORKSPACE_ACCESS_CHANGED'}); },
  };
  const reader = {snapshot: () => ({revision: 3, promises: [{id: 'p1', source: 'dida', sourceItemId: 't1', what: '交稿'}], sources: [{id: 'dida', state: 'ok'}]})};
  const links = {linkOf: async () => { if (!revoked) { revoked = true; grants = []; revision = 'workspace-b'; } return null; }};
  const projection = createTodayProjection({sessionLedger: ledger, dotSourceReader: reader, workspaceAccess: access, links, readConnection: async () => 'bound'});
  const value = await projection();
  assert.equal(value.access.revision, 'workspace-b');
  assert.equal(value.projects.length, 0, 'a revocation during the link read is not returned as the old project list');
  assert.equal(value.access.count, 0);
});

test('the projection retries when the source identity advances during the link await', async () => {
  let sourceRevision = 1;
  let reads = 0;
  const ledger = {
    async snapshot() { return {revision: 2, reachable: true, counts: {done: 0, wait: 0, stuck: 0, run: 0, total: 0}, sessions: [], projects: [], promises: [], noticed: [], sources: [], connection: {wechat: 'none'}, sample: false}; },
    async internal() { return {sessions: []}; },
  };
  const access = {async capture() { return {revision: 'workspace-a', grants: []}; }, authorizeSync() { return true; }, async assertCurrent() { return true; }};
  const reader = {snapshot: () => ({revision: sourceRevision, promises: [{id: 'p', source: 'dida', sourceItemId: 't', what: '交稿'}], sources: [{id: 'dida', state: sourceRevision === 1 ? 'needs_authorization' : 'ok'}]})};
  const links = {linkOf: async () => { reads += 1; if (reads === 1) sourceRevision = 2; return null; }};
  const projection = createTodayProjection({sessionLedger: ledger, dotSourceReader: reader, workspaceAccess: access, links, readConnection: async () => 'none'});
  const value = await projection();
  assert.equal(value.revision, 4, 'the returned projection uses the fresh source revision');
  assert.equal(value.sources[0].state, 'ok');
  assert.equal(reads, 2, 'the changed source caused one retry');
});

test('the foreground projection checks grants and source rows after its final owner await', async () => {
  const promise = {id: 'p1', source: 'dida', sourceItemId: 't1', what: '合成待办'};
  let ownerChecks = 0;
  let revision = 'old';
  const ledger = {
    snapshot: async ({grants}) => ({revision: 1, projects: grants.map(() => ({id: projectId}))}),
    internal: async () => ({sessions: []}),
  };
  const workspaceAccess = {
    capture: async () => ({revision, grants: revision === 'old' ? [{root}] : []}),
    authorizeSync: captured => captured.revision === revision,
    assertCurrent: async () => true,
  };
  const projection = createTodayProjection({
    sessionLedger: ledger,
    dotSourceReader: {snapshot: () => ({revision: revision === 'old' ? 1 : 2, promises: revision === 'old' ? [promise] : [], sources: []})},
    workspaceAccess,
    readConnection: async () => 'bound',
    ownerForeground: async () => { if (++ownerChecks === 2) revision = 'new'; return true; },
  });
  const result = await projection('session-foreground');
  assert.equal(result.access.revision, 'new');
  assert.deepEqual(result.projects, []);
  assert.deepEqual(result.promises, []);
});

test('batch handled only clears the done group, never waiting or stuck rows', async () => {
  const ledger = ledgerOf([
    row({sessionId: 'done-1', state: 'done', revision: 1}),
    row({sessionId: 'done-2', state: 'done', revision: 2}),
    row({sessionId: 'wait-1', state: 'needs_you', revision: 3}),
    row({sessionId: 'stuck-1', state: 'stuck', revision: 4}),
  ]);
  const controller = createTodayController({ledger, reader: {snapshot: () => ({promises: []})}, promptSession: async () => {}});
  const value = await controller.item({action: 'handled-all', projectId});
  assert.equal(value.ok, true);
  assert.match(value.text, /2 件/);
  assert.deepEqual(ledger.peek().sessions.map(item => [item.sessionId, item.state]), [
    ['done-1', 'handled'],
    ['done-2', 'handled'],
    ['wait-1', 'needs_you'],
    ['stuck-1', 'stuck'],
  ]);
});

test('a stuck card opens the supported original session action', () => {
  const activity = {
    revision: 1, reachable: true, counts: {done: 0, wait: 0, stuck: 1, run: 0, total: 1},
    sessions: [{projectId, state: 'stuck', title: '卡住', what: '报错', cardId: 'c', at: '2026-11-11T06:00:00.000Z'}],
    projects: [{id: projectId, name: 'Finder', slot: 0}], promises: [], sources: [], connection: {wechat: 'bound'},
  };
  const model = buildToday(activity);
  assert.equal(model.needCards[0].secondAct, 'open', 'the talk label must not send an unsupported action');
});

test('the right rail prefers the strong link, then a project-title weak link, then no owner', () => {
  const base = {
    revision: 3, reachable: true, counts: {done: 0, wait: 0, stuck: 0, run: 1, total: 1},
    sessions: [{projectId, state: 'doing', title: '最近的会话', cardId: 'card-1', at: '2026-11-11T06:00:00.000Z'}],
    projects: [{id: projectId, name: 'Finder', slot: 0}], sources: [], connection: {wechat: 'bound'},
  };
  const weak = buildToday({...base, promises: [{id: 'p1', what: '把 Finder 的稿子交掉', from: '滴答清单', source: 'dida', sourceItemId: 't1'}]});
  assert.equal(weak.promises[0].dispatch, false);
  assert.equal(weak.promises[0].related.projectName, 'Finder');
  assert.equal(weak.promises[0].related.cardId, 'card-1');
  assert.match(weak.promises[0].note, /最近有动静/);
  const none = buildToday({...base, promises: [{id: 'p2', what: '买牛奶', from: '滴答清单', source: 'dida', sourceItemId: 't2'}]});
  assert.equal(none.promises[0].dispatch, true);
  assert.equal(none.promises[0].note, '还没有人在处理');
  const strong = buildToday({...base, promises: [{id: 'p3', what: '把 Finder 的稿子交掉', from: '滴答清单', source: 'dida', sourceItemId: 't3', handledBy: {sessionId: 'session-strong', state: 'doing', title: '强关联会话'}}]});
  assert.equal(strong.promises[0].handledBy.sessionId, 'session-strong');
  assert.equal(strong.promises[0].related, null);
  assert.equal(strong.promises[0].dispatch, false);
});

test('overlay input keeps the original text after a failed say and clears after delivery', () => {
  assert.equal(afterOverlaySay('没发出去', {delivered: false}), '没发出去');
  assert.equal(afterOverlaySay('发出去了', {delivered: true}), '');
  assert.equal(afterOverlaySay('退路已带走', {delivered: true, moved: true}), '');
});

test('say re-checks the same foreground after busy and keeps the words when it switched', async () => {
  const prompts = [];
  let foregroundCalls = 0;
  const controller = createTodayController({
    ledger: ledgerOf([row()]),
    reader: {snapshot: () => ({promises: []})},
    foregroundSession: async () => (++foregroundCalls === 1 ? 'session-a' : 'session-b'),
    foregroundBusy: async () => { await new Promise(resolve => setTimeout(resolve, 5)); return true; },
    promptSession: async (...args) => prompts.push(args),
  });
  const value = await controller.say({text: '现在各项目什么情况'});
  assert.equal(value.ok, false);
  assert.equal(value.fallback, 'stage_draft');
  assert.equal(value.foregroundChanged, true);
  assert.equal(prompts.length, 0, 'the old foreground is never steered after the switch');
});

test('production waiting card has one open action and it opens the original session', async () => {
  const activity = {
    revision: 4, reachable: true, counts: {done: 0, wait: 1, stuck: 0, run: 0, total: 1},
    sessions: [{projectId, state: 'needs_you', title: '等你批准', what: 'bash 要批准', cardId: cardIdOf(row()), at: '2026-11-11T06:00:00.000Z'}],
    projects: [{id: projectId, name: 'Finder', slot: 0}], promises: [], sources: [], connection: {wechat: 'bound'},
  };
  const model = buildToday(activity);
  const card = model.needCards[0];
  assert.equal(card.primary, '打开会话');
  assert.equal(card.primaryAct, 'open');
  assert.equal(card.second, null, 'no duplicate approve/open pair without an approval service');
  const controller = createTodayController({ledger: ledgerOf([row()]), reader: {snapshot: () => ({promises: []})}, promptSession: async () => {}});
  const value = await controller.item({action: card.primaryAct, projectId, cardId: card.cardId});
  assert.equal(value.ok, true);
  assert.equal(value.openSession, true);
  assert.equal(value.sessionId, 'session-a');
});
