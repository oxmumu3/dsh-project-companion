import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,realpath,mkdir,writeFile} from 'node:fs/promises';
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
import {installCompanion} from '../index.js';
const familyRoot=process.env.FAMILY_BRIDGE_ROOT;
const complete='每天早上9点、每周一早上9点，根据我已启用的资料和选定项目做个人回顾，有风险或临期事项告诉我。';
async function fixture(t,options={}){
 assert.ok(isAbsolute(familyRoot));
 const {createRuntime}=await import(pathToFileURL(join(familyRoot,'src/runtime.mjs')).href);
 const {installOwnerDotReadGuard}=await import(pathToFileURL(join(familyRoot,'src/owner-dot-read-guard.mjs')).href);
 const root=await realpath(await mkdtemp(join(tmpdir(),'family-personal-review-'))),ownerRoot=join(root,'owner'),targetRoot=join(root,'project');await mkdir(ownerRoot);await mkdir(targetRoot);
 const ctx=new Context();for(const [plugin,config]of[[SystemPrompt,{}],[ToolRuntime,{mode:'native'}],[CommandRuntime,undefined],[Storage,undefined],[JsonStorage,{root:join(root,'storage')}],[StorageDomain,{backend:'json'}],[SessionStore,undefined]])await ctx.plugin(plugin,config);
 const intents=[],sent=[],reads=[],agents=new Map(),rows=[{workspaceId:'owner',id:'owner',title:'Owner',path:ownerRoot,sessionIds:[]},{workspaceId:'project',id:'project',title:'Synthetic project',path:targetRoot,sessionIds:['synthetic-project']}];
 let activeCall='initial',instant='2026-10-29T12:00:10.000Z',counter=0,adapter,family;
 const ownerAgent={ensureControlWorkspace:async()=>rows[0],listWorkspaces:async()=>rows,start:async input=>{intents.push(structuredClone(input));return{state:'running'};},observe:async input=>({workspaceId:input.workspaceId,sessionId:input.sessionId,requestId:input.requestId,cwd:input.cwd,state:'running',requestSeen:true,queued:false,foreign:false,turn:1,activeTurn:1,activeRequestIds:[input.requestId],events:[{type:'tool/call',seq:3,turn:1,callId:activeCall,status:'running'}]})};
 ctx.provide('agents',{get:id=>agents.get(id),list:()=>[...agents.values()]});ctx.provide('workingDirectory',{get:s=>s.header.cwd});ctx.provide('workspaceRegistry',{list:()=>rows});
 const familyFiber=await ctx.plugin({name:'synthetic-family-personal-review',apply(scope){
  family=createRuntime({directory:join(root,'family'),ownerAgent,now:()=>instant,intervalMs:1000000,channelFactory:()=>({status:()=>({status:'connected'}),connect:async()=>{},disconnect:async()=>{},close:async()=>{},send:async(route,text,sendOptions)=>{if(options.beforeSend)await options.beforeSend({family,text});if(sendOptions.authorize()!==true)throw Object.assign(Error('synthetic authorization changed'),{sendOutcome:'failed'});sent.push({personId:route.personId,text});return{status:'api_accepted'};}})});
  scope.provide('familyDotBridge',family.familyDotBridge);const guard=installOwnerDotReadGuard({ctx:scope,getTasks:()=>family.ownerTasksForToolGuard()});scope.effect(()=>async()=>{await guard.close();await family.close();});
 }});
 const dotFiber=await ctx.plugin({name:'synthetic-dot-personal-review',inject:['tools','commands','storageDomain','sessions','systemPrompt'],async apply(scope){adapter=await installCompanion(scope,{clock:()=>new Date(instant),hostTimeZone:'America/Mexico_City',family:{enabled:true},readSetup:async()=>({state:'bound',sessionId:'legacy-owner',bindingKey:'a'.repeat(64)}),readNativeRoute:async()=>({kind:'unbound'}),readBinding:async()=>null,
  context:{readConfig:()=>({didaToken:'synthetic-token-not-real'}),googlePublisher:null,fetch:async()=>assert.fail('synthetic test must not use network'),transport:{catalog:async()=>({tools:[{name:'list_projects',inputSchema:{type:'object',properties:{}}}]}),call:async()=>{reads.push('provider');assert.fail('settings must not read personal data');},close:async()=>{}},...(options.context??{})},
  news:{fetchCandidates:async()=>assert.fail('settings must not fetch public feeds'),...(options.news??{})},...(options.personalReview?{personalReview:options.personalReview}:{}),timers:{setInterval(){return{unref(){}};},clearInterval(){}}});}});
 t.after(async()=>{await dotFiber.dispose();await familyFiber.dispose();await ctx.fiber.dispose();await rm(root,{recursive:true,force:true});});
 const makeAgent=(id,cwd)=>{const session=ctx.sessions.create(SessionId(id),{meta:{cwd}}),agent={id,session,ctx,status:'idle'};agents.set(id,agent);return agent;};
 const old=makeAgent('legacy-owner',ownerRoot);makeAgent('synthetic-project',targetRoot);
 const invoke=async(agent,name,args,callId='call-'+(++counter))=>{activeCall=callId;return(await ctx.tools.execute({name,callId,arguments:args,agent,signal:new AbortController().signal})).value;};
 const enabled=await invoke(old,'personal_context',{action:'connect',source:'dida',userRequested:true});assert.notEqual(enabled?.status,'blocked',JSON.stringify(enabled));
 await invoke(old,'project_companion',{action:'watch',project:targetRoot});assert.equal((await adapter.service.watchedProjects()).length,1);
 for(const [id,role]of[['owner','owner'],['mom','elder']]){family.store.addPerson({id,role,label:id});family.store.bindPerson(id,{accountId:'synthetic-'+id,peerId:'peer-'+id});}await family.start();
 let agent;const message=async(text,{settle=true}={})=>{await family.receive('owner',{id:'source-'+(++counter),peerId:'peer-owner',text,sourceTiming:{receivedAt:instant,providerCreatedAt:instant}});if(settle)await family.settled();if(!agent)agent=makeAgent(intents.at(-1).sessionId,ownerRoot);return agent;};
 await message('请查看项目资料的来源连接状态。');assert.ok((await invoke(agent,'personal_context',{action:'connections'})).sources);
 return{adapter,family,reads,sent,intents,targetRoot,message,clearActiveCall:()=>{activeCall='no-active-call';},nativeTool:async(name,args)=>invoke(old,name,args),tool:async(name,args)=>invoke(agent,name,args),member:async(name,args)=>invoke({...agent,id:'family_member_synthetic'},name,args),forged:async(name,args)=>(await ctx.tools.execute({name,callId:'not-the-observed-call',arguments:args,agent,signal:new AbortController().signal})).value,time:value=>instant=value};
}

const preview='预览一份个人回顾，使用我在电脑启用的资料和已关注项目，不建立计划。';
function productionSource(io){return {transport:{
 catalog:async()=>({tools:[{name:'list_projects',inputSchema:{type:'object',properties:{limit:{type:'integer'},offset:{type:'integer'}}}},{name:'get_project_tasks_bounded',inputSchema:{type:'object',properties:{project_id:{type:'string'},limit:{type:'integer'}},required:['project_id','limit']}}]}),
 call:async(source,name,args,options)=>{await options.authorize();assert.equal(options.authorizeSync(),true);io.push(name);return name==='list_projects'?{value:{projects:[{id:'synthetic-list',name:'Synthetic list'}]}}:{value:{tasks:[{id:'synthetic-task',projectId:'synthetic-list',title:'Synthetic invitation',content:'Respond to the synthetic invitation.',status:0,dueDate:'2026-10-30T12:00:00.000Z',updatedAt:'2026-10-29T11:00:00.000Z'}]}};},close:async()=>{}
}};}
test('real Owner preview production collector succeeds when model succeeds',{skip:!familyRoot},async t=>{
 const io=[];let modelCalls=0;
 const f=await fixture(t,{context:productionSource(io),personalReview:{model:{summarize:async input=>{modelCalls++;const item=input.evidence.find(x=>x.source==='dida');assert.ok(item);return{items:[{key:'invitation',kind:'invitation',title:'合成邀请',summary:'有一项待回应邀请。',why:'期限临近。',action:'核对后回应。',unknown:'合成验收。',evidenceIds:[item.id],priority:'high',confidence:'source',dueAt:item.dueAt}]};}}}});
 await f.message(preview);const result=await f.tool('personal_review',{action:'preview'});
 assert.equal(result.status,'preview',JSON.stringify(result));assert.equal(modelCalls,1);assert.deepEqual(io,['list_projects','get_project_tasks_bounded']);assert.equal(f.sent.length,0);assert.equal(f.adapter.personalReview.needsTimer(),false);
});
test('model failure after confirmed source read must not masquerade as Owner authorization failure',{skip:!familyRoot},async t=>{
 const io=[];let modelCalls=0;
 const f=await fixture(t,{context:productionSource(io),personalReview:{model:{summarize:async()=>{modelCalls++;throw Object.assign(new Error('Synthetic malformed model output'),{code:'MODEL_INVALID_OUTPUT'});}}}});
 await f.message(preview);const result=await f.tool('personal_review',{action:'preview'});
 assert.equal(modelCalls,1);assert.deepEqual(io,['list_projects','get_project_tasks_bounded']);assert.equal(f.sent.length,0);assert.equal(f.adapter.personalReview.needsTimer(),false);
 assert.doesNotMatch(result.text,/Owner、资料范围或授权不可确认/,JSON.stringify(result));
 assert.equal(result.diagnostic.code,'MODEL_INVALID_OUTPUT');
});
