/** Persist a source credential through the host's transactional revision CAS.
 * No fallback to unguarded writes: a user replacement must always win.
 */
export function createContextCredentialWriter({ctx,readConfig,isClosed=()=>false}={}){
 const fail=()=>{throw new Error('账户凭据已变化或连接已关闭，请重新连接。');};
 return async(source,value,conditions={})=>{
  if(!['flomo','dida','googleCalendar','googleSuite'].includes(source)||typeof value!=='string'||!value.length||value.length>(['googleCalendar','googleSuite'].includes(source)?65536:32768))fail();
  const field=source+'OAuthCredentials',legacy=['googleCalendar','googleSuite'].includes(source)?null:source+'Token';
  const matches=()=>{const config=readConfig?.()??{};return(config[field]??'')===(conditions.expectedValue??'')&&(legacy===null||(config[legacy]??'')===(conditions.expectedLegacy??''));};
  if(isClosed()||!matches()||typeof conditions.authorizeMutation!=='function')fail();
  const settings=ctx.get('settings',false),ns=ctx.fiber?.entry?.options?.id;
  if(!ns||typeof settings?.describe!=='function'||typeof settings?.mutate!=='function')fail();
  const descriptor=settings.describe({redactSecrets:true}).find(row=>row.ns===ns);
  const revision=descriptor?.revision;
  if(!Number.isSafeInteger(revision)||revision<0)fail();
  if(await conditions.authorizeMutation()===false||isClosed()||!matches())fail();
  // Native SettingsForms verifies this revision inside configEditor.edit's transaction.
  // No asynchronous work may be inserted between the guard and this dispatch.
  try{await settings.mutate(ns,[{op:'set',path:[field],value}],revision);}catch{fail();}
 };
}
