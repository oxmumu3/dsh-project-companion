const DIGEST_ROUTINE_ID = 'daily-digest';

export async function buildMuseMemorySnapshot({personalProfile, museIntelligence}) {
  const profile = await personalProfile.snapshot();
  const sourceItems = await museIntelligence?.readMemoryItems?.().catch(() => []) ?? [];
  return {profile, memoryItems: personalProfile.memoryItems?.(profile, sourceItems) ?? sourceItems};
}

function digestTimeLabel(at, timeZone) {
  if (typeof at !== 'string' || !Number.isFinite(Date.parse(at))) return '';
  const options = {month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false};
  try {
    return new Intl.DateTimeFormat('zh-CN', {...options, timeZone}).format(new Date(at));
  } catch {
    return new Intl.DateTimeFormat('zh-CN', {...options, timeZone: 'UTC'}).format(new Date(at));
  }
}

export function projectMuseDigest(summary) {
  if (!summary) return {digest: null, routines: []};
  const record = summary.lastDigest;
  const failed = summary.lastStatus === 'failed';
  const lastRunAt = failed ? summary.lastAttemptAt ?? null : record?.at ?? null;
  const time = digestTimeLabel(lastRunAt, summary.timeZone);
  const count = Array.isArray(record?.items) ? record.items.length : 0;
  const results = {
    quiet: '本次没有需要提醒的事项',
    sent: `已整理出 ${count} 项 · 已交给微信通道`,
    blocked: `已整理出 ${count} 项 · 投递被拦截`,
    uncertain: `已整理出 ${count} 项 · 投递结果待确认`,
  };
  const lastResultSummary = failed ? '本次整理未完成' : results[record?.status] ?? null;
  const lastReceipt = time && lastResultSummary ? `${time} ${lastResultSummary}` : null;
  const receipt = lastReceipt ? {lastReceipt} : {};
  const active = summary.enabled === true;
  const scheduleLabel = `每天 ${summary.dailyTime || '09:00'}`;
  return {
    digest: {...summary, ...receipt},
    routines: [{
      id: DIGEST_ROUTINE_ID,
      title: '晨间整理',
      triggerKind: 'daily',
      scheduleLabel,
      instruction: '整理待跟进事项与接下来的日程',
      notifyWeChat: summary.deliveryMode === 'wechat_and_desktop',
      active,
      lastRunAt,
      lastResultSummary,
      nextRunLabel: active ? scheduleLabel : null,
      ...receipt,
    }],
  };
}

export function createMuseController({
  personalProfile,
  dailyDigest = null,
  superAgent = null,
  museIntelligence = null,
  mobileCompanion = null,
  proactive = null,
  archiveProjectMemory = null,
  readPromises = () => [],
  readConnections = null,
  readSessionRows = null,
  changeDossier = null,
  undoDossier = null,
  changeConnector = null,
  onChange = null,
  isClosed = () => false,
} = {}) {
  const buildSnapshot = async () => {
    const [superagent, workspaceBrief, staleProjectMemories, mobile, connections, sessionRows, proactiveState] = await Promise.all([
      superAgent?.readSynergySnapshot?.() ??
        { mode: 'standalone', available: false, ledgerRevision: 0, revision: 0, milestones: [], counts: { inReview: 0, blocked: 0, inProgress: 0, todo: 0, pending: 0 }, lastQueued: null },
      museIntelligence?.readWorkspaceBrief?.().catch(() => null) ?? null,
      museIntelligence?.readStaleMemorySuggestions?.().catch(() => []) ?? [],
      mobileCompanion?.summary?.().catch(() => null) ?? null,
      readConnections?.() ?? {},
      readSessionRows?.() ?? {},
      proactive?.snapshot?.() ?? {},
    ]);
    return {
      ...connections,
      ...sessionRows,
      ...proactiveState,
      ok: true,
      ...await buildMuseMemorySnapshot({personalProfile, museIntelligence}),
      ...projectMuseDigest(dailyDigest?.desktopSummary?.()),
      superagent,
      workspaceBrief,
      staleProjectMemories,
      mobile,
    };
  };

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
          active: input.active,
          sourceKind: input.sourceKind,
          provenance: input.provenance,
          effect: input.effect,
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
          active: input.active,
          sourceKind: input.sourceKind,
          provenance: input.provenance,
          effect: input.effect,
        });
      } else if (action === 'profile_delete_note') {
        result = await personalProfile.deleteNote({ id: input.id });
      } else if (action === 'profile_undo') {
        result = await personalProfile.undo({ token: input.token });
      } else if (action === 'memory_item') {
        result = await personalProfile.mutateMemoryItem(input, {
          readSourceItems: () => museIntelligence?.readMemoryItems?.() ?? [],
        });
      } else if (action === 'flomo_memory_refresh') {
        result = await museIntelligence?.refreshFlomoMemory?.() ??
          {ok: false, code: 'UNAVAILABLE', error: 'flomo 记忆暂不可用。'};
      } else if (action === 'proactive_settings_update') {
        const {cadence, autoPrebake, dailyPrebakeCap, dailyPushCap, quietHours} = input.settings ?? input;
        const patch = Object.fromEntries(Object.entries({cadence, autoPrebake, dailyPrebakeCap, dailyPushCap, quietHours})
          .filter(([, value]) => value !== undefined));
        result = await personalProfile.updateProactiveSettings(patch);
      } else if (action === 'proactive_insight_act') {
        result = await proactive?.actInsight({id: input.id, operation: input.operation}) ??
          {ok: false, code: 'UNAVAILABLE', error: '轻提醒暂不可用。'};
      } else if (action === 'proactive_dream_run') {
        result = await proactive?.runDream({force: input.force === true}) ??
          {ok: false, code: 'UNAVAILABLE', error: '暂时无法复盘记忆。'};
      } else if (action === 'dossier_act') {
        result = await changeDossier?.({id: input.id, action: input.operation}) ??
          {ok: false, code: 'UNAVAILABLE', error: '事项操作暂不可用。'};
      } else if (action === 'dossier_undo') {
        result = await undoDossier?.({undoToken: input.undoToken}) ??
          {ok: false, code: 'UNAVAILABLE', error: '撤回事项操作暂不可用。'};
      } else if (action === 'connector_toggle') {
        result = await changeConnector?.({id: input.id, enabled: input.enabled, contextMode: input.contextMode}) ??
          {ok: false, code: 'UNAVAILABLE', error: '连接设置暂不可用。'};
      } else if (action === 'rhythm_configure' || action === 'routine_toggle') {
        if (typeof dailyDigest?.configureRhythm !== 'function') {
          result = { ok: false, code: 'UNAVAILABLE', error: '当前早报节律服务暂不可用。' };
        } else if (action === 'routine_toggle') {
          if (input.id !== DIGEST_ROUTINE_ID || typeof input.active !== 'boolean') {
            result = {ok: false, code: 'INVALID_ROUTINE', error: '找不到要修改的例行。'};
          } else {
            result = await dailyDigest.configureRhythm({enabled: input.active});
          }
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
      } else if (action === 'workspace_brief_refresh') {
        if (typeof museIntelligence?.readWorkspaceBrief !== 'function') {
          result = { ok: false, code: 'UNAVAILABLE', error: '当前工作区简报服务暂不可用。' };
        } else {
          const brief = await museIntelligence.readWorkspaceBrief(null, { force: true });
          result = {
            ok: true,
            workspaceBrief: brief,
            text: brief
              ? `刚重新读了一遍你勾选的 ${brief.workspaceCount} 个工作区。`
              : '还没有勾选关注的工作区文件夹。',
          };
        }
      } else if (action === 'promise_draft_save') {
        if (typeof museIntelligence?.savePromiseDraft !== 'function') {
          result = { ok: false, code: 'UNAVAILABLE', error: '草稿服务暂不可用。' };
        } else {
          const promises = typeof readPromises === 'function' ? readPromises() : [];
          result = museIntelligence.savePromiseDraft({
            promiseId: input.promiseId,
            text: input.text,
            baseWhat: input.what,
            baseWhen: input.when,
            baseFrom: input.from,
            currentPromises: promises,
          });
        }
      } else if (action === 'promise_draft_reset') {
        if (typeof museIntelligence?.resetPromiseDraft !== 'function') {
          result = { ok: false, code: 'UNAVAILABLE', error: '草稿服务暂不可用。' };
        } else {
          result = museIntelligence.resetPromiseDraft({ promiseId: input.promiseId });
        }
      } else if (action === 'mobile_pair_info' || action === 'mobile_pair_rotate') {
        if (typeof mobileCompanion?.pairInfo !== 'function') {
          result = { ok: false, code: 'UNAVAILABLE', error: '手机连接服务暂不可用。' };
        } else {
          result = await mobileCompanion.pairInfo({ rotate: action === 'mobile_pair_rotate' });
        }
      } else if (action === 'project_memory_archive_stale') {
        if (typeof archiveProjectMemory !== 'function') {
          result = { ok: false, code: 'UNAVAILABLE', error: '项目记忆归档服务暂不可用。' };
        } else {
          await archiveProjectMemory({ projectRoot: input.projectRoot, memoryId: input.memoryId });
          result = { ok: true, text: '已从项目记忆划掉这条已收口旧记录。' };
        }
      } else if (action === 'project_memory_keep_stale') {
        museIntelligence?.dismissStaleMemorySuggestion?.({ projectRoot: input.projectRoot, memoryId: input.memoryId });
        result = { ok: true, text: '已保留这条项目记忆，不再重复提醒。' };
      } else {
        return { ok: false, code: 'UNKNOWN_ACTION', error: '不支持这项操作，没有改动任何内容。' };
      }

      if (result?.ok) await notify();
      const state = await buildSnapshot();
      return {
        ...state,
        ...result,
        profile: state.profile,
        ...(result?.digest ? {digest: state.digest ?? projectMuseDigest(result.digest).digest} : {}),
      };
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
