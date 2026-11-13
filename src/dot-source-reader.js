/**
 * Rule-based source reader for the Today page (DESIGN.md 3.3 path one).
 *
 * It re-reads a fixed window instead of asking a model what matters: Dida lists
 * (including Inbox) with open tasks due between seven days ago and seven days
 * ahead, and Calendar events in the next seven days. It owns no store and no
 * session; every call goes through `read`, which is the Dot-named context read
 * (switch on, credential fingerprint unchanged).
 *
 * A source that cannot be read becomes `unavailable` ("不知道"), never an empty
 * list. Previously read items stay visible with a note instead of disappearing.
 */
import {createHash} from 'node:crypto';
import {DIDA_INBOX_PROTOCOL_STAGES} from './dida-rest.js';
import {DOT_BULK_SOURCES, decisionKey} from './dot-sources.js';

const DAY = 86400000;
const MAX_PROMISES = 60;
// A failed Inbox window drops only that batch. Authorization, cancellation and
// binding failures still make the whole source unavailable.
const INBOX_PARTIAL_CODES = new Set([
  'CONTEXT_PROTOCOL_INVALID', 'CONTEXT_HTTP_ERROR', 'CONTEXT_RESPONSE_TOO_LARGE', 'CONTEXT_REDIRECT',
  'CONTEXT_UNSUPPORTED_OPERATION', 'CONTEXT_SCHEMA_MISMATCH', 'CONTEXT_ARGUMENTS_INVALID',
]);
const cleanText = value => typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, 200) : '';
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const promiseId = (source, itemId) => `${source}_${createHash('sha256').update(`${source}:${itemId}`).digest('hex').slice(0, 32)}`;

export function whenText(value, now = new Date(), timeZone = 'Asia/Shanghai') {
  const stamp = iso(value);
  if (!stamp) return '';
  try {
    const time = new Intl.DateTimeFormat('zh-CN', {timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).format(new Date(stamp));
    const dayOf = ms => new Intl.DateTimeFormat('en-CA', {timeZone, year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date(ms));
    const today = dayOf(now.getTime()), target = dayOf(Date.parse(stamp));
    const diff = Math.round((Date.parse(`${target}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY);
    if (diff === 0) return `今天 ${time}`;
    if (diff === 1) return `明天 ${time}`;
    if (diff === -1) return `昨天 ${time}`;
    const weekday = new Intl.DateTimeFormat('zh-CN', {timeZone, weekday: 'short'}).format(new Date(stamp));
    return `${weekday} ${time}`;
  } catch { return ''; }
}

/**
 * Pure projection for tests and for the page. `items` are already-read rows;
 * `states` maps source -> `{state, lastReadAt, code?}`. A failed source keeps
 * its last good rows with an explanatory note.
 */
export function projectPromises({items = [], states = {}, decisions = [], now = new Date(), timeZone = 'Asia/Shanghai'} = {}) {
  const applied = new Map();
  for (const row of decisions) applied.set(row.key, row);
  const promises = [];
  for (const item of items) {
    const source = item.source;
    const state = states[source]?.state ?? 'ok';
    if (state === 'disabled') continue;
    if (item.status === 'completed' || item.status === 'cancelled') continue;
    const when = iso(item.when);
    if (!when) continue;
    const decision = applied.get(decisionKey(source, item.sourceItemId));
    if (decision && decision.state !== 'snoozed') continue;
    if (decision?.state === 'snoozed' && decision.until && Date.parse(decision.until) > now.getTime()) {
      // Snoozed items stay visible but are pushed after everything actionable.
    }
    const basis = item.whenBasis === 'start' ? 'start' : 'due';
    const dateText = whenText(when, now, timeZone);
    promises.push({
      id: promiseId(source, item.sourceItemId),
      when,
      whenText: basis === 'start' && dateText ? `开始 · ${dateText}` : dateText,
      whenBasis: basis,
      what: cleanText(item.what),
      from: source === 'dida' ? '滴答清单' : source === 'calendar' ? 'Google 日历' : source,
      judged: false,
      source,
      sourceItemId: String(item.sourceItemId).slice(0, 200),
      ...(item.linkProjectId ? {linkProjectId: item.linkProjectId} : {}),
      ...(state !== 'ok' ? {note: '这次没读到，下面是上次读到的'} : {}),
      ...(decision?.state === 'snoozed' ? {note: '你让它稍后再说'} : {}),
    });
  }
  const rank = row => row.note === '你让它稍后再说' ? 1 : 0;
  promises.sort((a, b) => rank(a) - rank(b) || Date.parse(a.when) - Date.parse(b.when));
  return promises.slice(0, MAX_PROMISES).map(({whenText: text, ...row}) => ({...row, whenText: text}));
}

export function createDotSourceReader({
  sources,
  read,
  decisions = async () => [],
  clock = () => new Date(),
  hostTimeZone = () => 'Asia/Shanghai',
  windowDays = 7,
  intervalMs = 15 * 60 * 1000,
  timers = globalThis,
  isClosed = () => false,
  authorized = null,
  identity = null,
} = {}) {
  if (!sources?.rowOf || typeof read !== 'function') throw new Error('Dot source reader needs source rows and a read function');
  let cache = {promises: [], sources: [], revision: 0, lastAttemptAt: null, lastSuccessAt: null};
  let lastAttempt = 0;
  let lastGood = new Map();
  let cachedIdentity = new Map();
  let inflight = null;
  const identityOf = source => { try { return typeof identity === 'function' ? String(identity(source)) : null; } catch { return null; } };
  let timer = null;
  let stopped = false;
  let metrics = {};

  const timeZone = () => { try { return hostTimeZone() || 'Asia/Shanghai'; } catch { return 'Asia/Shanghai'; } };

  async function enabledRows() {
    const rows = [];
    for (const source of DOT_BULK_SOURCES) {
      const row = await sources.rowOf(source);
      if (row?.enabled === true) rows.push({source, row});
    }
    return rows;
  }

  async function readDida() {
    const started = Date.now();
    const stats = {source: 'dida', requests: 0, failed: 0, rateLimited: false, lists: 0, undone: 0, inboxWindow: 0, inWindow: 0, truncated: false, ms: 0, code: null};
    const countFailure = error => {
      stats.failed += 1;
      if (error?.rateLimited === true || error?.status === 429) stats.rateLimited = true;
    };
    metrics.dida = stats;
    const request = async input => {
      stats.requests += 1;
      try { return await read('dida', input); }
      catch (cause) {
        countFailure(cause);
        if ((input.projectId === 'inbox' || input.operation === 'inboxWindow') && cause?.code === 'CONTEXT_PROTOCOL_INVALID' && DIDA_INBOX_PROTOCOL_STAGES.includes(cause.inboxProtocolStage)) {
          stats.inboxProtocolStage = cause.inboxProtocolStage;
        }
        // A provider 401/403 is a lost grant even when the transport cannot
        // classify a scope challenge. Never keep a snapshot under it.
        if (cause?.status === 401) throw Object.assign(new Error('unauthorized'), {code: 'CONTEXT_AUTH_REQUIRED', status: 401});
        if (cause?.status === 403) throw Object.assign(new Error('forbidden'), {code: 'CONTEXT_INSUFFICIENT_SCOPE', status: 403});
        throw cause;
      }
    };
    const projects = await request({operation: 'projects', limit: 200});
    const now = clock().getTime();
    const from = now - windowDays * DAY, to = now + windowDays * DAY;
    const inWindow = value => {
      const stamp = iso(value);
      if (!stamp) return false;
      const time = Date.parse(stamp);
      return time >= from && time <= to;
    };
    const items = [];
    const seenTaskIds = new Set();
    const addListTasks = (tasks, sourceProjectId) => {
      stats.truncated ||= tasks.truncated === true;
      for (const task of tasks.items) {
        if (task.status === 'completed') continue;
        stats.undone += 1;
        const due = iso(task.dueAt);
        if (!due || Date.parse(due) < from || Date.parse(due) > to) continue;
        stats.inWindow += 1;
        seenTaskIds.add(String(task.id));
        items.push({source: 'dida', sourceItemId: task.id, what: task.title, when: due, whenBasis: 'due', projectId: task.projectId || sourceProjectId});
      }
    };
    // Only the literal Inbox alias is unverifiable as a named list. Any other
    // project id is read normally; the window response is de-duplicated by the
    // exact task id after both reads, never by an id prefix.
    const listRows = projects.items.slice(0, 200).filter(project => String(project.id).toLowerCase() !== 'inbox');
    stats.lists = listRows.length;
    stats.truncated ||= projects.truncated === true;
    for (const project of listRows) {
      addListTasks(await request({operation: 'tasks', projectId: project.id, limit: 200}), project.id);
    }
    let inboxError = null;
    try {
      const window = await request({
        operation: 'inboxWindow',
        from: new Date(from).toISOString(),
        to: new Date(to).toISOString(),
      });
      stats.truncated ||= window.truncated === true;
      for (const task of window.items) {
        if (task.status === 'completed') continue;
        if (seenTaskIds.has(String(task.id))) continue;
        stats.inboxWindow += 1;
        const due = iso(task.dueAt), start = iso(task.startAt);
        // The provider's sample cannot say whether it filters by due or start.
        // Accept either date, but show the due date whenever one exists.
        const dueHit = due && inWindow(due), startHit = start && inWindow(start);
        if (!dueHit && !startHit) continue;
        stats.inWindow += 1;
        items.push({
          source: 'dida', sourceItemId: task.id, what: task.title,
          when: due || start,
          whenBasis: due ? 'due' : 'start',
          projectId: task.projectId || 'inbox',
        });
      }
    } catch (error) {
      if (!INBOX_PARTIAL_CODES.has(error?.code)) throw error;
      inboxError = {code: error.code};
      stats.inboxFailed = 1;
      stats.inboxCode = error.code;
      if (error.inboxProtocolStage) stats.inboxProtocolStage = error.inboxProtocolStage;
    }
    stats.ms = Date.now() - started;
    metrics.dida = stats;
    return {items, ...(inboxError ? {inboxError} : {})};
  }

  async function readCalendar() {
    const started = Date.now();
    const now = clock();
    const stats = {source: 'calendar', requests: 1, pages: 1, lastPageHasMore: false, lastPageHasNextSyncToken: false, events: 0, ms: 0, code: null};
    metrics.calendar = stats;
    const result = await read('calendar', {
      operation: 'upcoming',
      from: now.toISOString(),
      to: new Date(now.getTime() + windowDays * DAY).toISOString(),
      limit: 100,
    });
    stats.events = result.items.length;
    stats.pages = result.coverage?.pages ?? 1;
    stats.requests = stats.pages;
    stats.lastPageHasMore = result.coverage?.hasMore === true;
    stats.lastPageHasNextSyncToken = result.coverage?.hasNextSyncToken === true;
    stats.truncated = result.truncated === true || stats.lastPageHasMore;
    stats.ms = Date.now() - started;
    metrics.calendar = stats;
    return {items: result.items.map(row => ({
      source: 'calendar',
      sourceItemId: row.id,
      what: row.title || '日程',
      when: iso(row.startAt),
      status: row.status,
    })), coverage: result.coverage ?? {pages: 1, hasMore: false}};
  }

  async function refreshOnce() {
    if (stopped || isClosed()) return cache;
    const rows = await enabledRows();
    const enabledSet = new Set(rows.map(row => row.source));
    // Turning a switch off removes its cached rows immediately; they must not
    // survive as a stale promise list.
    for (const key of [...lastGood.keys()]) if (!enabledSet.has(key)) { lastGood.delete(key); cachedIdentity.delete(key); }
    const states = {};
    const items = [];
    for (const {source} of rows) {
      if (!DOT_BULK_SOURCES.includes(source)) continue;
      const startIdentity = identityOf(source);
      try {
        const readResult = source === 'dida' ? await readDida() : await readCalendar();
        const readItems = readResult.items;
        // The result belongs to the identity that produced it. If the account,
        // credential or grant epoch moved while the request was in flight, the
        // answer is discarded instead of being labelled with the new identity.
        const endIdentity = identityOf(source);
        if (startIdentity !== null && endIdentity !== null && startIdentity !== endIdentity) {
          lastGood.delete(source); cachedIdentity.delete(source);
          states[source] = {state: 'unavailable', lastReadAt: null, code: 'CONTEXT_BINDING_CHANGED'};
          metrics[source].code = 'CONTEXT_BINDING_CHANGED';
          try { await sources.recordRead?.(source, 'unavailable', clock()); } catch { /* keep the discard */ }
          continue;
        }
        lastGood.set(source, readItems);
        if (endIdentity !== null) cachedIdentity.set(source, endIdentity);
        states[source] = {
          state: 'ok', lastReadAt: new Date(clock()).toISOString(),
          ...(readResult.inboxError ? {partial: true, partialReason: 'inbox_window'} : {}),
        };
        if (readResult.coverage && metrics.calendar) {
          metrics.calendar.truncated = metrics.calendar.truncated === true || readResult.coverage.hasMore === true;
        }
        items.push(...readItems);
        metrics[source].code = null;
        await sources.recordRead?.(source, 'ok', clock());
      } catch (error) {
        const code = typeof error?.code === 'string' ? error.code : 'CONTEXT_UNAVAILABLE';
        const state = code === 'CONTEXT_AUTH_REQUIRED' || code === 'CONTEXT_INSUFFICIENT_SCOPE' ? 'needs_authorization' : code === 'CONTEXT_NOT_ENABLED' ? 'disabled' : 'unavailable';
        states[source] = {state, lastReadAt: cache.sources.find(row => row.id === source)?.lastReadAt ?? null, code};
        // Revocation or a changed account is not a transient failure: drop the
        // source's cached titles so nothing remains visible after access ended.
        if (state !== 'unavailable') { lastGood.delete(source); cachedIdentity.delete(source); }
        else if (cachedIdentity.get(source) === identityOf(source)) items.push(...(lastGood.get(source) ?? []));
        else { lastGood.delete(source); cachedIdentity.delete(source); }
        if (metrics[source]) metrics[source].code = code;
        try { await sources.recordRead?.(source, state === 'needs_authorization' ? 'needs_authorization' : 'unavailable', clock()); } catch { /* Recording a failure must not mask it. */ }
      }
    }
    const decisionRows = await decisions();
    const nextPromises = projectPromises({items, states, decisions: decisionRows, now: clock(), timeZone: timeZone()});
    const sourceList = Object.entries(states)
      .filter(([, value]) => value.state !== 'disabled')
      .map(([id, value]) => {
        const stats = metrics[id];
        return {
          id, state: value.state,
          ...(stats?.truncated === true || value.partial === true ? {partial: true} : {}),
          ...(value.partialReason ? {partialReason: value.partialReason} : {}),
          ...(value.lastReadAt ? {lastReadAt: value.lastReadAt} : {}),
          ...(value.code ? {code: value.code} : {}),
          // Sanitized counts only: enough to record rate limits and window
          // sizes without exposing any task, event or list title.
          ...(stats ? {stats: {requests: stats.requests ?? 0, ...(stats.lists !== undefined ? {lists: stats.lists} : {}), ...(stats.undone !== undefined ? {undone: stats.undone} : {}), ...(stats.inWindow !== undefined ? {inWindow: stats.inWindow} : {}), ...(stats.events !== undefined ? {events: stats.events} : {}), ms: stats.ms ?? 0, truncated: stats.truncated === true}} : {}),
        };
      });
    const changed = JSON.stringify(nextPromises) !== JSON.stringify(cache.promises) || JSON.stringify(sourceList) !== JSON.stringify(cache.sources);
    cache = {
      revision: cache.revision + (changed ? 1 : 0),
      promises: nextPromises,
      sources: sourceList,
      lastAttemptAt: new Date(clock()).toISOString(),
      lastSuccessAt: Object.values(states).some(row => row.state === 'ok') ? new Date(clock()).toISOString() : cache.lastSuccessAt,
    };
    lastAttempt = clock().getTime();
    return cache;
  }

  function refresh() {
    if (inflight) return inflight;
    inflight = refreshOnce().finally(() => { inflight = null; });
    return inflight;
  }

  return {
    /** Cached view; starts a stale background read but never waits for it. */
    snapshot() {
      // A projection read never starts a provider request. Only the explicit
      // page-open refresh (activity route) or the 15-minute timer does.
      // Authorization is checked on the snapshot itself, not on the next
      // refresh: a closed switch or changed credential must not leak a title.
      let promises = cache.promises, sources = cache.sources;
      if (typeof identity === 'function') {
        // Each cached source carries the identity that produced it. A mismatch
        // drops that source on the first snapshot after the change, before any
        // refresh can relabel old rows; the revision advances so the activity
        // projection and its subscribers see the change.
        let advanced = false;
        for (const row of cache.sources) {
          const produced = cachedIdentity.get(row.id) ?? null;
          const current = identityOf(row.id);
          if (produced === null || current === null || produced === current) continue;
          lastGood.delete(row.id);
          cachedIdentity.delete(row.id);
          promises = promises.filter(item => item.source !== row.id);
          sources = sources.filter(item => item.id !== row.id);
          advanced = true;
        }
        if (advanced) cache = {...cache, revision: cache.revision + 1, promises, sources};
      }
      if (typeof authorized === 'function') {
        const allowed = new Set();
        for (const row of cache.sources) {
          try { if (authorized(row.id) === true) allowed.add(row.id); } catch { /* not authorized */ }
        }
        promises = promises.filter(row => allowed.has(row.source));
        sources = sources.filter(row => allowed.has(row.id));
      }
      return {promises, sources, revision: cache.revision, lastAttemptAt: cache.lastAttemptAt, lastSuccessAt: cache.lastSuccessAt};
    },
    async refreshNow() { return refresh(); },
    refreshIfStale() {
      if (clock().getTime() - lastAttempt < intervalMs) return Promise.resolve(cache);
      return refresh();
    },
    metrics() { return structuredClone(metrics); },
    start() {
      if (timer || typeof timers.setInterval !== 'function' || intervalMs <= 0) return;
      timer = timers.setInterval(() => { void refresh().catch(() => {}); }, intervalMs);
      if (typeof timer?.unref === 'function') timer.unref();
    },
    stop() {
      stopped = true;
      if (timer && typeof timers.clearInterval === 'function') timers.clearInterval(timer);
      timer = null;
      lastGood = new Map();
      cachedIdentity = new Map();
      cache = {promises: [], sources: [], revision: cache.revision + 1, lastAttemptAt: cache.lastAttemptAt, lastSuccessAt: null};
    },
  };
}
