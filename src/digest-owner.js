/**
 * Digest owner identity is deliberately two separate fingerprints:
 * - setupBindingKey: the legacy userId/botId row that identifies the candidate
 *   WeChat conversation;
 * - bindingKey: the live guarded bridge's channel epoch + actual session.
 * They are not comparable across sources. Both are frozen before a digest reads
 * and rechecked before its one send.
 */
export const digestOwnerSnapshot = (setup, binding) => {
  if (setup?.state !== 'bound' || typeof setup.sessionId !== 'string' || !setup.sessionId) return null;
  if (typeof setup.bindingKey !== 'string' || !/^[a-f0-9]{64}$/.test(setup.bindingKey)) return null;
  if (!binding || binding.bound !== true || typeof binding.bindingKey !== 'string' || !/^[a-f0-9]{64}$/.test(binding.bindingKey)) return null;
  return {sessionId: setup.sessionId, setupBindingKey: setup.bindingKey, bindingKey: binding.bindingKey};
};

export const sameDigestOwner = (left, right) => Boolean(
  left && right &&
  left.sessionId === right.sessionId &&
  left.setupBindingKey === right.setupBindingKey &&
  left.bindingKey === right.bindingKey,
);

/** Delivery gate: freeze both identities, then recheck the same owner and send
 *  with the live binding key only. The legacy setup key is never handed to the
 *  bridge as an expected binding. */
export const createDigestOwnerChannel = ({readSetup, readBridge, readBinding, isClosed = () => false}) => {
  if (typeof readSetup !== 'function' || typeof readBridge !== 'function' || typeof readBinding !== 'function') throw new Error('Digest owner channel needs setup, bridge and binding readers');
  const resolve = async () => {
    let setup;
    try { setup = await readSetup(); } catch { return null; }
    const bridge = readBridge();
    if (!bridge) return null;
    const sessionId = setup?.sessionId;
    const binding = typeof sessionId === 'string' ? readBinding(sessionId) : null;
    return digestOwnerSnapshot(setup, binding);
  };
  return {
    resolve,
    async send({owner, text, requestId}) {
      if (isClosed()) return {status: 'blocked'};
      const current = await resolve();
      if (!sameDigestOwner(owner, current)) return {status: 'blocked'};
      const bridge = readBridge();
      if (!bridge || typeof bridge.send !== 'function') return {status: 'blocked'};
      try {
        const result = await bridge.send({sessionId: owner.sessionId, expectedBinding: owner.bindingKey, requestId, text, authorize: () => !isClosed()});
        return {status: result?.status === 'accepted' ? 'reported_sent' : result?.status === 'blocked' ? 'blocked' : 'uncertain'};
      } catch { return {status: 'uncertain'}; }
    },
  };
};

/** Family identities are rejected before either owner branch is considered. */
export const digestCallerIsOwner = ({sessionId, desktopId, owner, family = false} = {}) => {
  if (typeof sessionId !== 'string' || !sessionId || family) return false;
  if (typeof desktopId === 'string' && desktopId === sessionId) return true;
  return Boolean(owner && owner.sessionId === sessionId);
};
