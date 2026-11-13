import test from 'node:test';
import assert from 'node:assert/strict';
import {createDotSources} from '../src/dot-sources.js';
import {createDotSourceReader} from '../src/dot-source-reader.js';
import {buildToday} from '../client/today-model.js';

const KEY = 'a'.repeat(64);
const NOW = new Date('2026-11-11T08:00:00.000Z');
const DAY = 86400000;
const iso = ms => new Date(ms).toISOString();
const FROM = iso(NOW.getTime() - 7 * DAY);
const TO = iso(NOW.getTime() + 7 * DAY);

function memoryStore() {
  let value = null;
  return {async get() { return value === null ? null : structuredClone(value); }, async put(_key, next) { value = structuredClone(next); }};
}

async function didaReader(read) {
  const sources = createDotSources({store: memoryStore(), clock: () => NOW});
  await sources.enable('dida', KEY);
  return createDotSourceReader({sources, clock: () => NOW, hostTimeZone: () => 'Asia/Shanghai', read});
}

const projectRead = () => ({items: [{id: 'list-1', name: '工作'}, {id: 'inbox', name: '收集箱 alias'}], truncated: false});
const listRead = () => ({items: [
  {id: 'named-in', projectId: 'list-1', title: '清单里到期', dueAt: iso(NOW.getTime() + DAY), status: 'open'},
  {id: 'named-out', projectId: 'list-1', title: '清单里过期', dueAt: iso(NOW.getTime() - 8 * DAY), status: 'open'},
  {id: 'named-done', projectId: 'list-1', title: '清单里做完', dueAt: iso(NOW.getTime() + DAY), status: 'completed'},
], truncated: false});

test('Inbox window accepts either date, prefers the due date and marks a start-only fallback', async () => {
  const requests = [];
  const reader = await didaReader(async (_source, request) => {
    requests.push(request);
    if (request.operation === 'projects') return projectRead();
    if (request.operation === 'tasks') return listRead();
    if (request.operation === 'inboxWindow') return {items: [
      {id: 'due-in', projectId: 'inbox69a85785', title: '到期在窗口', dueAt: iso(NOW.getTime() + DAY), startAt: iso(NOW.getTime() - 9 * DAY), status: 'open'},
      {id: 'start-only', projectId: 'inbox69a85785', title: '只有开始日', startAt: iso(NOW.getTime() + 2 * DAY), status: 'open'},
      {id: 'due-out-start-in', projectId: 'inbox69a85785', title: '开始日命中', startAt: iso(NOW.getTime() - 6 * DAY), dueAt: iso(NOW.getTime() + 9 * DAY), status: 'open'},
      {id: 'both-out', projectId: 'inbox69a85785', title: '两个日期都在外', startAt: iso(NOW.getTime() - 20 * DAY), dueAt: iso(NOW.getTime() + 20 * DAY), status: 'open'},
      {id: 'at-from', projectId: 'inbox69a85785', title: '开始日边界', startAt: FROM, status: 'open'},
      {id: 'before-from', projectId: 'inbox69a85785', title: '开始日早一毫秒', startAt: iso(Date.parse(FROM) - 1), status: 'open'},
      {id: 'at-to', projectId: 'inbox69a85785', title: '到期日边界', dueAt: TO, status: 'open'},
      {id: 'after-to', projectId: 'inbox69a85785', title: '到期日晚一毫秒', dueAt: iso(Date.parse(TO) + 1), status: 'open'},
      {id: 'window-done', projectId: 'inbox69a85785', title: '窗口里已完成', dueAt: iso(NOW.getTime() + DAY), status: 'completed'},
    ], truncated: false};
    throw new Error(`unexpected request ${JSON.stringify(request)}`);
  });
  const cache = await reader.refreshNow();
  const byId = new Map(cache.promises.map(row => [row.sourceItemId, row]));
  assert.deepEqual([...byId.keys()].sort(), ['at-from', 'at-to', 'due-in', 'due-out-start-in', 'named-in', 'start-only']);
  assert.equal(byId.has('both-out'), false);
  assert.equal(byId.has('before-from'), false);
  assert.equal(byId.has('after-to'), false);
  assert.equal(byId.has('window-done'), false);

  assert.equal(byId.get('due-in').whenBasis, 'due');
  assert.equal(byId.get('due-in').when, iso(NOW.getTime() + DAY));
  assert.equal(byId.get('start-only').whenBasis, 'start');
  assert.match(byId.get('start-only').whenText, /^开始 · /);
  assert.equal(byId.get('due-out-start-in').whenBasis, 'due');
  assert.equal(byId.get('due-out-start-in').when, iso(NOW.getTime() + 9 * DAY), 'a present due date is shown even when the start date is the window hit');

  const windowRequest = requests.find(row => row.operation === 'inboxWindow');
  assert.deepEqual(windowRequest, {operation: 'inboxWindow', from: FROM, to: TO});
  assert.equal(requests.some(row => row.projectId === 'inbox'), false, 'only the literal Inbox alias is skipped as a named list');
  const metrics = reader.metrics().dida;
  assert.equal(metrics.lists, 1);
  assert.equal(metrics.inboxWindow, 8, 'open rows returned by the window, before either-date filtering');
  assert.equal(metrics.inWindow, 6, 'named list hit plus five window hits');
  assert.equal(metrics.undone, 2, 'named-list undone tasks only; window rows are not counted as a total');
  assert.equal(metrics.requests, 3);
  const source = cache.sources.find(row => row.id === 'dida');
  assert.equal(source.state, 'ok');
  assert.equal(source.partial, undefined);
});

test('a mixed or malformed Inbox batch is dropped while named lists stay', async () => {
  let windowMode = 'mixed';
  const reader = await didaReader(async (_source, request) => {
    if (request.operation === 'projects') return projectRead();
    if (request.operation === 'tasks') return listRead();
    if (request.operation === 'inboxWindow') {
      if (windowMode === 'mixed') throw Object.assign(new Error('mixed owners'), {code: 'CONTEXT_PROTOCOL_INVALID', inboxProtocolStage: 'window_project'});
      return {items: [], truncated: false};
    }
    throw new Error('unexpected request');
  });
  const cache = await reader.refreshNow();
  assert.deepEqual(cache.promises.map(row => row.sourceItemId), ['named-in']);
  const source = cache.sources.find(row => row.id === 'dida');
  assert.equal(source.state, 'ok');
  assert.equal(source.partial, true);
  assert.equal(source.partialReason, 'inbox_window');
  const metrics = reader.metrics().dida;
  assert.equal(metrics.inboxFailed, 1);
  assert.equal(metrics.inboxCode, 'CONTEXT_PROTOCOL_INVALID');
  assert.equal(metrics.inboxProtocolStage, 'window_project');
  assert.equal(metrics.undone, 2, 'the named list was already read');
  const model = buildToday({reachable: true, counts: {done: 0, wait: 0, stuck: 0, run: 0, total: 0}, sessions: [], projects: [], promises: cache.promises, sources: cache.sources});
  assert.deepEqual(model.sourcePartials.map(row => row.id), ['dida']);
  assert.match(model.sourcePartials[0].note, /收集箱这次没读到/);

  windowMode = 'empty';
  const recovered = await reader.refreshNow();
  assert.deepEqual(recovered.promises.map(row => row.sourceItemId), ['named-in']);
  assert.equal(recovered.sources.find(row => row.id === 'dida').partial, undefined);
  assert.equal(reader.metrics().dida.inboxFailed, undefined);
});

test('a project whose id merely starts like Inbox is read normally, not skipped', async () => {
  const reads = [];
  const reader = await didaReader(async (_source, request) => {
    reads.push(request);
    if (request.operation === 'projects') return {items: [{id: 'inbox-notes', name: '普通清单'}, {id: 'inbox', name: '收集箱'}], truncated: false};
    if (request.operation === 'tasks') {
      assert.equal(request.projectId, 'inbox-notes');
      return {items: [{id: 'prefixed', projectId: 'inbox-notes', title: '前缀像收件箱的普通任务', dueAt: iso(NOW.getTime() + DAY), status: 'open'}], truncated: false};
    }
    if (request.operation === 'inboxWindow') return {items: [], truncated: false};
    throw new Error('unexpected request');
  });
  const cache = await reader.refreshNow();
  assert.equal(reads.some(row => row.projectId === 'inbox-notes'), true);
  assert.equal(reads.some(row => row.projectId === 'inbox'), false);
  assert.deepEqual(cache.promises.map(row => row.sourceItemId), ['prefixed']);
  assert.equal(reader.metrics().dida.lists, 1);
});

test('an Inbox window permission failure makes the source unavailable and drops old titles', async () => {
  let fail = false;
  const reader = await didaReader(async (_source, request) => {
    if (request.operation === 'projects') return projectRead();
    if (request.operation === 'tasks') return listRead();
    if (request.operation === 'inboxWindow') {
      if (fail) throw Object.assign(new Error('expired'), {code: 'CONTEXT_AUTH_REQUIRED'});
      return {items: [{id: 'window-1', projectId: 'inbox69a85785', title: '窗口任务', dueAt: iso(NOW.getTime() + DAY), status: 'open'}], truncated: false};
    }
    throw new Error('unexpected request');
  });
  const first = await reader.refreshNow();
  assert.ok(first.promises.some(row => row.sourceItemId === 'window-1'));
  fail = true;
  const cache = await reader.refreshNow();
  const source = cache.sources.find(row => row.id === 'dida');
  assert.equal(source.state, 'needs_authorization');
  assert.equal(source.code, 'CONTEXT_AUTH_REQUIRED');
  assert.equal(cache.promises.length, 0, 'revocation must not leave a cached title visible');
});

test('an unclassified HTTP 403 on the Inbox window still drops the authorization snapshot', async () => {
  let fail = false;
  const reader = await didaReader(async (_source, request) => {
    if (request.operation === 'projects') return projectRead();
    if (request.operation === 'tasks') return listRead();
    if (request.operation === 'inboxWindow') {
      if (fail) throw Object.assign(new Error('forbidden'), {code: 'CONTEXT_HTTP_ERROR', status: 403});
      return {items: [{id: 'window-1', projectId: 'inbox69a85785', title: '窗口任务', dueAt: iso(NOW.getTime() + DAY), status: 'open'}], truncated: false};
    }
    throw new Error('unexpected request');
  });
  assert.ok((await reader.refreshNow()).promises.some(row => row.sourceItemId === 'window-1'));
  fail = true;
  const cache = await reader.refreshNow();
  const source = cache.sources.find(row => row.id === 'dida');
  assert.equal(source.state, 'needs_authorization');
  assert.equal(source.code, 'CONTEXT_INSUFFICIENT_SCOPE');
  assert.equal(cache.promises.length, 0);
});
