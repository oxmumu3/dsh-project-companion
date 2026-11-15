import { randomUUID } from 'node:crypto';
import { z } from 'zod';

export const PERSONAL_TRAIT_CATEGORIES = ['rhythm', 'tone', 'focus', 'custom'];
export const PERSONAL_NOTE_CATEGORIES = ['note', 'travel', 'preference', 'context', 'habit', 'schedule', 'idea'];
export const PERSONAL_NOTE_SOURCES = ['desktop', 'wechat', 'agent'];

const UNDO_TTL_MS = 120_000;
const MAX_UNDO_TOKENS = 30;

export const personalTraitSchema = z.object({
  id: z.string().min(1).max(64),
  category: z.enum(PERSONAL_TRAIT_CATEGORIES),
  label: z.string().min(1).max(40),
  value: z.string().min(1).max(120),
  updatedAt: z.string().min(1).max(64),
}).strict();

export const personalNoteSchema = z.object({
  id: z.string().min(1).max(64),
  text: z.string().min(1).max(500),
  category: z.enum(PERSONAL_NOTE_CATEGORIES),
  source: z.enum(PERSONAL_NOTE_SOURCES),
  createdAt: z.string().min(1).max(64),
  updatedAt: z.string().min(1).max(64),
}).strict();

export const personalProfileRowSchema = z.object({
  id: z.literal('profile'),
  revision: z.number().int().min(0),
  traits: z.array(personalTraitSchema).max(24),
  notes: z.array(personalNoteSchema).max(60),
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
  return stripped.trim().slice(0, maxLen);
}

function cloneRow(row) {
  return {
    id: 'profile',
    revision: row.revision,
    traits: row.traits.map(item => ({ ...item })),
    notes: row.notes.map(item => ({ ...item })),
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

  const issueUndo = (previous, summary) => {
    const nowMs = nowDate().getTime();
    pruneUndo(nowMs);
    const token = `undo-${randomUUID().slice(0, 12)}`;
    undoTokens.set(token, {
      at: nowMs,
      summary,
      traits: previous.traits.map(item => ({ ...item })),
      notes: previous.notes.map(item => ({ ...item })),
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
    const parsed = personalProfileRowSchema.parse(nextRow);
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

  return {
    async ready() {
      return enqueue(async () => publicView(await ensureLoaded()));
    },

    async snapshot() {
      return enqueue(async () => publicView(await ensureLoaded()));
    },

    cachedSnapshot() {
      return publicView(cached);
    },

    async setTrait({ id, category = 'custom', label, value } = {}) {
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
        const trait = {
          id: idx >= 0 ? nextTraits[idx].id : cleanText(id, 64) || `trait-${randomUUID().slice(0, 8)}`,
          category: safeCategory,
          label: cleanLabel,
          value: cleanValue,
          updatedAt: nowIso,
        };
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
        const undoToken = issueUndo(prev, `恢复「${cleanLabel}」之前的设置`);
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
        const undoToken = issueUndo(prev, `恢复「${removed.label}」`);
        return { ok: true, removedId: removed.id, profile: publicView(saved), undoToken, text: `已忘记「${removed.label}」` };
      });
    },

    async addNote({ text, category = 'note', source = 'desktop' } = {}) {
      if (isClosed()) return { ok: false, code: 'CLOSED', error: '个人记忆服务已关闭，没有保存。' };
      return enqueue(async () => {
        const current = await ensureLoaded();
        const cleanBody = cleanText(text, 500, { allowNewlines: true });
        if (!cleanBody) return { ok: false, code: 'INVALID_NOTE', error: '请输入要记住的话。' };
        const safeCategory = PERSONAL_NOTE_CATEGORIES.includes(category) ? category : 'note';
        const safeSource = PERSONAL_NOTE_SOURCES.includes(source) ? source : 'desktop';
        const nowIso = nowDate().toISOString();
        const prev = cloneRow(current);
        const note = {
          id: `note-${randomUUID().slice(0, 8)}`,
          text: cleanBody,
          category: safeCategory,
          source: safeSource,
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        const nextNotes = [note, ...current.notes].slice(0, 60);
        const saved = await commit({
          id: 'profile',
          revision: current.revision + 1,
          traits: current.traits,
          notes: nextNotes,
          updatedAt: nowIso,
        });
        const undoToken = issueUndo(prev, '撤回刚才记下的这句话');
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
        const undoToken = issueUndo(prev, '恢复刚才忘掉的随记');
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
        undoTokens.delete(resolvedToken);
        if (lastUndoToken === resolvedToken) lastUndoToken = '';
        const current = await ensureLoaded();
        const nowIso = nowDate().toISOString();
        const saved = await commit({
          id: 'profile',
          revision: current.revision + 1,
          traits: entry.traits,
          notes: entry.notes,
          updatedAt: nowIso,
        });
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
        const undoToken = issueUndo(prev, `恢复已忘掉的个人记忆「${picked.summary}」`);
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

    guidanceSummary() {
      const row = cached;
      if (!row || (!row.traits.length && !row.notes.length)) return '';
      const stripSnake = str => String(str ?? '').replace(/\b[a-z]+_[a-z_]+\b/g, token => token.replace(/_/g, ' '));
      const parts = [];
      if (row.traits.length) {
        const list = row.traits
          .slice(0, 8)
          .map(item => `${stripSnake(item.label)}：${stripSnake(item.value)}`)
          .join('；');
        parts.push(`用户已确认的偏好：${list}`);
      }
      if (row.notes.length) {
        const list = row.notes
          .slice(0, 5)
          .map(item => stripSnake(item.text.replace(/\s+/g, ' ')).slice(0, 120))
          .join('；');
        parts.push(`近期顺口记下的背景：${list}`);
      }
      return `关于用户的个人记忆（用户可在「记忆」页随时修改或忘掉）：${parts.join('。')}。`.slice(0, 800);
    },
  };
}
