import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

/** 项目脉搏：只读的判断"这个项目最近发生了什么"。
 *
 *  只跑本机 git 读取命令（不联网、不写索引、不加锁），把结果压成一段可进上下文的
 *  中文摘要。不是 git 仓库、命令超时或失败时返回明确的不可用状态，不猜、不伪造进度。
 */
const runFile = promisify(execFile);
const GIT_ENV = {LC_ALL: 'C', GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0'};
const MAX_COMMITS = 5;
const MAX_DIRTY_LINES = 200;
const MAX_SUBJECT = 120;
const MAX_BRANCH = 120;
const TIMEOUT_MS = 4000;
const SUMMARY_MAX = 700;

const clean = (value, max) => String(value ?? '')
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, max);

async function defaultRun(args, {timeout = TIMEOUT_MS} = {}) {
  const {stdout} = await runFile('git', args, {
    encoding: 'utf8', maxBuffer: 65536, timeout, env: {...process.env, ...GIT_ENV},
  });
  return stdout;
}

/**
 * @param {object} options
 * @param {(args: string[], options?: object) => Promise<string>} [options.run] 已带 `git -C <root>` 前缀的命令执行器，测试可注入
 * @param {() => Date} [options.clock]
 */
export function createProjectPulse({run = defaultRun, clock = () => new Date()} = {}) {
  if (typeof run !== 'function' || typeof clock !== 'function') throw new Error('Project pulse requires git runner and clock');

  async function capture(root) {
    if (typeof root !== 'string' || !root.trim() || root.length > 4096) throw new Error('Project pulse requires a project root');
    const at = clock().toISOString();
    const git = (...args) => run(['-C', root, ...args]);

    let inside;
    try {
      inside = (await git('rev-parse', '--is-inside-work-tree')).trim();
    } catch {
      return {at, repo: false, reason: 'not_a_repository'};
    }
    if (inside !== 'true') return {at, repo: false, reason: 'not_a_repository'};

    const read = async (promise) => {
      try { return {ok: true, value: await promise}; } catch { return {ok: false}; }
    };

    const [branch, head, log, status] = await Promise.all([
      read(git('symbolic-ref', '--short', 'HEAD')),
      read(git('rev-parse', '--short', 'HEAD')),
      read(git('log', `-${MAX_COMMITS}`, '--date=short', '--pretty=format:%h%x1f%ad%x1f%s')),
      read(git('status', '--porcelain')),
    ]);

    const commits = log.ok
      ? log.value.split('\n').filter(Boolean).slice(0, MAX_COMMITS).map(line => {
        const [short, date, subject] = line.split('\x1f');
        return {short: clean(short, 16), date: clean(date, 24), subject: clean(subject, MAX_SUBJECT)};
      }).filter(row => row.short)
      : [];

    let dirty = null;
    if (status.ok) {
      const lines = status.value.split('\n').filter(Boolean);
      const truncated = lines.length > MAX_DIRTY_LINES;
      const visible = lines.slice(0, MAX_DIRTY_LINES);
      dirty = {
        total: lines.length,
        modified: visible.filter(line => !line.startsWith('??')).length,
        untracked: visible.filter(line => line.startsWith('??')).length,
        truncated,
      };
    }

    return {
      at,
      repo: true,
      branch: branch.ok && branch.value.trim() ? clean(branch.value, MAX_BRANCH) : null,
      head: head.ok ? clean(head.value, 40) : null,
      commits,
      dirty,
      unavailable: [...(branch.ok ? [] : ['branch']), ...(head.ok ? [] : ['head']), ...(log.ok ? [] : ['commits']), ...(status.ok ? [] : ['status'])],
    };
  }

  return {capture, summarize};
}

/** 把脉搏压成给模型看的一小段；没有可说的就返回空串，不凑字数。 */
export function summarize(pulse) {
  if (!pulse || pulse.repo !== true) return '';
  const parts = [];
  if (pulse.branch) parts.push(`分支 ${pulse.branch}`);
  if (pulse.commits?.length) {
    parts.push(`最近 ${pulse.commits.length} 次提交：${pulse.commits.map(row => `${row.short} ${row.subject}`).join('；')}`);
  }
  if (pulse.dirty) {
    parts.push(pulse.dirty.total ? `未提交改动 ${pulse.dirty.total} 个文件（修改 ${pulse.dirty.modified}、未跟踪 ${pulse.dirty.untracked}${pulse.dirty.truncated ? '，超过上限已截断' : ''}）` : '工作区没有未提交改动');
  }
  if (pulse.unavailable?.length) parts.push(`未能读取：${pulse.unavailable.join('、')}`);
  return parts.length ? clean(parts.join('；'), SUMMARY_MAX) : '';
}
