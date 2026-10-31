import test from 'node:test';
import assert from 'node:assert/strict';
import {createPersonalReviewCollector} from '../src/personal-review-collect.js';
import {createPersonalReviewService,personalReviewRowSchema} from '../src/personal-review.js';
import {createPersonalReviewModel} from '../src/personal-review-model.js';
const caller={sessionId:'synthetic-source-diagnostic-owner',cwd:'/synthetic/review'},binding='a'.repeat(64),grant='b'.repeat(64);
const from='2026-10-29T09:00:00.000Z',to='2026-10-30T09:00:00.000Z';
const failure={code:'CONTEXT_HTTP_ERROR',readStage:'call',operation:'recent'};
const expected={source:'flomo',...failure};
const run=(extra={})=>({caller,sources:['flomo'],projects:[],kind:'daily',from,to,guard:async()=>true,...extra});
const err=(extra={})=>Object.assign(Error('PRIVATE_CANARY_BODY_URL_TOKEN'),{code:'CONTEXT_HTTP_ERROR',readStage:'call',token:'PRIVATE_CANARY_TOKEN',...extra});
const collector=query=>createPersonalReviewCollector({query,readProject:async()=>assert.fail('must not read a project')});

test('direct model helper validates but omits source failure metadata before transmission',async()=>{
 let captured;
 const ctx={get(name){if(name==='agentDefaultModel')return{currentSelection:()=>({provider:'synthetic',model:'fake'})};if(name==='llm')return{prepareCall:async config=>({config,stream:async function*(request){captured=request;yield{type:'text-delta',index:0,text:'{"items":[]}'};yield{type:'finish',reason:{kind:'stop'}};}})};}};
 const model=createPersonalReviewModel(ctx);
 try{
  await model.summarize({evidence:[{id:'synthetic-boundary',source:'gmail',title:'Synthetic source',text:'Synthetic evidence.'}],coverage:[{source:'gmail',status:'partial',count:1,diagnostic:{code:'CONTEXT_HTTP_ERROR',readStage:'call',operation:'read'}}],kind:'daily',now:to});
  const material=JSON.parse(captured.messages[0].content[0].text);
  assert.deepEqual(material.coverage,[{source:'gmail',status:'partial',count:1}]);
  assert.doesNotMatch(JSON.stringify(material),/CONTEXT_HTTP_ERROR|readStage|diagnostic/);
 }finally{model.close();}
});

test('collector retains only first source failure closed code, read stage and operation without an extra read',async()=>{
 const calls=[];const collect=collector(async(_caller,args)=>{calls.push(args.operation);if(args.operation==='projects')return{items:[{id:'synthetic-p1',title:'one'},{id:'synthetic-p2',title:'two'}]};throw err({code:args.projectId==='synthetic-p1'?'CONTEXT_HTTP_ERROR':'CONTEXT_TIMEOUT',readStage:args.projectId==='synthetic-p1'?'call':'catalog'});});
 const value=await collect(run({sources:['dida']}));assert.deepEqual(calls,['projects','tasks','tasks']);assert.deepEqual(value.coverage[0].diagnostic,{code:'CONTEXT_HTTP_ERROR',readStage:'call',operation:'tasks'});assert.equal(value.coverage[0].status,'partial');assert.doesNotMatch(JSON.stringify(value),/PRIVATE_CANARY/);
});
test('zero matches remains ok zero rather than unavailable or a diagnostic',async()=>{
 let reads=0;const value=await collector(async()=>{reads++;return{items:[]};})(run());assert.equal(reads,1);assert.equal(value.coverage[0].status,'ok');assert.equal(value.coverage[0].count,0);assert.equal(value.coverage[0].diagnostic,undefined);
});
test('failure remains unknown with fixed metadata and no provider text',async()=>{
 let reads=0;const value=await collector(async()=>{reads++;throw err();})(run());assert.equal(reads,1);assert.equal(value.coverage[0].status,'unavailable');assert.equal(value.coverage[0].count,null);assert.deepEqual(value.coverage[0].diagnostic,failure);assert.doesNotMatch(JSON.stringify(value),/PRIVATE_CANARY/);
});
test('unknown fields and throwing diagnostic getters fail to a fixed unavailable category',async()=>{
 for(const variant of ['unknown','code-getter','stage-getter']){
  const error=variant==='unknown'?err({code:'PRIVATE_CANARY_CODE',readStage:'PRIVATE_CANARY_STAGE'}):err();
  if(variant!=='unknown')Object.defineProperty(error,variant==='code-getter'?'code':'readStage',{get(){throw Error('PRIVATE_CANARY_GETTER');}});
  const value=await collector(async()=>{throw error;})(run());assert.equal(value.coverage[0].status,'unavailable');assert.deepEqual(value.coverage[0].diagnostic,{code:'CONTEXT_UNAVAILABLE',readStage:'unknown',operation:'recent'},variant);assert.doesNotMatch(JSON.stringify(value),/PRIVATE_CANARY/);
 }
});
test('authorization failure after a provider failure still aborts collection rather than returning a diagnostic',async()=>{
 let valid=true,reads=0;const collect=collector(async()=>{reads++;valid=false;throw err();});await assert.rejects(collect(run({guard:async()=>valid})),/authorization revoked/);assert.equal(reads,1);
});
async function serviceFixture({mode='success',empty=false,allFailed=false,customCollect,outputRule}={}){
 let row,time=new Date('2026-10-30T08:00:00.000Z');const calls={query:0,model:0,send:0},modelInputs=[],sent=[];
 const collect=customCollect??collector(async(_caller,args)=>{calls.query++;if(args.source==='flomo'||allFailed)throw err();return{items:empty?[]:[{id:'synthetic-mail',title:'Synthetic work risk',text:'A service risk needs checking.',createdAt:'2026-10-30T08:55:00.000Z'}]};});
 const service=createPersonalReviewService({store:{get:async()=>structuredClone(row),put:async(_k,value)=>{row=structuredClone(value);}},clock:()=>time,readBinding:async()=>({bound:true,bindingKey:binding}),authorization:async()=>grant,collect,summarize:async input=>{calls.model++;modelInputs.push(input);if(mode==='model-failed')throw Object.assign(Error('PRIVATE_CANARY_MODEL'),{code:'MODEL_INVALID_OUTPUT',outputRule});const evidence=input.evidence.find(item=>item.source==='gmail');return{items:[{key:'synthetic-risk',kind:'risk',title:'合成服务风险',summary:'来源提示服务有变化。',why:'需要核对实际影响。',action:'查看原始通知。',unknown:'实际影响未知。',evidenceIds:[evidence.id],priority:'high',confidence:'source'}]};},send:async input=>{calls.send++;sent.push(input.text);return{status:'reported_sent'};}});
 await service.ready();await service.act(caller,{action:'configure',requestId:'synthetic-schedule',userRequested:true,sources:['flomo','gmail'],projects:[],schedule:{dailyTime:'09:00',timeZone:'UTC'}});time=new Date(to);return{service,calls,modelInputs,sent,row:()=>structuredClone(row)};
}
test('successful mixed-source job durably keeps safe source failures while model and sent text omit diagnostic codes',async()=>{
 const f=await serviceFixture();try{await f.service.tick();const row=f.row();assert.equal(row.jobs.at(-1).status,'reported_sent');assert.deepEqual(row.jobs.at(-1).sourceDiagnostics,[expected]);assert.equal(personalReviewRowSchema.safeParse(row).success,true);assert.equal(f.calls.send,1);assert.equal(f.calls.model,1);assert.doesNotMatch(JSON.stringify(f.modelInputs),/CONTEXT_HTTP_ERROR|readStage|diagnostic|PRIVATE_CANARY/);assert.doesNotMatch(f.sent.join('\n'),/CONTEXT_HTTP_ERROR|readStage|PRIVATE_CANARY/);assert.equal(row.watermarks.flomo,undefined);assert.equal(row.watermarks.gmail.daily,to);
 }finally{await f.service.close();}
});
test('quiet mixed-source success retains diagnostic without turning failed coverage into a success watermark',async()=>{
 const f=await serviceFixture({empty:true});try{await f.service.tick();const row=f.row();assert.equal(row.jobs.at(-1).status,'quiet');assert.deepEqual(row.jobs.at(-1).sourceDiagnostics,[expected]);assert.equal(f.calls.model,0);assert.equal(f.calls.send,0);assert.equal(row.watermarks.flomo,undefined);assert.equal(row.watermarks.gmail.daily,to);}finally{await f.service.close();}
});
test('diagnostic metadata alone cannot make unavailable coverage a successful or quiet review',async()=>{
 const f=await serviceFixture({allFailed:true});try{await f.service.tick();const row=f.row();assert.equal(row.jobs.at(-1).status,'unknown');assert.deepEqual(row.jobs.at(-1).sourceDiagnostics,[expected,{source:'gmail',code:'CONTEXT_HTTP_ERROR',readStage:'call',operation:'search'}]);assert.equal(f.calls.query,2);assert.equal(f.calls.model,0);assert.equal(f.calls.send,0);assert.deepEqual(row.watermarks,{});assert.equal(personalReviewRowSchema.safeParse(row).success,true);}finally{await f.service.close();}
});
test('model failure after collection preserves source diagnostics in the durable failed job',async()=>{
 const f=await serviceFixture({mode:'model-failed'});try{await f.service.tick();const job=f.row().jobs.at(-1);assert.equal(job.status,'failed');assert.deepEqual(job.sourceDiagnostics,[expected]);assert.deepEqual(job.diagnostic.sourceDiagnostics,[expected]);assert.equal(f.calls.send,0);assert.doesNotMatch(JSON.stringify(job),/PRIVATE_CANARY/);}finally{await f.service.close();}
});
test('diagnostic schema rejects malicious extra fields before model, without persisting them',async()=>{
 const f=await serviceFixture({customCollect:async()=>({evidence:[],coverage:[{source:'flomo',status:'unavailable',count:null,diagnostic:{...failure,token:'PRIVATE_CANARY'}},{source:'gmail',status:'ok',count:0}]})});try{await f.service.tick();const row=f.row();assert.equal(row.jobs.at(-1).status,'failed');assert.equal(row.jobs.at(-1).diagnostic.stage,'validation');assert.equal(f.calls.model,0);assert.equal(f.calls.send,0);assert.doesNotMatch(JSON.stringify(row),/PRIVATE_CANARY/);}finally{await f.service.close();}
});
test('durable source diagnostic schema excludes foreign source and duplicate sources',async()=>{
 const f=await serviceFixture();try{await f.service.tick();const row=f.row();row.jobs.at(-1).sourceDiagnostics=[{...expected,source:'PRIVATE_CANARY'}];assert.equal(personalReviewRowSchema.safeParse(row).success,false);row.jobs.at(-1).sourceDiagnostics=[expected,expected];assert.equal(personalReviewRowSchema.safeParse(row).success,false);}finally{await f.service.close();}
});

test('closed projection predicate survives collection but never reaches model materials',async()=>{
 const f=await serviceFixture({customCollect:collector(async(_caller,args)=>{if(args.source==='flomo')throw err({code:'CONTEXT_SCOPE_VIOLATION',readStage:'projection',scopeRule:'recent_time_missing'});return{items:[{id:'synthetic',title:'Synthetic',text:'A configuration changed.'}]};})});
 try{await f.service.tick();const row=f.row(),job=row.jobs.at(-1);assert.deepEqual(job.sourceDiagnostics,[{source:'flomo',code:'CONTEXT_SCOPE_VIOLATION',readStage:'projection',operation:'recent',scopeRule:'recent_time_missing'}]);assert.equal(personalReviewRowSchema.safeParse(row).success,true);assert.doesNotMatch(JSON.stringify(f.modelInputs),/scopeRule|recent_time_missing|CONTEXT_SCOPE_VIOLATION|PRIVATE_CANARY/);}finally{await f.service.close();}
});
test('closed model validation predicate is durable but untrusted strings are discarded',async()=>{
 for(const rule of ['json','evidence_unknown_or_duplicate','PRIVATE_CANARY_RULE']){
  const f=await serviceFixture({mode:'model-failed',outputRule:rule});try{await f.service.tick();const row=f.row(),job=row.jobs.at(-1);assert.equal(job.status,'failed');assert.equal(job.diagnostic.code,'MODEL_INVALID_OUTPUT');assert.equal(job.diagnostic.outputRule,rule==='PRIVATE_CANARY_RULE'?undefined:rule);assert.equal(personalReviewRowSchema.safeParse(row).success,true);assert.equal(f.calls.send,0);assert.doesNotMatch(JSON.stringify(job),/PRIVATE_CANARY/);}finally{await f.service.close();}
 }
});
test('unknown or wrong-stage projection rules are not copied from a provider error',async()=>{
 for(const patch of [{scopeRule:'PRIVATE_CANARY_RULE'},{scopeRule:'item_limit',readStage:'call'},{scopeRule:'item_limit',code:'CONTEXT_HTTP_ERROR'}]){
  const value=await collector(async()=>{throw err({code:'CONTEXT_SCOPE_VIOLATION',readStage:'projection',...patch});})(run());assert.equal(value.coverage[0].diagnostic.scopeRule,undefined);assert.doesNotMatch(JSON.stringify(value),/PRIVATE_CANARY/);
 }
});
