import test from 'node:test';
import assert from 'node:assert/strict';
import {checkGoogleConnection} from '../src/google-connection-check.js';
import {createContextRoute,registerContextRoute} from '../src/context-route.js';
import {bindingRevision} from '../src/workbench-scope.js';
const binding={state:'bound',sessionId:'synthetic-owner',bindingKey:'a'.repeat(64)};
test('connection probe uses only the fixed public endpoint and no user credentials or source query',async()=>{
 let n=0;assert.equal(await checkGoogleConnection({fetch:async(url,init)=>{n++;assert.equal(url,'https://oauth2.googleapis.com/token');assert.equal(init.method,'GET');assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');assert.equal(init.body,undefined);assert.equal(init.headers,undefined);return new Response('',{status:404});}}),true);assert.equal(n,1);
});
test('connection failures and abnormal HTTP responses stay bounded without retries or provider text',async()=>{
 for(const status of [200,302,429,500])await assert.rejects(checkGoogleConnection({fetch:async()=>new Response('PRIVATE',{status})}),e=>e.code==='GOOGLE_CONNECTION_UNAVAILABLE'&&!e.message.includes('PRIVATE'));
 let n=0;await assert.rejects(checkGoogleConnection({timeoutMs:8,fetch:async()=>{n++;return new Promise(()=>{});}}),e=>e.code==='GOOGLE_CONNECTION_UNAVAILABLE');assert.equal(n,1);
});
test('aborted probes do not start or survive disposal',async()=>{
 const c=new AbortController();c.abort();let n=0;await assert.rejects(checkGoogleConnection({signal:c.signal,fetch:async()=>{n++;return new Response('',{status:404});}}));assert.equal(n,0);
});
function route(probe){let b=binding,starts=0;const r=createContextRoute({context:{},readConnection:async()=>b,resolveOwner:()=>({sessionId:binding.sessionId,cwd:'/synthetic'}),googleSuiteAuth:{start:async()=>{starts++;return{url:'https://accounts.google.com/o/oauth2/v2/auth',expiresAt:'2030-01-01T00:00:00Z'};}},checkGoogleConnection:probe});return{r,starts:()=>starts,revoke:()=>b={state:'unknown'}};}
const input={action:'google_suite_authorize',expectedBindingRevision:bindingRevision(binding)};
test('unreachable Google does not create a consent flow; HTTP exposes only fixed failure code',async()=>{
 const h=route(async()=>{throw Object.assign(Error('PRIVATE'),{code:'GOOGLE_CONNECTION_UNAVAILABLE'});});let handler;registerContextRoute({get:()=>({fetch:{register:v=>handler=v}})},h.r);
 const res=await handler.fetch(new Request('http://localhost/api/project_companion/context',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)}));assert.equal(res.status,503);const data=await res.json();assert.equal(data.code,'GOOGLE_CONNECTION_UNAVAILABLE');assert.doesNotMatch(JSON.stringify(data),/PRIVATE/);assert.equal(h.starts(),0);
});
test('changed binding and route disposal during probe cannot create a consent flow',async()=>{
 for(const mode of ['revoke','close']){let release,enter,signal;const entered=new Promise(r=>enter=r),held=new Promise(r=>release=r);const h=route(async options=>{signal=options.signal;enter();await held;return true;});const pending=h.r.action(input);await entered;if(mode==='revoke')h.revoke();else h.r.close();release();await assert.rejects(pending);assert.equal(h.starts(),0);if(mode==='close')assert.equal(signal.aborted,true);}
});
test('reachable probe still requires unchanged owner before creating one consent flow',async()=>{const h=route(async()=>true);const r=await h.r.action(input);assert.match(r.url,/accounts.google.com/);assert.equal(h.starts(),1);});

test('failed probe after revoke or close invalidates the UI instead of retaining an old connection',async()=>{
 for(const mode of ['revoke','close']){let release,enter;const entered=new Promise(r=>enter=r),held=new Promise(r=>release=r);const h=route(async()=>{enter();await held;throw Object.assign(Error('PRIVATE'),{code:'GOOGLE_CONNECTION_UNAVAILABLE'});});let handler;registerContextRoute({get:()=>({fetch:{register:v=>handler=v}})},h.r);const pending=handler.fetch(new Request('http://localhost/api/project_companion/context',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)}));await entered;if(mode==='revoke')h.revoke();else h.r.close();release();const response=await pending;assert.equal(response.status,400);assert.equal((await response.json()).code,undefined);assert.equal(h.starts(),0);}
});

test('binding change while the failed probe rechecks pause state cannot retain the old snapshot',async()=>{
 let b=binding,checks=0,starts=0;
 const r=createContextRoute({context:{},readConnection:async()=>b,resolveOwner:()=>({sessionId:binding.sessionId,cwd:'/synthetic'}),canRun:async()=>{if(++checks===3)b={state:'unknown'};return true;},googleSuiteAuth:{start:async()=>{starts++;}},checkGoogleConnection:async()=>{throw Object.assign(Error('PRIVATE'),{code:'GOOGLE_CONNECTION_UNAVAILABLE'});}});
 let handler;registerContextRoute({get:()=>({fetch:{register:v=>handler=v}})},r);
 const response=await handler.fetch(new Request('http://localhost/api/project_companion/context',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)}));assert.equal(response.status,400);assert.equal((await response.json()).code,undefined);assert.equal(starts,0);assert.equal(checks,3);
});
