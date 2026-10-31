import test from 'node:test';
import assert from 'node:assert/strict';
import {createCoordinator} from '../src/coordination.js';
import {createTaskResults,taskResultsRowSchema} from '../src/task-results.js';
const familyOrigin={sessionId:'family_owner_test',bindingRevision:'a'.repeat(64),sourceRequestId:'source-1',workspaceId:'ws-target',root:'/synthetic/project',projectName:'Synthetic',taskHash:'b'.repeat(64)};
function fixture(t,{throwFollowup=false,afterPrepare=()=>{}}={}){
 let stored,dispatches=0,watches=0,permitted=true,sendItem;
 const caller={id:'family_owner_test',session:{header:{cwd:'/synthetic/owner'}}};
 const target={id:'target',status:'idle',session:{header:{cwd:'/synthetic/project'}},followup(){dispatches++;if(throwFollowup)throw Error('unknown inbox');}};
 const agents=new Map([[caller.id,caller],[target.id,target]]);
 const project={id:'registered-project',workspaceId:'ws-target',root:'/synthetic/project',label:'Synthetic',sessionIds:['target']};
 const ctx={get:name=>name==='agents'?{get:id=>agents.get(id)}:undefined,effect:()=>{}};
 const jobs=createTaskResults({store:{get:async()=>stored,put:async(_key,value)=>{stored=taskResultsRowSchema.parse(structuredClone(value));}},send:async item=>{sendItem=item;return{status:'reported_sent'};}});
 const prepare=jobs.prepare;jobs.prepare=async args=>{const r=await prepare(args);afterPrepare(()=>{permitted=false;},target);return r;};t.after(()=>jobs.close());
 const service={coordinationTarget:async()=>null,act:async()=>{watches++;throw Error('must not watch');},canCoordinate:()=>false};
 const run=createCoordinator({ctx,service,owner:a=>({sessionId:a.id,cwd:a.session.header.cwd}),liveAgents:()=>[...agents.values()],taskResults:jobs,readBinding:async()=>({userHash:'a'.repeat(64)})});
 const meta={resolveProject:async ref=>[project.id,project.root].includes(ref)?project:null,authorizeProjectSync:s=>permitted&&s.projectRoot===project.root&&s.sessionId==='target',authorizeAdmission:async()=>permitted,authorizeAdmissionSync:()=>permitted,familyOrigin,ledgerKey:'same-authenticated-message'};
 return{run:callId=>run(caller,{project:project.root,task:'Update project docs.',userRequested:true},undefined,{...meta,callId}),jobs,stats:()=>({dispatches,watches,stored,sendItem}),revoke:()=>{permitted=false;}};
}
test('unwatched registered project uses native coordinator once and stable source identity',async t=>{const f=fixture(t);const first=await f.run('model-call-1');assert.equal(first.status,'accepted',JSON.stringify(first));const again=await f.run('model-call-2');assert.equal(again.status,'duplicate');assert.equal(again.jobId,first.jobId);assert.equal(f.stats().dispatches,1);assert.equal(f.stats().watches,0);assert.deepEqual(f.stats().stored.jobs[0].familyOrigin,familyOrigin);});
test('unknown native admission is never replayed with a new model call',async t=>{const f=fixture(t,{throwFollowup:true});const first=await f.run('one');assert.equal(first.status,'uncertain');const again=await f.run('two');assert.equal(again.jobId,first.jobId);assert.equal(f.stats().dispatches,1);});
test('source revoke during preparation blocks final followup',async t=>{const f=fixture(t,{afterPrepare:revoke=>revoke()});const result=await f.run('one');assert.equal(result.status,'blocked');assert.equal(f.stats().dispatches,0);assert.equal(f.stats().watches,0);});
test('result retains source authority and current binding filters status',async t=>{const f=fixture(t),first=await f.run('one'),job=f.stats().stored.jobs[0];assert.ok(first.accepted);await f.jobs.claimed({sessionId:'target',messageId:job.targetMessageId,turn:1,sourceKind:'user'});await f.jobs.observe({sessionId:'target',type:'assistant',turn:1,text:'Done synthetic task'});await f.jobs.observe({sessionId:'target',type:'turn/end',turn:1,reason:'completed'});assert.deepEqual(f.stats().sendItem.familyOrigin,familyOrigin);const wrong=await f.jobs.status('family_owner_test',{expectedBinding:{userHash:'f'.repeat(64)}});assert.equal(wrong.jobs.length,0);});


test('registered native target cannot change cwd or become a subagent during prepare',async t=>{for(const mutate of [target=>{target.session.header.cwd='/synthetic/other';},target=>{target.session.header.origin='subagent';}]){const f=fixture(t,{afterPrepare:(_revoke,target)=>mutate(target)});const r=await f.run('one');assert.equal(r.status,'blocked');assert.equal(f.stats().dispatches,0);}});
