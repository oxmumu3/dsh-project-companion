/** Two composite entries over the project tool's long legacy action list.
 *
 *  The model picks between `look` and `manage` (plus the safety-critical
 *  standalone actions it already had); this module translates the chosen
 *  view/op back into the exact legacy action so every existing handler,
 *  guard and test keeps working unchanged. Old action names stay valid.
 */
export const LOOK_VIEWS = ['progress', 'change', 'status', 'health', 'task', 'once', 'followup'];
export const MANAGE_OPS = ['watch', 'unwatch', 'memory', 'remember', 'correct_memory', 'forget_memory', 'pause', 'resume', 'daily', 'cancel_daily', 'followup', 'cancel_followup'];

const LOOK = {
  progress: a => ({ action: 'digest', project: a.project, ...(a.detail ? { detail: a.detail } : {}) }),
  change: a => ({ action: 'project_update', project: a.project, userRequested: a.userRequested === true }),
  status: () => ({ action: 'status' }),
  health: () => ({ action: 'doctor' }),
  task: a => ({ action: 'task_status', ...(a.id ? { id: a.id } : {}) }),
  once: a => ({ action: 'once_status', ...(a.project ? { project: a.project } : {}) }),
  followup: a => ({ action: 'followup_status', ...(a.project ? { project: a.project } : {}) }),
};

const MANAGE = {
  watch: a => ({ action: 'watch', ...(a.project ? { project: a.project } : {}) }),
  unwatch: a => ({ action: 'unwatch', ...(a.project ? { project: a.project } : {}) }),
  memory: a => ({ action: 'memory', project: a.project }),
  remember: a => ({ action: 'remember', project: a.project, memoryKind: a.memoryKind, memoryText: a.memoryText, sourceKind: a.sourceKind, ...(a.sourceReference ? { sourceReference: a.sourceReference } : {}), userRequested: a.userRequested === true }),
  correct_memory: a => ({ action: 'correct_memory', project: a.project, memoryId: a.memoryId, memoryText: a.memoryText, userRequested: a.userRequested === true }),
  forget_memory: a => ({ action: 'forget_memory', project: a.project, memoryId: a.memoryId, userRequested: a.userRequested === true }),
  pause: () => ({ action: 'pause' }),
  resume: () => ({ action: 'resume' }),
  daily: a => ({ action: 'configure_daily', time: a.time, ...(a.timeZone ? { timeZone: a.timeZone } : {}), ...(a.project ? { project: a.project } : {}) }),
  cancel_daily: () => ({ action: 'cancel_daily' }),
  followup: a => ({ action: 'configure_followup', everyMinutes: a.everyMinutes, ...(a.project ? { project: a.project } : {}) }),
  cancel_followup: a => ({ action: 'cancel_followup', ...(a.project ? { project: a.project } : {}) }),
};

/** Pure translation. Unknown view/op or a missing discriminator throws, so a
 *  malformed call fails loudly instead of silently doing something else. */
export function normalizeSurfaceAction(args) {
  if (!args || typeof args !== 'object') return args;
  if (args.action === 'look') {
    const view = args.view;
    if (!Object.hasOwn(LOOK, view)) throw Error(`look 需要 view，可选：${LOOK_VIEWS.join('、')}`);
    return LOOK[view](args);
  }
  if (args.action === 'manage') {
    const op = args.op;
    if (!Object.hasOwn(MANAGE, op)) throw Error(`manage 需要 op，可选：${MANAGE_OPS.join('、')}`);
    return MANAGE[op](args);
  }
  return args;
}

/** What each composite view/op means, for the tool description and reports. */
export const SURFACE_COPY = {
  look: 'progress=进展与卡点｜change=相比上次的变化（需本人明确问了才传 userRequested:true）｜status=助理总状态｜health=本机自检（doctor）｜task=交办到哪了｜once=一次检查的状态｜followup=周期跟进的状态',
  manage: 'watch=关注项目｜unwatch=取消关注｜memory=读项目记忆｜remember=记一条｜correct_memory=改一条｜forget_memory=忘一条｜pause=暂停自动跟进｜resume=恢复｜daily=每日汇报时间｜cancel_daily=取消日报｜followup=设置周期跟进（要分钟数）｜cancel_followup=取消周期跟进',
};
