/** 私人资料读取标记与「读过私人资料后再外发」的确认门禁。
 *
 *  边界（很重要，别把这里当成真正的信息流控制）：
 *  - 宿主自带的 `send_wechat` 工具不在本插件控制范围内。本门禁只覆盖 Dot 自己的
 *    外发路径：ai_digest 的 send_now 与 personal_review 的 run_now。模型直接调用
 *    send_wechat、把内容贴进别的工具或换一个会话，都不经过这里。
 *  - 标记是会话级提示（「这个会话刚才读过私人来源」），不记录具体内容，也不检查
 *    即将发出去的正文。它要求本人再确认一次，不证明外发内容里没有私人资料。
 *  - 定时发送（资讯日报、回顾定时回顾）在服务内部直接投递，不经过工具层，因此
 *    本门禁不覆盖它们。
 *  - 只存时间与来源标签，按会话隔离，只在本进程内存里，不落盘、不保存正文。
 */
const TTL_MS = 30 * 60 * 1000, MAX_TOTAL = 200, MAX_PER_SESSION = 20, MAX_SESSION_ID = 200, MAX_SOURCE = 60;
const marks = new Map();

export const PRIVATE_EGRESS_BLOCKED_TEXT = '本次会话刚读过你的私人资料。要把它整理的内容发到微信，请先确认一次。';

const stampOf = value => {
  const at = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : NaN;
  if (!Number.isFinite(at)) throw new Error('私人读取标记需要有效时间');
  return at;
};
const keyOf = sessionId => {
  if (typeof sessionId !== 'string' || !sessionId || sessionId.length > MAX_SESSION_ID) throw new Error('私人读取标记需要真实会话');
  return sessionId;
};
const labelOf = source => String(source ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, MAX_SOURCE) || 'private';

/** 成功读取私人来源后调用。同一会话只保留最近若干条，整体也有上限。 */
export function markPrivateRead(sessionId, { at = new Date(), source = 'private' } = {}) {
  const key = keyOf(sessionId), stamp = stampOf(at), label = labelOf(source);
  const rows = (marks.get(key) ?? []).concat({ at: stamp, source: label }).slice(-MAX_PER_SESSION);
  // Reinsert so eviction drops the least recently marked session, not the busiest.
  marks.delete(key); marks.set(key, rows);
  while (marks.size > MAX_TOTAL) marks.delete(marks.keys().next().value);
  return { at: stamp, source: label };
}

/** 返回窗口内最近的标记；窗口外、没有标记或时间不合法时返回 null。 */
export function privateReadSince(sessionId, now, ttlMs = TTL_MS) {
  const key = keyOf(sessionId), at = stampOf(now), ttl = Number.isSafeInteger(ttlMs) && ttlMs > 0 ? ttlMs : TTL_MS;
  const rows = marks.get(key);
  if (!rows) return null;
  for (let index = rows.length - 1; index >= 0; index--) {
    const age = at - rows[index].at;
    if (age >= 0 && age <= ttl) return { at: rows[index].at, source: rows[index].source, ageMs: age };
  }
  return null;
}

/** 门禁判定：窗口内读过私人资料且这次调用没有明确确认时，返回阻断文案。 */
export function privateEgressBlocked(sessionId, now, confirmed) {
  if (confirmed === true) return null;
  return privateReadSince(sessionId, now) ? PRIVATE_EGRESS_BLOCKED_TEXT : null;
}

/** 插件重新装载时从干净状态开始：标记本来就只活在内存里，装载前的不属于这次运行。 */
export function clearPrivateReads() {
  marks.clear();
}
