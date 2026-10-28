// Fixed, non-sensitive login outcomes. Never include provider text, account,
// OAuth code/state, credentials or the authorization URL in this projection.
const messages=Object.freeze({
  expired:'授权链接已过期。请返回 DeepSeek Dot，重新点击连接 Google，并在五分钟内完成；授权期间保持 Harness 运行。',
  consent_not_granted:'本次未同意 Google 授权。请返回 DeepSeek Dot；如果仍希望连接，可重新选择需要的只读权限。',
  connection_changed:'本次授权期间连接或权限状态已变化，未保存新授权。请返回 DeepSeek Dot 刷新连接状态后重试。',
  code_rejected:'Google 未接受本次授权码，未保存新授权。请返回 DeepSeek Dot 重新点击连接，不要刷新或重复打开旧回调页面。',
  client_configuration:'Google 应用配置暂不可用，未保存新授权。请返回 DeepSeek Dot；这需要产品方检查配置，反复授权不能解决。',
  network:'与 Google 交换授权时连接未完成，未保存新授权。请返回 DeepSeek Dot，确认网络可用后重新连接。',
  permissions:'Google 未返回可用的只读授权，未保存新授权。请返回 DeepSeek Dot 重新连接并核对权限。',
  storage:'授权结果未能在本机保存。请返回 DeepSeek Dot 核对连接状态后重试。',
  response:'Google 授权返回内容未通过校验，未保存新授权。请返回 DeepSeek Dot 重新连接。',
  unknown:'本次 Google 连接未完成。请返回 DeepSeek Dot 核对连接状态后重新授权。',
});
export const googleAuthAttemptReasons=Object.freeze(Object.keys(messages));
export function safeGoogleAuthAttempt(value){
  if(value?.status==='saved')return{status:'saved'};
  return value?.status==='failed'&&Object.hasOwn(messages,value.reason)?{status:'failed',reason:value.reason}:null;
}
export function googleAuthAttemptMessage(reason){return messages[reason]??messages.unknown;}
export function googleAuthFailureReason(error,stage){
  const diagnostic=error?.authDiagnostic;
  if(diagnostic?.oauthError==='invalid_grant')return'code_rejected';
  if(['invalid_client','unauthorized_client'].includes(diagnostic?.oauthError))return'client_configuration';
  if(diagnostic?.stage==='network')return'network';
  if(diagnostic?.stage==='guard'||stage==='guard')return'connection_changed';
  if(stage==='persist'||diagnostic?.stage==='storage'||diagnostic?.stage==='persist')return'storage';
  if(stage==='permissions')return'permissions';
  if(diagnostic?.stage==='parse')return'response';
  return'unknown';
}
