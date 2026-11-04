import test from 'node:test';
import assert from 'node:assert/strict';
import * as attention from '../src/personal-review-attention.js';

const scopeKey='a'.repeat(64);
const policy={enabled:true,intervalMinutes:120,startHour:9,endHour:19,maxMessagesPerDay:2};
const highRisk=(overrides={})=>({id:'synthetic-item',scopeKey,kind:'risk',priority:'high',status:'open',revision:1,notifiedRevision:0,lastNotifiedAt:null,notifications:[],evidence:[{source:'gmail',id:'synthetic-evidence'}],...overrides});

test('a completed partial check explains no actionable items without claiming global no change',()=>{
 const output=attention.selectAttentionItems([highRisk({title:'PRIVATE_CANARY_TITLE',kind:'reply',priority:'normal'})],{now:'2026-10-31T17:00:00Z',scopeKey,coverage:[{source:'gmail',status:'partial',count:10,truncated:true},{source:'calendar',status:'ok',count:0}],remaining:2});
 assert.equal(output.status,'unknown');assert.deepEqual(output.selected,[]);
 assert.ok(output.decision,'persistable closed decision metadata must be available');
 assert.equal(output.decision.outcome,'no_actionable_in_covered_scope');
 assert.equal(output.decision.observedItems,1);assert.equal(output.decision.evaluatedItems,1);
 assert.equal(output.decision.reasonCounts.not_urgent,1);
 assert.deepEqual(output.decision.coverage,[{source:'gmail',status:'partial',count:10,truncated:true},{source:'calendar',status:'ok',count:0,truncated:false}]);
 assert.doesNotMatch(JSON.stringify(output.decision),/PRIVATE_CANARY|synthetic-item|synthetic-evidence|[a-f0-9]{64}/);
});

test('a real risk remains eligible even when another source is unavailable',()=>{
 const output=attention.selectAttentionItems([highRisk()],{now:'2026-10-31T17:00:00Z',scopeKey,coverage:[{source:'gmail',status:'ok',count:1},{source:'flomo',status:'unavailable',count:null}],remaining:2});
 assert.equal(output.status,'selected');assert.equal(output.selected.length,1);
 assert.ok(output.decision);assert.equal(output.decision.outcome,'selected');assert.equal(output.decision.selectedItems,1);
});

test('unavailable sources and exhausted budget are distinct decisions and never manufacture delivery',()=>{
 for(const [coverage,remaining,status,outcome]of[[[{source:'gmail',status:'unavailable',count:null}],2,'unknown','sources_unavailable'],[[{source:'gmail',status:'ok',count:1}],0,'budget_exhausted','budget_exhausted']]){
  const output=attention.selectAttentionItems([highRisk()],{now:'2026-10-31T17:00:00Z',scopeKey,coverage,remaining});assert.equal(output.status,status);assert.deepEqual(output.selected,[]);assert.ok(output.decision);assert.equal(output.decision.outcome,outcome);
 }
});

test('the last work-hours check covers verified deadlines before the next scheduled morning check',()=>{
 assert.equal(typeof attention.attentionDeadlineThrough,'function','a bounded next-check horizon is required');
 const now='2026-10-31T23:00:00Z'; // 17:00 Mexico; 19:00 is the quiet-hours boundary.
 const through=attention.attentionDeadlineThrough({now:new Date(now),timeZone:'America/Mexico_City',attention:policy,createdAt:'2026-10-30T20:59:00Z',dailyTime:'09:00',weeklyDay:1,weeklyTime:'09:00'});
 assert.equal(through,'2026-11-01T15:00:00.000Z');
 const item=highRisk({kind:'deadline',priority:'normal',dueAt:'2026-11-01T02:00:00.000Z',dueAtBasis:'source'});
 const prior=attention.selectAttentionItems([item],{now,scopeKey,coverage:[{source:'gmail',status:'ok',count:1}],remaining:2});assert.equal(prior.selected.length,0,'the original fixed two-hour horizon misses the quiet-hours deadline');
 const fixed=attention.selectAttentionItems([item],{now,scopeKey,coverage:[{source:'gmail',status:'ok',count:1}],remaining:2,deadlineThrough:through});assert.equal(fixed.selected.length,1);
 assert.equal(attention.selectAttentionItems([highRisk({...item,dueAtBasis:'relative'})],{now,scopeKey,coverage:[{source:'gmail',status:'ok',count:1}],remaining:2,deadlineThrough:through}).selected.length,0,'estimated dates remain estimated, not proven deadlines');
});

test('normal daytime horizon stays at the next check and a supplied horizon cannot exceed one day',()=>{
 assert.equal(typeof attention.attentionDeadlineThrough,'function');
 const now='2026-10-31T17:00:00Z';
 assert.equal(attention.attentionDeadlineThrough({now:new Date(now),timeZone:'America/Mexico_City',attention:policy,createdAt:'2026-10-30T20:59:00Z',dailyTime:'09:00'}),'2026-10-31T19:00:00.000Z');
 for(const deadlineThrough of ['2026-11-03T19:00:00Z','2026-10-31T16:00:00Z','not-a-date'])assert.throws(()=>attention.selectAttentionItems([],{now,scopeKey,coverage:[{source:'gmail',status:'ok',count:0}],remaining:2,deadlineThrough}));
});

test('a rescheduled but already claimed regular occurrence is not the next actual check',()=>{
 const through=attention.attentionDeadlineThrough({now:'2026-10-31T23:00:00Z',timeZone:'America/Mexico_City',attention:policy,createdAt:'2026-10-31T22:00:00Z',dailyTime:'20:00',occurrences:['daily:2026-10-31']});
 assert.equal(through,'2026-11-01T15:00:00.000Z');
 const result=attention.selectAttentionItems([highRisk({kind:'deadline',priority:'normal',dueAt:'2026-11-01T05:00:00.000Z',dueAtBasis:'source'})],{now:'2026-10-31T23:00:00Z',scopeKey,coverage:[{source:'gmail',status:'ok',count:1}],remaining:2,deadlineThrough:through});assert.equal(result.selected.length,1);
});

test('unknown coverage count is preserved rather than presented as zero',()=>{
 const result=attention.selectAttentionItems([],{now:'2026-10-31T17:00:00Z',scopeKey,coverage:[{source:'gmail',status:'partial',count:null}],remaining:2});assert.equal(result.decision.coverage[0].count,null);
 const aggregate=attention.selectAttentionItems([],{now:'2026-10-31T17:00:00Z',scopeKey,coverage:[{source:'project',status:'ok',count:2},{source:'project',status:'unavailable',count:null}],remaining:2});assert.equal(aggregate.decision.coverage[0].count,null);
});
