/**
 * Auditable Google Workspace Limited Use Data Isolation Engine.
 *
 * Google Workspace API User Data & Developer Policy requires that raw,
 * aggregated, anonymized, and derived Google Workspace user data (Gmail,
 * Calendar, Drive, Docs, Sheets, Slides) NEVER be transferred to or used by
 * third-party AI/ML providers whose terms permit training generalized or
 * foundational models (such as hosted DeepSeek APIs).
 *
 * This module enforces complete, code-level data isolation across:
 *  1. Provider & Endpoint Validation: unconditionally rejects `deepseek*`
 *     providers and `*.deepseek.com` / `*.deepseek.ai` endpoints, and requires
 *     model calls touching Google data to target verified zero-training
 *     providers (`google`, `google-vertex`, `anthropic`, `openai`,
 *     `azure-openai`, `amazon-bedrock`) or loopback local inference (`ollama`).
 *  2. Background Auto-Routing: `dailyDigest`, `personalReviewModel`, and
 *     `projectUpdateModel` never fall back to DeepSeek when summarizing Google
 *     data; they explicitly resolve a verified zero-training model or fail closed.
 *  3. Session-Level Taint & `agent/pre-step` Gate: any conversation that reads
 *     Google sources or receives Google-derived handoffs/promises is blocked
 *     before reading on non-compliant sessions and persistently tainted so
 *     switching that session back to DeepSeek rejects the next step before any
 *     model HTTP request is dispatched.
 */
import { z } from 'zod';

export const GOOGLE_WORKSPACE_SOURCES = Object.freeze(
  new Set(['gmail', 'calendar', 'drive', 'docs', 'sheets', 'slides']),
);

export const GOOGLE_MODEL_ISOLATION_CODE = 'GOOGLE_MODEL_ISOLATION_REQUIRED';

export const GOOGLE_ISOLATION_USER_MESSAGE =
  '根据 Google Workspace Limited Use 数据保护要求，Gmail、日历与云盘资料（含派生摘要）不会发送给 DeepSeek 官方模型。请将当前会话模型切换为已配置的零训练合规模型（如绑定计费项目的 Paid Google Gemini API、Anthropic/OpenAI 商用 API 或本地 Ollama）后再读取；「今天」页的本机日历展示不受影响。';

const GOOGLE_SOURCE_LIST = ['gmail', 'calendar', 'drive', 'docs', 'sheets', 'slides'];

export const googleIsolationRowSchema = z.object({
  id: z.literal('profile'),
  version: z.literal(1),
  sessions: z.array(z.object({
    sessionId: z.string().min(1).max(200),
    sources: z.array(z.enum(GOOGLE_SOURCE_LIST)).min(1).max(6),
    taintedAt: z.string().datetime(),
  }).strict()).max(500),
}).strict();

const MAX_TAINTED_SESSIONS = 500;
const DISCOVERY_TIMEOUT_MS = 3000;

const LOCAL_LOOPBACK_HOSTS = Object.freeze(['127.0.0.1', 'localhost', '::1']);

/**
 * Verified zero-training provider -> allowed destination host rules.
 * Remote providers require HTTPS; local inference requires loopback hosts.
 */
export const COMPLIANT_PROVIDER_HOSTS = Object.freeze({
  google: ['generativelanguage.googleapis.com'],
  gemini: ['generativelanguage.googleapis.com'],
  'google-generative-ai': ['generativelanguage.googleapis.com'],
  'google-vertex': [/^(?:[a-z0-9-]+-)?aiplatform\.googleapis\.com$/i],
  anthropic: ['api.anthropic.com'],
  openai: ['api.openai.com'],
  azure: [/^[a-z0-9-]+\.openai\.azure\.com$/i],
  'azure-openai': [/^[a-z0-9-]+\.openai\.azure\.com$/i],
  'amazon-bedrock': [/^bedrock-runtime\.[a-z0-9-]+\.amazonaws\.com$/i],
  bedrock: [/^bedrock-runtime\.[a-z0-9-]+\.amazonaws\.com$/i],
  ollama: LOCAL_LOOPBACK_HOSTS,
  lmstudio: LOCAL_LOOPBACK_HOSTS,
  local: LOCAL_LOOPBACK_HOSTS,
});

const AUTO_ROUTE_PROVIDER_ORDER = Object.freeze([
  'google',
  'google-vertex',
  'gemini',
  'google-generative-ai',
  'anthropic',
  'openai',
  'azure',
  'azure-openai',
  'amazon-bedrock',
  'bedrock',
  'ollama',
  'lmstudio',
  'local',
]);

const PREFERRED_GOOGLE_MODELS = Object.freeze([
  'gemini-2.5-flash',
  'gemini-3.5-flash',
  'gemini-3-flash-preview',
  'gemini-flash-latest',
  'gemini-2.5-pro',
  'gemini-3.5-flash-lite',
]);

export function isGoogleWorkspaceSource(source) {
  return typeof source === 'string' && GOOGLE_WORKSPACE_SOURCES.has(source);
}

export function googleSourcesInList(items) {
  if (!Array.isArray(items)) return [];
  const found = new Set();
  for (const item of items) {
    const source = typeof item === 'string' ? item : item?.source;
    if (isGoogleWorkspaceSource(source)) found.add(source);
  }
  return [...found].sort();
}

export function containsGoogleWorkspaceSource(items) {
  return googleSourcesInList(items).length > 0;
}

export function isDeniedDeepSeekProvider(provider) {
  return typeof provider === 'string' && /deepseek/i.test(provider.trim());
}

export function isDeniedDeepSeekUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return false;
  try {
    const host = new URL(rawUrl.trim()).hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return (
      host === 'deepseek.com' ||
      host.endsWith('.deepseek.com') ||
      host === 'deepseek.ai' ||
      host.endsWith('.deepseek.ai')
    );
  } catch {
    return /deepseek\.(?:com|ai)/i.test(rawUrl);
  }
}

function normalizeHostname(hostname) {
  return String(hostname ?? '').replace(/^\[|\]$/g, '').toLowerCase();
}

function urlMatchesProviderRules(rawUrl, providerKey) {
  const rules = COMPLIANT_PROVIDER_HOSTS[providerKey];
  if (!rules) return false;
  let parsed;
  try {
    parsed = new URL(String(rawUrl).trim());
  } catch {
    return false;
  }
  const isLocalProvider = providerKey === 'ollama' || providerKey === 'lmstudio' || providerKey === 'local';
  if (isLocalProvider) {
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  } else if (parsed.protocol !== 'https:') {
    return false;
  }
  const host = normalizeHostname(parsed.hostname);
  return rules.some(rule => (typeof rule === 'string' ? host === rule : rule.test(host)));
}

/**
 * Inspect host LLM/settings registries to discover any configured or custom
 * `baseURL` / `defaultBaseURL` bound to `provider`. Never reads secret fields.
 */
export function inspectConfiguredProviderUrls(ctx, provider, model = '') {
  const urls = [];
  if (!ctx || typeof ctx.get !== 'function' || typeof provider !== 'string' || !provider.trim()) return urls;
  const target = provider.trim();
  const targetModel = typeof model === 'string' ? model.trim() : '';
  const seen = new Set();
  const push = value => {
    if (typeof value === 'string' && value.trim() && !seen.has(value.trim())) {
      seen.add(value.trim());
      urls.push(value.trim());
    }
  };
  let llm = null;
  try { llm = ctx.get('llm', false); } catch { llm = null; }
  const lists = [];
  try { if (typeof llm?.listConfigurableProviders === 'function') lists.push(...(llm.listConfigurableProviders() ?? [])); } catch {}
  try { if (typeof llm?.listProviders === 'function') lists.push(...(llm.listProviders() ?? [])); } catch {}
  const settingsNamespaces = new Set();
  for (const entry of lists) {
    if (entry?.provider !== target) continue;
    push(entry.baseURL);
    push(entry.defaultBaseURL);
    if (Array.isArray(entry.models)) {
      for (const m of entry.models) {
        if (!targetModel || m?.id === targetModel) push(m?.baseURL);
      }
    }
    if (typeof entry.settingsNs === 'string' && entry.settingsNs) settingsNamespaces.add(entry.settingsNs);
  }
  if (settingsNamespaces.size > 0) {
    try {
      const settings = ctx.get('settings', false);
      if (typeof settings?.describe === 'function') {
        for (const row of settings.describe({ redactSecrets: true }) ?? []) {
          if (!settingsNamespaces.has(row?.ns)) continue;
          const pCfg = row?.value?.providers?.[target];
          push(pCfg?.baseURL);
          if (Array.isArray(pCfg?.models)) {
            for (const m of pCfg.models) {
              if (!targetModel || m?.id === targetModel) push(m?.baseURL);
            }
          }
        }
      }
    } catch {}
  }
  return urls;
}

export function isolationBlockedError(message = GOOGLE_ISOLATION_USER_MESSAGE, reason = 'isolation_required') {
  return Object.assign(new Error(message), {
    code: GOOGLE_MODEL_ISOLATION_CODE,
    isolationBlocked: true,
    isolationReason: reason,
  });
}

/**
 * Validate whether a model selection is compliant for processing raw or
 * derived Google Workspace data. DeepSeek providers and endpoints are
 * unconditionally rejected, even in synthetic test hosts.
 */
export function isCompliantGoogleWorkspaceSelection(
  selection,
  { ctx = null, syntheticHost = false, enforceStrictAllowlist = false } = {},
) {
  const provider = typeof selection?.provider === 'string' ? selection.provider.trim() : '';
  const model = typeof selection?.model === 'string' ? selection.model.trim() : '';
  const selectionBaseURL = typeof selection?.baseURL === 'string' ? selection.baseURL.trim() : '';

  if (isDeniedDeepSeekProvider(provider)) {
    return { allowed: false, code: GOOGLE_MODEL_ISOLATION_CODE, reason: 'denied_deepseek_provider' };
  }
  if (selectionBaseURL && isDeniedDeepSeekUrl(selectionBaseURL)) {
    return { allowed: false, code: GOOGLE_MODEL_ISOLATION_CODE, reason: 'denied_deepseek_endpoint' };
  }

  const configuredUrls = provider ? inspectConfiguredProviderUrls(ctx, provider, model) : [];
  for (const url of configuredUrls) {
    if (isDeniedDeepSeekUrl(url)) {
      return { allowed: false, code: GOOGLE_MODEL_ISOLATION_CODE, reason: 'denied_deepseek_endpoint' };
    }
  }

  if (!provider || !model) {
    if (syntheticHost === true && enforceStrictAllowlist !== true) {
      return { allowed: true, provider: provider || 'synthetic', model: model || 'synthetic', synthetic: true };
    }
    return { allowed: false, code: GOOGLE_MODEL_ISOLATION_CODE, reason: 'missing_selection' };
  }

  const key = provider.toLowerCase();
  if (Object.hasOwn(COMPLIANT_PROVIDER_HOSTS, key)) {
    const allUrls = [...configuredUrls];
    if (selectionBaseURL && !allUrls.includes(selectionBaseURL)) allUrls.push(selectionBaseURL);
    if (enforceStrictAllowlist === true && allUrls.length === 0) {
      return { allowed: false, code: GOOGLE_MODEL_ISOLATION_CODE, reason: 'missing_verified_endpoint' };
    }
    for (const url of allUrls) {
      if (!urlMatchesProviderRules(url, key)) {
        return { allowed: false, code: GOOGLE_MODEL_ISOLATION_CODE, reason: 'unverified_endpoint' };
      }
    }
    return { allowed: true, provider, model, verifiedEndpoints: allUrls };
  }

  if (syntheticHost === true && enforceStrictAllowlist !== true) {
    return { allowed: true, provider, model, synthetic: true };
  }
  return { allowed: false, code: GOOGLE_MODEL_ISOLATION_CODE, reason: 'unverified_provider' };
}

async function listModelsBounded(llm, provider) {
  if (typeof llm?.listModels !== 'function') return [];
  let timer;
  try {
    const models = await Promise.race([
      Promise.resolve().then(() => llm.listModels(provider)),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('MODEL_DISCOVERY_TIMEOUT')), DISCOVERY_TIMEOUT_MS);
      }),
    ]);
    return Array.isArray(models) ? models : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function pickModelId(provider, models) {
  const ids = models
    .map(item => (typeof item === 'string' ? item : item?.id))
    .filter(id => typeof id === 'string' && id.trim());
  if (!ids.length) return '';
  if (['google', 'gemini', 'google-generative-ai'].includes(provider.toLowerCase())) {
    for (const preferred of PREFERRED_GOOGLE_MODELS) {
      if (ids.includes(preferred)) return preferred;
    }
  }
  return ids[0];
}

function cloneSelection(selection) {
  return {
    provider: selection.provider,
    model: selection.model,
    ...(typeof selection.reasoningEffort === 'string' && selection.reasoningEffort
      ? { reasoningEffort: selection.reasoningEffort }
      : {}),
  };
}

/**
 * Resolve a compliant zero-training model selection for background or
 * automated Google Workspace summarization (`dailyDigest`, `personalReviewModel`,
 * `projectUpdateModel`). Never returns a DeepSeek provider.
 */
export async function resolveGoogleWorkspaceModelSelection({
  ctx,
  readWorkspaceConfig = null,
  syntheticHost = false,
  enforceStrictAllowlist = false,
} = {}) {
  let llm = null;
  try { llm = ctx?.get?.('llm', false) ?? null; } catch { llm = null; }

  const configured = typeof readWorkspaceConfig === 'function' ? readWorkspaceConfig() ?? {} : {};
  const explicitProvider = typeof configured.googleWorkspaceModelProvider === 'string'
    ? configured.googleWorkspaceModelProvider.trim()
    : '';
  const explicitModel = typeof configured.googleWorkspaceModelId === 'string'
    ? configured.googleWorkspaceModelId.trim()
    : '';

  if (explicitProvider) {
    if (isDeniedDeepSeekProvider(explicitProvider)) {
      throw isolationBlockedError(GOOGLE_ISOLATION_USER_MESSAGE, 'denied_explicit_provider');
    }
    let resolvedModel = explicitModel;
    if (!resolvedModel) {
      resolvedModel = pickModelId(explicitProvider, await listModelsBounded(llm, explicitProvider));
    }
    const candidate = { provider: explicitProvider, model: resolvedModel };
    const check = isCompliantGoogleWorkspaceSelection(candidate, { ctx, syntheticHost, enforceStrictAllowlist });
    if (!check.allowed) {
      throw isolationBlockedError(GOOGLE_ISOLATION_USER_MESSAGE, check.reason);
    }
    return cloneSelection(candidate);
  }

  let currentDefault = null;
  try { currentDefault = ctx?.get?.('agentDefaultModel', false)?.currentSelection?.() ?? null; } catch { currentDefault = null; }
  if (currentDefault && typeof currentDefault === 'object' && currentDefault.provider && currentDefault.model) {
    const check = isCompliantGoogleWorkspaceSelection(currentDefault, { ctx, syntheticHost, enforceStrictAllowlist });
    if (check.allowed) {
      return cloneSelection(currentDefault);
    }
  }

  if (llm) {
    const registered = new Set();
    try {
      for (const item of llm.listConfigurableProviders?.() ?? []) {
        if (typeof item?.provider === 'string' && item.provider) registered.add(item.provider);
      }
    } catch {}
    try {
      for (const item of llm.listProviders?.() ?? []) {
        if (typeof item?.provider === 'string' && item.provider) registered.add(item.provider);
        else if (typeof item?.id === 'string' && item.id) registered.add(item.id);
      }
    } catch {}

    const candidates = registered.size > 0
      ? AUTO_ROUTE_PROVIDER_ORDER.filter(p => registered.has(p))
      : AUTO_ROUTE_PROVIDER_ORDER;

    for (const provider of candidates) {
      const models = await listModelsBounded(llm, provider);
      const modelId = pickModelId(provider, models);
      if (!modelId) continue;
      const candidate = { provider, model: modelId };
      const check = isCompliantGoogleWorkspaceSelection(candidate, { ctx, syntheticHost, enforceStrictAllowlist });
      if (check.allowed) {
        return cloneSelection(candidate);
      }
    }
  }

  if (syntheticHost === true && enforceStrictAllowlist !== true && !isDeniedDeepSeekProvider(currentDefault?.provider)) {
    const check = isCompliantGoogleWorkspaceSelection(currentDefault, { ctx, syntheticHost, enforceStrictAllowlist: false });
    if (check.allowed) return { provider: check.provider, model: check.model };
  }

  throw isolationBlockedError(GOOGLE_ISOLATION_USER_MESSAGE, 'no_compliant_provider');
}

/**
 * Stateful per-session taint tracker and `agent/pre-step` guard.
 * Taints are kept synchronously in memory for immediate pre-step enforcement
 * and persisted asynchronously to `storageDomain` across restarts.
 */
export function createGoogleIsolationGuard({
  ctx,
  store = null,
  readWorkspaceConfig = null,
  clock = () => new Date(),
  syntheticHost = false,
  enforceStrictAllowlist = false,
} = {}) {
  const tainted = new Map();
  const assembledSelections = new Map();
  let queue = Promise.resolve();
  let closed = false;

  const sessionKeyFor = agent => (
    typeof agent?.id === 'string' && agent.id
      ? agent.id
      : typeof agent?.session?.id === 'string' && agent.session.id
        ? String(agent.session.id)
        : ''
  );

  const nowIso = () => {
    const d = typeof clock === 'function' ? new Date(clock()) : new Date();
    return Number.isFinite(d.getTime()) ? d.toISOString() : new Date().toISOString();
  };

  function persistSnapshot() {
    if (!store?.put || closed) return Promise.resolve();
    const sessions = [...tainted.entries()]
      .slice(-MAX_TAINTED_SESSIONS)
      .map(([sessionId, entry]) => ({
        sessionId,
        sources: [...entry.sources].filter(isGoogleWorkspaceSource).sort(),
        taintedAt: entry.taintedAt,
      }))
      .filter(row => row.sources.length > 0);
    const payload = googleIsolationRowSchema.parse({ id: 'profile', version: 1, sessions });
    const run = queue.then(() => (closed ? undefined : store.put('profile', payload)));
    queue = run.catch(() => {});
    return run.catch(() => {});
  }

  function recordAssembledSelection(sessionId, selection) {
    if (!sessionId || !selection || typeof selection.provider !== 'string' || !selection.provider.trim()) return;
    assembledSelections.set(sessionId, {
      provider: selection.provider.trim(),
      model: typeof selection.model === 'string' ? selection.model.trim() : '',
    });
    while (assembledSelections.size > MAX_TAINTED_SESSIONS) {
      assembledSelections.delete(assembledSelections.keys().next().value);
    }
  }

  function activeSelection(agent) {
    const sid = sessionKeyFor(agent);
    if (sid && assembledSelections.has(sid)) return assembledSelections.get(sid);
    const logged = agent?.session?.requestHeader?.()?.config;
    if (logged?.provider && logged?.model) return logged;
    try {
      return ctx?.get?.('agentDefaultModel', false)?.currentSelection?.() ?? null;
    } catch {
      return null;
    }
  }

  function markSessionTainted(sessionId, sources = ['gmail']) {
    if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 200) return false;
    const valid = googleSourcesInList(sources);
    if (!valid.length) return false;
    const existing = tainted.get(sessionId);
    if (existing) {
      tainted.delete(sessionId);
      for (const s of valid) existing.sources.add(s);
      existing.taintedAt = nowIso();
      tainted.set(sessionId, existing);
    } else {
      tainted.set(sessionId, { sources: new Set(valid), taintedAt: nowIso() });
      while (tainted.size > MAX_TAINTED_SESSIONS) {
        tainted.delete(tainted.keys().next().value);
      }
    }
    void persistSnapshot();
    return true;
  }

  function sessionHasGoogleHistory(agent) {
    const sessionId = typeof agent?.id === 'string' ? agent.id : typeof agent?.session?.id === 'string' ? String(agent.session.id) : '';
    if (!sessionId) return false;
    return tainted.has(sessionId);
  }

  async function assertSessionAllowedForGoogle(agent, _sources = GOOGLE_SOURCE_LIST) {
    const selection = activeSelection(agent);
    const check = isCompliantGoogleWorkspaceSelection(selection, { ctx, syntheticHost, enforceStrictAllowlist });
    if (check.allowed) return check;
    throw isolationBlockedError(GOOGLE_ISOLATION_USER_MESSAGE, check.reason);
  }

  async function hasCompliantBackgroundModel() {
    try {
      await resolveGoogleWorkspaceModelSelection({ ctx, readWorkspaceConfig, syntheticHost, enforceStrictAllowlist });
      return true;
    } catch {
      return false;
    }
  }

  async function observePromptAssembly(_assembly, context, next) {
    const assembled = typeof next === 'function' ? await next() : _assembly;
    const provider = assembled?.variables?.provider;
    const model = assembled?.variables?.model;
    const sid = sessionKeyFor(context?.agent) || (typeof context?.session?.id === 'string' ? String(context.session.id) : '');
    if (sid && typeof provider === 'string' && provider.trim()) {
      recordAssembledSelection(sid, { provider, model });
    }
    return assembled;
  }

  async function requestGuard(payload, next) {
    const resolved = typeof next === 'function' ? await next() : payload;
    const agent = payload?.agent;
    const sid = sessionKeyFor(agent);
    if (sid && typeof resolved?.provider === 'string' && resolved.provider.trim()) {
      recordAssembledSelection(sid, { provider: resolved.provider, model: resolved.model });
    }
    if (sessionHasGoogleHistory(agent)) {
      const check = isCompliantGoogleWorkspaceSelection(resolved, { ctx, syntheticHost, enforceStrictAllowlist });
      if (!check.allowed) {
        throw isolationBlockedError(GOOGLE_ISOLATION_USER_MESSAGE, check.reason);
      }
    }
    return resolved;
  }

  async function preStepGuard(payload, next) {
    const agent = payload?.agent;
    if (sessionHasGoogleHistory(agent)) {
      const explicit = payload?.modelSelection;
      const selection = explicit && typeof explicit.provider === 'string' && explicit.provider.trim()
        ? explicit
        : activeSelection(agent);
      const check = isCompliantGoogleWorkspaceSelection(selection, { ctx, syntheticHost, enforceStrictAllowlist });
      if (!check.allowed) {
        return { kind: 'reject' };
      }
    }
    return typeof next === 'function' ? next() : { kind: 'enter', messages: payload?.messages ?? [] };
  }

  return {
    async ready() {
      if (!store?.get) return;
      try {
        const raw = await store.get('profile');
        const parsed = googleIsolationRowSchema.safeParse(raw);
        if (!parsed.success) return;
        for (const row of parsed.data.sessions) {
          tainted.set(row.sessionId, { sources: new Set(row.sources), taintedAt: row.taintedAt });
        }
      } catch {}
    },
    activeSelection,
    markSessionTainted,
    sessionHasGoogleHistory,
    assertSessionAllowedForGoogle,
    hasCompliantBackgroundModel,
    resolveBackgroundSelection: () =>
      resolveGoogleWorkspaceModelSelection({ ctx, readWorkspaceConfig, syntheticHost, enforceStrictAllowlist }),
    observePromptAssembly,
    preStepGuard,
    requestGuard,
    isTainted: sessionId => tainted.has(String(sessionId ?? '')),
    close() {
      closed = true;
      return queue.catch(() => {});
    },
  };
}
