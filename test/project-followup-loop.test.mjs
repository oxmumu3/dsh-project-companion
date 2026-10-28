import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,realpath,access} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {Context} from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime,{defineTool} from '@deepseek-ai/dsh-tools';
import {createScope} from '@deepseek-ai/dsh-scope';
import {ProactiveScheduler} from '../vendor/proactive/lib/scheduler.js';
import {createProjectFollowup} from '../src/project-followup.js';

const binding={userHash:'a'.repeat(64),botHash:'b'.repeat(64)};
async function harness(t,options={}){
  const temp=await realpath(await mkdtemp(join(tmpdir(),'dot-followup-loop-'))),root=join(temp,'project');await mkdir(root);
  const ownerRoot=options.ownerOutside?join(temp,'owner-workspace'):root;if(options.ownerOutside)await mkdir(ownerRoot);
  const ctx=new Context();await ctx.plugin(SystemPrompt,{});await ctx.plugin(ToolRuntime,{mode:'native'});
  ctx.provide('workingDirectory',{get:session=>session.header.cwd,ensure:async agent=>agent.session.header.cwd});
  const events=[],messages=[],tools=[],schedulers=[],invalidated=[],wakeErrors=[];let now=new Date('2026-10-18T16:00:00Z'),adapter,currentBinding=binding;
  const owner={id:'session-loop',status:'idle',session:{id:'session-loop',header:{cwd:ownerRoot,agentPreset:'default'},events,get seq(){return events.length;},requestHeader:()=>({config:{provider:'synthetic',model:'synthetic'}})},runMaintenance:async work=>work(),
    followup(message){messages.push(message);events.push({seq:events.length,type:'turn/start',data:{turn:messages.length},time:now.toISOString()},{seq:events.length+1,type:'user/message',data:message,time:now.toISOString()});},
    whenIdle:async()=>{try{await options.onWake?.(h);}catch(error){wakeErrors.push(error);throw error;}events.push({seq:events.length,type:'turn/end',data:{reason:{kind:'completed'}},time:now.toISOString()});}};
  const scope=createScope(ctx,owner);owner.ctx=scope.ctx;
  ctx.provide('agents',{get:id=>id===owner.id?owner:undefined});ctx.provide('agentDefaultModel',{currentSelection:()=>({provider:'synthetic',model:'synthetic'})});
  for(const name of ['project_companion','personal_context','send_wechat','bash'])ctx.tools.register(defineTool({name,description:'Synthetic only',parameters:{action:{type:'string'},project:{type:'string'},loopId:{type:'string'}},output:{schema:{type:'object',additionalProperties:true},render:()=>[]},execute:async args=>{tools.push({name,args});return options.toolResult?.(name,args)??{ok:true,quiet:false};}}));
  const adapterOptions={ctx,clock:()=>now,hostTimeZone:'America/Mexico_City',authorizeRoot:async value=>value===root,readBinding:async()=>currentBinding,readConnection:async()=>({state:'bound',sessionId:owner.id,bindingKey:'d'.repeat(64)}),invalidateLoop:value=>{invalidated.push(value);options.invalidateLoop?.(value);},createScheduler:deps=>{const s=new ProactiveScheduler(deps);schedulers.push(s);return s;},...(options.familyRoute?{familyRoute:options.familyRoute}: {})};
  if(options.pauseState)adapterOptions.pauseState=options.pauseState;
  if(options.canRun)adapterOptions.canRun=options.canRun;
  adapter=createProjectFollowup(adapterOptions);
  let call=0;
  const h={root,temp,ctx,owner,events,messages,tools,schedulers,invalidated,get adapter(){return adapter;},setBinding:value=>{currentBinding=value;},args:{root,sessionId:owner.id,projectLabel:'公开测试项目',everyMinutes:30,loopId:'loop_123'},
    invoke:(args,name='project_companion')=>ctx.tools.execute({callId:'loop-'+(++call),name,arguments:args,agent:owner,signal:new AbortController().signal}),
    reply:text=>events.push({seq:events.length,type:'assistant/message',data:{blocks:[{type:'text',text}]},time:now.toISOString()}),
    reclaim:async()=>{const result=await h.invoke({reason:'无实质变化'},'proactive_reclaim');events.push({seq:events.length,type:'tool/call',data:{name:'proactive_reclaim',arguments:'{}'}});return result;},
    drain:async()=>{for(const s of schedulers)await s.driveChain;},
    tick:async(seconds=1800)=>{now=new Date(now.getTime()+seconds*1000);for(const s of schedulers)s.requestDrive();await h.drain();if(wakeErrors.length)throw wakeErrors[0];},
    reopen:async()=>{await adapter.close();adapter=createProjectFollowup(adapterOptions);}};
  t.after(async()=>{await adapter.close();await scope.dispose();await ctx.fiber.dispose();await rm(temp,{recursive:true,force:true});});return h;
}
const exact=h=>({action:'context_check',project:h.root,loopId:h.args.loopId});

test('family Owner in a different workspace wakes exactly once and delivers the entire scoped response',async t=>{
 const sent=[],scope={familySessionId:'session-loop',bindingRevision:'a'.repeat(64)};
 const route={getScope:id=>id===scope.familySessionId?scope:null,isCurrent:value=>value===scope,recheck:async()=>true,routeState:async()=> 'current',
  readDelivery:async()=>({status:'absent'}),send:async value=>{assert.equal(value.authorize(),true);sent.push(value);return{status:'accepted'};}};
 const text='有来源的真实新增事项。'.repeat(30);
 const h=await harness(t,{familyRoute:route,ownerOutside:true,onWake:async h=>{assert.equal((await h.invoke(exact(h))).isError,false);h.reply(text);}});
 await h.adapter.checkOnce({...h.args,delivery:'family',delaySeconds:60});await h.drain();await h.tick(60);
 assert.equal(sent.length,1);assert.equal(sent[0].text,text);assert.equal((await h.adapter.onceStatus(h.args)).status,'completed');
 await h.tick(120);assert.equal(sent.length,1);
});

function familyFixture(overrides={}){
 const scope={familySessionId:'session-loop',bindingRevision:'a'.repeat(64)},deliveries=[],state={current:true,grant:true,offline:false};
 const route={getScope:id=>id===scope.familySessionId?scope:null,isCurrent:()=>state.current,recheck:async()=>state.grant,
   routeState:async()=>state.offline?'offline':state.current&&state.grant?'current':'changed',readDelivery:async()=>({status:'absent'}),send:async value=>{deliveries.push(value);return{status:'accepted'};},...overrides};
 return{scope,route,deliveries,state};
}

test('family one-off keeps quiet when scoped context did not change',async t=>{
 const f=familyFixture(),h=await harness(t,{familyRoute:f.route,ownerOutside:true,toolResult:()=>({ok:true,quiet:true}),onWake:async h=>{assert.equal((await h.invoke(exact(h))).isError,false);assert.equal((await h.reclaim()).isError,false);}});
 await h.adapter.checkOnce({...h.args,delivery:'family',delaySeconds:60});await h.drain();await h.tick(60);
 assert.equal(f.deliveries.length,0);assert.equal((await h.adapter.onceStatus(h.args)).status,'completed');
});

test('family one-off rejects old route or revoked source permission before wake',async t=>{
 for(const field of ['current','grant']){
  const f=familyFixture(),h=await harness(t,{familyRoute:f.route,ownerOutside:true,onWake:async h=>{await h.invoke(exact(h));h.reply('变化');}});
  await h.adapter.checkOnce({...h.args,delivery:'family',delaySeconds:60});await h.drain();f.state[field]=false;await h.tick(60);
  assert.equal(h.messages.length,0);assert.equal(f.deliveries.length,0);assert.equal((await h.adapter.onceStatus(h.args)).status,'blocked');
 }
});

test('a temporary Family disconnection defers a due check without reading or sending, then resumes once',async t=>{
 const f=familyFixture(),h=await harness(t,{familyRoute:f.route,ownerOutside:true,onWake:async h=>{assert.equal((await h.invoke(exact(h))).isError,false);h.reply('恢复后的项目变化');}});
 await h.adapter.checkOnce({...h.args,delivery:'family',delaySeconds:60});await h.drain();f.state.offline=true;f.state.current=false;await h.tick(60);
 assert.equal(h.tools.length,0);assert.equal(h.messages.length,0);assert.equal(f.deliveries.length,0);assert.equal((await h.adapter.onceStatus(h.args)).enabled,true);
 f.state.offline=false;f.state.current=true;await h.tick(30);assert.equal(f.deliveries.length,1);assert.equal((await h.adapter.onceStatus(h.args)).status,'completed');await h.tick(60);assert.equal(f.deliveries.length,1);
});

test('an offline Family check expires without a late send or automatic catch-up',async t=>{
 const f=familyFixture(),h=await harness(t,{familyRoute:f.route,ownerOutside:true,onWake:async h=>{await h.invoke(exact(h));h.reply('变化');}});
 await h.adapter.checkOnce({...h.args,delivery:'family',delaySeconds:60});await h.drain();f.state.offline=true;f.state.current=false;await h.tick(60);await h.tick(300);
 assert.equal((await h.adapter.onceStatus(h.args)).status,'blocked');f.state.offline=false;f.state.current=true;await h.tick(30);
 assert.equal(h.messages.length,0);assert.equal(h.tools.length,0);assert.equal(f.deliveries.length,0);
});

test('unknown Family route state defers safely without treating unknown as authorization',async t=>{
 const f=familyFixture(),h=await harness(t,{familyRoute:f.route,ownerOutside:true});
 await h.adapter.checkOnce({...h.args,delivery:'family',delaySeconds:60});await h.drain();f.route.routeState=async()=> 'unknown';await h.tick(60);
 assert.equal((await h.adapter.onceStatus(h.args)).enabled,true);assert.equal(h.messages.length,0);assert.equal(f.deliveries.length,0);
});

test('a long Family outage skips the expired recurring run while keeping future checks',async t=>{
 const f=familyFixture(),h=await harness(t,{familyRoute:f.route,ownerOutside:true,onWake:async h=>{await h.invoke(exact(h));h.reply('后续变化');}});
 await h.adapter.configure({...h.args,delivery:'family'});await h.drain();f.state.offline=true;f.state.current=false;await h.tick();await h.tick(21600);
 assert.equal((await h.adapter.status(h.args)).enabled,true);assert.equal(h.messages.length,0);assert.equal(f.deliveries.length,0);
 f.state.offline=false;f.state.current=true;await h.tick();assert.equal(f.deliveries.length,1);
});

test('a confirmed Family route change invalidates even a recurring check without a loop',async t=>{
 const f=familyFixture(),h=await harness(t,{familyRoute:f.route,ownerOutside:true});
 await h.adapter.configure({...h.args,loopId:undefined,delivery:'family'});await h.drain();f.state.current=false;await h.tick();
 assert.equal((await h.adapter.status(h.args)).enabled,false);assert.equal(h.messages.length,0);assert.equal(f.deliveries.length,0);
});

test('restarting a recurring Family check while temporarily offline preserves its existing plan',async t=>{
 const f=familyFixture(),h=await harness(t,{familyRoute:f.route,ownerOutside:true});
 await h.adapter.configure({...h.args,delivery:'family'});await h.drain();await h.reopen();const before=h.invalidated.length;f.state.offline=true;f.state.current=false;
 const status=await h.adapter.resume(h.args);assert.equal(status.enabled,true);assert.equal(h.invalidated.length,before);
 f.state.offline=false;f.state.current=true;await h.adapter.resume(h.args);assert.equal((await h.adapter.status(h.args)).enabled,true);
});

test('Family going offline during recurring recovery authorization preserves its existing plan',async t=>{
 const f=familyFixture(),h=await harness(t,{familyRoute:f.route,ownerOutside:true});
 await h.adapter.configure({...h.args,delivery:'family'});await h.drain();await h.reopen();
 f.route.recheck=async()=>{f.state.offline=true;f.state.current=false;return false;};
 const status=await h.adapter.resume(h.args);assert.equal(status.enabled,true);
});
test('a paused Dot service preserves the recurring Family plan across recovery and resumes when unpaused',async t=>{
 let paused=false;const f=familyFixture(),h=await harness(t,{familyRoute:f.route,ownerOutside:true,pauseState:async()=>paused,canRun:async()=>!paused});
 await h.adapter.configure({...h.args,delivery:'family'});await h.drain();await h.reopen();paused=true;f.route.recheck=async()=>!paused;
 assert.equal((await h.adapter.resume(h.args)).enabled,true);paused=false;assert.equal((await h.adapter.resume(h.args)).enabled,true);
});
test('a paused Dot service does not discard a pending one-off Family check',async t=>{
 let paused=false;const f=familyFixture(),h=await harness(t,{familyRoute:f.route,ownerOutside:true,pauseState:async()=>paused,canRun:async()=>!paused,onWake:async h=>{await h.invoke(exact(h));h.reply('恢复后的项目变化');}});
 await h.adapter.checkOnce({...h.args,delivery:'family',delaySeconds:60});await h.drain();paused=true;await h.tick(60);assert.equal((await h.adapter.onceStatus(h.args)).enabled,true);assert.equal(f.deliveries.length,0);
 paused=false;await h.tick(30);assert.equal(f.deliveries.length,1);
});
test('Dot pausing during route authorization defers the unstarted Family check',async t=>{
 let paused=false;const f=familyFixture(),h=await harness(t,{familyRoute:f.route,ownerOutside:true,pauseState:async()=>paused,canRun:async()=>!paused,onWake:async h=>{await h.invoke(exact(h));h.reply('恢复后的项目变化');}});
 await h.adapter.checkOnce({...h.args,delivery:'family',delaySeconds:60});await h.drain();f.route.recheck=async()=>{paused=true;return false;};await h.tick(60);
 assert.equal((await h.adapter.onceStatus(h.args)).enabled,true);assert.equal(h.messages.length,0);paused=false;f.route.recheck=async()=>true;await h.tick(30);assert.equal(f.deliveries.length,1);
});

test('family grant replacement during an asynchronous scope recheck cannot authorize the stale scope',async t=>{
 let enter,release,first=true;const entered=new Promise(resolve=>enter=resolve),held=new Promise(resolve=>release=resolve);
 const a={familySessionId:'session-loop',bindingRevision:'a'.repeat(64),leaseFingerprint:'old'},b={...a,leaseFingerprint:'new'};let current=a;
 const route={getScope:()=>current,isCurrent:scope=>scope===current,recheck:async()=>{if(first){first=false;enter();await held;}return true;},readDelivery:async()=>({status:'absent'}),send:async()=>({status:'accepted'})};
 const h=await harness(t,{familyRoute:route,ownerOutside:true});
 const requested=h.adapter.checkOnce({...h.args,delivery:'family',delaySeconds:60});await entered;current=b;release();
 await assert.rejects(requested,/binding|route|native|微信/i);assert.equal(h.schedulers.length,0);
});

test('cancelled family check performs no later wake, read or delivery',async t=>{
 const f=familyFixture(),h=await harness(t,{familyRoute:f.route,ownerOutside:true,onWake:async h=>{await h.invoke(exact(h));h.reply('变化');}});
 await h.adapter.checkOnce({...h.args,delivery:'family',delaySeconds:60});await h.drain();
 assert.equal((await h.adapter.cancelOnce(h.args)).status,'cancelled');await h.tick(120);
 assert.equal(h.messages.length,0);assert.equal(h.tools.length,0);assert.equal(f.deliveries.length,0);
});

test('unknown family delivery blocks rather than retrying or claiming completion',async t=>{
 let attempts=0;const f=familyFixture({send:async()=>{attempts++;return{status:'uncertain'};}});
 const h=await harness(t,{familyRoute:f.route,ownerOutside:true,onWake:async h=>{await h.invoke(exact(h));h.reply('变化');}});
 await h.adapter.checkOnce({...h.args,delivery:'family',delaySeconds:60});await h.drain();await h.tick(60);await h.tick(120);
 assert.equal(attempts,1);assert.equal((await h.adapter.onceStatus(h.args)).status,'blocked');
});

test('family recurring follow-up recognizes a prior accepted receipt after restart without waking again',async t=>{
 let wakes=0,sends=0,receipt={status:'absent'};const f=familyFixture({readDelivery:async()=>receipt,send:async()=>{sends++;return{status:'accepted'};}});
 const h=await harness(t,{familyRoute:f.route,ownerOutside:true,onWake:async h=>{wakes++;await h.invoke(exact(h));h.reply('变化');}});
 await h.adapter.configure({...h.args,delivery:'family'});await h.drain();await h.reopen();receipt={status:'accepted'};
 await h.adapter.resume(h.args);await h.drain();await h.tick();assert.equal(wakes,0);assert.equal(sends,0);
});

test('future family one-off restores only its existing watched plan after restart',async t=>{
 const f=familyFixture(),h=await harness(t,{familyRoute:f.route,ownerOutside:true,onWake:async h=>{await h.invoke(exact(h));h.reply('恢复后的变化');}});
 const original=await h.adapter.checkOnce({...h.args,delivery:'family',delaySeconds:60});await h.drain();await h.reopen();
 assert.equal(typeof h.adapter.recoverFamilyOnce,'function');
 const attempts=await Promise.all([h.adapter.recoverFamilyOnce(h.args),h.adapter.recoverFamilyOnce(h.args),h.adapter.recoverFamilyOnce(h.args)]);
 for(const recovered of attempts){assert.equal(recovered.status,'queued');assert.equal(recovered.alarmId,original.alarmId);}assert.equal(h.schedulers.length,2);
 await h.drain();await h.tick(60);assert.equal(f.deliveries.length,1);assert.equal((await h.adapter.onceStatus(h.args)).status,'completed');
});

test('restoring an overdue family one-off never wakes or sends',async t=>{
 const f=familyFixture(),h=await harness(t,{familyRoute:f.route,ownerOutside:true,onWake:async h=>{await h.invoke(exact(h));h.reply('变化');}});
 await h.adapter.checkOnce({...h.args,delivery:'family',delaySeconds:60});await h.drain();await h.reopen();await h.tick(120);
 const recovered=await h.adapter.recoverFamilyOnce(h.args);assert.equal(recovered.status,'blocked');await h.tick(60);
 assert.equal(h.messages.length,0);assert.equal(f.deliveries.length,0);
});

test('restoring an interrupted family one-off without a receipt never reruns it',async t=>{
 const f=familyFixture({readDelivery:async()=>({status:'uncertain'})}),h=await harness(t,{familyRoute:f.route,ownerOutside:true,onWake:async h=>{await h.invoke(exact(h));h.reply('变化');}});
 await h.adapter.checkOnce({...h.args,delivery:'family',delaySeconds:60});await h.drain();await h.reopen();
 const scopeFile=join(h.root,'.dsh/dot-checks',(await import('node:crypto')).createHash('sha256').update(h.owner.id).digest('hex'),'scope.json');
 const saved=JSON.parse(await readFile(scopeFile,'utf8'));saved.familyInflight='family-followup-'+'1'.repeat(64);await writeFile(scopeFile,JSON.stringify(saved));
 const recovered=await h.adapter.recoverFamilyOnce(h.args);assert.equal(recovered.status,'blocked');await h.tick(120);
 assert.equal(h.messages.length,0);assert.equal(f.deliveries.length,0);
});

test('family recovery ignores absent and legacy plans and does not create any files',async t=>{
 const f=familyFixture(),h=await harness(t,{familyRoute:f.route,ownerOutside:true});
 assert.equal((await h.adapter.recoverFamilyOnce(h.args)).status,'absent');await assert.rejects(access(join(h.root,'.dsh')));
 await h.adapter.checkOnce({...h.args,delivery:'wechat',delaySeconds:60});await h.drain();await h.reopen();
 const recovered=await h.adapter.recoverFamilyOnce(h.args);assert.equal(recovered.delivery,'wechat');assert.equal(h.schedulers.length,1);
});

test('offline family recovery does not rewrite an existing future plan',async t=>{
 const f=familyFixture(),h=await harness(t,{familyRoute:f.route,ownerOutside:true});
 await h.adapter.checkOnce({...h.args,delivery:'family',delaySeconds:60});await h.drain();await h.reopen();
 const folder=join(h.root,'.dsh/dot-checks',(await import('node:crypto')).createHash('sha256').update(h.owner.id).digest('hex'));
 const before=await readFile(join(folder,'scope.json'),'utf8');f.state.current=false;
 const recovered=await h.adapter.recoverFamilyOnce(h.args);assert.equal(recovered.recoveryPending,true);assert.equal(recovered.nextDueAt,JSON.parse(before).dueAt,'the caller needs the persisted deadline to retry while offline');assert.equal(await readFile(join(folder,'scope.json'),'utf8'),before);assert.equal(h.schedulers.length,1);
 f.state.current=true;const reconnected=await h.adapter.recoverFamilyOnce(h.args);assert.equal(reconnected.status,'queued');assert.equal(h.schedulers.length,2);
});
test('a one-off that expires while Family remains offline is blocked without a catch-up wake',async t=>{
 const f=familyFixture(),h=await harness(t,{familyRoute:f.route,ownerOutside:true});
 await h.adapter.checkOnce({...h.args,delivery:'family',delaySeconds:60});await h.drain();await h.reopen();f.state.current=false;
 const pending=await h.adapter.recoverFamilyOnce(h.args);assert.equal(pending.recoveryPending,true);await h.tick(120);
 const expired=await h.adapter.recoverFamilyOnce(h.args);assert.equal(expired.status,'blocked');assert.equal(expired.recoveryPending,undefined);assert.equal(h.messages.length,0);assert.equal(f.deliveries.length,0);
});
test('an inflight receipt that stays offline until its deadline becomes unknown and is never replayed',async t=>{
 const f=familyFixture(),h=await harness(t,{familyRoute:f.route,ownerOutside:true});await h.adapter.checkOnce({...h.args,delivery:'family',delaySeconds:60});await h.drain();await h.reopen();
 const scopeFile=join(h.root,'.dsh/dot-checks',(await import('node:crypto')).createHash('sha256').update(h.owner.id).digest('hex'),'scope.json');const saved=JSON.parse(await readFile(scopeFile,'utf8'));saved.familyInflight='family-followup-'+'3'.repeat(64);await writeFile(scopeFile,JSON.stringify(saved));f.state.current=false;
 assert.equal((await h.adapter.recoverFamilyOnce(h.args)).recoveryPending,true);await h.tick(120);
 const expired=await h.adapter.recoverFamilyOnce(h.args);assert.equal(expired.status,'blocked');assert.equal(expired.recoveryPending,undefined);f.state.current=true;assert.equal((await h.adapter.recoverFamilyOnce(h.args)).status,'blocked');assert.equal(h.messages.length,0);assert.equal(f.deliveries.length,0);
});

test('revoked original lease keeps a future family plan stopped after restart',async t=>{
 const f=familyFixture(),h=await harness(t,{familyRoute:f.route,ownerOutside:true});
 await h.adapter.checkOnce({...h.args,delivery:'family',delaySeconds:60});await h.drain();await h.reopen();f.state.grant=false;
 const recovered=await h.adapter.recoverFamilyOnce(h.args);assert.equal(recovered.recoveryPending,true);assert.equal(h.schedulers.length,1);await h.tick(120);assert.equal(h.messages.length,0);
});

test('accepted pre-crash family delivery is recorded once without a second wake',async t=>{
 const f=familyFixture({readDelivery:async()=>({status:'accepted'})}),h=await harness(t,{familyRoute:f.route,ownerOutside:true});
 await h.adapter.checkOnce({...h.args,delivery:'family',delaySeconds:60});await h.drain();await h.reopen();
 const scopeFile=join(h.root,'.dsh/dot-checks',(await import('node:crypto')).createHash('sha256').update(h.owner.id).digest('hex'),'scope.json');
 const saved=JSON.parse(await readFile(scopeFile,'utf8'));saved.familyInflight='family-followup-'+'2'.repeat(64);await writeFile(scopeFile,JSON.stringify(saved));
 assert.equal((await h.adapter.recoverFamilyOnce(h.args)).status,'completed');await h.tick(120);assert.equal(h.messages.length,0);assert.equal(f.deliveries.length,0);
});

test('loop plan persists exact scope, preserves same timer, and replaces a different loop',async t=>{
  const h=await harness(t);const first=await h.adapter.configure(h.args);await h.drain();
  assert.equal(first.loopId,h.args.loopId);
  const same=await h.adapter.configure(h.args);assert.equal(same.alarmId,first.alarmId);assert.equal(h.invalidated.length,0);
  const next=await h.adapter.configure({...h.args,loopId:'loop_456'});assert.notEqual(next.alarmId,first.alarmId);assert.equal(next.loopId,'loop_456');
  assert.deepEqual(h.invalidated,[{root:h.root,loopId:'loop_123'}]);
  const meta=JSON.parse(await readFile(join(h.root,'.dsh/dot-followup/scope.json'),'utf8'));assert.equal(meta.loopId,'loop_456');
  await h.reopen();assert.equal((await h.adapter.status(h.args)).loopId,'loop_456');
});

for(const method of ['configure','checkOnce'])test(method+' rejects invalid loop IDs before writing a plan',async t=>{
  const h=await harness(t);
  for(const loopId of ['',null,[],{},'with space','a/b','a\n','a'.repeat(101)])await assert.rejects(h.adapter[method]({...h.args,loopId,delivery:'wechat',delaySeconds:60}),/loop/i);
  assert.equal(h.schedulers.length,0);await assert.rejects(access(join(h.root,'.dsh')));
});

test('stored loop ID is validated instead of trusting modified scope metadata',async t=>{
  const h=await harness(t);await h.adapter.configure(h.args);await h.drain();await h.reopen();
  const path=join(h.root,'.dsh/dot-followup/scope.json'),meta=JSON.parse(await readFile(path,'utf8'));meta.loopId='../other';await writeFile(path,JSON.stringify(meta));
  await assert.rejects(h.adapter.status(h.args),/loop|metadata/i);
});

test('ordinary follow-up never gains context, handoff or send permissions',async t=>{
  const denied=[];const h=await harness(t,{onWake:async h=>{
    assert.equal(h.adapter.activeLoop({agent:h.owner}),null);
    for(const [name,args] of [['project_companion',exact(h)],['personal_context',{}],['send_wechat',{}]])denied.push(await h.invoke(args,name));
    for(const action of ['memory','digest'])assert.equal((await h.invoke({action,project:h.root})).isError,false);
    h.reply('合成项目进展');
  }});
  await h.adapter.configure({...h.args,loopId:undefined});await h.drain();await h.tick();
  assert.ok(denied.every(result=>result.isError));assert.equal((await h.adapter.status(h.args)).lastReviewedAt,'2026-10-18T16:30:00.000Z');
});

test('loop wake only permits exact action/root/ID once and exposes its loop to the handler',async t=>{
  const results=[];const h=await harness(t,{onWake:async h=>{
    assert.equal(h.adapter.activeLoop({agent:h.owner}),h.args.loopId);
    for(const [name,args] of [['project_companion',{...exact(h),loopId:'other'}],['project_companion',{...exact(h),project:'/other'}],['project_companion',{action:'memory',project:h.root}],['project_companion',{action:'digest',project:h.root}],['project_companion',{action:'coordinate',project:h.root}],['personal_context',{}],['send_wechat',{}]])results.push(await h.invoke(args,name));
    {const outcome=await h.invoke(exact(h));assert.equal(outcome.isError,false,JSON.stringify(outcome));}
    assert.equal((await h.invoke(exact(h))).isError,true,'one successful read must not be repeated in the same wake');
    h.reply('来源发生了有价值的新变化');
  }});
  assert.equal(h.adapter.activeLoop({agent:h.owner}),null);
  await h.adapter.configure(h.args);await h.drain();await h.tick();
  assert.ok(results.every(result=>result.isError));assert.equal(h.tools.length,1);assert.equal(h.adapter.activeLoop({agent:h.owner}),null);
  assert.equal((await h.adapter.status(h.args)).lastReviewedAt,'2026-10-18T16:30:00.000Z');
  const prompt=h.messages[0].content[0].text;assert.match(prompt,/action=context_check/);assert.ok(prompt.includes(JSON.stringify(h.root)));assert.ok(prompt.includes('loopId="loop_123"'));assert.match(prompt,/quiet=true.*proactive_reclaim/);assert.doesNotMatch(prompt,/action=memory|action=digest/);
});

test('one-off loop check needs one successful context_check, quiet result reclaims, and no recurrence remains',async t=>{
  const h=await harness(t,{toolResult:()=>({ok:true,quiet:true}),onWake:async h=>{{const outcome=await h.invoke(exact(h));assert.equal(outcome.isError,false,JSON.stringify(outcome));}assert.equal((await h.reclaim()).isError,false);}});
  await h.adapter.checkOnce({...h.args,delivery:'wechat',delaySeconds:60});await h.drain();await h.tick(60);
  const status=await h.adapter.onceStatus(h.args);assert.equal(status.status,'completed');assert.equal(status.loopId,h.args.loopId);assert.equal(status.lastReviewedAt,'2026-10-18T16:01:00.000Z');assert.equal(status.nextDueAt,null);assert.equal(h.tools.length,1);assert.equal(status.lastCheckOutcome,'quiet');
  const inspected=await h.adapter.inspect({...h.args,expectedBinding:{sessionId:h.owner.id,bindingKey:'d'.repeat(64)}});assert.equal(inspected.once.lastCheckOutcome,'quiet');
});

for(const value of [{ok:false,quiet:true},{accepted:false,quiet:true},{status:'blocked',quiet:true},{code:'invalid_action',quiet:true}])test('failed context_check does not mark review complete: '+JSON.stringify(value),async t=>{
  const h=await harness(t,{toolResult:()=>value,onWake:async h=>{await h.invoke(exact(h));h.reply('不可冒充成功');}});
  await h.adapter.checkOnce({...h.args,delivery:'wechat',delaySeconds:60});await h.drain();await h.tick(60);
  assert.equal((await h.adapter.onceStatus(h.args)).status,'failed');assert.equal((await h.adapter.onceStatus(h.args)).lastReviewedAt,null);assert.equal((await h.adapter.onceStatus(h.args)).lastCheckOutcome,undefined);
});

test('quiet result followed by ordinary text is not accepted as a completed review',async t=>{
  const h=await harness(t,{toolResult:()=>({ok:true,quiet:true}),onWake:async h=>{await h.invoke(exact(h));h.reply('旧汇报不能重复发送');}});
  await h.adapter.checkOnce({...h.args,delivery:'wechat',delaySeconds:60});await h.drain();await h.tick(60);
  assert.equal((await h.adapter.onceStatus(h.args)).status,'failed');assert.equal((await h.adapter.onceStatus(h.args)).lastReviewedAt,null);
});

for(const method of ['cancel','cancelOnce','close'])test(method+' invalidates active loop immediately and cannot continue reading',async t=>{
  let operation;const h=await harness(t,{onWake:async h=>{
    assert.equal(h.adapter.activeLoop({agent:h.owner}),h.args.loopId);
    operation=method==='close'?h.adapter.close():h.adapter[method](h.args);
    assert.deepEqual(h.invalidated,[{root:h.root,loopId:h.args.loopId}]);
    assert.equal(h.adapter.activeLoop({agent:h.owner}),null);
    assert.equal((await h.invoke(exact(h))).isError,true);
    assert.equal((await h.reclaim()).isError,false);
  }});
  await h.adapter[method==='cancelOnce'?'checkOnce':'configure']({...h.args,delivery:'wechat',delaySeconds:60});await h.drain();await h.tick(method==='cancelOnce'?60:1800);await operation;assert.equal(h.tools.length,0);
});

test('cancel invalidates a context read already in flight, and its eventual success does not advance review',async t=>{
  let h,cancellation;const seen=[];
  h=await harness(t,{toolResult:async()=>{cancellation=h.adapter.cancel(h.args);seen.push(h.invalidated.length);return{ok:true,quiet:false};},onWake:async h=>{await h.invoke(exact(h));h.reply('过期结果');}});
  await h.adapter.configure(h.args);await h.drain();await h.tick();await cancellation;
  assert.deepEqual(seen,[1]);assert.equal((await h.adapter.status(h.args)).lastReviewedAt,null);
});

test('a denied UI cancellation neither invalidates the loop nor disables its plan',async t=>{
  const h=await harness(t);await h.adapter.configure(h.args);await h.drain();
  await assert.rejects(h.adapter.cancel({...h.args,authorizeMutation:async()=>false}),/authoriz/i);
  assert.equal(h.invalidated.length,0);assert.equal((await h.adapter.status(h.args)).enabled,true);
});

test('changing a pending one-off loop replaces it instead of returning the wrong saved context',async t=>{
  const h=await harness(t),args={...h.args,delivery:'wechat',delaySeconds:60};const first=await h.adapter.checkOnce(args);await h.drain();
  const next=await h.adapter.checkOnce({...args,loopId:'loop_456'});assert.notEqual(next.alarmId,first.alarmId);assert.equal(next.loopId,'loop_456');assert.deepEqual(h.invalidated,[{root:h.root,loopId:'loop_123'}]);
});

test('quiet result requires explicit reclaim, not merely an empty model turn',async t=>{
  const h=await harness(t,{toolResult:()=>({ok:true,quiet:true}),onWake:async h=>{assert.equal((await h.invoke(exact(h))).isError,false);}});
  await h.adapter.checkOnce({...h.args,delivery:'wechat',delaySeconds:60});await h.drain();await h.tick(60);
  const status=await h.adapter.onceStatus(h.args);assert.equal(status.status,'failed');assert.equal(status.lastReviewedAt,null);
});

test('parallel context checks cannot enter the connector twice in one wake',async t=>{
  let entered,release;const started=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
  const h=await harness(t,{toolResult:async()=>{entered();await gate;return{ok:true,quiet:false};},onWake:async h=>{
    const first=h.invoke(exact(h));await started;const duplicate=await h.invoke(exact(h));release();assert.equal(duplicate.isError,true);assert.equal((await first).isError,false);h.reply('一份变化');
  }});
  await h.adapter.configure(h.args);await h.drain();await h.tick();assert.equal(h.tools.length,1);
});

test('reconfiguring an executing loop invalidates the old read and resets its source baseline',async t=>{
  let h;h=await harness(t,{toolResult:async()=>{await h.adapter.configure({...h.args,loopId:'loop_456'});assert.deepEqual(h.invalidated,[{root:h.root,loopId:'loop_123'}]);assert.equal(h.adapter.activeLoop({agent:h.owner}),null);return{ok:true,quiet:false};},onWake:async h=>{await h.invoke(exact(h));h.reply('旧配置的结果');}});
  await h.adapter.configure(h.args);await h.drain();await h.tick();const status=await h.adapter.status(h.args);assert.equal(status.loopId,'loop_456');assert.equal(status.lastReviewedAt,null);
});

test('a following explicit user turn has no activeLoop and is not restricted by the finished wake',async t=>{
  const h=await harness(t,{onWake:async h=>{
    h.events.push({seq:h.events.length,type:'turn/end',data:{reason:{kind:'completed'}}},{seq:h.events.length+1,type:'turn/start',data:{turn:2}},{seq:h.events.length+2,type:'user/message',data:{source:{kind:'user'},content:[{type:'text',text:'新的用户请求'}]}});
    assert.equal(h.adapter.activeLoop({agent:h.owner}),null);assert.equal((await h.invoke({},'personal_context')).isError,false);
  }});
  await h.adapter.configure(h.args);await h.drain();await h.tick();assert.equal(h.tools.length,1);
});

for(const code of ['LOOP_AUTH_CHANGED','LOOP_NOT_FOUND','LOOP_SCOPE_CHANGED','LOOP_STOPPED'])test('terminal '+code+' stops the loop timer once and persists a blocked plan',async t=>{
 const h=await harness(t,{toolResult:()=>({status:'blocked',code}),onWake:async h=>{await h.invoke(exact(h));await h.reclaim();}});
 await h.adapter.configure(h.args);await h.drain();await h.tick();const status=await h.adapter.status(h.args);
 assert.equal(status.enabled,false);assert.equal(status.running,false);assert.match(status.blocked,/已停止|停用/);assert.equal(status.nextDueAt,null);assert.equal(status.lastReviewedAt,null);
 await h.tick();assert.equal(h.tools.length,1);assert.equal(h.messages.length,1);await h.reopen();const stored=await h.adapter.status(h.args);assert.equal(stored.enabled,false);assert.ok(stored.blocked);await h.adapter.resume(h.args);await h.tick();assert.equal(h.messages.length,1);
 assert.equal((await h.adapter.cancel(h.args)).enabled,false);
});
test('a transient LOOP_UNAVAILABLE does not silently stop the authorized recurring loop',async t=>{
 const h=await harness(t,{toolResult:()=>({status:'blocked',code:'LOOP_UNAVAILABLE'}),onWake:async h=>{await h.invoke(exact(h));await h.reclaim();}});
 await h.adapter.configure(h.args);await h.drain();await h.tick();assert.equal((await h.adapter.status(h.args)).enabled,true);assert.equal((await h.adapter.status(h.args)).lastReviewedAt,null);await h.tick();assert.equal(h.tools.length,2);assert.equal(h.invalidated.length,0);
});
test('terminal loop error blocks a one-off and leaves no future occurrence',async t=>{
 const h=await harness(t,{toolResult:()=>({status:'blocked',code:'LOOP_AUTH_CHANGED'}),onWake:async h=>{await h.invoke(exact(h));await h.reclaim();}});
 await h.adapter.checkOnce({...h.args,delivery:'wechat',delaySeconds:60});await h.drain();await h.tick(60);const status=await h.adapter.onceStatus(h.args);assert.equal(status.status,'blocked');assert.equal(status.enabled,false);assert.ok(status.blocked);assert.equal(status.nextDueAt,null);
});

test('an in-flight read returning LOOP_STOPPED after explicit cancellation cannot relabel it blocked',async t=>{
 let h,cancellation;h=await harness(t,{toolResult:async()=>{cancellation=h.adapter.cancelOnce(h.args);return{status:'blocked',code:'LOOP_STOPPED'};},onWake:async h=>{await h.invoke(exact(h));await h.reclaim();}});
 await h.adapter.checkOnce({...h.args,delivery:'wechat',delaySeconds:60});await h.drain();await h.tick(60);await cancellation;const status=await h.adapter.onceStatus(h.args);assert.equal(status.status,'cancelled');assert.equal(status.blocked,undefined);
});
for(const stage of ['before-wake','before-read','after-read'])test('loop route change '+stage+' stops the recurring timer without adopting a new binding',async t=>{
 const h=await harness(t,{onWake:async h=>{if(stage==='before-read')h.setBinding({...binding,userHash:'c'.repeat(64)});await h.invoke(exact(h));if(stage==='after-read')h.setBinding({...binding,userHash:'c'.repeat(64)});await h.reclaim();}});
 await h.adapter.configure(h.args);await h.drain();if(stage==='before-wake')h.setBinding({...binding,userHash:'c'.repeat(64)});await h.tick();
 const status=await h.adapter.status(h.args);assert.equal(status.enabled,false);assert.equal(status.running,false);assert.ok(status.blocked);assert.equal(status.lastReviewedAt,null);const count=h.messages.length;await h.tick();assert.equal(h.messages.length,count);
});


test('lastCheckOutcome retains verified quiet checks through passive inspect and same-loop reconfiguration',async t=>{
 const h=await harness(t,{toolResult:()=>({ok:true,quiet:true}),onWake:async h=>{await h.invoke(exact(h));await h.reclaim();}});
 await h.adapter.configure(h.args);await h.drain();await h.tick();
 const status=await h.adapter.status(h.args);assert.equal(status.lastCheckOutcome,'quiet');assert.equal(status.lastReviewedAt,'2026-10-18T16:30:00.000Z');
 await h.reopen();const path=join(h.root,'.dsh/dot-followup/scope.json'),before=await readFile(path,'utf8');
 const inspection=await h.adapter.inspect({...h.args,expectedBinding:{sessionId:h.owner.id,bindingKey:'d'.repeat(64)}});assert.equal(inspection.followup.lastCheckOutcome,'quiet');assert.equal(await readFile(path,'utf8'),before);
 const changedCadence=await h.adapter.configure({...h.args,everyMinutes:60});assert.equal(changedCadence.lastCheckOutcome,'quiet');assert.equal(changedCadence.lastReviewedAt,status.lastReviewedAt);
 const changedLoop=await h.adapter.configure({...h.args,loopId:'loop_other'});assert.equal(changedLoop.lastReviewedAt,null);assert.equal(Object.hasOwn(changedLoop,'lastCheckOutcome'),false);
});

test('lastCheckOutcome calls ordinary silent source review reviewed without inferring quiet from reclaim',async t=>{
 const h=await harness(t,{toolResult:()=>({ok:true,quiet:true}),onWake:async h=>{for(const action of ['memory','digest'])await h.invoke({action,project:h.root});await h.reclaim();}});
 await h.adapter.configure({...h.args,loopId:undefined});await h.drain();await h.tick();
 const status=await h.adapter.status(h.args);assert.equal(status.lastCheckOutcome,'reviewed');assert.equal(status.lastReviewedAt,'2026-10-18T16:30:00.000Z');
});

test('lastCheckOutcome records reviewed for a verified reply without claiming a new result or delivery',async t=>{
 const h=await harness(t,{toolResult:()=>({ok:true,quiet:false}),onWake:async h=>{await h.invoke(exact(h));h.reply('已有来源已核对，内容仍由用户验收。');}});
 await h.adapter.checkOnce({...h.args,delivery:'wechat',delaySeconds:60});await h.drain();await h.tick(60);
 const status=await h.adapter.onceStatus(h.args);assert.equal(status.lastCheckOutcome,'reviewed');assert.equal(status.lastReviewedAt,'2026-10-18T16:01:00.000Z');
});

for(const once of [false,true])test('lastCheckOutcome stays optional for legacy '+(once?'one-off':'recurring')+' metadata and never invents history',async t=>{
 const h=await harness(t);await h.adapter[once?'checkOnce':'configure']({...h.args,delivery:'wechat',delaySeconds:60});await h.drain();await h.reopen();
 const path=join(h.root,'.dsh',once?'dot-checks/'+createHash('sha256').update(h.owner.id).digest('hex'):'dot-followup','scope.json');
 const meta=JSON.parse(await readFile(path,'utf8'));meta.lastReviewedAt='2026-10-18T15:00:00.000Z';delete meta.lastCheckOutcome;await writeFile(path,JSON.stringify(meta));const before=await readFile(path,'utf8');
 const view=await h.adapter.inspect({...h.args,expectedBinding:{sessionId:h.owner.id,bindingKey:'d'.repeat(64)}});assert.equal(Object.hasOwn(view[once?'once':'followup'],'lastCheckOutcome'),false);assert.equal(view[once?'once':'followup'].lastReviewedAt,meta.lastReviewedAt);assert.equal(await readFile(path,'utf8'),before);
});

for(const once of [false,true])for(const outcome of ['reported_sent',true,null])test('lastCheckOutcome rejects unsupported '+JSON.stringify(outcome)+' in '+(once?'one-off':'recurring')+' metadata',async t=>{
 const h=await harness(t);await h.adapter[once?'checkOnce':'configure']({...h.args,delivery:'wechat',delaySeconds:60});await h.drain();await h.reopen();
 const path=join(h.root,'.dsh',once?'dot-checks/'+createHash('sha256').update(h.owner.id).digest('hex'):'dot-followup','scope.json'),meta=JSON.parse(await readFile(path,'utf8'));meta.lastCheckOutcome=outcome;meta.lastReviewedAt='2026-10-18T15:00:00.000Z';await writeFile(path,JSON.stringify(meta));
 await assert.rejects(h.adapter[once?'onceStatus':'status'](h.args),/outcome|metadata/i);
});

test('lastCheckOutcome is not created by a cancelled context read even when its late result says quiet',async t=>{
 let h,cancellation;h=await harness(t,{toolResult:async()=>{cancellation=h.adapter.cancel(h.args);return{ok:true,quiet:true};},onWake:async h=>{await h.invoke(exact(h));await h.reclaim();}});
 await h.adapter.configure(h.args);await h.drain();await h.tick();await cancellation;
 const status=await h.adapter.status(h.args);assert.equal(status.lastReviewedAt,null);assert.equal(Object.hasOwn(status,'lastCheckOutcome'),false);
});

for(const quiet of [false,'true',1])test('lastCheckOutcome does not infer quiet from non-true context value '+JSON.stringify(quiet),async t=>{
 const h=await harness(t,{toolResult:()=>({ok:true,quiet}),onWake:async h=>{await h.invoke(exact(h));await h.reclaim();}});
 await h.adapter.checkOnce({...h.args,delivery:'wechat',delaySeconds:60});await h.drain();await h.tick(60);
 assert.equal((await h.adapter.onceStatus(h.args)).lastCheckOutcome,'reviewed');
});

test('lastCheckOutcome remains paired with its previous successful check when a later attempt fails',async t=>{
 let succeeds=true;const h=await harness(t,{toolResult:()=>succeeds?{ok:true,quiet:true}:{ok:false,quiet:true},onWake:async h=>{await h.invoke(exact(h));await h.reclaim();}});
 await h.adapter.configure(h.args);await h.drain();await h.tick();const previous=await h.adapter.status(h.args);assert.equal(previous.lastCheckOutcome,'quiet');
 succeeds=false;await h.tick();const failed=await h.adapter.status(h.args);assert.equal(failed.lastCheckOutcome,'quiet');assert.equal(failed.lastReviewedAt,previous.lastReviewedAt,'failure cannot fabricate a newer successful quiet check');
});
