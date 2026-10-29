import test from 'node:test';
import assert from 'node:assert/strict';
import {createGoogleCalendarRest} from '../src/google-calendar-rest.js';

const fixed=new Date('2026-10-20T08:00:00Z');
const args={calendarId:'primary',startTime:fixed.toISOString(),endTime:'2026-10-21T08:00:00.000Z',orderBy:'startTime',pageSize:5};
const gates={authorize:async()=>true,authorizeSync:()=>true};
const response=body=>new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});
const fails=code=>e=>e.code===code&&!String(e.message).includes('private');

test('bundled calendar contract is passive and explicit about provenance',async()=>{
 let tokens=0,http=0;
 const t=createGoogleCalendarRest({getToken:async()=>{tokens++;return'x';},fetch:async()=>{http++;return response({items:[]});},clock:()=>fixed});
 const catalog=await t.catalog('calendar',gates);
 assert.equal(catalog.provenance,'bundled-contract');assert.equal(catalog.tools.length,1);assert.equal(catalog.tools[0].name,'list_events');assert.equal(tokens,0);assert.equal(http,0);await t.close();
});

test('bounded primary calendar uses fixed GET mapping and keeps coverage',async()=>{
 let request;
 const t=createGoogleCalendarRest({getToken:async()=> 'synthetic-bearer',fetch:async(url,options)=>{request={url:new URL(url),options};return response({summary:'My calendar',items:[{id:'event1',summary:'Planning',status:'confirmed',start:{dateTime:'2026-10-20T10:00:00-06:00',timeZone:'America/Mexico_City'},end:{dateTime:'2026-10-20T11:00:00-06:00'},htmlLink:'https://calendar.google.com/calendar/event?eid=abc',description:'private body omitted',attendees:[{email:'private@example.test'}]}]});},clock:()=>fixed});
 const r=await t.call('calendar','list_events',args,gates);
 assert.equal(request.url.origin,'https://www.googleapis.com');assert.equal(request.url.pathname,'/calendar/v3/calendars/primary/events');
 assert.equal(request.url.searchParams.get('timeMin'),args.startTime);assert.equal(request.url.searchParams.get('timeMax'),args.endTime);assert.equal(request.url.searchParams.get('maxResults'),'5');assert.equal(request.url.searchParams.get('singleEvents'),'true');assert.equal(request.url.searchParams.get('showDeleted'),'false');assert.ok(request.url.searchParams.get('fields').includes('nextPageToken'));assert.equal(request.options.method,'GET');assert.equal(request.options.redirect,'manual');assert.equal(request.options.headers.authorization,'Bearer synthetic-bearer');assert.equal(request.options.body,undefined);
 assert.deepEqual(r.coverage,{source:'calendar',calendarId:'primary',from:args.startTime,to:args.endTime,returned:1,hasMore:false});assert.equal(r.fetchedAt,fixed.toISOString());assert.equal(r.value.items[0].start.timeZone,'America/Mexico_City');assert.equal(r.value.items[0].description,undefined);assert.equal(r.value.items[0].attendees,undefined);assert.equal(r.value.truncated,false);await t.close();
});

test('all-day dates and exclusive end survive; pagination is visible without following it',async()=>{
 let calls=0;
 const t=createGoogleCalendarRest({getToken:async()=> 'x',fetch:async()=>{calls++;return response({nextPageToken:'opaque-private-page-token',items:[{id:'all-day',summary:'Holiday',start:{date:'2026-10-20'},end:{date:'2026-10-21'},htmlLink:'https://evil.example.test/?secret=private'}]});},clock:()=>fixed});
 const r=await t.call('calendar','list_events',args,gates);
 assert.deepEqual(r.value.items[0].start,{date:'2026-10-20'});assert.deepEqual(r.value.items[0].end,{date:'2026-10-21'});assert.equal(r.value.items[0].htmlLink,undefined);assert.equal(r.value.truncated,true);assert.equal(r.coverage.hasMore,true);assert.equal(JSON.stringify(r).includes('opaque-private-page-token'),false);assert.equal(calls,1);await t.close();
});

test('all-day events retain their source calendar timezone without invented timed starts',async()=>{
 const t=createGoogleCalendarRest({getToken:async()=> 'x',fetch:async()=>response({timeZone:'America/New_York',items:[{id:'all-day',summary:'Synthetic day',start:{date:'2026-11-01'},end:{date:'2026-11-02'}}]})});
 const r=await t.call('calendar','list_events',args,gates);
 assert.equal(r.value.items[0].calendarTimeZone,'America/New_York');
 assert.deepEqual(r.value.items[0].start,{date:'2026-11-01'});assert.deepEqual(r.value.items[0].end,{date:'2026-11-02'});
 assert.equal(r.value.items[0].start.dateTime,undefined);await t.close();
});

test('malformed calendar dates and mixed timed/all-day pairs are rejected',async()=>{
 for(const [start,end] of [[{date:'2026-02-31'},{date:'2026-03-01'}],[{date:'2026-11-01'},{date:'2026-11-01'}],[{date:'2026-11-01'},{dateTime:'2026-11-02T00:00:00Z'}]]){
  const t=createGoogleCalendarRest({getToken:async()=> 'x',fetch:async()=>response({timeZone:'UTC',items:[{id:'bad',start,end}]})});
  await assert.rejects(t.call('calendar','list_events',args,gates),fails('CONTEXT_PROTOCOL_INVALID'));await t.close();
 }
});

test('unsupported calendar or input is rejected before tokens or HTTP',async()=>{
 let tokens=0,http=0;const t=createGoogleCalendarRest({getToken:async()=>{tokens++;return'x';},fetch:async()=>{http++;return response({items:[]});}});
 for(const input of [{...args,calendarId:'other'},{...args,pageSize:11},{...args,pageSize:0},{...args,endTime:'2026-11-01T00:00:00Z'},{...args,endTime:args.startTime},{...args,startTime:'2026-10-20'},{...args,orderBy:'updated'},{...args,query:'extra'}])await assert.rejects(t.call('calendar','list_events',input,gates),fails('CONTEXT_ARGUMENTS_INVALID'));
 await assert.rejects(t.call('gmail','list_events',args,gates));await assert.rejects(t.call('calendar','delete_events',args,gates));assert.equal(tokens,0);assert.equal(http,0);await t.close();
});

test('permission revocation during token lookup prevents private HTTP',async()=>{
 let release;const token=new Promise(r=>release=r);let allowed=true,http=0;
 const t=createGoogleCalendarRest({getToken:()=>token,fetch:async()=>{http++;return response({items:[]});}});
 const pending=t.call('calendar','list_events',args,{authorize:async()=>allowed,authorizeSync:()=>allowed});allowed=false;release('x');await assert.rejects(pending,fails('CONTEXT_CANCELLED'));assert.equal(http,0);await t.close();
});

test('last synchronous gate prevents request after async owner validation',async()=>{
 let http=0;const t=createGoogleCalendarRest({getToken:async()=> 'x',fetch:async()=>{http++;return response({items:[]});}});
 await assert.rejects(t.call('calendar','list_events',args,{authorize:async()=>true,authorizeSync:()=>false}),fails('CONTEXT_CANCELLED'));assert.equal(http,0);await t.close();
});

test('missing gates, unusable token and pre-abort fail closed',async()=>{
 let http=0;const t=createGoogleCalendarRest({getToken:async()=> 'bad\r\nprivate',fetch:async()=>{http++;return response({items:[]});}});
 await assert.rejects(t.call('calendar','list_events',args,{}),fails('CONTEXT_CANCELLED'));
 await assert.rejects(t.call('calendar','list_events',args,gates),fails('CONTEXT_AUTH_REQUIRED'));
 await assert.rejects(t.call('calendar','list_events',args,{...gates,signal:AbortSignal.abort()}),fails('CONTEXT_ABORTED'));assert.equal(http,0);await t.close();
});

test('redirect, auth rejection, quota and malformed body expose fixed errors without retry',async()=>{
 for(const [result,code] of [[new Response('private',{status:302,headers:{location:'https://evil.example.test'}}),'CONTEXT_REDIRECT'],[new Response('private',{status:401}),'CONTEXT_AUTH_REQUIRED'],[new Response('private',{status:403}),'CONTEXT_AUTH_REQUIRED'],[new Response('private',{status:429}),'CONTEXT_HTTP_ERROR'],[new Response('{ private',{headers:{'content-type':'application/json'}}),'CONTEXT_PROTOCOL_INVALID'],[response({items:'private'}),'CONTEXT_PROTOCOL_INVALID']]){
 let calls=0;const t=createGoogleCalendarRest({getToken:async()=> 'x',fetch:async()=>{calls++;return result;}});await assert.rejects(t.call('calendar','list_events',args,gates),fails(code));assert.equal(calls,1);await t.close();}
});

test('response limit applies to declared and streamed bodies',async()=>{
 for(const result of [new Response('{}',{headers:{'content-type':'application/json','content-length':'1048577'}}),new Response('x'.repeat(1048577),{headers:{'content-type':'application/json'}})]){
 const t=createGoogleCalendarRest({getToken:async()=> 'x',fetch:async()=>result});await assert.rejects(t.call('calendar','list_events',args,gates),fails('CONTEXT_RESPONSE_TOO_LARGE'));await t.close();}
});

test('close aborts pending token and blocked body without leaking error payloads',async()=>{
 let http=0;const tokenTransport=createGoogleCalendarRest({getToken:()=>new Promise(()=>{}),fetch:async()=>{http++;return response({items:[]});}});
 const pending=tokenTransport.call('calendar','list_events',args,gates);await tokenTransport.close();await assert.rejects(pending,e=>['CONTEXT_ABORTED','CONTEXT_CLOSED'].includes(e.code));assert.equal(http,0);
 let bodyStarted;const started=new Promise(r=>bodyStarted=r);let cancelled=false;
 const bodyTransport=createGoogleCalendarRest({getToken:async()=> 'x',fetch:async()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{"items":['));bodyStarted();},cancel(){cancelled=true;}}),{headers:{'content-type':'application/json'}})});
 const bodyPending=bodyTransport.call('calendar','list_events',args,gates);await started;await bodyTransport.close();await assert.rejects(bodyPending,fails('CONTEXT_ABORTED'));assert.equal(cancelled,true);
});

 test('gates are rechecked after the response and private error payloads never escape',async()=>{
 let allowed=true;
 const t=createGoogleCalendarRest({getToken:async()=> 'x',fetch:async()=>{allowed=false;return response({items:[]});}});
 await assert.rejects(t.call('calendar','list_events',args,{authorize:async()=>allowed,authorizeSync:()=>allowed}),fails('CONTEXT_CANCELLED'));await t.close();
 const bad=createGoogleCalendarRest({getToken:async()=>{throw Object.assign(new Error('private-token-payload'),{code:'CONTEXT_AUTH_REQUIRED'});}});
 await assert.rejects(bad.call('calendar','list_events',args,gates),fails('CONTEXT_AUTH_REQUIRED'));await bad.close();
 });

test('clipped event title is marked as partial coverage',async()=>{
 const t=createGoogleCalendarRest({getToken:async()=> 'x',fetch:async()=>response({items:[{id:'long',summary:'x'.repeat(501),start:{date:'2026-10-20'},end:{date:'2026-10-21'}}]})});
 const r=await t.call('calendar','list_events',args,gates);assert.equal(r.value.items[0].summary.length,500);assert.equal(r.value.truncated,true);assert.equal(r.coverage.hasMore,false);await t.close();
});

test('token refresh mutation receives an affirmative owner gate',async()=>{
 let affirmed=false;
 const t=createGoogleCalendarRest({getToken:async({authorizeMutation})=>{affirmed=await authorizeMutation();assert.equal(affirmed,true);return 'x';},fetch:async()=>response({items:[]})});
 const r=await t.call('calendar','list_events',args,gates);assert.equal(affirmed,true);assert.equal(r.value.items.length,0);await t.close();
});
test('Calendar auth failure preserves fixed diagnostics without calling source API',async()=>{
 const transport=createGoogleCalendarRest({getToken:async()=>{throw Object.assign(Error('SYNTHETIC_PRIVATE'),{authDiagnostic:{stage:'token_endpoint_http',statusClass:'400',oauthError:'invalid_grant',error_description:'SYNTHETIC_PRIVATE'}});},fetch:async()=>{throw Error('must not access source');}});
 try{await assert.rejects(transport.call('calendar','list_events',{calendarId:'primary',startTime:'2026-10-27T19:00:00Z',endTime:'2026-10-28T19:00:00Z',orderBy:'startTime',pageSize:2},{authorize:async()=>true,authorizeSync:()=>true}),e=>{assert.equal(e.code,'CONTEXT_AUTH_REQUIRED');assert.deepEqual(e.authDiagnostic,{stage:'token_endpoint_http',statusClass:'400',oauthError:'invalid_grant'});assert.doesNotMatch(String(e)+JSON.stringify(e.authDiagnostic),/SYNTHETIC_PRIVATE/);return true;});}finally{await transport.close();}
});
