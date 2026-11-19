import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {buildMuseViewModel} from '../client/muse/muse-model.js';

let loadedMuseViews;
async function loadMuseViews(t) {
  if (loadedMuseViews) return loadedMuseViews;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dot-muse-views-'));
  t.after(() => fs.rm(dir, {recursive: true, force: true}));
  const outfile = path.join(dir, 'muse-views.cjs');
  await build({
    absWorkingDir: fileURLToPath(new URL('../', import.meta.url)),
    entryPoints: ['client/muse/muse-views.jsx'],
    outfile,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node20',
    logLevel: 'error',
  });
  loadedMuseViews = createRequire(import.meta.url)(outfile);
  return loadedMuseViews;
}

function runtime() {
  const stack = [];
  const React = {
    createElement: (type, props, ...children) => ({
      type,
      props: props ?? {},
      children: children.flat(Infinity).filter(c => c !== null && c !== undefined && c !== false && c !== true),
    }),
    useState: initial => {
      const frame = stack.at(-1);
      const index = frame.cursor++;
      if (!(index in frame.slots)) frame.slots[index] = typeof initial === 'function' ? initial() : initial;
      return [
        frame.slots[index],
        next => { frame.slots[index] = typeof next === 'function' ? next(frame.slots[index]) : next; },
      ];
    },
    useRef: initial => {
      const frame = stack.at(-1);
      const index = frame.cursor++;
      if (!(index in frame.slots)) frame.slots[index] = {current: initial};
      return frame.slots[index];
    },
    useEffect: () => {},
    useMemo: fn => fn(),
  };
  const expand = node => {
    if (node === null || node === undefined || typeof node === 'boolean') return null;
    if (typeof node === 'string' || typeof node === 'number') return node;
    if (Array.isArray(node)) return node.map(expand).flat(Infinity).filter(x => x !== null);
    if (typeof node.type === 'function') {
      const frame = {cursor: 0, slots: []};
      stack.push(frame);
      try { return expand(node.type(node.props)); } finally { stack.pop(); }
    }
    return {
      ...node,
      children: (node.children ?? []).map(expand).flat(Infinity).filter(x => x !== null),
    };
  };
  return {React, expand};
}

const walk = (node, out = []) => {
  if (!node || typeof node !== 'object') return out;
  out.push(node);
  for (const child of node.children ?? []) walk(child, out);
  return out;
};
const findAll = (tree, predicate) => walk(tree).filter(predicate);
const hasClass = (node, cls) => typeof node?.props?.className === 'string' && node.props.className.split(/\s+/).includes(cls);
const allText = node => {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (!node || typeof node !== 'object') return '';
  return (node.children ?? []).map(allText).join(' ');
};

function sampleActivity(mode = 'standalone') {
  return {
    reachable: true,
    revision: 12,
    counts: {done: 1, wait: 1, stuck: 1, run: 1, total: 3},
    sessions: [
      {
        sessionId: 'sess-stuck',
        projectId: 'proj-alpha',
        projectName: 'Alpha App',
        state: 'stuck',
        title: 'API 测试缺少 Key',
        what: '需要确认测试环境变量',
        at: '2026-11-15T01:00:00.000Z',
        cardId: 'card-1',
        primary: '授权继续',
        primaryAct: 'approve',
      },
      {
        sessionId: 'sess-wait',
        projectId: 'proj-beta',
        projectName: 'Beta Docs',
        state: 'needs_you',
        title: '确认发布说明',
        what: '请你拍板发不发',
        at: '2026-11-15T01:10:00.000Z',
        cardId: 'card-2',
        primary: '同意方案',
        primaryAct: 'approve',
      },
    ],
    projects: [
      {projectId: 'proj-alpha', projectName: 'Alpha App', activeCount: 1, doneCount: 1, updatedAt: '2026-11-15T01:00:00.000Z'},
    ],
    promises: [
      {id: 'prom-1', what: '回复张工报价确认邮件', from: 'Gmail', when: '2026-11-15T05:00:00.000Z', whenText: '今天 13:00', dispatch: true},
    ],
    events: [
      {id: 'ev-1', title: '产品周会', startAt: '2026-11-15T02:00:00.000Z', endAt: '2026-11-15T03:00:00.000Z', location: '3F 会议室'},
      {id: 'ev-2', title: '全天休假预留', allDay: true},
    ],
    sources: [{id: 'gmail', name: 'Gmail', enabled: true, state: 'ok'}],
    connection: {wechat: 'bound'},
    digest: {enabled: true, dailyTime: '09:00', timeZone: 'Asia/Shanghai', deliveryMode: 'wechat_and_desktop', maxDailyNudges: 2, isQuietToday: false},
    profile: {
      revision: 3,
      traits: [
        {id: 't1', category: 'tone', label: '汇报方式', value: '先给结论再附依据'},
      ],
      notes: [
        {id: 'n1', text: '下午三点去高铁站', source: 'desktop', createdAt: '2026-11-15T00:00:00.000Z'},
      ],
    },
    superagent: mode === 'synergy'
      ? {
        mode: 'synergy',
        available: true,
        milestones: [
          {id: 'ms-1', title: '验收登录重构', blocked: false, summary: 'PR #12 待验收'},
        ],
      }
      : {mode: 'standalone', available: false, milestones: []},
  };
}

test('buildMuseViewModel keeps strictly one focus candidate, supports pin swap, dual-mode, traitGroups, threads, and events', () => {
  const now = new Date('2026-11-15T01:30:00.000Z');
  const standalone = buildMuseViewModel({activity: sampleActivity('standalone'), now});
  assert.equal(standalone.mode, 'standalone');
  assert.equal(standalone.focus.key, 'session:proj-beta:card-2');
  assert.ok(standalone.folded.length >= 2);
  assert.equal(standalone.events.length, 2);
  assert.equal(standalone.events[1].timeText, '全天');
  assert.match(standalone.events[0].timeText, /–/);

  // Pinning a folded item swaps it into the single focus slot.
  const swapped = buildMuseViewModel({
    activity: sampleActivity('standalone'),
    now,
    pinnedKey: 'promise:prom-1',
  });
  assert.equal(swapped.focus.key, 'promise:prom-1');
  assert.ok(swapped.folded.some(item => item.key === 'session:proj-beta:card-2'));

  // Synergy mode includes SuperAgent milestones in folded/focus and threads.
  const synergy = buildMuseViewModel({activity: sampleActivity('synergy'), now});
  assert.equal(synergy.mode, 'synergy');
  assert.ok(synergy.folded.some(item => item.key === 'milestone:ms-1'));
  assert.ok(synergy.threads.some(item => item.group === 'attention'));
  assert.ok(synergy.threads.some(item => item.group === 'workspace'));
  assert.ok(synergy.threads.some(item => item.group === 'memory'));
  assert.equal(synergy.traitGroups.find(g => g.category === 'tone').items.length, 1);
});

test('createMuseViews renders 4 tabs, <= 1 .muse-focus-card, IME guard, rhythm controls, and synergy-only kanban action', async t => {
  const {createMuseViews} = await loadMuseViews(t);
  const now = new Date('2026-11-15T01:30:00.000Z');
  const standaloneModel = buildMuseViewModel({activity: sampleActivity('standalone'), now});
  const synergyModel = buildMuseViewModel({activity: sampleActivity('synergy'), now});

  // Render Today in standalone mode: verify 4 tabs & strictly 1 focus card & no kanban button in capsule.
  const sent = [];
  const museCalls = [];
  {
    const {React, expand} = runtime();
    const {MuseWorkbench} = createMuseViews(React);
    const tree = expand(React.createElement(MuseWorkbench, {
      model: standaloneModel,
      tab: 'today',
      capsuleDraft: '一条测试指令',
      onSendChat: text => sent.push(text),
      onMuseAct: payload => museCalls.push(payload),
    }));
    const tabs = findAll(tree, n => n?.type === 'button' && typeof n.props?.['data-muse-tab'] === 'string');
    assert.equal(tabs.length, 4);
    assert.deepEqual(tabs.map(t => allText(t).trim()), ['今天', '脉络', '记忆', '连接']);

    const focusCards = findAll(tree, n => hasClass(n, 'muse-focus-card'));
    assert.equal(focusCards.length, 1);

    // Capsule IME composing guard must NOT submit on Enter.
    const capInput = findAll(tree, n => n?.type === 'input' && n.props?.['data-muse-capsule-input'])[0];
    assert.ok(capInput);
    let prevented = false;
    capInput.props.onKeyDown({key: 'Enter', shiftKey: false, keyCode: 229, nativeEvent: {isComposing: true}, preventDefault: () => { prevented = true; }});
    assert.equal(sent.length, 0);
    assert.equal(prevented, false);

    capInput.props.onKeyDown({key: 'Enter', shiftKey: false, keyCode: 13, nativeEvent: {isComposing: false}, preventDefault: () => { prevented = true; }});
    assert.deepEqual(sent, ['一条测试指令']);
    assert.equal(prevented, true);

    // Standalone mode must NOT show "入看板" in Capsule.
    assert.equal(findAll(tree, n => n.props?.['data-muse-queue-pending']).length, 0);
  }

  // Render Synergy mode Capsule & verify "入看板" button appears.
  {
    const {React, expand} = runtime();
    const {MuseWorkbench} = createMuseViews(React);
    const tree = expand(React.createElement(MuseWorkbench, {
      model: synergyModel,
      tab: 'today',
      capsuleDraft: '帮我加到看板',
      onMuseAct: payload => museCalls.push(payload),
    }));
    assert.equal(findAll(tree, n => n.props?.['data-muse-queue-pending']).length, 1);
  }

  // Render Connections tab and change rhythm <select>.
  {
    const {React, expand} = runtime();
    const {MuseWorkbench} = createMuseViews(React);
    const tree = expand(React.createElement(MuseWorkbench, {
      model: standaloneModel,
      tab: 'connections',
      onMuseAct: payload => museCalls.push(payload),
    }));
    const timeSelect = findAll(tree, n => n?.type === 'select' && n.props?.['data-muse-rhythm-time'])[0];
    assert.ok(timeSelect);
    timeSelect.props.onChange({target: {value: '08:00'}});
    assert.deepEqual(museCalls.at(-1), {action: 'rhythm_configure', dailyTime: '08:00'});
  }

  // Render Memory tab and verify note input IME guard.
  {
    const {React, expand} = runtime();
    const {MuseWorkbench} = createMuseViews(React);
    const tree = expand(React.createElement(MuseWorkbench, {
      model: standaloneModel,
      tab: 'memory',
      onMuseAct: payload => museCalls.push(payload),
    }));
    const noteInput = findAll(tree, n => n?.type === 'input' && n.props?.['data-muse-note-input'])[0];
    assert.ok(noteInput);
    const before = museCalls.length;
    noteInput.props.onKeyDown({key: 'Enter', shiftKey: false, keyCode: 229, nativeEvent: {isComposing: true}, preventDefault: () => {}});
    assert.equal(museCalls.length, before);
  }
});

test('muse.css uses --dot-* semantic tokens without raw hex/rgb, uses @container muse, and uses two-level button selectors', async () => {
  const css = await fs.readFile(new URL('../client/muse/muse.css', import.meta.url), 'utf8');
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(noComments), false, 'muse.css must not hardcode hex colors');
  assert.equal(/\brgba?\s*\(/.test(noComments), false, 'muse.css must not hardcode rgb()/rgba() colors');
  assert.match(noComments, /container-type:\s*inline-size;/);
  assert.match(noComments, /container-name:\s*muse;/);
  assert.match(noComments, /@container\s+muse\s*\(\s*max-width:\s*740px\s*\)/);
  assert.match(noComments, /\.pc_dot_muse\s+\.muse-btn-primary\b/);
  assert.match(noComments, /\.pc_dot_muse\s+\.muse-nav-btn\b/);
});

test('buildMuseViewModel & MuseTodayView support Half-Step 1 editable draft slip with Escape cancel and onSaveDraft', async t => {
  const {createMuseViews} = await loadMuseViews(t);

  const model = buildMuseViewModel({
    activity: {
      access: {count: 1, workspaces: [{id: 'ws-1', label: 'Alpha'}]},
      workspaceBrief: {
        title: '刚读懂你勾选的 1 个工作区',
        text: '• Alpha（刚关注的工作区）：核心服务已联调',
        workspaces: [{id: 'ws-1', label: 'Alpha', summary: '核心服务已联调', statusText: '刚关注的工作区'}],
      },
      promises: [
        {id: 'prom-1', what: '给 Alpha 发本周进度同步', whenText: '今天 18:00', source: 'dida', status: 'open'},
      ],
      promiseDrafts: {
        'prom-1': {
          promiseId: 'prom-1',
          text: '【拟办草稿】围绕「给 Alpha 发本周进度同步」先把本周结论发出来。',
          kind: 'smart',
        },
      },
      sessions: [],
      events: [],
    },
    muse: {
      superagent: {mode: 'standalone', milestones: []},
      profile: {traits: [{id: 't1', category: 'tone', label: '汇报方式', value: '先给结论'}], notes: []},
    },
  });

  assert.equal(model.focus.kind, 'promise');
  assert.equal(model.focus.editableDraft, true);
  assert.match(model.focus.draftSlip, /先把本周结论发出来/);
  assert.equal(model.focus.primaryAction.type, 'dispatch_promise');
  assert.equal(model.focus.primaryAction.promiseId, 'prom-1');
  assert.equal(model.focus.primaryAction.draftText, model.focus.draftSlip);

  // Stateful React test harness preserving component hook slots across re-renders.
  const hookStore = new Map();
  const stack = [];
  const React = {
    createElement: (type, props, ...children) => ({
      type,
      props: props ?? {},
      children: children.flat(Infinity).filter(c => c !== null && c !== undefined && c !== false && c !== true),
    }),
    useState: initial => {
      const frame = stack.at(-1);
      const index = frame.cursor++;
      if (!(index in frame.slots)) frame.slots[index] = typeof initial === 'function' ? initial() : initial;
      return [
        frame.slots[index],
        next => { frame.slots[index] = typeof next === 'function' ? next(frame.slots[index]) : next; },
      ];
    },
    useRef: initial => {
      const frame = stack.at(-1);
      const index = frame.cursor++;
      if (!(index in frame.slots)) frame.slots[index] = {current: initial};
      return frame.slots[index];
    },
    useEffect: () => {},
    useMemo: fn => fn(),
  };
  const expand = (node, keyPath = 'root') => {
    if (node === null || node === undefined || typeof node === 'boolean') return null;
    if (typeof node === 'string' || typeof node === 'number') return node;
    if (Array.isArray(node)) return node.map((item, i) => expand(item, `${keyPath}[${i}]`)).flat(Infinity).filter(x => x !== null);
    if (typeof node.type === 'function') {
      const id = `${keyPath}:${node.type.name || 'fn'}`;
      let slots = hookStore.get(id);
      if (!slots) { slots = []; hookStore.set(id, slots); }
      stack.push({cursor: 0, slots});
      try { return expand(node.type(node.props), id); } finally { stack.pop(); }
    }
    return {
      ...node,
      children: (node.children ?? []).map((c, i) => expand(c, `${keyPath}.${i}`)).flat(Infinity).filter(x => x !== null),
    };
  };
  const findAll = (tree, pred, acc = []) => {
    if (!tree || typeof tree !== 'object') return acc;
    if (Array.isArray(tree)) { for (const x of tree) findAll(x, pred, acc); return acc; }
    if (pred(tree)) acc.push(tree);
    for (const c of tree.children ?? []) findAll(c, pred, acc);
    return acc;
  };
  const findProp = (tree, prop) => findAll(tree, n => n.props && prop in n.props && n.props[prop] !== false && n.props[prop] !== undefined);

  const {MuseTodayView} = createMuseViews(React);
  const savedCalls = [];
  const renderToday = () => expand(React.createElement(MuseTodayView, {
    model,
    busy: false,
    onAction: async () => {},
    onSaveDraft: async (focusItem, nextText) => { savedCalls.push({promiseId: focusItem.promiseId, nextText}); },
    onPinFocus: () => {},
    onAsk: () => {},
    onOpenProject: () => {},
    onOpenWorkspacePicker: () => {},
    onOpenTab: () => {},
  }));

  let tree = renderToday();
  assert.equal(findProp(tree, 'data-muse-draft-slip').length, 1);
  assert.equal(findProp(tree, 'data-muse-draft-editor').length, 0);

  // Click [改两句] -> editor opens.
  const editBtn = findProp(tree, 'data-muse-draft-edit')[0];
  assert.ok(editBtn);
  editBtn.props.onClick();
  tree = renderToday();
  const editor = findProp(tree, 'data-muse-draft-editor')[0];
  assert.ok(editor);

  // Change text then press Escape -> cancels cleanly without saving.
  editor.props.onChange({target: {value: '临时改动未保存'}});
  let prevented = false;
  editor.props.onKeyDown({key: 'Escape', preventDefault() { prevented = true; }});
  assert.equal(prevented, true);
  tree = renderToday();
  assert.equal(findProp(tree, 'data-muse-draft-editor').length, 0);
  assert.equal(savedCalls.length, 0);

  // Re-open editor, update draft, and save.
  findProp(tree, 'data-muse-draft-edit')[0].props.onClick();
  tree = renderToday();
  findProp(tree, 'data-muse-draft-editor')[0].props.onChange({target: {value: '正式定稿草稿'}});
  tree = renderToday();
  await findProp(tree, 'data-muse-draft-save')[0].props.onClick();
  tree = renderToday();
  assert.equal(savedCalls.length, 1);
  assert.deepEqual(savedCalls[0], {promiseId: 'prom-1', nextText: '正式定稿草稿'});
  assert.equal(findProp(tree, 'data-muse-draft-editor').length, 0);
});

test('buildMuseViewModel renders first-aha focus card + workspace brief in MuseBriefDialog + agent note badge in MuseMemoryView', async t => {
  const {createMuseViews} = await loadMuseViews(t);
  const {React, expand} = runtime();
  const collectText = node => {
    if (node === null || node === undefined || typeof node === 'boolean') return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(collectText).join(' ');
    return (node.children ?? []).map(collectText).join(' ');
  };
  const {MuseBriefDialog, MuseMemoryView} = createMuseViews(React);

  const model = buildMuseViewModel({
    activity: {
      access: {count: 2, workspaces: [{id: 'ws-a', label: 'Alpha'}, {id: 'ws-b', label: 'Beta'}]},
      workspaceBrief: {
        title: '刚读懂你勾选的 2 个工作区',
        text: '• Alpha（刚关注的工作区）：完成支付回调整理\n• Beta（1 件事在推进）：补齐回归脚本',
        workspaces: [
          {id: 'ws-a', label: 'Alpha', statusText: '刚关注的工作区', summary: '完成支付回调整理'},
          {id: 'ws-b', label: 'Beta', statusText: '1 件事在推进', summary: '补齐回归脚本'},
        ],
      },
      sessions: [],
      events: [],
      promises: [],
    },
    muse: {
      digest: {lastDigest: null, dailyTime: '09:00', enabled: true, isQuietToday: false},
      superagent: {mode: 'standalone', milestones: []},
      profile: {
        traits: [],
        notes: [{id: 'n-agent', text: '周三下午出差', category: 'schedule', source: 'agent', createdAt: '2026-11-15T01:00:00.000Z'}],
      },
    },
  });

  assert.equal(model.focus.kind, 'first-aha');
  assert.equal(model.focus.title, '刚读懂你勾选的 2 个工作区');
  assert.equal(model.workspaceRows.length, 2);
  assert.equal(model.workspaceRows[0].statusText, '刚关注的工作区');
  assert.equal(model.workspaceRows[1].summary, '补齐回归脚本');

  const briefTree = expand(React.createElement(MuseBriefDialog, {open: true, model, onClose: () => {}, onAsk: () => {}}));
  const briefText = collectText(briefTree);
  assert.match(briefText, /完成支付回调整理/);
  assert.match(briefText, /补齐回归脚本/);

  const memTree = expand(React.createElement(MuseMemoryView, {model, busy: false, onMuseAct: async () => {}, onAsk: () => {}}));
  const memText = collectText(memTree);
  assert.match(memText, /对话顺手记/);
  assert.match(memText, /周三下午出差/);
});

test('MuseMemoryView renders stale project memory review cards and dispatches archive or keep actions', async t => {
  const {createMuseViews} = await loadMuseViews(t);
  const {React, expand} = runtime();
  const findAll = (node, pred, acc = []) => {
    if (!node || typeof node !== 'object') return acc;
    if (Array.isArray(node)) { for (const x of node) findAll(x, pred, acc); return acc; }
    if (pred(node)) acc.push(node);
    for (const c of node.children ?? []) findAll(c, pred, acc);
    return acc;
  };
  const findProp = (node, prop) => findAll(node, n => n.props && prop in n.props && n.props[prop] !== false && n.props[prop] !== undefined);
  const {MuseMemoryView} = createMuseViews(React);

  const actions = [];
  const model = buildMuseViewModel({
    activity: {sessions: [], events: [], promises: []},
    muse: {
      digest: {lastDigest: null, dailyTime: '09:00', enabled: true, isQuietToday: false},
      superagent: {mode: 'standalone', milestones: []},
      profile: {traits: [], notes: []},
      staleProjectMemories: [
        {
          id: 'stale-99',
          projectRoot: '/tmp/alpha',
          projectLabel: 'Alpha',
          kind: 'blocker',
          text: '支付回调验签偶发超时',
          reason: 'progress.md 已有对应完成记录',
        },
      ],
    },
  });

  const tree = expand(React.createElement(MuseMemoryView, {
    model,
    busy: false,
    onMuseAct: async payload => { actions.push(payload); },
    onAsk: () => {},
  }));
  assert.equal(findProp(tree, 'data-muse-stale-memories').length, 1);
  await findProp(tree, 'data-muse-stale-archive')[0].props.onClick();
  await findProp(tree, 'data-muse-stale-keep')[0].props.onClick();
  assert.deepEqual(actions, [
    {action: 'project_memory_archive_stale', projectRoot: '/tmp/alpha', memoryId: 'stale-99'},
    {action: 'project_memory_keep_stale', projectRoot: '/tmp/alpha', memoryId: 'stale-99'},
  ]);
});

const v10Snapshot = {
  dossiers: [
    {id: 'doc', title: '上线使用手册', workspaceTitle: 'Writing/', status: 'done', artifactKind: 'doc', artifactWordCount: 1650},
    {id: 'running', title: '跑回归', workspaceTitle: 'Agent', state: 'doing'},
    {id: 'archived', title: '旧提案', workspaceTitle: 'Finvo/', status: 'done', archived: true},
    {id: 'wait', title: '确认排期', workspaceTitle: '/work/Agent/', state: 'stuck', checklist: [{id: '1', checked: true}, {id: '2', checked: false}]},
    {id: 'quiet', title: '收拢素材', workspaceTitle: '', status: 'quiet'},
  ],
  memoryItems: [
    {id: 'm1', text: '报价先用英文', active: true, category: 'preference', provenance: '来自 Finvo 对话', effect: '用于报价邮件'},
  ],
  routines: [
    {id: 'daily-digest', title: '晨报', active: true, scheduleLabel: '每日 09:00', lastReceipt: '今早找到两件待拍板事项'},
  ],
  connectors: [
    {id: 'mac_bridge', group: 'mac_base', connected: true, enabled: true, statusText: '已连接'},
    {id: 'workspace_grants', group: 'mac_base', enabled: true, canToggle: true},
    {id: 'google_suite', group: 'external_apps', connected: false, enabled: false, canToggle: true},
    {id: 'flomo', group: 'external_apps', connected: true, enabled: true, canToggle: true},
    {id: 'dida', group: 'external_apps', connected: false, enabled: false, canToggle: true},
    {id: 'wechat', group: 'external_apps', connected: false, enabled: false, canToggle: false},
  ],
  contextMode: 'full_local',
  mountedWorkspaces: ['Agent/', 'Finvo'],
  mobile: {paired: true, pairedCount: 2},
};

test('Muse v10 maps the four status states and excludes archived work from Today', () => {
  const model = buildMuseViewModel({activity: sampleActivity(), muse: v10Snapshot});
  assert.deepEqual(model.carouselCards.map(card => [card.id, card.workspaceTitle, card.status, card.statusLabel]), [
    ['wait', 'Agent', 'wait', '待你拍板'],
    ['running', 'Agent', 'run', '推进中'],
    ['doc', 'Writing', 'done', '成稿就绪'],
    ['quiet', '个人事务', 'quiet', '跟进中'],
  ]);
  assert.equal(model.todayFocus.id, 'wait');
  assert.deepEqual(model.sessionGroups.map(group => [group.workspaceTitle, group.items.map(item => item.id)]), [
    ['Agent', ['wait', 'running']],
    ['Writing', ['doc']],
    ['个人事务', ['quiet']],
  ]);
  assert.deepEqual(model.archivedSessions.map(item => item.id), ['archived']);
  assert.equal(buildMuseViewModel({activity: sampleActivity(), muse: {dossiers: []}}).todayFocus, null);
});

test('Muse v10 shows the active cards, opens native sessions and restores an archived session', async t => {
  const {createMuseViews} = await loadMuseViews(t);
  const {React, expand} = runtime();
  const {MuseWorkbench} = createMuseViews(React);
  const model = buildMuseViewModel({muse: v10Snapshot});
  const actions = [];
  const opened = [];
  const render = tab => expand(React.createElement(MuseWorkbench, {
    model, tab, onMuseAct: payload => actions.push(payload), onOpenSession: id => opened.push(id),
  }));
  const today = render('today');
  assert.deepEqual(findAll(today, item => hasClass(item, 'muse-focus-card')).map(item => item.props['data-muse-focus-card']), ['session']);
  assert.equal(findAll(today, item => item.props['data-muse-session-open'] === 'archived').length, 0);
  const tree = render('threads');
  assert.match(allText(tree), /在办/);
  for (const status of ['wait', 'run', 'done', 'quiet']) {
    assert.ok(findAll(tree, item => hasClass(item, 'muse-session-dot') && hasClass(item, `is-${status}`)).length);
  }
  assert.match(allText(tree), /1\/2 步/);
  assert.match(allText(tree), /1650 字/);
  findAll(tree, item => item.props['data-muse-session-open'] === 'wait')[0].props.onClick();
  findAll(tree, item => item.props['data-muse-session-complete'] === 'wait')[0].props.onClick();
  const archive = findAll(tree, item => item.props['data-muse-session-archive'])[0];
  assert.equal(archive.type, 'details');
  assert.equal(archive.props.open, undefined);
  assert.match(allText(archive), /查看已办妥与全部历史会话/);
  findAll(archive, item => item.props['data-muse-session-reopen'] === 'archived')[0].props.onClick();
  assert.deepEqual(opened, ['wait']);
  assert.deepEqual(actions, [
    {action: 'dossier_act', id: 'wait', operation: 'complete'},
    {action: 'dossier_act', id: 'archived', operation: 'reopen'},
  ]);
});

test('Muse v10 renders memory provenance, effects, real routine receipts, and grouped connector state', async t => {
  const {createMuseViews} = await loadMuseViews(t);
  const {React, expand} = runtime();
  const {MuseWorkbench} = createMuseViews(React);
  const model = buildMuseViewModel({muse: v10Snapshot});
  const actions = [];
  const render = tab => expand(React.createElement(MuseWorkbench, {model, tab, onMuseAct: payload => actions.push(payload)}));
  const memory = render('memory');
  assert.match(allText(memory), /来自 Finvo 对话.*用于报价邮件/);
  assert.match(allText(memory), /今早找到两件待拍板事项/);
  findAll(memory, item => item.props['data-muse-memory-toggle'] === 'm1')[0].props.onClick();
  findAll(memory, item => item.props['data-muse-note-delete'] === 'm1')[0].props.onClick();
  const connections = render('connections');
  assert.deepEqual(findAll(connections, item => item.props['data-muse-connector-group']).map(item => item.props['data-muse-connector-group']), [
    'mac_base', 'external_apps', 'iphone_system',
  ]);
  assert.match(allText(connections), /已开 3\/6 项/);
  assert.match(allText(connections), /Agent · Finvo/);
  assert.match(allText(connections), /2 台 iPhone/);
  const external = findAll(connections, item => item.props['data-muse-connector-group'] === 'external_apps')[0];
  assert.deepEqual(findAll(external, item => item.props['data-muse-connector']).map(item => item.props['data-muse-connector']), [
    'google_suite', 'flomo', 'dida', 'wechat',
  ]);
  findAll(external, item => item.props['data-muse-connector-toggle'] === 'flomo')[0].props.onClick();
  assert.deepEqual(actions, [
    {action: 'memory_item', id: 'm1', active: false},
    {action: 'memory_item', id: 'm1', remove: true},
    {action: 'connector_toggle', id: 'flomo', enabled: false},
  ]);
});

test('Muse v10 counts only iPhone permissions an actual paired device reported', async t => {
  const {createMuseViews} = await loadMuseViews(t);
  const {React, expand} = runtime();
  const {MuseConnectionsView} = createMuseViews(React);
  const iphoneSystem = [{id: 'ios_eventkit', enabled: true, statusText: '已同步日历与提醒'}];
  const render = paired => expand(React.createElement(MuseConnectionsView, {
    model: buildMuseViewModel({muse: {...v10Snapshot, mobile: {paired, iphoneSystem}}}),
  }));
  const paired = render(true);
  const unpaired = render(false);
  assert.match(allText(paired), /已开 4\/7 项/);
  assert.match(allText(paired), /已同步日历与提醒/);
  assert.match(allText(unpaired), /已开 3\/6 项/);
  assert.doesNotMatch(allText(unpaired), /已同步日历与提醒/);
  const health = findAll(paired, item => item.props['data-muse-connector'] === 'ios_health')[0];
  assert.match(allText(health), /在 iPhone 查看/);
});
