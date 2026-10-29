import test from 'node:test';
import assert from 'node:assert/strict';
import {buildContextCall,projectContextResult} from '../src/context-contracts.js';
import {createGoogleSuiteRest} from '../src/google-suite-rest.js';
import {createPersonalContext} from '../src/context-service.js';

const range={operation:'recent',from:'2026-10-28T12:00:00Z',to:'2026-10-29T12:00:00Z',limit:5};
test('recent Drive and flomo use an explicit bounded time window, no invented keyword',()=>{
  const drive=buildContextCall('drive',range);
  assert.equal(drive.name,'search_files');
  assert.equal(drive.args.query,"modifiedTime >= '2026-10-28T12:00:00.000Z' and modifiedTime <= '2026-10-29T12:00:00.000Z'");
  assert.equal(drive.args.pageSize,5);
  const flomo=buildContextCall('flomo',range);
  assert.equal(flomo.name,'memo_search');
  assert.deepEqual(flomo.args,{start_date:'2026-10-28T12:00:00.000Z',end_date:'2026-10-29T12:00:00.000Z',limit:5});
});
test('recent scope rejects open-ended, backward, injected and over-seven-day queries',()=>{
  for(const source of ['drive','flomo']) for(const input of [{...range,to:undefined},{...range,from:range.to},{...range,query:'secret'},{...range,from:'2026-10-01T00:00:00Z'}]) assert.throws(()=>buildContextCall(source,input));
});
test('provider deadlines and created times are preserved as evidence, not inferred',()=>{
  const result=projectContextResult('dida',{tasks:[{id:'t1',title:'Demo deadline',dueDate:'2026-10-30T12:00:00Z',createdTime:'2026-10-28T10:00:00Z'}]},{operation:'tasks'});
  assert.equal(result.items[0].dueAt,'2026-10-30T12:00:00.000Z');
  assert.equal(result.items[0].createdAt,'2026-10-28T10:00:00.000Z');
});
test('Drive recent REST accepts only generated dates and keeps pagination coverage',async()=>{
  const requests=[];const transport=createGoogleSuiteRest({getToken:async()=> 'synthetic',fetch:async url=>{requests.push(new URL(url));return Response.json({files:[{id:'f1',name:'Demo',mimeType:'text/plain',modifiedTime:'2026-10-29T10:00:00Z'}],nextPageToken:'hidden'});}});
  const c=buildContextCall('drive',range),gate={authorize:async()=>true,authorizeSync:()=>true};
  const result=await transport.call('drive',c.name,c.args,gate);
  assert.equal(requests[0].searchParams.get('q'),c.args.query+' and trashed = false');
  assert.equal(requests[0].searchParams.get('orderBy'),'modifiedTime desc');
  assert.equal(result.value.truncated,true);
  await assert.rejects(transport.call('drive',c.name,{...c.args,query:c.args.query+' or true'},gate));
  assert.equal(requests.length,1);await transport.close();
});
test('recent provider response outside consented dates fails closed before returning notes',async()=>{
 for(const source of ['flomo','drive']){
  let state;const service=createPersonalContext({store:{get:async()=>state,put:async(_k,v)=>{state=v;}},readConfig:()=>({}),credentialState:()=>({configured:true,key:'a'.repeat(64)}),readBinding:async()=>({kind:'unbound'}),transport:{catalog:async()=>({tools:[{name:source==='flomo'?'memo_search':'search_files',inputSchema:{type:'object'}}]}),call:async()=>({value:source==='flomo'?{memos:[{id:'m1',content:'outside range',created_at:'2020-01-01T00:00:00Z'}]}:{files:[{id:'f1',name:'outside range',modifiedTime:'2020-01-01T00:00:00Z'}]}})}});
  const owner={sessionId:'synthetic',cwd:'/synthetic'};
  await service.act(owner,{action:'connect',source,userRequested:true});
  await assert.rejects(service.act(owner,{...range,action:'query',source,userRequested:true}),e=>e.code==='CONTEXT_SCOPE_VIOLATION');await service.close();
 }
});
test('Gmail received date survives projection for factual invitation timing',()=>{
 const r=projectContextResult('gmail',{id:'m1',payload:{headers:[{name:'Date',value:'Thu, 29 Oct 2026 10:00:00 +0000'}]},snippet:'A demo invitation'},{operation:'read'});
 assert.equal(r.items[0].createdAt,'2026-10-29T10:00:00.000Z');
});
