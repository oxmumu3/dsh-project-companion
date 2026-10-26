import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {Context} from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime, {defineTool} from '@deepseek-ai/dsh-tools';
import CommandRuntime from '@deepseek-ai/dsh-commands';
import Storage from '@deepseek-ai/dsh-storage';
import * as JsonStorage from '@deepseek-ai/dsh-storage-json';
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain';
import SessionStore, {SessionId} from '@deepseek-ai/dsh-session';
import {createUserMessage} from '@deepseek-ai/dsh-llm';
import {createScope,scopeTarget} from '@deepseek-ai/dsh-scope';

test('host integration runs against the selected verified official SDK packages',()=>{
  const sdk=process.env.DSH_TEST_SDK_VERSION??'0.2.1-rc.3';
  const cordis=['0.2.1-rc.2','0.2.1-rc.3'].includes(sdk)?'4.0.5':'4.0.4';
  assert.ok(['0.2.0-rc.2','0.2.1-rc.2','0.2.1-rc.3'].includes(sdk),'unsupported test SDK version');
  const require=createRequire(import.meta.url);
  assert.equal(require('@deepseek-ai/cordis/package.json').version,cordis);
  for(const name of ['agent','tools','commands','storage-domain','session','llm','system-prompt','storage','storage-json'])assert.equal(require(`@deepseek-ai/dsh-${name}/package.json`).version,sdk,name);
});

async function api(){const m=await import('../index.js').catch(()=>({}));assert.equal(typeof m.installCompanion,'function','native companion adapter must exist');return m;}
async function openHost(t, options={}){
  const {installCompanion}=await api();
  const root=options.root??await realpath(await mkdtemp(join(tmpdir(),'companion-host-')));
  const workspace=join(root,'synthetic-project');await mkdir(workspace,{recursive:true});
  await writeFile(join(workspace,'README.md'),'SYNTHETIC host project source');
  const ctx=new Context();let adapter;const live=new Map();const sent=[];const accepted=[];
  let now=new Date('2026-10-18T15:00:00Z');let timer;let timerStarts=0;let timerStops=0;let intervalMs;
  await ctx.plugin(SystemPrompt,{});await ctx.plugin(ToolRuntime,{mode:options.mode??'native'});await ctx.plugin(CommandRuntime);
  await ctx.plugin(Storage);await ctx.plugin(JsonStorage,{root:join(root,'storage')});await ctx.plugin(StorageDomain,{backend:'json'});await ctx.plugin(SessionStore);
  const registry={get:id=>live.get(id),list:()=>[...live.values()]};ctx.provide('agents',registry);
  const known=[];ctx.provide('workspaceRegistry',{list:()=>known,resolveByPath:async path=>known.find(x=>x.path===path)});
  if(options.connection)ctx.provide('connection',options.connection);
  const directories=new Map();ctx.provide('workingDirectory',{get:session=>directories.get(String(session.id))??session.header.cwd});
  const session=ctx.sessions.create(SessionId('synthetic-owner'),{meta:{cwd:workspace}});
  const owner={id:session.id,session,ctx,status:'idle',followup:message=>accepted.push(message)};live.set(owner.id,owner);
  const disableWeChat=ctx.tools.register(defineTool({name:'send_wechat',description:'Synthetic queue only; no real network',parameters:{text:{type:'string',required:true}},output:{schema:{type:'object',additionalProperties:true},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},execute:(_args,execution)=>{sent.push(execution);return options.sendResponse?.(execution)??{ok:true,message:'queued synthetic message; not real WeChat'};}}));
  const lifecycle=await ctx.plugin({name:'synthetic-companion-mount',inject:['tools','commands','storageDomain','sessions','systemPrompt'],async apply(scope){adapter=await installCompanion(scope,{clock:()=>now,hostTimeZone:()=>options.hostTimeZone??'America/Mexico_City',...(options.readBinding?{readBinding:options.readBinding}:{}),...(options.readSetup?{readSetup:options.readSetup}:{}),...(options.readNativeRoute?{readNativeRoute:options.readNativeRoute}:{}),...(options.news?{news:options.news}:{}),...(options.projectUpdates?{projectUpdates:options.projectUpdates}:{}),timers:{setInterval:(fn,ms)=>{intervalMs=ms;timer=fn;timerStarts++;return {unref(){}};},clearInterval:()=>{timer=undefined;timerStops++;}}});}});
  let count=0;const signal=()=>new AbortController().signal;
  const nativeTool=async(args,agent=owner,callId=`synthetic-call-${++count}`)=>{const r=await ctx.tools.execute({callId,name:'project_companion',arguments:args,agent,signal:signal()});assert.equal(r.isError,false,JSON.stringify(r));return r;};
  const tool=async(...args)=>(await nativeTool(...args)).value;
  const command=async(raw,agent=owner)=>{const r=await ctx.commands.execute(agent,`/companion ${raw}`,[],signal());assert.ok(r);return r.result;};
  const close=()=>ctx.fiber.dispose();
  if(!options.keep)t.after(async()=>{await close();await rm(root,{recursive:true,force:true});});
  return {root,ctx,owner,live,registry,known,directories,disableWeChat,sent,accepted,tool,nativeTool,command,adapter,close,lifecycle,time:v=>{now=new Date(v);},tick:async()=>{assert.ok(timer,'timer must be armed');await timer();},interval:()=>intervalMs,timers:()=>({starts:timerStarts,stops:timerStops,active:!!timer})};
}

function addLive(h,id,cwd,{status='idle',origin}={}){
  const session=h.ctx.sessions.create(SessionId(id),{meta:{cwd,...(origin?{origin}:{})}});
  const agent={id:session.id,session,ctx:h.ctx,status,followup:message=>{h.accepted.push(message);agent.status='running';}};
  h.live.set(id,agent);return agent;
}
async function otherProject(h,label='另一个项目'){
  const root=join(h.root,label);await mkdir(root,{recursive:true});await writeFile(join(root,'README.md'),'SYNTHETIC target');return root;
}
function syntheticFactory(h,{root,logged={provider:'saved-provider',model:'saved-model'},failResume=false,resumeRoot=root}={}){
  const calls=[];const mounted=[];const owned=[];
  h.ctx.provide('agentPresets',{defaultId:'default-preset',mount:async(_scope,id)=>{mounted.push(id);}});
  h.ctx.provide('agentDefaultModel',{currentSelection:()=>({provider:'default-provider',model:'default-model'})});
  h.ctx.provide('sessionPersistence',{});
  const spawn=async(kind,options)=>{
    calls.push({kind,options});if(kind==='resume'&&failResume)throw new Error('SYNTHETIC persisted session unavailable');
    const id=String(options.resumeSessionId??options.sessionId);
    const session={id,header:{cwd:kind==='resume'?resumeRoot:options.meta.cwd,agentPreset:kind==='resume'?'saved-preset':options.meta.agentPreset},requestHeader:()=>kind==='resume'?{config:logged}:undefined};
    const agent={id,session,status:'idle',options:options.agentOptions??{},followup:message=>{h.accepted.push(message);agent.status='running';}};
    const scoped=createScope(h.ctx,agent);agent.ctx=scoped.ctx;
    try{await options.setup(scoped.ctx,agent);}catch(error){await scoped.dispose();throw error;}
    h.live.set(id,agent);let disposed=false;
    const dispose=async()=>{if(disposed)return;disposed=true;h.live.delete(id);await scoped.dispose();};
    owned.push(dispose);return{agent,dispose};
  };
  h.registry.resume=options=>spawn('resume',options);h.registry.create=options=>spawn('create',options);
  // The fake factory deliberately never starts a driver or model.
  return{calls,mounted,owned};
}

function projectSnapshots(h,values){
  const calls=[];
  h.ctx.provide('sessionProjections',{
    snapshot(session,keys){
      calls.push({session,keys});
      const value=values.get(String(session.id));
      if(value instanceof Error)throw value;
      return{asOfSeq:session.seq-1,values:value??{}};
    },
    cachedSnapshot(){assert.fail('routing must read the current public snapshot');},
  });
  return calls;
}

const priorBinding={userHash:'d'.repeat(64),botHash:'e'.repeat(64)};
async function completedTarget(h,root,targetSessionId,{binding=priorBinding,callId='synthetic-prior-call'}={}){
  const tracker=h.adapter.taskResults;
  const prepared=await tracker.prepare({originSessionId:String(h.owner.id),originToolCallId:callId,targetSessionId,targetMessageId:`${callId}-message`,projectRoot:root,projectLabel:'SYNTHETIC continuation project',task:'SYNTHETIC prior explicit task',returnBinding:binding});
  await tracker.admitted(prepared.job.id);await tracker.claimed({sessionId:targetSessionId,messageId:prepared.job.targetMessageId,turn:5,sourceKind:'user'});
  await tracker.observe({sessionId:targetSessionId,type:'assistant',turn:5,text:'SYNTHETIC prior completed response'});await tracker.observe({sessionId:targetSessionId,type:'turn/end',turn:5,reason:{kind:'completed'}});
}

test('multiple cold project histories resume only the original binding owned last completed target',async t=>{
  const h=await openHost(t,{readBinding:async()=>priorBinding});const root=await otherProject(h,'cold trusted continuation');
  const chosen=addLive(h,'synthetic-trusted-cold',root),other=addLive(h,'synthetic-unselected-cold',root);
  await h.tool({action:'watch',project:root});await completedTarget(h,root,String(chosen.id));h.live.delete(chosen.id);h.live.delete(other.id);
  const factory=syntheticFactory(h,{root});const result=await h.tool({action:'coordinate',project:root,task:'SYNTHETIC continue the established work',userRequested:true});
  assert.equal(result.status,'accepted');assert.equal(factory.calls.length,1);assert.equal(factory.calls[0].options.resumeSessionId,chosen.id);assert.equal(h.accepted.length,1);assert.match(result.lifecycle,/插件|卸载/);
});

test('trusted continuation does not bypass an occupied target for another idle project session',async t=>{
  const h=await openHost(t,{readBinding:async()=>priorBinding});const root=await otherProject(h,'busy trusted continuation');
  const selected=addLive(h,'synthetic-trusted-busy',root),other=addLive(h,'synthetic-other-idle',root);
  await h.tool({action:'watch',project:root});await completedTarget(h,root,String(selected.id));selected.status='running';
  const result=await h.tool({action:'coordinate',project:root,task:'SYNTHETIC continue without interrupting',userRequested:true});
  assert.equal(result.status,'busy');assert.equal(h.accepted.length,0);assert.equal(other.status,'idle');
});

test('explicit live session choice overrides a proven previous target',async t=>{
  const h=await openHost(t,{readBinding:async()=>priorBinding});const root=await otherProject(h,'explicit trusted override');
  const prior=addLive(h,'synthetic-prior-selected',root),explicit=addLive(h,'synthetic-explicit-selected',root);
  await h.tool({action:'watch',project:root});await completedTarget(h,root,String(prior.id));
  const result=await h.tool({action:'coordinate',project:root,session:String(explicit.id),task:'SYNTHETIC explicit user choice',userRequested:true});
  assert.equal(result.sessionId,explicit.id);assert.equal(prior.status,'idle');assert.equal(explicit.status,'running');
});

test('changed original binding invalidates a proven cold target before resume',async t=>{
  let binding=priorBinding;const h=await openHost(t,{readBinding:async()=>binding});const root=await otherProject(h,'trusted lookup race');
  const prior=addLive(h,'synthetic-lookup-prior',root),other=addLive(h,'synthetic-lookup-other',root);
  await h.tool({action:'watch',project:root});await completedTarget(h,root,String(prior.id));h.live.delete(prior.id);h.live.delete(other.id);const factory=syntheticFactory(h,{root});
  const lookup=h.adapter.taskResults.trustedLastTarget;
  h.adapter.taskResults.trustedLastTarget=async scope=>{const result=await lookup(scope);binding={...priorBinding,botHash:'f'.repeat(64)};return result;};
  const result=await h.tool({action:'coordinate',project:root,task:'SYNTHETIC do not recover after rebinding',userRequested:true});
  assert.equal(result.status,'blocked');assert.equal(factory.calls.length,0);assert.equal(h.accepted.length,0);
});

test('binding changes during cold preset mounting dispose the unsubmitted owned target',async t=>{
  let binding=priorBinding;const h=await openHost(t,{readBinding:async()=>binding});const root=await otherProject(h,'trusted mounting race');
  const prior=addLive(h,'synthetic-mount-prior',root),other=addLive(h,'synthetic-mount-other',root);
  await h.tool({action:'watch',project:root});await completedTarget(h,root,String(prior.id));h.live.delete(prior.id);h.live.delete(other.id);const factory=syntheticFactory(h,{root});
  h.ctx.get('agentPresets').mount=async()=>{binding={...priorBinding,userHash:'f'.repeat(64)};};
  const result=await h.tool({action:'coordinate',project:root,task:'SYNTHETIC do not submit after mounting race',userRequested:true});
  assert.equal(result.status,'blocked');assert.equal(factory.calls.length,1);assert.equal(h.accepted.length,0);assert.equal(h.live.has(prior.id),false);
  assert.equal((await h.adapter.taskResults.status(String(h.owner.id))).jobs.length,1,'no new admission prepared after source binding changed');
});

test('binding changes while persisting trusted admission stop final followup and dispose a cold owned target',async t=>{
  let binding=priorBinding;const h=await openHost(t,{readBinding:async()=>binding});const root=await otherProject(h,'trusted preparation race');
  const prior=addLive(h,'synthetic-prepare-prior',root),other=addLive(h,'synthetic-prepare-other',root);
  await h.tool({action:'watch',project:root});await completedTarget(h,root,String(prior.id));h.live.delete(prior.id);h.live.delete(other.id);syntheticFactory(h,{root});
  const prepare=h.adapter.taskResults.prepare;
  h.adapter.taskResults.prepare=async value=>{const result=await prepare(value);binding={...priorBinding,botHash:'f'.repeat(64)};return result;};
  const result=await h.tool({action:'coordinate',project:root,task:'SYNTHETIC final admission binding gate',userRequested:true});
  assert.equal(result.status,'blocked');assert.equal(h.accepted.length,0);assert.equal(h.live.has(prior.id),false);
  assert.equal((await h.adapter.taskResults.status(String(h.owner.id))).jobs.at(-1).status,'not_admitted');
});

test('unwatch while persisting a trusted admission prevents followup without restoring the subscription',async t=>{
  const h=await openHost(t,{readBinding:async()=>priorBinding});const root=await otherProject(h,'trusted unwatch preparation race');
  const prior=addLive(h,'synthetic-unwatch-prior',root);addLive(h,'synthetic-unwatch-other',root);
  await h.tool({action:'watch',project:root});await completedTarget(h,root,String(prior.id));
  const prepare=h.adapter.taskResults.prepare;
  h.adapter.taskResults.prepare=async value=>{const result=await prepare(value);await h.tool({action:'unwatch',project:root});return result;};
  const result=await h.tool({action:'coordinate',project:root,task:'SYNTHETIC stop after unwatch during durable preparation',userRequested:true});
  assert.equal(result.status,'blocked');assert.equal(h.accepted.length,0);assert.equal(prior.status,'idle');
  assert.equal((await h.tool({action:'status'})).projects.length,0);
  assert.equal((await h.adapter.taskResults.status(String(h.owner.id))).jobs.at(-1).status,'not_admitted');
});

test('membership revoked while persisting a trusted admission prevents final followup',async t=>{
  const h=await openHost(t,{readBinding:async()=>priorBinding});const root=await otherProject(h,'trusted revoked membership race');
  const prior=addLive(h,'synthetic-revoked-prior',root);addLive(h,'synthetic-revoked-other',root);
  await h.tool({action:'watch',project:root});await completedTarget(h,root,String(prior.id));
  let revoked=false;const lookup=h.adapter.service.coordinationTarget;const prepare=h.adapter.taskResults.prepare;
  h.adapter.service.coordinationTarget=async reference=>{const result=await lookup(reference);return revoked&&result?{...result,sessionIds:result.sessionIds.filter(id=>id!==String(prior.id))}:result;};
  h.adapter.taskResults.prepare=async value=>{const result=await prepare(value);revoked=true;return result;};
  const result=await h.tool({action:'coordinate',project:root,task:'SYNTHETIC stop after target membership revocation',userRequested:true});
  assert.equal(result.status,'blocked');assert.equal(h.accepted.length,0);assert.equal(prior.status,'idle');
  assert.equal((await h.adapter.taskResults.status(String(h.owner.id))).jobs.at(-1).status,'not_admitted');
});

for(const cold of [false,true])test(`unwatch during the final binding read blocks ${cold?'cold':'live'} admission using current service state`,async t=>{
  let armed=false,revoked=false,revoke=async()=>{};
  const h=await openHost(t,{readBinding:async()=>{if(armed&&!revoked){revoked=true;await revoke();}return priorBinding;}});
  const root=await otherProject(h,`final binding unwatch ${cold?'cold':'live'}`);
  const prior=addLive(h,`synthetic-late-prior-${cold}`,root),other=addLive(h,`synthetic-late-other-${cold}`,root);
  await h.tool({action:'watch',project:root});await completedTarget(h,root,String(prior.id));
  if(cold){h.live.delete(prior.id);h.live.delete(other.id);syntheticFactory(h,{root});}
  revoke=()=>h.tool({action:'unwatch',project:root});
  const prepare=h.adapter.taskResults.prepare;h.adapter.taskResults.prepare=async value=>{const result=await prepare(value);armed=true;return result;};
  const result=await h.tool({action:'coordinate',project:root,task:'SYNTHETIC stop despite an earlier valid project snapshot',userRequested:true});
  assert.equal(revoked,true);assert.equal(result.status,'blocked');assert.equal(h.accepted.length,0);
  assert.equal((await h.tool({action:'status'})).projects.length,0);
  assert.equal((await h.adapter.taskResults.status(String(h.owner.id))).jobs.at(-1).status,'not_admitted');
  if(cold)assert.equal(h.live.has(prior.id),false);
});

test('a trusted cold restore never re-watches a project removed while validating its restored binding',async t=>{
  let revoke=async()=>{},afterResumeReads=0,removed=false,restoring=false;
  const h=await openHost(t,{readBinding:async()=>{
    if(restoring&&h.live.has('synthetic-cold-no-rewatch')&&++afterResumeReads===1){removed=true;await revoke();}
    return priorBinding;
  }});
  const root=await otherProject(h,'trusted restore no rewatch');const prior=addLive(h,'synthetic-cold-no-rewatch',root),other=addLive(h,'synthetic-cold-no-rewatch-other',root);
  await h.tool({action:'watch',project:root});await completedTarget(h,root,String(prior.id));h.live.delete(prior.id);h.live.delete(other.id);syntheticFactory(h,{root});
  // Arm only after the seed session has become a cold, plugin-owned restore.
  restoring=true;revoke=()=>h.tool({action:'unwatch',project:root});
  const result=await h.tool({action:'coordinate',project:root,task:'SYNTHETIC preserve explicit unwatch during restoration',userRequested:true});
  assert.equal(removed,true);assert.equal(result.status,'blocked');assert.equal(h.accepted.length,0);assert.equal(h.live.has(prior.id),false);
  assert.equal((await h.tool({action:'status'})).projects.length,0,'an unwatch must not be undone by recovery accounting');
});

test('admission fails closed without the service synchronous coordination gate',async t=>{
  const h=await openHost(t);const root=await otherProject(h,'missing final service gate');addLive(h,'synthetic-missing-gate',root);
  h.adapter.service.canCoordinate=undefined;
  const result=await h.tool({action:'coordinate',project:root,task:'SYNTHETIC require a synchronous current membership check',userRequested:true});
  assert.equal(result.status,'blocked');assert.equal(h.accepted.length,0);
  assert.equal((await h.adapter.taskResults.status(String(h.owner.id))).jobs.at(-1).status,'not_admitted');
});

test('a cold target whose trusted route disappears at submit is released before admission',async t=>{
  const h=await openHost(t,{readBinding:async()=>priorBinding});const root=await otherProject(h,'cold submit route rejection');
  const prior=addLive(h,'synthetic-submit-prior',root),other=addLive(h,'synthetic-submit-other',root);
  await h.tool({action:'watch',project:root});await completedTarget(h,root,String(prior.id));h.live.delete(prior.id);h.live.delete(other.id);syntheticFactory(h,{root});
  let restoredReads=0;const lookup=h.adapter.service.coordinationTarget;
  h.adapter.service.coordinationTarget=async reference=>{
    // The first two post-resume gates pass; revoke at submit's own initial gate.
    if(h.live.has(prior.id)&&++restoredReads===3)await h.tool({action:'unwatch',project:root});
    return lookup(reference);
  };
  const result=await h.tool({action:'coordinate',project:root,task:'SYNTHETIC release a definitely unsubmitted restore',userRequested:true});
  assert.equal(result.status,'blocked');assert.ok(restoredReads>=3);assert.equal(h.accepted.length,0);assert.equal(h.live.has(prior.id),false);
  assert.equal((await h.adapter.taskResults.status(String(h.owner.id))).jobs.length,1);
});

test('an uncertain cold inbox admission is retained even when recording uncertainty fails',async t=>{
  const h=await openHost(t);const root=await otherProject(h,'cold uncertain admission ownership');const prior=addLive(h,'synthetic-uncertain-cold',root);
  await h.tool({action:'watch',project:root});h.live.delete(prior.id);syntheticFactory(h,{root});
  const resume=h.registry.resume;
  h.registry.resume=async options=>{const handle=await resume(options);handle.agent.followup=message=>{h.accepted.push(message);handle.agent.status='running';throw new Error('SYNTHETIC inbox acknowledgement unavailable');};return handle;};
  h.adapter.taskResults.notAdmitted=async()=>{throw new Error('SYNTHETIC uncertainty persistence unavailable');};
  const result=await h.tool({action:'coordinate',project:root,task:'SYNTHETIC do not dispose potentially accepted work',userRequested:true});
  assert.equal(result.accepted,false);assert.equal(h.accepted.length,1);assert.equal(h.live.has(prior.id),true);assert.equal(h.live.get(prior.id).status,'running');
  assert.match(result.text,/不确定|确认/);assert.doesNotMatch(result.text,/尚未提交任务/);
});

test('completed ledger target outside current project membership is not restored or replaced',async t=>{
  const h=await openHost(t,{readBinding:async()=>priorBinding});const root=await otherProject(h,'trusted membership boundary');
  const a=addLive(h,'synthetic-member-a',root),b=addLive(h,'synthetic-member-b',root);
  await h.tool({action:'watch',project:root});await completedTarget(h,root,'synthetic-former-member');h.live.delete(a.id);h.live.delete(b.id);const factory=syntheticFactory(h,{root});
  const result=await h.tool({action:'coordinate',project:root,task:'SYNTHETIC do not select foreign history',userRequested:true});
  assert.equal(result.status,'blocked');assert.equal(factory.calls.length,0);assert.equal(h.accepted.length,0);
});

test('natural-language guidance refreshes host time and obeys tool scope and plugin disposal',async t=>{
  const h=await openHost(t,{hostTimeZone:'Asia/Shanghai'});
  const prompt=async agent=>(await h.ctx.systemPrompt.assemble({scope:agent,agent})).sections.filter(x=>x.name==='project-companion:guidance').map(x=>x.text).join('');
  assert.match(await prompt(h.owner),/自然语言/);assert.match(await prompt(h.owner),/2026-10-18T15:00:00.000Z/);assert.match(await prompt(h.owner),/Asia\/Shanghai/);
  assert.match(await prompt(h.owner),/会话标题/);assert.match(await prompt(h.owner),/session/);
  h.time('2026-10-18T15:02:00Z');assert.match(await prompt(h.owner),/15:02:00/);
  const hidden={id:'hidden',session:h.owner.session};const scoped=createScope(h.ctx,hidden);hidden.ctx=scoped.ctx;
  scoped.ctx.get('tools').restrict({deny:['project_companion']});assert.equal(await prompt(hidden),'');
  await scoped.dispose();await h.lifecycle.dispose();assert.equal(await prompt(h.owner),'');
});

test('model tool accepts relative reminders and host timezone defaults without rebinding WeChat for reads',async t=>{
  const h=await openHost(t,{hostTimeZone:'Asia/Shanghai'});await h.disableWeChat();
  assert.ok(h.ctx.tools.schemas(h.owner).find(x=>x.name==='project_companion').parameters.properties.delayMinutes);
  assert.ok((await h.tool({action:'list'})).candidates.length);await h.tool({action:'watch',project:'synthetic-project'});
  assert.match((await h.tool({action:'digest',project:'synthetic-project'})).text,/SYNTHETIC/);
  const reminder=await h.tool({action:'remind',delayMinutes:2,title:'合成口述提醒'});
  assert.equal(reminder.reminder.dueAt,'2026-10-18T15:02:00.000Z');
  const daily=await h.tool({action:'configure_daily',time:'09:30'});assert.equal(daily.daily.timeZone,'Asia/Shanghai');
  assert.equal(h.sent.length,0);
});

test('cancel_daily is available through model tools and human commands without pausing reminders',async t=>{
  const h=await openHost(t);
  const schema=h.ctx.tools.schemas(h.owner).find(tool=>tool.name==='project_companion');
  assert.ok(schema.parameters.properties.action.enum.includes('cancel_daily'));
  const prompt=(await h.ctx.systemPrompt.assemble({scope:h.owner,agent:h.owner})).sections.find(section=>section.name==='project-companion:guidance').text;
  assert.match(prompt,/取消.*cancel_daily|cancel_daily.*取消/);
  await h.tool({action:'watch'});await h.tool({action:'configure_daily',time:'15:01',timeZone:'UTC'});
  const cancelled=await h.tool({action:'cancel_daily'});assert.equal(cancelled.daily,null);assert.equal(cancelled.paused,false);assert.equal(h.timers().active,false);
  await h.tool({action:'remind',delayMinutes:2,title:'保留提醒'});assert.equal(h.timers().active,true);
  await h.tool({action:'configure_daily',time:'15:01',timeZone:'UTC'});
  assert.equal((await h.command('daily off')).kind,'success');
  const status=await h.tool({action:'status'});assert.equal(status.daily,null);assert.equal(status.projects.length,1);assert.equal(status.counts.activeReminders,1);
  h.time('2026-10-18T15:02:00Z');await h.tick();assert.equal(h.sent.length,1);
});

test('daily off remains available as a host command in PTC mode',async t=>{
  const h=await openHost(t,{mode:'ptc'});
  assert.equal((await h.command('daily 15:01 UTC')).kind,'success');assert.equal(h.timers().active,true);
  assert.equal((await h.command('daily off')).kind,'success');assert.equal(h.timers().active,false);
  const status=await h.adapter.service.act({sessionId:h.owner.id,cwd:h.owner.session.header.cwd},{action:'status'});
  assert.equal(status.daily,null);assert.equal(status.paused,false);assert.equal(h.sent.length,0);
});

test('coordinate requires explicit user intent and never follows up into its current effective directory',async t=>{
  const h=await openHost(t);const effective=await otherProject(h,'正在口述的项目');h.directories.set(h.owner.id,effective);h.owner.status='running';
  const denied=await h.tool({action:'coordinate',project:'正在口述的项目',task:'只查询不派工'});
  assert.equal(denied.status,'blocked');assert.equal((await h.tool({action:'status'})).projects.length,0);
  const result=await h.tool({action:'coordinate',project:'正在口述的项目',task:'检查当前项目验收项',userRequested:true});
  assert.equal(result.status,'current_session');assert.equal(result.accepted,false);assert.equal(h.accepted.length,0);
  assert.match(result.text,/当前会话|直接继续/);
});

test('coordinate resolves a friendly project name and hands off once to a unique idle other session',async t=>{
  const h=await openHost(t);const root=await otherProject(h,'报告项目');const target=addLive(h,'synthetic-report-session',root);
  const result=await h.tool({action:'coordinate',project:'报告项目',task:'检查README中的验收项',userRequested:true});
  assert.equal(result.status,'accepted');assert.equal(result.sessionId,target.id);assert.equal(h.accepted.length,1);
  assert.equal(h.accepted[0].source.kind,'user');assert.match(h.accepted[0].content[0].text,/检查README/);
  const busy=await h.tool({action:'coordinate',project:'报告项目',task:'另一个任务',userRequested:true});assert.equal(busy.status,'busy');assert.equal(h.accepted.length,1);
});

test('coordinate explains ambiguous idle sessions and never interrupts a busy target',async t=>{
  const h=await openHost(t);const root=await otherProject(h,'多个会话的项目');const a=addLive(h,'synthetic-a',root);const b=addLive(h,'synthetic-b',root);
  let result=await h.tool({action:'coordinate',project:'多个会话的项目',task:'检查验收项',userRequested:true});assert.equal(result.status,'ambiguous');assert.equal(h.accepted.length,0);
  a.status='running';b.status='running';result=await h.tool({action:'coordinate',project:'多个会话的项目',task:'不要抢任务',userRequested:true});assert.equal(result.status,'busy');assert.equal(h.accepted.length,0);
});

test('coordinate prefers the sole used idle session only when every other idle session is currently proven blank',async t=>{
  const h=await openHost(t);const root=await otherProject(h,'空白与已有会话');const blank=addLive(h,'synthetic-initialized-blank',root);const used=addLive(h,'synthetic-readme-used',root);
  const views=new Map([
    [blank.id,{sessionListMetadata:{blank:true,lastPromptAt:null},title:null}],
    [used.id,{sessionListMetadata:{blank:false,lastPromptAt:1770000000000},title:'README 验收检查'}],
  ]);
  const calls=projectSnapshots(h,views);const factory=syntheticFactory(h,{root});const before=[...h.live.keys()];
  const result=await h.tool({action:'coordinate',project:'空白与已有会话',task:'只读检查公开README',userRequested:true});
  assert.equal(result.status,'accepted');assert.equal(result.sessionId,used.id);assert.equal(h.accepted.length,1);assert.equal(blank.status,'idle');
  assert.deepEqual(calls.map(x=>x.session),[blank.session,used.session]);assert.ok(calls.every(x=>JSON.stringify(x.keys)===JSON.stringify(['sessionListMetadata','title'])));
  assert.deepEqual(factory.calls,[]);assert.deepEqual([...h.live.keys()],before);
});

test('coordinate returns friendly structured candidates when two idle sessions are used',async t=>{
  const h=await openHost(t);const root=await otherProject(h,'两段已有工作');const a=addLive(h,'synthetic-two-used-a',root);const b=addLive(h,'synthetic-two-used-b',root);
  projectSnapshots(h,new Map([[a.id,{sessionListMetadata:{blank:false,lastPromptAt:1},title:'README 检查'}],[b.id,{sessionListMetadata:{blank:false,lastPromptAt:2},title:'发布准备'}]]));
  const result=await h.tool({action:'coordinate',project:'两段已有工作',task:'只读检查',userRequested:true});
  assert.equal(result.status,'ambiguous');assert.equal(result.accepted,false);assert.equal(h.accepted.length,0);
  assert.ok(Array.isArray(result.candidates),'ambiguous routing must expose structured candidates');
  assert.deepEqual(result.candidates.map(x=>({sessionId:x.sessionId,title:x.title,status:x.status})),[{sessionId:a.id,title:'README 检查',status:'idle'},{sessionId:b.id,title:'发布准备',status:'idle'}]);
  assert.match(result.text,/README 检查/);assert.match(result.text,/发布准备/);assert.doesNotMatch(result.text,/synthetic-|\/s|ID/);
});

test('coordinate keeps missing invalid or throwing current metadata unknown and never infers blank from a missing title',async t=>{
  for(const value of [{title:null},{sessionListMetadata:{blank:true},title:null},{sessionListMetadata:{blank:true,lastPromptAt:'invalid'},title:null},{sessionListMetadata:{blank:'true',lastPromptAt:null},title:null},new Error('SYNTHETIC snapshot failure')]){
    const h=await openHost(t);const root=await otherProject(h,'不可判定会话');const used=addLive(h,'synthetic-proven-used',root);const other=addLive(h,'synthetic-unknown',root);
    projectSnapshots(h,new Map([[used.id,{sessionListMetadata:{blank:false,lastPromptAt:1},title:'README 检查'}],[other.id,value]]));
    const result=await h.tool({action:'coordinate',project:'不可判定会话',task:'不猜目标',userRequested:true});
    assert.equal(result.status,'ambiguous');assert.equal(result.accepted,false);assert.equal(h.accepted.length,0);assert.ok(Array.isArray(result.candidates),'unknown metadata must retain candidate choices');assert.equal(result.candidates.length,2);
  }
});

test('coordinate session selector accepts an exact friendly title or known live id within the target project',async t=>{
  const h=await openHost(t);const root=await otherProject(h,'按标题选会话');const a=addLive(h,'synthetic-title-readme',root);const b=addLive(h,'synthetic-title-release',root);
  projectSnapshots(h,new Map([[a.id,{sessionListMetadata:{blank:false,lastPromptAt:1},title:'README 检查'}],[b.id,{sessionListMetadata:{blank:false,lastPromptAt:2},title:'发布准备'}]]));
  assert.ok(h.ctx.tools.schemas(h.owner).find(x=>x.name==='project_companion').parameters.properties.session);
  const chosen=await h.tool({action:'coordinate',project:'按标题选会话',session:'README 检查',task:'只读README',userRequested:true});
  assert.equal(chosen.status,'accepted');assert.equal(chosen.sessionId,a.id);assert.equal(b.status,'idle');
  const internal=await h.tool({action:'coordinate',project:'按标题选会话',session:b.id,task:'只读发布清单',userRequested:true});
  assert.equal(internal.status,'accepted');assert.equal(internal.sessionId,b.id);assert.equal(h.accepted.length,2);
});

test('coordinate session selector refuses duplicate titles and partial title matches without fallback',async t=>{
  const h=await openHost(t);const root=await otherProject(h,'同名会话');const a=addLive(h,'synthetic-duplicate-title-a',root);const b=addLive(h,'synthetic-duplicate-title-b',root);
  projectSnapshots(h,new Map([[a.id,{sessionListMetadata:{blank:false,lastPromptAt:1},title:'README 检查'}],[b.id,{sessionListMetadata:{blank:true,lastPromptAt:null},title:'README 检查'}]]));
  const duplicate=await h.tool({action:'coordinate',project:'同名会话',session:'README 检查',task:'不猜同名',userRequested:true});
  assert.equal(duplicate.status,'ambiguous');assert.ok(Array.isArray(duplicate.candidates),'duplicate titles must retain candidate choices');assert.equal(duplicate.candidates.length,2);assert.equal(h.accepted.length,0);
  const partial=await h.tool({action:'coordinate',project:'同名会话',session:'README',task:'不猜简称',userRequested:true});
  assert.equal(partial.status,'blocked');assert.equal(h.accepted.length,0);
});

test('coordinate session selector never dispatches to busy foreign moved subagent or unavailable targets',async t=>{
  const h=await openHost(t);const root=await otherProject(h,'选择边界');const otherRoot=await otherProject(h,'别的项目');const idle=addLive(h,'synthetic-boundary-idle',root);const busy=addLive(h,'synthetic-boundary-busy',root,{status:'running'});const foreign=addLive(h,'synthetic-boundary-foreign',otherRoot);const moved=addLive(h,'synthetic-boundary-moved',root);const subagent=addLive(h,'synthetic-boundary-subagent',root,{origin:'subagent'});
  await h.tool({action:'watch',project:'选择边界'});h.directories.set(moved.id,otherRoot);
  projectSnapshots(h,new Map([[idle.id,{title:'README 检查'}],[busy.id,{title:'正在执行'}],[foreign.id,{title:'外部标题'}],[moved.id,{title:'已切目录'}],[subagent.id,{title:'子任务'}]]));
  const factory=syntheticFactory(h,{root});const before=[...h.live.keys()];
  for(const session of ['正在执行',foreign.id,'外部标题',moved.id,subagent.id,'不存在的标题']){
    const result=await h.tool({action:'coordinate',project:'选择边界',session,task:'不回退派工',userRequested:true});
    assert.equal(result.accepted,false,session);assert.equal(result.status,session==='正在执行'?'busy':'blocked',session);
  }
  assert.equal(h.accepted.length,0);assert.deepEqual(factory.calls,[]);assert.deepEqual([...h.live.keys()],before);assert.equal(idle.status,'idle');
});

test('coordinate selector can choose another same-project session while its own selected session stays current_session',async t=>{
  const h=await openHost(t);const target=addLive(h,'synthetic-same-project-choice',h.owner.session.header.cwd);
  projectSnapshots(h,new Map([[h.owner.id,{title:'当前口述'}],[target.id,{title:'README 检查'}]]));
  const current=await h.tool({action:'coordinate',session:'当前口述',task:'当前直接继续',userRequested:true});
  assert.equal(current.status,'current_session');assert.equal(h.accepted.length,0);
  const chosen=await h.tool({action:'coordinate',session:'README 检查',task:'交给选定会话',userRequested:true});
  assert.equal(chosen.status,'accepted');assert.equal(chosen.sessionId,target.id);assert.equal(h.accepted.length,1);
});

test('coordinate does not treat unnamed display fallback as proof of blank or as a selectable title',async t=>{
  const h=await openHost(t);const root=await otherProject(h,'未命名会话');const a=addLive(h,'synthetic-unnamed-a',root);const b=addLive(h,'synthetic-unnamed-b',root);
  projectSnapshots(h,new Map([[a.id,{sessionListMetadata:{blank:false,lastPromptAt:1},title:null}],[b.id,{title:null}]]));
  const ambiguous=await h.tool({action:'coordinate',project:'未命名会话',task:'不能从标题猜空白',userRequested:true});
  assert.equal(ambiguous.status,'ambiguous');assert.ok(Array.isArray(ambiguous.candidates),'unnamed sessions must remain explicit candidates');assert.equal(ambiguous.candidates.length,2);assert.ok(ambiguous.candidates.every(x=>typeof x.title==='string'&&x.title));assert.doesNotMatch(ambiguous.text,/synthetic-|\/s|ID/);
  assert.match(ambiguous.text,/第几段/);assert.match(ambiguous.text,/1\. 未命名会话/);assert.match(ambiguous.text,/2\. 未命名会话/);assert.doesNotMatch(ambiguous.text,/电脑.*标题|重命名/);
  const fallback=await h.tool({action:'coordinate',project:'未命名会话',session:ambiguous.candidates[0].title,task:'没有真实标题就不猜',userRequested:true});
  assert.equal(fallback.accepted,false);assert.equal(h.accepted.length,0);
});

test('coordinate bounds numbered candidate titles and accepts the known id after an ordinary numbered choice',async t=>{
  const h=await openHost(t);const root=await otherProject(h,'长标题会话');const a=addLive(h,'synthetic-long-title-a',root);const b=addLive(h,'synthetic-long-title-b',root);const title='这是公开项目的长会话标题'.repeat(100);
  projectSnapshots(h,new Map([[a.id,{sessionListMetadata:{blank:false,lastPromptAt:1},title}],[b.id,{sessionListMetadata:{blank:false,lastPromptAt:2},title}]]));
  const ambiguous=await h.tool({action:'coordinate',project:'长标题会话',task:'先选哪段工作',userRequested:true});
  assert.equal(ambiguous.status,'ambiguous');assert.ok(Array.isArray(ambiguous.candidates));assert.ok(ambiguous.candidates.every(x=>x.title.length<=120));assert.ok(ambiguous.text.length<500);assert.doesNotMatch(ambiguous.text,/电脑.*标题|重命名/);
  const chosen=await h.tool({action:'coordinate',project:'长标题会话',session:ambiguous.candidates[1].sessionId,task:'用户选择了第二段工作',userRequested:true});
  assert.equal(chosen.status,'accepted');assert.equal(chosen.sessionId,b.id);assert.equal(a.status,'idle');assert.equal(h.accepted.length,1);
});

test('coordinate keeps a title equal to another candidate id ambiguous instead of silently preferring the id',async t=>{
  const h=await openHost(t);const root=await otherProject(h,'标题身份碰撞');const a=addLive(h,'synthetic-collision-a',root);const b=addLive(h,'synthetic-collision-b',root);
  projectSnapshots(h,new Map([[a.id,{title:b.id}],[b.id,{title:'README 检查'}]]));
  const result=await h.tool({action:'coordinate',project:'标题身份碰撞',session:b.id,task:'不猜用户所指',userRequested:true});
  assert.equal(result.status,'ambiguous');assert.equal(result.accepted,false);assert.equal(result.candidates.length,2);assert.equal(h.accepted.length,0);
});

test('native model content retains the numbered internal candidate mapping while its primary text stays human friendly',async t=>{
  const h=await openHost(t);const root=await otherProject(h,'模型选择会话');const otherRoot=await otherProject(h,'无关会话项目');const a=addLive(h,'synthetic-native-choice-a',root);const b=addLive(h,'synthetic-native-choice-b',root);const foreign=addLive(h,'synthetic-native-choice-foreign',otherRoot);
  projectSnapshots(h,new Map([[a.id,{title:null}],[b.id,{title:null}],[foreign.id,{title:'MUST_NOT_RENDER_FOREIGN_TITLE'}]]));
  const result=await h.nativeTool({action:'coordinate',project:'模型选择会话',task:'先问第几段',userRequested:true});
  assert.equal(result.value.status,'ambiguous');assert.equal(result.content[0].text,result.value.text);assert.doesNotMatch(result.content[0].text,/synthetic-native-choice/);
  assert.equal(result.content.length,2,'Native model content must include the internal selection index');
  assert.match(result.content[1].text,/助手内部索引|不要.*用户/);
  const index=JSON.parse(result.content[1].text.split('\n').at(-1));
  assert.deepEqual(index,[{number:1,sessionId:a.id,title:'未命名会话',status:'idle'},{number:2,sessionId:b.id,title:'未命名会话',status:'idle'}]);
  assert.doesNotMatch(JSON.stringify(result.content),/MUST_NOT_RENDER_FOREIGN_TITLE|synthetic-native-choice-foreign/);
  const chosen=await h.nativeTool({action:'coordinate',project:'模型选择会话',session:index[1].sessionId,task:'用户选择第二段',userRequested:true});
  assert.equal(chosen.value.status,'accepted');assert.equal(chosen.value.sessionId,b.id);assert.equal(chosen.content.length,1);assert.equal(h.accepted.length,1);
  assert.equal((await h.nativeTool({action:'list'})).content.length,1,'unrelated reads must not gain internal selection blocks');
});

test('a cold known session blocks plainly when native preset or resume services are unavailable',async t=>{
  const h=await openHost(t);const root=await otherProject(h,'待恢复项目');const target=addLive(h,'synthetic-cold',root);
  await h.tool({action:'watch',project:'待恢复项目'});h.live.delete(target.id);
  const result=await h.tool({action:'coordinate',project:'待恢复项目',task:'检查验收项',userRequested:true});
  assert.equal(result.status,'blocked');assert.match(result.text,/恢复|配置/);assert.equal(h.accepted.length,0);
});

test('explicit coordination resumes only its unique known session and mounts its preset and saved model',async t=>{
  const h=await openHost(t);const root=await otherProject(h,'恢复项目');const target=addLive(h,'synthetic-persisted',root);
  await h.tool({action:'watch',project:'恢复项目'});h.live.delete(target.id);
  const factory=syntheticFactory(h,{root});
  const result=await h.tool({action:'coordinate',project:'恢复项目',task:'检查验收项',userRequested:true});
  assert.equal(result.status,'accepted');assert.equal(factory.calls.length,1);assert.equal(factory.calls[0].kind,'resume');assert.equal(factory.calls[0].options.resumeSessionId,target.id);
  assert.deepEqual(factory.mounted,['saved-preset']);assert.equal(h.accepted.length,1);assert.match(result.lifecycle,/插件|卸载/);
  const resumed=h.live.get(target.id);const assembly=await h.ctx.systemPrompt.assemble({scope:resumed,agent:resumed});assert.equal(assembly.variables.provider,'saved-provider');assert.equal(assembly.variables.model,'saved-model');
  const request=await h.ctx.waterfall(scopeTarget(h.ctx,resumed),'agent/request',{},()=>Promise.resolve({}));assert.equal(request.provider,'saved-provider');assert.equal(request.model,'saved-model');
  const inherited=await h.ctx.waterfall(scopeTarget(h.ctx,resumed),'agent/request',{},()=>Promise.resolve({reasoningEffort:'max',syntheticOtherField:true}));assert.equal(inherited.reasoningEffort,undefined);assert.equal(inherited.syntheticOtherField,true);
  await h.lifecycle.dispose();assert.equal(h.live.has(target.id),false);
});

test('an explicit task creates one preset-composed session only for a known project without sessions',async t=>{
  const h=await openHost(t);const root=await otherProject(h,'没有会话的项目');const attached=[];
  h.known.push({id:'known-project',path:root,title:'没有会话的项目',sessionIds:[],attachSession:async id=>attached.push(id)});
  const factory=syntheticFactory(h,{root,logged:{}});
  const result=await h.tool({action:'coordinate',project:'没有会话的项目',task:'列出验收项',userRequested:true});
  assert.equal(result.status,'accepted');assert.equal(factory.calls.length,1);assert.equal(factory.calls[0].kind,'create');assert.equal(factory.calls[0].options.meta.cwd,root);assert.deepEqual(factory.mounted,['default-preset']);assert.equal(attached.length,1);
  const created=h.live.get(result.sessionId);const assembly=await h.ctx.systemPrompt.assemble({scope:created,agent:created});assert.equal(assembly.variables.model,'default-model');assert.equal(h.accepted.length,1);
});

test('concurrent friendly-name and internal-id requests cannot create two sessions for one cold project',async t=>{
  const h=await openHost(t);const root=await otherProject(h,'并发冷项目');h.known.push({id:'known-cold',path:root,title:'并发冷项目',sessionIds:[]});
  const watched=await h.tool({action:'watch',project:'并发冷项目'});const factory=syntheticFactory(h,{root});
  const started=Promise.withResolvers();const release=Promise.withResolvers();
  h.ctx.get('agentPresets').mount=async(_scope,id)=>{factory.mounted.push(id);started.resolve();await release.promise;};
  const first=h.tool({action:'coordinate',project:'并发冷项目',task:'第一个明确任务',userRequested:true});await started.promise;
  const second=h.tool({action:'coordinate',project:watched.project.id,task:'第二个明确任务',userRequested:true});
  await new Promise(resolve=>setTimeout(resolve,20));release.resolve();const results=await Promise.all([first,second]);
  assert.equal(factory.calls.length,1);assert.equal(h.accepted.length,1);assert.deepEqual(results.map(x=>x.status),['accepted','busy']);
});

test('failed cold resume never silently creates a replacement or reports acceptance',async t=>{
  const h=await openHost(t);const root=await otherProject(h,'恢复失败项目');const target=addLive(h,'synthetic-missing-persisted',root);await h.tool({action:'watch',project:'恢复失败项目'});h.live.delete(target.id);
  const factory=syntheticFactory(h,{root,failResume:true});
  const result=await h.tool({action:'coordinate',project:'恢复失败项目',task:'检查验收项',userRequested:true});
  assert.equal(result.status,'blocked');assert.equal(result.accepted,false);assert.deepEqual(factory.calls.map(x=>x.kind),['resume']);assert.equal(h.accepted.length,0);
});

test('resumed session with another effective directory is rejected and disposed before task admission',async t=>{
  const h=await openHost(t);const root=await otherProject(h,'目录一致性项目');const target=addLive(h,'synthetic-wrong-cwd',root);await h.tool({action:'watch',project:'目录一致性项目'});h.live.delete(target.id);
  const factory=syntheticFactory(h,{root,resumeRoot:h.root});
  const result=await h.tool({action:'coordinate',project:'目录一致性项目',task:'不能派错项目',userRequested:true});
  assert.equal(result.status,'blocked');assert.equal(factory.calls.length,1);assert.equal(h.accepted.length,0);assert.equal(h.live.has(target.id),false);
});

test('a restored effective directory may differ from its original workspace without reassigning workspace ownership',async t=>{
  const h=await openHost(t);const root=await otherProject(h,'切换后的项目');const original=await otherProject(h,'原始项目');const target=addLive(h,'synthetic-moved-session',original);h.directories.set(target.id,root);
  let attachments=0;h.known.push({id:'known-moved-project',path:root,title:'切换后的项目',sessionIds:[target.id],attachSession:async()=>{attachments++;throw new Error('Session original cwd belongs to another workspace');}});
  await h.tool({action:'watch',project:'切换后的项目'});h.live.delete(target.id);syntheticFactory(h,{root,resumeRoot:original});
  const result=await h.tool({action:'coordinate',project:'切换后的项目',task:'在当前有效目录检查验收项',userRequested:true});
  assert.equal(result.status,'accepted');assert.equal(attachments,0);assert.equal(h.accepted.length,1);
});

test('agentless tool calls cannot resume a cold project even with a userRequested argument',async t=>{
  const h=await openHost(t);const root=await otherProject(h,'需要真实调用方的项目');const target=addLive(h,'synthetic-no-caller',root);await h.tool({action:'watch',project:'需要真实调用方的项目'});h.live.delete(target.id);const factory=syntheticFactory(h,{root});
  const result=await h.ctx.tools.execute({callId:'synthetic-agentless-coordinate',name:'project_companion',arguments:{action:'coordinate',project:'需要真实调用方的项目',task:'没有调用方不能恢复',userRequested:true},signal:new AbortController().signal});
  assert.equal(result.isError,false);assert.equal(result.value.accepted,false);assert.equal(factory.calls.length,0);assert.equal(h.accepted.length,0);
});

test('native tools, ordinary commands, official session event feed and JSON storage work without a model',async t=>{
  const h=await openHost(t,{keep:true});
  t.after(async()=>{await h.close();await rm(h.root,{recursive:true,force:true});});
  assert.ok(h.ctx.tools.schemas(h.owner).some(x=>x.name==='project_companion'));
  assert.ok(h.ctx.commands.list(h.owner).some(x=>x.name==='companion'));
  assert.deepEqual(h.timers(),{starts:0,stops:0,active:false});
  const watched=await h.tool({action:'watch'});assert.match(watched.project.id,/^p_/);
  const msg=createUserMessage({content:[{type:'text',text:'SYNTHETIC user request'}],source:{kind:'user'}});
  h.owner.session.append('user/message',msg,{surfaceOp:'append'});
  const context=createUserMessage({content:[{type:'text',text:'TOOL_CONTEXT_MUST_NOT_BECOME_A_USER_REQUEST'}],source:{kind:'tool',callId:'synthetic-context-call'}});
  h.owner.session.append('user/message',context,{surfaceOp:'append'});
  await h.adapter.service.ready();
  const report=await h.tool({action:'digest'});assert.match(report.text,/SYNTHETIC user request/);assert.match(report.text,/README.md/);
  assert.equal(report.text.includes('TOOL_CONTEXT_MUST_NOT_BECOME_A_USER_REQUEST'),false);
  assert.equal((await h.command('now')).kind,'success');
  await h.close();
  const reopened=await openHost(t,{root:h.root,keep:true});
  const state=await reopened.tool({action:'status'});assert.equal(state.projects.length,1);assert.equal(state.projects[0].id,watched.project.id);
  await reopened.close();
});

test('one lifecycle timer sends through real tool pipeline with the bound live agent and disposes',async t=>{
  const h=await openHost(t);const results=[];h.ctx.on('tools/result',(execution)=>results.push(execution.name));
  await h.command('watch');
  assert.equal((await h.command('daily 09:00 America/Mexico_City')).kind,'success');
  assert.equal(h.timers().starts,1);
  await h.tick();await h.tick();assert.equal(h.sent.length,1);assert.equal(h.sent[0].agent,h.owner);assert.ok(results.includes('send_wechat'));
  const delivery=(await h.tool({action:'status'})).outbox[0];
  assert.equal(delivery.status,'queued',JSON.stringify(delivery));
  await h.command('pause');assert.equal(h.timers().active,false);
  await h.command('daily 09:00 America/Mexico_City');assert.equal(h.timers().starts,2);
  await h.lifecycle.dispose();assert.equal(h.timers().active,false);
});

test('missing live agent blocks without invoking the bridge or creating a replacement agent',async t=>{
  const h=await openHost(t);await h.command('daily 09:00 America/Mexico_City');h.live.delete(h.owner.id);
  await h.tick();assert.equal(h.sent.length,0);assert.equal((await h.tool({action:'status'})).outbox[0].status,'blocked');
});

test('PTC native denial stays blocked and never calls the raw send tool',async t=>{
  const h=await openHost(t,{mode:'ptc'});await h.command('daily 09:00 America/Mexico_City');await h.tick();
  assert.equal(h.sent.length,0);
  const result=await h.command('status');assert.match(result.text,/blocked/);
});

test('job deadline aborts approval waiting before an expired send reaches the tool body',async t=>{
  const h=await openHost(t);
  h.ctx.on('tools/pre-execute',async(execution,next)=>{if(execution.name==='send_wechat')await new Promise(resolve=>setTimeout(resolve,15));return next();});
  assert.equal((await h.command('remind 2026-10-18T15:01:00Z Synthetic approval deadline')).kind,'success');
  h.time('2026-10-18T15:15:59.999Z');await h.tick();
  assert.equal(h.sent.length,0,'the host must abort before dispatch when the job deadline expires during approval');
});

test('explicit continue command hands identified user content only to a watched idle live target',async t=>{
  const h=await openHost(t);const watched=await h.tool({action:'watch'});
  const result=await h.command(`continue ${watched.project.id} Review the synthetic README`);
  assert.equal(result.kind,'success');assert.match(result.text,/accepted/);assert.equal(h.accepted.length,1);
  assert.equal(h.accepted[0].role,'user');assert.equal(h.accepted[0].source.kind,'user');assert.ok(h.accepted[0].id);assert.ok(Object.isFrozen(h.accepted[0]));
  assert.match(h.accepted[0].content[0].text,/Review the synthetic README/);
  h.owner.status='running';assert.match((await h.command(`continue ${watched.project.id} Do not interrupt`)).text,/busy/);
  h.live.clear();assert.match((await h.command(`continue ${watched.project.id} Do not resume`)).text,/cold/);
  assert.equal((await h.command('continue unknown Do not dispatch')).kind,'error');assert.equal(h.accepted.length,1);
});

test('continue refuses ambiguous idle targets while preferring the calling watched session',async t=>{
  const h=await openHost(t);const watched=await h.tool({action:'watch'});
  for(const id of ['synthetic-other-a','synthetic-other-b']){
    const session=h.ctx.sessions.create(SessionId(id),{meta:{cwd:h.owner.session.header.cwd}});
    h.live.set(id,{id:session.id,session,ctx:h.ctx,status:'idle',followup:message=>h.accepted.push(message)});
  }
  await h.command('watch');
  assert.match((await h.command(`continue ${watched.project.id} Explicit current task`)).text,/accepted/);
  h.live.delete(h.owner.id);
  const otherSession=h.ctx.sessions.create(SessionId('synthetic-foreign-caller'),{meta:{cwd:h.root}});
  const other={id:otherSession.id,session:otherSession,ctx:h.ctx,status:'idle'};
  const result=await h.command(`continue ${watched.project.id} Ambiguous must not submit`,other);
  assert.match(result.text,/ambiguous/);assert.match(result.text,/synthetic-other-a/);assert.equal(h.accepted.length,1);
});

const binding={userHash:'a'.repeat(64),botHash:'b'.repeat(64)};
async function finishDelegated(h,target,message,{turn=7,text='SYNTHETIC execution reply',reason={kind:'completed'},interrupted=false}={}){
  h.ctx.emit('agent/inbox/claimed',{agent:target,message,turn});
  target.session.append('assistant/message',{turn,step:0,message:{id:'synthetic-answer',role:'assistant',content:[{type:'reasoning',text:'MUST_NOT_FORWARD_REASONING'},{type:'text',text}]},...(interrupted?{interrupted:true}:{})},{surfaceOp:'append'});
  target.session.append('turn/end',{turn,reason});
  await h.adapter.taskResults.ready();
}

test('native task status listing exposes only the owned job index needed to query its exact reply',async t=>{
  const h=await openHost(t,{readBinding:async()=>binding});const root=await otherProject(h,'模型查询交办');const target=addLive(h,'synthetic-native-job-target',root);
  await h.tool({action:'coordinate',project:'模型查询交办',task:'MUST_NOT_RENDER_TASK_BODY',userRequested:true});
  await finishDelegated(h,target,h.accepted[0],{text:'OWNED_EXECUTION_REPLY'});
  const stranger=addLive(h,'synthetic-native-job-stranger',h.root);
  const foreign=await h.adapter.taskResults.prepare({originSessionId:stranger.id,originToolCallId:'synthetic-native-foreign-call',targetSessionId:target.id,targetMessageId:'synthetic-native-foreign-message',projectRoot:root,projectLabel:'MUST_NOT_RENDER_FOREIGN_PROJECT',task:'MUST_NOT_RENDER_FOREIGN_TASK',returnBinding:binding});
  const result=await h.nativeTool({action:'task_status'});
  assert.equal(result.content[0].text,result.value.text);assert.equal(result.content.length,2,'Native model content must retain ids for exact owned detail lookup');
  assert.match(result.content[1].text,/助手内部索引|不要.*用户/);
  const index=JSON.parse(result.content[1].text.split('\n').at(-1));
  assert.deepEqual(index,[{id:result.value.jobs[0].id,projectLabel:'模型查询交办'}]);
  assert.doesNotMatch(result.content[0].text,new RegExp(index[0].id));
  const rendered=JSON.stringify(result.content);assert.ok(!rendered.includes(foreign.job.id));assert.doesNotMatch(rendered,/MUST_NOT_RENDER|OWNED_EXECUTION_REPLY/);assert.ok(!rendered.includes(binding.userHash));assert.ok(!rendered.includes(binding.botHash));
  const details=await h.nativeTool({action:'task_status',id:index[0].id});
  assert.equal(details.content.length,1);assert.match(details.content[0].text,/OWNED_EXECUTION_REPLY/);assert.equal(details.value.jobs.length,1);
  const unrelated=addLive(h,'synthetic-native-job-unrelated',h.root);const empty=await h.nativeTool({action:'task_status'},unrelated);
  assert.equal(empty.content.length,1);assert.doesNotMatch(JSON.stringify(empty.content),/OWNED_EXECUTION_REPLY|MUST_NOT_RENDER/);
});

test('delegation persists caller callId and exact message before admission, then returns only its claimed turn',async t=>{
  const h=await openHost(t,{readBinding:async()=>binding});const root=await otherProject(h,'回传项目');const target=addLive(h,'synthetic-return-target',root);
  let captured,persisted;const prepare=h.adapter.taskResults.prepare;h.adapter.taskResults.prepare=async input=>{const result=await prepare(input);persisted=result.job;return result;};
  const followup=target.followup;target.followup=message=>{assert.equal(persisted.targetMessageId,message.id,'mapping must be durable before followup');captured=message;followup(message);};
  const args={action:'coordinate',project:'回传项目',task:'检查合成公开材料',userRequested:true};
  const accepted=await h.tool(args,h.owner,'synthetic-stable-call');assert.equal(accepted.status,'accepted');
  const status=await h.tool({action:'task_status'});assert.equal(status.jobs.length,1);assert.equal(persisted.originToolCallId,'synthetic-stable-call');assert.equal(persisted.targetMessageId,captured.id);assert.equal(persisted.targetSessionId,target.id);assert.deepEqual(persisted.returnBinding,binding);
  target.session.append('assistant/message',{turn:6,step:0,message:{role:'assistant',content:[{type:'text',text:'MUST_NOT_FORWARD_OLD_TURN'}]}},{surfaceOp:'append'});
  await finishDelegated(h,target,captured);
  assert.equal(h.sent.length,1);assert.equal(h.sent[0].agent,h.owner);assert.match(h.sent[0].arguments.text,/SYNTHETIC execution reply/);assert.match(h.sent[0].arguments.text,/待验收/);assert.doesNotMatch(h.sent[0].arguments.text,/MUST_NOT_FORWARD/);
  target.status='idle';const duplicate=await h.tool(args,h.owner,'synthetic-stable-call');assert.equal(duplicate.accepted,false);assert.equal(h.accepted.length,1);
  await h.adapter.taskResults.tick();assert.equal(h.sent.length,1);assert.equal((await h.tool({action:'task_status'})).jobs[0].delivery.status,'queued');assert.equal(h.timers().active,false);
  const stranger=addLive(h,'synthetic-stranger',h.root);assert.equal((await h.tool({action:'task_status'},stranger)).jobs.length,0);
});

test('delegation stops if the target becomes busy while binding or ledger persistence is awaited',async t=>{
  let target;const h=await openHost(t,{readBinding:async()=>{target.status='running';return binding;}});const root=await otherProject(h,'准入复核项目');target=addLive(h,'synthetic-race-target',root);
  const result=await h.tool({action:'coordinate',project:'准入复核项目',task:'不抢占其他任务',userRequested:true});
  assert.equal(result.status,'busy');assert.equal(h.accepted.length,0);assert.equal(h.sent.length,0);
});

test('task return blocks missing source agents and changed, missing, or multi-user bindings',async t=>{
  for(const mode of ['missing-agent','changed-user','missing-bot','unbound']){
    let current=binding;const h=await openHost(t,{readBinding:async()=>current});const root=await otherProject(h,`绑定项目-${mode}`);const target=addLive(h,`synthetic-binding-${mode}`,root);
    await h.tool({action:'coordinate',project:`绑定项目-${mode}`,task:'读取合成材料',userRequested:true});
    if(mode==='missing-agent')h.live.delete(h.owner.id);else current=mode==='changed-user'?{...binding,userHash:'c'.repeat(64)}:mode==='missing-bot'?{userHash:binding.userHash}:null;
    await finishDelegated(h,target,h.accepted[0]);assert.equal(h.sent.length,0,mode);assert.equal((await h.tool({action:'task_status'})).jobs[0].delivery.status,'blocked',mode);
  }
});

test('official discard and turn error events produce honest status without forwarding private error or reasoning',async t=>{
  const h=await openHost(t,{readBinding:async()=>binding});const root=await otherProject(h,'失败回传项目');const target=addLive(h,'synthetic-error-target',root);
  await h.tool({action:'coordinate',project:'失败回传项目',task:'合成失败任务',userRequested:true});
  await finishDelegated(h,target,h.accepted[0],{reason:{kind:'error',error:{message:'MUST_NOT_FORWARD_PRIVATE_ERROR',code:'PRIVATE'}},text:'MUST_NOT_FORWARD_ERROR_REPLY'});
  assert.equal(h.sent.length,1);assert.doesNotMatch(h.sent[0].arguments.text,/MUST_NOT_FORWARD/);assert.equal((await h.tool({action:'task_status'})).jobs[0].status,'error');
  target.status='idle';await h.tool({action:'coordinate',project:'失败回传项目',task:'合成丢弃任务',userRequested:true});
  h.ctx.emit('agent/inbox/discarded',{agent:target,message:h.accepted[1]});await h.adapter.taskResults.ready();
  assert.equal((await h.tool({action:'task_status'})).jobs.length,2);assert.equal(h.accepted.length,2);
});

test('current-session work and progress queries never create task returns or send duplicates',async t=>{
  const h=await openHost(t,{readBinding:async()=>binding});const result=await h.tool({action:'coordinate',task:'当前会话直接做',userRequested:true});
  assert.equal(result.status,'current_session');assert.deepEqual((await h.tool({action:'task_status'})).jobs,[]);assert.equal(h.sent.length,0);assert.equal(h.timers().starts,0);
});

test('task return maps only official tools pipeline outcomes and never retries a reported send',async t=>{
  for(const [response,expected] of [[{ok:true,message:'sent 1 synthetic message'},'reported_sent'],[{ok:false,message:'MUST_NOT_STORE_PRIVATE_BRIDGE_ERROR'},'failed'],[{},'uncertain']]){
    const h=await openHost(t,{readBinding:async()=>binding,sendResponse:()=>response});const root=await otherProject(h,`通道-${expected}`);const target=addLive(h,`synthetic-outcome-${expected}`,root);
    await h.tool({action:'coordinate',project:`通道-${expected}`,task:'读取合成材料',userRequested:true});await finishDelegated(h,target,h.accepted[0]);
    const result=await h.tool({action:'task_status'});assert.equal(result.jobs[0].delivery.status,expected);assert.doesNotMatch(JSON.stringify(result),/MUST_NOT_STORE_PRIVATE/);
    await h.adapter.taskResults.tick();assert.equal(h.sent.length,1,expected);
  }
});

test('one timer owns reminder and task work and unloading stops its timer',async t=>{
  const h=await openHost(t);const root=await otherProject(h,'关闭测试项目');const target=addLive(h,'synthetic-shutdown-target',root);
  await h.command('daily 09:00 America/Mexico_City');await h.tool({action:'coordinate',project:'关闭测试项目',task:'合成待执行任务',userRequested:true});
  assert.equal(h.timers().starts,1);assert.equal(h.timers().active,true);await h.lifecycle.dispose();assert.equal(h.timers().active,false);assert.equal(h.sent.length,0);
});

test('unloading aborts a task send waiting in the official pipeline and drains its durable result',async t=>{
  const h=await openHost(t,{keep:true,readBinding:async()=>binding});let reopened;
  t.after(async()=>{await reopened?.close();await h.close();await rm(h.root,{recursive:true,force:true});});
  const root=await otherProject(h,'发送关闭项目');const target=addLive(h,'synthetic-pipeline-shutdown',root);const waiting=Promise.withResolvers();
  h.ctx.on('tools/pre-execute',async(execution,next)=>{
    if(execution.name==='send_wechat')await new Promise(resolve=>{waiting.resolve();execution.signal.addEventListener('abort',resolve,{once:true});});
    return next();
  });
  await h.tool({action:'coordinate',project:'发送关闭项目',task:'读取合成材料',userRequested:true});
  const completing=finishDelegated(h,target,h.accepted[0]);await waiting.promise;await h.lifecycle.dispose();await completing;
  assert.equal(h.sent.length,0);assert.equal(h.timers().active,false);await h.close();
  reopened=await openHost(t,{root:h.root,keep:true});
  const result=await reopened.tool({action:'task_status'});assert.equal(result.jobs.length,1);assert.equal(result.jobs[0].status,'completed');assert.equal(result.jobs[0].delivery.status,'blocked');
});

test('unloading waits for an in-flight durable admission to record not-admitted before closing storage',async t=>{
  const h=await openHost(t,{keep:true,readBinding:async()=>binding});let reopened;
  t.after(async()=>{await reopened?.close();await h.close();await rm(h.root,{recursive:true,force:true});});
  const root=await otherProject(h,'准入关闭项目');addLive(h,'synthetic-admission-shutdown',root);const prepared=Promise.withResolvers();const release=Promise.withResolvers();
  const prepare=h.adapter.taskResults.prepare;h.adapter.taskResults.prepare=async input=>{const result=await prepare(input);prepared.resolve();await release.promise;return result;};
  const coordinating=h.tool({action:'coordinate',project:'准入关闭项目',task:'不能在关闭后派工',userRequested:true});await prepared.promise;
  let closed=false;const closing=h.lifecycle.dispose().then(()=>{closed=true;});await new Promise(resolve=>setTimeout(resolve,20));
  const closedBeforeAdmission=closed;release.resolve();await coordinating;await closing;assert.equal(closedBeforeAdmission,false,'storage must remain open until admission settles');assert.equal(h.accepted.length,0);await h.close();
  reopened=await openHost(t,{root:h.root,keep:true});assert.equal((await reopened.tool({action:'task_status'})).jobs[0].status,'not_admitted');
});

test('project memory is opt-in, source-labelled, persistent and separate from execution',async t=>{
  const h=await openHost(t);
  const blocked=await h.tool({action:'memory',project:'synthetic-project'});
  assert.equal(blocked.status,'blocked');
  await h.tool({action:'watch',project:'synthetic-project'});
  const saved=await h.tool({action:'remember',project:'synthetic-project',memoryKind:'goal',memoryText:'Make one useful, source-backed project brief.',sourceKind:'user',sourceReference:'session:synthetic-owner',userRequested:true});
  assert.notEqual(saved.status,'blocked');
  const memory=await h.tool({action:'memory',project:'synthetic-project'});
  assert.ok(memory.goals.some(x=>JSON.stringify(x).includes('useful')));
  assert.ok(JSON.stringify(memory).includes('verified'));
  assert.equal(h.accepted.length,0);assert.equal(h.sent.length,0);
  const digest=await h.nativeTool({action:'digest',project:'synthetic-project'});
  assert.ok(digest.content.some(x=>x.type==='text'&&x.text.includes('useful')));
  const denied=await h.tool({action:'remember',project:'synthetic-project',memoryKind:'decision',memoryText:'Invented source',sourceKind:'file',sourceReference:'../../private.md'});
  assert.equal(denied.status,'blocked');
  await h.tool({action:'unwatch',project:'synthetic-project'});
  assert.equal((await h.tool({action:'memory',project:'synthetic-project'})).status,'blocked');
});

test('new follow-up stays off without explicit user cadence and never enables on install',async t=>{
  const h=await openHost(t,{readBinding:async()=>({userHash:'synthetic-user',botHash:'synthetic-bot'})});
  await h.tool({action:'watch',project:'synthetic-project'});
  const initial=await h.tool({action:'followup_status',project:'synthetic-project'});
  assert.equal(initial.enabled,false);
  const blocked=await h.tool({action:'configure_followup',project:'synthetic-project',everyMinutes:60});
  assert.equal(blocked.status,'blocked');
  assert.equal((await h.tool({action:'followup_status',project:'synthetic-project'})).enabled,false);
  assert.equal(h.accepted.length,0);assert.equal(h.sent.length,0);
});

test('explicit scoped follow-up survives pause gates and unwatch cancels its mapped plan',async t=>{
  const h=await openHost(t,{readBinding:async()=>({userHash:'a'.repeat(64),botHash:'b'.repeat(64)})});
  await h.tool({action:'watch',project:'synthetic-project'});
  const configured=await h.tool({action:'configure_followup',project:'synthetic-project',everyMinutes:60,userRequested:true});
  assert.equal(configured.enabled,true);assert.equal(configured.originSessionId,h.owner.id);
  assert.equal((await h.tool({action:'status'})).followups.length,1);
  await h.tool({action:'pause'});assert.equal(await h.adapter.service.isPaused(),true);
  assert.equal((await h.tool({action:'followup_status',project:'synthetic-project'})).paused,true);
  const paused=await h.tool({action:'configure_followup',project:'synthetic-project',everyMinutes:30,userRequested:true});
  assert.equal(paused.status,'blocked');
  await h.tool({action:'resume'});assert.equal(await h.adapter.service.isPaused(),false);
  await h.tool({action:'unwatch',project:'synthetic-project'});
  await h.tool({action:'watch',project:'synthetic-project'});
  assert.equal((await h.tool({action:'followup_status',project:'synthetic-project'})).enabled,false);
  assert.equal(h.accepted.length,0);assert.equal(h.sent.length,0);
});

test('explicit single check queues only once in a verified native project and can be cancelled',async t=>{
  const h=await openHost(t,{readBinding:async()=>null,readNativeRoute:async()=>({kind:'unbound'})});
  await h.tool({action:'watch',project:'synthetic-project'});
  const initial=await h.tool({action:'once_status',project:'synthetic-project'});assert.equal(initial.enabled,false);
  const denied=await h.tool({action:'check_once',project:'synthetic-project'});assert.equal(denied.status,'blocked');
  const queued=await h.tool({action:'check_once',project:'synthetic-project',delaySeconds:60,userRequested:true});
  assert.equal(queued.status,'queued');assert.equal(queued.delivery,'native');assert.equal(queued.enabled,true);
  const repeated=await h.tool({action:'check_once',project:'synthetic-project',delaySeconds:60,userRequested:true});assert.equal(repeated.alarmId,queued.alarmId);
  assert.equal((await h.tool({action:'followup_status',project:'synthetic-project'})).enabled,false);
  assert.equal((await h.tool({action:'once_status',project:'synthetic-project'})).status,'queued');
  assert.equal((await h.tool({action:'cancel_once',project:'synthetic-project'})).status,'cancelled');
  assert.equal(h.accepted.length,0);assert.equal(h.sent.length,0);
});

test('single check rejects unknown route and paused setup and unwatch cancels owned checks',async t=>{
  let route={kind:'unknown'};const h=await openHost(t,{readBinding:async()=>null,readNativeRoute:async()=>route});
  await h.tool({action:'watch',project:'synthetic-project'});
  assert.equal((await h.tool({action:'check_once',project:'synthetic-project',userRequested:true})).status,'blocked');
  route={kind:'unbound'};await h.tool({action:'pause'});
  assert.equal((await h.tool({action:'check_once',project:'synthetic-project',userRequested:true})).status,'blocked');
  await h.tool({action:'resume'});assert.equal((await h.tool({action:'check_once',project:'synthetic-project',userRequested:true})).status,'queued');
  await h.tool({action:'unwatch',project:'synthetic-project'});await h.tool({action:'watch',project:'synthetic-project'});
  assert.equal((await h.tool({action:'once_status',project:'synthetic-project'})).status,'cancelled');
  assert.equal(h.accepted.length,0);assert.equal(h.sent.length,0);
});


test('analysis context is available through the real tool schema without losing late blockers',async t=>{
  const h=await openHost(t);
  const text='SYNTHETIC historical note. '.repeat(80)+'\n当前阻塞：REAL_LATE_BLOCKER，第二次无变化静默尚未实测。';
  await writeFile(join(h.owner.session.header.cwd,'README.md'),text);
  await h.tool({action:'watch',project:'synthetic-project'});
  const result=await h.nativeTool({action:'digest',project:'synthetic-project',detail:'analysis'});
  assert.match(result.content.filter(x=>x.type==='text').map(x=>x.text).join('\n'),/REAL_LATE_BLOCKER/);
  assert.ok(result.value.analysis);
  assert.ok(result.value.wechatText.length<=3200);
  assert.equal(h.sent.length,0);assert.equal(h.accepted.length,0);
});


test('native authenticated onboarding is passive until an explicit start in the exact WeChat source',async t=>{
  let route;const h=await openHost(t,{connection:{fetch:{register:r=>{route=r;return()=>{};}}},readSetup:async()=>({state:'bound',sessionId:'synthetic-owner',bindingKey:'a'.repeat(64)})});
  h.owner.cancel=()=>{};h.owner.whenIdle=async()=>{};h.owner.inbox={remove:()=>{}};
  assert.ok(route,'official authenticated owner fetch must be registered');
  const get=()=>route.fetch(new Request('http://localhost/api/project_companion/onboarding'));
  const snapshot=await(await get()).json();
  assert.equal(snapshot.connection.sessionId,h.owner.id);assert.equal(h.accepted.length,0);assert.equal(h.sent.length,0);
  const post=async body=>(await route.fetch(new Request('http://localhost/api/project_companion/onboarding',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}))).json();
  const selected=await post({action:'select_projects',projectIds:[snapshot.projects[0].id]});
  assert.equal(selected.projects.filter(x=>x.watched).length,1);assert.equal(h.accepted.length,0);
  const result=await post({action:'complete'});assert.equal(result.welcome.status,'accepted');assert.equal(h.accepted.length,1);
  await post({action:'complete'});assert.equal(h.accepted.length,1);
  const message=h.accepted[0];const root=h.owner.session.header.cwd;
  assert.ok(message.content[0].text.includes(JSON.stringify(root)),'the admitted message must tell the model its exact allowed root');
  h.owner.status='running';h.owner.session.append('turn/start',{turn:20});
  h.ctx.emit('agent/inbox/claimed',{agent:h.owner,message,turn:20});
  const step=await h.ctx.serial('agent/pre-step',{agent:h.owner,turn:20,step:0,messages:[message],signal:new AbortController().signal},async()=>({kind:'enter',messages:[message]}));
  assert.equal(step.kind,'enter');
  const read=await h.tool({action:'digest',project:root,detail:'analysis'});assert.match(read.text,/SYNTHETIC/);
  const denied=await h.ctx.tools.execute({callId:'welcome-must-not-send',name:'send_wechat',arguments:{text:'MUST_NOT_SEND'},agent:h.owner,signal:new AbortController().signal});
  assert.equal(denied.isError,true);assert.equal(h.sent.length,0);
  const write=await h.ctx.tools.execute({callId:'welcome-must-not-write',name:'project_companion',arguments:{action:'remind',title:'MUST_NOT_SCHEDULE',delayMinutes:2},agent:h.owner,signal:new AbortController().signal});
  assert.equal(write.isError,true);assert.equal(h.timers().active,false);
  h.owner.session.append('turn/end',{turn:20,reason:{kind:'completed'}});h.owner.status='idle';h.ctx.emit('agent/status',{agent:h.owner,status:'idle'});
  assert.equal((await h.tool({action:'status'})).daily,null);assert.equal(h.sent.length,0);
});

test('host capture marks an observed event truncated before its saved 500 character excerpt',async t=>{
  const h=await openHost(t);await h.tool({action:'watch',project:'synthetic-project'});
  h.ctx.emit('session/event',h.owner.session,{type:'user/message',seq:700,time:Date.now(),data:{source:{kind:'user'},content:[{type:'text',text:'SYNTHETIC '.repeat(100)}]}});
  await h.adapter.service.ready();
  const result=await h.tool({action:'digest',project:'synthetic-project',detail:'analysis'});
  assert.equal(result.analysis.events.at(-1).truncated,true);
});

test('an explicit onboarding action resumes only the existing bound source after Desktop restart',async t=>{
  let route;const h=await openHost(t,{connection:{fetch:{register:r=>{route=r;return()=>{};}}},readSetup:async()=>({state:'bound',sessionId:'synthetic-owner',bindingKey:'a'.repeat(64)})});
  const root=h.owner.session.header.cwd;h.known.push({path:root,title:'synthetic-project'});h.live.delete(h.owner.id);
  h.owner.cancel=()=>{};h.owner.whenIdle=async()=>{};h.owner.inbox={remove:()=>{}};
  const resumed=[];h.ctx.provide('sessionController',{resolveAgent:async id=>{resumed.push(id);assert.equal(id,h.owner.id);h.live.set(id,h.owner);return{agent:h.owner};}});
  const snapshot=await(await route.fetch(new Request('http://localhost/api/project_companion/onboarding'))).json();
  assert.deepEqual(resumed,[]);assert.equal(h.accepted.length,0);
  const post=async body=>{const response=await route.fetch(new Request('http://localhost/api/project_companion/onboarding',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));assert.equal(response.status,200);return response.json();};
  const selected=await post({action:'select_projects',projectIds:[snapshot.projects[0].id]});assert.match(selected.firstBrief,/SYNTHETIC/);
  assert.deepEqual(resumed,[h.owner.id]);assert.equal(h.accepted.length,0);
  assert.equal((await post({action:'complete'})).welcome.status,'accepted');assert.equal(h.accepted.length,1);
  await post({action:'complete'});assert.equal(h.accepted.length,1);assert.deepEqual(resumed,[h.owner.id]);assert.equal(h.sent.length,0);
});


function newsFixtures(){
  let feeds=0,models=0;
  const articles=Array.from({length:10},(_,i)=>({id:`news-${i}`,title:`AI Builder ${i}`,url:`https://example.org/ai/${i}`,publishedAt:'2026-10-18T14:00:00Z',sourceName:'Synthetic public source',sourceUrl:'https://example.org',excerpt:`AI tool source ${i}`}));
  return {fetchCandidates:async()=>{feeds++;return{articles,stats:{totalFeeds:1,succeededFeeds:1,failedFeeds:0,totalArticles:10,eligibleArticles:10},warnings:[]};},readArticle:async article=>({article,content:`AI Builder publicly documented body ${article.id}`,coverage:'article',truncated:false}),model:{selectArticles:async()=>{models++;return articles.map(a=>a.id);},summarizeArticles:async({articles:items})=>({items:items.map(a=>({id:a.id,title:a.title,summary:'来自公开资料的简短中文摘要。',why:'可以用于 Builder 实践。'}))}),close(){}},counts:()=>({feeds,models})};
}
async function newsTool(h,args,callId='synthetic-news-call'){
  const r=await h.ctx.tools.execute({callId,name:'ai_digest',arguments:args,agent:h.owner,signal:new AbortController().signal});
  assert.equal(r.isError,false,JSON.stringify(r));return r.value;
}
test('AI digest host tool defaults off; native preview uses injected pipeline without any WeChat send',async t=>{
  const news=newsFixtures();const h=await openHost(t,{news});
  assert.ok(h.ctx.tools.schemas(h.owner).some(x=>x.name==='ai_digest'));
  const before=await newsTool(h,{action:'status'});assert.equal(before.schedule,null);assert.deepEqual(news.counts(),{feeds:0,models:0});
  const preview=await newsTool(h,{action:'preview'},'synthetic-news-preview');
  assert.match(preview.text,/重点|详读/);assert.match(preview.text,/速览/);assert.equal(h.sent.length,0);assert.equal(h.timers().active,false);
  assert.equal((await newsTool(h,{action:'status'})).schedule,null);
});
test('AI digest host manual send stays on exact bound owner and repeated tool call does not resend',async t=>{
  const news=newsFixtures();const h=await openHost(t,{news,readSetup:async()=>({state:'bound',sessionId:'synthetic-owner',bindingKey:'a'.repeat(64)})});
  const sent=await newsTool(h,{action:'send_now',userRequested:true},'synthetic-news-single');
  assert.ok(['queued','reported_sent'].includes(sent.status),JSON.stringify(sent));assert.equal(h.sent.length,1);
  await newsTool(h,{action:'send_now',userRequested:true},'synthetic-news-single');assert.equal(h.sent.length,1);
  assert.equal(h.sent[0].agent.id,h.owner.id);
});
test('AI digest schedule shares native minute timer and can cancel without touching project plans',async t=>{
  const news=newsFixtures();const h=await openHost(t,{news,readSetup:async()=>({state:'bound',sessionId:'synthetic-owner',bindingKey:'a'.repeat(64)})});
  await h.tool({action:'watch'});await h.tool({action:'remind',delayMinutes:10,title:'保留原提醒'});
  const plan=await newsTool(h,{action:'configure',time:'15:01',timeZone:'UTC',userRequested:true},'synthetic-news-plan');
  assert.equal(plan.schedule.time,'15:01');h.time('2026-10-18T15:01:00Z');await h.tick();assert.equal(h.sent.length,1);
  await newsTool(h,{action:'cancel',userRequested:true},'synthetic-news-cancel');
  assert.equal((await newsTool(h,{action:'status'})).schedule,null);
  assert.equal((await h.tool({action:'status'})).counts.activeReminders,1);
});

test('AI digest host pause aborts a pending preview without sending or removing other reminders',async t=>{
  const news=newsFixtures();let started;const entered=new Promise(r=>started=r);
  news.model.selectArticles=async({signal})=>{started();return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('synthetic cancelled')),{once:true}));};
  const h=await openHost(t,{news});await h.tool({action:'remind',delayMinutes:10,title:'保留'});
  const work=newsTool(h,{action:'preview'},'synthetic-news-paused');await entered;
  await h.tool({action:'pause'});assert.equal((await work).status,'blocked');assert.equal(h.sent.length,0);
  assert.equal((await h.tool({action:'status'})).counts.activeReminders,1);
});
test('AI digest host refuses a different source session before source fetch or model use',async t=>{
  const news=newsFixtures();const h=await openHost(t,{news,readSetup:async()=>({state:'bound',sessionId:'some-other-session',bindingKey:'b'.repeat(64)})});
  const result=await newsTool(h,{action:'send_now',userRequested:true},'synthetic-news-wrong-route');
  assert.equal(result.status,'blocked');assert.equal(h.sent.length,0);assert.deepEqual(news.counts(),{feeds:0,models:0});
});
test('AI digest host lifecycle disposal aborts generation and drains before its domain closes',async t=>{
  const news=newsFixtures();let started;const entered=new Promise(r=>started=r);
  news.model.selectArticles=async({signal})=>{started();return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('synthetic disposed')),{once:true}));};
  const h=await openHost(t,{news});const work=newsTool(h,{action:'preview'},'synthetic-news-dispose');await entered;
  await h.lifecycle.dispose();assert.equal((await work).status,'blocked');assert.equal(h.sent.length,0);assert.equal(h.timers().active,false);
});
test('failed news cleanup does not leave task-result service running on plugin unload',async t=>{
  const news=newsFixtures();const h=await openHost(t,{news});let taskClosed=false;
  const original=h.adapter.taskResults.close;h.adapter.taskResults.close=async()=>{taskClosed=true;return original();};
  h.adapter.news.close=async()=>{throw new Error('synthetic news store became unavailable');};
  await h.lifecycle.dispose();assert.equal(taskClosed,true);assert.equal(h.timers().active,false);
});

test('native memory correction and forgetting use current project IDs and render truthful receipts',async t=>{
  const h=await openHost(t);await h.tool({action:'watch',project:'synthetic-project'});
  const saved=await h.nativeTool({action:'remember',project:'synthetic-project',memoryKind:'goal',memoryText:'Original scoped goal',sourceKind:'user',userRequested:true});
  assert.equal(saved.value.receipt.status,'saved');assert.ok(saved.content.some(x=>x.text?.includes('操作回执')));
  const id=saved.value.receipt.id;const read=await h.nativeTool({action:'memory',project:'synthetic-project'});assert.ok(read.content.some(x=>x.text?.includes(id)&&x.text.includes('内部记忆索引')));
  const denied=await h.tool({action:'correct_memory',project:'synthetic-project',memoryId:id,memoryText:'Unauthorized rewrite'});assert.equal(denied.status,'blocked');
  const revised=await h.nativeTool({action:'correct_memory',project:'synthetic-project',memoryId:id,memoryText:'Corrected scoped goal',userRequested:true});assert.equal(revised.value.receipt.status,'revised');assert.ok(revised.content.some(x=>x.text?.includes('操作回执')));
  const forgotten=await h.nativeTool({action:'forget_memory',project:'synthetic-project',memoryId:id,userRequested:true});assert.equal(forgotten.value.receipt.status,'forgotten');assert.doesNotMatch(JSON.stringify(forgotten.value.receipt),/Corrected scoped goal/);
  const after=await h.tool({action:'memory',project:'synthetic-project'});assert.equal(after.goals.some(x=>x.id===id),false);assert.equal(h.sent.length,0);assert.equal(h.accepted.length,0);
});

test('workbench actions register on official owner transport and use real scoped memory/followup services',async t=>{
  let currentBinding=null;
  const routes=[];const h=await openHost(t,{connection:{fetch:{register:r=>{routes.push(r);return()=>{};}}},readSetup:async()=>({state:'bound',sessionId:'synthetic-owner',bindingKey:'a'.repeat(64)}),readBinding:async sessionId=>{assert.equal(sessionId,'synthetic-owner');return currentBinding;}});
  await h.tool({action:'watch',project:'synthetic-project'});const saved=await h.tool({action:'remember',project:'synthetic-project',memoryKind:'goal',memoryText:'Old UI goal',sourceKind:'user',userRequested:true});
  const view=await h.adapter.workbench.snapshot();const projectId=view.projects[0].id;const route=routes.find(r=>r.path==='/api/project_companion/workbench/actions');assert.ok(route);assert.deepEqual(route.methods,['POST']);
  const post=body=>route.fetch(new Request('http://localhost/api/project_companion/workbench/actions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));
  const response=await post({action:'memory_update',projectId,id:saved.receipt.id,text:'Corrected from project drawer',userRequested:true});assert.equal(response.status,200);assert.equal((await response.json()).receipt.status,'revised');
  // Setup state alone cannot establish the exact stored return pairing.
  assert.equal(view.projects[0].followup.available,false);
  assert.equal((await post({action:'followup_status',projectId})).status,400);
  currentBinding=priorBinding;
  const status=await post({action:'followup_status',projectId});assert.equal(status.status,200);const value=await status.json();assert.equal(value.followup.enabled,false);assert.equal(value.once.enabled,false);
  assert.equal(h.sent.length,0);assert.equal(h.accepted.length,0);assert.equal(h.timers().active,false);
});

 test('scheduled reminders use a fifteen-second active timer and retire when delivered',async t=>{
 const h=await openHost(t);assert.equal(h.timers().active,false);await h.tool({action:'remind',delayMinutes:2,title:'timer budget'});assert.equal(h.interval(),15000);h.time('2026-10-18T15:02:00Z');await h.tick();assert.equal(h.sent.length,1);assert.equal(h.timers().active,false);
 });

test('AI digest host exposes temporary preview topics without enabling subscriptions or private context', async t => {
  const news = newsFixtures(), seen = [];
  const select = news.model.selectArticles, summarize = news.model.summarizeArticles;
  news.model.selectArticles = async input => { seen.push(input.topics); return select(input); };
  news.model.summarizeArticles = async input => { seen.push(input.topics); return summarize(input); };
  const h = await openHost(t, { news });
  const schema = h.ctx.tools.schemas(h.owner).find(tool => tool.name === 'ai_digest');
  assert.ok(schema.parameters.properties.topics, 'preview topics must be exposed in the native tool schema');
  assert.equal(schema.parameters.properties.topics.type, 'array');
  assert.equal(schema.parameters.properties.topics.items.type, 'string');
  const result = await newsTool(h, { action: 'preview', topics: ['DeepSeek 插件', 'Agent 产品'] }, 'synthetic-topic-preview');
  assert.deepEqual(seen, [['DeepSeek 插件', 'Agent 产品'], ['DeepSeek 插件', 'Agent 产品']]);
  assert.match(result.text, /仅本次预览/);
  const denied = await newsTool(h, { action: 'configure', time: '09:00', timeZone: 'UTC', topics: ['AI'], userRequested: true }, 'synthetic-invalid-topic-configure');
  assert.equal(denied.status, 'blocked');
  assert.match(denied.text, /关注点.*仅.*预览/);
  assert.equal((await newsTool(h, { action: 'status' })).schedule, null);
  assert.equal(h.sent.length, 0);
  assert.equal(h.timers().active, false);
  const guidance = (await h.ctx.systemPrompt.assemble({ scope: h.owner, agent: h.owner })).sections.find(section => section.name === 'project-companion:guidance').text;
  assert.match(guidance, /topics/);
  assert.match(guidance, /不保存.*兴趣|关注点.*不保存/);
});

test('explicit project_update is sourced, repeat-quiet and passive in the real host tool pipeline',async t=>{const calls=[];const h=await openHost(t,{readSetup:async()=>({state:'bound',sessionId:'synthetic-owner',bindingKey:'a'.repeat(64)}),projectUpdates:{summarize:async input=>{calls.push(input);return{changes:[{kind:'quote',text:'SYNTHETIC host project source',sourceIds:[input.sources.find(s=>s.label==='README.md').sourceId]}],blockers:[],nextSteps:[]};}}});assert.ok(h.ctx.tools.schemas(h.owner).find(s=>s.name==='project_companion').parameters.properties.action.enum.includes('project_update'));await h.tool({action:'watch'});const before=h.timers();assert.equal((await h.tool({action:'project_update',project:'synthetic-project'})).status,'blocked');const first=await h.tool({action:'project_update',project:'synthetic-project',userRequested:true});assert.equal(first.status,'overview');assert.match(first.text,/首次概览/);assert.match(first.text,/README.md/);assert.equal(calls.length,1);const second=await h.nativeTool({action:'project_update',project:'synthetic-project',userRequested:true});assert.equal(second.value.quiet,true);assert.equal(second.value.text,'');assert.equal(calls.length,1);assert.equal(h.sent.length,0);assert.equal(h.accepted.length,0);assert.deepEqual(h.timers(),before);await h.tool({action:'pause'});assert.equal((await h.tool({action:'project_update',project:'synthetic-project',userRequested:true})).status,'blocked');assert.equal(calls.length,1);});
