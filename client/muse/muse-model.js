/**
 * Pure presentation model for the DSH Dot Muse desktop views.
 * Reuses `buildToday` / `atText` from `../today-model.js` to prevent
 * divergence in session/promise semantics, and layers on Calendar timeline,
 * Daily Digest rhythm, Personal Profile memory, and Standalone/Synergy views.
 */
import {atText, buildToday} from '../today-model.js';

const clean = value => typeof value === 'string'
  ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  : '';

const SESSION_STATUS = {
  wait: {rank: 0, label: '待你拍板'},
  run: {rank: 1, label: '推进中'},
  done: {rank: 2, label: '成稿就绪'},
  quiet: {rank: 3, label: '跟进中'},
};
const STATE_STATUS = {needs_you: 'wait', stuck: 'wait', doing: 'run', done: 'done'};

function workspaceTitle(value) {
  return clean(clean(value).split(/[\\/]+/).filter(Boolean).at(-1)) || '个人事务';
}

function sessionModel(row, now) {
  const archived = row.archived === true || row.state === 'handled';
  const status = archived ? 'done' : Object.hasOwn(SESSION_STATUS, row.status) ? row.status
    : Object.hasOwn(STATE_STATUS, row.state) ? STATE_STATUS[row.state] : 'quiet';
  const statusLabel = archived ? '已办妥' : SESSION_STATUS[status].label;
  const checklist = Array.isArray(row.checklist) ? row.checklist.filter(Boolean) : [];
  let progressLabel = '';
  if (row.artifactKind === 'doc') {
    progressLabel = Number.isFinite(row.artifactWordCount) ? `完整成稿 · ${row.artifactWordCount} 字` : '完整成稿';
  } else if (checklist.length) {
    progressLabel = `${checklist.filter(item => item.checked === true).length}/${checklist.length} 步`;
  }
  const updatedAt = row.updatedAt ?? row.at ?? null;
  return {
    ...row,
    id: row.id || row.sessionId,
    title: clean(row.title) || '未命名会话',
    workspaceTitle: workspaceTitle(row.workspaceTitle || row.projectName || row.workspaceRoot),
    archived,
    status,
    statusLabel,
    progressLabel,
    whyHere: clean(row.whyHere || row.summary || row.what),
    updatedAt,
    relativeTime: clean(row.relativeTime) || atText(updatedAt, now),
  };
}

const byNewest = (a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0);

function sessionFocusCard(session) {
  return {
    key: `dossier:${session.id}`,
    kind: 'session',
    session,
    sourceLabel: `工作区 ${session.workspaceTitle}`,
    timeText: session.relativeTime,
    title: session.title,
    body: session.whyHere,
  };
}

const CONNECTOR_GROUPS = [
  {id: 'mac_base', title: '这台 Mac 与工作区底座', items: [
    {id: 'mac_bridge', title: 'Mac 守护桥', subtitle: '连接 iPhone 与此 Mac 的工作会话'},
    {id: 'workspace_grants', title: 'Mac 工作区目录读取范围', subtitle: '仅使用已授权工作区'},
  ]},
  {id: 'external_apps', title: '外部信息与效率应用', items: [
    {id: 'google_suite', title: 'Google 三件套（Gmail · 日历 · Drive）', subtitle: '邮件检索与草稿、日程和云端文档'},
    {id: 'flomo', title: 'flomo 浮墨笔记', subtitle: '按需查找笔记'},
    {id: 'dida', title: '滴答清单', subtitle: '查看待办与截止时间'},
    {id: 'wechat', title: '微信通知', subtitle: '接收早报与需要你拍板的提醒'},
  ]},
  {id: 'iphone_system', title: 'iPhone 随身端系统感知与配对状态', items: [
    {id: 'ios_eventkit', title: '系统日历与提醒事项'},
    {id: 'ios_health', title: 'Apple Health 睡眠与运动'},
    {id: 'ios_location', title: '地理位置感知'},
    {id: 'ios_focus', title: '专注模式联动'},
    {id: 'ios_voice_vision', title: '语音听写与相机扫描'},
  ]},
];

function greetingPrefix(now) {
  const hour = now.getHours();
  if (hour < 6) return '夜深了';
  if (hour < 11) return '早上好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

function eventTimeText(event) {
  if (!event || event.allDay) return '全天';
  const startMs = Date.parse(event.startAt ?? '');
  if (!Number.isFinite(startMs)) return '今天';
  const fmt = ms => new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(ms));
  const endMs = Date.parse(event.endAt ?? '');
  if (Number.isFinite(endMs) && endMs > startMs) return `${fmt(startMs)} – ${fmt(endMs)}`;
  return fmt(startMs);
}

const TRAIT_GROUP_META = {
  rhythm: {label: '作息与早报节律', hint: '什么时候推给你最不打扰'},
  tone: {label: '沟通语气与习惯', hint: '先给结论还是附带来源依据'},
  focus: {label: '近期重心', hint: '这阵子最想优先盯住的方向'},
  custom: {label: '其他偏好', hint: '你自己告诉 Dot 的顺手规矩'},
};

export const TRAIT_PRESETS = [
  {category: 'rhythm', label: '读报时间', value: '早上 09:00 前先看简短重点'},
  {category: 'tone', label: '汇报方式', value: '先给结论与建议动作，再附关键依据'},
  {category: 'focus', label: '推进节奏', value: '没有卡点就不打扰，只提醒需要拍板的事'},
];

export const SOURCE_META = {
  gmail: {name: 'Gmail 邮件', desc: '只读梳理重要来信与待你回复的承诺'},
  calendar: {name: 'Google 日历', desc: '读取主日历近期日程，只读展示不改动事件'},
  dida: {name: '滴答清单', desc: '读取未完成任务与截止时间'},
  flomo: {name: 'flomo 笔记', desc: '找回日常记下的想法与项目背景'},
  drive: {name: 'Google Drive', desc: '按标题查找关联文档作为背景'},
  docs: {name: 'Google 文档 / 表格 / 幻灯片', desc: '按明确范围读取协作文档内容'},
};

/**
 * Derive complete view model for all 4 Muse tabs from current live snapshots.
 */
export function buildMuseViewModel({
  activity = null,
  muse = null,
  workbench = null,
  contextSnapshot = null,
  now = new Date(),
  loading = false,
  pinnedKey = null,
} = {}) {
  const safeNow = now instanceof Date && Number.isFinite(now.getTime()) ? now : new Date();
  const today = buildToday(activity, {
    now: safeNow,
    sample: activity?.sample === true,
    loading,
  });
  const wireSessions = [muse?.dossiers, activity?.dossiers, muse?.carouselCards, activity?.carouselCards]
    .find(Array.isArray);
  const v10 = Boolean(wireSessions);
  const sessions = (wireSessions ?? [])
    .filter(row => row?.id || row?.sessionId)
    .map(row => sessionModel(row, safeNow));
  const carouselCards = sessions.filter(row => !row.archived)
    .sort((a, b) => SESSION_STATUS[a.status].rank - SESSION_STATUS[b.status].rank || byNewest(a, b));
  const archivedSessions = sessions.filter(row => row.archived).sort(byNewest);
  const groupedSessions = new Map();
  for (const session of carouselCards) {
    if (!groupedSessions.has(session.workspaceTitle)) groupedSessions.set(session.workspaceTitle, []);
    groupedSessions.get(session.workspaceTitle).push(session);
  }
  const sessionGroups = Array.from(groupedSessions, ([workspaceTitle, items]) => ({workspaceTitle, items}));

  const superagentRaw = activity?.superagent ?? muse?.superagent ?? null;
  const mode = superagentRaw?.mode === 'synergy' ? 'synergy' : 'standalone';
  const milestones = Array.isArray(superagentRaw?.milestones) ? superagentRaw.milestones : [];
  const superagent = {
    mode,
    available: superagentRaw?.available === true,
    counts: superagentRaw?.counts ?? {inReview: 0, blocked: 0, inProgress: 0, todo: 0, pending: 0},
    milestones,
    lastQueued: superagentRaw?.lastQueued ?? null,
  };

  const profileRaw = muse?.profile ?? activity?.profile ?? null;
  const profile = {
    revision: profileRaw?.revision ?? 0,
    traits: Array.isArray(profileRaw?.traits) ? profileRaw.traits : [],
    notes: Array.isArray(profileRaw?.notes) ? profileRaw.notes : [],
    updatedAt: profileRaw?.updatedAt ?? null,
  };
  const memoryItems = [muse?.memoryItems, activity?.memoryItems, profileRaw?.memoryItems].find(Array.isArray);
  const routines = [muse?.routines, activity?.routines].find(Array.isArray) ?? [];

  const digestRaw = muse?.digest ?? activity?.digest ?? null;
  const digest = {
    enabled: digestRaw?.enabled !== false,
    dailyTime: digestRaw?.dailyTime ?? '09:00',
    timeZone: digestRaw?.timeZone ?? 'Asia/Shanghai',
    deliveryMode: digestRaw?.deliveryMode ?? 'wechat_and_desktop',
    maxDailyNudges: Number.isInteger(digestRaw?.maxDailyNudges) ? digestRaw.maxDailyNudges : 2,
    quietDate: digestRaw?.quietDate ?? null,
    isQuietToday: digestRaw?.isQuietToday === true,
    lastStatus: digestRaw?.lastStatus ?? null,
    lastDigestAt: digestRaw?.lastDigestAt ?? null,
    lastDigest: digestRaw?.lastDigest ?? null,
  };

  const workspaceBrief = activity?.workspaceBrief ?? muse?.workspaceBrief ?? null;
  const mobileRaw = muse?.mobile ?? activity?.mobile ?? null;
  const mobile = mobileRaw
    ? {
      available: mobileRaw.available !== false,
      paired: mobileRaw.paired === true,
      pairedCount: Number(mobileRaw.pairedCount || 0),
      deviceName: clean(mobileRaw.deviceName) || 'Mac',
      tunnelReady: mobileRaw.tunnelReady === true,
      bridgeActive: mobileRaw.bridgeActive === true,
      iphoneSystem: Array.isArray(mobileRaw.iphoneSystem) ? mobileRaw.iphoneSystem : [],
      lanUrl: clean(mobileRaw.lanUrl) || null,
      lastPairedAt: mobileRaw.lastPairedAt || null,
    }
    : null;
  const promiseDrafts = (activity?.promiseDrafts && typeof activity.promiseDrafts === 'object') ? activity.promiseDrafts : {};

  const events = (Array.isArray(activity?.events) ? activity.events : []).map(ev => ({
    id: String(ev.id || `${ev.startAt ?? ''}-${ev.title ?? ''}`),
    title: clean(ev.title) || '日程',
    timeText: eventTimeText(ev),
    location: clean(ev.location),
    startAt: ev.startAt ?? null,
    allDay: ev.allDay === true,
  }));

  // Keep the desktop focus card and rank active sessions in its candidate list.
  const candidates = carouselCards.map(sessionFocusCard);
  for (const item of v10 ? [] : today.urgent) {
    const key = `session:${item.projectId}:${item.cardId ?? item.state}`;
    const hasDistinctSecond = Boolean(item.second && item.secondAct);
    candidates.push({
      key,
      kind: 'session',
      priority: item.state === 'stuck' ? 1 : 2,
      sourceLabel: `${item.projectName} · ${item.state === 'stuck' ? '卡住了' : '等你拍板'}`,
      timeText: item.at || '',
      title: item.title,
      body: item.what && item.what !== item.title ? item.what : '这件事正在等你的确认或下一步安排。',
      primaryLabel: item.primary,
      primaryAction: {type: 'today_act', act: item.primaryAct, projectId: item.projectId, cardId: item.cardId},
      secondaryLabel: hasDistinctSecond ? item.second : '稍后再说',
      secondaryAction: hasDistinctSecond
        ? {type: 'today_act', act: item.secondAct, projectId: item.projectId, cardId: item.cardId}
        : {type: 'today_act', act: 'snooze', projectId: item.projectId, cardId: item.cardId},
      laterAction: hasDistinctSecond
        ? {type: 'today_act', act: 'snooze', projectId: item.projectId, cardId: item.cardId}
        : null,
      handledAction: {type: 'today_act', act: 'handled', projectId: item.projectId, cardId: item.cardId},
      askPrompt: `帮我看一下「${item.projectName}」当前这项进展（${item.title}），给我建议怎么处理。`,
    });
  }

  if (mode === 'synergy') {
    for (const ms of milestones) {
      const key = `milestone:${ms.id}`;
      candidates.push({
        key,
        kind: 'milestone',
        priority: ms.blocked ? 1 : 3,
        sourceLabel: `SuperAgent 协同 · ${ms.blocked ? '需要你解卡' : '待你验收'}`,
        timeText: ms.updatedAt ? atText(ms.updatedAt, safeNow) : '',
        title: ms.title,
        body: ms.summary || (ms.checklist ? `清单进度 ${ms.checklist.done}/${ms.checklist.total}，等待你的验收结论。` : '协同任务已提交成果，等待你的验收或下一句指示。'),
        primaryLabel: ms.blocked ? '跟它聊聊卡点' : '看验收情况并追问',
        primaryAction: {type: 'ask', prompt: `请对照「${ms.title}」的当前状态帮我核对关键验收点，我还需要注意什么？`},
        secondaryLabel: '去看板记一笔',
        secondaryAction: {type: 'queue_pending', text: `复核 SuperAgent 里程碑：${ms.title}`, title: ms.title},
        askPrompt: `帮我查看 SuperAgent 里程碑「${ms.title}」的状态并准备下一步。`,
      });
    }
  }

  for (const row of today.promises) {
    if (!row.dispatch) continue;
    const key = `promise:${row.id}`;
    const serverDraft = promiseDrafts[row.id];
    const draftSlip = clean(serverDraft?.text)
      ? serverDraft.text
      : `【拟办草稿】围绕「${row.what}」${row.whenText ? `（期限参考：${row.whenText}）` : ''}\n• 推进要点：先梳理相关背景与待确认事项，整理成可直接外发或执行的要点。\n• 表达口径：先给结论与时间节点，由你核对后再推进。`;
    candidates.push({
      key,
      kind: 'promise',
      priority: 4,
      sourceLabel: `${row.from || '来源待办'} · 答应过的事`,
      timeText: row.whenText || '',
      title: row.what,
      body: row.note || 'Dot 已顺手替你预拟好这版草稿，你可以直接按这版推进，或点开「改两句」微调。',
      draftSlip,
      draftKind: serverDraft?.kind || 'smart',
      promiseId: row.id,
      editableDraft: true,
      primaryLabel: '按这版草稿去办',
      primaryAction: {type: 'dispatch_promise', promiseId: row.id, what: row.what, draftText: draftSlip},
      secondaryLabel: '带去对话细聊',
      secondaryAction: {type: 'ask', prompt: `关于这件我答应过的事「${row.what}」，先参考这版草稿帮我润色或安排下一步：\n${draftSlip}`},
      askPrompt: `帮我完善「${row.what}」的回复草稿或推进计划。`,
    });
  }

  // Promote pinned candidate if user swapped a folded item to top.
  let focus = null;
  let folded = [];
  if (candidates.length > 0) {
    const pinnedIdx = pinnedKey ? candidates.findIndex(c => c.key === pinnedKey) : -1;
    const focusIdx = pinnedIdx >= 0 ? pinnedIdx : 0;
    focus = candidates[focusIdx];
    folded = candidates.filter((_, idx) => idx !== focusIdx);
  } else if (digest.lastDigest?.text) {
    focus = {
      key: 'digest:latest',
      kind: 'digest',
      sourceLabel: '今日简报 · 已经替你整理好',
      timeText: digest.lastDigestAt ? atText(digest.lastDigestAt, safeNow) : '',
      title: '今天的一眼重点简报已经备好',
      body: clean(digest.lastDigest.text).slice(0, 180),
      draftSlip: digest.lastDigest.text,
      primaryLabel: '展开完整早报',
      primaryAction: {type: 'open_brief'},
      secondaryLabel: '顺手追问一句',
      secondaryAction: {type: 'ask', prompt: '结合今天的早报重点，帮我安排最值得先做的 1 件事。'},
      askPrompt: '帮我梳理今天早报里的重点安排。',
    };
  } else if (Array.isArray(workspaceBrief?.workspaces) && workspaceBrief.workspaces.length > 0 && !today.sample) {
    focus = {
      key: 'first-aha',
      kind: 'first-aha',
      sourceLabel: `初见简报 · 已读懂 ${workspaceBrief.workspaceCount || workspaceBrief.workspaces.length} 个工作区`,
      timeText: workspaceBrief.generatedAt ? atText(workspaceBrief.generatedAt, safeNow) : '刚刚',
      title: workspaceBrief.title || `刚读懂你勾选的 ${workspaceBrief.workspaceCount || workspaceBrief.workspaces.length} 个工作区`,
      body: '不用配日历也能直接开工：Dot 已只读扫过这些目录的说明与近期进度摘要，随时可以帮你排今天先推哪件。',
      draftSlip: workspaceBrief.text,
      primaryLabel: '让 Dot 排今天优先级',
      primaryAction: {type: 'ask', prompt: '结合刚读懂的工作区初见简报，帮我排一下今天最值得先推进的 1–2 件事。'},
      secondaryLabel: '展开完整简报',
      secondaryAction: {type: 'open_brief'},
      laterLabel: '重新扫描',
      laterAction: {type: 'refresh_workspace_brief'},
      askPrompt: '结合已勾选的工作区摘要，帮我定今天先做什么。',
    };
  } else if (today.dots.length === 0 && today.state === 'empty') {
    focus = {
      key: 'first-use',
      kind: 'onboarding',
      sourceLabel: '初次见面 · 私人幕僚',
      timeText: '',
      title: '把常用工作区或日历接进来，明天一早你只用看这里',
      body: '没有装 SuperAgent 时，Dot 也能自己帮你盯着本地 DeepSeek 项目进度；如果接上了邮件、日历或滴答清单，今天答应过的事会自动收拢到右边栏。',
      primaryLabel: '去选关注的工作区',
      primaryAction: {type: 'open_workspace_picker'},
      secondaryLabel: '预览一份早报长什么样',
      secondaryAction: {type: 'open_brief'},
      askPrompt: '你好 Dot，先给我介绍一下怎么配合你开始今天的工作。',
    };
  } else {
    focus = {
      key: 'calm',
      kind: 'calm',
      sourceLabel: today.counts.run > 0 ? `${today.counts.run} 个会话在悄悄推进` : '手头清净',
      timeText: '',
      title: today.counts.done > 0
        ? `刚才有 ${today.counts.done} 件事做完了，随时可打开看看结果`
        : '暂时没有卡住或催着你拍板的事',
      body: digest.isQuietToday
        ? '你今天开启了「今早先别敲我」，Dot 保持安静；有需要随时在下方输入框说一句。'
        : '你可以顺口记下一句行程或偏好，或者打开右侧的工作区继续昨天做到一半的代码。',
      primaryLabel: '顺口记下一句话',
      primaryAction: {type: 'focus_capsule', prefill: '帮我记住：'},
      secondaryLabel: '预览今天的第一份早报',
      secondaryAction: {type: 'open_brief'},
      askPrompt: '帮我扫一眼今天所有已连接来源和工作区，有没有遗漏的事情？',
    };
  }

  // De-boxed workspace rows: synergy blends SuperAgent milestones; standalone shows local project abstracts.
  const projectSessionMap = new Map();
  for (const s of activity?.sessions ?? []) {
    if (!projectSessionMap.has(s.projectId)) projectSessionMap.set(s.projectId, s);
  }
  const workspaceRows = [];
  if (mode === 'synergy') {
    for (const ms of milestones.slice(0, 4)) {
      workspaceRows.push({
        key: `ms-${ms.id}`,
        kind: 'milestone',
        title: ms.title,
        statusText: ms.blocked ? '卡住了' : '待你验收',
        state: ms.blocked ? 'stuck' : 'done',
        summary: ms.summary || (ms.checklist ? `完成度 ${ms.checklist.done}/${ms.checklist.total}` : 'SuperAgent 里程碑等待验收'),
        askPrompt: `帮我看一下 SuperAgent 任务「${ms.title}」的具体进度与验收标准。`,
      });
    }
  }
  const briefWsById = new Map((Array.isArray(workspaceBrief?.workspaces) ? workspaceBrief.workspaces : []).map(ws => [ws.id, ws]));
  const seenDotIds = new Set();
  for (const dot of today.dots) {
    seenDotIds.add(dot.id);
    const latestSession = projectSessionMap.get(dot.id);
    const doneGroup = today.doneGroups.find(g => g.projectId === dot.id);
    const briefWs = briefWsById.get(dot.id);
    const stateLabel = {
      needs_you: '等你拍板',
      stuck: '卡住了',
      doing: '推进中',
      done: '刚完成',
      quiet: '近期无新动静',
      unknown: '等待读取',
    }[dot.state] ?? '在关注';
    workspaceRows.push({
      key: `ws-${dot.id}`,
      kind: 'workspace',
      projectId: dot.id,
      title: dot.name,
      statusText: dot.count > 1 ? `${stateLabel} · ${dot.count} 条动态` : stateLabel,
      state: dot.state,
      summary: clean(latestSession?.what || latestSession?.title || doneGroup?.latest?.what || briefWs?.latestProgress || briefWs?.summary) || '已授权由 Dot 跟踪该目录的本地会话动静',
      timeText: latestSession?.at ? atText(latestSession.at, safeNow) : '',
      askPrompt: `帮我总结一下工作区「${dot.name}」最近做到哪一步了。`,
    });
  }
  if (!today.sample && Array.isArray(workspaceBrief?.workspaces)) {
    for (const ws of workspaceBrief.workspaces) {
      if (!ws?.id || seenDotIds.has(ws.id)) continue;
      workspaceRows.push({
        key: `ws-${ws.id}`,
        kind: 'workspace',
        projectId: ws.id,
        title: ws.label,
        statusText: ws.statusText || '刚接入',
        state: 'quiet',
        summary: ws.latestProgress || ws.summary,
        timeText: workspaceBrief.generatedAt ? atText(workspaceBrief.generatedAt, safeNow) : '',
        askPrompt: `帮我看一下工作区「${ws.label}」最近在做什么，今天可以先推哪一步？`,
      });
    }
  }

  // Unified Threads stream (`脉络`)
  const threads = [];
  for (const u of today.urgent) {
    threads.push({
      id: `thr-u-${u.projectId}-${u.cardId ?? u.state}`,
      group: 'attention',
      source: u.projectName,
      badge: u.state === 'stuck' ? '阻塞卡点' : '等你决定',
      timeText: u.at || '刚才',
      title: u.title,
      body: u.what || '需要你给出结论或恢复执行。',
      askPrompt: `跟进「${u.projectName}」中的「${u.title}」。`,
    });
  }
  for (const ms of milestones) {
    threads.push({
      id: `thr-ms-${ms.id}`,
      group: 'attention',
      source: 'SuperAgent 看板',
      badge: ms.blocked ? '卡住了' : '待你验收',
      timeText: ms.updatedAt ? atText(ms.updatedAt, safeNow) : '协同状态',
      title: ms.title,
      body: ms.summary || '在 SuperAgent 台账中处于协同验收节点。',
      askPrompt: `讨论 SuperAgent 里程碑「${ms.title}」的验收细节。`,
    });
  }
  for (const row of today.promises) {
    threads.push({
      id: `thr-p-${row.id}`,
      group: 'attention',
      source: row.from || '来源待办',
      badge: row.handledBy ? '已有会话接手' : row.related ? `关联项目 · ${row.related.projectName}` : '待接手',
      timeText: row.whenText || '近期',
      title: row.what,
      body: row.note || '',
      askPrompt: `继续处理「${row.what}」。`,
    });
  }
  for (const ev of events) {
    threads.push({
      id: `thr-ev-${ev.id}`,
      group: 'workspace',
      source: 'Google 日历',
      badge: '日程安排',
      timeText: ev.timeText,
      title: ev.title,
      body: ev.location ? `地点：${ev.location}` : '主日历日程同步',
      askPrompt: `结合日程「${ev.title}（${ev.timeText}）」帮我做个准备清单。`,
    });
  }
  for (const ws of workspaceRows.filter(row => row.kind === 'workspace')) {
    threads.push({
      id: `thr-ws-${ws.projectId}`,
      group: 'workspace',
      source: '工作区进展',
      badge: ws.statusText,
      timeText: ws.timeText || '本地文件夹',
      title: ws.title,
      body: ws.summary,
      askPrompt: ws.askPrompt,
    });
  }
  for (const note of profile.notes) {
    threads.push({
      id: `thr-note-${note.id}`,
      group: 'memory',
      source: note.source === 'wechat' ? '微信随记' : '关于你 · 随记',
      badge: '顺口记下',
      timeText: atText(note.createdAt, safeNow) || '最近',
      title: note.text,
      body: '将在对话和整理早报时作为个人背景参考。',
      askPrompt: `结合我记下的这件事「${note.text}」，帮我看看今天有什么关联影响？`,
    });
  }

  // Group personal profile traits cleanly for Portrait Sheet
  const traitGroups = Object.entries(TRAIT_GROUP_META).map(([category, meta]) => ({
    category,
    label: meta.label,
    hint: meta.hint,
    items: profile.traits.filter(item => item.category === category),
  }));

  // Context sources status for Connections tab
  const ctxSources = Array.isArray(contextSnapshot?.sources) ? contextSnapshot.sources : [];
  const connectionSources = ['gmail', 'calendar', 'dida', 'flomo', 'drive', 'docs'].map(id => {
    const row = ctxSources.find(s => s?.id === id) ?? null;
    const readerRow = (activity?.sources ?? []).find(s => s?.id === id) ?? null;
    return {
      id,
      name: SOURCE_META[id]?.name ?? id,
      desc: SOURCE_META[id]?.desc ?? '',
      enabled: row?.enabled === true,
      ready: row?.ready === true || row?.authorized === true || readerRow?.state === 'ok',
      state: readerRow?.state ?? (row?.enabled ? 'ready' : 'off'),
    };
  });
  const wireConnectors = [muse?.connectors, activity?.connectors].find(Array.isArray);
  const workspaceList = [muse?.mountedWorkspaces, activity?.mountedWorkspaces, activity?.access?.workspaces].find(Array.isArray) ?? [];
  const mountedWorkspaces = Array.from(new Set(workspaceList
    .map(item => typeof item === 'string' ? item : item?.label || item?.title || item?.path)
    .filter(item => clean(item))
    .map(workspaceTitle)));
  const contextMode = muse?.contextMode ?? activity?.contextMode ?? wireConnectors?.find(row => row?.id === 'workspace_grants')?.contextMode;
  const wechatConnected = activity?.connection?.wechat === 'bound' || workbench?.connection?.state === 'bound';
  const legacyConnectorStates = {
    mac_bridge: {enabled: mobile?.bridgeActive === true, connected: mobile?.bridgeActive === true},
    workspace_grants: {enabled: mountedWorkspaces.length > 0},
    google_suite: {enabled: connectionSources.some(row => ['gmail', 'calendar', 'drive', 'docs'].includes(row.id) && row.enabled)},
    flomo: {enabled: connectionSources.some(row => row.id === 'flomo' && row.enabled)},
    dida: {enabled: connectionSources.some(row => row.id === 'dida' && row.enabled)},
    wechat: {enabled: wechatConnected, connected: wechatConnected},
  };
  const connectorGroups = CONNECTOR_GROUPS.map(group => ({
    ...group,
    items: group.items.map(base => {
      const reported = group.id === 'iphone_system' && mobile?.paired
        ? mobile.iphoneSystem.find(row => row?.id === base.id && typeof row.enabled === 'boolean')
        : null;
      const wire = reported ?? wireConnectors?.find(row => row?.id === base.id);
      const defaults = wireConnectors ? null : legacyConnectorStates[base.id];
      return {...base, ...defaults, ...wire, group: group.id, known: Boolean(wire || defaults)};
    }),
  }));
  const connectorItems = connectorGroups.flatMap(group => group.items).filter(row => row.known);
  const connectorEnabledCount = connectorItems.filter(row => row.enabled === true).length;
  const connectorTotalCount = connectorItems.length;

  const dateText = new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(safeNow);

  const watchedCount = today.dots.length || (today.sample ? 0 : workspaceBrief?.workspaceCount || 0);
  const heroSubline = mode === 'synergy'
    ? `SuperAgent 协同中 · ${superagent.counts.inReview} 项待验收 / ${superagent.counts.inProgress} 项推进中${watchedCount ? ` · 关注 ${watchedCount} 个工作区` : ''}`
    : watchedCount
      ? `独立模式 · 已关注 ${watchedCount} 个本地工作区，不依赖 SuperAgent 也能汇总项目进展`
      : '独立模式 · 授权几个常用文件夹或连接日历后，Dot 会每天替你收拢要点';

  return {
    today,
    mode,
    superagent,
    profile,
    memoryItems,
    routines,
    traitGroups,
    digest,
    workspaceBrief,
    staleProjectMemories: Array.isArray(muse?.staleProjectMemories)
      ? muse.staleProjectMemories
      : Array.isArray(activity?.staleProjectMemories)
        ? activity.staleProjectMemories
        : [],
    mobile,
    events,
    focus,
    folded,
    v10,
    carouselCards,
    todayFocus: carouselCards[0] ?? null,
    sessionGroups,
    archivedSessions,
    workspaceRows,
    threads,
    connectionSources,
    connectorGroups,
    connectorEnabledCount,
    connectorTotalCount,
    contextMode,
    mountedWorkspaces,
    dateText,
    greeting: `${greetingPrefix(safeNow)}，${carouselCards.length > 0
      ? `有 ${carouselCards.length} 件在办`
      : !v10 && today.urgent.length > 0 ? '先看这一件事就够了'
        : mode === 'synergy' && milestones.length > 0 ? '有一条协同进度等你点头'
          : today.promises.length > 0 ? '把挂心的小事顺手收一收' : '今天节奏正好'}`,
    heroSubline,
    wechatConnected,
    sourceProblems: today.sourceProblems,
    sourcePartials: today.sourcePartials,
    sample: today.sample,
    paused: activity?.access?.paused === true,
  };
}
