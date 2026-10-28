import test from 'node:test';
import assert from 'node:assert/strict';
import {createCoordinator} from '../src/coordination.js';
import {createTaskResults} from '../src/task-results.js';

function fixture(t,options={}){
  let stored,submissions=0,allowed=true;
  const controller=new AbortController();
  const caller={id:'synthetic-origin',session:{header:{cwd:'/synthetic/origin'}}};
  const target={id:'synthetic-target',status:'idle',session:{header:{cwd:'/synthetic/project'}},followup(){submissions++;if(options.throwFollowup)throw Error('synthetic inbox uncertain');}};
  const live=new Map([[caller.id,caller],[target.id,target]]);
  const ctx={get:name=>name==='agents'?{get:id=>live.get(id)}:undefined,effect:()=>{}};
  const project={id:'synthetic-project',root:'/synthetic/project',label:'Synthetic project',sessionIds:[target.id]};
  const service={coordinationTarget:async()=>project,act:async()=>{},canCoordinate:()=>allowed};
  const taskResults=createTaskResults({store:{get:async()=>structuredClone(stored),put:async(_key,value)=>{stored=structuredClone(value);}},clock:()=>new Date('2026-10-26T12:00:00Z')});
  const originalPrepare=taskResults.prepare;
  taskResults.prepare=async input=>{const result=await originalPrepare(input);if(!result.duplicate)await options.afterPrepare?.({target,controller,revoke:()=>{allowed=false;}});return result;};
  if(options.failAdmitted)taskResults.admitted=async()=>{throw Error('synthetic admitted store unavailable');};
  if(options.failNotAdmitted)taskResults.notAdmitted=async()=>{throw Error('synthetic uncertainty store unavailable');};
  t.after(()=>taskResults.close());
  const coordinate=createCoordinator({ctx,service,owner:agent=>({sessionId:String(agent.id),cwd:agent.session.header.cwd}),liveAgents:()=>[...live.values()],taskResults,readBinding:async()=>({userHash:'a'.repeat(64)})});
  return{run:()=>coordinate(caller,{project:project.id,task:'Read the synthetic README only.',userRequested:true},controller.signal,{callId:'synthetic-stable-item',...(options.authorizeAdmission?{authorizeAdmission:options.authorizeAdmission}:{}),...(options.authorizeAdmissionSync?{authorizeAdmissionSync:options.authorizeAdmissionSync}:{})}),stored:()=>stored,submissions:()=>submissions,target};
}

test('accepted and duplicate item admission return the same durable jobId without a second dispatch',async t=>{
  const f=fixture(t),first=await f.run();
  assert.equal(first.status,'accepted');assert.equal(first.accepted,true);
  assert.equal(first.jobId,f.stored().jobs[0].id);
  assert.match(first.text,/不是任务完成证明/);
  const again=await f.run();
  assert.equal(again.status,'duplicate');assert.equal(again.accepted,false);
  assert.equal(again.jobId,first.jobId);assert.equal(f.submissions(),1);assert.equal(f.stored().jobs.length,1);
});

test('admitted-save uncertainty retains its prepared jobId and cannot redispatch the item',async t=>{
  const f=fixture(t,{failAdmitted:true}),result=await f.run();
  assert.equal(result.status,'uncertain');assert.equal(result.accepted,false);
  assert.equal(result.jobId,f.stored().jobs[0].id);assert.match(result.text,/未能确认/);
  const again=await f.run();assert.equal(again.jobId,result.jobId);assert.equal(again.status,'duplicate');assert.equal(f.submissions(),1);
});

test('inbox uncertainty retains jobId while recording unknown and never retries automatically',async t=>{
  const f=fixture(t,{throwFollowup:true}),result=await f.run();
  assert.equal(result.status,'uncertain');
  assert.equal(result.accepted,false);assert.equal(result.jobId,f.stored().jobs[0].id);
  assert.equal(f.stored().jobs[0].status,'unknown');assert.match(result.text,/不确定/);
  const again=await f.run();assert.equal(again.jobId,result.jobId);assert.equal(again.status,'duplicate');assert.equal(f.submissions(),1);
});

test('uncertainty persistence failure still returns the durable prepared jobId',async t=>{
  const f=fixture(t,{throwFollowup:true,failNotAdmitted:true}),result=await f.run();
  assert.equal(result.status,'uncertain');
  assert.equal(result.accepted,false);assert.equal(result.jobId,f.stored().jobs[0].id);assert.match(result.text,/不确定/);
  assert.doesNotMatch(result.text,/synthetic uncertainty store/);assert.equal(f.submissions(),1);
});

test('scope revocation after prepare returns the unadmitted jobId without dispatch',async t=>{
  const f=fixture(t,{afterPrepare:({revoke})=>revoke()}),result=await f.run();
  assert.equal(result.status,'blocked');assert.equal(result.accepted,false);assert.equal(result.jobId,f.stored().jobs[0].id);
  assert.equal(f.stored().jobs[0].status,'not_admitted');assert.equal(f.submissions(),0);
});

test('target becomes busy after prepare returns its unadmitted jobId without dispatch',async t=>{
  const f=fixture(t,{afterPrepare:({target})=>{target.status='running';}}),result=await f.run();
  assert.equal(result.status,'busy');assert.equal(result.accepted,false);assert.equal(result.jobId,f.stored().jobs[0].id);
  assert.equal(f.stored().jobs[0].status,'not_admitted');assert.equal(f.submissions(),0);
});

test('source grant revoked while durable prepare is pending cannot reach final inbox admission',async t=>{
  let entered,release,authorized=true,checks=0;
  const pendingPrepare=new Promise(resolve=>{entered=resolve;}),wait=new Promise(resolve=>{release=resolve;});
  const f=fixture(t,{afterPrepare:async()=>{entered();await wait;},authorizeAdmission:async()=>{checks++;return authorized;},authorizeAdmissionSync:()=>authorized});
  const pending=f.run();await pendingPrepare;authorized=false;release();const result=await pending;
  assert.equal(result.status,'blocked');assert.equal(result.accepted,false);assert.equal(result.jobId,f.stored().jobs[0].id);
  assert.equal(f.stored().jobs[0].status,'not_admitted');assert.equal(f.submissions(),0);assert.equal(checks,1);
});

test('synchronous grant gate closes a change after the final asynchronous authorization check',async t=>{
  let authorized=true,syncChecks=0;
  const f=fixture(t,{authorizeAdmission:async()=>{authorized=false;return true;},authorizeAdmissionSync:()=>{syncChecks++;return authorized;}});
  const result=await f.run();assert.equal(result.status,'blocked');assert.equal(result.accepted,false);
  assert.equal(f.stored().jobs[0].status,'not_admitted');assert.equal(f.submissions(),0);assert.equal(syncChecks,1);
});

test('throwing grant check is fail-closed without leaking source errors',async t=>{
  const f=fixture(t,{authorizeAdmission:async()=>{throw Error('private source authorization error');}}),result=await f.run();
  assert.equal(result.status,'blocked');assert.equal(result.jobId,f.stored().jobs[0].id);assert.equal(f.submissions(),0);
  assert.doesNotMatch(result.text,/private source/);
});
