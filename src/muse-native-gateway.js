import {z} from 'zod';

const noResult = {ok: false, error: '桌面会话状态已变化，请刷新后再试。'};
const unavailable = {ok: false, status: 503, fallbackHeadless: true, error: '桌面会话服务不可用。'};
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validId = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 200;
const timingFields = {after_seconds: 'after', at: 'at', every_seconds: 'every', daily: 'daily', weekly: 'weekly', cron: 'cron', rrule: 'rrule'};
const createRequest = z.object({title: z.string().trim().min(1).max(120), prompt: z.string().min(1).max(20_000)
  .refine(text => Boolean(text.trim()))});
const questionAnswer = z.object({answers: z.array(z.object({id: z.string().min(1).max(200),
  selected: z.array(z.string()).max(100), custom: z.string().max(20_000).optional()}).strict()).min(1).max(100)}).strict();

function scheduleInput(input) {
  const request = input.request ?? input.schedule;
  if (!isRecord(request)) return null;
  const details = createRequest.safeParse(request);
  const typed = isRecord(request.timing);
  const source = typed ? request.timing : request;
  const selectors = Object.keys(timingFields).filter(key => Object.hasOwn(source, key));
  if (!details.success || selectors.length !== 1) return null;
  const selector = selectors[0];
  const kind = timingFields[selector];
  if (typed && (source.kind !== kind || Object.keys(source).length !== 2)) return null;
  const sessionId = input.sessionId ?? request.sessionId ?? request.target?.sessionId;
  if (sessionId != null && !validId(sessionId)) return null;
  if (request.target && (!isRecord(request.target) || request.target.kind !== 'session' ||
    request.target.sessionId !== sessionId || Object.keys(request.target).length !== 2)) return null;
  return {sessionId, request: {...details.data, timing: {kind, [selector]: source[selector]}}};
}

function questionInput(input) {
  const callId = input.callId ?? input.questionId ?? input.requestId;
  const result = questionAnswer.safeParse(input.answer ?? (Array.isArray(input.answers) ? {answers: input.answers} : null));
  if (!validId(callId) || !result.success) return null;
  return {callId, answer: result.data};
}

export function createNativeMuseGateway({ctx, lifecycle, canRun, gatewaySession, createSession, ledger, streamChat}) {
  const service = key => ctx.get(key, false) ?? ctx.root?.get?.(key, false);
  let ownerPeer;
  let peerPromise;

  function peer() {
    if (ownerPeer || lifecycle?.aborted) return Promise.resolve(ownerPeer);
    peerPromise ??= (async () => {
      const options = {principal: {kind: 'owner'}, interactions: 'answer'};
      const connection = service('connection');
      if (typeof connection?.createPeer === 'function') return connection.createPeer(options);
      const sdk = await import('@deepseek-ai/dsh-client-connection').catch(() => null);
      const Peer = sdk?.Peer ?? sdk?.OperatorPeer;
      return typeof Peer === 'function' ? new Peer(ctx, options) : null;
    })().then(async candidate => {
      if (lifecycle?.aborted) await candidate?.dispose?.();
      else ownerPeer = candidate;
      return ownerPeer;
    }).catch(() => null).finally(() => { peerPromise = null; });
    return peerPromise;
  }

  lifecycle?.addEventListener('abort', () => {
    void Promise.resolve().then(() => ownerPeer?.dispose?.()).catch(() => {});
  }, {once: true});

  async function native() {
    const gateway = service('typertGateway');
    if (typeof gateway?.invoke !== 'function' || typeof gateway.stream !== 'function' || lifecycle?.aborted) return null;
    const owner = await peer();
    if (!owner || lifecycle?.aborted) return null;
    return {
      gateway, owner,
      invoke: (namespace, method, args, signal) => gateway.invoke({namespace, method, args, signal, peer: owner}),
      stream: (namespace, method, args, signal) => gateway.stream({namespace, method, args, signal, peer: owner}),
    };
  }

  async function pendingProjection(api, signal) {
    try {
      const stream = await api.stream('session', 'control', {}, signal);
      for await (const frame of stream) {
        return frame?.type === 'baseline' && isRecord(frame.value?.projections) ? frame.value.projections : {};
      }
    } catch { /* Ledger evidence is still available when this service does not expose Control. */ }
    return {};
  }

  async function health() {
    const api = await native();
    if (!api) return unavailable;
    const timeout = AbortSignal.timeout(750);
    const signal = lifecycle ? AbortSignal.any([lifecycle, timeout]) : timeout;
    const [projections, rows] = await Promise.all([
      pendingProjection(api, signal), ledger.internal().then(value => value.sessions ?? []).catch(() => []),
    ]);
    const pending = new Map();
    function add(value) {
      const key = JSON.stringify([value.sessionId, value.callId ?? value.approvalId ?? value.id]);
      pending.set(key, {...value, state: 'needs_user_input'});
    }
    for (const row of rows) {
      if (row.state === 'needs_you' && row.needs?.kind === 'approval') {
        const {id, callId} = row.needs;
        add({sessionId: row.sessionId, id: id ?? callId ?? 'approval', approvalId: id, callId, kind: 'approval'});
      }
    }
    for (const [sessionId, projection] of Object.entries(projections)) {
      for (const question of Array.isArray(projection.values?.userQuestions?.active) ? projection.values.userQuestions.active : []) {
        if (!validId(question?.callId) || !['open', 'continued'].includes(question.state)) continue;
        add({sessionId, id: question.callId, callId: question.callId, kind: 'question', questionState: question.state});
      }
    }
    for (const row of api.gateway.getPendingRemoteEvents?.() ?? []) {
      if (!validId(row?.agentId) || !['approval/request', 'user-questions/request'].includes(row.event)) continue;
      const kind = row.event === 'approval/request' ? 'approval' : 'question';
      if (![...pending.values()].some(item => item.sessionId === row.agentId && item.kind === kind)) {
        add({sessionId: row.agentId, id: row.event, kind});
      }
    }
    const scoped = await Promise.all([...pending.values()].slice(0, 100).map(async item => {
      try { return (await gatewaySession(item.sessionId, signal))?.live ? item : null; }
      catch { return null; }
    }));
    const pendingInput = scoped.filter(Boolean);
    return {ok: true, pendingInput, needsInputSessionIds: [...new Set(pendingInput.map(row => row.sessionId))]};
  }

  async function preflight(route, input, signal) {
    if (!await canRun()) return {ok: false, status: 409, error: 'Dot 已暂停，请先恢复。'};
    if (route === 'schedule') {
      if (!scheduleInput(input)) return {ok: false, status: 400, error: '请提供有效的例行设置。'};
      return typeof service('schedule')?.create === 'function' ? null : unavailable;
    }
    if (route === 'prompt' && (typeof input.text !== 'string' || !input.text.trim() ||
      (input.sessionId != null && !validId(input.sessionId)) ||
      (input.cwd != null && (typeof input.cwd !== 'string' || !input.cwd.startsWith('/'))))) {
      return {ok: false, status: 400, error: '请提供会话与消息。'};
    }
    if (route === 'control' && (!validId(input.sessionId) || !['interrupt', 'approve', 'reject', 'deny'].includes(input.action))) {
      return {ok: false, status: 400, error: '请选择可用的会话操作。'};
    }
    if (route === 'answer' && (!validId(input.sessionId) || !questionInput(input))) {
      return {ok: false, status: 400, error: '缺少问题或回答。'};
    }
    if (!await native()) return unavailable;
    if (route === 'prompt' && (input.sessionId || !input.cwd)) {
      const target = await gatewaySession(input.sessionId, signal);
      if (!target) return {ok: false, status: 404, error: '当前会话不可访问。'};
      if (!target.live) return {...unavailable, status: 404};
    }
    return null;
  }

  async function prompt({sessionId, cwd, text, operationId, signal, onEvent}) {
    const api = await native();
    if (!api) return unavailable;
    if (!await canRun()) return noResult;
    const selected = !sessionId && cwd ? await createSession?.({cwd, signal}) : await gatewaySession(sessionId, signal);
    if (!selected || !await selected.allowed()) return noResult;
    const reply = await streamChat({sessionId: selected.foreground ? null : selected.id,
      text, onEvent, signal, operationId, native: api, prepared: selected.prepared});
    return {...reply, sessionId: selected.id, cwd: selected.cwd};
  }

  async function settleRemoteEvent(api, selected, signal, match, value) {
    if (typeof api.gateway.wireStream?.open !== 'function' || typeof api.gateway.dispatchRpc !== 'function') return noResult;
    const timeout = AbortSignal.any([signal, AbortSignal.timeout(2_000)]);
    const stream = await api.gateway.wireStream.open('$events', {args: {}}, [], api.owner, timeout);
    let clientId;
    for await (const frame of stream) {
      if (frame.type === 'ready') clientId = frame.clientId;
      if (frame.type !== 'waterfall' || frame.agentId !== selected.id || !match(frame) || !validId(clientId)) continue;
      if (!await selected.allowed() || !await canRun()) return noResult;
      const result = await api.gateway.dispatchRpc('$events/result', {args: {clientId, eventId: frame.eventId,
        outcome: {kind: 'result', value}}}, timeout, api.owner);
      return result?.ok === true ? {ok: true, accepted: true} : noResult;
    }
    return noResult;
  }

  async function control({sessionId, action, callId, approvalId, signal}) {
    const api = await native();
    const selected = await gatewaySession(sessionId, signal);
    if (!api || !selected || !await selected.allowed() || !await canRun()) return noResult;
    if (action === 'interrupt') {
      const result = await api.invoke('session', 'cancel', {request: {sessionId}}, signal);
      return result?.accepted === true ? {ok: true, accepted: true} : noResult;
    }
    if (!['approve', 'reject', 'deny'].includes(action)) return noResult;
    const recorded = selected.needs;
    const targetId = callId ?? (recorded?.id === approvalId ? recorded?.callId : approvalId);
    if (!validId(targetId) && !validId(approvalId)) return noResult;
    return settleRemoteEvent(api, selected, signal, frame => frame.event === 'approval/request' && (
      (validId(targetId) && frame.request?.callId === targetId) || frame.eventId === approvalId
    ), action === 'approve' ? 'allowed-once' : 'rejected');
  }

  async function answer(input) {
    const {sessionId, signal} = input;
    const question = questionInput(input);
    const api = await native();
    const selected = await gatewaySession(sessionId, signal);
    if (!question || !api || !selected || !await selected.allowed() || !await canRun()) return noResult;
    const {callId, answer} = question;
    const result = await api.invoke('userQuestions', 'answer', {agentId: sessionId, callId, answer}, signal);
    if (result === true) return {ok: true, accepted: true};
    const wait = new AbortController();
    const waitSignal = AbortSignal.any([signal, wait.signal, AbortSignal.timeout(2_000)]);
    try {
      const stream = await api.stream('userQuestions', 'attachWait', {agentId: sessionId, callId}, waitSignal);
      for await (const frame of stream) {
        if (!Number.isFinite(frame?.remainingMs) || frame.remainingMs <= 0) return noResult;
        const ids = new Set(answer.answers.map(item => item.id));
        return await settleRemoteEvent(api, selected, waitSignal, event => event.event === 'user-questions/request' &&
          event.request?.wait?.callId === callId && Array.isArray(event.request.questions) &&
          ids.size === answer.answers.length && ids.size === event.request.questions.length &&
          event.request.questions.every(item => ids.has(item.id)), answer);
      }
      return noResult;
    } finally { wait.abort(); }
  }

  async function schedule(input) {
    const schedule = service('schedule');
    const value = scheduleInput(input);
    if (!value || !await canRun() || typeof schedule?.create !== 'function') return noResult;
    const selected = await gatewaySession(value.sessionId, input.signal);
    if (!selected || !await selected.allowed()) return noResult;
    const saved = await schedule.create({...value.request, target: {kind: 'session', sessionId: selected.id}}, selected.id, input.signal);
    return saved ? {ok: true, accepted: true, schedule: saved} : noResult;
  }

  return {preflight, health, prompt, control, answer, schedule};
}
