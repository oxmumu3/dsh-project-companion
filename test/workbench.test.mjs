import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Context} from '@deepseek-ai/cordis';
import {bindingRevision} from '../src/workbench-scope.js';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import CommandRuntime from '@deepseek-ai/dsh-commands';
import Storage from '@deepseek-ai/dsh-storage';
import * as JsonStorage from '@deepseek-ai/dsh-storage-json';
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain';
import SessionStore from '@deepseek-ai/dsh-session';

const now='2026-10-19T15:00:00.000Z';
const binding={state:'bound',sessionId:'source-session',bindingKey:'a'.repeat(64)};
const returnBinding={userHash:'c'.repeat(64),botHash:'d'.repeat(64)};
const project={id:'p_one',root:'/synthetic/watched-project',label:'当前项目',sessionIds:['project-session'],github:'owner/repo',watchedAt:now,events:[{kind:'assistant',text:'助手记录，仍待核对',at:now,sessionId:'project-session',id:'event-1'}]};
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
test('shared WeChat plans retain daily clock and zone and render a Family single check',async()=>{
 const followup={inspect:async()=>({followup:{enabled:true,running:true,everyMinutes:1440,dailyTime:'21:30',timeZone:'Asia/Shanghai',nextDueAt:now},once:{enabled:true,running:false,status:'queued',delivery:'family',nextDueAt:now}})};
 const f=await fixture({dependencies:{followup}}),value=await f.adapter.snapshot(),plans=value.projects[0].followup;
 assert.equal(plans.available,true);assert.equal(plans.followup.dailyTime,'21:30');assert.equal(plans.followup.timeZone,'Asia/Shanghai');assert.equal(plans.once.delivery,'wechat');assert.equal(plans.once.status,'queued');
});
test('invalid mixed daily schedule never becomes an interval-looking visible plan',async()=>{
 for(const schedule of [{dailyTime:'99:00',timeZone:'Asia/Shanghai',everyMinutes:1440},{dailyTime:'21:30',timeZone:'PRIVATE INVALID',everyMinutes:1440},{dailyTime:'21:30',timeZone:'Asia/Shanghai',everyMinutes:60}]){
 const f=await fixture({dependencies:{followup:{inspect:async()=>({followup:{enabled:true,running:true,...schedule},once:null})}}});
 const result=await f.adapter.snapshot();assert.equal(result.projects[0].followup.available,false);assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
 }
});
const memoryRow=(kind,index=0,extra={})=>({id:`memory-${index}`,kind,text:`已有${kind}记录 ${index}`,at:now,source:{kind:'assistant',reference:'session:recorded-session#turn7'},verified:true,sessionId:'PRIVATE MEMORY SESSION',fingerprint:'PRIVATE FINGERPRINT',...extra});
async function api(){const value=await import('../src/workbench.js').catch(()=>({}));assert.equal(typeof value.createWorkbench,'function','read-only workbench adapter must exist');assert.equal(typeof value.registerWorkbenchRoute,'function','authenticated workbench route must exist');return value;}
async function fixture(options={}){
  const {createWorkbench}=await api();let connection=options.connection??binding;
  const calls=[];
  const adapter=createWorkbench({
    service:{watchedProjects:async()=>{calls.push('projects');return options.projects??[structuredClone(project)];}},
    readState:async()=>{calls.push('state');return options.state??{paused:false,reminders:[],daily:null,outbox:[]};},
    readConnection:async()=>{calls.push('connection');return connection;},
    taskResults:{inspect:async(sessionId,args)=>{calls.push([args?.id?'detail':'jobs',sessionId,args]);return options.jobs?.(sessionId,args)??{jobs:[]};},status:()=>{throw new Error('GET must not load recovery status');}},
    readBinding:async sessionId=>{calls.push(['binding',sessionId]);return returnBinding;},
    readProject:async root=>{calls.push(['files',root]);return options.readProject?.(root)??[{path:'README.md',status:'ok',text:'来源正文',modifiedAt:now,truncated:false}];},
    clock:()=>new Date(now),hostTimeZone:()=> 'America/Mexico_City',...options.dependencies,
  });
  return{adapter,calls,setConnection:value=>{connection=value;}};
}

test('unbound workbench still reads watched projects and does not query a session',async()=>{
  const f=await fixture({connection:{state:'awaiting-message',sessionId:'untrusted',bindingKey:binding.bindingKey}});
  const value=await f.adapter.snapshot();
  assert.equal(value.version,1);assert.equal(value.generatedAt,now);assert.equal(value.hostTimeZone,'America/Mexico_City');
  assert.deepEqual(value.connection,{state:'awaiting-message'});assert.equal(value.projects.length,1);assert.equal(value.projects[0].sources[0].text,'来源正文');
  assert.deepEqual(value.jobs,[]);assert.equal(value.availability.jobs,false);assert.equal(f.calls.some(item=>Array.isArray(item)&&item[0]==='jobs'),false);
});

test('unbound overview inspects only watched project memory and retains unverified source evidence',async()=>{
  const calls=[];const memory={inspect:async input=>{calls.push(input);return{goals:[memoryRow('goal',0)],entries:[memoryRow('blocker',1),memoryRow('next_step',2),memoryRow('decision',3)],changes:[]};},read:()=>{throw new Error('GET must not use write-capable read');},remember:()=>{throw new Error('GET must not remember');}};
  const f=await fixture({connection:{state:'missing'},dependencies:{memory}});const value=await f.adapter.snapshot();const overview=value.projects[0].overview;
  assert.deepEqual(calls,[{root:project.root,sessionId:'workbench-view'}]);
  assert.equal(overview.available,true);assert.equal(overview.goals[0].kind,'goal');assert.equal(overview.blockers[0].kind,'blocker');assert.equal(overview.nextSteps[0].kind,'next_step');assert.equal(overview.recent.length,4);
  for(const row of [...overview.goals,...overview.blockers,...overview.nextSteps,...overview.recent]){
    assert.deepEqual(Object.keys(row).sort(),['id','kind','text','at','source','verified'].sort());assert.deepEqual(Object.keys(row.source).sort(),['kind','reference']);assert.equal(row.verified,false);
  }
  assert.equal(JSON.stringify(value).includes('PRIVATE MEMORY'),false);assert.equal(JSON.stringify(value).includes('PRIVATE FINGERPRINT'),false);
  assert.equal(f.calls.some(item=>Array.isArray(item)&&item[0]==='jobs'),false);
});

test('overview bounds existing memory, cleans text and provenance, and omits malformed records',async()=>{
  const goals=Array.from({length:10},(_,i)=>memoryRow('goal',i,{at:new Date(Date.parse(now)+i).toISOString()}));
  const entries=['blocker','next_step','context'].flatMap((kind,j)=>Array.from({length:6},(_,i)=>memoryRow(kind,10+j*6+i)));
  entries.unshift(memoryRow('blocker',40,{text:`${project.root} ${binding.bindingKey} api_key=private-key `+'文'.repeat(1000),source:{kind:'file',reference:'README.md#'+'A'.repeat(600)}}));
  entries.push(memoryRow('task',90),memoryRow('context',91,{source:{kind:'tool',reference:'PRIVATE SOURCE'}}),memoryRow('context',92,{source:{kind:'file',reference:'/private/secret.md'}}),memoryRow('context',93,{source:{kind:'file',reference:'../secret.md'}}),memoryRow('context',94,{at:'invalid'}),memoryRow('context',95,{id:'/private/id'}));
  const f=await fixture({dependencies:{memory:{inspect:async()=>({goals,entries,changes:[]})}}});const value=await f.adapter.snapshot(),overview=value.projects[0].overview;
  assert.equal(overview.available,true);assert.equal(overview.goals.length,3);assert.equal(overview.blockers.length,3);assert.equal(overview.nextSteps.length,3);assert.equal(overview.recent.length,4);
  assert.equal(overview.goals[0].id,'memory-9');assert.ok(overview.blockers[0].text.length<=500);assert.ok(overview.blockers[0].source.reference.length<=500);
  for(const secret of [project.root,binding.bindingKey,'private-key','PRIVATE SOURCE','/private/secret.md','../secret.md','/private/id'])assert.equal(JSON.stringify(overview).includes(secret),false,secret);
});

test('empty confirmed memory differs from missing, malformed or failed inspection',async()=>{
  const empty={available:false,goals:[],blockers:[],nextSteps:[],recent:[]};
  for(const memory of [undefined,{read:()=>{throw new Error('unsafe fallback');}},{inspect:async()=>null},{inspect:async()=>({goals:'bad',entries:[]})},{inspect:async()=>{throw new Error('PRIVATE MEMORY FAILURE /secret/root');}}]){
    const f=await fixture({dependencies:{memory}});const value=await f.adapter.snapshot();assert.deepEqual(value.projects[0].overview,empty);assert.equal(JSON.stringify(value).includes('PRIVATE MEMORY FAILURE'),false);
  }
  const f=await fixture({dependencies:{memory:{inspect:async()=>({goals:[],entries:[],changes:[]})}}});assert.deepEqual((await f.adapter.snapshot()).projects[0].overview,{...empty,available:true});
});

test('overview failures are isolated per project and close discards an in-flight memory result',async()=>{
  const second={...project,root:'/synthetic/second-project',label:'第二个项目'};
  const f=await fixture({projects:[project,second],dependencies:{memory:{inspect:async({root})=>{if(root===project.root)throw new Error('private');return{goals:[],entries:[memoryRow('context')],changes:[]};}}}});
  const value=await f.adapter.snapshot();assert.equal(value.projects[0].overview.available,false);assert.equal(value.projects[1].overview.available,true);
  const entered=deferred(),gate=deferred();const closing=await fixture({dependencies:{memory:{inspect:async()=>{entered.resolve();await gate.promise;return{goals:[],entries:[memoryRow('context')],changes:[]};}}}});
  const pending=closing.adapter.snapshot();await entered.promise;closing.adapter.close();gate.resolve();await assert.rejects(pending,/关闭|停止/);
});

test('closing while files are pending prevents starting a later memory inspection',async()=>{
  const entered=deferred(),gate=deferred();let reads=0;
  const f=await fixture({readProject:async()=>{entered.resolve();await gate.promise;return[];},dependencies:{memory:{inspect:async()=>{reads++;return{goals:[],entries:[]};}}}});
  const pending=f.adapter.snapshot();await entered.promise;f.adapter.close();gate.resolve();await assert.rejects(pending,/关闭|停止/);assert.equal(reads,0);
});

test('bound jobs use only the verified source session and whitelist every output field',async()=>{
  const f=await fixture({jobs:async()=>({jobs:[{id:'job-1',projectLabel:'当前项目',task:'检查README',status:'completed',createdAt:now,finishedAt:now,reply:'DO NOT EXPORT REPLY',targetSessionId:'private-target',projectRoot:project.root,returnBinding:{userHash:'private-user'},delivery:{status:'reported_sent',detail:'通道报告已发',text:'DO NOT EXPORT DELIVERY'}}]})});
  const value=await f.adapter.snapshot();
  assert.deepEqual(f.calls.filter(item=>Array.isArray(item)&&item[0]==='jobs'),[['jobs','source-session',{expectedBinding:returnBinding}]]);
  assert.deepEqual(value.connection,{state:'bound',sessionId:'source-session'});
  assert.equal(value.jobs[0].status,'completed');assert.equal(value.jobs[0].delivery.status,'reported_sent');
  for(const secret of [project.root,binding.bindingKey,'DO NOT EXPORT','private-target','private-user','bindingKey','projectRoot'])assert.equal(JSON.stringify(value).includes(secret),false,secret);
  assert.deepEqual(Object.keys(value.jobs[0]).sort(),['id','projectLabel','task','status','createdAt','finishedAt','delivery','result'].sort());
  assert.equal(value.jobs[0].result.available,false);
});

test('binding replacement while jobs are being read discards their content and marks connection unknown',async()=>{
  const gate=deferred(),entered=deferred();
  const f=await fixture({jobs:async()=>{entered.resolve();await gate.promise;return{jobs:[{id:'job-1',task:'PRIVATE OLD BINDING',projectLabel:'旧项目',status:'running',createdAt:now}]};}});
  const pending=f.adapter.snapshot();await entered.promise;f.setConnection({...binding,bindingKey:'b'.repeat(64)});gate.resolve();
  const value=await pending;assert.deepEqual(value.jobs,[]);assert.deepEqual(value.connection,{state:'unknown'});assert.equal(JSON.stringify(value).includes('PRIVATE OLD'),false);
});

test('latest completed reply is inspected once, redacted, bounded and keeps truncation evidence',async()=>{
  const rows=[{id:'old',projectLabel:'项目',task:'旧交办',status:'completed',createdAt:'2026-10-19T14:00:00Z',finishedAt:now},{id:'latest',projectLabel:'项目',task:'新交办',status:'completed',createdAt:now,finishedAt:'2026-10-19T15:01:00Z'},{id:'interrupted',projectLabel:'项目',task:'中断',status:'interrupted',createdAt:'2026-10-19T14:30:00Z'}];
  const f=await fixture({jobs:async(_id,args)=>args.id?{jobs:[{...rows[1],reply:`${project.root} ${binding.bindingKey} api_key=private-token `+'字'.repeat(900),replyTruncated:false}]}:{jobs:rows}});
  const value=await f.adapter.snapshot();
  assert.equal(Object.hasOwn(value.jobs[0],'result'),false);assert.equal(Object.hasOwn(value.jobs[2],'result'),false);
  assert.equal(value.jobs[1].result.available,true);assert.equal(value.jobs[1].result.truncated,true);assert.ok(value.jobs[1].result.text.length<=600);
  assert.deepEqual(f.calls.filter(row=>row[0]==='detail'),[['detail','source-session',{id:'latest',expectedBinding:returnBinding}]]);
  for(const secret of [project.root,binding.bindingKey,'private-token'])assert.equal(JSON.stringify(value.jobs).includes(secret),false);
  assert.match(value.bindingRevision,/^[a-f0-9]{64}$/);assert.notEqual(value.bindingRevision,binding.bindingKey);
});

test('reply read failure or mismatched detail keeps jobs available and does not claim a missing result',async()=>{
  for(const detail of [async()=>{throw new Error('PRIVATE');},async()=>({jobs:[]}),async()=>({jobs:[{id:'other',reply:'PRIVATE',replyTruncated:false}]})]){
    const f=await fixture({jobs:async(_id,args)=>args.id?detail():{jobs:[{id:'job',projectLabel:'项目',task:'交办',status:'completed',createdAt:now}]}});
    const value=await f.adapter.snapshot();assert.equal(value.availability.jobs,true);assert.deepEqual(value.jobs[0].result,{available:false,text:'',truncated:false});
  }
});

test('passive followup projection is bounded to watched projects and exact binding with isolated availability',async()=>{
  const calls=[];const second={...project,root:'/synthetic/second'};
  const followup={inspect:async args=>{calls.push(args);if(args.root===second.root)throw new Error('PRIVATE OWNER');return{followup:{enabled:true,running:false,everyMinutes:45,nextDueAt:now,sessionId:binding.sessionId,alarmId:'alarm-private',blocked:'PRIVATE error'},once:{enabled:true,running:true,status:'running',delivery:'wechat',nextDueAt:now,originSessionId:binding.sessionId}};},status:()=>{throw new Error('must not load');},onceStatus:()=>{throw new Error('must not load');}};
  const f=await fixture({projects:[project,second],dependencies:{followup}});const value=await f.adapter.snapshot();
  assert.deepEqual(calls.map(row=>row.root),[project.root,second.root]);for(const args of calls)assert.deepEqual(args,{root:args.root,sessionId:binding.sessionId,expectedBinding:{sessionId:binding.sessionId,bindingKey:binding.bindingKey}});
  assert.equal(value.projects[0].followup.available,true);assert.equal(value.projects[0].followup.followup.everyMinutes,45);assert.equal(value.projects[0].followup.once.status,'running');
  assert.deepEqual(value.projects[1].followup,{available:false,followup:null,once:null});assert.equal(JSON.stringify(value).includes('PRIVATE'),false);assert.equal(JSON.stringify(value).includes('alarm-private'),false);
});

test('unbound, unsupported or malformed followups are unavailable while confirmed absence is explicit',async()=>{
  const missing={available:false,followup:null,once:null};
  for(const dependencies of [{},{followup:{status:()=>{throw new Error('must not load');}}},{followup:{inspect:async()=>({followup:{enabled:true},once:null})}}]){
    const f=await fixture({dependencies});assert.deepEqual((await f.adapter.snapshot()).projects[0].followup,missing);
  }
  const noRead=await fixture({connection:{state:'missing'},dependencies:{followup:{inspect:()=>{throw new Error('must not inspect');}}}});const unbound=await noRead.adapter.snapshot();assert.deepEqual(unbound.projects[0].followup,missing);assert.equal(unbound.bindingRevision,null);
  const absent=await fixture({dependencies:{followup:{inspect:async()=>({followup:null,once:null})}}});assert.deepEqual((await absent.adapter.snapshot()).projects[0].followup,{...missing,available:true});
});

test('binding replacement during followup inspection discards all binding-scoped content',async()=>{
  const gate=deferred(),entered=deferred();const f=await fixture({dependencies:{followup:{inspect:async()=>{entered.resolve();await gate.promise;return{followup:{enabled:true,running:true,everyMinutes:30},once:null};}}}});
  const pending=f.adapter.snapshot();await entered.promise;f.setConnection({...binding,bindingKey:'b'.repeat(64)});gate.resolve();const value=await pending;
  assert.deepEqual(value.projects[0].followup,{available:false,followup:null,once:null});assert.deepEqual(value.jobs,[]);assert.equal(value.bindingRevision,null);
});

test('an in-place binding mutation cannot change the expected identity captured before a job read',async()=>{
  const gate=deferred(),entered=deferred(),mutableBinding={...binding};
  const f=await fixture({connection:mutableBinding,jobs:async()=>{entered.resolve();await gate.promise;return{jobs:[{id:'job-1',task:'PRIVATE ORIGINAL OWNER',projectLabel:'旧项目',status:'running',createdAt:now}]};}});
  const pending=f.adapter.snapshot();await entered.promise;mutableBinding.bindingKey='b'.repeat(64);gate.resolve();
  const value=await pending;assert.deepEqual(value.jobs,[]);assert.deepEqual(value.connection,{state:'unknown'});
});

test('state display is passive and bounds reminders, schedules and counts without exposing owners',async()=>{
  const f=await fixture({state:{paused:true,daily:{time:'09:00',timeZone:'Asia/Shanghai',enabled:true,sessionId:'private-daily-owner'},reminders:[{id:'r1',title:'提醒我核对',dueAt:now,status:'scheduled',sessionId:'private-reminder-owner'},{id:'r2',title:'已排队',dueAt:now,status:'enqueued',outboxId:'o1'},{id:'r3',title:'已取消',dueAt:now,status:'cancelled'}],outbox:[{id:'o1',status:'reported_sent',text:'PRIVATE MESSAGE',sessionId:'private-route'}]}});
  const value=await f.adapter.snapshot();assert.equal(value.paused,true);assert.equal(value.counts.activeReminders,1);assert.deepEqual(value.reminders.map(row=>row.id),['r1']);
  assert.deepEqual(value.daily,{time:'09:00',timeZone:'Asia/Shanghai',enabled:true});
  for(const secret of ['private-daily-owner','private-reminder-owner','PRIVATE MESSAGE','private-route'])assert.equal(JSON.stringify(value).includes(secret),false);
  assert.ok(value.limitations.some(text=>text.includes('手机')));
});

test('each independent read failure marks only its availability false without exposing private errors',async()=>{
  for(const section of ['projects','plans','jobs']){
    const fail=async()=>{throw new Error('PRIVATE INTERNAL FAILURE /secret/root');};
    const dependencies=section==='projects'?{service:{watchedProjects:fail}}:section==='plans'?{readState:fail}:{taskResults:{inspect:fail}};
    const f=await fixture({dependencies});const value=await f.adapter.snapshot();
    assert.deepEqual(value.availability,{projects:section!=='projects',plans:section!=='plans',jobs:section!=='jobs'},section);
    if(section==='plans')assert.equal(value.paused,null);
    assert.equal(JSON.stringify(value).includes('PRIVATE INTERNAL'),false);
  }
});

test('malformed successful reads and absent state remain unavailable rather than claiming empty confirmed state',async()=>{
  const f=await fixture({dependencies:{service:{watchedProjects:async()=>({projects:[]})},readState:async()=>null,taskResults:{inspect:async()=>({jobs:null})}}});
  const value=await f.adapter.snapshot();assert.deepEqual(value.availability,{projects:false,plans:false,jobs:false});assert.equal(value.paused,null);
  const bad=await fixture({dependencies:{readState:async()=>({paused:false,reminders:'bad',outbox:[],daily:null})}});
  assert.equal((await bad.adapter.snapshot()).availability.plans,false);
});

test('an early active reminder remains visible when more recent reminders are cancelled',async()=>{
  const reminders=[{id:'active-first',title:'待核对',dueAt:now,status:'scheduled'},...Array.from({length:20},(_,i)=>({id:'cancelled-'+i,title:'已取消',dueAt:now,status:'cancelled'}))];
  const f=await fixture({state:{paused:false,daily:null,reminders,outbox:[]}});const value=await f.adapter.snapshot();
  assert.equal(value.counts.activeReminders,1);assert.deepEqual(value.reminders.map(row=>row.id),['active-first']);assert.equal(value.availability.plans,true);
});

test('active enqueued reminders preserve their exact pending, blocked and dispatching delivery states',async()=>{
  const statuses=['pending','blocked','dispatching','reported_sent','uncertain'];
  const reminders=statuses.map(status=>({id:'r-'+status,title:status,dueAt:now,status:'enqueued',outboxId:'o-'+status}));reminders.push({id:'r-pruned',title:'投递记录不可用',dueAt:now,status:'enqueued',outboxId:'missing'});
  const outbox=statuses.map(status=>({id:'o-'+status,status}));const f=await fixture({state:{paused:false,daily:null,reminders,outbox}});const value=await f.adapter.snapshot();
  assert.equal(value.counts.activeReminders,3);assert.deepEqual(value.reminders.map(row=>row.deliveryStatus),['pending','blocked','dispatching']);
});

test('project source failures are isolated and arbitrary files, error details and oversized payloads are omitted',async()=>{
  const many=Array.from({length:8},(_,i)=>({...project,id:'p_'+i,root:project.root+i,label:'L'.repeat(200),events:Array.from({length:40},()=>({kind:'assistant',text:'事件'.repeat(600),at:now}))}));
  const f=await fixture({projects:many,readProject:async root=>{if(root.endsWith('0'))throw new Error('private-path/private-token');return[{path:'../../secret',status:'ok',text:'PRIVATE THIRD PARTY'},{path:'README.md',status:'ok',text:`${root} ${binding.bindingKey} `+'正文'.repeat(12000),modifiedAt:now},{path:'.agent/memory/context.md',status:'rejected',detail:'private-path/private-token'}];}});
  const value=await f.adapter.snapshot();assert.equal(value.projects.length,5);assert.equal(value.counts.projects,5);assert.equal(value.projects[1].label.length,80);assert.ok(value.projects.every(p=>p.events.length<=5));
  assert.equal(value.projects[1].sources.find(s=>s.name==='README.md').truncated,true);
  for(const secret of [project.root,binding.bindingKey,'PRIVATE THIRD PARTY','private-path/private-token'])assert.equal(JSON.stringify(value).includes(secret),false,secret);
  assert.ok(Buffer.byteLength(JSON.stringify(value))<256*1024);
});

test('real safe fixed-file reader rejects symlink sources without reading outside the watched project',async t=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'workbench-source-')));t.after(()=>rm(root,{recursive:true,force:true}));
  const watched=join(root,'watched');await mkdir(watched);await writeFile(join(root,'private'),'PRIVATE OUTSIDE CONTENT');await symlink(join(root,'private'),join(watched,'README.md'));
  const {createWorkbench}=await api();const adapter=createWorkbench({service:{watchedProjects:async()=>[{...project,root:watched}]},readState:async()=>null,readConnection:async()=>({state:'missing'}),clock:()=>new Date(now)});
  const value=await adapter.snapshot();assert.equal(value.projects[0].sources.find(s=>s.name==='README.md').status,'rejected');assert.equal(JSON.stringify(value).includes('PRIVATE OUTSIDE CONTENT'),false);
});

test('authenticated route accepts only empty GET and registers no bare HTTP fallback',async()=>{
  const {registerWorkbenchRoute}=await api();let route,reads=0,stops=0;const effects=[];
  const ctx={get:name=>name==='connection'?{fetch:{register:value=>{route=value;return()=>stops++;}}}:undefined,effect:fn=>effects.push(fn)};
  registerWorkbenchRoute(ctx,{snapshot:async()=>{reads++;return{version:1};}});
  assert.equal(route.path,'/api/project_companion/workbench');assert.deepEqual(route.methods,['GET']);
  const ok=await route.fetch(new Request('http://localhost/api/project_companion/workbench'));assert.equal(ok.status,200);assert.equal(ok.headers.get('cache-control'),'no-store');
  for(const query of ['?project=other','?sessionId=other','?action=pause','?refresh=1'])assert.equal((await route.fetch(new Request('http://localhost/api/project_companion/workbench'+query))).status,400);
  for(const method of ['POST','PUT','PATCH','DELETE','HEAD'])assert.equal((await route.fetch(new Request('http://localhost/api/project_companion/workbench',{method}))).status,405);
  assert.equal((await route.fetch({method:'GET',url:'http://localhost/api/project_companion/workbench',body:'{}'})).status,400);
  assert.equal(reads,1);assert.equal(effects.length,1);effects[0]()();assert.equal(stops,1);
  assert.equal(registerWorkbenchRoute({get:()=>null},{}),null);
});

test('closing prevents late snapshot output and stale route responses after unregister',async()=>{
  const gate=deferred(),entered=deferred();const f=await fixture({readProject:async()=>{entered.resolve();await gate.promise;return[{path:'README.md',status:'ok',text:'LATE CONTENT'}];}});
  const pending=f.adapter.snapshot();await entered.promise;f.adapter.close();gate.resolve();await assert.rejects(pending,/关闭|停止/);await assert.rejects(f.adapter.snapshot(),/关闭|停止/);
  const {registerWorkbenchRoute}=await api();let route;const effects=[];
  registerWorkbenchRoute({get:()=>({fetch:{register:value=>{route=value;return()=>{};}}}),effect:fn=>effects.push(fn)},f.adapter);effects[0]()();
  assert.equal((await route.fetch(new Request('http://localhost/api/project_companion/workbench'))).status,503);
});

test('official SDK install exposes passive watched projects with a cold source and closes its route on disposal',async t=>{
  const {installCompanion}=await import('../index.js');
  const root=await realpath(await mkdtemp(join(tmpdir(),'workbench-host-')));const watched=join(root,'project');await mkdir(watched);await writeFile(join(watched,'README.md'),'真实安全读取的公开项目样本');
  const ctx=new Context();t.after(async()=>{await ctx.fiber.dispose();await rm(root,{recursive:true,force:true});});
  for(const [plugin,config] of [[SystemPrompt,{}],[ToolRuntime,{mode:'native'}],[CommandRuntime,undefined],[Storage,undefined],[JsonStorage,{root:join(root,'storage')}],[StorageDomain,{backend:'json'}],[SessionStore,undefined]])await ctx.plugin(plugin,config);
  const routes=new Map(),activity=[];let adapter;
  ctx.provide('agents',{get:()=>undefined,list:()=>[]});ctx.provide('workspaceRegistry',{list:()=>[]});
  ctx.provide('sessionController',{resolveAgent:async()=>{activity.push('resume');throw new Error('GET must not resume');}});
  ctx.provide('connection',{fetch:{register:route=>{routes.set(route.path,route);return()=>routes.delete(route.path);}}});
  await ctx.plugin({name:'synthetic-workbench-host',inject:['tools','commands','storageDomain','sessions','systemPrompt'],async apply(scope){adapter=await installCompanion(scope,{readSetup:async()=>binding,readNativeRoute:async()=>({kind:'unbound'}),readBinding:async()=>null,clock:()=>new Date(now),hostTimeZone:()=> 'America/Mexico_City',timers:{setInterval(){activity.push('timer');throw new Error('GET must not schedule');},clearInterval(){}}});}});
  const owner={sessionId:'synthetic-setup',cwd:watched};await adapter.service.act(owner,{action:'watch'});
  await adapter.memory.remember({root:watched,sessionId:'synthetic-setup',kind:'goal',text:'已有项目记忆应优先可见',source:{kind:'user',reference:'session:synthetic-setup#turn1'}});
  const before=await adapter.service.act(owner,{action:'status'});
  assert.ok(adapter.workbench,'installation must return its passive workbench');
  const route=routes.get('/api/project_companion/workbench');assert.ok(route,'installation must register the authenticated workbench');
  const response=await route.fetch(new Request('http://localhost/api/project_companion/workbench'));assert.equal(response.status,200);const value=await response.json();
  assert.equal(value.projects.length,1);assert.equal(value.projects[0].sources.find(s=>s.name==='README.md').text,'真实安全读取的公开项目样本');assert.equal(value.connection.sessionId,'source-session');assert.deepEqual(activity,[]);
  assert.equal(value.projects[0].overview.available,true);assert.equal(value.projects[0].overview.goals[0].text,'已有项目记忆应优先可见');assert.equal(value.projects[0].overview.goals[0].verified,false);
  assert.deepEqual(await adapter.service.act(owner,{action:'status'}),before);
  await ctx.fiber.dispose();assert.equal(routes.has('/api/project_companion/workbench'),false);await assert.rejects(adapter.workbench.snapshot(),/关闭|停止/);assert.equal((await route.fetch(new Request('http://localhost/api/project_companion/workbench'))).status,503);
});

test('Family projection uses its own result scope while legacy source and reminder scope stay separate',async()=>{
 const {createWorkbench}=await api();const legacy={state:'bound',sessionId:'legacy-owner',bindingKey:'a'.repeat(64)};
 const family={state:'bound',sessionId:'family_owner_synthetic',bindingKey:'b'.repeat(64),readOnly:true};
 const adapter=createWorkbench({service:{watchedProjects:async()=>[]},readConnection:async()=>family,readContextConnection:async()=>legacy,readState:async()=>({paused:true,daily:{time:'09:00',timeZone:'UTC',enabled:true},reminders:[{id:'legacy-reminder',title:'OTHER OWNER REMINDER',dueAt:now,status:'scheduled'}],outbox:[]}),readBinding:async()=>returnBinding,taskResults:{inspect:async id=>{assert.equal(id,family.sessionId);return{jobs:[]};}},clock:()=>new Date(now)});
 const value=await adapter.snapshot();const {bindingRevision}=await import('../src/workbench-scope.js');
 assert.equal(value.contextBindingRevision,bindingRevision(legacy));assert.notEqual(value.bindingRevision,value.contextBindingRevision);assert.equal(value.connection.readOnly,true);
 assert.equal(value.availability.plans,false);assert.deepEqual(value.reminders,[]);assert.equal(value.daily,null);assert.equal(value.paused,true);assert.doesNotMatch(JSON.stringify(value),/OTHER OWNER/);adapter.close();
});


test('offline paired Family view never projects legacy reminders or daily plans',async()=>{
 const f=await fixture({connection:{state:'unknown',readOnly:true},state:{paused:false,reminders:[{id:'r-legacy',title:'LEGACY_PLAN_SENTINEL',dueAt:now,status:'scheduled'}],daily:{time:'09:00',timeZone:'UTC',enabled:true},outbox:[]}});
 const value=await f.adapter.snapshot();assert.equal(value.connection.readOnly,true);assert.equal(value.availability.plans,false);assert.deepEqual(value.reminders,[]);assert.equal(value.daily,null);assert.doesNotMatch(JSON.stringify(value),/LEGACY_PLAN_SENTINEL/);
});


test('Family mode remains read-only when its binding disappears midway through a snapshot',async()=>{
 let f;f=await fixture({connection:{...binding,readOnly:true},readProject:async()=>{f.setConnection({state:'unknown',readOnly:true});return[];}});const result=await f.adapter.snapshot();assert.equal(result.connection.state,'unknown');assert.equal(result.connection.readOnly,true);assert.deepEqual(result.jobs,[]);assert.deepEqual(result.reminders,[]);
});


test('a new active job does not eagerly read an older completion into the current snapshot',async()=>{
 const f=await fixture({jobs:async(_s,args)=>args?.id?{jobs:[{id:args.id,status:'completed',reply:'OLD_DETAIL',replyTruncated:false}]}:{jobs:[{id:'old',projectLabel:'公开项目',task:'旧任务',status:'completed',createdAt:'2026-10-18T15:00:00Z',finishedAt:'2026-10-18T15:01:00Z'},{id:'new',projectLabel:'公开项目',task:'新任务',status:'running',createdAt:now}]}});const result=await f.adapter.snapshot();assert.equal(f.calls.some(c=>Array.isArray(c)&&c[0]==='detail'),false);assert.doesNotMatch(JSON.stringify(result),/OLD_DETAIL/);
});


test('verified quiet check is projected as historical evidence, never inferred for legacy records',async()=>{
 const f=await fixture({dependencies:{followup:{inspect:async()=>({followup:null,once:{enabled:false,running:false,status:'completed',delivery:'family',lastReviewedAt:now,lastCheckOutcome:'quiet',runCount:1}})}}});const r=await f.adapter.snapshot();assert.equal(r.projects[0].followup.once.lastCheckOutcome,'quiet');assert.equal(r.projects[0].followup.once.lastReviewedAt,now);
 const bad=await fixture({dependencies:{followup:{inspect:async()=>({followup:null,once:{enabled:false,running:false,status:'completed',delivery:'family',lastCheckOutcome:'quiet'}})}}});assert.equal((await bad.adapter.snapshot()).projects[0].followup.available,false);
});

test('desktop conversation is independently projected from the genuine native Dot session, never the Family Owner carrier',async()=>{
 const legacy={state:'bound',sessionId:'native-dot-owner',bindingKey:'d'.repeat(64)};
 const f=await fixture({connection:{...binding,sessionId:'family_owner_synthetic',readOnly:true},dependencies:{readDesktopConnection:async()=>legacy}});
 const value=await f.adapter.snapshot();
 assert.deepEqual(value.desktopConversation,{state:'ready',sessionId:legacy.sessionId,revision:bindingRevision(legacy)});
 assert.equal(value.connection.sessionId,'family_owner_synthetic');assert.equal(value.connection.readOnly,true);
 assert.equal(JSON.stringify(value.desktopConversation).includes(legacy.bindingKey),false);
});

test('desktop conversation rejects Family carriers and changing native owner, without adopting another session',async()=>{
 for(const mode of ['family','changed','offline']){
  let reads=0;const a={state:'bound',sessionId:'native-dot-owner',bindingKey:'d'.repeat(64)};
  const f=await fixture({dependencies:{readDesktopConnection:async()=>mode==='family'?{...a,sessionId:'family_owner_synthetic'}:mode==='offline'?{state:'unknown'}:++reads===1?a:{...a,sessionId:'another-native-owner'}}});
  const value=await f.adapter.snapshot();assert.deepEqual(value.desktopConversation,{state:'unavailable'});
 }
});

test('unknown Family result projection does not hide a separately verified native desktop conversation',async()=>{
 const legacy={state:'bound',sessionId:'native-dot-owner',bindingKey:'d'.repeat(64)};
 const f=await fixture({connection:{state:'unknown',readOnly:true},dependencies:{readDesktopConnection:async()=>legacy}});
 const result=await f.adapter.snapshot();assert.equal(result.connection.state,'unknown');assert.equal(result.desktopConversation.state,'ready');assert.equal(result.desktopConversation.sessionId,legacy.sessionId);
});

test('desktop conversation endpoint reads only native route metadata and never project or source contents',async()=>{
 const legacy={state:'bound',sessionId:'native-dot-owner',bindingKey:'d'.repeat(64)};
 const f=await fixture({dependencies:{readDesktopConnection:async()=>legacy}});
 assert.equal(typeof f.adapter.desktopConversation,'function');const result=await f.adapter.desktopConversation();assert.equal(result.sessionId,legacy.sessionId);assert.deepEqual(f.calls,[]);
});
