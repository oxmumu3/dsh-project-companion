import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,realpath,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Context} from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import CommandRuntime from '@deepseek-ai/dsh-commands';
import Storage from '@deepseek-ai/dsh-storage';
import * as JsonStorage from '@deepseek-ai/dsh-storage-json';
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain';
import SessionStore,{SessionId} from '@deepseek-ai/dsh-session';
import {installCompanion} from '../index.js';
const familyRoot=process.env.FAMILY_BRIDGE_ROOT;
const article={id:'synthetic-ai-news',title:'Synthetic AI news',excerpt:'Public synthetic summary',sourceName:'Synthetic RSS',publishedAt:'2026-10-28T06:00:00Z',url:'https://example.com/ai-news',sourceUrl:'https://example.com/feed'};
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
async function fixture(t,{beforeSend=async()=>{},readArticle=async a=>({article:a,content:'Synthetic public article',coverage:'article',truncated:false})}={}){
 assert.ok(isAbsolute(familyRoot));const {createRuntime}=await import(pathToFileURL(join(familyRoot,'src/runtime.mjs')).href);
 const root=await realpath(await mkdtemp(join(tmpdir(),'family-news-cross-'))),ownerRoot=join(root,'owner');await mkdir(ownerRoot);
 const ctx=new Context();for(const [plugin,config]of[[SystemPrompt,{}],[ToolRuntime,{mode:'native'}],[CommandRuntime,undefined],[Storage,undefined],[JsonStorage,{root:join(root,'storage')}],[StorageDomain,{backend:'json'}],[SessionStore,undefined]])await ctx.plugin(plugin,config);
 const intents=[],sent=[],agents=new Map();let activeCall='pair';
 const ownerAgent={ensureControlWorkspace:async()=>({workspaceId:'owner',title:'Owner',path:ownerRoot}),listWorkspaces:async()=>[{workspaceId:'owner',title:'Owner',path:ownerRoot}],start:async x=>{intents.push(structuredClone(x));return{state:'running'};},observe:async x=>({workspaceId:x.workspaceId,sessionId:x.sessionId,requestId:x.requestId,cwd:x.cwd,state:'running',requestSeen:true,queued:false,foreign:false,turn:1,activeTurn:1,activeRequestIds:[x.requestId],events:[{type:'tool/call',turn:1,callId:activeCall,status:'running'}]})};
 let family,adapter;const familyFiber=await ctx.plugin({name:'synthetic-news-family',apply(scope){family=createRuntime({directory:join(root,'family'),ownerAgent,intervalMs:1000000,channelFactory:()=>({status:()=>({status:'connected'}),connect:async()=>{},disconnect:async()=>{},close:async()=>{},send:async(route,text,options)=>{await beforeSend({family,text});if(options.authorize()!==true)throw Object.assign(Error('news authority cancelled'),{sendOutcome:'failed'});sent.push({personId:route.personId,text});return{status:'api_accepted'};}})});family.familyDotBridge.isOwnerProjectResultCurrent=()=>assert.fail('public RSS news must not borrow a project task authority');family.familyDotBridge.beforeOwnerProjectResult=()=>assert.fail('news has no original project acknowledgement barrier');scope.provide('familyDotBridge',family.familyDotBridge);scope.effect(()=>()=>family.close());}});
 family.store.addPerson({id:'owner',role:'owner',label:'Owner'});family.store.bindPerson('owner',{accountId:'synthetic-account',peerId:'synthetic-peer'});await family.start();await family.receive('owner',{id:'pairing',peerId:'synthetic-peer',text:'请查看项目资料的来源连接状态。'});await family.settled();
 const session=ctx.sessions.create(SessionId(intents[0].sessionId),{meta:{cwd:ownerRoot}}),owner={id:session.id,session,ctx,status:'idle'};agents.set(owner.id,owner);ctx.provide('agents',{get:id=>agents.get(id),list:()=>[...agents.values()]});ctx.provide('workingDirectory',{get:s=>s.header.cwd});ctx.provide('workspaceRegistry',{list:()=>[]});
 const dotFiber=await ctx.plugin({name:'synthetic-news-dot',inject:['tools','commands','storageDomain','sessions','systemPrompt'],async apply(scope){adapter=await installCompanion(scope,{clock:()=>new Date('2026-10-28T07:00:00Z'),family:{enabled:true},readSetup:async()=>({state:'unbound'}),readNativeRoute:async()=>({kind:'unbound'}),readBinding:async()=>null,news:{fetchCandidates:async()=>({articles:[article],stats:{hours:24}}),readArticle:a=>readArticle(a,family),model:{selectArticles:async()=>[article.id],summarizeArticles:async()=>({items:[{id:article.id,summary:'这是公开订阅源的合成新闻摘要。',why:'了解工具开发的新进展。'}]})}},context:{readConfig:()=>({}),googlePublisher:null,fetch:async()=>{throw Error('no network');}},timers:{setInterval(){return{unref(){}};},clearInterval(){}}});}});
 t.after(async()=>{await dotFiber.dispose();await familyFiber.dispose();await ctx.fiber.dispose();await rm(root,{recursive:true,force:true});});
 const paired=await ctx.tools.execute({name:'personal_context',callId:activeCall,arguments:{action:'connections'},agent:owner,signal:new AbortController().signal});assert.ok(paired.value.sources,JSON.stringify(paired));
 return{family,adapter,owner:{sessionId:owner.id,cwd:ownerRoot},sent};
}
test('real Family news send uses its own binding and cancellation authority without project origin',{skip:!familyRoot},async t=>{
 const f=await fixture(t),result=await f.adapter.news.act(f.owner,{action:'send_now',requestId:'authorized-news',userRequested:true});assert.equal(result.status,'reported_sent',JSON.stringify(result));assert.equal(f.sent.length,1);assert.equal(f.sent[0].personId,'owner');assert.match(f.sent[0].text,/合成新闻摘要/);assert.equal(f.family.store.snapshot().outbox.filter(row=>row.kind==='dot_result').length,1);const again=await f.adapter.news.act(f.owner,{action:'send_now',requestId:'authorized-news',userRequested:true});assert.equal(again.duplicate,true);assert.equal(f.sent.length,1);
});
test('real Family news send rechecks its cancellation guard while channel send is pending',{skip:!familyRoot},async t=>{
 const entered=deferred(),gate=deferred(),f=await fixture(t,{beforeSend:async()=>{entered.resolve();await gate.promise;}});const pending=f.adapter.news.act(f.owner,{action:'send_now',requestId:'cancel-news',userRequested:true});
 const raced=await Promise.race([entered.promise.then(()=>true),pending.then(()=>false)]);assert.equal(raced,true,'news must reach channel with no project task authority');const cancel=f.adapter.news.act(f.owner,{action:'cancel',requestId:'cancel-news-now',userRequested:true});gate.resolve();await Promise.allSettled([pending,cancel]);assert.equal(f.sent.length,0);
});
test('real Family news send rejects a changed binding after generation',{skip:!familyRoot},async t=>{
 const f=await fixture(t,{readArticle:async(a,family)=>{family.store.bindPerson('owner',{accountId:'changed',peerId:'changed'});return{article:a,content:'Public synthetic',coverage:'article',truncated:false};}});await assert.rejects(f.adapter.news.act(f.owner,{action:'send_now',requestId:'rebind-news',userRequested:true}),/绑定|授权/);assert.equal(f.sent.length,0);
});
