/**
 * DSH Dot 0.37.0 — "三个更聪明的半步" Backend Service
 *
 * 1. Half-Step 3 (5-Second First Aha): Synthesizes an instant, read-only local
 *    workspace brief strictly from currently authorized `workspaceAccess` grants.
 *    If grants are empty or revoked mid-scan, cached items are discarded immediately.
 * 2. Half-Step 1 (Proactive Draft Slip): Pre-prepares editable, grounded action
 *    and reply draft slips for open Today promises (incorporating user profile
 *    communication tone and matching workspace context) + stores inline edits.
 */
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { cleanGoalSource } from './goal-board-collect.js';
import { readProjectFiles, safeProjectRoot } from './sources.js';

const MAX_SCAN_WORKSPACES = 6;
const MAX_PROMISE_DRAFTS = 6;
const MAX_CUSTOM_DRAFTS = 30;
const PKG_BYTES = 16 * 1024;

const stripControls = (value, max = 500, { allowNewlines = false } = {}) => {
  const raw = String(value ?? '');
  const cleaned = allowNewlines
    ? raw.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').replace(/\r\n?/g, '\n')
    : raw.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ');
  return cleaned.trim().slice(0, max);
};

async function readSafePackageDescription(root) {
  let handle;
  try {
    const absolute = await safeProjectRoot(root);
    const target = join(absolute, 'package.json');
    const stat = await lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > PKG_BYTES) return '';
    if (await realpath(target) !== target) return '';
    handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const opened = await handle.stat();
    if (!opened.isFile() || stat.ino !== opened.ino || stat.dev !== opened.dev) return '';
    const buf = Buffer.alloc(Math.min(PKG_BYTES, opened.size));
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    if (await realpath(target) !== target) return '';
    const pkg = JSON.parse(buf.subarray(0, bytesRead).toString('utf8'));
    if (typeof pkg?.description === 'string' && pkg.description.trim()) {
      return stripControls(cleanGoalSource(pkg.description, 200), 140);
    }
  } catch {
    return '';
  } finally {
    await handle?.close().catch(() => {});
  }
  return '';
}

function summarizeMarkdownSnippet(rawText, maxLen = 120) {
  const safe = cleanGoalSource(rawText ?? '', 2400);
  if (!safe.trim()) return '';
  const lines = safe
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => {
      if (!line) return false;
      if (line.startsWith('<!--') || line.startsWith('[![') || line.startsWith('![')) return false;
      if (/^[-=*`]{3,}$/.test(line)) return false;
      if (/^<!--/.test(line)) return false;
      return true;
    });

  // Prefer the first substantive descriptive line over a bare title if available.
  const normalized = [];
  for (const line of lines.slice(0, 12)) {
    const cleanLine = line
      .replace(/^#{1,6}\s+/, '')
      .replace(/^[-*+]\s+/, '')
      .replace(/^\d+\.\s+/, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .trim();
    if (cleanLine && cleanLine.length >= 4) normalized.push(cleanLine);
  }
  if (!normalized.length) return '';
  const bodyCandidate = normalized.find((item, idx) => idx > 0 && item.length >= 10) ?? normalized[0];
  return stripControls(bodyCandidate, maxLen);
}

function summarizeProgressSnippet(rawText, maxLen = 110) {
  const safe = cleanGoalSource(rawText ?? '', 3000);
  if (!safe.trim()) return '';
  const lines = safe
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => /^[-*+]\s+/.test(line) || /^\d+\.\s+/.test(line));
  for (const line of lines.slice(0, 8)) {
    const cleaned = line
      .replace(/^[-*+]\s+/, '')
      .replace(/^\d+\.\s+/, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .trim();
    if (cleaned.length >= 6) return stripControls(cleaned, maxLen);
  }
  return summarizeMarkdownSnippet(safe, maxLen);
}

function matchWorkspaceForPromise(promiseRow, workspaces) {
  if (!Array.isArray(workspaces) || workspaces.length === 0) return null;
  const hay = `${promiseRow?.what ?? ''} ${promiseRow?.from ?? ''}`.toLowerCase();
  for (const ws of workspaces) {
    const label = String(ws?.label ?? '').trim().toLowerCase();
    if (label && label.length >= 2 && hay.includes(label)) return ws;
  }
  return workspaces.length === 1 ? workspaces[0] : null;
}

export function createMuseIntelligence({
  workspaceAccess,
  sessionLedger = null,
  readProject = readProjectFiles,
  clock = () => new Date(),
  isClosed = () => false,
} = {}) {
  let briefRevision = 0;
  let lastContentSignature = '';
  let cachedBrief = null;
  const customDrafts = new Map();
  const synthesizedDrafts = new Map();

  const nowDate = () => {
    const d = typeof clock === 'function' ? clock() : new Date();
    return d instanceof Date && Number.isFinite(d.getTime()) ? d : new Date();
  };

  const promiseFingerprint = row => [
    String(row?.id ?? ''),
    String(row?.what ?? ''),
    String(row?.when ?? ''),
    String(row?.from ?? ''),
  ].join('|');

  async function readWorkspaceBrief(capturedOverride = null, { force = false } = {}) {
    if (isClosed()) {
      cachedBrief = null;
      return null;
    }
    let captured = capturedOverride;
    if (!captured && typeof workspaceAccess?.capture === 'function') {
      try {
        captured = await workspaceAccess.capture();
      } catch {
        cachedBrief = null;
        return null;
      }
    }
    const grants = Array.isArray(captured?.grants) ? captured.grants : [];
    if (grants.length === 0) {
      cachedBrief = null;
      return null;
    }
    if (typeof workspaceAccess?.authorizeSync === 'function' && workspaceAccess.authorizeSync(captured) !== true) {
      cachedBrief = null;
      return null;
    }
    if (!force && cachedBrief && cachedBrief.accessRevision === captured.revision) {
      return structuredClone(cachedBrief);
    }

    let internalSessions = [];
    try {
      if (typeof sessionLedger?.internal === 'function') {
        internalSessions = (await sessionLedger.internal())?.sessions ?? [];
      }
    } catch {
      internalSessions = [];
    }

    const workspaces = [];
    for (const grant of grants.slice(0, MAX_SCAN_WORKSPACES)) {
      if (isClosed()) {
        cachedBrief = null;
        return null;
      }
      if (typeof workspaceAccess?.authorizeSync === 'function' && workspaceAccess.authorizeSync(captured) !== true) {
        cachedBrief = null;
        return null;
      }
      let files = [];
      try {
        files = await readProject(grant.root);
      } catch {
        files = [];
      }
      if (typeof workspaceAccess?.authorizeSync === 'function' && workspaceAccess.authorizeSync(captured) !== true) {
        cachedBrief = null;
        return null;
      }
      const byPath = new Map((Array.isArray(files) ? files : []).map(row => [row?.path, row]));
      const progressRow = byPath.get('.agent/memory/progress.md');
      const contextRow = byPath.get('.agent/memory/context.md');
      const readmeRow = byPath.get('README.md');

      const latestProgress = progressRow?.status === 'ok' ? summarizeProgressSnippet(progressRow.text, 110) : '';
      let summary = contextRow?.status === 'ok'
        ? summarizeMarkdownSnippet(contextRow.text, 120)
        : readmeRow?.status === 'ok'
          ? summarizeMarkdownSnippet(readmeRow.text, 120)
          : '';
      if (!summary) {
        summary = await readSafePackageDescription(grant.root);
      }
      if (!summary && latestProgress) {
        summary = latestProgress;
      }
      if (!summary) {
        summary = '已接入本地工作目录，随时可以让 Dot 帮你梳理下一步';
      }

      const activeCount = internalSessions.filter(s => s?.root === grant.root && ['needs_you', 'stuck', 'doing'].includes(s?.state)).length;
      const safeLabel = stripControls(cleanGoalSource(grant.label || '本地项目', 80), 80) || '本地项目';
      const statusText = activeCount > 0
        ? `${activeCount} 件事在推进`
        : grant.sessionIds?.length > 0
          ? `${grant.sessionIds.length} 个已有会话`
          : '刚关注的工作区';

      workspaces.push({
        id: grant.id,
        label: safeLabel,
        summary,
        ...(latestProgress ? { latestProgress } : {}),
        sessionCount: Array.isArray(grant.sessionIds) ? grant.sessionIds.length : 0,
        statusText,
      });
    }

    if (typeof workspaceAccess?.authorizeSync === 'function' && workspaceAccess.authorizeSync(captured) !== true) {
      cachedBrief = null;
      return null;
    }

    const lines = workspaces.map(ws => {
      const detail = ws.latestProgress && ws.latestProgress !== ws.summary
        ? `${ws.summary}；最近记着：${ws.latestProgress}`
        : ws.summary;
      return `• ${ws.label}（${ws.statusText}）：${detail}`;
    });
    if (grants.length > MAX_SCAN_WORKSPACES) {
      lines.push(`• 其余 ${grants.length - MAX_SCAN_WORKSPACES} 个已关注工作区同样已受控纳入范围。`);
    }

    const briefTitle = `刚读懂你勾选的 ${grants.length} 个工作区`;
    const briefText = lines.join('\n');
    const signature = JSON.stringify({ title: briefTitle, text: briefText, workspaces });
    if (signature !== lastContentSignature) {
      lastContentSignature = signature;
      briefRevision += 1;
    }
    cachedBrief = {
      revision: briefRevision,
      accessRevision: captured.revision,
      workspaceCount: grants.length,
      generatedAt: nowDate().toISOString(),
      title: briefTitle,
      text: briefText,
      workspaces,
    };
    return structuredClone(cachedBrief);
  }

  function readPromiseDrafts({ promises = [], workspaceBrief = null, profile = null } = {}) {
    if (isClosed() || !Array.isArray(promises) || promises.length === 0) return {};
    const traits = Array.isArray(profile?.traits) ? profile.traits : [];
    const toneTrait = traits.find(item => item?.category === 'tone');
    const focusTrait = traits.find(item => item?.category === 'focus');
    const workspaces = Array.isArray(workspaceBrief?.workspaces) ? workspaceBrief.workspaces : [];
    const out = {};

    for (const row of promises.slice(0, MAX_PROMISE_DRAFTS)) {
      if (!row?.id || !row?.what) continue;
      const fp = promiseFingerprint(row);
      const ws = matchWorkspaceForPromise(row, workspaces);
      const saved = customDrafts.get(row.id);
      if (saved && saved.fingerprint === fp) {
        out[row.id] = {
          promiseId: row.id,
          text: saved.text,
          kind: 'edited',
          workspaceLabel: ws?.label ?? null,
          updatedAt: saved.updatedAt,
        };
        synthesizedDrafts.set(row.id, { text: saved.text, updatedAt: saved.updatedAt });
        continue;
      }

      const whenClause = row.whenText ? `（期限参考：${stripControls(row.whenText, 40)}）` : '';
      const whatText = stripControls(row.what, 140);
      const contextLine = ws
        ? `结合工作区「${ws.label}」现状（${stripControls(ws.latestProgress || ws.summary, 90)}），先收拢现状与待确认点。`
        : focusTrait
          ? `围绕你的近期重心「${stripControls(focusTrait.value, 60)}」，先列出 2–3 条关键依据与需要拍板的结论。`
          : '先核对关联上下文，整理出一份可直接外发的简洁要点与下一步建议。';
      const toneLine = toneTrait
        ? `按你偏好的「${stripControls(toneTrait.value, 60)}」组织口径，由你确认后再发。`
        : '先给明确结论与时间节点，确认无误后再发送或执行。';

      const text = stripControls(
        `【拟办草稿】围绕「${whatText}」${whenClause}\n• 推进要点：${contextLine}\n• 表达口径：${toneLine}`,
        800,
        { allowNewlines: true },
      );
      const updatedAt = nowDate().toISOString();
      out[row.id] = {
        promiseId: row.id,
        text,
        kind: 'smart',
        workspaceLabel: ws?.label ?? null,
        updatedAt,
      };
      synthesizedDrafts.set(row.id, { text, updatedAt });
      if (synthesizedDrafts.size > MAX_CUSTOM_DRAFTS) {
        synthesizedDrafts.delete(synthesizedDrafts.keys().next().value);
      }
    }

    return out;
  }

  function savePromiseDraft({ promiseId, text, baseWhat = '', baseWhen = '', baseFrom = '', currentPromises = null } = {}) {
    if (isClosed()) return { ok: false, code: 'CLOSED', error: 'Dot 正在关闭，未能保存草稿。' };
    const id = stripControls(promiseId, 120);
    if (!id) return { ok: false, code: 'INVALID_ID', error: '缺少事项标识，没有保存草稿。' };
    const cleanDraft = stripControls(text, 1600, { allowNewlines: true });
    if (!cleanDraft) return { ok: false, code: 'EMPTY_DRAFT', error: '草稿内容不能为空；没有改动原草稿。' };

    const list = Array.isArray(currentPromises) ? currentPromises : [];
    const matched = list.find(item => item?.id === id) ?? { id, what: baseWhat, when: baseWhen, from: baseFrom };
    const fp = promiseFingerprint(matched);
    const updatedAt = nowDate().toISOString();
    customDrafts.set(id, { text: cleanDraft, fingerprint: fp, updatedAt });
    synthesizedDrafts.set(id, { text: cleanDraft, updatedAt });
    if (customDrafts.size > MAX_CUSTOM_DRAFTS) {
      customDrafts.delete(customDrafts.keys().next().value);
    }
    return {
      ok: true,
      draft: { promiseId: id, text: cleanDraft, kind: 'edited', updatedAt },
      text: '已保存修改后的草稿，点「按这版草稿去办」即可带上这版内容。',
    };
  }

  function resetPromiseDraft({ promiseId } = {}) {
    const id = stripControls(promiseId, 120);
    if (id) customDrafts.delete(id);
    return { ok: true, text: '已恢复自动拟好的草稿版本。' };
  }

  function getPromiseDraftText(promiseId, currentRow = null) {
    const id = stripControls(promiseId, 120);
    if (!id) return '';
    const custom = customDrafts.get(id);
    if (custom) {
      if (!currentRow || custom.fingerprint === promiseFingerprint(currentRow)) return custom.text;
    }
    return synthesizedDrafts.get(id)?.text ?? '';
  }

  function invalidateBrief() {
    cachedBrief = null;
  }

  return {
    readWorkspaceBrief,
    peekWorkspaceBrief() {
      return cachedBrief ? structuredClone(cachedBrief) : null;
    },
    readPromiseDrafts,
    savePromiseDraft,
    resetPromiseDraft,
    getPromiseDraftText,
    invalidateBrief,
  };
}
