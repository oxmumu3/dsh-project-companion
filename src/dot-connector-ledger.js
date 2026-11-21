import {basename} from 'node:path';
import {dotSourceState} from './dot-sources.js';

const outside = [
  {id: 'google_suite', sources: ['gmail', 'calendar', 'drive', 'docs', 'sheets', 'slides'],
    title: 'Google 三件套（Gmail · 日历 · Drive）', subtitle: '邮件、日程与云端文档',
    boundaryNote: '遵守 Google 数据隔离与已授权的只读范围。'},
  {id: 'flomo', sources: ['flomo'], title: 'flomo 浮墨笔记', subtitle: '笔记与记忆出处', boundaryNote: '读取当前已授权账号的笔记。'},
  {id: 'dida', sources: ['dida'], title: '滴答清单', subtitle: '任务与到期时间', boundaryNote: '读取当前已授权账号的任务。'},
  {id: 'wechat', title: '微信通知', subtitle: '经已配对的微信通道投递 Dot 简报', boundaryNote: '关闭后暂停 Dot 简报的微信投递。'},
];
const SOURCE_SHORT_LABEL = {
  gmail: 'Gmail', calendar: '日历', drive: 'Drive', docs: 'Docs', sheets: 'Sheets', slides: 'Slides', flomo: 'flomo', dida: '滴答清单',
};

export function createDotConnectorLedger({dotSources, context, workspaceAccess, readMobile, readWechat, canEnable, onChange}) {
  const credential = source => {
    try { return context.credentialFingerprint(source); }
    catch { return {configured: false, key: null}; }
  };
  const grantKey = (source, row) => {
    const current = credential(source);
    return current.configured && row?.credentialKey === current.key ? current.key : null;
  };
  async function snapshot() {
    const [sources, mobile, wechat, workspace] = await Promise.all([
      dotSources.snapshot(), readMobile(), readWechat(),
      workspaceAccess.capture().catch(() => null),
    ]);
    const rows = new Map(sources.sources.map(row => [row.source, row]));
    const contextMode = workspace?.contextMode ?? 'full_local';
    const mountedWorkspaces = (workspace?.grants ?? []).map(grant => grant.label || basename(grant.root));
    const macConnected = mobile?.bridgeActive === true && mobile?.paired === true;
    const hasGrants = mountedWorkspaces.length > 0;
    const connectors = [
      {id: 'mac_bridge', group: 'mac_base', title: 'Mac 守护桥',
        subtitle: '手机可接续已授权的会话', boundaryNote: '由这台 Mac 托管。',
        connected: macConnected, enabled: macConnected, statusText: macConnected ? '已连接' : '待配对', canToggle: false},
      {id: 'workspace_grants', group: 'mac_base', title: 'Mac 工作区目录读取范围',
        subtitle: hasGrants ? `已挂载 ${mountedWorkspaces.join(' · ')}` : '等待选择工作区',
        boundaryNote: '读取范围限于已授权的工作区。', connected: hasGrants, enabled: hasGrants,
        contextMode, statusText: hasGrants ? '已授权' : '待选择', canToggle: workspace !== null},
      ...outside.map(({sources: ids, ...item}) => {
        const connected = ids
          ? ids.some(id => Boolean(grantKey(id, rows.get(id))))
          : wechat === true;
        const enabled = ids
          ? ids.some(id => {
            const current = credential(id);
            return dotSourceState(rows.get(id), {configured: current.configured, credentialKey: current.key}) === 'connected';
          })
          : connected && sources.wechatNotificationsEnabled !== false;
        const configured = ids?.some(id => credential(id).configured);
        const reconnectNames = ids ? ids.filter(id => rows.get(id)?.enabled === true && rows.get(id)?.lastReadState === 'needs_authorization')
          .map(id => SOURCE_SHORT_LABEL[id] || id) : [];
        const subtitle = enabled && reconnectNames.length ? `${item.subtitle} · ${reconnectNames.join('、')}待重连` : item.subtitle;
        return {...item, subtitle, group: 'external_apps', connected, enabled,
          canToggle: connected || Boolean(ids?.some(id => rows.get(id)?.enabled === true)),
          statusText: enabled ? '已授权' : connected ? '已关闭' : configured ? '请在桌面连接' : '待授权'};
      }),
    ];
    return {connectors, enabledCount: connectors.filter(item => item.enabled).length,
      totalCount: connectors.length, contextMode, mountedWorkspaces};
  }
  async function toggle({id, enabled, contextMode}={}) {
    const fail = error => ({ok: false, error});
    if (id === 'workspace_grants') {
      if (!['full_local', 'curated_only'].includes(contextMode) || enabled !== undefined) return fail('请选择工作区读取方式。');
      if (contextMode === 'full_local' && !await canEnable()) return fail('Dot 已暂停，请恢复后再修改读取方式。');
      await workspaceAccess.setContextMode(contextMode);
    } else {
      const item = outside.find(row => row.id === id);
      if (!item || typeof enabled !== 'boolean' || contextMode !== undefined) return fail('这项连接暂不能这样修改。');
      if (enabled && !await canEnable()) return fail('Dot 已暂停，请恢复后再启用。');
      if (item.sources) {
        const state = await dotSources.snapshot();
        if (enabled && !state.sources.some(row => item.sources.includes(row.source) && grantKey(row.source, row))) {
          return fail('请先在桌面连接当前账号。');
        }
        if (!enabled) context.suspend();
        await dotSources.setConnectorSwitches(item.sources, enabled, grantKey);
      } else {
        if (enabled && !await readWechat()) return fail('请先在桌面配对微信。');
        await dotSources.setWechatNotifications(enabled);
      }
    }
    onChange();
    return {ok: true, ...await snapshot()};
  }
  return {snapshot, toggle};
}
