/**
 * Pure derivation for the Today page (DESIGN.md 2.2 / 2.3 / 3.8).
 *
 * Everything the page says is computed from the activity projection; no model
 * is involved and no count is invented. Components render this model, tests
 * assert it, and the same shape feeds the small floating panel.
 */
import {zh} from './strings.zh.js';

const RANK = {needs_you: 0, stuck: 0, doing: 1, done: 2};
const CN = n => n <= 10 ? '零一两三四五六七八九十'[n] : String(n);
const clean = value => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim() : '';

/** Human time for Today. The projection stores ISO instants; the page never
 *  shows an ISO string. Relative minutes are exact, not rounded up. */
export function atText(value, now = new Date()) {
  const stamp = Date.parse(value);
  if (!Number.isFinite(stamp)) return '';
  const diff = now.getTime() - stamp;
  if (diff >= 0 && diff < 60_000) return '刚刚';
  if (diff >= 0 && diff < 3_600_000) return `${Math.max(1, Math.floor(diff / 60_000))} 分钟前`;
  const date = new Date(stamp);
  const dayKey = d => new Intl.DateTimeFormat('en-CA', {year: 'numeric', month: '2-digit', day: '2-digit'}).format(d);
  const days = Math.round((Date.parse(dayKey(now)) - Date.parse(dayKey(date))) / 86_400_000);
  const time = new Intl.DateTimeFormat('zh-CN', {hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).format(date);
  if (days === 0) return `今天 ${time}`;
  if (days === 1) return `昨天 ${time}`;
  if (days > 1 && days < 7) return `${new Intl.DateTimeFormat('zh-CN', {weekday: 'short'}).format(date)} ${time}`;
  return new Intl.DateTimeFormat('zh-CN', {month: 'numeric', day: 'numeric'}).format(date);
}

export function groupSessions(sessions = []) {
  const rows = Array.isArray(sessions) ? sessions.filter(row => row && typeof row.projectId === 'string') : [];
  const byState = {wait: [], stuck: [], run: [], done: []};
  for (const row of rows) {
    if (row.state === 'needs_you') byState.wait.push(row);
    else if (row.state === 'stuck') byState.stuck.push(row);
    else if (row.state === 'doing') byState.run.push(row);
    else if (row.state === 'done') byState.done.push(row);
  }
  for (const list of Object.values(byState)) list.sort((a, b) => Date.parse(b.at ?? 0) - Date.parse(a.at ?? 0));
  return byState;
}

/** One row per project, most urgent first; a project's dot is its most urgent item. */
export function projectDots(projects = [], sessions = [], blind = false) {
  const grouped = new Map();
  for (const row of sessions) {
    if (!grouped.has(row.projectId)) grouped.set(row.projectId, []);
    grouped.get(row.projectId).push(row);
  }
  return (Array.isArray(projects) ? projects : []).map(project => {
    const rows = (grouped.get(project.id) ?? []).sort((a, b) => (RANK[a.state] ?? 3) - (RANK[b.state] ?? 3));
    return {
      id: project.id,
      name: clean(project.name) || zh.today.unnamedProject,
      state: blind ? 'unknown' : rows[0]?.state ?? 'quiet',
      count: rows.length,
    };
  });
}

function headlineFor({counts, state, sessions, projects, away}) {
  const parts = [];
  if (counts.done) parts.push(`${CN(counts.done)}件做完了`);
  if (counts.wait) parts.push(`${CN(counts.wait)}件在等你`);
  if (counts.stuck) parts.push(`${CN(counts.stuck)}件卡住了`);
  const runTail = counts.run ? `${parts.length ? '还有' : '有'}${CN(counts.run)}件在跑` : '';
  if (state === 'blind') return {lead: zh.today.leadBlind, lines: [], tail: '', text: zh.today.headlineBlind};
  if (state === 'empty') return {lead: '', lines: [zh.today.headlineEmpty], tail: '', text: `${zh.today.headlineEmpty}${zh.today.firstHint}`};
  const lead = away ? zh.today.leadAway : zh.today.leadNow;
  if (!parts.length) {
    const tail = runTail ? `${runTail}。${zh.today.headlineRunOnly}` : zh.today.headlineRunOnly;
    return {lead: runTail ? lead : '', lines: [], tail, text: `${runTail ? lead : ''}${tail}`};
  }
  return {
    lead,
    lines: parts,
    tail: runTail ? `${runTail}。` : '',
    text: `${lead}${parts.join('，')}${runTail ? `，${runTail}` : ''}。`,
  };
}

export function buildToday(activity, {now = new Date(), sample = false} = {}) {
  const value = activity && typeof activity === 'object' ? activity : null;
  const blind = !value || value.reachable === false;
  const sessions = blind ? [] : Array.isArray(value.sessions) ? value.sessions : [];
  const projects = blind ? [] : Array.isArray(value.projects) ? value.projects : [];
  const rawCounts = value?.counts && typeof value.counts === 'object' ? value.counts : {};
  const grouped = groupSessions(sessions);
  const counts = {
    done: Number.isSafeInteger(rawCounts.done) ? rawCounts.done : grouped.done.length,
    wait: Number.isSafeInteger(rawCounts.wait) ? rawCounts.wait : grouped.wait.length,
    stuck: Number.isSafeInteger(rawCounts.stuck) ? rawCounts.stuck : grouped.stuck.length,
    run: Number.isSafeInteger(rawCounts.run) ? rawCounts.run : grouped.run.length,
    total: Number.isSafeInteger(rawCounts.total) ? rawCounts.total : sessions.length,
  };
  const promises = Array.isArray(value?.promises) ? value.promises.filter(row => row && typeof row.id === 'string' && typeof row.what === 'string') : [];
  const sourceRows = Array.isArray(value?.sources) ? value.sources : [];
  const state = blind ? 'blind' : sample || value?.sample === true ? 'first' : counts.total === 0 && !promises.length ? 'empty' : counts.wait + counts.stuck > 0 ? 'needs' : counts.run > 0 ? 'running' : counts.done > 0 ? 'done' : 'calm';
  const dots = projectDots(projects, sessions, blind);
  const projectName = id => dots.find(row => row.id === id)?.name ?? zh.today.unnamedProject;
  const projectById = new Map(dots.map(row => [row.id, row]));

  const urgent = [...grouped.wait, ...grouped.stuck].map(row => ({
    projectId: row.projectId,
    cardId: typeof row.cardId === 'string' ? row.cardId : null,
    projectName: projectName(row.projectId),
    state: row.state,
    title: clean(row.title) || clean(row.what) || zh.today.untitledItem,
    what: clean(row.what),
    at: atText(row.at, now),
    short: clean(row.short),
    // Production does not inject an approval decision service today. The
    // waiting card therefore opens the original session directly; the approve
    // handler stays in the server for hosts that later expose a native
    // approval path, but it is not a second fake button on this card.
    primary: row.state === 'needs_you' ? zh.today.openSession : zh.today.retry,
    primaryAct: row.state === 'needs_you' ? 'open' : 'retry',
    second: row.state === 'needs_you' ? null : zh.today.talkToIt,
    // Both card kinds open the native session; "talk to it" is the label, not
    // a separate unsupported action.
    secondAct: row.state === 'needs_you' ? null : 'open',
  }));
  const doneGroups = [];
  for (const row of grouped.done) {
    const name = projectName(row.projectId);
    let group = doneGroups.find(item => item.projectId === row.projectId);
    if (!group) { group = {projectId: row.projectId, name, count: 0, latest: null}; doneGroups.push(group); }
    group.count += 1;
    if (!group.latest) group.latest = {what: clean(row.what) || clean(row.title), at: atText(row.at, now)};
  }
  doneGroups.sort((a, b) => b.count - a.count);

  const recentByProject = new Map();
  for (const row of sessions) {
    if (typeof row.projectId !== 'string') continue;
    const time = Date.parse(row.at ?? 0) || 0;
    const current = recentByProject.get(row.projectId);
    if (!current || time > current.time) recentByProject.set(row.projectId, {time, row});
  }
  // DESIGN.md 3.4 rules 2/3: a verifiable project link or a project name in the
  // promise text is a weak association to that project's most recent session.
  // It never overrides the strong dispatch link, and it never claims to be the
  // handler beyond "this project has recent activity".
  const weakAssociation = row => {
    if (row.linkProjectId && projectById.has(row.linkProjectId)) {
      const project = projectById.get(row.linkProjectId);
      const recent = recentByProject.get(project.id);
      if (recent) return {project, recent};
    }
    const what = clean(row.what);
    if (!what) return null;
    const matches = (Array.isArray(projects) ? projects : [])
      .map(project => ({project, name: clean(project.name)}))
      .filter(item => item.name.length >= 2 && what.includes(item.name))
      .sort((a, b) => b.name.length - a.name.length);
    for (const {project} of matches) {
      const recent = recentByProject.get(project.id);
      if (recent) return {project, recent};
    }
    return null;
  };

  const promiseRows = promises.slice(0, 8).map(row => {
    const link = row.linkProjectId && projectById.has(row.linkProjectId) ? projectById.get(row.linkProjectId) : null;
    const handled = row.handledBy && typeof row.handledBy.sessionId === 'string'
      ? {sessionId: row.handledBy.sessionId, state: row.handledBy.state, title: clean(row.handledBy.title)}
      : null;
    const weak = handled ? null : weakAssociation(row);
    const related = weak ? {
      projectId: weak.project.id,
      projectName: clean(weak.project.name),
      cardId: typeof weak.recent.row.cardId === 'string' ? weak.recent.row.cardId : null,
      state: weak.recent.row.state,
      title: clean(weak.recent.row.title) || clean(weak.recent.row.what),
    } : null;
    return {
      id: row.id,
      whenText: clean(row.whenText) || '',
      what: clean(row.what).slice(0, 160),
      from: clean(row.from) || '',
      state: handled ? (handled.state ?? 'doing') : related?.state ?? 'none',
      projectName: related?.projectName ?? '',
      note: handled ? (handled.title || zh.today.processing) : related ? zh.today.relatedNote(related.projectName) : zh.today.noOwner,
      dispatch: !handled && !related,
      handledBy: handled,
      related,
      judged: row.judged === true,
    };
  });
  const problems = sourceRows
    .filter(row => row && row.state && row.state !== 'ok')
    .slice(0, 3)
    .map(row => ({id: String(row.id), state: row.state, name: zh.sources[row.id] ?? String(row.id)}));
  const partials = sourceRows
    .filter(row => row && row.state === 'ok' && row.partialReason === 'inbox_window')
    .slice(0, 3)
    .map(row => ({id: String(row.id), note: zh.today.sourcePartial?.[row.id] ?? '部分来源这次没读到'}));

  const model = {
    revision: Number.isSafeInteger(value?.revision) ? value.revision : 0,
    state,
    blind,
    counts,
    dots,
    field: {
      active: dots.filter(row => row.state !== 'quiet'),
      quiet: dots.filter(row => row.state === 'quiet').length,
    },
    urgent,
    needCards: urgent.slice(0, 2),
    needRows: urgent.slice(2, 6),
    doneGroups: doneGroups.slice(0, 5),
    doneMore: Math.max(0, doneGroups.length - 5),
    promises: promiseRows,
    sourceProblems: problems,
    sourcePartials: partials,
    connection: value?.connection?.wechat ?? 'unknown',
    sample: state === 'first',
    generatedAt: now instanceof Date ? now.toISOString() : null,
  };
  model.headline = headlineFor({counts, state, sessions, projects, away: false});
  model.empty = state === 'empty';
  return model;
}

/** Four visible states plus the first-use marker, as the page test asserts. */
export const TODAY_STATES = ['needs', 'running', 'done', 'calm', 'empty', 'blind', 'first'];

/** First-use onboarding uses the stock Today projection and Workbench
 * pairing state. `guide` never starts pairing; `pair` reuses the existing
 * status route/poll and is only reached for an explicitly known pairing. */
export const todayWechatMode = (activityConnection, workbenchConnection, {empty = false, reachable = true} = {}) => {
  if (empty !== true || reachable === false) return null;
  if (!activityConnection || !workbenchConnection || workbenchConnection.readOnly === true) return null;
  const today = activityConnection.wechat;
  const pairing = workbenchConnection.state;
  if (today === 'bound' || pairing === 'bound') return null;
  if (pairing === 'unknown' || pairing === 'failed') return null;
  if (today === 'none' && pairing === 'missing') return 'guide';
  if (today === 'unknown' && ['waiting-qr', 'scanned', 'awaiting-message'].includes(pairing)) return 'pair';
  return null;
};

/** Boolean compatibility for callers that only need visibility. */
export const needsTodayWechatSetup = (...args) => todayWechatMode(...args) !== null;

/** A response is only allowed to land while the same passive pairing gate is
 * still current; a late Workbench bound/leave must not save an old QR. */
export const inlineResponseAllowed = ({active, page, gate} = {}) =>
  active === true && page === 'home' && gate === 'pair';

/** Starter buttons fill the composer only when it is still empty. */
export const starterDraft = (current, text) => typeof current === 'string' && current.trim() ? current : text;
