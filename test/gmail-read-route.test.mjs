import test from 'node:test';
import assert from 'node:assert/strict';
import {createGoogleSuiteRest} from '../src/google-suite-rest.js';
import {buildContextCall, projectDotBulk} from '../src/context-contracts.js';

const gates = {authorize: async () => true, authorizeSync: () => true};
const fixed = new Date('2026-11-12T02:00:00Z');
const json = (value, status = 200) => new Response(JSON.stringify(value), {status, headers: {'content-type': 'application/json'}});
const fixture = fetch => createGoogleSuiteRest({getToken: async () => 'fixture-token', fetch, clock: () => fixed});

test('bounded Gmail list requests metadata only and Dot projection keeps no bodies', async () => {
  const requests = [];
  const t = fixture(async (url, options) => {
    const u = new URL(url);
    requests.push({u, options});
    if (u.pathname.endsWith('/messages')) return json({messages: [{id: 'm1', threadId: 't1'}, {id: 'm2', threadId: 't2'}], nextPageToken: 'more'});
    const id = u.pathname.split('/').at(-1);
    return json({
      id, threadId: 't1', snippet: `preview ${id}`, internalDate: '1762911000000',
      payload: {headers: [{name: 'Subject', value: `主题 ${id}`}, {name: 'From', value: `发件人 ${id} <a${id}@example.test>`}, {name: 'Date', value: 'Thu, 12 Nov 2026 09:30:00 +0800'}], body: {data: Buffer.from('PRIVATE BODY').toString('base64url')}},
    });
  });
  const call = buildContextCall('gmail', {operation: 'search', query: 'after:1762900000 -from:me', limit: 30});
  assert.equal(call.args.pageSize, 30);
  const result = await t.call('gmail', call.name, call.args, gates);
  assert.equal(requests.length, 3);
  assert.equal(requests[0].u.origin, 'https://gmail.googleapis.com');
  assert.equal(requests[0].u.pathname, '/gmail/v1/users/me/messages');
  assert.equal(requests[0].u.searchParams.get('q'), 'after:1762900000 -from:me');
  assert.equal(requests[0].u.searchParams.get('maxResults'), '30');
  assert.equal(requests[0].u.searchParams.get('includeSpamTrash'), 'false');
  for (const item of requests.slice(1)) {
    assert.equal(item.u.searchParams.get('format'), 'metadata');
    assert.equal(item.options.method, 'GET');
    assert.equal(item.options.body, undefined);
  }
  assert.equal(JSON.stringify(result).includes('PRIVATE BODY'), false);
  const bulk = projectDotBulk('gmail', result.value, {operation: 'search'});
  assert.equal(bulk.items.length, 2);
  assert.equal(bulk.truncated, true, 'the provider advertised a next page');
  assert.deepEqual(Object.keys(bulk.items[0]).sort(), ['from', 'id', 'receivedAt', 'snippet', 'subject', 'threadId']);
  assert.equal(bulk.items[0].id, 'm1');
  assert.equal(bulk.items[0].threadId, 't1');
  assert.equal(bulk.items[0].subject, '主题 m1');
  assert.match(bulk.items[0].from, /a m1|am1/);
  assert.equal(JSON.stringify(bulk).includes('PRIVATE BODY'), false);
  assert.equal(bulk.items[0].text, undefined);
  await t.close();
});

test('history with an existing cursor counts additions, while a 204 bodyless response stays undetermined', async () => {
  let mode = 'added';
  const requests = [];
  const t = fixture(async url => {
    const u = new URL(url);
    requests.push(u);
    if (u.pathname.endsWith('/profile')) return json({historyId: '900'});
    if (u.pathname.endsWith('/history')) {
      if (mode === 'empty') return new Response(null, {status: 204});
      return json({history: [{messagesAdded: [{message: {id: 'm-a'}}, {message: {id: 'm-b'}}]}], nextPageToken: ''});
    }
    throw Error('unexpected');
  });
  const added = await t.diagnose('history', gates);
  assert.deepEqual(added.value, {historyId: true, profileStatus: 200, historyList: true, historyStatus: 200, count: 2, hasMore: false});
  assert.equal(requests[0].searchParams.get('fields'), 'historyId');
  // The probe uses the current cursor verbatim. A bodyless 204 does not prove
  // "no changes" and does not prove failure; only the status is recorded.
  assert.equal(requests[1].searchParams.get('startHistoryId'), '900');
  assert.equal(JSON.stringify(added).includes('m-a'), false);
  mode = 'empty';
  const empty = await t.diagnose('history', gates);
  assert.equal(empty.value.historyStatus, 204);
  assert.equal(empty.value.historyList, false);
  assert.equal(empty.value.count, 0);
  await t.close();
});

test('a malformed list response fails closed without inventing an empty mailbox', async () => {
  const t = fixture(async () => json({messages: 'not-an-array'}));
  await assert.rejects(
    t.call('gmail', 'search_threads', {query: 'newer_than:1d', pageSize: 5, includeTrash: false, view: 'THREAD_VIEW_METADATA_ONLY'}, gates),
    error => error.code === 'CONTEXT_PROTOCOL_INVALID',
  );
  await t.close();
});
