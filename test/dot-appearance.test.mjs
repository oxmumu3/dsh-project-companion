import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const plain = value => JSON.parse(JSON.stringify(value));
const ready = (mode = 'native', extra = {}) => ({ status: 'ready', writable: true, revision: 7, value: { dotAppearance: mode }, base: {}, user: {}, ...extra });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

async function load(options = {}) {
  let descriptor;
  const forbidden = [];
  const storage = new Proxy({}, { get: (_target, key) => { forbidden.push(`localStorage.${String(key)}`); throw new Error('appearance must use the native config form'); } });
  const context = { window: { __ModuleLoader__: { load: value => { descriptor = value; } }, localStorage: storage }, localStorage: storage };
  vm.runInNewContext(await readFile(new URL('../src/client.js', import.meta.url), 'utf8'), context);
  const module = descriptor.factory(name => name === 'react' ? { createElement() { throw new Error('controller must not render React'); } } : {});
  assert.equal(typeof module.createDotAppearance, 'function', 'client factory must export createDotAppearance(ctx)');

  let snapshot = options.snapshot ?? ready();
  const listeners = new Set(), mutations = [], layers = [], lookups = [], notifications = [];
  let mutation = options.mutate;
  const publish = value => { snapshot = value; for (const fn of [...listeners]) fn(); };
  const form = {
    getSnapshot: () => { if (options.snapshotThrows) throw new Error('sensitive internal form failure'); return snapshot; },
    subscribe: fn => { if (options.subscribeThrows) throw new Error('sensitive internal subscription failure'); listeners.add(fn); return () => listeners.delete(fn); },
    mutate: async (ops, revision) => {
      mutations.push({ ops: plain(ops), revision });
      if (mutation) return mutation(ops, revision);
      publish({ ...snapshot, revision: snapshot.revision + 1, value: { ...snapshot.value, dotAppearance: ops[0].value } });
      return true;
    },
  };
  const theme = {
    overrideTokens: (owner, pairs) => {
      if (options.overrideThrows) throw new Error('unsupported token override');
      const layer = { owner, pairs: plain(pairs), active: true, disposals: 0 };
      layers.push(layer);
      return () => {
        layer.disposals++;
        if (options.disposeThrows === true || layer.disposals <= options.disposeThrows) throw new Error('sensitive internal disposer failure');
        layer.active = false;
      };
    },
    ...Object.fromEntries(['setTheme', 'setFontFamily', 'setFontSize'].map(name => [name, () => { forbidden.push(name); throw new Error('do not change account or built-in appearance preferences'); }])),
  };
  if (options.noOverride) delete theme.overrideTokens;
  const forms = { get: name => { assert.equal(name, 'project-companion'); return options.noForm ? undefined : form; } };
  const ctx = options.direct ? { configForms: forms, theme: options.noTheme ? undefined : theme } : {
    get: (name, required) => {
      lookups.push({ name, required });
      if (options.lookupThrows) throw new Error('optional service unavailable');
      return name === 'configForms' ? forms : name === 'theme' && !options.noTheme ? theme : undefined;
    },
  };
  const controller = module.createDotAppearance(ctx);
  const unsubscribe = controller.subscribe(() => notifications.push(plain(controller.getSnapshot())));
  return {
    controller, form, layers, listeners, mutations, lookups, forbidden, notifications, publish,
    get snapshot() { return snapshot; },
    setMutation: fn => { mutation = fn; },
    active: () => layers.filter(layer => layer.active),
    close: () => { unsubscribe(); controller.close(); },
  };
}

test('native is the default and obtains optional services without changing global appearance preferences', async () => {
  const c = await load({ snapshot: ready(undefined, { value: {} }) });
  try {
    const state = c.controller.getSnapshot();
    assert.equal(state.mode, 'native'); assert.equal(state.applied, false);
    assert.equal(state.available, true); assert.equal(state.writable, true);
    assert.equal(state.busy, false); assert.equal(state.error, '');
    assert.equal(c.layers.length, 0); assert.equal(c.mutations.length, 0);
    assert.ok(c.lookups.some(call => call.name === 'configForms' && call.required === false));
    assert.ok(c.lookups.some(call => call.name === 'theme' && call.required === false));
    assert.deepEqual(c.forbidden, []);
  } finally { c.close(); }
});

test('explicit selection saves only dotAppearance with its current revision and applies after authoritative acceptance', async () => {
  const gate = deferred(), c = await load();
  c.setMutation(() => gate.promise);
  try {
    const pending = c.controller.setAppearance('dot');
    assert.equal(typeof pending?.then, 'function');
    assert.equal(c.controller.getSnapshot().busy, true);
    assert.equal(c.controller.getSnapshot().mode, 'native'); assert.equal(c.active().length, 0);
    assert.deepEqual(c.mutations, [{ ops: [{ op: 'set', path: ['dotAppearance'], value: 'dot' }], revision: 7 }]);
    c.publish({ ...ready('dot'), revision: 8 }); gate.resolve(true); await pending;
    assert.equal(c.controller.getSnapshot().mode, 'dot'); assert.equal(c.controller.getSnapshot().applied, true);
    assert.equal(c.controller.getSnapshot().busy, false); assert.equal(c.active().length, 1);
    assert.ok(c.notifications.some(state => state.busy));
    assert.ok(c.notifications.some(state => state.applied)); assert.deepEqual(c.forbidden, []);
  } finally { c.close(); }
  const noEcho = await load({ mutate: async () => true });
  try {
    await noEcho.controller.setAppearance('dot');
    assert.equal(noEcho.controller.getSnapshot().mode, 'native'); assert.equal(noEcho.active().length, 0);
    noEcho.publish({ ...ready('dot'), revision: 8 });
    assert.equal(noEcho.controller.getSnapshot().applied, true);
  } finally { noEcho.close(); }
});

test('a saved read-only Dot preference still restores one token layer while new selection remains disabled', async () => {
  const c = await load({ direct: true, snapshot: ready('dot', { writable: false }) });
  try {
    const state = c.controller.getSnapshot();
    assert.equal(state.mode, 'dot'); assert.equal(state.applied, true); assert.equal(state.writable, false);
    assert.equal(c.active().length, 1); assert.equal(c.layers[0].owner, 'dsh-project-companion');
    const tokens = JSON.stringify(c.layers[0].pairs);
    assert.match(tokens, /--dsw-font-family/);
    assert.match(tokens, /--dsw-[^"\s]*(?:radius|rounded)/);
    assert.match(tokens, /--dsw-[^"\s]*(?:bg|background|label|color)/);
    for (const [name, pair] of Object.entries(c.layers[0].pairs)) {
      assert.match(name, /^--dsw-/);
      assert.equal(typeof pair.light, 'string'); assert.equal(typeof pair.dark, 'string');
      assert.doesNotMatch(`${pair.light} ${pair.dark}`, /https?:|url\(/i);
    }
    await c.controller.setAppearance('native');
    assert.equal(c.mutations.length, 0); assert.equal(c.active().length, 1);
    assert.deepEqual(c.forbidden, []);
  } finally { c.close(); }
});

test('authoritative modes never stack layers and uncertain restoration remains visible and retryable', async () => {
  const c = await load();
  try {
    c.publish(ready('dot'));
    assert.equal(c.active().length, 1);
    c.publish({ ...ready('dot'), revision: 8 }); c.publish({ ...ready('dot'), revision: 9 });
    assert.equal(c.layers.length, 1); assert.equal(c.active().length, 1);
    c.publish({ ...ready('native'), revision: 10 });
    assert.equal(c.active().length, 0); assert.equal(c.layers[0].disposals, 1);
    assert.equal(c.controller.getSnapshot().mode, 'native'); assert.equal(c.controller.getSnapshot().applied, false);
    assert.equal(c.mutations.length, 0);
  } finally { c.close(); }
  const uncertain = await load({ snapshot: ready('dot'), disposeThrows: 2 });
  try {
    uncertain.publish({ ...ready('native'), revision: 8 });
    assert.equal(uncertain.active().length, 1);
    assert.equal(uncertain.controller.getSnapshot().mode, 'dot'); assert.equal(uncertain.controller.getSnapshot().applied, true);
    assert.equal(uncertain.controller.getSnapshot().restorationUncertain, true); assert.ok(uncertain.controller.getSnapshot().error);
    uncertain.publish({ ...ready('native'), revision: 9 });
    assert.ok(uncertain.controller.getSnapshot().error, 'a repeated native snapshot must not erase an unresolved restoration failure');
    await uncertain.controller.setAppearance('native');
    assert.equal(uncertain.active().length, 0); assert.equal(uncertain.controller.getSnapshot().mode, 'native');
    assert.equal(uncertain.controller.getSnapshot().restorationUncertain, false); assert.equal(uncertain.controller.getSnapshot().error, '');
    assert.equal(uncertain.mutations.length, 0, 'retrying a saved native preference only retries the token disposer');
  } finally { uncertain.close(); }
});

test('a rejected mutation preserves the currently applied Dot layer and exposes an error', async () => {
  const c = await load({ snapshot: ready('dot'), mutate: async () => false });
  try {
    await c.controller.setAppearance('native');
    assert.equal(c.controller.getSnapshot().mode, 'dot'); assert.equal(c.controller.getSnapshot().applied, true);
    assert.equal(c.controller.getSnapshot().busy, false); assert.ok(c.controller.getSnapshot().error);
    assert.equal(c.layers.length, 1); assert.equal(c.layers[0].disposals, 0); assert.equal(c.active().length, 1);
  } finally { c.close(); }
});

test('a thrown mutation keeps native appearance and is surfaced as state instead of escaping the controller', async () => {
  const c = await load({ mutate: async () => { throw new Error('revision write failed'); } });
  try {
    await assert.doesNotReject(c.controller.setAppearance('dot'));
    assert.equal(c.controller.getSnapshot().mode, 'native'); assert.equal(c.active().length, 0);
    assert.equal(c.controller.getSnapshot().busy, false); assert.ok(c.controller.getSnapshot().error);
    assert.equal(c.mutations.length, 1); assert.deepEqual(c.forbidden, []);
  } finally { c.close(); }
});

test('rapid duplicate selection shares one pending native-form mutation', async () => {
  const gate = deferred(), c = await load({ mutate: () => gate.promise });
  try {
    const first = c.controller.setAppearance('dot'), second = c.controller.setAppearance('dot');
    assert.equal(c.mutations.length, 1); assert.equal(c.controller.getSnapshot().busy, true);
    assert.equal(c.active().length, 0);
    c.publish({ ...ready('dot'), revision: 8 }); gate.resolve(true); await Promise.all([first, second]);
    assert.equal(c.layers.length, 1); assert.equal(c.controller.getSnapshot().busy, false);
  } finally { c.close(); }
});

test('missing optional host APIs degrade safely to unavailable native appearance', async () => {
  for (const options of [{ noForm: true }, { noTheme: true }, { noOverride: true }, { lookupThrows: true }, { snapshotThrows: true }, { subscribeThrows: true }]) {
    const c = await load(options);
    try {
      assert.equal(c.controller.getSnapshot().mode, 'native'); assert.equal(c.controller.getSnapshot().applied, false);
      assert.equal(c.controller.getSnapshot().available, false); assert.equal(c.controller.getSnapshot().writable, false);
      await assert.doesNotReject(c.controller.setAppearance('dot'));
      assert.equal(c.mutations.length, 0); assert.equal(c.layers.length, 0); assert.deepEqual(c.forbidden, []);
    } finally { c.close(); }
  }
  for (const revision of [undefined, null]) {
    const c = await load({ snapshot: ready('native', { revision }) });
    try {
      assert.equal(c.controller.getSnapshot().writable, false, 'a CAS write requires a snapshot revision');
      await c.controller.setAppearance('dot'); assert.equal(c.mutations.length, 0);
    } finally { c.close(); }
  }
});

test('token API failure falls back without crashing the whole client or changing the saved preference', async () => {
  const c = await load({ snapshot: ready('dot'), overrideThrows: true });
  try {
    assert.equal(c.controller.getSnapshot().applied, false); assert.equal(c.controller.getSnapshot().available, false);
    assert.ok(c.controller.getSnapshot().error); assert.equal(c.active().length, 0);
    assert.equal(c.snapshot.value.dotAppearance, 'dot'); assert.equal(c.mutations.length, 0);
    c.publish({ ...ready('dot'), revision: 8 });
    assert.ok(c.controller.getSnapshot().error, 'the failure remains visible while its theme API is unavailable');
    assert.deepEqual(c.forbidden, []);
  } finally { c.close(); }
});

test('leaving ready state withdraws the token layer and returning ready restores the saved preference', async () => {
  const c = await load({ snapshot: ready('dot') });
  try {
    c.publish({ ...ready('dot'), status: 'loading' });
    assert.equal(c.active().length, 0); assert.equal(c.layers[0].disposals, 1);
    assert.equal(c.controller.getSnapshot().applied, false); assert.equal(c.controller.getSnapshot().writable, false);
    await c.controller.setAppearance('native'); assert.equal(c.mutations.length, 0);
    c.publish({ ...ready('dot'), revision: 8 });
    assert.equal(c.active().length, 1); assert.equal(c.controller.getSnapshot().applied, true);
  } finally { c.close(); }
});

test('close withdraws its layer once, removes the form listener, and ignores queued notifications', async () => {
  const c = await load({ snapshot: ready('dot') });
  const queued = [...c.listeners];
  c.controller.close(); c.controller.close();
  const notificationCount = c.notifications.length;
  assert.equal(c.listeners.size, 0); assert.equal(c.active().length, 0); assert.equal(c.layers[0].disposals, 1);
  c.publish({ ...ready('dot'), revision: 8 }); queued.forEach(fn => fn());
  await c.controller.setAppearance('native');
  assert.equal(c.mutations.length, 0); assert.equal(c.layers.length, 1); assert.equal(c.notifications.length, notificationCount);
  c.close();
  const uncertain = await load({ snapshot: ready('dot'), disposeThrows: true });
  uncertain.controller.close();
  assert.equal(uncertain.listeners.size, 0); assert.equal(uncertain.active().length, 1);
  assert.equal(uncertain.controller.getSnapshot().mode, 'dot'); assert.equal(uncertain.controller.getSnapshot().applied, true);
  assert.equal(uncertain.controller.getSnapshot().restorationUncertain, true); assert.ok(uncertain.controller.getSnapshot().error);
  uncertain.controller.close(); assert.equal(uncertain.layers[0].disposals, 2, 'close may retry an unresolved disposer');
  uncertain.close();
});

test('close during a save prevents its late accepted response from installing a new token layer', async () => {
  const gate = deferred(), c = await load({ mutate: () => gate.promise });
  const pending = c.controller.setAppearance('dot'), queued = [...c.listeners];
  c.controller.close(); const notificationCount = c.notifications.length;
  c.publish({ ...ready('dot'), revision: 8 }); queued.forEach(fn => fn());
  gate.resolve(true); await pending;
  assert.equal(c.layers.length, 0); assert.equal(c.listeners.size, 0);
  assert.equal(c.notifications.length, notificationCount); assert.deepEqual(c.forbidden, []);
  c.close();
});
