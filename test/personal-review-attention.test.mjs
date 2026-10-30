import test from 'node:test';
import assert from 'node:assert/strict';
import {attentionDue,attentionStatus,selectAttentionItems} from '../src/personal-review-attention.js';

const attention={enabled:true,intervalMinutes:120,startHour:9,endHour:19,maxMessagesPerDay:2};
const scopeKey='a'.repeat(64),base={attention,timeZone:'America/Mexico_City',createdAt:'2026-10-29T00:00:00.000Z',occurrences:[],dailyTime:'09:00'};
const item=(v={})=>({id:'review-1',scopeKey,kind:'risk',priority:'high',status:'open',revision:1,notifiedRevision:0,lastNotifiedAt:null,notifications:[],evidence:[{source:'gmail',id:'e1'}],...v});

test('runs during local work hours, skipping a slot coincident with the existing daily brief',()=>{
 const first=attentionDue({...base,now:new Date('2026-10-30T15:00:00Z')});assert.equal(first.status,'not_due');assert.equal(first.nextRun,'2026-10-30T17:00:00.000Z');
 const due=attentionDue({...base,now:new Date('2026-10-30T17:04:00Z')});assert.equal(due.status,'due');assert.equal(due.occurrence.id,'attention:2026-10-30:11:00');assert.equal(due.nextRun,'2026-10-30T19:00:00.000Z');
});
test('a weekly brief also takes precedence over an exactly coincident slot',()=>{
 const t=attentionDue({...base,dailyTime:undefined,weeklyTime:'11:00',weeklyDay:1,now:new Date('2026-11-02T17:00:00Z')});assert.equal(t.status,'not_due');assert.equal(t.nextRun,'2026-11-02T19:00:00.000Z');
});
test('does not replay expired, handled or pre-creation occurrences',()=>{
 assert.equal(attentionDue({...base,now:new Date('2026-10-30T17:15:00Z')}).status,'due');
 assert.equal(attentionDue({...base,now:new Date('2026-10-30T17:15:00.001Z')}).status,'expired');
 assert.equal(attentionDue({...base,now:new Date('2026-10-30T17:16:00Z')}).status,'expired');
 assert.equal(attentionDue({...base,now:new Date('2026-10-30T17:04:00Z'),occurrences:['attention:2026-10-30:11:00']}).status,'not_due');
 assert.equal(attentionDue({...base,createdAt:'2026-10-30T17:01:00Z',now:new Date('2026-10-30T17:04:00Z')}).status,'not_due');
});
test('a suppressed occurrence is never regenerated when another tick runs in its window',()=>{
 const now=new Date('2026-10-30T17:07:00Z'),first=attentionDue({...base,now});assert.equal(first.status,'due');
 assert.equal(attentionDue({...base,now,occurrences:[first.occurrence.id]}).status,'not_due');
});
test('work hours use the selected time zone across DST transitions',()=>{
 const winter=attentionDue({...base,timeZone:'America/New_York',now:new Date('2026-11-02T16:00:00Z')});assert.equal(winter.status,'due');assert.equal(winter.occurrence.id,'attention:2026-11-02:11:00');
 const summer=attentionDue({...base,timeZone:'America/New_York',now:new Date('2026-10-30T15:00:00Z')});assert.equal(summer.status,'due');assert.equal(summer.occurrence.id,'attention:2026-10-30:11:00');
});
test('DST gap is skipped and the repeated local hour is never scheduled twice',()=>{
 const custom={...attention,startHour:1,endHour:4,intervalMinutes:60},opt={...base,timeZone:'America/New_York',attention:custom,dailyTime:undefined,createdAt:'2026-01-01T00:00:00Z'};
 const spring=attentionDue({...opt,now:new Date('2026-03-08T06:30:00Z')});assert.equal(spring.nextRun,'2026-03-08T07:00:00.000Z');
 const fall=attentionDue({...opt,now:new Date('2026-11-01T06:05:00Z')});assert.equal(fall.status,'expired');assert.equal(fall.nextRun,'2026-11-01T07:00:00.000Z');
});
test('time outside working hours and a disabled policy never creates an occurrence',()=>{
 const quiet=attentionDue({...base,now:new Date('2026-10-31T02:00:00Z')});assert.equal(quiet.quiet,true);assert.equal(quiet.occurrence,null);assert.equal(quiet.nextRun,'2026-10-31T17:00:00.000Z');
 assert.equal(attentionDue({...base,attention:{...attention,enabled:false},now:new Date('2026-10-30T17:00:00Z')}).status,'disabled');
});
test('only fresh high-risk or source-backed imminent deadlines are eligible, at most two',()=>{
 const now='2026-10-30T17:00:00Z',items=[item(),item({id:'meeting',kind:'invitation',dueAt:'2026-10-30T18:00:00Z',dueAtBasis:'source'}),item({id:'deadline',kind:'deadline',priority:'normal',dueAt:'2026-10-30T18:00:00Z',dueAtBasis:'source'}),item({id:'inferred',kind:'deadline',dueAt:'2026-10-30T18:00:00Z',dueAtBasis:'relative'}),item({id:'stale',notifiedRevision:1,lastNotifiedAt:'2026-10-30T16:00:00Z'})];
 const out=selectAttentionItems(items,{now,scopeKey,coverage:[{source:'gmail',status:'ok'}],remaining:2});assert.equal(out.status,'selected');assert.deepEqual(out.selected.map(x=>x.item.id),['deadline','review-1']);
});
test('handled, snoozed, dismissed and duplicate facts stay silent',()=>{
 const now='2026-10-30T17:00:00Z',items=[item({status:'handled'}),item({id:'s',status:'snoozed',snoozeUntil:'2026-10-30T18:00:00Z'}),item({id:'d',status:'dismissed'}),item({id:'n',notifications:['new']})];
 assert.equal(selectAttentionItems(items,{now,scopeKey,coverage:[{source:'gmail',status:'ok'}],remaining:2}).status,'quiet');
});
test('unknown source coverage is not mislabeled as no change, and daily message budget stops selection',()=>{
 const now='2026-10-30T17:00:00Z';assert.equal(selectAttentionItems([item()],{now,scopeKey,coverage:[{source:'gmail',status:'failed'}],remaining:2}).status,'unknown');
 assert.equal(selectAttentionItems([item()],{now,scopeKey,coverage:[{source:'gmail',status:'ok'}],remaining:0}).status,'budget_exhausted');
 const status=attentionStatus({...base,now:new Date(now),usedMessages:2});assert.equal(status.remaining,0);assert.equal(status.enabled,true);
});
test('partial source coverage cannot prove that there is no change',()=>{
 const result=selectAttentionItems([],{now:'2026-10-30T17:00:00Z',scopeKey,coverage:[{source:'gmail',status:'partial'}],remaining:2});assert.equal(result.status,'unknown');
});
