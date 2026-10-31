import test from 'node:test';
import assert from 'node:assert/strict';
import {createNewsModel} from '../src/news-model.js';
import {createNewsService} from '../src/news-service.js';
import {renderNewsDigest} from '../src/news-render.js';
const now=new Date('2026-10-30T07:00:00Z');
const article=(id,host='one.example.org')=>({id,title:`AI ${id}`,url:`https://${host}/${id}`,sourceName:host,publishedAt:'2026-10-30T06:00:00Z',excerpt:'A public AI engineering practice with an explicit evaluation and a known limitation.',content:'A public engineering method. '.repeat(30),coverage:'article',truncated:false});
const summary=(id,extra={})=>({id,tier:'deep',kind:'substantive',summary:'作者比较模型调用的两种实现，报告具体结果及局限。',why:'插件工程可复用文中的超时与重复调用对照方法。',...extra});
function modelWith(output){return createNewsModel({get(name){if(name==='agentDefaultModel')return{currentSelection:()=>({provider:'fixture',model:'fixture'})};if(name==='llm')return{prepareCall:async config=>({config,stream:async function*(){yield{type:'block-end',index:0,block:{type:'text',text:JSON.stringify(output)}};yield{type:'finish',reason:{kind:'stop'}};}})};throw Error('Unexpected dependency');}},{clock:()=>now});}
async function preview(items,summaries){let reads=0,writes=0,sends=0;const s=createNewsService({store:{get:async()=>undefined,put:async()=>{writes++;assert.fail('preview writes');}},clock:()=>now,readBinding:async()=>({bound:true,bindingKey:'a'.repeat(64)}),fetchCandidates:async()=>({articles:items}),selectArticles:async()=>items.map(a=>a.id),readArticle:async a=>{reads++;return items.find(item=>item.id===a.id);},summarizeArticles:async()=>({items:summaries}),send:async()=>{sends++;assert.fail('preview sends');}});try{return{output:await s.act({sessionId:'fixture',cwd:'/synthetic/news'},{action:'preview',topics:['插件生态']}),reads,writes,sends};}finally{await s.close();}}
test('a three-item digest is not automatically three deep reads: a quotation stays a brief',async()=>{
 const a=[article('method'),article('release'),article('joke')];
 const {output,reads,writes,sends}=await preview(a,[summary('method'),summary('release'),summary('joke',{tier:'deep',kind:'commentary',summary:'作者用一句玩笑评论 MCP，并未提供新的实现方法。',why:'材料仅为个人评论，不能据此提出工程结论。'})]);
 assert.equal(output.deepCount,2);assert.equal(output.briefCount,1);assert.equal(output.items.find(a=>a.id==='joke').tier,'brief');assert.match(output.text,/2 篇重点 · 1 篇速览/);assert.equal(reads,3);assert.equal(writes,0);assert.equal(sends,0);
});
test('deep reading has at most two canonical hosts while other qualified same-host stories remain briefs',()=>{
 const rows=[article('a','same.example.org'),article('b','www.same.example.org'),article('c','same.example.org'),article('d','other.example.org')].map(a=>({...a,...summary(a.id)}));
 const out=renderNewsDigest({items:rows,generatedAt:now.toISOString()});
 assert.deepEqual(out.items.filter(a=>a.tier==='deep').map(a=>a.id),['a','b','d']);assert.equal(out.items.find(a=>a.id==='c').tier,'brief');assert.equal(out.deepCount,3);assert.equal(out.briefCount,1);for(const row of rows)assert.ok(out.text.includes(row.url));
});
test('insufficient and omitted material cannot become filler, and legacy ungraded summaries stay briefs',async()=>{
 const rows=[article('a'),article('b'),article('c')];rows[0].coverage='feed-only';
 const {output}=await preview(rows,[summary('a'),summary('b',{tier:'omit',kind:'insufficient',summary:'材料只有标题，没有可核实的信息。'}),{id:'c',summary:'旧格式没有提供质量分档。',why:'仅作线索。'}]);
 assert.equal(output.deepCount,0);assert.equal(output.briefCount,2);assert.deepEqual(output.items.map(a=>a.id),['a','c']);assert.doesNotMatch(output.text,/https:\/\/one.example.org\/b/);assert.match(output.text,/0 篇重点/);
});
test('the production model accepts bounded explicit editorial tiers and refuses missing or invented classification',async()=>{
 const a=[article('a'),article('b')],items=[summary('a'),summary('b',{tier:'brief',kind:'commentary',summary:'一条评论，材料不足以写成详读。'})];
 const m=modelWith({items});try{assert.deepEqual(await m.summarizeArticles({articles:a}),{items});}finally{m.close();}
 for(const changes of [{tier:'urgent'},{kind:'official_verified'},{tier:undefined},{kind:undefined}]){const m=modelWith({items:[{...summary('a'),...changes}]});try{await assert.rejects(m.summarizeArticles({articles:[a[0]]}),{code:'MODEL_INVALID_OUTPUT'});}finally{m.close();}}
});
test('preview copy distinguishes its current conversation reply from additional delivery and unchanged schedules',()=>{
 const out=renderNewsDigest({items:[{...article('a'),...summary('a')}],generatedAt:now.toISOString(),preview:true});
 assert.match(out.text,/本次预览通过当前对话回复；未另行推送、未更改计划/);assert.doesNotMatch(out.text,/未发送|没有发送/);
 const sent=renderNewsDigest({items:[{...article('a'),...summary('a')}],generatedAt:now.toISOString(),preview:false});assert.doesNotMatch(sent.text,/本次预览|未另行推送/);
});

test('a brief may omit why when the digest already has a concrete deep-reading implication',async()=>{
 const items=[summary('a'),{id:'b',tier:'brief',kind:'substantive',summary:'一项有限的新能力更新；仅作线索。'}];
 const m=modelWith({items});try{assert.deepEqual(await m.summarizeArticles({articles:[article('a'),article('b')]}),{items});}finally{m.close();}
});
test('brief-only material without a supported implication admits that it has no concrete practice advice',()=>{
 const out=renderNewsDigest({items:[{...article('a'),tier:'brief',kind:'substantive',summary:'来源提到一项更新，尚缺少实施细节。'}],generatedAt:now.toISOString()});
 assert.match(out.text,/未形成可直接使用的实践建议/);assert.doesNotMatch(out.text,/值得关注：/);assert.equal(out.deepCount,0);
});
test('known coverage echoes are accepted only when identical to trusted input and then discarded',async()=>{
 const base=summary('a');const m=modelWith({items:[{...base,coverage:'article'}]});try{assert.deepEqual(await m.summarizeArticles({articles:[article('a')]}),{items:[base]});}finally{m.close();}
 for(const extra of [{coverage:'article'},{coverage:'read-full'},{content:'copied input body'}]){const m=modelWith({items:[{...base,...extra}]});try{await assert.rejects(m.summarizeArticles({articles:[{...article('a'),coverage:'feed-only'}]}),{code:'MODEL_INVALID_OUTPUT'});}finally{m.close();}}
});
