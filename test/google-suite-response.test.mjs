import test from 'node:test';
import assert from 'node:assert/strict';
import {createGoogleSuiteRest,safeGoogleReadDiagnostic} from '../src/google-suite-rest.js';
import {buildContextCall} from '../src/context-contracts.js';

const request=buildContextCall('gmail',{operation:'search',query:'synthetic',limit:1});
const gates={authorize:async()=>true,authorizeSync:()=>true};

async function rejectResponse(response,code,stage,reason,shape){
 let calls=0;
 const adapter=createGoogleSuiteRest({getToken:async()=>'synthetic',fetch:async()=>{calls++;return response;}});
 try{
  await assert.rejects(adapter.call('gmail',request.name,request.args,gates),error=>{
   assert.equal(error.code,code);
   const {responseStatus,bodyShape,headersShape,responseShape,...base}=error.readDiagnostic;
   assert.deepEqual(base,{operation:'gmail_list',stage,reason});
   if(shape)assert.deepEqual({responseStatus,bodyShape,headersShape,responseShape},shape);
   return true;
  });
  assert.equal(calls,1,'a response classification must not replay a read');
 }finally{await adapter.close();}
}

test('HTTP refusal and redirect remain identifiable when a valid Response has no body',async()=>{
 for(const status of [401,403])await rejectResponse(new Response(null,{status}),'CONTEXT_AUTH_REQUIRED','response_headers','http_status');
 for(const status of [429,500,503])await rejectResponse(new Response(null,{status}),'CONTEXT_HTTP_ERROR','response_headers','http_status');
 for(const status of [302,304])await rejectResponse(new Response(null,{status}),'CONTEXT_REDIRECT','response_headers','redirect');
});

test('a successful missing stream is a protocol failure, never an empty Gmail list',async()=>{
 for(const status of [200,204])await rejectResponse(new Response(null,{status,headers:{'content-type':'application/json'}}),'CONTEXT_PROTOCOL_INVALID','body_read','response_shape');
});

test('unsupported successful response wrappers remain fail closed without text or json fallback',async()=>{
 let fallbackCalls=0;
 for(const response of [
  {status:200,ok:true,headers:new Headers({'content-type':'application/json'}),body:{},text:async()=>{fallbackCalls++;return '{}';}},
  {status:200,ok:true,headers:new Headers({'content-type':'application/json'}),body:null,json:async()=>{fallbackCalls++;return {};}}
 ])await rejectResponse(response,'CONTEXT_PROTOCOL_INVALID','body_read','response_shape');
 assert.equal(fallbackCalls,0);
});

test('invalid status or headers fail without reading body content',async()=>{
 let bodyReads=0;
 for(const response of [{status:'200',headers:new Headers()},{status:200,headers:{}}]){
  response.body={getReader(){bodyReads++;throw Error('must not read invalid response');}};
  await rejectResponse(response,'CONTEXT_PROTOCOL_INVALID','response_headers','response_shape');
 }
 assert.equal(bodyReads,0);
});

test('failed response shapes carry only bounded structural metadata',async()=>{
 const cases=[
  [undefined,'response_headers',{responseStatus:null,responseShape:'missing',headersShape:'missing',bodyShape:'missing'}],
  ['PRIVATE_RESPONSE','response_headers',{responseStatus:null,responseShape:'other',headersShape:'missing',bodyShape:'missing'}],
  [{status:'PRIVATE_STATUS',headers:{secret:'PRIVATE_HEADER'},body:{secret:'PRIVATE_BODY'}},'response_headers',{responseStatus:null,responseShape:'object',headersShape:'other',bodyShape:'other'}],
  [new Response(null,{status:200,headers:{'content-type':'application/json'}}),'body_read',{responseStatus:200,responseShape:'object',headersShape:'get',bodyShape:'null'}],
 ];
 for(const [response,stage,shape]of cases)await rejectResponse(response,'CONTEXT_PROTOCOL_INVALID',stage,'response_shape',shape);
 await rejectResponse(new Response('PRIVATE_BODY',{status:200,headers:{'content-type':'text/html'}}),'CONTEXT_PROTOCOL_INVALID','response_headers','content_type',{responseStatus:200,responseShape:'object',headersShape:'get',bodyShape:'stream'});
});

test('diagnostic projection strips malicious values and keeps old records compatible',()=>{
 const base={operation:'gmail_list',stage:'response_headers',reason:'response_shape'};
 assert.deepEqual(safeGoogleReadDiagnostic(base),base);
 for(const responseStatus of ['PRIVATE_STATUS',600,-1,NaN,Infinity,200.5,{secret:'PRIVATE_STATUS'}]){
  const result=safeGoogleReadDiagnostic({...base,responseStatus,bodyShape:'PRIVATE_BODY',headersShape:{secret:'PRIVATE_HEADER'},responseShape:'PRIVATE_RESPONSE',url:'PRIVATE_URL',headers:'PRIVATE_HEADER',body:'PRIVATE_BODY'});
  assert.deepEqual(result,{...base,responseStatus:null,bodyShape:'other',headersShape:'other',responseShape:'other'});
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
 }
 for(const responseStatus of [0,200,401,599])assert.equal(safeGoogleReadDiagnostic({...base,responseStatus}).responseStatus,responseStatus);
});

test('successful reads expose no response diagnostics and revoked reads do not reach fetch',async()=>{
 let calls=0,bodyReads=0;
 const adapter=createGoogleSuiteRest({getToken:async()=>'synthetic',fetch:async()=>{calls++;return new Response('{}',{headers:{'content-type':'application/json'}});}});
 try{
  const value=await adapter.call('gmail',request.name,request.args,gates);assert.deepEqual(value.value,{items:[],truncated:false});assert.equal(Object.hasOwn(value,'readDiagnostic'),false);
  await assert.rejects(adapter.call('gmail',request.name,request.args,{...gates,authorizeSync:()=>false}),e=>e.code==='CONTEXT_CANCELLED');assert.equal(calls,1);
 }finally{await adapter.close();}
 const refused=createGoogleSuiteRest({getToken:async()=>'synthetic',fetch:async()=>({status:401,ok:false,headers:new Headers(),body:{getReader(){bodyReads++;throw Error('must not read');}}})});
 try{await assert.rejects(refused.call('gmail',request.name,request.args,gates),e=>e.code==='CONTEXT_AUTH_REQUIRED');assert.equal(bodyReads,0);}finally{await refused.close();}
});
