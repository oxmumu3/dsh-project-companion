import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,realpath,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
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
import {createProjectFollowup} from '../src/project-followup.js';
import {installCompanion} from '../index.js';

const familyRoot=process.env.FAMILY_BRIDGE_ROOT;
async function verifiedFamilyRuntime(){
 assert.ok(isAbsolute(familyRoot),'FAMILY_BRIDGE_ROOT must be an absolute source tree');
 const root=await realpath(familyRoot),metadata=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
 assert.equal(metadata.name,'dsh-family-assistant');
 const {createRuntime}=await import(pathToFileURL(join(root,'src/runtime.mjs')).href);
 assert.equal(typeof createRuntime,'function');return createRuntime;
}
test('real Family Owner WeChat admission + Cordis bridge + native Dot brief, handoff and one result',{skip:familyRoot?false:'Set FAMILY_BRIDGE_ROOT to a checked Family source tree'},async t=>{
 const createRuntime=await verifiedFamilyRuntime();
 const {createFamilyProjectExecutor}=await import(pathToFileURL(join(familyRoot,'src/family-project-executor.mjs')).href);
 const root=await realpath(await mkdtemp(join(tmpdir(),'family-dot-cross-host-'))),targetRoot=join(root,'target'),betaRoot=join(root,'beta');
 for(const dir of [root,targetRoot,betaRoot]){await mkdir(join(dir,'.agent/memory'),{recursive:true});for(const f of ['README.md','.agent/memory/progress.md','.agent/memory/context.md'])await writeFile(join(dir,f),'Synthetic project evidence');}
 const ctx=new Context();
 for(const [plugin,config] of [[SystemPrompt,{}],[ToolRuntime,{mode:'native'}],[CommandRuntime,undefined],[Storage,undefined],[JsonStorage,{root:join(root,'storage')}],[StorageDomain,{backend:'json'}],[SessionStore,undefined]])await ctx.plugin(plugin,config);
 const agents=new Map(),routes=new Map(),sent=[],intents=[],reads=[],admissions=[],catalogs=[];let activeCallId='not-active',changeRegistryBeforeSend=false;let registryRows=[{workspaceId:'control',title:'Owner',path:join(root,'owner')},{workspaceId:'target',title:'Synthetic project',path:targetRoot},{workspaceId:'beta',title:'Beta project',path:betaRoot}];
 ctx.provide('agents',{get:id=>agents.get(id),list:()=>[...agents.values()]});
 ctx.provide('workingDirectory',{get:session=>session.header.cwd});ctx.provide('workspaceRegistry',{list:()=>registryRows.map(row=>({id:row.workspaceId,title:row.title,path:row.path,sessionIds:[]}))});
 ctx.provide('connection',{fetch:{register:route=>{routes.set(route.path,route);return()=>routes.delete(route.path);}}});
 const oldSession=ctx.sessions.create(SessionId('context-owner'),{meta:{cwd:root}}),oldAgent={id:oldSession.id,session:oldSession,ctx,status:'idle'};agents.set(oldAgent.id,oldAgent);
 let ackRequestId=null;const ack='收到，正在只读检查。';const resultMessages=()=>sent.filter(row=>row.text.includes('README.md 第一行：'));
 const ownerAgent={ensureControlWorkspace:async()=>({workspaceId:'control',title:'Owner',path:join(root,'owner')}),listWorkspaces:async()=>registryRows.map(row=>({...row})),start:async intent=>{intents.push(structuredClone(intent));return{state:'running'};},observe:async intent=>intent.requestId===ackRequestId?({state:'succeeded',text:ack}):({workspaceId:intent.workspaceId,sessionId:intent.sessionId,requestId:intent.requestId,cwd:intent.cwd,state:'running',requestSeen:true,queued:false,foreign:false,turn:1,activeTurn:1,activeRequestIds:[intent.requestId],events:[{type:'tool/call',seq:3,turn:1,callId:activeCallId,status:'running'}]})};
 const executorReads=[];const llm={async *stream(options){executorReads.push(options);if(executorReads.length===1){const args=JSON.stringify({relativePath:'README.md'});yield{type:'block-start',index:0,blockType:'tool-call'};yield{type:'tool-call-delta',index:0,id:'readme',name:'read_project_file',argumentsDelta:args};yield{type:'block-end',index:0,block:{type:'tool-call',id:'readme',name:'read_project_file',arguments:args}};yield{type:'finish',reason:'tool-calls'};}else{yield{type:'text-delta',index:0,text:'SYNTHETIC CROSS RESULT'};yield{type:'finish',reason:'stop'};}}};
 const familyProjectExecutor=createFamilyProjectExecutor({ownerAgent,llm,readConfig:()=>({provider:'synthetic',model:'synthetic'})});
 let family;
 const familyFiber=await ctx.plugin({name:'synthetic-real-family',apply(scope){family=createRuntime({directory:join(root,'family'),ownerAgent,familyProjectExecutor,workspaceCurrentSync:(rootPath,id)=>registryRows.filter(row=>row.workspaceId===id&&row.path===rootPath).length===1&&registryRows.filter(row=>row.workspaceId===id||row.path===rootPath).length===1,intervalMs:1000000,channelFactory:()=>({status:()=>({status:'connected'}),connect:async()=>{},disconnect:async()=>{},close:async()=>{},send:async(route,text,options)=>{if(changeRegistryBeforeSend&&text.includes('README.md 第一行：'))registryRows=registryRows.filter(row=>row.workspaceId!=='target');if(options.authorize()!==true)throw Object.assign(Error('source authority changed'),{sendOutcome:'failed'});sent.push({personId:route.personId,text});return{status:'api_accepted'};}})});scope.provide('familyDotBridge',family.familyDotBridge);scope.effect(()=>()=>family.close());}});
 t.after(async()=>{await ctx.fiber.dispose();await rm(root,{recursive:true,force:true});});
 for(const [id,role] of [['owner','owner'],['mom','elder']]){family.store.addPerson({id,role,label:id});family.store.bindPerson(id,{accountId:'synthetic-account-'+id,peerId:'synthetic-peer-'+id});}
 await family.start();await family.receive('owner',{id:'first-owner-message',peerId:'synthetic-peer-owner',text:'从 flomo 搜索 DeepSeek 最多 2 条，日历未来 24 小时最多 2 条，生成 Synthetic project 的项目简报。先不要设置提醒。不要建立计划。'});await family.settled();assert.equal(intents.length,1);
 const ownerId=intents[0].sessionId,ownerSession=ctx.sessions.create(SessionId(ownerId),{meta:{cwd:root}}),familyAgent={id:ownerId,session:ownerSession,ctx,status:'idle'};agents.set(ownerId,familyAgent);
 const config={didaToken:'synthetic-only',flomoToken:'synthetic-only',googleClientId:'',googleClientSecret:'',googleRefreshToken:''};
 let failFlomo=false;const transport={catalog:async source=>{catalogs.push(source);if(failFlomo&&source==='flomo')throw Object.assign(Error('SYNTHETIC_PRIVATE'),{code:'CONTEXT_AUTH_REQUIRED',authDiagnostic:{stage:'token_endpoint_http',statusClass:'400',oauthError:'invalid_grant',error_description:'SYNTHETIC_PRIVATE'}});return{tools:source==='flomo'?[{name:'memo_search',inputSchema:{type:'object',properties:{keywords:{type:'string'},limit:{type:'integer'}}}}]:[{name:'list_projects',inputSchema:{type:'object',properties:{limit:{type:'integer'},offset:{type:'integer'}}}}],fetchedAt:'2026-10-19T12:00:00Z'};},call:async(source,name,args)=>{reads.push({source,name,args});return{value:{structuredContent:source==='flomo'?{memos:[{id:'synthetic-memo',content:'DeepSeek synthetic'}]}:{projects:[{id:'synthetic-p1',name:'Synthetic current project'}]}},fetchedAt:'2026-10-19T12:00:00Z'};},close:async()=>{}};
 const googleAuth={status:()=>({clientConfigured:false,refreshConfigured:false,authInProgress:false}),getToken:async()=>{throw Error('no real token');},close:async()=>{}};
 const googleSuiteAuth={status:()=>({clientConfigured:true,refreshConfigured:true,authInProgress:false,grantedSources:['gmail','calendar']}),credentialState:source=>({configured:['gmail','calendar'].includes(source),key:'d'.repeat(64)}),getToken:async()=>{throw Error('synthetic transport must not request token');},close:async()=>{}};
 const suiteTransport={catalog:async()=>({provenance:'bundled-contract',tools:[{name:'search_threads',inputSchema:{type:'object'}}]}),call:async(source,name,args)=>{reads.push({source,name,args});return{value:{items:[{id:'synthetic-mail',subject:'Synthetic email',snippet:'Synthetic content'}]},fetchedAt:'2026-10-19T12:00:00Z'};},close:async()=>{}};
 const calendarTransport={catalog:async()=>({provenance:'bundled-contract',tools:[{name:'list_events',inputSchema:{type:'object'}}]}),call:async(source,name,args)=>{reads.push({source,name,args});return{value:{items:[{id:'synthetic-event',summary:'Synthetic event',start:{dateTime:'2026-10-19T14:00:00Z'},end:{dateTime:'2026-10-19T15:00:00Z'}}]},fetchedAt:'2026-10-19T12:00:00Z'};},close:async()=>{}};
 let adapter, failSummary=false, failReason='MODEL_REQUEST_FAILED';
 const dotFiber=await ctx.plugin({name:'synthetic-real-dot',inject:['tools','commands','storageDomain','sessions','systemPrompt'],async apply(scope){adapter=await installCompanion(scope,{clock:()=>new Date('2026-10-19T12:00:00Z'),readSetup:async()=>({state:'bound',sessionId:'context-owner',bindingKey:'a'.repeat(64)}),readNativeRoute:async()=>({kind:'unbound'}),readBinding:async()=>null,family:{enabled:true},context:{readConfig:()=>({...config}),googlePublisher:null,transport,googleAuth,googleSuiteAuth,suiteTransport,calendarTransport,fetch:async()=>{throw Error('no real network');}},contextLoop:{summarize:async input=>{if(failSummary)throw Object.assign(Error('SYNTHETIC_PRIVATE_ERROR'),{code:failReason,validationDiagnostic:'JSON_SYNTAX'});return{changes:[],blockers:[],nextSteps:[{kind:'suggestion',text:'只读核对 README 第一行',sourceIds:[input.sources.find(row=>row.role==='file'&&row.status==='ok').sourceId]}]};}},timers:{setInterval(){return{unref(){}};},clearInterval(){}}});}});
 let counter=0;async function tool(agent,name,args,callId='cross-'+(++counter)){activeCallId=callId;const response=await ctx.tools.execute({callId,name,arguments:args,agent,signal:new AbortController().signal});return response.value;}
 async function completeOriginalAcknowledgement(prompt){const task=family.status().harness.tasks.filter(row=>row.prompt===prompt).at(-1);assert.ok(task?.sourceRequestId);assert.equal(task.delivery.state,'none');ackRequestId=task.requestId;let timer;try{await Promise.race([family.tick(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('gateway blocked by send barrier')),2500);})]);await family.settled();}finally{clearTimeout(timer);ackRequestId=null;}const original=family.status().harness.tasks.find(row=>row.id===task.id);assert.equal(original.sourceRequestId,task.sourceRequestId);assert.equal(original.delivery.state,'accepted');const rows=family.store.snapshot().outbox.filter(row=>row.sourceKey===`harness-task:${task.id}:${task.requestId}:0`);assert.equal(rows.length,1);assert.equal(rows[0].status,'api_accepted');assert.equal(rows[0].text,ack);}
 for(const source of ['dida','flomo','gmail','calendar']){const enabled=await tool(oldAgent,'personal_context',{action:'connect',source,userRequested:true});assert.notEqual(enabled.status,'blocked',JSON.stringify({source,enabled}));}
 const targetSession=ctx.sessions.create(SessionId('synthetic-target'),{meta:{cwd:targetRoot}}),target={id:targetSession.id,session:targetSession,ctx,status:'idle',followup:message=>admissions.push(message)};agents.set(target.id,target);
 await tool(oldAgent,'project_companion',{action:'watch',project:targetRoot});
 const betaSession=ctx.sessions.create(SessionId('synthetic-beta'),{meta:{cwd:betaRoot}});agents.set(betaSession.id,{id:betaSession.id,session:betaSession,ctx,status:'idle'});await tool(oldAgent,'project_companion',{action:'watch',project:betaRoot});
 const fakeOwner={...familyAgent,id:'family_member_11111111-1111-4111-8111-111111111111'};
 const denied=await tool(fakeOwner,'personal_context',{action:'query',source:'dida',operation:'projects',userRequested:true});assert.equal(denied.status,'blocked');assert.equal(reads.length,0);
 const bad=await ctx.tools.execute({callId:'forged-call',name:'personal_context',arguments:{action:'query',source:'dida',operation:'projects',userRequested:true},agent:familyAgent,signal:new AbortController().signal});assert.equal(bad.value.status,'blocked');assert.equal(reads.length,0);
 const sourceState=await tool(familyAgent,'personal_context',{action:'connections'});assert.ok(sourceState.sources,JSON.stringify(sourceState));
 reads.length=0;
 for(const [name,args] of [['project_companion',{action:'digest',project:betaRoot}],['project_companion',{action:'memory',project:targetRoot}],['project_companion',{action:'remember',project:targetRoot,memoryKind:'goal',memoryText:'SYNTHETIC-MUST-NOT-STORE',sourceKind:'user',userRequested:true}],['ai_digest',{action:'preview'}],['personal_context',{action:'connect',source:'flomo',userRequested:true}],['personal_context',{action:'disconnect',source:'calendar',userRequested:true}]]){const n=reads.length;const result=await tool(familyAgent,name,args);assert.equal(result.status,'blocked',JSON.stringify({name,args,result}));assert.equal(reads.length,n,'disabled action must not call a provider');}
 const afterDisabled=await tool(familyAgent,'personal_context',{action:'connections'});assert.equal(afterDisabled.sources.find(row=>row.id==='calendar').enabled,true,'blocked disconnect must preserve original authorization');assert.equal(afterDisabled.sources.find(row=>row.id==='flomo').enabled,true,'blocked connect must preserve original authorization');
 const swapped=await tool(familyAgent,'project_companion',{action:'context_brief',project:betaRoot,queries:[{source:'flomo',operation:'search',query:'DeepSeek',limit:2},{source:'calendar',operation:'upcoming',from:'2026-10-19T12:00:00Z',to:'2026-10-20T12:00:00Z',limit:2}],userRequested:true});assert.equal(swapped.status,'blocked');assert.equal(reads.length,0,'a model cannot substitute a different watched project');
 for(const [i,text] of ['先不要读取任何项目。从 flomo 搜索 DeepSeek 最多 2 条，日历未来 24 小时最多 2 条，生成 Synthetic project 的项目简报。','不要看 Synthetic project，从 flomo 搜索 DeepSeek 最多 2 条，日历未来 24 小时最多 2 条，生成项目简报。','如果是 Synthetic project 会怎样，从 flomo 搜索 DeepSeek 最多 2 条，日历未来 24 小时最多 2 条，生成项目简报。'].entries()){
  await family.receive('owner',{id:'project-denial-'+i,peerId:'synthetic-peer-owner',text});await family.settled();const deniedProject=await tool(familyAgent,'project_companion',{action:'context_brief',project:targetRoot,queries:[{source:'flomo',operation:'search',query:'DeepSeek',limit:2},{source:'calendar',operation:'upcoming',from:'2026-10-19T12:00:00Z',to:'2026-10-20T12:00:00Z',limit:2}],userRequested:true});assert.equal(deniedProject.status,'blocked');assert.equal(reads.length,0,'negated/hypothetical target must block before provider reads');
 }
 await family.receive('owner',{id:'restored-owner-request',peerId:'synthetic-peer-owner',text:'从 flomo 搜索 DeepSeek 最多 2 条，日历未来 24 小时最多 2 条，生成 Synthetic project 的项目简报。先不要设置提醒。不要建立计划。'});await family.settled();
 const brief=await tool(familyAgent,'project_companion',{action:'context_brief',project:targetRoot,queries:[{source:'flomo',operation:'search',query:'DeepSeek',limit:2},{source:'calendar',operation:'upcoming',from:'2026-10-19T11:59:50Z',to:'2026-10-20T11:59:50Z',limit:2}],userRequested:true});assert.ok(brief.loopId,JSON.stringify(brief));assert.equal(brief.objective,'整理项目简报');
 const item=brief.items.find(row=>row.section==='nextSteps');assert.ok(item);assert.deepEqual(reads.map(row=>row.source),['flomo','calendar']);assert.equal(reads[1].args.startTime,'2026-10-19T12:00:00.000Z');assert.equal(reads[1].args.endTime,'2026-10-20T12:00:00.000Z');
 // Real Family ingress and ownership gates wrap the same fallback; only synthetic sources are read.
 failSummary=true;const beforeFallbackReads=reads.length,beforeFallbackSends=sent.length;
 const fallback=await tool(familyAgent,'project_companion',{action:'context_brief',project:targetRoot,objective:'本次范围摘录',queries:[{source:'flomo',operation:'search',query:'DeepSeek',limit:2},{source:'calendar',operation:'upcoming',limit:2}],userRequested:true});
 assert.equal(fallback.status,'partial',JSON.stringify(fallback));assert.equal(fallback.modelDiagnostic,'MODEL_REQUEST_FAILED');assert.match(fallback.text,/原文摘录/);assert.match(fallback.text,/Synthetic project evidence/);assert.match(fallback.text,/flomo/);assert.match(fallback.text,/calendar/);assert.doesNotMatch(fallback.text,/SYNTHETIC_PRIVATE_ERROR/);assert.ok(!fallback.loopId);assert.deepEqual(reads.slice(beforeFallbackReads).map(row=>row.source),['flomo','calendar']);assert.equal(sent.length,beforeFallbackSends);reads.splice(beforeFallbackReads);failSummary=false;
 failFlomo=true;failSummary=true;const beforeFailReads=reads.length;const partial=await tool(familyAgent,'project_companion',{action:'context_brief',project:targetRoot,objective:'合成来源诊断',queries:[{source:'flomo',operation:'search',query:'DeepSeek',limit:2},{source:'calendar',operation:'upcoming',limit:2}],userRequested:true});
 assert.equal(partial.status,'partial');assert.deepEqual(partial.sourceDiagnostics,[{source:'flomo',code:'CONTEXT_AUTH_REQUIRED',authDiagnostic:{stage:'token_endpoint_http',statusClass:'400',oauthError:'invalid_grant'}}]);assert.doesNotMatch(JSON.stringify(partial),/SYNTHETIC_PRIVATE/);reads.splice(beforeFailReads);failFlomo=false;failSummary=false;
 failFlomo=true;failSummary=true;failReason='MODEL_INVALID_OUTPUT';const beforeInvalidReads=reads.length;const invalid=await tool(familyAgent,'project_companion',{action:'context_brief',project:targetRoot,objective:'合成格式诊断',queries:[{source:'flomo',operation:'search',query:'DeepSeek',limit:2},{source:'calendar',operation:'upcoming',limit:2}],userRequested:true});
 assert.equal(invalid.status,'partial');assert.equal(invalid.modelDiagnostic,'MODEL_INVALID_OUTPUT');assert.equal(invalid.validationDiagnostic,'JSON_SYNTAX');assert.match(invalid.text,/格式不正确/);assert.match(invalid.text,/原文摘录/);assert.ok(!invalid.loopId);assert.equal(invalid.readSummary.find(row=>row.source==='flomo').code,'CONTEXT_AUTH_REQUIRED');assert.equal(invalid.readSummary.find(row=>row.source==='calendar').status,'ok');assert.deepEqual(invalid.sourceDiagnostics,[{source:'flomo',code:'CONTEXT_AUTH_REQUIRED',authDiagnostic:{stage:'token_endpoint_http',statusClass:'400',oauthError:'invalid_grant'}}]);assert.doesNotMatch(JSON.stringify({readSummary:invalid.readSummary,sourceDiagnostics:invalid.sourceDiagnostics}),/SYNTHETIC_PRIVATE|synthetic-event/);assert.deepEqual(reads.slice(beforeInvalidReads).map(row=>row.source),['calendar']);assert.equal(sent.length,beforeFallbackSends);reads.splice(beforeInvalidReads);failFlomo=false;failSummary=false;failReason='MODEL_REQUEST_FAILED';
 const forbidden=await tool(familyAgent,'project_companion',{action:'check_once',project:targetRoot,loopId:brief.loopId,delaySeconds:60,userRequested:true});
 assert.equal(forbidden.status,'blocked','model-supplied userRequested cannot override the actual Owner denial');
 const readonly=await tool(familyAgent,'project_companion',{action:'context_handoff',project:targetRoot,revision:brief.revision,itemId:item.id,task:'只读检查 README 第一行',userRequested:true});
 assert.equal(readonly.accepted,false,'a model cannot fabricate an instruction from the initial brief request');assert.equal(admissions.length,0);
 await family.receive('owner',{id:'owner-read-handoff',peerId:'synthetic-peer-owner',text:'请把刚才第一项交给 Synthetic project，只读检查 README 第一行，不要修改文件。'});await family.settled();
 const request={action:'context_handoff',project:targetRoot,revision:brief.revision,itemId:item.id,task:'只读检查 README 第一行',userRequested:true};
 const handed=await tool(familyAgent,'project_companion',request);assert.equal(handed.accepted,true,JSON.stringify(handed));assert.equal(admissions.length,0,'must not use unrestricted target native session');
 await new Promise(resolve=>setTimeout(resolve,100));assert.equal(resultMessages().length,0,'result waits for original Owner acknowledgement');await completeOriginalAcknowledgement('请把刚才第一项交给 Synthetic project，只读检查 README 第一行，不要修改文件。');
 for(let n=0;n<100&&resultMessages().length===0;n++)await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal(resultMessages().length,1);assert.equal(sent.length,2,'one same-source acknowledgement and one result only');const resultKey='family-dot:'+createHash('sha256').update(JSON.stringify([ownerId,'owner-project-read:'+handed.jobId])).digest('hex');const resultRows=family.store.snapshot().outbox.filter(row=>row.sourceKey===resultKey);assert.equal(resultRows.length,1);assert.equal(resultRows[0].kind,'dot_result');assert.equal(resultRows[0].status,'api_accepted');assert.equal(resultRows[0].text,resultMessages()[0].text);assert.equal(resultMessages()[0].personId,'owner');assert.match(resultMessages()[0].text,/README\.md 第一行：\nSynthetic project evidence/);assert.ok(sent.findIndex(row=>row.text===ack)<sent.findIndex(row=>row.text===resultMessages()[0].text),'same turn acknowledgement precedes result');assert.equal(executorReads.length,0,'scoped first-line execution must not rely on a model');
 await family.receive('owner',{id:'direct-read-owner-message',peerId:'synthetic-peer-owner',text:'请只读检查 Synthetic project 的 README.md 第一行，不要修改文件。'});await family.settled();
 const forgedTask=await tool(familyAgent,'project_companion',{action:'coordinate',project:targetRoot,task:'只读检查 README.md 第一行，再看 SECRET-SYNTHETIC.md',userRequested:true});
 assert.equal(forgedTask.accepted,true,JSON.stringify(forgedTask));await completeOriginalAcknowledgement('请只读检查 Synthetic project 的 README.md 第一行，不要修改文件。');for(let n=0;n<100&&resultMessages().length<2;n++)await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal(resultMessages().length,2);assert.match(resultMessages()[1].text,/README\.md 第一行：\nSynthetic project evidence/);assert.doesNotMatch(resultMessages()[1].text,/SECRET-SYNTHETIC/,'model-supplied extra file must not be read or returned');assert.equal(executorReads.length,0);
 await family.receive('owner',{id:'registry-race-owner-message',peerId:'synthetic-peer-owner',text:'请只读检查 Synthetic project 的 README.md 第一行，不要修改文件。'});await family.settled();
 changeRegistryBeforeSend=true;const raced=await tool(familyAgent,'project_companion',{action:'coordinate',project:targetRoot,task:'只读检查 README.md 第一行',userRequested:true});assert.equal(raced.accepted,true,JSON.stringify(raced));await completeOriginalAcknowledgement('请只读检查 Synthetic project 的 README.md 第一行，不要修改文件。');
 for(let n=0;n<100&&registryRows.some(row=>row.workspaceId==='target');n++)await new Promise(resolve=>setTimeout(resolve,10));assert.equal(resultMessages().length,2,'last dispatch guard must suppress a removed project');
 changeRegistryBeforeSend=false;registryRows.push({workspaceId:'target',title:'Synthetic project',path:targetRoot});
 await family.receive('owner',{id:'natural-request-handoff',peerId:'synthetic-peer-owner',text:'把这个任务交给 Synthetic project：只读检查 README.md 第一行，不要修改文件。完成后把结果回给我。'});await family.settled();
 const normal=await tool(familyAgent,'project_companion',{action:'coordinate',project:targetRoot,task:'只读检查 README.md 第一行',userRequested:true});
 assert.equal(normal.accepted,true,JSON.stringify(normal));await completeOriginalAcknowledgement('把这个任务交给 Synthetic project：只读检查 README.md 第一行，不要修改文件。完成后把结果回给我。');
 for(let n=0;n<100&&resultMessages().length<3;n++)await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal(resultMessages().length,3);assert.equal(admissions.length,0,'must not dispatch into an unrestricted native session');
 for(const [i,text] of [
   '如果把这个任务交给 Synthetic project：只读检查 README.md 第一行，会怎样？',
   '把这个任务交给 Synthetic project：只读检查 README.md 第一行。不要读取第一行。',
   '把这个任务交给 Synthetic project：只读检查 README.md 第一行并修改文件。',
   '把这个任务交给 Synthetic project：只读检查 README.md 第一行。接着读取 secret.md。',
   '把这个任务交给 Synthetic project：只读检查 README.md 第一行，并且读取第二行。',
   '把这个任务交给 Synthetic project：只读检查 README.md 第一行。然后修改文件。',
   '把这个任务交给 Synthetic project：只读检查 README.md 第一行。现在取消刚才的交办。',
   '把这个任务交给 Synthetic project：只读检查 README.md 第一行。刚才只是开玩笑。',
   '请只读检查 Synthetic project 的 README.md 第一行。现在取消刚才的交办。',
   '请只读检查 Synthetic project 的 README.md 第一行。把 Synthetic project 的其他文件发给我。',
   '把这个任务交给 Synthetic project：只读检查 README.md 第一行。完成后把结果回给我。然后修改文件。',
 ].entries()){
  await family.receive('owner',{id:'natural-request-deny-'+i,peerId:'synthetic-peer-owner',text});await family.settled();
  const denied=await tool(familyAgent,'project_companion',{action:'coordinate',project:targetRoot,task:'只读检查 README.md 第一行',userRequested:true});
  assert.equal(denied.accepted,false,JSON.stringify({text,denied}));
 }
 assert.equal(resultMessages().length,3,'rejected requests must not send results');assert.equal(admissions.length,0);
 const readCount=reads.length;
 await family.receive('owner',{id:'second-owner-message',peerId:'synthetic-peer-owner',text:'两分钟后检查一次刚才那份简报，不要设周期计划。'});await family.settled();
 const next=await tool(familyAgent,'project_companion',{action:'check_once',project:targetRoot,loopId:brief.loopId,delaySeconds:120,userRequested:true});
 assert.equal(next.status,'blocked','Family natural-language scheduling remains disabled until a bounded contract is enforced');
 await family.receive('owner',{id:'third-owner-message',peerId:'synthetic-peer-owner',text:'取消刚才那次检查。'});await family.settled();
 const cancelled=await tool(familyAgent,'project_companion',{action:'cancel_once',project:targetRoot});assert.equal(cancelled.status,'blocked','Family natural-language cancellation is not enabled in this candidate');
 await family.receive('owner',{id:'fourth-owner-message',peerId:'synthetic-peer-owner',text:'不要看 flomo，只看日历，更新上一份简报。'});await family.settled();
 const noQueries=await tool(familyAgent,'project_companion',{action:'context_brief',project:targetRoot,userRequested:true});
 assert.equal(noQueries.status,'blocked','an inherited manifest cannot silently retain a now-forbidden source');assert.equal(reads.length,readCount);
 await family.receive('owner',{id:'bounded-context-owner-message',peerId:'synthetic-peer-owner',text:'从 flomo 搜索 DeepSeek 最多 2 条，日历未来 24 小时最多 2 条，生成 Synthetic project 的项目简报。'});await family.settled();
 const memo={source:'flomo',operation:'search',query:'DeepSeek',limit:2},calendar={source:'calendar',operation:'upcoming',from:'2026-10-19T12:00:00Z',to:'2026-10-20T12:00:00Z',limit:2};
 const beforeBounded=reads.length;for(const queries of [[{...memo,query:'private'},calendar],[{...memo,limit:3},calendar]]){const rejected=await tool(familyAgent,'project_companion',{action:'context_brief',project:targetRoot,queries,userRequested:true});assert.equal(rejected.status,'blocked');assert.equal(reads.length,beforeBounded);}
 const normalized=await tool(familyAgent,'project_companion',{action:'context_brief',project:targetRoot,queries:[memo,{...calendar,to:'2026-10-26T12:00:00Z'}],userRequested:true});assert.ok(normalized.loopId);assert.equal(reads.at(-1).args.startTime,'2026-10-19T12:00:00.000Z');assert.equal(reads.at(-1).args.endTime,'2026-10-20T12:00:00.000Z');reads.splice(beforeBounded);
 const bounded=await tool(familyAgent,'project_companion',{action:'context_brief',project:targetRoot,queries:[memo,calendar],userRequested:true});assert.ok(bounded.loopId,JSON.stringify(bounded));assert.deepEqual(reads.slice(beforeBounded).map(row=>row.source),['flomo','calendar']);
 const adversarial=[
  {text:'Synthetic project 项目简报，只查 Alice 发的邮件，最多 2 条。',q:{source:'gmail',operation:'search',query:'Alice',limit:2}},
  {text:'Synthetic project 项目简报，只查明天下午 2 点到 3 点的日历。',q:{source:'calendar',operation:'upcoming',from:'2026-10-19T12:00:00Z',to:'2026-10-26T12:00:00Z',limit:2}},
  {text:'Synthetic project 项目简报，只查关于 Zoom 的日历。',q:{source:'calendar',operation:'upcoming',from:'2026-10-19T12:00:00Z',to:'2026-10-20T12:00:00Z',limit:2}},
  {text:'Synthetic project 项目简报，只看滴答今天的工作任务。',q:{source:'dida',operation:'projects',limit:2}},
 ];
 for(const [i,row] of adversarial.entries()){await family.receive('owner',{id:'adversarial-owner-'+i,peerId:'synthetic-peer-owner',text:row.text});await family.settled();const n=reads.length;const rejected=await tool(familyAgent,'project_companion',{action:'context_brief',project:targetRoot,queries:[row.q],userRequested:true});assert.equal(rejected.status,'blocked',JSON.stringify(row));assert.equal(reads.length,n,'unsupported user restriction must block before provider reads');}
 const finalReadCount=reads.length,finalSentCount=sent.length;
 family.store.bindPerson('owner',{accountId:'new-synthetic-account',peerId:'new-synthetic-peer'});
 const stale=await tool(familyAgent,'personal_context',{action:'query',source:'dida',operation:'projects',userRequested:true});assert.equal(stale.status,'blocked');assert.equal(reads.length,finalReadCount);assert.equal(sent.length,finalSentCount,'stale binding must not send any new result');
 await dotFiber.dispose();await familyFiber.dispose();
});

test('synthetic internal scheduler with real Family outbox: quiet, one changed push, cancelled check',{skip:familyRoot?false:'Set FAMILY_BRIDGE_ROOT to a checked Family source tree'},async t=>{
 const createRuntime=await verifiedFamilyRuntime();
 const temp=await realpath(await mkdtemp(join(tmpdir(),'family-dot-wake-cross-'))),root=join(temp,'project'),ownerRoot=join(temp,'owner');await mkdir(root);await mkdir(ownerRoot);
 const sent=[],intents=[];let activeCall='sign-call',online=true;
 const ownerAgent={ensureControlWorkspace:async()=>({workspaceId:'control',title:'Owner',path:ownerRoot}),listWorkspaces:async()=>[{workspaceId:'control',title:'Owner',path:ownerRoot}],start:async intent=>{intents.push(structuredClone(intent));return{state:'running'};},observe:async intent=>({workspaceId:intent.workspaceId,sessionId:intent.sessionId,requestId:intent.requestId,cwd:intent.cwd,state:'running',requestSeen:true,queued:false,foreign:false,turn:1,activeTurn:1,activeRequestIds:[intent.requestId],events:[{type:'tool/call',seq:3,turn:1,callId:activeCall,status:'running'}]})};
 const family=createRuntime({directory:join(temp,'family'),ownerAgent,intervalMs:1000000,channelFactory:()=>({status:()=>({status:online?'connected':'error'}),connect:async()=>{},disconnect:async()=>{},close:async()=>{},send:async(route,text,options)=>{assert.equal(options.authorize(),true);sent.push({personId:route.personId,text});return{status:'api_accepted'};}})});
 family.store.addPerson({id:'owner',role:'owner',label:'owner'});family.store.bindPerson('owner',{accountId:'synthetic-account',peerId:'synthetic-peer'});await family.start();
 await family.receive('owner',{id:'original',peerId:'synthetic-peer',text:'请查看项目进展'});await family.settled();assert.equal(intents.length,1);
 const sessionId=intents[0].sessionId,bridge=family.familyDotBridge,signed=await bridge.resolveOwnerCall({sessionId,callId:'sign-call'});assert.ok(signed);
 const signedScope={familySessionId:sessionId,bindingRevision:signed.bindingRevision};
 const familyRoute={getScope:id=>id===sessionId?signedScope:null,isCurrent:scope=>scope===signedScope&&bridge.isOwnerRevisionCurrent(sessionId,scope.bindingRevision),recheck:async scope=>bridge.isOwnerRevisionCurrent(sessionId,scope.bindingRevision),
  routeState:({sessionId,bindingRevision})=>bridge.ownerRouteStatus({sessionId,bindingRevision}),
  readDelivery:({scope,requestId})=>bridge.readOwnerDelivery({sessionId,bindingRevision:scope.bindingRevision,requestId}),
  send:({scope,requestId,text,authorize})=>bridge.sendOwner({sessionId,bindingRevision:scope.bindingRevision,requestId,text,authorize})};
 const binding={userHash:signed.bindingRevision,botHash:createHash('sha256').update('family-dot:'+signed.bindingRevision).digest('hex')};
 const ctx=new Context();await ctx.plugin(SystemPrompt,{});await ctx.plugin(ToolRuntime,{mode:'native'});ctx.provide('familyDotBridge',bridge);
 ctx.provide('workingDirectory',{get:session=>session.header.cwd,ensure:async agent=>agent.session.header.cwd});
 const events=[],messages=[],tools=[],schedulers=[],errors=[];let now=new Date('2026-10-18T16:00:00Z'),quiet=true,adapter;
 const owner={id:sessionId,status:'idle',session:{id:sessionId,header:{cwd:ownerRoot,agentPreset:'default'},events,get seq(){return events.length;},requestHeader:()=>({config:{provider:'synthetic',model:'synthetic'}})},runMaintenance:async work=>work(),
  followup(message){messages.push(message);events.push({seq:events.length,type:'turn/start',data:{turn:messages.length},time:now.toISOString()},{seq:events.length+1,type:'user/message',data:message,time:now.toISOString()});},
  whenIdle:async()=>{try{
   const result=await ctx.tools.execute({callId:'wake-'+messages.length,name:'project_companion',arguments:{action:'context_check',project:root,loopId:'loop_123'},agent:owner,signal:new AbortController().signal});assert.equal(result.isError,false,JSON.stringify(result));
   if(quiet){const reclaimed=await ctx.tools.execute({callId:'reclaim-'+messages.length,name:'proactive_reclaim',arguments:{reason:'没有新变化'},agent:owner,signal:new AbortController().signal});assert.equal(reclaimed.isError,false);events.push({seq:events.length,type:'tool/call',data:{name:'proactive_reclaim',arguments:'{}'}});}
   else events.push({seq:events.length,type:'assistant/message',data:{blocks:[{type:'text',text:'Synthetic new change'}]},time:now.toISOString()});
  }catch(error){errors.push(error);throw error;}
  events.push({seq:events.length,type:'turn/end',data:{reason:{kind:'completed'}},time:now.toISOString()});}};
 const ownerScope=createScope(ctx,owner);owner.ctx=ownerScope.ctx;ctx.provide('agents',{get:id=>id===sessionId?owner:undefined});ctx.provide('agentDefaultModel',{currentSelection:()=>({provider:'synthetic',model:'synthetic'})});
 ctx.tools.register(defineTool({name:'project_companion',description:'Synthetic bounded scoped check only',parameters:{action:{type:'string'},project:{type:'string'},loopId:{type:'string'}},output:{schema:{type:'object',additionalProperties:true},render:()=>[]},execute:async args=>{tools.push(args);return{ok:true,quiet};}}));
 adapter=createProjectFollowup({ctx,clock:()=>now,hostTimeZone:'America/Mexico_City',authorizeRoot:async value=>value===root,readBinding:async()=>binding,readConnection:async()=>({state:'bound',sessionId,bindingKey:signed.bindingRevision}),familyRoute,createScheduler:deps=>{const s=new ProactiveScheduler(deps);schedulers.push(s);return s;}});
 t.after(async()=>{await adapter.close();await ownerScope.dispose();await ctx.fiber.dispose();await family.close();await rm(temp,{recursive:true,force:true});});
 const args={root,sessionId,projectLabel:'Synthetic project',loopId:'loop_123',delivery:'family',delaySeconds:60};
 const drain=async()=>{for(const scheduler of schedulers)await scheduler.driveChain;if(errors.length)throw errors[0];};
 const tick=async seconds=>{now=new Date(now.getTime()+seconds*1000);for(const scheduler of schedulers)scheduler.requestDrive();await drain();};
 await adapter.checkOnce(args);await drain();online=false;family.store.setConnection('owner',{status:'error'});await tick(60);
 assert.equal(tools.length,0,'offline must not wake or read');assert.equal(sent.length,0);
 online=true;family.store.setConnection('owner',{status:'connected'});await tick(30);assert.equal((await adapter.onceStatus(args)).status,'completed');assert.equal(tools.length,1);assert.equal(sent.length,0,'quiet check must not send');
 quiet=false;await adapter.checkOnce(args);await drain();await tick(60);assert.equal((await adapter.onceStatus(args)).status,'completed');assert.equal(tools.length,2);assert.deepEqual(sent,[{personId:'owner',text:'Synthetic new change'}]);
 await adapter.checkOnce(args);await drain();assert.equal((await adapter.cancelOnce(args)).status,'cancelled');await tick(120);assert.equal(tools.length,2);assert.equal(sent.length,1);
 await adapter.checkOnce(args);await drain();family.store.bindPerson('owner',{accountId:'changed-account',peerId:'changed-peer'});await tick(60);assert.equal((await adapter.onceStatus(args)).status,'blocked');assert.equal(tools.length,2);assert.equal(sent.length,1);
});
