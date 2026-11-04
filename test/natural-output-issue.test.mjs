import test from 'node:test';
import assert from 'node:assert/strict';
import {createPersonalReviewModel} from '../src/personal-review-model.js';
import {createPersonalReviewService,personalReviewRowSchema} from '../src/personal-review.js';
import {personalReviewFailure,personalReviewDiagnosticSchema} from '../src/personal-review-diagnostics.js';
import {createNewsModel} from '../src/news-model.js';
import {createNewsService,newsRowSchema} from '../src/news-service.js';

const evidence={id:'e1',source:'gmail',title:'Synthetic evidence',text:'A synthetic fact needs review.'};
const candidate={key:'k1',kind:'risk',title:'合成事项',summary:'合成来源有一项变更。',why:'需要核对。',action:'核对原来源。',unknown:'',evidenceIds:['e1'],priority:'normal',confidence:'source'};
const article={id:'a1',title:'AI engineering method',sourceName:'Synthetic public source',publishedAt:'2026-11-02T13:00:00Z',excerpt:'A public method.',url:'https://example.test/article',content:'Public synthetic article.',coverage:'article',truncated:false};
const summary={id:'a1',tier:'deep',kind:'substantive',summary:'公开来源说明一个工程方法。',why:'可核对其适用条件。'};
function context(outputs,{usage=1000}={}){
 const calls=[];let index=0;
 return {calls,get(name){
  if(name==='agentDefaultModel')return{currentSelection:()=>({provider:'synthetic',model:'synthetic',reasoningEffort:'off'})};
  if(name!=='llm')throw Error('Unexpected dependency');
  return{async prepareCall(config){calls.push(config);const output=outputs[Math.min(index++,outputs.length-1)];return{config,stream:async function*(){yield{type:'block-end',index:0,block:{type:'text',text:typeof output==='string'?output:JSON.stringify(output)}};if(usage!==undefined)yield{type:'usage',usage:{outputTokens:usage}};yield{type:'finish',reason:{kind:'stop'}};}};}};
 }};
}

test('review retains a closed field and rule after the existing single correction fails',async()=>{
 const ctx=context([{items:[{...candidate,priority:'PRIVATE_CANARY'}]}]);const m=createPersonalReviewModel(ctx);
 try{
  await assert.rejects(m.summarize({evidence:[evidence]}),error=>{
   assert.equal(error.code,'MODEL_INVALID_OUTPUT');assert.equal(error.outputRule,'schema');
   assert.deepEqual(error.outputIssue,{field:'priority',rule:'enum'});
   const failure=personalReviewFailure(error,{stage:'model'});
   assert.deepEqual(personalReviewDiagnosticSchema.parse(failure.reviewDiagnostic).outputIssue,error.outputIssue);
   assert.doesNotMatch(JSON.stringify(failure),/PRIVATE_CANARY/);return true;
  });
  assert.deepEqual(ctx.calls.map(c=>c.maxTokens),[6500,5500]);
 }finally{m.close();}
});

test('review never emits a dynamic extra key or its value in output issue metadata',async()=>{
 const ctx=context([{items:[{...candidate,PRIVATE_CANARY:'PRIVATE_VALUE'}]}]);const m=createPersonalReviewModel(ctx);
 try{await assert.rejects(m.summarize({evidence:[evidence]}),error=>{
  assert.deepEqual(error.outputIssue,{field:'item',rule:'extra_field'});
  assert.doesNotMatch(JSON.stringify(error),/PRIVATE_CANARY|PRIVATE_VALUE/);return true;
 });}finally{m.close();}
});

test('news preserves the exact failed predicate without creating a new correction request',async()=>{
 const ctx=context([{items:[{...summary,why:'PRIVATE_CANARY'}]}]);const m=createNewsModel(ctx);
 try{await assert.rejects(m.summarizeArticles({articles:[article]}),error=>{
  assert.equal(error.code,'MODEL_INVALID_OUTPUT');assert.deepEqual(error.outputIssue,{field:'why',rule:'language'});
  assert.doesNotMatch(JSON.stringify(error),/PRIVATE_CANARY/);return true;
 });assert.deepEqual(ctx.calls.map(c=>c.maxTokens),[7000]);}finally{m.close();}
});

test('scheduled news persists a closed output issue and does not replay after restart',async()=>{
 let persisted,fetches=0,sends=0;const ctx=context([{items:[{...summary,id:'PRIVATE_CANARY'}]}]);const m=createNewsModel(ctx);
 const make=()=>createNewsService({store:{get:async()=>structuredClone(persisted),put:async(_key,value)=>{persisted=structuredClone(value);}},clock:()=>new Date('2026-11-02T15:10:00Z'),readBinding:async()=>({bound:true,bindingKey:'a'.repeat(64)}),fetchCandidates:async()=>{fetches++;return{articles:[article]};},selectArticles:async()=>['a1'],readArticle:async()=>({content:article.content,coverage:'article'}),summarizeArticles:input=>m.summarizeArticles(input),send:async()=>{sends++;assert.fail('Invalid summary cannot send');}});
 const owner={sessionId:'synthetic-owner',cwd:'/synthetic/project'};const s=make();let reboot;
 try{
  await s.act(owner,{action:'configure',time:'15:10',timeZone:'UTC',userRequested:true,requestId:'synthetic-configure'});const settings=structuredClone({schedule:persisted.schedule,preferences:persisted.preferences,receipts:persisted.receipts});
  await s.tick();assert.equal(persisted.jobs[0].status,'failed');
  assert.deepEqual(persisted.jobs[0].diagnostic.outputIssue,{field:'id',rule:'identity'});
  assert.equal(newsRowSchema.safeParse(persisted).success,true);assert.doesNotMatch(JSON.stringify(persisted),/PRIVATE_CANARY/);
  assert.deepEqual({schedule:persisted.schedule,preferences:persisted.preferences,receipts:persisted.receipts},settings);
  reboot=make();assert.deepEqual((await reboot.act(owner,{action:'status'})).jobs[0].diagnostic.outputIssue,{field:'id',rule:'identity'});await reboot.tick();assert.equal(fetches,1);assert.equal(sends,0);
 }finally{await s.close();await reboot?.close();m.close();}
});

test('forged or unknown issue metadata is discarded at the review boundary',()=>{
 for(const outputIssue of [{field:'PRIVATE_FIELD',rule:'enum'},{field:'title',rule:'PRIVATE_RULE'},null,'PRIVATE_CANARY']){
  const error=Object.assign(Error('PRIVATE_CANARY'),{code:'MODEL_INVALID_OUTPUT',outputIssue});const d=personalReviewFailure(error,{stage:'model'}).reviewDiagnostic;
  assert.equal(d.outputIssue,undefined);assert.doesNotMatch(JSON.stringify(d),/PRIVATE/);
 }
});

test('news predicate categories cover schema, identity, source metadata and prose without exposing values',async()=>{
 const cases=[
  ['PRIVATE_JSON',{field:'root',rule:'json'}],
  [{items:[]},{field:'items',rule:'count'}],
  [{items:[null]},{field:'item',rule:'type'}],
  [{items:[{...summary,PRIVATE_KEY:'PRIVATE_VALUE'}]},{field:'item',rule:'extra_field'}],
  [{items:[{...summary,tier:'PRIVATE_ENUM'}]},{field:'tier',rule:'enum'}],
  [{items:[{...summary,kind:'PRIVATE_ENUM'}]},{field:'kind',rule:'enum'}],
  [{items:[{...summary,coverage:'feed-only'}]},{field:'coverage',rule:'source_metadata'}],
  [{items:[{...summary,title:null}]},{field:'title',rule:'type'}],
  [{items:[{...summary,summary:'  '}]},{field:'summary',rule:'empty'}],
  [{items:[{...summary,summary:'合成\u0001'}]},{field:'summary',rule:'content'}],
  [{items:[{...summary,summary:'公开资料 https://example.test/PRIVATE_CANARY'}]},{field:'summary',rule:'link'}],
  [{items:[{...summary,why:'字'.repeat(91)}]},{field:'why',rule:'length'}],
 ];
 for(const [output,issue]of cases){
  const ctx=context([output]);const m=createNewsModel(ctx);let persisted;
  const service=createNewsService({store:{get:async()=>persisted,put:async(_key,value)=>{persisted=structuredClone(value);}},clock:()=>new Date('2026-11-02T15:10:00Z'),readBinding:async()=>({bound:true,bindingKey:'a'.repeat(64)}),fetchCandidates:async()=>({articles:[article]}),selectArticles:async()=>['a1'],readArticle:async()=>({content:article.content,coverage:'article'}),summarizeArticles:input=>m.summarizeArticles(input),send:async()=>assert.fail('Invalid output cannot send')});
  try{
   await service.act({sessionId:'synthetic',cwd:'/synthetic'},{action:'configure',time:'15:10',timeZone:'UTC',userRequested:true,requestId:'configure'});await service.tick();
   assert.deepEqual(persisted.jobs[0].diagnostic.outputIssue,issue);assert.equal(newsRowSchema.safeParse(persisted).success,true);assert.doesNotMatch(JSON.stringify(persisted),/PRIVATE/);assert.ok(ctx.calls.length<=2);
  }finally{await service.close();m.close();}
 }
});

test('scheduled review retains issue after storage and restart without repeating its failed occurrence',async()=>{
 let persisted,reads=0,sends=0;const ctx=context([{items:[{...candidate,priority:'PRIVATE_CANARY'}]}]);const m=createPersonalReviewModel(ctx),owner={sessionId:'synthetic',cwd:'/synthetic'};
 const make=()=>createPersonalReviewService({store:{get:async()=>structuredClone(persisted),put:async(_key,value)=>{persisted=structuredClone(value);}},clock:()=>new Date('2026-11-02T15:00:00Z'),readBinding:async()=>({bound:true,bindingKey:'a'.repeat(64)}),authorization:async()=> 'b'.repeat(64),canRun:async()=>true,collect:async()=>{reads++;return{evidence:[evidence],coverage:[{source:'gmail',status:'ok',count:1}]};},summarize:input=>m.summarize(input),send:async()=>{sends++;assert.fail('Invalid review cannot send');}});
 const s=make();let reboot;
 try{
  await s.act(owner,{action:'configure',sources:['gmail'],projects:[],schedule:{dailyTime:'15:00',timeZone:'UTC'},userRequested:true,requestId:'configure'});const settings=structuredClone({scope:persisted.scope,subscription:persisted.subscription,receipts:persisted.receipts});
  await s.tick();assert.equal(persisted.jobs[0].status,'failed');assert.deepEqual(persisted.jobs[0].diagnostic.outputIssue,{field:'priority',rule:'enum'});assert.equal(personalReviewRowSchema.safeParse(persisted).success,true);assert.doesNotMatch(JSON.stringify(persisted),/PRIVATE_CANARY/);
  assert.deepEqual({scope:persisted.scope,subscription:persisted.subscription,receipts:persisted.receipts},settings);
  reboot=make();assert.deepEqual((await reboot.snapshot(owner)).jobs[0].diagnostic.outputIssue,{field:'priority',rule:'enum'});await reboot.tick();assert.equal(reads,1);assert.equal(sends,0);
 }finally{await s.close();await reboot?.close();m.close();}
});
