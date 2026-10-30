import test from 'node:test';
import assert from 'node:assert/strict';
async function api(){const m=await import('../src/news-service.js').catch(()=>({}));assert.equal(typeof m.createNewsService,'function','news service must exist');return m;}
const owner={sessionId:'session-test',cwd:'/synthetic/project'},binding='a'.repeat(64),otherBinding='b'.repeat(64);
const article=i=>({id:`a${i}`,url:`https://example${i}.com/article/${i}`,title:`Article ${i}`,sourceName:'Synthetic RSS',sourceUrl:'https://example.com/feed.xml',publishedAt:'2026-10-19T13:00:00Z',excerpt:`Feed fact ${i}`});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
async function fixture(options={}){const{createNewsService}=await api();let persisted=options.persisted,now=new Date('2026-10-19T15:00:00Z'),bound=binding,paused=false;let reads=[],sends=[],fetches=0,writes=0;const hooks={fetchCandidates:async()=>{fetches++;return{articles:Array.from({length:12},(_,i)=>article(i)),stats:{hours:24}};},selectArticles:async({articles})=>articles.slice(0,10).map(a=>a.id),readArticle:async a=>{reads.push(a.id);return{article:a,content:`Original fact ${a.id}`,coverage:'article',truncated:false};},summarizeArticles:async({articles})=>({items:articles.map(a=>({id:a.id,tier:a.coverage==='article'?'deep':'brief',kind:'substantive',summary:`Summary ${a.id}`,why:'Useful business context'}))}),send:async item=>{sends.push(item);return{status:'reported_sent'};},...options.hooks};const store=options.store??{get:async()=>structuredClone(persisted),put:async(_k,v)=>{writes++;persisted=structuredClone(v);}};const service=createNewsService({store,clock:()=>now,hostTimeZone:()=> 'America/Mexico_City',readBinding:async()=>({bound:!!bound,bindingKey:bound}),canRun:async()=>!paused,...hooks});return{service,sends,reads,fetches:()=>fetches,writes:()=>writes,persisted:()=>persisted,time:v=>{now=new Date(v);},bind:v=>{bound=v;},pause:v=>{paused=v;}};}
const mutate=(action,extra={})=>({action,userRequested:true,requestId:`req-${action}`,...extra});
test('default status is off without source, send or storage mutations',async()=>{const f=await fixture();await f.service.ready();const r=await f.service.act(owner,{action:'status'});assert.equal(r.schedule,null);assert.equal(f.fetches(),0);assert.equal(f.sends.length,0);assert.equal(f.writes(),0);assert.equal(f.service.needsTimer(),false);});
test('preview creates 3+7, reads only three originals and persists nothing',async()=>{const f=await fixture();const r=await f.service.act(owner,{action:'preview'});assert.equal(r.items.length,10);assert.deepEqual(f.reads,['a0','a1','a2']);assert.equal(f.writes(),0);assert.equal(f.sends.length,0);assert.ok(r.text.length<=3200);assert.equal(r.stats.hours,24);});
test('shortage stays honest and failed article reads fall back to RSS',async()=>{const f=await fixture({hooks:{fetchCandidates:async()=>({articles:[article(0),article(1)]}),readArticle:async()=>{throw new Error('secret path');}}});const r=await f.service.act(owner,{action:'preview'});assert.equal(r.items.length,2);assert.ok(r.items.every(a=>a.coverage==='feed-only'));assert.match(r.text,/RSS|原文未获取/);assert.doesNotMatch(r.text,/secret path/);});
test('unknown or duplicate selection and injected summary URLs cannot send',async()=>{for(const selectArticles of [async()=>['made-up'],async()=>['a0','a0']]){const f=await fixture({hooks:{selectArticles}});await assert.rejects(f.service.act(owner,mutate('send_now')),/ID|选择|重复/);assert.equal(f.sends.length,0);}const f=await fixture({hooks:{summarizeArticles:async()=>({items:[{id:'a0',summary:'https://evil.example/x'}]})}});await assert.rejects(f.service.act(owner,mutate('send_now')),/URL|链接|摘要/);assert.equal(f.sends.length,0);});
test('summary must cover selected IDs once and reject extra fields',async()=>{for(const summarizeArticles of [async()=>({items:[{id:'a0',summary:'one'}]}),async()=>({items:Array.from({length:10},(_,i)=>({id:`a${i}`,summary:'ok',url:'https://evil.test'}))})]){const f=await fixture({hooks:{summarizeArticles}});await assert.rejects(f.service.act(owner,mutate('send_now')),/摘要|ID|字段/);assert.equal(f.sends.length,0);}});
test('mutations require explicit user intent, request ID, timezone and binding',async()=>{const f=await fixture();for(const input of [{action:'send_now'},{action:'configure',time:'09:00',timeZone:'America/Mexico_City'},mutate('configure',{time:'09:00'})])await assert.rejects(f.service.act(owner,input));f.bind(null);await assert.rejects(f.service.act(owner,mutate('configure',{time:'09:00',timeZone:'America/Mexico_City'})),/绑定|binding/);assert.equal(f.fetches(),0);});
test('send receipt is persisted first, request retries dedupe, delivered IDs omitted',async()=>{let f;f=await fixture({hooks:{send:async item=>{assert.equal(f.persisted().jobs.at(-1).status,'dispatching');f.sends.push(item);return{status:'queued'};}}});assert.equal((await f.service.act(owner,mutate('send_now'))).status,'queued');assert.equal((await f.service.act(owner,mutate('send_now'))).duplicate,true);assert.equal(f.sends.length,1);assert.equal(f.persisted().articleHistory.length,10);assert.equal((await f.service.act(owner,{action:'preview'})).items.length,2);});
test('daily sends once per local date and expires after six hours',async()=>{const f=await fixture();await f.service.act(owner,mutate('configure',{time:'09:00',timeZone:'America/Mexico_City'}));assert.equal(f.service.needsTimer(),true);await f.service.tick();await f.service.tick();assert.equal(f.sends.length,1);f.time('2026-10-20T22:00:00Z');await f.service.tick();assert.equal(f.sends.length,1);assert.equal(f.persisted().jobs.at(-1).status,'expired');});
test('daily failure claims its date despite reconfigure',async()=>{const f=await fixture({hooks:{fetchCandidates:async()=>{throw new Error('failed');}}});await f.service.act(owner,mutate('configure',{time:'09:00',timeZone:'America/Mexico_City'}));await f.service.tick();await f.service.tick();await f.service.act(owner,mutate('configure',{requestId:'req-new',time:'08:00',timeZone:'America/Mexico_City'}));await f.service.tick();assert.equal(f.persisted().jobs.length,1);assert.equal(f.persisted().jobs[0].status,'failed');});
test('replayed configure cannot re-enable cancelled schedule',async()=>{const f=await fixture();const conf=mutate('configure',{time:'09:00',timeZone:'America/Mexico_City'});await f.service.act(owner,conf);await f.service.act(owner,mutate('cancel'));assert.equal((await f.service.act(owner,conf)).duplicate,true);assert.equal((await f.service.act(owner,{action:'status'})).schedule,null);});
test('cancel aborts waiting generation before dispatch',async()=>{const started=deferred(),gate=deferred();const f=await fixture({hooks:{fetchCandidates:async({signal})=>{started.resolve();await gate.promise;assert.equal(signal.aborted,true);return{articles:[article(0)]};}}});const p=f.service.act(owner,mutate('send_now'));await started.promise;const cancel=f.service.act(owner,mutate('cancel'));gate.resolve();await assert.rejects(p,/取消|停止|aborted|cancel/i);await cancel;assert.equal(f.sends.length,0);assert.equal(f.service.needsTimer(),false);});
test('delivery exposes a stable request identity and cancellation guard to a queued Family channel',async()=>{const entered=deferred(),gate=deferred();let permit,requestId;const f=await fixture({hooks:{send:async item=>{requestId=item.requestId;entered.resolve();await gate.promise;permit=item.authorize();return{status:permit?'reported_sent':'failed'};}}});const sending=f.service.act(owner,mutate('send_now'));await entered.promise;const cancelling=f.service.act(owner,mutate('cancel'));gate.resolve();await Promise.allSettled([sending,cancelling]);assert.match(requestId,/^news-news_/);assert.equal(permit,false);});
test('pause or changed binding after generation blocks sending',async()=>{for(const change of [f=>f.pause(true),f=>f.bind(otherBinding)]){const gate=deferred(),started=deferred();const f=await fixture({hooks:{fetchCandidates:async()=>{started.resolve();await gate.promise;return{articles:[article(0)]};}}});const p=f.service.act(owner,mutate('send_now'));await started.promise;change(f);gate.resolve();await assert.rejects(p,/暂停|绑定|不可用|授权/);assert.equal(f.sends.length,0);}});
test('binding changes during dispatch receipt persistence prevent side effect',async()=>{let saved,f;const store={get:async()=>saved,put:async(_k,v)=>{saved=structuredClone(v);if(v.jobs.some(j=>j.status==='dispatching'))f.bind(otherBinding);}};f=await fixture({store});await assert.rejects(f.service.act(owner,mutate('send_now')),/绑定|授权/);assert.equal(f.sends.length,0);});
test('storage failures fail closed without leaking details',async()=>{const f=await fixture({store:{get:async()=>undefined,put:async()=>{throw new Error('private secret');}}});await assert.rejects(f.service.act(owner,mutate('send_now')),/存储|storage/i);assert.equal(f.sends.length,0);await assert.rejects(f.service.act(owner,{action:'status'}),/存储|storage/i);});
test('restart dispatching becomes uncertain without automatic retransmit',async()=>{const f=await fixture();await f.service.act(owner,mutate('send_now'));const state=f.persisted();state.jobs[0].status='dispatching';state.articleHistory=[];const reboot=await fixture({persisted:state});await reboot.service.ready();assert.equal(reboot.persisted().jobs[0].status,'uncertain');await reboot.service.tick();assert.equal((await reboot.service.act(owner,mutate('send_now'))).duplicate,true);assert.equal(reboot.sends.length,0);assert.equal(reboot.persisted().articleHistory.length,10);});
test('unknown send outcome is terminal and recorded in article dedupe',async()=>{const f=await fixture({hooks:{send:async()=>{throw new Error('transport secret');}}});const r=await f.service.act(owner,mutate('send_now'));assert.equal(r.status,'uncertain');assert.doesNotMatch(r.text,/transport secret/);await f.service.tick();assert.equal(f.persisted().articleHistory.length,10);assert.equal(f.persisted().jobs.length,1);});
test('close aborts and drains generation',async()=>{const started=deferred(),gate=deferred();const f=await fixture({hooks:{fetchCandidates:async({signal})=>{started.resolve();await gate.promise;assert.equal(signal.aborted,true);return{articles:[article(0)]};}}});const p=f.service.act(owner,mutate('send_now'));await started.promise;const close=f.service.close();gate.resolve();await assert.rejects(p,/停止|关闭|aborted|cancel/i);await close;assert.equal(f.sends.length,0);assert.equal(f.service.needsTimer(),false);});
test('status omits identities and exported schema validates persisted state',async()=>{const{newsRowSchema}=await api();const f=await fixture();await f.service.act(owner,mutate('configure',{time:'09:00',timeZone:'America/Mexico_City'}));const r=await f.service.act(owner,{action:'status'});for(const secret of [binding,owner.sessionId,owner.cwd])assert.ok(!JSON.stringify(r).includes(secret));assert.equal(newsRowSchema.safeParse(f.persisted()).success,true);});
test('a cancel arriving during initial job persistence invalidates that pending request',async()=>{let saved,stop=false;const started=deferred(),gate=deferred();const f=await fixture({store:{get:async()=>saved,put:async(_k,v)=>{saved=structuredClone(v);if(!stop&&v.jobs.at(-1)?.status==='generating'){stop=true;started.resolve();await gate.promise;}}}});const p=f.service.act(owner,mutate('send_now'));await started.promise;const cancelled=f.service.act(owner,mutate('cancel'));gate.resolve();await assert.rejects(p,/取消|停止/);await cancelled;assert.equal(f.sends.length,0);});
test('caller abort and suspend stop preview even when dependency ignores the signal',async()=>{for(const method of ['signal','suspend']){const started=deferred();const f=await fixture({hooks:{fetchCandidates:async()=>{started.resolve();return new Promise(()=>{});}}});const controller=new AbortController();const p=f.service.act(owner,{action:'preview',signal:controller.signal});await started.promise;if(method==='signal')controller.abort();else f.service.suspend();await assert.rejects(p,/取消|停止|aborted/i);await f.service.close();assert.equal(f.sends.length,0);}});
test('zero relevant selections return an honest empty preview',async()=>{const f=await fixture({hooks:{selectArticles:async()=>[]}});const r=await f.service.act(owner,{action:'preview'});assert.equal(r.items.length,0);assert.match(r.text,/没有|0 篇/);assert.equal(f.writes(),0);});
test('summary Chinese title is used without allowing its model to create links',async()=>{const f=await fixture({hooks:{summarizeArticles:async({articles})=>({items:articles.map(a=>({id:a.id,title:'忠实中文标题',summary:'已有资料摘要',why:'帮助了解工程方法'}))})}});const r=await f.service.act(owner,{action:'preview'});assert.match(r.text,/忠实中文标题/);assert.ok(r.text.includes(article(0).url));});
test('published time outside the 24 hour window is not selected',async()=>{let selected;const f=await fixture({hooks:{fetchCandidates:async()=>({articles:[article(0),{...article(1),publishedAt:'2026-10-17T13:00:00Z'},{...article(2),publishedAt:'2026-10-20T13:00:00Z'}]}),selectArticles:async({articles})=>{selected=articles;return articles.map(a=>a.id);}}});const r=await f.service.act(owner,{action:'preview'});assert.deepEqual(selected.map(a=>a.id),['a0']);assert.equal(r.stats.candidateCount,1);});
test('source availability is bounded and disclosed without raw warning leakage',async()=>{const f=await fixture({hooks:{fetchCandidates:async()=>({articles:[article(0)],stats:{totalFeeds:92,succeededFeeds:90,failedFeeds:2,secret:'private'},warnings:['token=private']})}});const r=await f.service.act(owner,{action:'preview'});assert.equal(r.stats.totalFeeds,92);assert.equal(r.stats.failedFeeds,2);assert.match(r.text,/90\/92|92.*90/);assert.match(r.text,/2 个未获取/);assert.doesNotMatch(JSON.stringify(r),/token=private|"secret"/);});
test('cancel and configure replays do not cause unbounded recent receipt pruning',async()=>{const f=await fixture();for(let i=0;i<100;i++)await f.service.act(owner,mutate('cancel',{requestId:`cancel-${i}`}));await assert.rejects(f.service.act(owner,mutate('cancel',{requestId:'cancel-overflow'})),/过多|稍后/);assert.equal(f.persisted().receipts.length,100);});
test('daily history survives pruning old delivery jobs',async()=>{const f=await fixture();await f.service.act(owner,mutate('configure',{time:'09:00',timeZone:'America/Mexico_City'}));await f.service.tick();const state=f.persisted();state.jobs=[];const reboot=await fixture({persisted:state});await reboot.service.ready();await reboot.service.tick();assert.equal(reboot.sends.length,0);});
test('raw dependency errors never escape public preview',async()=>{for(const hooks of [{fetchCandidates:async()=>{throw new Error('secret API token');}},{selectArticles:async()=>{throw new Error('secret API token');}},{summarizeArticles:async()=>{throw new Error('secret API token');}}]){const f=await fixture({hooks});await assert.rejects(f.service.act(owner,{action:'preview'}),error=>!error.message.includes('secret'));}});
test('selection materials stay below the host model budget for 100 large candidates',async()=>{let size;const f=await fixture({hooks:{fetchCandidates:async()=>({articles:Array.from({length:100},(_,i)=>({...article(i),excerpt:'"'.repeat(2500)}))}),selectArticles:async({articles})=>{size=JSON.stringify(articles.map(({id,title,sourceName,publishedAt,excerpt})=>({id,title,sourceName,publishedAt,excerpt}))).length;return articles.slice(0,10).map(a=>a.id);}}});await f.service.act(owner,{action:'preview'});assert.ok(size<=150000);});
test('new daily subscription never catches up a due instant before user authorization',async()=>{const f=await fixture();f.time('2026-10-19T06:00:00Z');await f.service.act(owner,mutate('configure',{time:'21:00',timeZone:'America/Mexico_City'}));await f.service.tick();assert.equal(f.sends.length,0);assert.equal(f.persisted().jobs.length,0);assert.equal(f.fetches(),0);});
test('previously authorized daily plan catches up within six hours after restart',async()=>{const f=await fixture();f.time('2026-10-19T14:00:00Z');await f.service.act(owner,mutate('configure',{time:'09:00',timeZone:'America/Mexico_City'}));const reboot=await fixture({persisted:f.persisted()});reboot.time('2026-10-19T16:00:00Z');await reboot.service.tick();assert.equal(reboot.sends.length,1);});
test('fetch budget skips are disclosed as not scanned rather than all attempted failures',async()=>{const f=await fixture({hooks:{fetchCandidates:async()=>({articles:[article(0)],stats:{totalFeeds:92,succeededFeeds:64,failedFeeds:28,skippedFeeds:20}})}});const r=await f.service.act(owner,{action:'preview'});assert.equal(r.stats.skippedFeeds,20);assert.match(r.text,/64\/92 个获取成功/);assert.match(r.text,/28 个.*未获取|未获取.*28 个/);assert.match(r.text,/其中\s*20\s*个未及扫描（45秒上限）/);assert.doesNotMatch(r.text,/来源失败|28 个失败/);});
test('status text exposes last dispatch outcome without requiring execution-local structured value',async()=>{const f=await fixture();const before=await f.service.act(owner,{action:'status'});assert.match(before.text,/尚无发送任务/);await f.service.act(owner,mutate('send_now'));const after=await f.service.act(owner,{action:'status'});assert.match(after.text,/通道报告已发出/);assert.match(after.text,/手机送达.*未知/);});

test('explicit topics personalize only this preview and reach both model stages without persistence', async () => {
  const seen = [];
  const f = await fixture({ hooks: {
    selectArticles: async ({ articles, topics }) => { seen.push(topics); return articles.slice(0, 3).map(a => a.id); },
    summarizeArticles: async ({ articles, topics }) => { seen.push(topics); return { items: articles.map(a => ({ id: a.id, summary: '来源提供的插件实践。', why: '与 DeepSeek 插件关注点相关。' })) }; },
  } });
  const topics = [' DeepSeek 插件 ', '创作者生态'];
  const r = await f.service.act(owner, { action: 'preview', topics });
  assert.deepEqual(seen, [['DeepSeek 插件', '创作者生态'], ['DeepSeek 插件', '创作者生态']]);
  assert.deepEqual(r.topics, ['DeepSeek 插件', '创作者生态']);
  assert.deepEqual(topics, [' DeepSeek 插件 ', '创作者生态']);
  assert.match(r.text, /本次关注点.*DeepSeek 插件/);
  assert.match(r.text, /本次预览通过当前对话回复；未另行推送、未更改计划/s);
  assert.equal(f.writes(), 0);
  assert.equal(f.sends.length, 0);
  assert.equal(f.service.needsTimer(), false);
});

test('temporary topics leave an existing daily subscription byte-for-byte unchanged', async () => {
  const f = await fixture();
  await f.service.act(owner, mutate('configure', { time: '10:00', timeZone: 'America/Mexico_City' }));
  const before = structuredClone(f.persisted()), writes = f.writes();
  await f.service.act(owner, { action: 'preview', topics: ['Agent 产品'] });
  assert.deepEqual(f.persisted(), before);
  assert.equal(f.writes(), writes);
  assert.equal(f.sends.length, 0);
  assert.doesNotMatch(JSON.stringify(f.persisted()), /Agent 产品|readerFocus/);
  assert.equal(f.persisted().preferences, null);
});

test('topics on unsupported actions reject without cancelling work or mutating schedules', async () => {
  const f = await fixture();
  await f.service.act(owner, mutate('configure', { time: '10:00', timeZone: 'America/Mexico_City' }));
  const before = structuredClone(f.persisted()), writes = f.writes();
  for (const action of ['status', 'cancel', 'send_now', 'clear_topics']) {
    await assert.rejects(f.service.act(owner, mutate(action, { topics: ['AI'], time: '09:00', timeZone: 'America/Mexico_City' })));
    await assert.rejects(f.service.act(owner, mutate(action, { topics: undefined, time: '09:00', timeZone: 'America/Mexico_City' })));
  }
  assert.deepEqual(f.persisted(), before);
  assert.equal(f.writes(), writes);
  assert.equal(f.fetches(), 0);
  assert.equal(f.sends.length, 0);
});

test('saved explicit topics survive restart and status returns only sanitized preference metadata', async () => {
  const f = await fixture();
  const topics = [' DeepSeek 插件 ', '创作者生态'];
  await f.service.act(owner, mutate('set_topics', { topics }));
  topics[0] = 'Changed after call';
  assert.equal(f.fetches(), 0);
  assert.equal(f.sends.length, 0);
  assert.equal(f.persisted().version, 2);
  const reboot = await fixture({ persisted: f.persisted() });
  const r = await reboot.service.act(owner, { action: 'status' });
  assert.deepEqual(r.topics, ['DeepSeek 插件', '创作者生态']);
  assert.equal(r.topicSource, 'explicit');
  assert.equal(r.topicsEditable, true);
  assert.equal(r.schedule, null);
  for (const secret of [owner.sessionId, owner.cwd, binding]) assert.ok(!JSON.stringify(r).includes(secret));
  assert.match(r.text, /已保存关注点.*DeepSeek 插件/);
});

test('scheduled and immediate delivery use saved topics in both stages and freeze them in each job', async () => {
  const seen = [];
  const hooks = {
    selectArticles: async ({ articles, topics }) => { seen.push(['select', structuredClone(topics)]); topics?.push('adapter mutation'); return articles.slice(0, 3).map(a => a.id); },
    summarizeArticles: async ({ articles, topics }) => { seen.push(['summary', topics]); return { items: articles.map(a => ({ id: a.id, summary: '公开资料摘要', why: '与明确关注点有关' })) }; },
  };
  const f = await fixture({ hooks });
  await f.service.act(owner, mutate('configure', { time: '09:00', timeZone: 'America/Mexico_City', topics: ['Agent 产品'] }));
  await f.service.tick();
  await f.service.act(owner, mutate('send_now'));
  assert.deepEqual(seen, [['select', ['Agent 产品']], ['summary', ['Agent 产品']], ['select', ['Agent 产品']], ['summary', ['Agent 产品']]]);
  assert.equal(f.sends.length, 2);
  for (const job of f.persisted().jobs) assert.deepEqual(job.topics, ['Agent 产品']);
  for (const message of f.sends) {
    assert.match(message.text, /已保存关注点.*Agent 产品/);
    assert.doesNotMatch(message.text, /仅本次预览|未发送/);
  }
});

test('preview defaults to saved topics and an explicit override neither persists nor sends', async () => {
  const seen = [];
  const f = await fixture({ hooks: { selectArticles: async ({ topics }) => { seen.push(topics); return []; } } });
  await f.service.act(owner, mutate('set_topics', { topics: ['Agent 产品'] }));
  const before = structuredClone(f.persisted()), writes = f.writes();
  const saved = await f.service.act(owner, { action: 'preview' });
  const override = await f.service.act(owner, { action: 'preview', topics: ['开发工具'] });
  assert.deepEqual(seen, [['Agent 产品'], ['开发工具']]);
  assert.match(saved.text, /已保存关注点/);
  assert.match(saved.text, /本次预览通过当前对话回复；未另行推送、未更改计划/);
  assert.match(override.text, /本次关注点.*开发工具/);
  assert.deepEqual(f.persisted(), before);
  assert.equal(f.writes(), writes);
  assert.equal(f.sends.length, 0);
});

test('clear_topics returns to general AI coverage without disabling the schedule and replay cannot restore topics', async () => {
  const f = await fixture();
  const setting = mutate('set_topics', { topics: ['Agent 产品'] });
  await f.service.act(owner, setting);
  await f.service.act(owner, mutate('configure', { time: '09:00', timeZone: 'America/Mexico_City' }));
  const result = await f.service.act(owner, mutate('clear_topics'));
  assert.equal(result.topics, null);
  assert.equal(result.topicSource, 'default');
  assert.equal(f.service.needsTimer(), true);
  assert.equal((await f.service.act(owner, setting)).duplicate, true);
  assert.equal(f.persisted().preferences, null);
  await f.service.tick();
  assert.equal(f.sends.length, 1);
  assert.equal(f.persisted().jobs[0].topics, null);
});

test('preference mutations require real caller, explicit intent, real request ID and current binding', async () => {
  for (const input of [{ action: 'set_topics', topics: ['AI'] }, { action: 'clear_topics' }, { action: 'set_topics', topics: ['AI'], userRequested: true }]) {
    const f = await fixture();
    await assert.rejects(f.service.act(owner, input));
    assert.equal(f.writes(), 0);
  }
  for (const action of ['set_topics', 'clear_topics']) {
    const f = await fixture();
    await assert.rejects(f.service.act({ sessionId: 'synthetic' }, mutate(action, action === 'set_topics' ? { topics: ['AI'] } : {})));
    f.bind(null);
    await assert.rejects(f.service.act(owner, mutate(action, action === 'set_topics' ? { topics: ['AI'] } : {})), /绑定/);
    assert.equal(f.writes(), 0);
  }
});

test('another binding cannot read or overwrite saved topics or carry them into a delivery', async () => {
  const f = await fixture();
  await f.service.act(owner, mutate('set_topics', { topics: ['Synthetic private interest'] }));
  const before = structuredClone(f.persisted());
  const other = { sessionId: 'different-session', cwd: '/synthetic/other' };
  f.bind(otherBinding);
  const status = await f.service.act(other, { action: 'status' });
  assert.equal(status.topics, null);
  assert.equal(status.topicSource, 'unavailable');
  assert.equal(status.topicsEditable, false);
  assert.doesNotMatch(JSON.stringify(status), /Synthetic private interest/);
  await assert.rejects(f.service.act(other, { action: 'preview' }), /绑定|关注点/);
  for (const action of ['set_topics', 'clear_topics', 'configure', 'send_now']) {
    await assert.rejects(f.service.act(other, mutate(action, { ...(action === 'set_topics' ? { topics: ['Overwrite'] } : {}), ...(action === 'configure' ? { time: '09:00', timeZone: 'UTC' } : {}) })), /绑定/);
  }
  const explicit = await f.service.act(other, { action: 'preview', topics: ['公开技术'] });
  assert.deepEqual(explicit.topics, ['公开技术']);
  assert.deepEqual(f.persisted(), before);
  assert.equal(f.sends.length, 0);
});

test('a v1 subscription migrates with history and receipts intact but no inferred topics', async () => {
  const legacy = { id: 'profile', version: 1, schedule: { time: '09:00', timeZone: 'America/Mexico_City', sessionId: owner.sessionId, bindingKey: binding, createdAt: '2026-10-19T14:00:00.000Z' }, jobs: [], articleHistory: [{ id: 'old-article', at: '2026-10-18T15:00:00.000Z' }], dailyDates: ['2026-10-18'], receipts: [{ sessionId: owner.sessionId, requestId: 'legacy-configure', action: 'configure', createdAt: '2026-10-19T14:00:00.000Z' }] };
  const { newsRowSchema } = await api();
  assert.equal(newsRowSchema.safeParse(legacy).success, true);
  const f = await fixture({ persisted: legacy });
  await f.service.ready();
  assert.equal(f.persisted().version, 2);
  assert.equal(f.persisted().preferences, null);
  for (const key of ['schedule', 'articleHistory', 'dailyDates', 'receipts']) assert.deepEqual(f.persisted()[key], legacy[key]);
  await f.service.tick();
  assert.equal(f.sends.length, 1);
  assert.equal(f.persisted().jobs[0].topics, null);
});

test('changing topics aborts older generation and late adapters cannot dispatch stale content', async () => {
  const started = deferred(), gate = deferred(), seen = [];
  const f = await fixture({ hooks: { selectArticles: async ({ articles, topics }) => { seen.push(topics); if (seen.length === 1) { started.resolve(); await gate.promise; } return articles.slice(0, 1).map(a => a.id); } } });
  await f.service.act(owner, mutate('set_topics', { topics: ['旧主题'] }));
  const pending = f.service.act(owner, mutate('send_now'));
  await started.promise;
  const updating = f.service.act(owner, mutate('set_topics', { requestId: 'new-topics', topics: ['新主题'] }));
  await assert.rejects(pending, /取消|停止/);
  await updating;
  gate.resolve();
  assert.equal(f.sends.length, 0);
  assert.deepEqual(f.persisted().jobs[0].topics, ['旧主题']);
  assert.equal(f.persisted().jobs[0].status, 'cancelled');
  await f.service.act(owner, mutate('send_now', { requestId: 'new-send' }));
  assert.deepEqual(seen, [['旧主题'], ['新主题']]);
  assert.equal(f.sends.length, 1);
});

test('preference replays and foreign mutations do not cancel an authorized in-flight job', async () => {
  const started = deferred(), gate = deferred();
  const f = await fixture({ hooks: { selectArticles: async ({ articles }) => { started.resolve(); await gate.promise; return articles.slice(0, 1).map(a => a.id); }, readBinding: async sessionId => ({ bound: true, bindingKey: sessionId === owner.sessionId ? binding : otherBinding }) } });
  const setting = mutate('set_topics', { topics: ['Agent 产品'] });
  await f.service.act(owner, setting);
  const pending = f.service.act(owner, mutate('send_now'));
  await started.promise;
  const replay = f.service.act(owner, setting);
  await assert.rejects(f.service.act({ sessionId: 'foreign', cwd: '/synthetic/foreign' }, mutate('clear_topics')), /绑定/);
  gate.resolve();
  assert.equal((await pending).status, 'reported_sent');
  assert.equal((await replay).duplicate, true);
  assert.equal(f.sends.length, 1);
});

test('a late first configure authorization cannot re-enable after a newer explicit cancel', async () => {
  const entered = deferred(), gate = deferred();
  let reads = 0;
  const f = await fixture({ hooks: { readBinding: async () => { if (++reads === 1) { entered.resolve(); await gate.promise; } return { bound: true, bindingKey: binding }; } } });
  const configuring = f.service.act(owner, mutate('configure', { time: '09:00', timeZone: 'UTC', topics: ['旧配置'] }));
  await entered.promise;
  await f.service.act(owner, mutate('cancel'));
  gate.resolve();
  await assert.rejects(configuring, /取消|停止/);
  const result = await f.service.act(owner, { action: 'status' });
  assert.equal(result.schedule, null);
  assert.equal(result.topics, null);
});

test('a current binding loss suppresses saved focus from status and preview without modifying it', async () => {
  const f = await fixture();
  await f.service.act(owner, mutate('set_topics', { topics: ['绑定范围内的主题'] }));
  const before = structuredClone(f.persisted());
  f.bind(null);
  const result = await f.service.act(owner, { action: 'status' });
  assert.equal(result.topicSource, 'unavailable');
  assert.equal(result.topics, null);
  assert.doesNotMatch(JSON.stringify(result), /绑定范围内的主题/);
  await assert.rejects(f.service.act(owner, { action: 'preview' }), /绑定/);
  assert.deepEqual(f.persisted(), before);
});

test('a preference write failure is fail-closed for later preview and delivery', async () => {
  const f = await fixture({ store: { get: async () => undefined, put: async () => { throw new Error('private disk path'); } } });
  await assert.rejects(f.service.act(owner, mutate('set_topics', { topics: ['AI'] })), /存储/);
  for (const input of [{ action: 'preview' }, { action: 'status' }, mutate('send_now')]) await assert.rejects(f.service.act(owner, input), /存储/);
  assert.equal(f.fetches(), 0);
  assert.equal(f.sends.length, 0);
});

test('invalid saved preferences and invalid configure topics never change existing plans', async () => {
  const f = await fixture();
  await f.service.act(owner, mutate('configure', { time: '09:00', timeZone: 'UTC' }));
  const before = structuredClone(f.persisted());
  for (const action of ['set_topics', 'configure']) for (const topics of [undefined, null, [], ['x'.repeat(81)], ['AI', ' AI ']]) {
    await assert.rejects(f.service.act(owner, mutate(action, { topics, time: '10:00', timeZone: 'UTC' })), { code: 'NEWS_INVALID_TOPICS' });
  }
  assert.deepEqual(f.persisted(), before);
  const invalid = { ...before, preferences: { topics: [' AI '], source: 'explicit', sessionId: owner.sessionId, bindingKey: binding, updatedAt: '2026-10-19T15:00:00.000Z' } };
  const reboot = await fixture({ persisted: invalid });
  await assert.rejects(reboot.service.ready(), /损坏|不兼容/);
  assert.equal(reboot.writes(), 0);
});

test('legacy interrupted jobs retain dedupe and terminal outcomes during upgrade', async () => {
  const f = await fixture();
  await f.service.act(owner, mutate('send_now'));
  const legacy = structuredClone(f.persisted());
  legacy.version = 1;delete legacy.preferences;
  for (const job of legacy.jobs) { delete job.topics; delete job.timeZone; job.status = 'dispatching'; }
  legacy.articleHistory = [];
  const reboot = await fixture({ persisted: legacy });
  await reboot.service.ready();
  assert.equal(reboot.persisted().jobs[0].status, 'uncertain');
  assert.equal(reboot.persisted().jobs[0].topics, null);
  assert.equal(reboot.persisted().articleHistory.length, 10);
  assert.equal((await reboot.service.act(owner, mutate('send_now'))).duplicate, true);
  assert.equal(reboot.sends.length, 0);
});

test('a queued old tick does not claim the day after preferences were reconfigured', async () => {
  const started = deferred(), gate = deferred();
  let hold = false;
  const f = await fixture({ hooks: { selectArticles: async ({ articles }) => { if (hold) { started.resolve(); await gate.promise; } return articles.slice(0, 1).map(a => a.id); } } });
  await f.service.act(owner, mutate('configure', { time: '09:00', timeZone: 'America/Mexico_City', topics: ['旧主题'] }));
  hold = true;
  const preview = f.service.act(owner, { action: 'preview' });
  await started.promise;
  const staleTick = f.service.tick();
  const change = f.service.act(owner, mutate('set_topics', { topics: ['新主题'] }));
  await assert.rejects(preview, /取消|停止/);
  await staleTick;
  await change;
  gate.resolve();hold = false;
  assert.equal(f.persisted().jobs.length, 0);
  await f.service.tick();
  assert.equal(f.sends.length, 1);
  assert.deepEqual(f.persisted().jobs[0].topics, ['新主题']);
});

test('stored preferences cannot be joined to a schedule with a different binding', async () => {
  const f = await fixture();
  await f.service.act(owner, mutate('configure', { time: '09:00', timeZone: 'America/Mexico_City', topics: ['只有原绑定可见'] }));
  const mismatched = structuredClone(f.persisted());
  mismatched.schedule.bindingKey = otherBinding;
  const reboot = await fixture({ persisted: mismatched });
  await assert.rejects(reboot.service.ready(), /不兼容|损坏/);
  assert.equal(reboot.fetches(), 0);
  assert.equal(reboot.sends.length, 0);
});

test('request-scoped authorization is rechecked after binding lookup and before saving topics', async () => {
  let allowed = true, checks = 0;
  const f = await fixture({ hooks: { readBinding: async () => { if (++checks === 2) allowed = false; return { bound: true, bindingKey: binding }; } } });
  await assert.rejects(f.service.act(owner, mutate('set_topics', { topics: ['未授权主题'], guard: async () => { if (!allowed) throw new Error('private authorization details'); }, authorizeSync: () => allowed })), /授权/);
  assert.equal(f.writes(), 0);
  assert.equal((await f.service.act(owner, { action: 'status' })).topics, null);
});

test('denied request-scoped mutation does not cancel authorized in-flight delivery', async () => {
  const started = deferred(), gate = deferred();
  const f = await fixture({ hooks: { selectArticles: async ({ articles }) => { started.resolve(); await gate.promise; return articles.slice(0, 1).map(a => a.id); } } });
  await f.service.act(owner, mutate('set_topics', { topics: ['原主题'] }));
  const pending = f.service.act(owner, mutate('send_now'));
  await started.promise;
  await assert.rejects(f.service.act(owner, mutate('clear_topics', { guard: async () => { throw new Error('denied'); }, authorizeSync: () => true })), /授权/);
  gate.resolve();
  assert.equal((await pending).status, 'reported_sent');
  assert.deepEqual(f.persisted().preferences.topics, ['原主题']);
});

test('invalid synchronous authorization contracts fail closed without preference writes', async () => {
  for (const authorizeSync of [true, () => false, () => undefined, async () => true]) {
    const f = await fixture();
    await assert.rejects(f.service.act(owner, mutate('set_topics', { topics: ['AI'], authorizeSync })), /授权/);
    assert.equal(f.writes(), 0);
  }
});

test('invalid preview topics reject before source fetch or storage IO', async () => {
  for (const topics of ['AI', ['x'.repeat(81)], ['AI\n产品'], ['AI', 'AI'], [], null]) {
    const f = await fixture();
    await assert.rejects(f.service.act(owner, { action: 'preview', topics }), { code: 'NEWS_INVALID_TOPICS' });
    assert.equal(f.fetches(), 0);
    assert.equal(f.writes(), 0);
    assert.equal(f.sends.length, 0);
  }
});

test('topic preview with no selected articles still identifies one-off focus and no-send state', async () => {
  const f = await fixture({ hooks: { selectArticles: async () => [] } });
  const r = await f.service.act(owner, { action: 'preview', topics: ['DeepSeek 插件'] });
  assert.equal(r.items.length, 0);
  assert.match(r.text, /DeepSeek 插件/);
  assert.match(r.text, /本次预览通过当前对话回复；未另行推送、未更改计划/s);
});

test('mutating the submitted preview action cannot bypass admission or change a daily plan', async () => {
  for (const action of ['cancel', 'configure', 'send_now']) {
    const f = await fixture();
    await f.service.act(owner, mutate('configure', { time: '10:00', timeZone: 'America/Mexico_City' }));
    const before = structuredClone(f.persisted()), writes = f.writes();
    const input = { action: 'preview', topics: ['AI'], requestId: 'preview-input' };
    const resultPromise = f.service.act(owner, input);
    Object.assign(input, { action, userRequested: true, requestId: 'changed-input', time: '09:00', timeZone: 'UTC' });
    const result = await resultPromise;
    assert.equal(result.status, 'preview');
    assert.deepEqual(result.topics, ['AI']);
    assert.deepEqual(f.persisted(), before);
    assert.equal(f.writes(), writes);
    assert.equal(f.sends.length, 0);
  }
});

test('manual preview and delivery recheck the original request after fetching public candidates', async () => {
  for (const action of ['preview', 'send_now']) {
    let allowed = true, selections = 0;
    const f = await fixture({ hooks: {
      fetchCandidates: async () => { allowed = false; return { articles: [article(0)] }; },
      selectArticles: async ({ articles }) => { selections++; return articles.map(a => a.id); },
    } });
    await assert.rejects(f.service.act(owner, { ...mutate(action), guard: async () => { if (!allowed) throw Error('request withdrawn'); }, authorizeSync: () => allowed }), /授权/);
    assert.equal(selections, 0);
    assert.equal(f.sends.length, 0);
  }
});

test('news model adapters receive live request guards for provider preparation and stream admission', async () => {
  let allowed = true;
  const f = await fixture({ hooks: { selectArticles: async ({ guard, authorizeSync }) => {
    assert.equal(typeof guard, 'function'); assert.equal(typeof authorizeSync, 'function');
    await guard(); assert.equal(authorizeSync(), true); allowed = false;
    await assert.rejects(guard(), /授权/); assert.equal(authorizeSync(), false);
    return [];
  } } });
  await assert.rejects(f.service.act(owner, { action: 'preview', guard: async () => { if (!allowed) throw Error('request withdrawn'); }, authorizeSync: () => allowed }), /授权/);
});

test('a queued manual send checks request withdrawal and pause again at channel dispatch', async () => {
  for (const change of ['request', 'binding', 'pause']) {
    const entered = deferred(), release = deferred(); let allowed = true, currentBinding = binding, paused = false, permitted;
    const f = await fixture({ hooks: { canRunSync: () => !paused, readBinding: async () => ({ bound: true, bindingKey: currentBinding }), send: async item => {
      entered.resolve(); await release.promise; permitted = item.authorize(); return { status: permitted ? 'reported_sent' : 'failed' };
    } } });
    const result = f.service.act(owner, { ...mutate('send_now'), guard: async () => { if (!allowed) throw Error('request withdrawn'); }, authorizeSync: () => allowed && currentBinding === binding });
    await entered.promise;
    if (change === 'pause') paused = true; else if (change === 'binding') currentBinding = otherBinding; else allowed = false;
    release.resolve(); await result;
    assert.equal(permitted, false, change);
    assert.equal(f.persisted().jobs.at(-1).status, 'failed');
    assert.equal(f.persisted().articleHistory.length, 0);
  }
});

test('scheduled news retains binding and pause checks but does not reuse a finished configure call', async () => {
  let callActive = true, paused = false, permit;
  const f = await fixture({ hooks: { canRunSync: () => !paused, send: async item => { permit = item.authorize(); return { status: permit ? 'reported_sent' : 'failed' }; } } });
  await f.service.act(owner, { ...mutate('configure', { time: '09:00', timeZone: 'America/Mexico_City' }), guard: async () => { if (!callActive) throw Error('old call ended'); }, authorizeSync: () => callActive });
  callActive = false;
  await f.service.tick();
  assert.equal(permit, true);
  assert.equal(f.persisted().jobs.at(-1).status, 'reported_sent');
});

test('a false asynchronous request guard fails closed before any source or state access', async () => {
  const f = await fixture();
  await assert.rejects(f.service.act(owner, { action: 'preview', guard: async () => false }), /授权/);
  assert.equal(f.fetches(), 0); assert.equal(f.writes(), 0);
});

test('suspending news cancels a hung request recheck and releases the serial queue', async () => {
  let checking = false, timer;
  const entered = deferred();
  const f = await fixture({ hooks: { fetchCandidates: async () => { checking = true; return { articles: [article(0)] }; } } });
  const pending = f.service.act(owner, { action: 'preview', guard: async () => { if (checking) { entered.resolve(); await new Promise(() => {}); } } });
  const settled = pending.then(() => 'returned', () => 'cancelled');
  await entered.promise; f.service.suspend();
  try { assert.equal(await Promise.race([settled, new Promise(resolve => { timer = setTimeout(() => resolve('still-blocked'), 1000); })]), 'cancelled'); }
  finally { clearTimeout(timer); }
  assert.equal((await f.service.act(owner, { action: 'status' })).schedule, null);
  await f.service.close();
});
