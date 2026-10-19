import { isAbsolute, parse, resolve } from 'node:path';
import { sessionLogOf } from '../vendor/proactive/lib/wake.js';

const identity = value => typeof value === 'string' && value.length > 0 && value.length <= 200;
const canonicalRoot = value => typeof value === 'string' && value.length <= 4096 && isAbsolute(value) && value === resolve(value) && value !== parse(value).root;
const reason = 'The welcome brief is restricted to selected project memory/digest; no writes, sends, code or handoffs';

/** A message-bound read-only scope for the first onboarding brief, with no timer. */
export function createWelcomeGuard({ ctx, authorize } = {}) {
  let capable = false;
  try { capable = typeof ctx?.on === 'function' && typeof ctx?.effect === 'function' && typeof ctx?.tools?.guard === 'function' && typeof authorize === 'function'; } catch { /* Admission below remains a certain rejection. */ }
  if (!capable) return { admit: () => ({ accepted: false, reason: 'Welcome read-only host hooks are unavailable' }), close: async () => {} };
  const entries = new Map(), admittedExecutions = new WeakSet(), disposers = [];
  let closed = false, closing;
  const registryAgent = id => { try { return ctx.get('agents', false)?.get(id); } catch { return undefined; } };
  const cwdOf = agent => {
    try {
      const directory = agent.ctx?.get?.('workingDirectory', false) ?? ctx.get('workingDirectory', false);
      const value = typeof directory?.get === 'function' ? directory.get(agent.session) : agent.session?.header?.cwd;
      return typeof value === 'string' && isAbsolute(value) && value.length <= 4096 ? resolve(value) : undefined;
    } catch { return undefined; }
  };
  const find = agent => {
    const entry = agent?.id && entries.get(String(agent.id));
    return entry?.agent === agent ? entry : undefined;
  };
  const forget = entry => {
    if (entries.get(entry.scope.sessionId) === entry) entries.delete(entry.scope.sessionId);
    entry.resolveSettled();
  };
  function boundary(entry) {
    try {
      const events = sessionLogOf(entry.agent.session);
      for (let index = events.length - 1; index >= 0; index--) {
        const event = events[index];
        if ((event.type === 'turn/start' || event.type === 'turn/end') && Number.isInteger(event.data?.turn)) return { turn: event.data.turn, ended: event.type === 'turn/end' };
      }
    } catch { return null; }
    return Number.isInteger(entry.observedTurn) ? { turn: entry.observedTurn, ended: false } : null;
  }
  const current = entry => {
    const last = boundary(entry);
    return entry.turn !== null && last?.turn === entry.turn && !last.ended;
  };
  const valid = entry => !closed && !entry.revoked && entries.get(entry.scope.sessionId) === entry && registryAgent(entry.scope.sessionId) === entry.agent && cwdOf(entry.agent) === entry.scope.cwd && current(entry);
  function cancelOwn(entry) {
    if (entry.cancelled || registryAgent(entry.scope.sessionId) !== entry.agent || !current(entry)) return;
    entry.cancelled = true;
    try { entry.agent.cancel({ kind: 'user' }, { keepInbox: true }); } catch { /* The guard still rejects this scope until settlement. */ }
  }
  function revoke(entry) { entry.revoked = true; cancelOwn(entry); }
  function waitForSettlement(entry) {
    if (!current(entry) || entry.agent.status === 'idle') { forget(entry); return Promise.resolve(); }
    // A rejected driver wait is not settlement. Keep the monotonic guard until
    // a committed turn/end, idle status or a successful quiescence readback.
    const idle = Promise.resolve().then(() => entry.agent.whenIdle()).then(() => {
      if (!current(entry) || entry.agent.status === 'idle') { forget(entry); return; }
      return entry.settled;
    }, () => entry.settled);
    return Promise.race([idle, entry.settled]);
  }
  function active(agent) {
    const entry = find(agent);
    if (!entry || entry.turn === null) return undefined;
    if (!current(entry)) { forget(entry); return undefined; }
    return entry;
  }
  const allowed = (entry, execution) => execution.name === 'project_companion' && ['memory', 'digest'].includes(execution.arguments?.action) && entry.scope.roots.includes(execution.arguments.project);
  async function permitted(entry) {
    if (!valid(entry)) { revoke(entry); return false; }
    let allowedRoute = false;
    try { allowedRoute = await authorize(entry.scope) === true; } catch { /* An unavailable route is not permission. */ }
    if (!allowedRoute || !valid(entry)) { revoke(entry); return false; }
    return true;
  }
  const mixed = (entry, messages) => messages?.some(message => message.source?.kind === 'user' && message.id !== entry.scope.messageId);

  disposers.push(ctx.tools.guard(execution => {
    const entry = active(execution.agent); if (!entry) return;
    if (!valid(entry) || !allowed(entry, execution) || !admittedExecutions.has(execution)) return reason;
  }));
  disposers.push(ctx.on('tools/pre-execute', async (execution, next) => {
    const entry = active(execution.agent); if (!entry) return next();
    if (!allowed(entry, execution)) return { kind: 'deny', reason };
    const decision = await next();
    if (decision.kind === 'deny') return decision;
    if (!await permitted(entry)) return { kind: 'deny', reason: 'Welcome source, project authorization or original binding changed' };
    admittedExecutions.add(execution);
    return decision;
  }));
  disposers.push(ctx.on('agent/inbox/claimed', payload => {
    const entry = find(payload.agent); if (!entry || !Number.isInteger(payload.turn)) return;
    entry.observedTurn = payload.turn;
    if (payload.message?.id === entry.scope.messageId) {
      if (entry.turn !== null && entry.turn !== payload.turn) { revoke(entry); return; }
      entry.turn = payload.turn;
      if (entry.foreignTurns.has(payload.turn) || closed) revoke(entry);
    } else if (payload.message?.source?.kind === 'user') {
      entry.foreignTurns.add(payload.turn);
      if (entry.turn === payload.turn) revoke(entry);
      else if (entry.turn !== null) forget(entry);
    }
  }));
  disposers.push(ctx.on('agent/inbox/inserted', payload => {
    const entry = active(payload.agent);
    if (entry && payload.message?.source?.kind === 'user' && payload.message.id !== entry.scope.messageId) revoke(entry);
  }));
  disposers.push(ctx.on('agent/pre-step', async (payload, next) => {
    const entry = find(payload.agent); if (!entry) return next();
    if (entry.turn === null) {
      if (payload.messages?.some(message => message.id === entry.scope.messageId)) { entry.revoked = true; return { kind: 'reject' }; }
      return next();
    }
    if (entry.turn !== payload.turn) { forget(entry); return next(); }
    if (mixed(entry, payload.messages)) { revoke(entry); return { kind: 'reject' }; }
    const decision = await next();
    if (decision.kind === 'reject') return decision;
    if (mixed(entry, decision.messages) || !await permitted(entry)) { revoke(entry); return { kind: 'reject' }; }
    return decision;
  }));
  disposers.push(ctx.on('agent/turn-stopping', async payload => {
    const entry = active(payload.agent);
    if (entry?.turn === payload.turn && !await permitted(entry)) cancelOwn(entry);
  }));
  disposers.push(ctx.on('agent/inbox/discarded', payload => {
    const entry = find(payload.agent); if (!entry || payload.message?.id !== entry.scope.messageId) return;
    if (entry.turn === null) forget(entry); else revoke(entry);
  }));
  disposers.push(ctx.on('session/event', (session, event) => {
    const entry = entries.get(String(session?.id));
    if (entry?.agent.session === session && event?.type === 'turn/end' && event.data?.turn === entry.turn) forget(entry);
  }));
  disposers.push(ctx.on('agent/status', payload => { const entry = find(payload.agent); if (entry && entry.turn !== null && payload.status === 'idle') forget(entry); }));
  disposers.push(ctx.on('agent/disposed', payload => {
    const entry = find(payload.agent); if (!entry) return;
    entry.revoked = true;
    if (entry.turn === null) forget(entry); else void waitForSettlement(entry);
  }));

  function admit({ agent, message, roots, bindingKey } = {}) {
    if (closed) return { accepted: false, reason: 'Welcome guard is closed' };
    if (!identity(agent?.id) || registryAgent(agent.id) !== agent || !identity(message?.id) || message.source?.kind !== 'user' || !Array.isArray(roots) || roots.length < 1 || roots.length > 5 || roots.some(root => !canonicalRoot(root)) || new Set(roots).size !== roots.length || typeof bindingKey !== 'string' || !/^[a-f0-9]{64}$/.test(bindingKey)) return { accepted: false, reason: 'Invalid live source, selected roots, message or binding key' };
    const existing = find(agent);
    if (existing) return existing.scope.messageId === message.id && existing.scope.bindingKey === bindingKey && existing.scope.roots.length === roots.length && existing.scope.roots.every((root, index) => root === roots[index]) ? { accepted: true, duplicate: true } : { accepted: false, reason: 'A welcome scope is already pending for this source' };
    const cwd = cwdOf(agent);
    if (!cwd || agent.status !== 'idle' || typeof agent.cancel !== 'function' || typeof agent.whenIdle !== 'function' || typeof agent.inbox?.remove !== 'function') return { accepted: false, reason: 'A quiescent current source with cancellation and inbox capabilities is required' };
    const scope = Object.freeze({ sessionId: String(agent.id), messageId: message.id, roots: Object.freeze([...roots]), cwd, bindingKey });
    let resolveSettled;
    const settled = new Promise(resolve => { resolveSettled = resolve; });
    entries.set(scope.sessionId, { agent, scope, turn: null, observedTurn: null, foreignTurns: new Set(), revoked: false, cancelled: false, settled, resolveSettled });
    return { accepted: true };
  }
  function close() {
    if (closing) return closing;
    closed = true;
    const draining = [];
    for (const entry of [...entries.values()]) {
      entry.revoked = true;
      if (entry.turn === null) {
        try { entry.agent.inbox.remove(entry.scope.messageId); } catch { /* Do not cancel an unrelated current turn. */ }
        forget(entry);
      } else if (current(entry)) {
        cancelOwn(entry);
        draining.push(waitForSettlement(entry));
      } else forget(entry);
    }
    closing = (async () => {
      await Promise.allSettled(draining);
      entries.clear();
      for (const dispose of disposers.reverse()) dispose?.();
    })();
    return closing;
  }
  // Cordis unloads sibling effects concurrently. Collect these exact effect
  // disposers into one generator-owned bracket; its children unwind serially
  // in reverse order, so close/drain must finish before any guard is removed.
  ctx.effect(function* () {
    for (const dispose of disposers) yield dispose;
    yield () => close();
  }, 'project-companion:welcome-readonly-lifetime');
  return { admit, close };
}
