import { createHash } from 'node:crypto';
import { z } from 'zod';

export const reviewSources = ['gmail', 'calendar', 'drive', 'flomo', 'dida'];
export const reviewEvidenceSources = [...reviewSources, 'project', 'memory'];
export const reviewId = z.string().min(1).max(240);
export const reviewInstant = z.string().datetime();
const clean = n => z.string().max(n).refine(s => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(s));
const prose = n => clean(n).min(1).refine(s => !/(?:[a-z][a-z\d+.-]*:\/\/|www\.|\]\s*\()/iu.test(s));
const url = z.string().max(1600).refine(value => { try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password; } catch { return false; } });
export const reviewEvidenceSchema = z.object({ id: reviewId, source: z.enum(reviewEvidenceSources), title: clean(400), text: clean(6000), url: url.optional(), at: reviewInstant.optional(), dueAt: reviewInstant.optional(), dueAtBasis: z.enum(['source', 'relative']).optional() });
export const reviewCoverageSchema = z.object({ source: z.enum(reviewEvidenceSources), status: z.enum(['ok', 'partial', 'unavailable', 'failed']), count: z.number().int().min(0).max(100000).nullable(), truncated: z.boolean().optional(), from: reviewInstant.optional(), to: reviewInstant.optional() });
export const reviewCandidateSchema = z.object({ key: reviewId, kind: z.enum(['risk', 'deadline', 'invitation', 'reply', 'change', 'progress']), title: prose(100), summary: prose(360), why: prose(160), action: prose(160), unknown: clean(180).refine(s => !/https?:\/\//iu.test(s)).default(''), evidenceIds: z.array(reviewId).min(1).max(8), priority: z.enum(['low', 'normal', 'high']), confidence: z.enum(['source', 'inferred']), dueAt: reviewInstant.optional() }).strict();
const referenceSchema = reviewEvidenceSchema.omit({ text: true });
export const reviewItemSchema = reviewCandidateSchema.omit({ evidenceIds: true }).extend({ id: reviewId, aliases: z.array(reviewId).max(20), evidence: z.array(referenceSchema).max(12), evidenceDigests: z.array(z.object({ locator: z.string().max(1900), source: z.enum(reviewEvidenceSources), digest: z.string().length(64) }).strict()).max(12), revision: z.number().int().min(1), notifiedRevision: z.number().int().min(0), dueAtBasis: z.enum(['source', 'relative']).optional(), firstSeenAt: reviewInstant, lastSeenAt: reviewInstant, status: z.enum(['open', 'handled', 'snoozed', 'dismissed']), snoozeUntil: reviewInstant.nullable(), lastNotifiedAt: reviewInstant.nullable(), notifications: z.array(z.string().max(100)).max(12), scopeKey: z.string().length(64) }).strict();
export const hashReview = value => createHash('sha256').update(value).digest('hex');
const canon = value => value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
const locator = evidence => evidence.url ? `url:${evidence.url.replace(/#.*$/, '')}` : `${evidence.source}:${evidence.id}`;

/** Model claims must point at supplied evidence; only structured or verbatim dates may become reminders. */
export function validatePersonalReviewSummary(value, evidence) {
  const result = z.object({ items: z.array(reviewCandidateSchema).max(12) }).strict().parse(value);
  const known = new Map(evidence.map(e => [e.id, e]));
  for (const item of result.items) {
    if (new Set(item.evidenceIds).size !== item.evidenceIds.length || item.evidenceIds.some(id => !known.has(id))) throw new Error('复盘引用包含未知或重复证据');
    if (item.dueAt && !item.evidenceIds.some(id => { const e = known.get(id); return e.dueAt === item.dueAt || e.text.includes(item.dueAt); })) throw new Error('复盘期限没有来源依据');
    if (item.dueAt && item.evidenceIds.some(id => { const e = known.get(id); return e.dueAt === item.dueAt && e.dueAtBasis === 'relative'; })) item.confidence = 'inferred';
    if (new Set(item.evidenceIds.map(id => known.get(id).source)).size > 1) item.confidence = 'inferred';
  }
  return result;
}

export function mergeReviewItems(existing, candidates, evidence, { now, scopeKey }) {
  const items = structuredClone(existing), known = new Map(evidence.map(e => [e.id, e]));
  for (const candidate of candidates) {
    const refs = candidate.evidenceIds.map(id => { const { text, ...ref } = known.get(id); return ref; });
    const digests = candidate.evidenceIds.map(id => { const e = known.get(id); return { locator: `${e.source}:${locator(e)}`, source: e.source, digest: hashReview(canon(e.text)) }; });
    const key = canon(candidate.key), identities = new Set(refs.map(locator));
    let item = items.find(i => i.scopeKey === scopeKey && (i.aliases.includes(key) || i.kind === candidate.kind && canon(i.title) === canon(candidate.title) && i.evidence.some(ref => identities.has(locator(ref)))));
    if (!item) {
      item = { ...candidate, id: `review_${hashReview(`${scopeKey}:${key}`).slice(0, 32)}`, aliases: [], evidence: [], evidenceDigests: [], revision: 1, notifiedRevision: 0, firstSeenAt: now, lastSeenAt: now, status: 'open', snoozeUntil: null, lastNotifiedAt: null, notifications: [], scopeKey };
      delete item.evidenceIds; items.push(item);
    }
    // Compare source bodies, never model wording, document mtime, or display titles.
    // Merely adding corroboration from another source is not a new fact.
    const changed = digests.some(current => { const previous = item.evidenceDigests.find(d => d.locator === current.locator); return previous ? previous.digest !== current.digest : item.evidenceDigests.some(d => d.source === current.source) && !item.evidenceDigests.some(d => d.digest === current.digest); });
    if (changed || item.dueAt && candidate.dueAt && item.dueAt !== candidate.dueAt) item.revision++;
    // The fact identity and user feedback survive paraphrases and source revisions.
    const { evidenceIds, ...content } = candidate;
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

export function reviewNotificationReason(item, now, kind, occurrence) {
  if (item.status === 'handled' || item.status === 'dismissed') return null;
  if (item.status === 'snoozed' && Date.parse(item.snoozeUntil) > Date.parse(now)) return null;
  if (kind === 'weekly') return `weekly:${occurrence}`;
  if (!item.lastNotifiedAt) return 'new';
  if (item.status === 'snoozed') return `snooze:${item.snoozeUntil}`;
  if (item.revision > item.notifiedRevision) return `update:${item.revision}`;
  if (item.dueAt) {
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
    if (item.dueAt && Math.abs(Date.parse(item.dueAt) - Date.parse(now)) <= 86400000) item.notifications = [...new Set([...item.notifications, `due:${item.dueAt}`])].slice(-12);
    if (item.status === 'snoozed') { item.status = 'open'; item.snoozeUntil = null; }
  }
}

export function renderPersonalReview(items, coverage, { kind, now, unknown = false }) {
  if (unknown) return '本次个人回顾的授权来源暂不可用；当前进展与期限覆盖未知，保留上次成功读取位置。';
  const lines = [`${kind === 'weekly' ? '每周回顾：本周进展与未解决事项' : '每日回顾：值得处理的事项'}（${now}）`];
  if (!items.length) lines.push('本次有界读取未筛出值得提醒的新事项；不代表全账号没有待办或进展。');
  for (const [index, item] of items.entries()) {
    const refs = item.evidence.slice(0, 2).map(e => `${e.source} · ${e.at ?? '来源时间未知'}${e.url ? ` ${e.url}` : ''}`).join('；');
    lines.push(`${index + 1}. ${item.title}\n${item.summary}\n为什么现在：${item.why}${item.dueAt ? ` ${item.dueAtBasis === 'relative' ? '估算期限' : '期限'}：${item.dueAt}${item.dueAtBasis === 'relative' ? '（由来源相对日期推算，请核对原文）' : ''}` : ''}\n建议：${item.action}${item.unknown ? `\n未知：${item.unknown}` : ''}${item.confidence === 'inferred' ? '\n关联或期限为推断，尚未独立核实。' : ''}\n来源：${refs}\n事项：${item.id}`);
  }
  lines.push(`覆盖：${coverage.map(c => `${c.source} ${['failed', 'unavailable'].includes(c.status) ? '未获取，未知' : `${c.count ?? '未知'} 条${c.status === 'partial' || c.truncated ? '（限量／未完整覆盖）' : '（本次范围）'}`}`).join('；')}`);
  let text = lines.join('\n\n');
  // Remove whole tail items rather than silently sever source references.
  while (text.length > 3200 && items.length) { items.pop(); return renderPersonalReview(items, coverage, { kind, now }); }
  return text.slice(0, 3200);
}
