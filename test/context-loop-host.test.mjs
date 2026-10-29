import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,realpath,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Context} from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime,{defineTool} from '@deepseek-ai/dsh-tools';
import CommandRuntime from '@deepseek-ai/dsh-commands';
import Storage from '@deepseek-ai/dsh-storage';
import * as JsonStorage from '@deepseek-ai/dsh-storage-json';
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain';
import SessionStore,{SessionId} from '@deepseek-ai/dsh-session';
import {createScope} from '@deepseek-ai/dsh-scope';
import {ProactiveScheduler} from '../vendor/proactive/lib/scheduler.js';

async function fixture(t,options={}){
  const {installCompanion}=await import('../index.js');
  const root=await realpath(await mkdtemp(join(tmpdir(),'dot-context-host-')));
  await mkdir(join(root,'.agent/memory'),{recursive:true});for(const file of ['README.md','.agent/memory/progress.md','.agent/memory/context.md'])await writeFile(join(root,file),'Synthetic project context');
  const ctx=new Context();
  for(const [plugin,config] of [[SystemPrompt,{}],[ToolRuntime,{mode:'native'}],[CommandRuntime,undefined],[Storage,undefined],[JsonStorage,{root:join(root,'storage')}],[StorageDomain,{backend:'json'}],[SessionStore,undefined]])await ctx.plugin(plugin,config);
  const agents=new Map(),routes=new Map(),calls=[],closed=[];
  ctx.provide('agents',{get:id=>agents.get(id),list:()=>[...agents.values()]});
  ctx.provide('workingDirectory',{get:session=>session.header.cwd});
  ctx.provide('workspaceRegistry',{list:()=>[]});
  ctx.provide('connection',{fetch:{register:route=>{routes.set(route.path,route);return()=>routes.delete(route.path);}}});
  let connection={state:'bound',sessionId:'context-owner',bindingKey:'a'.repeat(64)};
  const session=ctx.sessions.create(SessionId('context-owner'),{meta:{cwd:root}});
  const agent={id:session.id,session,ctx,status:'idle'};agents.set(agent.id,agent);
  let adapter;
  const config={didaToken:'synthetic-private-token',flomoToken:'synthetic-flomo',googleClientId:'',googleClientSecret:'',googleRefreshToken:''};
  const googleTokenVault=options.vaultFactory?.(config);
  const transport={catalog:async(source,{signal})=>{calls.push({type:'catalog',source});return options.catalog?.(source,{signal})??{tools:[{name:source==='flomo'?'memo_search':'list_projects',inputSchema:{type:'object',properties:{limit:{type:'integer'},offset:{type:'integer'}}}}],fetchedAt:'2026-10-19T12:00:00Z'};},call:async(source,name,args,{signal})=>{calls.push({type:'call',source,name,args});return options.call?.(source,name,args,{signal})??{value:{structuredContent:source==='flomo'?{memos:[{id:'m1',content:'Synthetic DeepSeek note'}]}:{projects:[{id:'p1',name:'当前事项'}]}},fetchedAt:'2026-10-19T12:00:00Z'};},close:async()=>closed.push('transport')};
  const googleAuth={status:()=>({clientConfigured:false,refreshConfigured:false,authInProgress:false}),start:async()=>{calls.push({type:'google_authorize'});return{url:'https://accounts.google.com/o/oauth2/v2/auth?state=synthetic',expiresAt:'2026-10-19T12:05:00Z'};},getToken:async()=>{throw new Error('must not access Google');},close:async()=>closed.push('googleAuth')};
  options.onRoot?.(ctx);
  const plugin=await ctx.plugin({name:'synthetic-context-host',inject:['tools','commands','storageDomain','sessions','systemPrompt'],async apply(scope){adapter=await installCompanion(scope,{clock:options.clock??(()=>new Date('2026-10-19T12:00:00Z')),followup:options.followup,readSetup:async()=>connection,readNativeRoute:options.readNativeRoute??(async()=>({kind:'unbound'})),readBinding:options.readBinding??(async()=>null),family:options.family,context:{...(options.nativeConfig?{config:options.nativeConfig}:{}),readConfig:()=>({...config}),...(googleTokenVault?{googleTokenVault}:{}),googlePublisher:options.googlePublisher??null,fetch:options.contextFetch??(async()=>{throw new Error('Synthetic context host must not contact real services');}),transport,googleAuth,...(options.flomoAuth?{flomoAuth:options.flomoAuth}:{}),...(options.didaAuth?{didaAuth:options.didaAuth}:{}),...(options.googleCalendarAuth?{googleCalendarAuth:options.googleCalendarAuth}:{}),...(options.googleSuiteAuth?{googleSuiteAuth:options.googleSuiteAuth}:{}),...(options.suiteTransport?{suiteTransport:options.suiteTransport}:{}),...(options.calendarTransport?{calendarTransport:options.calendarTransport}:{})},contextLoop:options.contextLoop,timers:{setInterval(){return{unref(){}};},clearInterval(){}}});}});
  let number=0;
  const tool=async args=>{const response=await ctx.tools.execute({callId:'context-test-'+(++number),name:'personal_context',arguments:args,agent,signal:new AbortController().signal});assert.equal(response.isError,false,JSON.stringify(response));return response.value;};
  const project=async args=>{const response=await ctx.tools.execute({callId:'context-project-'+(++number),name:'project_companion',arguments:args,agent,signal:new AbortController().signal});assert.equal(response.isError,false,JSON.stringify(response));return response.value;};
  const route=()=>routes.get('/api/project_companion/context');
  const get=async()=>{const response=await route().fetch(new Request('http://localhost/api/project_companion/context'));return{status:response.status,value:await response.json()};};
  const post=async body=>{const response=await route().fetch(new Request('http://localhost/api/project_companion/context',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}));return{status:response.status,value:await response.json()};};
  const close=()=>ctx.fiber.dispose();
  t.after(async()=>{await close();await rm(root,{recursive:true,force:true});});
  return{ctx,agent,agents,routes,calls,closed,adapter,plugin,config,googleTokenVault,tool,project,get,post,route,close,setConnection:value=>connection=value};
}

test('Family Owner can reuse a Dot grant only when separately enabled and exact call verified',async t=>{
 const revision='b'.repeat(64);let authorized=true;
 const bridge={resolveOwnerCall:async ({sessionId,callId})=>authorized&&sessionId==='family_owner_1'&&callId==='family-real-call'?{sessionId,bindingRevision:revision,userText:'从 flomo 搜索 DeepSeek 最多2条'}:null,isOwnerRevisionCurrent:(id,r)=>authorized&&id==='family_owner_1'&&r===revision};
 const h=await fixture(t,{family:{enabled:true},onRoot:ctx=>ctx.provide('familyDotBridge',bridge)});
 await h.tool({action:'connect',source:'flomo',userRequested:true});
 const session=h.ctx.sessions.create(SessionId('family_owner_1'),{meta:{cwd:h.agent.session.header.cwd}}),agent={id:session.id,session,ctx:h.ctx,status:'idle'};h.agents.set(agent.id,agent);
 const query=callId=>h.ctx.tools.execute({callId,name:'personal_context',arguments:{action:'query',source:'flomo',operation:'search',query:'DeepSeek',limit:2,userRequested:true},agent,signal:new AbortController().signal});
 const denied=await query('fabricated');assert.equal(denied.value.status,'blocked');assert.equal(h.calls.filter(c=>c.type==='call').length,0);
 const allowed=await query('family-real-call');assert.equal(allowed.isError,false);assert.equal(allowed.value.source,'flomo',JSON.stringify(allowed.value));assert.equal(h.calls.filter(c=>c.type==='call').length,1);
 const memberSession=h.ctx.sessions.create(SessionId('family_member_1'),{meta:{cwd:h.agent.session.header.cwd}}),member={id:memberSession.id,session:memberSession,ctx:h.ctx,status:'idle'};h.agents.set(member.id,member);
 const memberRead=await h.ctx.tools.execute({callId:'family-real-call',name:'personal_context',arguments:{action:'query',source:'flomo',operation:'search',query:'DeepSeek',limit:2,userRequested:true},agent:member,signal:new AbortController().signal});assert.equal(memberRead.value.status,'blocked');assert.equal(h.calls.filter(c=>c.type==='call').length,1);
 h.setConnection({state:'bound',sessionId:'different-old-wechat-owner',bindingKey:'f'.repeat(64)});const rebound=await query('family-real-call');assert.equal(rebound.value.status,'blocked');
 h.setConnection({state:'bound',sessionId:'context-owner',bindingKey:'a'.repeat(64)});const restored=await query('family-real-call');assert.equal(restored.value.status,'blocked','a confirmed old-route rebind remains revoked');assert.equal(h.calls.filter(c=>c.type==='call').length,1);
 authorized=false;const after=await query('family-real-call');assert.equal(after.value.status,'blocked');assert.equal(h.calls.filter(c=>c.type==='call').length,1);
});

test('Family delegation is off by default even when the bridge and old grants exist',async t=>{
 const rev='b'.repeat(64),bridge={resolveOwnerCall:async({sessionId})=>({sessionId,bindingRevision:rev,userText:'读取滴答清单'}),isOwnerRevisionCurrent:()=>true};
 const h=await fixture(t,{onRoot:ctx=>ctx.provide('familyDotBridge',bridge)});await h.tool({action:'connect',source:'dida',userRequested:true});
 const session=h.ctx.sessions.create(SessionId('family_owner_1'),{meta:{cwd:h.agent.session.header.cwd}}),agent={id:session.id,session,ctx:h.ctx,status:'idle'};h.agents.set(agent.id,agent);
 const r=await h.ctx.tools.execute({callId:'family-call',name:'personal_context',arguments:{action:'query',source:'dida',operation:'projects',userRequested:true},agent,signal:new AbortController().signal});
 assert.equal(r.value.status,'blocked');assert.equal(h.calls.filter(c=>c.type==='call').length,0);
});

test('Family reminder passes only verified call identity to the single Family ledger, never model-supplied title or time',async t=>{
 const revision='b'.repeat(64),calls=[],receipts=new Map();let userText='2分钟后提醒我「喝水」',timing='fresh',authorized=true;
 const bridge={resolveOwnerCall:async({sessionId,callId})=>authorized&&sessionId==='family_owner_1'&&callId.startsWith('family-remind-')?{sessionId,bindingRevision:revision,userText,sourceRequestId:'wechat-'+'c'.repeat(64),sourceTimingState:timing,sourceTiming:{receivedAt:'2026-10-19T12:00:00.000Z',providerCreatedAt:'2026-10-19T12:00:00.000Z'}}:null,isOwnerRevisionCurrent:(id,r)=>authorized&&id==='family_owner_1'&&r===revision,remindOwnerOnce:async input=>{assert.deepEqual(Object.keys(input).sort(),['authorize','bindingRevision','callId','sessionId']);assert.equal(input.authorize(),true);calls.push(input);const id='wechat-synthetic';if(!receipts.has(id))receipts.set(id,{status:'scheduled',text:'已记下提醒。'});return receipts.get(id);}};
 const familyOptions={enabled:true,reminderEnabled:true};const h=await fixture(t,{family:familyOptions,onRoot:ctx=>ctx.provide('familyDotBridge',bridge)});
 const fs=h.ctx.sessions.create(SessionId('family_owner_1'),{meta:{cwd:h.agent.session.header.cwd}}),agent={id:fs.id,session:fs,ctx:h.ctx,status:'idle'};h.agents.set(agent.id,agent);
 const invoke=async(callId,as=agent)=>(await h.ctx.tools.execute({callId,name:'project_companion',arguments:{action:'remind',delayMinutes:1440,title:'模型捏造',userRequested:false},agent:as,signal:new AbortController().signal})).value;
 const first=await invoke('family-remind-first');assert.equal(first.status,'scheduled',JSON.stringify(first));assert.equal(calls.length,1);
 const duplicate=await invoke('family-remind-duplicate');assert.equal(duplicate.status,'scheduled');assert.equal(receipts.size,1);
 familyOptions.reminderEnabled=false;assert.equal((await invoke('family-remind-disabled')).status,'blocked');familyOptions.reminderEnabled=true;
 timing='unknown';assert.equal((await invoke('family-remind-unknown')).status,'blocked');timing='fresh';userText='2分钟后提醒我「喝水」，再发邮件';assert.equal((await invoke('family-remind-extra')).status,'blocked');
 const member={...agent,id:'family_member_1'};assert.equal((await invoke('family-remind-member',member)).status,'blocked');assert.equal(calls.length,2);
});

test('a Family reminder accepted just before owner revocation is never reported as definitely uncreated',async t=>{
 const rev='a'.repeat(64);let current=true;const bridge={resolveOwnerCall:async({sessionId})=>({sessionId,bindingRevision:rev,userText:'2分钟后提醒我「喝水」',sourceRequestId:'wechat-'+'b'.repeat(64),sourceTimingState:'fresh',sourceTiming:{receivedAt:'2026-10-19T12:00:00.000Z',providerCreatedAt:'2026-10-19T12:00:00.000Z'}}),isOwnerRevisionCurrent:()=>current,remindOwnerOnce:async input=>{assert.equal(input.authorize(),true);current=false;return{status:'scheduled',text:'已安排一次提醒。'};}};
 const h=await fixture(t,{family:{enabled:true,reminderEnabled:true},onRoot:ctx=>ctx.provide('familyDotBridge',bridge)});const fs=h.ctx.sessions.create(SessionId('family_owner_1'),{meta:{cwd:h.agent.session.header.cwd}}),agent={id:fs.id,session:fs,ctx:h.ctx,status:'idle'};h.agents.set(agent.id,agent);
 const r=(await h.ctx.tools.execute({callId:'remind-revoked-after-admission',name:'project_companion',arguments:{action:'remind'},agent,signal:new AbortController().signal})).value;assert.notEqual(r.status,'blocked',JSON.stringify(r));assert.doesNotMatch(r.text,/未创建|未安排|未执行/);
});

test('native live configuration enables the shared Family reminder only when explicitly switched on',async t=>{
 const rev='a'.repeat(64);let enabled=false,calls=0;const bridge={resolveOwnerCall:async({sessionId})=>({sessionId,bindingRevision:rev,userText:'2分钟后提醒我「喝水」',sourceRequestId:'wechat-'+'b'.repeat(64),sourceTimingState:'fresh',sourceTiming:{receivedAt:'2026-10-19T12:00:00.000Z',providerCreatedAt:'2026-10-19T12:00:00.000Z'}}),isOwnerRevisionCurrent:()=>true,remindOwnerOnce:async input=>{assert.equal(input.authorize(),true);calls++;return{status:'scheduled',text:'已安排。'};}};
 const h=await fixture(t,{family:{enabled:true},nativeConfig:{familyOwnerReminderEnabled:{get:()=>enabled}},onRoot:ctx=>ctx.provide('familyDotBridge',bridge)});const fs=h.ctx.sessions.create(SessionId('family_owner_1'),{meta:{cwd:h.agent.session.header.cwd}}),agent={id:fs.id,session:fs,ctx:h.ctx,status:'idle'};h.agents.set(agent.id,agent);
 const invoke=async id=>(await h.ctx.tools.execute({callId:id,name:'project_companion',arguments:{action:'remind'},agent,signal:new AbortController().signal})).value;
 assert.equal((await invoke('config-off')).status,'blocked');enabled=true;assert.equal((await invoke('config-on')).status,'scheduled');enabled=false;assert.equal((await invoke('config-off-again')).status,'blocked');assert.equal(calls,1);
});

test('brief returns scoped excerpts on model failure without private exception data',async t=>{
 const h=await fixture(t,{contextLoop:{summarize:async()=>{throw Object.assign(Error('PRIVATE_MODEL_SECRET'),{code:'MODEL_UNAVAILABLE'});}}});
 await h.tool({action:'connect',source:'flomo',userRequested:true});
 const root=h.agent.session.header.cwd;await h.project({action:'watch',project:root});
 const result=await h.project({action:'context_brief',project:root,objective:'整理项目简报',queries:[{source:'flomo',operation:'search',query:'DeepSeek',limit:2}],userRequested:true});
 assert.equal(result.status,'partial',JSON.stringify(result));assert.equal(result.modelDiagnostic,'MODEL_UNAVAILABLE');assert.match(result.text,/原文摘录/);assert.ok(result.loopId);assert.equal(result.analysisState,'source_only');assert.deepEqual(result.items,[]);assert.deepEqual(result.executions,[]);assert.doesNotMatch(JSON.stringify(result),/PRIVATE_MODEL_SECRET/);
});

test('Family Owner scoped brief does not admit project handoff until a turn guard is available',async t=>{
 const revision='b'.repeat(64),sent=[],admissions=[];
 const bridge={resolveOwnerCall:async ({sessionId,callId})=>sessionId==='family_owner_1'&&callId.startsWith('family-real-')?{sessionId,bindingRevision:revision,userText:'从 flomo 搜索 DeepSeek 最多2条，生成 family-target 的项目简报。'}:null,isOwnerRevisionCurrent:(id,r)=>id==='family_owner_1'&&r===revision,sendOwner:async item=>{assert.equal(item.authorize(),true);sent.push(item);return{status:'accepted'};}};
 const h=await fixture(t,{family:{enabled:true},onRoot:ctx=>ctx.provide('familyDotBridge',bridge),contextLoop:{summarize:async input=>({changes:[],blockers:[],nextSteps:[{kind:'suggestion',text:'建议核对当前事项。',sourceIds:[input.sources.find(s=>s.role==='file'&&s.status==='ok').sourceId]}]})}});
 await h.tool({action:'connect',source:'flomo',userRequested:true});
 const root=join(h.agent.session.header.cwd,'family-target');await mkdir(join(root,'.agent/memory'),{recursive:true});for(const f of ['README.md','.agent/memory/progress.md','.agent/memory/context.md'])await writeFile(join(root,f),'Synthetic target context');
 const ts=h.ctx.sessions.create(SessionId('family-target-session'),{meta:{cwd:root}}),target={id:ts.id,session:ts,ctx:h.ctx,status:'idle',followup:message=>admissions.push(message)};h.agents.set(target.id,target);await h.project({action:'watch',project:root});
 const fs=h.ctx.sessions.create(SessionId('family_owner_1'),{meta:{cwd:h.agent.session.header.cwd}}),agent={id:fs.id,session:fs,ctx:h.ctx,status:'idle'};h.agents.set(agent.id,agent);let i=0;
 const project=async args=>(await h.ctx.tools.execute({callId:'family-real-'+(++i),name:'project_companion',arguments:args,agent,signal:new AbortController().signal})).value;
 const brief=await project({action:'context_brief',project:root,objective:'推进当前事项',queries:[{source:'flomo',operation:'search',query:'DeepSeek',limit:2}],userRequested:true});assert.ok(brief.loopId,JSON.stringify(brief));
 const scope=h.adapter.familyRoute.getScope(agent.id);assert.ok(scope);h.agents.delete(agent.id);
 assert.equal(await h.adapter.familyRoute.recheck(scope,{root,loopId:brief.loopId}),true,'cold Owner must pass only persisted-scoped authority before an exact resume');
 h.agents.set(agent.id,agent);
 // Exercise the actual registered index.js tool with a controlled scheduler
 // admission predicate. The production scheduler enforces its own notice,
 // session, project and loop guard; this test verifies index routing rather
 // than claiming an end-to-end timed wake.
 const originalActiveLoop=h.adapter.followup.activeLoop;h.adapter.followup.activeLoop=e=>e.callId==='synthetic-protected-wake'&&e.agent===agent?brief.loopId:null;
 try{
  const call=async(callId,loopId,as=agent)=>(await h.ctx.tools.execute({callId,name:'project_companion',arguments:{action:'context_check',project:root,loopId},agent:as,signal:new AbortController().signal})).value;
  const before=h.calls.filter(c=>c.type==='call').length;
  assert.equal((await call('ordinary-turn',brief.loopId)).status,'blocked');assert.equal((await call('synthetic-protected-wake','wrong-loop')).status,'blocked');assert.equal(h.calls.filter(c=>c.type==='call').length,before);
  const exact=await call('synthetic-protected-wake',brief.loopId);assert.notEqual(exact.status,'blocked',JSON.stringify(exact));assert.equal(h.calls.filter(c=>c.type==='call').length,before+1);
 }finally{h.adapter.followup.activeLoop=originalActiveLoop;}
 const item=brief.items.find(row=>row.section==='nextSteps');assert.ok(item);
 const denied=await project({action:'context_handoff',project:root,revision:brief.revision,itemId:item.id,task:'只读检查并总结。',userRequested:true});assert.equal(denied.status,'blocked');assert.equal(admissions.length,0);
 const request={action:'context_handoff',project:root,revision:brief.revision,itemId:item.id,task:'检查并总结。',userRequested:true};
 const handoff=await project(request);assert.equal(handoff.status,'blocked',JSON.stringify(handoff));assert.equal(admissions.length,0);assert.equal(sent.length,0);
});

test('real index tool runs only the exact Family loop during a genuine scheduler wake',async t=>{
 let now=new Date('2026-10-19T12:00:00Z');const schedulers=[],messages=[],results=[],sent=[];const revision='b'.repeat(64);
 const bridge={resolveOwnerCall:async({sessionId,callId})=>sessionId==='family_owner_1'&&callId==='family-brief'?{sessionId,bindingRevision:revision,userText:'从 flomo 搜索 DeepSeek 最多2条，生成 family-target 的项目简报。'}:null,isOwnerRevisionCurrent:(id,r)=>id==='family_owner_1'&&r===revision,ownerRouteStatus:()=> 'current',readOwnerDelivery:async()=>({status:'absent'}),sendOwner:async row=>{sent.push(row);return{status:'accepted'};}};
 const h=await fixture(t,{family:{enabled:true},clock:()=>now,followup:{createScheduler:deps=>{const scheduler=new ProactiveScheduler(deps);schedulers.push(scheduler);return scheduler;}},onRoot:ctx=>{ctx.provide('familyDotBridge',bridge);ctx.provide('agentDefaultModel',{currentSelection:()=>({provider:'synthetic',model:'synthetic'})});},contextLoop:{summarize:async input=>({changes:[],blockers:[],nextSteps:[{kind:'suggestion',text:'建议核对当前事项。',sourceIds:[input.sources.find(s=>s.role==='file'&&s.status==='ok').sourceId]}]})}});
 await h.tool({action:'connect',source:'flomo',userRequested:true});const root=join(h.agent.session.header.cwd,'family-target');await mkdir(join(root,'.agent/memory'),{recursive:true});for(const f of ['README.md','.agent/memory/progress.md','.agent/memory/context.md'])await writeFile(join(root,f),'Synthetic target context');
 const ts=h.ctx.sessions.create(SessionId('family-target-session'),{meta:{cwd:root}});h.agents.set(ts.id,{id:ts.id,session:ts,ctx:h.ctx,status:'idle'});await h.project({action:'watch',project:root});
 const fs=h.ctx.sessions.create(SessionId('family_owner_1'),{meta:{cwd:h.agent.session.header.cwd}}),initial={id:fs.id,session:fs,ctx:h.ctx,status:'idle'};h.agents.set(initial.id,initial);
 const brief=(await h.ctx.tools.execute({callId:'family-brief',name:'project_companion',arguments:{action:'context_brief',project:root,objective:'推进当前事项',queries:[{source:'flomo',operation:'search',query:'DeepSeek',limit:2}],userRequested:true},agent:initial,signal:new AbortController().signal})).value;assert.ok(brief.loopId,JSON.stringify(brief));
 const events=[];const agent={id:initial.id,status:'idle',session:{id:initial.id,header:{cwd:h.agent.session.header.cwd,agentPreset:'default'},events,get seq(){return events.length;},requestHeader:()=>({config:{provider:'synthetic',model:'synthetic'}})},runMaintenance:async work=>work(),followup(message){messages.push(message);events.push({seq:events.length,type:'turn/start',data:{turn:messages.length},time:now.toISOString()},{seq:events.length+1,type:'user/message',data:message,time:now.toISOString()});},whenIdle:async()=>{
  const wrong=await h.ctx.tools.execute({callId:'wake-wrong',name:'project_companion',arguments:{action:'context_check',project:root,loopId:'wrong-loop'},agent,signal:new AbortController().signal});results.push({kind:'wrong',value:wrong});
  const member={...agent,id:'family_member_1'};const foreign=await h.ctx.tools.execute({callId:'wake-member',name:'project_companion',arguments:{action:'context_check',project:root,loopId:brief.loopId},agent:member,signal:new AbortController().signal});results.push({kind:'member',value:foreign});
  const exact=await h.ctx.tools.execute({callId:'wake-exact',name:'project_companion',arguments:{action:'context_check',project:root,loopId:brief.loopId},agent,signal:new AbortController().signal});results.push({kind:'exact',value:exact});
  if(exact.value?.quiet===true){await h.ctx.tools.execute({callId:'wake-reclaim',name:'proactive_reclaim',arguments:{reason:'无变化'},agent,signal:new AbortController().signal});events.push({seq:events.length,type:'tool/call',data:{name:'proactive_reclaim',arguments:'{}'}});}else events.push({seq:events.length,type:'assistant/message',data:{blocks:[{type:'text',text:'Synthetic wake result'}]},time:now.toISOString()});
  events.push({seq:events.length,type:'turn/end',data:{reason:{kind:'completed'}},time:now.toISOString()});}};
 const nativeScope=createScope(h.ctx,agent);agent.ctx=nativeScope.ctx;h.agents.set(agent.id,agent);t.after(()=>nativeScope.dispose());
 const ordinary=(await h.ctx.tools.execute({callId:'ordinary',name:'project_companion',arguments:{action:'context_check',project:root,loopId:brief.loopId},agent,signal:new AbortController().signal})).value;assert.equal(ordinary.status,'blocked');
 const plan=await h.adapter.followup.checkOnce({root,sessionId:agent.id,projectLabel:'family-target',loopId:brief.loopId,delivery:'family',delaySeconds:60});assert.equal(plan.status,'queued');for(const scheduler of schedulers)await scheduler.driveChain;
 now=new Date(now.getTime()+60000);for(const scheduler of schedulers)scheduler.requestDrive();for(const scheduler of schedulers)await scheduler.driveChain;
 assert.equal(messages.length,1);assert.equal(results.length,3);assert.ok(results[0].value.isError||results[0].value.value?.status==='blocked','wrong loop is rejected in the real wake');assert.ok(results[1].value.isError||results[1].value.value?.status==='blocked','family members cannot borrow the active Owner wake');assert.equal(results[2].value.isError,false,JSON.stringify(results[2].value));assert.notEqual(results[2].value.value?.status,'blocked',JSON.stringify(results[2].value));assert.ok(h.calls.filter(c=>c.type==='call').length>=2,'the exact wake reads only the preselected source');assert.ok(sent.length<=1);
});

test('native context loop exposes sourced brief and inspection, ordinary turns cannot call autonomous check',async t=>{
 const h=await fixture(t,{contextLoop:{summarize:async input=>({changes:[],blockers:[],nextSteps:[{kind:'suggestion',text:'建议核对当前事项的下一步。',sourceIds:[input.sources.find(s=>s.role==='file'&&s.status==='ok').sourceId]}]})}});
 await h.project({action:'watch'});await h.tool({action:'connect',source:'dida',userRequested:true});
 const r=await h.project({action:'context_brief',objective:'推进今天的项目',queries:[{source:'dida',operation:'projects',limit:2}],userRequested:true});
 assert.equal(r.status,'overview',JSON.stringify(r));assert.ok(r.loopId);assert.ok(r.items.length);assert.equal(typeof r.revision,'number');
 const count=h.calls.length;
 const status=await h.project({action:'context_status'});assert.equal(status.loopId,r.loopId);assert.equal(h.calls.length,count,'inspection cannot reread accounts');
 const auto=await h.project({action:'context_check',loopId:r.loopId});assert.equal(auto.status,'blocked');assert.equal(h.calls.length,count);
 const refresh=await h.project({action:'context_brief',userRequested:true});assert.equal(refresh.status,'ready');assert.equal(refresh.revision,r.revision);assert.equal(refresh.loopId,r.loopId);
 await h.project({action:'pause'});assert.equal((await h.project({action:'context_status'})).status,'blocked');
});

test('new context manifest requires explicit intent and source reconnect invalidates it',async t=>{
 const h=await fixture(t,{contextLoop:{summarize:async()=>({changes:[],blockers:[],nextSteps:[]})}});await h.project({action:'watch'});await h.tool({action:'connect',source:'dida',userRequested:true});
 const bad=await h.project({action:'context_brief',objective:'目标',queries:[{source:'dida',operation:'projects'}]});assert.equal(bad.status,'blocked');
 const ok=await h.project({action:'context_brief',objective:'目标',queries:[{source:'dida',operation:'projects'}],userRequested:true});assert.ok(ok.loopId,JSON.stringify(ok));
 await h.tool({action:'disconnect',source:'dida',userRequested:true});await h.tool({action:'connect',source:'dida',userRequested:true});
 const before=h.calls.length;assert.equal((await h.project({action:'context_brief',userRequested:true})).status,'blocked');assert.equal(h.calls.length,before);
});

test('selected sourced item executes once and its result rejoins the brief through the same ledger',async t=>{
 const binding={userHash:'c'.repeat(64),botHash:'d'.repeat(64)},sent=[],admissions=[];
 const h=await fixture(t,{readBinding:async()=>binding,contextLoop:{summarize:async input=>({changes:[],blockers:[],nextSteps:[{kind:'suggestion',text:'建议为当前事项整理下一步。',sourceIds:[input.sources.find(s=>s.role==='file'&&s.status==='ok').sourceId]}]})}});
 h.ctx.tools.register(defineTool({name:'send_wechat',description:'Synthetic only',parameters:{text:{type:'string',required:true}},output:{schema:{type:'object',additionalProperties:true},render:()=>[]},execute:args=>{sent.push(args.text);return{ok:true,message:'sent 1 synthetic'};}}));
 const root=join(h.agent.session.header.cwd,'other-project');await mkdir(join(root,'.agent/memory'),{recursive:true});for(const f of ['README.md','.agent/memory/progress.md','.agent/memory/context.md'])await writeFile(join(root,f),'Synthetic target project');
 const session=h.ctx.sessions.create(SessionId('loop-target'),{meta:{cwd:root}}),target={id:session.id,session,ctx:h.ctx,status:'idle',followup:message=>{admissions.push(message);}};h.agents.set(target.id,target);
 await h.project({action:'watch',project:root});await h.tool({action:'connect',source:'dida',userRequested:true});
 const brief=await h.project({action:'context_brief',project:root,objective:'推进当前事项',queries:[{source:'dida',operation:'projects',limit:2}],userRequested:true});assert.ok(brief.loopId,JSON.stringify(brief));
 const item=brief.items.find(i=>i.section==='nextSteps');assert.ok(item);
 const args={action:'context_handoff',project:root,revision:brief.revision,itemId:item.id,task:'请只读分析第二项并用三句话给出建议，不改文件。',userRequested:true};
 const handoff=await h.project(args);assert.equal(handoff.accepted,true,JSON.stringify(handoff));assert.ok(handoff.jobId);assert.equal(admissions.length,1);
 const duplicate=await h.project(args);assert.equal(duplicate.duplicate,true);assert.equal(duplicate.jobId,handoff.jobId);assert.equal(admissions.length,1);
 await h.adapter.taskResults.claimed({sessionId:target.id,messageId:String(admissions[0].id),turn:1,sourceKind:'user'});
 await h.adapter.taskResults.observe({sessionId:target.id,type:'assistant',turn:1,text:'SYNTHETIC RESULT unique reply'});
 await h.adapter.taskResults.observe({sessionId:target.id,type:'turn/end',turn:1,reason:{kind:'completed'}});
 assert.equal(sent.length,1);assert.match(sent[0],/SYNTHETIC RESULT/);
 const update=await h.project({action:'context_brief',project:root,userRequested:true});assert.equal(update.status,'updated',JSON.stringify(update));assert.equal(sent.length,1,'brief must not send a second reply');assert.doesNotMatch(update.text,/SYNTHETIC RESULT/);
 const quiet=await h.adapter.contextLoop.check({sessionId:h.agent.id,cwd:h.agent.session.header.cwd},{project:root,loopId:brief.loopId});assert.equal(quiet.quiet,true);assert.equal(admissions.length,1);assert.equal(sent.length,1);
 const status=await h.project({action:'context_status',project:root});assert.equal(status.executions.find(x=>x.jobId===handoff.jobId)?.status,'completed');
});
test('invalid model output returns separate bounded internal read and format diagnostics',async t=>{
 const h=await fixture(t,{contextLoop:{summarize:async()=>{throw Object.assign(Error('SYNTHETIC_PRIVATE_MODEL'),{code:'MODEL_INVALID_OUTPUT',validationDiagnostic:'JSON_SYNTAX'});}}});
 await h.tool({action:'connect',source:'flomo',userRequested:true});const root=h.agent.session.header.cwd;await h.project({action:'watch',project:root});
 const response=await h.ctx.tools.execute({callId:'format-probe',name:'project_companion',arguments:{action:'context_brief',project:root,objective:'整理项目简报',queries:[{source:'flomo',operation:'search',query:'DeepSeek',limit:2}],userRequested:true},agent:h.agent,signal:new AbortController().signal});
 assert.equal(response.isError,false);const value=response.value;assert.equal(value.modelDiagnostic,'MODEL_INVALID_OUTPUT');assert.equal(value.validationDiagnostic,'JSON_SYNTAX');assert.ok(value.readSummary.some(row=>row.source==='flomo'&&row.count===1));assert.ok(value.loopId);assert.equal(value.analysisState,'source_only');assert.deepEqual(value.items,[]);
 const rendered=JSON.stringify(response.content??response.message??response);assert.match(rendered,/内部脱敏读取概况/);assert.match(rendered,/本次读取范围和状态已保存/);assert.match(rendered,/不要.*清除旧简报/);assert.match(rendered,/内部脱敏格式诊断/);const summaries=rendered.match(/内部脱敏读取概况[^\n]*/)?.[0]??'';assert.doesNotMatch(summaries,/SYNTHETIC_PRIVATE_MODEL|Synthetic DeepSeek note|sourceId|m1/);
});
test('source HTTP structure diagnostics survive the native tool boundary without provider data',async t=>{
 const readDiagnostic={operation:'gmail_list',stage:'body_read',reason:'response_shape',responseStatus:204,bodyShape:'null',headersShape:'get',responseShape:'object'};
 const h=await fixture(t,{call:async()=>{throw Object.assign(Error('PRIVATE_BODY'),{code:'CONTEXT_PROTOCOL_INVALID',readDiagnostic:{...readDiagnostic,url:'PRIVATE_URL',body:'PRIVATE_BODY'}});},contextLoop:{summarize:async()=>{throw Object.assign(Error('PRIVATE_MODEL'),{code:'MODEL_INVALID_OUTPUT'});}}});
 await h.tool({action:'connect',source:'flomo',userRequested:true});const root=h.agent.session.header.cwd;await h.project({action:'watch',project:root});
 const response=await h.ctx.tools.execute({callId:'response-shape-probe',name:'project_companion',arguments:{action:'context_brief',project:root,queries:[{source:'flomo',operation:'search',query:'DeepSeek',limit:2}],userRequested:true},agent:h.agent,signal:new AbortController().signal});
 assert.equal(response.isError,false);assert.deepEqual(response.value.sourceDiagnostics[0].readDiagnostic,readDiagnostic);
 const rendered=JSON.stringify(response.content??response.message??response);assert.match(rendered,/内部脱敏来源诊断/);assert.match(rendered,/responseStatus/);assert.match(rendered,/bodyShape/);assert.doesNotMatch(rendered,/PRIVATE_BODY|PRIVATE_URL|PRIVATE_MODEL/);
});
test('brief rendering guides bounded counts and direct delivery without recycling source instructions',async t=>{
 const h=await fixture(t,{contextLoop:{summarize:async input=>({changes:[{kind:'inference',text:'示例进展',sourceIds:[input.sources.find(s=>s.role==='file').sourceId]}],blockers:[],nextSteps:[]})}});
 await h.tool({action:'connect',source:'flomo',userRequested:true});const root=h.agent.session.header.cwd;await h.project({action:'watch',project:root});
 const response=await h.ctx.tools.execute({callId:'scope-probe',name:'project_companion',arguments:{action:'context_brief',project:root,queries:[{source:'flomo',operation:'search',query:'DeepSeek',limit:2}],userRequested:true},agent:h.agent,signal:new AbortController().signal});
 const rendered=JSON.stringify(response.content??response.message??response);assert.match(rendered,/本次取到/);assert.match(rendered,/不代表账号总量/);assert.match(rendered,/不要.*重复.*请求/);assert.match(rendered,/来源.*指令/);
});

test('protected context check preserves bounded model diagnostics through the native tool result and renderer',async t=>{
 const diagnostic={attempts:[{attempt:1,requestedMaxTokens:6000,preparedMaxTokens:6000,reasoningEffort:'low',finish:'stop',textChars:800,reasoningChars:1200,outputTokens:700,reasoningTokens:null}]};
 for(const failure of [{code:'MODEL_INVALID_OUTPUT',validationDiagnostic:'CLAIM'},{code:'MODEL_INVALID_OUTPUT',validationDiagnostic:'PRIVATE_BAD_CATEGORY'},{code:'MODEL_TOKEN_LIMIT'}]){
  const h=await fixture(t,{contextLoop:{summarize:async()=>{throw Object.assign(Error('PRIVATE_PROVIDER_BODY'),failure,{modelRunDiagnostic:{...diagnostic,raw:'PRIVATE_MODEL_TEXT'},input:'PRIVATE_SOURCE'});}}});
  await h.project({action:'watch'});await h.tool({action:'connect',source:'dida',userRequested:true});
  const brief=await h.project({action:'context_brief',objective:'合成诊断',queries:[{source:'dida',operation:'projects',limit:2}],userRequested:true});assert.equal(brief.analysisState,'source_only');
  const activeLoop=h.adapter.followup.activeLoop;h.adapter.followup.activeLoop=e=>e.callId==='synthetic-diagnostic-wake'&&e.agent===h.agent?brief.loopId:null;
  try{
   const response=await h.ctx.tools.execute({callId:'synthetic-diagnostic-wake',name:'project_companion',arguments:{action:'context_check',loopId:brief.loopId},agent:h.agent,signal:new AbortController().signal});
   assert.equal(response.isError,false);const value=response.value;assert.equal(value.status,'blocked');assert.equal(value.quiet,false);assert.equal(value.modelDiagnostic,failure.code);assert.deepEqual(value.modelRunDiagnostic,diagnostic);
   const rendered=JSON.stringify(response.content??response.message??response);assert.match(rendered,/内部脱敏模型计数/);assert.match(rendered,/内部脱敏诊断代码/);
   if(failure.code==='MODEL_INVALID_OUTPUT'){assert.equal(value.code,'LOOP_MODEL_INVALID_OUTPUT');assert.equal(value.validationDiagnostic,failure.validationDiagnostic==='CLAIM'?'CLAIM':'UNKNOWN');assert.match(rendered,/内部脱敏格式诊断/);}else{assert.equal(value.code,'LOOP_MODEL_UNAVAILABLE');assert.equal(value.validationDiagnostic,undefined);}
   assert.doesNotMatch(JSON.stringify(response),/PRIVATE_PROVIDER_BODY|PRIVATE_MODEL_TEXT|PRIVATE_SOURCE|PRIVATE_BAD_CATEGORY/);
  }finally{h.adapter.followup.activeLoop=activeLoop;}
 }
});
