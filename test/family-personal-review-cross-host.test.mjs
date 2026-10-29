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
const complete='每天早上9点、每周一早上9点，根据我已启用的资料和选定项目做个人回顾，有风险或临期事项告诉我。';
async function fixture(t,options={}){
 assert.ok(isAbsolute(familyRoot));
 const {createRuntime}=await import(pathToFileURL(join(familyRoot,'src/runtime.mjs')).href);
 const {installOwnerDotReadGuard}=await import(pathToFileURL(join(familyRoot,'src/owner-dot-read-guard.mjs')).href);
 const root=await realpath(await mkdtemp(join(tmpdir(),'family-personal-review-'))),ownerRoot=join(root,'owner'),targetRoot=join(root,'project');await mkdir(ownerRoot);await mkdir(targetRoot);
 const ctx=new Context();for(const [plugin,config]of[[SystemPrompt,{}],[ToolRuntime,{mode:'native'}],[CommandRuntime,undefined],[Storage,undefined],[JsonStorage,{root:join(root,'storage')}],[StorageDomain,{backend:'json'}],[SessionStore,undefined]])await ctx.plugin(plugin,config);
 const intents=[],sent=[],reads=[],agents=new Map(),rows=[{workspaceId:'owner',id:'owner',title:'Owner',path:ownerRoot,sessionIds:[]},{workspaceId:'project',id:'project',title:'Synthetic project',path:targetRoot,sessionIds:['synthetic-project']}];
 let activeCall='initial',instant='2026-10-29T12:00:10.000Z',counter=0,adapter,family;
 const ownerAgent={ensureControlWorkspace:async()=>rows[0],listWorkspaces:async()=>rows,start:async input=>{intents.push(structuredClone(input));return{state:'running'};},observe:async input=>({workspaceId:input.workspaceId,sessionId:input.sessionId,requestId:input.requestId,cwd:input.cwd,state:'running',requestSeen:true,queued:false,foreign:false,turn:1,activeTurn:1,activeRequestIds:[input.requestId],events:[{type:'tool/call',seq:3,turn:1,callId:activeCall,status:'running'}]})};
 ctx.provide('agents',{get:id=>agents.get(id),list:()=>[...agents.values()]});ctx.provide('workingDirectory',{get:s=>s.header.cwd});ctx.provide('workspaceRegistry',{list:()=>rows});
 const familyFiber=await ctx.plugin({name:'synthetic-family-personal-review',apply(scope){
  family=createRuntime({directory:join(root,'family'),ownerAgent,now:()=>instant,intervalMs:1000000,channelFactory:()=>({status:()=>({status:'connected'}),connect:async()=>{},disconnect:async()=>{},close:async()=>{},send:async(route,text,sendOptions)=>{if(options.beforeSend)await options.beforeSend({family,text});if(sendOptions.authorize()!==true)throw Object.assign(Error('synthetic authorization changed'),{sendOutcome:'failed'});sent.push({personId:route.personId,text});return{status:'api_accepted'};}})});
  scope.provide('familyDotBridge',family.familyDotBridge);const guard=installOwnerDotReadGuard({ctx:scope,getTasks:()=>family.ownerTasksForToolGuard()});scope.effect(()=>async()=>{await guard.close();await family.close();});
 }});
 const dotFiber=await ctx.plugin({name:'synthetic-dot-personal-review',inject:['tools','commands','storageDomain','sessions','systemPrompt'],async apply(scope){adapter=await installCompanion(scope,{clock:()=>new Date(instant),hostTimeZone:'America/Mexico_City',family:{enabled:true},readSetup:async()=>({state:'bound',sessionId:'legacy-owner',bindingKey:'a'.repeat(64)}),readNativeRoute:async()=>({kind:'unbound'}),readBinding:async()=>null,
  context:{readConfig:()=>({didaToken:'synthetic-token-not-real'}),googlePublisher:null,fetch:async()=>assert.fail('synthetic test must not use network'),transport:{catalog:async()=>({tools:[{name:'list_projects',inputSchema:{type:'object',properties:{}}}]}),call:async()=>{reads.push('provider');assert.fail('settings must not read personal data');},close:async()=>{}}},
  news:{fetchCandidates:async()=>assert.fail('settings must not fetch public feeds'),...(options.news??{})},...(options.personalReview?{personalReview:options.personalReview}:{}),timers:{setInterval(){return{unref(){}};},clearInterval(){}}});}});
 t.after(async()=>{await dotFiber.dispose();await familyFiber.dispose();await ctx.fiber.dispose();await rm(root,{recursive:true,force:true});});
 const makeAgent=(id,cwd)=>{const session=ctx.sessions.create(SessionId(id),{meta:{cwd}}),agent={id,session,ctx,status:'idle'};agents.set(id,agent);return agent;};
 const old=makeAgent('legacy-owner',ownerRoot);makeAgent('synthetic-project',targetRoot);
 const invoke=async(agent,name,args,callId='call-'+(++counter))=>{activeCall=callId;return(await ctx.tools.execute({name,callId,arguments:args,agent,signal:new AbortController().signal})).value;};
 const enabled=await invoke(old,'personal_context',{action:'connect',source:'dida',userRequested:true});assert.notEqual(enabled?.status,'blocked',JSON.stringify(enabled));
 await invoke(old,'project_companion',{action:'watch',project:targetRoot});assert.equal((await adapter.service.watchedProjects()).length,1);
 for(const [id,role]of[['owner','owner'],['mom','elder']]){family.store.addPerson({id,role,label:id});family.store.bindPerson(id,{accountId:'synthetic-'+id,peerId:'peer-'+id});}await family.start();
 let agent;const message=async(text,{settle=true}={})=>{await family.receive('owner',{id:'source-'+(++counter),peerId:'peer-owner',text,sourceTiming:{receivedAt:instant,providerCreatedAt:instant}});if(settle)await family.settled();if(!agent)agent=makeAgent(intents.at(-1).sessionId,ownerRoot);return agent;};
 await message('请查看项目资料的来源连接状态。');assert.ok((await invoke(agent,'personal_context',{action:'connections'})).sources);
 return{adapter,family,reads,sent,intents,targetRoot,message,tool:async(name,args)=>invoke(agent,name,args),member:async(name,args)=>invoke({...agent,id:'family_member_synthetic'},name,args),forged:async(name,args)=>(await ctx.tools.execute({name,callId:'not-the-observed-call',arguments:args,agent,signal:new AbortController().signal})).value,time:value=>instant=value};
}
test('real Family and Dot accept only verified original schedule and server-selected scope',{skip:!familyRoot},async t=>{
 const f=await fixture(t);await f.message(complete);
 const configured=await f.tool('personal_review',{action:'configure',userRequested:false,sources:['gmail'],projects:['/not-authorized'],schedule:{dailyTime:'23:59',timeZone:'UTC'}});
 assert.equal(configured.status,'enabled',JSON.stringify(configured));assert.deepEqual(configured.sources,['dida']);assert.deepEqual(configured.projects,[f.targetRoot]);assert.deepEqual(configured.schedule,{dailyTime:'09:00',weeklyDay:1,weeklyTime:'09:00',timeZone:'America/Mexico_City'});assert.deepEqual(f.reads,[]);assert.deepEqual(f.sent,[]);
 const duplicate=await f.tool('personal_review',{action:'configure'});assert.equal(duplicate.duplicate,true);
 await f.message('暂停个人回顾。');assert.equal((await f.tool('personal_review',{action:'pause'})).status,'paused');
 await f.message('查看个人回顾状态。');assert.equal((await f.tool('personal_review',{action:'status'})).status,'paused');
 await f.message('恢复个人回顾。');assert.equal((await f.tool('personal_review',{action:'resume'})).status,'enabled');assert.deepEqual(f.reads,[]);assert.deepEqual(f.sent,[]);
});
test('real wrappers reject forged calls, model-selected actions and family member access',{skip:!familyRoot},async t=>{
 const f=await fixture(t);await f.message(complete);
 assert.equal((await f.forged('personal_review',{action:'configure'})).status,'blocked');assert.equal((await f.member('personal_review',{action:'configure'})).status,'blocked');
 await f.message('不要开启个人回顾。');assert.equal((await f.tool('personal_review',{action:'configure'})).status,'blocked');
 await f.message('每天每周主动给我做个人回顾');assert.equal((await f.tool('personal_review',{action:'configure'})).status,'needs_confirmation');
 assert.deepEqual(f.reads,[]);assert.deepEqual(f.sent,[]);
});
test('real shared entry saves news interest from Owner text and rejects model substitution',{skip:!familyRoot},async t=>{
 const f=await fixture(t);await f.message('把我的资讯兴趣设为：AI Agent、开发者工具。');
 const set=await f.tool('ai_digest',{action:'set_topics',topics:['private invented topic'],userRequested:false});assert.notEqual(set.status,'blocked',JSON.stringify(set));
 await f.message('查看我的资讯兴趣。');const state=await f.tool('ai_digest',{action:'status'});assert.notEqual(state.status,'blocked',JSON.stringify(state));assert.deepEqual(state.topics,['AI Agent','开发者工具']);
 await f.message('清空我的资讯兴趣。');assert.notEqual((await f.tool('ai_digest',{action:'clear_topics'})).status,'blocked');assert.equal((await f.member('ai_digest',{action:'set_topics',topics:['member']})).status,'blocked');assert.deepEqual(f.reads,[]);assert.deepEqual(f.sent,[]);
});
test('changed binding cannot resume old personal review or expose old status',{skip:!familyRoot},async t=>{
 const f=await fixture(t);await f.message(complete);assert.equal((await f.tool('personal_review',{action:'configure'})).status,'enabled');
 f.family.store.bindPerson('owner',{accountId:'replacement',peerId:'replacement'});
 assert.equal((await f.tool('personal_review',{action:'status'})).status,'blocked');assert.equal((await f.tool('personal_review',{action:'resume'})).status,'blocked');assert.deepEqual(f.sent,[]);
});
test('scheduled review re-enters persisted Family scope and delivers once without a new Owner tool call',{skip:!familyRoot},async t=>{
 const collected=[],models=[],personalReview={collect:async input=>{collected.push(input);await input.guard();return{evidence:[{id:'dida:synthetic',source:'dida',title:'Synthetic deadline',text:'Check an invitation before the deadline.',at:'2026-10-29T14:00:00.000Z',dueAt:'2026-10-30T12:00:00.000Z'}],coverage:[{source:'dida',status:'ok',count:1},{source:'project',status:'ok',count:0}]};},model:{summarize:async input=>{models.push(input);return{items:[{key:'synthetic-invitation',kind:'invitation',title:'合成邀请待处理',summary:'资料显示有一项邀请。',why:'期限临近。',action:'核对后决定。',unknown:'实际服务设置未知。',evidenceIds:['dida:synthetic'],priority:'high',confidence:'source',dueAt:'2026-10-30T12:00:00.000Z'}]};}}};
 const f=await fixture(t,{personalReview});await f.message(complete);assert.equal((await f.tool('personal_review',{action:'configure'})).status,'enabled');assert.equal(collected.length,0);
 f.time('2026-10-29T15:00:00.000Z');await f.adapter.personalReview.tick();await f.adapter.personalReview.tick();assert.equal(collected.length,1);assert.equal(models.length,1);assert.equal(f.sent.length,1);assert.equal(f.sent[0].personId,'owner');assert.match(f.sent[0].text,/实际服务设置未知/);
 f.family.store.bindPerson('owner',{accountId:'replacement',peerId:'replacement'});f.time('2026-10-30T15:00:00.000Z');await f.adapter.personalReview.tick();assert.equal(collected.length,1);assert.equal(f.sent.length,1);
});
const defer=()=>{let resolve;return{promise:new Promise(r=>{resolve=r;}),resolve:()=>resolve()};};
function publicNews(calls,overrides={}){return{fetchCandidates:async({now})=>({articles:[{id:'synthetic-'+now.toISOString().slice(0,10),title:'Synthetic public AI release',excerpt:'Synthetic public source',sourceName:'Synthetic RSS',url:'https://example.com/ai-news',publishedAt:new Date(now.getTime()-3600000).toISOString()}]}),readArticle:async()=>({content:'Synthetic public article',coverage:'article'}),model:{selectArticles:async input=>{calls.push({stage:'select',topics:input.topics});return input.articles.map(a=>a.id);},summarizeArticles:async input=>{calls.push({stage:'summary',topics:input.topics});return{items:input.articles.map(a=>({id:a.id,summary:'公开资料的合成资讯摘要。',why:'与明确兴趣有关。'}))};}},...overrides};}
test('Owner AI digest shortcut uses saved interests in both model stages and preview has no second delivery',{skip:!familyRoot},async t=>{
 const calls=[],f=await fixture(t,{news:publicNews(calls)});
 await f.message('AI 日报关注：Agent 产品、插件生态。');assert.notEqual((await f.tool('ai_digest',{action:'set_topics',topics:['model override']})).status,'blocked');
 await f.message('AI 日报');const preview=await f.tool('ai_digest',{action:'preview',topics:['model override']});assert.equal(preview.status,'preview',JSON.stringify(preview));assert.match(preview.text,/合成资讯摘要/);assert.deepEqual(calls.map(x=>x.topics),[['Agent 产品','插件生态'],['Agent 产品','插件生态']]);assert.deepEqual(f.sent,[],'preview returns to normal native reply, never calls bridge send');
 assert.match(f.intents.at(-1).prompt,/默认 preview/);
 assert.equal((await f.tool('ai_digest',{action:'send_now'})).status,'blocked','bare request cannot authorize extra send');
 await f.message('给我发送一份AI日报');const send=await f.tool('ai_digest',{action:'send_now'});assert.equal(send.status,'reported_sent',JSON.stringify(send));assert.equal(f.sent.length,1);assert.equal((await f.tool('ai_digest',{action:'send_now'})).duplicate,true);assert.equal(f.sent.length,1);
 assert.deepEqual(calls.map(x=>x.topics),Array.from({length:4},()=>['Agent 产品','插件生态']));assert.deepEqual(f.reads,[]);
});
test('Owner daily news uses original time, persists the same interest and stops after a real cancel request',{skip:!familyRoot},async t=>{
 const calls=[],f=await fixture(t,{news:publicNews(calls)});
 await f.message('AI 日报关注：Agent 产品、插件生态。');await f.tool('ai_digest',{action:'set_topics'});
 await f.message('每天早上9点发AI日报');const config=await f.tool('ai_digest',{action:'configure',time:'23:00',timeZone:'UTC',topics:['model override']});assert.deepEqual(config.schedule,{time:'09:00',timeZone:'America/Mexico_City'});assert.deepEqual(config.topics,['Agent 产品','插件生态']);assert.equal(calls.length,0);assert.equal(f.sent.length,0);
 f.time('2026-10-29T15:00:00.000Z');await f.adapter.news.tick();await f.adapter.news.tick();assert.equal(f.sent.length,1);assert.deepEqual(calls.map(x=>x.topics),[['Agent 产品','插件生态'],['Agent 产品','插件生态']]);
 await f.message('取消我的AI日报');const cancelled=await f.tool('ai_digest',{action:'cancel'});assert.equal(cancelled.schedule,null);assert.deepEqual(cancelled.topics,['Agent 产品','插件生态']);f.time('2026-10-30T15:00:00.000Z');await f.adapter.news.tick();assert.equal(f.sent.filter(row=>row.text.includes('公开资料的合成资讯摘要')).length,1);assert.equal(calls.length,2);
});
test('Owner manual saved-interest digest cannot deliver after a binding changes during generation',{skip:!familyRoot},async t=>{
 const calls=[];let f;f=await fixture(t,{news:publicNews(calls,{readArticle:async()=>{f.family.store.bindPerson('owner',{accountId:'new-owner-route',peerId:'new-peer'});return{content:'Synthetic public article',coverage:'article'};}})});
 await f.message('AI 日报关注：Agent 产品。');await f.tool('ai_digest',{action:'set_topics'});await f.message('给我发送一份AI日报');assert.equal((await f.tool('ai_digest',{action:'send_now'})).status,'blocked');assert.equal(f.sent.length,0);assert.equal(calls.filter(x=>x.stage==='summary').length,0);
});
test('Owner actual cancel request invalidates a saved-interest digest waiting at the Family channel',{skip:!familyRoot},async t=>{
 const entered=defer(),release=defer(),calls=[],f=await fixture(t,{news:publicNews(calls),beforeSend:async()=>{entered.resolve();await release.promise;}});
 await f.message('AI 日报关注：Agent 产品。');await f.tool('ai_digest',{action:'set_topics'});await f.message('给我发送一份AI日报');const pending=f.tool('ai_digest',{action:'send_now'});
 assert.equal(await Promise.race([entered.promise.then(()=>true),pending.then(()=>false)]),true);
 await f.message('取消我的AI日报',{settle:false});const cancel=f.tool('ai_digest',{action:'cancel'});await new Promise(resolve=>setImmediate(resolve));release.resolve();await pending;const result=await cancel;assert.equal(result.schedule,null,JSON.stringify(result));assert.equal(f.sent.length,0);
});
