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
