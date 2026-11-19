import { randomUUID } from 'node:crypto';
import { z } from 'zod';

export const PERSONAL_TRAIT_CATEGORIES = ['rhythm', 'tone', 'focus', 'custom'];
export const PERSONAL_NOTE_CATEGORIES = ['note', 'travel', 'preference', 'context', 'habit', 'schedule', 'idea', 'boundary'];
export const PERSONAL_NOTE_SOURCES = ['desktop', 'wechat', 'agent'];
const MEMORY_SOURCE_KINDS = ['chat', 'workspace', 'flomo', 'manual'];

const UNDO_TTL_MS = 120_000;
const MAX_UNDO_TOKENS = 30;
const MAX_SOURCE_OVERRIDES = 240;
const memoryMetadata = {
  active: z.boolean().optional(),
  sourceKind: z.enum(MEMORY_SOURCE_KINDS).optional(),
  provenance: z.string().min(1).max(240).optional(),
  effect: z.string().min(1).max(240).optional(),
};
const memoryOverrideSchema = z.object({
  id: z.string().min(1).max(64),
  active: z.boolean(),
  removed: z.boolean(),
}).strict();

export const personalTraitSchema = z.object({
  id: z.string().min(1).max(64),
  category: z.enum(PERSONAL_TRAIT_CATEGORIES),
  label: z.string().min(1).max(40),
  value: z.string().min(1).max(120),
  updatedAt: z.string().min(1).max(64),
  ...memoryMetadata,
}).strict();

export const personalNoteSchema = z.object({
  id: z.string().min(1).max(64),
  text: z.string().min(1).max(500),
  category: z.enum(PERSONAL_NOTE_CATEGORIES),
  source: z.enum(PERSONAL_NOTE_SOURCES),
  createdAt: z.string().min(1).max(64),
  updatedAt: z.string().min(1).max(64),
  ...memoryMetadata,
}).strict();

export const personalProfileRowSchema = z.object({
  id: z.literal('profile'),
  revision: z.number().int().min(0),
  traits: z.array(personalTraitSchema).max(24),
  notes: z.array(personalNoteSchema).max(60),
  memoryOverrides: z.array(memoryOverrideSchema).max(MAX_SOURCE_OVERRIDES).optional(),
  updatedAt: z.string().nullable(),
}).strict();

export function emptyPersonalProfileRow() {
  return {
    id: 'profile',
    revision: 0,
    traits: [],
    notes: [],
    updatedAt: null,
  };
}

function cleanText(raw, maxLen, { allowNewlines = false } = {}) {
  const input = String(raw ?? '');
  const stripped = allowNewlines
    ? input.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').replace(/\r\n?/g, '\n')
    : input.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ');
  return stripped.trim().slice(0, maxLen).replace(/[\uD800-\uDBFF]$/u, '');
}

function applyMemoryMetadata(row, input) {
  if (typeof input.active === 'boolean') row.active = input.active;
  if (MEMORY_SOURCE_KINDS.includes(input.sourceKind)) row.sourceKind = input.sourceKind;
  for (const key of ['provenance', 'effect']) {
    if (typeof input[key] !== 'string') continue;
    const text = cleanText(input[key], 240);
    if (text) row[key] = text;
    else delete row[key];
  }
  return row;
}

export function memoryRelativeTime(updatedAt, now) {
  const elapsed = Math.max(0, now.getTime() - Date.parse(updatedAt));
  if (!Number.isFinite(elapsed)) return '';
  if (elapsed < 60_000) return '刚刚';
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} 分钟前`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} 小时前`;
  if (elapsed < 172_800_000) return '昨天';
  return updatedAt.slice(0, 10);
}

function profileMemoryItems(profile, now) {
  return [...profile.traits, ...profile.notes].map(row => {
    const sourceKind = row.sourceKind ?? (['wechat', 'agent'].includes(row.source) ? 'chat' : 'manual');
    return {
      id: row.id,
      text: row.text ?? `${row.label}：${row.value}`,
      active: row.active !== false,
      category: row.text === undefined ? 'preference' : row.category,
      sourceKind,
      provenance: row.provenance ?? ({chat: '来自对话', manual: '手动记下', workspace: '来自工作区', flomo: '来自 flomo'})[sourceKind],
      effect: row.effect ?? '供 Dot 在对话中参考',
      updatedAt: row.updatedAt,
      relativeTime: memoryRelativeTime(row.updatedAt, now),
    };
  });
}

function cloneRow(row) {
  return {
    id: 'profile',
    revision: row.revision,
    traits: row.traits.map(item => ({ ...item })),
    notes: row.notes.map(item => ({ ...item })),
    ...(row.memoryOverrides ? { memoryOverrides: row.memoryOverrides.map(item => ({ ...item })) } : {}),
    updatedAt: row.updatedAt,
  };
}

function createMemoryStore() {
  let row = emptyPersonalProfileRow();
  return {
    async get(key) {
      return key === 'profile' ? cloneRow(row) : undefined;
    },
    async put(key, next) {
      const value = next === undefined ? key : next;
      row = cloneRow(value);
    },
  };
}

/**
 * Bounded personal profile store ("记忆 / 关于你") for Dot Muse v3.
 * Supports structured preferences (`rhythm`, `tone`, `focus`, `custom`),
 * casual quick notes ("顺口记下"), 2-minute in-memory undo tokens,
 * and bounded prompt guidance text.
 */
export function createPersonalProfile({
  store = createMemoryStore(),
  clock = () => new Date(),
  isClosed = () => false,
  onChange = null,
} = {}) {
  let cached = emptyPersonalProfileRow();
  let loaded = false;
  let chain = Promise.resolve();
  const undoTokens = new Map();
  let lastUndoToken = '';

  const nowDate = () => {
    const d = typeof clock === 'function' ? clock() : new Date();
    return d instanceof Date && Number.isFinite(d.getTime()) ? d : new Date();
  };

  const enqueue = fn => {
    const run = chain.then(fn, fn);
    chain = run.catch(() => {});
    return run;
  };

  const pruneUndo = nowMs => {
    for (const [token, entry] of undoTokens.entries()) {
      if (nowMs - entry.at > UNDO_TTL_MS) undoTokens.delete(token);
    }
    while (undoTokens.size >= MAX_UNDO_TOKENS) {
      undoTokens.delete(undoTokens.keys().next().value);
    }
  };

  const issueUndo = (previous, saved, summary) => {
    const nowMs = nowDate().getTime();
    pruneUndo(nowMs);
    const token = `undo-${randomUUID().slice(0, 12)}`;
    const changes = [];
    for (const key of ['traits', 'notes', 'memoryOverrides']) {
      const before = previous[key] ?? [], after = saved[key] ?? [];
      const ids = new Set([...before, ...after].map(item => item.id));
      for (const id of ids) {
        const index = before.findIndex(item => item.id === id);
        const oldItem = before[index];
        const newItem = after.find(item => item.id === id);
        if (JSON.stringify(oldItem) !== JSON.stringify(newItem)) changes.push({key, id, index, oldItem, newItem});
      }
    }
    undoTokens.set(token, {
      at: nowMs,
      summary,
      changes,
    });
    lastUndoToken = token;
    return token;
  };

  async function ensureLoaded() {
    if (loaded) return cached;
    try {
      const raw = await store.get('profile');
      const parsed = personalProfileRowSchema.safeParse(raw);
      if (parsed.success) {
        cached = cloneRow(parsed.data);
      } else {
        cached = emptyPersonalProfileRow();
      }
    } catch {
      cached = emptyPersonalProfileRow();
    }
    loaded = true;
    return cached;
  }

  async function commit(nextRow) {
    const parsed = personalProfileRowSchema.parse({...cached, ...nextRow});
    await store.put('profile', parsed);
    cached = cloneRow(parsed);
    loaded = true;
    try {
      await onChange?.(cloneRow(cached));
    } catch {
      // Change listeners are best-effort and must not roll back saved profile data.
    }
    return cloneRow(cached);
  }

  const publicView = row => ({
    revision: row.revision,
    traits: row.traits.map(item => ({ ...item })),
    notes: row.notes.map(item => ({ ...item })),
    updatedAt: row.updatedAt,
  });

  const profileApi = {
    async ready() {
      return enqueue(async () => publicView(await ensureLoaded()));
    },

    async snapshot() {
      return enqueue(async () => publicView(await ensureLoaded()));
    },

    cachedSnapshot() {
      return publicView(cached);
    },

    async setTrait({ id, category = 'custom', label, value, ...metadata } = {}) {
      if (isClosed()) return { ok: false, code: 'CLOSED', error: '个人记忆服务已关闭，没有修改。' };
      return enqueue(async () => {
        const current = await ensureLoaded();
        const safeCategory = PERSONAL_TRAIT_CATEGORIES.includes(category) ? category : 'custom';
        const cleanLabel = cleanText(label, 40);
        const cleanValue = cleanText(value, 120);
        if (!cleanLabel || !cleanValue) {
          return { ok: false, code: 'INVALID_TRAIT', error: '请填写偏好名称和内容后再保存。' };
        }
        const nowIso = nowDate().toISOString();
        const prev = cloneRow(current);
        const nextTraits = current.traits.map(item => ({ ...item }));
        const idx = nextTraits.findIndex(item =>
          (id && item.id === id) ||
          (item.category === safeCategory && item.label === cleanLabel),
        );
        const trait = applyMemoryMetadata({
          ...nextTraits[idx],
          id: idx >= 0 ? nextTraits[idx].id : cleanText(id, 64) || `trait-${randomUUID().slice(0, 8)}`,
          category: safeCategory,
          label: cleanLabel,
          value: cleanValue,
          updatedAt: nowIso,
        }, metadata);
        if (idx >= 0) nextTraits[idx] = trait;
        else {
          if (nextTraits.length >= 24) {
            return { ok: false, code: 'TRAIT_LIMIT', error: '个人偏好已达 24 条上限，可先删掉不常用的条目。' };
          }
          nextTraits.push(trait);
        }
        const saved = await commit({
          id: 'profile',
          revision: current.revision + 1,
          traits: nextTraits,
          notes: current.notes,
          updatedAt: nowIso,
        });
        const undoToken = issueUndo(prev, saved, `恢复「${cleanLabel}」之前的设置`);
        return { ok: true, trait, profile: publicView(saved), undoToken, text: `已记住：${cleanLabel} · ${cleanValue}` };
      });
    },

    async removeTrait({ id, category, label } = {}) {
      if (isClosed()) return { ok: false, code: 'CLOSED', error: '个人记忆服务已关闭，没有修改。' };
      return enqueue(async () => {
        const current = await ensureLoaded();
        const idx = current.traits.findIndex(item =>
          (id && item.id === id) ||
          (label && item.label === label && (!category || item.category === category)),
        );
        if (idx < 0) return { ok: false, code: 'NOT_FOUND', error: '没有找到这条偏好记录。' };
        const prev = cloneRow(current);
        const removed = current.traits[idx];
        const nextTraits = current.traits.filter((_, i) => i !== idx);
        const nowIso = nowDate().toISOString();
        const saved = await commit({
          id: 'profile',
          revision: current.revision + 1,
          traits: nextTraits,
          notes: current.notes,
          updatedAt: nowIso,
        });
        const undoToken = issueUndo(prev, saved, `恢复「${removed.label}」`);
        return { ok: true, removedId: removed.id, profile: publicView(saved), undoToken, text: `已忘记「${removed.label}」` };
      });
    },

    async addNote({ text, category = 'note', source = 'desktop', ...metadata } = {}) {
      if (isClosed()) return { ok: false, code: 'CLOSED', error: '个人记忆服务已关闭，没有保存。' };
      return enqueue(async () => {
        const current = await ensureLoaded();
        const cleanBody = cleanText(text, 500, { allowNewlines: true });
        if (!cleanBody) return { ok: false, code: 'INVALID_NOTE', error: '请输入要记住的话。' };
        const safeCategory = PERSONAL_NOTE_CATEGORIES.includes(category) ? category : 'note';
        const safeSource = PERSONAL_NOTE_SOURCES.includes(source) ? source : 'desktop';
        const nowIso = nowDate().toISOString();
        const prev = cloneRow(current);
        const note = applyMemoryMetadata({
          id: `note-${randomUUID().slice(0, 8)}`,
          text: cleanBody,
          category: safeCategory,
          source: safeSource,
          createdAt: nowIso,
          updatedAt: nowIso,
        }, metadata);
        const nextNotes = [note, ...current.notes].slice(0, 60);
        const saved = await commit({
          id: 'profile',
          revision: current.revision + 1,
          traits: current.traits,
          notes: nextNotes,
          updatedAt: nowIso,
        });
        const undoToken = issueUndo(prev, saved, '撤回刚才记下的这句话');
        return { ok: true, note, profile: publicView(saved), undoToken, text: `已顺口记下（共 ${saved.notes.length} 条）` };
      });
    },

    async deleteNote({ id } = {}) {
      if (isClosed()) return { ok: false, code: 'CLOSED', error: '个人记忆服务已关闭，没有修改。' };
      return enqueue(async () => {
        const current = await ensureLoaded();
        const idx = current.notes.findIndex(item => item.id === id);
        if (idx < 0) return { ok: false, code: 'NOT_FOUND', error: '这条随记已经不在记忆列表里。' };
        const prev = cloneRow(current);
        const removed = current.notes[idx];
        const nextNotes = current.notes.filter(item => item.id !== id);
        const nowIso = nowDate().toISOString();
        const saved = await commit({
          id: 'profile',
          revision: current.revision + 1,
          traits: current.traits,
          notes: nextNotes,
          updatedAt: nowIso,
        });
        const undoToken = issueUndo(prev, saved, '恢复刚才忘掉的随记');
        return { ok: true, removedId: removed.id, profile: publicView(saved), undoToken, text: '已从记忆里抹掉；2 分钟内可点撤回恢复。' };
      });
    },

    async undo({ token } = {}) {
      if (isClosed()) return { ok: false, code: 'CLOSED', error: '个人记忆服务已关闭，没有撤回。' };
      return enqueue(async () => {
        const nowMs = nowDate().getTime();
        pruneUndo(nowMs);
        const resolvedToken = (!token || token === 'latest') ? lastUndoToken : token;
        const entry = typeof resolvedToken === 'string' && resolvedToken ? undoTokens.get(resolvedToken) : null;
        if (!entry) {
          return { ok: false, code: 'UNDO_EXPIRED', error: '这条撤回已经超过 2 分钟或刚用过了。' };
        }
        const current = await ensureLoaded();
        const nowIso = nowDate().toISOString();
        const next = cloneRow(current);
        for (const {key, id, index, oldItem, newItem} of entry.changes) {
          const rows = next[key] ??= [];
          const at = rows.findIndex(item => item.id === id);
          if (JSON.stringify(rows[at]) !== JSON.stringify(newItem)) {
            return {ok: false, code: 'UNDO_CONFLICT', error: '这条记忆后来已经改过，无法撤回旧改动。'};
          }
          if (at >= 0) rows.splice(at, 1);
          if (oldItem) rows.splice(index, 0, oldItem);
        }
        if (!personalProfileRowSchema.safeParse(next).success) {
          return {ok: false, code: 'UNDO_CONFLICT', error: '记忆已满，无法恢复这条记录。'};
        }
        const saved = await commit({...next, revision: current.revision + 1, updatedAt: nowIso});
        undoTokens.delete(resolvedToken);
        if (lastUndoToken === resolvedToken) lastUndoToken = '';
        return { ok: true, profile: publicView(saved), text: entry.summary || '已撤回刚才的记忆改动。' };
      });
    },

    async forgetMatch({ id, category, label, query } = {}) {
      if (isClosed()) return { ok: false, code: 'CLOSED', error: '个人记忆服务已关闭，没有修改。' };
      return enqueue(async () => {
        const current = await ensureLoaded();
        const cleanId = cleanText(id, 64);
        const cleanLabel = cleanText(label, 40);
        const safeCategory = PERSONAL_TRAIT_CATEGORIES.includes(category) ? category : null;
        const cleanQuery = cleanText(query, 200).toLowerCase();

        const matches = [];
        for (const item of current.traits) {
          if (cleanId && item.id === cleanId) {
            matches.push({ kind: 'trait', item, summary: `${item.label}：${item.value}` });
            continue;
          }
          if (cleanLabel && item.label === cleanLabel && (!safeCategory || item.category === safeCategory)) {
            matches.push({ kind: 'trait', item, summary: `${item.label}：${item.value}` });
            continue;
          }
          if (cleanQuery && (`${item.label} ${item.value}`).toLowerCase().includes(cleanQuery)) {
            matches.push({ kind: 'trait', item, summary: `${item.label}：${item.value}` });
          }
        }
        for (const item of current.notes) {
          if (cleanId && item.id === cleanId) {
            matches.push({ kind: 'note', item, summary: item.text.slice(0, 60) });
            continue;
          }
          if (cleanQuery && item.text.toLowerCase().includes(cleanQuery)) {
            matches.push({ kind: 'note', item, summary: item.text.slice(0, 60) });
          }
        }

        if (matches.length === 0) {
          return { ok: false, code: 'NOT_FOUND', error: '个人记忆里没有找到这条偏好或随记，没有改动。' };
        }
        if (matches.length > 1) {
          const candidates = matches.slice(0, 5).map(m => m.summary);
          return {
            ok: false,
            code: 'AMBIGUOUS',
            candidates,
            error: `匹配到多条个人记忆，请说明要忘掉哪一条：${candidates.join(' / ')}`,
          };
        }

        const picked = matches[0];
        const prev = cloneRow(current);
        const nowIso = nowDate().toISOString();
        const nextTraits = picked.kind === 'trait'
          ? current.traits.filter(item => item.id !== picked.item.id)
          : current.traits;
        const nextNotes = picked.kind === 'note'
          ? current.notes.filter(item => item.id !== picked.item.id)
          : current.notes;
        const saved = await commit({
          id: 'profile',
          revision: current.revision + 1,
          traits: nextTraits,
          notes: nextNotes,
          updatedAt: nowIso,
        });
        const undoToken = issueUndo(prev, saved, `恢复已忘掉的个人记忆「${picked.summary}」`);
        return {
          ok: true,
          removedKind: picked.kind,
          removedId: picked.item.id,
          removedSummary: picked.summary,
          profile: publicView(saved),
          undoToken,
          text: `已从个人记忆忘掉：${picked.summary}（2 分钟内可说“撤回刚才忘掉的”恢复）`,
        };
      });
    },

    memoryItems(profile = publicView(cached), sources = []) {
      const overrides = new Map(cached.memoryOverrides?.map(item => [item.id, item]));
      const items = new Map(profileMemoryItems(profile, nowDate()).map(item => [item.id, item]));
      for (const item of sources) {
        const override = overrides.get(item.id);
        if (!items.has(item.id) && !override?.removed) {
          items.set(item.id, {...item, active: override?.active ?? item.active});
        }
      }
      return [...items.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },

    async mutateMemoryItem(input = {}, {readSourceItems} = {}) {
      if (isClosed()) return {ok: false, code: 'CLOSED', error: '个人记忆服务已关闭，没有修改。'};
      if (input.id === undefined && input.remove !== true) {
        return profileApi.addNote({...input, source: 'desktop'});
      }
      const id = typeof input.id === 'string' && input.id.length <= 64 ? input.id : '';
      if (!id) return {ok: false, code: 'INVALID_MEMORY_ID', error: '缺少有效的记忆标识。'};

      return enqueue(async () => {
        const current = await ensureLoaded();
        const next = cloneRow(current);
        const nowIso = nowDate().toISOString();
        const key = next.traits.some(item => item.id === id) ? 'traits' : 'notes';
        const index = next[key].findIndex(item => item.id === id);
        const removing = input.remove === true;
        if (index >= 0) {
          const row = next[key][index];
          if (removing) next[key].splice(index, 1);
          else {
            if (typeof input.text === 'string') {
              if (key === 'traits') {
                const prefix = `${row.label}：`;
                const value = input.text.startsWith(prefix) ? input.text.slice(prefix.length) : input.text;
                row.value = cleanText(value, 120);
              } else row.text = cleanText(input.text, 500, {allowNewlines: true});
            }
            const categories = key === 'traits' ? PERSONAL_TRAIT_CATEGORIES : PERSONAL_NOTE_CATEGORIES;
            if (categories.includes(input.category)) row.category = input.category;
            if (!(row.text ?? row.value)) return {ok: false, code: 'INVALID_MEMORY', error: '请输入要记住的话。'};
            applyMemoryMetadata(row, input);
            row.updatedAt = nowIso;
          }
        } else {
          const sources = await readSourceItems?.() ?? [];
          const source = sources.find(item => item.id === id);
          if (!source) return {ok: false, code: 'NOT_FOUND', error: '没有找到这条记忆。'};
          if (!removing && (typeof input.active !== 'boolean' || ['text', 'category', 'provenance', 'effect', 'sourceKind'].some(key => input[key] !== undefined))) {
            return {ok: false, code: 'SOURCE_READ_ONLY', error: '可以暂停、恢复或忘掉这条记忆。正文与出处请在原处修改。'};
          }
          const overrides = next.memoryOverrides ??= [];
          const at = overrides.findIndex(item => item.id === id);
          const old = overrides[at];
          if (!removing && old?.removed) return {ok: false, code: 'NOT_FOUND', error: '这条记忆已忘掉，可用撤回恢复。'};
          const active = removing ? (old?.active ?? source.active) : input.active;
          if (at < 0 && overrides.length >= MAX_SOURCE_OVERRIDES) {
            return {ok: false, code: 'MEMORY_LIMIT', error: '来源记忆的记录已达上限。'};
          }
          if (at >= 0) overrides.splice(at, 1);
          if (removing || active !== source.active) overrides.push({id, active, removed: removing});
        }
        if (isClosed()) return {ok: false, code: 'CLOSED', error: '个人记忆服务已关闭，没有修改。'};
        const saved = await commit({...next, revision: current.revision + 1, updatedAt: nowIso});
        const undoToken = issueUndo(current, saved, '已撤回记忆改动');
        return {ok: true, profile: publicView(saved), undoToken, text: removing ? '已忘掉这条记忆' : '已更新记忆'};
      });
    },

    guidanceSummary() {
      const row = cached;
      if (!row || (!row.traits.length && !row.notes.length)) return '';
      const traits = row.traits.filter(item => item.active !== false);
      const notes = row.notes.filter(item => item.active !== false);
      const stripSnake = str => String(str ?? '').replace(/\b[a-z]+_[a-z_]+\b/g, token => token.replace(/_/g, ' '));
      const parts = [];
      if (traits.length) {
        const list = traits
          .slice(0, 8)
          .map(item => `${stripSnake(item.label)}：${stripSnake(item.value)}`)
          .join('；');
        parts.push(`用户已确认的偏好：${list}`);
      }
      if (notes.length) {
        const list = notes
          .slice(0, 5)
          .map(item => stripSnake(item.text.replace(/\s+/g, ' ')).slice(0, 120))
          .join('；');
        parts.push(`近期顺口记下的背景：${list}`);
      }
      return parts.length ? `关于用户的个人记忆（用户可在「记忆」页随时修改或忘掉）：${parts.join('。')}。`.slice(0, 800) : '';
    },
  };
  return profileApi;
}
