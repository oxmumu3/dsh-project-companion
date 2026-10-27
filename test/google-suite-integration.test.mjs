import test from 'node:test';
import assert from 'node:assert/strict';
import {createGoogleSuiteAuth,GOOGLE_SUITE_SCOPES} from '../src/google-suite-auth.js';
import {createGoogleSuiteRest} from '../src/google-suite-rest.js';
import {createGoogleCalendarRest} from '../src/google-calendar-rest.js';
import {createContextProvider} from '../src/context-provider.js';
import {createContextCredentialWriter} from '../src/context-credential-writer.js';
import {createPersonalContext} from '../src/context-service.js';

const publisher={kind:'desktop',clientId:'suite-test.apps.googleusercontent.com',clientSecret:'public-fixture'};
const owner={sessionId:'suite-owner',cwd:'/private/synthetic-suite'};
const record={version:1,source:'google-suite',profile:'readonly',connectionId:'suite-connection',clientId:publisher.clientId,requestedScopes:[...GOOGLE_SUITE_SCOPES],grantedScopes:[...GOOGLE_SUITE_SCOPES],refreshToken:'old-refresh',authorizedAt:'2026-10-22T08:00:00Z'};
function fixture(t,options={}){
 let config={googleSuiteOAuthCredentials:JSON.stringify(record)},revision=1,state,binding='a'.repeat(64);const calls=[],writes=[];
 const writer=createContextCredentialWriter({ctx:{fiber:{entry:{options:{id:'suite-test'}}},get:()=>({describe:()=>[{ns:'suite-test',revision}],mutate:async(ns,ops,expected)=>{assert.equal(revision,expected);writes.push(ns);config={...config,[ops[0].path[0]]:ops[0].value};revision++;}})},readConfig:()=>config});
 const http=async(url,init)=>{const u=new URL(url);calls.push({url:u.href,method:init.method});if(u.hostname==='oauth2.googleapis.com'){await options.beforeToken?.();return Response.json({access_token:'suite-access',refresh_token:'rotated-refresh',expires_in:3600,token_type:'Bearer',scope:GOOGLE_SUITE_SCOPES.join(' ')});}await options.beforeRead?.(u);if(u.pathname.endsWith('/messages'))return Response.json({messages:[{id:'m1'}]});if(u.pathname.endsWith('/messages/m1'))return Response.json({id:'m1',snippet:'mail preview',payload:{headers:[{name:'Subject',value:'Customer update'}]}});if(u.pathname==='/drive/v3/files')return Response.json({files:[{id:'f1',name:'Work plan',mimeType:'application/vnd.google-apps.document'}]});if(u.pathname==='/drive/v3/files/f1')return Response.json({id:'f1',name:'Work plan',mimeType:'application/vnd.google-apps.document'});if(u.pathname==='/drive/v3/files/f1/export')return new Response('Project next step',{headers:{'content-type':'text/plain'}});if(u.hostname==='sheets.googleapis.com')return Response.json({range:'A1:B2',values:[['Metric','Value'],['Users',100]]});if(u.pathname.endsWith('/events'))return Response.json({items:[]});throw Error('unexpected request');};
 const auth=createGoogleSuiteAuth({publisher,readConfig:()=>config,saveCredentials:(value,conditions)=>writer('googleSuite',value,conditions),fetch:http,clock:()=>1800000000000});
 const suite=createGoogleSuiteRest({getToken:(source,settings)=>auth.getToken(source,settings),fetch:http});
 const calendar=createGoogleCalendarRest({getToken:settings=>auth.getToken('calendar',settings),fetch:http});
 const provider=createContextProvider({calendar,suite,useSuite:()=>true,mcp:{catalog:async()=>{throw Error('no advanced fallback');},call:async()=>{throw Error('no advanced fallback');},close(){}}});
 const service=createPersonalContext({store:{get:async()=>state,put:async(_key,value)=>state=value},transport:provider,readConfig:()=>config,credentialState:source=>auth.credentialState(source),readBinding:async()=>({kind:'bound',bindingKey:binding}),clock:()=>new Date('2026-10-22T08:00:00Z')});
 t.after(async()=>{await service.close();await provider.close();await auth.close();});
 return{auth,service,calls,writes,changeBinding:()=>{binding='b'.repeat(64);},config:()=>config};
}
test('suite consent record refreshes through native CAS and reads three services only after explicit enables',async t=>{
 const h=fixture(t),before=h.auth.credentialState('gmail').key;
 for(const source of ['gmail','calendar','drive','docs','sheets'])await h.service.act(owner,{action:'connect',source,userRequested:true});assert.deepEqual(h.calls,[]);
 const gmail=await h.service.act(owner,{action:'query',source:'gmail',operation:'search',query:'newer_than:1d',limit:1,userRequested:true});assert.equal(gmail.items[0].title,'Customer update');assert.equal(gmail.items[0].status,'metadata_only');
 const drive=await h.service.act(owner,{action:'query',source:'drive',operation:'search',query:'Work',userRequested:true});assert.equal(drive.items[0].title,'Work plan');
 const doc=await h.service.act(owner,{action:'query',source:'docs',operation:'read',id:'f1',userRequested:true});assert.equal(doc.items[0].text,'Project next step');
 const sheet=await h.service.act(owner,{action:'query',source:'sheets',operation:'read',id:'sheet1',range:'A1:B2',userRequested:true});assert.match(sheet.items[0].text,/Users\t100/);
 const calendar=await h.service.act(owner,{action:'query',source:'calendar',operation:'upcoming',userRequested:true});assert.equal(calendar.coverage.returned,0);
 assert.equal(h.calls.filter(c=>c.method==='POST').length,1);assert.equal(h.writes.length,1);assert.equal(h.auth.credentialState('gmail').key,before);assert.equal(JSON.parse(h.config().googleSuiteOAuthCredentials).refreshToken,'rotated-refresh');assert.equal(JSON.parse(h.config().googleSuiteOAuthCredentials).accessToken,undefined);
});
test('binding change during suite refresh prevents credential persistence and every private API read',async t=>{
 let h;h=fixture(t,{beforeToken:async()=>h.changeBinding()});await h.service.act(owner,{action:'connect',source:'gmail',userRequested:true});await assert.rejects(h.service.act(owner,{action:'query',source:'gmail',operation:'search',query:'today',userRequested:true}));assert.equal(h.calls.length,1);assert.equal(h.writes.length,0);assert.equal(JSON.parse(h.config().googleSuiteOAuthCredentials).refreshToken,'old-refresh');
});
test('owner change after Gmail listing stops detail reads and discards search result',async t=>{
 let h;h=fixture(t,{beforeRead:async u=>{if(u.pathname.endsWith('/messages'))h.changeBinding();}});await h.service.act(owner,{action:'connect',source:'gmail',userRequested:true});await assert.rejects(h.service.act(owner,{action:'query',source:'gmail',operation:'search',query:'today',userRequested:true}));assert.equal(h.calls.some(c=>c.url.includes('/messages/m1')),false);
});
test('cold suite Calendar uses the service guard through the real REST and auth chain',async t=>{
 const h=fixture(t);await h.service.act(owner,{action:'connect',source:'calendar',userRequested:true});
 const r=await h.service.act(owner,{action:'query',source:'calendar',operation:'upcoming',from:'2026-10-22T08:00:00Z',to:'2026-10-23T08:00:00Z',limit:2,userRequested:true});
 assert.equal(r.source,'calendar');assert.equal(r.coverage.returned,0);assert.equal(h.calls.filter(c=>c.method==='POST').length,1);assert.equal(h.writes.length,1);
});
