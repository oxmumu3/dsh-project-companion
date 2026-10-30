import {randomUUID} from 'node:crypto';
import {bindingRevision} from './workbench-scope.js';
const fail=()=>{throw new Error('回顾设置未更改，请刷新后核对原微信绑定与资料授权。');};
// Dedicated local Owner control. It can toggle only the fixed attention policy
// of an existing subscription, never select sources, impersonate an inbound
// message, or use the general shared-entry project mutation route.
export function createPersonalReviewControl({review,readConnection,resolveOwner,isOwnerCurrent,isClosed=()=>false,onChange=()=>{}}){
 return{async action(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['enabled','expectedBindingRevision'].includes(k))||typeof input.enabled!=='boolean'||!/^[a-f0-9]{64}$/.test(input.expectedBindingRevision??''))fail();
  const initial=await readConnection(),revision=bindingRevision(initial);
  if(isClosed()||initial.state!=='bound'||initial.sessionId.startsWith('family_member_')||revision!==input.expectedBindingRevision)fail();
  const caller=resolveOwner(initial.sessionId);if(!caller||caller.sessionId!==initial.sessionId||!isOwnerCurrent(caller))fail();
  const sync=()=>!isClosed()&&isOwnerCurrent(caller)&&resolveOwner(initial.sessionId)?.cwd===caller.cwd;
  const guard=async()=>{if(!sync()||bindingRevision(await readConnection())!==revision||!sync())fail();return true;};
  await guard();const before=await review.snapshot(caller);await guard();if(!before.schedule)fail();
  const result=await review.act(caller,{action:'attention',enabled:input.enabled,userRequested:true,requestId:`local-attention-${randomUUID()}`,guard,authorizeSync:sync});
  await guard();onChange();return{attention:result.attention,text:input.enabled?'已开启工作时段关注：09:00–19:00，每两小时检查原订阅范围；重要新风险或两小时内的明确截止事项才提醒，每天最多额外两条。':'已关闭工作时段关注；原每日和每周回顾保持不变。'};
 }};
}
export function registerPersonalReviewControl(ctx,controller){
 const connection=ctx.get('connection');if(typeof connection?.fetch?.register!=='function')return null;
 let closed=false;const json=(v,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store'}});
 const off=connection.fetch.register({path:'/api/project_companion/review/attention',methods:['POST'],requestBody:'buffered',async fetch(request){
  if(closed)return json({error:'回顾控制已关闭。'},503);
  if(request.method!=='POST')return json({error:'仅支持 POST。'},405);
  try{if(new URL(request.url).search||request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/json')return json({error:'请使用 JSON。'},400);
   const body=await request.text();if(Buffer.byteLength(body)>1024)return json({error:'请求过大。'},413);if(closed)throw Error();
   const value=await controller.action(JSON.parse(body));return closed?json({error:'回顾控制已关闭。'},503):json(value);
  }catch{return json({error:'回顾设置未更改或结果待核对，请刷新原绑定和订阅状态。'},409);}
 }});const stop=()=>{closed=true;off?.();};ctx.effect?.(()=>stop);return stop;
}
