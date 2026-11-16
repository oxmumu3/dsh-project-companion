import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createPersonalProfile} from '../src/personal-profile.js';
import {createSuperAgentBridge} from '../src/superagent-bridge.js';
import {createDailyDigest} from '../src/daily-digest-service.js';
import {createMuseController, registerMuseRoute} from '../src/muse-route.js';
import {createDotSourceReader} from '../src/dot-source-reader.js';
import {createTodayProjection} from '../src/today-projection.js';
import {createMuseIntelligence} from '../src/muse-intelligence.js';
import {createTodayController} from '../src/today-route.js';

function memoryKeyValueStore() {
  const map = new Map();
  return {
    async get(key) { return map.has(key) ? structuredClone(map.get(key)) : undefined; },
    async put(key, value) { map.set(key, structuredClone(value)); },
  };
}

test('createPersonalProfile manages traits, notes, persistence across reload, 2-minute undo expiry, and bounded guidanceSummary', async () => {
  let nowMs = Date.parse('2026-11-15T01:00:00.000Z');
  const clock = () => new Date(nowMs);
  const store = memoryKeyValueStore();

  const p1 = createPersonalProfile({store, clock});
  await p1.ready();

  const badTrait = await p1.setTrait({category: 'tone', label: '', value: '简短'});
  assert.equal(badTrait.ok, false);
  assert.equal(badTrait.code, 'INVALID_TRAIT');

  const t1 = await p1.setTrait({category: 'tone', label: '汇报方式', value: '先给结论_use_snake_case'});
  assert.equal(t1.ok, true);
  assert.equal(t1.profile.traits.length, 1);

  // Upserting same (category, label) updates in place rather than duplicating.
  const t2 = await p1.setTrait({category: 'tone', label: '汇报方式', value: '先给结论与下一步'});
  assert.equal(t2.ok, true);
  assert.equal(t2.profile.traits.length, 1);
  assert.equal(t2.profile.traits[0].value, '先给结论与下一步');

  const n1 = await p1.addNote({text: '周三下午出差，不排深思考', source: 'desktop'});
  assert.equal(n1.ok, true);
  assert.equal(n1.profile.notes.length, 1);
  assert.ok(n1.undoToken);

  // Delete note and undo within 2 minutes.
  const del = await p1.deleteNote({id: n1.note.id});
  assert.equal(del.ok, true);
  assert.equal(del.profile.notes.length, 0);
  const restored = await p1.undo({token: del.undoToken});
  assert.equal(restored.ok, true);
  assert.equal(restored.profile.notes.length, 1);

  // Expiry check: token older than 120s is rejected.
  const n2 = await p1.addNote({text: '过一会撤回验证超时', source: 'wechat'});
  assert.equal(n2.ok, true);
  nowMs += 121_000;
  const expired = await p1.undo({token: n2.undoToken});
  assert.equal(expired.ok, false);
  assert.equal(expired.code, 'UNDO_EXPIRED');

  // Guidance summary is bounded <= 800 chars and non-empty.
  for (let i = 0; i < 6; i += 1) {
    await p1.addNote({text: `第${i}条超长背景_${'a'.repeat(200)}`, source: 'desktop'});
  }
  const summary = p1.guidanceSummary();
  assert.ok(summary.length > 0 && summary.length <= 800);

  // Reload from backing store preserves persisted traits and notes.
  const p2 = createPersonalProfile({store, clock});
  const snap = await p2.ready();
  assert.equal(snap.traits.length, 1);
  assert.equal(snap.traits[0].value, '先给结论与下一步');
  assert.equal(snap.notes.length, 8);
});

test('createSuperAgentBridge handles absent/corrupt ledger as standalone and valid ledger as synergy + pending queue JSONL', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dot-muse-bridge-'));
  t.after(() => fs.rm(dir, {recursive: true, force: true}));

  const bridge = createSuperAgentBridge({
    dshHome: dir,
    clock: () => new Date('2026-11-15T02:00:00.000Z'),
  });

  const absent = await bridge.readSynergySnapshot();
  assert.equal(absent.mode, 'standalone');
  assert.equal(absent.available, false);
  assert.deepEqual(absent.milestones, []);

  // Corrupt JSON degrades safely to standalone.
  await fs.writeFile(path.join(dir, 'superagent-ledger.json'), '{not json', 'utf8');
  const corrupt = await bridge.readSynergySnapshot();
  assert.equal(corrupt.mode, 'standalone');
  assert.equal(corrupt.available, false);

  // Valid ledger enters synergy mode and filters milestones to blocked & in_review.
  await fs.writeFile(path.join(dir, 'superagent-ledger.json'), JSON.stringify({
    revision: 7,
    tasks: [
      {id: 't-1', title: '等待验收的 PR', status: 'in_review', description: '已完成单测', checklist: [{done: true}, {done: false}]},
      {id: 't-2', title: '鉴权卡点', status: 'in_progress', blocked: true, description: '缺少测试 key', checklist: [{done: true}]},
      {id: 't-3', title: '正在开发', status: 'in_progress'},
      {id: 't-4', title: '待开始', status: 'todo'},
    ],
    pending: [{id: 'p-1', text: '旧待确认'}],
  }), 'utf8');

  const synergy = await bridge.readSynergySnapshot();
  assert.equal(synergy.mode, 'synergy');
  assert.equal(synergy.available, true);
  assert.equal(synergy.ledgerRevision, 7);
  assert.equal(synergy.milestones.length, 2);
  assert.equal(synergy.milestones[0].blocked, true); // blocked comes first
  assert.deepEqual(synergy.milestones[1].checklist, {total: 2, done: 1});
  assert.deepEqual(synergy.counts, {inReview: 1, blocked: 1, inProgress: 2, todo: 1, pending: 1});

  const qRes = await bridge.enqueuePending({
    text: '顺手把 OAuth token 刷新逻辑抽成共用模块',
    title: '抽取 OAuth token 刷新',
    workspacePath: '/Users/synthetic/app',
  });
  assert.equal(qRes.ok, true);
  const rawQueue = await fs.readFile(path.join(dir, 'taskboard-queue', 'requests.jsonl'), 'utf8');
  const rows = rawQueue.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].action, 'pending');
  assert.equal(rows[0].source, 'dsh-dot');
  assert.equal(rows[0].payload.title, '抽取 OAuth token 刷新');
  assert.equal(rows[0].payload.workspacePath, '/Users/synthetic/app');
});

test('createDailyDigest rhythm extensions configure desktopSummary and suppress tick during quietToday or silent_pull', async () => {
  const store = memoryKeyValueStore();
  let sendCalls = 0;
  const at = new Date('2026-11-15T00:05:00.000Z'); // 08:05 Asia/Shanghai
  const digest = createDailyDigest({
    store,
    readSource: async () => ({items: []}),
    schedule: async () => ({dailyTime: '08:00', timeZone: 'Asia/Shanghai'}),
    summarize: async () => ({output: {items: []}}),
    send: async () => { sendCalls += 1; return {status: 'reported_sent'}; },
    clock: () => at,
  });

  const cfg1 = await digest.configureRhythm({
    dailyTime: '08:00',
    deliveryMode: 'desktop_only',
    maxDailyNudges: 1,
    quietToday: true,
  });
  assert.equal(cfg1.ok, true);
  assert.equal(cfg1.digest.dailyTime, '08:00');
  assert.equal(cfg1.digest.isQuietToday, true);
  assert.equal(digest.desktopSummary().isQuietToday, true);
  assert.equal(await digest.tick(), null);
  assert.equal(sendCalls, 0);

  const cfg2 = await digest.configureRhythm({deliveryMode: 'silent_pull', quietToday: false});
  assert.equal(cfg2.ok, true);
  assert.equal(digest.enabled(), false);
  assert.equal(digest.desktopSummary().deliveryMode, 'silent_pull');
  assert.equal(await digest.tick(), null);
  assert.equal(sendCalls, 0);

  await digest.close();
});

test('registerMuseRoute handles GET/POST actions and enforces Sec-Fetch-Site 403, 413 payload limit, and 400 unknown action', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dot-muse-route-'));
  t.after(() => fs.rm(dir, {recursive: true, force: true}));

  const profile = createPersonalProfile({store: memoryKeyValueStore()});
  const superAgent = createSuperAgentBridge({dshHome: dir});
  const dailyDigest = createDailyDigest({
    store: memoryKeyValueStore(),
    readSource: async () => ({items: []}),
    schedule: async () => ({dailyTime: '09:00', timeZone: 'Asia/Shanghai'}),
    summarize: async () => ({output: {items: []}}),
    send: async () => ({status: 'reported_sent'}),
  });
  t.after(() => dailyDigest.close());

  let registered = null;
  const ctx = {
    get(name) {
      if (name !== 'connection') return null;
      return {fetch: {register(entry) { registered = entry; return () => {}; }}};
    },
    effect() {},
  };

  const controller = createMuseController({personalProfile: profile, dailyDigest, superAgent});
  const stop = registerMuseRoute(ctx, {controller});
  t.after(() => stop?.());
  assert.equal(registered.path, '/api/project_companion/muse');

  // GET snapshot
  const getRes = await registered.fetch(new Request('http://localhost/api/project_companion/muse', {method: 'GET'}));
  assert.equal(getRes.status, 200);
  const snap = await getRes.json();
  assert.equal(snap.ok, true);
  assert.equal(snap.superagent.mode, 'standalone');

  // Sec-Fetch-Site: cross-site -> 403
  const csrfRes = await registered.fetch(new Request('http://localhost/api/project_companion/muse', {
    method: 'POST',
    headers: {'sec-fetch-site': 'cross-site', 'content-type': 'application/json'},
    body: JSON.stringify({action: 'profile_add_note', text: 'xss'}),
  }));
  assert.equal(csrfRes.status, 403);

  // Oversized body > 65536 -> 413
  const bigRes = await registered.fetch(new Request('http://localhost/api/project_companion/muse', {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({action: 'profile_add_note', text: 'x'.repeat(70000)}),
  }));
  assert.equal(bigRes.status, 413);

  // Unknown action -> 400
  const unknownRes = await registered.fetch(new Request('http://localhost/api/project_companion/muse', {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({action: 'no_such_action'}),
  }));
  assert.equal(unknownRes.status, 400);

  // Valid POST note + undo
  const addRes = await registered.fetch(new Request('http://localhost/api/project_companion/muse', {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({action: 'profile_add_note', text: '今天四点去机场'}),
  }));
  assert.equal(addRes.status, 200);
  const added = await addRes.json();
  assert.equal(added.ok, true);
  assert.equal(added.profile.notes[0].text, '今天四点去机场');
  assert.ok(added.undoToken);

  const undoRes = await registered.fetch(new Request('http://localhost/api/project_companion/muse', {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({action: 'profile_undo', token: added.undoToken}),
  }));
  const undone = await undoRes.json();
  assert.equal(undone.ok, true);
  assert.equal(undone.profile.notes.length, 0);
});

test('dotSourceReader projects calendar events and todayProjection attaches events, digest, superagent, and profile', async () => {
  let calendarAllowed = true;
  const reader = createDotSourceReader({
    sources: {
      rowOf: async source => source === 'calendar' ? {source: 'calendar', enabled: true, lastStatus: 'ok', lastReadAt: null} : {source, enabled: false},
      recordRead: async () => {},
    },
    read: async source => {
      assert.equal(source, 'calendar');
      return {
        items: [
          {id: 'ev-1', title: '设计评审会', startAt: '2026-11-15T06:00:00.000Z', endAt: '2026-11-15T07:00:00.000Z', location: 'Zoom', status: 'confirmed'},
          {id: 'ev-2', title: '已取消会议', startAt: '2026-11-15T08:00:00.000Z', status: 'cancelled'},
        ],
      };
    },
    authorized: source => source === 'calendar' && calendarAllowed,
    clock: () => new Date('2026-11-15T01:00:00.000Z'),
  });

  await reader.refreshNow();
  const snap1 = reader.snapshot();
  assert.equal(snap1.events.length, 1);
  assert.equal(snap1.events[0].title, '设计评审会');
  assert.equal(snap1.events[0].location, 'Zoom');

  const today = createTodayProjection({
    sessionLedger: {snapshot: async () => ({revision: 3, counts: {done: 0, wait: 0, stuck: 0, run: 0, total: 0}, sessions: [], projects: []})},
    dotSourceReader: reader,
    workspaceAccess: {capture: async () => ({revision: 'r1', grants: []}), authorizeSync: () => true, assertCurrent: async () => {}},
    links: {list: async () => []},
    readConnection: async () => ({wechat: 'none'}),
    readDigestSummary: () => ({revision: 2, dailyTime: '08:30', isQuietToday: false}),
    readSuperAgent: async () => ({mode: 'standalone', available: false, revision: 1, milestones: []}),
    readPersonalProfile: async () => ({revision: 4, traits: [], notes: []}),
  });

  const projected = await today();
  assert.equal(projected.events.length, 1);
  assert.equal(projected.digest.dailyTime, '08:30');
  assert.equal(projected.superagent.mode, 'standalone');
  assert.equal(projected.profile.revision, 4);

  // Revoking calendar immediately drops events from snapshot.
  calendarAllowed = false;
  assert.deepEqual(reader.snapshot().events, []);
});

test('createMuseIntelligence synthesizes workspaceBrief, redacts secrets, falls back to package.json, caches by revision, and clears on revocation', async t => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'dot-muse-intel-'));
  t.after(() => fs.rm(tmp, {recursive: true, force: true}));

  const projA = await fs.realpath(path.join(tmp, 'alpha-project')).catch(async () => {
    await fs.mkdir(path.join(tmp, 'alpha-project/.agent/memory'), {recursive: true});
    return fs.realpath(path.join(tmp, 'alpha-project'));
  });
  await fs.writeFile(path.join(projA, 'README.md'), '# Alpha Project\n这是一个包含 token sk-secret1234567890abcdef 和 Bearer secret_tok_xyz 的说明文件');
  await fs.writeFile(path.join(projA, '.agent/memory/progress.md'), '# 进展\n- 刚完成核心联调 Bearer supersecret999\n');

  const projB = path.join(tmp, 'beta-pkg');
  await fs.mkdir(projB, {recursive: true});
  const realB = await fs.realpath(projB);
  await fs.writeFile(path.join(realB, 'package.json'), JSON.stringify({name: 'beta-pkg', description: 'Package fallback description for Beta'}));

  let revision = 1;
  let authorized = true;
  let grants = [
    {id: 'ws-a', root: projA, label: 'Alpha', sessionIds: ['s1']},
    {id: 'ws-b', root: realB, label: 'Beta', sessionIds: []},
  ];
  let readCalls = 0;

  const workspaceAccess = {
    async capture() {
      return {revision, grants: authorized ? structuredClone(grants) : []};
    },
    authorizeSync(captured) {
      return authorized && Array.isArray(captured?.grants) && captured.grants.length > 0 && captured.revision === revision;
    },
  };

  const {readProjectFiles} = await import('../src/sources.js');
  const intel = createMuseIntelligence({
    workspaceAccess,
    sessionLedger: {internal: async () => ({sessions: [{root: projA, state: 'doing'}]})},
    readProject: async root => {
      readCalls += 1;
      return readProjectFiles(root);
    },
  });

  const first = await intel.readWorkspaceBrief();
  assert.ok(first);
  assert.equal(first.workspaceCount, 2);
  assert.equal(first.title, '刚读懂你勾选的 2 个工作区');
  assert.equal(first.workspaces[0].statusText, '1 件事在推进');
  assert.equal(first.workspaces[1].summary, 'Package fallback description for Beta');
  assert.doesNotMatch(first.text, /sk-secret|secret_tok|supersecret/);
  assert.equal(readCalls, 2);

  // Caching on unchanged access revision avoids re-reading project files.
  const cached = await intel.readWorkspaceBrief();
  assert.equal(cached.revision, first.revision);
  assert.equal(readCalls, 2);

  // Revocation immediately clears cached brief and returns null.
  authorized = false;
  revision += 1;
  assert.equal(await intel.readWorkspaceBrief(), null);
  assert.equal(intel.peekWorkspaceBrief(), null);
});

test('muse promise drafts integrate profile tone + workspace brief and feed custom draftText into createTodayController dispatch', async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dot-draft-dispatch-')));
  t.after(() => fs.rm(root, {recursive: true, force: true}));

  const intel = createMuseIntelligence({
    workspaceAccess: {async capture() { return {revision: 1, grants: []}; }, authorizeSync() { return true; }},
  });
  const promises = [
    {id: 'prom-1', what: '给 Alpha 对齐上线节奏', whenText: '今天 18:00', source: 'dida', sourceItemId: 'dida-1', from: 'Alpha'},
  ];
  const workspaceBrief = {
    workspaces: [{id: 'ws-a', label: 'Alpha', summary: 'Alpha 核心模块已联调', latestProgress: '刚完成上线清单确认'}],
  };
  const profile = {
    traits: [{id: 't1', category: 'tone', label: '汇报方式', value: '先给结论与下一步'}],
  };

  const smart = intel.readPromiseDrafts({promises, workspaceBrief, profile});
  assert.equal(smart['prom-1'].kind, 'smart');
  assert.match(smart['prom-1'].text, /Alpha/);
  assert.match(smart['prom-1'].text, /先给结论与下一步/);

  const saved = intel.savePromiseDraft({
    promiseId: 'prom-1',
    text: '修改版草稿：周四 18:00 同步最终结论',
    currentPromises: promises,
  });
  assert.equal(saved.ok, true);
  assert.equal(intel.readPromiseDrafts({promises, workspaceBrief, profile})['prom-1'].kind, 'edited');
  assert.equal(intel.getPromiseDraftText('prom-1', promises[0]), '修改版草稿：周四 18:00 同步最终结论');

  const dispatchedPrompts = [];
  const todayCtrl = createTodayController({
    ledger: {
      internal: async () => ({sessions: []}),
      setState: async () => ({changed: true}),
    },
    reader: {snapshot: () => ({promises})},
    promptSession: async () => ({ok: true}),
    createSession: async ({text, sessionId}) => {
      dispatchedPrompts.push({text, sessionId});
      return sessionId;
    },
    readPromiseDraft: (id, row) => intel.getPromiseDraftText(id, row),
    authorizeRoot: async () => true,
    defaultRoot: async () => root,
  });

  const dispatched = await todayCtrl.item({
    action: 'dispatch',
    promiseId: 'prom-1',
    draftText: '最终拍板草稿：请按这版发周报',
  });
  assert.equal(dispatched.ok, true);
  assert.equal(dispatchedPrompts.length, 1);
  assert.match(dispatchedPrompts[0].text, /最终拍板草稿：请按这版发周报/);

  const reset = intel.resetPromiseDraft({promiseId: 'prom-1'});
  assert.equal(reset.ok, true);
  assert.equal(intel.readPromiseDrafts({promises, workspaceBrief, profile})['prom-1'].kind, 'smart');
});

test('createPersonalProfile.forgetMatch handles NOT_FOUND, AMBIGUOUS, single deletion and undoToken latest', async () => {
  let nowMs = Date.parse('2026-11-15T02:00:00.000Z');
  const p = createPersonalProfile({store: memoryKeyValueStore(), clock: () => new Date(nowMs)});
  await p.ready();

  await p.setTrait({category: 'tone', label: '汇报方式', value: '先给结论'});
  await p.addNote({text: '周五下午约牙医复查', category: 'schedule', source: 'agent'});
  await p.addNote({text: '周五上午开月度评审', category: 'schedule', source: 'agent'});

  assert.equal((await p.forgetMatch({query: '完全不存在'})).code, 'NOT_FOUND');
  const ambiguous = await p.forgetMatch({query: '周五'});
  assert.equal(ambiguous.ok, false);
  assert.equal(ambiguous.code, 'AMBIGUOUS');
  assert.equal(ambiguous.candidates.length, 2);

  const deleted = await p.forgetMatch({query: '牙医'});
  assert.equal(deleted.ok, true);
  assert.equal(deleted.profile.notes.length, 1);

  const undone = await p.undo({token: 'latest'});
  assert.equal(undone.ok, true);
  assert.equal(undone.profile.notes.length, 2);
});

test('project_companion apply(ctx) supports profile_remember, profile_forget, look profile, daily rhythm sync, and blocks family sessions', async t => {
  const {Context} = await import('@deepseek-ai/cordis');
  const SystemPrompt = (await import('@deepseek-ai/dsh-system-prompt')).default;
  const ToolRuntime = (await import('@deepseek-ai/dsh-tools')).default;
  const CommandRuntime = (await import('@deepseek-ai/dsh-commands')).default;
  const Storage = (await import('@deepseek-ai/dsh-storage')).default;
  const JsonStorage = await import('@deepseek-ai/dsh-storage-json');
  const StorageDomain = await import('@deepseek-ai/dsh-storage-domain');
  const {default: SessionStore, SessionId} = await import('@deepseek-ai/dsh-session');
  const {installCompanion} = await import('../index.js');

  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dot-profile-host-')));
  await fs.writeFile(path.join(root, 'README.md'), '# Host Profile Test\n');
  const ctx = new Context();
  for (const [plugin, config] of [
    [SystemPrompt, {}],
    [ToolRuntime, {mode: 'native'}],
    [CommandRuntime, undefined],
    [Storage, undefined],
    [JsonStorage, {root: path.join(root, 'storage')}],
    [StorageDomain, {backend: 'json'}],
    [SessionStore, undefined],
  ]) {
    await ctx.plugin(plugin, config);
  }
  const agents = new Map();
  ctx.provide('agents', {get: id => agents.get(id), list: () => [...agents.values()]});
  ctx.provide('workingDirectory', {get: session => session.header.cwd});
  ctx.provide('workspaceRegistry', {list: () => []});
  ctx.provide('connection', {fetch: {register: () => () => {}}});

  const ownerSession = ctx.sessions.create(SessionId('desktop-owner-1'), {meta: {cwd: root}});
  const ownerAgent = {id: ownerSession.id, session: ownerSession, ctx, status: 'idle'};
  agents.set(ownerAgent.id, ownerAgent);

  const familyOwnerSession = ctx.sessions.create(SessionId('family_owner_1'), {meta: {cwd: root}});
  const familyOwnerAgent = {id: familyOwnerSession.id, session: familyOwnerSession, ctx, status: 'idle'};
  agents.set(familyOwnerAgent.id, familyOwnerAgent);

  const familyMemberSession = ctx.sessions.create(SessionId('family_member_1'), {meta: {cwd: root}});
  const familyMemberAgent = {id: familyMemberSession.id, session: familyMemberSession, ctx, status: 'idle'};
  agents.set(familyMemberAgent.id, familyMemberAgent);

  let adapter;
  await ctx.plugin({
    name: 'synthetic-profile-host',
    inject: ['tools', 'commands', 'storageDomain', 'sessions', 'systemPrompt'],
    async apply(scope) {
      adapter = await installCompanion(scope, {
        clock: () => new Date('2026-11-15T01:00:00.000Z'),
        family: {enabled: true},
        readSetup: async () => ({state: 'unbound'}),
        readBinding: async () => null,
        readNativeRoute: async () => ({kind: 'unbound'}),
        context: {readConfig: () => ({}), googlePublisher: null, fetch: async () => { throw new Error('no network'); }},
        timers: {setInterval: () => ({unref() {}}), clearInterval() {}},
      });
    },
  });
  t.after(async () => {
    await ctx.fiber.dispose();
    await fs.rm(root, {recursive: true, force: true});
  });

  let callNum = 0;
  const execTool = async (agent, args) => {
    const res = await ctx.tools.execute({
      callId: `prof-${++callNum}`,
      name: 'project_companion',
      arguments: args,
      agent,
      signal: new AbortController().signal,
    });
    assert.equal(res.isError, false, JSON.stringify(res));
    return res.value;
  };

  // Owner remembers rhythm trait -> syncs to dailyDigest 07:45.
  const rhythm = await execTool(ownerAgent, {
    action: 'manage',
    op: 'profile_remember',
    userRequested: true,
    traitCategory: 'rhythm',
    traitLabel: '读报时间',
    traitValue: '每天 07:45 之前',
  });
  assert.equal(rhythm.status, 'ok', JSON.stringify(rhythm));
  assert.equal(adapter.dailyDigest.desktopSummary().dailyTime, '07:45');

  // Owner remembers casual note -> tagged source: 'agent'.
  const note = await execTool(ownerAgent, {
    action: 'manage',
    op: 'profile_remember',
    userRequested: true,
    noteText: '周三上午要带身份证',
    noteCategory: 'habit',
  });
  assert.equal(note.status, 'ok', JSON.stringify(note));
  assert.equal(note.profile.notes[0].source, 'agent');

  // Owner looks at profile view.
  const looked = await execTool(ownerAgent, {action: 'look', view: 'profile'});
  assert.equal(looked.status, 'ok');
  assert.match(looked.text, /读报时间/);
  assert.match(looked.text, /带身份证/);

  // Owner forgets latest via undoToken: 'latest'.
  const undone = await execTool(ownerAgent, {
    action: 'manage',
    op: 'profile_forget',
    userRequested: true,
    undoToken: 'latest',
  });
  assert.equal(undone.status, 'ok', JSON.stringify(undone));
  assert.equal(undone.profile.notes.length, 0);

  // Family owner and family member sessions are both strictly blocked.
  for (const familyAgent of [familyOwnerAgent, familyMemberAgent]) {
    const blockedView = await execTool(familyAgent, {action: 'look', view: 'profile'});
    assert.equal(blockedView.status, 'blocked');
    assert.equal(blockedView.profile, undefined);

    const blockedWrite = await execTool(familyAgent, {
      action: 'manage',
      op: 'profile_remember',
      userRequested: true,
      noteText: '不该写入家庭会话',
    });
    assert.equal(blockedWrite.status, 'blocked');
    assert.equal(blockedWrite.accepted ?? false, false);
  }
  assert.equal((await adapter.personalProfile.snapshot()).notes.length, 0);
});

test('museIntelligence detects stale resolved project memories and controller supports archive vs keep dismissal', async () => {
  const {createMuseIntelligence} = await import('../src/muse-intelligence.js');
  const {createMuseController} = await import('../src/muse-route.js');
  const {createPersonalProfile} = await import('../src/personal-profile.js');

  const grants = [{id: 'ws-pay', root: '/tmp/ws-pay', label: 'PayProject', revision: 1, sessionIds: []}];
  const entries = [
    {
      id: 'mem-stale-1',
      kind: 'blocker',
      text: '支付回调签名校验异常导致异步通知失败',
      at: '2026-11-15T08:00:00.000Z',
    },
    {
      id: 'mem-fresh-2',
      kind: 'blocker',
      text: '需要评估全新的国际化字体方案',
      at: '2026-11-16T08:00:00.000Z',
    },
  ];
  let archivedCalls = [];

  const intel = createMuseIntelligence({
    workspaceAccess: {
      capture: async () => ({revision: 1, grants}),
      authorizeSync: () => true,
    },
    readProject: async () => [
      {path: '.agent/memory/progress.md', status: 'ok', text: '- 已完成：修复支付回调签名校验异常，测试全绿\n'},
    ],
    inspectProjectMemory: async () => ({goals: [], entries: [...entries]}),
  });

  const profile = createPersonalProfile();
  const controller = createMuseController({
    personalProfile: profile,
    museIntelligence: intel,
    archiveProjectMemory: async ({projectRoot, memoryId}) => {
      archivedCalls.push({projectRoot, memoryId});
      const idx = entries.findIndex(e => e.id === memoryId);
      if (idx >= 0) entries.splice(idx, 1);
    },
  });

  const snap1 = await controller.snapshot();
  assert.equal(snap1.staleProjectMemories.length, 1);
  assert.equal(snap1.staleProjectMemories[0].id, 'mem-stale-1');
  assert.match(snap1.staleProjectMemories[0].reason, /progress\.md/);

  const keepRes = await controller.act({
    action: 'project_memory_keep_stale',
    projectRoot: '/tmp/ws-pay',
    memoryId: 'mem-stale-1',
  });
  assert.equal(keepRes.ok, true);
  assert.equal(keepRes.staleProjectMemories.length, 0);

  // Fresh intel checks archive path.
  const intel2 = createMuseIntelligence({
    workspaceAccess: {capture: async () => ({revision: 2, grants}), authorizeSync: () => true},
    readProject: async () => [{path: '.agent/memory/progress.md', status: 'ok', text: '- 已收口：支付回调签名校验异常'}],
    inspectProjectMemory: async () => ({goals: [], entries}),
  });
  const controller2 = createMuseController({
    personalProfile: profile,
    museIntelligence: intel2,
    archiveProjectMemory: async ({projectRoot, memoryId}) => {
      archivedCalls.push({projectRoot, memoryId});
      const idx = entries.findIndex(e => e.id === memoryId);
      if (idx >= 0) entries.splice(idx, 1);
    },
  });
  const arcRes = await controller2.act({
    action: 'project_memory_archive_stale',
    projectRoot: '/tmp/ws-pay',
    memoryId: 'mem-stale-1',
  });
  assert.equal(arcRes.ok, true);
  assert.equal(archivedCalls.length, 1);
  assert.deepEqual(archivedCalls[0], {projectRoot: '/tmp/ws-pay', memoryId: 'mem-stale-1'});
  assert.equal(arcRes.staleProjectMemories.length, 0);
});
