import test from 'node:test';
import assert from 'node:assert/strict';
import * as rest from '../src/google-suite-rest.js';
import {buildContextCall} from '../src/context-contracts.js';
import {createPersonalContext} from '../src/context-service.js';

const gates={authorize:async()=>true,authorizeSync:()=>true};
const args=buildContextCall('gmail',{operation:'search',query:'subject:DeepSeek',limit:1});
const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json; charset=UTF-8'}});
const invoke=t=>t.call('gmail',args.name,args.args,gates);
const make=fetch=>rest.createGoogleSuiteRest({getToken:async()=>'synthetic',fetch});

test('Google REST distinguishes safe Gmail protocol stages without retaining provider data',async()=>{
 const cases=[
  ['response_headers','content_type',()=>new Response('SYNTHETIC_PRIVATE',{headers:{'content-type':'text/html'}})],
  ['json_parse','json_invalid',()=>new Response('SYNTHETIC_PRIVATE',{headers:{'content-type':'application/json'}})],
  ['utf8_decode','utf8_invalid',()=>new Response(new Uint8Array([0xc3,0x28]),{headers:{'content-type':'application/json'}})],
  ['list_shape','list_invalid',()=>json({messages:'SYNTHETIC_PRIVATE'})],
 ];
 for(const[stage,reason,response]of cases){let calls=0;const t=make(async()=>{calls++;return response();});try{await assert.rejects(invoke(t),error=>{assert.equal(error.code,'CONTEXT_PROTOCOL_INVALID');assert.deepEqual(error.readDiagnostic,{operation:'gmail_list',stage,reason});assert.doesNotMatch(JSON.stringify(error),/SYNTHETIC_PRIVATE|subject:DeepSeek|googleapis/);return true;});assert.equal(calls,1);}finally{await t.close();}}
});

test('Gmail metadata validation identifies the second request without exposing the id',async()=>{
 let calls=0;const t=make(async()=>json(++calls===1?{messages:[{id:'synthetic_private_id'}]}:{id:'different_private_id'}));
 try{await assert.rejects(invoke(t),error=>{assert.equal(error.code,'CONTEXT_PROTOCOL_INVALID');assert.deepEqual(error.readDiagnostic,{operation:'gmail_metadata',stage:'message_shape',reason:'message_invalid'});assert.doesNotMatch(JSON.stringify(error),/private_id/);return true;});assert.equal(calls,2);}finally{await t.close();}
});

test('confirmed response-stream network errors are HTTP failures and are never replayed',async()=>{
 for(const failure of [Object.assign(new Error('SYNTHETIC_PRIVATE'),{code:'ECONNRESET'}),new TypeError('SYNTHETIC_PRIVATE',{cause:Object.assign(new Error('SYNTHETIC_PRIVATE'),{code:'UND_ERR_SOCKET'})})]){
  let calls=0;const t=make(async()=>{calls++;return new Response(new ReadableStream({start(c){c.error(failure);}}),{headers:{'content-type':'application/json'}});});
  try{await assert.rejects(invoke(t),error=>{assert.equal(error.code,'CONTEXT_HTTP_ERROR');assert.deepEqual(error.readDiagnostic,{operation:'gmail_list',stage:'body_read',reason:'stream_failed'});assert.doesNotMatch(JSON.stringify(error),/SYNTHETIC_PRIVATE|ECONNRESET|UND_ERR_SOCKET/);return true;});assert.equal(calls,1);}finally{await t.close();}
 }
});

test('unknown response-stream errors remain protocol failures with a bounded stage',async()=>{
 const t=make(async()=>new Response(new ReadableStream({start(c){c.error(new Error('SYNTHETIC_PRIVATE'));}}),{headers:{'content-type':'application/json'}}));
 try{await assert.rejects(invoke(t),error=>{assert.equal(error.code,'CONTEXT_PROTOCOL_INVALID');assert.deepEqual(error.readDiagnostic,{operation:'gmail_list',stage:'body_read',reason:'stream_failed'});return true;});}finally{await t.close();}
});

test('Google REST retains allowlisted token diagnostics but never arbitrary OAuth fields',async()=>{
 let calls=0;const t=rest.createGoogleSuiteRest({getToken:async()=>{throw Object.assign(new Error('SYNTHETIC_PRIVATE'),{code:'CONTEXT_AUTH_REQUIRED',authDiagnostic:{stage:'token_endpoint_http',statusClass:'400',oauthError:'invalid_grant',error_description:'SYNTHETIC_PRIVATE',token:'SYNTHETIC_PRIVATE'}});},fetch:async()=>{calls++;return json({});}});
 try{await assert.rejects(invoke(t),error=>{assert.equal(error.code,'CONTEXT_AUTH_REQUIRED');assert.deepEqual(error.authDiagnostic,{stage:'token_endpoint_http',statusClass:'400',oauthError:'invalid_grant'});assert.deepEqual(error.readDiagnostic,{operation:'gmail_list',stage:'token',reason:'auth_failed'});assert.doesNotMatch(JSON.stringify(error),/SYNTHETIC_PRIVATE/);return true;});assert.equal(calls,0);}finally{await t.close();}
});

test('read diagnostic sanitizer accepts only three fixed enum values',()=>{
 assert.equal(typeof rest.safeGoogleReadDiagnostic,'function');
 assert.deepEqual(rest.safeGoogleReadDiagnostic({operation:'gmail_list',stage:'body_read',reason:'stream_failed',url:'SYNTHETIC_PRIVATE',body:'SYNTHETIC_PRIVATE'}),{operation:'gmail_list',stage:'body_read',reason:'stream_failed'});
 assert.deepEqual(rest.safeGoogleReadDiagnostic({operation:'SYNTHETIC_PRIVATE',stage:'SYNTHETIC_PRIVATE',reason:'SYNTHETIC_PRIVATE'}),{operation:'unknown',stage:'unknown',reason:'unknown'});
 assert.equal(rest.safeGoogleReadDiagnostic(null),undefined);
});

test('context service carries only sanitized provider read diagnostics through both error boundaries',async()=>{
 const owner={sessionId:'synthetic-owner',cwd:'/synthetic/project'};let state;
 const s=createPersonalContext({store:{get:async()=>state,put:async(_key,value)=>{state=value;}},readConfig:()=>({flomoToken:'synthetic'}),readBinding:async()=>({kind:'unbound'}),transport:{catalog:async()=>({tools:[{name:'memo_search',inputSchema:{type:'object'}}]}),call:async()=>{throw Object.assign(new Error('SYNTHETIC_PRIVATE'),{code:'CONTEXT_PROTOCOL_INVALID',readDiagnostic:{operation:'gmail_metadata',stage:'message_shape',reason:'message_invalid',id:'SYNTHETIC_PRIVATE',url:'SYNTHETIC_PRIVATE'}});}}});
 try{await s.act(owner,{action:'connect',source:'flomo',userRequested:true});await assert.rejects(s.act(owner,{action:'query',source:'flomo',operation:'search',query:'DeepSeek',limit:1,userRequested:true}),error=>{assert.equal(error.readStage,'call');assert.deepEqual(error.readDiagnostic,{operation:'gmail_metadata',stage:'message_shape',reason:'message_invalid'});assert.doesNotMatch(JSON.stringify(error),/SYNTHETIC_PRIVATE/);return true;});}finally{await s.close();}
});

test('Drive text export diagnostics identify content rather than the successful metadata request',async()=>{
 let calls=0;const t=make(async()=>++calls===1?json({id:'synthetic',name:'Synthetic',mimeType:'application/vnd.google-apps.document'}):new Response('SYNTHETIC_PRIVATE',{headers:{'content-type':'application/json'}}));
 const request=buildContextCall('drive',{operation:'read',id:'synthetic'});
 try{await assert.rejects(t.call('drive',request.name,request.args,gates),error=>{assert.deepEqual(error.readDiagnostic,{operation:'drive_content',stage:'response_headers',reason:'content_type'});return true;});assert.equal(calls,2);}finally{await t.close();}
});

test('optional Gmail fields remain accepted under diagnostic instrumentation',async()=>{
 for(const [list,metadata]of [[{},null],[{messages:[]},null],[{messages:[{id:'synthetic'}]},{id:'synthetic'}],[{messages:[{id:'synthetic'}]},{id:'synthetic',payload:{headers:[{name:'subject',value:'Synthetic subject'}]}}]]){
  let calls=0;const t=make(async()=>json(calls++?metadata:list));
  try{const result=await invoke(t);assert.equal(result.value.items.length,list.messages?.length??0);assert.equal(calls,list.messages?.length?2:1);}finally{await t.close();}
 }
});
