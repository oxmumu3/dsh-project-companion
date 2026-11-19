import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import test from 'node:test';
import {createDotConnectorLedger} from '../src/dot-connector-ledger.js';
import {createDotSources} from '../src/dot-sources.js';
import {createMuseSessionHost} from '../src/muse-session-host.js';
import {createSessionLedger, sessionLedgerRowSchema} from '../src/session-ledger.js';
import {createWorkspaceAccess, workspaceAccessRowSchema} from '../src/workspace-access.js';

const memoryStore = () => {
  let value;
  return {get: async () => value, put: async (_key, next) => { value = structuredClone(next); }};
};

test('native ledger preserves the pre-archive state and complete Markdown across restart', async () => {
  const store = memoryStore();
  const ledger = createSessionLedger({store});
  const scope = {sessionId: 'native', root: '/work/project', projectLabel: 'Project', title: 'Write'};
  const markdown = '# Outline\n\n' + 'A complete paragraph.\n'.repeat(100);
  await ledger.apply({...scope, kind: 'start'});
  await ledger.setArtifact(scope.sessionId, {kind: 'doc', markdown});
  await ledger.apply({...scope, kind: 'turn-end', reason: {kind: 'completed'}});
  assert.equal((await ledger.setState(scope.sessionId, 'handled', null, {archive: true})).changed, true);
  await ledger.apply({...scope, kind: 'start'});
  const saved = sessionLedgerRowSchema.parse(await store.get('profile'));
  assert.equal(saved.sessions[0].state, 'handled');
  assert.equal(saved.sessions[0].archivedFrom, 'done');
  assert.equal(saved.sessions[0].artifact.markdown, markdown);
  const restarted = createSessionLedger({store});
  assert.equal((await restarted.restoreState(scope.sessionId, null)).changed, true);
  assert.equal((await restarted.internal()).sessions[0].state, 'done');
});

test('connector switches preserve individual conversation grants and reject rotated credentials', async () => {
  const sources = createDotSources({store: memoryStore()});
  const first = 'a'.repeat(64), second = 'b'.repeat(64);
  const credentials = {calendar: first, gmail: first};
  await sources.enable('calendar', first);
  await sources.addSession('calendar', 'native', first);
  const workspace = createWorkspaceAccess({store: memoryStore(), catalog: {targets: () => []}});
  let invalidated = 0;
  const ledger = createDotConnectorLedger({
    dotSources: sources, workspaceAccess: workspace,
    context: {credentialFingerprint: source => ({configured: Boolean(credentials[source]), key: credentials[source]}),
      suspend: () => invalidated++},
    canEnable: async () => true, readMobile: async () => ({bridgeActive: true, paired: true}),
    readWechat: async () => true, onChange: () => {},
  });
  assert.deepEqual((await ledger.snapshot()).connectors.map(item => item.id),
    ['mac_bridge', 'workspace_grants', 'google_suite', 'flomo', 'dida', 'wechat']);
  await ledger.toggle({id: 'google_suite', enabled: false});
  assert.equal(invalidated, 1);
  assert.equal(sources.stateOf('calendar').allowedSessions[0].sessionId, 'native');
  credentials.calendar = second;
  assert.equal((await ledger.toggle({id: 'google_suite', enabled: true})).ok, false);
  assert.equal(sources.stateOf('gmail'), null);
  credentials.calendar = first;
  assert.equal((await ledger.toggle({id: 'google_suite', enabled: true})).ok, true);
  assert.equal(sources.stateOf('calendar').enabled, true);
  await ledger.toggle({id: 'wechat', enabled: false});
  assert.equal(sources.wechatNotificationsEnabled(), false);
});

test('native chat returns only the selected host turn and the ledger reflects archive and undo', async () => {
  const bus = new EventEmitter();
  const ledger = createSessionLedger({store: memoryStore()});
  const one = {id: 'native', header: {id: 'native', cwd: '/work/project'}};
  const other = {id: 'another', header: {id: 'another', cwd: '/work/project'}};
  const events = [];
  const agent = {id: one.id, status: 'idle', session: one, followup(message) {
    bus.emit('agent/inbox/claimed', {agent, message, turn: 2});
    const frame = data => bus.emit('agent/assistant-stream', {agent, frame: {attemptId: 'selected', revision: 0, ...data}});
    frame({type: 'start', turn: 2});
    frame({type: 'chunk', chunk: {type: 'reasoning-delta', text: 'private reasoning'}});
    frame({type: 'chunk', chunk: {type: 'text-delta', text: 'selected session '}});
    frame({type: 'chunk', chunk: {type: 'text-delta', text: 'reply'}});
    const assistant = text => ({type: 'assistant/message', seq: 2, time: Date.now(),
      data: {turn: 2, message: {content: [{type: 'text', text}]}}});
    bus.emit('session/event', other, assistant('belongs to another session'));
    events.push(assistant('selected session reply'));
    bus.emit('session/event', one, events[0]);
    bus.emit('session/event', one, {type: 'turn/end', data: {turn: 2, reason: {kind: 'completed'}}});
  }};
  const services = {
    agents: new Map([[one.id, agent]]),
    sessionPersistence: {stat: async () => ({header: one.header})},
    sessionController: {
      projections: async () => ({kind: 'sequenced', asOfSeq: 2, values: {workingDirectory: one.header.cwd}}),
      page: async () => ({records: events.map(event => ({type: 'event', event}))}),
    },
  };
  await ledger.apply({sessionId: one.id, root: one.header.cwd, title: 'Native', kind: 'start', projectLabel: ''});
  const grant = {root: one.header.cwd, label: 'Agent'};
  const access = {capture: async () => ({grants: [grant]}), authorizeSync: () => true, assertCurrent: async () => true};
  const host = createMuseSessionHost({
    ctx: {get: key => services[key], on(name, listener) {
      bus.on(name, listener);
      return () => bus.off(name, listener);
    }},
    ledger, workspaceAccess: access, foregroundSession: async () => null, isForeground: async () => false,
    canRun: async () => true,
  });
  const streamed = [];
  const response = await host.streamChat({sessionId: one.id, text: 'Continue', onEvent: event => streamed.push(event)});
  assert.deepEqual(response, {ok: true, reply: 'selected session reply'});
  assert.deepEqual(streamed, [{type: 'text_delta', delta: 'selected session '}, {type: 'text_delta', delta: 'reply'}]);
  assert.equal((await host.readSession(one.id)).messages[0].text, response.reply);
  assert.equal((await host.snapshot()).todayFocus.workspaceTitle, 'Agent');
  const archived = await host.desktopAct({id: one.id, action: 'complete'});
  assert.equal(archived.ok, true);
  assert.equal((await host.snapshot()).todayFocus, null);
  assert.equal((await host.readSession(one.id)).statusLabel, '已办妥');
  assert.equal((await host.desktopUndo({undoToken: archived.undoToken})).ok, true);
  assert.equal((await host.snapshot()).todayFocus.id, one.id);
});

test('workspace context mode survives a restart and invalidates old captures', async () => {
  const store = memoryStore();
  const catalog = {targets: () => []};
  const access = createWorkspaceAccess({store, catalog});
  const original = await access.capture();
  assert.equal(original.contextMode, 'full_local');
  await access.setContextMode('curated_only');
  assert.equal(access.authorizeSync(original), false);
  assert.equal(workspaceAccessRowSchema.parse(await store.get('profile')).contextMode, 'curated_only');
  assert.equal((await createWorkspaceAccess({store, catalog}).capture()).contextMode, 'curated_only');
  await assert.rejects(access.setContextMode('unrestricted'));
});
