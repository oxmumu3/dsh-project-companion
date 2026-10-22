import test from 'node:test';
import assert from 'node:assert/strict';
import {createContextAccountAuth} from '../src/context-account-auth.js';
import {createDidaRest} from '../src/dida-rest.js';
import {createContextProvider} from '../src/context-provider.js';
import {createPersonalContext} from '../src/context-service.js';

const fixed=new Date('2026-10-22T12:00:00Z'),owner={sessionId:'dida-owner',cwd:'/private/synthetic-dida'};
const record={version:1,source:'dida',connectionId:'connection',clientId:'client',accessToken:'read-only-synthetic',refreshToken:'',expiresAt:fixed.getTime()+3600000,scope:'tasks:read'};
function fixture(t,options={}){
 let config={didaOAuthCredentials:JSON.stringify(record),didaToken:'legacy-synthetic'},state,binding='a'.repeat(64);const calls=[],writes=[],mcpCalls=[];
 const auth=createContextAccountAuth({source:'dida',readConfig:()=>config,saveCredentials:async()=>{writes.push('unexpected-save');},fetch:async()=>{throw Error('No OAuth exchange expected');},clock:()=>fixed.getTime()});
 const dida=createDidaRest({getToken:settings=>auth.getToken(settings),fetch:async(url,init)=>{calls.push({url,method:init.method});assert.equal(init.headers.authorization,'Bearer read-only-synthetic');await options.beforeRead?.();return options.response?.()??Response.json([{id:'p1',name:'My project'}]);},clock:()=>fixed});
 const provider=createContextProvider({calendar:{catalog:async()=>{},call:async()=>{}},dida,useDidaRest:()=>true,mcp:{catalog:async()=>{mcpCalls.push('catalog');throw Error('No MCP fallback');},call:async()=>{mcpCalls.push('call');throw Error('No MCP fallback');}}});
 const service=createPersonalContext({store:{get:async()=>state,put:async(_key,value)=>state=value},transport:provider,readConfig:()=>config,readBinding:async()=>({kind:'bound',bindingKey:binding}),clock:()=>fixed});
 t.after(async()=>{await service.close();await provider.close();await auth.close();});
 return{service,calls,writes,mcpCalls,changeBinding:()=>binding='b'.repeat(64),changeAccount:()=>config={...config,didaOAuthCredentials:JSON.stringify({...record,connectionId:'other'})}};
}

test('saved read-scope OAuth enables passively then reads only explicit bounded GET through service',async t=>{
 const h=fixture(t);const connected=await h.service.act(owner,{action:'connect',source:'dida',userRequested:true});assert.match(connected.text,/尚未验证实际读取/);assert.deepEqual(h.calls,[]);
 const result=await h.service.act(owner,{action:'query',source:'dida',operation:'projects',limit:2,userRequested:true});assert.equal(result.items[0].title,'My project');assert.equal(result.accessMode,'read-only');assert.equal(result.truncated,false);assert.equal(result.text.includes('read-only-synthetic'),false);assert.deepEqual(h.calls,[{url:'https://api.dida365.com/open/v1/project?offset=0&limit=2',method:'GET'}]);assert.deepEqual(h.writes,[]);assert.deepEqual(h.mcpCalls,[]);
 await assert.rejects(h.service.act(owner,{action:'query',source:'dida',operation:'search',query:'test',userRequested:true}),e=>e.code==='CONTEXT_UNSUPPORTED_OPERATION');assert.equal(h.calls.length,1);
});

test('owner binding and OAuth account changes during REST request discard content',async t=>{
 for(const kind of ['binding','account']){
  let h;h=fixture(t,{beforeRead:async()=>kind==='binding'?h.changeBinding():h.changeAccount()});await h.service.act(owner,{action:'connect',source:'dida',userRequested:true});
  await assert.rejects(h.service.act(owner,{action:'query',source:'dida',operation:'projects',userRequested:true}));assert.equal(h.calls.length,1);assert.deepEqual(h.mcpCalls,[]);assert.deepEqual(h.writes,[]);
 }
});

test('disconnect interrupts a pending read and leaves no enabled lease or automatic reread',async t=>{
 let entered,cancelled=false;const ready=new Promise(r=>entered=r);const h=fixture(t,{response:()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('['));entered();},cancel(){cancelled=true;}}),{headers:{'content-type':'application/json'}})});
 await h.service.act(owner,{action:'connect',source:'dida',userRequested:true});const reading=h.service.act(owner,{action:'query',source:'dida',operation:'projects',userRequested:true});await ready;
 const stopped=h.service.act(owner,{action:'disconnect',source:'dida',userRequested:true});await assert.rejects(reading,e=>e.code==='CONTEXT_STOPPED');const status=await stopped;assert.equal(status.sources.find(row=>row.id==='dida').enabled,false);assert.equal(cancelled,true);assert.equal(h.calls.length,1);assert.deepEqual(h.mcpCalls,[]);assert.deepEqual(h.writes,[]);
});
