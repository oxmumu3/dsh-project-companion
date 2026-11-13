/**
 * Dot-owned source switches (DESIGN.md 3.15).
 *
 * One row per source records whether Dot itself may read it, the credential
 * fingerprint and binding captured by the legacy grant, and which conversations
 * were explicitly added. Conversations are added, never moved: enabling a source
 * in one session cannot rebind Dot's switch or another session's row.
 *
 * The legacy `project_companion_context` domain stays read-only and is read at
 * most once, only when the new domain does not exist yet. Its credential
 * fingerprint is preserved verbatim: if the configured account changed, reads
 * require a reconnect instead of silently authorizing the new account.
 */
import {createHash} from 'node:crypto';
import {z} from 'zod';

const identity = z.string().min(1).max(200);
const stamp = z.string().datetime();
const hash = z.string().regex(/^[a-f0-9]{64}$/);

/** Keep this list local: context-service imports this module, so importing its
 *  CONTEXT_SOURCES back would create a cycle. dot-sources.test asserts parity. */
export const DOT_SOURCE_IDS = Object.freeze(['gmail', 'calendar', 'drive', 'docs', 'sheets', 'slides', 'dida', 'flomo']);
const sourceEnum = z.enum(DOT_SOURCE_IDS);

/** Sources with a rule-based bulk reader in this batch (DESIGN.md 3.3 path 1). */
export const DOT_BULK_SOURCES = Object.freeze(['dida', 'calendar']);

const sessionRowSchema = z.object({
  sessionId: identity,
  credentialKey: hash.nullable(),
  bindingKey: hash.nullable(),
  grantId: z.string().max(200).optional(),
  // Independent grant generation for this conversation. Only this session's
  // reconnect changes it; another session's enable/disable does not.
  generation: z.number().int().nonnegative().optional(),
  addedAt: stamp,
}).strict();

const sourceRowSchema = z.object({
  source: sourceEnum,
  enabled: z.boolean(),
  credentialKey: hash.nullable(),
  bindingKey: hash.nullable(),
  grantId: z.string().max(200).optional(),
  connectedAt: stamp.nullable(),
  lastReadAt: stamp.nullable(),
  lastReadState: z.enum(['ok', 'needs_authorization', 'unavailable']).nullable(),
  // Monotonic grant generation: every enable/disable/session add/remove bumps
  // it, so a manifest approved before a reconnect can never verify afterwards.
  generation: z.number().int().nonnegative().optional(),
  // Monotonic revocation epochs per conversation: a removed conversation keeps
  // its counter, so disconnect-then-reconnect can never recreate an old digest.
  sessionEpochs: z.record(z.string(), z.number().int().nonnegative()).optional(),
  allowedSessions: z.array(sessionRowSchema).max(50),
}).strict();

const decisionSchema = z.object({
  key: z.string().min(1).max(400),
  state: z.enum(['snoozed', 'handled', 'dismissed']),
  at: stamp,
  until: stamp.optional(),
}).strict();

/** A "let Dot handle it" claim. Pending rows block a second dispatch for the
 *  same source item across restarts until settled or released. */
const linkSchema = z.object({
  key: z.string().min(1).max(400),
  state: z.enum(['pending', 'ok']),
  token: z.string().min(1).max(120),
  sessionId: identity.nullable(),
  root: z.string().max(4096).nullable(),
  at: stamp,
}).strict();

export const dotSourcesRowSchema = z.object({
  id: z.literal('profile'),
  version: z.literal(1),
  revision: z.number().int().nonnegative(),
  sources: z.array(sourceRowSchema).max(8),
  decisions: z.array(decisionSchema).max(500),
  links: z.array(linkSchema).max(500),
  migrated: z.object({from: z.literal('project_companion_context'), at: stamp, legacyDigest: hash}).strict().optional(),
}).strict();

export const emptyDotSourcesRow = () => ({
  id: 'profile', version: 1, revision: 0, sources: [], decisions: [], links: [],
});

const at = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function legacyDigest(legacySources) {
  const rows = (Array.isArray(legacySources) ? legacySources : [])
    .map(row => [row?.source, row?.sessionId, row?.credentialKey ?? null, row?.bindingKey ?? null, row?.grantId ?? 'legacy'])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return digest(rows);
}

/**
 * Pure upgrade projection. A source with one legacy row is on; a configured
 * source without a row is off. The legacy fingerprint/binding/grant id are kept
 * exactly as stored, so a different current account cannot inherit the grant.
 */
export function migrateLegacySources({legacySources = [], now = new Date(), legacy = null} = {}) {
  const rows = [];
  for (const source of DOT_SOURCE_IDS) {
    const existing = (Array.isArray(legacySources) ? legacySources : []).find(row => row?.source === source);
    const legacyKey = typeof existing?.credentialKey === 'string' && /^[a-f0-9]{64}$/.test(existing.credentialKey) ? existing.credentialKey : null;
    const legacyBinding = typeof existing?.bindingKey === 'string' && /^[a-f0-9]{64}$/.test(existing.bindingKey) ? existing.bindingKey : null;
    const grantId = typeof existing?.grantId === 'string' ? existing.grantId.slice(0, 200) : undefined;
    rows.push({
      source,
      enabled: Boolean(existing),
      credentialKey: legacyKey,
      bindingKey: legacyBinding,
      ...(grantId ? {grantId} : {}),
      connectedAt: existing ? (at(existing.connectedAt) ?? null) : null,
      lastReadAt: null,
      lastReadState: null,
      // Carry the existing conversation grant over as one explicit row. This is
      // the same grant, not a new one: it keeps personal review and Family
      // working after the upgrade without moving or widening any permission.
      ...(existing && typeof existing.sessionId === 'string' && existing.sessionId ? {sessionEpochs: {[existing.sessionId]: 1}} : {}),
      allowedSessions: existing && typeof existing.sessionId === 'string' && existing.sessionId
        ? [{sessionId: existing.sessionId, credentialKey: legacyKey, bindingKey: legacyBinding, ...(grantId ? {grantId} : {}), generation: 1, addedAt: new Date(now).toISOString()}]
        : [],
    });
  }
  return {
    id: 'profile', version: 1, revision: 1, sources: rows, decisions: [], links: [],
    migrated: {from: 'project_companion_context', at: new Date(now).toISOString(), legacyDigest: legacy?.digest ?? legacyDigest(legacySources)},
  };
}

/**
 * Authorization is a pure question over one stored row. It returns a reason so
 * the connection page can say "reconnect" instead of silently disabling a row.
 */
export function dotAuthorization(row, {credentialKey = null, configured = false, foreground = false, sessionId = null, background = false} = {}) {
  if (!row) return {allowed: false, state: 'disconnected', reason: 'no_grant'};
  if (!configured) return {allowed: false, state: 'needs_authorization', reason: 'credentials_missing'};
  // The stored fingerprint is the account that originally granted access. A
  // different current credential never inherits it.
  if (typeof credentialKey !== 'string') return {allowed: false, state: 'needs_authorization', reason: 'credential_changed'};
  // Dot's own switch only governs Dot's foreground/background reads.
  if (background) {
    if (row.enabled !== true) return {allowed: false, state: 'disconnected', reason: 'switch_off'};
    if (row.credentialKey !== credentialKey) return {allowed: false, state: 'needs_authorization', reason: 'credential_changed'};
    return {allowed: true, state: 'connected', reason: 'dot_background'};
  }
  if (foreground && sessionId) {
    if (row.enabled !== true) return {allowed: false, state: 'disconnected', reason: 'switch_off'};
    if (row.credentialKey !== credentialKey) return {allowed: false, state: 'needs_authorization', reason: 'credential_changed'};
    return {allowed: true, state: 'connected', reason: 'dot_foreground'};
  }
  // An ordinary conversation is governed only by its own grant row, even while
  // Dot's own switch is off.
  if (sessionId) {
    const session = row.allowedSessions.find(item => item.sessionId === sessionId);
    if (!session) return {allowed: false, state: 'disconnected', reason: 'not_added_to_session'};
    if (session.credentialKey !== null && session.credentialKey !== credentialKey) return {allowed: false, state: 'needs_authorization', reason: 'credential_changed'};
    return {allowed: true, state: 'connected', reason: 'session_added'};
  }
  return {allowed: false, state: 'disconnected', reason: 'not_added_to_session'};
}

export function dotSourceState(row, {credentialKey = null, configured = false} = {}) {
  if (!row || row.enabled !== true) return 'disconnected';
  if (!configured || row.credentialKey === null || row.credentialKey !== credentialKey) return 'needs_authorization';
  return 'connected';
}

export function decisionKey(source, itemId) {
  return `${source}:${String(itemId ?? '').slice(0, 360)}`;
}

/**
 * Serialized store. Every mutation bumps `revision`; reads never infer a
 * changed view from an empty result.
 */
export function createDotSources({store, legacyReader = null, clock = () => new Date(), isClosed = () => false} = {}) {
  if (!store?.get || !store?.put) throw new Error('Dot source store required');
  let state = null;
  let hasStored = false;
  let queue = Promise.resolve();
  const serial = work => { const run = queue.then(work); queue = run.catch(() => {}); return run; };
  const parse = value => dotSourcesRowSchema.parse(value);
  const load = async () => {
    if (state) return state;
    const stored = await store.get('profile');
    if (stored != null) { hasStored = true; state = parse(stored); return state; }
    state = parse(emptyDotSourcesRow());
    return state;
  };
  const save = async next => {
    const parsed = parse(next);
    await store.put('profile', structuredClone(parsed));
    state = parsed;
    return parsed;
  };
  const mutate = fn => serial(async () => {
    if (isClosed()) throw Object.assign(new Error('Dot source store closed'), {code: 'DOT_SOURCES_CLOSED'});
    const row = await load();
    const next = structuredClone(row);
    const changed = fn(next);
    if (!changed) return {row, changed: false};
    next.revision = row.revision + 1;
    await save(next);
    return {row: next, changed: true};
  });
  const emptySession = (sessionId, credentialKey = null, bindingKey = null) => ({sessionId, credentialKey, bindingKey, addedAt: new Date(clock()).toISOString()});
  return {
    async ready() {
      await load();
      // Any stored new-domain row means migration already happened (or the user
      // already connected). Never read the legacy domain again after that.
      if (hasStored || state.migrated) return state;
      if (typeof legacyReader === 'function') {
        const legacy = await legacyReader();
        const migrated = migrateLegacySources({legacySources: legacy?.sources ?? [], now: clock(), legacy});
        await save({...migrated, revision: state.revision + 1});
      }
      return state;
    },
    async snapshot() { await load(); return structuredClone(state); },
    /** Synchronous read of the loaded row, for transport authorization callbacks
     *  that must not await between admission and a request. */
    stateOf(source) {
      if (!state) return null;
      const row = state.sources.find(item => item.source === source);
      return row ? structuredClone(row) : null;
    },
    /** All loaded rows, for the synchronous lease bridge used by Family and
     *  personal review. Still no token values; only opaque fingerprints. */
    rowsSync() {
      return state ? structuredClone(state.sources) : [];
    },
    async rowOf(source) { await load(); return structuredClone(state.sources.find(row => row.source === source) ?? null); },
    async enable(source, credentialKey) {
      if (!DOT_SOURCE_IDS.includes(source) || typeof credentialKey !== 'string' || !/^[a-f0-9]{64}$/.test(credentialKey)) throw Object.assign(new Error('Invalid source enable'), {code: 'DOT_SOURCES_INVALID'});
      const now = new Date(clock()).toISOString();
      return mutate(next => {
        const row = next.sources.find(item => item.source === source);
        if (!row) { next.sources.push({source, enabled: true, credentialKey, bindingKey: null, connectedAt: now, lastReadAt: null, lastReadState: null, allowedSessions: []}); return true; }
        row.enabled = true; row.credentialKey = credentialKey;
        // A fresh explicit enable is a new grant: clear the old account's
        // binding id, but keep explicit conversation rows for their own checks.
        row.bindingKey = null; delete row.grantId; row.connectedAt = now; row.lastReadState = null;
        row.generation = (row.generation ?? 0) + 1;
        return true;
      });
    },
    async disable(source) {
      return mutate(next => {
        const row = next.sources.find(item => item.source === source);
        if (!row || row.enabled !== true) return false;
        row.enabled = false;
        row.generation = (row.generation ?? 0) + 1;
        // Revocation must not leave a cacheable title behind.
        row.lastReadAt = null; row.lastReadState = null;
        return true;
      });
    },
    async addSession(source, sessionId, credentialKey = null, bindingKey = null) {
      if (typeof sessionId !== 'string' || !sessionId) throw Object.assign(new Error('Invalid session'), {code: 'DOT_SOURCES_INVALID'});
      return mutate(next => {
        const row = next.sources.find(item => item.source === source);
        if (!row) { next.sources.push({source, enabled: false, credentialKey: null, bindingKey: null, connectedAt: null, lastReadAt: null, lastReadState: null, allowedSessions: [emptySession(sessionId, credentialKey, bindingKey)]}); return true; }
        const epochs = {...(row.sessionEpochs ?? {})};
        const epoch = (epochs[sessionId] ?? row.allowedSessions.find(item => item.sessionId === sessionId)?.generation ?? 0) + 1;
        epochs[sessionId] = epoch;
        row.sessionEpochs = epochs;
        const existing = row.allowedSessions.find(item => item.sessionId === sessionId);
        if (existing) {
          // Re-connecting the same conversation refreshes its binding and
          // credential fingerprint in place; it never creates a second row.
          existing.credentialKey = credentialKey;
          existing.bindingKey = bindingKey;
          existing.addedAt = new Date(clock()).toISOString();
          existing.generation = epoch;
          return true;
        }
        row.allowedSessions = [...row.allowedSessions, {...emptySession(sessionId, credentialKey, bindingKey), generation: epoch}].slice(-50);
        return true;
      });
    },
    async removeSession(source, sessionId) {
      return mutate(next => {
        const row = next.sources.find(item => item.source === source);
        if (!row) return false;
        const kept = row.allowedSessions.filter(item => item.sessionId !== sessionId);
        if (kept.length === row.allowedSessions.length) return false;
        const epochs = {...(row.sessionEpochs ?? {})};
        epochs[sessionId] = (epochs[sessionId] ?? row.allowedSessions.find(item => item.sessionId === sessionId)?.generation ?? 0) + 1;
        row.sessionEpochs = epochs;
        row.allowedSessions = kept;
        return true;
      });
    },
    async recordRead(source, readState, when = clock()) {
      return mutate(next => {
        const row = next.sources.find(item => item.source === source);
        if (!row) return false;
        row.lastReadState = ['ok', 'needs_authorization', 'unavailable'].includes(readState) ? readState : 'unavailable';
        if (readState === 'ok') row.lastReadAt = new Date(when).toISOString();
        else if (readState !== 'unavailable') { row.lastReadAt = null; }
        return true;
      });
    },
    async decide(source, itemId, decision, until = null) {
      const key = decisionKey(source, itemId);
      const now = new Date(clock()).toISOString();
      return mutate(next => {
        next.decisions = next.decisions.filter(item => item.key !== key);
        next.decisions.push({key, state: decision, at: now, ...(until ? {until: new Date(until).toISOString()} : {})});
        if (next.decisions.length > 500) next.decisions = next.decisions.slice(-500);
        return true;
      });
    },
    /** Decisions that still apply. An expired snooze stops applying; it is not
     *  silently rewritten, so the stored record keeps its original time. */
    async activeDecisions(now = clock()) {
      await load();
      const stampNow = Date.parse(now);
      return structuredClone(state.decisions.filter(row => row.state !== 'snoozed' || !row.until || Date.parse(row.until) > stampNow));
    },
    /** Atomic "one dispatch per promise" claim. A pending claim blocks another
     *  caller until it is settled or released. The pre-generated session id is
     *  written at claim time, so a crash after create cannot cause a second
     *  session: the next click sees the accurate pending id. */
    async claimLink(key, root, token, {sessionId = null} = {}) {
      const now = new Date(clock()).toISOString();
      return mutate(next => {
        if (next.links.some(item => item.key === key && item.state === 'pending')) return false;
        const settled = next.links.find(item => item.key === key && item.state === 'ok');
        if (settled) return false;
        next.links = next.links.filter(item => item.key !== key);
        next.links.push({key, state: 'pending', token, sessionId: sessionId ?? null, root: String(root ?? '').slice(0, 4096), at: now});
        return true;
      });
    },
    /** Attach the host's actual session id while the claim is still pending. */
    async bindLink(key, token, {sessionId, root} = {}) {
      return mutate(next => {
        const row = next.links.find(item => item.key === key && item.token === token && item.state === 'pending');
        if (!row || typeof sessionId !== 'string' || !sessionId) return false;
        row.sessionId = sessionId;
        row.root = String(root ?? '').slice(0, 4096);
        return true;
      });
    },
    async settleLink(key, token, {sessionId, root}) {
      return mutate(next => {
        const row = next.links.find(item => item.key === key && item.token === token && item.state === 'pending');
        if (!row) return false;
        row.state = 'ok'; row.sessionId = sessionId; row.root = String(root ?? '').slice(0, 4096); row.at = new Date(clock()).toISOString();
        return true;
      });
    },
    async releaseLink(key, token) {
      return mutate(next => {
        const before = next.links.length;
        next.links = next.links.filter(item => !(item.key === key && item.token === token && item.state === 'pending'));
        return next.links.length !== before;
      });
    },
    async linkOf(key) {
      await load();
      return structuredClone(state.links.find(item => item.key === key) ?? null);
    },
    async close() { state = null; hasStored = false; },
  };
}
