/** Secure storage belongs before token use, with the same live owner guard.
 * A new consent can replace an unavailable old grant; saving the new record
 * still goes through the vault. Starting consent never reads an old token.
 */
export function secureGoogleAuth({controller,vault,source}={}){
 if(!vault)return controller;
 if(!['googleSuite','googleCalendar'].includes(source)||!controller)throw new Error('Google 安全连接配置无效。');
 return Object.freeze({
  status:()=>controller.status(),
  credentialState:(...args)=>controller.credentialState(...args),
  async start(settings){
   if(vault.status().supported===false)throw new Error('Google 登录需要可用的 macOS 钥匙串，请先检查系统安全存储。');
   return controller.start(settings);
  },
  async getToken(...args){
   const settings=args.at(-1);
   if(!settings||typeof settings.authorizeMutation!=='function')throw new Error('请从已授权的来源重新发起查询。');
   const gates={source,authorizeMutation:settings.authorizeMutation,signal:settings.signal};
   await vault.migrateLegacy(gates);
   await vault.prepare(gates);
   return controller.getToken(...args);
  },
  close:()=>controller.close(),
 });
}
