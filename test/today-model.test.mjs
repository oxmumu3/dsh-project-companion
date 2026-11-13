import test from 'node:test';
import assert from 'node:assert/strict';
import {buildToday, projectDots, TODAY_STATES} from '../client/today-model.js';
import {createTodayStore} from '../client/store.js';

const project = (id, name) => ({id, name, slot: 0});
const session = (projectId, state, extra = {}) => ({projectId, state, title: `标题-${state}`, what: `说明-${state}`, short: state, at: '2026-11-11T06:00:00.000Z', ...extra});

function activity(overrides = {}) {
  return {
    revision: 7,
    reachable: true,
    counts: {done: 2, wait: 1, stuck: 1, run: 2, total: 6},
    sessions: [
      session('p1', 'needs_you'), session('p2', 'stuck'), session('p3', 'doing'), session('p4', 'doing'),
      session('p5', 'done'), session('p5', 'done'),
    ],
    projects: [project('p1', 'Finder'), project('p2', '产品站'), project('p3', '写作'), project('p4', 'Dot'), project('p5', '墨西哥')],
    promises: [
      {id: 'pr1', when: '2026-11-11T10:00:00.000Z', whenText: '今天 18:00', what: '交稿', from: '滴答清单', linkProjectId: 'p1'},
      {id: 'pr2', when: '2026-11-12T02:00:00.000Z', whenText: '明天 10:00', what: '对账', from: 'Google 日历'},
    ],
    sources: [{id: 'dida', state: 'needs_authorization'}],
    connection: {wechat: 'bound'},
    sample: false,
    ...overrides,
  };
}

test('the sentence is built from counts, never from a model', () => {
  const model = buildToday(activity());
  assert.equal(model.state, 'needs');
  assert.equal(model.counts.wait, 1);
  assert.equal(model.headline.text, '到现在为止，两件做完了，一件在等你，一件卡住了，还有两件在跑。');
});

test('needs-you and stuck items become two big cards and the rest become rows', () => {
  const model = buildToday(activity({sessions: [session('p1', 'needs_you'), session('p2', 'stuck'), session('p3', 'needs_you')], counts: {done: 0, wait: 2, stuck: 1, run: 0, total: 3}}));
  assert.equal(model.needCards.length, 2);
  assert.equal(model.needRows.length, 1);
  assert.equal(model.needCards[0].primaryAct, 'open');
  assert.equal(model.needCards[1].primaryAct, 'open');
  assert.equal(model.needCards[0].primary, '打开会话');
  assert.equal(model.needCards[0].second, null, 'the waiting card has one action, not a duplicate open button');
  assert.equal(model.needRows[0].primaryAct, 'retry');
  assert.equal(model.needRows[0].secondAct, 'open', 'the stuck card keeps retry plus talk/open');
});

test('done work groups one row per project and keeps the newest first', () => {
  const model = buildToday(activity({sessions: [session('p5', 'done', {what: '最近一件'}), session('p5', 'done', {what: '更早一件'}), session('p6', 'done')], projects: [project('p5', '墨西哥'), project('p6', '阅读')], counts: {done: 3, wait: 0, stuck: 0, run: 0, total: 3}}));
  assert.equal(model.doneGroups.length, 2);
  assert.equal(model.doneGroups[0].count, 2);
  assert.match(model.doneGroups[0].latest.what, /最近一件|更早一件/);
});

test('the four visible states plus first use and blind are distinct', () => {
  const needs = buildToday(activity());
  const onlyRunning = buildToday(activity({sessions: [session('p3', 'doing')], counts: {done: 0, wait: 0, stuck: 0, run: 1, total: 1}}));
  const empty = buildToday(activity({sessions: [], counts: {done: 0, wait: 0, stuck: 0, run: 0, total: 0}, promises: []}));
  const blind = buildToday({reachable: false});
  const first = buildToday(activity({sample: true}));
  assert.deepEqual([needs.state, onlyRunning.state, empty.state, blind.state, first.state], ['needs', 'running', 'empty', 'blind', 'first']);
  for (const state of [needs.state, onlyRunning.state, empty.state, blind.state, first.state]) assert.ok(TODAY_STATES.includes(state));
  assert.match(blind.headline.text, /看不到/);
  assert.equal(onlyRunning.headline.text.includes('在跑'), true);
});

test('a failed source is reported beside the promises instead of clearing them', () => {
  const model = buildToday(activity());
  assert.deepEqual(model.sourceProblems.map(row => row.id), ['dida']);
  const linked = model.promises.find(row => row.id === 'pr1');
  assert.equal(linked.dispatch, false);
  const unlinked = model.promises.find(row => row.id === 'pr2');
  assert.equal(unlinked.dispatch, true);
  assert.equal(unlinked.note, '还没有人在处理');
});

test('dots take the most urgent state of each project and stay quiet without sessions', () => {
  const dots = projectDots([project('a', 'A'), project('b', 'B')], [session('a', 'done'), session('a', 'needs_you')]);
  assert.equal(dots.find(row => row.id === 'a').state, 'needs_you');
  assert.equal(dots.find(row => row.id === 'b').state, 'quiet');
});

test('an unreachable activity never becomes an empty-state claim', async () => {
  const calls = [];
  const store = createTodayStore({
    fetchImpl: async () => { calls.push(1); throw Object.assign(new Error('down'), {code: 'NETWORK'}); },
    visibility: {visibilityState: 'visible', addEventListener() {}, removeEventListener() {}},
    timers: {setInterval() { return 1; }, clearInterval() {}},
  });
  await store.refreshNow();
  const snapshot = store.getSnapshot();
  assert.equal(snapshot.activity.reachable, false);
  const model = buildToday(snapshot.activity);
  assert.equal(model.state, 'blind');
  assert.equal(calls.length, 1);
});

test('the store skips redraw when revision did not change', async () => {
  let payload = activity();
  let fetches = 0;
  const store = createTodayStore({
    fetchImpl: async () => { fetches += 1; return {ok: true, json: async () => payload}; },
    visibility: {visibilityState: 'visible', addEventListener() {}, removeEventListener() {}},
    timers: {setInterval() { return 1; }, clearInterval() {}},
  });
  let notifications = 0;
  store.subscribe(() => { notifications += 1; });
  await store.refreshNow();
  const afterFirst = notifications;
  await store.refreshNow();
  assert.equal(fetches, 2);
  assert.equal(notifications, afterFirst, 'same revision must not notify subscribers');
  payload = {...activity(), revision: 8};
  await store.refreshNow();
  assert.equal(notifications, afterFirst + 1);
});

test('revoking a workspace changes the authorization shape even with the same revision', async () => {
  let payload = activity({access: {revision: 'workspace-access:a', count: 1}});
  const store = createTodayStore({
    fetchImpl: async () => ({ok: true, json: async () => payload}),
    visibility: {visibilityState: 'visible', addEventListener() {}, removeEventListener() {}},
    timers: {setInterval() { return 1; }, clearInterval() {}},
  });
  let notifications = 0;
  store.subscribe(() => { notifications += 1; });
  await store.refreshNow();
  assert.equal(store.getSnapshot().activity.projects.length, 5);
  const afterFirst = notifications;
  // Same ledger/source revision, but the workspace was revoked: the projects
  // disappear and the authorization revision moved.
  payload = activity({access: {revision: 'workspace-access:b', count: 0}, projects: [], sessions: [], promises: [], counts: {done: 0, wait: 0, stuck: 0, run: 0, total: 0}});
  await store.refreshNow();
  assert.equal(notifications, afterFirst + 1, 'a revocation must notify even when revision is identical');
  assert.equal(store.getSnapshot().activity.projects.length, 0);
  await store.refreshNow();
  assert.equal(notifications, afterFirst + 1, 'an unchanged authorization shape must not redraw');
});

test('activity polling stops while the Today page is not active and refreshes when it returns', async () => {
  let fetches = 0, tick = null;
  const store = createTodayStore({
    fetchImpl: async () => { fetches += 1; return {ok: true, json: async () => activity()}; },
    visibility: {visibilityState: 'visible', addEventListener() {}, removeEventListener() {}},
    timers: {setInterval(fn) { tick = fn; return 1; }, clearInterval() {}},
  });
  store.setActive(false);
  store.start();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fetches, 0, 'an inactive page does not fetch on start');
  tick();
  assert.equal(fetches, 0, 'the interval does not fetch while another page is active');
  store.setActive(true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fetches, 1, 'returning to Today refreshes immediately');
  tick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fetches, 2, 'polling resumes after returning');
  store.stop();
});
