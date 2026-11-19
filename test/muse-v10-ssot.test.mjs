import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {link, mkdir, mkdtemp, realpath, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
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

async function transcriptFixture({root = '/work/project', cwd = root, currentCwd = cwd, pageSize} = {}) {
  const id = 'native-transcript';
  const ledger = createSessionLedger({store: memoryStore()});
  await ledger.apply({sessionId: id, root, title: 'Native transcript', kind: 'start'});
  const records = [];
  const grant = {root, label: 'Project'};
  const access = {grants: [grant], contextMode: 'full_local'};
  const services = {
    sessionPersistence: {stat: async () => ({header: {id, cwd}})},
    sessionController: {
      projections: async () => ({kind: 'sequenced', asOfSeq: 100, values: {workingDirectory: currentCwd}}),
      page: async ({throughSeq, beforeSeq = throughSeq + 1}) => {
        if (!pageSize) return {records};
        const eligible = records.filter(record => record.event.seq < beforeSeq);
        return {records: eligible.slice(-pageSize), hasMore: eligible.length > pageSize};
      },
    },
  };
  const host = createMuseSessionHost({
    ledger, ctx: {get: key => services[key]},
    workspaceAccess: {
      capture: async () => ({...access}), authorizeSync: captured => captured.contextMode === access.contextMode,
      assertCurrent: async captured => assert.equal(captured.contextMode, access.contextMode),
    },
    foregroundSession: async () => null, isForeground: async () => false, canRun: async () => true,
  });
  const append = (type, seq, data) => records.push({type: 'event', event: {type, seq, data, time: Date.now()}});
  return {id, ledger, host, append, access};
}

test('native checklist wins over legacy sidecar data in session reads and both snapshots', async () => {
  const {id, ledger, host, append} = await transcriptFixture();
  await ledger.setArtifact(id, {kind: 'todo', checklist: [{id: 'legacy', text: 'Previously saved', checked: true}]});
  const plain = await host.readSession(id);
  assert.equal(plain.artifactKind, 'none');
  assert.deepEqual(plain.checklist, []);
  assert.equal(plain.progress, null);
  assert.equal((await host.snapshot()).todayFocus.artifactKind, 'none');
  assert.deepEqual(await host.act({id, action: 'toggle_checklist', itemId: 'legacy', checked: false}), {
    ok: false, error: '执行步骤由会话自动推进，请在对话中直接回复。',
  });

  append('todo/write', 4, {todos: [
    {content: 'Research', status: 'completed'}, {content: 'Draft', status: 'in_progress', checked: true},
    {content: 'Proofread', status: 'pending'}, {content: ' '}, {content: 'Publish', checked: true},
  ]});
  append('todo/write', 2, {todos: [{content: 'Old checklist'}]});
  append('todo/write', 101, {todos: [{content: 'Outside the sequence cut'}]});
  for (let seq = 10; seq < 44; seq++) append('user/message', seq, {source: {kind: 'user'}, content: [{type: 'text', text: String(seq)}]});
  append('assistant/message', 44, {interrupted: true, message: {content: [{type: 'text', text: 'discard'}]}});

  const detail = await host.readSession(id);
  const defaultSnapshot = await host.snapshot();
  const withMessages = await host.snapshot({includeMessages: true});
  for (const row of [detail, defaultSnapshot.todayFocus, withMessages.todayFocus]) {
    assert.equal(row.artifactKind, 'todo');
    assert.equal(row.progress, 0.5);
    assert.deepEqual(row.checklist, [
      {id: 'native-4-0', text: 'Research', checked: true, status: 'completed'},
      {id: 'native-4-1', text: 'Draft', checked: false, status: 'in_progress'},
      {id: 'native-4-2', text: 'Proofread', checked: false, status: 'pending'},
      {id: 'native-4-3', text: 'Publish', checked: true, status: 'completed'},
    ]);
  }
  assert.equal(detail.messages.length, 30);
  assert.equal(detail.messages[0].text, '14');
  assert.deepEqual(withMessages.todayFocus.messages, detail.messages);
  assert.deepEqual(defaultSnapshot.todayFocus.messages, []);

  append('todo/write', 45, {todos: []});
  assert.equal((await host.snapshot()).todayFocus.artifactKind, 'none');
});

test('a native checklist from an older transcript page remains visible', async () => {
  const {id, host, append} = await transcriptFixture({pageSize: 1});
  append('todo/write', 0, {todos: [{content: 'Keep this plan', status: 'in_progress'}]});
  append('user/message', 1, {source: {kind: 'user'}, content: [{type: 'text', text: 'Continue'}]});
  const row = await host.readSession(id);
  assert.equal(row.checklist[0]?.status, 'in_progress');
  assert.equal(row.messages[0]?.text, 'Continue');
  assert.equal((await host.snapshot()).todayFocus.checklist[0]?.status, 'in_progress');
});

test('a relative deliverable follows the working directory at the presentation event', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dot-native-directory-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const drafts = join(root, 'drafts');
  const currentCwd = join(root, 'review');
  await Promise.all([mkdir(drafts), mkdir(currentCwd)]);
  await Promise.all([writeFile(join(currentCwd, 'final.md'), 'Different file'), writeFile(join(drafts, 'final.md'), 'Presented file')]);
  const {id, host, append} = await transcriptFixture({root, currentCwd, pageSize: 1});
  append('working-directory/change', 1, {cwd: drafts});
  append('deliverables/presented', 2, {files: [{path: 'final.md'}]});
  append('working-directory/change', 3, {cwd: currentCwd});
  assert.equal((await host.readSession(id)).artifactMarkdown, 'Presented file');
});

test('a checklist written outside the granted workspace is hidden on return', async () => {
  const {host, id, append} = await transcriptFixture({pageSize: 1});
  append('working-directory/change', 0, {cwd: '/other/project'});
  append('todo/write', 1, {todos: [{content: 'Another workspace'}]});
  append('working-directory/change', 2, {cwd: '/work/project'});
  assert.equal((await host.readSession(id)).artifactKind, 'none');
  append('todo/write', 3, {todos: [{content: 'Authorized workspace'}]});
  assert.equal((await host.snapshot()).todayFocus.checklist[0]?.text, 'Authorized workspace');
});

test('presented Markdown is read only from the currently granted workspace', async t => {
  const temporary = await realpath(await mkdtemp(join(tmpdir(), 'dot-native-markdown-')));
  t.after(() => rm(temporary, {recursive: true, force: true}));
  const root = join(temporary, 'project');
  const cwd = join(root, 'drafts');
  const outside = join(temporary, 'project-private');
  await Promise.all([mkdir(cwd, {recursive: true}), mkdir(outside)]);
  const markdown = '# Final\n\nComplete Markdown.\n';
  const source = join(cwd, 'final.markdown');
  const secret = join(outside, 'secret.md');
  await Promise.all([
    writeFile(source, markdown), writeFile(secret, 'outside workspace'),
    writeFile(join(cwd, 'oversized.md'), Buffer.alloc(512 * 1024 + 1, 'a')),
  ]);
  await Promise.all([
    link(secret, join(cwd, 'hardlink.md')),
    symlink(secret, join(cwd, 'symlink.md')),
    symlink(outside, join(cwd, 'escape')),
    symlink(cwd, join(root, 'alias')),
    mkdir(join(cwd, 'directory.md')),
  ]);
  const {host, id, ledger, append, access} = await transcriptFixture({root, cwd});
  await ledger.setArtifact(id, {kind: 'doc', markdown: '# Earlier explicit draft'});
  append('todo/write', 1, {todos: [{content: 'Prepare final'}]});
  append('deliverables/presented', 2, {files: [{path: 'export.pdf'}, {path: 'final.markdown'}, {path: 'missing.md'}]});
  append('deliverables/presented', 101, {files: [{path: 'missing.md'}]});
  for (const row of [await host.readSession(id), (await host.snapshot()).todayFocus]) {
    assert.equal(row.artifactKind, 'doc');
    assert.equal(row.artifactMarkdown, markdown);
    assert.deepEqual(row.checklist, []);
    assert.equal(row.progress, 1);
  }
  access.contextMode = 'curated_only';
  assert.equal((await host.snapshot()).todayFocus.artifactMarkdown, '# Earlier explicit draft');
  access.contextMode = 'full_local';
  const blocked = [secret, '../../project-private/secret.md', 'symlink.md', 'escape/secret.md', '../alias/final.markdown',
    'hardlink.md', 'directory.md', 'oversized.md', 'missing.md', 'latest.pdf'];
  for (const [index, path] of blocked.entries()) {
    append('deliverables/presented', 3 + index, {files: [{path}]});
    assert.equal((await host.readSession(id)).artifactMarkdown, '# Earlier explicit draft', path);
  }
});

test('a symlink in the granted root path cannot redirect a presented document', async t => {
  const temporary = await realpath(await mkdtemp(join(tmpdir(), 'dot-native-grant-')));
  t.after(() => rm(temporary, {recursive: true, force: true}));
  const outside = join(temporary, 'outside');
  await mkdir(join(outside, 'project'), {recursive: true});
  await writeFile(join(outside, 'project', 'secret.md'), 'outside');
  await symlink(outside, join(temporary, 'alias'));
  const {host, id, append} = await transcriptFixture({root: join(temporary, 'alias', 'project')});
  append('deliverables/presented', 0, {files: [{path: 'secret.md'}]});
  assert.equal((await host.readSession(id)).artifactKind, 'none');
});
