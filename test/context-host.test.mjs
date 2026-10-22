import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Context} from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import CommandRuntime from '@deepseek-ai/dsh-commands';
import Storage from '@deepseek-ai/dsh-storage';
import * as JsonStorage from '@deepseek-ai/dsh-storage-json';
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain';
import SessionStore,{SessionId} from '@deepseek-ai/dsh-session';

async function fixture(t,options={}){
  const {installCompanion}=await import('../index.js');
  const root=await realpath(await mkdtemp(join(tmpdir(),'dot-context-host-')));
  const ctx=new Context();
  for(const [plugin,config] of [[SystemPrompt,{}],[ToolRuntime,{mode:'native'}],[CommandRuntime,undefined],[Storage,undefined],[JsonStorage,{root:join(root,'storage')}],[StorageDomain,{backend:'json'}],[SessionStore,undefined]])await ctx.plugin(plugin,config);
  const agents=new Map(),routes=new Map(),calls=[],closed=[];
  ctx.provide('agents',{get:id=>agents.get(id),list:()=>[...agents.values()]});
  ctx.provide('workingDirectory',{get:session=>session.header.cwd});
  ctx.provide('workspaceRegistry',{list:()=>[]});
  ctx.provide('connection',{fetch:{register:route=>{routes.set(route.path,route);return()=>routes.delete(route.path);}}});
  let connection={state:'bound',sessionId:'context-owner',bindingKey:'a'.repeat(64)};
  const session=ctx.sessions.create(SessionId('context-owner'),{meta:{cwd:root}});
  const agent={id:session.id,session,ctx,status:'idle'};agents.set(agent.id,agent);
  let adapter;
  const config={didaToken:'synthetic-private-token',flomoToken:'',googleClientId:'',googleClientSecret:'',googleRefreshToken:''};
  const transport={catalog:async(source,{signal})=>{calls.push({type:'catalog',source});return options.catalog?.(source,{signal})??{tools:[{name:'list_projects',inputSchema:{type:'object',properties:{limit:{type:'integer'},offset:{type:'integer'}}}}],fetchedAt:'2026-10-19T12:00:00Z'};},call:async(source,name,args,{signal})=>{calls.push({type:'call',source,name,args});return options.call?.(source,name,args,{signal})??{value:{structuredContent:{projects:[{id:'p1',name:'当前事项'}]}},fetchedAt:'2026-10-19T12:00:00Z'};},close:async()=>closed.push('transport')};
  const googleAuth={status:()=>({clientConfigured:false,refreshConfigured:false,authInProgress:false}),start:async()=>{calls.push({type:'google_authorize'});return{url:'https://accounts.google.com/o/oauth2/v2/auth?state=synthetic',expiresAt:'2026-10-19T12:05:00Z'};},getToken:async()=>{throw new Error('must not access Google');},close:async()=>closed.push('googleAuth')};
  const plugin=await ctx.plugin({name:'synthetic-context-host',inject:['tools','commands','storageDomain','sessions','systemPrompt'],async apply(scope){adapter=await installCompanion(scope,{clock:()=>new Date('2026-10-19T12:00:00Z'),readSetup:async()=>connection,readNativeRoute:options.readNativeRoute??(async()=>({kind:'unbound'})),readBinding:async()=>null,context:{readConfig:()=>({...config}),googlePublisher:options.googlePublisher??null,fetch:options.contextFetch??(async()=>{throw new Error('Synthetic context host must not contact real services');}),transport,googleAuth,...(options.flomoAuth?{flomoAuth:options.flomoAuth}:{}),...(options.didaAuth?{didaAuth:options.didaAuth}:{}),...(options.googleCalendarAuth?{googleCalendarAuth:options.googleCalendarAuth}:{}),...(options.googleSuiteAuth?{googleSuiteAuth:options.googleSuiteAuth}:{}),...(options.suiteTransport?{suiteTransport:options.suiteTransport}:{}),...(options.calendarTransport?{calendarTransport:options.calendarTransport}:{})},timers:{setInterval(){throw new Error('context must not start timers');},clearInterval(){}}});}});
  let number=0;
  const tool=async args=>{const response=await ctx.tools.execute({callId:'context-test-'+(++number),name:'personal_context',arguments:args,agent,signal:new AbortController().signal});assert.equal(response.isError,false,JSON.stringify(response));return response.value;};
  const project=async args=>{const response=await ctx.tools.execute({callId:'context-project-'+(++number),name:'project_companion',arguments:args,agent,signal:new AbortController().signal});assert.equal(response.isError,false,JSON.stringify(response));return response.value;};
  const route=()=>routes.get('/api/project_companion/context');
  const get=async()=>{const response=await route().fetch(new Request('http://localhost/api/project_companion/context'));return{status:response.status,value:await response.json()};};
  const post=async body=>{const response=await route().fetch(new Request('http://localhost/api/project_companion/context',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}));return{status:response.status,value:await response.json()};};
  const close=()=>ctx.fiber.dispose();
  t.after(async()=>{await close();await rm(root,{recursive:true,force:true});});
  return{ctx,agent,agents,routes,calls,closed,adapter,plugin,config,tool,project,get,post,route,close,setConnection:value=>connection=value};
}

test('installs a passive native context tool and authenticated route without reading sources',async t=>{
  const h=await fixture(t);
  assert.ok(h.ctx.tools.schemas(h.agent).some(tool=>tool.name==='personal_context'));
  assert.ok(h.route());
  const snapshot=await h.get();
  assert.equal(snapshot.status,200);assert.equal(snapshot.value.sources.length,8);assert.equal(snapshot.value.googleAuth.refreshConfigured,false);
  assert.equal(snapshot.value.sources.find(row=>row.id==='dida').configured,true);
  assert.equal(h.calls.length,0);
  assert.equal(JSON.stringify(snapshot).includes('synthetic-private-token'),false);
  assert.ok(h.adapter.context);
});

test('context tool requires explicit user intent and reads only an enabled exact source',async t=>{
  const h=await fixture(t);
  assert.equal((await h.tool({action:'query',source:'dida',operation:'projects'})).status,'blocked');
  assert.equal(h.calls.length,0);
  const connected=await h.tool({action:'connect',source:'dida',userRequested:true});
  assert.equal(connected.sources.find(row=>row.id==='dida').enabled,true);
  await h.tool({action:'query',source:'dida',operation:'projects',userRequested:true});
  assert.deepEqual(h.calls.map(row=>row.type),['catalog','catalog','call']);
  assert.equal(h.calls.at(-1).name,'list_projects');
  const before=h.calls.length;
  assert.equal((await h.tool({action:'query',source:'flomo',operation:'search',query:'AI',userRequested:true})).status,'blocked');
  assert.equal(h.calls.length,before);
});

test('authenticated context route rejects extra fields, secret text, wrong media type and oversized requests',async t=>{
  const h=await fixture(t);
  for(const input of [{action:'connect',source:'dida',token:'do-not-store'},{action:'google_authorize',source:'gmail'},{action:'query',source:'dida'},{action:'connect',source:'unknown'}])assert.equal((await h.post(input)).status,400);
  const bad=await h.route().fetch(new Request('http://localhost/api/project_companion/context',{method:'POST',body:'{}'}));assert.equal(bad.status,415);
  const huge=await h.route().fetch(new Request('http://localhost/api/project_companion/context',{method:'POST',headers:{'content-type':'application/json'},body:' '.repeat(5000)}));assert.equal(huge.status,413);
  assert.equal(h.calls.length,0);
});

test('native route resumes only its original bound session on an explicit POST, never on GET',async t=>{
  const h=await fixture(t);h.agents.delete(h.agent.id);
  const resumed=[];h.ctx.provide('sessionController',{resolveAgent:async id=>{resumed.push(id);h.agents.set(h.agent.id,h.agent);return{agent:h.agent};}});
  assert.equal((await h.get()).status,200);assert.deepEqual(resumed,[]);
  assert.equal((await h.post({action:'connect',source:'dida'})).status,200);
  assert.deepEqual(resumed,[h.agent.id]);assert.deepEqual(h.calls.map(row=>row.type),['catalog']);
});

test('changed binding during native owner resume prevents source discovery and authorization',async t=>{
  const h=await fixture(t);h.agents.delete(h.agent.id);
  h.ctx.provide('sessionController',{resolveAgent:async()=>{h.agents.set(h.agent.id,h.agent);h.setConnection({state:'bound',sessionId:'different-owner',bindingKey:'b'.repeat(64)});return{agent:h.agent};}});
  assert.equal((await h.post({action:'connect',source:'dida'})).status,400);assert.equal(h.calls.length,0);
});

test('only native explicit google_authorize returns a browser link',async t=>{
  const h=await fixture(t);
  const result=await h.post({action:'google_authorize'});
  assert.equal(result.status,200);assert.match(result.value.url,/^https:\/\/accounts\.google\.com\//);
  assert.deepEqual(h.calls.map(row=>row.type),['google_authorize']);
});

test('global pause stops new context reads and existing connections survive resume',async t=>{
  const h=await fixture(t);await h.tool({action:'connect',source:'dida',userRequested:true});
  await h.project({action:'pause'});
  assert.equal((await h.tool({action:'query',source:'dida',operation:'projects',userRequested:true})).status,'blocked');
  assert.equal(h.calls.length,1);
  await h.project({action:'resume'});
  assert.notEqual((await h.tool({action:'query',source:'dida',operation:'projects',userRequested:true})).status,'blocked');
});

test('unknown binding fails closed while a positively unbound native session can connect',async t=>{
  const h=await fixture(t);h.setConnection({state:'unknown'});
  // The fixture readNativeRoute positively verifies this is a native, unbound session.
  assert.equal((await h.tool({action:'connect',source:'dida',userRequested:true})).sources.find(row=>row.id==='dida').enabled,true);
  const unknown=await fixture(t,{readNativeRoute:async()=>({kind:'unknown'})});unknown.setConnection({state:'unknown'});
  assert.equal((await unknown.tool({action:'connect',source:'dida',userRequested:true})).status,'blocked');
  assert.equal(unknown.calls.length,0);
});

test('plugin disposal aborts context work and closes only its own native route and services',async t=>{
  let entered;
  const ready=new Promise(resolve=>entered=resolve);
  let wait=false;
  const h=await fixture(t,{catalog:async(source,{signal})=>{if(!wait)return{tools:[{name:'list_projects',inputSchema:{type:'object'}}]};entered();return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('private source failure')),{once:true}));}});
  await h.tool({action:'connect',source:'dida',userRequested:true});wait=true;
  const pending=h.tool({action:'query',source:'dida',operation:'projects',userRequested:true});await ready;
  await h.close();assert.equal((await pending).status,'blocked');
  assert.ok(h.closed.includes('transport'));assert.ok(h.closed.includes('googleAuth'));
  assert.equal(h.routes.has('/api/project_companion/context'),false);
});

test('context cleanup rejection is observed immediately while unrelated project cleanup drains',async t=>{
  const h=await fixture(t);
  const original=h.adapter.context.close;
  h.adapter.context.close=()=>{void original();return Promise.reject(new Error('synthetic failed context store cleanup'));};
  const closeMemory=h.adapter.memory.close;
  h.adapter.memory.close=async()=>{await new Promise(resolve=>setImmediate(resolve));return closeMemory();};
  await h.close();
  assert.ok(h.closed.includes('transport'));assert.ok(h.closed.includes('googleAuth'));
});


test('native account authorizations return sanitized first-party links only on explicit owner POST',async t=>{
 const starts=[];const make=source=>({status:()=>({clientConfigured:true,refreshConfigured:false,authInProgress:false}),start:async()=>{starts.push(source);return{url:source==='flomo'?'https://flomoapp.com/integration/grant?state=fixture':'https://dida365.com/oauth/authorize?state=fixture',expiresAt:'2026-10-19T12:05:00Z'};},getToken:async()=>{throw new Error('no private read');},close:async()=>{}});
 const h=await fixture(t,{flomoAuth:make('flomo'),didaAuth:make('dida')});const before=await h.get();assert.equal(before.value.flomoAuth.refreshConfigured,false);assert.equal(before.value.didaAuth.clientConfigured,true);assert.deepEqual(starts,[]);
 for(const source of ['flomo','dida']){const result=await h.post({action:source+'_authorize'});assert.equal(result.status,200);assert.ok(result.value.url.startsWith('https://'));assert.equal((await h.post({action:source+'_authorize',token:'untrusted'})).status,400);}
 assert.deepEqual(starts,['flomo','dida']);assert.equal(h.calls.length,0);
});

test('ordinary Calendar preparation is passive and cannot use the legacy Google authorization',async t=>{
 const h=await fixture(t,{googlePublisher:null});const snapshot=await h.get();assert.equal(snapshot.value.googleCalendarAuth.clientConfigured,false);assert.equal(snapshot.value.sources.find(row=>row.id==='calendar').configured,false);assert.equal((await h.post({action:'google_calendar_authorize'})).status,400);assert.equal(h.calls.length,0);
});
test('Calendar native authorization is owner gated and separate from advanced MCP; only explicit query reaches REST',async t=>{
 let guard,connected=true;const events=[];const auth={status:()=>({clientConfigured:true,refreshConfigured:connected,authInProgress:false}),credentialState:()=>({configured:connected,key:'c'.repeat(64)}),start:async o=>{guard=o.authorizeMutation;assert.equal(await guard(),true);events.push('authorize');return{url:'https://accounts.google.com/o/oauth2/v2/auth?state=calendar',expiresAt:'2026-10-19T12:05:00Z'};},getToken:async()=>{throw Error('injected REST handles token');},close:async()=>events.push('auth close')};
 const calendar={catalog:async()=>{events.push('catalog');return{provenance:'bundled-contract',tools:[{name:'list_events',inputSchema:{type:'object'}}]};},call:async()=>{events.push('read');return{value:{items:[]},coverage:{source:'calendar',calendarId:'primary',from:'2026-10-19T12:00:00Z',to:'2026-10-20T12:00:00Z',returned:0,hasMore:false}};},close:async()=>events.push('rest close')};
 const h=await fixture(t,{googleCalendarAuth:auth,calendarTransport:calendar});assert.deepEqual(events,[]);assert.equal((await h.post({action:'google_calendar_authorize'})).status,200);assert.deepEqual(events,['authorize']);assert.equal((await h.post({action:'google_calendar_authorize',source:'calendar'})).status,400);const c=await h.tool({action:'connect',source:'calendar',userRequested:true});assert.match(c.text,/尚未验证/);assert.equal(events.includes('read'),false);const r=await h.tool({action:'query',source:'calendar',operation:'upcoming',userRequested:true});assert.match(r.text,/主日历/);assert.deepEqual(h.calls,[]);h.setConnection({state:'bound',sessionId:'other',bindingKey:'b'.repeat(64)});await assert.rejects(guard());assert.equal((await h.tool({action:'query',source:'calendar',operation:'upcoming',userRequested:true})).status,'blocked');await h.close();assert.ok(events.includes('auth close'));assert.ok(events.includes('rest close'));
});

test('registered Calendar publisher stays passive until explicit owner login and cannot read without user authorization',async t=>{
  const requests=[];
  const publisher={kind:'desktop',clientId:'synthetic-registration.apps.googleusercontent.com',clientSecret:'synthetic-public-desktop'};
  const h=await fixture(t,{googlePublisher:publisher,contextFetch:async(url,init)=>{requests.push({url,method:init?.method});throw new Error('Synthetic host must not contact Google');}});
  assert.equal(requests.length,0,'install must not fetch metadata, tokens or private Calendar data');
  assert.equal(h.adapter.googleCalendarAuth.status().clientConfigured,true,'publisher metadata reaches the real controller');
  const first=await h.get();
  assert.equal(first.status,200);
  assert.deepEqual(first.value.googleCalendarAuth,{clientConfigured:true,refreshConfigured:false,authInProgress:false});
  const row=first.value.sources.find(source=>source.id==='calendar');
  assert.equal(row.configured,false,'registered app is not a user account connection');
  assert.equal(row.enabled,false);
  assert.equal(requests.length,0,'GET is a local status projection');
  assert.deepEqual(h.calls,[]);
  assert.doesNotMatch(JSON.stringify(first.value),/synthetic-registration|synthetic-public-desktop/);
  assert.equal((await h.post({action:'connect',source:'calendar'})).status,400);
  assert.equal((await h.tool({action:'query',source:'calendar',operation:'upcoming',userRequested:true})).status,'blocked');
  assert.equal(requests.length,0,'missing user authorization cannot fetch or refresh tokens');
  const started=await h.post({action:'google_calendar_authorize'});
  assert.equal(started.status,200);
  const url=new URL(started.value.url),redirect=new URL(url.searchParams.get('redirect_uri'));
  assert.equal(url.origin+url.pathname,'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(url.searchParams.get('client_id'),publisher.clientId);
  assert.deepEqual(url.searchParams.get('scope').split(' '),['https://www.googleapis.com/auth/calendar.events.readonly']);
  assert.equal(url.searchParams.get('include_granted_scopes'),null);
  assert.equal(url.searchParams.get('code_challenge_method'),'S256');
  assert.equal(redirect.hostname,'127.0.0.1');
  assert.equal(redirect.pathname,'/oauth2/callback');
  assert.ok(Number(redirect.port)>0);
  assert.doesNotMatch(JSON.stringify(started.value),/synthetic-public-desktop|access_token|refresh_token/);
  assert.equal(h.adapter.googleCalendarAuth.status().authInProgress,true);
  const waiting=await h.get();
  assert.equal(waiting.value.googleCalendarAuth.refreshConfigured,false);
  assert.equal(waiting.value.sources.find(source=>source.id==='calendar').configured,false);
  assert.equal((await h.post({action:'connect',source:'calendar'})).status,400);
  assert.equal((await h.tool({action:'query',source:'calendar',operation:'upcoming',userRequested:true})).status,'blocked');
  assert.deepEqual(requests,[],'generating a link is not a token exchange or Calendar read');
  assert.deepEqual(h.calls,[],'ordinary Calendar never calls the legacy Google/MCP stub');
  await h.close();
  assert.equal(h.adapter.googleCalendarAuth.status().authInProgress,false);
  await assert.rejects(h.adapter.googleCalendarAuth.start({authorizeMutation:async()=>true}),/已关闭/);
  await assert.rejects(fetch(redirect),/fetch failed/);
  assert.deepEqual(requests,[]);
});


test('Google suite native login exposes only sanitized actual grants and requires owner and explicit POST',async t=>{
 const events=[];let guard;const suite={status:()=>({clientConfigured:true,refreshConfigured:true,authInProgress:false,grantedSources:['gmail','drive','untrusted'],refreshToken:'must-not-expose'}),credentialState:source=>({configured:['gmail','drive','docs','sheets','slides'].includes(source),key:'d'.repeat(64)}),start:async options=>{guard=options.authorizeMutation;assert.equal(await guard(),true);events.push('authorize');return{url:'https://accounts.google.com/o/oauth2/v2/auth?state=fixture',expiresAt:'2026-10-19T12:05:00Z'};},getToken:async()=>{throw Error('no live fetch');},close:async()=>events.push('auth close')};
 const transport={catalog:async()=>{events.push('catalog');return{provenance:'bundled-contract',tools:[{name:'search_threads',inputSchema:{type:'object'}}]};},call:async()=>{events.push('read');return{value:{messages:[]}};},close:async()=>events.push('transport close')};
 const h=await fixture(t,{googleSuiteAuth:suite,suiteTransport:transport});const before=await h.get();assert.deepEqual(before.value.googleSuiteAuth,{clientConfigured:true,refreshConfigured:true,authInProgress:false,grantedSources:['gmail','drive']});assert.equal(before.value.sources.find(r=>r.id==='gmail').configured,true);assert.equal(before.value.sources.find(r=>r.id==='calendar').configured,false);assert.deepEqual(events,[]);assert.doesNotMatch(JSON.stringify(before.value),/must-not-expose/);
 assert.equal((await h.post({action:'google_suite_authorize'})).status,200);assert.equal((await h.post({action:'google_suite_authorize',token:'not-accepted'})).status,400);assert.equal((await h.post({action:'connect',source:'gmail'})).status,200);assert.deepEqual(events,['authorize','catalog']);assert.equal((await h.tool({action:'query',source:'gmail',operation:'search',query:'test',userRequested:true})).source,'gmail');assert.deepEqual(events,['authorize','catalog','catalog','read']);assert.deepEqual(h.calls,[]);
 h.setConnection({state:'bound',sessionId:'another-owner',bindingKey:'b'.repeat(64)});await assert.rejects(guard());assert.equal((await h.tool({action:'query',source:'gmail',operation:'search',query:'test',userRequested:true})).status,'blocked');await h.close();assert.ok(events.includes('auth close'));assert.ok(events.includes('transport close'));
});

test('suite registration is passive and full-login request has only the three read scopes',async t=>{
 const requests=[];const h=await fixture(t,{googlePublisher:{kind:'desktop',clientId:'suite-fixture.apps.googleusercontent.com'},contextFetch:async()=>{requests.push('unexpected');throw Error('no network');}});const state=await h.get();assert.deepEqual(state.value.googleSuiteAuth,{clientConfigured:true,refreshConfigured:false,authInProgress:false,grantedSources:[]});const started=await h.post({action:'google_suite_authorize'});assert.equal(started.status,200);const url=new URL(started.value.url);assert.deepEqual(url.searchParams.get('scope').split(' '),['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/calendar.events.readonly','https://www.googleapis.com/auth/drive.readonly']);assert.equal(url.searchParams.get('include_granted_scopes'),null);assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.deepEqual(requests,[]);await h.project({action:'pause'});assert.equal((await h.post({action:'google_suite_authorize'})).status,400);
});
