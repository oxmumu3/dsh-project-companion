import test from 'node:test';
import assert from 'node:assert/strict';
import {createContextAccountAuth,contextAccountCredentialState} from '../src/context-account-auth.js';
import {createContextTransport} from '../src/context-transport.js';
import {createGoogleSuiteAuth,GOOGLE_SUITE_SCOPES} from '../src/google-suite-auth.js';
import {createGoogleCalendarRest} from '../src/google-calendar-rest.js';
import {createPersonalContext} from '../src/context-service.js';
const owner={sessionId:'fixture-owner',cwd:'/synthetic/project'},now=new Date('2026-10-27T19:00:00.000Z'),publisher={kind:'desktop',clientId:'fixture.apps.googleusercontent.com',clientSecret:'public-fixture'};
const response=()=>Response.json({error:'invalid_grant',error_description:'SYNTHETIC_PRIVATE_PROVIDER_BODY'},{status:400});
test('real flomo auth plus MCP and personal context retain only sanitized refresh error',async()=>{
 const config={flomoOAuthCredentials:JSON.stringify({version:1,source:'flomo',connectionId:'fixture',clientId:'fixture',accessToken:'old',refreshToken:'old',expiresAt:1,scope:'mcp'})};
 const credential=contextAccountCredentialState('flomo',config,now.getTime()),state={id:'profile',version:1,sources:[{source:'flomo',sessionId:owner.sessionId,bindingKey:null,credentialKey:credential.key}]};let sourceCalls=0;
 const auth=createContextAccountAuth({source:'flomo',readConfig:()=>config,saveCredentials:async()=>{throw Error('must not save');},clock:()=>now.getTime(),fetch:async()=>response()}),transport=createContextTransport({flomoAuth:auth,fetch:async()=>{sourceCalls++;throw Error('must not call source');}});
 const service=createPersonalContext({store:{get:async()=>state,put:async()=>{throw Error('must not write');}},readConfig:()=>config,readBinding:async()=>({kind:'unbound'}),transport,clock:()=>now});
 try{await assert.rejects(service.act(owner,{action:'query',source:'flomo',operation:'search',query:'DeepSeek',limit:2,userRequested:true}),e=>{assert.equal(e.code,'CONTEXT_AUTH_REQUIRED');assert.equal(e.readStage,'catalog');assert.deepEqual(e.authDiagnostic,{stage:'token_endpoint_http',statusClass:'400',oauthError:'invalid_grant'});assert.doesNotMatch(String(e)+JSON.stringify(e),/SYNTHETIC_PRIVATE/);return true;});assert.equal(sourceCalls,0);}finally{await service.close();await transport.close();await auth.close();}
});
test('real Suite auth plus Calendar REST and personal context retain only sanitized refresh error',async()=>{
 const record={version:1,source:'google-suite',profile:'readonly',connectionId:'fixture',clientId:publisher.clientId,requestedScopes:[...GOOGLE_SUITE_SCOPES],grantedScopes:[...GOOGLE_SUITE_SCOPES],refreshToken:'old',authorizedAt:'2026-10-22T08:00:00Z'},config={googleSuiteOAuthCredentials:JSON.stringify(record)};let sourceCalls=0;
 const auth=createGoogleSuiteAuth({publisher,readConfig:()=>config,saveCredentials:async()=>{throw Error('must not save');},clock:()=>now.getTime(),fetch:async()=>response()}),credential=auth.credentialState('calendar'),state={id:'profile',version:1,sources:[{source:'calendar',sessionId:owner.sessionId,bindingKey:null,credentialKey:credential.key}]};
 const transport=createGoogleCalendarRest({getToken:settings=>auth.getToken('calendar',settings),fetch:async()=>{sourceCalls++;throw Error('must not call source');},clock:()=>now}),service=createPersonalContext({store:{get:async()=>state,put:async()=>{throw Error('must not write');}},readConfig:()=>config,credentialState:source=>auth.credentialState(source),readBinding:async()=>({kind:'unbound'}),transport,clock:()=>now});
 try{await assert.rejects(service.act(owner,{action:'query',source:'calendar',operation:'upcoming',from:now.toISOString(),to:'2026-10-28T19:00:00.000Z',limit:2,userRequested:true}),e=>{assert.equal(e.code,'CONTEXT_AUTH_REQUIRED');assert.equal(e.readStage,'call');assert.deepEqual(e.authDiagnostic,{stage:'token_endpoint_http',statusClass:'400',oauthError:'invalid_grant'});assert.doesNotMatch(String(e)+JSON.stringify(e),/SYNTHETIC_PRIVATE/);return true;});assert.equal(sourceCalls,0);}finally{await service.close();await transport.close();await auth.close();}
});
