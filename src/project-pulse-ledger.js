import {z} from 'zod';
import {createHash} from 'node:crypto';

/** 项目变化账本：记住每个项目上次被看到时的样子，下次只报增量。
 *
 *  只存指纹级信息（提交短哈希、分支、未提交改动条数），不存文件内容、不存路径以外
 *  的私人资料；读取失败时保留旧记录，不把"没读到"记成"没有变化"。
 */
const identity = z.string().min(1).max(200);
const timestamp = z.string().max(40);
const entrySchema = z.object({
  id: identity, root: z.string().min(1).max(4096), label: z.string().max(120),
  head: z.string().max(64).nullable(), branch: z.string().max(120).nullable(),
  dirty: z.number().int().min(0).max(100000), at: timestamp,
}).strict();
export const pulseLedgerRowSchema = z.object({
  id: z.literal('profile'), version: z.literal(1),
  projects: z.array(entrySchema).max(200),
}).strict();

const key = root => createHash('sha256').update(String(root)).digest('hex').slice(0, 32);
const fresh = () => ({id: 'profile', version: 1, projects: []});

const snapshot = (root, label, pulse) => ({
  id: key(root), root, label: String(label ?? '').slice(0, 120),
  head: pulse?.head ?? null, branch: pulse?.branch ?? null,
  dirty: pulse?.dirty?.total ?? 0, at: pulse?.at ?? new Date(0).toISOString(),
});

function delta(previous, current, pulse) {
  if (!previous) return null;
  const changes = [];
  if (previous.head !== current.head) {
    const lines = (pulse?.commits ?? []).slice(0, 3).map(row => `${row.short} ${row.subject}`).join('；');
    changes.push(`HEAD ${previous.head ?? '未知'} → ${current.head ?? '未知'}${lines ? `（${lines}）` : ''}`);
  }
  if (previous.branch !== current.branch) changes.push(`分支 ${previous.branch ?? '未知'} → ${current.branch ?? '未知'}`);
  if (previous.dirty !== current.dirty) {
    const diff = current.dirty - previous.dirty;
    changes.push(`未提交改动 ${previous.dirty} → ${current.dirty}${diff > 0 ? `（+${diff}）` : `（${diff}）`}`);
  }
  return changes.length ? changes : null;
}

/**
 * @param {object} options
 * @param {{get:Function,put:Function}} options.store 存储单元
 * @param {() => Date} [options.clock]
 */
export function createProjectPulseLedger({store, clock = () => new Date()} = {}) {
  if (typeof store?.get !== 'function' || typeof store?.put !== 'function') throw new Error('Pulse ledger requires a persistent store');
  let state;

  async function load() {
    if (state) return state;
    const stored = await store.get('profile');
    state = stored ? pulseLedgerRowSchema.parse(stored) : fresh();
    return state;
  }

  /** 对比并记账；返回自上次以来真正变了的项目。读取失败的项目保留旧记录。 */
  async function observe({root, label, pulse}) {
    const current = await load();
    const next = snapshot(root, label, pulse);
    const previous = current.projects.find(row => row.id === next.id) ?? null;
    // 读不到就不记账：旧记录保留，"没读到"不能被记成"没有变化"。
    if (pulse?.repo !== true) return {changed: false, changes: null, firstSeen: previous === null, skipped: true};
    const changes = delta(previous, next, pulse);
    current.projects = [...current.projects.filter(row => row.id !== next.id), next].slice(-200);
    await store.put('profile', pulseLedgerRowSchema.parse(current));
    return {changed: Boolean(changes), changes, firstSeen: previous === null};
  }

  async function status() {
    const current = await load();
    return {
      version: 1,
      projects: current.projects.map(row => ({label: row.label, head: row.head, branch: row.branch, dirty: row.dirty, at: row.at})),
      text: current.projects.length ? `已记录 ${current.projects.length} 个项目的最近状态；下次只报增量。` : '还没有记录任何项目的变化；看一次进度后才会开始记。',
    };
  }

  return {ready: load, observe, status};
}
