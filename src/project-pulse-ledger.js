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
const policySchema = z.object({
  sessionId: identity,
  bindingKey: z.string().regex(/^[a-f0-9]{64}$/),
  projects: z.array(z.object({root: z.string().min(1).max(4096), label: z.string().max(120)}).strict()).min(1).max(50),
  intervalMinutes: z.number().int().min(5).max(1440),
  createdAt: timestamp, lastCheckAt: timestamp, lastNotifiedAt: timestamp.nullable(),
}).strict();
export const pulseLedgerRowSchema = z.object({
  id: z.literal('profile'), version: z.literal(1),
  projects: z.array(entrySchema).max(200),
  policy: policySchema.nullable().optional(),
}).strict();

const key = root => createHash('sha256').update(String(root)).digest('hex').slice(0, 32);
const fresh = () => ({id: 'profile', version: 1, projects: [], policy: null});

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

  let queue = Promise.resolve();
  const serial = work => { const run = queue.then(work, work); queue = run.catch(() => {}); return run; };

  async function load() {
    if (state) return state;
    const stored = await store.get('profile');
    state = stored ? pulseLedgerRowSchema.parse(stored) : fresh();
    return state;
  }

  const observe = args => serial(() => observeInner(args));

  /** 对比并记账；返回自上次以来真正变了的项目。读取失败的项目保留旧记录。 */
  async function observeInner({root, label, pulse}) {
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
    const policy = current.policy;
    return {
      version: 1,
      projects: current.projects.map(row => ({label: row.label, head: row.head, branch: row.branch, dirty: row.dirty, at: row.at})),
      watch: policy ? {intervalMinutes: policy.intervalMinutes, count: policy.projects.length, lastCheckAt: policy.lastCheckAt} : null,
      text: policy
        ? `正在盯 ${policy.projects.length} 个项目，每 ${policy.intervalMinutes} 分钟看一次；只有真的变了才发消息。`
        : current.projects.length
          ? `已记录 ${current.projects.length} 个项目的最近状态；还没有开启主动提醒。`
          : '还没有记录任何项目的变化；看一次进度后才会开始记。',
    };
  }

  /** 开启主动提醒：明确绑定到一个会话与绑定，换绑即失效，不自动迁移。 */
  async function enable({sessionId, bindingKey, projects, intervalMinutes = 30, capture}) {
    if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 200) throw new Error('Pulse watch requires a session');
    if (!/^[a-f0-9]{64}$/.test(String(bindingKey))) throw new Error('Pulse watch requires a current binding');
    if (!Array.isArray(projects) || !projects.length || projects.length > 50) throw new Error('Pulse watch requires 1-50 projects');
    const at = clock().toISOString();
    const current = await load();
    current.policy = {
      sessionId, bindingKey,
      projects: projects.map(row => ({root: row.root, label: String(row.label ?? '').slice(0, 120)})),
      intervalMinutes, createdAt: at, lastCheckAt: at, lastNotifiedAt: null,
    };
    await store.put('profile', pulseLedgerRowSchema.parse(current));
    // 立刻记一次基线：否则第一次到点检查只能记账，要再等一个间隔才能发现变化。
    if (typeof capture === 'function') {
      for (const project of current.policy.projects) {
        let pulse; try { pulse = await capture(project.root); } catch { continue; }
        if (pulse?.repo !== true) continue;
        try { await observeInner({root: project.root, label: project.label, pulse}); } catch {}
      }
    }
    return status();
  }

  async function disable() {
    const current = await load();
    current.policy = null;
    await store.put('profile', pulseLedgerRowSchema.parse(current));
    return status();
  }

  const needsTimer = () => Boolean(state?.policy);

  /** 到点检查一次；只把真正变了的项目交给 notify，没有变化完全不打扰。 */
  async function tickInner({capture, notify, now = clock()} = {}) {
    if (typeof capture !== 'function' || typeof notify !== 'function') throw new Error('Pulse tick requires capture and notify');
    const current = await load();
    const policy = current.policy;
    if (!policy) return {checked: 0, changed: 0};
    if (now.getTime() - Date.parse(policy.lastCheckAt) < policy.intervalMinutes * 60000) return {checked: 0, changed: 0};
    const changed = [];
    for (const project of policy.projects) {
      let pulse;
      try { pulse = await capture(project.root); } catch { continue; }
      if (pulse?.repo !== true) continue;
      const observed = await observeInner({root: project.root, label: project.label, pulse});
      if (observed.changes?.length) changed.push({label: project.label, changes: observed.changes});
    }
    policy.lastCheckAt = now.toISOString();
    if (changed.length) {
      const result = await notify({sessionId: policy.sessionId, bindingKey: policy.bindingKey, text: compose(changed), requestId: `pulse-${now.getTime()}`});
      if (['reported_sent', 'queued'].includes(result?.status)) policy.lastNotifiedAt = now.toISOString();
    }
    await store.put('profile', pulseLedgerRowSchema.parse(current));
    return {checked: policy.projects.length, changed: changed.length, delivered: changed.length > 0};
  }

  return {ready: load, observe, status, enable, disable, needsTimer, tick: args => serial(() => tickInner(args))};
}

/** 推给本人的那段话：先说变了什么，再给一条能立刻做的下一步。 */
export function compose(changes) {
  const lines = changes.slice(0, 6).map(row => `· ${row.label}：${row.changes.join('；')}`);
  const more = changes.length > 6 ? `\n另有 ${changes.length - 6} 个项目也有变化，下次看进度时一起给。` : '';
  return `项目有变化\n${lines.join('\n')}${more}\n\n建议：先看这几个项目最近的提交和未提交改动，决定是继续推进还是先收尾。这是本机 git 的变化，不代表任务已完成。`;
}
