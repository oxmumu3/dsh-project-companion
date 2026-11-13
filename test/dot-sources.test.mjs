import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DOT_SOURCE_IDS,
  dotSourcesRowSchema,
  dotAuthorization,
  dotSourceState,
  createDotSources,
  migrateLegacySources,
  legacyDigest,
  decisionKey,
} from '../src/dot-sources.js';
import {CONTEXT_SOURCES} from '../src/context-service.js';

const KEY = 'a'.repeat(64);
const KEY2 = 'b'.repeat(64);
const clock = () => new Date('2026-11-11T08:00:00.000Z');

function memoryStore(initial = null) {
  let value = initial;
  return {
    async get() { return value === null ? null : structuredClone(value); },
    async put(_key, next) { value = structuredClone(next); },
    peek() { return value; },
  };
}

test('Dot source ids stay in parity with the context contract', () => {
  assert.deepEqual([...DOT_SOURCE_IDS], [...CONTEXT_SOURCES]);
});

test('migration turns an existing legacy row on and a configured-but-unused source off', () => {
  const row = migrateLegacySources({
    legacySources: [{source: 'dida', sessionId: 'session-a', credentialKey: KEY, bindingKey: null}],
    credentialOf: source => source === 'dida' || source === 'gmail' ? {configured: true, key: KEY} : {configured: false, key: null},
    now: clock(),
  });
  assert.equal(dotSourcesRowSchema.safeParse(row).success, true);
  const dida = row.sources.find(item => item.source === 'dida');
  const gmail = row.sources.find(item => item.source === 'gmail');
  const calendar = row.sources.find(item => item.source === 'calendar');
  assert.equal(dida.enabled, true);
  assert.equal(dida.credentialKey, KEY);
  assert.equal(gmail.enabled, false, 'configured without a legacy row is off');
  assert.equal(calendar.enabled, false);
  assert.equal(row.migrated.from, 'project_companion_context');
  // The existing conversation grant is carried over as one explicit row: the
  // same grant, so Family and personal review do not lose access on upgrade.
  assert.deepEqual(dida.allowedSessions.map(item => item.sessionId), ['session-a']);
});

test('the legacy digest is stable across ordering', () => {
  const a = [{source: 'dida', sessionId: 's1', credentialKey: KEY}, {source: 'calendar', sessionId: 's2', credentialKey: KEY2}];
  const b = [{source: 'calendar', sessionId: 's2', credentialKey: KEY2}, {source: 'dida', sessionId: 's1', credentialKey: KEY}];
  assert.equal(legacyDigest(a), legacyDigest(b));
});

test('ready migrates once and never writes the legacy domain again', async () => {
  const store = memoryStore();
  let reads = 0;
  const sources = createDotSources({
    store,
    legacyReader: async () => { reads += 1; return {sources: [{source: 'dida', sessionId: 'session-a', credentialKey: KEY}], credentialOf: () => ({configured: true, key: KEY}), digest: legacyDigest([{source: 'dida'}])}; },
    clock,
  });
  await sources.ready();
  await sources.ready();
  assert.equal(reads, 1);
  const row = await sources.snapshot();
  assert.equal(row.migrated.from, 'project_companion_context');
  assert.equal(row.sources.find(item => item.source === 'dida').enabled, true);
});

test('enabling in another session adds a row and never moves Dot or siblings', async () => {
  const store = memoryStore();
  const sources = createDotSources({store, clock});
  await sources.enable('dida', KEY);
  await sources.addSession('dida', 'session-a', KEY);
  await sources.addSession('dida', 'session-b', KEY);
  const row = await sources.rowOf('dida');
  assert.equal(row.enabled, true);
  assert.deepEqual(row.allowedSessions.map(item => item.sessionId).sort(), ['session-a', 'session-b']);

  await sources.removeSession('dida', 'session-a');
  const next = await sources.rowOf('dida');
  assert.equal(next.enabled, true, 'removing one session keeps Dot on');
  assert.deepEqual(next.allowedSessions.map(item => item.sessionId), ['session-b']);
  assert.equal(dotAuthorization(next, {credentialKey: KEY, configured: true, sessionId: 'session-b'}).allowed, true);
  assert.equal(dotAuthorization(next, {credentialKey: KEY, configured: true, sessionId: 'session-a'}).allowed, false);
});

test('authorization requires the switch, matching credentials and an allowed conversation', () => {
  const row = {source: 'dida', enabled: true, credentialKey: KEY, connectedAt: null, lastReadAt: null, lastReadState: null, allowedSessions: [{sessionId: 'session-a', credentialKey: KEY, addedAt: '2026-11-11T08:00:00.000Z'}]};
  assert.equal(dotAuthorization(row, {credentialKey: KEY, configured: true, background: true}).allowed, true);
  assert.equal(dotAuthorization(row, {credentialKey: KEY, configured: true, sessionId: 'session-a'}).allowed, true);
  assert.equal(dotAuthorization(row, {credentialKey: KEY, configured: true, sessionId: 'session-b'}).allowed, false);
  assert.equal(dotAuthorization(row, {credentialKey: KEY2, configured: true, background: true}).reason, 'credential_changed');
  assert.equal(dotAuthorization({...row, enabled: false}, {credentialKey: KEY, configured: true, background: true}).reason, 'switch_off');
  assert.equal(dotSourceState({...row, enabled: true}, {credentialKey: KEY2, configured: true}), 'needs_authorization');
  assert.equal(dotSourceState(null, {}), 'disconnected');
});

test('decisions are keyed by source and source item, and an expired snooze stops applying', async () => {
  let now = new Date('2026-11-11T08:00:00.000Z');
  const store = memoryStore();
  const sources = createDotSources({store, clock: () => now});
  await sources.decide('dida', 'task-1', 'handled');
  await sources.decide('dida', 'task-2', 'snoozed', '2026-11-11T09:00:00.000Z');
  let active = await sources.activeDecisions(now);
  assert.deepEqual(active.map(row => row.key), [decisionKey('dida', 'task-1'), decisionKey('dida', 'task-2')]);
  now = new Date('2026-11-11T10:00:00.000Z');
  active = await sources.activeDecisions(now);
  assert.deepEqual(active.map(row => row.key), [decisionKey('dida', 'task-1')]);
});

test('unknown sources and malformed keys fail closed', async () => {
  const sources = createDotSources({store: memoryStore(), clock});
  await assert.rejects(sources.enable('not-a-source', KEY), /Invalid source enable/);
  await assert.rejects(sources.enable('dida', 'not-a-key'), /Invalid source enable/);
});
