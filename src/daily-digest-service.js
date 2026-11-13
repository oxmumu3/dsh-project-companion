/**
 * Daily digest service (brief A–D): read → rule filter → one no-tools model
 * call → program renderer → owner-channel send. One run per local day, 0 items
 * sends nothing, and the previous personal-review daily is muted while this
 * digest is enabled. The rendering cursor (`lastDigestAt`) advances after a
 * successful generation even when nothing is delivered; delivery success is
 * tracked separately. A pending send is persisted before the channel call so a
 * restart cannot produce a second message inside the same local day.
 */
import {createHash} from 'node:crypto';
import {
  MAIL_LIMIT, MAX_ITEMS, dailyDigestRowSchema, emptyDailyDigestRow, localDay, latestOccurrence,
  mailQuery, filterMails, buildMaterial, validateDigestOutput, renderDigest,
} from './daily-digest.js';

const DAY = 86400000;
const GRACE = 6 * 3600000;
const clean = value => typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim() : '';
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const textHash = value => createHash('sha256').update(value).digest('hex');

export function createDailyDigest({store, readSource, readLedger = async () => [], readOwner, sameOwner = (left, right) => JSON.stringify(left) === JSON.stringify(right), schedule = async () => ({dailyTime: '09:00', timeZone: 'Asia/Shanghai'}), summarize, send, enabled = true, clock = () => new Date(), hostTimeZone = () => 'Asia/Shanghai', isClosed = () => false, canRun = async () => true} = {}) {
  for (const [name, dependency] of Object.entries({get: store?.get, put: store?.put, readSource, summarize, send})) if (typeof dependency !== 'function') throw new Error(`Missing daily digest dependency: ${name}`);
  let state = null, closed = false, queue = Promise.resolve();
  const serial = fn => { const next = queue.then(fn); queue = next.catch(() => {}); return next; };
  const now = () => { const value = clock(); if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error('每日整理时钟无效'); return value; };
  const load = async () => {
    if (state) return state;
    const raw = await store.get('profile');
    const parsed = dailyDigestRowSchema.safeParse(raw ?? {...emptyDailyDigestRow(), enabled});
    if (!parsed.success) throw Object.assign(new Error('每日整理状态不兼容或损坏'), {code: 'DIGEST_STORE_INVALID'});
    state = parsed.data;
    return state;
  };
  const save = async next => { const parsed = dailyDigestRowSchema.parse(next); await store.put('profile', parsed); state = parsed; return parsed; };
  const closeGuard = () => { if (closed || isClosed()) throw Object.assign(new Error('每日整理已关闭'), {code: 'DIGEST_CLOSED'}); };
  const zone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || hostTimeZone() || 'Asia/Shanghai'; } catch { return 'Asia/Shanghai'; } };
  async function plan() {
    let value = {};
    try { value = await schedule() ?? {}; } catch { value = {}; }
    const dailyTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(value.dailyTime ?? '') ? value.dailyTime : '09:00';
    const timeZone = typeof value.timeZone === 'string' && value.timeZone ? value.timeZone : zone();
    return {dailyTime, timeZone};
  }
  function windowStart(row, at) {
    // The cursor is the last completed generation, not the last delivery.
    const last = iso(row?.lastDigestAt);
    const from = last ? Date.parse(last) : at - DAY;
    return new Date(at - from > 7 * DAY ? at - DAY : from).toISOString();
  }

  async function recoverPending() {
    const pending = state.pendingSend;
    if (!pending) return false;
    const row = structuredClone(state);
    row.pendingSend = null;
    row.lastStatus = 'uncertain';
    row.lastError = 'DIGEST_SEND_INTERRUPTED';
    row.lastDay = row.lastDay ?? pending.day;
    // The rendering cursor advances to the uncertain attempt, but the Gmail
    // retry window must stay at the absolute start used by that attempt. A
    // failed Gmail read has no lastGmailAt to fall back to; advancing
    // lastDigestAt here used to skip the whole failed window.
    row.lastDigestAt = pending.at;
    if (!iso(row.gmailSince) && !row.lastGmailAt) row.gmailSince = iso(pending.gmailSince) ?? iso(state.lastDigestAt) ?? new Date(Date.parse(pending.at) - DAY).toISOString();
    if (row.lastDigest) row.lastDigest = {...row.lastDigest, status: 'uncertain'};
    await save(row);
    return true;
  }

  async function collect(at) {
    const since = windowStart({lastDigestAt: state.lastGmailAt ?? state.gmailSince ?? state.lastDigestAt}, at.getTime());
    const counts = {mailboxes: 1, mailRaw: 0, mailKept: 0, mailDropped: 0, mailSkipped: 0, mailTruncated: false, lists: 0, listsFailed: 0, promises: 0, events: 0, since, unreadable: []};
    const states = {};
    let mails = [], mailTruncated = false, gmailAt = null;
    try {
      const result = await readSource('gmail', {operation: 'search', query: mailQuery(since), limit: MAIL_LIMIT});
      states.gmail = {state: 'ok', code: null};
      const filtered = filterMails(result.items ?? [], {now: at.getTime(), since});
      mails = filtered.kept;
      counts.mailRaw = (result.items ?? []).length;
      counts.mailKept = mails.length;
      counts.mailDropped = filtered.dropped;
      counts.mailSkipped = filtered.skipped;
      mailTruncated = result.truncated === true;
      counts.mailTruncated = mailTruncated;
      gmailAt = at.toISOString();
      if (filtered.total > MAIL_LIMIT) counts.mailSkipped = filtered.total - MAIL_LIMIT;
    } catch (error) {
      const code = typeof error?.code === 'string' ? error.code : 'CONTEXT_UNAVAILABLE';
      states.gmail = {state: 'unavailable', code};
      counts.unreadable.push('gmail');
    }
    const from = new Date(at.getTime() - 7 * DAY).toISOString(), to = new Date(at.getTime() + 7 * DAY).toISOString();
    const promises = [];
    try {
      const projects = await readSource('dida', {operation: 'projects', limit: 200});
      const rows = (projects.items ?? []).filter(row => String(row.id).toLowerCase() !== 'inbox').slice(0, 200);
      const seen = new Set();
      let readableLists = 0;
      for (const project of rows) {
        try {
          const tasks = await readSource('dida', {operation: 'tasks', projectId: project.id, limit: 200});
          readableLists += 1;
          for (const task of tasks.items ?? []) {
            if (task.status === 'completed') continue;
            const when = iso(task.dueAt);
            if (!when || Date.parse(when) < at.getTime() - 7 * DAY || Date.parse(when) > at.getTime() + 7 * DAY) continue;
            if (seen.has(String(task.id))) continue;
            seen.add(String(task.id));
            promises.push({source: 'dida', sourceItemId: String(task.id), what: clean(task.title).slice(0, 160), when, projectId: String(project.id)});
          }
        } catch {
          counts.listsFailed += 1;
        }
      }
      counts.lists = readableLists;
      if (!readableLists && rows.length) {
        states.dida = {state: 'unavailable', code: 'CONTEXT_UNAVAILABLE'};
        counts.unreadable.push('dida');
      } else {
        states.dida = {state: counts.listsFailed || readableLists < rows.length ? 'partial' : 'ok', code: null};
      }
      try {
        const inbox = await readSource('dida', {operation: 'inboxWindow', from, to});
        for (const task of inbox.items ?? []) {
          if (task.status === 'completed' || seen.has(String(task.id))) continue;
          const when = iso(task.dueAt) ?? iso(task.startAt);
          if (!when || Date.parse(when) < at.getTime() - 7 * DAY || Date.parse(when) > at.getTime() + 7 * DAY) continue;
          seen.add(String(task.id));
          promises.push({source: 'dida', sourceItemId: String(task.id), what: clean(task.title).slice(0, 160), when, projectId: String(task.projectId)});
        }
      } catch {
        if (states.dida.state === 'ok') states.dida = {state: 'partial', code: null};
      }
    } catch (error) {
      const code = typeof error?.code === 'string' ? error.code : 'CONTEXT_UNAVAILABLE';
      states.dida = {state: 'unavailable', code};
      if (!counts.unreadable.includes('dida')) counts.unreadable.push('dida');
    }
    let events = [];
    try {
      const result = await readSource('calendar', {operation: 'upcoming', from: at.toISOString(), to: new Date(at.getTime() + 7 * DAY).toISOString(), limit: 100});
      events = (result.items ?? []).filter(row => row.status !== 'cancelled');
      states.calendar = {state: 'ok', code: null};
    } catch (error) {
      const code = typeof error?.code === 'string' ? error.code : 'CONTEXT_UNAVAILABLE';
      states.calendar = {state: 'unavailable', code};
      counts.unreadable.push('calendar');
    }
    counts.promises = promises.length;
    counts.events = events.length;
    let ledger = [];
    try { ledger = (await readLedger()) ?? []; } catch { states.ledger = {state: 'unavailable', code: 'LEDGER_UNAVAILABLE'}; }
    return {mails, promises, events, ledger, states, counts, since, mailTruncated, gmailAt};
  }

  async function runOnce({trigger = 'manual', force = false, at = now(), owner: ownerInput = null} = {}) {
    closeGuard();
    await load();
    if (!await canRun()) return {status: 'blocked', code: 'DIGEST_PAUSED', text: 'Dot 已暂停，本次没有整理或发送。'};
    const timeZone = (await plan()).timeZone;
    const day = localDay(at, timeZone);
    if (state.pendingSend) return {status: 'uncertain', code: 'DIGEST_PENDING_SEND', day, text: '上一次发送结果不确定；今天不会重发。'};
    if (!force && state.lastDay === day) return {status: 'already', code: 'DIGEST_ALREADY_TODAY', day, text: '今天已经整理过一次；没有重复发送。'};
    // Freeze the live owner before any read or model call. The sender rechecks
    // the same session and both identity fingerprints immediately before send.
    let owner = null;
    if (typeof readOwner === 'function') {
      let current = null;
      try { current = await readOwner(); } catch {}
      if (ownerInput && !sameOwner(ownerInput, current)) return {status: 'blocked', code: 'DIGEST_OWNER_CHANGED', day, text: '微信绑定已变化；本次没有读取或发送。'};
      if (!current) return {status: 'blocked', code: 'DIGEST_OWNER_UNAVAILABLE', day, text: '当前没有可确认的微信主人绑定；本次没有读取或发送。'};
      owner = ownerInput ?? current;
    }
    const data = await collect(at);
    if (typeof readOwner === 'function') {
      let current = null;
      try { current = await readOwner(); } catch { current = null; }
      // Collection can take long enough for the bridge to rotate. Recheck the
      // same session and both identities before the material reaches a model.
      if (!sameOwner(owner, current)) return {status: 'blocked', code: 'DIGEST_OWNER_CHANGED', day, text: '读取期间微信绑定已变化；本次没有交给模型，也没有发送。'};
    }
    const material = buildMaterial({mails: data.mails, promises: data.promises, events: data.events, ledger: data.ledger, states: data.states, counts: data.counts, now: at.getTime(), timeZone, lastDigestAt: state.lastDigestAt});
    let output;
    try {
      output = await summarize({material});
    } catch (error) {
      const code = typeof error?.code === 'string' && /^MODEL_/.test(error.code) ? error.code : 'DIGEST_MODEL_FAILED';
      const row = structuredClone(state);
      row.lastAttemptAt = at.toISOString(); row.lastStatus = 'failed'; row.lastError = code; row.gmailSince = data.since;
      await save(row);
      return {status: 'failed', code, text: '这次整理没有完成，也没有发送。'};
    }
    const checked = validateDigestOutput(output.output ?? output, {mails: data.mails, promises: data.promises, events: data.events});
    const rendered = renderDigest({items: checked.items, mails: data.mails, promises: data.promises, events: data.events, counts: data.counts, now: at.getTime(), timeZone, lastDigestAt: state.lastDigestAt});
    const record = {
      at: at.toISOString(), day, text: rendered.text, status: checked.items.length ? 'sent' : 'quiet',
      items: checked.items, counts: data.counts,
      links: (rendered.text.match(/https:\/\/[^\s]+/g) ?? []).slice(0, 12),
    };
    if (!checked.items.length) {
      const row = structuredClone(state);
      row.lastAttemptAt = at.toISOString(); row.lastDigestAt = data.gmailAt ?? row.lastDigestAt; row.lastGmailAt = data.gmailAt ?? row.lastGmailAt; row.gmailSince = data.since; row.lastDay = day;
      row.lastStatus = 'quiet'; row.lastError = null; row.pendingSend = null;
      row.lastDigest = {...record, status: 'quiet'};
      row.history = [...row.history, row.lastDigest].slice(-30);
      await save(row);
      return {status: 'quiet', code: null, day, counts: data.counts, cursorAdvanced: true, text: '今天没有达到值得看的事，按规则没有发送。', digest: row.lastDigest};
    }
    const requestId = `digest:${day}`;
    const pending = {day, requestId, at: at.toISOString(), textHash: textHash(rendered.text), gmailAt: data.gmailAt, gmailSince: data.since};
    const before = structuredClone(state);
    before.lastAttemptAt = at.toISOString(); before.lastDigestAt = data.gmailAt ?? before.lastDigestAt; before.lastGmailAt = data.gmailAt ?? before.lastGmailAt; before.gmailSince = data.since; before.lastDay = day; before.lastStatus = 'uncertain'; before.lastError = null;
    before.pendingSend = pending; before.lastDigest = {...record, status: 'uncertain'};
    // Persist the attempt before the channel call: a crash after this point can
    // never produce a second send today, and the same requestId is reused.
    await save(before);
    let delivery;
    try { delivery = await send({text: rendered.text, day, requestId, at: at.toISOString(), owner}); }
    catch { delivery = {status: 'uncertain'}; }
    const status = delivery?.status === 'reported_sent' ? 'sent' : delivery?.status === 'blocked' ? 'blocked' : 'uncertain';
    const row = structuredClone(state);
    row.pendingSend = null;
    row.lastAttemptAt = at.toISOString(); row.lastDigestAt = data.gmailAt ?? row.lastDigestAt; row.lastGmailAt = data.gmailAt ?? row.lastGmailAt; row.gmailSince = data.since;
    row.lastStatus = status; row.lastError = status === 'sent' ? null : 'DELIVERY_' + status.toUpperCase();
    row.lastDigest = {...record, status};
    if (status === 'sent') row.lastSentAt = at.toISOString();
    row.history = [...row.history, row.lastDigest].slice(-30);
    await save(row);
    return {status, day, counts: data.counts, cursorAdvanced: true, digest: row.lastDigest, text: rendered.text};
  }

  function run(options = {}) {
    return serial(() => runOnce(options));
  }

  return {
    ready() {
      return serial(async () => {
        await load();
        await recoverPending();
        return structuredClone(state);
      });
    },
    enabled() { return state?.enabled === true; },
    /** Kept for callers that need to know whether today already has a
     *  completed digest; muting the old review uses enabled() per the brief. */
    async ranToday() {
      await load();
      const {timeZone} = await plan();
      return state.lastDay === localDay(now(), timeZone) && ['sent', 'quiet', 'uncertain', 'blocked'].includes(state.lastStatus);
    },
    needsTimer() { return !closed && !isClosed() && state?.enabled === true; },
    tick() {
      // The occurrence read/write and the run share the same serial gate as a
      // manual run: a queued manual send can never overwrite the claim and
      // produce a second send for the same day.
      return serial(async () => {
        if (closed || isClosed()) return null;
        await load();
        if (state.enabled !== true) return null;
        if (!await canRun()) return null;
        const schedule = await plan();
        const due = latestOccurrence(now(), schedule.dailyTime, schedule.timeZone);
        if (!due || state.lastOccurrence === due.id) return null;
        if (now().getTime() - due.epoch > GRACE) {
          const row = structuredClone(state); row.lastOccurrence = due.id; await save(row);
          return {status: 'expired', code: 'DIGEST_MISSED', text: '错过今天的整理窗口，不补发。'};
        }
        // Do not consume today's occurrence when the bridge is mounted but the
        // owner is not ready yet. A late mount can then still run today.
        let owner = null;
        if (typeof readOwner === 'function') {
          try { owner = await readOwner(); } catch { owner = null; }
          if (!owner) return {status: 'blocked', code: 'DIGEST_OWNER_UNAVAILABLE', text: '主人绑定尚未就绪；今天这次定时没有消耗。'};
        }
        const row = structuredClone(state); row.lastOccurrence = due.id; await save(row);
        return runOnce({trigger: 'tick', at: now(), owner});
      });
    },
    manual(options = {}) { return serial(() => runOnce({trigger: 'manual', ...options, at: options.at ?? now()})); },
    async probe() {
      closeGuard();
      try {
        const result = await readSource('gmail', {operation: 'search', query: 'newer_than:1d', limit: 1});
        return {status: 'ok', source: 'gmail', count: Array.isArray(result.items) ? result.items.length : 0, truncated: result.truncated === true, code: null};
      } catch (error) {
        return {status: 'blocked', source: 'gmail', count: 0, truncated: false, code: typeof error?.code === 'string' ? error.code : 'CONTEXT_UNAVAILABLE'};
      }
    },
    async view() {
      await load();
      const schedule = await plan();
      const at = now();
      const next = new Date(at.getTime() + DAY);
      const nextRun = latestOccurrence(next, schedule.dailyTime, schedule.timeZone);
      const last = state.lastDigest;
      const statusText = {
        sent: '已通过主人通道发出（手机送达未知）', quiet: '没有值得看的，按规则保持安静',
        failed: '这次没有完成，没有发送', blocked: '发送被拦住，没有发出', uncertain: '发送结果不确定，没有自动重发',
      }[state.lastStatus] ?? '还没有整理过';
      const text = last
        ? `每日整理：${statusText}\n整理时间：${last.at}\n\n${last.text}`
        : `每日整理：${statusText}。每天 ${schedule.dailyTime}（${schedule.timeZone}）整理一次；0 件不发。`;
      return {
        status: 'ok', view: 'digest', enabled: state.enabled, schedule,
        lastStatus: state.lastStatus, lastAt: state.lastAttemptAt, lastDigestAt: state.lastDigestAt,
        lastSentAt: state.lastSentAt, lastDay: state.lastDay, lastError: state.lastError,
        pendingSend: state.pendingSend, lastDigest: last,
        nextRunAt: nextRun ? new Date(nextRun.epoch).toISOString() : null,
        counts: last?.counts ?? null, items: last?.items ?? [],
        text,
      };
    },
    close() { closed = true; return queue; },
  };
}
