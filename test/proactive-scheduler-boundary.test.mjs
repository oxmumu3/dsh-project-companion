import test from 'node:test';
import assert from 'node:assert/strict';
import {ProactiveScheduler} from '../vendor/proactive/lib/scheduler.js';
import {DEFAULT_CONFIG} from '../vendor/proactive/lib/config.js';

const due=Date.parse('2026-10-29T12:00:00.000Z');
function harness(t,{clock=[due-1,due],bootHandled=true,respectQuietHours=false,result,alarmOverrides={}}={}){
 t.mock.timers.enable({apis:['setTimeout']});
 let readings=[...clock],time=readings.at(-1);
 const wakes=[],records=[];
 let alarm={id:'alarm_boundary',ownerSessionId:'synthetic',type:'once',status:'scheduled',nextDueAt:new Date(due).toISOString(),trigger:{at:new Date(due).toISOString()},respectQuietHours,runCount:0,...alarmOverrides};
 const store={listAlarms:()=>[{...alarm}],getAlarm:id=>id===alarm.id?{...alarm}:undefined,replaceAlarm:row=>{alarm={...row};},persist:async()=>{},appendRun:async row=>{records.push(row);},budgetFor:()=>0,spendBudget:async()=>{}};
 const scheduler=new ProactiveScheduler({store,config:{...structuredClone(DEFAULT_CONFIG),quietHours:{start:'00:00',end:'23:59',timeZone:'UTC'},bootOverduePolicy:'drop'},now:()=>readings.length?readings.shift():time,log:()=>{},runWake:async row=>{wakes.push(row.id);return result?.(wakes.length)??{outcome:'ok',analysis:{decision:'no_reply',budgetDelta:0}};}});
 scheduler.bootHandled=bootHandled;
 t.after(()=>scheduler.stop());
 return{scheduler,wakes,records,alarm:()=>alarm,time:value=>{readings=[];time=value;},drive:async()=>{scheduler.requestDrive();await scheduler.driveChain;},tick:async ms=>{t.mock.timers.tick(ms);await scheduler.driveChain;}};
}
for(const offset of [0,1])test(`a once alarm becoming due + ${offset} ms between drive selection and arm runs once`,async t=>{
 const h=harness(t,{clock:[due-1,due+offset]});await h.drive();
 assert.equal(h.wakes.length,0,'arming never runs the wake inline');
 assert.notEqual(h.scheduler.timer,null,'a now-due scheduled alarm must retain an asynchronous wake');
 assert.equal(h.scheduler.driveRequested,false,'the rearmed timer waits until the current drive releases its coalescing flag');
 await h.tick(1);assert.equal(h.wakes.length,1);assert.equal(h.alarm().status,'completed');
 assert.equal(h.scheduler.timer,null);await h.tick(60000);assert.equal(h.wakes.length,1);
});
test('a future once deadline is not advanced and fires at its original time',async t=>{
 const h=harness(t,{clock:[due-100,due-100]});await h.drive();h.time(due-1);await h.tick(99);assert.equal(h.wakes.length,0);
 h.time(due);await h.tick(1);assert.equal(h.wakes.length,1);assert.equal(h.alarm().status,'completed');
});
test('stopping after the due boundary rearms cancels the timer without a wake',async t=>{
 const h=harness(t);await h.drive();h.scheduler.stop();await h.tick(1000);assert.equal(h.wakes.length,0);assert.equal(h.scheduler.timer,null);
});
test('boot overdue drop still consumes an expired once alarm without calling runWake',async t=>{
 const h=harness(t,{clock:[due+1],bootHandled:false});await h.drive();assert.equal(h.wakes.length,0);assert.equal(h.alarm().status,'cancelled');assert.equal(h.records.length,1);assert.match(h.records[0].note,/boot overdue: drop/);assert.equal(h.scheduler.timer,null);
});
test('an explicitly quiet-hours-respecting alarm still skips rather than waking',async t=>{
 const h=harness(t,{respectQuietHours:true});await h.drive();await h.tick(1);assert.equal(h.wakes.length,0);assert.equal(h.alarm().status,'completed');assert.match(h.records[0].note,/quiet hours/);assert.equal(h.scheduler.timer,null);
});
test('a busy wake retains its original 30 second retry without a boundary spin',async t=>{
 const h=harness(t,{result:n=>n===1?{outcome:'busy'}:{outcome:'ok',analysis:{decision:'no_reply',budgetDelta:0}}});await h.drive();await h.tick(1);assert.equal(h.wakes.length,1);assert.equal(Date.parse(h.alarm().nextDueAt),due+30000);
 h.time(due+29999);await h.tick(29999);assert.equal(h.wakes.length,1);h.time(due+30000);await h.tick(1);assert.equal(h.wakes.length,2);assert.equal(h.alarm().status,'completed');assert.equal(h.scheduler.timer,null);
});
test('a runWake deferral retains its bounded deadline and does not run inline',async t=>{
 const h=harness(t,{result:n=>n===1?{outcome:'defer',deferUntilMs:due+30000}:{outcome:'ok',analysis:{decision:'no_reply',budgetDelta:0}}});await h.drive();await h.tick(1);assert.equal(h.wakes.length,1);assert.equal(Date.parse(h.alarm().nextDueAt),due+30000);
 h.time(due+30000);await h.tick(30000);assert.equal(h.wakes.length,2);assert.equal(h.alarm().status,'completed');assert.equal(h.scheduler.timer,null);
});

for(const [label,alarmOverrides] of [
 ['cancelled',{status:'cancelled'}],['completed',{status:'completed'}],['paused',{status:'paused'}],
 ['file subscription',{type:'file'}],['invalid deadline',{nextDueAt:'not-a-time'}],
])test(`${label} cannot create a zero-delay timer or run`,async t=>{
 const h=harness(t,{alarmOverrides});await h.drive();assert.equal(h.scheduler.timer,null);await h.tick(60000);assert.equal(h.wakes.length,0);
});
test('a far-future alarm retains the platform maximum timeout clamp',async t=>{
 const max=2_147_483_647,target=due+max+1000,h=harness(t,{clock:[due],alarmOverrides:{nextDueAt:new Date(target).toISOString(),trigger:{at:new Date(target).toISOString()}}});await h.drive();
 h.time(due+max);await h.tick(max);assert.equal(h.wakes.length,0);assert.notEqual(h.scheduler.timer,null);
 h.time(target);await h.tick(1000);assert.equal(h.wakes.length,1);assert.equal(h.alarm().status,'completed');
});
