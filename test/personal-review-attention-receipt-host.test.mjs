import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,realpath,mkdir} from 'node:fs/promises';
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
 let lastToolResult,activeCall='initial',instant='2026-10-29T12:00:10.000Z',counter=0,adapter,family;
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
 const invoke=async(agent,name,args,callId='call-'+(++counter))=>{activeCall=callId;lastToolResult=await ctx.tools.execute({name,callId,arguments:args,agent,signal:new AbortController().signal});return lastToolResult.value;};
 const enabled=await invoke(old,'personal_context',{action:'connect',source:'dida',userRequested:true});assert.notEqual(enabled?.status,'blocked',JSON.stringify(enabled));
 await invoke(old,'project_companion',{action:'watch',project:targetRoot});assert.equal((await adapter.service.watchedProjects()).length,1);
 for(const [id,role]of[['owner','owner'],['mom','elder']]){family.store.addPerson({id,role,label:id});family.store.bindPerson(id,{accountId:'synthetic-'+id,peerId:'peer-'+id});}await family.start();
 let agent;const message=async(text,{settle=true}={})=>{await family.receive('owner',{id:'source-'+(++counter),peerId:'peer-owner',text,sourceTiming:{receivedAt:instant,providerCreatedAt:instant}});if(settle)await family.settled();if(!agent)agent=makeAgent(intents.at(-1).sessionId,ownerRoot);return agent;};
 await message('请查看项目资料的来源连接状态。');assert.ok((await invoke(agent,'personal_context',{action:'connections'})).sources);
 return{adapter,family,reads,sent,intents,targetRoot,message,lastContent:()=>lastToolResult?.content,clearActiveCall:()=>{activeCall='no-active-call';},nativeTool:async(name,args)=>invoke(old,name,args),tool:async(name,args)=>invoke(agent,name,args),member:async(name,args)=>invoke({...agent,id:'family_member_synthetic'},name,args),forged:async(name,args)=>(await ctx.tools.execute({name,callId:'not-the-observed-call',arguments:args,agent,signal:new AbortController().signal})).value,time:value=>instant=value};
}

const textOf=parts=>(parts??[]).filter(part=>part.type==='text').map(part=>part.text).join('\n');
test('real Family SDK pipeline confirms attention state in visible content without a status request under a different intent',{skip:!familyRoot},async t=>{
 const f=await fixture(t);await f.message(complete);const configured=await f.tool('personal_review',{action:'configure'});
 assert.equal(configured.status,'enabled');assert.match(textOf(f.lastContent()),/工作时段主动关注：未配置/);
 await f.message('开启个人回顾的工作时段主动关注。');const enabled=await f.tool('personal_review',{action:'attention',enabled:false});
 assert.equal(enabled.attention.enabled,true);assert.match(textOf(f.lastContent()),/工作时段主动关注：已开启/);assert.match(textOf(f.lastContent()),/每日额外最多 2 条/);assert.match(textOf(f.lastContent()),/America\/Mexico_City/);
 const duplicate=await f.tool('personal_review',{action:'attention',enabled:false});assert.equal(duplicate.duplicate,true);assert.match(textOf(f.lastContent()),/工作时段主动关注：已开启/);assert.deepEqual(duplicate.attention,enabled.attention);
 const unsupported=await f.tool('personal_review',{action:'status'});assert.equal(unsupported.status,'blocked');assert.doesNotMatch(textOf(f.lastContent()),/工作时段主动关注：已开启/);
 await f.message('查看个人回顾状态。');const status=await f.tool('personal_review',{action:'status'});assert.equal(status.attention.enabled,true);assert.match(textOf(f.lastContent()),/工作时段主动关注：已开启/);
 await f.message('关闭个人回顾的工作时段主动关注。');const off=await f.tool('personal_review',{action:'attention',enabled:true});assert.equal(off.attention.enabled,false);assert.match(textOf(f.lastContent()),/工作时段主动关注：已关闭/);assert.doesNotMatch(textOf(f.lastContent()),/工作时段主动关注：已开启/);
 assert.deepEqual(f.reads,[]);assert.deepEqual(f.sent,[]);
});
test('real Family SDK pause and resume preserve attention but expose actual paused receipt',{skip:!familyRoot},async t=>{
 const f=await fixture(t);await f.message(complete);await f.tool('personal_review',{action:'configure'});await f.message('开启个人回顾的工作时段主动关注。');await f.tool('personal_review',{action:'attention'});
 await f.message('暂停个人回顾。');const paused=await f.tool('personal_review',{action:'pause'});assert.equal(paused.attention.enabled,false);assert.match(textOf(f.lastContent()),/工作时段主动关注：已暂停/);
 await f.message('恢复个人回顾。');const resumed=await f.tool('personal_review',{action:'resume'});assert.equal(resumed.attention.enabled,true);assert.match(textOf(f.lastContent()),/工作时段主动关注：已开启/);
 assert.deepEqual(f.reads,[]);assert.deepEqual(f.sent,[]);
});
