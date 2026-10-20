const identity = value => typeof value === 'string' && value.length > 0 && value.length <= 200;
const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 10000;

/**
 * Deliberately closed, whole-message grammar. Unknown wording, quotation,
 * attachments and any extra question/task stay with the normal agent path.
 * This recognizes a transport request; it makes no delivery claim.
 */
export function isWechatRecoveryOnlyMessage(message) {
  if (message?.role !== 'user' || message.source?.kind !== 'user' || !Array.isArray(message.content) || message.content.length !== 1) return false;
  const block = message.content[0];
  if (block?.type !== 'text' || typeof block.text !== 'string' || block.text.length > 256) return false;
  const clauses = block.text.trim().replace(/[。.!！]+$/u, '').split(/[，,；;。\n]/u).map(value => value.replace(/\s/gu, ''));
  if (clauses.length < 1 || clauses.length > 4 || clauses.some(value => !value)) return false;
  const receive = /^(?:请)?(?:只|仅)?(?:继续|恢复)?(?:收取|接收)(?:刚才|之前)?(?:的)?(?:微信)?(?:缓存|暂存)(?:的)?(?:回复|消息)(?:就好|就行|即可)?$/u;
  const noTask = /^(?:也)?(?:不要|别)(?:再)?(?:重新|重复)?(?:执行|运行|做)(?:刚才的|之前的|原来的)?任务$/u;
  const noReminder = /^(?:也)?(?:不要|别)(?:再)?(?:新增|新建|创建|增加)(?:任何)?提醒$/u;
  return receive.test(clauses[0]) && clauses.slice(1).every(value => noTask.test(value) || noReminder.test(value));
}

/**
 * The bridge asks this synchronous bail hook only after its own auto-flush,
 * with the original frozen message and exact live agent. A session binding,
 * a queued ledger row or text at the generic agent seam is insufficient.
 *
 * Consume before enqueue, so recovery opens no agent turn and cannot cancel
 * current work or strand another waking message behind a pre-step rejection.
 * The bridge remains solely responsible for its transfer result and status.
 */
export function createWechatRecoveryGuard({ ctx } = {}) {
  if (typeof ctx?.on !== 'function' || typeof ctx?.effect !== 'function') return { close() {} };
  const disposers = [];
  let closed = false;
  const live = agent => {
    try { return identity(agent?.id) && ctx.get('agents', false)?.get(agent.id) === agent; }
    catch { return false; }
  };
  disposers.push(ctx.on('wechat/inbound-admit', payload => {
    const { agent, message, receipt } = payload ?? {};
    if (closed || !live(agent) || !identity(message?.id) || receipt?.attempted !== true || !['sent', 'remaining', 'dropped'].every(key => count(receipt[key])) || !isWechatRecoveryOnlyMessage(message)) return;
    return { kind: 'transport-only' };
  }, { prepend: true }));
  function close() {
    if (closed) return;
    closed = true;
    for (const dispose of disposers.reverse()) dispose?.();
  }
  ctx.effect(() => close, 'project-companion:wechat-recovery-lifetime');
  return { close };
}
