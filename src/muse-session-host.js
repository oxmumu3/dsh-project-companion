import {randomUUID} from 'node:crypto';
import {closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync} from 'node:fs';
import {basename, dirname, relative, resolve, sep} from 'node:path';
import {createUserMessage} from '@deepseek-ai/dsh-llm';
import {effectiveCwd} from './coordination.js';
import {grantForCwd} from './session-ledger.js';
import {compactHistoryEvents, createWireTextStream} from './mobile-wire.js';
import {createNativeMuseGateway} from './muse-native-gateway.js';

const undoWindow = 12_000;
const messageLimit = 30;
const markdownLimit = 512 * 1024;
const stale = () => ({ok: false, error: '会话状态已变化，请刷新后再试。'});
const emptyTranscript = () => ({messages: [], checklist: [], markdown: null});
const textBlocks = blocks => Array.isArray(blocks) ? blocks
  .filter(block => block?.type === 'text' && typeof block.text === 'string')
  .map(block => block.text).join('\n') : '';
const cleanWorkspace = value => String(value ?? '').replace(/(?:电脑同源|电脑原有|主会话新建|分身)/g, '').trim();
const statusLabels = {wait: '待你拍板', run: '推进中', done: '成稿就绪', quiet: '跟进中'};
const ranks = {wait: 0, run: 1, done: 2, quiet: 3};
export const isProjectSessionHeader = header => Boolean(header && !header.isSeeded &&
  !header.parentSession && !header.parentSessionId && header.origin !== 'subagent');

function extractTranscriptSignals(records, {id, cwd, grant, contextMode, throughSeq, beforeSeq, includeMessages, clock}, signals) {
  const events = records.filter(record => record?.type === 'event').map(record => record.event)
    .filter(event => Number.isSafeInteger(event?.seq) && event.seq >= 0 && event.seq <= throughSeq && event.seq < beforeSeq)
    .sort((a, b) => b.seq - a.seq);
  const includeDocument = grant && contextMode !== 'curated_only';
  // Pages arrive newest first. Resolve a relative file using the cwd at its event.
  for (const event of events) {
    if (grant && signals.todoAt === undefined && event.type === 'todo/write' && Array.isArray(event.data?.todos)) {
      signals.checklist = event.data.todos
        .filter(todo => typeof todo?.content === 'string' && todo.content.trim())
        .map((todo, index) => {
          const status = ['pending', 'in_progress', 'completed'].includes(todo.status)
            ? todo.status : (todo.checked === true ? 'completed' : 'pending');
          return {id: `native-${event.seq}-${index}`, text: todo.content, checked: status === 'completed', status};
        });
      signals.todoAt = Number(event.time) || 0;
      if (!signals.cwdChanged) signals.todoCwd = cwd;
    } else if (includeDocument && signals.documentAt === undefined && event.type === 'deliverables/presented' && Array.isArray(event.data?.files)) {
      signals.nativeDocumentPath = event.data.files.find(file => typeof file?.path === 'string' && /\.(?:md|markdown)$/i.test(file.path))?.path;
      signals.documentAt = Number(event.time) || 0;
      if (!signals.cwdChanged) signals.documentCwd = cwd;
    } else if (grant && event.type === 'working-directory/change' && typeof event.data?.cwd === 'string') {
      signals.cwdChanged = true;
      if (signals.checklist?.length && signals.todoCwd === undefined) signals.todoCwd = event.data.cwd;
      if (signals.nativeDocumentPath && signals.documentCwd === undefined) signals.documentCwd = event.data.cwd;
    } else if (includeMessages && signals.messages.length < messageLimit) {
      const isUser = event.type === 'user/message' && event.data?.source?.kind === 'user';
      const isAssistant = event.type === 'assistant/message' && event.data?.interrupted !== true;
      if (!isUser && !isAssistant) continue;
      const text = textBlocks(isUser ? event.data.content : event.data?.message?.content);
      if (!text.trim()) continue;
      const time = Number.isFinite(event.time) ? event.time : Number(clock());
      signals.messages.push({id: `${id}:${event.seq}`, role: isUser ? 'user' : 'assistant', text, createdAt: new Date(time).toISOString()});
    }
  }
  return events.at(-1)?.seq;
}

const isDescendant = (root, target) => target !== root && target.startsWith(root.endsWith(sep) ? root : root + sep);
const sameFile = (a, b) => a.dev === b.dev && a.ino === b.ino;

function readPresentedMarkdown({grant, cwd, docPath, contextMode, workspaceAccess, snapshot, maxBytes = markdownLimit}) {
  let fd;
  try {
    if (!grant || !docPath || contextMode === 'curated_only' || workspaceAccess.authorizeSync(snapshot) !== true) return null;
    const grantStat = lstatSync(grant.root);
    if (!grantStat.isDirectory()) return null;
    const root = realpathSync(grant.root);
    // macOS exposes /tmp and /var as system aliases under /private.
    const systemAlias = process.platform === 'darwin' && /^\/(?:tmp|var)\//.test(grant.root) && root === '/private' + grant.root;
    if (root !== grant.root && !systemAlias) return null;
    const candidate = resolve(cwd, docPath);
    const target = isDescendant(grant.root, candidate) ? resolve(root, relative(grant.root, candidate)) : candidate;
    const parent = dirname(target);
    if (!isDescendant(root, target) || realpathSync(parent) !== parent) return null;
    const expected = lstatSync(target);
    if (!expected.isFile() || expected.nlink !== 1 || expected.size > maxBytes) return null;
    fd = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.nlink !== 1 || opened.size > maxBytes || !sameFile(expected, opened)) return null;
    const buffer = Buffer.alloc(opened.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = readSync(fd, buffer, length, buffer.length - length, length);
      if (!count) break;
      length += count;
    }
    const after = fstatSync(fd);
    if (length !== opened.size || after.size !== opened.size || after.nlink !== 1 ||
      after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs ||
      !sameFile(grantStat, lstatSync(grant.root)) || realpathSync(grant.root) !== root ||
      realpathSync(parent) !== parent || !sameFile(opened, lstatSync(target)) ||
      workspaceAccess.authorizeSync(snapshot) !== true) return null;
    return buffer.subarray(0, length).toString('utf8');
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export function projectMuseDossier(row, grant, messages = [], nativeOverlay = {}, metadata = {}) {
  const archived = row.state === 'handled';
  const rowDocMarkdown = row.artifact?.kind === 'doc' ? row.artifact.markdown : null;
  const artifactMarkdown = nativeOverlay.markdown ?? rowDocMarkdown;
  const checklist = artifactMarkdown ? [] : (Array.isArray(nativeOverlay.checklist) ? nativeOverlay.checklist : []);
  const artifactKind = artifactMarkdown ? 'doc' : checklist.length > 0 ? 'todo' : 'none';
  const status = archived || (row.state === 'done' && artifactMarkdown) ? 'done'
    : ['needs_you', 'stuck'].includes(row.state) ? 'wait'
    : row.state === 'doing' && metadata.origin !== 'proactive_prebake' ? 'run' : 'quiet';
  return {
    id: row.sessionId, title: row.title || '工作会话', summary: row.what, whyHere: row.what,
    workspaceTitle: cleanWorkspace(row.projectLabel) || cleanWorkspace(grant.label) || cleanWorkspace(basename(grant.root)) || '工作区',
    state: row.state, status, statusLabel: archived ? '已办妥' : statusLabels[status], archived,
    artifactKind, artifactMarkdown, checklist,
    artifactWordCount: artifactMarkdown ? [...artifactMarkdown.trim().matchAll(/\p{Script=Han}|[\p{L}\p{N}]+/gu)]
      .reduce((count, [word]) => count + (/\p{Script=Han}/u.test(word) ? [...word].length : 1), 0) : null,
    progress: checklist.length ? checklist.filter(item => item.checked).length / checklist.length : artifactMarkdown ? 1 : null,
    draftText: artifactMarkdown, updatedAt: row.lastEventAt, category: 'work', source: row.sessionId,
    timeline: [], messages, origin: metadata.origin ?? 'user',
    ...(metadata.prebakeTrigger ? {prebakeTrigger: metadata.prebakeTrigger} : {}),
  };
}

export function createMuseSessionHost({ctx, ledger, workspaceAccess, foregroundSession, isForeground, canRun,
  signal: lifecycle, clock = () => new Date(), onChange = () => {}, waitForLedger = () => {}, readForegroundIds,
  getPrebakeMetadata = () => null, mutatePrebake}) {
  const controller = () => ctx.get('sessionController', false);
  const pending = new Set();
  const undo = new Map();
  const mobileAdmissions = new Map();
  const nativeRequests = new Map();

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

  const canInspect = api => typeof api?.projections === 'function' && typeof api?.page === 'function';

  async function inspectSession(id, permits, signal = AbortSignal.timeout(8000), {includeMessages = true, selected} = {}) {
    try {
      const api = controller();
      if (!canInspect(api) || signal.aborted) return emptyTranscript();
      const header = await nativeHeader(id, signal);
      if (!header || !await permits(header)) return emptyTranscript();
      const projection = await api.projections({sessionId: id}, signal);
      const cwd = projection?.values?.workingDirectory;
      if (projection?.kind !== 'sequenced' || !Number.isSafeInteger(projection.asOfSeq) ||
        projection.asOfSeq < 0 || typeof cwd !== 'string' ||
        (cwd !== header.cwd && (!selected || !await permits({...header, cwd})))) return emptyTranscript();
      const contextMode = selected?.snapshot.contextMode;
      const grant = selected?.grant;
      const includeDocument = grant && contextMode !== 'curated_only';
      const signals = {messages: []};
      let beforeSeq;
      // The host caps pages by messages, so native events may precede the newest page.
      while (true) {
        signal.throwIfAborted();
        const page = await api.page({
          address: {kind: 'session', sessionId: id}, throughSeq: projection.asOfSeq, maxMessages: messageLimit,
          ...(beforeSeq === undefined ? {} : {beforeSeq}),
        }, signal);
        if (!Array.isArray(page?.records)) return emptyTranscript();
        const firstSeq = extractTranscriptSignals(compactHistoryEvents(page.records), {
          id, cwd, grant, contextMode, throughSeq: projection.asOfSeq, beforeSeq: beforeSeq ?? Infinity, includeMessages, clock,
        }, signals);
        const needsChecklist = grant && (signals.todoAt === undefined ||
          (signals.checklist.length > 0 && signals.todoCwd === undefined));
        const needsDocument = includeDocument && (signals.documentAt === undefined ||
          (signals.nativeDocumentPath && signals.documentCwd === undefined));
        const needsMessages = includeMessages && signals.messages.length < messageLimit;
        if (!page.hasMore || !firstSeq || !(needsChecklist || needsDocument || needsMessages)) break;
        beforeSeq = firstSeq;
      }
      const current = await nativeHeader(id, signal);
      if (current?.cwd !== header.cwd || !await permits(current) || signal.aborted) return emptyTranscript();
      const permitsArtifactCwd = cwd => grant && grantForCwd(cwd, selected.snapshot.grants)?.root === grant.root;
      const documentCwd = signals.documentCwd ?? header.cwd;
      const markdown = signals.nativeDocumentPath && permitsArtifactCwd(documentCwd) ? readPresentedMarkdown({
        grant, cwd: documentCwd, docPath: signals.nativeDocumentPath, contextMode,
        workspaceAccess, snapshot: selected.snapshot,
      }) : null;
      const checklist = permitsArtifactCwd(signals.todoCwd ?? header.cwd) ? signals.checklist ?? [] : [];
      return {messages: signals.messages.reverse(), checklist, markdown};
    } catch {
      return emptyTranscript();
    }
  }

  const workspacePermits = selected => async header => {
    await workspaceAccess.assertCurrent(selected.snapshot);
    return grantForCwd(header.cwd, selected.snapshot.grants)?.root === selected.grant.root;
  };

  async function readSession(id) {
    try {
      const selected = await scope(id);
      if (!selected || getPrebakeMetadata(id)?.hidden) return null;
      const transcript = await inspectSession(id, workspacePermits(selected), undefined, {selected});
      await workspaceAccess.assertCurrent(selected.snapshot);
      const metadata = getPrebakeMetadata(id);
      return metadata?.hidden ? null : projectMuseDossier(selected.row, selected.grant, transcript.messages, transcript, metadata ?? {});
    } catch { return null; }
  }

  async function readForegroundMessages() {
    const id = await foregroundSession();
    if (!id || /^family[_-]/.test(id) || typeof controller()?.page !== 'function') return undefined;
    const {messages} = await inspectSession(id, async () => !lifecycle?.aborted && await foregroundSession() === id);
    return messages;
  }

  async function snapshot({includeMessages = false} = {}) {
    try {
      const [access, state, foreground] = await Promise.all([
        workspaceAccess.capture(), ledger.internal(),
        readForegroundIds?.() ?? foregroundSession().then(id => new Set([id])),
      ]);
      const entries = state.sessions.flatMap(row => {
        if (foreground.has(row.sessionId) || /^family[_-]/.test(row.sessionId) || getPrebakeMetadata(row.sessionId)?.hidden) return [];
        const grant = grantForCwd(row.root, access.grants);
        return grant ? [{row, grant, snapshot: access}] : [];
      });
      const dossiers = [];
      if (canInspect(controller())) {
        // Bound simultaneous transcript reads. A delayed session cannot flood
        // the host with one request for every row in a large workspace.
        const signal = AbortSignal.timeout(8000);
        for (let offset = 0; offset < entries.length; offset += 8) {
          dossiers.push(...await Promise.all(entries.slice(offset, offset + 8).map(async selected => {
            const transcript = await inspectSession(selected.row.sessionId, workspacePermits(selected), signal, {includeMessages, selected});
            const metadata = getPrebakeMetadata(selected.row.sessionId);
            return metadata?.hidden ? null : projectMuseDossier(selected.row, selected.grant, transcript.messages, transcript, metadata ?? {});
          })));
        }
      } else {
        for (const entry of entries) dossiers.push(projectMuseDossier(entry.row, entry.grant, undefined, undefined,
          getPrebakeMetadata(entry.row.sessionId) ?? {}));
      }
      await workspaceAccess.assertCurrent(access);
      const visible = dossiers.filter(row => row && !getPrebakeMetadata(row.id)?.hidden);
      visible.sort((a, b) => Number(b.origin === 'proactive_prebake') - Number(a.origin === 'proactive_prebake') ||
        ranks[a.status] - ranks[b.status] || Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
      const carouselCards = visible.filter(row => !row.archived);
      return {dossiers: visible, carouselCards, todayFocus: carouselCards[0] ?? null};
    } catch { return {dossiers: [], carouselCards: [], todayFocus: null}; }
  }

  async function act({id, action, previous} = {}) {
    if (action === 'toggle_checklist') return {ok: false, error: '执行步骤由会话自动推进，请在对话中直接回复。'};
    if (!await canRun()) return {ok: false, error: 'Dot 已暂停，请恢复后再修改会话。'};
    const selected = await scope(id).catch(() => null);
    if (!selected) return stale();
    const {row, snapshot} = selected;
    await workspaceAccess.assertCurrent(snapshot);
    const authorize = () => workspaceAccess.authorizeSync(snapshot);
    const metadata = getPrebakeMetadata(id);
    if (metadata?.hidden) return stale();
    if (action === 'adopt_prebake' || action === 'dismiss_prebake') {
      if (metadata?.origin !== 'proactive_prebake' || typeof mutatePrebake !== 'function') return stale();
      const result = await mutatePrebake({id, action, authorize});
      if (result?.ok) onChange();
      return result;
    }
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
    if (artifact === undefined) {
      return selected.row.artifact?.kind === 'doc' ? selected.row.artifact : {kind: 'none'};
    }
    if (artifact?.kind !== 'doc') return null;
    await workspaceAccess.assertCurrent(selected.snapshot);
    const result = await ledger.setArtifact(id, artifact, {...selected.row,
      authorize: () => workspaceAccess.authorizeSync(selected.snapshot)});
    if (!result.changed && JSON.stringify(selected.row.artifact) !== JSON.stringify(artifact)) return null;
    onChange();
    return artifact;
  }

  async function streamChat({sessionId, text, onEvent, signal, operationId, native, prepared}) {
    if (!await canRun()) return {ok: false, error: 'Dot 已暂停，请先恢复。'};
    const id = sessionId || await foregroundSession();
    if (!id || /^family[_-]/.test(id)) return {ok: false, error: '请先在电脑上选择 Dot 会话。'};
    if (pending.has(id)) return {ok: false, error: '本会话正在回复，请稍后再试。'};
    pending.add(id);
    try {
      const selected = sessionId ? prepared ?? await scope(id) : null;
      if (sessionId && (!selected || selected.row?.state === 'handled' || getPrebakeMetadata(id)?.hidden)) return stale();
      const cancelled = AbortSignal.any([lifecycle, AbortSignal.timeout(120_000), ...(signal ? [signal] : [])].filter(Boolean));
      const getAgent = () => ctx.get('agents', false)?.get?.(id);
      let agent = getAgent();
      if (!agent && native && !prepared) return {ok: false, status: 404, fallbackHeadless: true};
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
      function recordAdmission(message) {
        mobileAdmissions.set(message.id, id);
        if (mobileAdmissions.size > 200) mobileAdmissions.delete(mobileAdmissions.keys().next().value);
      }
      const message = native ? null : createUserMessage({content: [{type: 'text', text}], source: {kind: 'user'}});
      if (message) recordAdmission(message);
      const followLifetime = new AbortController();
      const followSignal = AbortSignal.any([cancelled, followLifetime.signal]);
      let follow;
      if (native) {
        follow = (await native.stream('session', 'follow', {request: {address: {kind: 'session', sessionId: id},
          maxMessages: 1, assistantStream: true}}, followSignal))[Symbol.asyncIterator]();
        try {
          if ((await follow.next()).value?.type !== 'snapshot') {
            followLifetime.abort();
            await follow.return?.();
            return stale();
          }
        } catch (error) {
          followLifetime.abort();
          void follow.return?.().catch(() => {});
          throw error;
        }
      }
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
          followLifetime.abort();
          for (const dispose of disposers) if (typeof dispose === 'function') dispose();
          resolve(result);
        };
        const abort = () => finish({ok: false, error: '等候回复已结束，可打开原会话查看进展。'});
        const matchesInput = input => native ? input?.source?.rpcId === operationId : input?.id === message.id;
        if (native) disposers.push(ctx.on('agent/inbox/inserted', payload => {
          if (payload?.agent === agent && matchesInput(payload.message)) recordAdmission(payload.message);
        }));
        disposers.push(ctx.on('agent/inbox/claimed', payload => {
          if (payload?.agent !== agent || !Number.isSafeInteger(payload.turn)) return;
          if (matchesInput(payload.message)) {
            turn = payload.turn;
            mixed ||= competingTurns.has(turn);
          } else {
            competingTurns.add(payload.turn);
            mixed ||= payload.turn === turn;
          }
        }));
        const consumeAssistantFrame = frame => {
          if (turn === null || !frame) return;
          if (!inScope() || mixed) return finish(stale());
          if (frame.type === 'start' && frame.turn === turn) {
            attempt = {id: frame.attemptId, revision: frame.revision, text: ''};
          } else if (frame.type === 'chunk' && attempt?.id === frame.attemptId &&
            attempt.revision === frame.revision && frame.chunk?.type === 'text-delta' &&
            typeof frame.chunk.text === 'string' && frame.chunk.text) {
            emitText(!attempt.text && completed.length ? `\n${frame.chunk.text}` : frame.chunk.text);
            attempt.text += frame.chunk.text;
          }
        };
        const consumeSessionEvent = event => {
          if (turn === null || event?.data?.turn !== turn) return;
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
        };
        if (!native) {
          disposers.push(ctx.on('agent/assistant-stream', ({agent: source, frame} = {}) => {
            if (source === agent) consumeAssistantFrame(frame);
          }));
          disposers.push(ctx.on('session/event', (session, event) => {
            if (session === agent.session) consumeSessionEvent(event);
          }));
        }
        cancelled.addEventListener('abort', abort, {once: true});
        if (!inScope()) return abort();
        if (native) {
          nativeRequests.set(operationId, id);
          void (async () => {
            while (!settled) {
              const next = await follow.next();
              if (next.done) break;
              if (next.value?.type === 'assistant-stream') consumeAssistantFrame(next.value.frame);
              if (next.value?.type === 'event') consumeSessionEvent(next.value.event);
            }
            if (!settled) finish(stale());
          })().catch(() => finish(stale())).finally(() => follow.return?.()).catch(() => {});
          void native.invoke('session', 'prompt', {request: {sessionId: id, requestId: operationId,
            mode: 'queue', content: [{type: 'text', text}]}}, cancelled).then(result => {
            if (result?.accepted !== true) finish(stale());
          }).catch(() => finish(stale()));
        } else {
          try { agent.followup(message); } catch { finish(stale()); }
        }
      });
      if (!inScope()) return stale();
      await waitForLedger();
      return inScope() ? result : stale();
    } catch {
      return stale();
    } finally {
      pending.delete(id);
      nativeRequests.delete(operationId);
    }
  }

  async function gatewaySession(sessionId, signal) {
    const foregroundId = await foregroundSession();
    const id = sessionId || foregroundId;
    if (typeof id !== 'string' || /^family[_-]/.test(id) || getPrebakeMetadata(id)?.hidden) return null;
    const selected = id === foregroundId ? null : await scope(id);
    if (id !== foregroundId && (!selected || selected.row.state === 'handled')) return null;
    const allowed = async () => {
      if (signal?.aborted || lifecycle?.aborted || getPrebakeMetadata(id)?.hidden) return false;
      if (!selected) return await foregroundSession() === id;
      const agent = ctx.get('agents', false)?.get?.(id);
      return workspaceAccess.authorizeSync(selected.snapshot) && !await isForeground(id) &&
        (!agent || grantForCwd(effectiveCwd(ctx, agent), selected.snapshot.grants)?.root === selected.grant.root);
    };
    const header = await nativeHeader(id, signal);
    if (!header || (selected && grantForCwd(header.cwd, selected.snapshot.grants)?.root !== selected.grant.root) ||
      !await allowed()) return null;
    const live = ctx.get('agents', false)?.get?.(id);
    return {id, allowed, needs: selected?.row.needs, cwd: header.cwd, foreground: !selected,
      live: live?.id === id && live.session?.id === id};
  }

  async function createGatewaySession({cwd, signal}) {
    const snapshot = await workspaceAccess.capture();
    const grant = grantForCwd(cwd, snapshot.grants);
    const api = controller();
    if (!grant || cwd !== grant.root || snapshot.contextMode !== 'full_local' ||
      typeof api?.create !== 'function' || realpathSync(cwd) !== cwd) return null;
    const id = `dot-mobile-${randomUUID()}`;
    const allowed = () => !signal?.aborted && !lifecycle?.aborted && workspaceAccess.authorizeSync(snapshot);
    await workspaceAccess.assertCurrent(snapshot);
    if (!allowed() || !await canRun()) return null;
    const created = await api.create({sessionId: id, cwd, agentPreset: 'standard'}, signal);
    if (created?.sessionId !== id || !allowed()) return null;
    return {id, cwd, allowed, prepared: {grant, snapshot}};
  }

  const gateway = createNativeMuseGateway({ctx, lifecycle, canRun, gatewaySession, createSession: createGatewaySession, ledger, streamChat});
  return {snapshot, readSession, readForegroundMessages, act, desktopAct, desktopUndo, streamChat, artifactFor, gateway,
    isMobileAdmission: (id, messageId, requestId) => mobileAdmissions.get(messageId) === id || nativeRequests.get(requestId) === id};
}
