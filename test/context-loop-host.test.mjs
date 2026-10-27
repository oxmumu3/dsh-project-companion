import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,realpath,mkdir,writeFile} from 'node:fs/promises';
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

async function fixture(t,options={}){
  const {installCompanion}=await import('../index.js');
  const root=await realpath(await mkdtemp(join(tmpdir(),'dot-context-host-')));
  await mkdir(join(root,'.agent/memory'),{recursive:true});for(const file of ['README.md','.agent/memory/progress.md','.agent/memory/context.md'])await writeFile(join(root,file),'Synthetic project context');
  const ctx=new Context();
  for(const [plugin,config] of [[SystemPrompt,{}],[ToolRuntime,{mode:'native'}],[CommandRuntime,undefined],[Storage,undefined],[JsonStorage,{root:join(root,'storage')}],[StorageDomain,{backend:'json'}],[SessionStore,undefined]])await ctx.plugin(plugin,config);
  const agents=new Map(),routes=new Map(),calls=[],closed=[];
  ctx.provide('agents',{get:id=>agents.get(id),list:()=>[...agents.values()]});
  ctx.provide('workingDirectory',{get:session=>session.header.cwd});
  ctx.provide('workspaceRegistry',{list:()=>[]});
  ctx.provide('connection',{fetch:{register:route=>{routes.set(route.path,route);return()=>routes.delete(route.path);}}});
  let connection={state:'bound',sessionId:'context-owner',bindingKey:'a'.repeat(64)};
  const session=ctx.sessions.create(SessionId('context-owner'),{meta:{cwd:root}});
  const agent={id:session.id,session,ctx,status:'idle'};agents.set(agent.id,agent);
  let adapter;
  const config={didaToken:'synthetic-private-token',flomoToken:'',googleClientId:'',googleClientSecret:'',googleRefreshToken:''};
  const googleTokenVault=options.vaultFactory?.(config);
  const transport={catalog:async(source,{signal})=>{calls.push({type:'catalog',source});return options.catalog?.(source,{signal})??{tools:[{name:'list_projects',inputSchema:{type:'object',properties:{limit:{type:'integer'},offset:{type:'integer'}}}}],fetchedAt:'2026-10-19T12:00:00Z'};},call:async(source,name,args,{signal})=>{calls.push({type:'call',source,name,args});return options.call?.(source,name,args,{signal})??{value:{structuredContent:{projects:[{id:'p1',name:'当前事项'}]}},fetchedAt:'2026-10-19T12:00:00Z'};},close:async()=>closed.push('transport')};
  const googleAuth={status:()=>({clientConfigured:false,refreshConfigured:false,authInProgress:false}),start:async()=>{calls.push({type:'google_authorize'});return{url:'https://accounts.google.com/o/oauth2/v2/auth?state=synthetic',expiresAt:'2026-10-19T12:05:00Z'};},getToken:async()=>{throw new Error('must not access Google');},close:async()=>closed.push('googleAuth')};
  options.onRoot?.(ctx);
  const plugin=await ctx.plugin({name:'synthetic-context-host',inject:['tools','commands','storageDomain','sessions','systemPrompt'],async apply(scope){adapter=await installCompanion(scope,{clock:()=>new Date('2026-10-19T12:00:00Z'),readSetup:async()=>connection,readNativeRoute:options.readNativeRoute??(async()=>({kind:'unbound'})),readBinding:options.readBinding??(async()=>null),context:{readConfig:()=>({...config}),...(googleTokenVault?{googleTokenVault}:{}),googlePublisher:options.googlePublisher??null,fetch:options.contextFetch??(async()=>{throw new Error('Synthetic context host must not contact real services');}),transport,googleAuth,...(options.flomoAuth?{flomoAuth:options.flomoAuth}:{}),...(options.didaAuth?{didaAuth:options.didaAuth}:{}),...(options.googleCalendarAuth?{googleCalendarAuth:options.googleCalendarAuth}:{}),...(options.googleSuiteAuth?{googleSuiteAuth:options.googleSuiteAuth}:{}),...(options.suiteTransport?{suiteTransport:options.suiteTransport}:{}),...(options.calendarTransport?{calendarTransport:options.calendarTransport}:{})},contextLoop:options.contextLoop,timers:{setInterval(){return{unref(){}};},clearInterval(){}}});}});
  let number=0;
  const tool=async args=>{const response=await ctx.tools.execute({callId:'context-test-'+(++number),name:'personal_context',arguments:args,agent,signal:new AbortController().signal});assert.equal(response.isError,false,JSON.stringify(response));return response.value;};
  const project=async args=>{const response=await ctx.tools.execute({callId:'context-project-'+(++number),name:'project_companion',arguments:args,agent,signal:new AbortController().signal});assert.equal(response.isError,false,JSON.stringify(response));return response.value;};
  const route=()=>routes.get('/api/project_companion/context');
  const get=async()=>{const response=await route().fetch(new Request('http://localhost/api/project_companion/context'));return{status:response.status,value:await response.json()};};
  const post=async body=>{const response=await route().fetch(new Request('http://localhost/api/project_companion/context',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}));return{status:response.status,value:await response.json()};};
  const close=()=>ctx.fiber.dispose();
  t.after(async()=>{await close();await rm(root,{recursive:true,force:true});});
  return{ctx,agent,agents,routes,calls,closed,adapter,plugin,config,googleTokenVault,tool,project,get,post,route,close,setConnection:value=>connection=value};
}

test('native context loop exposes sourced brief and inspection, ordinary turns cannot call autonomous check',async t=>{
 const h=await fixture(t,{contextLoop:{summarize:async input=>({changes:[],blockers:[],nextSteps:[{kind:'suggestion',text:'建议核对当前事项的下一步。',sourceIds:[input.sources.find(s=>s.role==='file'&&s.status==='ok').sourceId]}]})}});
 await h.project({action:'watch'});await h.tool({action:'connect',source:'dida',userRequested:true});
 const r=await h.project({action:'context_brief',objective:'推进今天的项目',queries:[{source:'dida',operation:'projects',limit:2}],userRequested:true});
 assert.equal(r.status,'overview',JSON.stringify(r));assert.ok(r.loopId);assert.ok(r.items.length);assert.equal(typeof r.revision,'number');
 const count=h.calls.length;
 const status=await h.project({action:'context_status'});assert.equal(status.loopId,r.loopId);assert.equal(h.calls.length,count,'inspection cannot reread accounts');
 const auto=await h.project({action:'context_check',loopId:r.loopId});assert.equal(auto.status,'blocked');assert.equal(h.calls.length,count);
 const refresh=await h.project({action:'context_brief',userRequested:true});assert.equal(refresh.status,'ready');assert.equal(refresh.revision,r.revision);assert.equal(refresh.loopId,r.loopId);
 await h.project({action:'pause'});assert.equal((await h.project({action:'context_status'})).status,'blocked');
});

test('new context manifest requires explicit intent and source reconnect invalidates it',async t=>{
 const h=await fixture(t,{contextLoop:{summarize:async()=>({changes:[],blockers:[],nextSteps:[]})}});await h.project({action:'watch'});await h.tool({action:'connect',source:'dida',userRequested:true});
 const bad=await h.project({action:'context_brief',objective:'目标',queries:[{source:'dida',operation:'projects'}]});assert.equal(bad.status,'blocked');
 const ok=await h.project({action:'context_brief',objective:'目标',queries:[{source:'dida',operation:'projects'}],userRequested:true});assert.ok(ok.loopId,JSON.stringify(ok));
 await h.tool({action:'disconnect',source:'dida',userRequested:true});await h.tool({action:'connect',source:'dida',userRequested:true});
 const before=h.calls.length;assert.equal((await h.project({action:'context_brief',userRequested:true})).status,'blocked');assert.equal(h.calls.length,before);
});

test('selected sourced item executes once and its result rejoins the brief through the same ledger',async t=>{
 const binding={userHash:'c'.repeat(64),botHash:'d'.repeat(64)},sent=[],admissions=[];
 const h=await fixture(t,{readBinding:async()=>binding,contextLoop:{summarize:async input=>({changes:[],blockers:[],nextSteps:[{kind:'suggestion',text:'建议为当前事项整理下一步。',sourceIds:[input.sources.find(s=>s.role==='file'&&s.status==='ok').sourceId]}]})}});
 h.ctx.tools.register(defineTool({name:'send_wechat',description:'Synthetic only',parameters:{text:{type:'string',required:true}},output:{schema:{type:'object',additionalProperties:true},render:()=>[]},execute:args=>{sent.push(args.text);return{ok:true,message:'sent 1 synthetic'};}}));
 const root=join(h.agent.session.header.cwd,'other-project');await mkdir(join(root,'.agent/memory'),{recursive:true});for(const f of ['README.md','.agent/memory/progress.md','.agent/memory/context.md'])await writeFile(join(root,f),'Synthetic target project');
 const session=h.ctx.sessions.create(SessionId('loop-target'),{meta:{cwd:root}}),target={id:session.id,session,ctx:h.ctx,status:'idle',followup:message=>{admissions.push(message);}};h.agents.set(target.id,target);
 await h.project({action:'watch',project:root});await h.tool({action:'connect',source:'dida',userRequested:true});
 const brief=await h.project({action:'context_brief',project:root,objective:'推进当前事项',queries:[{source:'dida',operation:'projects',limit:2}],userRequested:true});assert.ok(brief.loopId,JSON.stringify(brief));
 const item=brief.items.find(i=>i.section==='nextSteps');assert.ok(item);
 const args={action:'context_handoff',project:root,revision:brief.revision,itemId:item.id,task:'请只读分析第二项并用三句话给出建议，不改文件。',userRequested:true};
 const handoff=await h.project(args);assert.equal(handoff.accepted,true,JSON.stringify(handoff));assert.ok(handoff.jobId);assert.equal(admissions.length,1);
 const duplicate=await h.project(args);assert.equal(duplicate.duplicate,true);assert.equal(duplicate.jobId,handoff.jobId);assert.equal(admissions.length,1);
 await h.adapter.taskResults.claimed({sessionId:target.id,messageId:String(admissions[0].id),turn:1,sourceKind:'user'});
 await h.adapter.taskResults.observe({sessionId:target.id,type:'assistant',turn:1,text:'SYNTHETIC RESULT unique reply'});
 await h.adapter.taskResults.observe({sessionId:target.id,type:'turn/end',turn:1,reason:{kind:'completed'}});
 assert.equal(sent.length,1);assert.match(sent[0],/SYNTHETIC RESULT/);
 const update=await h.project({action:'context_brief',project:root,userRequested:true});assert.equal(update.status,'updated',JSON.stringify(update));assert.equal(sent.length,1,'brief must not send a second reply');assert.doesNotMatch(update.text,/SYNTHETIC RESULT/);
 const quiet=await h.adapter.contextLoop.check({sessionId:h.agent.id,cwd:h.agent.session.header.cwd},{project:root,loopId:brief.loopId});assert.equal(quiet.quiet,true);assert.equal(admissions.length,1);assert.equal(sent.length,1);
 const status=await h.project({action:'context_status',project:root});assert.equal(status.executions.find(x=>x.jobId===handoff.jobId)?.status,'completed');
});
