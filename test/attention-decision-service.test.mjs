import test from 'node:test';
import assert from 'node:assert/strict';
import {createPersonalReviewService,personalReviewRowSchema} from '../src/personal-review.js';
import {reviewRuntimeHealth} from '../src/review-runtime-health.js';

const owner={sessionId:'synthetic-decision-owner',cwd:'/synthetic/project'},binding='a'.repeat(64),grant='b'.repeat(64);
const at='2026-10-31T23:00:00.000Z';
async function fixture(t,{partial=false,unavailable=false,kind='reply',delivery='reported_sent'}={}){
 let row,clock=new Date('2026-10-31T22:30:00Z');const calls={read:0,model:0,send:0},materials=[],sent=[];
 const service=createPersonalReviewService({store:{get:async()=>structuredClone(row),put:async(_,v)=>{row=structuredClone(v);}},clock:()=>clock,
  readBinding:async()=>({bound:true,bindingKey:binding}),readBindingSync:()=>({bound:true,bindingKey:binding}),authorization:async()=>grant,authorizationSync:()=>true,
  collect:async()=>{calls.read++;return{evidence:unavailable?[]:[{id:'synthetic-evidence',source:'gmail',title:'Synthetic',text:'Synthetic deadline 2026-11-01T02:00:00.000Z',dueAt:'2026-11-01T02:00:00.000Z',dueAtBasis:'source'}],coverage:[{source:'gmail',status:unavailable?'unavailable':partial?'partial':'ok',count:unavailable?null:1,...(partial?{truncated:true}:{})}]};},
  summarize:async input=>{calls.model++;materials.push(input);return{items:[{key:'synthetic-item',kind,title:'合成事项',summary:'仅使用合成资料。',why:'核对这项变化。',action:'查看原通知。',unknown:'',evidenceIds:['synthetic-evidence'],priority:kind==='risk'?'high':'normal',confidence:'source',...(kind==='deadline'?{dueAt:'2026-11-01T02:00:00.000Z'}:{})}]};},
  send:async input=>{calls.send++;sent.push(input.text);return{status:delivery};}});
 t.after(()=>service.close());await service.act(owner,{action:'configure',sources:['gmail'],projects:[],schedule:{dailyTime:'09:00',timeZone:'America/Mexico_City'},requestId:'configure',userRequested:true});
 await service.act(owner,{action:'attention',enabled:true,requestId:'attention',userRequested:true});clock=new Date(at);
 return{service,calls,materials,sent,row:()=>structuredClone(row),setTime:value=>{clock=new Date(value);}};
}
test('partial natural attention persists a closed completed-check decision without notifying or complete watermark',async t=>{
 const f=await fixture(t,{partial:true});assert.equal((await f.service.tick())[0].status,'unknown');
 const row=f.row(),job=row.jobs.at(-1);assert.ok(job.attentionDecision);assert.equal(job.attentionDecision.outcome,'no_actionable_in_covered_scope');assert.equal(job.attentionDecision.evaluatedItems,1);
 assert.equal(f.calls.read,1);assert.equal(f.calls.model,1);assert.equal(f.calls.send,0);assert.deepEqual(row.watermarks,{});assert.equal(row.attentionClaims.length,0);
 const view=await f.service.snapshot(owner);assert.match(view.health.label,/已检查.*未发现达到提醒门槛.*覆盖/);assert.equal(view.health.state,'unknown');assert.equal(view.health.phoneReceipt,'unverified');
 assert.doesNotMatch(JSON.stringify(f.materials),/attentionDecision|reasonCounts|no_actionable_in_covered_scope/);assert.equal(personalReviewRowSchema.safeParse(row).success,true);
});
test('fully unavailable attention persists no-evaluation metadata without model, delivery or quiet claims',async t=>{
 const f=await fixture(t,{unavailable:true});await f.service.tick();const job=f.row().jobs.at(-1);
 assert.ok(job.attentionDecision);assert.equal(job.attentionDecision.outcome,'sources_unavailable');assert.equal(job.attentionDecision.evaluatedItems,0);assert.equal(job.status,'unknown');
 assert.equal(f.calls.model,0);assert.equal(f.calls.send,0);assert.match((await f.service.snapshot(owner)).health.label,/未能读取/);
});
test('last regular attention selects a proven quiet-hours deadline once, using unchanged read scope',async t=>{
 const f=await fixture(t,{kind:'deadline'});assert.equal((await f.service.tick())[0].status,'reported_sent');const row=f.row(),job=row.jobs.at(-1);
 assert.ok(job.attentionDecision);assert.equal(job.attentionDecision.deadlineThrough,'2026-11-01T15:00:00.000Z');assert.equal(job.attentionDecision.selectedItems,1);
 assert.equal(f.calls.send,1);assert.equal(f.calls.read,1);assert.doesNotMatch(f.sent[0],/attentionDecision|reasonCounts|deadlineThrough/);
 assert.deepEqual(await f.service.tick(),[]);assert.equal(f.calls.read,1);assert.equal(f.calls.send,1);assert.equal(row.attentionClaims.length,1);
});
test('an uncertain delivery is durably claimed and never replayed',async t=>{
 const f=await fixture(t,{kind:'risk',delivery:'uncertain'});assert.equal((await f.service.tick())[0].status,'uncertain');
 assert.equal(f.row().jobs.at(-1).attentionDecision.selectedItems,1);assert.deepEqual(await f.service.tick(),[]);assert.equal(f.calls.send,1);
});
test('durable decisions accept legacy absence but reject extra private fields and unknown enum values',async t=>{
 const f=await fixture(t);await f.service.tick();const row=f.row(),job=row.jobs.at(-1);assert.ok(job.attentionDecision);
 const legacy=structuredClone(row);delete legacy.jobs.at(-1).attentionDecision;assert.equal(personalReviewRowSchema.safeParse(legacy).success,true);
 job.attentionDecision.token='PRIVATE_CANARY';assert.equal(personalReviewRowSchema.safeParse(row).success,false);delete job.attentionDecision.token;
 job.attentionDecision.outcome='PRIVATE_CANARY';assert.equal(personalReviewRowSchema.safeParse(row).success,false);
});
test('unknown old jobs retain their uncertainty and no saved plan becomes execution',()=>{
 const subscription={paused:false,createdAt:'2026-10-31T22:30:00.000Z'},now=new Date(at);
 const health=reviewRuntimeHealth({subscription,jobs:[{createdAt:at,kind:'attention',status:'unknown'}],now});assert.equal(health.state,'unknown');assert.match(health.label,/覆盖不完整/);
 assert.equal(reviewRuntimeHealth({subscription,jobs:[],now}).state,'waiting');
});
