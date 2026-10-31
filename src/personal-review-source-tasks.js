import { createHash } from 'node:crypto';
import { z } from 'zod';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const sourceId = z.string().min(1).max(512).regex(/^[\p{L}\p{N}_@.+:\-]+$/u);
const instant = z.string().datetime();
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const MAX_TRACKED_REVIEW_TASKS = 5;

// This is a structured task locator, never a model-selected URL or title match.
// scopeKey includes the review scope AND source grant, so a new account cannot
// inherit old task ids. Other source entity types need their own checked contract.
export const reviewSourceTaskSchema = z.object({ source: z.literal('dida'), projectId: sourceId, taskId: sourceId, scopeKey: digest }).strict();
export const reviewTaskResolutionSchema = z.object({ status: z.enum(['open', 'completed', 'unknown']), checkedAt: instant }).strict();
export const reviewTaskCheckSchema = reviewTaskResolutionSchema.extend({ task: reviewSourceTaskSchema }).strict();

export function reviewSourceTaskKey(raw) {
  const parsed = reviewSourceTaskSchema.safeParse(raw);
  return parsed.success ? hash([parsed.data.source, parsed.data.scopeKey, parsed.data.projectId, parsed.data.taskId]) : null;
}

export function singleReviewSourceTask(evidence) {
  if (!Array.isArray(evidence) || evidence.length !== 1 || evidence[0]?.source !== 'dida') return null;
  const parsed = reviewSourceTaskSchema.safeParse(evidence[0].sourceTask);
  return parsed.success ? parsed.data : null;
}

/** Least recently checked active tasks first; no legacy URL parsing or title inference. */
export function trackedReviewSourceTasks(items, { scopeKey, taskScopeKey, sources }) {
  if (!sources.includes('dida')) return { tasks: [], hasMore: false };
  const selected = new Map();
  const active = items.filter(item => item.scopeKey === scopeKey && ['open', 'snoozed'].includes(item.status) && item.sourceTask?.scopeKey === taskScopeKey)
    .sort((a, b) => String(a.sourceResolution?.checkedAt ?? a.firstSeenAt).localeCompare(String(b.sourceResolution?.checkedAt ?? b.firstSeenAt)) || a.id.localeCompare(b.id));
  for (const item of active) {
    const key = reviewSourceTaskKey(item.sourceTask);
    if (key && !selected.has(key)) selected.set(key, structuredClone(item.sourceTask));
    if (selected.size > MAX_TRACKED_REVIEW_TASKS) break;
  }
  return { tasks: [...selected.values()].slice(0, MAX_TRACKED_REVIEW_TASKS), hasMore: selected.size > MAX_TRACKED_REVIEW_TASKS };
}

/** Only a checked completion changes local follow-up status; never writes the source. */
export function reconcileReviewSourceTasks(items, checks, { scopeKey, taskScopeKey }) {
  const result = structuredClone(items);
  for (const raw of checks) {
    const parsed = reviewTaskCheckSchema.safeParse(raw);
    if (!parsed.success || parsed.data.task.scopeKey !== taskScopeKey) continue;
    const { task, status, checkedAt } = parsed.data, key = reviewSourceTaskKey(task);
    for (const item of result) {
      if (item.scopeKey !== scopeKey || !['open', 'snoozed'].includes(item.status) || reviewSourceTaskKey(item.sourceTask) !== key) continue;
      item.sourceResolution = { status, checkedAt };
      if (status === 'completed') { item.status = 'handled'; item.snoozeUntil = null; }
    }
  }
  return result;
}

/** Explicit association for a future shared notification claim adapter.
 * Both services must persist/claim notificationKey before sending. This helper
 * alone neither suppresses ordinary reminders nor claims global deduplication.
 */
export function linkReviewTaskReminder(item, { scopeKey, sourceTask, dueAt } = {}) {
  const key = reviewSourceTaskKey(sourceTask);
  if (!item || !key || item.scopeKey !== scopeKey || reviewSourceTaskKey(item.sourceTask) !== key || item.kind !== 'deadline' || item.dueAtBasis === 'relative' || !instant.safeParse(dueAt).success || Date.parse(item.dueAt) !== Date.parse(dueAt)) return null;
  const deadline = new Date(dueAt).toISOString();
  return { reviewItemId: item.id, sourceTask: structuredClone(sourceTask), dueAt: deadline, notificationKey: hash([scopeKey, key, 'deadline', deadline]) };
}
