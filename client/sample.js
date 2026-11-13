/** Clearly marked first-run sample. It never comes from the host and never
 *  writes to the ledger; clearing it only hides this local example. */
export const sampleActivity = () => {
  const at = hours => new Date(Date.now() - hours * 3600_000).toISOString();
  const due = hours => new Date(Date.now() + hours * 3600_000).toISOString();
  return {
    revision: 1,
    reachable: true,
    sample: true,
    counts: {done: 2, wait: 1, stuck: 1, run: 2, total: 6},
    sessions: [
      {projectId: 'project_000000000000000000000001', state: 'needs_you', title: '要不要把首屏截成浅色那张？', what: '两张都截好了，浅色那张在深色下也不糊。', short: '等你选截图', at: at(1), startedAt: at(3)},
      {projectId: 'project_000000000000000000000002', state: 'stuck', title: '回归跑不过：登录后的跳转断言', what: '断言写死了旧路径。我没有自己改断言，停下来等你。', short: '卡住了', at: at(2), startedAt: at(4)},
      {projectId: 'project_000000000000000000000003', state: 'doing', title: '第 28 篇旧稿的引用', what: '正在补原文链接。', short: '正在做', at: at(0), startedAt: at(1)},
      {projectId: 'project_000000000000000000000004', state: 'doing', title: '安装包 0.35.2 的说明', what: '正在核对升级说明。', short: '正在做', at: at(0), startedAt: at(1)},
      {projectId: 'project_000000000000000000000005', state: 'done', title: '第 37 个问题', what: '修完了，回归全过。', short: '做完了', at: at(1), startedAt: at(3)},
      {projectId: 'project_000000000000000000000005', state: 'done', title: '旧卡的归档说明', what: '归档说明写好了。', short: '做完了', at: at(2), startedAt: at(4)},
    ],
    projects: [
      {id: 'project_000000000000000000000001', name: '产品站', slot: 0},
      {id: 'project_000000000000000000000002', name: 'Finder', slot: 1},
      {id: 'project_000000000000000000000003', name: '写作', slot: 2},
      {id: 'project_000000000000000000000004', name: 'Dot', slot: 3},
      {id: 'project_000000000000000000000005', name: '任务看板', slot: 4},
    ],
    promises: [
      {id: 'sample-promise-1', when: due(5), whenText: '今天 18:00', what: '把试读说明改成读者能看懂的话', from: '滴答清单', linkProjectId: 'project_000000000000000000000001'},
      {id: 'sample-promise-2', when: due(20), whenText: '明天 10:00', what: '和编辑确认第 28 篇的引用格式', from: 'Google 日历'},
    ],
    sources: [{id: 'dida', state: 'ok'}, {id: 'calendar', state: 'ok'}],
    connection: {wechat: 'bound'},
  };
};

/** Local-only preference. It never calls the host and never touches tasks,
 * drafts or a bridge binding. */
export const markSampleCleared = storage => {
  try { storage?.setItem?.('dot.sample.cleared', '1'); return true; } catch { return false; }
};
