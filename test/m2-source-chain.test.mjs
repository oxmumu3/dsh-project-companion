import test from 'node:test';
import assert from 'node:assert/strict';
import {createContextProvider} from '../src/context-provider.js';
import {createGoogleCalendarRest} from '../src/google-calendar-rest.js';
import {createGoogleSuiteRest} from '../src/google-suite-rest.js';
import {createTodayController} from '../src/today-route.js';

test('metrics route reaches real adapters through provider with one gate per source', async () => {
  const urls = [];
  const calendar = createGoogleCalendarRest({
    getToken: async () => 'synthetic-bearer',
    fetch: async url => {
      urls.push(String(url));
      return Response.json({items: [{id: 'evt-1'}], nextPageToken: 'calendar-private-page-token'});
    },
    clock: () => new Date('2026-11-11T09:00:00.000Z'),
  });
  const suite = createGoogleSuiteRest({
    getToken: async () => 'synthetic-bearer',
    fetch: async url => {
      urls.push(String(url));
      if (String(url).includes('/profile')) return new Response(JSON.stringify({historyId: 'history-1'}), {headers: {'content-type': 'application/json'}});
      return Response.json({history: [{id: 'h1', messagesAdded: [{message: {id: 'm1'}}]}], nextPageToken: 'gmail-private-page-token'});
    },
    clock: () => new Date('2026-11-11T09:00:00.000Z'),
  });
  const provider = createContextProvider({calendar, suite, mcp: {catalog: async () => ({}), call: async () => ({})}, useSuite: () => true});
  let gates = 0;
  const controller = createTodayController({
    ledger: {internal: async () => ({}), setState: async () => {}, projection: () => ({promises: []})},
    reader: {
      async refreshNow() {},
      metrics: () => ({calendar: {pages: 1, requests: 1, lastPageHasNextSyncToken: true, events: 0, ms: 2, truncated: false}}),
      snapshot: () => ({promises: [], sources: [{id: 'calendar', state: 'ok'}]}),
    },
    diagnose: async (source, name) => {
      gates += 1;
      const result = await provider.diagnose(source, name, {authorize: async () => true, authorizeSync: () => true});
      return {available: true, ...result.value};
    },
    promptSession: async () => {},
  });
  const value = await controller.metrics();
  assert.equal(gates, 2, 'one gate check per source diagnostic');
  assert.equal(value.probes.calendar.updatedMin.count, 1);
  assert.equal(value.probes.calendar.updatedMin.ok, true);
  assert.equal(value.probes.calendar.updatedMin.sampleLimit, 1);
  assert.equal(value.probes.calendar.updatedMin.hasMore, true);
  assert.equal(value.probes.gmail.count, 1);
  assert.equal(value.probes.gmail.historyList, true);
  assert.equal(value.probes.gmail.hasMore, true);
  assert.equal(urls.length, 3, 'calendar + gmail profile + gmail history');
  assert.equal(JSON.stringify(value).includes('evt-1'), false);
  assert.equal(JSON.stringify(value).includes('m1'), false);
  assert.equal(JSON.stringify(value).includes('history-1'), false);
  assert.equal(JSON.stringify(value).includes('private-page-token'), false);
  await provider.close();
});
