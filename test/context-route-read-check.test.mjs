import test from 'node:test';
import assert from 'node:assert/strict';
import {createContextRoute,registerContextRoute} from '../src/context-route.js';
import {bindingRevision} from '../src/workbench-scope.js';
const initial={state:'bound',sessionId:'fixture-owner',bindingKey:'a'.repeat(64)},revision=bindingRevision(initial),grant='b'.repeat(64),now='2026-10-27T19:00:00.000Z';
function fixture({result,enabled=true,onRead,timeoutMs}={}){
 let current=initial,allowed=true;const calls=[];
 const context={snapshot:async()=>({sources:[{id:'flomo',configured:true,enabled},{id:'calendar',configured:true,enabled}]}),authorization:async()=>{if(!allowed)throw Error('revoked');return grant;},assertAuthorization:(_o,_s,g)=>allowed&&g===grant,act:async(_owner,args)=>{calls.push(args);if(onRead)await onRead(args);return result??{source:args.source,items:[{id:'SYNTHETIC_PRIVATE_ID',title:'SYNTHETIC_PRIVATE_TITLE',text:'SYNTHETIC_PRIVATE_BODY'}],truncated:true};}};
 const route=createContextRoute({context,readConnection:async()=>current,resolveOwner:id=>({sessionId:id,cwd:'/synthetic/project'}),authCheckTimeoutMs:timeoutMs,readCheckClock:()=>new Date(now)});
 return{route,calls,change:()=>{current={...initial,bindingKey:'c'.repeat(64)}},revoke:()=>{allowed=false}};
}
test('bounded native reads return only counts and use the exact authorized scope',async()=>{
 for(const source of ['flomo','calendar']){const h=fixture(),input={action:'check_read',source,expectedBindingRevision:revision,...(source==='flomo'?{query:'DeepSeek'}:{})};
  const value=await h.route.action(input);assert.deepEqual(value,{source,readAvailable:true,returnedCount:1,truncated:true});assert.doesNotMatch(JSON.stringify(value),/SYNTHETIC_PRIVATE/);assert.equal(h.calls.length,1);
  const q=h.calls[0];assert.equal(q.action,'query');assert.equal(q.source,source);assert.equal(q.limit,2);assert.equal(q.userRequested,true);assert.equal(q.signal.aborted,true);
  if(source==='flomo'){assert.equal(q.operation,'search');assert.equal(q.query,'DeepSeek');assert.equal(q.from,undefined);}else{assert.equal(q.operation,'upcoming');assert.equal(q.from,now);assert.equal(q.to,'2026-10-28T19:00:00.000Z');assert.equal(q.query,undefined);}
 }
});
test('strict read action rejects wrong source, missing query, and any attempt to change limits or dates',async()=>{
 for(const input of [{action:'check_read',source:'flomo',expectedBindingRevision:revision},{action:'check_read',source:'flomo',query:'other',expectedBindingRevision:revision},{action:'check_read',source:'flomo',query:'DeepSeek',limit:3,expectedBindingRevision:revision},{action:'check_read',source:'calendar',from:'2026-01-01',expectedBindingRevision:revision},{action:'check_read',source:'gmail',expectedBindingRevision:revision},{action:'check_read',source:'calendar'}]){const h=fixture();await assert.rejects(h.route.action(input));assert.equal(h.calls.length,0);}
 const disabled=fixture({enabled:false});await assert.rejects(disabled.route.action({action:'check_read',source:'calendar',expectedBindingRevision:revision}));assert.equal(disabled.calls.length,0);
});
test('only fixed failure codes are returned, never provider error or data',async()=>{
 for(const [actual,expected] of [['CONTEXT_AUTH_REQUIRED','CONTEXT_AUTH_REQUIRED'],['CONTEXT_SCOPE_VIOLATION','CONTEXT_SCOPE_VIOLATION'],['SYNTHETIC_PRIVATE_CODE','CONTEXT_UNAVAILABLE']]){const h=fixture({onRead:async()=>{throw Object.assign(Error('SYNTHETIC_PRIVATE_BODY'),{code:actual});}}),r=await h.route.action({action:'check_read',source:'calendar',expectedBindingRevision:revision});assert.deepEqual(r,{source:'calendar',readAvailable:false,code:expected});assert.doesNotMatch(JSON.stringify(r),/SYNTHETIC_PRIVATE/);}
});
test('binding and source grant revocation during the query never returns successful read',async()=>{
 for(const mode of ['binding','grant']){let release,enter;const held=new Promise(r=>{release=r;}),started=new Promise(r=>{enter=r;}),h=fixture({onRead:async()=>{enter();await held;}});const p=h.route.action({action:'check_read',source:'calendar',expectedBindingRevision:revision});await started;if(mode==='binding')h.change();else h.revoke();release();await assert.rejects(p);}
});
test('timeout aborts a noncooperative query and a late result is not reported',async()=>{
 let release,signal;const held=new Promise(r=>{release=r;}),h=fixture({timeoutMs:10,onRead:async args=>{signal=args.signal;await held;}});await assert.rejects(h.route.action({action:'check_read',source:'calendar',expectedBindingRevision:revision}));assert.equal(signal.aborted,true);release();await new Promise(r=>setImmediate(r));
});

test('malformed or expanded provider results cannot be reported as successful',async()=>{
 for(const [result,code] of [[{source:'flomo',items:[],truncated:false},'CONTEXT_PROTOCOL_INVALID'],[{source:'calendar',items:[{},{},{}],truncated:false},'CONTEXT_SCOPE_VIOLATION'],[{source:'calendar',items:[],truncated:'yes'},'CONTEXT_PROTOCOL_INVALID']]){const h=fixture({result});const r=await h.route.action({action:'check_read',source:'calendar',expectedBindingRevision:revision});assert.deepEqual(r,{source:'calendar',readAvailable:false,code,stage:'projection'});}
});
test('GET with a query string never starts a source read',async()=>{
 const h=fixture();let handler;registerContextRoute({get:()=>({fetch:{register:route=>{handler=route;}}})},h.route);
 const res=await handler.fetch(new Request('http://localhost/api/project_companion/context?action=check_read&source=calendar'));assert.equal(res.status,200);assert.equal(h.calls.length,0);
});

test('a fixed source stage is surfaced without source exception details',async()=>{
 for(const stage of ['scope','build','catalog','call','projection','SYNTHETIC_PRIVATE']){const h=fixture({onRead:async()=>{throw Object.assign(Error('SYNTHETIC_PRIVATE_BODY'),{code:'CONTEXT_AUTH_REQUIRED',readStage:stage});}}),r=await h.route.action({action:'check_read',source:'calendar',expectedBindingRevision:revision});assert.equal(r.code,'CONTEXT_AUTH_REQUIRED');assert.equal(r.stage,stage==='SYNTHETIC_PRIVATE'?undefined:stage);assert.doesNotMatch(JSON.stringify(r),/SYNTHETIC_PRIVATE/);}
});
