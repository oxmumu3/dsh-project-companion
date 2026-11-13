/**
 * Today's promise rail has four distinct data states, and a delayed source
 * request must never borrow the success-empty copy.
 *
 * The regression drives the real store and source reader, then renders the
 * real Today view with a browser-shaped React tree. It also asserts the shipped
 * stylesheet gives a waiting/error/empty row the full rail width instead of the
 * 52 px date column that produced one-character-per-line wrapping.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {buildToday} from '../client/today-model.js';
import {zh} from '../client/strings.zh.js';
import {createTodayStore} from '../client/store.js';
import {createDotSourceReader} from '../src/dot-source-reader.js';
import {createTodayProjection} from '../src/today-projection.js';

const HERE = new URL('../', import.meta.url);

function createReactRuntime() {
  const stack = [];
  const React = {
    createElement: (type, props, ...children) => ({
      type,
      props: props ?? {},
      children: children.flat(Infinity).filter(child => child !== null && child !== undefined && child !== false && child !== true),
    }),
    useState: initial => {
      const frame = stack.at(-1);
      const index = frame.cursor++;
      if (!(index in frame.slots)) frame.slots[index] = typeof initial === 'function' ? initial() : initial;
      return [frame.slots[index], next => { frame.slots[index] = typeof next === 'function' ? next(frame.slots[index]) : next; }];
    },
    useRef: initial => {
      const frame = stack.at(-1);
      const index = frame.cursor++;
      if (!(index in frame.slots)) frame.slots[index] = {current: initial};
      return frame.slots[index];
    },
    useEffect: () => {},
    useMemo: factory => factory(),
  };
  function expand(node) {
    if (node === null || node === undefined || typeof node === 'boolean') return null;
    if (typeof node === 'string' || typeof node === 'number') return node;
    if (Array.isArray(node)) return node.map(expand).flat(Infinity).filter(item => item !== null);
    if (typeof node.type === 'function') {
      const frame = {cursor: 0, slots: []};
      stack.push(frame);
      let rendered;
      try {
        rendered = node.type(node.props);
      } finally {
        stack.pop();
      }
      return expand(rendered);
    }
    return {...node, children: (node.children ?? []).map(expand).flat(Infinity).filter(item => item !== null)};
  }
  return {React, expand};
}

const walk = (node, visit) => {
  if (!node || typeof node !== 'object') return;
  visit(node);
  for (const child of node.children ?? []) walk(child, visit);
};
const findAll = (node, predicate) => {
  const hits = [];
  walk(node, item => { if (predicate(item)) hits.push(item); });
  return hits;
};
const textOf = node => {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return (node.children ?? []).map(textOf).join('');
};

let view;
async function loadView(t) {
  if (view) return view;
  const dir = await mkdtemp(join(tmpdir(), 'dot-today-loading-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const outfile = join(dir, 'today.cjs');
  await build({
    absWorkingDir: fileURLToPath(HERE),
    entryPoints: ['client/today.jsx'],
    outfile,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node20',
    jsx: 'transform',
    jsxFactory: 'React.createElement',
    jsxFragment: 'React.Fragment',
    logLevel: 'error',
  });
  view = createRequire(import.meta.url)(outfile);
  return view;
}

function render(model) {
  const {React, expand} = createReactRuntime();
  const TodayPage = view.createTodayView(React).TodayPage;
  return expand(React.createElement(TodayPage, {
    model,
    onAct: () => {},
    onSay: () => {},
    onOpenProject: () => {},
    onOpenSession: () => {},
    onClearSample: () => {},
    pending: new Set(),
  }));
}

function rail(tree) {
  const list = findAll(tree, node => node.props?.className === 'promise' && node.type === 'ul')[0];
  assert.ok(list, '今天页右栏没有渲染出「你答应过的事」列表');
  const rows = (list.children ?? []).filter(child => child?.type === 'li');
  return {list, rows, stateRow: rows.find(row => /(^|\s)is-state(\s|$)/.test(String(row.props?.className ?? ''))) ?? null};
}

const base = extra => ({
  reachable: true,
  revision: 3,
  counts: {done: 0, wait: 0, stuck: 0, run: 0, total: 0},
  sessions: [],
  projects: [],
  promises: [],
  sources: [],
  sourcesPhase: 'ready',
  connection: {wechat: 'none'},
  ...extra,
});

test('a delayed request renders waiting copy in one full rail row, never "all handled"', async t => {
  await loadView(t);
  // The first store response is still loading and has no activity at all.
  const pending = buildToday(null, {loading: true});
  assert.equal(pending.state, 'loading');
  assert.equal(pending.promisesState, 'loading');
  const pendingTree = render(pending);
  const pendingRail = rail(pendingTree);
  assert.equal(pendingRail.list.props['data-promise-state'], 'loading');
  assert.equal(pendingRail.rows.length, 1);
  assert.match(pendingRail.stateRow.props.className, /is-state/);
  assert.match(pendingRail.stateRow.props.className, /is-loading/);
  assert.equal(textOf(pendingRail.stateRow), zh.today.promisesLoading);
  assert.equal(textOf(pendingTree).includes(zh.today.emptyNeed), false, 'a waiting page must not claim everything was handled');

  // The ready projection can still say the provider read is in flight.
  const reading = buildToday(base({sourcesPhase: 'reading'}));
  assert.equal(reading.state, 'loading');
  assert.equal(reading.promisesState, 'loading');
  const readingRail = rail(render(reading));
  assert.equal(readingRail.list.props['data-promise-state'], 'loading');
  assert.equal(textOf(readingRail.stateRow), zh.today.promisesLoading);
  assert.equal(textOf(readingRail.stateRow).includes(zh.today.emptyNeed), false);

  const css = await readFile(new URL('client/styles.css', HERE), 'utf8');
  assert.match(css, /\.dotv2 \.promise li\.is-state\{grid-template-columns:minmax\(0,1fr\)/, 'state rows must span the rail instead of the date column');
});

test('a delayed fetch stays loading until it resolves, then can be success-empty or non-empty', async t => {
  let release;
  const response = new Promise(resolve => { release = resolve; });
  const store = createTodayStore({
    fetchImpl: () => response,
    visibility: {visibilityState: 'visible', addEventListener() {}, removeEventListener() {}},
    timers: {setInterval() { return 1; }, clearInterval() {}},
  });
  const flight = store.refreshNow();
  assert.equal(store.getSnapshot().phase, 'loading');
  assert.equal(buildToday(store.getSnapshot().activity, {loading: true}).promisesState, 'loading');

  release({ok: true, json: async () => base({sourcesPhase: 'reading'})});
  await flight;
  const waiting = buildToday(store.getSnapshot().activity);
  assert.equal(waiting.promisesState, 'loading');
  assert.notEqual(waiting.promisesState, 'empty');

  await loadView(t);
  const waitingRail = rail(render(waiting));
  assert.equal(textOf(waitingRail.stateRow), zh.today.promisesLoading);

  // A later successful empty read is the only state allowed to use emptyNeed.
  const empty = buildToday(base({sourcesPhase: 'ready', sources: [{id: 'dida', state: 'ok'}]}));
  const emptyRail = rail(render(empty));
  assert.equal(empty.promisesState, 'empty');
  assert.equal(textOf(emptyRail.stateRow), zh.today.emptyNeed);

  const nonEmpty = buildToday(base({
    sourcesPhase: 'ready',
    promises: [{id: 'p1', whenText: '今天 18:00', what: '交稿', from: '滴答清单'}],
    sources: [{id: 'dida', state: 'ok'}],
  }));
  assert.equal(nonEmpty.promisesState, 'ready');
  const readyRail = rail(render(nonEmpty));
  assert.equal(readyRail.list.props['data-promise-state'], 'ready');
  assert.equal(readyRail.stateRow, null, 'success with data renders real promise rows');
  assert.equal(readyRail.rows.length, 1);
  assert.equal(textOf(readyRail.rows[0]).includes('交稿'), true);
});

test('a failed read is not a successful empty list', async t => {
  await loadView(t);
  const failed = buildToday(base({sourcesPhase: 'failed'}));
  assert.equal(failed.promisesState, 'error');
  const failedRail = rail(render(failed));
  assert.equal(failedRail.list.props['data-promise-state'], 'error');
  assert.match(failedRail.stateRow.props.className, /is-error/);
  assert.equal(textOf(failedRail.stateRow), zh.today.promisesUnread);
  assert.equal(textOf(failedRail.stateRow).includes(zh.today.emptyNeed), false);

  const unavailable = buildToday(base({sourcesPhase: 'ready', sources: [{id: 'dida', state: 'needs_authorization'}]}));
  assert.equal(unavailable.promisesState, 'error');
  const unavailableRail = rail(render(unavailable));
  assert.equal(unavailableRail.list.props['data-promise-state'], 'error');
  assert.equal(textOf(unavailableRail.stateRow), zh.today.promisesUnread);
  assert.equal(unavailableRail.stateRow.children.some(child => child?.type === 'time'), false, 'the failure row is not put in the date column');

  const empty = buildToday(base({sourcesPhase: 'ready', sources: [{id: 'dida', state: 'ok'}]}));
  assert.equal(empty.promisesState, 'empty');
  const emptyRail = rail(render(empty));
  assert.equal(emptyRail.list.props['data-promise-state'], 'empty');
  assert.equal(textOf(emptyRail.stateRow), zh.today.emptyNeed);
  assert.notEqual(failed.promisesState, empty.promisesState);
  assert.notEqual(textOf(failedRail.stateRow), textOf(emptyRail.stateRow), 'failure and success-empty must not share copy');
});

test('a same-revision phase change still redraws the promise rail', async () => {
  let payload = base({sourcesPhase: 'reading'});
  const store = createTodayStore({
    fetchImpl: async () => ({ok: true, json: async () => payload}),
    visibility: {visibilityState: 'visible', addEventListener() {}, removeEventListener() {}},
    timers: {setInterval() { return 1; }, clearInterval() {}},
  });
  await store.refreshNow();
  let notifications = 0;
  store.subscribe(() => { notifications += 1; });
  await store.refreshNow();
  assert.equal(notifications, 0, 'an identical ready response does not redraw');
  payload = base({sourcesPhase: 'ready', sources: [{id: 'dida', state: 'ok'}]});
  await store.refreshNow();
  assert.equal(notifications, 1, 'loading → ready must redraw even when revision is unchanged');
  assert.equal(store.getSnapshot().activity.sourcesPhase, 'ready');
});

test('the source reader reports reading, then ready, for a delayed provider read', async () => {
  let release;
  let first = true;
  const reader = createDotSourceReader({
    sources: {rowOf: async () => ({enabled: true})},
    clock: () => new Date('2026-11-13T15:00:00.000Z'),
    read: async () => {
      if (!first) return {items: [], truncated: false};
      first = false;
      return new Promise(resolve => { release = resolve; });
    },
  });
  const flight = reader.refreshNow();
  assert.equal(reader.snapshot().phase, 'reading');
  assert.deepEqual(reader.snapshot().promises, []);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof release, 'function', 'the delayed provider read has started');
  release({items: [], truncated: false});
  await flight;
  const snapshot = reader.snapshot();
  assert.equal(snapshot.phase, 'ready');
  assert.deepEqual(snapshot.promises, []);
  assert.deepEqual(snapshot.sources.map(row => row.state), ['ok', 'ok']);
});

test('the activity projection carries the reader phase', async () => {
  const ledger = {
    snapshot: async () => ({revision: 2, reachable: true, counts: {done: 0, wait: 0, stuck: 0, run: 0, total: 0}, sessions: [], projects: [], promises: [], sources: [], connection: {wechat: 'none'}}),
    internal: async () => ({sessions: []}),
  };
  const workspaceAccess = {capture: async () => ({revision: 'workspace-a', grants: []}), authorizeSync: () => true, assertCurrent: async () => {}};
  for (const phase of ['reading', 'failed', 'ready']) {
    const projection = createTodayProjection({
      sessionLedger: ledger,
      dotSourceReader: {snapshot: () => ({revision: 0, promises: [], sources: [], phase})},
      workspaceAccess,
      links: {linkOf: async () => null},
      readConnection: async () => 'none',
    });
    const value = await projection();
    assert.equal(value.sourcesPhase, phase);
  }
});

test('a whole-read failure is reported as failed, never as an empty source list', async () => {
  let reads = 0;
  const reader = createDotSourceReader({
    sources: {rowOf: async () => { reads += 1; throw Object.assign(new Error('store unavailable'), {code: 'SOURCE_STORE_FAILED'}); }},
    clock: () => new Date('2026-11-13T15:00:00.000Z'),
    read: async () => ({items: [], truncated: false}),
  });
  await assert.rejects(reader.refreshNow(), /store unavailable/);
  const snapshot = reader.snapshot();
  assert.equal(snapshot.phase, 'failed');
  assert.equal(snapshot.readError, 'SOURCE_STORE_FAILED');
  assert.deepEqual(snapshot.promises, []);
  const model = buildToday(base({sourcesPhase: snapshot.phase}));
  assert.equal(model.promisesState, 'error');
  assert.notEqual(model.promisesState, 'empty');
  assert.equal(reads, 1);
});

test('a failed read with no sessions never claims "all handled" anywhere on Today', async t => {
  await loadView(t);
  const model = buildToday(base({sourcesPhase: 'failed'}));
  assert.equal(model.state, 'empty');
  assert.equal(model.promisesState, 'error');
  const text = textOf(render(model));
  assert.equal(text.includes(zh.today.emptyNeed), false);
  assert.equal(text.includes(zh.today.promisesUnread), true);
});
