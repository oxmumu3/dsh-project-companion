import test from 'node:test';
import assert from 'node:assert/strict';

test('saved cadence, active work, accepted delivery and uncertain results remain separate',async()=>{
 const {reviewRuntimeHealth}=await import('../src/review-runtime-health.js');
 const now=new Date('2026-10-31T15:05:00.000Z'),subscription={paused:false,createdAt:'2026-10-31T14:00:00.000Z'};
 const health=(status,createdAt='2026-10-31T15:04:00.000Z')=>reviewRuntimeHealth({subscription,jobs:status?[{kind:'daily',status,createdAt}]:[],now});
 assert.equal(health().state,'waiting');assert.equal(health('generating').state,'running');
 assert.equal(health('generating','2026-10-31T15:00:00.000Z').state,'stalled');
 assert.equal(health('reported_sent').state,'channel_accepted');assert.equal(health('queued').state,'channel_accepted');
 assert.equal(health('uncertain').state,'uncertain');assert.equal(health('dispatching').retryAllowed,false);
 assert.equal(health('failed').state,'failed');assert.equal(health('unknown').state,'unknown');
 for(const status of ['reported_sent','queued','uncertain','failed'])assert.equal(health(status).phoneReceipt,'unverified');
 assert.equal(reviewRuntimeHealth({subscription:{...subscription,paused:true},jobs:[],now}).state,'paused');
 assert.equal(reviewRuntimeHealth({subscription:null,jobs:[],now}).state,'off');
});
test('an old or future record cannot report that the current subscription ran',async()=>{
 const {reviewRuntimeHealth}=await import('../src/review-runtime-health.js');
 for(const createdAt of ['2026-10-30T15:00:00.000Z','2026-11-01T15:00:00.000Z']){
  const value=reviewRuntimeHealth({subscription:{paused:false,createdAt:'2026-10-31T14:00:00.000Z'},jobs:[{status:'reported_sent',kind:'daily',createdAt}],now:new Date('2026-10-31T15:05:00.000Z')});
  assert.equal(value.state,'waiting');assert.equal(value.at,null);assert.doesNotMatch(value.label,/已收到|没有变化/);
 }
});
