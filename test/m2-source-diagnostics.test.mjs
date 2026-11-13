import test from 'node:test';
import assert from 'node:assert/strict';
import {createContextProvider} from '../src/context-provider.js';
import {createGoogleCalendarRest} from '../src/google-calendar-rest.js';
import {createGoogleSuiteRest} from '../src/google-suite-rest.js';
import {createTodayController} from '../src/today-route.js';

const gates = {authorize: async () => true, authorizeSync: () => true};

test('provider dispatches only the fixed diagnostics to the real adapter', async () => {
  const calendar = {catalog: async () => ({tools: []}), call: async () => ({}), diagnose: async name => ({value: {ok: true, httpStatus: 200, count: 0}, name})};
  const suite = {catalog: async () => ({}), call: async () => ({}), diagnose: async name => ({value: {historyId: true, historyList: true, count: 1}, name})};
  const mcp = {catalog: async () => ({}), call: async () => ({}), close: async () => {}};
  const provider = createContextProvider({calendar, suite, mcp, useSuite: () => true});
  const c = await provider.diagnose('calendar', 'updated_min', gates);
  assert.equal(c.value.count, 0);
  assert.equal(c.name, 'updated_min');
  const g = await provider.diagnose('gmail', 'history', gates);
  assert.equal(g.value.count, 1);
  await assert.rejects(async () => provider.diagnose('dida', 'updated_min', gates), error => error.code === 'CONTEXT_UNSUPPORTED_OPERATION');
  await assert.rejects(async () => provider.diagnose('calendar', 'history', gates), error => error.code === 'CONTEXT_UNSUPPORTED_OPERATION');
});

test('calendar updatedMin diagnosis uses one fixed seven-day window and reports sample coverage', async () => {
  const urls = [];
  const fixed = new Date('2026-11-11T09:00:00.000Z');
  const transport = createGoogleCalendarRest({
    getToken: async () => 'synthetic-bearer',
    fetch: async url => {
      urls.push(String(url));
      return Response.json({items: [{id: 'evt-1'}], nextPageToken: 'calendar-private-page-token'});
    },
    clock: () => fixed,
  });
  const result = await transport.diagnose('updated_min', gates);
  assert.equal(urls.length, 1);
  const url = new URL(urls[0]);
  assert.equal(url.searchParams.get('timeMin'), '2026-11-11T09:00:00.000Z');
  assert.equal(url.searchParams.get('timeMax'), '2026-11-18T09:00:00.000Z');
  assert.equal(url.searchParams.get('updatedMin'), '2026-11-11T09:00:00.000Z');
  assert.equal(url.searchParams.get('maxResults'), '1');
  assert.equal(url.searchParams.has('pageToken'), false);
  assert.equal(url.searchParams.get('fields'), 'nextPageToken,items(id)');
  assert.deepEqual(result.value, {ok: true, httpStatus: 200, count: 1, sampleLimit: 1, hasMore: true});
  assert.equal(JSON.stringify(result).includes('evt-1'), false);
  assert.equal(JSON.stringify(result).includes('calendar-private-page-token'), false);
  await transport.close();
});

test('gmail profile/history diagnosis projects only cursor and IDs and returns counts', async () => {
  const urls = [];
  const transport = createGoogleSuiteRest({
    getToken: async () => 'synthetic-bearer',
    fetch: async url => {
      urls.push(String(url));
      if (String(url).includes('/profile')) return new Response(JSON.stringify({historyId: 'history-1'}), {headers: {'content-type': 'application/json'}});
      return new Response(JSON.stringify({history: [{id: 'h1', messagesAdded: [{message: {id: 'm1'}}, {message: {id: 'm2'}}]}, {id: 'h2', messagesAdded: [{message: {id: 'm1'}}]}], nextPageToken: 'next-page'}), {headers: {'content-type': 'application/json'}});
    },
    clock: () => new Date('2026-11-11T09:00:00.000Z'),
  });
  const result = await transport.diagnose('history', gates);
  assert.equal(urls.length, 2);
  assert.match(urls[0], /profile\?fields=historyId$/);
  assert.match(urls[1], /history\?startHistoryId=history-1/);
  assert.match(urls[1], /fields=history\(messagesAdded\(message\(id\)\)\)/);
  assert.deepEqual(result.value, {historyId: true, profileStatus: 200, historyList: true, historyStatus: 200, count: 2, hasMore: true});
  assert.equal(JSON.stringify(result).includes('m1'), false);
 assert.equal(result.value.count, 2, 'duplicate message IDs count once');
  await transport.close();
});

test('gmail history diagnosis distinguishes valid empty pages from invalid replies', async t => {
  const cases = [
    ['omitted history', () => Response.json({}), 200, true],
    ['empty history array', () => Response.json({history: []}), 200, true],
    ['omitted or empty additions', () => Response.json({history: [{}, {messagesAdded: []}]}), 200, true],
    ['no content', () => new Response(null, {status: 204}), 204, false],
    ['expired cursor', () => Response.json({error: {code: 404}}, {status: 404}), 404, false],
    ['invalid JSON', () => new Response('invalid synthetic JSON'), 200, false],
    ['non-object JSON', () => Response.json([]), 200, false],
    ['error envelope', () => Response.json({error: {code: 502}}), 200, false],
    ['invalid history array', () => Response.json({history: {}}), 200, false],
    ['oversized history page', () => Response.json({history: Array(501).fill({})}), 200, false],
    ['invalid page token', () => Response.json({nextPageToken: 9}), 200, false],
    ['invalid additions', () => Response.json({history: [{messagesAdded: null}]}), 200, false],
    ['invalid entry with otherwise countable data', () => Response.json({
      history: [{messagesAdded: [{message: {id: 'synthetic-message'}}, {message: {id: 42}}]}],
      nextPageToken: 'synthetic-next',
    }), 200, false],
  ];
  for (const [name, historyResponse, historyStatus, historyList] of cases) {
    await t.test(name, async () => {
      const transport = createGoogleSuiteRest({
        getToken: async () => 'synthetic-bearer',
        fetch: async url => String(url).includes('/profile')
          ? Response.json({historyId: 'synthetic-cursor'})
          : historyResponse(),
      });
      try {
        const {value} = await transport.diagnose('history', gates);
        assert.deepEqual(value, {
          historyId: true, profileStatus: 200, historyList, historyStatus, count: 0, hasMore: false,
        });
      } finally {
        await transport.close();
      }
    });
  }
});
