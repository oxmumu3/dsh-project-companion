import {randomUUID} from 'node:crypto';
import {basename} from 'node:path';
import {createUserMessage} from '@deepseek-ai/dsh-llm';
import {effectiveCwd} from './coordination.js';
import {grantForCwd} from './session-ledger.js';
import {createWireTextStream} from './mobile-wire.js';

const undoWindow = 12_000;
const stale = () => ({ok: false, error: '会话状态已变化，请刷新后再试。'});
const textBlocks = blocks => Array.isArray(blocks) ? blocks
  .filter(block => block?.type === 'text' && typeof block.text === 'string')
  .map(block => block.text).join('\n') : '';
const cleanWorkspace = value => String(value ?? '').replace(/(?:电脑同源|电脑原有|主会话新建|分身)/g, '').trim();
const statusLabels = {wait: '待你拍板', run: '推进中', done: '成稿就绪', quiet: '跟进中'};
const ranks = {wait: 0, run: 1, done: 2, quiet: 3};
export const isProjectSessionHeader = header => Boolean(header && !header.isSeeded &&
  !header.parentSession && !header.parentSessionId && header.origin !== 'subagent');

export function projectMuseDossier(row, grant, messages = []) {
  const archived = row.state === 'handled';
  const artifactMarkdown = row.artifact?.kind === 'doc' ? row.artifact.markdown : null;
  const checklist = row.artifact?.kind === 'todo' ? row.artifact.checklist : [];
  const status = archived || (row.state === 'done' && artifactMarkdown) ? 'done'
    : ['needs_you', 'stuck'].includes(row.state) ? 'wait' : row.state === 'doing' ? 'run' : 'quiet';
  return {
    id: row.sessionId, title: row.title || '工作会话', summary: row.what, whyHere: row.what,
    workspaceTitle: cleanWorkspace(row.projectLabel) || cleanWorkspace(grant.label) || cleanWorkspace(basename(grant.root)) || '工作区',
    state: row.state, status, statusLabel: archived ? '已办妥' : statusLabels[status], archived,
    artifactKind: row.artifact?.kind ?? 'none', artifactMarkdown, checklist,
    artifactWordCount: artifactMarkdown ? [...artifactMarkdown.trim().matchAll(/\p{Script=Han}|[\p{L}\p{N}]+/gu)]
      .reduce((count, [word]) => count + (/\p{Script=Han}/u.test(word) ? [...word].length : 1), 0) : null,
    progress: checklist.length ? checklist.filter(item => item.checked).length / checklist.length : null,
    draftText: artifactMarkdown, updatedAt: row.lastEventAt, category: 'work', source: row.sessionId,
    timeline: [], messages,
  };
}

export function createMuseSessionHost({ctx, ledger, workspaceAccess, foregroundSession, isForeground, canRun,
  signal: lifecycle, clock = () => new Date(), onChange = () => {}, waitForLedger = () => {}, readForegroundIds}) {
  const controller = () => ctx.get('sessionController', false);
  const pending = new Set();
  const undo = new Map();
  const mobileAdmissions = new Map();

  async function scope(id) {
    if (typeof id !== 'string' || /^family[_-]/.test(id)) return null;
    const [snapshot, state] = await Promise.all([workspaceAccess.capture(), ledger.internal()]);
    const row = state.sessions.find(item => item.sessionId === id);
    const grant = row && grantForCwd(row.root, snapshot.grants);
    if (!grant || !workspaceAccess.authorizeSync(snapshot) || await isForeground(id)) return null;
    await workspaceAccess.assertCurrent(snapshot);
    return {row, grant, snapshot};
  }

  async function nativeHeader(id, signal) {
    const persistence = ctx.get('sessionPersistence', false);
    const stat = await persistence?.stat?.(id, {signal});
    const header = stat?.header;
    if (header?.id !== id || !isProjectSessionHeader(header) || stat.formatStatus === 'migration-required' ||
      typeof header.cwd !== 'string') return null;
    return header;
  }

  async function history(id, permits, signal = AbortSignal.timeout(5000)) {
    try {
      const api = controller();
      if (typeof api?.projections !== 'function' || typeof api?.page !== 'function') return [];
      const header = await nativeHeader(id, signal);
      if (!header || !await permits(header)) return [];
      const projection = await api.projections({sessionId: id}, signal);
      if (projection?.kind !== 'sequenced' || !Number.isSafeInteger(projection.asOfSeq) ||
        projection.values?.workingDirectory !== header.cwd) return [];
      const page = await api.page({address: {kind: 'session', sessionId: id}, throughSeq: projection.asOfSeq, maxMessages: 30}, signal);
      const current = await nativeHeader(id, signal);
      if (current?.cwd !== header.cwd || !await permits(current) || !Array.isArray(page?.records)) return [];
      return page.records.flatMap(record => {
        const event = record?.type === 'event' ? record.event : null;
        if (!Number.isSafeInteger(event?.seq) || event.seq < 0 || event.seq > projection.asOfSeq) return [];
        const isUser = event.type === 'user/message' && event.data?.source?.kind === 'user';
        const isAssistant = event.type === 'assistant/message' && event.data?.interrupted !== true;
        if (!isUser && !isAssistant) return [];
        const text = textBlocks(isUser ? event.data.content : event.data?.message?.content);
        if (!text.trim()) return [];
        const time = Number.isFinite(event.time) ? event.time : Number(clock());
        return [{id: `${id}:${event.seq}`, role: isUser ? 'user' : 'assistant', text, createdAt: new Date(time).toISOString()}];
      }).slice(-30);
    } catch {
      return [];
    }
  }

  const workspacePermits = selected => async header => {
    await workspaceAccess.assertCurrent(selected.snapshot);
    return grantForCwd(header.cwd, selected.snapshot.grants)?.root === selected.grant.root;
  };

  async function readSession(id) {
    try {
      const selected = await scope(id);
      if (!selected) return null;
      const messages = await history(id, workspacePermits(selected));
      await workspaceAccess.assertCurrent(selected.snapshot);
      return projectMuseDossier(selected.row, selected.grant, messages);
    } catch { return null; }
  }

  async function readForegroundMessages() {
    const id = await foregroundSession();
    if (!id || /^family[_-]/.test(id) || typeof controller()?.page !== 'function') return undefined;
    return history(id, async () => !lifecycle?.aborted && await foregroundSession() === id);
  }

  async function snapshot({includeMessages = false} = {}) {
    try {
      const [access, state, foreground] = await Promise.all([
        workspaceAccess.capture(), ledger.internal(),
        readForegroundIds?.() ?? foregroundSession().then(id => new Set([id])),
      ]);
      const entries = state.sessions.flatMap(row => {
        if (foreground.has(row.sessionId) || /^family[_-]/.test(row.sessionId)) return [];
        const grant = grantForCwd(row.root, access.grants);
        return grant ? [{row, grant, snapshot: access}] : [];
      });
      const dossiers = [];
      if (includeMessages) {
        // Bound simultaneous host history reads. A delayed session cannot flood
        // the host with one request for every row in a large workspace.
        const signal = AbortSignal.timeout(8000);
        for (let offset = 0; offset < entries.length; offset += 8) {
          dossiers.push(...await Promise.all(entries.slice(offset, offset + 8).map(async selected =>
            projectMuseDossier(selected.row, selected.grant,
              signal.aborted ? [] : await history(selected.row.sessionId, workspacePermits(selected), signal)))));
        }
      } else {
        for (const entry of entries) dossiers.push(projectMuseDossier(entry.row, entry.grant));
      }
      await workspaceAccess.assertCurrent(access);
      dossiers.sort((a, b) => ranks[a.status] - ranks[b.status] || Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
      const carouselCards = dossiers.filter(row => !row.archived);
      return {dossiers, carouselCards, todayFocus: carouselCards[0] ?? null};
    } catch { return {dossiers: [], carouselCards: [], todayFocus: null}; }
  }

  async function act({id, action, previous, itemId, checked} = {}) {
    if (!await canRun()) return {ok: false, error: 'Dot 已暂停，请恢复后再修改会话。'};
    const selected = await scope(id).catch(() => null);
    if (!selected) return stale();
    const {row, snapshot} = selected;
    await workspaceAccess.assertCurrent(snapshot);
    const authorize = () => workspaceAccess.authorizeSync(snapshot);
    if (action === 'complete') {
      const result = await ledger.setState(id, 'handled', {...row, authorize}, {archive: true});
      if (!result.changed) return stale();
      onChange();
      return {ok: true, undoState: {id, root: row.root, state: 'handled', revision: result.rowRevision}};
    }
    if (action === 'reopen' || action === 'undo') {
      if (row.state !== 'handled' || (action === 'undo' && previous?.id !== id)) return stale();
      const result = await ledger.restoreState(id, null, {...(action === 'undo' ? previous : row), authorize});
      if (!result.changed) return stale();
      onChange();
      return {ok: true};
    }
    if (action === 'toggle_checklist' && row.state !== 'handled' && row.artifact?.kind === 'todo' &&
      row.artifact.checklist.some(item => item.id === itemId) && typeof checked === 'boolean') {
      if (row.artifact.checklist.find(item => item.id === itemId).checked === checked) return {ok: true};
      const result = await ledger.setArtifact(id, artifact => ({kind: 'todo',
        checklist: artifact.checklist.map(item => item.id === itemId ? {...item, checked} : item)}), {...row, authorize});
      if (!result.changed) return stale();
      onChange();
      return {ok: true};
    }
    return {ok: false, error: '这项操作暂不适用于当前会话。'};
  }

  async function desktopAct(input) {
    const {undoState, ...result} = await act(input);
    if (!undoState) return result;
    const now = Number(clock());
    for (const [token, entry] of undo) if (entry.until < now) undo.delete(token);
    const undoToken = randomUUID();
    undo.set(undoToken, {until: now + undoWindow, previous: undoState});
    return {...result, undoToken, undoExpiresAt: new Date(now + undoWindow).toISOString()};
  }

  async function desktopUndo({undoToken} = {}) {
    const entry = undo.get(undoToken);
    undo.delete(undoToken);
    if (!entry || entry.until <= Number(clock())) return stale();
    return act({id: entry.previous.id, action: 'undo', previous: entry.previous});
  }

  async function artifactFor(agent, artifact) {
    const id = agent?.id;
    if (typeof id !== 'string' || agent?.session?.id !== id ||
      !isProjectSessionHeader(agent.session.header) || !await canRun()) return null;
    const selected = await scope(id);
    if (!selected || selected.row.state === 'handled' ||
      grantForCwd(effectiveCwd(ctx, agent), selected.snapshot.grants)?.root !== selected.grant.root) return null;
    if (artifact === undefined) return selected.row.artifact ?? {kind: 'none'};
    await workspaceAccess.assertCurrent(selected.snapshot);
    const result = await ledger.setArtifact(id, artifact, {...selected.row,
      authorize: () => workspaceAccess.authorizeSync(selected.snapshot)});
    if (!result.changed && JSON.stringify(selected.row.artifact) !== JSON.stringify(artifact)) return null;
    onChange();
    return artifact;
  }

  async function streamChat({sessionId, text, onEvent, signal}) {
    if (!await canRun()) return {ok: false, error: 'Dot 已暂停，请先恢复。'};
    const id = sessionId || await foregroundSession();
    if (!id || /^family[_-]/.test(id)) return {ok: false, error: '请先在电脑上选择 Dot 会话。'};
    if (pending.has(id)) return {ok: false, error: '本会话正在回复，请稍后再试。'};
    pending.add(id);
    try {
      const selected = sessionId ? await scope(id) : null;
      if (sessionId && (!selected || selected.row.state === 'handled')) return stale();
      const cancelled = AbortSignal.any([lifecycle, AbortSignal.timeout(120_000), ...(signal ? [signal] : [])].filter(Boolean));
      const getAgent = () => ctx.get('agents', false)?.get?.(id);
      let agent = getAgent();
      if (!agent) {
        const header = await nativeHeader(id, cancelled);
        if (!header || (selected && grantForCwd(header.cwd, selected.snapshot.grants)?.root !== selected.grant.root)) return stale();
        if (cancelled.aborted || (selected ? !workspaceAccess.authorizeSync(selected.snapshot) : await foregroundSession() !== id)) return stale();
        const activated = await controller()?.resolveAgent?.(id);
        agent = activated?.agent;
      }
      if (agent?.id !== id || agent?.session?.id !== id || typeof agent.followup !== 'function' ||
        agent.status !== 'idle' || !isProjectSessionHeader(agent.session.header)) return {ok: false, error: '会话暂不能接收消息，请稍后再试。'};
      const cwd = effectiveCwd(ctx, agent);
      const inScope = () => !cancelled.aborted &&
        (!selected || (workspaceAccess.authorizeSync(selected.snapshot) &&
          grantForCwd(effectiveCwd(ctx, agent), selected.snapshot.grants)?.root === selected.grant.root));
      if (!cwd || !inScope() || (!selected && await foregroundSession() !== id)) return stale();
      if (!inScope() || cancelled.aborted || agent.status !== 'idle') return stale();
      const message = createUserMessage({content: [{type: 'text', text}], source: {kind: 'user'}});
      mobileAdmissions.set(message.id, id);
      if (mobileAdmissions.size > 200) mobileAdmissions.delete(mobileAdmissions.keys().next().value);
      const result = await new Promise(resolve => {
        let turn = null;
        let mixed = false;
        let settled = false;
        const completed = [];
        let attempt = null;
        const disposers = [];
        const competingTurns = new Set();
        const emitText = createWireTextStream(delta => onEvent?.({type: 'text_delta', delta}));
        const finish = result => {
          if (settled) return;
          settled = true;
          cancelled.removeEventListener('abort', abort);
          for (const dispose of disposers) if (typeof dispose === 'function') dispose();
          resolve(result);
        };
        const abort = () => finish({ok: false, error: '等候回复已结束，可打开原会话查看进展。'});
        disposers.push(ctx.on('agent/inbox/claimed', payload => {
          if (payload?.agent !== agent || !Number.isSafeInteger(payload.turn)) return;
          if (payload.message?.id === message.id) {
            turn = payload.turn;
            mixed ||= competingTurns.has(turn);
          } else {
            competingTurns.add(payload.turn);
            mixed ||= payload.turn === turn;
          }
        }));
        disposers.push(ctx.on('agent/assistant-stream', ({agent: source, frame} = {}) => {
          if (source !== agent || turn === null || !frame) return;
          if (!inScope() || mixed) return finish(stale());
          if (frame.type === 'start' && frame.turn === turn) {
            attempt = {id: frame.attemptId, revision: frame.revision, text: ''};
          } else if (frame.type === 'chunk' && attempt?.id === frame.attemptId &&
            attempt.revision === frame.revision && frame.chunk?.type === 'text-delta' &&
            typeof frame.chunk.text === 'string' && frame.chunk.text) {
            emitText(!attempt.text && completed.length ? `\n${frame.chunk.text}` : frame.chunk.text);
            attempt.text += frame.chunk.text;
          }
        }));
        disposers.push(ctx.on('session/event', (session, event) => {
          if (session !== agent.session || turn === null || event?.data?.turn !== turn) return;
          if (!inScope() || mixed) return finish(stale());
          if (event.type === 'assistant/message' && event.data.interrupted !== true) {
            const chunk = textBlocks(event.data.message?.content);
            if (!chunk) return;
            if (!attempt?.text) emitText(completed.length ? `\n${chunk}` : chunk);
            else if (chunk.startsWith(attempt.text)) emitText(chunk.slice(attempt.text.length));
            emitText('', true);
            completed.push(chunk);
            attempt = null;
          } else if (event.type === 'turn/end') {
            const reason = event.data.reason?.kind;
            finish(reason === 'completed' ? {ok: true, reply: completed.join('\n')}
              : {ok: false, error: '本轮已结束，请打开原会话查看进展。'});
          }
        }));
        cancelled.addEventListener('abort', abort, {once: true});
        if (!inScope()) return abort();
        try { agent.followup(message); } catch { finish(stale()); }
      });
      if (!inScope()) return stale();
      await waitForLedger();
      return inScope() ? result : stale();
    } catch {
      return stale();
    } finally { pending.delete(id); }
  }
  return {snapshot, readSession, readForegroundMessages, act, desktopAct, desktopUndo, streamChat, artifactFor,
    isMobileAdmission: (id, messageId) => mobileAdmissions.get(messageId) === id};
}
