import test from 'node:test';
import assert from 'node:assert/strict';
const api = async () => { const m = await import('../src/personal-review.js').catch(() => ({})); assert.equal(typeof m.createPersonalReviewService, 'function', 'personal review service exists'); return m; };
const owner = { sessionId: 'owner-session', cwd: '/synthetic/project' }, binding = 'a'.repeat(64), grant = 'b'.repeat(64);
const evidence = (extra = {}) => ({ id: 'mail:1', source: 'gmail', title: 'New access policy', text: 'A new account policy may interrupt access. Review before 2026-11-01.', at: '2026-10-29T08:00:00.000Z', dueAt: '2026-11-01T10:00:00.000Z', url: 'https://example.test/event/1', ...extra });
const candidate = (extra = {}) => ({ key: 'access-policy', kind: 'risk', title: '访问政策即将变化', summary: '来源提示可能影响访问，尚未确认实际生效。', why: '需要在生效前核对。', action: '核对服务商设置。', unknown: '实际生效状态未知。', evidenceIds: ['mail:1'], priority: 'high', confidence: 'source', dueAt: '2026-11-01T10:00:00.000Z', ...extra });
const intent = (action, extra = {}) => ({ action, requestId: `request-${action}`, userRequested: true, ...extra });
const scope = { sources: ['gmail'], projects: [] };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function fixture(options = {}) {
  const { createPersonalReviewService } = await api();
  let stored = options.persisted, now = new Date('2026-10-29T09:00:00.000Z'), currentGrant = grant, currentBinding = binding, allowed = true, writes = 0;
  const sends = [], reads = [], models = [];
  const service = createPersonalReviewService({ store: options.store ?? { get: async () => structuredClone(stored), put: async (_key, row) => { writes++; stored = structuredClone(row); } },
    clock: () => now, readBinding: async () => ({ bound: Boolean(currentBinding), bindingKey: currentBinding }), authorization: async caller => caller.sessionId === owner.sessionId ? currentGrant : null, canRun: async () => allowed,
    collect: async args => { reads.push(args); return { evidence: [evidence()], coverage: [{ source: 'gmail', status: 'ok', count: 1 }] }; },
    summarize: async args => { models.push(args); return { items: [candidate()] }; }, send: async args => { sends.push(args); return { status: 'reported_sent' }; }, ...options.hooks });
  return { service, sends, reads, models, stored: () => stored, writes: () => writes, time: value => { now = new Date(value); }, revoke: () => { currentGrant = 'c'.repeat(64); }, rebind: () => { currentBinding = 'd'.repeat(64); }, disable: () => { allowed = false; } };
}
test('default stays off; configured scope persists without reading', async () => {
  const f = await fixture(); await f.service.ready(); assert.equal(f.service.needsTimer(), false); assert.equal(f.writes(), 0);
  await f.service.act(owner, intent('configure', { ...scope, schedule: { dailyTime: '09:00', weeklyDay: 4, weeklyTime: '10:00', timeZone: 'UTC' } }));
  assert.equal(f.reads.length, 0); assert.equal(f.service.needsTimer(), true); assert.deepEqual(f.stored().subscription.sources, ['gmail']);
  assert.equal((await api()).personalReviewRowSchema.safeParse(f.stored()).success, true);
});
test('configuration and status show the actual daily and weekly times with their time zone', async () => {
  const f = await fixture();
  const configured = await f.service.act(owner, intent('configure', { ...scope, schedule: { dailyTime: '09:00', weeklyDay: 1, weeklyTime: '18:30', timeZone: 'America/Mexico_City' } }));
  for (const result of [configured, await f.service.act(owner, { action: 'status' })]) { assert.match(result.text, /每天 09:00/); assert.match(result.text, /每周一 18:30/); assert.match(result.text, /America\/Mexico_City/); }
});
test('preview detects an unconfigured new risk in authorized sources without creating plans', async () => {
  const f = await fixture(); const result = await f.service.act(owner, { action: 'preview', ...scope });
  assert.equal(result.items.length, 1); assert.match(result.text, /可能影响|未知/); assert.match(result.text, /邮件/); assert.equal(f.reads[0].sources[0], 'gmail');
  assert.equal(f.sends.length, 0); assert.equal(f.stored().subscription, null); assert.equal(f.service.needsTimer(), false);
});
test('daily and weekly claim independent occurrences; replay and restart do not resend', async () => {
  const f = await fixture(); await f.service.act(owner, intent('configure', { ...scope, schedule: { dailyTime: '09:00', weeklyDay: 4, weeklyTime: '10:00', timeZone: 'UTC' } }));
  await f.service.tick(); await f.service.tick(); assert.equal(f.sends.length, 1);
  f.time('2026-10-29T10:00:00.000Z'); await f.service.tick(); assert.equal(f.sends.length, 2); assert.match(f.sends[1].text, /每周|本周/);
  const reboot = await fixture({ persisted: f.stored() }); reboot.time('2026-10-29T10:10:00.000Z'); await reboot.service.tick(); assert.equal(reboot.sends.length, 0);
});
test('unchanged evidence escalates once when deadline approaches and handled feedback suppresses it', async () => {
  const f = await fixture(); await f.service.act(owner, intent('run_now', scope)); const id = f.stored().items[0].id;
  f.time('2026-10-30T09:00:00.000Z'); await f.service.act(owner, intent('run_now', { ...scope, requestId: 'second' })); assert.equal(f.sends.length, 1);
  f.time('2026-11-01T09:00:00.000Z'); await f.service.act(owner, intent('run_now', { ...scope, requestId: 'third' })); assert.equal(f.sends.length, 2);
  await f.service.act(owner, intent('run_now', { ...scope, requestId: 'fourth' })); assert.equal(f.sends.length, 2);
  await f.service.act(owner, intent('feedback', { itemId: id, feedback: 'handled' }));
  f.time('2026-11-02T09:00:00.000Z'); await f.service.act(owner, intent('run_now', { ...scope, requestId: 'fifth' })); assert.equal(f.sends.length, 2); assert.equal(f.stored().items[0].status, 'handled');
});
test('snooze and dismissed feedback survive future sightings', async () => {
  for (const feedback of ['snoozed', 'dismissed']) {
    const f = await fixture(); await f.service.act(owner, intent('run_now', scope));
    await f.service.act(owner, intent('feedback', { itemId: f.stored().items[0].id, feedback, ...(feedback === 'snoozed' ? { snoozeUntil: '2026-11-05T00:00:00.000Z' } : {}) }));
    f.time('2026-11-01T09:00:00.000Z'); await f.service.act(owner, intent('run_now', { ...scope, requestId: 'again' })); assert.equal(f.sends.length, 1);
  }
});
test('one event across sources and rewritten model keys preserves identity', async () => {
  let round = 0;
  const f = await fixture({ hooks: { collect: async () => ({ evidence: [evidence(), evidence({ id: 'drive:2', source: 'drive' })], coverage: [{ source: 'gmail', status: 'ok', count: 1 }, { source: 'drive', status: 'ok', count: 1 }] }), summarize: async () => ({ items: [candidate({ key: `wording-${round++}` }), candidate({ key: 'another-title', evidenceIds: ['drive:2'], confidence: 'inferred' })] }) } });
  await f.service.act(owner, intent('run_now', { sources: ['gmail', 'drive'], projects: [] })); await f.service.act(owner, intent('run_now', { sources: ['gmail', 'drive'], projects: [], requestId: 'next' }));
  assert.equal(f.stored().items.length, 1); assert.equal(f.sends.length, 1); assert.equal(f.stored().items[0].evidence.length, 2);
});
test('failed coverage is unknown and does not advance success watermarks', async () => {
  let failed = false;
  const f = await fixture({ hooks: { collect: async () => failed ? { evidence: [], coverage: [{ source: 'gmail', status: 'failed', count: null }] } : { evidence: [evidence()], coverage: [{ source: 'gmail', status: 'ok', count: 1 }] } } });
  await f.service.act(owner, intent('run_now', scope)); const before = structuredClone(f.stored().watermarks); failed = true; f.time('2026-10-30T09:00:00.000Z');
  const result = await f.service.act(owner, intent('run_now', { ...scope, requestId: 'failed' })); assert.equal(result.status, 'unknown'); assert.deepEqual(f.stored().watermarks, before); assert.doesNotMatch(result.text, /没有进展|无变化|0 条/); assert.equal(f.sends.length, 1);
});
test('weekly retains unresolved commitments even when source has no new evidence', async () => {
  let empty = false;
  const f = await fixture({ hooks: { collect: async () => ({ evidence: empty ? [] : [evidence()], coverage: [{ source: 'gmail', status: 'ok', count: empty ? 0 : 1 }] }), summarize: async () => ({ items: empty ? [] : [candidate()] }) } });
  await f.service.act(owner, intent('run_now', scope)); empty = true; f.time('2026-10-30T09:00:00.000Z'); const result = await f.service.act(owner, intent('run_now', { ...scope, kind: 'weekly', requestId: 'weekly' }));
  assert.equal(result.items.length, 1); assert.match(result.text, /未解决|未处理/); assert.match(result.text, /10月29日/);
});
test('revocation and rebind during collection prevent model and delivery', async () => {
  for (const change of ['revoke', 'rebind']) {
    const started = deferred(), release = deferred(); const f = await fixture({ hooks: { collect: async () => { started.resolve(); await release.promise; return { evidence: [evidence()], coverage: [{ source: 'gmail', status: 'ok', count: 1 }] }; } } });
    const pending = f.service.act(owner, intent('run_now', scope)); await started.promise; f[change](); release.resolve(); await assert.rejects(pending, /授权|绑定/); assert.equal(f.models.length, 0); assert.equal(f.sends.length, 0);
  }
});
test('cancel aborts uncooperative collector and suppresses its later result', async () => {
  const started = deferred(); const f = await fixture({ hooks: { collect: async () => { started.resolve(); return new Promise(() => {}); } } });
  const pending = f.service.act(owner, intent('run_now', scope)); await started.promise; const cancel = f.service.act(owner, intent('cancel')); await assert.rejects(pending, /取消|停止/); await cancel; assert.equal(f.sends.length, 0); await f.service.close();
});
test('dispatch is journaled first and ambiguous outcomes are never retransmitted', async () => {
  let f; f = await fixture({ hooks: { send: async args => { assert.equal(f.stored().jobs.at(-1).status, 'dispatching'); assert.equal(await args.authorize(), true); f.sends.push(args); throw new Error('private token'); } } });
  const first = await f.service.act(owner, intent('run_now', scope)); assert.equal(first.status, 'uncertain'); assert.doesNotMatch(first.text, /private token/);
  const saved = f.stored(); saved.jobs[0].status = 'dispatching'; const reboot = await fixture({ persisted: saved }); await reboot.service.ready(); assert.equal(reboot.stored().jobs[0].status, 'uncertain');
  const replay = await reboot.service.act(owner, intent('run_now', scope)); assert.equal(replay.duplicate, true); await reboot.service.act(owner, intent('run_now', { ...scope, requestId: 'new-request' })); assert.equal(reboot.sends.length, 0);
});
test('replayed configuration cannot undo pause or cancel, and family caller cannot invalidate owner work', async () => {
  const f = await fixture(); const config = intent('configure', { ...scope, schedule: { dailyTime: '09:00', timeZone: 'UTC' } }); await f.service.act(owner, config);
  await assert.rejects(f.service.act({ ...owner, sessionId: 'family-session' }, intent('cancel')), /授权|本人|会话/);
  await f.service.act(owner, intent('pause')); assert.equal(f.service.needsTimer(), false); await f.service.act(owner, config); assert.equal(f.service.needsTimer(), false);
  await f.service.act(owner, intent('cancel')); await f.service.act(owner, config); assert.equal(f.service.needsTimer(), false);
});
test('unknown citations, fabricated dates, external URLs and out-of-scope evidence reject safely', async () => {
  for (const item of [candidate({ evidenceIds: ['unknown'] }), candidate({ dueAt: '2030-01-01T00:00:00.000Z' }), candidate({ summary: 'https://evil.test' })]) {
    const f = await fixture({ hooks: { summarize: async () => ({ items: [item] }) } }); await assert.rejects(f.service.act(owner, intent('run_now', scope))); assert.equal(f.sends.length, 0);
  }
  const f = await fixture({ hooks: { collect: async () => ({ evidence: [evidence({ source: 'flomo' })], coverage: [{ source: 'gmail', status: 'ok', count: 1 }] }) } }); await assert.rejects(f.service.act(owner, { action: 'preview', ...scope }));
});
test('new plan never catches up before authorization; expired occurrences do not scan', async () => {
  const f = await fixture(); await f.service.act(owner, intent('configure', { ...scope, schedule: { dailyTime: '08:00', timeZone: 'UTC' } })); await f.service.tick(); assert.equal(f.reads.length, 0);
  f.time('2026-10-30T18:00:00.000Z'); await f.service.tick(); assert.equal(f.reads.length, 0); assert.equal(f.stored().jobs.at(-1).status, 'expired');
});
test('request mutation guard prevents a replaced Family message from persisting configuration or feedback', async () => {
  const f = await fixture(); await assert.rejects(f.service.act(owner, intent('configure', { ...scope, schedule: { dailyTime: '09:00', timeZone: 'UTC' }, guard: async () => { throw new Error('replaced'); }, authorizeSync: () => false })));
  assert.equal(f.writes(), 0); await f.service.act(owner, intent('run_now', scope)); const before = f.writes();
  await assert.rejects(f.service.act(owner, intent('feedback', { itemId: f.stored().items[0].id, feedback: 'handled', authorizeSync: () => false })));
  assert.equal(f.writes(), before); assert.equal(f.stored().items[0].status, 'open');
});
test('final synchronous send authorization rejects scope changes after async checks', async () => {
  let authorized = true; const f = await fixture({ hooks: { authorizationSync: () => authorized, readBindingSync: () => ({ bound: true, bindingKey: binding }), canRunSync: () => true, send: async args => { assert.equal(args.authorize(), true); assert.equal(typeof args.authorizeAsync, 'function'); authorized = false; assert.equal(args.authorize(), false); return { status: 'failed' }; } } });
  assert.equal((await f.service.act(owner, intent('run_now', scope))).status, 'failed');
});
test('a first preview can be cancelled without an existing subscription', async () => {
  const started = deferred(); const f = await fixture({ hooks: { collect: async () => { started.resolve(); return new Promise(() => {}); } } });
  let fallback = false; const pending = f.service.act(owner, { action: 'preview', ...scope }); await started.promise; const cancelled = f.service.act(owner, intent('cancel')); const timer = setTimeout(() => { fallback = true; f.service.suspend(); }, 60); await assert.rejects(pending, /取消|停止/); clearTimeout(timer); await cancelled; assert.equal(fallback, false);
});
test('project-only scope is valid and partial coverage cannot advance a watermark', async () => {
  const f = await fixture({ hooks: { collect: async () => ({ evidence: [evidence({ source: 'project' })], coverage: [{ source: 'project', status: 'partial', count: 1, truncated: true }] }) } });
  const result = await f.service.act(owner, intent('run_now', { sources: [], projects: ['/synthetic/project'] })); assert.equal(result.items.length, 1); assert.deepEqual(f.stored().watermarks, {}); assert.match(result.text, /未完整覆盖/);
});
test('relative caller directories are rejected before source access', async () => {
  const f = await fixture(); await assert.rejects(f.service.act({ ...owner, cwd: 'relative' }, { action: 'preview', ...scope })); assert.equal(f.reads.length, 0);
});
test('new source facts on the same item notify once; model paraphrases and modified timestamps stay quiet', async () => {
  let body = 'Access policy is planned.', at = '2026-10-29T08:00:00.000Z', wording = 0;
  const f = await fixture({ hooks: { collect: async () => ({ evidence: [evidence({ text: body, at })], coverage: [{ source: 'gmail', status: 'ok', count: 1 }] }), summarize: async () => ({ items: [candidate({ summary: `来源提示访问政策待核对，表述 ${wording++}。` })] }) } });
  await f.service.act(owner, intent('run_now', scope)); assert.equal(f.sends.length, 1);
  at = '2026-10-29T08:10:00.000Z'; await f.service.act(owner, intent('run_now', { ...scope, requestId: 'mtime' })); assert.equal(f.sends.length, 1);
  body = 'Access policy is planned. The rollout now includes a new mandatory access review.'; await f.service.act(owner, intent('run_now', { ...scope, requestId: 'changed' })); assert.equal(f.sends.length, 2);
  await f.service.act(owner, intent('run_now', { ...scope, requestId: 'reword' })); assert.equal(f.sends.length, 2);
});
test('late duplicate source evidence does not notify the same fact twice', async () => {
  let second = false;
  const f = await fixture({ hooks: { collect: async () => ({ evidence: [evidence(), ...(second ? [evidence({ id: 'drive:2', source: 'drive', text: 'A document repeats the same access policy.' })] : [])], coverage: [{ source: 'gmail', status: 'ok', count: 1 }, { source: 'drive', status: 'ok', count: second ? 1 : 0 }] }), summarize: async () => ({ items: [candidate({ evidenceIds: second ? ['mail:1', 'drive:2'] : ['mail:1'] })] }) } });
  const selected = { sources: ['gmail', 'drive'], projects: [] }; await f.service.act(owner, intent('run_now', selected)); second = true; await f.service.act(owner, intent('run_now', { ...selected, requestId: 'duplicate-source' })); assert.equal(f.sends.length, 1);
});
test('feedback replay and status cannot expose old scope after rebind', async () => {
  const f = await fixture(); await f.service.act(owner, intent('run_now', scope)); const feedback = intent('feedback', { itemId: f.stored().items[0].id, feedback: 'handled' }); await f.service.act(owner, feedback); f.rebind();
  await assert.rejects(f.service.act(owner, feedback), /绑定/); await assert.rejects(f.service.act(owner, { action: 'status' }), /绑定/);
});
test('status remains readable while assistant is paused, without reading sources', async () => {
  const f = await fixture(); await f.service.act(owner, intent('configure', { ...scope, schedule: { dailyTime: '09:00', timeZone: 'UTC' } })); f.disable();
  const result = await f.service.act(owner, { action: 'status' }); assert.equal(result.schedule.dailyTime, '09:00'); assert.equal(f.reads.length, 0);
});
test('long request ids remain bounded and a pruned job request cannot be replayed', async () => {
  const f = await fixture(); const requestId = 'x'.repeat(240); await f.service.act(owner, intent('run_now', { ...scope, requestId }));
  const stored = f.stored(); stored.jobs = []; const reboot = await fixture({ persisted: stored }); const result = await reboot.service.act(owner, intent('run_now', { ...scope, requestId })); assert.equal(result.duplicate, true); assert.equal(reboot.reads.length, 0); assert.equal(reboot.sends.length, 0);
});
test('derived relative deadlines are explicitly estimated, and changed source deadlines notify once', async () => {
  let dueAt = '2026-11-01T10:00:00.000Z';
  const f = await fixture({ hooks: { collect: async () => ({ evidence: [evidence({ dueAt, dueAtBasis: 'relative' })], coverage: [{ source: 'gmail', status: 'ok', count: 1 }] }), summarize: async () => ({ items: [candidate({ dueAt, confidence: 'source' })] }) } });
  const first = await f.service.act(owner, intent('run_now', scope)); assert.equal(first.items[0].confidence, 'inferred'); assert.match(first.text, /估算期限.*核对原文/);
  dueAt = '2026-11-02T10:00:00.000Z'; await f.service.act(owner, intent('run_now', { ...scope, requestId: 'deadline-change' })); assert.equal(f.sends.length, 2); await f.service.act(owner, intent('run_now', { ...scope, requestId: 'deadline-repeat' })); assert.equal(f.sends.length, 2);
});
test('one-off scope does not misrepresent a saved subscription, and feedback checks its own item scope', async () => {
  const authorizations = [];
  const f = await fixture({ hooks: { authorization: async (_caller, sources) => { authorizations.push([...sources]); return grant; }, collect: async ({ sources }) => ({ evidence: [evidence({ id: `${sources[0]}:1`, source: sources[0], ...(sources[0] === 'calendar' ? { dueAt: undefined, text: 'Synthetic meeting scheduled.', eventStartAt: '2026-10-29T10:00:00.000Z', eventEndAt: '2026-10-29T11:00:00.000Z' } : {}) })], coverage: [{ source: sources[0], status: 'ok', count: 1 }] }), summarize: async ({ evidence: rows }) => ({ items: [candidate({ key: rows[0].source, title: `${rows[0].source} 待处理`, evidenceIds: [rows[0].id], ...(rows[0].source === 'calendar' ? { kind: 'event', dueAt: undefined, eventStartAt: rows[0].eventStartAt, eventEndAt: rows[0].eventEndAt, summary: '已安排一次会议。', why: '会议即将开始。', action: '查看会议详情。', unknown: '准备状态未知。' } : {}) })] }) } });
  await f.service.act(owner, intent('configure', { ...scope, schedule: { dailyTime: '09:00', timeZone: 'UTC' } }));
  const daily = await f.service.act(owner, intent('run_now')); const manual = await f.service.act(owner, intent('run_now', { sources: ['calendar'], projects: [], requestId: 'calendar-only' }));
  const status = await f.service.snapshot(owner); assert.deepEqual(status.sources, ['gmail']); assert.deepEqual(status.items.map(i => i.id), [daily.items[0].id]);
  await f.service.act(owner, intent('feedback', { itemId: daily.items[0].id, feedback: 'handled', requestId: 'feedback-gmail' })); assert.deepEqual(authorizations.at(-1), ['gmail']);
  await f.service.act(owner, intent('feedback', { itemId: manual.items[0].id, feedback: 'handled', requestId: 'feedback-calendar' })); assert.deepEqual(authorizations.at(-1), ['calendar']);
});
test('collector content digest avoids false updates when budget changes the same evidence excerpt', async () => {
  let text='Full original source facts.',contentDigest='d'.repeat(64);
  const f=await fixture({hooks:{collect:async()=>({evidence:[evidence({text,contentDigest})],coverage:[{source:'gmail',status:'partial',count:1,truncated:true}]})}});
  await f.service.act(owner,intent('run_now',scope));text='Full original';await f.service.act(owner,intent('run_now',{...scope,requestId:'shorter'}));assert.equal(f.sends.length,1);
  contentDigest='e'.repeat(64);await f.service.act(owner,intent('run_now',{...scope,requestId:'new-facts'}));assert.equal(f.sends.length,2);assert.equal('contentDigest' in f.stored().items[0].evidence[0],false);
});
test('preview persists actionable last-view items but never creates a schedule or delivery',async()=>{
 const f=await fixture();const preview=await f.service.act(owner,{action:'preview',...scope});
 assert.equal(f.stored()?.lastView?.itemIds[0],preview.items[0].id);assert.equal(f.stored().subscription,null);assert.equal(f.sends.length,0);
 await f.service.act(owner,intent('feedback',{itemNumber:1,feedback:'handled',confirmedViewToken:preview.viewToken}));assert.equal(f.stored().items[0].status,'handled');
 const reboot=await fixture({persisted:f.stored()});await reboot.service.ready();assert.equal((await reboot.service.snapshot(owner)).items[0].status,'handled');
});
test('ordinal feedback rejects stale, rebound, ambiguous and wrong-owner views',async()=>{
 for(const mode of ['stale','rebound','ambiguous','owner']){const f=await fixture();await f.service.act(owner,{action:'preview',...scope});
 if(mode==='stale')f.time('2026-10-30T10:00:00.000Z');if(mode==='rebound')f.rebind();
 await assert.rejects(f.service.act(mode==='owner'?{...owner,sessionId:'other'}:owner,intent('feedback',{itemNumber:1,feedback:'handled',...(mode==='ambiguous'?{itemId:'another'}:{})})));assert.equal(f.stored().items[0].status,'open');}
});
test('daytime attention uses existing scope, skips morning overlap, persists budget and dedupes',async()=>{
 const f=await fixture();await f.service.act(owner,intent('configure',{...scope,schedule:{dailyTime:'09:00',timeZone:'UTC'}}));
 await f.service.act(owner,intent('attention',{enabled:true}));assert.equal(f.reads.length,0);assert.equal((await f.service.snapshot(owner)).attention.enabled,true);
 await f.service.tick();assert.equal(f.sends.length,1);f.time('2026-10-29T11:00:00.000Z');await f.service.tick();assert.equal(f.sends.length,1);assert.equal(f.stored().jobs.at(-1).kind,'attention');
 const reboot=await fixture({persisted:f.stored()});reboot.time('2026-10-29T11:01:00.000Z');await reboot.service.tick();assert.equal(reboot.reads.length,0);assert.equal(reboot.sends.length,0);
 await f.service.act(owner,intent('attention',{enabled:false,requestId:'off'}));assert.equal(f.stored().subscription.schedule.dailyTime,'09:00');assert.equal((await f.service.snapshot(owner)).attention.enabled,false);
});
test('attention never expands scope, requires existing explicit schedule and conserves private permissions',async()=>{
 const f=await fixture();await assert.rejects(f.service.act(owner,intent('attention',{enabled:true})));
 await f.service.act(owner,intent('configure',{...scope,schedule:{dailyTime:'09:00',timeZone:'UTC'}}));
 await assert.rejects(f.service.act(owner,intent('attention',{enabled:true,sources:['drive']})));assert.equal(f.reads.length,0);
 f.revoke();await assert.rejects(f.service.act(owner,intent('attention',{enabled:true})));assert.equal(f.stored().subscription.attention,undefined);
});
test('coincident daily and weekly sends only weekly and claims both occurrences before side effects',async()=>{
 const f=await fixture();await f.service.act(owner,intent('configure',{...scope,schedule:{dailyTime:'09:00',weeklyDay:4,weeklyTime:'09:00',timeZone:'UTC'}}));
 await f.service.tick();assert.equal(f.sends.length,1);assert.equal(f.stored().jobs[0].kind,'weekly');assert.ok(f.stored().occurrences.includes('daily:2026-10-29'));assert.ok(f.stored().occurrences.includes('weekly:2026-10-29'));
});

test('unconfirmed or mismatched preview never resolves an ordinal feedback',async()=>{const f=await fixture();const p=await f.service.act(owner,{action:'preview',...scope});for(const token of [undefined,'old_view'])await assert.rejects(f.service.act(owner,intent('feedback',{itemNumber:1,feedback:'handled',confirmedViewToken:token})));assert.equal(f.stored().items[0].status,'open');assert.ok(p.viewToken);});
test('exact-title feedback modifies only the unique same-scope item and rejects ambiguity',async()=>{
 const f=await fixture();await f.service.act(owner,{action:'preview',...scope});
 await assert.rejects(f.service.act(owner,intent('feedback',{itemTitle:'访问政策',feedback:'handled'})));
 await f.service.act(owner,intent('feedback',{requestId:'title-feedback',itemTitle:'访问政策即将变化',feedback:'handled'}));assert.equal(f.stored().items[0].status,'handled');
 f.rebind();await assert.rejects(f.service.act(owner,intent('feedback',{requestId:'title-rebind',itemTitle:'访问政策即将变化',feedback:'dismissed'})));assert.equal(f.stored().items[0].status,'handled');
 const ambiguous=await fixture({hooks:{summarize:async()=>({items:[candidate(),candidate({key:'second',kind:'change'})]})}});await ambiguous.service.act(owner,{action:'preview',...scope});assert.equal(ambiguous.stored().items.length,2);
 await assert.rejects(ambiguous.service.act(owner,intent('feedback',{itemTitle:'访问政策即将变化',feedback:'handled'})));assert.ok(ambiguous.stored().items.every(i=>i.status==='open'));
});
test('attention message budget survives short job history pruning and uncertain delivery',async()=>{
 const f=await fixture();await f.service.act(owner,intent('configure',{...scope,schedule:{dailyTime:'08:00',timeZone:'UTC'}}));await f.service.act(owner,intent('attention',{enabled:true}));
 const stored=structuredClone(f.stored());stored.jobs=[];stored.attentionClaims=[{id:'claim-one',at:'2026-10-29T09:01:00.000Z',timeZone:'UTC',status:'uncertain'},{id:'claim-two',at:'2026-10-29T11:01:00.000Z',timeZone:'UTC',status:'queued'}];
 const restart=await fixture({persisted:stored});restart.time('2026-10-29T13:00:00.000Z');await restart.service.tick();assert.equal(restart.sends.length,0);assert.equal(restart.reads.length,0);assert.equal((await restart.service.snapshot(owner)).attention.remaining,0);
});
test('enabling attention after a daytime slot never catches up that slot or reads immediately',async()=>{
 const f=await fixture();await f.service.act(owner,intent('configure',{...scope,schedule:{dailyTime:'08:00',timeZone:'UTC'}}));f.time('2026-10-29T11:10:00.000Z');await f.service.act(owner,intent('attention',{enabled:true}));await f.service.tick();assert.equal(f.reads.length,0);assert.equal(f.sends.length,0);
});
test('failed preview cannot replace feedback mapping, and confirmed old tokens cannot affect a new preview',async()=>{
 let failing=false;const f=await fixture({hooks:{summarize:async()=>{if(failing)throw new Error('model failure');return{items:[candidate()]};}}});
 const original=await f.service.act(owner,{action:'preview',...scope});failing=true;await assert.rejects(f.service.act(owner,{action:'preview',...scope}));assert.equal(f.stored().lastView.viewToken,original.viewToken);
 failing=false;const latest=await f.service.act(owner,{action:'preview',...scope});assert.notEqual(latest.viewToken,original.viewToken);await assert.rejects(f.service.act(owner,intent('feedback',{itemNumber:1,feedback:'handled',confirmedViewToken:original.viewToken})));assert.equal(f.stored().items[0].status,'open');
});
test('attention last-moment local authority rejection leaves the saved subscription unchanged',async()=>{
 const f=await fixture();await f.service.act(owner,intent('configure',{...scope,schedule:{dailyTime:'09:00',timeZone:'UTC'}}));const before=structuredClone(f.stored());let calls=0;
 await assert.rejects(f.service.act(owner,intent('attention',{enabled:true,authorizeSync:()=>++calls<4})));assert.deepEqual(f.stored(),before);assert.equal(f.reads.length,0);assert.equal(f.sends.length,0);
});
