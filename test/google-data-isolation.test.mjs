import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, realpath, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import CommandRuntime from '@deepseek-ai/dsh-commands';
import Storage from '@deepseek-ai/dsh-storage';
import * as JsonStorage from '@deepseek-ai/dsh-storage-json';
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain';
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session';
import { executeHostTool } from '../src/host-tool-call.js';
import {
  GOOGLE_MODEL_ISOLATION_CODE,
  isCompliantGoogleWorkspaceSelection,
  resolveGoogleWorkspaceModelSelection,
} from '../src/google-data-isolation.js';
import { createDailyDigest } from '../src/daily-digest-service.js';
import { createDigestModel } from '../src/daily-digest.js';
import { createProjectUpdateModel } from '../src/project-update-model.js';
import { createPersonalReviewModel } from '../src/personal-review-model.js';

async function openIsolationHost(t, options = {}) {
  const { installCompanion, apply } = await import('../index.js');
  const root = options.root ?? await realpath(await mkdtemp(join(tmpdir(), 'dot-google-isolation-')));
  const projectRoot = join(root, 'workspace');
  await mkdir(join(projectRoot, '.agent/memory'), { recursive: true });
  for (const file of ['README.md', '.agent/memory/progress.md', '.agent/memory/context.md']) {
    await writeFile(join(projectRoot, file), 'Synthetic project note line 1.');
  }

  let selection = options.initialSelection ?? { provider: 'deepseek-account', model: 'deepseek-flash' };
  const providers = options.providers ?? [
    { provider: 'deepseek-account', defaultBaseURL: 'https://api.deepseek.com', settingsNs: 'llm-deepseek-account' },
    { provider: 'google', defaultBaseURL: 'https://generativelanguage.googleapis.com/v1beta', settingsNs: 'llm-pi-ai' },
  ];
  const modelsByProvider = options.modelsByProvider ?? {
    'deepseek-account': [{ id: 'deepseek-flash' }, { id: 'deepseek-chat' }],
    google: [{ id: 'gemini-2.5-flash' }, { id: 'gemini-2.5-pro' }],
  };
  const customSettings = options.customSettings ?? [];
  const llmCalls = [];
  const googleFetches = [];
  const otherFetches = [];
  const createdSessions = [];
  const sessionPrompts = [];
  const accepted = [];

  const ctx = new Context();
  for (const [plugin, cfg] of [
    [SystemPrompt, {}],
    [ToolRuntime, { mode: 'native' }],
    [CommandRuntime, undefined],
    [Storage, undefined],
    [JsonStorage, { root: join(root, 'storage') }],
    [StorageDomain, { backend: 'json' }],
    [SessionStore, undefined],
  ]) {
    await ctx.plugin(plugin, cfg);
  }

  const agents = new Map();
  const routes = new Map();
  const known = [{ id: 'ws-iso', path: projectRoot, title: 'Isolation Project', sessionIds: ['owner-main'] }];
  ctx.provide('agents', { get: id => agents.get(id), list: () => [...agents.values()] });
  if (options.guardedBridge) ctx.provide('dotWechatGuarded', options.guardedBridge);
  ctx.provide('workingDirectory', { get: session => session.header.cwd });
  ctx.provide('workspaceRegistry', {
    list: () => known,
    resolveByPath: async path => known.find(item => item.path === path),
  });
  ctx.provide('connection', {
    fetch: {
      register: route => {
        routes.set(route.path, route);
        return () => routes.delete(route.path);
      },
    },
  });
  ctx.provide('agentDefaultModel', {
    currentSelection: () => (selection ? { ...selection } : null),
  });
  ctx.provide('settings', {
    describe: () => customSettings,
  });
  ctx.provide('llm', {
    listConfigurableProviders: () => providers,
    listModels: async provider => modelsByProvider[provider] ?? [],
    prepareCall: async cfg => {
      llmCalls.push({ provider: cfg.provider, model: cfg.model });
      return {
        config: cfg,
        stream: async function* (request) {
          let sourceId = 'file:synthetic';
          try {
            const payload = JSON.parse(request?.messages?.[0]?.content?.[0]?.text ?? '{}');
            const firstOk = payload?.sources?.find?.(s => s?.status === 'ok' && typeof s?.sourceId === 'string');
            if (firstOk) sourceId = firstOk.sourceId;
          } catch {}
          const text = options.llmResponder
            ? options.llmResponder(cfg, sourceId, request)
            : JSON.stringify({
                changes: [],
                blockers: [],
                nextSteps: [{ kind: 'suggestion', text: '建议在隔离核对会话中查看当前资料线索。', sourceIds: [sourceId] }],
              });
          yield { type: 'text-delta', index: 0, text };
          yield { type: 'finish', reason: { kind: 'stop' } };
        },
      };
    },
  });
  ctx.provide('sessionController', {
    create: async ({ sessionId, cwd }) => {
      createdSessions.push({ sessionId, cwd });
      const s = ctx.sessions.create(SessionId(sessionId), { meta: { cwd } });
      const a = { id: s.id, session: s, ctx, status: 'idle', followup: msg => accepted.push({ sessionId, msg }) };
      agents.set(sessionId, a);
      return { sessionId, agent: a };
    },
    prompt: async (req) => {
      const sid = typeof req === 'string' ? req : req?.sessionId;
      const body = typeof req === 'string' ? '' : (req?.content?.[0]?.text ?? '');
      sessionPrompts.push({ sessionId: sid, text: body, taintedAtPrompt: adapter?.googleIsolation?.isTainted?.(sid) ?? false });
      return { ok: true };
    },
  });

  const makeAgent = (id, { headerConfig = null } = {}) => {
    const session = ctx.sessions.create(SessionId(id), { meta: { cwd: projectRoot } });
    if (headerConfig) {
      session.requestHeader = () => ({ config: headerConfig });
    }
    const agent = {
      id: session.id,
      session,
      ctx,
      status: 'idle',
      followup: msg => accepted.push({ sessionId: id, msg }),
    };
    agents.set(id, agent);
    return agent;
  };
  const owner = makeAgent('owner-main');

  const config = {
    didaToken: 'synthetic-dida-token',
    flomoToken: 'synthetic-flomo-token',
    googleClientId: '',
    googleClientSecret: '',
    googleRefreshToken: '',
  };
  const credentialKey = 'e'.repeat(64);
  const googleSuiteAuth = {
    status: () => ({ clientConfigured: true, refreshConfigured: true, authInProgress: false, grantedSources: ['gmail', 'calendar', 'drive'] }),
    credentialState: source => ({ configured: ['gmail', 'calendar', 'drive'].includes(source), key: credentialKey }),
    getToken: async () => 'synthetic-google-token',
    close: async () => {},
  };
  const googleCalendarAuth = {
    status: () => ({ clientConfigured: false, refreshConfigured: false, authInProgress: false }),
    credentialState: () => ({ configured: false, key: '0'.repeat(64) }),
    getToken: async () => { throw new Error('use suite'); },
    close: async () => {},
  };
  const suiteTransport = {
    catalog: async source => ({
      provenance: 'bundled-contract',
      tools: [{ name: source === 'drive' ? 'search_files' : 'search_threads', inputSchema: { type: 'object' } }],
    }),
    call: async (source, name, args) => {
      googleFetches.push({ source, name, args });
      return {
        value: {
          items: source === 'drive'
            ? [{ id: 'drive-1', name: 'Secret Plan Doc', modifiedTime: '2026-11-17T08:00:00Z' }]
            : [{ id: 'mail-1', threadId: 't-1', subject: 'Private OAuth Verification', from: 'verifier@example.com', snippet: 'Sensitive Gmail snippet', receivedAt: '2026-11-17T08:00:00Z' }],
        },
        fetchedAt: '2026-11-17T10:00:00Z',
      };
    },
    close: async () => {},
  };
  const calendarTransport = {
    catalog: async () => ({
      provenance: 'bundled-contract',
      tools: [{ name: 'list_events', inputSchema: { type: 'object' } }],
    }),
    call: async (source, name, args) => {
      googleFetches.push({ source, name, args });
      return {
        value: {
          items: [{
            id: 'cal-1',
            summary: '我已经答应今天发方案',
            description: '承诺会前把方案发出去。',
            start: { dateTime: '2026-11-17T11:00:00Z' },
            end: { dateTime: '2026-11-17T12:00:00Z' },
          }],
        },
        fetchedAt: '2026-11-17T10:00:00Z',
      };
    },
    close: async () => {},
  };
  const transport = {
    catalog: async source => ({
      tools: [{ name: source === 'flomo' ? 'memo_search' : 'list_projects', inputSchema: { type: 'object' } }],
      fetchedAt: '2026-11-17T10:00:00Z',
    }),
    call: async (source, name, args) => {
      otherFetches.push({ source, name, args });
      return {
        value: {
          structuredContent: source === 'flomo'
            ? { memos: [{ id: 'flomo-1', content: 'Non-Google Flomo note' }] }
            : { projects: [{ id: 'dida-p1', name: 'Work List' }] },
        },
        fetchedAt: '2026-11-17T10:00:00Z',
      };
    },
    close: async () => {},
  };

  let adapter;
  let seq = 0;
  if (options.useApply) {
    await ctx.plugin({
      name: 'prod-apply-host',
      inject: ['tools', 'commands', 'storageDomain', 'sessions', 'systemPrompt'],
      async apply(scope) {
        await apply(scope, {});
      },
    });
  } else {
    await ctx.plugin({
      name: 'isolation-test-host',
      inject: ['tools', 'commands', 'storageDomain', 'sessions', 'systemPrompt'],
      async apply(scope) {
        adapter = await installCompanion(scope, {
          clock: () => new Date('2026-11-17T10:00:00Z'),
          hostTimeZone: () => 'Asia/Shanghai',
          readSetup: async () => ({ state: 'bound', sessionId: 'owner-main', bindingKey: 'b'.repeat(64) }),
          readNativeRoute: async () => ({ kind: 'unbound' }),
          readBinding: async () => null,
          googleIsolation: { enforceStrictAllowlist: true, syntheticHost: false },
          context: {
            config: options.nativeConfig ?? { googleWorkspaceModelProvider: '', googleWorkspaceModelId: '' },
            readConfig: () => ({ ...config }),
            fetch: async () => { throw new Error('offline unit test'); },
            transport,
            googleSuiteAuth,
            googleCalendarAuth,
            suiteTransport,
            calendarTransport,
          },
          timers: { setInterval() { return { unref() {} }; }, clearInterval() {} },
        });
      },
    });
  }

  const tool = async (name, args, asAgent = owner) => {
    const res = await executeHostTool(ctx.tools, {
      callId: `iso-call-${++seq}`,
      name,
      arguments: args,
      agent: asAgent,
      signal: new AbortController().signal,
    });
    assert.equal(res.isError, false, JSON.stringify(res));
    return res.value;
  };

  t.after(async () => {
    await ctx.fiber.dispose();
    if (!options.keepRoot) await rm(root, { recursive: true, force: true });
  });

  return {
    root,
    projectRoot,
    ctx,
    owner,
    agents,
    makeAgent,
    adapter,
    routes,
    llmCalls,
    googleFetches,
    otherFetches,
    createdSessions,
    sessionPrompts,
    accepted,
    tool,
    setSelection: next => { selection = next; },
  };
}

test('blocks deepseek-account, deepseek-official, unverified providers, and custom *.deepseek.com endpoints with zero Google fetches', async t => {
  const customSettings = [
    {
      ns: 'llm-custom-openai',
      value: { providers: { openai: { baseURL: 'https://api.deepseek.com/v1' } } },
    },
  ];
  const h = await openIsolationHost(t, {
    customSettings,
    providers: [
      { provider: 'deepseek-account', defaultBaseURL: 'https://api.deepseek.com', settingsNs: 'llm-deepseek-account' },
      { provider: 'deepseek-official', defaultBaseURL: 'https://api.deepseek.com', settingsNs: 'llm-deepseek-official' },
      { provider: 'openai', defaultBaseURL: 'https://api.deepseek.com/v1', settingsNs: 'llm-custom-openai' },
      { provider: 'unknown-vendor', defaultBaseURL: 'https://unknown.example/v1', settingsNs: 'llm-unknown' },
      { provider: 'google', defaultBaseURL: 'https://generativelanguage.googleapis.com/v1beta', settingsNs: 'llm-pi-ai' },
    ],
  });

  for (const src of ['gmail', 'calendar', 'drive', 'dida', 'flomo']) {
    const connected = await h.tool('personal_context', { action: 'connect', source: src, userRequested: true });
    assert.notEqual(connected.status, 'blocked', `connect ${src}: ${JSON.stringify(connected)}`);
  }
  await h.tool('project_companion', { action: 'watch', project: h.projectRoot });

  for (const badSelection of [
    { provider: 'deepseek-account', model: 'deepseek-flash' },
    { provider: 'deepseek-official', model: 'deepseek-chat' },
    { provider: 'openai', model: 'gpt-4.1' }, // custom baseURL points to api.deepseek.com
    { provider: 'unknown-vendor', model: 'model-x' },
  ]) {
    h.setSelection(badSelection);
    const mailRes = await h.tool('personal_context', {
      action: 'query', source: 'gmail', operation: 'search', query: 'OAuth', limit: 2, userRequested: true,
    });
    assert.equal(mailRes.status, 'blocked', `${badSelection.provider} must be blocked on gmail`);
    assert.equal(mailRes.code, GOOGLE_MODEL_ISOLATION_CODE);

    const briefRes = await h.tool('personal_context', {
      action: 'brief', sources: ['gmail', 'dida'], userRequested: true,
    });
    assert.equal(briefRes.status, 'blocked', `${badSelection.provider} must block brief including gmail`);
    assert.equal(briefRes.code, GOOGLE_MODEL_ISOLATION_CODE);

    const loopRes = await h.tool('project_companion', {
      action: 'context_brief',
      project: h.projectRoot,
      objective: 'Check Gmail update',
      queries: [{ source: 'gmail', operation: 'search', query: 'OAuth', limit: 1 }],
      userRequested: true,
    });
    assert.equal(loopRes.status, 'blocked', `${badSelection.provider} must block context_brief with gmail`);
    assert.equal(loopRes.code, GOOGLE_MODEL_ISOLATION_CODE);
  }
  assert.equal(h.googleFetches.length, 0, 'blocked models must perform zero Google API fetches');

  // Non-Google sources still work normally on deepseek-account.
  h.setSelection({ provider: 'deepseek-account', model: 'deepseek-flash' });
  const didaRes = await h.tool('personal_context', {
    action: 'query', source: 'dida', operation: 'projects', limit: 2, userRequested: true,
  });
  assert.equal(didaRes.source, 'dida');
  assert.equal(h.otherFetches.length, 1);

  // Verify direct allowlist helper rejects DeepSeek URLs and allows official endpoints / loopback Ollama.
  assert.equal(
    isCompliantGoogleWorkspaceSelection(
      { provider: 'openai', model: 'gpt-4o', baseURL: 'https://proxy.deepseek.ai/v1' },
      { enforceStrictAllowlist: true },
    ).allowed,
    false,
  );
  assert.equal(
    isCompliantGoogleWorkspaceSelection(
      { provider: 'anthropic', model: 'claude-sonnet-4', baseURL: 'https://api.anthropic.com' },
      { enforceStrictAllowlist: true },
    ).allowed,
    true,
  );
  assert.equal(
    isCompliantGoogleWorkspaceSelection(
      { provider: 'ollama', model: 'qwen2.5:14b', baseURL: 'http://127.0.0.1:11434/v1' },
      { enforceStrictAllowlist: true },
    ).allowed,
    true,
  );
});

test('Gemini allows Google read, persistently taints session across restarts, and rejects switching back to DeepSeek via pre-step/request guards', async t => {
  const sharedRoot = await realpath(await mkdtemp(join(tmpdir(), 'dot-google-taint-restart-')));
  t.after(async () => rm(sharedRoot, { recursive: true, force: true }));

  const h1 = await openIsolationHost(t, {
    root: sharedRoot,
    keepRoot: true,
    initialSelection: { provider: 'google', model: 'gemini-2.5-flash' },
  });
  for (const src of ['gmail', 'calendar']) {
    await h1.tool('personal_context', { action: 'connect', source: src, userRequested: true });
  }

  // First turn starts on Gemini.
  const gmailRes = await h1.tool('personal_context', {
    action: 'query', source: 'gmail', operation: 'search', query: 'OAuth', limit: 2, userRequested: true,
  });
  assert.equal(gmailRes.source, 'gmail');
  assert.equal(h1.googleFetches.length, 1);
  assert.equal(h1.adapter.googleIsolation.isTainted('owner-main'), true);

  // Switching assembled model selection back to deepseek-account rejects both agent/pre-step and agent/request!
  await h1.ctx.waterfall(
    'system-prompt/assemble',
    { variables: {} },
    { agent: h1.owner },
    () => Promise.resolve({ variables: { provider: 'deepseek-account', model: 'deepseek-flash' } }),
  );
  const preStepRejected = await h1.ctx.waterfall('agent/pre-step', {
    agent: h1.owner, messages: [], turn: 2, step: 1, signal: new AbortController().signal,
  }, () => ({ kind: 'enter', messages: [] }));
  assert.equal(preStepRejected.kind, 'reject');

  await assert.rejects(
    () => h1.ctx.waterfall('agent/request', {
      agent: h1.owner, turn: 2, step: 1, signal: new AbortController().signal,
    }, () => ({ provider: 'deepseek-account', model: 'deepseek-flash' })),
    { code: GOOGLE_MODEL_ISOLATION_CODE },
  );

  // Untainted sibling session can still use deepseek-account freely!
  const cleanSibling = h1.makeAgent('clean-sibling', { headerConfig: { provider: 'deepseek-account', model: 'deepseek-flash' } });
  const preStepClean = await h1.ctx.waterfall('agent/pre-step', {
    agent: cleanSibling, messages: [], turn: 1, step: 1, signal: new AbortController().signal,
  }, () => ({ kind: 'enter', messages: [] }));
  assert.equal(preStepClean.kind, 'enter');

  // Reopen plugin on the same storage root: persisted taint survives restart!
  await h1.ctx.fiber.dispose();
  const h2 = await openIsolationHost(t, {
    root: sharedRoot,
    keepRoot: true,
    initialSelection: { provider: 'deepseek-account', model: 'deepseek-flash' },
  });
  assert.equal(h2.adapter.googleIsolation.isTainted('owner-main'), true);
  const afterRestart = await h2.ctx.waterfall('agent/pre-step', {
    agent: h2.owner, messages: [], turn: 3, step: 1, signal: new AbortController().signal,
  }, () => ({ kind: 'enter', messages: [] }));
  assert.equal(afterRestart.kind, 'reject');
});

test('background dailyDigest, projectUpdateModel, and personalReviewModel auto-route to Gemini and fail closed when no compliant model exists', async t => {
  // Case A: default is deepseek-account, but google provider is available -> auto-routes background calls to google/gemini-2.5-flash.
  const routedCalls = [];
  const ctxWithGoogle = {
    get(name) {
      if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }) };
      if (name === 'llm') {
        return {
          listConfigurableProviders: () => [
            { provider: 'deepseek-account', defaultBaseURL: 'https://api.deepseek.com' },
            { provider: 'google', defaultBaseURL: 'https://generativelanguage.googleapis.com/v1beta' },
          ],
          listModels: async p => (p === 'google' ? [{ id: 'gemini-2.5-flash' }] : [{ id: 'deepseek-flash' }]),
          prepareCall: async cfg => {
            routedCalls.push({ provider: cfg.provider, model: cfg.model });
            return {
              config: cfg,
              stream: async function* () {
                const payload = cfg._kind === 'review' ? { items: [] } : { items: [] };
                yield { type: 'text-delta', index: 0, text: JSON.stringify(payload) };
                yield { type: 'finish', reason: { kind: 'stop' } };
              },
            };
          },
        };
      }
      return undefined;
    },
  };
  const resolved = await resolveGoogleWorkspaceModelSelection({ ctx: ctxWithGoogle, enforceStrictAllowlist: true });
  assert.deepEqual(resolved, { provider: 'google', model: 'gemini-2.5-flash' });

  const digestModel = createDigestModel(ctxWithGoogle, {
    resolveGoogleSelection: () => resolveGoogleWorkspaceModelSelection({ ctx: ctxWithGoogle, enforceStrictAllowlist: true }),
  });
  await digestModel.summarize({
    material: { mails: [{ id: 'm1', subject: 'Hello', from: 'a@b.com', receivedAt: '2026-11-17T08:00:00Z', snippet: 'Hi' }], calendar: [], promises: [] },
  });
  assert.equal(routedCalls.at(-1).provider, 'google');
  assert.equal(routedCalls.at(-1).model, 'gemini-2.5-flash');

  // Case B: ONLY deepseek-account exists -> dailyDigest skips gmail & calendar with 0 fetches while keeping dida!
  const onlyDeepSeekCtx = {
    get(name) {
      if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }) };
      if (name === 'llm') {
        return {
          listConfigurableProviders: () => [{ provider: 'deepseek-account', defaultBaseURL: 'https://api.deepseek.com' }],
          listModels: async () => [{ id: 'deepseek-flash' }],
          prepareCall: async cfg => {
            routedCalls.push({ provider: cfg.provider, model: cfg.model });
            return {
              config: cfg,
              stream: async function* () {
                yield { type: 'text-delta', index: 0, text: JSON.stringify({ items: [] }) };
                yield { type: 'finish', reason: { kind: 'stop' } };
              },
            };
          },
        };
      }
      return undefined;
    },
  };
  const deepSeekModel = createProjectUpdateModel(onlyDeepSeekCtx, {
    resolveGoogleSelection: () => resolveGoogleWorkspaceModelSelection({ ctx: onlyDeepSeekCtx, enforceStrictAllowlist: true }),
  });
  const beforeDeepSeekCalls = routedCalls.length;
  await assert.rejects(
    () => deepSeekModel.summarize({
      project: { label: 'Proj' },
      includesGoogleSources: true,
      sources: [{ sourceId: 'file:abc', label: 'README.md', role: 'file', status: 'ok', text: 'Email excerpt', at: null, truncated: false }],
    }),
    { code: 'MODEL_UNAVAILABLE' },
  );
  assert.equal(routedCalls.length, beforeDeepSeekCalls, 'must never call DeepSeek LLM when summarizing Google sources');

  const reviewModel = createPersonalReviewModel(onlyDeepSeekCtx, {
    resolveGoogleSelection: () => resolveGoogleWorkspaceModelSelection({ ctx: onlyDeepSeekCtx, enforceStrictAllowlist: true }),
  });
  await assert.rejects(
    () => reviewModel.summarize({
      kind: 'daily',
      now: '2026-11-17T10:00:00Z',
      evidence: [{ id: 'ev:1', source: 'gmail', title: 'Secret', text: 'Body', at: '2026-11-17T08:00:00Z' }],
    }),
    { code: 'MODEL_UNAVAILABLE' },
  );
  assert.equal(routedCalls.length, beforeDeepSeekCalls);

  // createDailyDigest skips gmail & calendar reads completely when canUseGoogleForModel returns false.
  const digestReadSources = [];
  let rowData = null;
  const service = createDailyDigest({
    store: { get: async () => rowData, put: async (_k, v) => { rowData = v; } },
    readSource: async src => {
      digestReadSources.push(src);
      return { items: [] };
    },
    summarize: async ({ material }) => {
      assert.equal(material.states.gmail.code, 'GOOGLE_MODEL_ISOLATION_REQUIRED');
      assert.equal(material.states.calendar.code, 'GOOGLE_MODEL_ISOLATION_REQUIRED');
      return { output: { items: [] }, text: '{"items":[]}' };
    },
    send: async () => ({ status: 'reported_sent' }),
    canUseGoogleForModel: async () => false,
    clock: () => new Date('2026-11-17T09:00:00Z'),
  });
  await service.ready();
  const digestRun = await service.manual({ force: true, at: new Date('2026-11-17T09:00:00Z') });
  assert.equal(digestRun.status, 'quiet');
  assert.equal(digestReadSources.includes('gmail'), false);
  assert.equal(digestReadSources.includes('calendar'), false);
  assert.equal(digestReadSources.includes('dida'), true);
});

test('cross-session context_handoff, Today calendar promise dispatch, and tool ledger sanitization preserve Google isolation', async t => {
  const h = await openIsolationHost(t, {
    initialSelection: { provider: 'google', model: 'gemini-2.5-flash' },
    guardedBridge: {
      binding: sid => (sid === 'owner-main' ? { bound: true, bindingKey: 'b'.repeat(64) } : null),
      send: async () => ({ status: 'accepted' }),
    },
    nativeConfig: {
      googleWorkspaceModelProvider: '',
      googleWorkspaceModelId: '',
      desktopConversationSessionId: 'owner-main',
      desktopConversationSelectionVersion: 1,
    },
    llmResponder: (_cfg, sourceId, request) => {
      try {
        const parsed = JSON.parse(request?.messages?.[0]?.content?.[0]?.text ?? '{}');
        if (Array.isArray(parsed?.mails)) {
          const mailId = parsed.mails[0]?.id;
          return JSON.stringify({
            items: mailId
              ? [{ category: 'work', what: '跟进 OAuth 审核邮件', progress: '', otherSays: true, missing: '', searchedMissing: '', evidence: { mailId } }]
              : [],
          });
        }
      } catch {}
      return JSON.stringify({
        changes: [],
        blockers: [],
        nextSteps: [{ kind: 'suggestion', text: '建议在隔离核对会话中查看本次邮件线索。', sourceIds: [sourceId] }],
      });
    },
  });
  await h.tool('personal_context', { action: 'connect', source: 'gmail', userRequested: true });
  await h.tool('personal_context', { action: 'connect', source: 'calendar', userRequested: true });
  await h.tool('project_companion', { action: 'watch', project: h.projectRoot });

  // Grant workspace access and verify /api/project_companion/activity still shows calendar promises/events while tool ledger strips them.
  const page = await h.adapter.workspaceAccess.list();
  await h.adapter.workspaceAccess.save({
    expectedRevision: page.revision,
    expectedCatalogRevision: page.catalogRevision,
    workspaceIds: [page.items[0].id],
  });
  await h.adapter.dotSourceReader.refreshNow();

  const activityRes = await h.routes.get('/api/project_companion/activity').fetch(new Request('http://synthetic.invalid/api/project_companion/activity'));
  const activityBody = await activityRes.json();
  assert.ok(activityBody.promises.some(p => p.source === 'calendar'), 'Today UI still renders deterministic calendar promises on-device');
  assert.ok(Array.isArray(activityBody.events) && activityBody.events.length === 1);

  const statusRes = await h.tool('project_companion', { action: 'status' });
  assert.ok(statusRes.ledger, 'tool status preserves ledger summary');
  assert.equal(statusRes.ledger.promises.some(p => p.source === 'calendar'), false, 'tool ledger must strip calendar promises');
  assert.deepEqual(statusRes.ledger.events, [], 'tool ledger must strip raw calendar events');

  // Today promise dispatch for calendar source blocks on DeepSeek default model, allows & taints on Gemini default model!
  const calPromise = activityBody.promises.find(p => p.source === 'calendar');
  h.setSelection({ provider: 'deepseek-account', model: 'deepseek-flash' });
  const promiseRoute = h.routes.get('/api/project_companion/promise');
  const deniedPromise = await (await promiseRoute.fetch(new Request('http://synthetic.invalid/api/project_companion/promise', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ promiseId: calPromise.id }),
  }))).json();
  assert.equal(deniedPromise.ok, false);
  assert.equal(deniedPromise.code, GOOGLE_MODEL_ISOLATION_CODE);
  assert.equal(h.createdSessions.length, 0);

  h.setSelection({ provider: 'google', model: 'gemini-2.5-flash' });
  const allowedPromise = await (await promiseRoute.fetch(new Request('http://synthetic.invalid/api/project_companion/promise', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ promiseId: calPromise.id }),
  }))).json();
  assert.equal(allowedPromise.ok, true);
  assert.equal(h.sessionPrompts[0].taintedAtPrompt, true, 'created session must be tainted before promptSession runs');

  // context_brief + cross-session handoff: reject DeepSeek target, admit & taint Gemini target.
  const brief = await h.tool('project_companion', {
    action: 'context_brief',
    project: h.projectRoot,
    objective: 'Check Gmail verification status',
    queries: [{ source: 'gmail', operation: 'search', query: 'OAuth', limit: 1 }],
    userRequested: true,
  });
  assert.ok(Array.isArray(brief.items) && brief.items.length > 0, JSON.stringify(brief));
  const deepSeekTarget = h.makeAgent('target-deepseek', { headerConfig: { provider: 'deepseek-account', model: 'deepseek-flash' } });
  const geminiTarget = h.makeAgent('target-gemini', { headerConfig: { provider: 'google', model: 'gemini-2.5-flash' } });
  await h.tool('project_companion', { action: 'watch', project: h.projectRoot }, deepSeekTarget);
  await h.tool('project_companion', { action: 'watch', project: h.projectRoot }, geminiTarget);

  const deniedHandoff = await h.tool('project_companion', {
    action: 'context_handoff',
    project: h.projectRoot,
    revision: brief.revision,
    itemId: brief.items[0].id,
    task: '检查这项邮件线索',
    session: 'target-deepseek',
    userRequested: true,
  });
  assert.equal(deniedHandoff.status, 'blocked', JSON.stringify(deniedHandoff));
  assert.equal(h.accepted.filter(a => a.sessionId === 'target-deepseek').length, 0);

  const admittedHandoff = await h.tool('project_companion', {
    action: 'context_handoff',
    project: h.projectRoot,
    revision: brief.revision,
    itemId: brief.items[0].id,
    task: '检查这项邮件线索',
    session: 'target-gemini',
    userRequested: true,
  });
  assert.equal(admittedHandoff.status, 'accepted', JSON.stringify(admittedHandoff));
  assert.equal(h.adapter.googleIsolation.isTainted('target-gemini'), true);

  // digest_view containing Google data blocks DeepSeek owner session and allows & taints Gemini session.
  const manualDigest = await h.adapter.dailyDigest.manual({ force: true, at: new Date('2026-11-17T10:00:00Z') });
  assert.ok(manualDigest.counts?.mailKept > 0 || manualDigest.counts?.events > 0, JSON.stringify(manualDigest));
  const deepSeekDigestView = await h.tool('project_companion', { action: 'digest_view' }, deepSeekTarget);
  // Note: deepSeekTarget isn't owner so digestOwner blocks it; test owner switched to deepseek vs gemini:
  assert.equal(deepSeekDigestView.status, 'blocked');
  h.setSelection({ provider: 'deepseek-account', model: 'deepseek-flash' });
  await h.ctx.waterfall(
    'system-prompt/assemble',
    { variables: {} },
    { agent: h.owner },
    () => Promise.resolve({ variables: { provider: 'deepseek-account', model: 'deepseek-flash' } }),
  );
  const ownerDeniedDigestView = await h.tool('project_companion', { action: 'digest_view' });
  assert.equal(ownerDeniedDigestView.status, 'blocked');
  assert.equal(ownerDeniedDigestView.code, GOOGLE_MODEL_ISOLATION_CODE);

  h.setSelection({ provider: 'google', model: 'gemini-2.5-flash' });
  await h.ctx.waterfall(
    'system-prompt/assemble',
    { variables: {} },
    { agent: h.owner },
    () => Promise.resolve({ variables: { provider: 'google', model: 'gemini-2.5-flash' } }),
  );
  const ownerAllowedDigestView = await h.tool('project_companion', { action: 'digest_view' });
  assert.equal(ownerAllowedDigestView.status, 'ok');
});

test('production apply(ctx, config) enforces strict allowlist and rejects deepseek-account', async t => {
  const h = await openIsolationHost(t, { useApply: true });
  const res = await h.tool('personal_context', {
    action: 'query', source: 'gmail', operation: 'search', query: 'test', limit: 1, userRequested: true,
  });
  assert.equal(res.status, 'blocked');
  assert.equal(res.code, GOOGLE_MODEL_ISOLATION_CODE);
});

test('strict allowlist rejects missing endpoint URLs and model-level unverified baseURL overrides', async t => {
  const missingUrlCheck = isCompliantGoogleWorkspaceSelection(
    { provider: 'google', model: 'gemini-2.5-flash' },
    { ctx: null, syntheticHost: false, enforceStrictAllowlist: true },
  );
  assert.equal(missingUrlCheck.allowed, false);
  assert.equal(missingUrlCheck.reason, 'missing_verified_endpoint');

  const h = await openIsolationHost(t, {
    initialSelection: { provider: 'google', model: 'gemini-2.5-flash' },
    customSettings: [
      {
        ns: 'llm-pi-ai',
        value: {
          providers: {
            google: {
              models: [{ id: 'gemini-2.5-flash', baseURL: 'https://relay.untrusted.example/v1beta' }],
            },
          },
        },
      },
    ],
  });
  await h.tool('personal_context', { action: 'connect', source: 'gmail', userRequested: true });
  const res = await h.tool('personal_context', {
    action: 'query', source: 'gmail', operation: 'search', query: 'test', limit: 1, userRequested: true,
  });
  assert.equal(res.status, 'blocked');
  assert.equal(res.code, GOOGLE_MODEL_ISOLATION_CODE);
  assert.equal(h.googleFetches.length, 0);
});
