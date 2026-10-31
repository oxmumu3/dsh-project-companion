import test from 'node:test';
import assert from 'node:assert/strict';
import {createNewsService} from '../src/news-service.js';
import {publicNewsIdentity} from '../src/news-identity.js';

test('clean and tracked queries share canonical encoding but preserve changed public evidence',()=>{
 const base={title:'Short title',publishedAt:'2026-10-31T12:00:00.000Z',excerpt:'Original feed fact'};
 for(const query of ['title=hello%20world','query=foo~bar'])assert.equal(publicNewsIdentity({...base,url:'https://example.com/a?'+query}).urlKey,publicNewsIdentity({...base,url:'https://example.com/a?'+query+'&utm_source=rss'}).urlKey);
 const headline='A concrete agent execution framework is now available';
 assert.notEqual(publicNewsIdentity({...base,title:headline,url:'https://example.com/v1'}).eventKey,publicNewsIdentity({...base,title:headline,url:'https://example.com/v2',excerpt:'A substantively changed feed fact'}).eventKey);
});

test('public digest deduplicates URL variants and exact same-day headlines across feeds and restart',async()=>{
 let stored,candidates=[],selected=[],sends=0;
 const caller={sessionId:'synthetic-news-owner',cwd:'/synthetic'},clock=()=>new Date('2026-10-31T15:10:00.000Z');
 const article=(id,url,title)=>({id,url,title,sourceName:'Public fixture',sourceUrl:'https://example.com/rss',publishedAt:'2026-10-31T12:00:00.000Z',excerpt:'Synthetic public feed evidence.'});
 const a=article('one','https://example.com/agent?utm_source=feed#part','A concrete agent execution framework is now available');
 candidates=[a,{...a,id:'two',url:'https://example.com/agent?utm_source=another'},article('three','https://another.example.com/report',a.title),article('four','https://example.com/agent?version=2','A revised agent framework adds a distinct runtime capability')];
 const options={store:{get:async()=>stored,put:async(_k,row)=>{stored=structuredClone(row);}},clock,readBinding:async()=>({bound:true,bindingKey:'a'.repeat(64)}),canRun:async()=>true,fetchCandidates:async()=>({articles:candidates}),selectArticles:async({articles})=>{selected=articles;return articles.map(a=>a.id);},readArticle:async()=>({coverage:'article',content:'Synthetic public report.'}),summarizeArticles:async({articles})=>({items:articles.map(a=>({id:a.id,summary:'原文提供框架实践。',why:'对应 Agent 产品的执行可靠性。'}))}),send:async()=>{sends++;return{status:'reported_sent'};}};
 const first=createNewsService(options);await first.act(caller,{action:'send_now',userRequested:true,requestId:'first'});
 assert.deepEqual(selected.map(a=>a.id),['one','four']);assert.equal(sends,1);assert.equal(stored.articleHistory.length,2);
 await first.close();candidates=[{...a,id:'changed-feed-id',url:'https://example.com/agent?utm_campaign=new'},article('copied-headline','https://third.example.com/copy',a.title)];
 const restart=createNewsService(options);const next=await restart.act(caller,{action:'preview'});assert.equal(next.items.length,0);assert.equal(sends,1);await restart.close();
});
