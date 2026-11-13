import test from 'node:test';
import assert from 'node:assert/strict';
import {createDotSources} from '../src/dot-sources.js';
import {createDotSourceReader} from '../src/dot-source-reader.js';
import {createDidaRest} from '../src/dida-rest.js';
import {buildContextCall,projectDotBulk} from '../src/context-contracts.js';

// These cases go through the real Dida REST transport and the real source
// reader. The synthetic fetch returns actual Response objects so the HTTP
// status classification in readBody() is exercised, not a fabricated reader
// error carrying a status field.
const KEY='a'.repeat(64);
const TOKEN='synthetic-transport-token';
const NOW=new Date('2026-11-11T08:00:00.000Z');
const DAY=86400000;
const iso=ms=>new Date(ms).toISOString();
const FROM=iso(NOW.getTime()-7*DAY);
const TO=iso(NOW.getTime()+7*DAY);
const WINDOW_ROW={id:'window-1',projectId:'inbox69a85785',title:'窗口任务',dueDate:iso(NOW.getTime()+DAY),status:0};
const NAMED_ROW={id:'named-1',projectId:'work',title:'清单任务',dueDate:iso(NOW.getTime()+DAY),status:0};

function response(status,body,headers={}){return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json',...headers}});}

async function harness(){
  let mode='ok';
  const fetchImpl=async input=>{
    const path=new URL(input).pathname;
    if(mode==='denyProjects')return response(403,{error:'forbidden'});
    if(mode==='unauthorized')return response(401,{error:'invalid_token'});
    if(path==='/open/v1/project')return response(200,[{id:'work',name:'工作'},{id:'inbox',name:'收集箱'}]);
    if(path==='/open/v1/project/work/data')return response(200,{project:{id:'work',name:'工作'},tasks:[NAMED_ROW]});
    if(path==='/open/v1/task/undone'){
      if(mode==='denyWindow')return response(403,{error:'forbidden'});
      if(mode==='scope')return response(403,{error:'scope'},{'www-authenticate':'Bearer error="insufficient_scope"'});
      return response(200,[WINDOW_ROW]);
    }
    throw new Error('unexpected synthetic path '+path);
  };
  const transport=createDidaRest({getToken:()=>TOKEN,fetch:fetchImpl,clock:()=>NOW});
  const store={value:null,async get(){return this.value===null?null:structuredClone(this.value);},async put(_key,next){this.value=structuredClone(next);}};
  const sources=createDotSources({store,clock:()=>NOW});
  await sources.enable('dida',KEY);
  const authorized=()=>{const row=sources.stateOf('dida');return row?.enabled===true&&row.credentialKey===KEY;};
  const settings={authorize:async()=>authorized(),authorizeSync:authorized};
  const read=async (source,request)=>{
    const call=buildContextCall(source,request,{now:NOW,timeZone:'Asia/Shanghai'});
    const result=await transport.call(source,call.name,call.args,settings);
    return projectDotBulk(source,result.value,{operation:request.operation});
  };
  const reader=createDotSourceReader({sources,read,clock:()=>NOW,hostTimeZone:()=>'Asia/Shanghai',authorized,identity:()=>`${KEY}:0:${KEY}`});
  return {transport,reader,sources,settings,setMode:next=>{mode=next;}};
}

test('a raw 403 keeps the existing CONTEXT_HTTP_ERROR code but carries the fixed numeric status',async()=>{
  const {transport,setMode}=await harness();
  setMode('denyWindow');
  await assert.rejects(
    transport.call('dida','get_inbox_undone_window',{start_date:FROM,end_date:TO},{authorize:async()=>true,authorizeSync:()=>true}),
    error=>error.code==='CONTEXT_HTTP_ERROR'&&error.status===403,
  );
});

test('an explicit insufficient_scope challenge stays a distinct code without a fabricated status',async()=>{
  const {transport,setMode}=await harness();
  setMode('scope');
  await assert.rejects(
    transport.call('dida','get_inbox_undone_window',{start_date:FROM,end_date:TO},{authorize:async()=>true,authorizeSync:()=>true}),
    error=>error.code==='CONTEXT_INSUFFICIENT_SCOPE'&&error.status===undefined,
  );
});

test('a raw 403 on the Inbox window drops the whole source and never reuses the named list',async()=>{
  const {reader,setMode}=await harness();
  const first=await reader.refreshNow();
  assert.ok(first.promises.some(row=>row.sourceItemId==='window-1'));
  assert.ok(first.promises.some(row=>row.sourceItemId==='named-1'));

  setMode('denyWindow');
  const denied=await reader.refreshNow();
  const source=denied.sources.find(row=>row.id==='dida');
  assert.equal(source.state,'needs_authorization');
  assert.equal(source.code,'CONTEXT_INSUFFICIENT_SCOPE');
  assert.equal(denied.promises.length,0,'the named list read before the window must not survive');
});

test('a raw 403 on the project list drops the whole source through the same transport path',async()=>{
  const {reader,setMode}=await harness();
  assert.ok((await reader.refreshNow()).promises.some(row=>row.sourceItemId==='window-1'));

  setMode('denyProjects');
  const denied=await reader.refreshNow();
  const source=denied.sources.find(row=>row.id==='dida');
  assert.equal(source.state,'needs_authorization');
  assert.equal(source.code,'CONTEXT_INSUFFICIENT_SCOPE');
  assert.equal(denied.promises.length,0);
});

test('a 401 remains CONTEXT_AUTH_REQUIRED and still drops the snapshot',async()=>{
  const {reader,setMode}=await harness();
  assert.ok((await reader.refreshNow()).promises.some(row=>row.sourceItemId==='window-1'));

  setMode('unauthorized');
  const denied=await reader.refreshNow();
  const source=denied.sources.find(row=>row.id==='dida');
  assert.equal(source.state,'needs_authorization');
  assert.equal(source.code,'CONTEXT_AUTH_REQUIRED');
  assert.equal(denied.promises.length,0);
});
