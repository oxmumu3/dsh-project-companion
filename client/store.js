/**
 * The single state source for the Today page (DESIGN.md 4.2).
 *
 * Polls the activity projection every two seconds only while the page is
 * visible, skips redraws when `revision` did not change, and treats an
 * unreachable host as "can't see", never as "nothing happened".
 *
 * Revoking a workspace can remove projects without changing the ledger or
 * source revisions. The projection therefore carries an authorization
 * revision; the store compares that shape too, so the page cannot keep showing
 * a project that was just revoked.
 */
const accessKeyOf = activity => {
  const access = activity?.access;
  const projects = Array.isArray(activity?.projects) ? activity.projects.map(row => row?.id).filter(id => typeof id === 'string').join(',') : '';
  return `${typeof access?.revision === 'string' ? access.revision : ''}|${Number.isSafeInteger(access?.count) ? access.count : ''}|${projects}`;
};
// The source phase can move without a data revision (for example, a first read
// with no enabled source completes with an unchanged empty list). A loading →
// ready move must still redraw, or the page would stay on "reading" forever.
const sourcePhaseOf = activity => ['idle', 'reading', 'ready', 'failed'].includes(activity?.sourcesPhase) ? activity.sourcesPhase : '';

export function createTodayStore({fetchImpl = globalThis.fetch, endpoint = '/api/project_companion/activity', intervalMs = 2000, visibility = globalThis.document, timers = globalThis, timeoutMs = 8000, isActive = () => true} = {}) {
  let snapshot = {phase: 'loading', activity: null, revision: null, accessKey: '', error: null, sampleCleared: false};
  const listeners = new Set();
  let timer = null;
  let active = true;
  const shouldPoll = () => !stopped && visibility?.visibilityState !== 'hidden' && active && isActive?.() !== false;
  let inflight = null;
  let stopped = false;

  function emit(next) {
    snapshot = next;
    for (const listener of listeners) { try { listener(); } catch { /* A broken view cannot stop the store. */ } }
  }

  async function load() {
    if (stopped) return snapshot;
    if (inflight) return inflight;
    const controller = new AbortController();
    const cancel = setTimeout(() => controller.abort('timeout'), timeoutMs);
    inflight = (async () => {
      try {
        const response = await fetchImpl(endpoint, {method: 'GET', credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal: controller.signal});
        if (!response?.ok) throw Object.assign(new Error('activity unavailable'), {code: `HTTP_${response?.status ?? 'UNKNOWN'}`});
        const value = await response.json();
        const next = value && typeof value === 'object' && Number.isSafeInteger(value.revision) ? value : null;
        if (!next) throw Object.assign(new Error('activity invalid'), {code: 'INVALID_PROJECTION'});
        const nextAccess = accessKeyOf(next);
        const same = snapshot.phase === 'ready' && snapshot.revision === next.revision && snapshot.activity?.reachable === next.reachable && snapshot.accessKey === nextAccess && sourcePhaseOf(snapshot.activity) === sourcePhaseOf(next);
        if (same) {
          // Keep the newest payload for the next real diff, but do not emit:
          // an unchanged revision and authorization shape must not redraw.
          snapshot = {...snapshot, activity: next, accessKey: nextAccess};
          return snapshot;
        }
        emit({...snapshot, phase: 'ready', activity: next, revision: next.revision, accessKey: nextAccess, error: null});
        return snapshot;
      } catch (error) {
        if (stopped) return snapshot;
        const previous = snapshot.activity;
        emit({...snapshot, phase: 'ready', activity: previous ? {...previous, reachable: false} : {reachable: false, revision: snapshot.revision ?? 0, counts: null, sessions: [], projects: [], promises: [], sources: []}, error: error?.code ?? 'UNREACHABLE'});
        return snapshot;
      } finally {
        clearTimeout(cancel);
        inflight = null;
      }
    })();
    return inflight;
  }

  function tick() {
    if (!shouldPoll()) return;
    void load();
  }

  function onVisibility() {
    if (shouldPoll()) void load();
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start() {
      if (timer || stopped) return;
      if (shouldPoll()) void load();
      timer = timers.setInterval(tick, intervalMs);
      if (typeof timer?.unref === 'function') timer.unref();
      visibility?.addEventListener?.('visibilitychange', onVisibility);
    },
    /** Called when the page or the floating panel becomes active/inactive. */
    setActive(next) {
      active = next !== false;
      if (shouldPoll()) void load();
    },
    stop() {
      stopped = true;
      if (timer) { timers.clearInterval(timer); timer = null; }
      visibility?.removeEventListener?.('visibilitychange', onVisibility);
      listeners.clear();
    },
    refreshNow: load,
    clearSample() { emit({...snapshot, sampleCleared: true}); },
    sampleCleared: () => snapshot.sampleCleared === true,
  };
}
