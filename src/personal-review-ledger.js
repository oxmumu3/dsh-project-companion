import { createHash } from 'node:crypto';
import { z } from 'zod';
import { reviewSourceTaskSchema, reviewTaskResolutionSchema, reviewSourceTaskKey, singleReviewSourceTask } from './personal-review-source-tasks.js';
import {reviewSourceFailureSchema} from './personal-review-source-diagnostics.js';
import {reviewExecutionSchema} from './review-continuation.js';

export const reviewSources = ['gmail', 'calendar', 'drive', 'flomo', 'dida'];
export const reviewEvidenceSources = [...reviewSources, 'project', 'memory'];
export const reviewId = z.string().min(1).max(240);
export const reviewInstant = z.string().datetime();
const clean = n => z.string().max(n).refine(s => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(s));
const prose = n => clean(n).min(1).refine(s => !/(?:[a-z][a-z\d+.-]*:\/\/|www\.|\]\s*\()/iu.test(s));
const url = z.string().max(1600).refine(value => { try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password; } catch { return false; } });
export const reviewEvidenceSchema = z.object({ id: reviewId, source: z.enum(reviewEvidenceSources), title: clean(400), projectRoot:z.string().max(4096).optional(), text: clean(6000), contentDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(), url: url.optional(), at: reviewInstant.optional(), dueAt: reviewInstant.optional(), dueAtBasis: z.enum(['source', 'relative']).optional(), eventStartAt: reviewInstant.optional(), eventEndAt: reviewInstant.optional(), contentState: z.enum(['metadata_only','unread','unavailable','truncated','read','actual_empty']).optional(), contentScope: z.literal('returned_text').optional(), sourceTask: reviewSourceTaskSchema.optional() });
export const reviewCoverageSchema = z.object({ source: z.enum(reviewEvidenceSources), status: z.enum(['ok', 'partial', 'unavailable', 'failed']), count: z.number().int().min(0).max(100000).nullable(), truncated: z.boolean().optional(), from: reviewInstant.optional(), to: reviewInstant.optional(),diagnostic:reviewSourceFailureSchema.optional() });
export const reviewCandidateSchema = z.object({ key: reviewId, kind: z.enum(['risk', 'deadline', 'invitation', 'reply', 'change', 'progress', 'event']), title: prose(100), summary: prose(360), why: prose(160), action: prose(160), unknown: clean(180).refine(s => !/https?:\/\//iu.test(s)).default(''), evidenceIds: z.array(reviewId).min(1).max(8), priority: z.enum(['low', 'normal', 'high']), confidence: z.enum(['source', 'inferred']), dueAt: reviewInstant.optional(), eventStartAt: reviewInstant.optional(), eventEndAt: reviewInstant.optional() }).strict();
const referenceSchema = reviewEvidenceSchema.omit({ text: true, contentDigest: true });
export const reviewItemSchema = reviewCandidateSchema.omit({ evidenceIds: true }).extend({ id: reviewId, aliases: z.array(reviewId).max(20), evidence: z.array(referenceSchema).max(12), evidenceDigests: z.array(z.object({ locator: z.string().max(1900), source: z.enum(reviewEvidenceSources), digest: z.string().length(64) }).strict()).max(12), revision: z.number().int().min(1), notifiedRevision: z.number().int().min(0), dueAtBasis: z.enum(['source', 'relative']).optional(), firstSeenAt: reviewInstant, lastSeenAt: reviewInstant, status: z.enum(['open', 'handled', 'snoozed', 'dismissed']), snoozeUntil: reviewInstant.nullable(), lastNotifiedAt: reviewInstant.nullable(), notifications: z.array(z.string().max(100)).max(12), scopeKey: z.string().length(64), grantScopeKey: z.string().regex(/^[a-f0-9]{64}$/).optional(), sourceTask: reviewSourceTaskSchema.optional(), sourceResolution: reviewTaskResolutionSchema.optional(), execution: reviewExecutionSchema.optional() }).strict();
export const hashReview = value => createHash('sha256').update(value).digest('hex');
const canon = value => value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
// URL fragments can identify the resource itself (for example Gmail #all/messageId).
const locator = evidence => evidence.url ? `url:${evidence.url}` : `${evidence.source}:${evidence.id}`;

/** Model claims must point at supplied evidence; only structured or verbatim dates may become reminders. */
export function validatePersonalReviewSummary(value, evidence) {
  let result;try{result=z.object({ items: z.array(reviewCandidateSchema).max(12) }).strict().parse(value);}catch(error){error.reviewValidationRule='schema';throw error;}
  const reject=(rule,message)=>{throw Object.assign(new Error(message),{reviewValidationRule:rule});};
  const known = new Map(evidence.map(e => [e.id, e]));
  for (const item of result.items) {
    if (new Set(item.evidenceIds).size !== item.evidenceIds.length || item.evidenceIds.some(id => !known.has(id))) reject('evidence_unknown_or_duplicate','复盘引用包含未知或重复证据');
    const refs = item.evidenceIds.map(id => known.get(id));
    const claims = [item.title, item.summary, item.why, item.action].join('\n');
    // A time on a calendar is not evidence of a deadline, including when the
    // model leaves dueAt blank but describes it as one in its prose.
    const deadlineWords = /截止|期限|到期|逾期|\bdeadline\b|\boverdue\b/iu;
    if ((item.kind === 'event' || refs.every(e => e.source === 'calendar')) && (item.kind === 'deadline' || deadlineWords.test(claims))) reject('calendar_deadline_claim','日历日程不能表述为任务期限');
    // Metadata and an empty returned excerpt cannot establish that a whole
    // document is empty, stale, or that preparation is incomplete.
    const unsupportedFileClaim = /(?:文件|文档|表|内容|资料|数据)[^。！？\n]{0,18}(?:为空|是空的|未更新|没有更新|缺失)|准备(?:不足|不充分)/u;
    const driveRefs = refs.filter(e => e.source === 'drive');
    if (driveRefs.length && driveRefs.every(e => !['read', 'truncated'].includes(e.contentState) || !e.text.trim()) && unsupportedFileClaim.test(claims) && !refs.some(e => e.source !== 'drive' && unsupportedFileClaim.test(e.text))) reject('unsupported_file_claim','未读取的正文不能支持文件为空或准备不足的结论');
    if (item.dueAt && !item.evidenceIds.some(id => { const e = known.get(id); return e.source!=='calendar'&&(e.dueAt === item.dueAt || e.text.includes(item.dueAt)); })) reject('deadline_without_source','复盘期限没有来源依据');
    if(item.kind==='event'&&(!item.eventStartAt||item.dueAt)||item.kind!=='event'&&(item.eventStartAt||item.eventEndAt))reject('event_kind','日程与任务期限类型不一致');
    if(item.eventStartAt&&!item.evidenceIds.some(id=>{const e=known.get(id);return e.source==='calendar'&&e.eventStartAt===item.eventStartAt&&(!item.eventEndAt||e.eventEndAt===item.eventEndAt);} ))reject('event_time_without_source','日程时间没有来源依据');
    if(item.eventEndAt&&Date.parse(item.eventEndAt)<=Date.parse(item.eventStartAt))reject('event_time_order','日程时间无效');
    if (item.dueAt && item.evidenceIds.some(id => { const e = known.get(id); return e.dueAt === item.dueAt && e.dueAtBasis === 'relative'; })) item.confidence = 'inferred';
    if (new Set(item.evidenceIds.map(id => known.get(id).source)).size > 1) item.confidence = 'inferred';
  }
  return result;
}

export function mergeReviewItems(existing, candidates, evidence, { now, scopeKey, grantScopeKey }) {
  if(grantScopeKey!==undefined&&!/^[a-f0-9]{64}$/.test(grantScopeKey))throw new Error('Invalid review grant scope');
  const items = structuredClone(existing), known = new Map(evidence.map(e => [e.id, e]));
  for (const candidate of candidates) {
    const refs = candidate.evidenceIds.map(id => { const { text, contentDigest, ...ref } = known.get(id); return ref; });
    const digests = candidate.evidenceIds.map(id => { const e = known.get(id); return { locator: `${e.source}:${locator(e)}`, source: e.source, digest: e.contentDigest ?? hashReview(canon(e.text)) }; });
    const key = canon(candidate.key), identities = new Set(refs.map(locator));
    const sourceTask = singleReviewSourceTask(refs), taskKey = reviewSourceTaskKey(sourceTask);
    let item = items.find(i => i.scopeKey === scopeKey && (taskKey ? reviewSourceTaskKey(i.sourceTask) === taskKey : !i.sourceTask && (i.aliases.includes(key) || i.kind === candidate.kind && canon(i.title) === canon(candidate.title) && i.evidence.some(ref => identities.has(locator(ref))))));
    if (!item) {
      item = { ...candidate, id: `review_${hashReview(taskKey ? JSON.stringify([scopeKey, 'source-task', taskKey]) : `${scopeKey}:${key}`).slice(0, 32)}`, aliases: [], evidence: [], evidenceDigests: [], revision: 1, notifiedRevision: 0, firstSeenAt: now, lastSeenAt: now, status: 'open', snoozeUntil: null, lastNotifiedAt: null, notifications: [], scopeKey, ...(sourceTask ? { sourceTask } : {}) };
      delete item.evidenceIds; items.push(item);
    }
    // The marker comes only from the trusted generation seam, never the model.
    // A new grant may reuse the same scope key; its actual current candidates
    // cannot inherit evidence retained under an unproven or different grant.
    const grantChanged=grantScopeKey!==undefined&&item.grantScopeKey!==grantScopeKey;
    // Compare source bodies, never model wording, document mtime, or display titles.
    // Merely adding corroboration from another source is not a new fact.
    const changed = digests.some(current => { const previous = item.evidenceDigests.find(d => d.locator === current.locator); return previous ? previous.digest !== current.digest : item.evidenceDigests.some(d => d.source === current.source) && !item.evidenceDigests.some(d => d.digest === current.digest); });
    if (changed || item.dueAt && candidate.dueAt && item.dueAt !== candidate.dueAt || item.eventStartAt && candidate.eventStartAt && item.eventStartAt !== candidate.eventStartAt || item.eventEndAt && candidate.eventEndAt && item.eventEndAt !== candidate.eventEndAt) item.revision++;
    if(grantChanged){item.evidence=[];item.evidenceDigests=[];for(const field of ['sourceResolution','execution','dueAt','dueAtBasis','eventStartAt','eventEndAt'])delete item[field];}
    if(grantScopeKey!==undefined)item.grantScopeKey=grantScopeKey;
    // The fact identity and user feedback survive paraphrases and source revisions.
    const { evidenceIds, ...content } = candidate;
    if (candidate.kind === 'event') { delete item.dueAt; delete item.dueAtBasis; if (!candidate.eventEndAt) delete item.eventEndAt; }
    else { delete item.eventStartAt; delete item.eventEndAt; }
    Object.assign(item, content, { lastSeenAt: now });
    if (candidate.dueAt) item.dueAtBasis = refs.some(e => e.dueAt === candidate.dueAt && e.dueAtBasis === 'relative') ? 'relative' : 'source';
    item.aliases = [...new Set([...item.aliases, key])].slice(-20);
    item.evidenceDigests = [...new Map([...item.evidenceDigests, ...digests].map(d => [d.locator, d])).values()].slice(-12);
    item.evidence = [...new Map([...item.evidence, ...refs].map(ref => [`${ref.source}:${ref.id}`, ref])).values()].slice(-12);
    if (new Set(item.evidence.map(ref => ref.source)).size > 1) item.confidence = 'inferred';
  }
  // Preserve all recent feedback; oldest records are evicted only after the hard bound.
  return items.sort((a, b) => a.lastSeenAt.localeCompare(b.lastSeenAt)).slice(-300);
}

function eventTiming(item){
 if(item.kind==='event'&&item.eventStartAt)return{start:item.eventStartAt,end:item.eventEndAt};
 // Older reviews encoded a meeting start as dueAt. Do not keep escalating it
 // as a task deadline when only calendar references supported that time.
 if(item.dueAt&&item.evidence.every(e=>e.source==='calendar')){const e=item.evidence.find(e=>e.eventStartAt===item.dueAt||e.dueAt===item.dueAt);if(e)return{start:item.dueAt,end:e.eventEndAt};}
 return null;
}
export function reviewNotificationReason(item, now, kind, occurrence) {
  if (item.status === 'handled' || item.status === 'dismissed') return null;
  const event=eventTiming(item);if(event&&Date.parse(event.end??event.start)<=Date.parse(now))return null;
  if (item.status === 'snoozed' && Date.parse(item.snoozeUntil) > Date.parse(now)) return null;
  if (kind === 'weekly') return `weekly:${occurrence}`;
  if (!item.lastNotifiedAt) return 'new';
  if (item.status === 'snoozed') return `snooze:${item.snoozeUntil}`;
  if (item.revision > item.notifiedRevision) return `update:${item.revision}`;
  if (item.dueAt && !event) {
    const remaining = Date.parse(item.dueAt) - Date.parse(now);
    if (remaining >= -86400000 && remaining <= 86400000) return `due:${item.dueAt}`;
  }
  return null;
}

export function selectReviewItems(items, { now, kind, occurrence, scopeKey }) {
  return items.filter(i => i.scopeKey === scopeKey).map(item => ({ item, reason: reviewNotificationReason(item, now, kind, occurrence) }))
    .filter(({ item, reason }) => reason && !item.notifications.includes(reason) && (kind === 'weekly' || item.priority !== 'low' || item.dueAt && Date.parse(item.dueAt) <= Date.parse(now) + 86400000))
    .sort((a, b) => ({ high: 0, normal: 1, low: 2 }[a.item.priority] - { high: 0, normal: 1, low: 2 }[b.item.priority]) || (Date.parse(a.item.dueAt ?? '9999-01-01') - Date.parse(b.item.dueAt ?? '9999-01-01'))).slice(0, kind === 'weekly' ? 5 : 3);
}

export function markReviewNotified(items, selected, now) {
  for (const { item: selectedItem, reason } of selected) {
    const item = items.find(i => i.id === selectedItem.id); if (!item) continue;
    item.lastNotifiedAt = now; item.notifiedRevision = item.revision; item.notifications = [...new Set([...item.notifications, reason])].slice(-12);
    // A first reminder already close to its deadline also consumes that escalation.
    if (item.dueAt && !eventTiming(item) && Math.abs(Date.parse(item.dueAt) - Date.parse(now)) <= 86400000) item.notifications = [...new Set([...item.notifications, `due:${item.dueAt}`])].slice(-12);
    if (item.status === 'snoozed') { item.status = 'open'; item.snoozeUntil = null; }
  }
}

const sourceLabels = { gmail: '邮件', calendar: '日历', drive: '云盘', flomo: 'flomo 笔记', dida: '滴答', project: '项目资料', memory: '项目记忆' };
function readableTime(value, timeZone, full = false) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('zh-CN', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value)).map(x => [x.type, x.value]));
  return `${full ? `${p.year}年` : ''}${p.month}月${p.day}日 ${p.hour}:${p.minute}`;
}
export function renderPersonalReview(items, coverage, { kind, now, unknown = false, timeZone = 'UTC' }) {
  if (unknown) return '本次个人回顾的授权来源暂不可用；当前进展与期限覆盖未知，保留上次成功读取位置。';
  const lines = [`${kind === 'weekly' ? '每周回顾：进展与未解决事项' : '每日回顾'} · ${readableTime(now, timeZone, true)}（${timeZone}）`];
  if (!items.length) lines.push('本次有界读取未筛出值得提醒的新事项；不代表全账号没有待办或进展。');
  for (const [index, item] of items.entries()) {
    const refs = item.evidence.slice(0, 2).map(e => `${sourceLabels[e.source]} · ${e.at ? readableTime(e.at, timeZone) : '时间未知'}${e.url ? ` ${e.url}` : ''}`).join('；');
    const event=eventTiming(item);
    const knownTimes = new Set([item.dueAt, event?.start, event?.end].filter(Boolean).map(Date.parse));
    const display = value => value.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z/g, match => knownTimes.has(Date.parse(match)) ? readableTime(match, timeZone) : match)
      .replace(/(?<![A-Za-z\d:])(\d{2}:\d{2}(?::\d{2})?)Z\b/g, (match, clock) => {
        const length = clock.length, matches = [...knownTimes].filter(value => new Date(value).toISOString().slice(11, 11 + length) === clock);
        return matches.length === 1 ? readableTime(new Date(matches[0]).toISOString(), timeZone) : match;
      });
    const inferred = item.confidence === 'inferred' && item.dueAtBasis !== 'relative' ? '（关联待核对）' : '';
    lines.push(`${index + 1}. ${item.title}${inferred}\n${display(item.summary)}\n为什么现在：${display(item.why)}${event?`\n日程：${readableTime(event.start,timeZone)}${event.end?`—${readableTime(event.end,timeZone)}`:''}`:item.dueAt ? `\n${item.dueAtBasis === 'relative' ? '估算期限' : '期限'}：${readableTime(item.dueAt, timeZone)}${item.dueAtBasis === 'relative' ? '（请核对原文）' : ''}` : ''}\n下一步：${display(item.action)}${item.unknown ? `\n待核对：${display(item.unknown)}` : ''}\n来源：${refs}${item.evidence.length > 2 ? `；另有 ${item.evidence.length - 2} 条关联资料` : ''}`);
  }
  lines.push(`覆盖：${coverage.map(c => `${sourceLabels[c.source]} ${['failed', 'unavailable'].includes(c.status) ? '未获取，情况未知' : `${c.count ?? '未知'} 条${c.status === 'partial' || c.truncated ? '（限量／未完整覆盖）' : '（本次范围）'}`}`).join('；')}`);
  if (items.length) lines.push('可回复：个人回顾「事项原题」已处理，或个人回顾「事项原题」延后1天。刚收到的预览也可按第几条反馈。');
  let text = lines.join('\n\n');
  // Remove whole tail items rather than silently sever source references.
  while (text.length > 3200 && items.length) { items.pop(); return renderPersonalReview(items, coverage, { kind, now, timeZone }); }
  return text.slice(0, 3200);
}
