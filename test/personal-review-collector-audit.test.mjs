import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPersonalReviewCollector } from '../src/personal-review-collect.js';
import { createPersonalContext } from '../src/context-service.js';
import { readProjectFiles } from '../src/sources.js';

const caller = { sessionId: 'collector-audit', cwd: '/synthetic/audit' };
const input = { caller, sources: ['gmail'], projects: [], from: '2026-10-28T00:00:00.000Z', to: '2026-10-29T00:00:00.000Z', kind: 'daily', guard: async () => true };
const collectWith = overrides => createPersonalReviewCollector({ query: async () => ({ items: [] }), readProject: async () => [], ...overrides });

test('collector audit: quoted JSON credentials and Bearer values never enter model evidence', async () => {
  const collect = collectWith({ readMemory: async () => [{ id: 'synthetic-note', source: { kind: 'user' }, text: '{"api_key": "SYNTHETIC-JSON-SECRET"}\nAuthorization: Bearer SYNTHETIC-BEARER-SECRET', at: input.to }] });
  const result = await collect({ ...input, sources: [], projects: ['/synthetic/audit'] });
  assert.equal(result.evidence.length, 1);
  assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC-JSON-SECRET|SYNTHETIC-BEARER-SECRET/);
});

test('collector audit: negated, conditional and quoted day counts do not become reminder deadlines', async () => {
  for (const text of ['You do not need to respond within 3 days. This is not a deadline.', 'If you accept within 3 days, we can discuss a new date.', 'The example says "respond within 3 days".']) {
    const collect = collectWith({ query: async () => ({ items: [{ id: 'synthetic-mail', title: 'Informational mail', text, createdAt: input.from }] }) });
    const result = await collect(input);
    assert.equal(result.evidence[0].dueAt, undefined, text);
    assert.equal(result.evidence[0].dueAtBasis, undefined, text);
  }
});

test('collector audit: known out-of-range Gmail is excluded and incomplete timing is disclosed', async () => {
  for (const dated of [true, false]) {
    const collect = collectWith({ query: async () => ({ items: [{ id: 'synthetic-mail', title: 'Old or undated mail', text: 'Synthetic notification', ...(dated ? { createdAt: '2020-01-01T00:00:00.000Z' } : {}) }] }) });
    const result = await collect(input);
    assert.equal(result.coverage[0].status, 'partial');
    if (dated) assert.equal(result.evidence.length, 0);
  }
});

test('collector audit: a provider overrun cannot exceed the requested flomo or total evidence bound', async () => {
  const collect = collectWith({ query: async () => ({ items: Array.from({ length: 101 }, (_, i) => ({ id: `memo-${i}`, title: 'Synthetic memo', text: 'Synthetic memo body', createdAt: input.from })) }) });
  const result = await collect({ ...input, sources: ['flomo'] });
  assert.ok(result.evidence.length <= 5);
  assert.ok(result.evidence.length <= 100);
  assert.notEqual(result.coverage[0].status, 'ok');
});

test('collector audit: a body response cannot replace the enumerated resource with a foreign id', async () => {
  const collect = collectWith({ query: async (_caller, args) => ({ items: args.operation === 'read'
    ? [{ id: 'foreign-mail', title: 'Unrequested mail', text: 'FOREIGN-BODY-CANARY', createdAt: input.from }]
    : [{ id: 'requested-mail', title: 'Requested metadata', text: 'Bound metadata', createdAt: input.from }] }) });
  const result = await collect(input);
  assert.equal(result.evidence.length, 1);
  assert.equal(result.coverage[0].status, 'partial');
  assert.doesNotMatch(JSON.stringify(result), /FOREIGN-BODY-CANARY/);
});

test('collector audit: known Dida list ids bind task reads and returned tasks', async () => {
  const calls = [];
  const collect = collectWith({ query: async (_caller, args) => {
    calls.push(args);
    return { items: args.operation === 'projects' ? [{ id: 'known-list', title: 'Synthetic title' }] : [{ id: 'task-one', projectId: 'foreign-list', title: 'Wrong list task', text: 'FOREIGN-LIST-CANARY' }] };
  } });
  const result = await collect({ ...input, sources: ['dida'] });
  assert.equal(calls[1].projectId, 'known-list');
  assert.equal(calls[1].query, undefined);
  assert.equal(calls[1].limit, 3);
  assert.doesNotMatch(JSON.stringify(result), /FOREIGN-LIST-CANARY/);
  assert.notEqual(result.coverage[0].status, 'ok');
});

test('collector audit: valid all-day calendar events survive the bounded context path', async () => {
  let stored, calendarTimeZone = 'UTC';
  const context = createPersonalContext({ store: { get: async () => stored, put: async (_key, value) => { stored = value; } },
    readConfig: () => ({}), credentialState: () => ({ configured: true, key: 'a'.repeat(64) }), readBinding: async () => ({ kind: 'unbound' }),
    transport: { catalog: async () => ({ tools: [{ name: 'list_events', inputSchema: { type: 'object' } }] }),
      call: async () => ({ value: { items: [{ id: 'all-day', summary: 'Synthetic holiday', start: { date: '2026-10-29' }, end: { date: '2026-10-30' }, ...(calendarTimeZone ? { calendarTimeZone } : {}) }] } }) },
  });
  try {
    await context.act(caller, { action: 'connect', source: 'calendar', userRequested: true });
    const result = await context.act(caller, { action: 'query', source: 'calendar', operation: 'upcoming', from: '2026-10-29T00:00:00.000Z', to: '2026-10-30T00:00:00.000Z', limit: 10, userRequested: true });
    assert.equal(result.items.length, 1);
    assert.match(result.items[0].text, /2026-10-29/);
    calendarTimeZone = undefined;
    await assert.rejects(context.act(caller, { action: 'query', source: 'calendar', operation: 'upcoming', from: '2026-10-29T00:00:00.000Z', to: '2026-10-30T00:00:00.000Z', limit: 10, userRequested: true }), { code: 'CONTEXT_SCOPE_VIOLATION' });
  } finally { await context.close(); }
});

test('collector audit: five sources and five fixed projects stay under 100 evidence items', async () => {
  const collect = collectWith({
    query: async (_caller, args) => {
      if (args.operation === 'read') return { items: [{ id: args.id, title: 'Synthetic body', text: 'Synthetic content', createdAt: input.from, updatedAt: input.from }] };
      const count = args.source === 'dida' ? args.operation === 'projects' ? 5 : 3 : args.source === 'flomo' ? 5 : 10;
      return { items: Array.from({ length: count }, (_, i) => ({ id: `${args.source}-${args.projectId ?? args.query ?? ''}-${i}`, projectId: args.projectId, title: `Synthetic ${i}`, text: 'Synthetic content', createdAt: input.from, updatedAt: input.from })) };
    },
    readProject: async () => ['README.md', '.agent/memory/context.md', '.agent/memory/progress.md'].map(path => ({ path, status: 'ok', text: 'Synthetic project evidence', modifiedAt: input.to })),
    readMemory: async () => Array.from({ length: 5 }, (_, i) => ({ id: `memory-${i}`, text: 'Synthetic memory', source: { kind: 'user' }, at: input.to })),
  });
  const result = await collect({ ...input, sources: ['gmail', 'calendar', 'drive', 'flomo', 'dida'], projects: Array.from({ length: 5 }, (_, i) => `/synthetic/project-${i}`) });
  assert.ok(result.evidence.length <= 100);
  assert.ok(result.evidence.length >= 70);
});

test('collector audit: actual fixed file reader rejects symlink bodies before collection', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'personal-review-audit-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  await mkdir(join(project, '.agent', 'memory'), { recursive: true });
  await writeFile(join(root, 'secret.txt'), 'SYNTHETIC-SYMLINK-SECRET');
  await symlink(join(root, 'secret.txt'), join(project, 'README.md'));
  await writeFile(join(project, '.agent', 'memory', 'progress.md'), 'Synthetic progress');
  await writeFile(join(project, '.agent', 'memory', 'context.md'), 'Synthetic context');
  const collect = collectWith({ readProject: async (_caller, selected) => ({ sources: await readProjectFiles(selected) }) });
  const result = await collect({ ...input, sources: [], projects: [project] });
  assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC-SYMLINK-SECRET/);
  assert.equal(result.evidence.length, 2);
  assert.equal(result.coverage[0].status, 'partial');
});
