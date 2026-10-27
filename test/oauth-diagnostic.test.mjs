import test from 'node:test';
import assert from 'node:assert/strict';
import {createContextAccountAuth} from '../src/context-account-auth.js';
import {createGoogleSuiteAuth,GOOGLE_SUITE_SCOPES} from '../src/google-suite-auth.js';
import {createGoogleCalendarAuth,GOOGLE_CALENDAR_SCOPES} from '../src/google-calendar-auth.js';
const publisher={kind:'desktop',clientId:'fixture.apps.googleusercontent.com',clientSecret:'public-registration'};
const flomo={version:1,source:'flomo',connectionId:'fixture',clientId:'fixture',accessToken:'old',refreshToken:'old',expiresAt:1,scope:'mcp'};
const suite={version:1,source:'google-suite',profile:'readonly',connectionId:'fixture',clientId:publisher.clientId,requestedScopes:[...GOOGLE_SUITE_SCOPES],grantedScopes:[...GOOGLE_SUITE_SCOPES],refreshToken:'old',authorizedAt:'2026-10-22T08:00:00Z'};
test('both cold refresh paths expose only allowlisted OAuth failure metadata',async()=>{
 for(const source of ['flomo','calendar']){
  const fetch=async()=>Response.json({error:'invalid_grant',error_description:'SYNTHETIC_PRIVATE_BODY'},{status:400});
  const auth=source==='flomo'?createContextAccountAuth({source,readConfig:()=>({flomoOAuthCredentials:JSON.stringify(flomo)}),saveCredentials:async()=>{},fetch,clock:()=>10000}):createGoogleSuiteAuth({publisher,readConfig:()=>({googleSuiteOAuthCredentials:JSON.stringify(suite)}),saveCredentials:async()=>{},fetch,clock:()=>10000});
  try{const run=source==='flomo'?()=>auth.getToken({authorizeMutation:async()=>true}):()=>auth.getToken('calendar',{authorizeMutation:async()=>true});await assert.rejects(run,error=>{assert.deepEqual(error.authDiagnostic,{stage:'token_endpoint_http',statusClass:'400',oauthError:'invalid_grant'});assert.doesNotMatch(String(error)+JSON.stringify(error.authDiagnostic),/SYNTHETIC_PRIVATE_BODY/);return true;});}finally{await auth.close();}
 }
});
test('refresh network, malformed response and guard rejection use safe stage labels',async()=>{
 for(const source of ['flomo','calendar'])for(const stage of ['network','parse','guard']){
  const fetch=async()=>{if(stage==='network')throw Error('SYNTHETIC_PRIVATE');return Response.json({not_a_token:'SYNTHETIC_PRIVATE'});};
  const auth=source==='flomo'?createContextAccountAuth({source,readConfig:()=>({flomoOAuthCredentials:JSON.stringify(flomo)}),saveCredentials:async()=>{},fetch,clock:()=>10000}):createGoogleSuiteAuth({publisher,readConfig:()=>({googleSuiteOAuthCredentials:JSON.stringify(suite)}),saveCredentials:async()=>{},fetch,clock:()=>10000});
  try{const options={authorizeMutation:async()=>stage!=='guard'};const run=source==='flomo'?()=>auth.getToken(options):()=>auth.getToken('calendar',options);await assert.rejects(run,error=>{assert.equal(error.authDiagnostic?.stage,stage);assert.doesNotMatch(String(error)+JSON.stringify(error.authDiagnostic),/SYNTHETIC_PRIVATE/);return true;});}finally{await auth.close();}
 }
});

test('independent Calendar refresh keeps allowlisted OAuth error and hides response body',async()=>{
 const record={version:1,source:'calendar',profile:'primary-events',connectionId:'fixture',clientId:publisher.clientId,requestedScopes:[...GOOGLE_CALENDAR_SCOPES],grantedScopes:[...GOOGLE_CALENDAR_SCOPES],refreshToken:'old',authorizedAt:'2026-10-22T08:00:00Z'};
 const auth=createGoogleCalendarAuth({publisher,readConfig:()=>({googleCalendarOAuthCredentials:JSON.stringify(record)}),saveCredentials:async()=>{},fetch:async()=>Response.json({error:'invalid_client',error_description:'SYNTHETIC_PRIVATE'},{status:401}),clock:()=>10000});
 try{await assert.rejects(()=>auth.getToken({authorizeMutation:async()=>true}),e=>{assert.deepEqual(e.authDiagnostic,{stage:'token_endpoint_http',statusClass:'401',oauthError:'invalid_client'});assert.doesNotMatch(String(e)+JSON.stringify(e.authDiagnostic),/SYNTHETIC_PRIVATE/);return true;});}finally{await auth.close();}
});
