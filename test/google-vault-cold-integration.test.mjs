import test from 'node:test';
import assert from 'node:assert/strict';
import {createGoogleSuiteAuth,GOOGLE_SUITE_SCOPES} from '../src/google-suite-auth.js';
import {createGoogleTokenVault} from '../src/google-token-vault.js';
import {secureGoogleAuth} from '../src/google-secure-auth.js';
import {createGoogleCalendarRest} from '../src/google-calendar-rest.js';
import {createContextCredentialWriter} from '../src/context-credential-writer.js';
import {createPersonalContext} from '../src/context-service.js';
import {createFamilyContextAdapter} from '../src/family-context-adapter.js';

test('Family cold Calendar migrates a legacy grant into the vault then refreshes through the real guards',async t=>{
 const publisher={kind:'desktop',clientId:'fixture.apps.googleusercontent.com',clientSecret:'fixture-public'};
 const record={version:1,source:'google-suite',profile:'readonly',connectionId:'fixture-connection',clientId:publisher.clientId,requestedScopes:[...GOOGLE_SUITE_SCOPES],grantedScopes:[...GOOGLE_SUITE_SCOPES],refreshToken:'fixture-refresh',authorizedAt:'2026-10-22T08:00:00Z'};
 const at=new Date('2026-10-27T19:00:00Z'),owner={sessionId:'fixture-original',cwd:'/private/synthetic-project'},binding='a'.repeat(64),scope={familySessionId:'fixture-family',originSessionId:owner.sessionId,originBindingKey:binding};
 let config={googleSuiteOAuthCredentials:JSON.stringify(record)},revision=1,state,refreshes=0,reads=0,writes=0;const keys=new Map();
 const keychain={supported:true,write:async(id,val)=>keys.set(id,val),read:async id=>keys.get(id)??null,remove:async id=>keys.delete(id)};
 const writer=createContextCredentialWriter({ctx:{fiber:{entry:{options:{id:'fixture'}}},get:()=>({describe:()=>[{ns:'fixture',revision}],mutate:async(_ns,ops,expected)=>{assert.equal(expected,revision);writes++;config={...config,[ops[0].path[0]]:ops[0].value};revision++;}})},readConfig:()=>config});
 const vault=createGoogleTokenVault({rawReadConfig:()=>config,rawWrite:writer,keychain,scope:'fixture-native-profile'}),http=async(url)=>{if(String(url).startsWith('https://oauth2.googleapis.com/')){refreshes++;return Response.json({access_token:'fixture-access',token_type:'Bearer',expires_in:3600,scope:GOOGLE_SUITE_SCOPES.join(' ')});}reads++;return Response.json({items:[]});};
 const controller=createGoogleSuiteAuth({publisher,readConfig:()=>vault.readConfig(),saveCredentials:(value,conditions)=>vault.saveCredentials('googleSuite',value,conditions),fetch:http,clock:()=>at.getTime()});
 const auth=secureGoogleAuth({controller,vault,source:'googleSuite'}),transport=createGoogleCalendarRest({getToken:settings=>auth.getToken('calendar',settings),fetch:http,clock:()=>at});
 let family;const service=createPersonalContext({store:{get:async()=>state,put:async(_k,v)=>{state=v;}},transport,readConfig:()=>vault.readConfig(),credentialState:source=>auth.credentialState(source),readBinding:async id=>await family?.bindingOverride(id)??{kind:'bound',bindingKey:binding},clock:()=>at});
 family=createFamilyContextAdapter({context:service,delegation:{current:()=>true,recheck:async()=>true}});
 t.after(async()=>{await service.close();await transport.close();await auth.close();await vault.close();});
 await service.act(owner,{action:'connect',source:'calendar',userRequested:true});assert.equal(refreshes,0);assert.equal(writes,0);
 const result=await family.run(scope,()=>family.act({...owner,sessionId:scope.familySessionId},{action:'query',source:'calendar',operation:'upcoming',from:'2026-10-27T19:00:00Z',to:'2026-10-28T19:00:00Z',limit:2,userRequested:true}));
 assert.equal(result.source,'calendar');assert.equal(result.coverage.returned,0);assert.equal(refreshes,1);assert.equal(reads,1);assert.equal(writes,1);assert.doesNotMatch(config.googleSuiteOAuthCredentials,/fixture-refresh/);
});
