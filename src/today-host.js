/** The official 0.2.2-rc.1 front-of-house contract.
 *
 * - busy: the live agent registry, `agents.get(sessionId).status === 'running'`
 *   (the same predicate SessionController.list uses). `resolveAgent` is an
 *   internal SessionCommands shape and is deliberately not called.
 * - delivery: `sessionController.prompt(request, AbortSignal)` for both idle
 *   and busy, with the official `queue` and `steer` modes.
 */
export function createTodayHost({ctx, timeoutMs = 20000} = {}) {
  const controller = () => { try { return ctx.get('sessionController', false); } catch { return null; } };
  const agentOf = sessionId => {
    try { return ctx.get('agents', false)?.get?.(sessionId) ?? null; } catch { return null; }
  };
  return {
    async busy(sessionId) {
      const agent = agentOf(sessionId);
      return typeof agent?.status === 'string' ? agent.status === 'running' : null;
    },
    async prompt(sessionId, text, {steer = false} = {}) {
      const api = controller();
      if (typeof api?.prompt !== 'function') throw Object.assign(new Error('no session controller'), {code: 'HOST_PROMPT_UNSUPPORTED'});
      const request = {
        sessionId,
        requestId: `dot-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`,
        mode: steer ? 'steer' : 'queue',
        content: [{type: 'text', text}],
      };
      const signal = AbortSignal.timeout(timeoutMs);
      await api.prompt(request, signal);
      return request;
    },
  };
}
