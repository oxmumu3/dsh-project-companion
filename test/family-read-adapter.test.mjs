import test from 'node:test';
import assert from 'node:assert/strict';
import {createFamilyReadAdapter} from '../src/family-read-adapter.js';

const root='/synthetic/project',scope={familySessionId:'family_owner_1',bindingRevision:'a'.repeat(64),callId:'real-owner-call'};
function fixture(){const calls=[],state={current:true,root:true};const bridge={startOwnerProjectRead:async input=>{calls.push(input);assert.equal(input.authorize(),true);return{status:'accepted',accepted:true,jobId:'family-read-1'};},readOwnerProjectRead:async input=>({id:input.jobId,status:'completed',reply:'done',delivery:{status:'accepted'}})};return{calls,state,adapter:createFamilyReadAdapter({getBridge:()=>bridge,isCurrent:()=>state.current,authorizeRoot:async r=>state.root&&r===root,recheck:async()=>state.current})};}

test('only the verified scope and watched root can admit an independent read task',async()=>{
 const {adapter,calls}=fixture(),result=await adapter.start({scope,root,requestId:'loop_1',reference:'已确认的简报事项',authorizeAdmission:async()=>true,authorizeAdmissionSync:()=>true,authorizeDelivery:()=>true});
 assert.equal(result.jobId,'family-read-1');assert.equal(calls.length,1);assert.deepEqual(Object.keys(calls[0]).sort(),['authorize','bindingRevision','callId','reference','requestId','root','sessionId']);assert.equal(calls[0].callId,scope.callId);assert.equal(calls[0].reference,'已确认的简报事项');
});
test('missing trusted call, changed owner, unwatched project, or revoked admission cannot start',async()=>{
 for(const variation of ['call','owner','root','admission']){const f=fixture();if(variation==='owner')f.state.current=false;if(variation==='root')f.state.root=false;
  const result=await f.adapter.start({scope:variation==='call'?{...scope,callId:undefined}:scope,root,requestId:'loop_1',authorizeAdmission:async()=>variation!=='admission',authorizeAdmissionSync:()=>true,authorizeDelivery:()=>true});
  assert.equal(result.accepted,false);assert.equal(f.calls.length,0);}
});
test('the guard remains revocable before delivery and status cannot use an unrelated id',async()=>{
 const f=fixture();await f.adapter.start({scope,root,requestId:'loop_1',authorizeAdmission:async()=>true,authorizeAdmissionSync:()=>true,authorizeDelivery:()=>true});f.state.current=false;assert.equal(f.calls[0].authorize(),false);
 assert.equal(await f.adapter.read({scope,id:'family-read-1'}),null);
 assert.equal(await f.adapter.read({scope,id:'another-job'}),null);
});
test('background authorization outlives the transient admission while retaining durable revocation',async()=>{
 const f=fixture();let admission=true,delivery=true;
 const result=await f.adapter.start({scope,root,requestId:'loop_1',authorizeAdmission:async()=>admission,authorizeAdmissionSync:()=>admission,authorizeDelivery:()=>delivery});
 assert.equal(result.accepted,true);admission=false;assert.equal(f.calls[0].authorize(),true);delivery=false;assert.equal(f.calls[0].authorize(),false);
});
