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
test('A new ordinary Owner message does not cancel an earlier authorized read',{skip:familyRoot?false:'Set FAMILY_BRIDGE_ROOT to a checked Family source tree'},async t=>{
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
 let ackFinished=false;const ack='已经派出去了：让独立只读检查跑一遍，不碰原项目会话，也不改文件。结果出来会回到这里。'+(process.env.ACK_MATERIAL==='1'?'另外授权已变更。':'');const ownerAgent={ensureControlWorkspace:async()=>({workspaceId:'control',title:'Owner',path:join(root,'owner')}),listWorkspaces:async()=>registryRows.map(row=>({...row})),start:async intent=>{intents.push(structuredClone(intent));return{state:'running'};},observe:async intent=>ackFinished?({state:'succeeded',text:ack}):({workspaceId:intent.workspaceId,sessionId:intent.sessionId,requestId:intent.requestId,cwd:intent.cwd,state:'running',requestSeen:true,queued:false,foreign:false,turn:1,activeTurn:1,activeRequestIds:[intent.requestId],events:[{type:'tool/call',seq:3,turn:1,callId:activeCallId,status:'running'}]})};
 const executorReads=[];const llm={async *stream(options){executorReads.push(options);if(executorReads.length===1){const args=JSON.stringify({relativePath:'README.md'});yield{type:'block-start',index:0,blockType:'tool-call'};yield{type:'tool-call-delta',index:0,id:'readme',name:'read_project_file',argumentsDelta:args};yield{type:'block-end',index:0,block:{type:'tool-call',id:'readme',name:'read_project_file',arguments:args}};yield{type:'finish',reason:'tool-calls'};}else{yield{type:'text-delta',index:0,text:'SYNTHETIC CROSS RESULT'};yield{type:'finish',reason:'stop'};}}};
 const familyProjectExecutor=createFamilyProjectExecutor({ownerAgent,llm,readConfig:()=>({provider:'synthetic',model:'synthetic'})});
 let family;
 const familyFiber=await ctx.plugin({name:'synthetic-real-family',apply(scope){family=createRuntime({directory:join(root,'family'),ownerAgent,familyProjectExecutor,workspaceCurrentSync:(rootPath,id)=>registryRows.filter(row=>row.workspaceId===id&&row.path===rootPath).length===1&&registryRows.filter(row=>row.workspaceId===id||row.path===rootPath).length===1,intervalMs:1000000,channelFactory:()=>({status:()=>({status:'connected'}),connect:async()=>{},disconnect:async()=>{},close:async()=>{},send:async(route,text,options)=>{if(changeRegistryBeforeSend)registryRows=registryRows.filter(row=>row.workspaceId!=='target');if(options.authorize()!==true)throw Object.assign(Error('source authority changed'),{sendOutcome:'failed'});sent.push({personId:route.personId,text});return{status:'api_accepted'};}})});scope.provide('familyDotBridge',family.familyDotBridge);scope.effect(()=>()=>family.close());}});
 t.after(async()=>{await ctx.fiber.dispose();await rm(root,{recursive:true,force:true});});
 for(const [id,role] of [['owner','owner'],['mom','elder']]){family.store.addPerson({id,role,label:id});family.store.bindPerson(id,{accountId:'synthetic-account-'+id,peerId:'synthetic-peer-'+id});}
 await family.start();await family.receive('owner',{id:'first-owner-message',peerId:'synthetic-peer-owner',text:'从 flomo 搜索 DeepSeek 最多 2 条，日历未来 24 小时最多 2 条，生成 Synthetic project 的项目简报。先不要设置提醒。不要建立计划。'});await family.settled();assert.equal(intents.length,1);
 const ownerId=intents[0].sessionId,ownerSession=ctx.sessions.create(SessionId(ownerId),{meta:{cwd:root}}),familyAgent={id:ownerId,session:ownerSession,ctx,status:'idle'};agents.set(ownerId,familyAgent);
 const config={didaToken:'synthetic-only',flomoToken:'synthetic-only',googleClientId:'',googleClientSecret:'',googleRefreshToken:''};
 const transport={catalog:async source=>(catalogs.push(source),{tools:source==='flomo'?[{name:'memo_search',inputSchema:{type:'object',properties:{keywords:{type:'string'},limit:{type:'integer'}}}}]:[{name:'list_projects',inputSchema:{type:'object',properties:{limit:{type:'integer'},offset:{type:'integer'}}}}],fetchedAt:'2026-10-19T12:00:00Z'}),call:async(source,name,args)=>{reads.push({source,name,args});return{value:{structuredContent:source==='flomo'?{memos:[{id:'synthetic-memo',content:'DeepSeek synthetic'}]}:{projects:[{id:'synthetic-p1',name:'Synthetic current project'}]}},fetchedAt:'2026-10-19T12:00:00Z'};},close:async()=>{}};
 const googleAuth={status:()=>({clientConfigured:false,refreshConfigured:false,authInProgress:false}),getToken:async()=>{throw Error('no real token');},close:async()=>{}};
 const googleSuiteAuth={status:()=>({clientConfigured:true,refreshConfigured:true,authInProgress:false,grantedSources:['gmail','calendar']}),credentialState:source=>({configured:['gmail','calendar'].includes(source),key:'d'.repeat(64)}),getToken:async()=>{throw Error('synthetic transport must not request token');},close:async()=>{}};
 const suiteTransport={catalog:async()=>({provenance:'bundled-contract',tools:[{name:'search_threads',inputSchema:{type:'object'}}]}),call:async(source,name,args)=>{reads.push({source,name,args});return{value:{items:[{id:'synthetic-mail',subject:'Synthetic email',snippet:'Synthetic content'}]},fetchedAt:'2026-10-19T12:00:00Z'};},close:async()=>{}};
 const calendarTransport={catalog:async()=>({provenance:'bundled-contract',tools:[{name:'list_events',inputSchema:{type:'object'}}]}),call:async(source,name,args)=>{reads.push({source,name,args});return{value:{items:[{id:'synthetic-event',summary:'Synthetic event',start:{dateTime:'2026-10-19T14:00:00Z'},end:{dateTime:'2026-10-19T15:00:00Z'}}]},fetchedAt:'2026-10-19T12:00:00Z'};},close:async()=>{}};
 let adapter, failSummary=false;
 const dotFiber=await ctx.plugin({name:'synthetic-real-dot',inject:['tools','commands','storageDomain','sessions','systemPrompt'],async apply(scope){adapter=await installCompanion(scope,{clock:()=>new Date('2026-10-19T12:00:00Z'),readSetup:async()=>({state:'bound',sessionId:'context-owner',bindingKey:'a'.repeat(64)}),readNativeRoute:async()=>({kind:'unbound'}),readBinding:async()=>null,family:{enabled:true},context:{readConfig:()=>({...config}),googlePublisher:null,transport,googleAuth,googleSuiteAuth,suiteTransport,calendarTransport,fetch:async()=>{throw Error('no real network');}},contextLoop:{summarize:async input=>{if(failSummary)throw Object.assign(Error('SYNTHETIC_PRIVATE_ERROR'),{code:'MODEL_REQUEST_FAILED'});return{changes:[],blockers:[],nextSteps:[{kind:'suggestion',text:'只读核对 README 第一行',sourceIds:[input.sources.find(row=>row.role==='file'&&row.status==='ok').sourceId]}]};}},timers:{setInterval(){return{unref(){}};},clearInterval(){}}});}});
 let counter=0;async function tool(agent,name,args,callId='cross-'+(++counter)){activeCallId=callId;const response=await ctx.tools.execute({callId,name,arguments:args,agent,signal:new AbortController().signal});return response.value;}
 for(const source of ['dida','flomo','gmail','calendar']){const enabled=await tool(oldAgent,'personal_context',{action:'connect',source,userRequested:true});assert.notEqual(enabled.status,'blocked',JSON.stringify({source,enabled}));}
 const targetSession=ctx.sessions.create(SessionId('synthetic-target'),{meta:{cwd:targetRoot}}),target={id:targetSession.id,session:targetSession,ctx,status:'idle',followup:message=>admissions.push(message)};agents.set(target.id,target);
 await tool(oldAgent,'project_companion',{action:'watch',project:targetRoot});
 const betaSession=ctx.sessions.create(SessionId('synthetic-beta'),{meta:{cwd:betaRoot}});agents.set(betaSession.id,{id:betaSession.id,session:betaSession,ctx,status:'idle'});await tool(oldAgent,'project_companion',{action:'watch',project:betaRoot});

 await family.receive('owner',{id:'actual-order-owner-message',peerId:'synthetic-peer-owner',text:'把这个任务交给 Synthetic project：只读检查 README.md 第一行，不要修改文件。完成后把结果回给我。'});await family.settled();
 const normal=await tool(familyAgent,'project_companion',{action:'coordinate',project:targetRoot,task:'只读检查 README.md 第一行',userRequested:true});assert.equal(normal.accepted,true,JSON.stringify(normal));
 // A new ordinary message is not a cancellation of the earlier request.
 await new Promise(resolve=>setTimeout(resolve,150));assert.equal(sent.length,0);
 await family.receive('owner',{id:'new-owner-source',peerId:'synthetic-peer-owner',text:'另外帮我查一下另一个项目。'});await family.settled();
 ackFinished=true;await Promise.race([family.tick(),new Promise((_,reject)=>setTimeout(()=>reject(Error('gateway blocked by barrier')),2500))]);await family.settled();
 for(let n=0;n<100&&!sent.some(row=>row.text.includes('Synthetic project evidence'));n++)await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal(sent.filter(row=>row.text.includes('Synthetic project evidence')).length,1,'new unrelated message must not silently cancel prior result');
 const ledger=JSON.parse(await readFile(join(root,'family','dot-owner-read-jobs.json'),'utf8'));const job=ledger.rows.find(row=>row.id===normal.jobId);assert.equal(job.status,'succeeded');assert.equal(job.delivery.status,'accepted');
 await dotFiber.dispose();await familyFiber.dispose();
});
