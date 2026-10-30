import test from 'node:test';
import assert from 'node:assert/strict';
import {createPersonalReviewService} from '../src/personal-review.js';
import {captureReviewMeetings,changeReviewGoal} from '../src/personal-review-goals.js';

const caller={sessionId:'synthetic-owner',cwd:'/synthetic/project'};
const schedule={dailyTime:'09:00',timeZone:'America/Mexico_City'};
const bindingKey='b'.repeat(64);

test('old source grant task is invisible and all feedback routes reject it',async()=>{
 let state=null,grant='a'.repeat(64);const service=createPersonalReviewService({store:{get:async()=>structuredClone(state),put:async(_k,v)=>{state=structuredClone(v);}},readBinding:async()=>({bound:true,bindingKey}),authorization:async()=>grant,canRun:async()=>true,clock:()=>new Date('2026-10-30T17:00:00Z'),collect:async input=>({evidence:[{id:'ev',source:'dida',title:'任务',text:'内容',sourceTask:{source:'dida',projectId:'p',taskId:'t',scopeKey:input.taskScopeKey}}],coverage:[{source:'dida',status:'ok',count:1}]}),summarize:async()=>({items:[{key:'k',kind:'risk',title:'旧授权任务',summary:'合成摘要',why:'原因',action:'处理',unknown:'',evidenceIds:['ev'],priority:'normal',confidence:'source'}]}),send:async()=>({status:'reported_sent'})});
 const configure=(requestId)=>service.act(caller,{action:'configure',sources:['dida'],projects:[],schedule,userRequested:true,requestId});
 await configure('old');const preview=await service.act(caller,{action:'preview',userRequested:true,requestId:'preview'});const id=state.items[0].id;grant='c'.repeat(64);const updated=await configure('new');assert.deepEqual(updated.items,[]);
 for(const extra of [{itemId:id},{itemTitle:'旧授权任务'},{itemNumber:1,confirmedViewToken:preview.viewToken}])await assert.rejects(service.act(caller,{action:'feedback',feedback:'handled',userRequested:true,requestId:`feedback-${Object.keys(extra)[0]}`,...extra}));
 assert.equal(state.items[0].status,'open');await service.close();
});

test('partial calendar coverage cannot populate a unique meeting cache',()=>{
 const scope={key:'a'.repeat(64),grant:'b'.repeat(64),sources:['calendar'],projects:[caller.cwd]};const evidence=[{id:'e',source:'calendar',title:'发布评审',text:'会议',eventStartAt:'2026-10-30T17:30:00.000Z'}];
 for(const coverage of [[{source:'calendar',status:'partial',count:1,truncated:true}],[{source:'calendar',status:'ok',count:1,truncated:true}],[{source:'calendar',status:'ok',count:1},{source:'calendar',status:'partial',count:1}]])assert.equal(captureReviewMeetings(evidence,coverage,scope,'2026-10-30T17:00:00.000Z'),null);
});

test('fresh partial calendar at a previously confirmed meeting lead time never creates a preparation',async()=>{
 let state=null,stamp='2026-10-30T15:30:00.000Z',partial=false;const sent=[];const event={id:'e',source:'calendar',title:'发布评审',text:'会议',eventStartAt:'2026-10-30T17:30:00.000Z'};
 const service=createPersonalReviewService({store:{get:async()=>structuredClone(state),put:async(_k,v)=>{state=structuredClone(v);}},readBinding:async()=>({bound:true,bindingKey}),authorization:async()=> 'a'.repeat(64),canRun:async()=>true,clock:()=>new Date(stamp),collect:async input=>({evidence:[event],coverage:[{source:'calendar',status:partial?'partial':'ok',count:1,...(partial?{truncated:true}: {})},...(input.projects.length?[{source:'project',status:'ok',count:0}]:[])]}),summarize:async()=>({items:[]}),send:async message=>{sent.push(message);return{status:'reported_sent'};}});
 await service.act(caller,{action:'configure',sources:['calendar'],projects:[caller.cwd],schedule,userRequested:true,requestId:'configure'});await service.act(caller,{action:'goal',goalAction:'track',goalTitle:'目标',projectName:'project',meetingTitle:'发布评审',userRequested:true,requestId:'goal'});assert.ok(state.meetingCache);partial=true;stamp='2026-10-30T17:00:00.000Z';await service.tick();assert.equal(sent.length,0);await service.close();
});

test('late partial preview clears a previously confirmed meeting cache and does not trigger a meeting',async()=>{
 let state=null,stamp='2026-10-30T15:30:00.000Z',partial=false;const sent=[];const event={id:'e',source:'calendar',title:'发布评审',text:'会议',eventStartAt:'2026-10-30T17:30:00.000Z'};
 const service=createPersonalReviewService({store:{get:async()=>structuredClone(state),put:async(_k,v)=>{state=structuredClone(v);}},readBinding:async()=>({bound:true,bindingKey}),authorization:async()=> 'a'.repeat(64),canRun:async()=>true,clock:()=>new Date(stamp),collect:async input=>({evidence:[event],coverage:[{source:'calendar',status:partial?'partial':'ok',count:1,...(partial?{truncated:true}: {})},...(input.projects.length?[{source:'project',status:'ok',count:0}]:[])]}),summarize:async()=>({items:[]}),send:async message=>{sent.push(message);return{status:'reported_sent'};}});
 await service.act(caller,{action:'configure',sources:['calendar'],projects:[caller.cwd],schedule,userRequested:true,requestId:'configure'});await service.act(caller,{action:'goal',goalAction:'track',goalTitle:'目标',projectName:'project',meetingTitle:'发布评审',userRequested:true,requestId:'goal'});assert.ok(state.meetingCache);partial=true;stamp='2026-10-30T16:55:00.000Z';await service.act(caller,{action:'preview',userRequested:true,requestId:'partial-preview'});assert.equal(state.meetingCache,null);stamp='2026-10-30T17:00:00.000Z';await service.tick();assert.equal(sent.length,0);await service.close();
});
