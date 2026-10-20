import z from '@deepseek-ai/schemastery';

// Native Configure owns credential entry and persistence. No chat/tool accepts these fields.
export const Config = z.object({
  dotAppearance: z.union(['native','dot']).default('native').description('界面外观：native 保留原生外观，dot 使用可恢复的 Dot 主题').volatile(),
  flomoToken: z.string().default('').role('secret').description('flomo MCP 访问令牌；仅用于你主动开启的只读查询').volatile(),
  didaToken: z.string().default('').role('secret').description('滴答清单 MCP API 口令；仅用于只读查询').volatile(),
  flomoOAuthCredentials: z.string().default('').role('secret').description('flomo 账号授权后自动保存；清空可移除本机连接').volatile(),
  didaOAuthCredentials: z.string().default('').role('secret').description('滴答清单账号授权后自动保存；清空可移除本机连接').volatile(),
  googleClientId: z.string().default('').description('你自己的 Google Desktop OAuth Client ID').volatile(),
  googleClientSecret: z.string().default('').role('secret').description('Google Desktop OAuth Client Secret').volatile(),
  googleRefreshToken: z.string().default('').role('secret').description('Google 授权后由本插件保存；也可在此清除连接').volatile(),
});

const FIELDS = ['flomoToken', 'didaToken', 'flomoOAuthCredentials', 'didaOAuthCredentials', 'googleClientId', 'googleClientSecret', 'googleRefreshToken'];

/** Read only this plugin's credential fields; never persist, log or inspect other entries. */
export function readContextConfig(config) {
  try {
    return Object.fromEntries(FIELDS.map((field) => {
      const ref = config?.[field];
      const value = ref && typeof ref.get === 'function' ? ref.get() : ref;
      if (value !== undefined && (typeof value !== 'string' || value.length > (field.endsWith('OAuthCredentials') ? 32768 : 16384))) throw new Error();
      return [field, value ?? ''];
    }));
  } catch { throw new Error('Context 连接配置无效，请在原生插件设置中检查。'); }
}

export default Config;
