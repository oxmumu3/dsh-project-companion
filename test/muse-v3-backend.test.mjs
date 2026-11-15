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
