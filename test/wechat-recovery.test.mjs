import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const recoveryText = '继续收取刚才缓存的回复就好，不要重新执行任务，也不要新增提醒';
const message = (text = recoveryText, id = 'wechat-message-1', source = { kind: 'user' }) => ({ id, source, role: 'user', content: [{ type: 'text', text }] });
const receipt = overrides => ({ attempted: true, sent: 3, remaining: 0, dropped: 0, ...overrides });

async function api() {
  const module = await import('../src/wechat-recovery.js').catch(() => ({}));
  assert.equal(typeof module.createWechatRecoveryGuard, 'function', 'cache recovery needs a deterministic bridge admission gate');
  assert.equal(typeof module.isWechatRecoveryOnlyMessage, 'function');
  return module;
}

async function harness(t) {
  const { createWechatRecoveryGuard } = await api();
  const ctx = new Context(), forwarded = [], agent = { id: 'bound-session', status: 'idle', followup: input => forwarded.push(input) };
  const agents = new Map([[agent.id, agent]]);
  ctx.provide('agents', { get: id => agents.get(id) });
  const guard = createWechatRecoveryGuard({ ctx });
  const admit = (input = message(), data = receipt(), source = agent) => ctx.bail('wechat/inbound-admit', { agent: source, message: input, receipt: data });
  const receive = (input = message(), data = receipt()) => {
    const decision = admit(input, data);
    if (decision?.kind !== 'transport-only') agent.followup(input);
    return decision;
  };
  t.after(async () => { guard.close(); await ctx.fiber.dispose(); });
  return { ctx, guard, agent, agents, forwarded, admit, receive };
}

test('the exact three-cache recovery input is consumed before any new agent turn', async t => {
  const h = await harness(t);
  assert.deepEqual(h.receive(), { kind: 'transport-only' });
  assert.equal(h.forwarded.length, 0, 'no followup means no model, tool call, summary or wake');
});

test('complete recovery-only phrases are accepted while new questions and tasks remain intact', async () => {
  const { isWechatRecoveryOnlyMessage } = await api();
  for (const text of [recoveryText, '请继续接收暂存的消息即可。', '只恢复收取缓存回复，不要重复运行任务，别再创建提醒']) assert.equal(isWechatRecoveryOnlyMessage(message(text)), true, text);
  for (const text of [
    `${recoveryText}，另外告诉我任务结果`,
    `${recoveryText}，并在五分钟后提醒我`,
    '继续收取缓存回复，再重新执行README任务',
    '不要继续收取缓存回复',
    '如何继续收取缓存回复？',
    '他说“继续收取缓存回复”是什么意思',
    '请分析“继续收取缓存回复”这句话',
    '继续收取缓存回复，不要新增提醒了吗？',
    '/next', '',
  ]) assert.equal(isWechatRecoveryOnlyMessage(message(text)), false, text);
  assert.equal(isWechatRecoveryOnlyMessage(message(recoveryText, 'plugin-message', { kind: 'plugin', name: 'source' })), false);
  assert.equal(isWechatRecoveryOnlyMessage({ ...message(), role: 'assistant' }), false);
  assert.equal(isWechatRecoveryOnlyMessage({ ...message(), content: [...message().content, { type: 'image', url: 'synthetic' }] }), false);
  assert.equal(isWechatRecoveryOnlyMessage({ ...message(), content: [{ type: 'text', text: '继续收取缓存回复'.repeat(30) }] }), false);
});

test('GUI or a generic pre-step event cannot activate the bridge-only gate', async t => {
  const h = await harness(t), input = message();
  const original = { kind: 'enter', messages: [input], startsRequestSeries: true };
  const result = await h.ctx.waterfall('agent/pre-step', { agent: h.agent, messages: [input], step: 1, turn: 1 }, async () => original);
  assert.equal(result, original);
  assert.equal(h.admit(input, receipt(), { ...h.agent }), undefined);
  h.agents.set(h.agent.id, { ...h.agent });
  assert.equal(h.admit(), undefined);
});

test('unknown, absent and malformed flush receipts cannot consume a user request', async t => {
  const h = await harness(t);
  for (const data of [undefined, {}, receipt({ attempted: false }), receipt({ attempted: false, sent: 0, remaining: 1 }), receipt({ attempted: false, sent: 0, dropped: 1 }), receipt({ attempted: 'false' }), receipt({ sent: -1 }), receipt({ remaining: NaN }), receipt({ dropped: '0' })]) {
    assert.equal(h.ctx.bail('wechat/inbound-admit', { agent: h.agent, message: message(), receipt: data }), undefined);
  }
});

test('partially flushed recovery creates no model summary or retry', async t => {
  const h = await harness(t);
  assert.deepEqual(h.receive(message(), receipt({ sent: 1, remaining: 2 })), { kind: 'transport-only' });
  assert.equal(h.forwarded.length, 0);
});

test('mixed recovery and a real new question forward the whole original message', async t => {
  const h = await harness(t), mixed = message(`${recoveryText}，另外告诉我README任务的具体结果`);
  assert.equal(h.receive(mixed), undefined);
  assert.deepEqual(h.forwarded, [mixed]); assert.equal(h.forwarded[0], mixed);
});

test('recovery received during an active task never cancels, steers or enqueues', async t => {
  const h = await harness(t); h.agent.status = 'running';
  const cancellations = [], steers = [];
  h.agent.cancel = input => cancellations.push(input); h.agent.steer = input => steers.push(input);
  assert.deepEqual(h.receive(), { kind: 'transport-only' });
  assert.equal(h.agent.status, 'running');
  assert.equal(h.forwarded.length, 0); assert.equal(cancellations.length, 0); assert.equal(steers.length, 0);
});

test('a real request immediately before or after recovery stays in the existing inbox', async t => {
  const h = await harness(t), first = message('先核对README', 'first'), next = message('现在检查一次项目状态，不要设提醒', 'next');
  h.agent.status = 'running';
  h.receive(first, receipt({ attempted: false }));
  assert.deepEqual(h.receive(), { kind: 'transport-only' });
  h.receive(next, receipt({ attempted: false }));
  assert.deepEqual(h.forwarded, [first, next]);
  assert.equal(h.forwarded[0], first); assert.equal(h.forwarded[1], next);
});

test('an actual empty-cache receipt consumes pure recovery and requests one fixed bridge acknowledgement', async t => {
  const h = await harness(t), input = message();
  assert.deepEqual(h.receive(input, receipt({ attempted: false, sent: 0, remaining: 0 })), { kind: 'transport-only', acknowledgement: 'empty-queue' });
  assert.deepEqual(h.forwarded, []);
  const mixed = message(`${recoveryText}，另外给我看README结果`, 'mixed-empty');
  assert.equal(h.receive(mixed, receipt({ attempted: false, sent: 0, remaining: 0 })), undefined);
  assert.deepEqual(h.forwarded, [mixed]);
  const withFile = { ...message(recoveryText, 'file-empty'), content: [...input.content, { type: 'file', path: '/synthetic/attached.txt' }] };
  assert.equal(h.receive(withFile, receipt({ attempted: false, sent: 0, remaining: 0 })), undefined);
  assert.deepEqual(h.forwarded, [mixed, withFile]);
});

test('close and automatic plugin fiber unload remove their admission hook', async t => {
  const h = await harness(t); h.guard.close(); h.guard.close();
  assert.equal(h.admit(), undefined);
  const { createWechatRecoveryGuard } = await api();
  const ctx = new Context(), agent = { id: 'fiber-owned-session' };
  ctx.provide('agents', { get: id => id === agent.id ? agent : undefined });
  const lifecycle = await ctx.plugin({ name: 'synthetic-recovery-owner', apply: pluginCtx => { createWechatRecoveryGuard({ ctx: pluginCtx }); } });
  assert.deepEqual(ctx.bail('wechat/inbound-admit', { agent, message: message(), receipt: receipt() }), { kind: 'transport-only' });
  await lifecycle.dispose();
  assert.equal(ctx.bail('wechat/inbound-admit', { agent, message: message(), receipt: receipt() }), undefined);
  await ctx.fiber.dispose();
});

test('built bridge original inbound produces the actual empty/nonempty receipts consumed by Dot', { skip: !process.env.DSH_WECHAT_BRIDGE_ROOT }, async () => {
  const root = process.env.DSH_WECHAT_BRIDGE_ROOT;
  const { WeChatDSHBridge } = await import(pathToFileURL(join(root, 'dist/bridge/bridge.js')).href);
  const { defaultConfig } = await import(pathToFileURL(join(root, 'dist/config.js')).href);
  const { createWechatRecoveryGuard } = await api();
  const directory = await mkdtemp(join(tmpdir(), 'dot-recovery-real-seam-'));
  const ctx = new Context(), forwarded = [], wires = [], observed = [];
  const agent = { id: 'synthetic-session', status: 'running', options: {}, followup: input => forwarded.push(input), steer: input => forwarded.push(input) };
  ctx.provide('agents', { get: id => id === agent.id ? agent : undefined, list: () => [agent] });
  const guard = createWechatRecoveryGuard({ ctx });
  ctx.on('wechat/inbound-admit', payload => { observed.push(structuredClone(payload.receipt)); }, { prepend: true });
  const bridge = new WeChatDSHBridge(ctx, { ...defaultConfig(), storageDir: directory });
  bridge.token = { baseUrl: 'https://synthetic.invalid', token: 'synthetic-token' };
  bridge.state.ensureUser('synthetic-peer', '/synthetic');
  bridge.state.update('synthetic-peer', { sessionId: agent.id });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input));
    assert.equal(url.hostname, 'synthetic.invalid', 'the integration seam cannot access real network endpoints');
    assert.equal(url.pathname, '/ilink/bot/sendmessage');
    wires.push(JSON.parse(options.body).msg.item_list[0].text_item.text);
    return Response.json({ ret: 0, errcode: 0 });
  };
  const inbound = (text, id) => ({ message_type: 1, message_id: id, from_user_id: 'synthetic-peer', item_list: [{ type: 1, text_item: { text } }] });
  try {
    await bridge.handleMessage(inbound(recoveryText, 1));
    assert.deepEqual(observed[0], { attempted: false, sent: 0, remaining: 0, dropped: 0 });
    assert.deepEqual(wires, ['当前没有待补发的消息；未重新执行任务或新增提醒。']);
    assert.equal(forwarded.length, 0);
    await bridge.handleMessage(inbound(recoveryText, 1));
    assert.equal(wires.length, 1, 'a replay cannot emit another acknowledgement');
    bridge.outboundCache = [{ kind: 'text', text: 'synthetic-first' }, { kind: 'text', text: 'synthetic-second' }];
    await bridge.handleMessage(inbound(recoveryText, 2));
    assert.deepEqual(observed[1], { attempted: true, sent: 2, remaining: 0, dropped: 0 });
    assert.deepEqual(wires.slice(1), ['synthetic-first', 'synthetic-second', '✅ 全部 2 条缓存消息已发送。']);
    assert.equal(forwarded.length, 0);
    const mixed = `${recoveryText}，另外告诉我README具体结果`;
    await bridge.handleMessage(inbound(mixed, 3));
    assert.equal(forwarded.length, 1); assert.equal(forwarded[0].content[0].text, mixed);
    assert.equal(wires.length, 4);
    assert.equal(agent.status, 'running', 'recovery never cancels the current task');
  } finally {
    await bridge.stop(); guard.close(); await ctx.fiber.dispose(); globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});
