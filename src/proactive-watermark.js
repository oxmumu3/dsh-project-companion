import { createHash } from 'node:crypto';
import { z } from 'zod';
import { isGoogleWorkspaceSource } from './google-data-isolation.js';
import { DEFAULT_PROACTIVE_SETTINGS } from './personal-profile.js';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const BATCH = 90_000;
const supported = new Set(['flomo', 'dida', 'ticktick', 'eventkit', 'workspace', 'dsh']);
const isGoogle = source => isGoogleWorkspaceSource(source) || source === 'google' || source.startsWith('google_');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const xml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export function fenceProactiveEvent(event) {
  return '<event source="' + xml(text(event.source, 64)) + '" untrusted="true">' +
    xml(JSON.stringify({externalId: event.externalId, state: event.state, text: text(event.text, 2400)})) + '</event>';
}

const insightSchema = z.object({
  id: z.string(), unread: z.boolean(), category: z.string(), title: z.string(), eyebrow: z.string(),
  prompt: z.string(), sourceRef: z.string(), suggestedReplies: z.array(z.string()).max(3), createdAt: z.string(),
}).strict();
const feedbackSchema = z.object({
  id: z.string(), kind: z.enum(['dismiss', 'reject', 'explicit']), patternKey: z.string(),
  summary: z.string(), quote: z.string(), quoteSource: z.string(), sourceKind: z.enum(['manual', 'chat']),
}).strict();
const prebakeSchema = z.object({
  origin: z.enum(['proactive_prebake', 'adopted_prebake']),
  hidden: z.boolean(), patternKey: z.string(),
  prebakeTrigger: z.object({source: z.string(), workspace: z.string(), tokenCost: z.number().int().nonnegative()}).strict(),
}).strict();
export const proactiveWatermarkRowSchema = z.object({
  id: z.literal('profile'), version: z.literal(1),
  watermarks: z.record(z.string(), z.string()), seen: z.record(z.string(), z.string()),
  liveInsight: insightSchema.nullable(), insightPattern: z.string(), insightUrgent: z.boolean(),
  feedback: z.array(feedbackSchema).max(60),
  prebakes: z.record(z.string(), prebakeSchema),
  budgetDay: z.string(), pushed: z.number().int().nonnegative(), prepared: z.number().int().nonnegative(),
}).strict();

const empty = () => ({
  id: 'profile', version: 1, watermarks: {}, seen: {}, liveInsight: null, insightPattern: '', insightUrgent: false, feedback: [],
  prebakes: {}, budgetDay: '', pushed: 0, prepared: 0,
});

function localTime(now, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({type, value}) => [type, value]));
  return {day: [values.year, values.month, values.day].join('-'), time: values.hour + ':' + values.minute};
}

function quietAt(time, {start, end}) {
  return start < end ? time >= start && time < end : start > end && (time >= start || time < end);
}

const externalAction = new Set(['approval_required', 'needs_user_input', 'schedule_conflict', 'actionable']);
function supportedProposal(proposal, rows) {
  if (!proposal || !Array.isArray(proposal.evidence)) return [];
  const evidence = rows.filter(row => proposal.evidence.includes(row.externalId));
  const crossSource = new Set(evidence.map(row => row.source)).size >= 2;
  return crossSource || evidence.some(row => externalAction.has(row.state)) ? evidence : [];
}

export function createProactiveWatermark({
  store, readSettings = () => DEFAULT_PROACTIVE_SETTINGS, readRules = () => [], readWatermarks = () => [],
  classifyLocal, classifyGoogle, authorizeEvents = rows => rows, canUseGoogle = () => true,
  rememberCandidates, prepare, dismissPrebake, strongPush, dream,
  canRun = () => true, clock = () => new Date(), timeZone = () => 'Asia/Shanghai', timers = globalThis,
  onChange = () => {}, onError = () => {}, signal,
} = {}) {
  let state, tail = Promise.resolve(), closed = false, timer, batchTimer, dueAt = 0;
  let lastChatAt = -Infinity, lastScanAt = -Infinity, lastScanSlot = '', lastDreamDay = '', batch = new Map(), scanVersion = 0;

  function serial(fn) {
    const next = tail.then(async () => {
      if (!state) {
        const stored = await store?.get('profile');
        state = stored == null ? empty() : proactiveWatermarkRowSchema.parse(stored);
      }
      return fn();
    });
    tail = next.catch(() => {});
    return next;
  }
  async function save(next) {
    await store?.put('profile', proactiveWatermarkRowSchema.parse(next));
    state = next;
  }
  const running = async () => !closed && !signal?.aborted && await canRun();
  const local = () => {
    try { return localTime(clock(), timeZone()); }
    catch { return localTime(clock(), 'UTC'); }
  };
  async function settings() {
    const value = await readSettings();
    return {...DEFAULT_PROACTIVE_SETTINGS, ...value,
      quietHours: {...DEFAULT_PROACTIVE_SETTINGS.quietHours, ...value?.quietHours}};
  }
  function armBatch() {
    if (!timer || batchTimer || !dueAt) return;
    batchTimer = timers.setTimeout(() => {
      batchTimer = undefined;
      void flush().catch(onError);
    }, Math.max(0, dueAt - clock().getTime()));
    batchTimer.unref?.();
  }
  async function scan({scheduled = false} = {}) {
    const admission = await serial(async () => {
      if (!await running()) return null;
      const config = await settings();
      const now = clock().getTime(), {day, time} = local();
      if (config.cadence === 'off') { scanVersion += 1; batch.clear(); dueAt = 0; return null; }
      if (scheduled && config.cadence === '10m' && now - lastScanAt < 10 * MINUTE) return null;
      const slot = day + (time < '18:00' ? ':morning' : ':evening');
      if (scheduled && config.cadence === 'twice_daily' && (time < '08:00' || lastScanSlot === slot)) return null;
      lastScanAt = now;
      lastScanSlot = slot;
      return ++scanVersion;
    });
    if (!admission) return {changed: 0};
    const observations = await readWatermarks({signal});
    return serial(async () => {
      if (admission !== scanVersion || !await running() || (await settings()).cadence === 'off') return {changed: 0};
      const now = clock().getTime(), {day} = local();
      const next = structuredClone(state);
      if (next.budgetDay !== day) {
        next.budgetDay = day; next.pushed = 0; next.prepared = 0;
        next.seen = Object.fromEntries(Object.entries(next.seen).filter(([, seenDay]) => seenDay === day));
      }
      let changed = 0;
      for (const {source, watermark, events = []} of observations ?? []) {
        if (typeof source !== 'string' || !(supported.has(source) || isGoogle(source)) || watermark == null) continue;
        const fingerprint = hash(watermark);
        if ((batch.get(source)?.fingerprint ?? next.watermarks[source]) === fingerprint) continue;
        const rows = [];
        for (const event of events.slice(0, 40)) {
          if (typeof event?.externalId !== 'string' || !event.externalId || typeof event.state !== 'string') continue;
          const key = hash([source, event.externalId, event.state, day]);
          if (next.seen[key] === day) continue;
          rows.push({...event, source, key});
        }
        if (rows.length) batch.set(source, {fingerprint, rows});
        else {
          batch.delete(source);
          next.watermarks[source] = fingerprint;
        }
        changed += rows.length;
      }
      await save(next);
      if (batch.size && changed) {
        dueAt = now + BATCH;
        if (batchTimer) { timers.clearTimeout(batchTimer); batchTimer = undefined; }
        armBatch();
      }
      return {changed};
    });
  }

  async function deliver(proposal, rows, config, {day, time}, google) {
    const evidence = supportedProposal(proposal, rows);
    if (!evidence.length) return;
    const sources = [...new Set(evidence.map(row => row.source))];
    const source = sources.find(value => value !== 'workspace') ?? sources[0];
    const urgent = proposal.category === 'schedule_conflict' && evidence.some(row => row.state === 'schedule_conflict');
    if (quietAt(time, config.quietHours) && !urgent) return;
    const id = 'dot-proactive-' + hash(evidence.map(row => row.key).sort()).slice(0, 24);
    const patternKey = text(proposal.category, 60) || source;
    const ruleId = 'rule-' + createHash('sha256').update(patternKey).digest('hex').slice(0, 24);
    if ((await readRules()).some(rule => rule.id === ruleId && rule.sourceKind === 'manual' && rule.active)) return;
    if (!google && proposal.decision === 'Prepare' && config.autoPrebake === true && proposal.confidence >= 0.85 &&
      sources.length >= 2 && prepare && state.prepared < Math.min(2, config.dailyPrebakeCap)) {
      const workspace = text(evidence.find(row => row.workspaceLabel === proposal.workspace)?.workspaceLabel ??
        evidence.find(row => row.workspaceLabel)?.workspaceLabel ?? proposal.workspace, 120);
      const prebakeTrigger = {source, workspace, tokenCost: Math.max(0, Math.floor(Number(proposal.tokenCost) || 0))};
      // Debit before dispatch, so restarts and failed receipts cannot spend the slot twice.
      const metadata = {origin: 'proactive_prebake', hidden: true, patternKey, prebakeTrigger};
      await save({...state, prepared: state.prepared + 1, prebakes: {...state.prebakes, [id]: metadata}});
      const result = await prepare({id, proposal, evidence, signal});
      if (result?.id === id && !closed) {
        await save({...state, prebakes: {...state.prebakes, [id]: {...metadata, hidden: false}}});
        onChange();
      }
      return;
    }
    if (proposal.decision !== 'Notify' || state.liveInsight?.unread && Date.parse(state.liveInsight.createdAt) > clock().getTime() - DAY) return;
    // Google-derived text can be read in the whisper, but the CTA never copies
    // it into the owner transcript or a subsequent DeepSeek call.
    const prompt = google ? '打开连接，查看这条 Google 轻提醒。' : text(proposal.prompt, 1000);
    const title = text(proposal.title, 160);
    if (!prompt || !title) return;
    const liveInsight = {id, unread: true, category: patternKey, title, eyebrow: text(proposal.eyebrow, 200),
      prompt, sourceRef: sources.join(' × '), suggestedReplies: google ? [] :
        (Array.isArray(proposal.suggestedReplies) ? proposal.suggestedReplies.map(value => text(value, 120)).filter(Boolean).slice(0, 3) : []),
      createdAt: clock().toISOString()};
    await save({...state, liveInsight, insightPattern: patternKey, insightUrgent: urgent});
    onChange();
    if (!google && proposal.strong === true && strongPush && state.pushed < Math.min(3, config.dailyPushCap) &&
        clock().getTime() - lastChatAt >= 3 * MINUTE) {
      await save({...state, budgetDay: day, pushed: state.pushed + 1});
      await strongPush(liveInsight, {signal});
    }
  }

  async function flush() {
    const work = await serial(async () => {
      if (!dueAt || clock().getTime() < dueAt || !await running()) return null;
      const config = await settings();
      if (config.cadence === 'off') { batch.clear(); dueAt = 0; return null; }
      if (batchTimer) { timers.clearTimeout(batchTimer); batchTimer = undefined; }
      const {day} = local();
      const next = structuredClone(state);
      if (next.budgetDay !== day) {
        next.budgetDay = day; next.pushed = 0; next.prepared = 0; next.seen = {};
      }
      const localRows = [], googleRows = [];
      for (const [source, {fingerprint, rows}] of batch) {
        next.watermarks[source] = fingerprint;
        for (const row of rows) {
          const key = hash([source, row.externalId, row.state, day]);
          if (next.seen[key] === day) continue;
          next.seen[key] = day;
          (isGoogle(source) ? googleRows : localRows).push({...row, key});
        }
      }
      await save(next);
      batch = new Map(); dueAt = 0;
      return {localRows, googleRows};
    });
    if (!work) return {processed: 0};
    const {localRows, googleRows} = work;
    await Promise.all([[localRows, classifyLocal, false], [googleRows, classifyGoogle, true]].map(async ([rows, classifier, google]) => {
      if (!rows.length || !classifier || !await running()) return;
      try {
        if (google && !await canUseGoogle()) return;
        const permitted = await authorizeEvents(rows);
        if (!permitted.length || !await running()) return;
        const check = async () => {
          if (!await running() || (await settings()).cadence === 'off' ||
            (await authorizeEvents(permitted)).length !== permitted.length) throw new Error('STAGE4_AUTHORIZATION_CHANGED');
        };
        const quotas = new Map();
        const modelRows = permitted.filter(row => {
          const count = (quotas.get(row.source) ?? 0) + 1;
          quotas.set(row.source, count);
          return count <= 12;
        }).slice(0, 72);
        const rules = google ? [] : (await readRules()).filter(rule => rule.active && ['manual', 'chat'].includes(rule.sourceKind))
          .map(rule => rule.text).slice(0, 15);
        const output = await classifier({events: modelRows.map(fenceProactiveEvent), rules, signal, check});
        await serial(async () => {
          const config = await settings();
          if (config.cadence === 'off' || !await running()) return;
          const current = local();
          if (state.budgetDay !== current.day) await save({...state, budgetDay: current.day, pushed: 0, prepared: 0});
          const confirmed = await authorizeEvents(modelRows);
          if (!google && Array.isArray(output?.memories)) await rememberCandidates?.(output.memories, confirmed);
          const proposals = output?.proposals ?? output;
          for (const proposal of Array.isArray(proposals) ? proposals : [proposals]) {
            if (!await running()) break;
            await deliver(proposal, confirmed, config, current, google);
          }
        });
      } catch (error) { onError(error); }
    }));
    return {processed: localRows.length + googleRows.length};
  }

  const feedback = (id, patternKey, summary) => {
    const quote = '用户忽略了这类主动建议（' + patternKey + '）';
    return {id, kind: 'dismiss', patternKey, summary, quote, quoteSource: 'Dot 操作回执 ' + id, sourceKind: 'manual'};
  };
  const enqueue = entry => [...state.feedback.filter(row => row.id !== entry.id), entry].slice(-60);
  function runDream({force = false} = {}) {
    return serial(async () => {
      if (!dream || !await running()) return {ok: false, error: '暂时无法复盘记忆。'};
      const receipts = new Map(state.feedback.map(row => [row.quoteSource, row.quote]));
      const result = await dream({force, feedback: state.feedback}, {readEvidence: entry =>
        receipts.get(entry)});
      if (result?.ok && !result.skipped && state.feedback.length) await save({...state, feedback: []});
      if (result?.ok) lastDreamDay = local().day;
      return result;
    });
  }
  async function tick() {
    if (!await running()) return;
    const current = local();
    if (current.time >= '22:30' && current.day !== lastDreamDay && dream) await runDream();
    await scan({scheduled: true});
    await flush();
    // The next mobile/desktop snapshot can now pick up an idle whisper.
    if (state?.liveInsight?.unread && lastChatAt !== -Infinity && clock().getTime() - lastChatAt >= 3 * MINUTE) {
      lastChatAt = -Infinity;
      onChange();
    }
  }
  return {
    scan, flush, runDream,
    start() {
      if (timer || closed) return;
      timer = timers.setInterval(() => void tick().catch(onError), MINUTE);
      timer.unref?.();
      void tick().catch(onError);
    },
    noteChat() { lastChatAt = clock().getTime(); },
    async recordCorrection({id, summary, quote}) {
      return serial(async () => {
        const entry = feedbackSchema.parse({id: text(id, 140), kind: 'explicit', patternKey: 'owner:' + hash(summary).slice(0, 24),
          summary: text(summary, 240), quote: text(quote, 320), quoteSource: '用户原话 ' + text(id, 140), sourceKind: 'chat'});
        if (entry.summary && entry.quote) await save({...state, feedback: enqueue(entry)});
      });
    },
    getPrebakeMetadata(id) { return state?.prebakes?.[id] ?? null; },
    async snapshot() {
      return serial(async () => {
        const config = await settings(), active = state.liveInsight;
        const show = config.cadence !== 'off' && active?.unread && Date.parse(active.createdAt) > clock().getTime() - DAY &&
          clock().getTime() - lastChatAt >= 3 * MINUTE && (state.insightUrgent || !quietAt(local().time, config.quietHours));
        return {liveInsight: show ? {...active} : null, proactiveSettings: config};
      });
    },
    actInsight({id, operation, action} = {}) {
      return serial(async () => {
        const current = state.liveInsight;
        const op = operation ?? action;
        const targetId = id ?? current?.id;
        if (!current?.id || current.id !== targetId || !['dismiss', 'mark_read'].includes(op)) return {ok: false, error: '这条提醒已更新。'};
        if (!current.unread) return {ok: true};
        await save({...state, liveInsight: {...current, unread: false}, feedback: op === 'dismiss'
          ? enqueue(feedback(targetId, state.insightPattern, '减少「' + state.insightPattern + '」类主动提醒')) : state.feedback});
        onChange();
        return {ok: true};
      });
    },
    actPrebake({id, action} = {}) {
      return serial(async () => {
        const current = Object.hasOwn(state.prebakes, id) ? state.prebakes[id] : null;
        if (current?.origin !== 'proactive_prebake' || current.hidden || !['dismiss_prebake', 'adopt_prebake'].includes(action)) {
          return {ok: false, error: '这项预办已更新。'};
        }
        const dismiss = action === 'dismiss_prebake';
        if (dismiss && dismissPrebake && !await dismissPrebake(id)) return {ok: false, error: '预办正在变化，请刷新后重试。'};
        await save({...state, prebakes: {...state.prebakes, [id]: {...current,
          origin: dismiss ? current.origin : 'adopted_prebake', hidden: dismiss}},
        feedback: dismiss ? enqueue(feedback(id, current.patternKey, '减少「' + current.patternKey + '」类预办')) : state.feedback});
        onChange();
        return {ok: true};
      });
    },
    close() {
      closed = true;
      if (timer) timers.clearInterval(timer);
      if (batchTimer) timers.clearTimeout(batchTimer);
      batch.clear();
      return tail;
    },
  };
}
