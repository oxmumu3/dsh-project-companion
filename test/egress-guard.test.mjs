import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Context} from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime,{defineTool} from '@deepseek-ai/dsh-tools';
import CommandRuntime from '@deepseek-ai/dsh-commands';
import Storage from '@deepseek-ai/dsh-storage';
import * as JsonStorage from '@deepseek-ai/dsh-storage-json';
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain';
import SessionStore,{SessionId} from '@deepseek-ai/dsh-session';
import {executeHostTool} from '../src/host-tool-call.js';
import {markPrivateRead,privateReadSince,privateEgressBlocked,PRIVATE_EGRESS_BLOCKED_TEXT} from '../src/egress-guard.js';

const BINDING='a'.repeat(64), TTL=30*60*1000;
const at=iso=>new Date(iso);

test('没有标记时不拦；标记按会话隔离，且在 TTL 内返回最近一条',()=>{
  assert.equal(privateReadSince('guard-none',at('2026-11-04T20:00:00Z')),null);
  assert.equal(privateEgressBlocked('guard-none',at('2026-11-04T20:00:00Z')),null);
  markPrivateRead('guard-a',{at:at('2026-11-04T20:00:00Z'),source:'personal_context:gmail'});
  const mark=privateReadSince('guard-a',at('2026-11-04T20:05:00Z'));
  assert.equal(mark.source,'personal_context:gmail');
  assert.equal(mark.ageMs,5*60*1000);
  assert.equal(privateEgressBlocked('guard-a',at('2026-11-04T20:05:00Z')),PRIVATE_EGRESS_BLOCKED_TEXT);
  assert.equal(privateEgressBlocked('guard-b',at('2026-11-04T20:05:00Z')),null,'别的会话不受影响');
  assert.equal(privateEgressBlocked('guard-a',at('2026-11-04T20:05:00Z'),true),null,'明确确认后放行');
});

test('TTL 过期后不拦，未来时间的标记也不算数',()=>{
  markPrivateRead('guard-ttl',{at:at('2026-11-04T20:00:00Z'),source:'context_brief'});
  assert.ok(privateReadSince('guard-ttl',at('2026-11-04T20:29:59Z')));
  assert.equal(privateReadSince('guard-ttl',at('2026-11-04T20:30:01Z')),null);
  assert.equal(privateEgressBlocked('guard-ttl',at('2026-11-04T20:30:01Z')),null);
  markPrivateRead('guard-future',{at:at('2026-11-04T21:00:00Z')});
  assert.equal(privateReadSince('guard-future',at('2026-11-04T20:00:00Z')),null,'时钟回拨不会伪造匹配');
});

test('标记只保留时间与来源，参数非法直接报错',()=>{
  assert.throws(()=>markPrivateRead('',{}),/真实会话/);
  assert.throws(()=>markPrivateRead('guard-x',{at:'not-a-date'}),/有效时间/);
  assert.throws(()=>privateReadSince('guard-x',NaN),/有效时间/);
  markPrivateRead('guard-per-session',{at:at('2026-11-04T20:00:00Z')});
  for(let i=0;i<40;i++)markPrivateRead('guard-per-session',{at:at('2026-11-04T20:00:00Z'),source:`s${i}`});
  const newest=privateReadSince('guard-per-session',at('2026-11-04T20:01:00Z'));
  assert.equal(newest.source,'s39');
});

function newsFixtures(){
  let feeds=0,models=0;
  const articles=Array.from({length:10},(_,i)=>({id:`news-${i}`,title:`AI Builder ${i}`,url:`https://example.org/ai/${i}`,publishedAt:'2026-10-18T14:00:00Z',sourceName:'Synthetic public source',sourceUrl:'https://example.org',excerpt:`AI tool source ${i}`}));
  return {fetchCandidates:async()=>{feeds++;return{articles,stats:{totalFeeds:1,succeededFeeds:1,failedFeeds:0,totalArticles:10,eligibleArticles:10},warnings:[]};},readArticle:async article=>({article,content:`Public body ${article.id}`,coverage:'article',truncated:false}),model:{selectArticles:async()=>{models++;return articles.map(a=>a.id);},summarizeArticles:async({articles:items})=>({items:items.map(a=>({id:a.id,title:a.title,summary:'来自公开资料的简短中文摘要。',why:'可以用于 Builder 实践。'}))}),close(){}},counts:()=>({feeds,models})};
}

async function openHost(t,options={}){
  const {installCompanion}=await import('../index.js');
  const root=await realpath(await mkdtemp(join(tmpdir(),'egress-host-')));
  const workspace=join(root,'synthetic-project');await mkdir(workspace,{recursive:true});
  await writeFile(join(workspace,'README.md'),'SYNTHETIC host project source');
  const ctx=new Context();let adapter;const live=new Map();const sent=[];let now=new Date('2026-10-18T15:00:00Z');
  await ctx.plugin(SystemPrompt,{});
  const batchTools=typeof ToolRuntime.prototype?.selectExecutor==='function';
  await ctx.plugin(ToolRuntime,batchTools?{}:{mode:'native'});
  if(batchTools)await ctx.plugin(await import('@deepseek-ai/dsh-tool-executor-native'));
  await ctx.plugin(CommandRuntime);
  await ctx.plugin(Storage);await ctx.plugin(JsonStorage,{root:join(root,'storage')});await ctx.plugin(StorageDomain,{backend:'json'});await ctx.plugin(SessionStore);
  ctx.provide('agents',{get:id=>live.get(id),list:()=>[...live.values()]});
  ctx.provide('workspaceRegistry',{list:()=>[],resolveByPath:async()=>undefined});
  ctx.provide('workingDirectory',{get:session=>session.header.cwd});
  if(options.guardedBridge)ctx.provide('dotWechatGuarded',options.guardedBridge);
  const session=ctx.sessions.create(SessionId('synthetic-owner'),{meta:{cwd:workspace}});
  const owner={id:session.id,session,ctx,status:'idle',followup:()=>{}};live.set(owner.id,owner);
  ctx.tools.register(defineTool({name:'send_wechat',description:'Synthetic queue only; no real network',parameters:{text:{type:'string',required:true}},output:{schema:{type:'object',additionalProperties:true},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},execute:(args,execution)=>{sent.push({args,execution});return{ok:true,message:'queued synthetic message; not real WeChat'};}}));
  const lifecycle=await ctx.plugin({name:'synthetic-egress-mount',inject:['tools','commands','storageDomain','sessions','systemPrompt'],async apply(scope){adapter=await installCompanion(scope,{clock:()=>now,hostTimeZone:()=>'America/Mexico_City',readSetup:async()=>({state:'bound',sessionId:'synthetic-owner',bindingKey:BINDING}),...(options.news?{news:options.news}:{}),...(options.personalReview?{personalReview:options.personalReview}:{})});}});
  t.after(async()=>{await lifecycle.dispose?.();await ctx.fiber.dispose();await rm(root,{recursive:true,force:true});});
  const tool=async(name,args,callId)=>{const r=await executeHostTool(ctx.tools,{callId:callId??`call-${Math.random()}`,name,arguments:args,agent:owner,signal:new AbortController().signal});assert.equal(r.isError,false,JSON.stringify(r));return r.value;};
  return {root,workspace,ctx,owner,adapter,sent,tool,now:()=>now,time:value=>{now=new Date(value);}};
}

const bridge=()=>({binding:id=>id==='synthetic-owner'?{bound:true,bindingKey:BINDING}:null,routeStatus:()=>'current',send:async()=>({status:'accepted'})});

test('没有私人读取标记时 send_now 照常抓取并发送',async t=>{
  const news=newsFixtures(),h=await openHost(t,{news});
  const value=await h.tool('ai_digest',{action:'send_now',userRequested:true},'egress-send-1');
  assert.ok(['queued','reported_sent'].includes(value.status),JSON.stringify(value));
  assert.equal(h.sent.length,1);assert.deepEqual(news.counts(),{feeds:1,models:1});
});

test('资讯日报不设私人外发门禁：正文来自公开 RSS，读了私人资料也照常发送',async t=>{
  const news=newsFixtures(),h=await openHost(t,{news});
  markPrivateRead('synthetic-owner',{at:h.now(),source:'personal_context:gmail'});
  const value=await h.tool('ai_digest',{action:'send_now',userRequested:true},'egress-send-2');
  // Deliberate: the digest carries public RSS content, so blocking it on "this
  // session read something private" would be an unrelated proxy check that only
  // adds friction. The private-egress gate lives on personal_review.run_now.
  assert.ok(['queued','reported_sent'].includes(value.status),JSON.stringify(value));
  assert.deepEqual(news.counts(),{feeds:1,models:1});
  assert.equal(h.sent.length,1);
  assert.ok(privateReadSince('synthetic-owner',h.now()),'the marker stays: it is what the review gate reads');
});

test('personal_review run_now 被拦时不读取也不建计划，确认后才继续',async t=>{
  const reads=[];const h=await openHost(t,{guardedBridge:bridge(),readSetup:async()=>({state:'bound',sessionId:'synthetic-owner',bindingKey:BINDING}),personalReview:{collect:async()=>{reads.push(1);return{evidence:[],coverage:[]};},model:{summarize:async()=>({items:[]})}}});
  const root=h.owner.session.header.cwd;await h.tool('project_companion',{action:'watch'});
  const review=async(args,callId)=>{const r=await executeHostTool(h.ctx.tools,{callId,name:'personal_review',arguments:args,agent:h.owner,signal:new AbortController().signal});assert.equal(r.isError,false,JSON.stringify(r));return r.value;};
  markPrivateRead('synthetic-owner',{at:h.now(),source:'personal_review:preview'});
  const blocked=await review({action:'run_now',sources:[],projects:[root],userRequested:true},'review-egress-1');
  assert.equal(blocked.status,'blocked');assert.equal(blocked.text,PRIVATE_EGRESS_BLOCKED_TEXT);
  assert.equal(reads.length,0,'被拦时不能读取私人资料');
  assert.equal((await review({action:'status'},'review-status-1')).jobs.length,0,'被拦时不建计划');
  const allowed=await review({action:'run_now',sources:[],projects:[root],userRequested:true,confirmPrivateEgress:true},'review-egress-2');
  assert.equal(reads.length,1);assert.notEqual(allowed.status,'blocked');
  assert.equal(h.sent.length,0);
  h.time('2026-10-18T16:00:00Z');
  const expired=await review({action:'run_now',sources:[],projects:[root],userRequested:true},'review-egress-3');
  assert.equal(reads.length,2,'30 分钟窗口外的旧标记不再拦');assert.notEqual(expired.status,'blocked');
});

test('标记只在内存里，不写任何文件',async t=>{
  const h=await openHost(t);
  markPrivateRead('synthetic-owner',{at:h.now(),source:'personal_context:brief'});
  const {readdir}=await import('node:fs/promises');
  const files=await readdir(join(h.root,'storage'),{recursive:true});
  for(const file of files)assert.ok(!String(file).includes('egress')&&!String(file).includes('private'),String(file));
  assert.ok(privateReadSince('synthetic-owner',h.now()));
  assert.ok(TTL>0);
});
