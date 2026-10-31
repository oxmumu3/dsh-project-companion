const fail=code=>{throw Object.assign(new Error(code),{code});};
const record=input=>input&&typeof input==='object'&&!Array.isArray(input);
export function createWorkspaceAccessController({access,isClosed=()=>false}={}){
 return{async action(input){
  if(isClosed())fail('WORKSPACE_ACCESS_UNAVAILABLE');
  if(!record(input)||!['list','save'].includes(input.action))fail('WORKSPACE_ACCESS_ARGUMENT');
  const keys=input.action==='list'?['action','query','offset','limit','expectedCatalogRevision']:['action','expectedRevision','expectedCatalogRevision','workspaceIds'];
  if(Object.keys(input).some(k=>!keys.includes(k)))fail('WORKSPACE_ACCESS_ARGUMENT');
  const{action,...args}=input;return access[action](args);
 }};
}
// Only mounted on the official authenticated Owner connection carrier.
// Local JSON endpoints do not create or renew any WeChat delegation.
export function registerGoalJSONRoute(ctx,{path,controller}){
 const connection=ctx.get('connection');if(typeof connection?.fetch?.register!=='function')return null;
 let closed=false;const json=(v,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store'}});
 const off=connection.fetch.register({path,methods:['POST'],requestBody:'buffered',async fetch(request){
  if(closed)return json({error:'页面服务已关闭。'},503);
  if(request.method!=='POST')return json({error:'仅支持 POST。'},405);
  try{
   if(new URL(request.url).search)return json({error:'请使用 JSON 请求。'},400);
   if(request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/json')return json({error:'请使用 JSON。'},415);
   const length=request.headers.get('Content-Length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>65536))return json({error:'请求过大。'},413);
   const body=await request.text();if(Buffer.byteLength(body)>65536)return json({error:'请求过大。'},413);
   if(closed)return json({error:'页面服务已关闭。'},503);
   const result=await controller.action(JSON.parse(body));return closed?json({error:'页面服务已关闭。'},503):json(result);
  }catch(error){
   const code=['WORKSPACE_ACCESS_ARGUMENT','WORKSPACE_ACCESS_CHANGED','WORKSPACE_CATALOG_CHANGED','WORKSPACE_ACCESS_UNAVAILABLE','GOAL_ARGUMENT','GOAL_CHANGED','GOAL_ACCESS_CHANGED','GOAL_UNKNOWN','GOAL_CLOSED','GOAL_BUSY','GOAL_STORE_UNAVAILABLE','GOAL_LIMIT','GOAL_CONVERSATION_UNAVAILABLE'].includes(error?.code)?error.code:'GOAL_REQUEST_FAILED';
   const status=/CHANGED|BUSY/.test(code)?409:/UNAVAILABLE|CLOSED/.test(code)?503:400;
   return json({code,error:status===409?'项目或工作区范围已变化，请刷新后继续。':code==='GOAL_LIMIT'?'保存的项目资料已达到本机上限，原记录已保留。':code==='GOAL_CONVERSATION_UNAVAILABLE'?'项目对话暂未打开，原草稿保留，请重试。':'请求未完成，原资料范围和记录已保留。'},status);
  }
 }});
 const stop=()=>{if(closed)return;closed=true;off?.();};ctx.effect?.(()=>stop);return stop;
}
export const registerWorkspaceAccessRoute=(ctx,controller)=>registerGoalJSONRoute(ctx,{path:'/api/project_companion/workspaces',controller});
