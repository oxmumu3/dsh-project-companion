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

test('model failure keeps only safe code and stage after collection', async () => {
 const f=await fixture({hooks:{summarize:async()=>{throw Object.assign(new Error('PRIVATE_CANARY actual provider body'),{code:'MODEL_INVALID_OUTPUT',modelDiagnostic:{textChars:123,reasoningChars:90,finish:'stop',secret:'PRIVATE_CANARY'}});}}});
 await assert.rejects(f.service.act(owner,{action:'preview',...scope}),error=>{assert.equal(error.code,'MODEL_INVALID_OUTPUT');assert.equal(error.reviewDiagnostic.stage,'model');assert.equal(error.reviewDiagnostic.evidenceCount,1);assert.equal(error.reviewDiagnostic.sourceCount,1);assert.equal(error.reviewDiagnostic.model.textChars,123);assert.doesNotMatch(JSON.stringify(error),/PRIVATE_CANARY|actual provider body|secret/);return true;});
 assert.equal(f.sends.length,0);assert.equal(f.writes(),0);
});
test('unrecognized collector failure is fixed collection diagnostic, never raw provider details',async()=>{
 const f=await fixture({hooks:{collect:async()=>{throw Object.assign(new Error('PRIVATE_CANARY'),{code:'access-token-PRIVATE_CANARY'});}}});
 await assert.rejects(f.service.act(owner,{action:'preview',...scope}),error=>{assert.equal(error.code,'REVIEW_COLLECTION_FAILED');assert.equal(error.reviewDiagnostic.stage,'collection');assert.doesNotMatch(JSON.stringify(error),/PRIVATE_CANARY/);return true;});
});
test('actual authorization change remains authorization failure even during model stage',async()=>{
 let f;f=await fixture({hooks:{summarize:async input=>{f.revoke();await input.guard();}}});
 await assert.rejects(f.service.act(owner,{action:'preview',...scope}),error=>{assert.equal(error.code,'REVIEW_AUTHORIZATION_CHANGED');assert.equal(error.reviewDiagnostic.stage,'authorization');return true;});
});

test('configured is not generated: failed scheduled model has durable safe diagnostics and no delivery',async()=>{
 const f=await fixture({hooks:{summarize:async()=>{throw Object.assign(new Error('PRIVATE_CANARY'),{code:'MODEL_TOKEN_LIMIT',modelDiagnostic:{textChars:0,reasoningChars:6000,outputTokens:6500,finish:'max-tokens'}});}}});
 await f.service.act(owner,intent('configure',{...scope,schedule:{dailyTime:'09:00',timeZone:'UTC'}}));
 assert.equal((await f.service.snapshot(owner)).lastGeneration,null);
 assert.deepEqual(await f.service.tick(),[]);
 const status=await f.service.snapshot(owner);
 assert.equal(status.status,'enabled');
 assert.equal(status.jobs[0].status,'failed');
 assert.equal(status.jobs[0].diagnostic.code,'MODEL_TOKEN_LIMIT');
 assert.equal(status.jobs[0].diagnostic.stage,'model');
 assert.equal(status.jobs[0].diagnostic.evidenceCount,1);
 assert.equal(status.lastGeneration.status,'failed');
 assert.equal(status.lastGeneration.persisted,false);
 assert.equal(f.stored().jobs[0].diagnostic.model.textChars,0);
 assert.equal('lastGeneration' in f.stored(),false);
 assert.doesNotMatch(JSON.stringify(f.stored()),/PRIVATE_CANARY/);
 assert.equal(f.sends.length,0);
 const restored=await fixture({persisted:f.stored()});
 assert.equal((await restored.service.snapshot(owner)).jobs[0].diagnostic.code,'MODEL_TOKEN_LIMIT');
 await f.service.close();await restored.service.close();
});

test('preview diagnostics are transient while last successful generation is distinguishable',async()=>{
 let calls=0;const f=await fixture({hooks:{summarize:async()=>{if(++calls===1)throw Object.assign(new Error('PRIVATE_CANARY'),{code:'MODEL_INVALID_OUTPUT'});return{items:[candidate()]};}}});
 await f.service.act(owner,intent('configure',{...scope,schedule:{dailyTime:'09:00',timeZone:'UTC'}}));
 const before=structuredClone(f.stored());
 await assert.rejects(f.service.act(owner,{action:'preview',...scope}),{code:'MODEL_INVALID_OUTPUT'});
 assert.equal((await f.service.snapshot(owner)).lastGeneration.status,'failed');
 const result=await f.service.act(owner,{action:'preview',...scope});
 assert.equal(result.status,'preview');
 const status=await f.service.snapshot(owner);
 assert.equal(status.lastGeneration.status,'completed');
 assert.equal(status.lastGeneration.diagnostic,undefined);
 assert.deepEqual(f.stored().subscription,before.subscription);assert.deepEqual(f.stored().jobs,before.jobs);assert.deepEqual(f.stored().watermarks,before.watermarks);assert.equal(f.stored().items.length,1);assert.ok(f.stored().lastView.viewToken);assert.equal(f.stored().lastGeneration,undefined);
 assert.equal(f.sends.length,0);
 await f.service.close();
});

test('overall execution deadline remains a timeout, not user cancellation, in safe journal',async()=>{
 const timeout=AbortSignal.timeout;
 const keepAlive=setTimeout(()=>{},1000);
 AbortSignal.timeout=()=>timeout(10);
 const f=await fixture({hooks:{collect:async()=>new Promise(()=>{})}});
 try {
  await assert.rejects(f.service.act(owner,intent('run_now',scope)),error=>{assert.equal(error.code,'REVIEW_TIMEOUT');assert.equal(error.reviewDiagnostic.stage,'collection');return true;});
  assert.equal(f.stored().jobs[0].status,'failed');
  assert.equal(f.stored().jobs[0].diagnostic.code,'REVIEW_TIMEOUT');
  assert.equal(f.sends.length,0);
 }finally{AbortSignal.timeout=timeout;clearTimeout(keepAlive);await f.service.close();}
});

test('scheduled model failure persists only allowlisted SDK finish metadata across restart',async()=>{
 const f=await fixture({hooks:{summarize:async()=>{throw Object.assign(new Error('PRIVATE_CANARY'),{code:'MODEL_INCOMPLETE',modelDiagnostic:{finish:'other',finishDetail:'error',failureCode:'RATE_LIMIT',privateMessage:'PRIVATE_CANARY'}});}}});
 await f.service.act(owner,intent('configure',{...scope,schedule:{dailyTime:'09:00',timeZone:'UTC'}}));await f.service.tick();const first=f.stored().jobs[0];assert.equal(first.diagnostic.model.finishDetail,'error');assert.equal(first.diagnostic.model.failureCode,'RATE_LIMIT');assert.doesNotMatch(JSON.stringify(first),/PRIVATE_CANARY/);assert.equal(f.sends.length,0);
 const restored=await fixture({persisted:f.stored()});const status=await restored.service.snapshot(owner);assert.equal(status.jobs[0].diagnostic.model.failureCode,'RATE_LIMIT');await f.service.close();await restored.service.close();
});
