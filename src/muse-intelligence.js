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
import { createHash } from 'node:crypto';
import { lstat, open, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { cleanGoalSource } from './goal-board-collect.js';
import { memoryRelativeTime } from './personal-profile.js';
import { readProjectFiles, readWorkspaceExperience, safeProjectRoot } from './sources.js';

const MAX_SCAN_WORKSPACES = 10;
const isFixtureGrant = grant => /\/output\/.*fixtures\//.test(String(grant?.root ?? ''));
const MAX_PROMISE_DRAFTS = 6;
const MAX_CUSTOM_DRAFTS = 30;
const PKG_BYTES = 16 * 1024;
const MAX_EXPERIENCES_PER_WORKSPACE = 8;
const MAX_FLOMO_MEMORIES = 5;
const DAY_MS = 86_400_000;
const EXPERIENCE_METADATA = new Set(['id', '标识', 'created', 'updatedat', 'last_hit', '更新日期', 'tags', 'hit_count', 'promoted']);
const EXPERIENCE_EFFECT = new Set(['effect', '效果', '生效', '如何生效']);
const flomoDay = new Intl.DateTimeFormat('zh-CN', {month: 'numeric', day: 'numeric', timeZone: 'UTC'});

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

function stableMemoryId(source, ...identity) {
  return `${source}-${createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0, 32)}`;
}

function isoDate(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : '';
}

function memoryText(value, max = 500) {
  return stripControls(cleanGoalSource(value, max * 2)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\x60([^\x60]+)\x60/g, '$1'), max).replace(/[\uD800-\uDBFF]$/u, '');
}

function projectWorkspaceExperiences(row, grant, now) {
  if (row?.status !== 'ok' || typeof row.text !== 'string') return [];
  const fallbackAt = isoDate(row.modifiedAt);
  if (!fallbackAt) return [];
  const lines = row.text.replace(/<!--[\s\S]*?(?:-->|$)/g, '').split(/\r?\n/);
  const headings = [];
  const fallback = [];
  let fenced = false;
  let current = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (/^(?:```|~~~)/u.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced || !line) continue;
    const heading = /^#{2,6}\s+(.+)$/u.exec(line);
    if (heading) {
      const match = /^(EXP-\d{4}-\d{2}-\d{2}-[A-Za-z0-9_-]+)\s*[·：:\-]?\s*(.*)$/iu.exec(heading[1]);
      const text = memoryText(match?.[2] || heading[1]);
      current = !text || /^(?:已确认|待确认|进行中|项目经验|经验记录|待审候选|历史记录)$/u.test(text)
        ? null
        : {text, key: match?.[1] ?? text, at: isoDate(match?.[1].slice(4, 14))};
      if (current) headings.push(current);
      continue;
    }
    const content = line.replace(/^(?:[-*+]\s+|\d+\.\s+)/u, '');
    const detail = /^\x60?([^:：`]+)\x60?[:：]\s*(.+)$/u.exec(content);
    if (detail) {
      const label = detail[1].trim().toLowerCase();
      if (current && EXPERIENCE_EFFECT.has(label)) current.effect = memoryText(detail[2], 240);
      if (current && ['id', '标识'].includes(label)) current.key = memoryText(detail[2], 240) || current.key;
      if (current && ['created', 'updatedat', 'last_hit', '更新日期'].includes(label)) {
        current.at = isoDate(detail[2]) || current.at;
      }
      if (EXPERIENCE_METADATA.has(label) || EXPERIENCE_EFFECT.has(label)) continue;
    }
    if (content !== line) {
      const text = memoryText(content);
      if (text) fallback.push({text, key: text, at: fallbackAt});
    }
  }

  const provenance = `来自 ${memoryText(grant.label, 80) || '工作区'} · .agent/memory/experience.md`;
  return (headings.length ? headings : fallback).slice(0, MAX_EXPERIENCES_PER_WORKSPACE).map(item => {
    const updatedAt = item.at || fallbackAt;
    return {
      id: stableMemoryId('workspace', grant.id ?? grant.workspaceId, item.key),
      text: item.text,
      active: true,
      category: 'context',
      sourceKind: 'workspace',
      provenance,
      effect: item.effect || '作为工作区经验参考',
      updatedAt,
      relativeTime: memoryRelativeTime(updatedAt, now),
    };
  });
}

export function createMuseIntelligence({
  workspaceAccess,
  sessionLedger = null,
  readProject = readProjectFiles,
  readExperience = readWorkspaceExperience,
  readFlomoMemory = null,
  canReadFlomoMemory = null,
  inspectProjectMemory = null,
  clock = () => new Date(),
  isClosed = () => false,
} = {}) {
  let briefRevision = 0;
  let lastContentSignature = '';
  let cachedBrief = null;
  let memoryInspector = typeof inspectProjectMemory === 'function' ? inspectProjectMemory : null;
  const dismissedStaleKeys = new Set();
  const customDrafts = new Map();
  const synthesizedDrafts = new Map();
  let flomoCache = null;
  let flomoRefresh = 0;

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

    const prioritizedGrants = [...grants].sort((a, b) => Number(isFixtureGrant(a)) - Number(isFixtureGrant(b)));
    const workspaces = [];
    for (const grant of prioritizedGrants.slice(0, MAX_SCAN_WORKSPACES)) {
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
        files = await readProject(grant.root, {curatedOnly: captured.contextMode === 'curated_only'});
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
      if (!summary && captured.contextMode !== 'curated_only') {
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

  function workspaceAuthorized(captured) {
    return !isClosed() && Boolean(captured) &&
      (typeof workspaceAccess?.authorizeSync !== 'function' || workspaceAccess.authorizeSync(captured) === true);
  }

  async function readWorkspaceMemory() {
    let captured;
    try {
      captured = await workspaceAccess?.capture?.();
      if (!workspaceAuthorized(captured) || !Array.isArray(captured.grants)) return null;
      const items = [];
      for (const grant of captured.grants.slice(0, MAX_SCAN_WORKSPACES)) {
        if (!workspaceAuthorized(captured)) return null;
        try {
          const row = await readExperience(grant.root);
          items.push(...projectWorkspaceExperiences(row, grant, nowDate()));
        } catch {
          // One unavailable workspace does not obscure other granted memories.
        }
      }
      await workspaceAccess?.assertCurrent?.(captured);
      return workspaceAuthorized(captured) ? {captured, items} : null;
    } catch {
      return null;
    }
  }

  async function flomoAuthorization() {
    if (isClosed() || typeof canReadFlomoMemory !== 'function') return null;
    try {
      const scope = await canReadFlomoMemory();
      return !isClosed() && typeof scope === 'string' && scope ? scope : null;
    } catch {
      return null;
    }
  }

  async function refreshFlomoMemory() {
    if (typeof readFlomoMemory !== 'function') {
      return {ok: false, code: 'UNAVAILABLE', error: 'flomo 记忆暂不可用。'};
    }
    const generation = ++flomoRefresh;
    const scope = await flomoAuthorization();
    if (!scope) {
      return {ok: false, code: 'FLOMO_NOT_ENABLED', error: '请先在「连接」里启用 flomo。'};
    }
    const now = nowDate();
    try {
      const from = new Date(now.getTime() - 7 * DAY_MS).toISOString();
      const to = now.toISOString();
      const result = await readFlomoMemory({operation: 'recent', from, to, limit: MAX_FLOMO_MEMORIES});
      if (await flomoAuthorization() !== scope || generation !== flomoRefresh) {
        return {ok: false, code: 'FLOMO_ACCESS_CHANGED', error: 'flomo 连接已变化，请重新读取。'};
      }
      if (!Array.isArray(result?.items)) throw new Error('Unexpected flomo result');
      const items = [];
      for (const row of result.items.slice(0, MAX_FLOMO_MEMORIES)) {
        const createdAt = isoDate(row?.createdAt);
        const text = memoryText(row?.text ?? row?.title);
        if (typeof row?.id !== 'string' || !row.id || !text || !createdAt || createdAt < from || createdAt > to) continue;
        const updatedAt = isoDate(row.updatedAt) || createdAt;
        const day = flomoDay.format(new Date(createdAt));
        items.push({
          id: stableMemoryId('flomo', row.id),
          text,
          active: true,
          category: 'note',
          sourceKind: 'flomo',
          provenance: `来自 flomo · ${day} 笔记`,
          effect: '在记忆中保留笔记供查阅',
          updatedAt,
        });
      }
      flomoCache = {scope, items};
      return {ok: true, text: items.length ? `已更新 ${items.length} 条 flomo 笔记` : '最近 7 天没有可展示的 flomo 笔记'};
    } catch {
      return {ok: false, code: 'FLOMO_READ_FAILED', error: '暂时读不到 flomo 笔记，请稍后重试。'};
    }
  }

  async function readMemoryItems() {
    const workspace = await readWorkspaceMemory();
    const source = flomoCache;
    let flomo = [];
    if (source) {
      const scope = await flomoAuthorization();
      if (source === flomoCache) {
        if (scope !== source.scope) flomoCache = null;
        else flomo = source.items.map(item => ({...item, relativeTime: memoryRelativeTime(item.updatedAt, nowDate())}));
      }
    }
    const local = workspaceAuthorized(workspace?.captured) ? workspace.items : [];
    return [...local, ...flomo];
  }

  function readPromiseDrafts({ promises = [], workspaceBrief = null, profile = null } = {}) {
    if (isClosed() || !Array.isArray(promises) || promises.length === 0) return {};
    const traits = Array.isArray(profile?.traits) ? profile.traits.filter(item => item.active !== false) : [];
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

  function attachMemoryInspector(fn) {
    memoryInspector = typeof fn === 'function' ? fn : null;
  }

  function dismissStaleMemorySuggestion({ projectRoot, memoryId } = {}) {
    if (!projectRoot || !memoryId) return;
    if (dismissedStaleKeys.size >= 200) {
      dismissedStaleKeys.delete(dismissedStaleKeys.values().next().value);
    }
    dismissedStaleKeys.add(`${projectRoot}::${memoryId}`);
  }

  async function readStaleMemorySuggestions() {
    if (isClosed() || typeof memoryInspector !== 'function' || typeof workspaceAccess?.capture !== 'function') {
      return [];
    }
    let captured;
    try {
      captured = await workspaceAccess.capture();
    } catch {
      return [];
    }
    const grants = Array.isArray(captured?.grants) ? captured.grants : [];
    if (!grants.length) return [];
    if (typeof workspaceAccess?.authorizeSync === 'function' && workspaceAccess.authorizeSync(captured) !== true) {
      return [];
    }

    const stopWords = new Set(['项目', '问题', '需要', '目前', '下一步', '建议', '继续', '检查', '处理', '功能', '支持', '完成', '修改', '阻塞', '待办', '进度', '已经']);
    const extractTokens = raw => {
      const set = new Set();
      const chunks = String(raw ?? '').match(/[A-Za-z0-9_.-]{3,}|[\u4e00-\u9fff]{2,}/gu) ?? [];
      for (const tok of chunks) {
        if (/^[A-Za-z0-9_.-]+$/.test(tok)) {
          set.add(tok.toLowerCase());
          continue;
        }
        if (tok.length <= 3) {
          if (!stopWords.has(tok)) set.add(tok);
        } else {
          for (let i = 0; i <= tok.length - 2; i++) {
            const sub = tok.slice(i, i + 2);
            if (!stopWords.has(sub)) set.add(sub);
          }
        }
      }
      return set;
    };
    const tokensOverlap = (candTokens, lineText) => {
      const target = extractTokens(lineText);
      let hits = 0;
      for (const tok of candTokens) {
        if (!target.has(tok)) continue;
        if (/^[a-z0-9_.-]{4,}$/.test(tok)) return true;
        hits += 1;
        if (hits >= 2) return true;
      }
      return false;
    };

    const suggestions = [];
    for (const grant of grants.slice(0, MAX_SCAN_WORKSPACES)) {
      if (isClosed() || (typeof workspaceAccess?.authorizeSync === 'function' && workspaceAccess.authorizeSync(captured) !== true)) {
        return [];
      }
      let memView = null;
      try {
        memView = await memoryInspector(grant.root);
      } catch {
        continue;
      }
      const entries = Array.isArray(memView?.entries) ? memView.entries : [];
      const candidates = entries.filter(e => e?.kind === 'blocker' || e?.kind === 'next_step');
      if (!candidates.length) continue;

      let progressDoneLines = [];
      try {
        const files = await readProject(grant.root, {curatedOnly: captured.contextMode === 'curated_only'});
        const progressRow = (Array.isArray(files) ? files : []).find(row => row?.path === '.agent/memory/progress.md');
        if (progressRow?.status === 'ok' && typeof progressRow.text === 'string') {
          progressDoneLines = progressRow.text
            .split(/\r?\n/)
            .filter(line => /已完成|已修复|已收口|已解决|全绿|已上线|通过验收|已实现/u.test(line))
            .slice(0, 60);
        }
      } catch {
        progressDoneLines = [];
      }

      const safeLabel = stripControls(cleanGoalSource(grant.label || '本地项目', 80), 80) || '本地项目';
      const allRecords = [...(Array.isArray(memView?.goals) ? memView.goals : []), ...entries];

      for (const entry of candidates) {
        const key = `${grant.root}::${entry.id}`;
        if (dismissedStaleKeys.has(key)) continue;
        const candTokens = extractTokens(entry.text);
        if (!candTokens.size) continue;
        const entryAt = Date.parse(entry.at) || 0;

        let reason = '';
        const newerResolved = allRecords.find(other => {
          if (!other || other.id === entry.id) return false;
          const otherAt = Date.parse(other.at) || 0;
          if (otherAt <= entryAt) return false;
          if (!/已解决|已修复|已完成|已收口|不再阻塞|已上线/u.test(other.text)) return false;
          return tokensOverlap(candTokens, other.text);
        });
        if (newerResolved) {
          reason = '后续项目记忆已记录收口';
        } else if (progressDoneLines.some(line => tokensOverlap(candTokens, line))) {
          reason = 'progress.md 已有对应完成记录';
        }

        if (reason) {
          suggestions.push({
            id: entry.id,
            projectRoot: grant.root,
            projectLabel: safeLabel,
            kind: entry.kind,
            text: stripControls(entry.text, 160),
            at: entry.at,
            reason,
          });
          if (suggestions.length >= 5) return suggestions;
        }
      }
    }
    return suggestions;
  }

  return {
    readWorkspaceBrief,
    readMemoryItems,
    refreshFlomoMemory,
    peekWorkspaceBrief() {
      return cachedBrief ? structuredClone(cachedBrief) : null;
    },
    readPromiseDrafts,
    savePromiseDraft,
    resetPromiseDraft,
    getPromiseDraftText,
    invalidateBrief,
    attachMemoryInspector,
    dismissStaleMemorySuggestion,
    readStaleMemorySuggestions,
  };
}
