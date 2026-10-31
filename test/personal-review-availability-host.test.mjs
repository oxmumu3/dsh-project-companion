import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Context} from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import CommandRuntime from '@deepseek-ai/dsh-commands';
import {installCompanion} from '../index.js';

const revision='a'.repeat(64),at='2026-10-30T10:40:00.000Z';
function reviewRow(sessionId){
 return{id:'profile',version:1,scope:null,subscription:{caller:{sessionId,cwd:'/synthetic/availability-host'},sources:['gmail'],projects:[],bindingKey:revision,grant:'b'.repeat(64),key:'c'.repeat(64),schedule:{dailyTime:'09:00',timeZone:'UTC'},createdAt:at,paused:false,attention:{enabled:true,intervalMinutes:120,startHour:9,endHour:19,maxMessagesPerDay:2,createdAt:at}},items:[],jobs:[],occurrences:[],watermarks:{},receipts:[]};
}
async function host(t,{family=true}={}){
 const sessionId=family?'family_owner_synthetic_availability':'standalone-synthetic-availability',rows=new Map(),effects={route:0,lease:0,collect:0,model:0,send:0,network:0};let status='offline',adapter;
 rows.set('project_companion_personal_review',reviewRow(sessionId));
 if(family)rows.set('project_companion_family_delegate',{id:'profile',version:1,familySessionId:sessionId,bindingRevision:revision,originSessionId:'family-no-legacy',originBindingKey:'0'.repeat(64),leaseFingerprint:createHash('sha256').update('[]').digest('hex')});
 const ctx=new Context();
 await ctx.plugin(SystemPrompt,{});await ctx.plugin(ToolRuntime,{mode:'native'});await ctx.plugin(CommandRuntime);
 ctx.provide('storageDomain',{open:async spec=>({table:()=>({get:async()=>structuredClone(rows.get(spec.name)),put:async(_key,value)=>{rows.set(spec.name,structuredClone(value));}}),close:async()=>{}})});
 ctx.provide('sessions',{});ctx.provide('agents',{get:()=>undefined,list:()=>[]});ctx.provide('workspaceRegistry',{list:()=>[]});
 const route=()=>{effects.route++;if(status==='throw')throw new Error('PRIVATE_BRIDGE_CANARY');return status;};
 if(family)ctx.provide('familyDotBridge',{ownerRouteStatus:route,isOwnerRevisionCurrent:()=>true,sendOwner:async()=>{effects.send++;assert.fail('blocked admission must not send');}});
 else ctx.provide('dotWechatGuarded',{routeStatus:route,binding:()=>({bound:true,bindingKey:revision}),send:async()=>{effects.send++;assert.fail('blocked admission must not send');}});
 await ctx.plugin({name:'synthetic-availability-carrier',inject:['tools','commands','storageDomain','sessions','systemPrompt'],async apply(scope){adapter=await installCompanion(scope,{clock:()=>new Date('2026-10-30T11:00:00Z'),family:{enabled:family},readSetup:async()=>({state:'unbound'}),readBinding:async()=>null,readNativeRoute:async()=>({kind:'unbound'}),context:{readConfig:()=>({}),googlePublisher:null,fetch:async()=>{effects.network++;assert.fail('fixture must not access network');}},news:{fetchCandidates:async()=>assert.fail('fixture must not fetch news')},personalReview:{collect:async()=>{effects.collect++;assert.fail('blocked admission must not collect');},model:{summarize:async()=>{effects.model++;assert.fail('blocked admission must not call model');}}},timers:{setInterval:()=>({unref(){}}),clearInterval(){}}});}});
 const readLeases=adapter.context.delegationLeases;adapter.context.delegationLeases=()=>{effects.lease++;return readLeases();};
 t.after(async()=>ctx.fiber.dispose());
 return{adapter,effects,status:value=>{status=value;},row:()=>structuredClone(rows.get('project_companion_personal_review'))};
}
test('in-memory SDK carrier persists diagnostic from the single existing Family route call',async t=>{
 const f=await host(t);
 for(const [status,diagnostic,leaseReads] of [
  ['offline',{state:'offline',reason:'BRIDGE_OFFLINE'},1],
  ['unknown',{state:'unknown',reason:'BRIDGE_UNKNOWN'},1],
  ['throw',{state:'unknown',reason:'BRIDGE_FAILED'},0],
 ]){
  f.status(status);const before={...f.effects};assert.deepEqual(await f.adapter.personalReview.tick(),[]);
  assert.deepEqual(f.row().recovery.diagnostic,diagnostic);
  assert.deepEqual(f.effects,{...before,route:before.route+1,lease:before.lease+leaseReads});
  assert.deepEqual(f.row().jobs,[]);assert.deepEqual(f.row().occurrences,[]);assert.doesNotMatch(JSON.stringify(f.row().recovery),/PRIVATE_/);
 }
});
test('in-memory SDK carrier retains standalone legacy string route admission',async t=>{
 const f=await host(t,{family:false});assert.deepEqual(await f.adapter.personalReview.tick(),[]);
 assert.deepEqual(f.row().recovery.diagnostic,{state:'offline',reason:'ROUTE_OFFLINE'});
 assert.deepEqual(f.effects,{route:1,lease:0,collect:0,model:0,send:0,network:0});assert.deepEqual(f.row().jobs,[]);
});
