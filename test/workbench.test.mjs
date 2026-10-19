import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Context} from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import CommandRuntime from '@deepseek-ai/dsh-commands';
import Storage from '@deepseek-ai/dsh-storage';
import * as JsonStorage from '@deepseek-ai/dsh-storage-json';
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain';
import SessionStore from '@deepseek-ai/dsh-session';

const now='2026-10-19T15:00:00.000Z';
const binding={state:'bound',sessionId:'source-session',bindingKey:'a'.repeat(64)};
const project={id:'p_one',root:'/synthetic/watched-project',label:'当前项目',sessionIds:['project-session'],github:'owner/repo',watchedAt:now,events:[{kind:'assistant',text:'助手记录，仍待核对',at:now,sessionId:'project-session',id:'event-1'}]};
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
async function api(){const value=await import('../src/workbench.js').catch(()=>({}));assert.equal(typeof value.createWorkbench,'function','read-only workbench adapter must exist');assert.equal(typeof value.registerWorkbenchRoute,'function','authenticated workbench route must exist');return value;}
async function fixture(options={}){
  const {createWorkbench}=await api();let connection=options.connection??binding;
  const calls=[];
  const adapter=createWorkbench({
    service:{watchedProjects:async()=>{calls.push('projects');return options.projects??[structuredClone(project)];}},
    readState:async()=>{calls.push('state');return options.state??{paused:false,reminders:[],daily:null,outbox:[]};},
    readConnection:async()=>{calls.push('connection');return connection;},
    taskResults:{status:async sessionId=>{calls.push(['jobs',sessionId]);return options.jobs?.(sessionId)??{jobs:[]};}},
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

test('bound jobs use only the verified source session and whitelist every output field',async()=>{
  const f=await fixture({jobs:async()=>({jobs:[{id:'job-1',projectLabel:'当前项目',task:'检查README',status:'completed',createdAt:now,finishedAt:now,reply:'DO NOT EXPORT REPLY',targetSessionId:'private-target',projectRoot:project.root,returnBinding:{userHash:'private-user'},delivery:{status:'reported_sent',detail:'通道报告已发',text:'DO NOT EXPORT DELIVERY'}}]})});
  const value=await f.adapter.snapshot();
  assert.deepEqual(f.calls.filter(item=>Array.isArray(item)&&item[0]==='jobs'),[['jobs','source-session']]);
  assert.deepEqual(value.connection,{state:'bound',sessionId:'source-session'});
  assert.equal(value.jobs[0].status,'completed');assert.equal(value.jobs[0].delivery.status,'reported_sent');
  for(const secret of [project.root,binding.bindingKey,'DO NOT EXPORT','private-target','private-user','bindingKey','projectRoot'])assert.equal(JSON.stringify(value).includes(secret),false,secret);
  assert.deepEqual(Object.keys(value.jobs[0]).sort(),['id','projectLabel','task','status','createdAt','finishedAt','delivery'].sort());
});

test('binding replacement while jobs are being read discards their content and marks connection unknown',async()=>{
  const gate=deferred(),entered=deferred();
  const f=await fixture({jobs:async()=>{entered.resolve();await gate.promise;return{jobs:[{id:'job-1',task:'PRIVATE OLD BINDING',projectLabel:'旧项目',status:'running',createdAt:now}]};}});
  const pending=f.adapter.snapshot();await entered.promise;f.setConnection({...binding,bindingKey:'b'.repeat(64)});gate.resolve();
  const value=await pending;assert.deepEqual(value.jobs,[]);assert.deepEqual(value.connection,{state:'unknown'});assert.equal(JSON.stringify(value).includes('PRIVATE OLD'),false);
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
    const dependencies=section==='projects'?{service:{watchedProjects:fail}}:section==='plans'?{readState:fail}:{taskResults:{status:fail}};
    const f=await fixture({dependencies});const value=await f.adapter.snapshot();
    assert.deepEqual(value.availability,{projects:section!=='projects',plans:section!=='plans',jobs:section!=='jobs'},section);
    if(section==='plans')assert.equal(value.paused,null);
    assert.equal(JSON.stringify(value).includes('PRIVATE INTERNAL'),false);
  }
});

test('malformed successful reads and absent state remain unavailable rather than claiming empty confirmed state',async()=>{
  const f=await fixture({dependencies:{service:{watchedProjects:async()=>({projects:[]})},readState:async()=>null,taskResults:{status:async()=>({jobs:null})}}});
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
  const before=await adapter.service.act(owner,{action:'status'});
  assert.ok(adapter.workbench,'installation must return its passive workbench');
  const route=routes.get('/api/project_companion/workbench');assert.ok(route,'installation must register the authenticated workbench');
  const response=await route.fetch(new Request('http://localhost/api/project_companion/workbench'));assert.equal(response.status,200);const value=await response.json();
  assert.equal(value.projects.length,1);assert.equal(value.projects[0].sources.find(s=>s.name==='README.md').text,'真实安全读取的公开项目样本');assert.equal(value.connection.sessionId,'source-session');assert.deepEqual(activity,[]);
  assert.deepEqual(await adapter.service.act(owner,{action:'status'}),before);
  await ctx.fiber.dispose();assert.equal(routes.has('/api/project_companion/workbench'),false);await assert.rejects(adapter.workbench.snapshot(),/关闭|停止/);assert.equal((await route.fetch(new Request('http://localhost/api/project_companion/workbench'))).status,503);
});
