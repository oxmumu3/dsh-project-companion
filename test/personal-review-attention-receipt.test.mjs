import test from 'node:test';
import assert from 'node:assert/strict';
import {createPersonalReviewService} from '../src/personal-review.js';
import {renderGenerationResult} from '../src/generation-failure.js';

const caller={sessionId:'synthetic-receipt-owner',cwd:'/synthetic/receipt'};
const intent=(action,extra={})=>({action,requestId:`receipt-${action}`,userRequested:true,...extra});
const visible=result=>renderGenerationResult(result).filter(part=>part.type==='text').map(part=>part.text).join('\n');
async function fixture(t,{persisted,at='2026-10-30T20:59:41.427Z'}={}){
 let row=structuredClone(persisted),clock=new Date(at),clockReader,grant='b'.repeat(64),binding='a'.repeat(64);
 const effects={collect:0,model:0,send:0},service=createPersonalReviewService({
  store:{get:async()=>structuredClone(row),put:async(_key,value)=>{row=structuredClone(value);}},clock:()=>clockReader?clockReader():clock,
  readBinding:async()=>({bound:true,bindingKey:binding}),authorization:async()=>grant,
  collect:async()=>{effects.collect++;assert.fail('receipt must not collect');},
  summarize:async()=>{effects.model++;assert.fail('receipt must not call a model');},
  send:async()=>{effects.send++;assert.fail('receipt must not send');},
 });
 await service.ready();t.after(()=>service.close());
 return{service,effects,row:()=>structuredClone(row),time:value=>{clock=new Date(value);},clockUsing:value=>{clockReader=value;},revoke:()=>{grant='c'.repeat(64);},rebind:()=>{binding='d'.repeat(64);}};
}
async function configure(f){return f.service.act(caller,intent('configure',{sources:['gmail'],projects:[],schedule:{dailyTime:'09:00',weeklyDay:1,weeklyTime:'09:00',timeZone:'America/Mexico_City'}}));}
async function enable(f,extra={}){return f.service.act(caller,intent('attention',{enabled:true,...extra}));}

test('actual rendered enable receipt exposes the persisted attention policy and local next check',async t=>{
 const f=await fixture(t);await configure(f);const result=await enable(f),text=visible(result);
 assert.equal(result.attention.enabled,true);assert.equal(f.row().subscription.attention.enabled,true);
 assert.match(text,/工作时段主动关注：已开启/);assert.match(text,/09:00[–—-]19:00/);assert.match(text,/每[两2]小时/);
 assert.match(text,/每日额外最多 2 条/);assert.match(text,/今天还可额外提醒 2 条/);
 assert.match(text,/下次检查：2026\/10\/30 15:00/);assert.match(text,/America\/Mexico_City/);
 assert.equal(result.attention.nextRun,'2026-10-30T21:00:00.000Z');assert.doesNotMatch(text,/已送达|检查已完成/);
 assert.deepEqual(f.effects,{collect:0,model:0,send:0});
});

test('rendered status retains enabled policy without a second mutation and duplicate receipt does not reset it',async t=>{
 const f=await fixture(t);await configure(f);const first=await enable(f),before=f.row();f.time('2026-10-30T20:59:55.000Z');
 const duplicate=await enable(f),status=await f.service.act(caller,{action:'status'});
 assert.equal(duplicate.duplicate,true);assert.deepEqual(f.row().subscription,before.subscription);assert.equal(f.row().receipts.length,2);
 for(const result of [first,duplicate,status]){assert.equal(result.attention.enabled,true);assert.match(visible(result),/工作时段主动关注：已开启/);assert.match(visible(result),/15:00/);}
 assert.deepEqual(f.effects,{collect:0,model:0,send:0});
});

test('rendered disable receipt reflects stored off state without old next-check text',async t=>{
 const f=await fixture(t);await configure(f);await enable(f);
 const result=await f.service.act(caller,intent('attention',{enabled:false,requestId:'receipt-attention-off'})),text=visible(result);
 assert.equal(result.attention.enabled,false);assert.equal(f.row().subscription.attention.enabled,false);
 assert.match(text,/工作时段主动关注：已关闭/);assert.doesNotMatch(text,/工作时段主动关注：已开启|下次检查：2026/);
 assert.deepEqual(f.effects,{collect:0,model:0,send:0});
});

test('rendered pause differs from permanent disable and resume shows the actual retained policy',async t=>{
 const f=await fixture(t);await configure(f);await enable(f);
 const paused=await f.service.act(caller,intent('pause'));
 assert.equal(paused.status,'paused');assert.equal(paused.attention.enabled,false);assert.equal(f.row().subscription.attention.enabled,true);
 assert.match(visible(paused),/工作时段主动关注：已暂停/);assert.doesNotMatch(visible(paused),/工作时段主动关注：已关闭|工作时段主动关注：已开启/);
 const resumed=await f.service.act(caller,intent('resume'));assert.equal(resumed.attention.enabled,true);assert.match(visible(resumed),/工作时段主动关注：已开启/);
 assert.deepEqual(f.effects,{collect:0,model:0,send:0});
});

test('rendered off configuration does not imply active attention or absence of work',async t=>{
 const f=await fixture(t);const empty=await f.service.act(caller,{action:'status'}),configured=await configure(f);
 assert.match(visible(empty),/工作时段主动关注：未配置/);assert.match(visible(configured),/工作时段主动关注：未配置/);
 for(const result of [empty,configured]){assert.equal(result.attention.enabled,false);assert.doesNotMatch(visible(result),/没有任务|无事项|已送达/);}
 assert.deepEqual(f.effects,{collect:0,model:0,send:0});
});

test('quiet hours and exhausted budget retain truthful local scheduling and do not reset counters',async t=>{
 const initial=await fixture(t);await configure(initial);await enable(initial);const persisted=initial.row();
 persisted.attentionClaims=[{id:'synthetic-first',at:'2026-10-30T17:00:00.000Z',timeZone:'America/Mexico_City',status:'reported_sent'},{id:'synthetic-second',at:'2026-10-30T19:00:00.000Z',timeZone:'America/Mexico_City',status:'uncertain'}];
 const day=await fixture(t,{persisted,at:'2026-10-30T20:59:50.000Z'}),state=await day.service.act(caller,{action:'status'});
 assert.equal(state.attention.remaining,0);assert.equal(state.attention.nextRun,'2026-10-30T21:00:00.000Z');assert.equal(day.row().attentionClaims.length,2);
 const duplicate=await enable(day);assert.equal(duplicate.duplicate,true);
 for(const result of [state,duplicate]){
  assert.equal(result.attention.remaining,0);assert.match(result.text,/今天额外额度已用尽/);assert.match(result.text,/今日剩余的额外检查与推送不再执行/);assert.match(result.text,/每日和每周回顾仍按原计划运行/);
  const text=visible(result);assert.match(text,/今天还可额外提醒 0 条/);assert.match(text,/今天额外额度已用尽/);assert.match(text,/每日和每周回顾仍按原计划运行/);assert.doesNotMatch(text,/下次检查|明天|明日/);
 }
 day.time('2026-10-30T21:00:00.000Z');await day.service.tick();assert.deepEqual(day.effects,{collect:0,model:0,send:0});assert.equal(day.row().attentionClaims.length,2);
 const night=await fixture(t,{persisted,at:'2026-10-31T02:00:00.000Z'}),later=await night.service.act(caller,{action:'status'});
 assert.equal(later.attention.quiet,true);assert.equal(later.attention.remaining,0);assert.match(visible(later),/当前不在工作时段/);assert.match(visible(later),/今天额外额度已用尽/);assert.doesNotMatch(visible(later),/下次检查/);
 assert.doesNotMatch(visible(later),/没有变化|已送达/);assert.deepEqual(night.effects,{collect:0,model:0,send:0});
 const tomorrow=await fixture(t,{persisted,at:'2026-10-31T16:00:00.000Z'}),fresh=await tomorrow.service.act(caller,{action:'status'});
 assert.equal(fresh.attention.remaining,2);assert.match(visible(fresh),/下次检查：2026\/10\/31 11:00/);assert.doesNotMatch(visible(fresh),/今天额外额度已用尽/);
});

test('changed authority still blocks status instead of displaying a successful receipt',async t=>{
 for(const mode of ['revoke','rebind']){const f=await fixture(t);await configure(f);await enable(f);f[mode]();await assert.rejects(f.service.act(caller,{action:'status'}));assert.deepEqual(f.effects,{collect:0,model:0,send:0});}
});

test('a new scope configuration does not display an old attention success',async t=>{
 const f=await fixture(t);await configure(f);await enable(f);const result=await f.service.act(caller,intent('configure',{requestId:'new-configure',sources:['gmail'],projects:[],schedule:{dailyTime:'10:00',timeZone:'America/Mexico_City'}}));
 assert.equal(result.attention.enabled,false);assert.match(visible(result),/工作时段主动关注：未配置/);assert.doesNotMatch(visible(result),/工作时段主动关注：已开启/);
});

test('text uses the same attention snapshot when the clock crosses a slot during rendering',async t=>{
 const f=await fixture(t);await configure(f);await enable(f);let calls=0;
 f.clockUsing(()=>new Date(++calls<=2?'2026-10-30T20:59:59.999Z':'2026-10-30T21:00:00.001Z'));
 const result=await f.service.act(caller,{action:'status'});
 assert.equal(result.attention.nextRun,'2026-10-30T21:00:00.000Z');assert.match(visible(result),/下次检查：2026\/10\/30 15:00/);
 assert.doesNotMatch(visible(result),/下次检查：2026\/10\/30 17:00/);
});

test('an enabled policy with an unconfirmed next slot does not claim no tasks or a completed check',async t=>{
 const initial=await fixture(t);await configure(initial);await enable(initial);const persisted=initial.row();
 persisted.subscription.attention.createdAt='2026-11-05T20:59:41.427Z';
 const f=await fixture(t,{persisted}),result=await f.service.act(caller,{action:'status'});
 assert.equal(result.attention.enabled,true);assert.equal(result.attention.nextRun,null);assert.match(visible(result),/下次检查时间尚未确认/);
 assert.doesNotMatch(visible(result),/没有任务|无事项|检查已完成|已送达/);assert.deepEqual(f.effects,{collect:0,model:0,send:0});
});
