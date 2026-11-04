import test from 'node:test';
import assert from 'node:assert/strict';
import {Context} from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime,{defineTool} from '@deepseek-ai/dsh-tools';

const api=async()=>{const m=await import('../src/host-tool-call.js').catch(()=>({}));assert.equal(typeof m.executeHostTool,'function');return m.executeHostTool;};

test('legacy Host keeps the original single invocation and never retries rejection',async()=>{
 const execute=await api(),controller=new AbortController(),agent={id:'synthetic-owner'},input={callId:'synthetic-call',name:'synthetic_tool',arguments:{text:'synthetic'},agent,signal:controller.signal};
 let count=0;const result={value:{ok:true},isError:false};
 assert.equal(await execute({execute:async request=>{count++;assert.equal(request,input);return result;}},input),result);
 assert.equal(count,1);
 await assert.rejects(execute({execute:async()=>{count++;throw Error('synthetic rejection');}},input),/synthetic rejection/);
 assert.equal(count,2);
});

test('new Host uses exactly one call with original authority and requires an unambiguous matching settlement',async()=>{
 const execute=await api(),controller=new AbortController(),agent={id:'synthetic-owner'},input={callId:'synthetic-call',name:'synthetic_tool',arguments:{text:'synthetic'},agent,signal:controller.signal};
 let calls=0;const result={value:{ok:true},isError:false};
 const tools={selectExecutor(){throw Error('adapter must not select or replace an executor');},async execute(request){calls++;assert.deepEqual(request.calls,[{id:input.callId,name:input.name,arguments:JSON.stringify(input.arguments)}]);assert.equal(request.agent,agent);assert.equal(request.signal,controller.signal);return{results:[{callId:input.callId,result}],additionalContexts:[],concluded:false};}};
 assert.equal(await execute(tools,input),result);assert.equal(calls,1);
 for(const rows of [[],[{callId:'other',result}],[{callId:input.callId,result},{callId:input.callId,result}]]){
  await assert.rejects(execute({...tools,execute:async()=>{calls++;return{results:rows};}},input),/settlement/);
 }
 assert.equal(calls,4,'ambiguous settlement is never resubmitted');
});

test('exact official Host dispatcher preserves tool guards, cancellation, and one synthetic execution',async()=>{
 const execute=await api(),ctx=new Context();let bodies=0;
 await ctx.plugin(SystemPrompt,{});
 const newSdk=typeof ToolRuntime.prototype?.selectExecutor==='function';
 await ctx.plugin(ToolRuntime,newSdk?{}:{mode:'native'});
 if(typeof ctx.tools.selectExecutor==='function')await ctx.plugin(await import('@deepseek-ai/dsh-tool-executor-native'));
 const agent={id:'synthetic-owner',session:{id:'synthetic-owner'},ctx};
 ctx.tools.register(defineTool({name:'synthetic_tool',description:'Synthetic in-memory test only',parameters:{text:{type:'string',required:true}},output:{schema:{type:'object',additionalProperties:true},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},execute:(args,execution)=>{bodies++;assert.equal(execution.agent,agent);return{ok:true,text:args.text};}}));
 const controller=new AbortController();
 try{
  const result=await execute(ctx.tools,{callId:'synthetic-success',name:'synthetic_tool',arguments:{text:'test'},agent,signal:controller.signal});assert.equal(result.isError,false);assert.equal(result.value.text,'test');assert.equal(bodies,1);
  const release=ctx.tools.guard(()=>({reason:'synthetic guard denial'}));
  try{const denied=await execute(ctx.tools,{callId:'synthetic-denied',name:'synthetic_tool',arguments:{text:'test'},agent,signal:controller.signal});assert.equal(denied.isError,true);assert.equal(bodies,1);}finally{release();}
  controller.abort();
  try{const cancelled=await execute(ctx.tools,{callId:'synthetic-cancelled',name:'synthetic_tool',arguments:{text:'test'},agent,signal:controller.signal});assert.equal(cancelled.isError,true);}catch(error){assert.ok(error);}
  assert.equal(bodies,1);
 }finally{await ctx.fiber.dispose();}
});
