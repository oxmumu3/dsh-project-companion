import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createMobileCompanion } from '../src/mobile-companion.js';

const nowIso = '2026-11-19T15:00:00.000Z';

async function fixture(t, options) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dot-mobile-v10-'));
  t.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));
  async function open() {
    const companion = createMobileCompanion({
      stateDir,
      port: 0,
      host: '127.0.0.1',
      autoStart: false,
      embeddedServer: true,
      allowLoopbackProbe: false,
      ...options,
    });
    t.after(() => companion.dispose());
    const { port } = await companion.ensureStarted();
    const base = `http://127.0.0.1:${port}`;
    const { pair } = await companion.pairInfo();
    const paired = await fetch(`${base}/api/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: pair.pin }),
    }).then((res) => res.json());
    function request(route, body, token = paired.token) {
      return fetch(`${base}${route}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    }
    return { companion, request, paired };
  }
  return { open, ...(await open()) };
}

test('v10 snapshot orders active native sessions and preserves full documents and older wire fields', async (t) => {
  const artifactMarkdown = '# 项目说明\n\n' + '- 完整的正文 **第二节**\n'.repeat(100);
  const { paired } = await fixture(t, {
    readLiveState: async () => ({
      sessions: [
        { id: 'quiet', state: 'watching', title: '跟进事项', projectLabel: 'Writing', updatedAt: nowIso },
        { id: 'doc', state: 'done', title: '工作计划', artifactMarkdown, updatedAt: nowIso },
        { id: 'closed', state: 'handled', title: '已结束', updatedAt: nowIso },
        { id: 'run', state: 'doing', title: '进行中', updatedAt: nowIso },
        { id: 'wait-old', state: 'needs_you', title: '更早拍板', updatedAt: '2026-11-18T15:00:00.000Z' },
        {
          id: 'wait',
          state: 'stuck',
          title: '电脑同源 电脑原有 主会话新建 分身',
          workspaceTitle: 'Finvo',
          checklist: [{ id: 'a', text: '准备发票', checked: true }, { id: 'b', text: '核对总额', checked: false }],
          updatedAt: nowIso,
        },
      ],
      scheduleItems: [{ id: 'meeting', timeLabel: '15:00', title: '评审', source: 'calendar' }],
      routines: [{ id: 'morning', title: '晨间简报', lastReceipt: '08:30 已发送' }],
    }),
  });
  const { snapshot } = paired;
  assert.deepEqual(snapshot.carouselCards.map(({ id }) => id), ['wait', 'wait-old', 'run', 'doc', 'quiet']);
  assert.equal(snapshot.todayFocus.id, 'wait');
  assert.equal(snapshot.todayFocus.dossierId, 'wait');
  assert.equal(snapshot.todayFocus.draftSlip, '');
  assert.equal(snapshot.todayFocus.statusLabel, '待你拍板');
  assert.equal(snapshot.todayFocus.workspaceTitle, 'Finvo');
  assert.equal(snapshot.todayFocus.progress, 0.5);
  assert.equal(snapshot.todayFocus.artifactKind, 'todo');
  assert.equal(snapshot.dossiers.find(({ id }) => id === 'doc').artifactMarkdown, artifactMarkdown);
  assert.equal(snapshot.dossiers.find(({ id }) => id === 'doc').statusLabel, '成稿就绪');
  assert.equal(snapshot.dossiers.find(({ id }) => id === 'closed').archived, true);
  assert.equal(snapshot.dossiers.find(({ id }) => id === 'closed').statusLabel, '已办妥');
  assert.equal(snapshot.dossiers.find(({ id }) => id === 'quiet').artifactKind, 'none');
  assert.equal(snapshot.dossiers.find(({ id }) => id === 'quiet').workspaceTitle, 'Writing');
  assert.equal(snapshot.scheduleItems.find(({ id }) => id === 'meeting').sourceLabel, '日历');
  assert.equal(snapshot.routines[0].lastReceipt, '08:30 已发送');
  assert.deepEqual(snapshot.messages, []);
  assert.deepEqual(snapshot.reminders, []);
  assert.doesNotMatch(JSON.stringify(snapshot), /电脑同源|电脑原有|主会话新建|分身/);
});

test('v10 reminders persist, reject stale undo, and restore on single use', async (t) => {
  let clock = new Date(nowIso);
  const { companion, request, open } = await fixture(t, { clock: () => clock });
  const add = await (await request('/api/reminders', {
    action: 'add', text: '购买牛奶', timeLabel: '17:00', sourceLabel: '随记', eventKitIdentifier: 'event-kit-1',
  })).json();
  const [reminder] = add.snapshot.reminders;
  assert.deepEqual(reminder, {
    id: reminder.id, timeLabel: '17:00', text: '购买牛奶', sourceLabel: '随记', done: false, eventKitIdentifier: 'event-kit-1',
  });
  assert.deepEqual(add.snapshot.dossiers, []);
  const toggle = await (await request('/api/reminders', { action: 'toggle', id: reminder.id })).json();
  assert.equal(toggle.snapshot.reminders[0].done, true);
  assert.ok(toggle.undoToken);
  clock = new Date(Date.parse(nowIso) + 11_999);
  const undo = await (await request('/api/undo', { undoToken: toggle.undoToken })).json();
  assert.equal(undo.snapshot.reminders[0].done, false);
  assert.equal((await request('/api/undo', { undoToken: toggle.undoToken })).status, 409);
  await companion.dispose();
  const { request: restarted } = await open();
  assert.deepEqual((await (await restarted('/api/bootstrap')).json()).snapshot.reminders, [reminder]);
  const remove = await (await restarted('/api/reminders', { action: 'remove', id: reminder.id })).json();
  assert.deepEqual(remove.snapshot.reminders, []);
  clock = new Date(clock.getTime() + 12_000);
  assert.equal((await restarted('/api/undo', { undoToken: remove.undoToken })).status, 409);
});

test('v10 streams main and native session conversations with isolated history and archives through the ledger', async (t) => {
  const sessions = [{
    id: 'session-1', state: 'doing', title: '写周报', updatedAt: nowIso, messages: [],
    checklist: [{ id: 'step-1', text: '整理事项', checked: false }],
  }];
  const calls = [];
  const { request } = await fixture(t, {
    readLiveState: async () => ({ sessions }),
    onDossierAct({ id, action, previous, itemId, checked }) {
      calls.push({ id, action, previous });
      if (action === 'toggle_checklist') {
        assert.equal(itemId, 'step-1');
        assert.equal(checked, true);
        sessions[0].checklist[0].checked = checked;
        return { ok: true };
      }
      const before = sessions[0].state;
      sessions[0].state = action === 'undo' ? previous : action === 'complete' ? 'handled' : 'doing';
      return { ok: true, undoState: before };
    },
    async onStreamChat({ sessionId, text, messages, onEvent }) {
      onEvent({ type: 'text_delta', delta: `确认：${text}` });
      if (sessionId) {
        assert.deepEqual(messages, sessions[0].messages);
        sessions[0].messages = [
          ...messages,
          { id: 'u1', role: 'user', text, createdAt: nowIso },
          { id: 'a1', role: 'assistant', text: '只在周报里', createdAt: nowIso },
        ];
        sessions[0].artifactMarkdown = '# 完整周报\n\n新的内容';
        return { reply: '只在周报里' };
      }
      assert.ok(messages.every((m) => m.text !== '只在周报里'));
      return { reply: '只在主会话里' };
    },
  });
  const widget = await (await request('/api/widgets/act', {
    action: 'checklist_toggle', dossierId: 'session-1', itemId: 'step-1',
  })).json();
  assert.equal(widget.dossier.checklist[0].checked, true);
  assert.equal(widget.dossier.progress, 1);
  assert.equal((await request('/api/chat/stream', { sessionId: 'missing', text: '写周报' })).status, 404);
  const sessionStream = await request('/api/chat/stream', { sessionId: 'session-1', text: '继续写' });
  assert.match(sessionStream.headers.get('content-type'), /ndjson/);
  const sessionChunks = (await sessionStream.text()).trim().split('\n').map(JSON.parse);
  assert.deepEqual(sessionChunks.map(({ type }) => type), ['ack', 'text_delta', 'done']);
  const sessionDone = sessionChunks.at(-1);
  assert.equal(sessionDone.sessionId, 'session-1');
  assert.equal(sessionDone.dossier.artifactMarkdown, '# 完整周报\n\n新的内容');
  assert.deepEqual(sessionDone.snapshot.messages, []);
  const detail = await (await request('/api/sessions/session-1')).json();
  assert.equal(detail.messages.at(-1).text, '只在周报里');
  const main = (await (await request('/api/chat/stream', { text: '工作安排是什么？' })).text()).trim().split('\n').map(JSON.parse).at(-1);
  assert.deepEqual(main.snapshot.messages.map(({ text }) => text), ['工作安排是什么？', '只在主会话里']);
  assert.equal(main.snapshot.dossiers.length, 1);
  const complete = await (await request('/api/dossiers/session-1/act', { action: 'complete' })).json();
  assert.equal(complete.snapshot.dossiers[0].archived, true);
  assert.equal(complete.snapshot.todayFocus, null);
  assert.equal(complete.undoState, undefined);
  const undo = await (await request('/api/undo', { undoToken: complete.undoToken })).json();
  assert.equal(undo.snapshot.dossiers[0].status, 'run');
  assert.deepEqual(calls.map(({ action }) => action), ['toggle_checklist', 'complete', 'undo']);
});

test('v10 EventKit sync deduplicates reminders by identifier and revocation clears the synced data and undo', async (t) => {
  const { companion, request } = await fixture(t, {});
  assert.deepEqual((await companion.summary()).iphoneSystem, []);
  const add = await (await request('/api/reminders', {
    action: 'add', text: '发票', sourceLabel: '随记', eventKitIdentifier: 'native-reminder-1',
  })).json();
  const sync = await (await request('/api/apple/sync', {
    permissions: { calendar: true, reminders: true },
    events: [{ id: 'native-calendar-1', timeLabel: '15:00', title: '评审' }],
    reminders: [{ id: 'native-reminder-1', dueLabel: '17:00', title: '发票' }],
  })).json();
  assert.deepEqual(sync.snapshot.reminders, [{
    id: add.reminder.id, text: '发票', sourceLabel: '随记', done: false,
    eventKitIdentifier: 'native-reminder-1', timeLabel: '17:00',
  }]);
  assert.equal(sync.snapshot.scheduleItems[0].sourceLabel, '日历');
  assert.deepEqual((await companion.summary()).iphoneSystem, [{
    id: 'ios_eventkit', connected: true, enabled: true, statusText: '日历与提醒已授权',
  }]);
  const toggled = await (await request('/api/reminders', { action: 'toggle', id: add.reminder.id })).json();
  assert.ok(toggled.undoToken);
  const revoked = await (await request('/api/apple/sync', { permissions: { calendar: false, reminders: false } })).json();
  assert.deepEqual(revoked.snapshot.reminders, []);
  assert.deepEqual(revoked.snapshot.scheduleItems, []);
  assert.equal((await request('/api/undo', { undoToken: toggled.undoToken })).status, 409);
  assert.equal((await companion.summary()).iphoneSystem[0].statusText, '日历与提醒未授权');
});

test('v10 connector updates enforce existing authorization and broadcast a fresh snapshot', async (t) => {
  const calls = [];
  const connector = { id: 'flomo', connected: true, enabled: false, canToggle: true, statusText: '已暂停' };
  const { request } = await fixture(t, {
    readLiveState: async () => ({ connectors: {
      connectors: [connector, { id: 'google_suite', connected: false, enabled: false, canToggle: false }],
      contextMode: 'curated_only',
      mountedWorkspaces: ['Agent'],
    } }),
    onToggleConnector: async (input) => {
      calls.push(input);
      connector.enabled = input.enabled;
      connector.statusText = '已授权';
      return { ok: true };
    },
  });
  assert.equal((await request('/api/connectors', undefined, '')).status, 401);
  const before = await (await request('/api/connectors')).json();
  assert.deepEqual(before.connectors.map(({ id }) => id), ['mac_bridge', 'workspace_grants', 'google_suite', 'flomo', 'dida', 'wechat']);
  assert.deepEqual(before.mountedWorkspaces, ['Agent']);
  assert.equal(before.totalCount, 6);
  assert.equal((await request('/api/connectors/toggle', { id: 'google_suite', enabled: true })).status, 403);
  assert.equal((await request('/api/connectors/toggle', { id: 'ios_health', enabled: true })).status, 404);
  const stream = await request('/api/events');
  const reader = stream.body.getReader();
  t.after(() => reader.cancel().catch(() => {}));
  await reader.read();
  const update = await (await request('/api/connectors/toggle', { id: 'flomo', enabled: true })).json();
  const event = new TextDecoder().decode((await reader.read()).value);
  assert.ok(event.startsWith('event: snapshot\n'));
  assert.equal(JSON.parse(event.split('\n')[1].slice(6)).connectors.find(({ id }) => id === 'flomo').enabled, true);
  assert.equal(update.snapshot.connectors.find(({ id }) => id === 'flomo').statusText, '已授权');
  assert.deepEqual(calls, [{ id: 'flomo', enabled: true }]);
  await reader.cancel();
});

test('v10 memory mutations preserve provenance, mirror compatibility fields, and restore archived memory', async (t) => {
  const { request } = await fixture(t, {});
  const add = await (await request('/api/memory/items', {
    text: '先发英文版', category: 'preference', sourceKind: 'chat', provenance: '11/18 邮件编辑', effect: '邮件草稿',
  })).json();
  const [memory] = add.snapshot.memoryItems;
  assert.equal(memory.sourceKind, 'chat');
  assert.equal(memory.provenance, '11/18 邮件编辑');
  assert.equal(memory.effect, '邮件草稿');
  assert.equal(add.snapshot.traits[0].id, memory.id);
  const off = await (await request('/api/memory/items', { id: memory.id, active: false })).json();
  assert.equal(off.snapshot.memoryItems[0].active, false);
  assert.equal(off.snapshot.traits[0].active, false);
  const remove = await (await request('/api/memory/items', { id: memory.id, remove: true })).json();
  assert.deepEqual(remove.snapshot.memoryItems, []);
  const restore = await (await request('/api/undo', { undoToken: remove.undoToken })).json();
  assert.deepEqual(restore.snapshot.memoryItems, off.snapshot.memoryItems);
});
