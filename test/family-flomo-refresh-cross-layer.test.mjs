import test from 'node:test';
import assert from 'node:assert/strict';
import {createContextAccountAuth} from '../src/context-account-auth.js';
import {createContextCredentialWriter} from '../src/context-credential-writer.js';
import {createContextTransport} from '../src/context-transport.js';
import {createGoogleCalendarRest} from '../src/google-calendar-rest.js';
import {createContextProvider} from '../src/context-provider.js';
import {createPersonalContext} from '../src/context-service.js';
import {createFamilyOwnerDelegation} from '../src/family-owner-delegation.js';
import {createFamilyContextAdapter} from '../src/family-context-adapter.js';

const at=new Date('2026-10-27T19:00:00Z');
const familyId='family_owner_synthetic',origin={sessionId:'fixture-origin',cwd:'/private/synthetic-project'},binding='a'.repeat(64);
const creds={version:1,source:'flomo',connectionId:'fixture-connection',clientId:'fixture-client',accessToken:'fixture-old',refreshToken:'fixture-refresh',expiresAt:at.getTime()+60000,scope:'mcp'};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function fixture(t,{pauseRefresh=false}={}){
 let config={flomoOAuthCredentials:JSON.stringify(creds)},state,profile,revision=1,ownerRevision='b'.repeat(64),checks=0,refreshes=0,writes=0;
 const requests=[],bearers=[],entered=deferred(),release=deferred();
 const writer=createContextCredentialWriter({ctx:{fiber:{entry:{options:{id:'fixture'}}},get:()=>({describe:()=>[{ns:'fixture',revision}],mutate:async(_ns,ops,expected)=>{assert.equal(expected,revision);writes++;config={...config,[ops[0].path[0]]:ops[0].value};revision++;}})},readConfig:()=>config});
 const auth=createContextAccountAuth({source:'flomo',readConfig:()=>config,clock:()=>at.getTime(),saveCredentials:(value,conditions)=>writer('flomo',value,conditions),fetch:async url=>{assert.equal(url,'https://flomoapp.com/oauth/token');refreshes++;entered.resolve();if(pauseRefresh)await release.promise;return Response.json({access_token:'fixture-new',refresh_token:'fixture-refresh-new',token_type:'Bearer',expires_in:3600,scope:'mcp'});}});
 const fetch=async(url,init)=>{
  if(String(url).startsWith('https://www.googleapis.com/calendar/')){const q=new URL(url).searchParams;assert.equal(q.get('timeMin'),'2026-10-27T19:00:00.000Z');assert.equal(q.get('timeMax'),'2026-10-28T19:00:00.000Z');assert.equal(q.get('maxResults'),'2');requests.push('calendar:read');return Response.json({items:[{id:'cal1',summary:'Synthetic event',start:{dateTime:'2026-10-27T20:00:00Z'},end:{dateTime:'2026-10-27T21:00:00Z'}}]});}
  assert.equal(url,'https://flomoapp.com/mcp');bearers.push(init.headers.Authorization);const req=JSON.parse(init.body),rpc=result=>Response.json({jsonrpc:'2.0',id:req.id,result});requests.push('flomo:'+req.method);
  if(req.method==='initialize')return rpc({protocolVersion:'2025-03-26',capabilities:{tools:{}}});if(req.method==='notifications/initialized')return new Response(null,{status:202});
  if(req.method==='tools/list')return rpc({tools:[{name:'memo_search',inputSchema:{type:'object',properties:{keywords:{type:'string'},limit:{type:'integer'}}}}]});
  if(req.method==='tools/call'){assert.equal(req.params.name,'memo_search');assert.deepEqual(req.params.arguments,{keywords:'DeepSeek',limit:2});return rpc({structuredContent:{memos:[{id:'memo1',content:'Synthetic note'}]}});}
  throw Error('unexpected fixture network');
 };
 const mcp=createContextTransport({flomoAuth:auth,fetch,clock:()=>at});
 const calendar=createGoogleCalendarRest({getToken:async()=> 'fixture-calendar',fetch,clock:()=>at});
 const transport=createContextProvider({calendar,mcp});
 let family;
 const service=createPersonalContext({store:{get:async()=>state,put:async(_k,v)=>{state=structuredClone(v);}},readConfig:()=>config,credentialState:s=>s==='calendar'?{configured:true,key:'c'.repeat(64)}:null,readBinding:async id=>await family?.bindingOverride(id)??{kind:'bound',bindingKey:binding},transport,clock:()=>at});
 const bridge={resolveOwnerCall:async input=>input.sessionId===familyId&&input.callId==='call'?{sessionId:familyId,bindingRevision:ownerRevision}:null,isOwnerRevisionCurrent:(session,rev)=>session===familyId&&rev===ownerRevision};
 const delegation=createFamilyOwnerDelegation({store:{get:async()=>profile,put:async(_k,v)=>{profile=structuredClone(v);}},getBridge:()=>bridge,readGrantedLeases:async()=>{checks++;return service.delegationLeases();},readGrantedLeasesSync:()=>{checks++;return service.delegationLeases();},readLegacySetup:async()=>({state:'bound',sessionId:origin.sessionId,bindingKey:binding})});
 family=createFamilyContextAdapter({context:service,delegation});
 t.after(async()=>{release.resolve();await delegation.close();await service.close();await transport.close();await auth.close();});
 await service.act(origin,{action:'connect',source:'flomo',userRequested:true});await service.act(origin,{action:'connect',source:'calendar',userRequested:true});
 const execution={sessionId:familyId,callId:'call'};await delegation.pair({execution,originSessionId:origin.sessionId,userAuthorized:true});const scope=await delegation.resolve(execution);assert.ok(scope);
 requests.length=0;bearers.length=0;config={...config,flomoOAuthCredentials:JSON.stringify({...creds,expiresAt:at.getTime()-1000})};
 const query=()=>family.run(scope,async()=>{
  const owner={...origin,sessionId:familyId};
  const flomo=await family.act(owner,{action:'query',source:'flomo',operation:'search',query:'DeepSeek',limit:2,userRequested:true});
  const calendar=await family.act(owner,{action:'query',source:'calendar',operation:'upcoming',from:'2026-10-27T19:00:00Z',to:'2026-10-28T19:00:00Z',limit:2,userRequested:true});
  return{flomo,calendar};
 });
 return {query,entered,release,requests,bearers,counts:()=>({checks,refreshes,writes}),rebind:()=>{ownerRevision='d'.repeat(64);},disconnect:()=>service.act(origin,{action:'disconnect',source:'flomo',userRequested:true})};
}

test('real Family delegation and guarded OAuth refresh preserve flomo and calendar read scopes',async t=>{
 const h=await fixture(t);const before=h.counts();const result=await h.query();const after=h.counts();
 assert.equal(result.flomo.items.length,1);assert.equal(result.calendar.items.length,1);assert.equal(after.refreshes,1);assert.equal(after.writes,1);assert.ok(after.checks>before.checks+3);assert.ok(h.requests.includes('flomo:tools/list'));assert.ok(h.requests.includes('flomo:tools/call'));assert.ok(h.requests.includes('calendar:read'));assert.ok(h.bearers.length>0);assert.ok(h.bearers.every(value=>value==='Bearer fixture-new'));
});
for(const mode of ['binding','lease'])test('revoked '+mode+' during refresh blocks persistence and source call',async t=>{
 const h=await fixture(t,{pauseRefresh:true});const pending=h.query();await h.entered.promise;let disconnect;if(mode==='binding')h.rebind();else disconnect=h.disconnect();h.release.resolve();await assert.rejects(pending);if(disconnect)await disconnect;assert.equal(h.counts().writes,0);assert.ok(!h.requests.includes('flomo:tools/call'));assert.ok(!h.requests.includes('calendar:read'));
});
