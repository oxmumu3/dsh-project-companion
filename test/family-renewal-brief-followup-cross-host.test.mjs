import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,realpath,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Context} from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import CommandRuntime from '@deepseek-ai/dsh-commands';
import Storage from '@deepseek-ai/dsh-storage';
import * as JsonStorage from '@deepseek-ai/dsh-storage-json';
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain';
import SessionStore,{SessionId} from '@deepseek-ai/dsh-session';
import {createScope} from '@deepseek-ai/dsh-scope';
import {ProactiveScheduler} from '../vendor/proactive/lib/scheduler.js';
import {installCompanion} from '../index.js';

const familyRoot=process.env.FAMILY_BRIDGE_ROOT;
const renewal='更新这个微信的 Dot 资料授权，使用我在电脑上启用的来源。';
const briefText='从 Gmail 搜索「subject:DeepSeek」最多1条，日历未来24小时最多2条，Drive 搜索「DeepSeek」最多1条，flomo 搜索 DeepSeek 最多2条，滴答清单列出清单最多2个，生成 Synthetic project 的项目简报。先不要设置提醒，不要建立计划。';
const fiveQueries=[{source:'gmail',operation:'search',query:'subject:DeepSeek',limit:1},{source:'calendar',operation:'upcoming',limit:2},{source:'drive',operation:'search',query:'DeepSeek',limit:1},{source:'flomo',operation:'search',query:'DeepSeek',limit:2},{source:'dida',operation:'projects',limit:2}];

for(const scenario of [
 {name:'complete brief stays quiet on unchanged sources',sourceOnly:false,unavailable:false,wakeFails:false},
 {name:'complete analysis with an unavailable source remains partial on unchanged evidence',sourceOnly:false,unavailable:true,wakeFails:false},
 {name:'QUOTE_MISMATCH source-only brief retries identical five-source evidence and completes one shot',sourceOnly:true,unavailable:false,wakeFails:false},
 {name:'unavailable source stays explicitly unknown instead of quiet after source-only recovery',sourceOnly:true,unavailable:true,wakeFails:false},
 {name:'repeated model failure after source-only brief stays unknown and does not deliver old success',sourceOnly:true,unavailable:false,wakeFails:true},
])test('real Family + Cordis renewal: '+scenario.name,{
 skip:familyRoot?false:'Set FAMILY_BRIDGE_ROOT to the checked Family source tree',
},async t=>{
 assert.ok(isAbsolute(familyRoot));
 const verifiedRoot=await realpath(familyRoot);
 assert.equal(JSON.parse(await readFile(join(verifiedRoot,'package.json'),'utf8')).name,'dsh-family-assistant');
 const {createRuntime}=await import(pathToFileURL(join(verifiedRoot,'src/runtime.mjs')).href);
 const root=await realpath(await mkdtemp(join(tmpdir(),'dot-renew-cross-host-'))),targetRoot=join(root,'project');
 for(const dir of [root,targetRoot]){
  await mkdir(join(dir,'.agent/memory'),{recursive:true});
  for(const file of ['README.md','.agent/memory/progress.md','.agent/memory/context.md'])await writeFile(join(dir,file),'Synthetic project evidence');
 }
 let now=new Date('2026-10-28T12:00:00.000Z'),modelPhase='valid',sourceUnavailable=false;
 const ctx=new Context(),agents=new Map(),intents=[],sent=[],reads=[],catalogs=[],summaries=[],schedulers=[],messages=[],wakeResults=[],wakeErrors=[];
 for(const [plugin,config]of[[SystemPrompt,{}],[ToolRuntime,{mode:'native'}],[CommandRuntime,undefined],[Storage,undefined],[JsonStorage,{root:join(root,'storage')}],[StorageDomain,{backend:'json'}],[SessionStore,undefined]])await ctx.plugin(plugin,config);
 ctx.provide('agents',{get:id=>agents.get(id),list:()=>[...agents.values()]});
 ctx.provide('workingDirectory',{get:s=>s.header.cwd,ensure:async a=>a.session.header.cwd});
 ctx.provide('agentDefaultModel',{currentSelection:()=>({provider:'synthetic',model:'synthetic'})});
 // Exercise the actual project summary adapter and strict validator; all model
 // responses and provider payloads in this host are synthetic fixtures.
 ctx.provide('llm',{async prepareCall(config,signal){return{config,async *stream(request){
  const input=JSON.parse(request.messages[0].content[0].text);summaries.push({previous:structuredClone(input.previous),sources:structuredClone(input.sources)});
  assert.deepEqual(request.tools,[]);assert.equal(signal.aborted,false);
  const sourceId=input.sources.find(row=>row.role==='file'&&row.status==='ok').sourceId;
  const value={changes:modelPhase==='quote_mismatch'?[{kind:'quote',text:'SYNTHETIC QUOTE THAT IS NOT IN ANY SOURCE',sourceIds:[sourceId]}]:[],blockers:[],nextSteps:[{kind:'suggestion',text:'核对合成项目的下一步。',sourceIds:[sourceId]}]};
  yield{type:'text-delta',index:0,text:JSON.stringify(value)};yield{type:'usage',usage:{outputTokens:1200}};yield{type:'finish',reason:{kind:'stop'}};
 }}}});
 const registry=[{workspaceId:'control',title:'Owner',path:join(root,'owner')},{workspaceId:'target',title:'Synthetic project',path:targetRoot}];
 ctx.provide('workspaceRegistry',{list:()=>registry.map(row=>({id:row.workspaceId,title:row.title,path:row.path,sessionIds:[]}))});
 ctx.provide('connection',{fetch:{register:()=>()=>{}}});
 let activeCall='none',counter=0,family,adapter,wakeScope,wakeLoop;
 const ownerAgent={
  ensureControlWorkspace:async()=>registry[0],listWorkspaces:async()=>registry.map(row=>({...row})),
  start:async intent=>{intents.push(structuredClone(intent));return{state:'running'};},
  observe:async intent=>({workspaceId:intent.workspaceId,sessionId:intent.sessionId,requestId:intent.requestId,cwd:intent.cwd,state:'running',requestSeen:true,queued:false,foreign:false,turn:1,activeTurn:1,activeRequestIds:[intent.requestId],events:[{type:'tool/call',seq:3,turn:1,callId:activeCall,status:'running'}]}),
 };
 await ctx.plugin({name:'renew-test-real-family',apply(scope){
  family=createRuntime({directory:join(root,'family'),now:()=>now.toISOString(),ownerAgent,intervalMs:1000000,workspaceCurrentSync:(path,id)=>registry.some(row=>row.path===path&&row.workspaceId===id),channelFactory:()=>({status:()=>({status:'connected'}),connect:async()=>{},disconnect:async()=>{},close:async()=>{},send:async(route,text,options)=>{assert.equal(options.authorize(),true);sent.push({personId:route.personId,text});return{status:'api_accepted'};}})});
  scope.provide('familyDotBridge',family.familyDotBridge);scope.effect(()=>()=>family.close());
 }});
 t.after(async()=>{await wakeScope?.dispose();await ctx.fiber.dispose();await rm(root,{recursive:true,force:true});});
 for(const [id,role]of[['owner','owner'],['mom','elder']]){family.store.addPerson({id,role,label:id});family.store.bindPerson(id,{accountId:'synthetic-account-'+id,peerId:'synthetic-peer-'+id});}
 await family.start();
 const receive=async text=>{await family.receive('owner',{id:'synthetic-message-'+(++counter),peerId:'synthetic-peer-owner',text,sourceTiming:{receivedAt:now.toISOString(),providerCreatedAt:now.toISOString()}});await family.settled();};
 await receive('从 flomo 搜索 DeepSeek 最多2条，生成 Synthetic project 的项目简报。不要建立计划。');
 assert.equal(intents.length,1);
 const originalSession=ctx.sessions.create(SessionId('context-owner'),{meta:{cwd:root}}),originalAgent={id:originalSession.id,session:originalSession,ctx,status:'idle'};
 agents.set(originalAgent.id,originalAgent);
 const ownerId=intents[0].sessionId,ownerSession=ctx.sessions.create(SessionId(ownerId),{meta:{cwd:root}});
 let familyAgent={id:ownerId,session:ownerSession,ctx,status:'idle'};agents.set(ownerId,familyAgent);
 const targetSession=ctx.sessions.create(SessionId('synthetic-target'),{meta:{cwd:targetRoot}});agents.set(targetSession.id,{id:targetSession.id,session:targetSession,ctx,status:'idle'});
 const config={didaToken:'synthetic-dida-v1',flomoToken:'synthetic-flomo-v1',googleClientId:'',googleClientSecret:'',googleRefreshToken:''};let credentialKey='d'.repeat(64);
 const stamp='2026-10-28T12:00:00.000Z';
 const transport={catalog:async source=>{catalogs.push(source);return{tools:source==='flomo'?[{name:'memo_search',inputSchema:{type:'object',properties:{keywords:{type:'string'},limit:{type:'integer'}}}}]:[{name:'list_projects',inputSchema:{type:'object',properties:{limit:{type:'integer'},offset:{type:'integer'}}}}],fetchedAt:stamp};},call:async(source,name,args)=>{reads.push({source,name,args});return{value:{structuredContent:source==='flomo'?{memos:[{id:'synthetic-memo',content:'Synthetic DeepSeek memo'}]}:{projects:[{id:'synthetic-list',name:'Synthetic list'}]}},fetchedAt:stamp};},close:async()=>{}};
 const googleAuth={status:()=>({clientConfigured:false,refreshConfigured:false,authInProgress:false}),getToken:async()=>assert.fail('no real credential'),close:async()=>{}};
 const googleSuiteAuth={status:()=>({clientConfigured:true,refreshConfigured:true,authInProgress:false,grantedSources:['gmail','calendar','drive']}),credentialState:source=>({configured:['gmail','calendar','drive'].includes(source),key:credentialKey}),getToken:async()=>assert.fail('no real token'),close:async()=>{}};
 const suiteTransport={catalog:async source=>({provenance:'bundled-contract',tools:[{name:source==='drive'?'search_files':'search_threads',inputSchema:{type:'object'}}]}),call:async(source,name,args)=>{reads.push({source,name,args});if(sourceUnavailable&&source==='gmail')throw Object.assign(new Error('SYNTHETIC_UNAVAILABLE'),{code:'CONTEXT_HTTP_ERROR'});return{value:{items:[source==='drive'?{id:'synthetic-file',name:'Synthetic DeepSeek file'}:{id:'synthetic-mail',subject:'Synthetic DeepSeek mail',snippet:'Synthetic content'}]},fetchedAt:stamp};},close:async()=>{}};
 const calendarTransport={catalog:async()=>({provenance:'bundled-contract',tools:[{name:'list_events',inputSchema:{type:'object'}}]}),call:async(source,name,args)=>{reads.push({source,name,args});return{value:{items:[]},fetchedAt:stamp};},close:async()=>{}};
 await ctx.plugin({name:'renew-test-real-dot',inject:['tools','commands','storageDomain','sessions','systemPrompt'],async apply(scope){adapter=await installCompanion(scope,{
  clock:()=>now,readSetup:async()=>({state:'bound',sessionId:'context-owner',bindingKey:'a'.repeat(64)}),readNativeRoute:async()=>({kind:'unbound'}),readBinding:async()=>null,family:{enabled:true},
  followup:{createScheduler:deps=>{const scheduler=new ProactiveScheduler(deps);schedulers.push(scheduler);return scheduler;}},
  context:{readConfig:()=>({...config}),googlePublisher:null,transport,googleAuth,googleSuiteAuth,suiteTransport,calendarTransport,fetch:async()=>assert.fail('no real network')},
  timers:{setInterval(){return{unref(){}};},clearInterval(){}},
 });}});
 async function tool(agent,name,args){activeCall='synthetic-tool-'+(++counter);const response=await ctx.tools.execute({callId:activeCall,name,arguments:args,agent,signal:new AbortController().signal});assert.equal(response.isError,false,JSON.stringify(response));return response.value;}
 const project=args=>tool(familyAgent,'project_companion',{project:targetRoot,...args});
 for(const source of ['gmail','calendar','drive','flomo','dida'])assert.notEqual((await tool(originalAgent,'personal_context',{action:'connect',source,userRequested:true})).status,'blocked');
 await tool(originalAgent,'project_companion',{action:'watch',project:targetRoot});
 const old=await project({action:'context_brief',objective:'OLD-OBJECTIVE',queries:[{source:'flomo',operation:'search',query:'DeepSeek',limit:2}],userRequested:true});
 assert.ok(old.loopId,JSON.stringify(old));assert.deepEqual(reads.map(row=>row.source),['flomo']);
 assert.equal(summaries.length,1);assert.equal(summaries[0].previous,null);
 // A real Family-signed message admits the original one-shot plan.
 await receive('2分钟后只读检查 Synthetic project 的这份简报一次，不要建立周期计划。');
 const oldPlan=await project({action:'check_once',delaySeconds:1,userRequested:true});assert.equal(oldPlan.status,'queued',JSON.stringify(oldPlan));assert.equal(oldPlan.loopId,old.loopId);
 const initialScope=adapter.familyRoute.getScope(ownerId);assert.ok(initialScope);
 const beforeRenewReads=reads.length;
 credentialKey='e'.repeat(64);config.flomoToken='synthetic-flomo-v2';config.didaToken='synthetic-dida-v2';
 await receive(renewal);
 const beforeEnable=await tool(familyAgent,'personal_context',{action:'connections'});assert.equal(beforeEnable.status,'blocked','changing credentials does not imply enabling or renewed Owner permission');assert.equal(reads.length,beforeRenewReads);
 for(const source of ['gmail','calendar','drive','flomo','dida'])assert.notEqual((await tool(originalAgent,'personal_context',{action:'connect',source,userRequested:true})).status,'blocked');
 await receive('查看连接状态');assert.equal((await tool(familyAgent,'personal_context',{action:'connections'})).status,'blocked','ordinary inquiry cannot renew');
 await receive(renewal);const renewed=await tool(familyAgent,'personal_context',{action:'connections'});assert.equal(renewed.status,'renewed',JSON.stringify(renewed));assert.deepEqual(renewed.sources.map(row=>row.id).sort(),fiveQueries.map(row=>row.source).sort());
 assert.equal(reads.length,beforeRenewReads,'enable and renewal do not read source content');
 const renewedScope=adapter.familyRoute.getScope(ownerId);assert.notEqual(renewedScope.leaseFingerprint,initialScope.leaseFingerprint);assert.notEqual(renewedScope.grantRevision,initialScope.grantRevision);assert.equal(adapter.familyRoute.isCurrent(initialScope),false);
 // Install a synthetic native agent only for genuine scheduler execution.
 const events=[];familyAgent={id:ownerId,status:'idle',session:{id:ownerId,header:{cwd:root,agentPreset:'default'},events,get seq(){return events.length;},requestHeader:()=>({config:{provider:'synthetic',model:'synthetic'}})},runMaintenance:async work=>work(),followup(message){messages.push(message);events.push({seq:events.length,type:'turn/start',data:{turn:messages.length},time:now.toISOString()},{seq:events.length+1,type:'user/message',data:message,time:now.toISOString()});},whenIdle:async()=>{
  try{
   const exact=await ctx.tools.execute({callId:'scheduler-check-'+messages.length,name:'project_companion',arguments:{action:'context_check',project:targetRoot,loopId:wakeLoop},agent:familyAgent,signal:new AbortController().signal});wakeResults.push(exact);assert.equal(exact.isError,false);
   if(scenario.wakeFails){
    assert.equal(exact.value?.quiet,false);assert.equal(exact.value?.status,'blocked');assert.equal(exact.value?.code,'LOOP_MODEL_INVALID_OUTPUT');
    events.push({seq:events.length,type:'assistant/message',data:{blocks:[{type:'text',text:'Synthetic analysis remains unknown; no successful summary.'}]},time:now.toISOString()});
   }else if(scenario.sourceOnly||scenario.unavailable){
    assert.equal(exact.value?.quiet,false,JSON.stringify(exact));assert.equal(exact.value?.analysisState,'complete');assert.equal(exact.value?.loopId,wakeLoop);
    if(scenario.unavailable){assert.equal(exact.value?.status,'partial');assert.equal(exact.value.coverage.find(row=>row.source==='gmail').unavailable,true);assert.match(exact.value.text,/来源读取未完成|内容.*未知/);}
    events.push({seq:events.length,type:'assistant/message',data:{blocks:[{type:'text',text:scenario.unavailable?'Synthetic source-backed summary; Gmail remains unknown.':'Synthetic source-backed summary recovered.'}]},time:now.toISOString()});
   }else{
    assert.equal(exact.value?.quiet,true,JSON.stringify(exact));
    const reclaimed=await ctx.tools.execute({callId:'scheduler-reclaim-'+messages.length,name:'proactive_reclaim',arguments:{reason:'没有新变化'},agent:familyAgent,signal:new AbortController().signal});assert.equal(reclaimed.isError,false);
    events.push({seq:events.length,type:'tool/call',data:{name:'proactive_reclaim',arguments:'{}'}});
   }
  }catch(error){wakeErrors.push(error);throw error;}
  events.push({seq:events.length,type:'turn/end',data:{reason:{kind:'completed'}},time:now.toISOString()});
 }};
 wakeScope=createScope(ctx,familyAgent);familyAgent.ctx=wakeScope.ctx;agents.set(ownerId,familyAgent);
 const drain=async()=>{for(const scheduler of schedulers)await scheduler.driveChain;if(wakeErrors.length)throw wakeErrors[0];};
 const tick=async seconds=>{now=new Date(now.getTime()+seconds*1000);for(const scheduler of schedulers)scheduler.requestDrive();await drain();};
 await drain();await tick(120);
 const stalePlan=await adapter.followup.onceStatus({root:targetRoot,sessionId:ownerId});assert.equal(stalePlan.status,'blocked',JSON.stringify(stalePlan));assert.equal(stalePlan.loopId,old.loopId);assert.equal(messages.length,0);assert.equal(reads.length,beforeRenewReads);assert.equal(sent.length,0);
 await receive(briefText);
 const inherited=await project({action:'context_brief',userRequested:true});assert.equal(inherited.status,'blocked');assert.equal(reads.length,beforeRenewReads);
 modelPhase=scenario.sourceOnly?'quote_mismatch':'valid';sourceUnavailable=scenario.unavailable;const beforeFreshSummaries=summaries.length;
 const current=await project({action:'context_brief',queries:fiveQueries,userRequested:true});
 assert.ok(current.loopId,JSON.stringify(current));assert.notEqual(current.loopId,old.loopId);assert.equal(current.objective,'整理项目简报');assert.equal(current.revision,2);assert.equal(summaries.at(-1).previous,null,'fresh scope must not expose old brief summary to the model');
 assert.equal(summaries.length-beforeFreshSummaries,scenario.sourceOnly?2:1,'QUOTE_MISMATCH exhausts only the one permitted repair');
 if(scenario.sourceOnly){assert.equal(current.status,'partial');assert.equal(current.quiet,false);assert.equal(current.analysisState,'source_only');assert.equal(current.validationDiagnostic,'QUOTE_MISMATCH');assert.deepEqual(current.items,[]);assert.deepEqual(current.executions,[]);assert.equal(Object.hasOwn(current,'summary'),false);}
 assert.deepEqual(reads.slice(beforeRenewReads).map(row=>row.source),fiveQueries.map(row=>row.source));assert.equal(current.sourceDiagnostics.length,scenario.unavailable?1:0);if(scenario.unavailable)assert.equal(current.sourceDiagnostics[0].source,'gmail');assert.equal(current.coverage.find(row=>row.source==='calendar').unavailable,false);assert.equal(current.references.filter(row=>row.source==='calendar'&&row.role!=='coverage').length,0);
 assert.deepEqual(family.store.snapshot().outbox.filter(row=>row.kind!=='harness_notice'),[],'brief must not enqueue a Dot result or reminder; synthetic running Owner tasks may emit Family wait notices');assert.equal((await adapter.followup.onceStatus({root:targetRoot,sessionId:ownerId})).status,'blocked','a new brief must not reactivate an old plan');
 const scope=adapter.familyRoute.getScope(ownerId);assert.equal(await adapter.familyRoute.recheck(scope,{root:targetRoot,loopId:old.loopId}),false);assert.equal(await adapter.familyRoute.recheck(scope,{root:targetRoot,loopId:current.loopId}),true);
 // A new explicit owner request is the only way to schedule the new scope.
 await receive('2分钟后只读检查 Synthetic project 的这份简报一次，不要建立周期计划。');
 const newPlan=await project({action:'check_once',loopId:current.loopId,delaySeconds:1,userRequested:true});assert.equal(newPlan.status,'queued',JSON.stringify(newPlan));assert.equal(newPlan.loopId,current.loopId);assert.notEqual(newPlan.alarmId,oldPlan.alarmId);
 modelPhase=scenario.wakeFails?'quote_mismatch':'valid';wakeLoop=current.loopId;await drain();const beforeWake=reads.length,beforeWakeSummaries=summaries.length;await tick(120);await family.settled();
 const done=await adapter.followup.onceStatus({root:targetRoot,sessionId:ownerId});assert.equal(done.status,scenario.wakeFails?'failed':'completed',JSON.stringify(done));assert.equal(done.lastCheckOutcome,scenario.wakeFails?undefined:scenario.unavailable?'partial':scenario.sourceOnly?'reviewed':'quiet');assert.equal(messages.length,1);assert.equal(wakeResults.length,1);assert.deepEqual(reads.slice(beforeWake).map(row=>row.source),fiveQueries.map(row=>row.source));
 assert.equal(summaries.length-beforeWakeSummaries,scenario.wakeFails?2:scenario.sourceOnly?1:0,'source-only state retries analysis even with unchanged evidence');
 if(scenario.sourceOnly){const evidence=rows=>rows.map(({sourceId,role,status,text,truncated})=>({sourceId,role,status,text,truncated}));assert.deepEqual(evidence(summaries.at(-1).sources),evidence(summaries[beforeFreshSummaries].sources),'all fingerprint source fields remain identical');assert.equal(summaries.at(-1).previous,null,'a failed summary is not previous successful evidence');}
 const delivered=sent.filter(row=>row.text.startsWith('Synthetic source-backed summary'));
 assert.equal(delivered.length,(scenario.sourceOnly||scenario.unavailable)&&!scenario.wakeFails?1:0,'only one successful nonquiet check is delivered through the real Family route');
 if(scenario.wakeFails){const notices=sent.filter(row=>row.text.startsWith('这次定时检查未能完成'));assert.equal(notices.length,1);assert.equal(done.failureNotificationStatus,'accepted');assert.equal(done.lastFailureCode,'LOOP_MODEL_INVALID_OUTPUT');assert.equal(await adapter.familyRoute.recheck(scope,{root:targetRoot,loopId:current.loopId}),true,'failed analysis preserves the authorized current context');assert.equal(done.loopId,current.loopId);assert.notEqual(done.loopId,old.loopId);assert.equal(done.lastReviewedAt,null,'failed analysis must not advance the successful check watermark');}
 if(!scenario.sourceOnly&&!scenario.unavailable)assert.deepEqual(family.store.snapshot().outbox.filter(row=>row.kind!=='harness_notice'),[],'unchanged complete Dot check must remain silent');
 const finalReadCount=reads.length;await tick(600);assert.equal(reads.length,finalReadCount);assert.equal(messages.length,1,'one-shot must not leave a periodic wake');assert.equal((await adapter.followup.status({root:targetRoot})).enabled,false);
 const member={...familyAgent,id:'family_member_synthetic'};assert.equal((await tool(member,'personal_context',{action:'query',source:'flomo',operation:'search',query:'DeepSeek',limit:2,userRequested:true})).status,'blocked');assert.equal(reads.length,finalReadCount,'family members cannot inherit Owner source permission');
});
