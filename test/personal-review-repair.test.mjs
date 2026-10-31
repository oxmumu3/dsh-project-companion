import test from 'node:test';
import assert from 'node:assert/strict';
import {createPersonalReviewModel} from '../src/personal-review-model.js';
const evidence=[{id:'m1',source:'gmail',title:'合成变更通知',text:'服务将调整设置，请核对是否接受，尚未给出精确截止时间。'}];
const good={items:[{key:'notice',kind:'change',title:'合成设置变更待确认',summary:'服务通知有一项设置变更。',why:'需要核对是否接受。',action:'查看服务设置。',unknown:'精确生效时间待核对。',evidenceIds:['m1'],priority:'normal',confidence:'source'}]};
const bad={items:[{...good.items[0],dueAt:'2099-01-01T00:00:00.000Z'}]};
function fixture({answers=[bad,good],usage={outputTokens:100,reasoningTokens:30},prepare,finish='stop',timeoutMs=2000,afterFirst}={}) {
 const requests=[],configs=[];let count=0;
 const ctx={get(name) {
  if(name==='agentDefaultModel')return{currentSelection:()=>({provider:'synthetic',model:'fake'})};
  if(name==='llm')return{prepareCall:async config=>{
   configs.push(config);await prepare?.(configs.length);
   return{config,stream:async function*(request){
    const index=count++;requests.push(request);
    yield{type:'text-delta',index:0,text:JSON.stringify(answers[index]??answers.at(-1))};
    if(usage)yield{type:'usage',usage};yield{type:'finish',reason:{kind:finish}};
    if(index===0)afterFirst?.();
   }};
  }};
 }};
 return{model:createPersonalReviewModel(ctx,{timeoutMs}),requests,configs};
}
test('invalid deadline receives one same-evidence repair and strict validation inside original token budget',async()=>{const f=fixture();try{const result=await f.model.summarize({evidence,kind:'daily'});assert.deepEqual(result,good);assert.equal(f.requests.length,2);assert.equal(f.requests[1].messages[0].content[0].text,f.requests[0].messages[0].content[0].text);assert.equal(f.requests[0].maxTokens,6500);assert.equal(f.requests[1].maxTokens,6370);assert.deepEqual(f.requests[1].tools,[]);assert.match(f.requests[1].system,/deadline_without_source/);assert.ok(!f.requests[1].system.includes('2099'));assert.equal(f.model.usage().requests,2);}finally{f.model.close();}});
test('two invalid candidates still fail closed and do not enter a third request',async()=>{const f=fixture({answers:[bad,bad,good]});try{await assert.rejects(f.model.summarize({evidence}),e=>e.code==='MODEL_INVALID_OUTPUT'&&e.outputRule==='deadline_without_source'&&!JSON.stringify(e).includes('2099'));assert.equal(f.requests.length,2);}finally{f.model.close();}});
test('unknown or exhausted accounting never grants a second output allowance',async()=>{for(const usage of [null,{outputTokens:6500},{outputTokens:6400,reasoningTokens:100}]){const f=fixture({usage});try{await assert.rejects(f.model.summarize({evidence}),{code:'MODEL_INVALID_OUTPUT'});assert.equal(f.requests.length,1);}finally{f.model.close();}}});
test('source authorization is checked again adjacent to repair transmission',async()=>{let allowed=true;const f=fixture({prepare:n=>{if(n===2)allowed=false;}});try{await assert.rejects(f.model.summarize({evidence,guard:async()=>{if(!allowed)throw Error('PRIVATE_CANARY');},authorizeSync:()=>allowed}),{code:'MODEL_AUTHORIZATION_CHANGED'});assert.equal(f.configs.length,2);assert.equal(f.requests.length,1);}finally{f.model.close();}});
test('cancellation after first output prevents repair',async()=>{const abort=new AbortController(),f=fixture({afterFirst:()=>abort.abort()});try{await assert.rejects(f.model.summarize({evidence,signal:abort.signal}),/MODEL_ABORTED/);assert.equal(f.requests.length,1);}finally{f.model.close();}});
test('incomplete provider output is not a validation repair opportunity',async()=>{const f=fixture({finish:'max-tokens'});try{await assert.rejects(f.model.summarize({evidence}),{code:'MODEL_TOKEN_LIMIT'});assert.equal(f.requests.length,1);}finally{f.model.close();}});
test('shared deadline interrupts a stalled repair guard and late completion cannot transmit',async()=>{
 const f=fixture({timeoutMs:25});let postFirst=0,late;
 const pending=f.model.summarize({evidence,guard:()=>{if(f.requests.length===1&&++postFirst===2)return new Promise(resolve=>late=resolve);return true;}});
 try{const observed=await Promise.race([pending.then(()=> 'resolved',e=>e.code),new Promise(resolve=>setTimeout(()=>resolve('still_pending'),150))]);assert.equal(observed,'MODEL_TIMEOUT');assert.equal(f.requests.length,1);late?.(true);await new Promise(resolve=>setImmediate(resolve));assert.equal(f.requests.length,1);}finally{f.model.close();}
});
test('an explicit false asynchronous authorization blocks the initial call',async()=>{const f=fixture();try{await assert.rejects(f.model.summarize({evidence,guard:async()=>false}),{code:'MODEL_AUTHORIZATION_CHANGED'});assert.equal(f.requests.length,0);}finally{f.model.close();}});
