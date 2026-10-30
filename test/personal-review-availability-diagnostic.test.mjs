import test from 'node:test';
import assert from 'node:assert/strict';
import {createPersonalReviewService,personalReviewRowSchema} from '../src/personal-review.js';

const caller={sessionId:'synthetic-availability-owner',cwd:'/synthetic/availability'},binding='a'.repeat(64),grant='b'.repeat(64);
const intent=(action,extra={})=>({action,requestId:`availability-${action}`,userRequested:true,...extra});
async function fixture({persisted}={}){
 let row=structuredClone(persisted),at=new Date('2026-10-30T10:40:00Z'),availability='current',failure,grantMode,bindingMode,enabled=true,writes=0,availabilityReads=0,authorizationReads=0,bindingReads=0;
 const calls={collect:0,model:0,send:0};
 const service=createPersonalReviewService({store:{get:async()=>structuredClone(row),put:async(_key,value)=>{writes++;row=structuredClone(value);}},clock:()=>at,
  readAvailability:async()=>{availabilityReads++;if(failure)throw failure;return availability;},
  authorization:async()=>{authorizationReads++;if(grantMode==='throw')throw new Error('PRIVATE_AUTH_CANARY');return grantMode==='missing'?null:grantMode==='changed'?'c'.repeat(64):grant;},
  readBinding:async()=>{bindingReads++;if(bindingMode==='throw')throw new Error('PRIVATE_BINDING_CANARY');if(bindingMode==='unexpected')return{bound:true,get bindingKey(){throw Object.assign(new Error('PRIVATE_GUARD_CANARY'),{code:'MODEL_INVALID_OUTPUT'});}};return{bound:bindingMode!=='missing',bindingKey:bindingMode==='changed'?'d'.repeat(64):binding};},
  canRun:async()=>enabled,
  collect:async()=>{calls.collect++;return{evidence:[],coverage:[{source:'gmail',status:'ok',count:0}]};},
  summarize:async()=>{calls.model++;return{items:[]};},send:async()=>{calls.send++;return{status:'reported_sent'};},
 });
 await service.ready();
 return{service,calls,row:()=>structuredClone(row),writes:()=>writes,counts:()=>({availabilityReads,authorizationReads,bindingReads}),time:value=>{at=new Date(value);},route:value=>{availability=value;failure=undefined;},routeFailure:()=>{failure=Object.assign(new Error('PRIVATE_ROUTE_MESSAGE_CANARY'),{code:'PRIVATE_ROUTE_CODE_CANARY',session:'PRIVATE_SESSION_CANARY',path:'/PRIVATE_PATH_CANARY',token:'PRIVATE_TOKEN_CANARY'});},grantMode:value=>{grantMode=value;},bindingMode:value=>{bindingMode=value;},disable:()=>{enabled=false;}};
}
async function subscribe(f){
 await f.service.act(caller,intent('configure',{sources:['gmail'],projects:[],schedule:{dailyTime:'09:00',timeZone:'UTC'}}));
 await f.service.act(caller,intent('attention',{enabled:true}));
}
function blocked(f){assert.deepEqual(f.calls,{collect:0,model:0,send:0});assert.deepEqual(f.row().jobs,[]);assert.deepEqual(f.row().occurrences,[]);assert.deepEqual(f.row().attentionClaims,[]);}

test('natural pre-job route categories persist without creating a job, read, model call or send',async()=>{
 for(const [route,expected] of [
  ['unknown',{state:'unknown',reason:'ROUTE_UNKNOWN'}],
  ['changed',{state:'changed',reason:'ROUTE_CHANGED'}],
  ['offline',{state:'offline',reason:'ROUTE_OFFLINE'}],
  [{state:'unknown',reason:'BRIDGE_UNKNOWN'},{state:'unknown',reason:'BRIDGE_UNKNOWN'}],
  [{state:'offline',reason:'BRIDGE_OFFLINE'},{state:'offline',reason:'BRIDGE_OFFLINE'}],
  [{state:'changed',reason:'CREDENTIAL_BINDING_CHANGED'},{state:'changed',reason:'CREDENTIAL_BINDING_CHANGED'}],
 ]){
  const f=await fixture();await subscribe(f);f.route(route);f.time('2026-10-30T11:00:00Z');const before=f.counts();
  assert.deepEqual(await f.service.tick(),[]);assert.deepEqual(f.row().recovery.diagnostic,expected);blocked(f);
  assert.deepEqual(f.counts(),{...before,availabilityReads:before.availabilityReads+1});await f.service.close();
 }
});

test('route exceptions persist only the fixed failure category',async()=>{
 const f=await fixture();await subscribe(f);f.routeFailure();f.time('2026-10-30T11:00:00Z');await f.service.tick();
 assert.deepEqual(f.row().recovery.diagnostic,{state:'unknown',reason:'ROUTE_FAILED'});assert.doesNotMatch(JSON.stringify(f.row().recovery),/PRIVATE_/);blocked(f);await f.service.close();
});

test('pre-job guard failures persist only existing fixed authorization, binding and pause codes',async()=>{
 for(const [kind,value,code] of [
  ['grant','throw','REVIEW_AUTHORIZATION_UNAVAILABLE'],['grant','missing','REVIEW_AUTHORIZATION_REQUIRED'],['grant','changed','REVIEW_AUTHORIZATION_CHANGED'],
  ['binding','throw','REVIEW_BINDING_CHANGED'],['binding','missing','REVIEW_BINDING_CHANGED'],['binding','changed','REVIEW_BINDING_CHANGED'],['binding','unexpected','REVIEW_FAILED'],['pause',false,'REVIEW_PAUSED'],
 ]){
  const f=await fixture();await subscribe(f);if(kind==='grant')f.grantMode(value);else if(kind==='binding')f.bindingMode(value);else f.disable();
  f.time('2026-10-30T11:00:00Z');await f.service.tick();
  assert.deepEqual(f.row().recovery.diagnostic,{state:'changed',reason:'GUARD_REJECTED',guardCode:code});assert.doesNotMatch(JSON.stringify(f.row().recovery),/PRIVATE_/);blocked(f);await f.service.close();
 }
});

test('availability metadata is strict and closed, including state/reason correspondence',async()=>{
 for(const route of [
  {state:'offline',reason:'BRIDGE_OFFLINE',source:'PRIVATE_SOURCE_CANARY',session:'PRIVATE_SESSION_CANARY',token:'PRIVATE_TOKEN_CANARY',path:'/PRIVATE_PATH_CANARY'},
  {state:'unknown',reason:'PRIVATE_REASON_CANARY'}, {state:'PRIVATE_STATE_CANARY',reason:'BRIDGE_UNKNOWN'},
  {state:'current',reason:'BRIDGE_CHANGED'}, {state:'offline'}, 'PRIVATE_STATE_CANARY',null,
 ]){
  const f=await fixture();await subscribe(f);f.route(route);f.time('2026-10-30T11:00:00Z');await f.service.tick();
  assert.deepEqual(f.row().recovery.diagnostic,{state:'unknown',reason:'ROUTE_INVALID'});assert.doesNotMatch(JSON.stringify(f.row().recovery),/PRIVATE_/);blocked(f);await f.service.close();
 }
});

test('cause changes persist immediately within five minutes while repeated observations are throttled',async()=>{
 const f=await fixture();await subscribe(f);f.route({state:'unknown',reason:'BRIDGE_UNAVAILABLE'});await f.service.tick();const initial=f.writes();
 f.time('2026-10-30T10:41:00Z');await f.service.tick();assert.equal(f.writes(),initial);
 f.route({state:'unknown',reason:'BRIDGE_FAILED'});f.time('2026-10-30T10:42:00Z');await f.service.tick();assert.equal(f.writes(),initial+1);assert.equal(f.row().recovery.diagnostic.reason,'BRIDGE_FAILED');
 f.time('2026-10-30T10:43:00Z');await f.service.tick();assert.equal(f.writes(),initial+1);
 f.time('2026-10-30T10:45:00Z');await f.service.tick();assert.equal(f.writes(),initial+2);assert.equal(f.row().recovery.observedAt,'2026-10-30T10:45:00.000Z');blocked(f);await f.service.close();
});

test('guard code changes persist immediately and current admission clears the diagnostic',async()=>{
 const f=await fixture();await subscribe(f);f.grantMode('throw');await f.service.tick();const initial=f.writes();
 f.grantMode('missing');f.time('2026-10-30T10:41:00Z');await f.service.tick();assert.equal(f.writes(),initial+1);assert.equal(f.row().recovery.diagnostic.guardCode,'REVIEW_AUTHORIZATION_REQUIRED');
 f.grantMode(undefined);f.time('2026-10-30T10:42:00Z');await f.service.tick();assert.equal(f.writes(),initial+2);assert.equal('diagnostic' in f.row().recovery,false);blocked(f);await f.service.close();
});

test('legacy recovery rows without diagnostic remain loadable and current route strings preserve cadence',async()=>{
 const f=await fixture();await subscribe(f);await f.service.tick();const legacy=f.row();delete legacy.recovery.diagnostic;
 assert.equal(personalReviewRowSchema.safeParse(legacy).success,true);const reboot=await fixture({persisted:legacy});reboot.time('2026-10-30T10:41:00Z');await reboot.service.tick();
 assert.equal(reboot.writes(),0);assert.equal('diagnostic' in reboot.row().recovery,false);blocked(reboot);await f.service.close();await reboot.service.close();
});

test('stored diagnostics reject raw fields, unrecognized codes and mismatched states',async()=>{
 const f=await fixture();await subscribe(f);f.route('unknown');await f.service.tick();const valid=f.row();
 assert.equal(personalReviewRowSchema.safeParse(valid).success,true);
 for(const diagnostic of [
  {state:'unknown',reason:'ROUTE_UNKNOWN',message:'PRIVATE_MESSAGE_CANARY'},
  {state:'changed',reason:'GUARD_REJECTED',guardCode:'MODEL_INVALID_OUTPUT'},
  {state:'changed',reason:'GUARD_REJECTED',guardCode:'PRIVATE_CODE_CANARY'},
  {state:'offline',reason:'BRIDGE_CHANGED'},
 ]){
  const raw=structuredClone(valid);raw.recovery.diagnostic=diagnostic;assert.equal(personalReviewRowSchema.safeParse(raw).success,false);
 }
 await f.service.close();
});

test('attention disabled and paused subscriptions do not introduce route probes',async()=>{
 for(const mode of ['attention','pause']){
  const f=await fixture();await subscribe(f);await f.service.act(caller,intent(mode,mode==='attention'?{enabled:false,requestId:'disable-attention'}:{}));
  const before=f.counts();f.routeFailure();f.time('2026-10-30T10:41:00Z');await f.service.tick();assert.equal(f.counts().availabilityReads,before.availabilityReads);blocked(f);await f.service.close();
 }
});
