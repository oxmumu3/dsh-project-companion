import test from 'node:test';
import assert from 'node:assert/strict';

const api = () => import('../src/task-results.js');
const START = '2026-10-18T15:00:00.000Z';
const SIX_HOURS = 6 * 60 * 60 * 1000;
const binding = { userHash: 'a'.repeat(64), botHash: 'b'.repeat(64) };
const input = (overrides = {}) => ({
  originSessionId: 'origin-session', originToolCallId: 'call-1', targetSessionId: 'target-session',
  targetMessageId: 'message-1', projectRoot: '/synthetic/public-project', projectLabel: '公开项目',
  task: '只读检查公开 README', returnBinding: binding, ...overrides,
});
async function fixture(options = {}) {
  const { createTaskResults } = await api();
  let now = new Date(START);
  let saved = options.saved ? structuredClone(options.saved) : undefined;
  const writes = [], sends = [];
  const service = createTaskResults({
    store: { get: async () => saved, put: async (key, value) => {
      assert.equal(key, 'profile'); saved = structuredClone(value); writes.push(structuredClone(value));
      await options.onPut?.(value);
    } },
    clock: () => now, hostTimeZone: 'Asia/Shanghai',
    send: async item => { const {authorize,...data}=item;sends.push(structuredClone(data)); return options.send ? options.send(item) : { status: 'reported_sent' }; },
  });
  await service.ready();
  return { service, writes, sends, persisted: () => structuredClone(saved), time: value => { now = new Date(value); } };
}
async function running(f, overrides = {}) {
  const result = await f.service.prepare(input(overrides));
  await f.service.admitted(result.job.id);
  await f.service.claimed({sessionId:result.job.targetSessionId,messageId:result.job.targetMessageId,turn:12,sourceKind:'user'});
  return result.job.id;
}
const reply = (service, text, extra = {}) => service.observe({sessionId:'target-session',type:'assistant',turn:12,text,...extra});
const end = (service, reason = {kind:'completed'}, extra = {}) => service.observe({sessionId:'target-session',type:'turn/end',turn:12,reason,...extra});
const jobStatus = async (f, id) => (await f.service.status('origin-session', {id})).jobs[0];

test('result delivery exposes a durable request ID and a guard that expires when the service closes',async()=>{
 let enter,release;const entered=new Promise(resolve=>enter=resolve),held=new Promise(resolve=>release=resolve);let item;
 const f=await fixture({send:async value=>{item=value;enter();await held;return{status:'blocked'};}});
 const id=await running(f);await reply(f.service,'合成结果');const finishing=end(f.service);await entered;
 assert.equal(item.requestId,'task-result-'+id);assert.equal(item.authorize(),true);
 const closing=f.service.close();assert.equal(item.authorize(),false);release();await finishing;await closing;
});

test('passive inspect never recovers, expires, writes or sends cold task state and scopes the original pairing',async()=>{
  const f=await fixture();const id=await running(f);await reply(f.service,'unfinished fragment');
  const saved=f.persisted(),before=structuredClone(saved);let writes=0,sends=0;
  const {createTaskResults}=await api();
  const cold=createTaskResults({store:{get:async()=>saved,put:async()=>{writes++;}},send:async()=>{sends++;},clock:()=>new Date('2026-10-19T00:00:00Z')});
  assert.equal(typeof cold.inspect,'function');
  const value=await cold.inspect('origin-session',{id,expectedBinding:binding});
  assert.equal(value.jobs[0].status,'running');assert.equal(value.jobs[0].reply,'');
  assert.deepEqual((await cold.inspect('origin-session',{expectedBinding:{...binding,userHash:'c'.repeat(64)}})).jobs,[]);
  assert.deepEqual((await cold.inspect('other-origin',{expectedBinding:binding})).jobs,[]);
  await assert.rejects(cold.inspect('origin-session',{}));
  assert.equal(writes,0);assert.equal(sends,0);assert.deepEqual(saved,before);
});

test('passive inspect only returns stored completed replies for selected ids and keeps truncation evidence',async()=>{
  const f=await fixture();const id=await running(f);await reply(f.service,'字'.repeat(9000));await end(f.service);
  const writes=f.writes.length,sends=f.sends.length;
  assert.equal(typeof f.service.inspect,'function');
  assert.equal(Object.hasOwn((await f.service.inspect('origin-session',{expectedBinding:binding})).jobs[0],'reply'),false);
  const selected=(await f.service.inspect('origin-session',{id,expectedBinding:binding})).jobs[0];
  assert.equal(selected.reply.length,8000);assert.equal(selected.replyTruncated,true);
  assert.equal(f.writes.length,writes);assert.equal(f.sends.length,sends);
  await f.service.close();await assert.rejects(f.service.inspect('origin-session',{expectedBinding:binding}));
});

const trustedScope = (overrides = {}) => ({originSessionId:'origin-session',projectRoot:'/synthetic/public-project',returnBinding:binding,...overrides});
test('trusted continuation returns only an exact completed target scoped to origin, project and original binding', async()=>{
  const f=await fixture();const id=await running(f);await reply(f.service,'SYNTHETIC result body never exposed by target selection');await end(f.service);
  assert.equal(typeof f.service.trustedLastTarget,'function');
  const writes=f.writes.length,sends=f.sends.length;
  assert.deepEqual(await f.service.trustedLastTarget(trustedScope()),{targetSessionId:'target-session'});
  for(const scope of [trustedScope({originSessionId:'another-origin'}),trustedScope({projectRoot:'/synthetic/other-project'}),trustedScope({returnBinding:null}),trustedScope({returnBinding:{...binding,botHash:'c'.repeat(64)}})])assert.equal(await f.service.trustedLastTarget(scope),null);
  assert.equal(f.writes.length,writes);assert.equal(f.sends.length,sends);assert.equal((await jobStatus(f,id)).status,'completed');
});
test('latest incomplete or ambiguous records prevent stale successful target fallback',async()=>{
  const f=await fixture();await running(f);await reply(f.service,'SYNTHETIC completed');await end(f.service);
  assert.equal(typeof f.service.trustedLastTarget,'function');
  f.time('2026-10-18T15:01:00.000Z');await f.service.prepare(input({originToolCallId:'newer-unconfirmed',targetMessageId:'newer-message',targetSessionId:'other-target'}));
  assert.equal(await f.service.trustedLastTarget(trustedScope()),null);
  const complete=await fixture();await running(complete);await reply(complete.service,'SYNTHETIC completed');await end(complete.service);
  const rows=complete.persisted();rows.jobs.push({...structuredClone(rows.jobs[0]),id:'second-same-time',originToolCallId:'other-call',targetMessageId:'other-message',targetSessionId:'other-target'});
  const restarted=await fixture({saved:rows});assert.equal(await restarted.service.trustedLastTarget(trustedScope()),null);
});
test('trusted continuation survives restart without requiring delivery or phone acceptance',async()=>{
  const f=await fixture({send:async()=>({status:'queued'})});await running(f);await reply(f.service,'SYNTHETIC finished');await end(f.service);
  const saved=f.persisted();const restored=await fixture({saved});
  assert.equal(typeof restored.service.trustedLastTarget,'function');
  assert.deepEqual(await restored.service.trustedLastTarget(trustedScope()),{targetSessionId:'target-session'});assert.equal(restored.sends.length,0);
  for(const change of [{reason:'unknown'},{turn:null},{status:'unknown'},{returnBinding:null}]){
    const invalid=structuredClone(saved);Object.assign(invalid.jobs[0],change);const untrusted=await fixture({saved:invalid});assert.equal(await untrusted.service.trustedLastTarget(trustedScope()),null);
  }
});

// Admission is deliberately persisted before the host performs followup().
test('prepare durably records the exact target input and duplicate call id never creates a second admission', async () => {
  const f = await fixture();
  const first = await f.service.prepare(input());
  assert.equal(first.duplicate,false); assert.equal(first.job.status,'prepared');
  assert.equal(f.persisted().jobs.length,1); assert.equal(f.persisted().jobs[0].targetMessageId,'message-1');
  assert.equal(f.persisted().jobs[0].originToolCallId,'call-1'); assert.equal(f.sends.length,0);
  const duplicate = await f.service.prepare(input({task:'a changed retry',targetMessageId:'message-retry'}));
  assert.equal(duplicate.duplicate,true); assert.equal(duplicate.job.id,first.job.id);
  assert.equal(duplicate.job.targetMessageId,'message-1'); assert.equal(f.persisted().jobs.length,1);
  const other = await f.service.prepare(input({originSessionId:'other-origin',targetMessageId:'message-2'}));
  assert.notEqual(other.job.id,first.job.id);
  first.job.task='mutated'; assert.notEqual(f.persisted().jobs[0].task,'mutated');
});

test('admission failure records never submitted or unknown without dispatching a result or readmitting', async () => {
  const f=await fixture();
  const a=await f.service.prepare(input()); await f.service.notAdmitted(a.job.id,{uncertain:false});
  assert.equal((await jobStatus(f,a.job.id)).status,'not_admitted');
  const b=await f.service.prepare(input({originToolCallId:'call-2',targetMessageId:'message-2'}));
  await f.service.notAdmitted(b.job.id,{uncertain:true});
  assert.equal((await jobStatus(f,b.job.id)).status,'unknown');
  await f.service.admitted(b.job.id); await f.service.tick();
  assert.equal((await jobStatus(f,b.job.id)).status,'unknown'); assert.equal(f.sends.length,0);
  assert.equal((await f.service.prepare(input())).duplicate,true);
});

test('invalid admission inputs and same-session returns are rejected without a saved job', async () => {
  const f=await fixture();
  for(const bad of [ {originToolCallId:''},{targetMessageId:''},{targetSessionId:'origin-session'},
    {projectRoot:'relative'},{returnBinding:{userHash:'raw-user'}},{task:'x'.repeat(8001)} ]) {
    await assert.rejects(f.service.prepare(input(bad)));
  }
  assert.equal((await f.service.status('origin-session')).jobs.length,0);
});

test('only the exact claimed input binds a turn and only its latest readable assistant response is returned', async () => {
  const f=await fixture(); const prepared=await f.service.prepare(input()); await f.service.admitted(prepared.job.id);
  await f.service.claimed({sessionId:'wrong-session',messageId:'message-1',turn:12,sourceKind:'user'});
  await reply(f.service,'UNCLAIMED'); await end(f.service); assert.equal(f.sends.length,0);
  await f.service.claimed({sessionId:'target-session',messageId:'message-other',turn:11,sourceKind:'user'});
  await f.service.claimed({sessionId:'target-session',messageId:'message-1',turn:12,sourceKind:'user'});
  await reply(f.service,'OLD TURN',{turn:11}); await reply(f.service,'WRONG SESSION',{sessionId:'other'});
  await reply(f.service,'first readable reply'); await reply(f.service,'REASONING',{type:'reasoning'});
  await reply(f.service,'interrupted fragment',{interrupted:true}); await reply(f.service,'   ');
  await reply(f.service,'最终公开材料回复'); assert.equal(f.sends.length,0,'assistant text alone is not a terminal result');
  await end(f.service,{kind:'completed'},{turn:11}); assert.equal(f.sends.length,0);
  await end(f.service); assert.equal(f.sends.length,1);
  const job=await jobStatus(f,prepared.job.id); assert.equal(job.status,'completed'); assert.equal(job.turn,12);
  assert.equal(job.reply,'最终公开材料回复'); assert.match(f.sends[0].text,/本次执行回复|执行回复/); assert.match(f.sends[0].text,/待验收/);
  assert.doesNotMatch(f.sends[0].text,/UNCLAIMED|OLD TURN|WRONG SESSION|REASONING|interrupted fragment|first readable/);
  assert.deepEqual(f.sends[0].expectedBinding,binding); assert.equal(f.sends[0].sessionId,'origin-session');
});

test('discarded tracked input terminates safely and late claim or turn events cannot revive it', async () => {
  const f=await fixture(); const p=await f.service.prepare(input()); await f.service.admitted(p.job.id);
  await f.service.discarded({sessionId:'wrong',messageId:'message-1'}); assert.equal((await jobStatus(f,p.job.id)).status,'admitted');
  await f.service.discarded({sessionId:'target-session',messageId:'message-1'});
  assert.equal((await jobStatus(f,p.job.id)).status,'discarded');
  await f.service.claimed({sessionId:'target-session',messageId:'message-1',turn:12,sourceKind:'user'});
  await reply(f.service,'must never forward'); await end(f.service); assert.equal(f.sends.length,0);
});

test('another direct input in the claimed turn suppresses mixed results even when claimed before the delegated input', async () => {
  for(const before of [false,true]) {
    const f=await fixture(); const p=await f.service.prepare(input()); await f.service.admitted(p.job.id);
    const tracked={sessionId:'target-session',messageId:'message-1',turn:12,sourceKind:'user'};
    const other={sessionId:'target-session',messageId:'private-message',turn:12,sourceKind:'user'};
    await f.service.claimed(before?other:tracked); await f.service.claimed(before?tracked:other);
    await reply(f.service,'PRIVATE_MIXED'); await end(f.service); await f.service.tick();
    const job=await jobStatus(f,p.job.id); assert.equal(job.status,'mixed'); assert.equal(job.reply,'');
    assert.equal(f.sends.length,0); assert.equal(JSON.stringify(f.persisted()).includes('PRIVATE_MIXED'),false);
  }
});

test('injected context does not count as a direct input but another delegated user input does', async () => {
  const f=await fixture(); const id=await running(f);
  await f.service.claimed({sessionId:'target-session',messageId:'context-message',turn:12,sourceKind:'system-context'});
  await reply(f.service,'clean reply'); await end(f.service); assert.equal((await jobStatus(f,id)).status,'completed');
  const g=await fixture(); const p=await g.service.prepare(input()); const q=await g.service.prepare(input({originToolCallId:'call-2',targetMessageId:'message-2'}));
  await g.service.claimed({sessionId:'target-session',messageId:'message-1',turn:12,sourceKind:'user'});
  await g.service.claimed({sessionId:'target-session',messageId:'message-2',turn:12,sourceKind:'user'});
  await reply(g.service,'mixed tasks'); await end(g.service);
  assert.deepEqual((await g.service.status('origin-session')).jobs.map(j=>j.status),['mixed','mixed']); assert.equal(g.sends.length,0);
  assert.notEqual(p.job.id,q.job.id);
});

test('terminal reasons are distinct and generic, never raw errors, partial replies or acceptance claims', async () => {
  for(const reason of ['blocked','aborted','error','max-tokens','interrupted','forked','plugin-unknown']) {
    const f=await fixture(); const id=await running(f); await reply(f.service,'UNSAFE_PARTIAL_REPLY');
    await end(f.service,{kind:reason,error:{message:'SECRET_RAW_EXCEPTION'},reason:'SECRET_CREDENTIAL'});
    const job=await jobStatus(f,id); assert.equal(job.status,reason==='plugin-unknown'?'unknown':reason);
    assert.equal(job.reply,''); assert.equal(f.sends.length,1); assert.ok(f.sends[0].text.length<=3200);
    assert.doesNotMatch(JSON.stringify(f.persisted()),/SECRET_RAW_EXCEPTION|SECRET_CREDENTIAL|UNSAFE_PARTIAL_REPLY/);
    assert.doesNotMatch(f.sends[0].text,/已验收|验收通过|成功完成/);
  }
  const f=await fixture(); const id=await running(f); await end(f.service);
  assert.equal((await jobStatus(f,id)).status,'no_text'); assert.match(f.sends[0].text,/没有.*回复|无.*文本|没有.*文本/);
});

test('duplicate terminal events and concurrent ticks produce a single durable delivery', async () => {
  let f; f=await fixture({send:async()=>{
    const job=f.persisted().jobs[0]; assert.equal(job.status,'completed'); assert.equal(job.delivery.status,'dispatching');
    assert.match(job.delivery.text,/only once/); return {status:'queued',detail:'untrusted bridge raw text'};
  }});
  const id=await running(f); await reply(f.service,'only once');
  await Promise.all([end(f.service),end(f.service),f.service.tick(),f.service.tick()]);
  assert.equal(f.sends.length,1); assert.equal((await jobStatus(f,id)).delivery.status,'queued');
  await f.service.tick(); await reply(f.service,'late replacement'); await end(f.service);
  assert.equal(f.sends.length,1); assert.equal((await jobStatus(f,id)).reply,'only once');
  assert.equal(JSON.stringify(f.persisted()).includes('untrusted bridge raw text'),false);
});

test('blocked delivery may retry while queued, reported sent, failed and uncertain deliveries never resend', async () => {
  for(const final of ['queued','reported_sent','failed','uncertain']) {
    let count=0; const f=await fixture({send:async()=>{count++; return {status:count===1?'blocked':final};}});
    const id=await running(f); await reply(f.service,'return body'); await end(f.service);
    assert.equal((await jobStatus(f,id)).delivery.status,'blocked'); assert.equal(f.service.needsTimer(),true);
    await f.service.tick(); await f.service.tick(); assert.equal(f.sends.length,2);
    assert.equal((await jobStatus(f,id)).delivery.status,final); assert.equal(f.service.needsTimer(),false);
  }
});

test('throwing or unrecognized send outcomes become uncertain without retaining raw exception text', async () => {
  for(const send of [async()=>{throw new Error('RAW_SECRET_FAILURE');}, async()=>({status:'new-unrecognized',detail:'RAW_SECRET_FAILURE'})]) {
    const f=await fixture({send}); const id=await running(f); await reply(f.service,'reply'); await end(f.service);
    await f.service.tick(); assert.equal(f.sends.length,1); assert.equal((await jobStatus(f,id)).delivery.status,'uncertain');
    assert.equal(JSON.stringify(f.persisted()).includes('RAW_SECRET_FAILURE'),false);
  }
});

test('unbound task results remain blocked and never cross the send boundary', async () => {
  const f=await fixture(); const id=await running(f,{returnBinding:null}); await reply(f.service,'reply'); await end(f.service); await f.service.tick();
  assert.equal(f.sends.length,0); assert.equal((await jobStatus(f,id)).delivery.status,'blocked');
});

test('status is caller scoped, omits bodies in listings and reveals a captured reply only by owned exact id', async () => {
  const f=await fixture(); const id=await running(f); await reply(f.service,'OWNED_BODY_SENTINEL'); await end(f.service);
  await f.service.prepare(input({originSessionId:'another-origin',originToolCallId:'call-2',targetMessageId:'message-2',task:'OTHER_PRIVATE_TASK'}));
  const listing=await f.service.status('origin-session'); assert.equal(listing.jobs.length,1); assert.equal(listing.jobs[0].id,id);
  assert.equal(JSON.stringify(listing).includes('OWNED_BODY_SENTINEL'),false); assert.equal(JSON.stringify(listing).includes('OTHER_PRIVATE_TASK'),false);
  assert.match(listing.text,/待验收/); assert.match(listing.text,/手机|送达|已读/);
  const detail=await f.service.status('origin-session',{id}); assert.equal(detail.jobs[0].reply,'OWNED_BODY_SENTINEL'); assert.match(detail.text,/OWNED_BODY_SENTINEL/);
  const denied=await f.service.status('another-origin',{id}); assert.deepEqual(denied.jobs,[]); assert.equal(JSON.stringify(denied).includes('OWNED_BODY_SENTINEL'),false);
});

test('six hour tracking and delivery windows expire without late execution or replay', async () => {
  const f=await fixture(); const p=await f.service.prepare(input()); await f.service.admitted(p.job.id);
  f.time(new Date(Date.parse(START)+SIX_HOURS)); await f.service.tick();
  assert.equal((await jobStatus(f,p.job.id)).status,'expired'); assert.equal(f.service.needsTimer(),false);
  await f.service.claimed({sessionId:'target-session',messageId:'message-1',turn:12,sourceKind:'user'}); await reply(f.service,'late'); await end(f.service); assert.equal(f.sends.length,0);
  const g=await fixture({send:async()=>({status:'blocked'})}); const id=await running(g); await reply(g.service,'reply'); await end(g.service); assert.equal(g.sends.length,1);
  g.time(new Date(Date.parse(START)+SIX_HOURS)); await g.service.tick(); assert.equal((await jobStatus(g,id)).delivery.status,'expired'); assert.equal(g.sends.length,1);
});

test('expiration is rechecked after dispatching persistence before sending', async () => {
  let f; f=await fixture({onPut:async row=>{if(row.jobs.some(job=>job.delivery?.status==='dispatching'))f.time(new Date(Date.parse(START)+SIX_HOURS));}});
  const id=await running(f); await reply(f.service,'reply'); await end(f.service);
  assert.equal(f.sends.length,0); assert.equal((await jobStatus(f,id)).delivery.status,'expired');
});

test('restart marks live executions unknown and in-flight sends uncertain without resubmission', async () => {
  const live=await fixture(); const id=await running(live); await reply(live.service,'partial before restart');
  const recovered=await fixture({saved:live.persisted()}); await recovered.service.tick();
  assert.equal((await jobStatus(recovered,id)).status,'unknown'); assert.equal((await jobStatus(recovered,id)).reply,'');
  assert.equal((await recovered.service.prepare(input())).duplicate,true); assert.equal(recovered.sends.length,0);
  await recovered.service.claimed({sessionId:'target-session',messageId:'message-1',turn:12,sourceKind:'user'}); await end(recovered.service); assert.equal(recovered.sends.length,0);
  const done=await fixture(); const doneId=await running(done); await reply(done.service,'reply'); await end(done.service);
  const saved=done.persisted(); saved.jobs[0].delivery.status='dispatching';
  const restored=await fixture({saved}); await restored.service.tick(); assert.equal((await jobStatus(restored,doneId)).delivery.status,'uncertain'); assert.equal(restored.sends.length,0);
});

test('at most ten active and fifty total records retain dedupe until the six hour window closes', async () => {
  const f=await fixture();
  for(let i=0;i<10;i++)await f.service.prepare(input({originToolCallId:`call-${i}`,targetMessageId:`message-${i}`}));
  await assert.rejects(f.service.prepare(input({originToolCallId:'overflow',targetMessageId:'overflow'})),/10|十/);
  assert.equal(f.persisted().jobs.length,10);
  const g=await fixture();
  for(let i=0;i<50;i++) {
    const p=await g.service.prepare(input({originToolCallId:`call-${i}`,targetMessageId:`message-${i}`}));
    await g.service.notAdmitted(p.job.id,{uncertain:false});
  }
  assert.equal(g.persisted().jobs.length,50);
  await assert.rejects(g.service.prepare(input({originToolCallId:'overflow',targetMessageId:'overflow'})),/50|五十/);
  assert.equal((await g.service.prepare(input())).duplicate,true);
  g.time(new Date(Date.parse(START)+SIX_HOURS));
  await g.service.prepare(input({originToolCallId:'after-expiry',targetMessageId:'after-expiry'}));
  assert.ok(g.persisted().jobs.length<=50);
  const {taskResultsRowSchema}=await api(); assert.equal(taskResultsRowSchema.safeParse(g.persisted()).success,true);
});

test('mobile result budget preserves complete Markdown and hides internal ids and paths', async () => {
  const f=await fixture(); const id=await running(f,{projectLabel:'公开项目 *[label](x)'.repeat(10)});
  await reply(f.service,'**[long](https://example.invalid) `code`** '.repeat(600)); await end(f.service);
  const text=f.sends[0].text; assert.ok(text.length<=3200); assert.match(text,/待验收/); assert.match(text,/截|完整|详情/);
  for(const internal of [id,'origin-session','target-session','message-1','call-1','/synthetic/public-project'])assert.equal(text.includes(internal),false);
  assert.equal((text.match(/(?<!\\)\*\*/g)??[]).length%2,0);
  assert.ok((await jobStatus(f,id)).reply.length<=8000,'captured reply storage is bounded');
});

test('mobile result turns observed relative citations into readable labels without changing the captured reply', async () => {
  const source='从 [README.md](README.md#L3-L13) 看，当前版本用于项目简报、提醒和任务结果回传。详见 [README.md](./README.md#L13) 和 [说明](docs/quickstart.md)。';
  const f=await fixture(); const id=await running(f); await reply(f.service,source); await end(f.service);
  const text=f.sends[0].text;
  assert.match(text,/README\.md（第3–13行）/); assert.match(text,/README\.md（第13行）/); assert.match(text,/和 说明。/);
  assert.doesNotMatch(text,/\\[\[\]()#]|\]\((?:\.\/)?README\.md|docs\/quickstart\.md/);
  assert.equal((await jobStatus(f,id)).reply,source); assert.equal(f.persisted().jobs[0].reply,source);
});

test('mobile result preserves simple quoted Markdown and separates long Chinese prose at sentence boundaries', async () => {
  const source='**当前结论**\n\n- 已读取公开资料\n- 仍需人工验收\n\n[官网](https://example.com/guide?q=1#section)';
  const f=await fixture(); await running(f); await reply(f.service,source); await end(f.service);
  assert.match(f.sends[0].text,/> \*\*当前结论\*\*\n> \n> - 已读取公开资料\n> - 仍需人工验收/);
  assert.match(f.sends[0].text,/> \[官网\]\(https:\/\/example\.com\/guide\?q=1#section\)/);
  const prose='第一句保留全部事实与措辞。'.repeat(10)+'第二句也应保留全部事实与措辞。';
  const g=await fixture(); await running(g); await reply(g.service,prose); await end(g.service);
  const body=g.sends[0].text.split('\n\n> ')[1].split('\n\n本轮回复')[0];
  assert.ok(body.includes('\n> \n> '),'a long prose paragraph gains paragraph breaks');
  assert.equal(body.replace(/\n> ?/g,''),prose);
});

test('mobile result removes local and unsafe link targets, images and HTML while keeping their readable text', async () => {
  const source='[本地说明](/Users/example/private/README.md#L5-L8) [文件](file:///Users/example/private/a.md) [编辑](vscode://file/Users/example/a.md) [危险](javascript:alert) [带认证](https://user:secret@example.com/a) [内网](http://127.0.0.1/a) ![示意图](https://example.com/image.png) <a href="https://evil.example">文字</a><img src="file:///secret">';
  const f=await fixture(); const id=await running(f); await reply(f.service,source); await end(f.service);
  const text=f.sends[0].text;
  assert.match(text,/本地说明（第5–8行）/); assert.match(text,/文件.*编辑.*危险.*带认证.*内网.*示意图.*文字/);
  assert.doesNotMatch(text,/\/Users\/|file:\/\/|vscode:|javascript:|user:secret|127\.0\.0\.1|!\[|<\/?[a-z]|image\.png|evil\.example/);
  assert.equal((await jobStatus(f,id)).reply,source);
});

test('HTML sanitizing preserves comparison facts and generic types inside inline code', async () => {
  const source='剩余额度 < 3，重试次数 > 2；类型为 `Array<Item>`。';
  const f=await fixture(); const id=await running(f); await reply(f.service,source); await end(f.service);
  assert.match(f.sends[0].text,/剩余额度 [<＜] 3，重试次数 [>＞] 2/);
  assert.match(f.sends[0].text,/Array[<＜]Item[>＞]/); assert.equal((await jobStatus(f,id)).reply,source);
});

test('plain display fallback preserves identifiers, arithmetic and array brackets', async () => {
  const source='account_id = 2*3；arr[0] < 3；类型为 `Array<Item>`；见 [README_data.md](README_data.md#L3)。';
  const f=await fixture(); await running(f); await reply(f.service,source); await end(f.service);
  const text=f.sends[0].text;
  assert.match(text,/account_id = 2\*3；arr\[0\] < 3/); assert.match(text,/Array<Item>/);
  assert.match(text,/README_data\.md（第3行）/);
});

test('long or unbalanced source Markdown falls back to a clean unicode-safe bounded excerpt', async () => {
  for(const source of ['**未闭合的结论和 [README.md](README.md#L3-L13)', '```js\nconst value = "片段";\n', '**事实** 😀 '.repeat(1200), '😀'.repeat(3999)+'\ud800']) {
    const f=await fixture(); await running(f); await reply(f.service,source); await end(f.service);
    const text=f.sends[0].text; assert.ok(text.length<=3200); assert.match(text,/本轮回复，仍待验收；可继续问进度/);
    assert.doesNotMatch(text,/[\\`*\[\]]|\ud800(?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/);
    assert.equal((text.match(/(?<!\\)\*\*/g)??[]).length%2,0);
  }
});

test('loading historical reported-sent results preserves their existing text and never resends them', async () => {
  const f=await fixture(); const id=await running(f); await reply(f.service,'[README.md](README.md#L3-L13)'); await end(f.service);
  const saved=f.persisted(); saved.jobs[0].delivery.text='历史回执 \\[README.md\\]\\(README.md\\#L3-L13\\)';
  const recovered=await fixture({saved}); await recovered.service.tick(); await end(recovered.service);
  assert.equal(recovered.sends.length,0); assert.equal(recovered.persisted().jobs[0].delivery.text,saved.jobs[0].delivery.text);
  assert.equal((await jobStatus(recovered,id)).delivery.status,'reported_sent');
});

test('close rejects new admissions, prevents pending sends and waits for queued persistence', async () => {
  const f=await fixture({send:async()=>({status:'blocked'})}); const id=await running(f); await reply(f.service,'reply'); await end(f.service); assert.equal(f.sends.length,1);
  const closing=f.service.close(); await assert.rejects(f.service.prepare(input({originToolCallId:'after-close',targetMessageId:'after-close'})),/关闭|closed/); await closing;
  await f.service.tick(); await end(f.service); assert.equal(f.sends.length,1); assert.equal(f.service.needsTimer(),false);
  assert.equal((await jobStatus(f,id)).delivery.status,'blocked');
  await f.service.close();
});

test('official assistant/message alias captures only non-interrupted text', async () => {
  const f=await fixture(); const id=await running(f);
  await reply(f.service,'official alias reply',{type:'assistant/message'}); await end(f.service);
  assert.equal((await jobStatus(f,id)).reply,'official alias reply'); assert.equal(f.sends.length,1);
});

test('duplicate claims for the same exact input are idempotent and cannot rebind its turn', async () => {
  const f=await fixture(); const id=await running(f);
  await f.service.claimed({sessionId:'target-session',messageId:'message-1',turn:12,sourceKind:'user'});
  await f.service.claimed({sessionId:'target-session',messageId:'message-1',turn:99,sourceKind:'user'});
  await reply(f.service,'valid turn'); await end(f.service);
  assert.equal((await jobStatus(f,id)).turn,12); assert.equal(f.sends.length,1);
});

test('close during dispatch persistence cancels its unsent boundary and drains the write', async () => {
  let release, persistedDispatch, f;
  const dispatchPersisted=new Promise(resolve=>{persistedDispatch=resolve;});
  const gate=new Promise(resolve=>{release=resolve;});
  f=await fixture({onPut:async row=>{if(row.jobs.some(j=>j.delivery?.status==='dispatching')){persistedDispatch();await gate;}}});
  await running(f); await reply(f.service,'reply'); const finishing=end(f.service); await dispatchPersisted;
  const closing=f.service.close(); release(); await finishing; await closing;
  assert.equal(f.sends.length,0); assert.equal(f.persisted().jobs[0].delivery.status,'pending');
});

test('failed dispatch persistence blocks side effects until restart recovery', async () => {
  const {createTaskResults}=await api(); let saved, sends=0;
  const service=createTaskResults({clock:()=>new Date(START),store:{get:async()=>saved,put:async(_key,row)=>{
    if(row.jobs.some(j=>j.delivery?.status==='dispatching'))throw new Error('RAW_STORAGE_SECRET');
    saved=structuredClone(row);
  }},send:async()=>{sends++;return {status:'reported_sent'};}});
  const f={service}; await running(f); await reply(service,'reply');
  await assert.rejects(end(service),error=>/storage unavailable/.test(error.message)&&!error.message.includes('RAW_STORAGE_SECRET'));
  assert.equal(sends,0); await assert.rejects(service.tick(),/storage unavailable/);
  assert.equal(saved.jobs[0].delivery.status,'pending');
});

test('abnormal direct-input history fails closed instead of forgetting an earlier mixed input', async () => {
  const f=await fixture(); const p=await f.service.prepare(input());
  for(let turn=0;turn<33;turn++)await f.service.claimed({sessionId:'target-session',messageId:`other-${turn}`,turn,sourceKind:'user'});
  assert.equal((await jobStatus(f,p.job.id)).status,'unknown');
  await f.service.claimed({sessionId:'target-session',messageId:'message-1',turn:12,sourceKind:'user'}); await reply(f.service,'unsafe'); await end(f.service);
  assert.equal(f.sends.length,0);
});
