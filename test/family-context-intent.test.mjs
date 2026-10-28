import test from 'node:test';
import assert from 'node:assert/strict';
import {familyScopedContextAllowed,normalizeFamilyScopedContext,parseFamilyContextSelection} from '../src/family-context-intent.js';

const now=new Date('2026-10-28T12:00:00Z');
const text='Gmail 搜索「subject:预算」最多2条，日历未来24小时最多2条，Drive 搜索「预算」最多2条，flomo 搜索「成长」最多2条，滴答清单列出清单最多2个，生成 Alpha 的项目简报。先不要设置提醒，不要建立计划。';
const queries=[{source:'gmail',operation:'search',query:'subject:预算',limit:2},{source:'calendar',operation:'upcoming',from:now.toISOString(),to:'2026-10-29T12:00:00.000Z',limit:2},{source:'drive',operation:'search',query:'预算',limit:2},{source:'flomo',operation:'search',query:'成长',limit:2},{source:'dida',operation:'projects',limit:2}];
test('a continuation can validate a stored semantic calendar range without model-created dates',()=>{
 const prior='flomo 搜索 DeepSeek 最多2条，日历未来24小时最多2条，生成 Alpha 的项目简报。不要建立计划。';
 const saved=[{source:'flomo',operation:'search',query:'DeepSeek',limit:2},{source:'calendar',operation:'upcoming',rollingWindowHours:24,limit:2}];
 assert.equal(familyScopedContextAllowed({action:'context_brief',queries:saved,userRequested:true},'继续刚才的简报',prior,now),true);
 assert.equal(familyScopedContextAllowed({action:'context_brief',queries:saved,userRequested:true},'继续刚才的简报',prior.replace('24小时','48小时'),now),false);
 assert.equal(familyScopedContextAllowed({action:'context_brief',queries:saved,userRequested:true},'继续刚才的简报，不要读日历',prior,now),false);
});

test('five explicit sources are derived without a model, credential, reader or scheduler',()=>{
  const result=parseFamilyContextSelection(text,undefined,now);
  assert.deepEqual(result.queries,queries);
  assert.equal(familyScopedContextAllowed({action:'context_brief',queries,userRequested:true},text,undefined,now),true);
});
test('the model cannot widen a literal query, count, source, identifier or calendar',()=>{
  const allowed=q=>familyScopedContextAllowed({action:'context_brief',queries:q,userRequested:true},text,undefined,now);
  assert.equal(allowed(queries.map((q,i)=>i===0?{...q,query:'in:anywhere'}:q)),false);
  assert.equal(allowed(queries.map((q,i)=>i===0?{...q,limit:3}:q)),false);
  assert.equal(allowed(queries.map((q,i)=>i===0?{...q,id:'invented'}:q)),false);
  assert.equal(allowed(queries.map((q,i)=>i===1?{...q,calendarId:'foreign'}:q)),false);
  assert.equal(allowed([...queries,{source:'docs',operation:'read',id:'invented'}]),false);
  assert.equal(allowed(queries.slice(0,4)),false);
});
test('source denial, hypothetical instructions, extra filters and a global refusal stop before reads',()=>{
  for(const changed of [text.replace('Gmail 搜索','不要在Gmail 搜索'),'如果我说'+text,text+'只看 Alice 发来的。',text+'不要读取任何个人资料。',text+'不许查邮箱。']){
    assert.equal(familyScopedContextAllowed({action:'context_brief',queries,userRequested:true},changed,undefined,now),false,changed);
  }
});
test('quoted keywords may contain source names or punctuation without granting another source',()=>{
  const s='从 Gmail 搜索「subject:flomo; Drive」最多2条';
  const q={action:'query',source:'gmail',operation:'search',query:'subject:flomo; Drive',limit:2,userRequested:true};
  assert.equal(familyScopedContextAllowed(q,s,undefined,now),true);
  assert.equal(familyScopedContextAllowed({...q,source:'drive'},s,undefined,now),false);
});
test('a current continuation reuses only the preceding authenticated scope and preserves new refusals',()=>{
  const q={action:'query',source:'flomo',operation:'search',query:'成长',limit:2,userRequested:true};
  assert.equal(familyScopedContextAllowed(q,'继续刚才的查询。','flomo 搜索「成长」最多2条',now),true);
  assert.equal(familyScopedContextAllowed(q,'继续刚才的查询，但不要读取 flomo。','flomo 搜索「成长」最多2条',now),false);
  assert.equal(familyScopedContextAllowed(q,'继续刚才的查询。',undefined,now),false);
});
test('calendar dates come from the verified relative range, not the model clock',()=>{
  const s='看看日历未来48小时最多3条';
  const raw={action:'query',source:'calendar',operation:'upcoming',from:'2000-01-01T00:00:00Z',to:'2099-01-01T00:00:00Z',limit:3,userRequested:true};
  const normalized=normalizeFamilyScopedContext(raw,s,undefined,now);
  assert.equal(normalized.from,now.toISOString());assert.equal(normalized.to,'2026-10-30T12:00:00.000Z');
  assert.equal(familyScopedContextAllowed(normalized,s,undefined,now),true);
  assert.equal(familyScopedContextAllowed(raw,s,undefined,now),false);
  assert.equal(familyScopedContextAllowed(normalizeFamilyScopedContext(raw,'日历未来8天最多3条',undefined,now),'日历未来8天最多3条',undefined,now),false);
});
test('no implicit account-wide query, resource ID or incomplete quoted term',()=>{
  for(const s of ['看看所有资料','Gmail 搜索「预算最多2条','读 Gmail 那封邮件','Drive 读取文件123','滴答查看任务abc','日历今天最多2条']){
    assert.equal(parseFamilyContextSelection(s,undefined,now),null,s);
  }
  assert.equal(familyScopedContextAllowed({action:'query',source:'dida',operation:'projects',limit:3,userRequested:true},'看看滴答清单',undefined,now),true);
});
test('actual intent and bounded arguments remain required',()=>{
  assert.equal(familyScopedContextAllowed({action:'context_brief',queries,userRequested:false},text,undefined,now),false);
  assert.equal(familyScopedContextAllowed({action:'context_brief',queries:queries.map(q=>({...q,limit:undefined})),userRequested:true},text,undefined,now),false);
  assert.equal(familyScopedContextAllowed({action:'query',source:'gmail',operation:'search',query:'预算',limit:10,userRequested:true},'Gmail搜索「预算」最多20条',undefined,now),true);
});
