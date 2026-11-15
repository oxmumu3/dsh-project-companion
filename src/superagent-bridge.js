import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function cleanLine(raw, maxLen) {
  return String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function summarizeChecklist(checklist) {
  if (!Array.isArray(checklist) || !checklist.length) return null;
  let done = 0;
  for (const item of checklist) {
    if (item && (item.done === true || item.checked === true || item.status === 'done')) done += 1;
  }
  return { total: checklist.length, done };
}

function resolveDshHome(dshHome) {
  if (typeof dshHome === 'string' && dshHome.trim()) return path.resolve(dshHome.trim());
  if (typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME.trim()) {
    return path.resolve(process.env.DSH_HOME.trim());
  }
  return path.join(os.homedir(), '.dsh');
}

/**
 * Dual-mode bridge between DSH Dot (standalone personal companion) and
 * dsh-superagent (synergy engineering taskboard).
 *
 * - When `$DSH_HOME/superagent-ledger.json` is absent or unreadable, Dot runs
 *   in `standalone` mode and surfaces workspace/session progress on its own.
 * - When readable, Dot switches to `synergy` mode: highlighting only `blocked`
 *   and `in_review` milestones, and enqueuing casual new tasks to
 *   `$DSH_HOME/taskboard-queue/requests.jsonl` (`action: 'pending'`).
 */
export function createSuperAgentBridge({
  dshHome = null,
  fsImpl = fs,
  clock = () => new Date(),
  isClosed = () => false,
} = {}) {
  let localQueueSeq = 0;
  let lastQueued = null;

  const homeDir = () => resolveDshHome(dshHome);
  const ledgerPath = () => path.join(homeDir(), 'superagent-ledger.json');
  const queuePath = () => path.join(homeDir(), 'taskboard-queue', 'requests.jsonl');

  const nowDate = () => {
    const d = typeof clock === 'function' ? clock() : new Date();
    return d instanceof Date && Number.isFinite(d.getTime()) ? d : new Date();
  };

  async function readSynergySnapshot() {
    const file = ledgerPath();
    let raw = '';
    try {
      raw = await fsImpl.promises.readFile(file, 'utf8');
    } catch {
      return {
        mode: 'standalone',
        available: false,
        ledgerRevision: 0,
        revision: localQueueSeq,
        milestones: [],
        counts: { inReview: 0, blocked: 0, inProgress: 0, todo: 0, pending: 0 },
        lastQueued,
      };
    }

    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {
        mode: 'standalone',
        available: false,
        ledgerRevision: 0,
        revision: localQueueSeq,
        milestones: [],
        counts: { inReview: 0, blocked: 0, inProgress: 0, todo: 0, pending: 0 },
        lastQueued,
      };
    }

    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.tasks)) {
      return {
        mode: 'standalone',
        available: false,
        ledgerRevision: 0,
        revision: localQueueSeq,
        milestones: [],
        counts: { inReview: 0, blocked: 0, inProgress: 0, todo: 0, pending: 0 },
        lastQueued,
      };
    }

    const tasks = parsed.tasks.filter(t => t && typeof t === 'object');
    const pendingList = Array.isArray(parsed.pending) ? parsed.pending : [];
    const activeSet = new Set(['todo', 'in_progress', 'in_review']);
    const inReviewTasks = tasks.filter(t => t.status === 'in_review');
    const blockedTasks = tasks.filter(t => t.blocked === true && activeSet.has(t.status));
    const inProgressCount = tasks.filter(t => t.status === 'in_progress').length;
    const todoCount = tasks.filter(t => t.status === 'todo').length;

    const seenIds = new Set();
    const milestones = [];
    for (const row of [...blockedTasks, ...inReviewTasks]) {
      const id = cleanLine(row.id, 64);
      if (!id || seenIds.has(id)) continue;
      seenIds.add(id);
      milestones.push({
        id,
        title: cleanLine(row.title, 120) || '未命名任务',
        status: row.status === 'in_review' ? 'in_review' : String(row.status || 'todo'),
        blocked: row.blocked === true,
        urgency: typeof row.urgency === 'string' ? cleanLine(row.urgency, 24) : 'normal',
        workspaceId: typeof row.workspaceId === 'string' ? cleanLine(row.workspaceId, 80) : null,
        summary: cleanLine(row.description || row.prompt || '', 180),
        updatedAt: typeof row.updatedAt === 'number' || typeof row.updatedAt === 'string' ? row.updatedAt : null,
        checklist: summarizeChecklist(row.checklist),
      });
    }

    milestones.sort((a, b) => {
      if (a.blocked !== b.blocked) return a.blocked ? -1 : 1;
      const aTime = typeof a.updatedAt === 'number' ? a.updatedAt : Date.parse(a.updatedAt || '') || 0;
      const bTime = typeof b.updatedAt === 'number' ? b.updatedAt : Date.parse(b.updatedAt || '') || 0;
      return bTime - aTime;
    });

    const ledgerRevision = Number.isInteger(parsed.revision) && parsed.revision >= 0 ? parsed.revision : 0;

    return {
      mode: 'synergy',
      available: true,
      ledgerRevision,
      revision: ledgerRevision + localQueueSeq,
      milestones: milestones.slice(0, 12),
      counts: {
        inReview: inReviewTasks.length,
        blocked: blockedTasks.length,
        inProgress: inProgressCount,
        todo: todoCount,
        pending: pendingList.length,
      },
      lastQueued,
    };
  }

  async function enqueuePending({
    text,
    title = '',
    workspacePath = '',
    workspaceId = '',
    by = 'dot',
  } = {}) {
    if (isClosed()) {
      return { ok: false, code: 'CLOSED', error: '协同桥接已关闭，没有投递待确认事项。' };
    }
    const cleanText = String(text ?? '')
      .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '')
      .trim()
      .slice(0, 1000);
    if (!cleanText) {
      return { ok: false, code: 'INVALID_TEXT', error: '请写一句具体的待确认事项再放进看板。' };
    }
    const cleanTitle = cleanLine(title, 120);
    const cleanWorkspacePath = typeof workspacePath === 'string' ? workspacePath.trim().slice(0, 1024) : '';
    const cleanWorkspaceId = cleanLine(workspaceId, 80);
    const now = nowDate();
    const requestId = `dot-pending-${randomUUID().slice(0, 10)}`;
    const record = {
      id: requestId,
      requestId,
      action: 'pending',
      source: 'dsh-dot',
      payload: {
        text: cleanText,
        ...(cleanTitle ? { title: cleanTitle } : {}),
        ...(cleanWorkspacePath ? { workspacePath: cleanWorkspacePath } : {}),
        ...(cleanWorkspaceId ? { workspaceId: cleanWorkspaceId } : {}),
        by: cleanLine(by, 32) || 'dot',
      },
      createdAt: now.toISOString(),
      at: now.getTime(),
    };

    const file = queuePath();
    try {
      await fsImpl.promises.mkdir(path.dirname(file), { recursive: true });
      await fsImpl.promises.appendFile(file, `${JSON.stringify(record)}\n`, 'utf8');
    } catch (error) {
      return {
        ok: false,
        code: 'QUEUE_WRITE_FAILED',
        error: '写入 SuperAgent 待确认队列失败，没有丢掉你的输入。',
        detail: error instanceof Error ? error.message : String(error),
      };
    }

    localQueueSeq += 1;
    lastQueued = {
      requestId,
      text: cleanLine(cleanText, 120),
      title: cleanTitle || null,
      at: now.toISOString(),
    };

    return {
      ok: true,
      requestId,
      queuePath: file,
      lastQueued,
      superagent: await readSynergySnapshot(),
      text: '已放进 SuperAgent「待确认」，你可以继续做别的事，或者稍后去看板拍板。',
    };
  }

  return {
    readSynergySnapshot,
    enqueuePending,
    ledgerPath,
    queuePath,
  };
}
