import test from 'node:test';
import assert from 'node:assert/strict';
import {createDotSources} from '../src/dot-sources.js';
import {createDotSourceReader, projectPromises, whenText} from '../src/dot-source-reader.js';

const KEY = 'a'.repeat(64);
const NOW = new Date('2026-11-11T08:00:00.000Z');
const DAY = 86400000;
const iso = ms => new Date(ms).toISOString();

function memoryStore() {
  let value = null;
  return {async get() { return value === null ? null : structuredClone(value); }, async put(_key, next) { value = structuredClone(next); }, peek() { return value; }};
}

async function seededSources() {
  const sources = createDotSources({store: memoryStore(), clock: () => NOW});
  await sources.enable('dida', KEY);
  await sources.enable('calendar', KEY);
  return sources;
}

test('dida reads every list and keeps only open tasks due inside the window', async () => {
  const sources = await seededSources();
  const calls = [];
  const reader = createDotSourceReader({
    sources,
    clock: () => NOW,
    hostTimeZone: () => 'Asia/Shanghai',
    read: async (source, request) => {
      calls.push({source, request});
      if (request.operation === 'projects') return {items: [{id: 'list-1', name: '工作'}, {id: 'list-2', name: '收集箱'}], truncated: false};
      if (request.operation === 'inboxWindow') return {items: [], truncated: false};
      if (request.projectId === 'list-1') return {items: [
        {id: 'overdue', projectId: 'list-1', title: '过期八天', dueAt: iso(NOW.getTime() - 8 * DAY), status: 'open'},
        {id: 'soon', projectId: 'list-1', title: '后天到期', dueAt: iso(NOW.getTime() + 2 * DAY), status: 'open'},
        {id: 'done', projectId: 'list-1', title: '已经做完', dueAt: iso(NOW.getTime() + DAY), status: 'completed'},
        {id: 'undated', projectId: 'list-1', title: '没有日期', status: 'open'},
      ], truncated: false};
      return {items: [{id: 'today', projectId: 'list-2', title: '今天到期', dueAt: iso(NOW.getTime() + 3600000), status: 'open'}], truncated: false};
    },
  });
  const cache = await reader.refreshNow();
  const dida = calls.filter(call => call.source === 'dida');
  assert.equal(dida.filter(call => call.request.operation === 'tasks').length, 2, 'one read per named list; Inbox uses the window operation');
  assert.equal(dida.filter(call => call.request.operation === 'inboxWindow').length, 1);
  assert.deepEqual(cache.promises.map(row => row.sourceItemId), ['today', 'soon']);
  const promise = cache.promises[1];
  assert.equal(promise.source, 'dida');
  assert.equal(promise.from, '滴答清单');
  assert.equal(promise.judged, false);
  assert.equal(typeof promise.what, 'string');
  assert.equal(reader.metrics().dida.lists, 2, 'the Inbox window is not counted as a named list');
  assert.equal(reader.metrics().dida.inWindow, 2);
  assert.equal(reader.metrics().dida.requests, 4, 'projects + two named lists + one Inbox window');
});

test('calendar keeps events in the next seven days and sources carry ok plus last read', async () => {
  const sources = await seededSources();
  const reader = createDotSourceReader({
    sources, clock: () => NOW, hostTimeZone: () => 'Asia/Shanghai',
    read: async (source, request) => {
      if (source === 'dida') return request.operation === 'projects' ? {items: [], truncated: false} : {items: [], truncated: false};
      return {items: [
        {id: 'evt-1', title: '评审', startAt: iso(NOW.getTime() + DAY), status: 'confirmed'},
        {id: 'evt-2', title: '取消的会', startAt: iso(NOW.getTime() + 2 * DAY), status: 'cancelled'},
      ], truncated: false};
    },
  });
  const cache = await reader.refreshNow();
  assert.deepEqual(cache.promises.map(row => row.sourceItemId), ['evt-1']);
  assert.deepEqual(cache.sources.map(row => row.id).sort(), ['calendar', 'dida']);
  assert.equal(cache.sources.find(row => row.id === 'calendar').state, 'ok');
  assert.ok(cache.sources.find(row => row.id === 'calendar').lastReadAt);
  assert.equal(cache.promises[0].from, 'Google 日历');
});

test('a source that cannot be read is unknown, keeps last-known items and names the failure', async () => {
  const sources = await seededSources();
  let fail = false;
  const reader = createDotSourceReader({
    sources, clock: () => NOW, hostTimeZone: () => 'Asia/Shanghai',
    read: async (source, request) => {
      if (source === 'dida') {
        if (fail) throw Object.assign(new Error('expired'), {code: 'CONTEXT_AUTH_REQUIRED'});
        if (request.operation === 'projects') return {items: [{id: 'list-1', name: '工作'}], truncated: false};
        if (request.operation === 'inboxWindow' || request.projectId === 'inbox') return {items: [], truncated: false};
        return {items: [{id: 'task-1', projectId: 'list-1', title: '要交的稿', dueAt: iso(NOW.getTime() + DAY), status: 'open'}], truncated: false};
      }
      return {items: [], truncated: false};
    },
  });
  await reader.refreshNow();
  assert.equal(reader.snapshot().promises.length, 1);
  fail = true;
  const cache = await reader.refreshNow();
  const dida = cache.sources.find(row => row.id === 'dida');
  assert.equal(dida.state, 'needs_authorization');
  assert.equal(dida.code, 'CONTEXT_AUTH_REQUIRED');
  assert.equal(cache.promises.length, 0, 'revocation must not leave a cached title visible');
});

test('a disabled source is not reported as an empty promise list', async () => {
  const sources = createDotSources({store: memoryStore(), clock: () => NOW});
  let reads = 0;
  const reader = createDotSourceReader({sources, clock: () => NOW, read: async () => { reads += 1; return {items: [], truncated: false}; }});
  const cache = await reader.refreshNow();
  assert.equal(reads, 0);
  assert.deepEqual(cache.sources, []);
  assert.deepEqual(cache.promises, []);
});

test('handled and dismissed promises disappear; a snoozed one stays marked as later', async () => {
  const now = NOW;
  const items = [
    {source: 'dida', sourceItemId: 'one', what: '先做这个', when: iso(now.getTime() + DAY)},
    {source: 'dida', sourceItemId: 'two', what: '这个已经处理', when: iso(now.getTime() + DAY)},
    {source: 'dida', sourceItemId: 'three', what: '稍后再说', when: iso(now.getTime() + 2 * DAY)},
  ];
  const decisions = [
    {key: 'dida:two', state: 'handled', at: now.toISOString()},
    {key: 'dida:three', state: 'snoozed', at: now.toISOString(), until: iso(now.getTime() + 3600000)},
  ];
  const promises = projectPromises({items, states: {dida: {state: 'ok'}}, decisions, now, timeZone: 'Asia/Shanghai'});
  assert.deepEqual(promises.map(row => row.sourceItemId), ['one', 'three']);
  assert.equal(promises[1].note, '你让它稍后再说');
});

test('cached snapshots do not re-read before the interval and refreshNow always does', async () => {
  const sources = await seededSources();
  let reads = 0;
  const reader = createDotSourceReader({
    sources, clock: () => NOW, intervalMs: 900000,
    read: async (source, request) => {
      reads += 1;
      if (source === 'dida') return request.operation === 'projects' ? {items: [], truncated: false} : {items: [], truncated: false};
      return {items: [], truncated: false};
    },
  });
  await reader.refreshNow();
  const afterFirst = reads;
  reader.snapshot();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(reads, afterFirst, 'a fresh cache does not trigger another read');
  await reader.refreshNow();
  assert.ok(reads > afterFirst);
});

test('whenText uses the host timezone and never guesses an invalid timestamp', () => {
  const text = whenText(iso(NOW.getTime() + DAY), NOW, 'Asia/Shanghai');
  assert.match(text, /^明天 /);
  assert.equal(whenText('not-a-date', NOW, 'Asia/Shanghai'), '');
});
