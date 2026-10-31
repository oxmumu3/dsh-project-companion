import test from 'node:test';
import assert from 'node:assert/strict';
import {NEWS_FEEDS,fetchNewsCandidates,readNewsArticle} from '../src/news-feeds.js';
import {createNewsService} from '../src/news-service.js';
import {renderNewsDigest} from '../src/news-render.js';
const now=new Date('2026-10-30T06:00:00Z'),lookup=async()=>[{address:'93.184.216.34',family:4}];
test('the production service normalized source URL still reaches the allowlisted original article reader',async()=>{
 const feed=NEWS_FEEDS.find(f=>f.name==='simonwillison.net');let articleReads=0;
 const candidates=await fetchNewsCandidates({feeds:[feed],now,lookup,fetch:async()=>new Response('<rss><channel><item><title>AI plugin engineering</title><link>https://simonwillison.net/2026/fixture/</link><pubDate>2026-10-30T05:00:00Z</pubDate><description>Synthetic AI plugin source</description></item></channel></rss>',{headers:{'content-type':'application/rss+xml'}})});
 const service=createNewsService({store:{get:async()=>undefined,put:async()=>assert.fail('no writes')},clock:()=>now,readBinding:async()=>({bound:true,bindingKey:'a'.repeat(64)}),fetchCandidates:async()=>candidates,selectArticles:async({articles})=>articles.map(a=>a.id),readArticle:a=>readNewsArticle(a,{lookup,fetch:async()=>{articleReads++;return new Response('<article>'+ 'Synthetic public article evidence. '.repeat(10)+'</article>',{headers:{'content-type':'text/html'}});}}),summarizeArticles:async({articles})=>{assert.equal(articles[0].coverage,'article');assert.match(articles[0].content,/Synthetic public article evidence/);return{items:articles.map(a=>({id:a.id,summary:'虚构公开来源摘要',why:'验证原文读取衔接'}))};},send:async()=>assert.fail('no send')});
 try{const r=await service.act({sessionId:'test',cwd:'/synthetic/news'},{action:'preview'});assert.equal(articleReads,1);assert.equal(r.items[0].coverage,'article');}finally{await service.close();}
});
test('message-bounded prose marks truncation rather than ending silently mid-sentence',()=>{
 const r=renderNewsDigest({items:Array.from({length:10},(_,i)=>({id:`a${i}`,tier:i<3?'deep':'brief',kind:'substantive',title:'AI news',url:`https://example${i}.org/${i}?q=${'x'.repeat(100)}`,sourceName:'Public',publishedAt:now.toISOString(),summary:'源'.repeat(350),why:'因'.repeat(90),coverage:'article'})),generatedAt:now.toISOString()});
 assert.match(r.text,/源+…/u);assert.match(r.text,/值得关注：因+…/u);assert.ok(r.text.length<=3200);for(const item of r.items)assert.ok(r.text.includes(item.url));
});
test('short digest preserves complete valid summaries when the message budget has room',()=>{
 const summary='源'.repeat(350),why='因'.repeat(90);
 const r=renderNewsDigest({items:[{id:'a',tier:'deep',kind:'substantive',title:'AI news',url:'https://example.org/a',sourceName:'Public',publishedAt:now.toISOString(),summary,why,coverage:'article'}],generatedAt:now.toISOString()});
 assert.ok(r.text.includes(summary));assert.ok(r.text.includes(why));assert.equal(r.items[0].summary,summary);assert.equal(r.items[0].why,why);assert.ok(r.text.length<=3200);
});
