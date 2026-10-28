import test from 'node:test';
import assert from 'node:assert/strict';
import {createService} from '../src/service.js';
const owner={sessionId:'family_owner_synthetic',cwd:'/synthetic/owner'};
const bindingA={userHash:'a'.repeat(64),botHash:'b'.repeat(64)};
const bindingB={userHash:'c'.repeat(64),botHash:'d'.repeat(64)};
async function fixture(opts={}){
 let state,now=new Date('2026-10-26T12:00:00Z');const sent=[];
 const service=createService({store:{get:async()=>structuredClone(state),put:async(_,v)=>{state=structuredClone(v);await opts.onSave?.(state);}},clock:()=>now,hostTimeZone:()=> 'UTC',send:async(item,control)=>{sent.push({item,control,allowedAtEntry:control?.authorize?.()});return opts.send?.(item,control)??{status:'reported_sent'};}});
 return{service,sent,state:()=>state,time:s=>{now=new Date(s)}};
}
test('family reminder captures its binding at creation and preserves it in the durable delivery item',async()=>{
 const f=await fixture();await f.service.act(owner,{action:'remind',delayMinutes:2,title:'synthetic',expectedBinding:bindingA,userRequested:true});
 assert.deepEqual(f.state().reminders[0].expectedBinding,bindingA);
 f.time('2026-10-26T12:02:00Z');await f.service.tick();
 assert.deepEqual(f.sent[0].item.expectedBinding,bindingA);assert.equal(typeof f.sent[0].control?.authorize,'function');assert.equal(f.sent[0].allowedAtEntry,true);
});
test('reconfiguring family daily never retargets an earlier blocked delivery to a new binding',async()=>{
 const f=await fixture({send:()=>({status:'blocked'})});await f.service.act(owner,{action:'configure_daily',time:'12:01',timeZone:'UTC',expectedBinding:bindingA,userRequested:true});
 f.time('2026-10-26T12:01:00Z');await f.service.tick();assert.deepEqual(f.state().outbox[0].expectedBinding,bindingA);
 await f.service.act(owner,{action:'configure_daily',time:'12:02',timeZone:'UTC',expectedBinding:bindingB,userRequested:true});
 assert.deepEqual(f.state().outbox[0].expectedBinding,bindingA);assert.deepEqual(f.state().daily.expectedBinding,bindingB);
});
test('family dispatch guard immediately reflects cancel intent while send is awaiting admission',async()=>{
 let ready,release;const started=new Promise(r=>ready=r),gate=new Promise(r=>release=r);let observed;
 const f=await fixture({send:async(_item,control)=>{ready();await gate;observed=control.authorize();return{status:observed?'reported_sent':'blocked'};}});
 const r=await f.service.act(owner,{action:'remind',delayMinutes:2,title:'synthetic',expectedBinding:bindingA,userRequested:true});
 f.time('2026-10-26T12:02:00Z');const tick=f.service.tick();await started;
 const cancel=f.service.act(owner,{action:'cancel_reminder',id:r.reminder.id});release();await tick;await cancel;
 assert.equal(observed,false,'cancellation must block an unstarted transport dispatch');
});
test('family scheduling requires an explicit authorized-intent marker',async()=>{
 for(const action of [{action:'remind',delayMinutes:2,title:'synthetic'}, {action:'configure_daily',time:'12:01',timeZone:'UTC'}]){
  for(const requested of [undefined,false]){const f=await fixture();await assert.rejects(f.service.act(owner,{...action,expectedBinding:bindingA,...(requested===undefined?{}:{userRequested:requested})}),/intent|要求|授权/i);assert.equal(f.state()?.daily??null,null);assert.equal(f.state()?.reminders?.length??0,0);}
 }
});
