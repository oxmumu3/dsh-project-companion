import test from 'node:test';
import assert from 'node:assert/strict';
import {createPersonalReviewService} from '../src/personal-review.js';
import {createPersonalReviewModel} from '../src/personal-review-model.js';

const caller={sessionId:'synthetic-owner',cwd:'/synthetic/project'};
const binding='a'.repeat(64),grant='b'.repeat(64);
const scope={sources:['flomo','gmail'],projects:['/synthetic/project']};
const stale={id:'project:old-control',source:'project',projectRoot:'/synthetic/project',title:'Synthetic old progress',text:'旧记录：等待本人恢复资料授权和工作时段关注。',at:'2026-10-30T20:49:00.000Z'};
const coverage=[{source:'gmail',status:'ok',count:0},{source:'flomo',status:'unavailable',count:null},{source:'project',status:'ok',count:1}];
const intent=(action,extra={})=>({action,userRequested:true,requestId:`request-${action}`,...extra});
async function serviceFixture(){
 let row,at=new Date('2026-10-30T20:59:00.000Z'),actualGrant=grant,advance=false,revokeDuringRead=false;
 const calls={collect:[],model:[],send:[]};
 const service=createPersonalReviewService({store:{get:async()=>structuredClone(row),put:async(_,value)=>{row=structuredClone(value);}},clock:()=>at,
  authorization:async()=>actualGrant,readBinding:async()=>({bound:true,bindingKey:binding}),readAvailability:async()=>'current',
  collect:async input=>{calls.collect.push(input);if(advance)at=new Date('2026-10-30T21:00:10.000Z');if(revokeDuringRead)actualGrant='c'.repeat(64);return{evidence:input.projects.length?[stale]:[{id:'mail:1',source:'gmail',title:'Synthetic mail',text:'Synthetic service notice',at:at.toISOString()}],coverage:coverage.filter(c=>input.sources.includes(c.source)||input.projects.length&&c.source==='project'),currentReview:{checkedAt:'2000-01-01T00:00:00.000Z',scopeConfirmedAt:null,sourceCount:0,projectCount:0,secret:'COLLECTOR_PRIVATE_CANARY'}};},
  summarize:async input=>{calls.model.push(input);return{items:[]};},send:async input=>{calls.send.push(input);return{status:'reported_sent'};}
 });
 await service.ready();
 return{service,calls,row:()=>structuredClone(row),time:value=>{at=new Date(value);},advance:()=>{advance=true;},revoke:()=>{actualGrant='c'.repeat(64);},revokeDuringRead:()=>{revokeDuringRead=true;}};
}
async function configure(f){await f.service.act(caller,intent('configure',{...scope,schedule:{dailyTime:'09:00',timeZone:'America/Mexico_City'}}));f.time('2026-10-30T20:59:30.000Z');await f.service.act(caller,intent('attention',{enabled:true}));}

test('generation supplies actual same-scope control dates after collection, not collector assertions',async()=>{
 const f=await serviceFixture();await configure(f);f.time('2026-10-30T21:00:00.000Z');f.advance();
 await f.service.act(caller,intent('preview',scope));
 assert.deepEqual(f.calls.model[0].currentReview,{checkedAt:'2026-10-30T21:00:10.000Z',scopeConfirmedAt:'2026-10-30T20:59:00.000Z',attentionEnabledAt:'2026-10-30T20:59:30.000Z',sourceCount:2,projectCount:1});
 assert.equal(f.calls.model[0].now,f.calls.model[0].currentReview.checkedAt);
 assert.deepEqual(f.calls.model[0].coverage,coverage);assert.deepEqual(f.calls.model[0].evidence,[stale]);
 assert.doesNotMatch(JSON.stringify(f.calls.model[0].currentReview),/COLLECTOR_PRIVATE_CANARY|synthetic-owner|synthetic\/project|credential|token|grant/i);
 assert.equal(f.calls.collect.length,1);assert.equal(f.calls.model.length,1);assert.equal(f.calls.send.length,0);await f.service.close();
});
test('a different preview scope cannot borrow existing subscription or attention confirmation',async()=>{
 const f=await serviceFixture();await configure(f);f.time('2026-10-30T21:00:00.000Z');
 await f.service.act(caller,intent('preview',{sources:['gmail'],projects:[]}));
 assert.deepEqual(f.calls.model[0].currentReview,{checkedAt:'2026-10-30T21:00:00.000Z',scopeConfirmedAt:null,attentionEnabledAt:null,sourceCount:1,projectCount:0});
 assert.deepEqual(f.row().subscription.sources,scope.sources);assert.equal(f.calls.send.length,0);await f.service.close();
});
test('preview with no subscription has no invented confirmation timestamps',async()=>{
 const f=await serviceFixture();await f.service.act(caller,intent('preview',{sources:['gmail'],projects:[]}));
 assert.equal(f.calls.model[0].currentReview.scopeConfirmedAt,null);assert.equal(f.calls.model[0].currentReview.attentionEnabledAt,null);await f.service.close();
});
test('paused or disabled attention is not represented as currently enabled control',async()=>{
 for(const action of ['pause','attention']){
  const f=await serviceFixture();await configure(f);await f.service.act(caller,intent(action,{enabled:false,requestId:'attention-off'}));
  await f.service.act(caller,intent('preview',scope));assert.equal(f.calls.model[0].currentReview.attentionEnabledAt,null);await f.service.close();
 }
});
test('a fresh manual preview under a different grant cannot borrow old subscription confirmation',async()=>{
 const f=await serviceFixture();await configure(f);f.revoke();await f.service.act(caller,intent('preview',scope));
 assert.equal(f.calls.model[0].currentReview.scopeConfirmedAt,null);assert.equal(f.calls.model[0].currentReview.attentionEnabledAt,null);assert.equal(f.row().subscription.grant,grant);await f.service.close();
});
test('a backward clock never serializes confirmation dates from the future',async()=>{
 const f=await serviceFixture();await configure(f);f.time('2026-10-30T20:58:00.000Z');await f.service.act(caller,intent('preview',scope));
 assert.equal(f.calls.model[0].currentReview.scopeConfirmedAt,null);assert.equal(f.calls.model[0].currentReview.attentionEnabledAt,null);await f.service.close();
});
test('post-collection authorization failure still prevents any model or delivery call',async()=>{
 const f=await serviceFixture();await configure(f);f.revokeDuringRead();
 await assert.rejects(f.service.act(caller,intent('preview',scope)));assert.equal(f.calls.collect.length,1);assert.equal(f.calls.model.length,0);assert.equal(f.calls.send.length,0);await f.service.close();
});

const control={checkedAt:'2026-10-30T21:00:10.000Z',scopeConfirmedAt:'2026-10-30T20:59:00.000Z',attentionEnabledAt:'2026-10-30T20:59:30.000Z',sourceCount:2,projectCount:1};
function modelFixture(){
 const calls=[];const ctx={get(name){if(name==='agentDefaultModel')return{currentSelection:()=>({provider:'synthetic',model:'fake'})};if(name==='llm')return{prepareCall:async config=>({config,stream:async function*(request){calls.push(request);yield{type:'text-delta',index:0,text:'{"items":[]}'};yield{type:'finish',reason:{kind:'stop'}};}})};}};
 return{model:createPersonalReviewModel(ctx),calls};
}
test('model receives strict current control separately from unchanged stale evidence and failed coverage',async()=>{
 const f=modelFixture();await f.model.summarize({evidence:[stale],coverage,currentReview:control,now:control.checkedAt});
 const data=JSON.parse(f.calls[0].messages[0].content[0].text);assert.deepEqual(data.currentReview,control);assert.deepEqual(data.evidence,[stale]);assert.deepEqual(data.coverage,coverage);
 assert.deepEqual(f.calls[0].tools,[]);assert.match(f.calls[0].system,/currentReview/);assert.match(f.calls[0].system,/旧.*(?:授权|确认)|早于.*(?:授权|确认)/);assert.match(f.calls[0].system,/不代表.*(?:读取|成功)/);assert.match(f.calls[0].system,/业务.*证据|不能.*业务/);
 f.model.close();
});
test('legacy model callers remain valid and gain no invented current control',async()=>{
 const f=modelFixture();await f.model.summarize({evidence:[stale],coverage,now:control.checkedAt});
 const data=JSON.parse(f.calls[0].messages[0].content[0].text);assert.equal(data.currentReview,undefined);f.model.close();
});
test('model rejects unknown fields, unbounded counts and impossible control dates without raw detail',async()=>{
 const invalid=[{...control,account:'PRIVATE_CONTROL_CANARY'},{...control,checkedAt:'invalid'},{...control,checkedAt:'2026-10-30T21:00:11.000Z'},{...control,sourceCount:6},{...control,sourceCount:1.5},{...control,projectCount:-1},{...control,scopeConfirmedAt:'2026-10-30T21:01:00.000Z'},{...control,attentionEnabledAt:'2026-10-30T21:01:00.000Z'},{...control,attentionEnabledAt:'2026-10-30T20:58:00.000Z'},{...control,scopeConfirmedAt:null}];
 for(const currentReview of invalid){const f=modelFixture();await assert.rejects(f.model.summarize({evidence:[stale],coverage,currentReview,now:control.checkedAt}),error=>error.code==='MODEL_INVALID_INPUT'&&!String(error).includes('PRIVATE_CONTROL_CANARY'));assert.equal(f.calls.length,0);f.model.close();}
});
