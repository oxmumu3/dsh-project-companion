import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools';
import { createScope } from '@deepseek-ai/dsh-scope';
import { ProactiveScheduler } from '../vendor/proactive/lib/scheduler.js';
import { createProjectFollowup } from '../src/project-followup.js';

async function harness(t) {
  const temp = await realpath(await mkdtemp(join(tmpdir(), 'followup-lifecycle-'))), root = join(temp, 'public-project');
  await mkdir(root);
  const ctx = new Context(); await ctx.plugin(SystemPrompt, {}); await ctx.plugin(ToolRuntime, { mode: 'native' });
  ctx.provide('workingDirectory', { get: session => session.header.cwd });
  ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'synthetic', model: 'synthetic' }) });
  const events = [], calls = [], schedulers = [];
  let now = new Date('2026-10-19T16:00:00Z'), entered, release;
  const arrived = new Promise(resolve => { entered = resolve; });
  const agent = {
    id: 'followup-lifetime-source', status: 'idle',
    session: { id: 'followup-lifetime-source', header: { cwd: root }, events, get seq() { return events.length; }, requestHeader: () => ({ config: { provider: 'synthetic', model: 'synthetic' } }) },
    followup(message) {
      agent.status = 'running';
      events.push({ seq: events.length, type: 'turn/start', data: { turn: 7 }, time: now.toISOString() }, { seq: events.length + 1, type: 'user/message', data: message, time: now.toISOString() });
    },
    runMaintenance: async work => work(),
    whenIdle: async () => { entered(); await new Promise(resolve => { release = resolve; }); },
    cancel: () => assert.fail('unloading follow-up must not cancel an ordinary user turn'),
  };
  const scope = createScope(ctx, agent); agent.ctx = scope.ctx;
  ctx.provide('agents', { get: id => id === agent.id ? agent : undefined });
  for (const name of ['project_companion', 'bash', 'send_wechat']) ctx.tools.register(defineTool({
    name, description: 'Synthetic lifecycle probe without external effects', parameters: { action: { type: 'string' }, project: { type: 'string' } },
    output: { schema: { type: 'object', additionalProperties: true }, render: () => [] },
    execute: args => { calls.push({ name, args }); return { ok: true }; },
  }));
  let adapter;
  const lifecycle = await ctx.plugin({ name: 'synthetic-followup-owner', inject: ['tools', 'agents', 'workingDirectory', 'agentDefaultModel'], apply: pluginCtx => {
    // Match index.js: the plugin's broad cleanup is registered before adapter
    // hooks, so sibling automatic disposers can otherwise outrun async close.
    pluginCtx.effect(() => async () => adapter?.close());
    adapter = createProjectFollowup({
      ctx: pluginCtx, clock: () => now, hostTimeZone: 'America/Mexico_City', authorizeRoot: async value => value === root,
      readBinding: async () => ({ userHash: 'a'.repeat(64), botHash: 'b'.repeat(64) }),
      createScheduler: deps => { const scheduler = new ProactiveScheduler(deps); schedulers.push(scheduler); return scheduler; },
    });
  } });
  const finishWake = () => {
    if (!release) return;
    events.push({ seq: events.length, type: 'assistant/message', data: { blocks: [{ type: 'text', text: 'Synthetic read-only progress.' }] }, time: now.toISOString() }, { seq: events.length + 1, type: 'turn/end', data: { turn: 7, reason: { kind: 'completed' } }, time: now.toISOString() });
    agent.status = 'idle'; const resolve = release; release = null; resolve();
  };
  t.after(async () => { finishWake(); await adapter.close(); await lifecycle.dispose(); await scope.dispose(); await ctx.fiber.dispose(); await rm(temp, { recursive: true, force: true }); });
  await adapter.configure({ root, sessionId: agent.id, everyMinutes: 30, projectLabel: 'Synthetic public project' });
  await schedulers[0].driveChain;
  now = new Date(now.getTime() + 30 * 60000); schedulers[0].requestDrive(); await arrived;
  let count = 0;
  const tool = (name, args = {}) => ctx.tools.execute({ callId: `followup-life-${++count}`, name, arguments: args, agent, signal: new AbortController().signal });
  return { root, ctx, agent, adapter, lifecycle, events, calls, schedulers, tool, finishWake };
}

test('actual plugin unload preserves read-only follow-up tools and reclaim until the active upstream wake settles', async t => {
  const h = await harness(t);
  for (const action of ['memory', 'digest']) assert.equal((await h.tool('project_companion', { action, project: h.root })).isError, false);
  let unloaded = false;
  const unloading = h.lifecycle.dispose().then(() => { unloaded = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(unloaded, false);
  assert.equal((await h.tool('bash')).isError, true, 'automatic fiber disposal cannot release writes while WakeDriver is waiting');
  assert.equal((await h.tool('send_wechat')).isError, true);
  assert.equal(Boolean(h.ctx.tools.get('proactive_reclaim', h.agent)), true, 'the guarded turn keeps its silent conclusion capability until drain');
  h.finishWake(); await h.schedulers[0].driveChain; await unloading;
  assert.equal((await h.tool('bash')).isError, false);
  assert.deepEqual(h.calls.map(call => call.name), ['project_companion', 'project_companion', 'bash']);
});

test('an ordinary new user turn is unrestricted while the old wake driver drains during plugin unload', async t => {
  const h = await harness(t);
  const unloading = h.lifecycle.dispose();
  await new Promise(resolve => setImmediate(resolve));
  h.events.push({ seq: h.events.length, type: 'turn/end', data: { turn: 7, reason: { kind: 'completed' } } }, { seq: h.events.length + 1, type: 'turn/start', data: { turn: 8 } }, { seq: h.events.length + 2, type: 'user/message', data: { id: 'ordinary-next-turn', source: { kind: 'user' }, content: [{ type: 'text', text: 'An independently authorized ordinary user turn.' }] } });
  assert.equal((await h.tool('bash')).isError, false);
  h.finishWake(); await h.schedulers[0].driveChain; await unloading;
});
