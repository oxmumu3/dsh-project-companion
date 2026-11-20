import { basename } from 'node:path';

const DOSSIER_STATUS = {
  needs_you: 'wait',
  stuck: 'wait',
  in_review: 'wait',
  doing: 'run',
  wait: 'wait',
  run: 'run',
  done: 'done',
};
const DOSSIER_PRIORITY = { wait: 0, run: 1, done: 2, quiet: 3 };
const CHECKLIST_STATUSES = new Set(['pending', 'in_progress', 'completed']);
const MEMORY_SOURCES = new Set(['chat', 'workspace', 'flomo', 'manual']);
const ICON_CATEGORIES = new Set(['work', 'admin', 'life', 'birthday', 'note']);
const DOSSIER_ORIGINS = new Set(['user', 'proactive_prebake', 'adopted_prebake']);
const legacyLabels = new Map([['电脑同源', '工作区'], ['电脑原有', '工作区'], ['主会话新建', '新事项'], ['分身', '协办事项']]);
const userPath = /\/Users\/[^\s"'\x60)\]}]+/g;
const LEGACY_WORKSPACE_LABEL = /电脑同源|电脑原有|主会话新建|分身/;

const CONNECTORS = [
  ['mac_base', 'mac_bridge', 'Mac 守护桥', '手机与电脑共享工作进展', '只有已配对设备可访问'],
  ['mac_base', 'workspace_grants', 'Mac 工作区目录读取范围', '选择允许读取的工作区', '仅在已授权目录内读取'],
  ['external_apps', 'google_suite', 'Google 三件套（Gmail · 日历 · Drive）', '检索资料与准备邮件草稿', '草稿仅暂存，外发需你操作'],
  ['external_apps', 'flomo', 'flomo 浮墨笔记', '按需查阅笔记', '在已授权范围内读取'],
  ['external_apps', 'dida', '滴答清单', '按需查阅待办', '在已授权范围内读取'],
  ['external_apps', 'wechat', '微信通知', '将选定消息发到微信', '沿用当前通知通道的权限'],
];

export const asArray = (value) => Array.isArray(value) ? value : [];
export const wireDate = (value, fallback) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : fallback;

export function replaceLegacyLabels(value) {
  for (const [label, replacement] of legacyLabels) value = value.replaceAll(label, replacement);
  return value;
}

export function createWireTextStream(emit) {
  const prefixes = [...legacyLabels.keys(), '/Users/'].flatMap(value =>
    Array.from({length: value.length - 1}, (_unused, index) => value.slice(0, index + 1)));
  let tail = '';
  return (chunk, flush = false) => {
    const text = tail + chunk;
    const partialPath = flush ? '' : (text.match(/\/Users\/[^\s"'\x60)\]}]*$/)?.[0] ?? '');
    let hold = partialPath.length;
    if (!flush) for (const prefix of prefixes) {
      if (text.endsWith(prefix)) hold = Math.max(hold, prefix.length);
    }
    tail = hold ? text.slice(-hold) : '';
    const delta = replaceLegacyLabels(text.slice(0, text.length - hold)).replace(userPath, '[本机工作区]');
    if (delta) emit(delta);
  };
}

export function cleanWireText(value, fallback = '') {
  if (typeof value !== 'string') return fallback;
  const cleaned = replaceLegacyLabels(value)
    .replace(userPath, '[本机工作区]')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ');
  return cleaned.trim() ? cleaned : fallback;
}

export function stringifyWire(payload) {
  return JSON.stringify(payload, (_key, value) => typeof value === 'string' ? replaceLegacyLabels(value) : value);
}

export function projectMessages(rows, nowIso) {
  return asArray(rows).filter((row) => row && typeof row.text === 'string').map((row, index) => ({
    id: String(row.id || `message-${index + 1}`),
    role: row.role === 'assistant' ? 'assistant' : 'user',
    text: cleanWireText(row.text),
    createdAt: wireDate(row.createdAt, nowIso),
    ...(row.tier ? { tier: row.tier } : {}),
    ...(row.briefCard ? { briefCard: row.briefCard } : {}),
    ...(row.widgets ? { widgets: row.widgets } : {}),
    ...(row.toolSteps ? { toolSteps: row.toolSteps } : {}),
  }));
}

/** Compact only the mobile projection. Raw logs, user input and cursors stay intact. */
export function compactHistoryEvents(rows) {
  function compactToolValue(value) {
    if (typeof value === 'string') return value.slice(0, 512);
    if (value === undefined) return value;
    const serialized = JSON.stringify(value);
    return serialized.length > 512 ? serialized.slice(0, 512) : value;
  }
  const toolKeys = new Set(['input', 'output', 'arguments', 'args', 'result', 'content', 'text', 'body', 'response', 'delta', 'message', 'value']);
  const toolData = data => Object.fromEntries(Object.entries(data).map(([key, value]) => {
    if (!toolKeys.has(key)) return [key, value];
    if (value && typeof value === 'object' && !Array.isArray(value) &&
      ['isError', 'usage'].some(field => Object.hasOwn(value, field))) return [key, toolData(value)];
    return [key, compactToolValue(value)];
  }));
  return asArray(rows).map(row => {
    const wrapped = row?.type === 'event' && row.event;
    const event = wrapped ? row.event : row;
    const data = event?.data;
    if (!data || typeof data !== 'object' || data.source?.kind === 'user' || event.source?.kind === 'user') return row;
    let compact;
    if (event.type === 'request/header') {
      const strip = ({tools, system, ...rest}) => rest;
      compact = strip(data);
      if (compact.header && typeof compact.header === 'object') compact.header = strip(compact.header);
      if (compact.request && typeof compact.request === 'object') compact.request = strip(compact.request);
    } else if (/^tool[/:_-]/.test(event.type) || event.type === 'stream' || /^stream[/:_-]/.test(event.type)) {
      compact = toolData(data);
    } else {
      return row;
    }
    const projected = {...event, data: compact};
    return wrapped ? {...row, event: projected} : projected;
  });
}

export function projectDossier(row, nowIso) {
  const { id } = row;
  const summary = cleanWireText(row.summary || row.note).trim();
  const artifactMarkdown = cleanWireText(row.artifactMarkdown, null);
  const checklist = asArray(row.checklist)
    .filter((item) => item && typeof item.text === 'string')
    .map((item, index) => {
      const status = CHECKLIST_STATUSES.has(item.status) ? item.status : item.checked === true ? 'completed' : 'pending';
      return {
        id: String(item.id || `${id}-${index + 1}`),
        text: cleanWireText(item.text).trim(),
        status,
        checked: status === 'completed',
      };
    });
  const artifactKind = artifactMarkdown ? 'doc' : checklist.length ? 'todo' : 'none';
  const workspaceTitle = [row.workspaceTitle, row.projectLabel, typeof row.root === 'string' ? basename(row.root) : '']
    .map((label) => !LEGACY_WORKSPACE_LABEL.test(label) && cleanWireText(label).trim())
    .find(Boolean) || '个人事务';
  const rowState = row.state ?? row.status;
  const archived = row.archived === true || rowState === 'handled';
  const mappedStatus = rowState === 'done' && artifactKind !== 'doc' ? 'quiet' : rowState;
  const status = archived ? 'done' : Object.hasOwn(DOSSIER_STATUS, mappedStatus) ? DOSSIER_STATUS[mappedStatus] : 'quiet';
  const statusLabel = archived ? '已办妥' : {
    wait: '待你拍板',
    run: '推进中',
    done: '成稿就绪',
    quiet: '跟进中',
  }[status];
  const progress = artifactKind === 'todo'
    ? checklist.filter(({ checked }) => checked).length / checklist.length
    : artifactKind === 'doc' ? 1 : 0;
  const artifactWordCount = artifactMarkdown
    ? Math.max(0, Number.isInteger(row.artifactWordCount) ? row.artifactWordCount : [...artifactMarkdown.replace(/\s/gu, '')].length)
    : null;
  const origin = DOSSIER_ORIGINS.has(row.origin) ? row.origin : null;
  const trigger = row.prebakeTrigger;
  return {
    id,
    title: cleanWireText(row.title || row.text, '待跟进事项').trim(),
    summary,
    whyHere: cleanWireText(row.whyHere, summary).trim(),
    workspaceTitle,
    status,
    statusLabel,
    archived,
    artifactKind,
    progress,
    checklist: artifactKind === 'todo' ? checklist : [],
    artifactMarkdown,
    artifactWordCount,
    draftText: cleanWireText(row.draftText, null),
    category: cleanWireText(row.category, 'work'),
    source: id,
    updatedAt: wireDate(row.updatedAt, nowIso),
    relativeTime: cleanWireText(row.relativeTime, '最近'),
    timeline: asArray(row.timeline).filter(Boolean).map((step, index) => ({
      id: String(step.id || `${id}-step-${index + 1}`),
      timeLabel: cleanWireText(step.timeLabel, '最近'),
      detail: cleanWireText(step.detail),
      state: cleanWireText(step.state, 'quiet'),
    })),
    messages: projectMessages(row.messages, nowIso),
    deliverableKind: cleanWireText(row.deliverableKind, artifactKind),
    ...(origin ? {origin} : {}),
    ...(trigger && typeof trigger === 'object' ? {prebakeTrigger: {
      source: cleanWireText(trigger.source),
      workspace: cleanWireText(trigger.workspace),
      tokenCost: Number.isSafeInteger(trigger.tokenCost) && trigger.tokenCost >= 0 ? trigger.tokenCost : 0,
    }} : {}),
    ...(Array.isArray(row.widgets) ? { widgets: row.widgets } : {}),
  };
}

export function projectCarousel(dossiers) {
  const isPrebake = row => row.origin === 'proactive_prebake';
  const carouselCards = dossiers.filter((row) => !row.archived).sort((a, b) =>
    Number(isPrebake(b)) - Number(isPrebake(a)) ||
    DOSSIER_PRIORITY[a.status] - DOSSIER_PRIORITY[b.status] || Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, 5);
  const first = carouselCards[0];
  const todayFocus = first ? {
    ...first,
    eyebrow: first.workspaceTitle,
    whyNow: first.whyHere,
    draftSlip: '',
    primaryActionLabel: '查看详情',
    completeActionLabel: '办妥',
    secondaryActionLabel: '稍后查看',
    dossierId: first.id,
  } : null;
  const secondaryQueue = carouselCards.slice(1).map((row) => ({
    id: row.id,
    title: row.title,
    summary: row.summary,
    eyebrow: row.workspaceTitle,
    dossierId: row.id,
    category: row.category,
  }));
  return { carouselCards, todayFocus, secondaryQueue };
}

export function projectSchedule(row, index) {
  const source = cleanWireText(row.source, 'dot');
  const sourceLabel = /calendar/.test(source) ? '日历' : /mail/.test(source) ? '邮件' : null;
  return {
    id: String(row.id || `schedule-${index + 1}`),
    timeLabel: cleanWireText(row.timeLabel, '今天'),
    title: cleanWireText(row.title, '日程'),
    subtitle: cleanWireText(row.subtitle),
    source,
    actionLabel: cleanWireText(row.actionLabel, null),
    actionPrompt: cleanWireText(row.actionPrompt, null),
    statusBadge: cleanWireText(row.statusBadge, null),
    linkedDossierId: cleanWireText(row.linkedDossierId, null),
    sourceLabel: cleanWireText(row.sourceLabel, sourceLabel),
    ...(ICON_CATEGORIES.has(row.iconCategory) ? {iconCategory: row.iconCategory} : {}),
    ...(typeof row.isAllDayBirthday === 'boolean' ? {isAllDayBirthday: row.isAllDayBirthday} : {}),
    ...(Array.isArray(row.groupedNames) ? {groupedNames: row.groupedNames.map(name => cleanWireText(name)).filter(Boolean)} : {}),
  };
}

export function projectReminderFields(row) {
  return {
    ...(ICON_CATEGORIES.has(row.iconCategory) ? {iconCategory: row.iconCategory} : {}),
    ...(typeof row.overdue === 'boolean' ? {overdue: row.overdue} : {}),
    ...(row.actionLabel !== undefined ? {actionLabel: cleanWireText(row.actionLabel, null)} : {}),
    ...(row.actionPrompt !== undefined ? {actionPrompt: cleanWireText(row.actionPrompt, null)} : {}),
  };
}

export function projectLiveInsight(row, nowIso) {
  if (!row || typeof row.id !== 'string') return null;
  return {
    id: row.id, unread: row.unread === true, category: cleanWireText(row.category),
    title: cleanWireText(row.title), eyebrow: cleanWireText(row.eyebrow), prompt: cleanWireText(row.prompt),
    sourceRef: cleanWireText(row.sourceRef), suggestedReplies: asArray(row.suggestedReplies)
      .map(reply => cleanWireText(reply)).filter(Boolean).slice(0, 3),
    createdAt: wireDate(row.createdAt, nowIso),
  };
}

export function projectRoutine(row, index) {
  return {
    id: String(row.id || `routine-${index + 1}`),
    title: cleanWireText(row.title, '动态例行'),
    triggerKind: cleanWireText(row.triggerKind, 'daily'),
    scheduleLabel: cleanWireText(row.scheduleLabel, '每天'),
    instruction: cleanWireText(row.instruction),
    notifyWeChat: row.notifyWeChat === true,
    active: row.active !== false,
    lastRunAt: wireDate(row.lastRunAt, null),
    lastResultSummary: cleanWireText(row.lastResultSummary, null),
    lastReceipt: cleanWireText(row.lastReceipt, null),
    nextRunLabel: cleanWireText(row.nextRunLabel, null),
  };
}

export function projectMemoryItem(row, nowIso) {
  const sourceKind = MEMORY_SOURCES.has(row.sourceKind) ? row.sourceKind : 'manual';
  return {
    id: String(row.id),
    text: cleanWireText(row.text).trim(),
    active: row.active !== false,
    category: cleanWireText(row.bucket ?? row.category, 'note'),
    sourceKind,
    provenance: cleanWireText(row.provenance, { chat: '来自对话', workspace: '来自工作区', flomo: '来自 flomo', manual: '手动添加' }[sourceKind]),
    effect: cleanWireText(row.effect, '待应用'),
    updatedAt: wireDate(row.updatedAt ?? row.createdAt, nowIso),
    relativeTime: cleanWireText(row.relativeTime, '最近'),
    ...(typeof row.quote === 'string' ? {quote: cleanWireText(row.quote)} : {}),
    ...(typeof row.quoteSource === 'string' ? {quoteSource: cleanWireText(row.quoteSource)} : {}),
    ...(typeof row.quotedInVerified === 'boolean' ? {quotedInVerified: row.quotedInVerified} : {}),
    ...(row.replacedOld !== undefined ? {replacedOld: cleanWireText(row.replacedOld, null)} : {}),
    ...(row.tagBadge !== undefined ? {tagBadge: ['新', '已更新'].includes(row.tagBadge) ? row.tagBadge : null} : {}),
  };
}

export function projectConnectorLedger(ledger, { bridgeActive, workspaces }) {
  const mountedWorkspaces = asArray(ledger?.mountedWorkspaces ?? workspaces)
    .map((workspace) => cleanWireText(typeof workspace === 'string' ? workspace : workspace?.label || workspace?.name).trim())
    .filter(Boolean);
  const contextMode = ledger?.contextMode === 'full_local' ? 'full_local' : 'curated_only';
  const rows = new Map(asArray(ledger?.connectors).filter(Boolean).map((row) => [row.id, row]));
  const connectors = CONNECTORS.map(([group, id, title, subtitle, boundaryNote]) => {
    const row = rows.get(id);
    const connected = row ? row.connected === true : id === 'mac_bridge' && bridgeActive;
    const enabled = connected && (id === 'mac_bridge' || row?.enabled === true);
    const fallbackStatus = id === 'mac_bridge'
      ? (connected ? '已连接' : '未连接')
      : id === 'workspace_grants' && mountedWorkspaces.length ? `已挂载 ${mountedWorkspaces.join(' · ')}`
        : enabled ? '已授权' : connected ? '已暂停' : '待授权';
    return {
      id,
      group,
      title: cleanWireText(row?.title, title),
      subtitle: cleanWireText(row?.subtitle, subtitle),
      boundaryNote: cleanWireText(row?.boundaryNote, boundaryNote),
      connected,
      enabled,
      statusText: cleanWireText(row?.statusText, fallbackStatus),
      canToggle: id !== 'mac_bridge' && row?.canToggle === true,
      ...(id === 'workspace_grants' ? { contextMode } : {}),
    };
  });
  return { connectors, enabledCount: connectors.filter((row) => row.enabled).length, totalCount: connectors.length, contextMode, mountedWorkspaces };
}
