import test from 'node:test';
import assert from 'node:assert/strict';
import {createContextRoute,registerContextRoute} from '../src/context-route.js';
import {bindingRevision} from '../src/workbench-scope.js';
const initial={state:'bound',sessionId:'fixture',bindingKey:'a'.repeat(64)},grant='b'.repeat(64);
function fixture({enabled=true,token=async()=> 'SYNTHETIC_ACCESS',credentialError,owner=true,timeoutMs}={}){
 let connection=initial,allowed=true,queries=0,called=0;const calls=[];
 const context={snapshot:async()=>({sources:[{id:'calendar',configured:true,enabled},{id:'flomo',configured:true,enabled}]}),authorization:async(_o,sources)=>{calls.push('authorization:'+sources.join());if(!allowed)throw Error('revoked');return grant;},assertAuthorization:(_o,_s,g)=>allowed&&g===grant};
 const route=createContextRoute({authCheckTimeoutMs:timeoutMs,context,readConnection:async()=>connection,resolveOwner:sessionId=>owner?{sessionId,cwd:'/synthetic/project'}:null,checkCalendarToken:async settings=>{called++;return token(settings);},flomoAuth:{getToken:async settings=>{called++;if(credentialError)throw credentialError;return token(settings);}}});
 return{route,calls,change:()=>{connection={...initial,bindingKey:'c'.repeat(64)}},revoke:()=>{allowed=false},called:()=>called,queries:()=>queries};
}
test('one owner may check an enabled source without exposing token or reading provider content',async()=>{for(const source of ['calendar','flomo']){const h=fixture();const result=await h.route.action({action:'check_authorization',source,expectedBindingRevision:bindingRevision(initial)});assert.deepEqual(result,{source,tokenAvailable:true});assert.doesNotMatch(JSON.stringify(result),/SYNTHETIC_ACCESS/);assert.equal(h.called(),1);assert.equal(h.queries(),0);}});
test('check authorization requires exact scope and currently enabled source',async()=>{for(const input of [{action:'check_authorization',source:'calendar'},{action:'check_authorization',source:'gmail',expectedBindingRevision:bindingRevision(initial)},{action:'check_authorization',source:'flomo',expectedBindingRevision:bindingRevision(initial),extra:true}]){const h=fixture();await assert.rejects(h.route.action(input));assert.equal(h.called(),0);}const h=fixture({enabled:false});await assert.rejects(h.route.action({action:'check_authorization',source:'calendar',expectedBindingRevision:bindingRevision(initial)}));assert.equal(h.called(),0);});
test('stale binding or revoked source discards a delayed positive token check',async()=>{for(const mode of ['binding','grant']){let resolve,entered;const held=new Promise(r=>{resolve=r;}),started=new Promise(r=>{entered=r;});const h=fixture({token:async()=>{entered();await held;return'SYNTHETIC_ACCESS';}});const p=h.route.action({action:'check_authorization',source:'calendar',expectedBindingRevision:bindingRevision(initial)});await started;if(mode==='binding')h.change();else h.revoke();resolve();await assert.rejects(p);}});
test('safe token failure reports only predefined diagnostic metadata',async()=>{const h=fixture({credentialError:Object.assign(Error('SYNTHETIC_PRIVATE_BODY'),{authDiagnostic:{stage:'token_endpoint_http',statusClass:'400'}})});const r=await h.route.action({action:'check_authorization',source:'flomo',expectedBindingRevision:bindingRevision(initial)});assert.deepEqual(r,{source:'flomo',tokenAvailable:false,diagnostic:{stage:'token_endpoint_http',statusClass:'400'}});assert.doesNotMatch(JSON.stringify(r),/SYNTHETIC_PRIVATE_BODY/);});

test('GET remains passive and only authenticated handler POST may initiate a token check',async()=>{
 const h=fixture();let handler;registerContextRoute({get:()=>({fetch:{register:route=>{handler=route;}}})},h.route);
 const get=await handler.fetch(new Request('http://localhost/api/project_companion/context'));assert.equal(get.status,200);assert.equal(h.called(),0);
 const post=await handler.fetch(new Request('http://localhost/api/project_companion/context',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'check_authorization',source:'calendar',expectedBindingRevision:bindingRevision(initial)})}));assert.equal(post.status,200);assert.equal((await post.json()).tokenAvailable,true);assert.equal(h.called(),1);
});
test('untrusted diagnostic labels, extra metadata and provider text never survive output',async()=>{
 const h=fixture({credentialError:Object.assign(Error('SYNTHETIC_PRIVATE'),{authDiagnostic:{stage:'token_endpoint_http',statusClass:'400',oauthError:'SYNTHETIC_PRIVATE',error_description:'SYNTHETIC_PRIVATE'}})});
 const r=await h.route.action({action:'check_authorization',source:'flomo',expectedBindingRevision:bindingRevision(initial)});assert.deepEqual(r,{source:'flomo',tokenAvailable:false,diagnostic:{stage:'token_endpoint_http',statusClass:'400'}});assert.doesNotMatch(JSON.stringify(r),/SYNTHETIC_PRIVATE/);
});
test('a non-cooperative token controller times out and its late mutation guard is revoked',async()=>{
 let guard;const h=fixture({token:async settings=>{guard=settings.authorizeMutation;return new Promise(()=>{});},timeoutMs:10});
 await assert.rejects(h.route.action({action:'check_authorization',source:'calendar',expectedBindingRevision:bindingRevision(initial)}));
 assert.equal(typeof guard,'function');await assert.rejects(guard());
});
