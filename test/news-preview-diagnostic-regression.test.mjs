import test from 'node:test';
import assert from 'node:assert/strict';
import {createNewsModel} from '../src/news-model.js';
import {createNewsService,newsRowSchema} from '../src/news-service.js';
const article={id:'a',title:'AI plugin engineering',sourceName:'Synthetic public RSS',publishedAt:'2026-10-30T05:00:00Z',excerpt:'Public source evidence.',url:'https://example.org/a'};
const ctx={get(name){if(name==='agentDefaultModel')return{currentSelection:()=>({provider:'p',model:'m',reasoningEffort:'max'})};if(name==='llm')return{prepareCall:async config=>({config,stream:async function*(){yield{type:'reasoning-delta',index:0,text:'PRIVATE_REASONING'};yield{type:'usage',usage:{outputTokens:1800,reasoningTokens:1800}};yield{type:'finish',reason:{kind:'max-tokens'}};}})};throw Error('unavailable');}};
const owner={sessionId:'synthetic',cwd:'/synthetic/public-news'};
function service(hooks={}){return createNewsService({store:{get:async()=>undefined,put:async()=>assert.fail('preview cannot persist')},clock:()=>new Date('2026-10-30T06:00:00Z'),readBinding:async()=>({bound:true,bindingKey:'a'.repeat(64)}),fetchCandidates:async()=>({articles:[article]}),selectArticles:async()=>['a'],readArticle:async()=>({content:'Public article body',coverage:'article'}),summarizeArticles:async()=>({items:[{id:'a',summary:'公开事实摘要',why:'与插件实践有关'}]}),send:async()=>assert.fail('preview cannot send'),...hooks});}
test('news token exhaustion retains safe model counters across service boundary',async()=>{const model=createNewsModel(ctx);const s=service({selectArticles:input=>model.selectArticles(input)});try{await assert.rejects(s.act(owner,{action:'preview'}),error=>{assert.equal(error.code,'MODEL_TOKEN_LIMIT');assert.deepEqual(error.newsDiagnostic,{stage:'selection',code:'MODEL_TOKEN_LIMIT',model:{requestedMaxTokens:1800,preparedMaxTokens:1800,reasoningEffort:'max',finish:'max-tokens',textChars:0,reasoningChars:17,outputTokens:1800,reasoningTokens:1800}});assert.doesNotMatch(JSON.stringify(error),/PRIVATE_REASONING/);return true;});}finally{model.close();await s.close();}});
test('news source and summary failures retain distinct stages without raw errors',async()=>{for(const [stage,dependency,code]of[['sources','fetchCandidates','NEWS_SOURCE_FAILED'],['summary','summarizeArticles','NEWS_SUMMARY_FAILED']]){const s=service({[dependency]:async()=>{throw Object.assign(Error('PRIVATE_TOKEN'),{code:'PRIVATE_CODE',url:'PRIVATE_URL'});}});try{await assert.rejects(s.act(owner,{action:'preview'}),e=>{assert.equal(e.code,code);assert.deepEqual(e.newsDiagnostic,{stage,code});assert.doesNotMatch(JSON.stringify(e)+e.message,/PRIVATE/);return true;});}finally{await s.close();}}});
test('news selection and summary use only declared bounded effort without altering host selection',async()=>{
 for(const [efforts,want]of[[['off','low','max'],'off'],[['low','max'],'low'],[['high','max'],'max']]){
  const selection={provider:'p',model:'m',reasoningEffort:'max'},calls=[];
  const model=createNewsModel({get(name){if(name==='agentDefaultModel')return{currentSelection:()=>selection};if(name==='llm')return{async prepareCall(config,_signal,policy){const before=structuredClone(config);const prepared=policy?policy(config,{reasoning:{efforts:efforts.map(id=>({id}))}}):config;calls.push({before,prepared});return{config:prepared,stream:async function*(request){const data=JSON.parse(request.messages[0].content[0].text);const value=data.articles[0].coverage?{items:[{id:'a',summary:'公开来源的工程实践。',why:'与插件实践相关。'}]}:{ids:['a']};yield{type:'block-end',index:0,block:{type:'text',text:JSON.stringify(value)}};yield{type:'finish',reason:{kind:'stop'}};}};}};throw Error('unknown');}});
  try{assert.deepEqual(await model.selectArticles({articles:[article]}),['a']);assert.equal((await model.summarizeArticles({articles:[{...article,content:'Public facts',coverage:'article',truncated:false}]})).items.length,1);assert.deepEqual(selection,{provider:'p',model:'m',reasoningEffort:'max'});assert.deepEqual(calls.map(x=>x.before.maxTokens),[1800,7000]);assert.ok(calls.every(x=>x.prepared.reasoningEffort===want));}finally{model.close();}
 }
});
test('a long summary gets one compression pass within the original total output budget',async()=>{
 const configs=[],data=[],responses=[{items:[{id:'a',summary:'字'.repeat(393),why:'与插件实践有关'}]},{items:[{id:'a',summary:'压缩后的公开资料摘要。',why:'与插件实践有关'}]}];
 const model=createNewsModel({get(name){if(name==='agentDefaultModel')return{currentSelection:()=>({provider:'p',model:'m'})};return{prepareCall:async config=>{configs.push(config);return{config,stream:async function*(r){data.push(r.messages[0].content[0].text);yield{type:'block-end',index:0,block:{type:'text',text:JSON.stringify(responses.shift())}};yield{type:'usage',usage:{outputTokens:700}};yield{type:'finish',reason:{kind:'stop'}};}};}};}});
 try{assert.equal((await model.summarizeArticles({articles:[{...article,content:'Public evidence only.',coverage:'article',truncated:false}]})).items[0].summary,'压缩后的公开资料摘要。');assert.deepEqual(configs.map(c=>c.maxTokens),[7000,6300]);assert.equal(data[0],data[1]);assert.doesNotMatch(data[1],/字{10}/);}finally{model.close();}
});
test('binding revocation during news generation keeps the authorization error category',async()=>{
 let bound=true;const s=service({store:{get:async()=>undefined,put:async()=>{}},readBinding:async()=>({bound,bindingKey:'a'.repeat(64)}),readArticle:async()=>{bound=false;return{content:'Public source',coverage:'article'};}});
 await s.act(owner,{action:'set_topics',topics:['AI'],userRequested:true,requestId:'topics'});
 try{await assert.rejects(s.act(owner,{action:'preview'}),e=>e.code==='NEWS_AUTHORIZATION_CHANGED');}finally{await s.close();}
});
test('compression never loops or expands an unknown or exhausted output budget',async()=>{
 for(const used of [undefined,7000,6600,1000]){
  let calls=0;const model=createNewsModel({get(name){if(name==='agentDefaultModel')return{currentSelection:()=>({provider:'p',model:'m'})};return{prepareCall:async config=>{calls++;return{config,stream:async function*(){yield{type:'block-end',index:0,block:{type:'text',text:JSON.stringify({items:[{id:'a',summary:'字'.repeat(393),why:'来源明确'}]})}};if(used!==undefined)yield{type:'usage',usage:{outputTokens:used}};yield{type:'finish',reason:{kind:'stop'}};}};}};}});
  try{await assert.rejects(model.summarizeArticles({articles:[{...article,content:'Public facts',coverage:'article',truncated:false}]}),{code:'MODEL_INVALID_OUTPUT'});assert.equal(calls,used===1000?2:1);}finally{model.close();}
 }
});
test('scheduled failure persists only safe stage and model counters and survives v2 restart',async()=>{
 let persisted,fetches=0;const model=createNewsModel(ctx);
 const store={get:async()=>structuredClone(persisted),put:async(_key,value)=>{persisted=structuredClone(value);}};
 const make=()=>service({store,fetchCandidates:async()=>{fetches++;return{articles:[article]};},selectArticles:input=>model.selectArticles(input)});
 const s=make();let reboot;
 try{
  await s.act(owner,{action:'configure',time:'06:00',timeZone:'UTC',userRequested:true,requestId:'schedule'});
  const settings=structuredClone({schedule:persisted.schedule,preferences:persisted.preferences,receipts:persisted.receipts});
  await s.tick();
  const job=persisted.jobs[0];assert.equal(job.status,'failed');assert.equal(job.diagnostic.stage,'selection');assert.equal(job.diagnostic.code,'MODEL_TOKEN_LIMIT');assert.equal(job.diagnostic.model.outputTokens,1800);assert.equal(job.diagnostic.model.textChars,0);
  assert.equal(newsRowSchema.safeParse(persisted).success,true);assert.deepEqual({schedule:persisted.schedule,preferences:persisted.preferences,receipts:persisted.receipts},settings);
  assert.doesNotMatch(JSON.stringify(persisted),/PRIVATE_REASONING/);
  reboot=make();const status=await reboot.act(owner,{action:'status'});assert.deepEqual(status.jobs[0].diagnostic,job.diagnostic);assert.doesNotMatch(JSON.stringify(status),/PRIVATE_REASONING|synthetic-public/);
  await reboot.tick();assert.equal(fetches,1,'failed occurrence must not regenerate or send after restart');
 }finally{await s.close();await reboot?.close();model.close();}
});
test('scheduled source error cannot persist arbitrary diagnostic strings',async()=>{
 let persisted;const s=service({store:{get:async()=>persisted,put:async(_key,value)=>{persisted=structuredClone(value);}},fetchCandidates:async()=>{throw Object.assign(new Error('PRIVATE_TOKEN'),{code:'PRIVATE_CODE',newsDiagnostic:{stage:'PRIVATE_STAGE',code:'PRIVATE_CODE',model:{reasoningEffort:'PRIVATE_SECRET',finish:'PRIVATE_FINISH',textChars:'PRIVATE_TEXT'}}});}});
 try{await s.act(owner,{action:'configure',time:'06:00',timeZone:'UTC',userRequested:true,requestId:'schedule'});await s.tick();assert.deepEqual(persisted.jobs[0].diagnostic,{stage:'sources',code:'NEWS_SOURCE_FAILED'});assert.doesNotMatch(JSON.stringify(persisted),/PRIVATE/);}finally{await s.close();}
});
