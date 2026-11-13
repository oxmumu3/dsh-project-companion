/** Today-page actions: say, card actions, and "let Dot handle it".
 *
 * Every card action carries an opaque `cardId` derived from the session, its
 * ledger revision and its visible state. A stale card (a newer session or a
 * changed revision) cannot act on whatever happens to be newest now. Dispatch
 * claims a per-promise key atomically before creating a session, so a double
 * click or two concurrent callers cannot create two sessions.
 */
import {createHash, randomUUID} from 'node:crypto';
import {projectPublicId} from './session-ledger.js';

const PROJECT_ID = /^project_[a-f0-9]{24}$/;
const ACTIONS = new Set(['approve', 'retry', 'snooze', 'handled', 'handled-all', 'dispatch', 'open', 'undo', 'sample-clear']);
const UNDO_TTL_MS = 2 * 60 * 1000;
const clean = value => typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim() : '';
const cardIdOf = row => createHash('sha256').update(`${row.sessionId}\n${row.revision}\n${row.state}`).digest('hex').slice(0, 32);

export function createTodayController({ledger, reader, foregroundSession = async () => null, foregroundBusy = async () => false, promptSession, createSession, approvals = null, defaultRoot = async () => null, authorizeRoot = async () => true, diagnose = null, links = null, clock = () => new Date(), isClosed = () => false} = {}) {
  if (!ledger?.internal || !ledger?.setState || typeof promptSession !== 'function') throw new Error('Today controller needs a ledger and a foreground prompt');
  const now = () => new Date(clock());
  // Undo is deliberately short-lived and server-owned: the page never gets a
  // session id or a state it can replay against another project by hand.
  const undoTokens = new Map();
  const pruneUndo = at => { for (const [token, row] of undoTokens) if (at - row.at > UNDO_TTL_MS) undoTokens.delete(token); };
  const rememberUndo = (row, at, producedRevision, producedState) => {
    pruneUndo(at);
    const token = randomUUID();
    undoTokens.set(token, {sessionId: row.sessionId, root: row.root, previous: row.state, produced: producedState, revision: producedRevision, at});
    return token;
  };

  async function projectScope(projectId) {
    const state = await ledger.internal();
    const rows = state.sessions
      .filter(row => projectPublicId(row.root) === projectId)
      .sort((a, b) => Date.parse(b.lastEventAt) - Date.parse(a.lastEventAt));
    // Every action passes the current workspace authorization again: a card
    // left over from before a revocation cannot read or mutate that project.
    const allowed = [];
    for (const row of rows) { try { if (await authorizeRoot(row.root) === true) allowed.push(row); } catch { /* revoked */ } }
    return {rows: allowed, total: rows.length};
  }

  async function rowForCard(projectId, cardId, scope = null) {
    if (typeof cardId !== 'string' || !/^[a-f0-9]{32}$/.test(cardId)) return null;
    const rows = (scope ?? await projectScope(projectId)).rows;
    return rows.find(row => cardIdOf(row) === cardId) ?? null;
  }

  return {
    async say(input = {}) {
      if (isClosed()) return {ok: false, error: 'Dot 已关闭。'};
      const text = clean(input.text);
      if (!text || text.length > 4000) return {ok: false, error: '这句话是空的或太长了，没有发送。'};
      const sessionId = await foregroundSession();
      if (!sessionId) return {ok: false, fallback: 'stage_draft', error: '还没有可用的前台会话，已把这句话留在输入里。'};
      let busy = false;
      try { busy = await foregroundBusy(sessionId) === true; } catch { busy = false; }
      // The foreground can switch while busy is awaited. Never steer the old
      // session after the user moved to another one; keep the words for the
      // composer fallback instead.
      let currentForeground = null;
      try { currentForeground = await foregroundSession(); } catch { currentForeground = null; }
      if (currentForeground !== sessionId) return {ok: false, fallback: 'stage_draft', foregroundChanged: true, sessionId: currentForeground ?? null, error: '前台会话已经切换，原话留在输入里。'};
      try {
        await promptSession(sessionId, text, {steer: busy});
        return {
          ok: true,
          sessionId,
          mode: busy ? 'steer' : 'queue',
          text: busy ? '收到，我插一句。' : '收到，我去办。',
          at: now().toISOString(),
        };
      } catch (error) {
        if (error?.code === 'HOST_PROMPT_UNSUPPORTED') return {ok: false, fallback: 'stage_draft', sessionId, error: '这个宿主没有可用的投递入口，已把这句话留在输入里。'};
        return {ok: false, sessionId, error: '这句话没有发出去；没有自动重试。', code: typeof error?.code === 'string' ? error.code : 'SAY_FAILED'};
      }
    },

    async item(input = {}) {
      if (isClosed()) return {ok: false, error: 'Dot 已关闭。'};
      const action = clean(input.action);
      if (!ACTIONS.has(action)) return {ok: false, error: '不认识这个动作；没有执行。'};
      if (action === 'sample-clear') return {ok: true, text: '示例数据已清空。'};
      if (action === 'dispatch') return this.promise({promiseId: input.promiseId});
      if (action === 'undo') {
        const token = clean(input.undoId);
        const record = token ? undoTokens.get(token) : null;
        if (!record) return {ok: false, error: '这次撤销已经过期；没有改动。', expired: true};
        if (now().getTime() - record.at > UNDO_TTL_MS) { undoTokens.delete(token); return {ok: false, error: '这次撤销已经过期；没有改动。', expired: true}; }
        if (await authorizeRoot(record.root) !== true) return {ok: false, revoked: true, error: '这个文件夹的授权已经收回；没有改动。'};
        const state = await ledger.internal();
        const row = state.sessions.find(item => item.sessionId === record.sessionId && item.root === record.root);
        // The token is bound to the exact row revision and state produced by the
        // action that minted it. A newer snooze/handled on the same row changes
        // both, so an older token cannot undo a later action.
        if (!row || row.state !== record.produced || row.revision !== record.revision) {
          undoTokens.delete(token);
          return {ok: false, stale: true, error: '这张卡片已经变化；没有撤销后来的操作。'};
        }
        const restore = typeof ledger.restoreState === 'function' ? ledger.restoreState.bind(ledger) : ledger.setState.bind(ledger);
        const result = await restore(row.sessionId, record.previous, {root: record.root, state: record.produced, revision: record.revision});
        if (!result.changed) return {ok: false, stale: true, error: '这张卡片已经变化；没有改动。'};
        undoTokens.delete(token);
        return {ok: true, text: '已经撤销。', sessionId: row.sessionId};
      }
      const projectId = clean(input.projectId);
      if (!PROJECT_ID.test(projectId)) return {ok: false, error: '项目标识无效；没有执行。'};
      const scope = await projectScope(projectId);
      if (scope.total > 0 && scope.rows.length === 0) return {ok: false, revoked: true, error: '这个项目的授权已经收回；没有执行任何动作。'};
      if (action === 'handled-all') {
        // The batch belongs to the "done" group only. Waiting and stuck rows
        // in the same project still need the user and must not be swept in.
        const done = scope.rows.filter(row => row.state === 'done');
        for (const row of done) await ledger.setState(row.sessionId, 'handled');
        return {ok: true, text: `已经把 ${done.length} 件做完的标记为处理过`};
      }
      const row = await rowForCard(projectId, clean(input.cardId), scope);
      if (!row) return {ok: false, error: '这张卡片已经过期；没有操作任何会话。请刷新今天页。', stale: true};
      if (action === 'open' || action === 'talk') {
        return {ok: true, openSession: true, sessionId: row.sessionId, text: '已打开这个会话。'};
      }
      try {
        if (action === 'handled' || action === 'snooze') {
          const produced = action === 'handled' ? 'handled' : 'snoozed';
          const result = await ledger.setState(row.sessionId, produced, row);
          if (!result.changed) return {ok: false, stale: true, error: '这张卡片已经不在首屏；没有改动。'};
          const producedRevision = result.rowRevision ?? row.revision + 1;
          const undoId = rememberUndo(row, now().getTime(), producedRevision, produced);
          return {ok: true, text: action === 'handled' ? '已标记为处理过，可撤销' : '已放到稍后，可撤销', sessionId: row.sessionId, undoId};
        }
        if (action === 'retry') {
          if (row.state !== 'stuck' && row.state !== 'needs_you') return {ok: false, stale: true, error: '这件已经不在卡住状态；没有投递重试。'};
          await promptSession(row.sessionId, '刚才那一步出错了。请先看错误信息，再用同样的要求重试一次；不要换目标。', {steer: row.state === 'doing'});
          return {ok: true, text: '已经告诉它重试；结果回到账本后这里才会变。', sessionId: row.sessionId};
        }
        // approve: only when the host really exposes an approval decision.
        // The native approval card and this button race; whoever answers first
        // wins and a late loser must not look like a successful approval.
        const decision = approvals?.decide ?? approvals?.resolve ?? approvals?.respond;
        const approvalId = row.needs?.id;
        if (row.state !== 'needs_you' || !approvalId) return {ok: false, stale: true, error: '这件已经不需要批准；没有动作。'};
        if (typeof decision === 'function') {
          try {
            const value = await decision.call(approvals, approvalId, 'allow-once');
            if (value === true || value?.ok === true) return {ok: true, text: '已发出，等它接', pending: true, sessionId: row.sessionId};
          } catch { /* fall through to the documented fallback */ }
        }
        return {ok: false, fallback: 'open_session', sessionId: row.sessionId, text: '这个宿主还不支持在这里批准，已帮你打开会话。'};
      } catch (error) {
        return {ok: false, error: '操作结果待核对；没有自动重试。', code: typeof error?.code === 'string' ? error.code : 'ITEM_FAILED'};
      }
    },

    /** Authorized counts and coverage flags; raw cursors and records stay in the adapters. */
    async metrics() {
      if (isClosed()) return {ok: false, error: 'Dot 已关闭。'};
      if (typeof reader?.refreshNow === 'function') await reader.refreshNow();
      const allStats = typeof reader?.metrics === 'function' ? reader.metrics() : {};
      const cache = reader?.snapshot?.() ?? {sources: []};
      // Metrics follow the same authorization and identity filter as the
      // projection: a switched-off or changed account returns no old numbers.
      const current = new Set(cache.sources.map(row => row.id));
      const metrics = Object.fromEntries(Object.entries(allStats).filter(([id]) => current.has(id)));
      const runProbe = async (source, name) => {
        if (typeof diagnose !== 'function') return {available: false, reason: 'no_diagnose'};
        try { return await diagnose(source, name); } catch (error) { return {available: false, code: typeof error?.code === 'string' ? error.code : 'DIAGNOSE_FAILED'}; }
      };
      const calendarProbe = await runProbe('calendar', 'updated_min');
      const gmailProbe = await runProbe('gmail', 'history');
      return {
        ok: true,
        sources: cache.sources,
        metrics,
        probes: {
          calendar: {
            nextSyncToken: metrics.calendar?.lastPageHasNextSyncToken === true,
            updatedMin: calendarProbe.available === true
              ? {
                ok: calendarProbe.ok === true,
                httpStatus: calendarProbe.httpStatus ?? null,
                count: calendarProbe.count ?? 0,
                ...(Number.isInteger(calendarProbe.sampleLimit) ? {sampleLimit: calendarProbe.sampleLimit} : {}),
                hasMore: calendarProbe.hasMore === true,
              }
              : {available: false, code: calendarProbe.code ?? calendarProbe.reason ?? null},
          },
          gmail: gmailProbe.available === true
            ? {
              historyId: gmailProbe.historyId === true,
              historyList: gmailProbe.historyList === true,
              count: gmailProbe.count ?? 0,
              hasMore: gmailProbe.hasMore === true,
              profileStatus: gmailProbe.profileStatus ?? null,
              historyStatus: gmailProbe.historyStatus ?? null,
            }
            : {available: false, code: gmailProbe.code ?? gmailProbe.reason ?? null},
          accountId: {available: false, reason: 'credential_fingerprint_is_not_an_account_id'},
        },
        generatedAt: now().toISOString(),
      };
    },

    async promise(input = {}) {
      if (isClosed()) return {ok: false, error: 'Dot 已关闭。'};
      const promiseId = clean(input.promiseId);
      const row = (reader?.snapshot?.().promises ?? []).find(item => item.id === promiseId);
      if (!row) return {ok: false, error: '这条诺言已经不在当前列表；没有派工。'};
      const key = `${row.source}:${row.sourceItemId}`;
      const duplicateOf = async existing => {
        if (!existing) return null;
        if (await authorizeRoot(existing.root) !== true) return {ok: false, revoked: true, error: '这个文件夹的授权已经变化；没有重复派工。'};
        if (existing.sessionId) return {ok: false, duplicate: true, pending: existing.state === 'pending', sessionId: existing.sessionId, text: existing.state === 'pending' ? '这一件已经建好会话，等对账；没有重复建。' : '这一件已经派出去了。'};
        if (existing.state === 'pending') return {ok: false, duplicate: true, pending: true, text: '这一件正在派出，没有重复建会话。'};
        return null;
      };
      if (links?.linkOf) {
        const existing = await links.linkOf(key);
        const duplicate = await duplicateOf(existing);
        if (duplicate) return duplicate;
      }
      const root = await defaultRoot();
      if (!root) return {ok: false, error: '还没有可派工的已授权文件夹；没有建会话。'};
      if (await authorizeRoot(root) !== true) return {ok: false, revoked: true, error: '这个文件夹的授权已经变化；没有建会话。'};
      const token = randomUUID();
      // Persist the exact, pre-generated session id at claim time. If create
      // succeeds but settle fails (or the process dies), the next click sees
      // this pending id and cannot create a second session.
      const proposedSessionId = `session-dot-${randomUUID()}`;
      if (links?.claimLink) {
        const claim = await links.claimLink(key, root, token, {sessionId: proposedSessionId});
        if (!claim?.changed) {
          const duplicate = await duplicateOf(await links.linkOf(key));
          return duplicate ?? {ok: false, duplicate: true, text: '这一件已经派出去了。'};
        }
      }
      // Re-check workspace and source after the claim, before creating anything.
      if (await authorizeRoot(root) !== true) {
        if (links?.releaseLink) await links.releaseLink(key, token);
        return {ok: false, revoked: true, error: '这个文件夹的授权已经变化；没有建会话。'};
      }
      const current = (reader?.snapshot?.().promises ?? []).find(item =>
        item.id === promiseId && item.source === row.source && item.sourceItemId === row.sourceItemId &&
        item.what === row.what && item.when === row.when);
      if (!current) {
        if (links?.releaseLink) await links.releaseLink(key, token);
        return {ok: false, stale: true, error: '这条诺言已变化或无法读取；没有派工。'};
      }
      try {
        const text = `请处理这件已经答应的事：${current.what}。做完告诉我结果和还需要我决定的事。`;
        const sessionId = await createSession({root, text, sessionId: proposedSessionId});
        // Bind the host's actual id first; settle records the completed state.
        if (links?.bindLink && sessionId !== proposedSessionId) {
          try { await links.bindLink(key, token, {sessionId, root}); } catch { /* settle can still record the actual ID */ }
        }
        if (links?.settleLink) {
          try {
            await links.settleLink(key, token, {sessionId, root});
          } catch {
            return {ok: true, pending: true, sessionId, promiseId, root, text: '会话已经建好，派工记录待对账；没有重复建会话。'};
          }
        }
        return {ok: true, text: '已经派出去了；它接到消息后这里会变色。', sessionId, promiseId, root};
      } catch (error) {
        const createdSessionId = typeof error?.createdSessionId === 'string' ? error.createdSessionId : null;
        if (createdSessionId) {
          // The session exists even though delivery failed. Keep the claim and
          // the accurate id; a second click must not create another session.
          try { await links?.bindLink?.(key, token, {sessionId: createdSessionId, root}); } catch { /* keep claim */ }
          try { await links?.settleLink?.(key, token, {sessionId: createdSessionId, root}); } catch { /* pending */ }
          return {ok: true, pending: true, sessionId: createdSessionId, promiseId, root, text: '会话已经建好，消息投递待核对；没有重复建会话。'};
        }
        if (links?.releaseLink) await links.releaseLink(key, token);
        return {ok: false, error: '会话没有建出来；没有重复派工。', code: typeof error?.code === 'string' ? error.code : 'PROMISE_FAILED'};
      }
    },
  };
}

export function registerTodayRoutes(ctx, {controller, isClosed = () => false} = {}) {
  const connection = ctx.get('connection');
  if (typeof connection?.fetch?.register !== 'function') return null;
  const json = (value, status = 200) => Response.json(value, {status, headers: {'Cache-Control': 'no-store'}});
  const stops = [];
  let closed = false;
  const read = async request => {
    const text = await request.text();
    if (text.length > 65536) throw Object.assign(new Error('too large'), {code: 'BODY_TOO_LARGE'});
    const value = text ? JSON.parse(text) : {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Object.assign(new Error('invalid'), {code: 'BODY_INVALID'});
    return value;
  };
  const route = (path, handler) => {
    const unregister = connection.fetch.register({
      path, methods: ['POST'], requestBody: 'buffered',
      async fetch(request) {
        if (closed || isClosed()) return json({error: '今天页已关闭。'}, 503);
        if (request.method !== 'POST') return json({error: '仅支持 POST。'}, 405);
        try {
          const value = await read(request);
          return json(await handler(value));
        } catch (error) {
          if (error?.code === 'BODY_TOO_LARGE') return json({error: '请求太大了，没有执行。'}, 413);
          if (error?.code === 'BODY_INVALID' || error instanceof SyntaxError) return json({error: '请求格式不对，没有执行。'}, 400);
          return json({error: '动作没有完成；没有自动重试。'}, 503);
        }
      },
    });
    stops.push(unregister);
  };
  route('/api/project_companion/say', input => controller.say(input));
  route('/api/project_companion/item', input => controller.item(input));
  route('/api/project_companion/promise', input => controller.promise(input));
  route('/api/project_companion/metrics', () => controller.metrics());
  const stop = () => { if (closed) return; closed = true; for (const unregister of stops) { try { unregister?.(); } catch { /* already gone */ } } };
  if (typeof ctx.effect === 'function') ctx.effect(() => stop);
  return stop;
}
