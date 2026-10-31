import { randomUUID } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import { z } from 'zod';

const SIX_HOURS = 6 * 60 * 60 * 1000;
const MAX_REPLY = 8000;
const MOBILE_LIMIT = 3200;
const LIVE = new Set(['prepared', 'admitted', 'running']);
const RETRYABLE = new Set(['pending', 'blocked']);
const identity = z.string().min(1).max(200);
const timestamp = z.string().datetime();
const bindingSchema = z.object({userHash:z.string().regex(/^[a-f0-9]{64}$/),botHash:z.string().regex(/^[a-f0-9]{64}$/).optional()}).strict();
const executionStatus = z.enum(['prepared','admitted','running','not_admitted','unknown','discarded','mixed','completed','blocked','aborted','error','max-tokens','interrupted','forked','no_text','expired']);
const deliveryStatus = z.enum(['pending','dispatching','blocked','queued','reported_sent','failed','uncertain','expired']);
const knownReasons = new Set(['completed','blocked','aborted','error','max-tokens','interrupted','forked']);
const deliverySchema = z.object({text:z.string().max(MOBILE_LIMIT),status:deliveryStatus,createdAt:timestamp,expiresAt:timestamp,detail:z.string().max(160)}).strict();
const familyOriginSchema=z.object({sessionId:identity,bindingRevision:z.string().regex(/^[a-f0-9]{64}$/),sourceRequestId:z.string().min(1).max(512),workspaceId:z.string().min(1).max(240),root:z.string().min(1).max(4096),projectName:z.string().min(2).max(240),taskHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const jobSchema = z.object({
  id:identity, originSessionId:identity, originToolCallId:identity, targetSessionId:identity, targetMessageId:identity,
  projectRoot:z.string().max(4096), projectLabel:z.string().max(80), task:z.string().min(1).max(8000),
  familyOrigin:familyOriginSchema.optional(),returnBinding:bindingSchema.nullable(),createdAt:timestamp,expiresAt:timestamp,status:executionStatus,
  turn:z.number().int().nonnegative().nullable(),reply:z.string().max(MAX_REPLY),replyTruncated:z.boolean(),
  reason:z.enum([...knownReasons,'unknown']).nullable(),finishedAt:timestamp.nullable(),delivery:deliverySchema.nullable(),
}).strict();

export const taskResultsRowSchema = z.object({id:z.literal('profile'),version:z.literal(1),jobs:z.array(jobSchema).max(50)}).strict();
const freshState = () => ({id:'profile',version:1,jobs:[]});
const copy = value => structuredClone(value);
const clean = value => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').trim();
function bounded(value, limit) {
  const text = clean(value);
  let result = '';
  for (const char of text) { if (result.length + char.length > limit) break; result += char; }
  return result;
}
const line = (value, limit) => bounded(String(value ?? '').replace(/\s+/g,' '),limit);
const stripSimpleSpans = value => value.replace(/\*\*([^*\n]+)\*\*|__([^_\n]+)__/g,(_match,bold,strong)=>bold??strong)
  .replace(/(?<![\p{L}\p{N}_])([*_])([^*_\n]+)\1(?![\p{L}\p{N}_])/gu,'$2');
const plainLabel = value => stripSimpleSpans(value).replace(/`([^`\n]+)`/g,'$1').trim();
function publicLink(value) {
  try {
    if (/[\s<>\\]/.test(value)) return null;
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (!['http:','https:'].includes(url.protocol) || url.username || url.password ||
      !host.includes('.') || /(?:^|\.)(?:localhost|local|internal)$/.test(host) ||
      /^(?:0|10|127)\.|^169\.254\.|^192\.168\.|^172\.(?:1[6-9]|2\d|3[01])\./.test(host)) return null;
    return url.href.replace(/[()[\]]/g,char=>`%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  } catch { return null; }
}
function displaySource(value) {
  // Only a small inline-link subset is needed for project citations. Targets
  // are never fetched, and local or unsafe targets never enter the result.
  return value.toWellFormed().replace(/\\([\\`*_\[\]()<>#|~])/g,'$1')
    .replace(/`[^`\n]+`|<\/?[a-z][a-z\d-]*(?:\s[^>]*|\/?)>/gi,part=>part.startsWith('`')?part:'')
    .replace(/(!?)\[([^\]\n]*)\]\(([^)\n]*)\)/g,(_match,image,label,target)=>{
      const text=plainLabel(label);
      if (image) return text;
      const href=publicLink(target);
      if (href) return `[${text}](${href})`;
      const local=!/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target) || /^file:/i.test(target);
      const range=local && target.match(/#L(\d+)(?:-L?(\d+))?$/);
      return `${text}${range?`（第${range[1]}${range[2]?`–${range[2]}`:''}行）`:''}`;
    });
}
function simpleMarkdown(value) {
  // Complete simple spans and list prefixes can be kept. Anything outside
  // this bounded subset takes the plain-text path instead of guessing syntax.
  const rest=value.replace(/\[[^\]\n]*\]\(https?:\/\/[^)\s]+\)/g,'')
    .replace(/^\s*(?:[-+*]|\d+[.)])\s+/gm,'').replace(/^\s*#{1,6}\s+/gm,'')
    .replace(/`[^`\n]+`/g,'').replace(/\*\*[^*\n]+\*\*|__[^_\n]+__/g,'')
    .replace(/\*[^*\n]+\*|_[^_\n]+_/g,'');
  return !/[\\`*_\[\]<>~]/.test(rest);
}
function plainSource(value) {
  return stripSimpleSpans(value.replace(/\[([^\]\n]*)\]\([^\n)]*\)/g,'$1'))
    .replace(/^\s*(?:`{3,}|~{3,}).*$/gm,'').replace(/^\s{0,3}[>#]+\s?/gm,'')
    .replace(/(^|\s)(?:\*\*|__)(?=\S)|(?:\*\*|__)(?=\s|$)/g,'$1')
    .replace(/`[^`\n]+`|`+/g,part=>/^`[^`\n]+`$/.test(part)?part:'').trim();
}
function proseParagraphs(value) {
  if (value.length<120 || /[\n`*_\[\]<>]/.test(value)) return value;
  let size=0;
  return value.replace(/[^。！？]+[。！？]|[^。！？]+$/g,sentence=>{
    const start=size>=100?'\n\n':'';
    size=start?sentence.length:size+sentence.length;
    return start+sentence;
  });
}
const statusNames = {
  prepared:'已记录，等待提交',admitted:'已提交，等待项目认领',running:'项目正在处理',not_admitted:'未提交到项目',
  unknown:'执行状态未知，不会自动重新交办',discarded:'项目输入已取消',mixed:'同轮混入其他用户输入，已停止自动回传',
  completed:'收到本次执行回复，待验收',blocked:'本轮受阻，尚未形成可验收回复',aborted:'本轮已中止，尚未验收',
  error:'本轮执行出错，尚未验收','max-tokens':'本轮达到输出上限，尚未形成完整回复',interrupted:'本轮被中断，尚未验收',
  forked:'本轮因分支结束，后续结果未知',no_text:'本轮已结束，但没有可回传的文本回复',expired:'跟踪窗口已结束，执行结果未知',
};
const deliveryNames = {pending:'等待回传',dispatching:'回传结果尚未确定',blocked:'原微信通道暂不可用，等待窗口内复核',queued:'通道已排队，手机送达未知',reported_sent:'通道报告已发送，手机送达及已读未知',failed:'通道回传失败，不自动重发',uncertain:'回传结果不确定，不自动重发',expired:'回传窗口已结束，不再重放'};
const active = job => LIVE.has(job.status) || (job.delivery && ['pending','blocked','dispatching'].includes(job.delivery.status));
function localTime(value, hostTimeZone) {
  const zone = typeof hostTimeZone === 'function' ? hostTimeZone() : hostTimeZone;
  try { return new Intl.DateTimeFormat('zh-CN',{timeZone:zone,dateStyle:'short',timeStyle:'short',hourCycle:'h23'}).format(new Date(value)); }
  catch { return '本次'; }
}
function mobileResult(job, hostTimeZone) {
  const label=plainLabel(line(job.projectLabel,60)).replace(/[*`\[\]<>]/g,char=>({'*':'＊','`':'｀','[':'［',']':'］','<':'＜','>':'＞'}[char]));
  const header = `## 本次执行回复\n\n### ${label}\n\n${localTime(job.finishedAt,hostTimeZone)} · 电脑时间${job.status==='completed'?'':`\n\n${statusNames[job.status]}。`}`;
  const footer = '本轮回复，仍待验收；可继续问进度。';
  if (job.status !== 'completed') return `${header}\n\n本条仅报告本轮状态，不转发异常详情或未完成片段。\n\n${footer}`;
  const note = '回复较长，已截取；可继续询问完整详情。';
  const render=(body,tail='')=>`${header}\n\n> ${body.replace(/\n/g,'\n> ')}${tail?`\n\n${tail}`:''}\n\n${footer}`;
  const source=proseParagraphs(displaySource(job.reply));
  if (!job.replyTruncated && simpleMarkdown(source) && render(source).length<=MOBILE_LIMIT) return render(source);
  // Long or unsupported Markdown becomes a plain excerpt before budgeting,
  // so truncation cannot leave a span, fence or Unicode character unfinished.
  const plain=proseParagraphs(plainSource(source));
  const truncated=job.replyTruncated || render(plain).length>MOBILE_LIMIT;
  const tail=truncated?note:'';
  const budget=MOBILE_LIMIT-render('',tail).length;
  let body = '';
  let used=0;
  for (const char of plain.match(/`[^`\n]+`|[\s\S]/gu)??[]) {
    const size=char.length+(char.match(/\n/g)?.length??0)*2;
    if (used+size>budget) break;
    body+=char; used+=size;
  }
  return render(body.trimEnd(),tail);
}

export function createTaskResults({store,clock = () => new Date(),send = async () => ({status:'blocked'}),hostTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone} = {}) {
  if (typeof store?.get !== 'function' || typeof store?.put !== 'function') throw new Error('Persistent task-result store required');
  let state;
  let queue = Promise.resolve();
  let closing = false;
  let closePromise;
  let storageFailed = false;
  const directClaims = new Map();
  const serial = work => { const run = queue.then(work); queue = run.catch(() => {}); return run; };
  const now = () => {
    const date = clock();
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new Error('Task result clock unavailable');
    return date;
  };
  async function save() {
    if (storageFailed) throw new Error('Task result storage unavailable');
    try { await store.put('profile',taskResultsRowSchema.parse(copy(state))); }
    catch { storageFailed = true; throw new Error('Task result storage unavailable'); }
  }
  async function load() {
    if (storageFailed) throw new Error('Task result storage unavailable');
    if (state) return;
    const stored = await store.get('profile');
    const parsed = taskResultsRowSchema.safeParse(stored ?? freshState());
    if (!parsed.success) throw new Error('Unsupported or corrupt task result state');
    state = parsed.data;
    let changed = false;
    for (const job of state.jobs) {
      if (LIVE.has(job.status)) {
        job.status = now().getTime() >= Date.parse(job.expiresAt) ? 'expired' : 'unknown';
        job.reply = ''; job.replyTruncated = false; job.finishedAt = now().toISOString(); changed = true;
      }
      if (job.delivery?.status === 'dispatching') {
        job.delivery.status = 'uncertain'; job.delivery.detail = deliveryNames.uncertain; changed = true;
      }
    }
    if (changed) await save();
  }
  async function expire() {
    let changed = false;
    for (const job of state.jobs) {
      if (now().getTime() < Date.parse(job.expiresAt)) continue;
      if (LIVE.has(job.status)) {
        job.status = 'expired'; job.reply = ''; job.replyTruncated = false; job.finishedAt = now().toISOString(); changed = true;
      }
      if (job.delivery && RETRYABLE.has(job.delivery.status)) {
        job.delivery.status = 'expired'; job.delivery.detail = deliveryNames.expired; changed = true;
      }
    }
    if (changed) await save();
  }
  const findJob = id => state.jobs.find(job => job.id === id);
  const snapshot = job => copy(job);
  const ready = () => serial(load);
  const byRequest=(originSessionId,key)=>serial(async()=>{await load();identity.parse(originSessionId);identity.parse(key);const job=state.jobs.find(row=>row.originSessionId===originSessionId&&row.originToolCallId===key);return job?snapshot(job):null;});
  const prepare = value => serial(async () => {
    if (closing) throw new Error('Task results closed / 任务结果服务已关闭');
    await load();
    identity.parse(value?.originSessionId); identity.parse(value?.originToolCallId);
    const prior = state.jobs.find(job => job.originSessionId === value.originSessionId && job.originToolCallId === value.originToolCallId);
    if (prior) return {job:snapshot(prior),duplicate:true};
    for (const field of ['targetSessionId','targetMessageId']) identity.parse(value?.[field]);
    if (value.targetSessionId === value.originSessionId) throw new Error('Current session handles its own task directly');
    if (typeof value.projectRoot !== 'string' || value.projectRoot.length > 4096 || !isAbsolute(value.projectRoot)) throw new Error('Known absolute project root required');
    if (typeof value.projectLabel !== 'string' || !value.projectLabel.trim()) throw new Error('Project label required');
    if (typeof value.task !== 'string' || !value.task.trim() || value.task.length > 8000) throw new Error('A bounded explicit task is required');
    const returnBinding = bindingSchema.nullable().parse(value.returnBinding ?? null);
    const familyOrigin=value.familyOrigin===undefined?undefined:familyOriginSchema.parse(value.familyOrigin);
    if(familyOrigin&&(familyOrigin.sessionId!==value.originSessionId||familyOrigin.root!==value.projectRoot))throw new Error('Family task origin mismatch');
    await expire();
    if (state.jobs.filter(active).length >= 10) throw new Error('最多保留10项活动交办，请先等待结果。');
    // Keep dedupe keys for the entire six-hour lifetime. Only expired history
    // may be pruned: deleting a recent terminal row could execute a tool retry.
    if (state.jobs.length >= 50) {
      const index = state.jobs.findIndex(job => !active(job) && now().getTime() >= Date.parse(job.expiresAt));
      if (index < 0) throw new Error('六小时内最多保留50项交办记录，请稍后再试。');
      state.jobs.splice(index,1);
    }
    const createdAt = now().toISOString();
    const job = {id:`task_${randomUUID()}`,originSessionId:value.originSessionId,originToolCallId:value.originToolCallId,
      targetSessionId:value.targetSessionId,targetMessageId:value.targetMessageId,projectRoot:value.projectRoot,
      projectLabel:line(value.projectLabel,80),task:clean(value.task),...(familyOrigin?{familyOrigin}:{}),returnBinding,createdAt,
      expiresAt:new Date(Date.parse(createdAt)+SIX_HOURS).toISOString(),status:'prepared',turn:null,
      reply:'',replyTruncated:false,reason:null,finishedAt:null,delivery:null};
    state.jobs.push(job); await save(); return {job:snapshot(job),duplicate:false};
  });
  const admitted = id => serial(async () => {
    await load(); const job=findJob(id); if (job?.status !== 'prepared') return;
    job.status='admitted'; await save();
  });
  const notAdmitted = (id,{uncertain = false} = {}) => serial(async () => {
    await load(); const job=findJob(id); if (!job || !['prepared','admitted'].includes(job.status)) return;
    job.status=uncertain?'unknown':'not_admitted'; job.finishedAt=now().toISOString(); await save();
  });
  const clearInactiveClaims = () => {
    for (const sessionId of directClaims.keys()) {
      if (!state.jobs.some(job=>job.targetSessionId===sessionId && LIVE.has(job.status))) directClaims.delete(sessionId);
    }
  };
  const stopMixed = job => {
    job.status='mixed'; job.reply=''; job.replyTruncated=false; job.finishedAt=now().toISOString();
  };
  const claimed = event => serial(async () => {
    if (closing) return;
    await load(); await expire();
    const {sessionId,messageId,turn,sourceKind}=event ?? {};
    if (typeof sessionId!=='string' || typeof messageId!=='string' || !messageId || messageId.length>200 || !Number.isInteger(turn) || turn<0) return;
    const watching=state.jobs.filter(job=>job.targetSessionId===sessionId && LIVE.has(job.status));
    if (!watching.length) return;
    let claims=directClaims.get(sessionId);
    if (!claims) { claims=new Map(); directClaims.set(sessionId,claims); }
    if (sourceKind==='user') {
      if (!claims.has(turn) && claims.size>=32) {
        // An abnormal stream must fail closed instead of forgetting a prior
        // direct input and accidentally treating a later mixed turn as clean.
        for (const job of watching) { job.status='unknown'; job.reply=''; job.replyTruncated=false; job.finishedAt=now().toISOString(); }
        directClaims.delete(sessionId); await save(); return;
      }
      const seen=claims.get(turn);
      if (!seen) claims.set(turn,{first:messageId,mixed:false});
      else if (seen.first!==messageId) seen.mixed=true;
    }
    let changed=false;
    const tracked=watching.find(job=>job.targetMessageId===messageId);
    if (tracked && ['prepared','admitted'].includes(tracked.status)) {
      tracked.turn=turn; tracked.status='running'; changed=true;
    }
    const direct=claims.get(turn);
    const sameTurn=watching.filter(job=>job.turn===turn && job.status==='running');
    for (const job of sameTurn) {
      if ((direct && (direct.mixed || direct.first!==job.targetMessageId)) || sameTurn.some(other=>other.targetMessageId!==job.targetMessageId)) {
        stopMixed(job); changed=true;
      }
    }
    if (changed) await save();
    clearInactiveClaims();
  });
  const discarded = event => serial(async () => {
    if (closing) return;
    await load(); await expire();
    const job=state.jobs.find(job=>job.targetSessionId===event?.sessionId && job.targetMessageId===event?.messageId && ['prepared','admitted'].includes(job.status));
    if (!job) return;
    job.status='discarded'; job.reply=''; job.replyTruncated=false; job.finishedAt=now().toISOString();
    await save(); clearInactiveClaims();
  });
  async function flush() {
    if (closing || storageFailed) return;
    for (const job of state.jobs) {
      if (closing) break;
      const delivery=job.delivery;
      if (!delivery || !RETRYABLE.has(delivery.status)) continue;
      if (now().getTime()>=Date.parse(delivery.expiresAt)) {
        delivery.status='expired'; delivery.detail=deliveryNames.expired; await save(); continue;
      }
      if (!job.returnBinding) {
        if (delivery.status!=='blocked') { delivery.status='blocked'; delivery.detail=deliveryNames.blocked; await save(); }
        continue;
      }
      delivery.status='dispatching'; delivery.detail=deliveryNames.dispatching; await save();
      // Saving can take long enough to close the service or expire its window.
      if (closing) { delivery.status='pending'; delivery.detail=deliveryNames.pending; await save(); break; }
      if (now().getTime()>=Date.parse(delivery.expiresAt)) {
        delivery.status='expired'; delivery.detail=deliveryNames.expired; await save(); continue;
      }
      let result;
      try {
        const expectedBinding=copy(job.returnBinding);
        const authorize=()=>!closing&&!storageFailed&&state.jobs.includes(job)&&job.delivery===delivery&&delivery.status==='dispatching'&&now().getTime()<Date.parse(delivery.expiresAt)&&job.returnBinding?.userHash===expectedBinding.userHash&&(job.returnBinding?.botHash??null)===(expectedBinding.botHash??null);
        result=await send({sessionId:job.originSessionId,text:delivery.text,expiresAt:delivery.expiresAt,expectedBinding,...(job.familyOrigin?{familyOrigin:copy(job.familyOrigin)}:{}),requestId:'task-result-'+job.id,authorize});
      } catch { result={status:'uncertain'}; }
      delivery.status=['blocked','queued','reported_sent','failed','uncertain'].includes(result?.status)?result.status:'uncertain';
      delivery.detail=deliveryNames[delivery.status];
      await save();
    }
  }
  const observe = event => serial(async () => {
    if (closing) return;
    await load(); await expire();
    const job=state.jobs.find(job=>job.status==='running' && job.targetSessionId===event?.sessionId && job.turn===event?.turn);
    if (!job) return;
    if (['assistant','assistant/message'].includes(event.type) && !event.interrupted && typeof event.text==='string') {
      const text=clean(event.text);
      if (text) { job.reply=bounded(text,MAX_REPLY); job.replyTruncated=text.length>job.reply.length; await save(); }
      return;
    }
    if (event.type!=='turn/end') return;
    const rawReason=typeof event.reason==='string'?event.reason:event.reason?.kind;
    const reason=knownReasons.has(rawReason)?rawReason:'unknown';
    job.reason=reason; job.status=reason==='completed'?(job.reply?'completed':'no_text'):reason;
    if (job.status!=='completed') { job.reply=''; job.replyTruncated=false; }
    job.finishedAt=now().toISOString();
    job.delivery={text:mobileResult(job,hostTimeZone),status:'pending',createdAt:job.finishedAt,expiresAt:job.expiresAt,detail:deliveryNames.pending};
    // Terminal execution state and its only outbox item share this one write.
    await save(); clearInactiveClaims(); await flush();
  });
  const status = (originSessionId,{id,expectedBinding} = {}) => serial(async () => {
    await load(); identity.parse(originSessionId);
    const expected=expectedBinding===undefined?undefined:bindingSchema.parse(expectedBinding);
    const owned=state.jobs.filter(job=>job.originSessionId===originSessionId && (id === undefined || job.id===id)&&(!expected||job.returnBinding?.userHash===expected.userHash&&(job.returnBinding?.botHash??null)===(expected.botHash??null)));
    const jobs=owned.slice(-10).map(job=>({id:job.id,projectLabel:job.projectLabel,task:line(job.task,160),status:job.status,
      createdAt:job.createdAt,expiresAt:job.expiresAt,finishedAt:job.finishedAt,turn:job.turn,
      delivery:job.delivery?{status:job.delivery.status,detail:deliveryNames[job.delivery.status]}:null,
      ...(id===undefined?{}:{reply:job.reply,replyTruncated:job.replyTruncated})}));
    const text=['## 最近交办状态','交办回复由独立回传流程交给桥接；本查询不补发，也不刷新或检查桥接队列。queued 只记录交给通道时排队，不能说明当前仍有缓存或手机收到。',...jobs.map(job=>`${job.projectLabel}：${statusNames[job.status]}。${job.delivery?` ${deliveryNames[job.delivery.status]}。`:''}${id&&job.reply?`\n${bounded(job.reply,2500)}`:''}`),...(!jobs.length?['没有找到属于当前会话的交办记录。']:[]),'执行回复仍待验收；通道报告发送不代表手机送达或已读。'].join('\n\n');
    return {jobs,text:bounded(text,MOBILE_LIMIT)};
  });
  // Passive UI reads must not invoke load(): its cold recovery intentionally
  // rewrites unfinished executions and dispatches. Never adopt cold state here.
  const inspect = async (originSessionId,{id,expectedBinding} = {}) => {
    const owner=identity.parse(originSessionId),selected=id===undefined?undefined:identity.parse(id);
    const binding=bindingSchema.parse(copy(expectedBinding));
    return serial(async()=>{
      if(closing||storageFailed)throw new Error('Task result inspection unavailable');
      const snapshot=taskResultsRowSchema.parse(copy(state??await store.get('profile')??freshState()));
      if(closing)throw new Error('Task result inspection closed');
      const owned=snapshot.jobs.filter(job=>job.originSessionId===owner&&(selected===undefined||job.id===selected)&&job.returnBinding?.userHash===binding.userHash&&(job.returnBinding?.botHash??null)===(binding.botHash??null));
      return{jobs:owned.slice(-10).map(job=>({id:job.id,projectLabel:job.projectLabel,task:line(job.task,160),status:job.status,
        createdAt:job.createdAt,expiresAt:job.expiresAt,finishedAt:job.finishedAt,turn:job.turn,
        delivery:job.delivery?{status:job.delivery.status,detail:deliveryNames[job.delivery.status]}:null,
        ...(selected===undefined?{}:{reply:job.status==='completed'?job.reply:'',replyTruncated:job.status==='completed'&&job.replyTruncated})}))};
    });
  };
  // Routing evidence is separate from delivery or acceptance. Never expose the
  // task/reply here, and never fall back past a newer uncertain admission.
  const trustedLastTarget = scope => serial(async()=>{
    if(closing)return null;
    await load();
    if(!identity.safeParse(scope?.originSessionId).success||typeof scope?.projectRoot!=='string'||!isAbsolute(scope.projectRoot))return null;
    const current=bindingSchema.safeParse(scope.returnBinding);
    if(!current.success)return null;
    const root=resolve(scope.projectRoot);
    const owned=state.jobs.filter(job=>job.originSessionId===scope.originSessionId&&isAbsolute(job.projectRoot)&&resolve(job.projectRoot)===root);
    if(!owned.length)return null;
    const latest=Math.max(...owned.map(job=>Date.parse(job.createdAt)));
    const recent=owned.filter(job=>Date.parse(job.createdAt)===latest);
    const trusted=job=>job.status==='completed'&&job.reason==='completed'&&Number.isInteger(job.turn)&&job.turn>=0&&job.targetSessionId!==scope.originSessionId&&job.finishedAt!==null&&Date.parse(job.finishedAt)>=latest&&Date.parse(job.finishedAt)<=now().getTime()&&job.returnBinding?.userHash===current.data.userHash&&(job.returnBinding?.botHash??null)===(current.data.botHash??null);
    if(!recent.every(trusted))return null;
    const targets=[...new Set(recent.map(job=>job.targetSessionId))];
    return targets.length===1?{targetSessionId:targets[0]}:null;
  });
  const tick = () => serial(async () => { if (closing) return; await load(); await expire(); clearInactiveClaims(); await flush(); });
  const needsTimer = () => !closing && Boolean(state?.jobs.some(active));
  const close = () => {
    closing=true;
    closePromise ??= serial(async()=>{await load();directClaims.clear();});
    return closePromise;
  };
  return {ready,byRequest,prepare,admitted,notAdmitted,claimed,discarded,observe,status,inspect,trustedLastTarget,tick,needsTimer,close};
}
