import test from 'node:test';
import assert from 'node:assert/strict';
import {createPersonalContext} from '../src/context-service.js';
const owner={sessionId:'synthetic-owner',cwd:'/synthetic'};
const from='2026-10-30T12:00:00Z',to='2026-10-30T13:00:00Z';
for(const [name,memos,expected] of [
 ['over limit',Array.from({length:3},(_,i)=>({id:String(i),content:'PRIVATE_CANARY',created_at:'2026-10-30T12:30:00Z'})),'item_limit'],
 ['missing timestamp',[{id:'x',content:'PRIVATE_CANARY'}],'recent_time_missing'],
 ['before bound',[{id:'x',content:'PRIVATE_CANARY',created_at:'2026-10-30T11:59:59Z'}],'recent_before_from'],
 ['after bound',[{id:'x',content:'PRIVATE_CANARY',created_at:'2026-10-30T13:00:01Z'}],'recent_after_to']
])test(`recent flomo rejects ${name} with a closed predicate category`,async()=>{
 let row;const service=createPersonalContext({store:{get:async()=>row,put:async(_k,v)=>row=v},readConfig:()=>({flomoToken:'synthetic'}),readBinding:async()=>({kind:'unbound'}),transport:{catalog:async()=>({tools:[{name:'memo_search',inputSchema:{type:'object'}}]}),call:async()=>({value:{memos}})}});
 try{await service.act(owner,{action:'connect',source:'flomo',userRequested:true});await assert.rejects(service.act(owner,{action:'query',source:'flomo',operation:'recent',from,to,limit:2,userRequested:true}),e=>{assert.equal(e.code,'CONTEXT_SCOPE_VIOLATION');assert.equal(e.readStage,'projection');assert.equal(e.scopeRule,expected);assert.doesNotMatch(String(e)+JSON.stringify(e),/PRIVATE_CANARY/);return true;});}finally{await service.close();}
});
test('recent flomo still accepts exact time boundaries without broadening the request',async()=>{
 let row;const calls=[],memos=[{id:'a',content:'synthetic',created_at:from},{id:'b',content:'synthetic',created_at:to}];const service=createPersonalContext({store:{get:async()=>row,put:async(_k,v)=>row=v},readConfig:()=>({flomoToken:'synthetic'}),readBinding:async()=>({kind:'unbound'}),transport:{catalog:async()=>({tools:[{name:'memo_search',inputSchema:{type:'object'}}]}),call:async(_s,_n,args)=>{calls.push(args);return{value:{memos}};}}});
 try{await service.act(owner,{action:'connect',source:'flomo',userRequested:true});const r=await service.act(owner,{action:'query',source:'flomo',operation:'recent',from,to,limit:2,userRequested:true});assert.equal(r.items.length,2);assert.deepEqual(calls,[{start_date:'2026-10-30T12:00:00.000Z',end_date:'2026-10-30T13:00:00.000Z',limit:2}]);}finally{await service.close();}
});
