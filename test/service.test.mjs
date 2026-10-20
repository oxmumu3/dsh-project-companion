import test from 'node:test';
import assert from 'node:assert/strict';

// Dynamic import makes the initial RED an assertion about the missing behavior.
async function api() {
  const module = await import('../src/service.js').catch(() => ({}));
  assert.equal(typeof module.createService, 'function', 'createService must implement the companion behavior');
  return module;
}
async function fixture(overrides = {}) {
  const { createService } = await api();
  let persisted;
  let now = new Date('2026-10-18T15:00:00Z');
  const sends = [];
  const roots = Array.from({length: 6}, (_, i) => ({ root: `/synthetic/project-${i}`, label: `Project ${i}` }));
  const service = createService({
    store: { get: async () => structuredClone(persisted), put: async (_id, value) => { persisted = structuredClone(value); } },
    discover: async () => roots,
    readProject: async root => [{ path: 'README.md', status: 'ok', text: `SYNTHETIC ${root}`, modifiedAt: now.toISOString() }],
    readRelease: async repo => ({ status: 'ok', repository: repo, tag: 'v1.0', url: `https://github.com/${repo}/releases/tag/v1.0`, publishedAt: '2026-10-17T00:00:00Z' }),
    send: async item => { sends.push(item); return { status: 'queued', detail: 'bridge accepted queue' }; },
    clock: () => now,
    ...overrides,
  });
  const owner = { sessionId: 'synthetic-session', cwd: roots[0].root };
  return { service, owner, roots, sends, time: value => { now = new Date(value); }, persisted: () => persisted };
}

test('synchronous coordination gate is inert until ready and validates exact watched identity and membership',async()=>{
  const {createService}=await api();let reads=0,writes=0;const loaded=Promise.withResolvers();
  const project={id:'synthetic-gate-project',root:'/synthetic/gate',label:'SYNTHETIC gate',sessionIds:['synthetic-gate-target'],events:[],github:null,watchedAt:'2026-10-18T15:00:00Z'};
  const service=createService({store:{get:async()=>{reads++;return loaded.promise;},put:async()=>{writes++;}}});
  const scope={projectId:project.id,projectRoot:project.root,sessionId:project.sessionIds[0]};
  assert.equal(typeof service.canCoordinate,'function');
  assert.equal(service.canCoordinate(scope),false);assert.equal(reads,0);assert.equal(writes,0);
  const ready=service.ready();await Promise.resolve();assert.equal(service.canCoordinate(scope),false);
  loaded.resolve({id:'profile',version:1,projects:[project],daily:null,paused:false,reminders:[],outbox:[]});await ready;
  assert.equal(service.canCoordinate(scope),true);
  for(const invalid of [null,{}, {...scope,projectId:project.label},{...scope,projectRoot:'/synthetic/other'},{...scope,sessionId:'synthetic-nonmember'}])assert.equal(service.canCoordinate(invalid),false);
  assert.equal(reads,1);assert.equal(writes,0,'the sync gate must not read storage or mutate state');
  await service.act({sessionId:'synthetic-owner',cwd:project.root},{action:'unwatch',project:project.id});
  assert.equal(service.canCoordinate(scope),false);
});

test('synchronous coordination gate stays closed after corrupt state fails readiness',async()=>{
  const {createService}=await api();let writes=0;
  const service=createService({store:{get:async()=>({version:99,projects:[{id:'synthetic-corrupt',root:'/synthetic/corrupt',sessionIds:['synthetic-target']}],outbox:[],reminders:[]}),put:async()=>{writes++;}}});
  assert.equal(typeof service.canCoordinate,'function');await assert.rejects(service.ready(),/corrupt|Unsupported/);
  assert.equal(service.canCoordinate({projectId:'synthetic-corrupt',projectRoot:'/synthetic/corrupt',sessionId:'synthetic-target'}),false);assert.equal(writes,0);
});

test('watch accepts only discovered/current roots and caps watched projects at five', async () => {
  const f = await fixture();
  await assert.rejects(f.service.act(f.owner, {action: 'watch', project: '/not-host-known'}), /known|未知/);
  await f.service.act(f.owner, {action: 'watch'});
  await f.service.act(f.owner, {action: 'watch'});
  for (let i = 1; i < 5; i++) await f.service.act(f.owner, {action: 'watch', project: f.roots[i].root});
  assert.equal((await f.service.act(f.owner, {action:'list'})).projects.length, 5);
  await assert.rejects(f.service.act(f.owner, {action:'watch', project:f.roots[5].root}), /5|five/);
});

test('unique friendly project names select only known roots and work for watched actions',async()=>{
  const f=await fixture();f.roots[0].label='墨西哥增长';f.roots[1].label='写作研究';
  const watched=await f.service.act(f.owner,{action:'watch',project:'墨西哥'});
  assert.equal(watched.project.root,f.owner.cwd);
  assert.equal(watched.project.label,'墨西哥增长','the human workspace name must survive current-agent fallback metadata');
  assert.match((await f.service.act(f.owner,{action:'digest',project:'墨西哥增长'})).text,/SYNTHETIC/);
  await f.service.act(f.owner,{action:'link_github',project:'墨西哥增长',repository:'example/synthetic-project'});
  await assert.rejects(f.service.act(f.owner,{action:'watch',project:'从未注册的项目'}),/未知|找不到|known/);
  await f.service.act(f.owner,{action:'unwatch',project:'墨西哥增长'});
  assert.equal((await f.service.act(f.owner,{action:'list'})).projects.length,0);
});

test('an explicit digest reads a listed but unwatched project without persisting or consuming a watched slot',async()=>{
  const reads=[];
  const known={id:'workspace-companion',root:'/synthetic/dsh-project-companion',label:'dsh-project-companion',sessionIds:['known-project-session']};
  const f=await fixture({discover:async()=>[known],readProject:async root=>{reads.push(root);return[{path:'README.md',status:'ok',text:'SYNTHETIC companion progress',modifiedAt:'2026-10-18T14:59:00Z'}];}});
  assert.ok((await f.service.act(f.owner,{action:'list'})).candidates.some(p=>p.label===known.label));
  const before=structuredClone(f.persisted());
  const result=await f.service.act(f.owner,{action:'digest',project:'dsh-project-companion'});
  assert.deepEqual(reads,[known.root]);
  assert.match(result.text,/README\.md.*2026-10-18T14:59:00Z.*SYNTHETIC companion progress/);
  assert.match(result.text,/known-project-session/);
  assert.ok(result.text.length<=3200);
  assert.deepEqual(f.persisted(),before,'reading must not create a persisted project or any other state');
  assert.equal((await f.service.act(f.owner,{action:'status'})).counts.projects,0);
  assert.equal(await f.service.coordinationTarget(known.root),null,'a read must not silently enable task coordination');
});

test('an unwatched digest works at the five-project limit while default digest remains limited to watched projects',async()=>{
  const reads=[];
  const f=await fixture({readProject:async root=>{reads.push(root);return[{path:'README.md',status:'ok',text:`SYNTHETIC ${root}`,modifiedAt:'2026-10-18T15:00:00Z'}];}});
  for(let i=0;i<5;i++)await f.service.act(f.owner,{action:'watch',project:f.roots[i].root});
  const before=structuredClone(f.persisted());reads.length=0;
  await f.service.act(f.owner,{action:'digest',project:'Project 5'});
  assert.deepEqual(reads,[f.roots[5].root]);
  assert.deepEqual(f.persisted(),before);
  reads.length=0;
  await f.service.act(f.owner,{action:'digest'});
  assert.deepEqual(reads,f.roots.slice(0,5).map(p=>p.root));
  assert.deepEqual(f.persisted(),before);
});

test('explicit digests reject unknown and ambiguous known projects without reading or changing state',async()=>{
  const reads=[];
  const f=await fixture({discover:async()=>[{root:'/synthetic/business/report',label:'进度报告'},{root:'/synthetic/writing/report',label:'进度报告'}],readProject:async root=>{reads.push(root);return[];}});
  await assert.rejects(f.service.act(f.owner,{action:'digest',project:'进度报告'}),error=>/多个/.test(error.message)&&/business/.test(error.message)&&/writing/.test(error.message));
  for(const project of ['未注册项目','/unknown/进度报告'])await assert.rejects(f.service.act(f.owner,{action:'digest',project}),/未知|找不到/);
  assert.deepEqual(reads,[]);
  assert.equal(f.persisted(),undefined);
  const empty=await f.service.act(f.owner,{action:'digest'});
  assert.match(empty.text,/还没有关注项目/);
  assert.deepEqual(reads,[],'default digest does not read every discovered project');
});

test('explicit known identifiers preserve watched event and GitHub sources without duplicate-root ambiguity',async()=>{
  const known={id:'workspace-writing',root:'/synthetic/writing',label:'写作项目'};
  const f=await fixture({discover:async()=>[known]});
  const watched=await f.service.act(f.owner,{action:'watch',project:known.id});
  await f.service.record({root:known.root,sessionId:'writing-session',id:'event-1',kind:'user',text:'SYNTHETIC explicit request'});
  await f.service.act(f.owner,{action:'link_github',project:watched.project.id,repository:'example/writing'});
  const before=structuredClone(f.persisted());
  for(const project of [known.id,known.label,watched.project.id]){
    const result=await f.service.act(f.owner,{action:'digest',project});
    assert.match(result.text,/SYNTHETIC explicit request/);
    assert.match(result.text,/example\/writing latest release/);
    assert.ok(result.text.includes(watched.project.id));
  }
  assert.deepEqual(f.persisted(),before);
});

test('GitHub association explains follow-up in ordinary language without internal command words',async()=>{
  const f=await fixture();await f.service.act(f.owner,{action:'watch'});
  const linked=await f.service.act(f.owner,{action:'link_github',repository:'example/project'});
  assert.doesNotMatch(linked.text,/\bnow\b|latest release|\/companion/);
  assert.match(linked.text,/查询|进展/);
});

test('pause explains recovery in ordinary language without internal command words',async()=>{
  const f=await fixture();
  const paused=await f.service.act(f.owner,{action:'pause'});
  assert.doesNotMatch(paused.text,/\bdaily\b|HH:mm|\bTZ\b|\bqueued\b|\buncertain\b|\/companion/);
  assert.match(paused.text,/恢复/);
});

test('ambiguous friendly names ask naturally with candidates and never silently choose',async()=>{
  const projects=[{root:'/synthetic/business/report',label:'进度报告'},{root:'/synthetic/writing/report',label:'进度报告'}];
  const f=await fixture({discover:async()=>projects});
  await assert.rejects(f.service.act(f.owner,{action:'watch',project:'进度报告'}),error=>/多个|不止|两个/.test(error.message)&&/business/.test(error.message)&&/writing/.test(error.message));
  assert.equal((await f.service.act(f.owner,{action:'list'})).projects.length,0);
  for(const project of projects)await f.service.act(f.owner,{action:'watch',project:project.root});
  await assert.rejects(f.service.act(f.owner,{action:'digest',project:'进度'}),/多个|不止|两个/);
  await assert.rejects(f.service.act(f.owner,{action:'unwatch',project:'进度报告'}),/多个|不止|两个/);
  await assert.rejects(f.service.act(f.owner,{action:'link_github',project:'进度报告',repository:'example/report'}),/多个|不止|两个/);
  assert.equal((await f.service.act(f.owner,{action:'status'})).projects.length,2);
});

test('friendly name matching normalizes case and spacing but never interprets an unknown absolute root as a label',async()=>{
  const f=await fixture();f.roots[1].label='Product   Research';
  const result=await f.service.act(f.owner,{action:'watch',project:' product research '});
  assert.equal(result.project.root,f.roots[1].root);
  await assert.rejects(f.service.act(f.owner,{action:'watch',project:'/unregistered/Product Research'}),/未知|找不到|known/);
});

test('only watched events are kept, deduplicated, bounded and attributed as assistant records', async () => {
  const f = await fixture();
  await f.service.act(f.owner, {action:'watch'});
  await f.service.record({root:'/not-watched', sessionId:'other', id:'skip', kind:'user', text:'PRIVATE_SENTINEL'});
  for (let i=0; i<40; i++) await f.service.record({root:f.owner.cwd, sessionId:'s', id:`event-${i}`, kind:'assistant', text:`assistant says done ${i}`});
  await f.service.record({root:f.owner.cwd, sessionId:'s', id:'event-39', kind:'assistant', text:'duplicate'});
  const result = await f.service.act(f.owner, {action:'digest'});
  assert.equal(f.persisted().projects[0].events.length, 30);
  assert.doesNotMatch(result.text, /PRIVATE_SENTINEL|duplicate/);
  assert.match(result.text, /助手记录/);
  assert.match(result.text, /README.md/);
  assert.ok(result.text.length <= 3200);
});

test('scheduled daily sends a readable Markdown brief while digest keeps its original provenance text',async()=>{
  let reads=0;
  const f=await fixture({hostTimeZone:'Asia/Shanghai',readProject:async()=>{reads++;return[
    {path:'.agent/memory/progress.md',status:'ok',text:'SYNTHETIC current progress',modifiedAt:'2026-10-18T14:59:00Z'},
    {path:'README.md',status:'missing'},
  ];}});
  const watched=await f.service.act(f.owner,{action:'watch'});
  await f.service.record({root:f.owner.cwd,sessionId:f.owner.sessionId,id:'assistant-1',kind:'assistant',text:'SYNTHETIC assistant says done'});
  const before=reads;
  const report=await f.service.act(f.owner,{action:'digest'});
  assert.equal(reads,before+1,'both representations share the same bounded source read');
  assert.ok(report.text.includes(watched.project.id));assert.ok(report.text.includes(f.owner.cwd));assert.ok(report.text.includes(f.owner.sessionId));
  assert.match(report.text,/2026-10-18T14:59:00Z/);
  assert.equal(typeof report.wechatText,'string');assert.match(report.wechatText,/^## 项目简报\n\n/);
  assert.match(report.wechatText,/### Project 0/);assert.match(report.wechatText,/progress\.md.*22:59/);
  assert.match(report.wechatText,/SYNTHETIC current progress/);assert.match(report.wechatText,/README\.md.*未找到/);
  assert.match(report.wechatText,/助手记录/);assert.match(report.wechatText,/不能|不等于|不代表/);
  for(const internal of [watched.project.id,f.owner.cwd,f.owner.sessionId,'assistant-1'])assert.equal(report.wechatText.includes(internal),false);
  assert.ok(report.wechatText.length<=3200);
  await f.service.act(f.owner,{action:'configure_daily',time:'15:01',timeZone:'UTC'});
  f.time('2026-10-18T15:01:00Z');await f.service.tick();
  assert.equal(f.sends[0].text,(await f.service.act(f.owner,{action:'digest'})).wechatText);
  assert.equal(f.sends[0].kind,'daily');
});

test('five-project mobile briefs stay bounded with complete Markdown and source uncertainty',async()=>{
  const f=await fixture({hostTimeZone:'Asia/Shanghai',readProject:async()=>[
    {path:'.agent/memory/progress.md',status:'ok',text:'SYNTHETIC '+ '*[untrusted](https://example.invalid) '.repeat(500),modifiedAt:'2026-10-18T14:59:00Z',truncated:true},
    {path:'.agent/memory/context.md',status:'rejected',detail:'INTERNAL_PATH /synthetic/private'},
    {path:'README.md',status:'missing'},
  ]});
  const ids=[];
  for(let i=0;i<5;i++){
    f.roots[i].label=`项目${i} `+'*[]()'.repeat(15);
    const watched=await f.service.act(f.owner,{action:'watch',project:f.roots[i].root});ids.push(watched.project.id);
    await f.service.record({root:f.roots[i].root,sessionId:`internal-session-${i}`,id:`internal-event-${i}`,kind:'assistant',text:'SYNTHETIC '+'**[record]** '.repeat(100)});
    await f.service.act(f.owner,{action:'link_github',project:watched.project.id,repository:`example/project-${i}`});
  }
  for(let i=0;i<6;i++)await f.service.act(f.owner,{action:'remind',delayMinutes:10,title:`提醒${i} `+'*[]()'.repeat(35)});
  const report=await f.service.act(f.owner,{action:'digest'});
  assert.equal(typeof report.wechatText,'string');assert.ok(report.wechatText.length<=3200);
  for(let i=0;i<5;i++){assert.ok(report.wechatText.includes(`项目${i}`));assert.ok(report.text.includes(ids[i]));}
  assert.match(report.text,/明确提醒\(6\)/);assert.match(report.wechatText,/明确提醒.*6/);
  assert.match(report.wechatText,/context\.md.*读取受限/);assert.match(report.wechatText,/README\.md.*未找到/);
  assert.match(report.wechatText,/助手记录/);assert.doesNotMatch(report.wechatText,/INTERNAL_PATH|internal-session|internal-event|\/synthetic/);
  assert.doesNotMatch(report.wechatText,/(?<!\\)\[untrusted\]\(/,'source Markdown is quoted, never promoted to a new clickable instruction');
  assert.equal((report.wechatText.match(/(?<!\\)\*\*/g)??[]).length%2,0,'the size budget never cuts a bold span');
  const links=[...report.wechatText.matchAll(/(?<!\\)\[([^\]\n]*)\]\(([^\s)]*)\)/g)];
  for(const link of links)assert.match(link[2],/^https:\/\/github\.com\/example\/project-\d\/releases\/tag\/v1\.0$/);
  assert.doesNotMatch(report.wechatText,/now projectId|\/companion/);
});

test('due reminders send the emphasized user task and readable computer-local time without debug identifiers',async()=>{
  const f=await fixture({hostTimeZone:'Asia/Shanghai'});
  const result=await f.service.act(f.owner,{action:'remind',delayMinutes:2,title:'检查实测结果'});
  assert.equal(result.reminder.dueAt,'2026-10-18T15:02:00.000Z');
  f.time('2026-10-18T15:02:00Z');await f.service.tick();
  assert.equal(f.sends.length,1);const text=f.sends[0].text;
  assert.match(text,/^## 提醒\n\n\*\*检查实测结果\*\*/);assert.match(text,/23:02/);
  assert.doesNotMatch(text,/r_[a-z0-9]+|session|\/synthetic|2026-10-18T|\/companion|delayMinutes|dueAt/);
  assert.ok(text.length<=3200);
});

test('daily uses local calendar date, queues once and never re-submits bridge queued output', async () => {
  const f = await fixture();
  await f.service.act(f.owner, {action:'watch'});
  await f.service.act(f.owner, {action:'configure_daily', time:'09:00', timeZone:'America/Mexico_City'});
  await Promise.all([f.service.tick(), f.service.tick()]);
  assert.equal(f.sends.length, 1);
  assert.equal((await f.service.act(f.owner, {action:'status'})).outbox[0].status, 'queued');
  f.time('2026-10-19T14:59:00Z');
  await f.service.tick();
  assert.equal(f.sends.length, 1);
  f.time('2026-10-19T15:00:00Z');
  await f.service.tick();
  assert.equal(f.sends.length, 2);
});

test('reconfiguring a daily time rebinds the same blocked job without another daily queue', async()=>{
  const f=await fixture({send:async item=>({status:item.sessionId==='replacement-session'?'reported_sent':'blocked',detail:'synthetic'})});
  await f.service.act(f.owner,{action:'configure_daily',time:'09:00',timeZone:'America/Mexico_City'});
  await f.service.tick();
  const prior=(await f.service.act(f.owner,{action:'status'})).outbox[0];
  await f.service.act({...f.owner,sessionId:'replacement-session'},{action:'configure_daily',time:'08:59',timeZone:'America/Mexico_City'});
  await f.service.tick();
  const after=(await f.service.act(f.owner,{action:'status'})).outbox;
  assert.equal(after.length,1,'a changed time must not queue the same local date twice');
  assert.equal(after[0].id,prior.id);
  assert.equal(after[0].status,'reported_sent');
});

test('one-time reminders tolerate a normal late timer tick',async()=>{
  const f=await fixture();
  await f.service.act(f.owner,{action:'remind',dueAt:'2026-10-18T15:01:00Z',title:'Synthetic timer tolerance'});
  f.time('2026-10-18T15:01:02Z');await f.service.tick();
  assert.equal(f.sends.length,1);
});

test('relative reminder minutes use the injected clock and enqueue once within the existing grace window',async()=>{
  const f=await fixture();
  const result=await f.service.act(f.owner,{action:'remind',delayMinutes:5,title:'五分钟后提醒检查稿件'});
  assert.equal(result.reminder.dueAt,'2026-10-18T15:05:00.000Z');
  f.time('2026-10-18T15:04:59Z');await f.service.tick();assert.equal(f.sends.length,0);
  f.time('2026-10-18T15:05:02Z');await f.service.tick();await f.service.tick();
  assert.equal(f.sends.length,1);
});

test('relative reminders reject conflicting absolute time and invalid delays without saving a reminder',async()=>{
  const f=await fixture();
  await assert.rejects(f.service.act(f.owner,{action:'remind',delayMinutes:5,dueAt:'2026-10-18T16:00:00Z',title:'冲突时间'}),/同时|冲突|both|conflict/);
  for(const delayMinutes of [0,-1,Infinity,NaN,'5',null])await assert.rejects(f.service.act(f.owner,{action:'remind',delayMinutes,title:'无效相对时间'}));
  assert.equal((await f.service.act(f.owner,{action:'status'})).counts.reminders,0);
});

test('status and list expose injected current time and computer timezone for natural language coordination',async()=>{
  const f=await fixture({hostTimeZone:()=> 'Asia/Shanghai'});
  const status=await f.service.act(f.owner,{action:'status'});
  assert.equal(status.now,'2026-10-18T15:00:00.000Z');assert.equal(status.hostTimeZone,'Asia/Shanghai');
  assert.match(status.text,/Asia\/Shanghai/);
  f.time('2026-10-18T15:02:00Z');
  const list=await f.service.act(f.owner,{action:'list'});
  assert.equal(list.now,'2026-10-18T15:02:00.000Z');assert.equal(list.hostTimeZone,'Asia/Shanghai');
});

test('daily without timezone uses and clearly reports the injected computer timezone',async()=>{
  const f=await fixture({hostTimeZone:'Asia/Shanghai'});
  const result=await f.service.act(f.owner,{action:'configure_daily',time:'09:00'});
  assert.equal(result.daily.timeZone,'Asia/Shanghai');assert.equal(result.hostTimeZone,'Asia/Shanghai');
  assert.match(result.text,/电脑|本机/);assert.match(result.text,/Asia\/Shanghai/);
  const explicit=await f.service.act(f.owner,{action:'configure_daily',time:'09:00',timeZone:'America/Mexico_City'});
  assert.equal(explicit.daily.timeZone,'America/Mexico_City');
});

test('later reminders expire when an earlier send advances time beyond their delivery window',async()=>{
  let calls=0;
  const f=await fixture({send:async()=>{calls++;f.time('2026-10-18T15:16:30Z');return{status:'reported_sent',detail:'synthetic first send took sixty seconds'};}});
  for(let i=0;i<3;i++)await f.service.act(f.owner,{action:'remind',dueAt:'2026-10-18T15:01:00Z',title:`Synthetic expiry reminder ${i}`});
  f.time('2026-10-18T15:15:30Z');await f.service.tick();
  assert.equal(calls,1,'expired later jobs must not cross the send boundary');
  assert.deepEqual((await f.service.act(f.owner,{action:'status'})).outbox.map(item=>item.status),['reported_sent','expired','expired']);
});

test('a reminder expiring during dispatching persistence never crosses the send boundary',async()=>{
  const {createService}=await api();let now=new Date('2026-10-18T15:00:00Z');let saved;let calls=0;
  const service=createService({clock:()=>now,store:{get:async()=>saved,put:async(_key,value)=>{saved=structuredClone(value);if(value.outbox.some(item=>item.status==='dispatching'))now=new Date('2026-10-18T15:16:01Z');}},send:async()=>{calls++;return{status:'reported_sent'};}});
  const owner={sessionId:'synthetic-expiry-session',cwd:'/synthetic/project'};
  await service.act(owner,{action:'remind',dueAt:'2026-10-18T15:01:00Z',title:'Synthetic slow persistence'});
  now=new Date('2026-10-18T15:15:59Z');await service.tick();
  assert.equal(calls,0);
  assert.equal((await service.act(owner,{action:'status'})).outbox[0].status,'expired');
});

test('daily older than six hours and reminders expired during downtime are not replayed', async () => {
  const f = await fixture();
  await f.service.act(f.owner, {action:'configure_daily', time:'08:00', timeZone:'UTC'});
  await f.service.act(f.owner, {action:'remind', dueAt:'2026-10-18T15:01:00Z', title:'Expired synthetic reminder'});
  f.time('2026-10-18T22:00:00Z');
  await f.service.tick();
  assert.equal(f.sends.length, 0);
  assert.equal((await f.service.act(f.owner, {action:'status'})).reminders[0].status, 'expired');
});

test('daily catches the most recent schedule across midnight within its six-hour window',async()=>{
  const f=await fixture();
  await f.service.act(f.owner,{action:'configure_daily',time:'23:00',timeZone:'UTC'});
  f.time('2026-10-19T01:00:00Z');await f.service.tick();
  assert.equal(f.sends.length,1);
  assert.equal((await f.service.act(f.owner,{action:'status'})).daily.lastDate,'2026-10-18');
  await f.service.tick();assert.equal(f.sends.length,1);
});

test('daily catch-up keys the prior date in Mexico timezone rather than UTC date',async()=>{
  const f=await fixture();
  await f.service.act(f.owner,{action:'configure_daily',time:'23:00',timeZone:'America/Mexico_City'});
  f.time('2026-10-19T07:00:00Z');await f.service.tick();
  assert.equal(f.sends.length,1);
  assert.equal((await f.service.act(f.owner,{action:'status'})).daily.lastDate,'2026-10-18');
  f.time('2026-10-20T05:00:00Z');await f.service.tick();assert.equal(f.sends.length,2);
});

test('cancel and pause prevent sending, invalid schedules do not mutate state', async () => {
  const f = await fixture();
  const reminder = await f.service.act(f.owner,{action:'remind',dueAt:'2026-10-18T15:01:00Z',title:'Synthetic review'});
  await f.service.act(f.owner,{action:'cancel_reminder',id:reminder.reminder.id});
  await assert.rejects(f.service.act(f.owner,{action:'configure_daily',time:'25:00',timeZone:'Invalid/Zone'}));
  await f.service.act(f.owner,{action:'configure_daily',time:'15:01',timeZone:'UTC'});
  await f.service.act(f.owner,{action:'pause'});
  f.time('2026-10-18T15:01:00Z');
  await f.service.tick();
  assert.equal(f.sends.length, 0);
  assert.equal((await f.service.act(f.owner,{action:'status'})).paused, true);
});

test('cancel_daily clears only the schedule and unstarted daily outbox while preserving other state',async()=>{
  const f=await fixture();await f.service.act(f.owner,{action:'watch'});
  await f.service.act(f.owner,{action:'configure_daily',time:'15:01',timeZone:'UTC'});
  await f.service.act(f.owner,{action:'remind',delayMinutes:2,title:'保留的提醒'});await f.service.act(f.owner,{action:'pause'});
  let saved=structuredClone(f.persisted());
  const statuses=['pending','blocked','queued','reported_sent','failed','uncertain','expired','cancelled'];
  saved.outbox=statuses.map((status,index)=>({id:`daily-${index}`,kind:'daily',sessionId:f.owner.sessionId,text:'保留原文',createdAt:'2026-10-18T15:00:00Z',expiresAt:'2026-10-18T21:00:00Z',status,detail:`原状态 ${status}`}));
  saved.outbox.push({...saved.outbox[0],id:'reminder-pending',kind:'reminder'});
  const before=structuredClone(saved);const {createService}=await api();
  const service=createService({store:{get:async()=>saved,put:async(_key,value)=>{saved=structuredClone(value);}},clock:()=>new Date('2026-10-18T15:00:00Z')});
  const result=await service.act(f.owner,{action:'cancel_daily'});
  assert.equal(result.daily,null);assert.equal(result.cancelledDailyCount,2);assert.equal(result.nonRetractableDailyCount,3);
  assert.equal(saved.daily,null);assert.equal(saved.paused,before.paused);assert.deepEqual(saved.projects,before.projects);assert.deepEqual(saved.reminders,before.reminders);
  assert.deepEqual(saved.outbox.slice(2),before.outbox.slice(2));
  for(let index=0;index<2;index++)assert.deepEqual({...saved.outbox[index],status:before.outbox[index].status,detail:before.outbox[index].detail},before.outbox[index]);
  assert.deepEqual(saved.outbox.slice(0,2).map(item=>item.status),['cancelled','cancelled']);
  assert.match(result.text,/每日汇报.*关闭|已取消.*每日汇报/);assert.match(result.text,/无法撤回/);
  const again=await service.act(f.owner,{action:'cancel_daily'});assert.equal(again.cancelledDailyCount,0);assert.deepEqual(saved.daily,null);
});

test('a new reminder cannot reactivate a cancelled daily schedule',async()=>{
  const f=await fixture();await f.service.act(f.owner,{action:'configure_daily',time:'15:01',timeZone:'UTC'});
  await f.service.act(f.owner,{action:'pause'});const cancelled=await f.service.act(f.owner,{action:'cancel_daily'});
  assert.equal(cancelled.paused,true);assert.equal(cancelled.daily,null);
  await f.service.act(f.owner,{action:'remind',delayMinutes:2,title:'只发送这条提醒'});
  f.time('2026-10-18T15:01:00Z');await f.service.tick();assert.equal(f.sends.length,0);
  f.time('2026-10-18T15:02:00Z');await f.service.tick();assert.deepEqual(f.sends.map(item=>item.kind),['reminder']);
  assert.equal((await f.service.act(f.owner,{action:'status'})).daily,null);
});

test('cancel_daily during a dispatch preserves the send result and reports that it cannot retract it',async()=>{
  let release,started,calls=0;const gate=new Promise(resolve=>{release=resolve;});const sending=new Promise(resolve=>{started=resolve;});
  const f=await fixture({send:async()=>{calls++;started();await gate;return{status:'queued',detail:'已交给通道'};}});
  await f.service.act(f.owner,{action:'configure_daily',time:'15:00',timeZone:'UTC'});
  const tick=f.service.tick();await sending;
  const cancellation=f.service.act(f.owner,{action:'cancel_daily'});release();await tick;
  const result=await cancellation;assert.equal(result.daily,null);assert.equal(result.cancelledDailyCount,0);assert.equal(result.nonRetractableDailyCount,1);
  assert.equal(result.outbox[0].status,'queued');assert.equal(result.outbox[0].detail,'已交给通道');assert.match(result.text,/无法撤回/);
  f.time('2026-10-19T15:00:00Z');await f.service.tick();assert.equal(calls,1);
});

test('cancel_daily received while a scheduled digest is reading prevents its unsent daily result',async()=>{
  let release,started,reading=false;const gate=new Promise(resolve=>{release=resolve;});const ready=new Promise(resolve=>{started=resolve;});
  const f=await fixture({readProject:async()=>{if(reading){started();await gate;}return[];}});
  await f.service.act(f.owner,{action:'watch'});await f.service.act(f.owner,{action:'configure_daily',time:'15:00',timeZone:'UTC'});
  reading=true;const tick=f.service.tick();await ready;
  const cancellation=f.service.act(f.owner,{action:'cancel_daily'});release();await tick;const result=await cancellation;
  assert.equal(f.sends.length,0);assert.equal(result.daily,null);assert.equal(result.outbox.length,0);
});

test('cancel_daily received during a reminder send cancels the daily still waiting behind it',async()=>{
  let release,started;const gate=new Promise(resolve=>{release=resolve;});const ready=new Promise(resolve=>{started=resolve;});const sent=[];
  const f=await fixture({send:async item=>{
    sent.push(item.kind);
    if(sent.length===1)return{status:'blocked'};
    if(item.kind==='reminder'){started();await gate;}
    return{status:'reported_sent'};
  }});
  await f.service.act(f.owner,{action:'remind',delayMinutes:1,title:'先发送的提醒'});
  f.time('2026-10-18T15:01:00Z');await f.service.tick();
  await f.service.act(f.owner,{action:'configure_daily',time:'15:02',timeZone:'UTC'});
  f.time('2026-10-18T15:02:00Z');const tick=f.service.tick();await ready;
  const cancellation=f.service.act(f.owner,{action:'cancel_daily'});release();await tick;const result=await cancellation;
  assert.deepEqual(sent,['reminder','reminder']);assert.equal(result.cancelledDailyCount,1);assert.equal(result.nonRetractableDailyCount,0);
  assert.deepEqual(result.outbox.map(item=>[item.kind,item.status]),[['reminder','reported_sent'],['daily','cancelled']]);
});

test('queued daily configuration and cancellation retain their request order across a blocked tick',async()=>{
  for(const cancelFirst of [false,true]){
    let release,started,reading=false;const gate=new Promise(resolve=>{release=resolve;});const ready=new Promise(resolve=>{started=resolve;});
    const f=await fixture({readProject:async()=>{if(reading){started();await gate;}return[];}});
    await f.service.act(f.owner,{action:'watch'});await f.service.act(f.owner,{action:'configure_daily',time:'15:00',timeZone:'UTC'});
    reading=true;const tick=f.service.tick();await ready;
    let cancellation,configuration,queuedTick;
    if(cancelFirst){
      cancellation=f.service.act(f.owner,{action:'cancel_daily'});
      configuration=f.service.act(f.owner,{action:'configure_daily',time:'15:00',timeZone:'UTC'});
      queuedTick=f.service.tick();
    }else{
      configuration=f.service.act(f.owner,{action:'configure_daily',time:'15:00',timeZone:'UTC'});
      queuedTick=f.service.tick();
      cancellation=f.service.act(f.owner,{action:'cancel_daily'});
    }
    reading=false;release();await Promise.all([tick,cancellation,configuration,queuedTick]);
    const status=await f.service.act(f.owner,{action:'status'});
    assert.equal(status.daily===null,!cancelFirst);assert.equal(f.sends.length,cancelFirst?1:0);
  }
});

test('invalid cancellation owners and unknown actions cannot suppress an otherwise valid daily send',async()=>{
  let release,started,reading=false;const gate=new Promise(resolve=>{release=resolve;});const ready=new Promise(resolve=>{started=resolve;});
  const f=await fixture({readProject:async()=>{if(reading){started();await gate;}return[];}});
  await f.service.act(f.owner,{action:'watch'});await f.service.act(f.owner,{action:'configure_daily',time:'15:00',timeZone:'UTC'});
  reading=true;const tick=f.service.tick();await ready;
  const invalidOwner=assert.rejects(f.service.act({sessionId:'invalid'},{action:'cancel_daily'}),/real current local session/);
  const invalidAction=assert.rejects(f.service.act(f.owner,{action:'cancel_daily_unknown'}),/Unknown companion action/);
  release();await Promise.all([tick,invalidOwner,invalidAction]);assert.equal(f.sends.length,1);
  assert.notEqual((await f.service.act(f.owner,{action:'status'})).daily,null);
});

test('blocked retains pending work while uncertain outcomes are never automatically retried', async () => {
  let calls = 0;
  const f = await fixture({send:async () => { calls++; if(calls===1)return {status:'blocked',detail:'no live agent'}; throw new Error('connection lost after send'); }});
  await f.service.act(f.owner,{action:'remind',dueAt:'2026-10-18T15:01:00Z',title:'Synthetic check'});
  f.time('2026-10-18T15:01:00Z');
  await f.service.tick();
  assert.equal((await f.service.act(f.owner,{action:'status'})).outbox[0].status,'blocked');
  await f.service.tick();
  assert.equal((await f.service.act(f.owner,{action:'status'})).outbox[0].status,'uncertain');
  await f.service.tick();
  assert.equal(calls,2);
});

test('restoring a dispatching record marks it uncertain and does not resend', async () => {
  const f = await fixture();
  await f.service.act(f.owner,{action:'remind',dueAt:'2026-10-18T15:01:00Z',title:'Synthetic check'});
  const saved = structuredClone(f.persisted());
  saved.reminders[0].status = 'enqueued';
  saved.outbox.push({id:'interrupted',kind:'reminder',sessionId:f.owner.sessionId,text:'synthetic',createdAt:'2026-10-18T15:01:00Z',expiresAt:'2026-10-18T15:06:00Z',status:'dispatching',detail:''});
  let calls=0;
  const {createService}=await api();
  const service=createService({store:{get:async()=>saved,put:async()=>{}},clock:()=>new Date('2026-10-18T15:02:00Z'),send:async()=>{calls++;return{status:'reported_sent'};}});
  await service.tick();
  assert.equal((await service.act(f.owner,{action:'status'})).outbox[0].status,'uncertain');
  assert.equal(calls,0);
});

test('completed reminder delivery does not consume the fifty active reminder slots forever',async()=>{
  const f=await fixture();
  for(let i=0;i<50;i++)await f.service.act(f.owner,{action:'remind',dueAt:'2026-10-18T15:01:00Z',title:`Synthetic reminder ${i}`});
  f.time('2026-10-18T15:01:00Z');await f.service.tick();
  const result=await f.service.act(f.owner,{action:'remind',dueAt:'2026-10-18T15:02:00Z',title:'Synthetic next reminder'});
  assert.equal(result.reminder.status,'scheduled');
});

test('status and list expose bounded metadata instead of replaying large outbox bodies',async()=>{
  const f=await fixture();await f.service.act(f.owner,{action:'watch'});
  const saved=structuredClone(f.persisted());
  saved.outbox=Array.from({length:100},(_,i)=>({id:`job-${i}`,kind:'daily',sessionId:f.owner.sessionId,text:'BODY_SENTINEL'.repeat(240),createdAt:'2026-10-18T15:00:00Z',expiresAt:'2026-10-18T21:00:00Z',status:'uncertain',detail:'REASON_SENTINEL '+ 'x'.repeat(280)}));
  const {createService}=await api();
  const service=createService({store:{get:async()=>saved,put:async()=>{}},discover:async()=>Array.from({length:100},(_,i)=>({id:`candidate-${i}`,root:`/synthetic/known-${i}`,label:'Synthetic known project'}))});
  const result=await service.act(f.owner,{action:'status'});
  assert.equal(JSON.stringify(result).includes('BODY_SENTINEL'),false);
  assert.match(JSON.stringify(result),/REASON_SENTINEL/);
  assert.match(result.text,/daily|恢复/);
  assert.ok(result.text.length<=3200);
  assert.ok(JSON.stringify(result).length<=16000);
  assert.ok(result.outbox.length<=10);
  const list=await service.act(f.owner,{action:'list'});assert.ok(list.candidates.length<=20);assert.ok(list.text.length<=3200);
});

test('digest always preserves every selected project identifier and explicit reminder within the cap',async()=>{
  const f=await fixture({readProject:async()=>Array.from({length:3},(_,i)=>({path:`file-${i}`,status:'ok',text:'x'.repeat(16000),modifiedAt:'2026-10-18T00:00:00Z'}))});
  for(let i=0;i<5;i++)await f.service.act(f.owner,{action:'watch',project:f.roots[i].root});
  for(let i=0;i<5;i++)await f.service.act(f.owner,{action:'remind',dueAt:'2026-10-18T15:01:00Z',title:`REMINDER ${i}`});
  const result=await f.service.act(f.owner,{action:'digest'});
  const state=await f.service.act(f.owner,{action:'status'});
  for(const project of state.projects)assert.ok(result.text.includes(project.id),'all project IDs should remain visible');
  assert.match(result.text,/明确提醒/);
  assert.ok(result.text.length<=3200);
});

test('GitHub requires explicit watched project association and reports fresh failures', async()=>{
  const f=await fixture({readRelease:async()=>{throw new Error('synthetic network failure');}});
  await f.service.act(f.owner,{action:'watch'});
  await f.service.act(f.owner,{action:'link_github',repository:'example/public-project'});
  const result=await f.service.act(f.owner,{action:'digest'});
  assert.match(result.text,/synthetic network failure/);
  await assert.rejects(f.service.act(f.owner,{action:'link_github',repository:'https://evil.invalid/x'}),/owner\/repo|repository/);
});

test('human commands accept ordinary arguments without JSON', async()=>{
  const {parseCommand}=await api();
  assert.deepEqual(parseCommand('daily 09:00 America/Mexico_City'),{action:'configure_daily',time:'09:00',timeZone:'America/Mexico_City'});
  assert.deepEqual(parseCommand('remind 2026-10-19T10:00:00-06:00 Review synthetic draft'),{action:'remind',dueAt:'2026-10-19T10:00:00-06:00',title:'Review synthetic draft'});
  assert.deepEqual(parseCommand('now'),{action:'digest'});
  assert.deepEqual(parseCommand('watch'),{action:'watch'});
  assert.deepEqual(parseCommand(''),{action:'status'});
  assert.deepEqual(parseCommand('daily 09:00'),{action:'configure_daily',time:'09:00'});
  assert.deepEqual(parseCommand('daily off'),{action:'cancel_daily'});
  assert.throws(()=>parseCommand('daily off UTC'),/Usage|用法/);
});
