import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools';
import { createScope } from '@deepseek-ai/dsh-scope';

async function api() {
  const module = await import('../src/welcome-guard.js').catch(() => ({}));
  assert.equal(typeof module.createWelcomeGuard, 'function', 'welcome turns need a hard read-only guard');
  return module;
}
async function harness(t, options = {}) {
  const { createWelcomeGuard } = await api();
  const ctx = new Context();
  await ctx.plugin(SystemPrompt, {});
  await ctx.plugin(ToolRuntime, { mode: options.mode ?? 'native' });
  let cwd = '/synthetic/welcome-source', authorized = true, transportRuns = 0;
  const events = [], inbox = new Map(), agents = new Map(), executed = [], cancellations = [], idleWaiters = [];
  const agent = {
    id: 'welcome-source-session', status: 'idle',
    session: { id: 'welcome-source-session', header: { cwd }, events },
    inbox: { remove: id => inbox.delete(id) },
    cancel: (...args) => cancellations.push(args),
    whenIdle: () => agent.status === 'idle' ? Promise.resolve() : new Promise(resolve => idleWaiters.push(resolve)),
  };
  const scope = createScope(ctx, agent); agent.ctx = scope.ctx; agents.set(agent.id, agent);
  ctx.provide('agents', { get: id => agents.get(id) });
  ctx.provide('workingDirectory', { get: () => cwd });
  if (options.mode === 'ptc') ctx.provide('ptcRuntime', { language: 'typescript', resolve: input => input, release: async () => {}, run: async () => { transportRuns++; return { logs: [], result: 'synthetic' }; } });
  for (const name of ['project_companion', 'send_wechat', 'bash']) ctx.tools.register(defineTool({
    name, description: 'Synthetic guard test; no external side effects',
    parameters: { action: { type: 'string' }, project: { type: 'string' }, detail: { type: 'string' } },
    output: { schema: { type: 'object', additionalProperties: true }, render: () => [] },
    execute: args => { executed.push({ name, args }); return { ok: true }; },
  }));
  const observed = [];
  const authorize = async entry => { observed.push(entry); return options.authorize ? options.authorize(entry) : authorized; };
  let guard, lifecycle;
  if (options.pluginOwned) lifecycle = await ctx.plugin({ name: 'synthetic-welcome-owner', inject: ['tools', 'agents', 'workingDirectory'], apply: pluginCtx => { guard = createWelcomeGuard({ ctx: pluginCtx, authorize }); } });
  else guard = createWelcomeGuard({ ctx, authorize });
  const message = { id: 'welcome-message-1', source: { kind: 'user' }, content: [{ type: 'text', text: 'Read the selected project only.' }] };
  const roots = ['/synthetic/selected-one', '/synthetic/selected-two'];
  const bindingKey = 'a'.repeat(64);
  const admit = (overrides = {}) => guard.admit({ agent, message, roots, bindingKey, ...overrides });
  const insert = (input = message) => { inbox.set(input.id, input); ctx.emit('agent/inbox/inserted', { agent, message: input }); };
  const claim = (input = message, turn = 7) => { inbox.delete(input.id); ctx.emit('agent/inbox/claimed', { agent, message: input, turn }); };
  const start = (turn = 7, input = message) => {
    agent.status = 'running';
    events.push({ type: 'turn/start', data: { turn } });
    ctx.emit('agent/status', { agent, status: 'running' });
    claim(input, turn);
    events.push({ type: 'user/message', data: { ...input, turn } });
  };
  const finish = (turn = 7) => {
    const event = { type: 'turn/end', data: { turn, reason: { kind: 'completed' } } };
    events.push(event); ctx.emit('session/event', agent.session, event);
    agent.status = 'idle'; ctx.emit('agent/status', { agent, status: 'idle' });
    for (const resolve of idleWaiters.splice(0)) resolve();
  };
  let count = 0;
  const tool = (name, args = {}) => ctx.tools.execute({ callId: `welcome-call-${++count}`, name, arguments: args, agent, signal: new AbortController().signal });
  const step = (messages = [], turn = 7) => ctx.serial('agent/pre-step', { agent, messages, turn, step: 1, signal: new AbortController().signal }, async () => ({ kind: 'enter', messages }));
  t.after(async () => { finish(); await guard.close(); await scope.dispose(); await ctx.fiber.dispose(); });
  return { ctx, agent, agents, guard, lifecycle, message, roots, bindingKey, observed, executed, cancellations, admit, insert, claim, start, finish, tool, step, transportRuns: () => transportRuns, revoke: () => { authorized = false; }, move: value => { cwd = value; } };
}

test('a claimed welcome turn only reads memory and digest for the frozen selected roots', async t => {
  const h = await harness(t);
  assert.equal(h.admit().accepted, true); h.insert(); h.start();
  assert.equal((await h.step([h.message])).kind, 'enter');
  h.roots.push('/synthetic/not-selected-at-admission');
  const cases = [
    ['project_companion', { action: 'memory', project: h.roots[0] }, true],
    ['project_companion', { action: 'digest', project: h.roots[1], detail: 'analysis' }, true],
    ['project_companion', { action: 'digest' }, false],
    ['project_companion', { action: 'digest', project: h.roots[2] }, false],
    ...['remember', 'watch', 'coordinate', 'list', 'configure_daily', 'remind'].map(action => ['project_companion', { action, project: h.roots[0] }, false]),
    ['send_wechat', {}, false], ['bash', {}, false],
  ];
  for (const [name, args, allowed] of cases) assert.equal((await h.tool(name, args)).isError, !allowed, `${name}:${args.action}`);
  assert.deepEqual(h.executed.map(item => item.args.action), ['memory', 'digest']);
  assert.deepEqual(h.observed[0].roots, h.roots.slice(0, 2));
  assert.equal(h.observed[0].bindingKey, h.bindingKey);
});

test('binding revocation is checked on every step and before a tool body', async t => {
  const h = await harness(t); h.admit(); h.insert(); h.start();
  h.revoke();
  assert.equal((await h.step([h.message])).kind, 'reject');
  assert.equal((await h.tool('project_companion', { action: 'memory', project: h.roots[0] })).isError, true);
  assert.equal(h.executed.length, 0);
});

for (const change of ['cwd', 'cwd-unknown', 'live-agent']) test(`an async authorization cannot admit a read after ${change} changes`, async t => {
  let release, entered;
  const arrived = new Promise(resolve => { entered = resolve; });
  const h = await harness(t, { authorize: async () => { entered(); return new Promise(resolve => { release = resolve; }); } });
  h.admit(); h.insert(); h.start();
  const pending = h.tool('project_companion', { action: 'digest', project: h.roots[0] });
  await arrived;
  if (change === 'cwd') h.move('/synthetic/other-source');
  else if(change === 'cwd-unknown')h.move(undefined);
  else h.agents.set(h.agent.id, { ...h.agent });
  release(true);
  assert.equal((await pending).isError, true);
  assert.equal(h.executed.length, 0);
});

test('an existing current-directory projection with no value cannot fall back to a stale session header',async t=>{
  const h=await harness(t);h.move(undefined);
  assert.equal(h.admit().accepted,false);
});

test('a different user message mixed into the welcome turn fails closed without removing its restrictions', async t => {
  const h = await harness(t); h.admit(); h.insert(); h.start();
  const other = { ...h.message, id: 'ordinary-steering-message' };
  h.insert(other); h.claim(other, 7);
  assert.equal((await h.step([other])).kind, 'reject');
  assert.equal((await h.tool('bash')).isError, true);
  assert.equal(h.executed.length, 0);
  assert.equal(h.cancellations.length > 0, true);
});

test('end and discard release the guard for ordinary subsequent user turns', async t => {
  const h = await harness(t); h.admit(); h.insert(); h.start(); h.finish();
  h.start(8, { ...h.message, id: 'ordinary-next-turn' });
  assert.equal((await h.tool('bash')).isError, false);
  h.finish(8);
  const nextMessage = { ...h.message, id: 'never-started-welcome' };
  assert.equal(h.admit({ message: nextMessage }).accepted, true); h.insert(nextMessage);
  h.ctx.emit('agent/inbox/discarded', { agent: h.agent, message: nextMessage });
  assert.equal((await h.tool('bash')).isError, false);
});

test('a turn-stopping route check cancels an invalid welcome completion', async t => {
  const h = await harness(t); h.admit(); h.insert(); h.start(); h.revoke();
  await h.ctx.serial('agent/turn-stopping', { agent: h.agent, turn: 7, signal: new AbortController().signal });
  assert.equal(h.cancellations.length, 1);
});

test('close retains the read-only guard until its exact in-flight welcome turn becomes idle', async t => {
  const h = await harness(t); h.admit(); h.insert(); h.start();
  let closed = false;
  const closing = h.guard.close().then(() => { closed = true; });
  await Promise.resolve();
  assert.equal(closed, false);
  assert.equal(h.cancellations.length, 1);
  assert.equal((await h.tool('bash')).isError, true);
  h.finish(); await closing;
  assert.equal((await h.tool('bash')).isError, false);
  assert.equal(h.admit({ message: { ...h.message, id: 'after-close' } }).accepted, false);
});

test('closing after the welcome ended never cancels a later ordinary user turn', async t => {
  const h = await harness(t); h.admit(); h.insert(); h.start(); h.finish();
  h.start(8, { ...h.message, id: 'ordinary-active-turn' });
  await h.guard.close();
  assert.equal(h.cancellations.length, 0);
  assert.equal((await h.tool('bash')).isError, false);
});

for (const change of ['idle-wait-rejection', 'old-agent-replaced']) test(`close keeps its protection while ${change} leaves the original turn in flight`, async t => {
  const h = await harness(t); h.admit(); h.insert(); h.start();
  if (change === 'idle-wait-rejection') h.agent.whenIdle = async () => { throw new Error('Synthetic driver wait failed'); };
  else h.agents.set(h.agent.id, { ...h.agent, cancel: () => assert.fail('must not cancel the replacement agent') });
  let closed = false;
  const closing = h.guard.close().then(() => { closed = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(closed, false, 'a failed wait or registry replacement is not proof that the old turn settled');
  assert.equal((await h.tool('bash')).isError, true);
  h.finish(); await closing;
  assert.equal(closed, true);
});

test('pending close removes only its queued welcome message and malformed admissions fail closed', async t => {
  const h = await harness(t);
  for (const input of [{ roots: [] }, { roots: ['/'] }, { roots: ['relative'] }, { bindingKey: '' }, { message: { ...h.message, id: '' } }]) assert.equal(h.admit(input).accepted, false);
  assert.equal(h.admit().accepted, true);
  assert.equal(h.admit().accepted, true, 'same message admission is idempotent');
  assert.equal(h.admit({ message: { ...h.message, id: 'second-overlap' } }).accepted, false);
  h.insert();
  let discarded = false;
  h.agent.inbox.remove = id => { discarded = id === h.message.id; return true; };
  await h.guard.close();
  assert.equal(discarded, true);
  assert.equal(h.cancellations.length, 0);
});

test('PTC code transport cannot bypass the welcome read-only boundary', async t => {
  const h = await harness(t, { mode: 'ptc' }); h.admit(); h.insert(); h.start();
  const result = await h.tool('run_code', { code: 'return "not allowed";', description: 'must not run' });
  assert.equal(result.isError, true); assert.equal(h.transportRuns(), 0);
});

test('actual plugin fiber unload drains the claimed welcome before removing its tool guard', async t => {
  const h = await harness(t, { pluginOwned: true }); h.admit(); h.insert(); h.start();
  let unloaded = false;
  const unloading = h.lifecycle.dispose().then(() => { unloaded = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(unloaded, false, 'fiber disposal must await this exact welcome turn');
  assert.equal(h.cancellations.length, 1);
  assert.equal((await h.tool('bash')).isError, true, 'automatic effect disposal cannot remove the guard ahead of drain');
  h.finish(); await unloading;
  assert.equal((await h.tool('bash')).isError, false);
});

test('missing mandatory host capabilities are rejected by admit without an uncertain throw', async () => {
  const { createWelcomeGuard } = await api();
  const guard = createWelcomeGuard({ ctx: { on() {} }, authorize: async () => true });
  assert.equal(guard.admit({}).accepted, false);
  await guard.close();
});
