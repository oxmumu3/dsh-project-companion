import {reviewGoalSchema,meetingCacheSchema,changeReviewGoal,activeReviewGoals,calendarCoverageComplete,captureReviewMeetings,dueReviewMeeting,prepareReviewMeeting,selectMeetingPreparation,meetingWorkHours} from './personal-review-goals.js';
import {recoveryCheck,recoveryWindow,recoveryWorkTime,RECOVERY_CHECKPOINT_INTERVAL} from './personal-review-recovery.js';
import { attentionDue, attentionStatus, selectAttentionItems } from './personal-review-attention.js';
import { randomUUID } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import { z } from 'zod';
import { personalReviewFailure, personalReviewDiagnosticSchema, personalReviewAvailabilitySchema, personalReviewGuardCodeSchema, personalReviewRecoveryDiagnosticSchema } from './personal-review-diagnostics.js';
import { reviewTaskCheckSchema, reviewSourceTaskKey, trackedReviewSourceTasks, reconcileReviewSourceTasks, MAX_TRACKED_REVIEW_TASKS } from './personal-review-source-tasks.js';
import { canonicalizeTimeZone, makeLocalFormatter, localProjection, resolveLocalInstant } from '../vendor/proactive/lib/domain.js';
import { reviewSources, reviewId, reviewInstant, reviewEvidenceSchema, reviewCoverageSchema, reviewItemSchema, hashReview, validatePersonalReviewSummary, mergeReviewItems, selectReviewItems, markReviewNotified, renderPersonalReview } from './personal-review-ledger.js';

const DAY = 86400000, GRACE = 6 * 3600000, TIMEOUT = 180000, copy = value => structuredClone(value);
const digest = z.string().regex(/^[a-f0-9]{64}$/), localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const callerSchema = z.object({ sessionId: reviewId, cwd: z.string().min(1).max(4096).refine(isAbsolute) }).strict();
const scopeSchema = z.object({ caller: callerSchema, sources: z.array(z.enum(reviewSources)).max(5), projects: z.array(z.string().min(1).max(4096).refine(isAbsolute)).max(5), bindingKey: digest, grant: digest, key: digest }).strict();
const scheduleSchema = z.object({ dailyTime: localTime.optional(), weeklyDay: z.number().int().min(0).max(6).optional(), weeklyTime: localTime.optional(), timeZone: z.string().min(1).max(100) }).strict().refine(s => Boolean(s.dailyTime || s.weeklyTime) && (s.weeklyTime === undefined) === (s.weeklyDay === undefined));
const attentionSchema=z.object({enabled:z.boolean(),intervalMinutes:z.literal(120),startHour:z.literal(9),endHour:z.literal(19),maxMessagesPerDay:z.literal(2),createdAt:reviewInstant}).strict();
const recoverySchema=z.object({key:digest,observedAt:reviewInstant,offlineSince:reviewInstant.nullable(),blocked:z.boolean(),diagnostic:personalReviewRecoveryDiagnosticSchema.optional()}).strict();
const lastViewSchema=z.object({viewToken:reviewId.optional(),caller:callerSchema,scopeKey:digest,bindingKey:digest,grant:digest,at:reviewInstant,itemIds:z.array(reviewId).max(5)}).strict();
const statuses = ['generating', 'dispatching', 'reported_sent', 'queued', 'uncertain', 'failed', 'cancelled', 'expired', 'quiet', 'unknown'];
const jobSchema = z.object({ id: reviewId, sessionId: reviewId, requestId: reviewId, kind: z.enum(['daily', 'weekly', 'attention']), occurrence: reviewId, createdAt: reviewInstant, status: z.enum(statuses), itemIds: z.array(reviewId).max(5), diagnostic: personalReviewDiagnosticSchema.optional() }).strict();
export const personalReviewRowSchema = z.object({ id: z.literal('profile'), version: z.literal(1), scope: scopeSchema.nullable(), goals:z.array(reviewGoalSchema).max(50).default([]), meetingCache:meetingCacheSchema.default(null), recovery:recoverySchema.nullable().default(null), lastView:lastViewSchema.nullable().default(null), attentionClaims:z.array(z.object({id:reviewId,at:reviewInstant,timeZone:z.string(),status:z.enum(['dispatching','reported_sent','queued','uncertain'])}).strict()).max(100).default([]), subscription: scopeSchema.extend({ schedule: scheduleSchema, createdAt: reviewInstant, paused: z.boolean(), attention:attentionSchema.optional() }).strict().nullable(), items: z.array(reviewItemSchema).max(300), jobs: z.array(jobSchema).max(60), occurrences: z.array(reviewId).max(800), watermarks: z.record(z.string(), z.object({ daily: reviewInstant.optional(), weekly: reviewInstant.optional(), attention:reviewInstant.optional() }).strict()), receipts: z.array(z.object({ sessionId: reviewId, requestId: reviewId, action: z.string().max(30), at: reviewInstant }).strict()).max(200) }).strict();
const fresh = () => ({ id: 'profile', version: 1, scope: null, subscription: null, items: [], jobs: [], occurrences: [], watermarks: {}, receipts: [] });
const labels = { generating: '正在整理', dispatching: '正在提交通道', reported_sent: '通道报告已发出，手机送达与已读未知', queued: '通道已排队，手机送达未知', uncertain: '发送结果不确定，不自动重发', failed: '本次回顾失败，不自动重试', cancelled: '本次已取消', expired: '已错过本次检查窗口，不补发', quiet: '没有达到提醒门槛的新事项，本次保持安静', unknown: '来源覆盖未知，未作无变化判断' };
function requireCaller(raw) { try { const caller = callerSchema.parse({ sessionId: raw?.sessionId, cwd: raw?.cwd }); caller.cwd = resolve(caller.cwd); return caller; } catch { throw new Error('需要本人真实本地会话'); } }
function sourceScope(input, fallback) {
  const sources = input.sources ?? fallback?.sources, projects = input.projects ?? fallback?.projects ?? [];
  const parsed = z.object({ sources: z.array(z.enum(reviewSources)).max(5), projects: z.array(z.string().max(4096).refine(isAbsolute)).max(5) }).parse({ sources, projects });
  parsed.sources = [...new Set(parsed.sources)].sort(); parsed.projects = [...new Set(parsed.projects.map(p => resolve(p)))].sort();
  if (!parsed.sources.length && !parsed.projects.length) throw new Error('需要明确至少一个授权来源或项目');
  return parsed;
}
function scheduleInput(raw) { const parsed = scheduleSchema.parse(raw); parsed.timeZone = canonicalizeTimeZone(parsed.timeZone); return parsed; }
function sameCaller(a, b) { return a?.sessionId === b?.sessionId && a?.cwd === b?.cwd; }
function latestOccurrence(now, schedule, kind) {
  const time = kind === 'weekly' ? schedule.weeklyTime : schedule.dailyTime; if (!time) return null;
  const local = localProjection(makeLocalFormatter(schedule.timeZone), now.getTime());
  const base = Date.UTC(local.year, local.month - 1, local.day);
  for (let days = 0; days < 9; days++) {
    const date = new Date(base - days * DAY); if (kind === 'weekly' && date.getUTCDay() !== schedule.weeklyDay) continue;
    let epoch;
    try { epoch = resolveLocalInstant({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), hour: Number(time.slice(0, 2)), minute: Number(time.slice(3)), second: 0, millisecond: 0 }, schedule.timeZone); } catch { continue; } // Nonexistent DST local times are skipped.
    if (epoch <= now.getTime()) return { id: `${kind}:${date.toISOString().slice(0, 10)}`, epoch };
  }
  return null;
}
function interruption(signal) { return personalReviewFailure(null,{code:signal?.reason?.name==='TimeoutError'?'REVIEW_TIMEOUT':'REVIEW_CANCELLED'}); }
function race(fn, signal, message) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(interruption(signal));
    if (signal.aborted) return abort(); signal.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => { signal.throwIfAborted(); return fn(); }).then(value => { signal.removeEventListener('abort', abort); if (signal.aborted) abort(); else resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(signal.aborted?interruption(signal):personalReviewFailure(error,{code:message,stage:message==='REVIEW_COLLECTION_FAILED'?'collection':message==='REVIEW_MODEL_FAILED'?'model':'delivery'})); });
  });
}

export function createPersonalReviewService({ store, readBinding, readBindingSync, authorization, authorizationSync, canRun = async () => true, canRunSync, readAvailability=async()=> 'current', collect, summarize, send, clock = () => new Date() } = {}) {
  for (const [name, dependency] of Object.entries({ get: store?.get, put: store?.put, readBinding, authorization, canRun, collect, summarize, send })) if (typeof dependency !== 'function') throw new Error(`Missing personal review dependency: ${name}`);
  let state, queue = Promise.resolve(), generation = 0, closed = false, storageFailed = false, lastGeneration=null;
  for (const dependency of [authorizationSync, readBindingSync, canRunSync,readAvailability]) if (dependency !== undefined && typeof dependency !== 'function') throw new Error('Invalid personal review synchronous guard');
  const controllers = new Map(), serial = fn => { const result = queue.then(fn); queue = result.catch(() => {}); return result; };
  const now = () => { const value = clock(); if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error('个人回顾时钟无效'); return value; };
  function requestSync(input = {}) { if (input.signal?.aborted || input.authorizeSync && input.authorizeSync() !== true) throw personalReviewFailure(null,{code:'REVIEW_REQUEST_EXPIRED'}); }
  async function requestGuard(input = {}) { try { if (input.guard && await input.guard() === false) throw new Error(); requestSync(input); } catch { throw personalReviewFailure(null,{code:'REVIEW_AUTHORIZATION_CHANGED'}); } }
  async function persist(value, input) { if (storageFailed) throw new Error('个人回顾存储不可用'); const parsed = personalReviewRowSchema.parse(copy(value)); requestSync(input); try { await store.put('profile', parsed); } catch { storageFailed = true; throw new Error('个人回顾存储不可用'); } }
  const save = input => persist(state, input);
  async function commitMutation(input, admission, change) {
    const draft = copy(state); capacity(draft); change(draft); recordReceipt(draft, input);
    if (closed || admission !== generation) throw new Error('个人回顾本次请求已取消');
    // A rejected last-moment gate cannot leave an enabled plan or feedback in memory.
    await persist(draft, input); state = draft;
  }
  async function load() {
    if (storageFailed) throw new Error('个人回顾存储不可用'); if (state) return;
    let raw; try { raw = await store.get('profile'); } catch { storageFailed = true; throw new Error('个人回顾存储不可用'); }
    const parsed = personalReviewRowSchema.safeParse(raw ?? fresh()); if (!parsed.success) throw new Error('个人回顾状态不兼容或损坏'); state = parsed.data;
    let changed = false;
    for (const job of state.jobs) if (job.status === 'dispatching' || job.status === 'generating') { job.status = job.status === 'dispatching' ? 'uncertain' : 'failed'; changed = true; }
    if (changed) await save();
  }
  function invalidate() { generation++; for (const controller of controllers.keys()) controller.abort(); }
  async function grantFor(caller, selected) {
    let grant; try { grant = await authorization(copy(caller), copy(selected.sources), copy(selected.projects)); } catch { throw personalReviewFailure(null,{code:'REVIEW_AUTHORIZATION_UNAVAILABLE'}); }
    if (!digest.safeParse(grant).success) throw personalReviewFailure(null,{code:'REVIEW_AUTHORIZATION_REQUIRED'}); return grant;
  }
  async function connection(caller) { let route; try { route = await readBinding(caller.sessionId); } catch { throw personalReviewFailure(null,{code:'REVIEW_BINDING_CHANGED'}); } if (!route?.bound || !digest.safeParse(route.bindingKey).success) throw personalReviewFailure(null,{code:'REVIEW_BINDING_CHANGED'}); return route.bindingKey; }
  async function buildScope(caller, input, fallback) {
    const selected = sourceScope(input, fallback), grant = await grantFor(caller, selected), bindingKey = await connection(caller);
    return { caller, ...selected, grant, bindingKey, key: hashReview(JSON.stringify({ caller, ...selected, bindingKey })) };
  }
  function execution(scope, signal, input = {}) {
    const controller = new AbortController(); controllers.set(controller, scope);
    return { ...copy(scope), generation, request: input, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(TIMEOUT), ...(signal ? [signal] : [])]), dispose: () => controllers.delete(controller) };
  }
  function validSync(run) { return !closed && !storageFailed && !run.signal.aborted && run.generation === generation; }
  function authorizeSync(run, allowPaused = false) {
    if (!validSync(run)) return false;
    try {
      requestSync(run.request);
      if(run.recoveryAttention&&!recoveryWorkTime({now:now(),timeZone:run.schedule.timeZone,...run.attention}))return false;
      if (!allowPaused && canRunSync && canRunSync() !== true) return false;
      if (authorizationSync && authorizationSync(copy(run.caller), copy(run.sources), copy(run.projects), run.grant) !== true) return false;
      if (readBindingSync) { const binding = readBindingSync(run.caller.sessionId); if (!binding?.bound || binding.bindingKey !== run.bindingKey) return false; }
      return validSync(run);
    } catch { return false; }
  }
  async function guard(run, { allowPaused = false } = {}) {
    if (!validSync(run)) throw interruption(run.signal);
    if(run.recoveryAttention&&!recoveryWorkTime({now:now(),timeZone:run.schedule.timeZone,...run.attention}))throw personalReviewFailure(null,{code:'REVIEW_CANCELLED'});
    let enabled = true; if (!allowPaused) { try { enabled = await canRun(); } catch { enabled = false; } } if (!enabled) throw personalReviewFailure(null,{code:'REVIEW_PAUSED',stage:'authorization'});
    if (!validSync(run)) throw interruption(run.signal);
    if (await grantFor(run.caller, run) !== run.grant) throw personalReviewFailure(null,{code:'REVIEW_AUTHORIZATION_CHANGED'});
    if (!validSync(run)) throw interruption(run.signal);
    if (await connection(run.caller) !== run.bindingKey) throw personalReviewFailure(null,{code:'REVIEW_BINDING_CHANGED'});
    await requestGuard(run.request);
    if (!authorizeSync(run, allowPaused)) throw personalReviewFailure(null,{code:'REVIEW_AUTHORIZATION_CHANGED'}); return true;
  }
  const displayScope = () => state.subscription ?? state.scope;
  function usedAttention(plan=state.subscription) {
    if(!plan)return 0;
    const date=d=>{const p=localProjection(makeLocalFormatter(plan.schedule.timeZone),d);return `${p.year}-${p.month}-${p.day}`;};
    const today=date(now().getTime());return state.attentionClaims.filter(j=>date(Date.parse(j.at))===today).length;
  }
  function attentionView(){const plan=state.subscription;if(!plan)return{enabled:false,nextRun:null,quiet:true,remaining:0};return attentionStatus({now:now(),timeZone:plan.schedule.timeZone,attention:plan.paused?undefined:plan.attention,createdAt:plan.attention?.createdAt??plan.createdAt,occurrences:state.occurrences,...plan.schedule,usedMessages:usedAttention(plan)});}
  function itemInScope(item,scope){const grantScopeKey=scope&&hashReview(JSON.stringify({key:scope.key,grant:scope.grant}));return Boolean(scope&&item.scopeKey===scope.key&&item.grantScopeKey===grantScopeKey&&(!item.sourceTask||item.sourceTask.scopeKey===grantScopeKey));}
  function view(includeScope = true) {
    const scope = displayScope();
    const schedule = state.subscription?.schedule, scheduleText = schedule ? `时间：${[schedule.dailyTime ? `每天 ${schedule.dailyTime}` : '', schedule.weeklyTime ? `每周${'日一二三四五六'[schedule.weeklyDay]} ${schedule.weeklyTime}` : ''].filter(Boolean).join('，')}（${schedule.timeZone}）。` : '';
    const attention=attentionView(),policy=state.subscription?.attention;
    let attentionText='工作时段主动关注：未配置。';
    if(policy?.enabled===false)attentionText='工作时段主动关注：已关闭。';
    else if(policy?.enabled===true&&state.subscription.paused)attentionText='工作时段主动关注：已暂停（随个人回顾暂停）；当前不会执行工作时段检查。';
    else if(attention.enabled){
      const pad=value=>String(value).padStart(2,'0');
      const next=attention.nextRun?localProjection(makeLocalFormatter(schedule.timeZone),Date.parse(attention.nextRun)):null;
      const nextText=attention.remaining===0?'今天额外额度已用尽，今日剩余的额外检查与推送不再执行；每日和每周回顾仍按原计划运行。':next?`下次检查：${next.year}/${pad(next.month)}/${pad(next.day)} ${pad(next.hour)}:${pad(next.minute)}（${schedule.timeZone}）。`:'下次检查时间尚未确认。';
      attentionText=`工作时段主动关注：已开启。${pad(policy.startHour)}:00–${pad(policy.endHour)}:00，每${policy.intervalMinutes/60}小时检查；每日额外最多 ${policy.maxMessagesPerDay} 条，今天还可额外提醒 ${attention.remaining} 条。${nextText}${attention.quiet?'当前不在工作时段。':''}只在有值得提醒的新变化时发送；开启不代表本次已完成检查或手机已收到。`;
    }
    const unconfirmed=includeScope&&scope&&state.items.some(item=>item.scopeKey===scope.key&&!['handled','dismissed'].includes(item.status)&&!itemInScope(item,scope));
    return { status: state.subscription ? state.subscription.paused ? 'paused' : 'enabled' : 'off', schedule: state.subscription ? copy(state.subscription.schedule) : null,
      attention,goals:includeScope&&scope?state.goals.filter(g=>g.scopeKey===scope.key&&g.grant===scope.grant).sort((a,b)=>Number(a.status==='completed')-Number(b.status==='completed')).slice(0,5).map(g=>({title:g.title,objective:g.objective,status:g.status,meetingTitle:g.meetingTitle??null})):[],
      sources: includeScope ? scope?.sources ?? [] : [], projects: includeScope ? scope?.projects ?? [] : [], items: includeScope ? state.items.filter(i => itemInScope(i,scope)).map(i => ({ id: i.id, title: i.title, status: i.status, dueAt: i.dueAt ?? null, snoozeUntil: i.snoozeUntil })) : [],
      jobs: state.jobs.slice(-8).map(j => ({ kind: j.kind, status: j.status, createdAt: j.createdAt, detail: labels[j.status],...(j.diagnostic?{diagnostic:copy(j.diagnostic)}:{}) })),
      lastGeneration: includeScope&&scope&&lastGeneration&&sameCaller(scope.caller,lastGeneration.caller)?copy(lastGeneration.value):null,
      text: `个人回顾：${state.subscription ? state.subscription.paused ? '已暂停' : '已启用' : '未启用定时计划'}。${scheduleText}${attentionText}${state.jobs.length ? `最近一次：${labels[state.jobs.at(-1).status]}。` : ''}${unconfirmed?'部分旧事项缺少当前授权依据，暂未展示，请在原范围重新核对。':''}只读取已确认的来源与项目；电脑与宿主须在线。` };
  }
  function result(job, items = [], text, duplicate = false) { return { status: job.status, duplicate, kind: job.kind, items: copy(items), text: text ?? labels[job.status] }; }
  function capacity(draft) { const cutoff = now().getTime() - 30 * DAY; draft.receipts = draft.receipts.filter(r => Date.parse(r.at) >= cutoff); if (draft.receipts.length >= 200) throw new Error('近期操作过多，请稍后再试'); }
  function recordReceipt(draft, input) { draft.receipts.push({ sessionId: input.receiptSessionId, requestId: input.requestId, action: input.action, at: now().toISOString() }); }
  function setScope(scope, draft = state) { if (draft.scope?.key !== scope.key || draft.scope?.grant !== scope.grant) draft.watermarks = {}; draft.scope = copy(scope); }
  function rememberView(draft,run,generated){draft.lastView={viewToken:hashReview(randomUUID()),caller:copy(run.caller),scopeKey:run.key,bindingKey:run.bindingKey,grant:run.grant,at:generated.at,itemIds:generated.items.map(i=>i.id)};}

  function normalizeCollection(raw, run, trackedTasks = [], taskScopeKey) {
    const parsed = z.object({ evidence: z.array(reviewEvidenceSchema).max(100), coverage: z.array(reviewCoverageSchema).max(50), taskChecks: z.array(reviewTaskCheckSchema).max(MAX_TRACKED_REVIEW_TASKS).default([]) }).parse(raw);
    const allowed = new Set([...run.sources, ...(run.projects.length ? ['project', 'memory'] : [])]);
    if (parsed.evidence.some(e => !allowed.has(e.source)) || parsed.coverage.some(c => !allowed.has(c.source))) throw new Error('个人回顾证据超出授权范围');
    const trackedKeys = new Set(trackedTasks.map(reviewSourceTaskKey));
    if(parsed.taskChecks.some(check=>!allowed.has(check.task.source)||check.task.scopeKey!==taskScopeKey||!trackedKeys.has(reviewSourceTaskKey(check.task)))||new Set(parsed.taskChecks.map(check=>reviewSourceTaskKey(check.task))).size!==parsed.taskChecks.length||parsed.evidence.some(e=>e.sourceTask&&(e.source!==e.sourceTask.source||e.sourceTask.scopeKey!==taskScopeKey)))throw new Error('个人回顾任务定位超出授权范围');
    if (new Set(parsed.evidence.map(e => e.id)).size !== parsed.evidence.length) throw new Error('个人回顾证据 ID 重复');
    for (const source of run.sources) if (!parsed.coverage.some(c => c.source === source)) parsed.coverage.push({ source, status: 'unavailable', count: null });
    if (run.projects.length && !parsed.coverage.some(c => ['project', 'memory'].includes(c.source))) parsed.coverage.push({ source: 'project', status: 'unavailable', count: null });
    if (parsed.evidence.some(e => !parsed.coverage.some(c => c.source === e.source && ['ok', 'partial'].includes(c.status)))) throw new Error('个人回顾证据缺少成功读取记录');
    // Bound serialized input, including adversarial escaping expansion.
    while (JSON.stringify(parsed).length > 160000 && parsed.evidence.length) { const removed = parsed.evidence.pop(); for (const c of parsed.coverage) if (c.source === removed.source) { c.status = 'partial'; c.truncated = true; } }
    return parsed;
  }
  async function generate(run, kind, occurrence) {
    // Attention uses daily material while retaining its own scheduling and notification policy.
    const materialKind = kind === 'attention' ? 'daily' : kind;
    const started=Date.now();let stage='authorization',counts={sourceCount:run.sources.length,projectCount:run.projects.length};
    const generationStatus=(status,diagnostic)=>{lastGeneration={caller:copy(run.caller),value:{status,kind,at:now().toISOString(),...(diagnostic?{diagnostic}:{}),persisted:false}};};
    generationStatus('running');
    try {
    await guard(run); const at = now().toISOString(), window = kind === 'weekly' ? 7 * DAY : DAY, timeZone = run.schedule?.timeZone ?? (state.subscription?.key === run.key ? state.subscription.schedule.timeZone : 'UTC');
    const sourceWatermarks = Object.fromEntries(Object.entries(state.scope?.key === run.key && state.scope?.grant === run.grant ? state.watermarks : {}).flatMap(([source, value]) => value[kind] ? [[source, value[kind]]] : []));
    const taskScopeKey = hashReview(JSON.stringify({ key: run.key, grant: run.grant }));
    const currentTaskScope = i => i.grantScopeKey === taskScopeKey && (!i.sourceTask || i.sourceTask.scopeKey === taskScopeKey);
    const { tasks: trackedTasks, hasMore: trackedTasksIncomplete } = trackedReviewSourceTasks(state.items.filter(currentTaskScope), { scopeKey: run.key, taskScopeKey, sources: run.sources });
    const starts = Object.values(sourceWatermarks).map(value => Date.parse(value) - 2 * 3600000);
    const normalFrom = new Date(Math.max(now().getTime() - 30 * DAY, starts.length ? Math.min(...starts, now().getTime() - window) : now().getTime() - window)).toISOString();
    const recovery=recoveryWindow({from:normalFrom,to:at,check:run.recovery});const from=recovery.from;
    stage='collection';
    const raw = await race(() => collect({ caller: copy(run.caller), sources: copy(run.sources), projects: copy(run.projects), from, to: at, sourceWatermarks, kind: materialKind, taskScopeKey, trackedTasks, trackedTasksIncomplete, signal: run.signal, guard: () => guard(run) }), run.signal, 'REVIEW_COLLECTION_FAILED');
    await guard(run); stage='validation'; const data = normalizeCollection(raw, run, trackedTasks, taskScopeKey); counts={...counts,evidenceCount:data.evidence.length,coverageCount:data.coverage.length};
    if(recovery.coverageUnknown)for(const coverage of data.coverage)if(coverage.status==='ok'){coverage.status='partial';coverage.truncated=true;}
    const recoveryNote=recovery.coverageUnknown?'未覆盖时段超过 7 天；本次仅检查最近 7 天与当前状态，更早变化仍未知。\n\n':'';
    const reconciled = reconcileReviewSourceTasks(state.items, data.taskChecks, { scopeKey: run.key, taskScopeKey });
    if (!data.coverage.some(c => ['ok', 'partial'].includes(c.status))) { generationStatus('unknown'); return { ...data, items: [], selected: [], ledger: reconciled, text: recoveryNote+renderPersonalReview([], data.coverage, { kind, now: at, unknown: true, timeZone }), unknown: true, at }; }
    const previousItems = reconciled.filter(i => i.scopeKey === run.key && currentTaskScope(i)).slice(-60).map(i => ({ id: i.id, key: i.key, kind: i.kind, title: i.title, summary: i.summary, status: i.status, dueAt: i.dueAt ?? null, evidenceIds: i.evidence.map(e => e.id), lastSeenAt: i.lastSeenAt }));
    let candidates = [];
    if (data.evidence.length) { stage='model'; const summary = await race(() => summarize({ ...copy(data), previousItems, goals:activeReviewGoals(state.goals,run).map(g=>({objective:g.objective,project:g.project,meetingTitle:g.meetingTitle??null})), kind: materialKind, now: at, signal: run.signal, guard: () => guard(run), authorizeSync: () => authorizeSync(run) }), run.signal, 'REVIEW_MODEL_FAILED'); await guard(run); candidates = validatePersonalReviewSummary(summary, data.evidence).items; }
    const meetingCandidates=kind==='attention'&&calendarCoverageComplete(data.coverage)?prepareReviewMeeting(state.goals,run,data.evidence,candidates,at):[];
    const ledger = mergeReviewItems(reconciled, [...candidates,...meetingCandidates], data.evidence, { now: at, scopeKey: run.key, grantScopeKey: taskScopeKey });
    const attentionSelection=kind==='attention'?selectAttentionItems(ledger.filter(i=>currentTaskScope(i)&&i.lastSeenAt===at),{now:at,scopeKey:run.key,coverage:data.coverage,remaining:Math.max(0,(run.attention?.maxMessagesPerDay??2)-usedAttention(run))}):null;
    let selected = occurrence.startsWith('meeting:')?[]:attentionSelection?.selected ?? selectReviewItems(ledger.filter(currentTaskScope), { now: at, kind, occurrence, scopeKey: run.key });
    if(kind==='attention'&&usedAttention(run)<(run.attention?.maxMessagesPerDay??2)){const preparation=selectMeetingPreparation(ledger.filter(currentTaskScope),meetingCandidates.map(c=>c.key),{scopeKey:run.key,now:at});selected=[...selected,...preparation].filter((v,i,a)=>a.findIndex(x=>x.item.id===v.item.id)===i).slice(0,3);}
    const items = selected.map(s => copy(s.item)); const text = recoveryNote+(kind==='attention'?'有一件新变化值得留意。\n\n':'')+renderPersonalReview(items, data.coverage, { kind:kind==='attention'?'daily':kind, now: at, timeZone });
    selected = selected.filter(s => items.some(i => i.id === s.item.id));
    generationStatus('completed'); return { ...data, items, selected, ledger, text, unknown: attentionSelection?.status==='unknown', at };
    } catch(error) { const failure=personalReviewFailure(error,{...counts,stage,elapsedMs:Date.now()-started,code:stage==='collection'?'REVIEW_COLLECTION_FAILED':stage==='validation'?'REVIEW_VALIDATION_FAILED':stage==='model'?'REVIEW_MODEL_FAILED':'REVIEW_FAILED'});generationStatus('failed',failure.reviewDiagnostic);throw failure; }
  }
  async function runJob(scope, { requestId, kind = 'daily', occurrence, signal, expired = false, input = {}, admission = generation, coClaim=[], recovery=null }) {
    if (admission !== generation || closed) throw personalReviewFailure(null,{code:'REVIEW_CANCELLED'});
    const existing = state.jobs.find(j => j.sessionId === scope.caller.sessionId && j.requestId === requestId);
    if (existing) return result(existing, [], undefined, true);
    if (state.occurrences.includes(occurrence)) return { status: 'quiet', kind, duplicate: true, items: [], text: '此回顾请求已处理，不重复读取或发送。' };
    const job = { id: `review_job_${randomUUID()}`, sessionId: scope.caller.sessionId, requestId, kind, occurrence, createdAt: now().toISOString(), status: expired ? 'expired' : 'generating', itemIds: [] };
    const draft = copy(state); if (input.action === 'run_now') setScope(scope, draft);
    draft.jobs.push(job); draft.jobs = draft.jobs.slice(-60); if (!draft.occurrences.includes(occurrence)) draft.occurrences.push(occurrence); for(const id of coClaim)if(!draft.occurrences.includes(id))draft.occurrences.push(id); draft.occurrences = draft.occurrences.slice(-800);
    const run = execution(scope, signal, input);run.recovery=recovery;run.recoveryAttention=Boolean(recovery&&kind==='attention');
    let journaled = false;
    try {
      if (!expired) await guard(run); await persist(draft, input); state = draft; journaled = true; if (expired) return result(job);
      const generated = await generate(run, kind, occurrence); await guard(run);
      // A slow read/model or delayed transport must not carry proactive work
      // into quiet hours, or deliver a meeting briefing after the meeting starts.
      const deliveryEligible=()=>kind!=='attention'||meetingWorkHours(now(),scope.schedule.timeZone)&&generated.items.every(item=>!item.key.startsWith('meeting-prep:')||typeof item.eventStartAt==='string'&&Date.parse(item.eventStartAt)>now().getTime());
      if(!deliveryEligible()){job.status='expired';await save();return result(job);}
      state.items = generated.ledger;state.meetingCache=captureReviewMeetings(generated.evidence,generated.coverage,run,generated.at);
      // A failed or truncated scan never claims a complete incremental watermark.
      for (const coverage of generated.coverage) if (state.scope?.key === run.key && coverage.status === 'ok' && !coverage.truncated && !generated.coverage.some(c => c.source === coverage.source && (c.status !== 'ok' || c.truncated))) state.watermarks[coverage.source] = { ...state.watermarks[coverage.source], [kind]: generated.at };
      if (!generated.items.length) { job.status = generated.unknown ? 'unknown' : 'quiet'; await save(); return result(job, [], generated.text); }
      job.itemIds = generated.items.map(i => i.id); job.status = 'dispatching';
      for(const item of generated.items)if(item.key.startsWith('meeting-prep:')){const claim=`meeting:${item.key.slice('meeting-prep:'.length)}`;if(!state.occurrences.includes(claim))state.occurrences.push(claim);}
      state.occurrences=state.occurrences.slice(-800);
      if(kind==='attention'){
        state.attentionClaims=state.attentionClaims.filter(row=>now().getTime()-Date.parse(row.at)<7*DAY);
        if(state.attentionClaims.length>=100)throw new Error('主动关注预算账本已满');
        state.attentionClaims.push({id:job.id,at:now().toISOString(),timeZone:scope.schedule.timeZone,status:'dispatching'});
      }
      // Persist both claim and fact notification before entering a side-effecting adapter.
      const notificationBefore=new Map(state.items.filter(item=>job.itemIds.includes(item.id)).map(item=>[item.id,{notifiedRevision:item.notifiedRevision,lastNotifiedAt:item.lastNotifiedAt,notifications:copy(item.notifications),status:item.status,snoozeUntil:item.snoozeUntil}]));
      markReviewNotified(state.items, generated.selected, generated.at); await save(); await guard(run);
      let delivery;
      try { delivery = await race(() => send({ sessionId: scope.caller.sessionId, bindingKey: scope.bindingKey, text: generated.text, requestId: `personal-${job.id}`, signal: run.signal, authorize: () => deliveryEligible()&&authorizeSync(run), authorizeSync: () => deliveryEligible()&&authorizeSync(run), authorizeAsync: async () => { try { return deliveryEligible()&&await guard(run)&&deliveryEligible(); } catch { return false; } } }), run.signal, 'REVIEW_DELIVERY_FAILED'); } catch (error) { job.status = 'uncertain'; job.diagnostic=personalReviewFailure(error,{code:'REVIEW_DELIVERY_FAILED',stage:'delivery'}).reviewDiagnostic; await save(); return result(job, generated.items); }
      job.status = ['reported_sent', 'queued'].includes(delivery?.status) ? delivery.status : delivery?.status === 'failed' || delivery?.status === 'blocked' ? 'failed' : 'uncertain';
      // A definite no-delivery releases only the notification fact; the current
      // occurrence remains claimed. Uncertain/crashed dispatch remains claimed.
      if(job.status==='failed'){state.attentionClaims=state.attentionClaims.filter(row=>row.id!==job.id);job.diagnostic=personalReviewFailure(null,{code:'REVIEW_DELIVERY_FAILED',stage:'delivery'}).reviewDiagnostic;for(const item of state.items){const before=notificationBefore.get(item.id);if(before)Object.assign(item,before);}}
      const claim=state.attentionClaims.find(row=>row.id===job.id);if(claim)claim.status=job.status;
      if(['reported_sent'].includes(job.status))rememberView(state,run,generated);
      await save(); return result(job, generated.items, `${generated.text}\n\n${labels[job.status]}`);
    } catch (error) {
      if (!journaled) throw error;
      job.diagnostic=personalReviewFailure(error).reviewDiagnostic;
      if (job.status === 'generating') job.status = run.generation !== generation || run.signal.aborted && run.signal.reason?.name!=='TimeoutError' ? 'cancelled' : 'failed';
      else if (job.status === 'dispatching') job.status = 'uncertain';
      if (!storageFailed) await save(); throw error;
    } finally { run.dispose(); }
  }
  async function act(rawCaller, input = {}) {
    const caller = requireCaller(rawCaller), action = input.action;
    input = { ...input, receiptSessionId: caller.sessionId };
    if (!['configure', 'preview', 'run_now', 'status', 'pause', 'resume', 'cancel', 'feedback', 'attention','goal'].includes(action)) throw new Error('未知个人回顾操作');
    if (input.signal !== undefined && !(input.signal instanceof AbortSignal)) throw new Error('无效取消信号');
    if (input.guard !== undefined && typeof input.guard !== 'function' || input.authorizeSync !== undefined && typeof input.authorizeSync !== 'function') throw new Error('无效本次请求授权检查');
    if (!['preview', 'status'].includes(action) && (input.userRequested !== true || !reviewId.safeParse(input.requestId).success)) throw new Error('需要用户明确要求及本次请求 ID');
    if (input.kind !== undefined && !['daily', 'weekly'].includes(input.kind)) throw new Error('无效回顾频率');
    // Only the original owner can invalidate in-flight work before waiting for serialization.
    const activeScope = state?.scope ?? controllers.values().next().value;
    if (activeScope && !sameCaller(caller, activeScope.caller)) throw new Error('需要原本人会话，不能延续他人授权');
    await requestGuard(input);
    if (activeScope && ['cancel', 'pause', 'configure', 'feedback','attention','goal'].includes(action) && !state?.receipts.some(r => r.sessionId === caller.sessionId && r.requestId === input.requestId)) invalidate();
    const admission = generation;
    return serial(async () => {
      await load(); if (closed) throw new Error('个人回顾服务已关闭');
      if (state.scope && !sameCaller(caller, state.scope.caller)) throw new Error('需要原本人会话');
      if (state.receipts.some(r => r.sessionId === caller.sessionId && r.requestId === input.requestId)) {
        if (!['cancel', 'pause'].includes(action) && displayScope()) { const run = execution(displayScope(), input.signal, input); try { await guard(run); } finally { run.dispose(); } }
        return { ...view(!['cancel', 'pause'].includes(action)), duplicate: true };
      }
      if (action === 'status') { if (displayScope()) { const run = execution(displayScope(), input.signal, input); try { await guard(run, { allowPaused: true }); } finally { run.dispose(); } } return view(); }
      if (action === 'configure') {
        const schedule = scheduleInput(input.schedule), scope = await buildScope(caller, input, displayScope()); if (!await canRun()) throw new Error('助理已暂停');
        const run = execution(scope, input.signal, input); try { await guard(run); } finally { run.dispose(); }
        await commitMutation(input, admission, draft => { setScope(scope, draft); draft.subscription = { ...copy(scope), schedule, createdAt: now().toISOString(), paused: false }; }); return view();
      }
      if (action === 'cancel' || action === 'pause') { await requestGuard(input); await commitMutation(input, admission, draft => { if (action === 'cancel') draft.subscription = null; else if (draft.subscription) draft.subscription.paused = true; }); return view(false); }
      if (action === 'resume') {
        if (!state.subscription) throw new Error('尚无个人回顾计划'); const run = execution(state.subscription, input.signal, input); try { await guard(run); await commitMutation(input, admission, draft => { draft.subscription.paused = false; draft.subscription.createdAt = now().toISOString(); }); return view(); } finally { run.dispose(); }
      }
      if(action==='attention'){
        if(typeof input.enabled!=='boolean'||input.sources!==undefined||input.projects!==undefined||input.schedule!==undefined)throw new Error('主动关注沿用原订阅范围，不能在此扩大资料范围');
        if(!state.subscription)throw new Error('请先确认个人回顾的资料范围和日程');
        const run=execution(state.subscription,input.signal,input);try{await guard(run,{allowPaused:!input.enabled});
          await commitMutation(input,admission,draft=>{draft.subscription.attention={enabled:input.enabled,intervalMinutes:120,startHour:9,endHour:19,maxMessagesPerDay:2,createdAt:now().toISOString()};});return view();
        }finally{run.dispose();}
      }
      if(action==='goal'){
        if(!state.subscription)throw Error('请先确认个人回顾的资料范围和日程');
        const run=execution(state.subscription,input.signal,input);try{
          await guard(run,{allowPaused:true});await commitMutation(input,admission,draft=>{draft.goals=changeReviewGoal(draft.goals,input,draft.subscription,now().toISOString());});
          let discovery='';
          if(input.goalAction==='track'&&input.meetingTitle){
            if(state.subscription.paused)discovery='个人回顾已暂停，本次未读取日历，会议时间尚未确认。';
            else try{
              await guard(run);const at=now().toISOString(),from=new Date(Date.parse(at)-DAY).toISOString();
              // One exact source already in the saved scope; no project read,
              // extra source grant, new recurring plan, model call or send.
              const raw=await race(()=>collect({caller:copy(run.caller),sources:['calendar'],projects:[],from,to:at,sourceWatermarks:{},kind:'daily',signal:run.signal,guard:()=>guard(run)}),run.signal,'REVIEW_COLLECTION_FAILED');
              await guard(run);const data=z.object({evidence:z.array(reviewEvidenceSchema).max(100),coverage:z.array(reviewCoverageSchema).max(50)}).parse(raw);
              if(data.evidence.some(e=>e.source!=='calendar')||data.coverage.length!==1||data.coverage[0].source!=='calendar'||new Set(data.evidence.map(e=>e.id)).size!==data.evidence.length)throw Error('invalid calendar discovery');
              const complete=data.coverage[0].status==='ok'&&!data.coverage[0].truncated;
              const cache=complete?captureReviewMeetings(data.evidence,data.coverage,run,at):null;
              const matches=cache?.events.filter(e=>e.title===input.meetingTitle&&Date.parse(e.eventStartAt)>Date.parse(at))??[];
              const draft=copy(state);draft.meetingCache=cache;await guard(run);await persist(draft,input);state=draft;
              discovery=matches.length===1?'已确认一场同名未来会议，会前 30 分钟重新核对，遵守工作时段和每日额外两条上限。':'会议时间未确认：近期日历未唯一匹配，或本次覆盖不完整；请核对会议后再说明。';
            }catch{discovery='目标已保存，但日历读取未完成或授权已变化，会议时间未确认；本次没有发送。';return{status:'needs_recheck',text:discovery};}
          }
          return {...view(),text:input.goalAction==='track'?`已跟进目标「${input.goalTitle}」，沿用原个人回顾范围。${input.meetingTitle?discovery:'每日／每周回顾会结合这个目标整理进展。'}本次没有发送。`:'目标状态已更新，已暂停或完成的目标不再安排会前准备。'};
        }finally{run.dispose();}
      }
      if (action === 'feedback') {
        let itemId=input.itemId;
        if(input.itemTitle!==undefined){
          if(itemId!==undefined||input.itemNumber!==undefined||typeof input.itemTitle!=='string'||!input.itemTitle.trim()||input.itemTitle.length>100)throw new Error('请提供唯一的事项名称');
          const active=displayScope(),matches=state.items.filter(item=>itemInScope(item,active)&&item.title===input.itemTitle);
          if(matches.length!==1)throw new Error('这个事项名称无法唯一确认，请查看回顾后再说明');itemId=matches[0].id;
        }
        if(input.itemNumber!==undefined){
          const index=z.number().int().min(1).max(5).parse(input.itemNumber)-1,shown=state.lastView;
          if(itemId!==undefined||!shown||typeof input.confirmedViewToken!=='string'||input.confirmedViewToken!==shown.viewToken||!sameCaller(shown.caller,caller)||now().getTime()-Date.parse(shown.at)>DAY||now().getTime()<Date.parse(shown.at)||!shown.itemIds[index])throw new Error('最近一份回顾编号不可用，请用事项名称确认或重新查看回顾');
          const selected=[state.scope,state.subscription].find(v=>v?.key===shown.scopeKey&&v.bindingKey===shown.bindingKey&&v.grant===shown.grant);
          if(!selected)throw new Error('回顾编号对应的授权范围已变化');itemId=shown.itemIds[index];
        }
        const feedback = z.enum(['handled', 'snoozed', 'dismissed']).parse(input.feedback), scopes = [state.scope, state.subscription].filter(Boolean), item = state.items.find(i => i.id === itemId && scopes.some(scope => itemInScope(i,scope))); if (!item) throw new Error('未找到同一授权范围内的事项');
        const run = execution(scopes.find(scope => itemInScope(item,scope)), input.signal, input); try { await guard(run); } finally { run.dispose(); }
        let snoozeUntil = null; if (feedback === 'snoozed') { snoozeUntil = reviewInstant.parse(input.snoozeUntil); if (Date.parse(snoozeUntil) <= now().getTime()) throw new Error('稍后提醒时间须在未来'); }
        await requestGuard(input); await commitMutation(input, admission, draft => { const target = draft.items.find(i => i.id === item.id); target.status = feedback; target.snoozeUntil = snoozeUntil; }); return { ...view(false), text: feedback === 'handled' ? '已标记处理，后续不再催促。' : feedback === 'dismissed' ? '此事项不再提醒。' : '已延后此事项。' };
      }
      const scope = await buildScope(caller, input, displayScope()), kind = input.kind ?? 'daily';
      if (admission !== generation) throw new Error('个人回顾本次请求已取消');
      if (action === 'preview') { const run = execution(scope, input.signal, input); try { const generated = await generate(run, kind, `preview:${now().toISOString()}`); await guard(run); const draft=copy(state); setScope(scope,draft); draft.items=generated.ledger; draft.meetingCache=captureReviewMeetings(generated.evidence,generated.coverage,run,generated.at); rememberView(draft,run,generated); await persist(draft,input); state=draft; return { status: generated.unknown ? 'unknown' : 'preview', viewToken:state.lastView.viewToken, items: generated.items, coverage: generated.coverage, text: generated.text }; } finally { run.dispose(); } }
      const existing = state.jobs.find(j => j.sessionId === caller.sessionId && j.requestId === input.requestId); if (existing) return result(existing, [], undefined, true);
      return runJob(scope, { requestId: input.requestId, kind, occurrence: `manual:${hashReview(`${caller.sessionId}:${input.requestId}`)}`, signal: input.signal, input, admission });
    });
  }
  async function recoveryAdmission(plan,admission){
    const at=now(),key=hashReview(JSON.stringify([plan.key,plan.grant,plan.createdAt,plan.attention?.createdAt]));
    const enabled=plan.attention?.enabled===true&&!plan.paused;
    let availability='current',diagnostic;
    if(enabled){
      let route;
      try{
        const raw=await readAvailability(copy(plan));
        const parsed=personalReviewAvailabilitySchema.safeParse(typeof raw==='string'?{state:raw,reason:raw==='current'?'CURRENT':raw==='offline'?'ROUTE_OFFLINE':raw==='changed'?'ROUTE_CHANGED':'ROUTE_UNKNOWN'}:raw);
        route=parsed.success?parsed.data:{state:'unknown',reason:'ROUTE_INVALID'};
      }catch{route={state:'unknown',reason:'ROUTE_FAILED'};}
      availability=route.state;if(availability!=='current')diagnostic=route;
      if(availability==='current'){
        const run=execution(plan);try{await guard(run);}catch(error){
          availability='changed';let guardCode='REVIEW_FAILED';
          // Even error metadata getters may throw. Diagnostics must preserve
          // the original blocked admission without exposing the thrown value.
          try{const code=personalReviewGuardCodeSchema.safeParse(personalReviewFailure(error).code);if(code.success)guardCode=code.data;}catch{}
          diagnostic={state:'changed',reason:'GUARD_REJECTED',guardCode};
        }finally{run.dispose();}
      }
    }
    if(closed||admission!==generation)return{blocked:true,check:null};
    const regularKind=['weekly','daily'].find(kind=>{const due=latestOccurrence(at,plan.schedule,kind);return due&&due.epoch>=Date.parse(plan.createdAt)&&at.getTime()-due.epoch<=15*60000&&!state.occurrences.includes(due.id);})??(attentionDue({now:at,timeZone:plan.schedule.timeZone,attention:plan.attention,createdAt:plan.attention?.createdAt??plan.createdAt,occurrences:state.occurrences,...plan.schedule}).status==='due'?'attention':null);
    const decision=recoveryCheck({now:at,key,previous:state.recovery,availability,enabled,timeZone:plan.schedule.timeZone,startHour:plan.attention?.startHour,endHour:plan.attention?.endHour,occurrences:state.occurrences,remaining:Math.max(0,(plan.attention?.maxMessagesPerDay??0)-usedAttention(plan)),regularDue:Boolean(regularKind)});
    const before=state.recovery,next=decision.observation;
    if(next&&diagnostic)next.diagnostic=diagnostic;
    const persistObservation=Boolean(!before!==!next||before&&next&&(before.key!==next.key||before.blocked!==next.blocked||before.offlineSince!==next.offlineSince||JSON.stringify(before.diagnostic)!==JSON.stringify(next.diagnostic)||Math.floor(at.getTime()/RECOVERY_CHECKPOINT_INTERVAL)!==Math.floor(Date.parse(before.observedAt)/RECOVERY_CHECKPOINT_INTERVAL))||decision.check);
    // Keep the live timestamp accurate; persist at most once per five minutes
    // except state transitions. A short restart cannot become a false sleep gap.
    state.recovery=next;
    if(persistObservation)await save();
    return{...decision,regularKind,blocked:enabled&&availability!=='current'};
  }
  return { act, snapshot: caller => act(caller, { action: 'status' }), ready: () => serial(load), needsTimer: () => !closed && !storageFailed && Boolean(state?.subscription && !state.subscription.paused), suspend: invalidate,
    tick: () => { const admission = generation; return serial(async () => {
      await load(); if (closed || admission !== generation || !state.subscription || state.subscription.paused) return [];
      const output=[],plan=state.subscription;
      const recovery=await recoveryAdmission(plan,admission);
      if(recovery.blocked)return output;
      if(recovery.check||recovery.regularRecovery){
        const coClaim=['weekly','daily'].map(kind=>latestOccurrence(now(),plan.schedule,kind)).filter(due=>due&&due.epoch>=Date.parse(plan.createdAt)).map(due=>due.id);
        const missed=attentionDue({now:now(),timeZone:plan.schedule.timeZone,attention:plan.attention,createdAt:plan.attention.createdAt,occurrences:state.occurrences,...plan.schedule}).occurrence;
        if(missed)coClaim.push(missed.id);
        const kind=recovery.check?'attention':recovery.regularKind,due=recovery.check??(kind==='attention'?missed:latestOccurrence(now(),plan.schedule,kind));
        try{output.push(await runJob(plan,{requestId:due.id,kind,occurrence:due.id,recovery:recovery.check??recovery.regularRecovery,admission,coClaim}));}catch{/* Authorization and safe failure diagnostics remain fail-closed. */}
        return output;
      }
      // The weekly review includes daily attention: claim coincident daily work
      // together before any read/send, including uncertain delivery recovery.
      for(const kind of ['weekly','daily','attention']){
        const plan=state.subscription;if(!plan||plan.paused||closed||admission!==generation)break;
        const policy=kind==='attention'?attentionDue({now:now(),timeZone:plan.schedule.timeZone,attention:plan.attention,createdAt:plan.attention?.createdAt??plan.createdAt,occurrences:state.occurrences,...plan.schedule}):null;
        const due=policy?policy.occurrence:latestOccurrence(now(),plan.schedule,kind);
        if(!due||due.epoch<Date.parse(plan.createdAt)||state.occurrences.includes(due.id))continue;
        if(kind==='attention'&&usedAttention(plan)>=(plan.attention?.maxMessagesPerDay??0))continue;
        const daily=kind==='weekly'?latestOccurrence(now(),plan.schedule,'daily'):null;
        const coClaim=daily?.epoch===due.epoch?[daily.id]:[];
        try{output.push(await runJob(plan,{requestId:due.id,kind,occurrence:due.id,expired:policy?policy.status==='expired':now().getTime()-due.epoch>GRACE,admission,coClaim}));}catch{/* Fixed diagnostics stay in the journal; never leak provider errors. */}
      }
      const meetingPlan=state.subscription;
      if(meetingPlan&&!meetingPlan.paused&&!closed&&admission===generation&&usedAttention(meetingPlan)<2&&meetingWorkHours(now(),meetingPlan.schedule.timeZone)){
        const due=dueReviewMeeting(state.goals,state.meetingCache,meetingPlan,now().toISOString(),state.occurrences);
        if(due){try{output.push(await runJob(meetingPlan,{requestId:due.id,kind:'attention',occurrence:due.id,admission}));}catch{/* Persisted diagnostic is the recovery boundary. */}}
      }
      return output;
    }); },
    close: () => { closed = true; invalidate(); return queue; } };
}
