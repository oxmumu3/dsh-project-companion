import test from 'node:test';
import assert from 'node:assert/strict';
import {createPersonalContext} from '../src/context-service.js';
const implementation=await import('../src/family-context-adapter.js').catch(()=>({}));
const {createFamilyContextAdapter}=implementation;
const old={sessionId:'old-dot',cwd:'/synthetic/project'},family={sessionId:'family-owner',cwd:'/synthetic/project'};
const revision='a'.repeat(64),binding='b'.repeat(64);

async function fixture({onCall}={}){
 let row,valid=true,calls=0;const scope={familySessionId:family.sessionId,bindingRevision:revision,originSessionId:old.sessionId,originBindingKey:binding};
 const delegation={current:s=>valid&&s===scope,recheck:async s=>valid&&s===scope};let adapter;
 const service=createPersonalContext({store:{get:async()=>row,put:async(_k,v)=>row=structuredClone(v)},readConfig:()=>({flomoToken:'synthetic'}),readBinding:async id=>await adapter.bindingOverride(id)??(id===old.sessionId?{kind:'bound',bindingKey:binding}:{kind:'unbound'}),transport:{catalog:async()=>({tools:[{name:'memo_search',inputSchema:{type:'object'}}]}),call:async()=>{calls++;if(onCall)await onCall();return{value:{structuredContent:{memos:[{id:'m',content:'synthetic note'}]}}};}}});
 adapter=createFamilyContextAdapter({delegation,context:service});
 await service.act(old,{action:'connect',source:'flomo',userRequested:true});
 return{adapter,service,scope,stored:()=>structuredClone(row),calls:()=>calls,revoke:()=>valid=false};
}
test('verified Family call reads the existing enabled Dot lease without moving it',async()=>{
 assert.equal(typeof createFamilyContextAdapter,'function');const f=await fixture(),before=f.stored();
 const r=await f.adapter.run(f.scope,()=>f.adapter.act(family,{action:'query',source:'flomo',operation:'search',query:'x',userRequested:true}));
 assert.match(r.text,/synthetic note/);assert.deepEqual(f.stored(),before);assert.equal(f.calls(),1);await f.service.close();
});
test('outside a verified Family scope the same family session cannot use the old lease',async()=>{const f=await fixture();await assert.rejects(f.adapter.act(family,{action:'query',source:'flomo',operation:'search',query:'x',userRequested:true}));assert.equal(f.calls(),0);await f.service.close();});
test('revocation while the provider is executing suppresses the response',async()=>{
 let started,release;const entered=new Promise(r=>started=r),wait=new Promise(r=>release=r);const f=await fixture({onCall:async()=>{started();await wait;}});
 const result=f.adapter.run(f.scope,()=>f.adapter.act(family,{action:'query',source:'flomo',operation:'search',query:'x',userRequested:true}));await entered;f.revoke();release();await assert.rejects(result);assert.equal(f.calls(),1);await f.service.close();
});
test('Family delegation does not mutate, enable or disable the owner grants',async()=>{const f=await fixture(),before=f.stored();await assert.rejects(f.adapter.run(f.scope,()=>f.adapter.act(family,{action:'disconnect',source:'flomo',userRequested:true})));assert.deepEqual(f.stored(),before);await f.service.close();});
