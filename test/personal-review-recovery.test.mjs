import test from 'node:test';
import assert from 'node:assert/strict';
import {createPersonalReviewService} from '../src/personal-review.js';
import {recoveryCheck,recoveryWindow} from '../src/personal-review-recovery.js';

const caller={sessionId:'synthetic-owner',cwd:'/synthetic/recovery'},binding='a'.repeat(64),grant='b'.repeat(64);
const intent=(action,extra={})=>({action,requestId:`request-${action}`,userRequested:true,...extra});
async function fixture({persisted,time='2026-10-30T10:40:00.000Z',delivery='reported_sent',modelHook}={}){
 let row=structuredClone(persisted),at=new Date(time),activeGrant=grant,activeBinding=binding,availability='current',enabled=true,round=0;
 const reads=[],models=[],sends=[];
 const service=createPersonalReviewService({store:{get:async()=>structuredClone(row),put:async(_,value)=>{row=structuredClone(value);}},clock:()=>at,
  authorization:async()=>activeGrant,readBinding:async()=>({bound:true,bindingKey:activeBinding}),canRun:async()=>enabled,
  readAvailability:async()=>availability,
  collect:async input=>{reads.push(input);return{evidence:[{id:'risk:1',source:'gmail',title:'Synthetic service risk',text:`Service disruption notice ${round}`,at:at.toISOString()}],coverage:[{source:'gmail',status:'ok',count:1}]};},
  summarize:async input=>{models.push(input);await modelHook?.(input);return{items:[{key:'risk',kind:'risk',title:'测试服务风险',summary:`服务变更需要核对 ${round}`,why:'新变化可能影响服务',action:'查看原始通知',unknown:'影响尚未证实',evidenceIds:['risk:1'],priority:'high',confidence:'source'}]};},
  send:async input=>{sends.push(input);assert.equal(await input.authorizeAsync(),true);return{status:delivery};}
 });
 const f={service,reads,models,sends,row:()=>structuredClone(row),time:value=>{at=new Date(value);},offline:()=>{availability='offline';},online:()=>{availability='current';},unknown:()=>{availability='unknown';},changed:()=>{availability='changed';},revoke:()=>{activeGrant='c'.repeat(64);},rebind:()=>{activeBinding='d'.repeat(64);},disable:()=>{enabled=false;},change:()=>{round++;}};
 await service.ready();return f;
}
async function subscribed(f){await f.service.act(caller,intent('configure',{sources:['gmail'],projects:[],schedule:{dailyTime:'09:00',timeZone:'UTC'}}));await f.service.act(caller,intent('attention',{enabled:true}));await f.service.tick();}

test('sleep before 11 and wake at 12 runs one fresh bounded attention check, not the stale slot',async()=>{
 const f=await fixture();await subscribed(f);f.time('2026-10-30T10:50:00Z');await f.service.tick();f.time('2026-10-30T12:00:00Z');const output=await f.service.tick();
 assert.equal(f.reads.length,1);assert.equal(f.models[0].kind,'daily');assert.equal(f.reads[0].kind,'daily');assert.equal(f.reads[0].to,'2026-10-30T12:00:00.000Z');assert.equal(output[0].kind,'attention');assert.equal(f.sends.length,1);
 assert.match(f.row().jobs.at(-1).occurrence,/^recovery:/);assert.ok(f.row().occurrences.includes('attention:2026-10-30:11:00'));
 await f.service.tick();assert.equal(f.reads.length,1);assert.equal(f.sends.length,1);
});
test('repeated same-day resumes and restart cannot repeat the recovery or reset its budget',async()=>{
 const f=await fixture();await subscribed(f);f.time('2026-10-30T12:00:00Z');await f.service.tick();f.change();f.time('2026-10-30T14:00:00Z');await f.service.tick();assert.equal(f.reads.length,1);
 const reboot=await fixture({persisted:f.row(),time:'2026-10-30T14:01:00Z'});await reboot.service.tick();assert.equal(reboot.reads.length,0);assert.equal(reboot.sends.length,0);assert.equal(reboot.row().attentionClaims.length,1);
});
test('disabled attention does not create a recovery scan',async()=>{
 const f=await fixture();await subscribed(f);await f.service.act(caller,intent('attention',{enabled:false,requestId:'off'}));f.time('2026-10-30T12:00:00Z');await f.service.tick();assert.equal(f.reads.length,0);
});
test('night recovery remains quiet and does not reset the next day schedule',async()=>{
 const f=await fixture();await subscribed(f);f.time('2026-10-30T20:00:00Z');await f.service.tick();assert.equal(f.reads.length,0);assert.equal(f.sends.length,0);
 f.time('2026-10-31T09:00:00Z');await f.service.tick();assert.equal(f.reads.length,1);assert.equal(f.sends.length,1);assert.equal(f.row().jobs.at(-1).kind,'daily');
});
test('pause, rebind, revoke and global pause prevent recovery reads and sends',async()=>{
 for(const mode of ['pause','rebind','revoke','disable']){const f=await fixture();await subscribed(f);if(mode==='pause')await f.service.act(caller,intent('pause'));else f[mode]();f.time('2026-10-30T12:00:00Z');await f.service.tick();assert.equal(f.reads.length,0,mode);assert.equal(f.sends.length,0,mode);}
});
test('explicit temporary offline recovers once even when scheduler ticks continued',async()=>{
 const f=await fixture();await subscribed(f);f.offline();for(const time of ['10:50','11:05','11:20','11:50']){f.time(`2026-10-30T${time}:00Z`);await f.service.tick();}assert.equal(f.reads.length,0);
 f.online();f.time('2026-10-30T12:00:00Z');await f.service.tick();assert.equal(f.reads.length,1);assert.equal(f.sends.length,1);
});
test('changed or unknown route is not treated as temporary offline',async()=>{
 for(const mode of ['changed','unknown']){const f=await fixture();await subscribed(f);f[mode]();f.time('2026-10-30T11:30:00Z');await f.service.tick();f.online();f.time('2026-10-30T12:00:00Z');await f.service.tick();assert.equal(f.reads.length,0,mode);}
});
test('an uncertain old delivery is never repeated by a fresh recovery or restart',async()=>{
 const f=await fixture({delivery:'uncertain'});await subscribed(f);f.time('2026-10-30T11:00:00Z');await f.service.tick();assert.equal(f.sends.length,1);f.time('2026-10-30T12:00:00Z');await f.service.tick();assert.equal(f.sends.length,1);
 const reboot=await fixture({persisted:f.row(),time:'2026-10-30T12:01:00Z'});await reboot.service.tick();assert.equal(reboot.sends.length,0);assert.ok(reboot.row().jobs.some(job=>job.status==='uncertain'));
});
test('recovery shares the existing two-message daily budget',async()=>{
 const f=await fixture();await subscribed(f);f.time('2026-10-30T11:00:00Z');await f.service.tick();f.change();f.time('2026-10-30T13:00:00Z');await f.service.tick();assert.equal(f.sends.length,2);f.change();f.time('2026-10-30T16:00:00Z');await f.service.tick();assert.equal(f.sends.length,2);assert.equal(f.row().attentionClaims.length,2);
});
test('over seven days offline scans at most seven days and preserves unknown coverage',async()=>{
 const f=await fixture();await subscribed(f);f.time('2026-11-09T12:00:00Z');const result=await f.service.tick();assert.equal(f.reads.length,1);assert.equal(f.reads[0].from,'2026-11-02T12:00:00.000Z');assert.equal(f.reads[0].to,'2026-11-09T12:00:00.000Z');
 assert.match(f.sends[0].text,/超过.*7.*天|超过.*七.*天/);assert.match(f.sends[0].text,/未知|未完整覆盖/);assert.equal(f.models[0].coverage[0].status,'partial');assert.equal(f.row().watermarks.gmail?.attention,undefined);assert.equal(result[0].kind,'attention');
});
test('a short ordinary restart does not invent a sleep recovery',async()=>{
 const f=await fixture();await subscribed(f);const reboot=await fixture({persisted:f.row(),time:'2026-10-30T10:42:00Z'});await reboot.service.tick();assert.equal(reboot.reads.length,0);
});
test('continuous ticks checkpoint the live observation once each five minutes, not once each tick',async()=>{
 const f=await fixture();await subscribed(f);assert.equal(f.row().recovery.observedAt,'2026-10-30T10:40:00.000Z');
 for(const minute of [41,42,43,44]){f.time(`2026-10-30T10:${minute}:00Z`);await f.service.tick();assert.equal(f.row().recovery.observedAt,'2026-10-30T10:40:00.000Z');}
 f.time('2026-10-30T10:45:00Z');await f.service.tick();assert.equal(f.row().recovery.observedAt,'2026-10-30T10:45:00.000Z');
 f.time('2026-10-30T10:46:00Z');await f.service.tick();assert.equal(f.row().recovery.observedAt,'2026-10-30T10:45:00.000Z');
});
test('a recovery decision keeps the selected local timezone and DST boundary',()=>{
 const base={key:grant,previous:{key:grant,observedAt:'2026-11-01T16:00:00.000Z',offlineSince:null,blocked:false},availability:'current',enabled:true,timeZone:'America/New_York',remaining:2};
 const out=recoveryCheck({...base,now:new Date('2026-11-01T17:00:00Z')});assert.match(out.check.id,/recovery:2026-11-01:/);assert.equal(out.check.since,base.previous.observedAt);
 assert.equal(recoveryCheck({...base,now:new Date('2026-11-02T01:00:00Z')}).check,null);
});
test('scope generation change and backward clock reset only the observation',()=>{
 const base={key:grant,previous:{key:binding,observedAt:'2026-10-30T10:00:00.000Z',offlineSince:null,blocked:false},availability:'current',enabled:true,timeZone:'UTC',remaining:2};
 assert.equal(recoveryCheck({...base,now:new Date('2026-10-30T12:00:00Z')}).check,null);
 assert.equal(recoveryCheck({...base,previous:{...base.previous,key:grant},now:new Date('2026-10-30T09:30:00Z')}).check,null);
});
test('seven days is an inclusive bound and earlier gaps retain coverage unknown',()=>{
 const to='2026-11-09T12:00:00.000Z',from='2026-11-08T12:00:00.000Z';
 assert.deepEqual(recoveryWindow({from,to,check:{since:'2026-11-02T12:00:00.000Z',coverageUnknown:false}}),{from:'2026-11-02T12:00:00.000Z',coverageUnknown:false});
 assert.deepEqual(recoveryWindow({from,to,check:{since:'2026-11-02T11:59:59.999Z',coverageUnknown:true}}),{from:'2026-11-02T12:00:00.000Z',coverageUnknown:true});
});
test('waking at a normal daily slot coalesces recovery while retaining the long-gap boundary',async()=>{
 const f=await fixture();await subscribed(f);f.time('2026-11-09T09:00:00Z');await f.service.tick();
 assert.equal(f.reads.length,1);assert.equal(f.reads[0].from,'2026-11-02T09:00:00.000Z');assert.equal(f.sends.length,1);assert.equal(f.row().jobs.at(-1).kind,'daily');assert.equal(f.models[0].coverage[0].status,'partial');assert.match(f.sends[0].text,/超过 7 天/);
});
test('a fresh scheduled slot on wake does not also replay missed weekly or daily messages',async()=>{
 const f=await fixture({time:'2026-10-29T10:40:00Z'});
 await f.service.act(caller,intent('configure',{sources:['gmail'],projects:[],schedule:{dailyTime:'12:00',weeklyDay:5,weeklyTime:'11:00',timeZone:'UTC'}}));await f.service.act(caller,intent('attention',{enabled:true}));await f.service.tick();
 f.time('2026-10-30T12:00:00Z');await f.service.tick();assert.equal(f.reads.length,1);assert.equal(f.sends.length,1);assert.equal(f.row().jobs.at(-1).kind,'daily');assert.ok(f.row().occurrences.includes('weekly:2026-10-30'));
});
test('a recovery that finishes after quiet hours begin cannot send late',async()=>{
 let f;f=await fixture({modelHook:()=>f.time('2026-10-30T19:01:00Z')});await subscribed(f);f.time('2026-10-30T18:58:00Z');await f.service.tick();assert.equal(f.models.length,1);assert.equal(f.sends.length,0);
});
