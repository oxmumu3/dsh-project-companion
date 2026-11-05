/** 本机自检报告的纯格式化层。
 *
 *  这里不读任何东西：调用方只注入本机已有状态的探测函数（助理快照、个人回顾
 *  状态、资讯状态、已启用来源、微信路由、待投递队列），本模块负责超时、把抛错
 *  归一成「未知」、去掉内部编号／ISO 时间／英文状态码，并压到 1500 字符以内。
 *  抛错、超时、返回值不合法的探测一律显示「未知」，绝不当作没问题。
 */
const MAX_CHARS = 1500, DETAIL_MAX = 120, DEFAULT_TIMEOUT_MS = 2000;
const ROWS = [['assistant', '助理'], ['wechat', '微信'], ['sources', '资料来源'], ['review', '个人回顾'], ['news', 'AI 资讯'], ['delivery', '投递']];
const STATE_TEXT = { ok: '正常', warn: '需要留意', unknown: '未知', off: '未启用' };
const ISO = /\d{4}-\d\d-\d\d[T ]\d\d:\d\d(?::\d\d(?:\.\d{1,6})?)?(?:Z|[+-]\d\d:?\d\d)?/g;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const SNAKE = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g;
const CODES = /\b(?:queued|blocked|pending|dispatching|uncertain|failed|expired|cancelled|canceled|scheduled|enqueued|generating|quiet|unknown|ok|off|sent)\b/gi;

/** 报告是给本人看的：内部编号、ISO 时刻、英文状态码都不进正文。 */
const clean = value => String(value ?? '')
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
  .replace(ISO, '（时间略）').replace(UUID, '（编号略）').replace(SNAKE, '（略）').replace(CODES, '（略）')
  .replace(/\s+/g, ' ').trim().slice(0, DETAIL_MAX);

/** 本地化时刻；时区不可用时明确写「时间未知」，不猜、不回落到 UTC。 */
function localStamp(now, hostTimeZone) {
  try {
    const value = now instanceof Date ? now : new Date(now);
    if (!Number.isFinite(value.getTime())) throw new Error();
    return { ok: true, text: new Intl.DateTimeFormat('zh-CN', { timeZone: hostTimeZone, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(value) };
  } catch { return { ok: false, text: '时间未知' }; }
}
function within(value, timeoutMs) {
  let timer;
  return Promise.race([
    Promise.resolve().then(() => value),
    new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error('PROBE_TIMEOUT')), timeoutMs); }),
  ]).finally(() => clearTimeout(timer));
}
async function run(probe, timeoutMs) {
  if (typeof probe !== 'function') return { state: 'unknown', detail: '本次没有可用的本机探测，不能判断为正常' };
  try {
    const value = await within(probe(), timeoutMs);
    if (!value || typeof value !== 'object') return { state: 'unknown', detail: '探测没有返回可用状态' };
    const detail = clean(value.detail);
    if (!Object.hasOwn(STATE_TEXT, value.state)) return { state: 'unknown', detail: detail || '探测返回了无法识别的状态' };
    return { state: value.state, detail };
  } catch { return { state: 'unknown', detail: '探测没有完成，不能判断为正常' }; }
}
function advice(rows, stamp) {
  const warn = rows.find(row => row[1].state === 'warn');
  if (rows.some(row => row[1].state === 'unknown')) return '建议：有项目状态未知，先重跑一次自检；仍未知就到 Dot 连接页或连接状态里核对，别把未知当成没问题。';
  if (!stamp.ok) return '建议：先核对电脑时间与时区设置，再重跑一次自检。';
  if (warn) return `建议：先处理「${warn[0]}」这一项，再重跑一次自检确认。`;
  if (rows.some(row => row[1].state === 'off')) return '建议：关掉的功能需要时在 Dot 里开启；本次只核对本机状态，没有验证微信送达或外部账号可读。';
  return '建议：各项本机状态正常，无需处理；本次自检没有访问外部账号，也不代表手机已经收到过消息。';
}

/** 探测并发执行；每项超时或抛错都只影响自己那一行，且一定是「未知」。 */
export async function buildDoctorReport({ now, hostTimeZone, probes = {}, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const stamp = localStamp(now, hostTimeZone);
  const zone = typeof hostTimeZone === 'string' && hostTimeZone.length > 0 && hostTimeZone.length <= 100 ? hostTimeZone : '时区未知';
  const ms = Number.isSafeInteger(timeoutMs) && timeoutMs >= 50 && timeoutMs <= 10000 ? timeoutMs : DEFAULT_TIMEOUT_MS;
  const results = await Promise.all(ROWS.map(([key]) => run(probes?.[key], ms)));
  const rows = ROWS.map(([, label], index) => {
    const row = results[index];
    if (label === '助理' && !stamp.ok && row.state !== 'unknown') return [label, { state: 'warn', detail: '本机时间或时区读不出来，先核对电脑时间设置' }];
    return [label, row];
  });
  const text = rows.map(([label, row]) => {
    const suffix = label === '助理' ? `（自检于 ${stamp.text}，${zone}）` : '';
    const detail = label === '助理' && row.detail ? `${row.detail}${suffix}` : row.detail || suffix;
    return `${label}：${STATE_TEXT[row.state]}${detail ? ` · ${detail}` : ''}`;
  });
  text.push(advice(rows, stamp));
  const full = text.join('\n');
  if (full.length <= MAX_CHARS) return full;
  // 兜底：先去掉逐项细节，仍超长只截正文，绝不让正文吞掉最后的建议。
  const compact = rows.map(([label, row]) => `${label}：${STATE_TEXT[row.state]}`);
  compact.push(advice(rows, stamp));
  const trimmed = compact.join('\n');
  return trimmed.length <= MAX_CHARS ? trimmed : `${trimmed.slice(0, MAX_CHARS - 1)}…`;
}
