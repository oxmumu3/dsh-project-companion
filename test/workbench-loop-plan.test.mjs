import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createWorkbenchActions} from '../src/workbench-actions.js';
import {createWorkbench} from '../src/workbench.js';
const now='2026-10-26T16:00:00.000Z',binding={state:'bound',sessionId:'owner',bindingKey:'a'.repeat(64)};
const project={root:'/synthetic/public-project',label:'公开项目',sessionIds:['owner'],events:[],watchedAt:now};
const projectId='project_'+createHash('sha256').update(project.root).digest('hex').slice(0,24);
const recurring={enabled:true,running:true,everyMinutes:30,loopId:'loop_recurring'},once={enabled:true,running:false,status:'queued',delivery:'wechat',loopId:'loop_once'};
function fixture(plans={followup:recurring,once}){
 const calls=[];let connection=binding;
 const service={watchedProjects:async()=>[project],isPaused:async()=>false};
 const followup={inspect:async args=>{calls.push(['inspect',args]);return structuredClone(plans);},configure:async args=>{calls.push(['configure',args]);return{...recurring,...args};},checkOnce:async args=>{calls.push(['checkOnce',args]);return{...once,...args};}};
 const deps={service,followup,readConnection:async()=>connection,resolveOwner:sessionId=>({sessionId,cwd:'/synthetic/dot'}),clock:()=>new Date(now)};
 return{plans,calls,followup,actions:createWorkbenchActions(deps),workbench:createWorkbench({...deps,readProject:async()=>[],readState:async()=>({paused:false,reminders:[],outbox:[],daily:null})}),replaceBinding:()=>{connection={...binding,bindingKey:'b'.repeat(64)};}};
}
for(const [action,method,key]of [['followup_configure','configure','followup'],['check_once','checkOnce','once']])test(action+' preserves only its existing plan loop and projects it back to the UI',async()=>{
 const f=fixture();const value=await f.actions.action({action,projectId,userRequested:true,...(action==='followup_configure'?{everyMinutes:45}:{delaySeconds:60})});
 const args=f.calls.find(row=>row[0]===method)[1];assert.equal(args.loopId,f.plans[key].loopId);assert.equal(value[key].loopId,f.plans[key].loopId);
 const inspection=f.calls.find(row=>row[0]==='inspect')[1];assert.equal(inspection.root,project.root);assert.deepEqual(inspection.expectedBinding,{sessionId:'owner',bindingKey:binding.bindingKey});
});
for(const action of ['followup_configure','check_once'])test(action+' never adds a loop to a new plan from the other kind',async()=>{
 const f=fixture(action==='check_once'?{followup:recurring,once:null}:{followup:null,once});
 await f.actions.action({action,projectId,userRequested:true,...(action==='followup_configure'?{everyMinutes:45}:{delaySeconds:60})});
 const args=f.calls.find(row=>row[0]===(action==='check_once'?'checkOnce':'configure'))[1];assert.equal(Object.hasOwn(args,'loopId'),false);
});

test('snapshot and explicit status retain valid loop IDs without exporting their scope details',async()=>{
 const f=fixture(),snapshot=await f.workbench.snapshot(),status=await f.actions.action({action:'followup_status',projectId});
 for(const view of [snapshot.projects[0].followup,status]){assert.equal(view.followup.loopId,'loop_recurring');assert.equal(view.once.loopId,'loop_once');}
 assert.equal(JSON.stringify(snapshot.projects[0].followup).includes(project.root),false);
});
for(const loopId of ['','../foreign',null,'x'.repeat(101)])test('invalid stored loop ID cannot be projected or converted into a project-only plan: '+String(loopId),async()=>{
 const f=fixture({followup:{...recurring,loopId},once:null});await assert.rejects(f.actions.action({action:'followup_configure',projectId,everyMinutes:45,userRequested:true}));
 assert.equal(f.calls.some(row=>row[0]==='configure'),false);await assert.rejects(f.actions.action({action:'followup_status',projectId}));assert.equal((await f.workbench.snapshot()).projects[0].followup.available,false);
});
test('binding change while retrieving the stored plan blocks the following write',async()=>{
 const f=fixture();f.followup.inspect=async()=>{f.replaceBinding();return{followup:recurring,once};};
 await assert.rejects(f.actions.action({action:'followup_configure',projectId,everyMinutes:45,userRequested:true}));assert.equal(f.calls.some(row=>row[0]==='configure'),false);
});
test('client input cannot inject a different loop ID through the workbench action',async()=>{
 const f=fixture();await assert.rejects(f.actions.action({action:'check_once',projectId,delaySeconds:60,loopId:'foreign',userRequested:true}));assert.equal(f.calls.length,0);
});
