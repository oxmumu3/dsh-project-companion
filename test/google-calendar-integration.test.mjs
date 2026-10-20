import test from 'node:test';import assert from 'node:assert/strict';
import {createGoogleCalendarAuth} from '../src/google-calendar-auth.js';
import {createGoogleCalendarRest} from '../src/google-calendar-rest.js';
import {createContextProvider} from '../src/context-provider.js';
import {createContextCredentialWriter} from '../src/context-credential-writer.js';
import {createPersonalContext} from '../src/context-service.js';
const publisher={kind:'desktop',clientId:'integration-fixture.apps.googleusercontent.com'};
const scope='https://www.googleapis.com/auth/calendar.events.readonly';
const owner={sessionId:'owner',cwd:'/synthetic/project'};
async function fixture(t,options={}){
 let record={version:1,source:'calendar',profile:'primary-events',connectionId:'stable-fixture-connection',clientId:publisher.clientId,requestedScopes:[scope],grantedScopes:[scope],refreshToken:'old-fixture-refresh',authorizedAt:'2026-10-19T12:00:00Z'};
 let config={googleCalendarOAuthCredentials:JSON.stringify(record)},revision=1,state,binding='a'.repeat(64);const requests=[],writes=[];
 const writer=createContextCredentialWriter({ctx:{fiber:{entry:{options:{id:'project-companion'}}},get:()=>({describe:()=>[{ns:'project-companion',revision}],mutate:async(ns,ops,expected)=>{assert.equal(expected,revision);writes.push({ns,ops,expected});config={...config,[ops[0].path[0]]:ops[0].value};revision++;}})},readConfig:()=>config});
 const http=async(url,init)=>{requests.push({url,init});if(url==='https://oauth2.googleapis.com/token'){await options.beforeToken?.();return Response.json({access_token:'integration-access',refresh_token:'rotated-fixture-refresh',token_type:'Bearer',expires_in:3600});}return Response.json({items:[{id:'event-one',summary:'团队会议',start:{dateTime:'2026-10-20T14:00:00-06:00'},end:{dateTime:'2026-10-20T15:00:00-06:00'}}]});};
 const auth=createGoogleCalendarAuth({publisher,readConfig:()=>config,saveCredentials:(v,c)=>writer('googleCalendar',v,c),fetch:http,clock:()=>1800000000000});
 const rest=createGoogleCalendarRest({getToken:s=>auth.getToken(s),fetch:http,clock:()=>new Date('2026-10-20T12:00:00Z')});
 const provider=createContextProvider({calendar:rest,mcp:{catalog:async()=>{throw Error('no legacy fallback');},call:async()=>{throw Error('no legacy fallback');},close(){}}});
 const service=createPersonalContext({store:{get:async()=>state,put:async(_k,v)=>state=v},transport:provider,readConfig:()=>config,credentialState:s=>s==='calendar'?auth.credentialState():null,readBinding:async()=>({kind:'bound',bindingKey:binding}),clock:()=>new Date('2026-10-20T12:00:00Z')});
 t.after(async()=>{await service.close();await provider.close();await auth.close();});
 return{auth,service,requests,writes,config:()=>config,changeBinding:()=>{binding='b'.repeat(64);}};
}
test('real auth refresh, native CAS, provider and service jointly read only explicit primary Calendar',async t=>{
 const h=await fixture(t);const before=h.auth.credentialState().key;assert.equal(h.requests.length,0);const c=await h.service.act(owner,{action:'connect',source:'calendar',userRequested:true});assert.match(c.text,/尚未验证实际读取/);assert.equal(h.requests.length,0);
 const r=await h.service.act(owner,{action:'query',source:'calendar',operation:'upcoming',userRequested:true});assert.match(r.text,/团队会议/);assert.equal(r.coverage.calendarId,'primary');assert.equal(h.requests.length,2);assert.equal(h.requests[0].url,'https://oauth2.googleapis.com/token');assert.match(h.requests[1].url,/^https:\/\/www.googleapis.com\/calendar\/v3\/calendars\/primary\/events\?/);assert.equal(h.writes.length,1);assert.equal(h.auth.credentialState().key,before);assert.equal(JSON.parse(h.config().googleCalendarOAuthCredentials).refreshToken,'rotated-fixture-refresh');assert.equal(JSON.parse(h.config().googleCalendarOAuthCredentials).accessToken,undefined);assert.equal((await h.service.snapshot(owner)).sources.find(s=>s.id==='calendar').enabled,true);
});
test('owner changed during the real auth refresh cannot persist or reach Calendar REST',async t=>{
 let h;h=await fixture(t,{beforeToken:async()=>h.changeBinding()});await h.service.act(owner,{action:'connect',source:'calendar',userRequested:true});await assert.rejects(h.service.act(owner,{action:'query',source:'calendar',operation:'upcoming',userRequested:true}));assert.equal(h.requests.length,1);assert.equal(h.writes.length,0);assert.equal(JSON.parse(h.config().googleCalendarOAuthCredentials).refreshToken,'old-fixture-refresh');
});
