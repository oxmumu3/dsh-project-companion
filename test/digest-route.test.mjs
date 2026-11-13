import test from 'node:test';
import assert from 'node:assert/strict';
import {bindingRevision} from '../src/workbench-scope.js';
import {createDigestRoute, registerDigestRoute} from '../src/digest-route.js';

const connection = {state: 'bound', sessionId: 'synthetic-owner', bindingKey: 'a'.repeat(64)};
const revision = bindingRevision(connection);
const owner = {sessionId: connection.sessionId, setupBindingKey: connection.bindingKey, bindingKey: 'e'.repeat(64)};
const okDigest = (counters) => ({
  async view() { counters.view += 1; return {status: 'ok', view: 'digest'}; },
  async manual(input) { counters.manual += 1; counters.owner = input?.owner; return {status: 'quiet'}; },
  async probe() { counters.probe += 1; return {status: 'ok', source: 'gmail', count: 1, truncated: false, code: null}; },
});

test('digest UI route requires the current owner binding for view and run', async () => {
  const counters = {view: 0, manual: 0, probe: 0};
  const route = createDigestRoute({digest: okDigest(counters), readConnection: async () => connection, readOwner: async () => owner});
  assert.deepEqual((await route.view({expectedBindingRevision: revision})).view, 'digest');
  assert.equal((await route.run({expectedBindingRevision: revision})).status, 'quiet');
  assert.deepEqual(counters.owner, owner);
  assert.equal(counters.view, 1);
  assert.equal(counters.manual, 1);
  assert.equal((await route.probe({expectedBindingRevision: revision})).count, 1);
  assert.equal(counters.probe, 1);
  await assert.rejects(route.run({expectedBindingRevision: 'b'.repeat(64)}), error => error.code === 'DIGEST_UI_ONLY');
  await assert.rejects(route.view({}), error => error.code === 'DIGEST_UI_ONLY');
  assert.equal(counters.manual, 1);
  assert.equal(counters.view, 1);
});

test('changing or missing owner binding blocks manual sending', async () => {
  const counters = {view: 0, manual: 0, probe: 0};
  let current = {...connection};
  const route = createDigestRoute({digest: okDigest(counters), readConnection: async () => current, readOwner: async () => owner});
  current = {state: 'unknown'};
  await assert.rejects(route.run({expectedBindingRevision: revision}), error => error.code === 'DIGEST_UI_ONLY');
  current = {...connection, bindingKey: 'c'.repeat(64)};
  await assert.rejects(route.run({expectedBindingRevision: revision}), error => error.code === 'DIGEST_UI_ONLY');
  assert.equal(counters.manual, 0);
});

test('a click authorized for the prior owner does not enqueue a newly resolved owner', async () => {
  const counters = {view: 0, manual: 0, probe: 0};
  for (const replacement of [
    {...owner, sessionId: 'replacement-owner'},
    {...owner, setupBindingKey: 'd'.repeat(64)},
  ]) {
    const route = createDigestRoute({
      digest: okDigest(counters), readConnection: async () => connection, readOwner: async () => replacement,
    });
    await assert.rejects(route.run({expectedBindingRevision: revision}), error => error.code === 'DIGEST_UI_ONLY');
  }
  assert.equal(counters.manual, 0);
});

test('the registered same-origin route rejects wrong methods/media types and runs only with the binding revision', async () => {
  const counters = {view: 0, manual: 0, probe: 0};
  const routes = new Map();
  const ctx = {
    get: name => name === 'connection' ? {fetch: {register: spec => { routes.set(spec.path, spec); return () => {}; }}} : null,
    effect: fn => { fn(); },
  };
  const stop = registerDigestRoute(ctx, createDigestRoute({digest: okDigest(counters), readConnection: async () => connection, readOwner: async () => owner}));
  assert.equal(typeof stop, 'function');
  const spec = routes.get('/api/project_companion/digest');
  assert.ok(spec);
  const call = body => spec.fetch(new Request('http://localhost/api/project_companion/digest', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)}));
  assert.equal((await call({action: 'run', expectedBindingRevision: revision})).status, 200);
  assert.equal((await call({action: 'view', expectedBindingRevision: revision})).status, 200);
  assert.equal((await call({action: 'probe', expectedBindingRevision: revision})).status, 200);
  assert.equal(counters.manual, 1);
  assert.equal(counters.view, 1);
  assert.equal((await call({action: 'run', expectedBindingRevision: 'b'.repeat(64)})).status, 403);
  assert.equal((await spec.fetch(new Request('http://localhost/api/project_companion/digest', {method: 'GET'}))).status, 405);
  assert.equal((await spec.fetch(new Request('http://localhost/api/project_companion/digest', {method: 'POST', headers: {'content-type': 'text/plain'}, body: '{}'}))).status, 415);
  assert.equal(counters.manual, 1);
});
