import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,symlink,realpath,access,cp} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {Context} from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime,{defineTool} from '@deepseek-ai/dsh-tools';
import {createScope} from '@deepseek-ai/dsh-scope';
import {ProactiveScheduler} from '../vendor/proactive/lib/scheduler.js';

async function api(){const m=await import('../src/project-followup.js').catch(()=>({}));assert.equal(typeof m.createProjectFollowup,'function','scoped real proactive adapter must exist');return m;}
const binding={userHash:'a'.repeat(64),botHash:'b'.repeat(64)};
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
// 0.2.0 supports both; 0.2.1 exposes the reserved transport through ptc only.
// Ask the loaded SDK schema instead of inferring support from a matrix label.
const codeTransportMode=(()=>{try{return ToolRuntime.Config({mode:'both'}).mode;}catch{return ToolRuntime.Config({mode:'ptc'}).mode;}})();
async function harness(t,options={}){
  const {createProjectFollowup}=await api();
  const temp=await realpath(await mkdtemp(join(tmpdir(),'dot-followup-')));
  const root=join(temp,'public-project');await mkdir(root);
  const authorizedRoots=new Set([root]);
  const ctx=new Context();await ctx.plugin(SystemPrompt,{});await ctx.plugin(ToolRuntime,{mode:options.mode??'native'});
  ctx.provide('workingDirectory',{get:session=>session.header.cwd,ensure:async agent=>agent.session.header.cwd});
  let transportRuns=0;
  if(['both','ptc'].includes(options.mode))ctx.provide('ptcRuntime',{language:'typescript',resolve:input=>input,release:async()=>{},run:async()=>{transportRuns++;return{logs:[],result:'synthetic transport executed'};}});
  const agents=new Map(),schedulers=[],messages=[],mounts=[],resumes=[],tools=[];
  let now=new Date(options.startTime??'2026-10-18T16:00:00Z'),currentBinding=binding,allow=true,allowedRun=true;
  const makeAgent=id=>{
    const events=[];
    const session={id,header:{cwd:root,agentPreset:'default'},events,get seq(){return events.length;},requestHeader:()=>({config:{provider:'synthetic',model:'synthetic'}})};
    const agent={id,session,status:'idle',followup(message){messages.push(message);events.push({seq:events.length,type:'turn/start',data:{turn:1},time:now.toISOString()},{seq:events.length+1,type:'user/message',data:message,time:now.toISOString()});},runMaintenance:async work=>work(),whenIdle:async()=>{
      if(options.onWake)await options.onWake({agent,ctx,events,tools,messages});
      else{
        for(const action of ['memory','digest'])await ctx.tools.execute({callId:`synthetic-${action}-${events.length}`,name:'project_companion',arguments:{action,project:root},agent,signal:new AbortController().signal});
        events.push({seq:events.length,type:'assistant/message',data:{blocks:[{type:'text',text:'合成项目有一项明确阻塞。'}]},time:now.toISOString()});
      }
      events.push({seq:events.length,type:'turn/end',data:{reason:{kind:'completed'}},time:now.toISOString()});
    }};
    const scope=createScope(ctx,agent);agent.ctx=scope.ctx;agent.scopeDispose=scope.dispose;
    return agent;
  };
  const owner=makeAgent('session-original');agents.set(owner.id,owner);
  const registry={get:id=>agents.get(id),resume:async opts=>{resumes.push(opts);const agent=makeAgent(opts.resumeSessionId);await opts.setup(agent.ctx,agent);agents.set(agent.id,agent);return{agent,dispose:async()=>{agents.delete(agent.id);await agent.scopeDispose();}};}};
  ctx.provide('agents',registry);ctx.provide('agentDefaultModel',{currentSelection:()=>({provider:'synthetic',model:'synthetic'})});
  ctx.provide('agentPresets',{mount:async(_scope,id)=>mounts.push(id)});
  for(const name of ['project_companion','send_wechat','bash'])ctx.tools.register(defineTool({name,description:'Synthetic capability only, no external effects',parameters:{action:{type:'string'},project:{type:'string'}},output:{schema:{type:'object',additionalProperties:true},render:()=>[]},execute:args=>{tools.push({name,args});return options.toolResult?.(name,args)??{ok:true};}}));
  const optionsForAdapter={ctx,clock:()=>now,hostTimeZone:()=> 'America/Mexico_City',authorizeRoot:async r=>allow&&authorizedRoots.has(r),canRun:async()=>allowedRun,readBinding:async sessionId=>options.readBinding?options.readBinding(sessionId):currentBinding,readConnection:async()=>options.readConnection?options.readConnection():{state:'bound',sessionId:owner.id,bindingKey:'d'.repeat(64)},readNativeRoute:async sessionId=>options.readNativeRoute?options.readNativeRoute(sessionId):(currentBinding===null?{kind:'unbound'}:{kind:'bound',binding:currentBinding}),createScheduler:deps=>{const scheduler=new ProactiveScheduler(deps);schedulers.push(scheduler);options.onSchedulerCreated?.();return scheduler;}};
  let adapter=createProjectFollowup(optionsForAdapter);
  const args={root,sessionId:owner.id,everyMinutes:30,projectLabel:'测试项目'};
  const drain=async()=>{for(const s of schedulers)await s.driveChain;};
  const tick=async()=>{for(const s of schedulers)s.requestDrive();await drain();};
  t.after(async()=>{await adapter.close();await owner.scopeDispose();await ctx.fiber.dispose();await rm(temp,{recursive:true,force:true});});
  return{root,temp,ctx,agents,owner,schedulers,messages,mounts,resumes,tools,args,drain,tick,get adapter(){return adapter;},transportRuns:()=>transportRuns,authorize:r=>authorizedRoots.add(r),advance:minutes=>{now=new Date(now.getTime()+minutes*60000);},advanceSeconds:seconds=>{now=new Date(now.getTime()+seconds*1000);},setBinding:b=>{currentBinding=b;},deny:()=>{allow=false;},pause:()=>{allowedRun=false;},unpause:()=>{allowedRun=true;},reopen:async()=>{await adapter.close();adapter=createProjectFollowup(optionsForAdapter);return adapter;}};
}

test('no plan or timer is created at construction or a first read-only status',async t=>{
  const h=await harness(t);assert.equal(h.schedulers.length,0);
  const s=await h.adapter.status(h.args);assert.equal(s.enabled,false);assert.equal(h.schedulers.length,0);
  await assert.rejects(access(join(h.root,'.dsh')));
});

test('a daily follow-up keeps the explicit clock time and timezone through restart',async t=>{const h=await harness(t),args={...h.args,everyMinutes:1440,dailyTime:'09:30',timeZone:'Asia/Shanghai'};const first=await h.adapter.configure(args);assert.equal(first.dailyTime,'09:30');assert.equal(first.timeZone,'Asia/Shanghai');assert.equal(first.nextDueAt,'2026-10-19T01:30:00.000Z');const data=JSON.parse(await readFile(join(h.root,'.dsh/dot-followup/alarms.json'),'utf8'));const alarm=data.alarms[0];assert.equal(alarm.type,'cron');assert.equal(alarm.trigger.expr,'30 9 * * *');assert.equal(alarm.timeZone,'Asia/Shanghai');assert.equal(alarm.respectQuietHours,false);await h.reopen();const recovered=await h.adapter.resume(h.args);assert.equal(recovered.dailyTime,'09:30');assert.equal(recovered.alarmId,first.alarmId);assert.equal((await h.adapter.configure(args)).alarmId,first.alarmId);assert.equal((await h.adapter.cancel(h.args)).enabled,false);});
test('daily ownership validation rejects missing zones, mixed cadence and modified cron',async t=>{const h=await harness(t);for(const bad of [{dailyTime:'25:00',timeZone:'UTC',everyMinutes:1440},{dailyTime:'09:00',timeZone:'not/a-zone',everyMinutes:1440},{dailyTime:'09:00',everyMinutes:1440},{dailyTime:'09:00',timeZone:'UTC',everyMinutes:30}])await assert.rejects(h.adapter.configure({...h.args,...bad}));await h.adapter.configure({...h.args,dailyTime:'09:00',timeZone:'UTC',everyMinutes:1440});await h.reopen();const path=join(h.root,'.dsh/dot-followup/alarms.json'),data=JSON.parse(await readFile(path,'utf8'));data.alarms[0].trigger.expr='0 10 * * *';await writeFile(path,JSON.stringify(data));await assert.rejects(h.adapter.status(h.args));});
test('daily follows the requested local clock across daylight-saving transition',async t=>{const h=await harness(t,{startTime:'2026-10-31T12:00:00Z'}),args={...h.args,everyMinutes:1440,dailyTime:'09:00',timeZone:'America/New_York'};assert.equal((await h.adapter.configure(args)).nextDueAt,'2026-10-31T13:00:00.000Z');await h.drain();h.advance(60);await h.tick();assert.equal((await h.adapter.status(args)).nextDueAt,'2026-11-01T14:00:00.000Z');});
test('a trusted cancellation invalidates an in-flight context read before async persistence',async t=>{const entered=deferred(),release=deferred();let invalidated=0;const h=await harness(t,{onWake:async()=>{entered.resolve();await release.promise;}});const m=await api();await h.adapter.close();const local=m.createProjectFollowup({ctx:h.ctx,clock:()=>new Date('2026-10-18T16:00:00Z'),hostTimeZone:'UTC',authorizeRoot:async r=>r===h.root,readBinding:async()=>binding,invalidateLoop:()=>invalidated++});t.after(()=>local.close());await local.configure({...h.args,loopId:'loop-trusted'});const cancellation=local.cancel({...h.args,authorizeMutation:async()=>{await release.promise;return true;},authorizeMutationSync:()=>true});assert.equal(invalidated,1,'trusted cancellation stops the current context generation synchronously');release.resolve();assert.equal((await cancellation).enabled,false);});
test('a freshly authenticated revocation does not need a still-readable route',async t=>{const h=await harness(t);await h.adapter.configure(h.args);await h.drain();h.setBinding({...binding,userHash:'c'.repeat(64)});const stopped=await h.adapter.cancel({...h.args,authorizeMutation:async()=>true,authorizeMutationSync:()=>true});assert.equal(stopped.enabled,false);assert.equal(stopped.running,false);h.setBinding(binding);assert.equal((await h.adapter.resume(h.args)).enabled,false);});

test('passive inspection confirms absence without creating files or activating a source',async t=>{
  const h=await harness(t);assert.equal(typeof h.adapter.inspect,'function');
  assert.deepEqual(await h.adapter.inspect({...h.args,expectedBinding:{sessionId:h.owner.id,bindingKey:'d'.repeat(64)}}),{followup:null,once:null});
  assert.deepEqual(h.schedulers,[]);assert.deepEqual(h.resumes,[]);assert.deepEqual(h.messages,[]);
  await assert.rejects(access(join(h.root,'.dsh')));
});

test('passive cold inspection does not cache, rewrite or restart stored plans, and rejects a different owner or pairing',async t=>{
  const h=await harness(t);await h.adapter.configure(h.args);await h.adapter.checkOnce({...h.args,delaySeconds:60,delivery:'wechat'});await h.drain();await h.reopen();
  const files=['.dsh/dot-followup/scope.json','.dsh/dot-followup/alarms.json','.dsh/dot-checks/'+createHash('sha256').update(h.owner.id).digest('hex')+'/scope.json'];
  const before=await Promise.all(files.map(file=>readFile(join(h.root,file),'utf8')));const count=h.schedulers.length;
  const args={...h.args,expectedBinding:{sessionId:h.owner.id,bindingKey:'d'.repeat(64)}};
  assert.equal(typeof h.adapter.inspect,'function');const value=await h.adapter.inspect(args);
  assert.equal(value.followup.enabled,true);assert.equal(value.followup.running,false);assert.equal(value.once.status,'blocked');
  await assert.rejects(h.adapter.inspect({...args,sessionId:'another-owner'}));
  h.setBinding({...binding,userHash:'c'.repeat(64)});await assert.rejects(h.adapter.inspect(args));h.setBinding(binding);
  await h.reopen();assert.deepEqual(await Promise.all(files.map(file=>readFile(join(h.root,file),'utf8'))),before);
  assert.equal(h.schedulers.length,count);assert.deepEqual(h.resumes,[]);assert.deepEqual(h.messages,[]);
});

test('passive inspection rejects binding replacement during a read and requires the expected UI binding',async t=>{
  let reads=0;const h=await harness(t,{readConnection:async()=>({state:'bound',sessionId:'session-original',bindingKey:(++reads===1?'d':'e').repeat(64)})});
  assert.equal(typeof h.adapter.inspect,'function');
  await assert.rejects(h.adapter.inspect({...h.args,expectedBinding:{sessionId:h.owner.id,bindingKey:'d'.repeat(64)}}));
  await assert.rejects(h.adapter.inspect(h.args));
  assert.equal(h.schedulers.length,0);await assert.rejects(access(join(h.root,'.dsh')));
});

test('an explicit cadence persists one original-session alarm and cancel only removes that plan',async t=>{
  const h=await harness(t);const s=await h.adapter.configure(h.args);await h.drain();
  assert.equal(s.enabled,true);assert.equal(s.everyMinutes,30);assert.equal(h.schedulers.length,1);
  const data=JSON.parse(await readFile(join(h.root,'.dsh/dot-followup/alarms.json'),'utf8'));
  assert.equal(data.alarms.length,1);assert.equal(data.alarms[0].target.mode,'resume');assert.equal(data.alarms[0].target.sessionId,h.owner.id);
  assert.equal(data.alarms[0].compaction,'off');assert.equal(data.alarms[0].respectQuietHours,true);
  assert.match(data.alarms[0].prompt,/memory/);assert.match(data.alarms[0].prompt,/digest/);assert.match(data.alarms[0].prompt,/不要.*派工/);
  assert.equal((await h.adapter.cancel(h.args)).enabled,false);await h.drain();h.advance(60);await h.tick();assert.equal(h.messages.length,0);
});

test('invalid cadence and an unbound source cannot create a schedule',async t=>{
  const h=await harness(t);
  for(const everyMinutes of [0,29,1441,30.5,NaN])await assert.rejects(h.adapter.configure({...h.args,everyMinutes}),/cadence|分钟|30|1440/i);
  h.setBinding(null);await assert.rejects(h.adapter.configure(h.args),/binding|微信/i);assert.equal(h.schedulers.length,0);
});

test('recurring configuration rechecks pairing before any scoped store or timer is created',async t=>{
  let reads=0;const mutable={...binding};
  const h=await harness(t,{readBinding:async()=>{if(++reads>1)mutable.userHash='c'.repeat(64);return mutable;}});
  await assert.rejects(h.adapter.configure(h.args),/binding|route|paused|unauthorized/i);await assert.rejects(access(join(h.root,'.dsh')));assert.equal(h.schedulers.length,0);
});

test('an already paused project cannot configure a new recurring alarm',async t=>{
  const h=await harness(t);h.pause();await assert.rejects(h.adapter.configure(h.args),/paused|unauthorized/i);await assert.rejects(access(join(h.root,'.dsh')));assert.equal(h.schedulers.length,0);
});

for(const method of ['configure','checkOnce'])test(method+' final UI authorization rejects without creating a scoped store or timer',async t=>{
  const h=await harness(t);const args={...h.args,delivery:'wechat',delaySeconds:60,authorizeMutation:async()=>false};
  await assert.rejects(h.adapter[method](args),/authoriz/i);await assert.rejects(access(join(h.root,'.dsh')));assert.equal(h.schedulers.length,0);
});

for(const method of ['configure','checkOnce'])test(method+' cannot recapture a replacement pairing instead of its expected UI binding',async t=>{
  const h=await harness(t,{readConnection:async()=>({state:'bound',sessionId:'session-original',bindingKey:'e'.repeat(64)})});
  await assert.rejects(h.adapter[method]({...h.args,delivery:'wechat',delaySeconds:60,authorizeMutation:async()=>true,expectedBinding:{sessionId:h.owner.id,bindingKey:'d'.repeat(64)}}),/binding|authoriz/i);
  await assert.rejects(access(join(h.root,'.dsh')));assert.equal(h.schedulers.length,0);
});

for(const [create,cancel] of [['configure','cancel'],['checkOnce','cancelOnce']])test(cancel+' does not stop a live timer or cancel its alarm before final UI authorization',async t=>{
  const h=await harness(t);const args={...h.args,delivery:'wechat',delaySeconds:60};await h.adapter[create](args);await h.drain();
  const before=await readFile(join(h.schedulers[0].deps.store.dataDir??h.schedulers[0].deps.config.dataDir,'alarms.json'),'utf8');
  await assert.rejects(h.adapter[cancel]({...args,authorizeMutation:async()=>false}),/authoriz/i);assert.equal(h.schedulers[0].stopped,false);
  const status=await h.adapter[create==='configure'?'status':'onceStatus'](args);assert.equal(status.enabled,true);
  const after=await readFile(join(h.schedulers[0].deps.config.dataDir,'alarms.json'),'utf8');assert.equal(after,before);
});

for(const method of ['configure','checkOnce','cancel','cancelOnce'])test(method+' rejects pairing revocation while its final mutation authorization awaits',async t=>{
  let setup={state:'bound',sessionId:'session-original',bindingKey:'d'.repeat(64)};
  const h=await harness(t,{readConnection:async()=>setup}),args={...h.args,delivery:'wechat',delaySeconds:60};
  const cancellation=method.startsWith('cancel');let before;
  if(cancellation){await h.adapter[method==='cancel'?'configure':'checkOnce'](args);await h.drain();before=await readFile(join(h.schedulers[0].deps.config.dataDir,'alarms.json'),'utf8');}
  const entered=deferred(),gate=deferred();
  const pending=h.adapter[method]({...args,expectedBinding:{sessionId:h.owner.id,bindingKey:'d'.repeat(64)},authorizeMutation:async()=>{entered.resolve();return gate.promise;}});
  await entered.promise;if(cancellation)assert.equal(h.schedulers[0].stopped,false);
  setup={...setup,bindingKey:'e'.repeat(64)};h.setBinding({...binding,userHash:'c'.repeat(64)});gate.resolve(true);
  await assert.rejects(pending,/binding|authoriz/i);
  if(cancellation){assert.equal(h.schedulers[0].stopped,false);assert.equal(await readFile(join(h.schedulers[0].deps.config.dataDir,'alarms.json'),'utf8'),before);}
  else{assert.equal(h.schedulers.length,0);await assert.rejects(access(join(h.root,'.dsh')));}
});

test('unwatched and symlink roots or data directories fail closed',async t=>{
  const h=await harness(t);const outside=join(h.temp,'outside');await mkdir(outside);
  await assert.rejects(h.adapter.configure({...h.args,root:outside}),/watched|scope|授权/i);
  const link=join(h.temp,'link');await symlink(h.root,link);await assert.rejects(h.adapter.configure({...h.args,root:link}),/symlink|canonical|scope|watched/i);
  await mkdir(join(h.root,'.dsh'));await symlink(outside,join(h.root,'.dsh/dot-followup'));await assert.rejects(h.adapter.configure(h.args),/symlink|directory/i);
});

test('status cannot start persisted timers; only resume restores the exact owned plan',async t=>{
  const h=await harness(t);await h.adapter.configure(h.args);await h.drain();await h.reopen();
  assert.equal((await h.adapter.status(h.args)).enabled,true);assert.equal(h.schedulers.length,1);
  await h.adapter.resume(h.args);await h.drain();assert.equal(h.schedulers.length,2);
  h.advance(30);await h.tick();assert.equal(h.messages.length,1);
  assert.equal((await h.adapter.status(h.args)).enabled,true);
});

test('an unauthorized session cannot read, replace, cancel or resume the owned alarm',async t=>{
  const h=await harness(t);await h.adapter.configure(h.args);await h.drain();
  for(const method of ['status','configure','cancel','resume'])await assert.rejects(h.adapter[method]({...h.args,sessionId:'session-other'}),/owner|source|session/i);
  assert.equal((await h.adapter.status(h.args)).enabled,true);
});

test('a real upstream scheduled wake reaches the original live session once',async t=>{
  const h=await harness(t);await h.adapter.configure(h.args);await h.drain();h.advance(30);await h.tick();
  assert.equal(h.messages.length,1);assert.match(h.messages[0].content[0].text,/Host-scheduled wake/);
  assert.match(h.messages[0].content[0].text,/project_companion/);assert.match(h.messages[0].content[0].text,/不要.*send_wechat/);
  const runs=(await readFile(join(h.root,'.dsh/dot-followup/runs.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(runs.length,1);assert.equal(runs[0].decision,'reply');assert.equal(runs[0].budgetDelta,1);assert.deepEqual(h.tools.map(t=>t.name),['project_companion','project_companion']);
});

test('a changed original binding or removed watched authorization prevents a wake',async t=>{
  const h=await harness(t);await h.adapter.configure(h.args);await h.drain();h.setBinding({...binding,userHash:'c'.repeat(64)});h.advance(30);await h.tick();assert.equal(h.messages.length,0);
  h.setBinding(binding);h.deny();h.advance(30);await h.tick();assert.equal(h.messages.length,0);
});

test('the guard denies remote sends, writes, handoffs and unrelated roots only during the autonomous wake',async t=>{
  const outcomes=[];
  const h=await harness(t,{onWake:async({agent,ctx})=>{
    let n=0;for(const [name,args,allowed] of [['send_wechat',{},false],['bash',{},false],['project_companion',{action:'coordinate',project:h.root},false],['project_companion',{action:'remember',project:h.root},false],['project_companion',{action:'memory'},false],['project_companion',{action:'memory',project:'/unwatched'},false],['project_companion',{action:'memory',project:h.root},true],['project_companion',{action:'digest',project:h.root},true]]){
      const r=await ctx.tools.execute({callId:`guard-${++n}`,name,arguments:args,agent,signal:new AbortController().signal});outcomes.push({allowed,isError:r.isError});
    }
  }});
  await h.adapter.configure(h.args);await h.drain();h.advance(30);await h.tick();
  assert.equal(outcomes.length,8);for(const o of outcomes)assert.equal(o.isError,!o.allowed);
  const r=await h.ctx.tools.execute({callId:'ordinary-user-call',name:'bash',arguments:{},agent:h.owner,signal:new AbortController().signal});assert.equal(r.isError,false);
});

test('cancelling while binding confirmation is pending prevents the queued wake',async t=>{
  let unblock;let pending=false;
  const h=await harness(t,{readBinding:()=>pending?new Promise(resolve=>{unblock=()=>resolve(binding);}):binding});
  await h.adapter.configure(h.args);await h.drain();pending=true;h.advance(30);
  const tick=h.tick();while(!unblock)await new Promise(resolve=>setTimeout(resolve,1));
  const cancellation=h.adapter.cancel(h.args);unblock();await tick;await cancellation;assert.equal(h.messages.length,0);
});

test('closed adapters reject new work while preserving persisted plans',async t=>{
  const h=await harness(t);await h.adapter.configure(h.args);await h.drain();await h.adapter.close();
  await assert.rejects(h.adapter.configure(h.args),/closed|关闭/i);
  const data=JSON.parse(await readFile(join(h.root,'.dsh/dot-followup/alarms.json'),'utf8'));assert.equal(data.alarms.length,1);
});

test('setting the same plan twice preserves one upstream alarm and its due time',async t=>{
  const h=await harness(t);const first=await h.adapter.configure(h.args);await h.drain();h.advance(3);
  const again=await h.adapter.configure(h.args);await h.drain();assert.equal(first.alarmId,again.alarmId);assert.equal(first.nextDueAt,again.nextDueAt);
  const data=JSON.parse(await readFile(join(h.root,'.dsh/dot-followup/alarms.json'),'utf8'));assert.equal(data.alarms.length,1);assert.equal(h.schedulers.length,1);
});

test('pause skips model wake and blocks reads if pause arrives during an active wake',async t=>{
  const results=[];const h=await harness(t,{onWake:async({agent,ctx})=>{
    h.pause();results.push(await ctx.tools.execute({callId:'read-after-pause',name:'project_companion',arguments:{action:'memory',project:h.root},agent,signal:new AbortController().signal}));
  }});
  await h.adapter.configure(h.args);await h.drain();h.pause();h.advance(30);await h.tick();assert.equal(h.messages.length,0);
  const paused=await h.adapter.status({root:h.root});assert.equal(paused.enabled,true);assert.equal(paused.lastRunAt,null,'a skipped read must not advance the last-check baseline');assert.equal(paused.runCount,0);
  h.unpause();h.advance(30);await h.tick();assert.equal(h.messages.length,1);assert.equal(results[0].isError,true);assert.equal(h.tools.length,0);
});

test('a cold original session is resumed with the saved preset, never a new target',async t=>{
  const h=await harness(t);await h.adapter.configure(h.args);await h.drain();h.agents.delete(h.owner.id);h.advance(30);await h.tick();
  assert.equal(h.resumes.length,1);assert.equal(h.resumes[0].resumeSessionId,h.owner.id);assert.deepEqual(h.mounts,['default']);assert.equal(h.messages.length,1);
  assert.equal(h.agents.has(h.owner.id),false,'upstream disposes only its owned resumed handle');
});

test('a silent reclaim is charged zero deliveries and the next prompt uses lastRunAt',async t=>{
  const results=[];const h=await harness(t,{onWake:async({agent,ctx,events})=>{
    for(const action of ['memory','digest'])await ctx.tools.execute({callId:`silent-${action}-${events.length}`,name:'project_companion',arguments:{action,project:h.root},agent,signal:new AbortController().signal});
    const tool=ctx.tools.get('proactive_reclaim',agent);let concluded=false;
    const result=await tool.execute({reason:'没有实质变化'},{agent,concludeTurn:()=>{concluded=true;}});
    assert.equal(concluded,true);results.push(result);
    events.push({seq:events.length,type:'tool/call',data:{name:'proactive_reclaim',arguments:JSON.stringify({reason:'没有实质变化'})}});
  }});
  await h.adapter.configure(h.args);await h.drain();h.advance(30);await h.tick();h.advance(30);await h.tick();
  assert.equal(results.length,2);assert.equal(results[0].silent,true);assert.match(h.messages[1].content[0].text,/上次检查时间：2026-10-18T16:30:00.000Z/);assert.equal((await h.adapter.status(h.args)).lastReviewedAt,'2026-10-18T17:00:00.000Z');
  const runs=(await readFile(join(h.root,'.dsh/dot-followup/runs.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);assert.deepEqual(runs.map(r=>[r.decision,r.budgetDelta]),[['no_reply',0],['no_reply',0]]);
});

test('a following ordinary user turn keeps its normal tool permissions',async t=>{
  let result;const h=await harness(t,{onWake:async({agent,ctx,events})=>{
    events.push({seq:events.length,type:'turn/end',data:{reason:{kind:'completed'}}},{seq:events.length+1,type:'turn/start',data:{turn:2}},{seq:events.length+2,type:'user/message',data:{source:{kind:'user'},content:[{type:'text',text:'这是新的显式用户请求'}]}});
    result=await ctx.tools.execute({callId:'following-real-user',name:'bash',arguments:{},agent,signal:new AbortController().signal});
  }});
  await h.adapter.configure(h.args);await h.drain();h.advance(30);await h.tick();assert.equal(result.isError,false,'follow-up guards must not leak into a newer ordinary user turn');
});

test('read-only status and resume infer only the stored owner, never a caller-selected target',async t=>{
  const h=await harness(t);await h.adapter.configure(h.args);await h.drain();await h.reopen();
  const before=await h.adapter.status({root:h.root});assert.equal(before.originSessionId,h.owner.id);await h.adapter.resume({root:h.root});await h.drain();h.advance(30);await h.tick();assert.equal(h.messages.length,1);
});

test('cancelling an active wake still permits its reclaim tool to end silently',async t=>{
  let cancellation,result;const h=await harness(t,{onWake:async({agent,ctx,events})=>{
    cancellation=h.adapter.cancel(h.args);
    result=await ctx.tools.execute({callId:'reclaim-after-cancel',name:'proactive_reclaim',arguments:{reason:'跟进已取消'},agent,signal:new AbortController().signal});
    events.push({seq:events.length,type:'tool/call',data:{name:'proactive_reclaim',arguments:'{}'}});
  }});
  await h.adapter.configure(h.args);await h.drain();h.advance(30);await h.tick();await cancellation;
  assert.equal(result.isError,false,JSON.stringify(result));assert.equal(result.value.silent,true);assert.equal((await h.adapter.status(h.args)).enabled,false);
});

test('autonomous wake denies the reserved code transport before any PTC execution',async t=>{
  const mode=codeTransportMode;
  let result;const h=await harness(t,{mode,onWake:async({agent,ctx})=>{
    result=await ctx.tools.execute({callId:'autonomous-code-transport',name:'run_code',arguments:{code:'return "must not execute";',description:'Synthetic code transport deny regression'},agent,signal:new AbortController().signal});
  }});
  await h.adapter.configure(h.args);await h.drain();h.advance(30);await h.tick();assert.equal(result.isError,true);assert.match(result.error.message,/restricted|Autonomous/);assert.equal(h.transportRuns(),0);
  const ordinary=await h.ctx.tools.execute({callId:'ordinary-code-transport',name:'run_code',arguments:{code:'return "synthetic allowed outside the wake";',description:'Prove the synthetic transport is executable'},agent:h.owner,signal:new AbortController().signal});
  assert.equal(ordinary.isError,false,JSON.stringify(ordinary));assert.equal(h.transportRuns(),1,'the same backend remains executable outside the autonomous wake');
});

test('quiet hours do not masquerade as a completed source review',async t=>{
  const h=await harness(t);await h.adapter.configure(h.args);await h.drain();h.advance(13*60+30);await h.tick();
  const quiet=await h.adapter.status(h.args);assert.equal(h.messages.length,0);assert.equal(quiet.lastReviewedAt,null);assert.notEqual(quiet.lastRunAt,null,'upstream may record a skipped schedule');
  h.advance(9*60);await h.tick();assert.equal(h.messages.length,1);assert.match(h.messages[0].content[0].text,/上次检查时间：无，首次概览/);assert.equal((await h.adapter.status(h.args)).lastReviewedAt,'2026-10-19T14:30:00.000Z');
});

test('a reply without successful memory and digest reads cannot advance the review watermark',async t=>{
  const h=await harness(t,{onWake:async({events})=>events.push({seq:events.length,type:'assistant/message',data:{text:'合成回复，未读来源。'}})});
  await h.adapter.configure(h.args);await h.drain();h.advance(30);await h.tick();assert.equal((await h.adapter.status(h.args)).lastReviewedAt,null);
});

test('a later plugin context notice in the wake turn cannot remove read-only guards',async t=>{
  let result;const h=await harness(t,{onWake:async({agent,ctx,events})=>{
    events.push({seq:events.length,type:'user/message',data:{source:{kind:'plugin:synthetic-context',form:'notice'},content:[{type:'text',text:'Synthetic later context, not a user request'}]}});
    result=await ctx.tools.execute({callId:'context-cannot-release-guard',name:'bash',arguments:{},agent,signal:new AbortController().signal});
  }});
  await h.adapter.configure(h.args);await h.drain();h.advance(30);await h.tick();assert.equal(result.isError,true);assert.equal(h.tools.length,0);
});

for(const method of ['cancel','configure'])test(`a following user can ${method} without waiting for its own turn to become idle`,async t=>{
  let completedBeforeTurnEnd=false;
  const h=await harness(t,{onWake:async({events})=>{
    events.push({seq:events.length,type:'turn/end',data:{reason:{kind:'completed'}}},{seq:events.length+1,type:'turn/start',data:{turn:2}},{seq:events.length+2,type:'user/message',data:{source:{kind:'user'},content:[{type:'text',text:'用户修改跟进安排'}]}});
    let timer;try{
      completedBeforeTurnEnd=await Promise.race([h.adapter[method]({...h.args,everyMinutes:60}).then(()=>true),new Promise(resolve=>{timer=setTimeout(()=>resolve(false),2000);})]);
    }finally{clearTimeout(timer);}
  }});
  await h.adapter.configure(h.args);await h.drain();h.advance(30);await h.tick();await h.drain();assert.equal(completedBeforeTurnEnd,true,'interactive schedule management must not await the active agent to finish its own turn');
});

test('a domain-blocked read inside a successful tool envelope cannot advance the review baseline',async t=>{
  const h=await harness(t,{toolResult:(name,args)=>name==='project_companion'&&args.action==='memory'?{status:'blocked',accepted:false,text:'Synthetic unavailable source'}:{ok:true}});
  await h.adapter.configure(h.args);await h.drain();h.advance(30);await h.tick();assert.equal((await h.adapter.status(h.args)).lastReviewedAt,null);
});

test('source review watermark uses the start of the read window, not the later reply time',async t=>{
  const h=await harness(t,{onWake:async({agent,ctx,events})=>{
    for(const action of ['memory','digest'])await ctx.tools.execute({callId:`window-${action}`,name:'project_companion',arguments:{action,project:h.root},agent,signal:new AbortController().signal});
    h.advance(7);events.push({seq:events.length,type:'assistant/message',data:{text:'Synthetic completed source-backed summary'}});
  }});
  await h.adapter.configure(h.args);await h.drain();h.advance(30);await h.tick();assert.equal((await h.adapter.status(h.args)).lastReviewedAt,'2026-10-18T16:30:00.000Z');
});

test('closing a cancelled active wake retains its guards until that old driver settles',async t=>{
  let release,entered;const arrived=new Promise(resolve=>{entered=resolve;});
  const h=await harness(t,{onWake:async()=>{entered();await new Promise(resolve=>{release=resolve;});}});
  await h.adapter.configure(h.args);await h.drain();h.advance(30);const running=h.tick();await arrived;await h.adapter.cancel(h.args);
  let settled=false;const closing=h.adapter.close().then(()=>{settled=true;});let early;
  try{await new Promise(resolve=>setTimeout(resolve,20));early=settled;}finally{release();await running;await closing;}
  assert.equal(early,false,'close must retain read-only guards until the retired driver is actually settled');
});
test('close drains the unawaited scheduler boot persistence before returning',async t=>{
 const {ProactiveStore}=await import('../vendor/proactive/lib/store.js');const original=ProactiveStore.prototype.persist;
 let hold=false,release,entered;const arrived=new Promise(resolve=>{entered=resolve;});const waiting=new Promise(resolve=>{release=resolve;});
 ProactiveStore.prototype.persist=function(...args){if(hold){hold=false;entered();return waiting.then(()=>original.apply(this,args));}return original.apply(this,args);};
 try{const h=await harness(t,{onSchedulerCreated:()=>{hold=true;}});await h.adapter.configure(h.args);await arrived;let settled=false;const closing=h.adapter.close().then(()=>{settled=true;});await new Promise(resolve=>setTimeout(resolve,20));const early=settled;release();await closing;assert.equal(early,false,'close must wait for boot persistence even though upstream does not await it');}finally{release?.();ProactiveStore.prototype.persist=original;}
});

test('copying a plan directory into another watched project cannot transfer its authorization',async t=>{
  const h=await harness(t);await h.adapter.configure(h.args);await h.drain();const second=join(h.temp,'other-watched');await mkdir(second);h.authorize(second);
  await mkdir(join(second,'.dsh'));await cp(join(h.root,'.dsh/dot-followup'),join(second,'.dsh/dot-followup'),{recursive:true});
  await assert.rejects(h.adapter.resume({root:second}),/root|scope|ownership/i);
});

const onceArgs=h=>({root:h.root,sessionId:h.owner.id,projectLabel:'单次公开项目检查',delivery:'native',delaySeconds:60});
const onceDirectory=h=>join(h.root,'.dsh/dot-checks',createHash('sha256').update(h.owner.id).digest('hex'));

test('one-off read status creates no directory, alarm or timer',async t=>{
  const h=await harness(t);h.setBinding(null);
  assert.equal(typeof h.adapter.checkOnce,'function');assert.equal(typeof h.adapter.onceStatus,'function');assert.equal(typeof h.adapter.cancelOnce,'function');
  assert.equal((await h.adapter.onceStatus(onceArgs(h))).enabled,false);assert.equal(h.schedulers.length,0);await assert.rejects(access(join(h.root,'.dsh')));
});

test('explicit native once uses the real upstream once scheduler and completes without another occurrence',async t=>{
  const h=await harness(t);h.setBinding(null);const args=onceArgs(h);
  const first=await h.adapter.checkOnce(args);assert.equal(first.status,'queued');assert.equal(first.delivery,'native');assert.equal(first.enabled,true);assert.equal(h.messages.length,0);
  await h.drain();h.advanceSeconds(30);await h.tick();assert.equal(h.messages.length,0);h.advanceSeconds(30);await h.tick();
  const done=await h.adapter.onceStatus(args);assert.equal(done.status,'completed');assert.equal(done.enabled,false);assert.equal(done.runCount,1);assert.equal(done.lastReviewedAt,'2026-10-18T16:01:00.000Z');assert.equal(h.messages.length,1);
  // Upstream advances its in-memory alarm first and persists asynchronously.
  // Wait for the actual file instead of assuming driveChain awaited that write.
  let stored;for(let i=0;i<100;i++){stored=JSON.parse(await readFile(join(onceDirectory(h),'alarms.json'),'utf8'));if(stored.alarms[0]?.status==='completed')break;await new Promise(resolve=>setTimeout(resolve,10));}
  assert.equal(stored.alarms.length,1);assert.equal(stored.alarms[0].type,'once');assert.equal(stored.alarms[0].status,'completed');assert.equal(stored.alarms[0].respectQuietHours,false);
  const runs=(await readFile(join(onceDirectory(h),'runs.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);assert.equal(runs.length,1);assert.equal(runs[0].decision,'reply');
  h.advance(60);await h.tick();assert.equal(h.messages.length,1);assert.equal(h.resumes.length,0);
});

test('once validates delay and delivery and refuses an already bound native session',async t=>{
  const h=await harness(t);const args=onceArgs(h);
  await assert.rejects(h.adapter.checkOnce(args),/binding|native|微信/i);
  h.setBinding(null);for(const delaySeconds of [0,29,301,30.5,NaN])await assert.rejects(h.adapter.checkOnce({...args,delaySeconds}),/delay|30|300/i);
  await assert.rejects(h.adapter.checkOnce({...args,delivery:'other'}),/delivery/i);await assert.rejects(access(join(h.root,'.dsh')));
});

test('one-off absolute future time uses the community once alarm unchanged and cancels exactly that alarm',async t=>{
  const h=await harness(t);h.setBinding(null);const args={...onceArgs(h),delaySeconds:undefined,dueAt:'2026-10-20T16:00:00.000Z'};
  const first=await h.adapter.checkOnce(args);await h.drain();assert.equal(first.nextDueAt,args.dueAt);
  const stored=JSON.parse(await readFile(join(onceDirectory(h),'alarms.json'),'utf8'));assert.equal(stored.alarms.length,1);assert.equal(stored.alarms[0].type,'once');assert.equal(stored.alarms[0].trigger.at,args.dueAt);
  h.advance(24*60);await h.tick();assert.equal(h.messages.length,0);
  assert.equal((await h.adapter.cancelOnce(args)).status,'cancelled');h.advance(24*60);await h.tick();assert.equal(h.messages.length,0);
  await h.reopen();assert.equal((await h.adapter.onceStatus(args)).status,'cancelled');
});

test('absolute one-off dates reject ambiguous, past, over-seven-day and conflicting delay inputs without stores',async t=>{
  const h=await harness(t);h.setBinding(null);const args={...onceArgs(h),delaySeconds:undefined};
  for(const dueAt of ['not-a-date','2026-10-19T16:00','2026-10-18T16:00:00Z','2026-10-17T16:00:00Z','2026-10-25T16:00:01Z'])await assert.rejects(h.adapter.checkOnce({...args,dueAt}),/time|date|future|7|seven|ISO/i);
  await assert.rejects(h.adapter.checkOnce({...args,delaySeconds:60,dueAt:'2026-10-19T16:00:00Z'}),/delay|one|time|either/i);await assert.rejects(access(join(h.root,'.dsh')));assert.equal(h.schedulers.length,0);
});

test('one-off cancellation is exact to project and original owner while preserving another owned plan',async t=>{
  const h=await harness(t);const first=await h.adapter.checkOnce({...onceArgs(h),delivery:'wechat'});await h.drain();
  const second=join(h.temp,'second-watched');await mkdir(second);h.authorize(second);const other=await h.adapter.checkOnce({...onceArgs(h),root:second,delivery:'wechat'});await h.drain();
  await h.adapter.cancelOnce({...onceArgs(h),sessionId:'other-owner'});assert.equal((await h.adapter.onceStatus(onceArgs(h))).alarmId,first.alarmId);assert.equal((await h.adapter.onceStatus(onceArgs(h))).enabled,true);
  await h.adapter.cancelOnce(onceArgs(h));assert.equal((await h.adapter.onceStatus({...onceArgs(h),root:second})).alarmId,other.alarmId);assert.equal((await h.adapter.onceStatus({...onceArgs(h),root:second})).enabled,true);
});

test('native once fails closed when its route is unknown even if old binding API returns null',async t=>{
  const h=await harness(t,{readNativeRoute:async()=>({kind:'unknown'})});h.setBinding(null);
  await assert.rejects(h.adapter.checkOnce(onceArgs(h)),/route|native|unbound/i);await assert.rejects(access(join(h.root,'.dsh')));
});

test('native once refuses changed cwd or a missing live session before scheduling',async t=>{
  const h=await harness(t);h.setBinding(null);const args=onceArgs(h);
  h.owner.session.header.cwd=h.temp;await assert.rejects(h.adapter.checkOnce(args),/root|cwd|live|native/i);
  h.owner.session.header.cwd=h.root;h.agents.delete(h.owner.id);await assert.rejects(h.adapter.checkOnce(args),/live|native/i);assert.equal(h.resumes.length,0);
});

for(const change of ['binding','cwd','cold'])test('native once blocks '+change+' changes at wake without rerouting or cold resume',async t=>{
  const h=await harness(t);h.setBinding(null);const args=onceArgs(h);await h.adapter.checkOnce(args);await h.drain();
  if(change==='binding')h.setBinding(binding);else if(change==='cwd')h.owner.session.header.cwd=h.temp;else h.agents.delete(h.owner.id);
  h.advanceSeconds(60);await h.tick();const blocked=await h.adapter.onceStatus(args);assert.equal(blocked.status,'blocked');assert.equal(blocked.enabled,false);assert.equal(h.messages.length,0);assert.equal(h.resumes.length,0);
});

test('repeated once requests preserve one pending alarm and a fresh request after completion runs once more',async t=>{
  const h=await harness(t);h.setBinding(null);const args=onceArgs(h);const first=await h.adapter.checkOnce(args);await h.drain();h.advanceSeconds(10);const repeated=await h.adapter.checkOnce({...args,delaySeconds:90});
  assert.equal(repeated.alarmId,first.alarmId);assert.equal(repeated.nextDueAt,first.nextDueAt);assert.equal(h.schedulers.length,1);
  h.advanceSeconds(50);await h.tick();assert.equal(h.messages.length,1);const second=await h.adapter.checkOnce(args);assert.notEqual(second.alarmId,first.alarmId);await h.drain();h.advanceSeconds(60);await h.tick();assert.equal(h.messages.length,2);
});

test('a native once from another session coexists with an existing WeChat interval without replacing its ownership',async t=>{
  let nativeId;
  const h=await harness(t,{readBinding:sessionId=>sessionId===nativeId?null:binding,readNativeRoute:async()=>({kind:'unbound'})});
  const interval=await h.adapter.configure(h.args);await h.drain();
  nativeId='session-native-check';const native={...h.owner,id:nativeId,session:{...h.owner.session,id:nativeId}};h.agents.set(nativeId,native);
  const single=await h.adapter.checkOnce({...onceArgs(h),sessionId:nativeId});await h.drain();assert.notEqual(single.alarmId,interval.alarmId);
  const retained=await h.adapter.status(h.args);assert.equal(retained.alarmId,interval.alarmId);assert.equal(retained.enabled,true);assert.equal(retained.originSessionId,h.owner.id);
  await h.adapter.cancelOnce({...onceArgs(h),sessionId:nativeId});assert.equal((await h.adapter.status(h.args)).enabled,true);
});

test('once cancellation and close prevent queued wakes and reopening does not restart native timers',async t=>{
  const h=await harness(t);h.setBinding(null);const args=onceArgs(h);await h.adapter.checkOnce(args);await h.drain();assert.equal((await h.adapter.cancelOnce(args)).status,'cancelled');h.advance(10);await h.tick();assert.equal(h.messages.length,0);
  await h.adapter.checkOnce(args);await h.drain();await h.reopen();h.advance(10);await h.tick();assert.equal(h.messages.length,0);assert.equal((await h.adapter.onceStatus(args)).status,'blocked');assert.equal(h.resumes.length,0);
});

test('one-off requested checks run inside quiet hours while existing recurring alarms keep respecting quiet hours',async t=>{
  const h=await harness(t);await h.adapter.configure(h.args);await h.drain();h.advance(13*60+30);await h.tick();assert.equal(h.messages.length,0);
  h.setBinding(null);await h.adapter.checkOnce(onceArgs(h));await h.drain();h.advanceSeconds(60);await h.tick();assert.equal(h.messages.length,1);assert.equal((await h.adapter.onceStatus(onceArgs(h))).status,'completed');
});

test('a native once enforces read-only tools and checks its route again before source reads',async t=>{
  let changedResult;const outcomes=[];
  const mode=codeTransportMode;
  const h=await harness(t,{mode,onWake:async({agent,ctx})=>{
    for(const [name,args] of [['send_wechat',{}],['bash',{}],['project_companion',{action:'coordinate',project:h.root}],['project_companion',{action:'remember',project:h.root}],['run_code',{code:'return \"denied\";',description:'deny one-off code'}]]){
      outcomes.push(await ctx.tools.execute({callId:'once-deny-'+outcomes.length,name,arguments:args,agent,signal:new AbortController().signal}));
    }
    h.setBinding(binding);changedResult=await ctx.tools.execute({callId:'once-route-changed',name:'project_companion',arguments:{action:'memory',project:h.root},agent,signal:new AbortController().signal});
  }});
  h.setBinding(null);await h.adapter.checkOnce(onceArgs(h));await h.drain();h.advanceSeconds(60);await h.tick();for(const r of outcomes)assert.equal(r.isError,true);assert.equal(h.transportRuns(),0);assert.equal(changedResult.isError,true);assert.equal(h.tools.length,0);assert.equal((await h.adapter.onceStatus(onceArgs(h))).status,'blocked');
});

test('project unwatch cancels all locally held one-off checks but preserves the interval plan',async t=>{
  const h=await harness(t,{readNativeRoute:async()=>({kind:'unbound'})});await h.adapter.configure(h.args);await h.drain();
  h.setBinding(null);await h.adapter.checkOnce(onceArgs(h));
  const secondId='session-second-native';h.agents.set(secondId,{...h.owner,id:secondId,session:{...h.owner.session,id:secondId}});
  await h.adapter.checkOnce({...onceArgs(h),sessionId:secondId});await h.drain();
  assert.equal((await h.adapter.cancelOnceForProject({root:h.root})).cancelled,2);
  h.advanceSeconds(60);await h.tick();assert.equal(h.messages.length,0);assert.equal((await h.adapter.onceStatus(onceArgs(h))).status,'cancelled');assert.equal((await h.adapter.status(h.args)).enabled,true);
});

test('a native check uses effective cwd instead of an unchanged session header',async t=>{
  const h=await harness(t);h.setBinding(null);
  const directory=h.ctx.get('workingDirectory');directory.get=()=>h.temp;
  assert.equal(h.owner.session.header.cwd,h.root);await assert.rejects(h.adapter.checkOnce(onceArgs(h)),/root|native|project/i);
});

test('one-off cancellation while route validation is pending does not create a timer',async t=>{
  let release;let waiting=false;const h=await harness(t,{readNativeRoute:async()=>waiting?new Promise(resolve=>{release=()=>resolve({kind:'unbound'});}):{kind:'unbound'}});
  h.setBinding(null);waiting=true;const starting=h.adapter.checkOnce(onceArgs(h));while(!release)await new Promise(resolve=>setTimeout(resolve,1));
  const cancelled=h.adapter.cancelOnce(onceArgs(h));release();await starting;await cancelled;assert.equal(h.schedulers.length,0);h.advanceSeconds(300);await h.tick();assert.equal(h.messages.length,0);
});

test('one-off pre-step and turn-stopping hooks recheck native routing',async t=>{
  let rejected,cancelled=false;
  const h=await harness(t,{onWake:async({agent,ctx})=>{
    h.setBinding(binding);
    rejected=await ctx.serial('agent/pre-step',{agent,messages:[],turn:1,step:2,signal:new AbortController().signal},async()=>({kind:'enter',messages:[]}));
    agent.cancel=()=>{cancelled=true;};await ctx.serial('agent/turn-stopping',{agent,turn:1,signal:new AbortController().signal});
  }});
  h.setBinding(null);await h.adapter.checkOnce(onceArgs(h));await h.drain();h.advanceSeconds(60);await h.tick();assert.equal(rejected.kind,'reject');assert.equal(cancelled,true);assert.equal((await h.adapter.onceStatus(onceArgs(h))).status,'blocked');
});

test('a second one-off successful check retains the real source-review baseline and excludes management chatter',async t=>{
  const h=await harness(t);h.setBinding(null);const args=onceArgs(h);await h.adapter.checkOnce(args);await h.drain();h.advanceSeconds(60);await h.tick();
  await h.adapter.checkOnce(args);await h.drain();h.advanceSeconds(60);await h.tick();
  assert.match(h.messages[1].content[0].text,/上次检查时间：2026-10-18T16:01:00.000Z/);assert.match(h.messages[1].content[0].text,/跟进设置、状态查询、测试调度指令/);assert.equal((await h.adapter.onceStatus(args)).lastReviewedAt,'2026-10-18T16:02:00.000Z');
});

for(const failure of ['missing','blocked','throw'])test('one-off '+failure+' source checks fail without a successful review watermark or future occurrence',async t=>{
  const h=await harness(t,failure==='missing'?{onWake:async({events})=>events.push({seq:events.length,type:'assistant/message',data:{blocks:[{type:'text',text:'未读来源的合成回复'}]}})}:
    failure==='blocked'?{toolResult:(_name,args)=>args.action==='memory'?{status:'blocked',accepted:false}:{ok:true}}:
    {onWake:async()=>{throw new Error('Synthetic failed model wake');}});
  h.setBinding(null);await h.adapter.checkOnce(onceArgs(h));await h.drain();h.advanceSeconds(60);await h.tick();const result=await h.adapter.onceStatus(onceArgs(h));assert.equal(result.status,'failed');assert.equal(result.lastReviewedAt,null);assert.equal(result.nextDueAt,null);assert.equal(result.enabled,false);
  h.advance(10);await h.tick();assert.equal(h.messages.length,1);
});

test('same-session recurring wake defers a due one-off until the original wake settles',async t=>{
  let release,entered;let wakeCount=0;const arrived=new Promise(resolve=>{entered=resolve;});
  const h=await harness(t,{onWake:async({agent,ctx,events})=>{
    if(++wakeCount===1){entered();await new Promise(resolve=>{release=resolve;});}
    for(const action of ['memory','digest'])await ctx.tools.execute({callId:'shared-session-'+wakeCount+'-'+action,name:'project_companion',arguments:{action,project:h.root},agent,signal:new AbortController().signal});
    events.push({seq:events.length,type:'assistant/message',data:{blocks:[{type:'text',text:'Synthetic source-backed reply'}]}});
  }});
  await h.adapter.configure(h.args);await h.drain();h.advance(30);h.schedulers[0].requestDrive();await arrived;
  const args={...onceArgs(h),delivery:'wechat'};await h.adapter.checkOnce(args);const single=h.schedulers[1];await single.driveChain;h.advanceSeconds(60);single.requestDrive();await single.driveChain;
  assert.equal(h.messages.length,1);assert.equal((await h.adapter.onceStatus(args)).status,'queued');
  release();await h.schedulers[0].driveChain;h.advanceSeconds(30);await h.tick();assert.equal(h.messages.length,2);assert.equal((await h.adapter.onceStatus(args)).status,'completed');
});

test('a native agent removed while route status is pending is never cold resumed',async t=>{
  let waiting=false,release;const h=await harness(t,{readNativeRoute:async()=>waiting?new Promise(resolve=>{release=()=>resolve({kind:'unbound'});}):{kind:'unbound'}});
  h.setBinding(null);await h.adapter.checkOnce(onceArgs(h));await h.drain();waiting=true;h.advanceSeconds(60);const scheduler=h.schedulers[0];scheduler.requestDrive();
  while(!release)await new Promise(resolve=>setTimeout(resolve,1));
  h.agents.delete(h.owner.id);waiting=false;release();await scheduler.driveChain;
  assert.equal(h.resumes.length,0);assert.equal(h.messages.length,0);assert.equal((await h.adapter.onceStatus(onceArgs(h))).status,'blocked');
});

test('close during pending wake routing cannot masquerade as a completed one-off after reopening',async t=>{
  let waiting=false,release;const h=await harness(t,{readNativeRoute:async()=>waiting?new Promise(resolve=>{release=()=>resolve({kind:'unbound'});}):{kind:'unbound'}});
  h.setBinding(null);await h.adapter.checkOnce(onceArgs(h));await h.drain();waiting=true;h.advanceSeconds(60);const scheduler=h.schedulers[0];scheduler.requestDrive();
  while(!release)await new Promise(resolve=>setTimeout(resolve,1));
  const closing=h.adapter.close();waiting=false;release();await scheduler.driveChain;await closing;await h.reopen();
  const status=await h.adapter.onceStatus(onceArgs(h));assert.notEqual(status.status,'completed');assert.equal(status.enabled,false);assert.equal(status.lastReviewedAt,null);assert.equal(h.messages.length,0);assert.equal(h.resumes.length,0);
});
