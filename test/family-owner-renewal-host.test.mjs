import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Context} from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import CommandRuntime from '@deepseek-ai/dsh-commands';
import Storage from '@deepseek-ai/dsh-storage';
import * as JsonStorage from '@deepseek-ai/dsh-storage-json';
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain';
import SessionStore,{SessionId} from '@deepseek-ai/dsh-session';
import {installCompanion} from '../index.js';
import {familyDelegationBinding} from '../src/family-owner-delegation.js';
const renewal='更新这个微信的 Dot 资料授权，使用我在电脑上启用的来源。';
async function fixture(t){
 const root=await realpath(await mkdtemp(join(tmpdir(),'dot-renew-host-'))),ctx=new Context();
 for(const [plugin,config]of[[SystemPrompt,{}],[ToolRuntime,{mode:'native'}],[CommandRuntime,undefined],[Storage,undefined],[JsonStorage,{root:join(root,'storage')}],[StorageDomain,{backend:'json'}],[SessionStore,undefined]])await ctx.plugin(plugin,config);
 let userText='查看连接状态',activeCall='real-call',adapter;
 const family='family_owner_synthetic',revision='a'.repeat(64),binding='b'.repeat(64),origin={sessionId:'original-dot',cwd:root};
 const bridge={resolveOwnerCall:async({sessionId,callId})=>sessionId===family&&callId===activeCall?{sessionId,bindingRevision:revision,userText,previousUserText:renewal,sourceRequestId:'real-inbound',sourceTimingState:'fresh'}:null,isOwnerRevisionCurrent:(id,rev)=>id===family&&rev===revision,ownerRouteStatus:()=> 'current',isOwnerProjectResultCurrent:()=>true,beforeOwnerProjectResult:async()=> 'ready',sendOwner:async()=>{sideEffects.push('send');return{status:'accepted'};}};
 const agents=new Map();ctx.provide('familyDotBridge',bridge);ctx.provide('agents',{get:id=>agents.get(id),list:()=>[...agents.values()]});ctx.provide('workingDirectory',{get:s=>s.header.cwd});ctx.provide('workspaceRegistry',{list:()=>[]});
 const session=ctx.sessions.create(SessionId(family),{meta:{cwd:root}}),agent={id:family,session,ctx,status:'idle'};agents.set(family,agent);
 const config={didaToken:'synthetic-original-token'},sideEffects=[];
 await ctx.plugin({name:'synthetic-renew-host',inject:['tools','commands','storageDomain','sessions','systemPrompt'],async apply(scope){adapter=await installCompanion(scope,{family:{enabled:true},readSetup:async()=>({state:'bound',sessionId:origin.sessionId,bindingKey:binding}),readNativeRoute:async()=>({kind:'unbound'}),readBinding:async()=>null,context:{readConfig:()=>({...config}),googlePublisher:null,fetch:async()=>assert.fail('must not fetch'),transport:{catalog:async()=>{sideEffects.push('catalog');return{tools:[{name:'list_projects',inputSchema:{type:'object',properties:{}}}]};},call:async()=>{sideEffects.push('query');assert.fail('renewal must not read');},close(){} }},timers:{setInterval(){sideEffects.push('timer');assert.fail('no schedule');},clearInterval(){}}});}});
 t.after(async()=>{await ctx.fiber.dispose();await rm(root,{recursive:true,force:true});});
 const tool=async(name,args)=>{const response=await ctx.tools.execute({name,callId:activeCall,arguments:args,agent,signal:new AbortController().signal});return response.value;};
 await adapter.context.act(origin,{action:'connect',source:'dida',userRequested:true});
 assert.ok((await tool('personal_context',{action:'connections'})).sources);sideEffects.length=0;
 return{adapter,tool,sideEffects,config,origin,family,revision,text:v=>userText=v};
}
test('personal_context connections renews explicit shared grant without reading, enabling, dispatching or scheduling',async t=>{
 const f=await fixture(t);f.config.didaToken='synthetic-reauthorized-token';
 f.text(renewal);const stale=await f.tool('personal_context',{action:'connections'});assert.equal(stale.status,'blocked');assert.match(stale.text,/电脑.*启用/);
 await f.adapter.context.act(f.origin,{action:'connect',source:'dida',userRequested:true});f.sideEffects.length=0;
 f.text('查看连接状态');assert.equal((await f.tool('personal_context',{action:'connections'})).status,'blocked');
 f.text(renewal);const renewed=await f.tool('personal_context',{action:'connections',userRequested:true});assert.equal(renewed.status,'renewed',JSON.stringify(renewed));assert.deepEqual(renewed.sources,[{id:'dida',name:'滴答清单',state:'enabled'}]);
 assert.doesNotMatch(JSON.stringify(renewed),/synthetic|fingerprint|credentialKey|bindingKey|loopId/);
 const again=await f.tool('personal_context',{action:'connections'});assert.equal(again.status,'current');
 assert.deepEqual(f.sideEffects,[]);
});
test('other personal_context actions cannot renew even when current trusted message is the recovery sentence',async t=>{
 const f=await fixture(t);f.config.didaToken='synthetic-new-token';await f.adapter.context.act(f.origin,{action:'connect',source:'dida',userRequested:true});f.sideEffects.length=0;f.text(renewal);
 assert.equal((await f.tool('personal_context',{action:'query',source:'dida',operation:'projects',userRequested:true})).status,'blocked');
 f.text('查看连接状态');assert.equal((await f.tool('personal_context',{action:'connections'})).status,'blocked');assert.deepEqual(f.sideEffects,[]);
});
test('an active follow-up wake cannot renew the delegation via connections',async t=>{
 const f=await fixture(t);f.config.didaToken='synthetic-new-token';await f.adapter.context.act(f.origin,{action:'connect',source:'dida',userRequested:true});f.sideEffects.length=0;f.text(renewal);
 const active=f.adapter.followup.activeLoop;f.adapter.followup.activeLoop=()=> 'active-synthetic-loop';
 assert.equal((await f.tool('personal_context',{action:'connections'})).status,'blocked');
 f.adapter.followup.activeLoop=active;f.text('查看连接状态');assert.equal((await f.tool('personal_context',{action:'connections'})).status,'blocked');assert.deepEqual(f.sideEffects,[]);
});
test('a result queued before renewal cannot be sent under the renewed source grant',async t=>{
 const f=await fixture(t),results=f.adapter.taskResults,returnBinding=familyDelegationBinding({bindingRevision:f.revision});
 const prepare=async number=>{
  const targetSessionId='synthetic-target-'+number,targetMessageId='synthetic-message-'+number;
  const job=await results.prepare({originSessionId:f.family,originToolCallId:'original-owner-call-'+number,targetSessionId,targetMessageId,projectRoot:f.origin.cwd,projectLabel:'Synthetic project',task:'Read synthetic first line',returnBinding,familyOrigin:{sessionId:f.family,bindingRevision:f.revision,sourceRequestId:'original-inbound-'+number,workspaceId:'synthetic-workspace',root:f.origin.cwd,projectName:'Synthetic project',taskHash:'f'.repeat(64)}});
  await results.admitted(job.job.id);await results.claimed({sessionId:targetSessionId,messageId:targetMessageId,turn:1,sourceKind:'user'});
  return{id:job.job.id,sessionId:targetSessionId};
 };
 const finish=async job=>{await results.observe({sessionId:job.sessionId,type:'assistant',turn:1,text:'Synthetic result'});await results.observe({sessionId:job.sessionId,type:'turn/end',turn:1,reason:{kind:'completed'}});return(await results.status(f.family,{id:job.id})).jobs[0];};
 const baseline=await prepare(1),pending=await prepare(2);assert.equal((await finish(baseline)).delivery.status,'reported_sent');assert.deepEqual(f.sideEffects,['send']);f.sideEffects.length=0;
 f.config.didaToken='synthetic-new-token';await f.adapter.context.act(f.origin,{action:'connect',source:'dida',userRequested:true});f.sideEffects.length=0;f.text(renewal);
 assert.equal((await f.tool('personal_context',{action:'connections'})).status,'renewed');
 const after=await finish(pending);assert.equal(after.delivery.status,'blocked');assert.deepEqual(f.sideEffects,[]);
});
