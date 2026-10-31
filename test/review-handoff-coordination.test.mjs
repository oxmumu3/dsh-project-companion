import test from 'node:test';
import assert from 'node:assert/strict';
import {createCoordinator} from '../src/coordination.js';
import {createTaskResults} from '../src/task-results.js';

test('coordinator preserves review provenance through one dispatch and one local terminal outcome',async t=>{
 let stored,count=0,current=true,disposed=0;
 const reference={itemId:'review_'+'a'.repeat(32),scopeKey:'b'.repeat(64),grantScopeKey:'c'.repeat(64),revision:1};
 const taskResults=createTaskResults({store:{get:async()=>stored,put:async(_k,v)=>{stored=structuredClone(v);}},clock:()=>new Date('2026-10-31T15:00:00.000Z')});t.after(()=>taskResults.close());
 const caller={id:'owner',session:{header:{cwd:'/synthetic/origin'}}},target={id:'target',status:'idle',session:{header:{cwd:'/synthetic/project'}},followup(){count++;}};
 const project={id:'project',root:'/synthetic/project',label:'Project',sessionIds:['target']},agents=[caller,target];
 const ctx={get:name=>name==='agents'?{get:id=>agents.find(a=>a.id===id)}:undefined,effect:()=>{}};
 const run=createCoordinator({ctx,service:{act:async()=>{},coordinationTarget:async()=>project,canCoordinate:()=>true},owner:a=>({sessionId:a.id,cwd:a.session.header.cwd}),liveAgents:()=>agents,taskResults,
  authorizeReviewHandoff:async(_caller,input)=>{assert.equal(input.project,project.root);return{reference,authorize:async()=>current,authorizeSync:()=>current,dispose:()=>{disposed++;}};}});
 const input={project:'project',task:'个人回顾「权限邀请」只读准备',reviewItemId:reference.itemId,userRequested:true};
 const first=await run(caller,input,undefined,{callId:'request'});assert.equal(first.status,'accepted');
 assert.deepEqual(stored.jobs[0].reviewOrigin,reference);assert.equal(disposed,1);
 const duplicate=await run(caller,input,undefined,{callId:'request'});assert.equal(duplicate.jobId,first.jobId);assert.equal(count,1);
 const job=stored.jobs[0];await taskResults.claimed({sessionId:'target',messageId:job.targetMessageId,turn:1,sourceKind:'user'});
 await taskResults.observe({sessionId:'target',type:'assistant',turn:1,text:'Synthetic result is ready.'});
 await taskResults.observe({sessionId:'target',type:'turn/end',turn:1,reason:'completed'});
 const outcomes=await taskResults.reviewOutcomes('owner');assert.equal(outcomes[0].status,'completed');assert.equal(outcomes[0].id,first.jobId);assert.deepEqual(outcomes[0].reviewOrigin,reference);
 assert.equal(outcomes[0].reply,undefined);assert.equal(outcomes[0].task,undefined);assert.equal((await taskResults.reviewOutcomes('another')).length,0);
 current=false;const blocked=await run(caller,input,undefined,{callId:'new-request'});assert.equal(blocked.status,'blocked');assert.equal(count,1);
});
test('a review link cannot silently bypass missing provenance authorization',async()=>{
 let count=0;const caller={id:'owner',session:{header:{cwd:'/synthetic/origin'}}},target={id:'target',status:'idle',session:{header:{cwd:'/synthetic/project'}},followup(){count++;}},agents=[caller,target];
 const run=createCoordinator({ctx:{get:()=>({get:id=>agents.find(a=>a.id===id)}),effect:()=>{}},service:{act:async()=>{},coordinationTarget:async()=>({id:'p',root:'/synthetic/project',label:'Project',sessionIds:['target']}),canCoordinate:()=>true},owner:a=>({sessionId:a.id,cwd:a.session.header.cwd}),liveAgents:()=>agents});
 const result=await run(caller,{project:'p',task:'Synthetic only',userRequested:true,reviewItemId:'review_'+'a'.repeat(32)});assert.equal(result.status,'blocked');assert.equal(count,0);
});
test('a linked handoff never watches an unselected project before rejecting scope',async()=>{
 let watches=0;const caller={id:'owner',session:{header:{cwd:'/synthetic/origin'}}};
 const run=createCoordinator({ctx:{get:()=>({get:()=>caller}),effect:()=>{}},service:{coordinationTarget:async()=>null,act:async()=>{watches++;}},owner:a=>({sessionId:a.id,cwd:a.session.header.cwd}),liveAgents:()=>[],authorizeReviewHandoff:async()=>{throw Error('outside scope');}});
 const result=await run(caller,{project:'other',task:'个人回顾「权限邀请」只读准备',userRequested:true,reviewItemId:'review_'+'a'.repeat(32)});
 assert.equal(result.status,'blocked');assert.equal(watches,0);
});
