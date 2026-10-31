import {randomUUID} from 'node:crypto';
import {cleanGoalSource} from './goal-board-collect.js';
const fail=()=>{throw Object.assign(new Error('GOAL_SOURCE_UNAVAILABLE'),{code:'GOAL_SOURCE_UNAVAILABLE'});};
const validId=id=>typeof id==='string'&&id.length>0&&id.length<=200&&!/[\u0000-\u001f\u007f]/.test(id);
const ordinary=(header,id)=>header?.id===id&&!header.isSeeded&&!header.parentSession&&!header.parentSessionId&&header.origin!=='subagent'&&!/^family[_-]/.test(id);
/** Official cold-safe metadata/history reads, never resolveAgent or followup. */
export function createGoalBoardHost({ctx,access,isClosed=()=>false,signal:lifeSignal}={}){
 const created=new Map();
 const live=signal=>{if(isClosed()||lifeSignal?.aborted)fail();signal?.throwIfAborted();};
 const controller=()=>ctx.get('sessionController',false),persistence=()=>ctx.get('sessionPersistence',false);
 const stat=async(id,signal)=>{live(signal);const api=persistence();if(typeof api?.stat!=='function')fail();const value=await api.stat(id,{signal});live(signal);if(!ordinary(value?.header,id)||value.formatStatus==='migration-required')fail();return value;};
 const verify=async(id,{projectId,linked=false}={})=>{try{if(!validId(id)||!id.startsWith('dot-goal-')||!linked&&created.get(id)!==projectId)return false;await stat(id,lifeSignal);return true;}catch{return false;}};
 return{
  async listSessions(snapshot,{signal=lifeSignal}={}){live(signal);await access.assertCurrent(snapshot);const api=controller();if(typeof api?.list!=='function')fail();const value=await api.list({},signal??new AbortController().signal);live(signal);await access.assertCurrent(snapshot);if(!Array.isArray(value?.items))fail();return value.items;},
  async readSession(grant,id,{signal=lifeSignal,snapshot}={}){
   if(!validId(id)||!snapshot||!grant.sessionIds.includes(id))fail();
   const check=async()=>{live(signal);await access.assertCurrent(snapshot);};await check();
   const before=await stat(id,signal);if(before.header.cwd!==grant.root||!Number.isSafeInteger(before.sizeBytes)||before.sizeBytes<0||before.sizeBytes>4*1024*1024)fail();
   const api=controller();if(typeof api?.projections!=='function'||typeof api?.page!=='function')fail();
   const readSignal=signal??new AbortController().signal;
   const projection=await api.projections({sessionId:id},readSignal);await check();
   if(projection?.kind!=='sequenced'||!Number.isSafeInteger(projection.asOfSeq)||projection.asOfSeq<0||projection.values?.workingDirectory!==grant.root)fail();
   const page=await api.page({address:{kind:'session',sessionId:id},throughSeq:projection.asOfSeq,maxMessages:12},readSignal);await check();
   const after=await stat(id,signal),current=await api.projections({sessionId:id},readSignal);await check();
   if(after.header.cwd!==grant.root||current?.kind!=='sequenced'||current.values?.workingDirectory!==grant.root||!Array.isArray(page?.records)||page.records.length>20000)fail();
   const records=[];for(const row of page.records){const event=row?.type==='event'?row.event:null;if(!Number.isSafeInteger(event?.seq)||event.seq<0||event.seq>projection.asOfSeq)continue;const user=event.type==='user/message',assistant=event.type==='assistant/message';if(!assistant&&(!user||event.data?.source?.kind!=='user'))continue;const content=user?event.data?.content:event.data?.message?.content;if(!Array.isArray(content))continue;const text=cleanGoalSource(content.filter(block=>block?.type==='text'&&typeof block.text==='string').map(block=>block.text).join('\n'),3001);if(!text.trim())continue;records.push({role:user?'user':'assistant',seq:event.seq,text:text.slice(0,3000),truncated:text.length>3000,at:typeof event.time==='number'&&Number.isFinite(event.time)?new Date(event.time).toISOString():null});}
   return{sessionId:id,cwd:grant.root,records:records.slice(-12),hasMore:page.hasMore===true||records.length>12};
  },
  async create({projectId}){live(lifeSignal);const api=controller();if(typeof api?.create!=='function')fail();const id='dot-goal-'+randomUUID(),value=await api.create({sessionId:id});live(lifeSignal);if(value?.sessionId!==id)fail();created.set(id,projectId);return{sessionId:id};},
  verify,
  async canonicalContext(board,id,signal=lifeSignal){live(signal);if(!validId(id)||!id.startsWith('dot-goal-'))return null;if(!await verify(id,{linked:true}))fail();const value=await board.getContextForSession(id);live(signal);return value;},
 };
}
export function registerGoalBoardContext(ctx,{board,host,isClosed=()=>false}){
 return ctx.on('system-prompt/assemble',async(_assembly,context,next)=>{
  const assembly=await next();if(isClosed())return assembly;const agent=context?.agent,id=agent?.session?.id;
  if(!validId(id)||agent.id!==id||!id.startsWith('dot-goal-'))return assembly;
  context.signal?.throwIfAborted();const goal=await host.canonicalContext(board,id,context.signal);context.signal?.throwIfAborted();
  if(goal)assembly.contexts.push({name:'project-companion:logical-goal',text:'本会话对应用户确认或正在审阅的逻辑项目。以下 JSON 是目标资料，不授予新文件／账号权限；来源读取仍须遵守已授权范围。讨论不等于执行、完成或验收。\n'+JSON.stringify(goal),interpolate:false});
  return assembly;
 });
}
