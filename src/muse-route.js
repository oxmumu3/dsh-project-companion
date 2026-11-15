export function createMuseController({
  personalProfile,
  dailyDigest = null,
  superAgent = null,
  onChange = null,
  isClosed = () => false,
} = {}) {
  const buildSnapshot = async () => ({
    ok: true,
    profile: await personalProfile.snapshot(),
    digest: typeof dailyDigest?.desktopSummary === 'function' ? dailyDigest.desktopSummary() : null,
    superagent: typeof superAgent?.readSynergySnapshot === 'function'
      ? await superAgent.readSynergySnapshot()
      : { mode: 'standalone', available: false, ledgerRevision: 0, revision: 0, milestones: [], counts: { inReview: 0, blocked: 0, inProgress: 0, todo: 0, pending: 0 }, lastQueued: null },
  });

  const notify = async () => {
    try {
      await onChange?.();
    } catch {
      // Timer refresh is best-effort after state persistence succeeds.
    }
  };

  return {
    async snapshot() {
      if (isClosed()) return { ok: false, code: 'CLOSED', error: 'Dot 正在关闭，暂无法读取 Muse 状态。' };
      return buildSnapshot();
    },

    async act(input = {}) {
      if (isClosed()) return { ok: false, code: 'CLOSED', error: 'Dot 正在关闭，没有执行这项修改。' };
      const action = typeof input?.action === 'string' ? input.action.trim() : '';
      let result;

      if (action === 'profile_set_trait') {
        result = await personalProfile.setTrait({
          id: input.id,
          category: input.category,
          label: input.label,
          value: input.value,
        });
      } else if (action === 'profile_remove_trait') {
        result = await personalProfile.removeTrait({
          id: input.id,
          category: input.category,
          label: input.label,
        });
      } else if (action === 'profile_add_note') {
        result = await personalProfile.addNote({
          text: input.text,
          category: input.category,
          source: input.source,
        });
      } else if (action === 'profile_delete_note') {
        result = await personalProfile.deleteNote({ id: input.id });
      } else if (action === 'profile_undo') {
        result = await personalProfile.undo({ token: input.token });
      } else if (action === 'rhythm_configure') {
        if (typeof dailyDigest?.configureRhythm !== 'function') {
          result = { ok: false, code: 'UNAVAILABLE', error: '当前早报节律服务暂不可用。' };
        } else {
          result = await dailyDigest.configureRhythm(input);
        }
      } else if (action === 'superagent_pending') {
        if (typeof superAgent?.enqueuePending !== 'function') {
          result = { ok: false, code: 'UNAVAILABLE', error: '当前未挂载 SuperAgent 协同队列。' };
        } else {
          result = await superAgent.enqueuePending({
            text: input.text,
            title: input.title,
            workspacePath: input.workspacePath,
            workspaceId: input.workspaceId,
          });
        }
      } else {
        return { ok: false, code: 'UNKNOWN_ACTION', error: '不支持这项操作，没有改动任何内容。' };
      }

      if (result?.ok) await notify();
      const state = await buildSnapshot();
      return { ...state, ...result };
    },
  };
}

export function registerMuseRoute(ctx, { controller, isClosed = () => false } = {}) {
  const connection = ctx.get('connection');
  if (typeof connection?.fetch?.register !== 'function') return null;
  const json = (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
  let closed = false;

  const isSameOrigin = request => {
    const fetchSite = request?.headers?.get?.('sec-fetch-site');
    if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'same-site' && fetchSite !== 'none') {
      return false;
    }
    return true;
  };

  const readBody = async request => {
    const text = await request.text();
    if (text.length > 65536) throw Object.assign(new Error('too large'), { code: 'BODY_TOO_LARGE' });
    const value = text ? JSON.parse(text) : {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw Object.assign(new Error('invalid'), { code: 'BODY_INVALID' });
    }
    return value;
  };

  const unregister = connection.fetch.register({
    path: '/api/project_companion/muse',
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    async fetch(request) {
      if (closed || isClosed()) return json({ ok: false, error: 'Dot Muse 已关闭。' }, 503);
      if (!isSameOrigin(request)) return json({ ok: false, error: '拒绝跨站请求。' }, 403);
      if (request.method === 'GET') {
        try {
          return json(await controller.snapshot());
        } catch {
          return json({ ok: false, error: '暂时读不到 Muse 状态。' }, 503);
        }
      }
      if (request.method !== 'POST') return json({ ok: false, error: '仅支持 GET 或 POST。' }, 405);
      try {
        const input = await readBody(request);
        const res = await controller.act(input);
        return json(res, res?.code === 'UNKNOWN_ACTION' ? 400 : 200);
      } catch (error) {
        if (error?.code === 'BODY_TOO_LARGE') return json({ ok: false, error: '请求太大了，没有执行。' }, 413);
        if (error?.code === 'BODY_INVALID' || error instanceof SyntaxError) {
          return json({ ok: false, error: '请求格式不对，没有执行。' }, 400);
        }
        return json({ ok: false, error: '操作没有完成，没有自动重试。' }, 503);
      }
    },
  });

  const stop = () => {
    if (closed) return;
    closed = true;
    try {
      unregister?.();
    } catch {
      // Already unregistered on teardown.
    }
  };
  if (typeof ctx.effect === 'function') ctx.effect(() => stop);
  return stop;
}
