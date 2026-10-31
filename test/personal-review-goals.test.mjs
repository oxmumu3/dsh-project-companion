import test from 'node:test';
import assert from 'node:assert/strict';
import {createPersonalReviewService} from '../src/personal-review.js';
import {changeReviewGoal,prepareReviewMeeting} from '../src/personal-review-goals.js';
import {validatePersonalReviewSummary} from '../src/personal-review-ledger.js';
import {createPersonalReviewCollector} from '../src/personal-review-collect.js';

const caller={sessionId:'owner-test',cwd:'/synthetic/project'},grant='a'.repeat(64),bindingKey='b'.repeat(64);
const clockAt='2026-10-30T15:00:00.000Z';
const event={id:'calendar-meeting-1',source:'calendar',title:'发布评审',text:'讨论交付验收',eventStartAt:'2026-10-30T17:30:00.000Z',eventEndAt:'2026-10-30T18:00:00.000Z'};
const project={id:'project-progress',source:'project',projectRoot:caller.cwd,title:'project / progress',text:'安装验收已完成；手机排版仍待本人确认。'};
function fixture(saved,options={}){let value=saved??null,stamp=clockAt,allowed=true,events=[event],sent=[],reads=0,model=[],calls=[],failCalendar=false;
 const service=createPersonalReviewService({store:{get:async()=>structuredClone(value),put:async(_k,v)=>{value=structuredClone(v);}},readBinding:async()=>({bound:true,bindingKey}),authorization:async()=>allowed?grant:null,canRun:async()=>true,clock:()=>new Date(stamp),collect:async input=>{reads++;calls.push(input);await options.onCollect?.(input);if(failCalendar)return{evidence:[],coverage:[{source:'calendar',status:'unavailable',count:null}]};if(input.projects.length===0)return{evidence:[...events],coverage:[{source:'calendar',status:'ok',count:events.length}]};return{evidence:[...events,project],coverage:[{source:'calendar',status:'ok',count:events.length},{source:'project',status:'ok',count:1}]};},summarize:async input=>{model.push(input);await options.onModel?.();return{items:options.items??[]};},send:async message=>{await options.beforeSend?.();if(!await message.authorizeAsync()||!message.authorize())return{status:'blocked'};sent.push(message);return{status:'reported_sent'};}});
 return{service,sent,model,calls,get reads(){return reads;},saved:()=>structuredClone(value),time:t=>stamp=t,events:v=>events=v,revoke:()=>allowed=false,failCalendar:()=>failCalendar=true};}
async function configure(f){await f.service.act(caller,{action:'configure',sources:['calendar'],projects:[caller.cwd],schedule:{dailyTime:'09:00',timeZone:'America/Mexico_City'},userRequested:true,requestId:'schedule'});await f.service.act(caller,{action:'attention',enabled:true,userRequested:true,requestId:'attention'});}
const goalInput={action:'goal',goalAction:'track',goalTitle:'完成公开试用',projectName:'project',meetingTitle:'发布评审',userRequested:true,requestId:'goal-1'};

test('confirmed goal performs one bounded calendar-only discovery before scheduling and is passed to review',async()=>{
 const f=fixture();await configure(f);const result=await f.service.act(caller,goalInput);assert.equal(f.reads,1);assert.deepEqual(f.calls[0].sources,['calendar']);assert.deepEqual(f.calls[0].projects,[]);assert.equal(f.calls[0].kind,'daily');assert.equal(result.goals[0].title,'完成公开试用');assert.match(result.text,/30 分钟/);
 await f.service.act(caller,{action:'preview'});assert.equal(f.model[0].goals[0].objective,'完成公开试用');assert.equal(f.sent.length,0);await f.service.close();
});
test('goal cannot expand sources/projects or use a made-up project',async()=>{
 const f=fixture();await configure(f);await assert.rejects(f.service.act(caller,{...goalInput,projectName:'private-other'}));await assert.rejects(f.service.act(caller,{...goalInput,sources:['gmail']}));assert.equal(f.reads,0);await f.service.close();
});
test('meeting preparation runs once at the explicit lead time and survives restart without replay',async()=>{
 const f=fixture();await configure(f);await f.service.act(caller,goalInput);await f.service.act(caller,{action:'preview'});await f.service.tick();assert.equal(f.sent.length,0);const before=f.reads;f.time('2026-10-30T17:00:00.000Z');await f.service.tick();assert.equal(f.sent.length,1);assert.match(f.sent[0].text,/会前准备/);assert.match(f.sent[0].text,/需要决定|需决定/);assert.match(f.sent[0].text,/已有依据/);assert.match(f.sent[0].text,/待核对/);
 assert.equal(f.reads,before+1);await f.service.tick();assert.equal(f.sent.length,1);assert.equal(f.reads,before+1);const saved=f.saved();await f.service.close();const restarted=fixture(saved);restarted.time('2026-10-30T17:01:00.000Z');await restarted.service.tick();assert.equal(restarted.sent.length,0);assert.equal(restarted.reads,0);await restarted.service.close();
});
test('a fresh cancelled or rescheduled meeting invalidates the old preparation',async()=>{
 for(const events of [[],[{...event,eventStartAt:'2026-10-30T19:30:00.000Z',eventEndAt:'2026-10-30T20:00:00.000Z'}]]){const f=fixture();await configure(f);await f.service.act(caller,goalInput);await f.service.act(caller,{action:'preview'});f.events(events);f.time('2026-10-30T17:00:00.000Z');await f.service.tick();assert.equal(f.sent.length,0);await f.service.close();}
});
test('ambiguous calendars and paused or completed goals do not trigger preparation',async()=>{
 for(const change of ['ambiguous','pause','complete']){const f=fixture();await configure(f);await f.service.act(caller,goalInput);await f.service.act(caller,{action:'preview'});if(change==='ambiguous')f.events([event,{...event,id:'calendar-other'}]);else await f.service.act(caller,{action:'goal',goalAction:change,goalTitle:goalInput.goalTitle,userRequested:true,requestId:change});f.time('2026-10-30T17:00:00.000Z');await f.service.tick();assert.equal(f.sent.length,0);await f.service.close();}
});
test('revocation blocks meeting collection and previously stored goal content',async()=>{const f=fixture();await configure(f);await f.service.act(caller,goalInput);await f.service.act(caller,{action:'preview'});f.revoke();f.time('2026-10-30T17:00:00.000Z');await f.service.tick();assert.equal(f.reads,2);assert.equal(f.sent.length,0);await assert.rejects(f.service.snapshot(caller));await f.service.close();});

test('meeting lead check between normal attention slots reads fresh evidence once',async()=>{const f=fixture();await configure(f);await f.service.act(caller,goalInput);f.events([{...event,eventStartAt:'2026-10-30T18:00:00.000Z',eventEndAt:'2026-10-30T18:30:00.000Z'}]);await f.service.act(caller,{action:'preview'});await f.service.tick();f.time('2026-10-30T17:00:00.000Z');await f.service.tick();assert.equal(f.sent.length,0);f.time('2026-10-30T17:30:00.000Z');await f.service.tick();assert.equal(f.sent.length,1);const count=f.reads;await f.service.tick();assert.equal(f.reads,count);await f.service.close();});
test('night meetings do not create extra notifications or override quiet hours',async()=>{const f=fixture();await configure(f);await f.service.act(caller,goalInput);f.events([{...event,eventStartAt:'2026-10-31T02:30:00.000Z',eventEndAt:'2026-10-31T03:00:00.000Z'}]);await f.service.act(caller,{action:'preview'});f.time('2026-10-31T02:00:00.000Z');await f.service.tick();assert.equal(f.sent.length,0);await f.service.close();});
test('explicit meeting preparation needs no second generic attention switch',async()=>{const f=fixture();await f.service.act(caller,{action:'configure',sources:['calendar'],projects:[caller.cwd],schedule:{dailyTime:'09:00',timeZone:'America/Mexico_City'},userRequested:true,requestId:'schedule'});await f.service.act(caller,goalInput);await f.service.tick();f.time('2026-10-30T17:00:00.000Z');await f.service.tick();assert.equal(f.sent.length,1);assert.equal(f.saved().subscription.attention,undefined);assert.match(f.sent[0].text,/会前准备/);await f.service.close();});
test('goal created after daily report discovers its meeting without a separate preview or attention toggle',async()=>{const f=fixture();f.time('2026-10-30T15:30:00.000Z');await f.service.act(caller,{action:'configure',sources:['calendar'],projects:[caller.cwd],schedule:{dailyTime:'09:00',timeZone:'America/Mexico_City'},userRequested:true,requestId:'schedule'});await f.service.act(caller,goalInput);assert.equal(f.reads,1);f.time('2026-10-30T17:00:00.000Z');await f.service.tick();assert.equal(f.sent.length,1);assert.match(f.sent[0].text,/会前准备/);await f.service.close();});
test('failed or ambiguous discovery records goal but explicitly says meeting time is unknown',async()=>{for(const setup of ['failure','ambiguous','missing']){const f=fixture();await configure(f);if(setup==='failure')f.failCalendar();else f.events(setup==='missing'?[]:[event,{...event,id:'duplicate'}]);const result=await f.service.act(caller,goalInput);assert.equal(result.goals.length,1);assert.match(result.text,/未确认|无法确认/);assert.equal(f.sent.length,0);await f.service.close();}});
test('preparation excludes summaries supported by other projects or more than the selected references',()=>{
 const scope={key:'a'.repeat(64),grant:'b'.repeat(64),projects:[caller.cwd],sources:['calendar']},goals=changeReviewGoal([],goalInput,scope,clockAt);
 const other={id:'other-project',source:'project',projectRoot:'/other',title:'other',text:'other evidence'};const candidate={key:'x',kind:'risk',title:'wrong scope',summary:'跨项目事实不得拼入',why:'why',action:'action',unknown:'',priority:'normal',confidence:'source',evidenceIds:[project.id,other.id]};
 const evidence=[event,project,other],[prep]=prepareReviewMeeting(goals,scope,evidence,[candidate],'2026-10-30T17:00:00.000Z');assert.doesNotMatch(prep.summary,/跨项目事实/);assert.ok(!prep.evidenceIds.includes(other.id));assert.doesNotThrow(()=>validatePersonalReviewSummary({items:[prep]},evidence));
});
test('old grants do not occupy the active scope limit or erase historical goals',()=>{
 const scope={key:'a'.repeat(64),grant:'b'.repeat(64),projects:[caller.cwd],sources:['calendar']},first=changeReviewGoal([],goalInput,scope,clockAt),old=Array.from({length:5},(_,i)=>({...first[0],id:`old-${i}`,title:`old-${i}`,grant:'c'.repeat(64)}));
 const result=changeReviewGoal(old,goalInput,scope,clockAt);assert.equal(result.length,6);assert.deepEqual(result.slice(0,5),old);
});
test('grant revocation or pause during initial discovery prevents cache and sending',async()=>{
 for(const mode of ['revoke','pause']){let entered,release;const start=new Promise(r=>entered=r),wait=new Promise(r=>release=r);const f=fixture(null,{onCollect:async()=>{entered();await wait;}});await configure(f);
  const goal=f.service.act(caller,goalInput);await start;let pause;if(mode==='revoke')f.revoke();else pause=f.service.act(caller,{action:'pause',userRequested:true,requestId:'pause-during-discovery'});release();const result=await goal;if(pause)await pause;
  assert.equal(result.status,'needs_recheck');assert.equal(f.saved().meetingCache,null);assert.equal(f.sent.length,0);await f.service.close();
 }
});
test('goal capacity never deletes old grants and reports exhaustion',()=>{
 const scope={key:'a'.repeat(64),grant:'b'.repeat(64),projects:[caller.cwd],sources:['calendar']},first=changeReviewGoal([],goalInput,scope,clockAt),old=Array.from({length:50},(_,i)=>({...first[0],id:`old-${i}`,title:`old-${i}`,grant:'c'.repeat(64)}));
 assert.throws(()=>changeReviewGoal(old,goalInput,scope,clockAt),/历史目标已满/);assert.equal(old.length,50);
});
test('completed goals retain history but do not permanently consume current five goal slots',()=>{
 const scope={key:'a'.repeat(64),grant:'b'.repeat(64),projects:[caller.cwd],sources:['calendar']};let rows=[];
 for(let i=0;i<5;i++)rows=changeReviewGoal(rows,{...goalInput,goalTitle:`目标${i}`},scope,clockAt);
 assert.throws(()=>changeReviewGoal(rows,{...goalInput,goalTitle:'第六个'},scope,clockAt),/最多跟进五个/);
 rows=changeReviewGoal(rows,{goalAction:'complete',goalTitle:'目标0'},scope,clockAt);rows=changeReviewGoal(rows,{...goalInput,goalTitle:'第六个'},scope,clockAt);assert.equal(rows.length,6);assert.equal(rows.find(x=>x.title==='目标0').status,'completed');
 assert.throws(()=>changeReviewGoal(rows,{goalAction:'resume',goalTitle:'目标0'},scope,clockAt),/最多跟进五个/);
});
test('workbench prioritizes active goals over completed history',async()=>{
 const f=fixture();await configure(f);for(let i=0;i<5;i++){const title=`目标${i}`;await f.service.act(caller,{action:'goal',goalAction:'track',goalTitle:title,projectName:'project',userRequested:true,requestId:`track-${i}`});await f.service.act(caller,{action:'goal',goalAction:'complete',goalTitle:title,userRequested:true,requestId:`finish-${i}`});}
 await f.service.act(caller,{action:'goal',goalAction:'track',goalTitle:'新目标',projectName:'project',userRequested:true,requestId:'new-goal'});const result=await f.service.snapshot(caller);assert.equal(result.goals.length,5);assert.equal(result.goals[0].title,'新目标');await f.service.close();
});
test('real bounded collector discovers an explicitly named meeting before its natural lead check',async()=>{
 let saved,stamp='2026-10-30T15:30:00.000Z',projectReads=0;const calls=[],sends=[];
 const collect=createPersonalReviewCollector({query:async(_owner,args)=>{calls.push(args);return{items:[{id:'calendar-real',title:'发布评审',text:'合成会议',startAt:'2026-10-30T17:30:00.000Z',endAt:'2026-10-30T18:00:00.000Z'}]};},readProject:async()=>{projectReads++;return{sources:[{status:'ok',path:'README.md',text:'合成项目进展'}]};}});
 const service=createPersonalReviewService({store:{get:async()=>structuredClone(saved),put:async(_k,row)=>{saved=structuredClone(row);}},readBinding:async()=>({bound:true,bindingKey}),authorization:async()=>grant,canRun:async()=>true,clock:()=>new Date(stamp),collect,summarize:async()=>({items:[]}),send:async input=>{sends.push(input);return{status:'reported_sent'};}});
 await service.act(caller,{action:'configure',sources:['calendar'],projects:[caller.cwd],schedule:{dailyTime:'09:00',timeZone:'America/Mexico_City'},userRequested:true,requestId:'schedule'});
 const result=await service.act(caller,goalInput);assert.match(result.text,/已确认一场/);assert.equal(calls.length,1);assert.equal(calls[0].source,'calendar');assert.equal(calls[0].operation,'upcoming');assert.equal(projectReads,0);assert.equal(sends.length,0);
 stamp='2026-10-30T17:00:00.000Z';await service.tick();assert.equal(sends.length,1);assert.match(sends[0].text,/会前准备/);assert.equal(projectReads,1);await service.close();
});
test('meeting and confirmed goal names containing deadline words remain usable',async()=>{
 const f=fixture();await configure(f);f.events([{...event,title:'交付截止评审'}]);await f.service.act(caller,{...goalInput,goalTitle:'截止前提交资料',meetingTitle:'交付截止评审'});f.time('2026-10-30T17:00:00.000Z');await f.service.tick();assert.equal(f.sent.length,1);assert.match(f.sent[0].text,/交付截止评审/);await f.service.close();
});
test('slow model and transport never deliver attention after quiet hours or meeting start',async()=>{
 for(const mode of ['model-quiet','model-start','send-quiet','send-start']){
  let f;const quiet=mode.endsWith('quiet'),after=quiet?'2026-10-31T01:01:00.000Z':'2026-10-30T17:31:00.000Z';
  f=fixture(null,{...(mode.startsWith('model')?{onModel:()=>f.time(after)}:{beforeSend:()=>f.time(after)})});await configure(f);
  if(quiet)f.events([{...event,eventStartAt:'2026-10-31T00:59:00.000Z',eventEndAt:'2026-10-31T01:30:00.000Z'}]);
  await f.service.act(caller,goalInput);f.time(quiet?'2026-10-31T00:30:00.000Z':'2026-10-30T17:00:00.000Z');await f.service.tick();assert.equal(f.sent.length,0,mode);await f.service.close();
 }
});
test('an explicitly configured daily report still sends outside attention work hours',async()=>{
 const item={key:'daily-risk',kind:'risk',title:'合成风险',summary:'项目有风险',why:'待核对',action:'核对',unknown:'',evidenceIds:[project.id],priority:'high',confidence:'source'};const f=fixture(null,{items:[item]});
 await f.service.act(caller,{action:'configure',sources:['calendar'],projects:[caller.cwd],schedule:{dailyTime:'20:00',timeZone:'America/Mexico_City'},userRequested:true,requestId:'late-daily'});f.time('2026-10-31T02:00:00.000Z');await f.service.tick();assert.equal(f.sent.length,1);await f.service.close();
});
