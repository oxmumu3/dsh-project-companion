import test from 'node:test';
import assert from 'node:assert/strict';
import {createFamilyOwnerDelegation} from '../src/family-owner-delegation.js';
import * as delegation from '../src/family-owner-delegation.js';
import {createFamilyWorkbenchConnection} from '../src/family-workbench-route.js';

const text='更新这个微信的 Dot 资料授权，使用我在电脑上启用的来源。';
const owner='family_owner_synthetic',revision='a'.repeat(64),binding='b'.repeat(64);
const call={sessionId:owner,callId:'active-owner-call'};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
async function fixture(){
 let row,rev=revision,sourceText=text,timing='fresh',request='inbound-1',readError,readHook,putHook,legacySession='original-dot';
 let leases=[{source:'calendar',sessionId:'original-dot',bindingKey:binding,credentialKey:'c'.repeat(64),grantId:'original-grant'}];
 const writes=[];
 const bridge={resolveOwnerCall:async input=>input.sessionId===owner&&input.callId===call.callId?{sessionId:owner,bindingRevision:rev,userText:sourceText,previousUserText:text,sourceRequestId:request,sourceTimingState:timing}:null,isOwnerRevisionCurrent:(id,r)=>id===owner&&r===rev,ownerRouteStatus:({sessionId,bindingRevision})=>sessionId===owner&&bindingRevision===rev?'current':'changed'};
 const service=createFamilyOwnerDelegation({store:{get:async()=>structuredClone(row),put:async(_id,value)=>{writes.push(structuredClone(value));if(putHook)await putHook(value);row=structuredClone(value);}},getBridge:()=>bridge,readGrantedLeases:async()=>{if(readHook)await readHook();if(readError)throw readError;return structuredClone(leases);},readGrantedLeasesSync:()=>{if(readError)throw readError;return structuredClone(leases);},readLegacySetup:async()=>({state:'bound',sessionId:legacySession,bindingKey:binding})});
 await service.pair({execution:call,originSessionId:'original-dot',userAuthorized:true});writes.length=0;
 return{service,bridge,writes,row:()=>structuredClone(row),change:()=>{leases[0].credentialKey='d'.repeat(64);leases[0].grantId='new-grant';},text:v=>sourceText=v,timing:v=>timing=v,request:v=>request=v,error:v=>readError=v,leases:v=>leases=v,onRead:v=>readHook=v,onPut:v=>putHook=v,rebind:()=>rev='e'.repeat(64),rebindLegacy:()=>legacySession='different-dot'};
}
const renew=f=>f.service.renewIfRequested({execution:call});

test('fresh exact original Owner request renews only effective source fingerprint; old captured authority remains invalid',async()=>{
 const f=await fixture(),old=await f.service.resolve(call),before=f.row();f.change();
 assert.equal(typeof f.service.renewIfRequested,'function','explicit recovery entry is absent');
 const result=await renew(f);assert.equal(result.status,'renewed');assert.deepEqual(result.sources,[{id:'calendar',state:'enabled'}]);
 assert.equal(f.writes.length,1);assert.notEqual(f.row().leaseFingerprint,before.leaseFingerprint);
 assert.match(f.row().grantRevision,/^[a-f0-9]{64}$/);assert.equal(before.grantRevision,undefined);
 for(const key of ['familySessionId','bindingRevision','originSessionId','originBindingKey'])assert.equal(f.row()[key],before[key]);
 assert.equal(f.service.current(old),false);assert.equal(await f.service.recheck(old),false);
 assert.ok(await f.service.resolve(call));assert.doesNotMatch(JSON.stringify(result),/credentialKey|bindingKey|sourceRequestId/);
 const oldGeneration={...f.row(),grantRevision:undefined};assert.equal(f.service.current(oldGeneration),false);assert.equal(await f.service.recheck(oldGeneration),false);
 const again=await renew(f);assert.equal(again.status,'current');assert.equal(f.writes.length,1,'identical effective grants must not be rewritten');
});
test('normal connections, previous text, quoted, denied, questioned or appended instructions never renew',async()=>{
 for(const value of ['查看连接状态','不要'+text,'“'+text+'”','请解释这句话：'+text,text+'可以吗？',text+'然后读取日历。',text.replace('。','？'),'']){
  const f=await fixture();f.change();f.text(value);assert.equal(await renew(f),null,value);assert.equal(f.writes.length,0,value);
 }
});
test('only fresh trusted inbound is accepted; model input and wake flag cannot supply authority',async()=>{
 for(const state of ['stale','unknown',undefined]){const f=await fixture();f.change();f.timing(state);await assert.rejects(renew(f),/FAMILY_DELEGATION_FRESH_REQUEST_REQUIRED/);assert.equal(f.writes.length,0);}
 const f=await fixture();f.change();assert.equal(await f.service.renewIfRequested({execution:call,wake:true}),null);assert.equal(f.writes.length,0);
 f.text('查看连接状态');assert.equal(await f.service.renewIfRequested({execution:call,userText:text,sourceTimingState:'fresh'}),null);assert.equal(f.writes.length,0);
});
test('stale source leases require explicit desktop enabling and never alter delegation',async()=>{
 const f=await fixture(),before=f.row();f.error(Object.assign(Error('stale'),{code:'CONTEXT_BINDING_CHANGED'}));await assert.rejects(renew(f),/FAMILY_DELEGATION_SOURCES_NOT_READY/);assert.deepEqual(f.row(),before);assert.equal(f.writes.length,0);
});
test('renewal rejects foreign origin, mixed bindings and missing original grants',async()=>{
 for(const rows of [[{source:'calendar',sessionId:'foreign',bindingKey:binding,credentialKey:'c'.repeat(64)}],[{source:'calendar',sessionId:'original-dot',bindingKey:'e'.repeat(64),credentialKey:'c'.repeat(64)}],[{source:'calendar',sessionId:'original-dot',bindingKey:binding,credentialKey:'c'.repeat(64)},{source:'flomo',sessionId:'foreign',bindingKey:binding,credentialKey:'c'.repeat(64)}],[]]){
  const f=await fixture(),before=f.row();f.leases(rows);await assert.rejects(renew(f),/FAMILY_DELEGATION_SOURCES_NOT_READY/);assert.deepEqual(f.row(),before);assert.equal(f.writes.length,0);
 }
});
test('disabled delegation or a different Owner binding cannot be revived',async()=>{
 for(const disabled of [false,true]){const f=await fixture();f.rebind();if(disabled){f.service.routeState({sessionId:owner,bindingRevision:revision});await new Promise(r=>setImmediate(r));}const before=f.row(),n=f.writes.length;await assert.rejects(renew(f),/FAMILY_DELEGATION_CHANGED/);assert.deepEqual(f.row(),before);assert.equal(f.writes.length,n);}
});
test('revocation or close while effective leases await cannot be overwritten by renewal',async()=>{
 for(const mode of ['revoke','close']){const f=await fixture(),entered=deferred(),release=deferred(),before=f.row();f.change();f.onRead(async()=>{entered.resolve();await release.promise;});const pending=renew(f);await entered.promise;let closing;if(mode==='revoke'){f.rebind();f.service.routeState({sessionId:owner,bindingRevision:revision});}else closing=f.service.close();release.resolve();await assert.rejects(pending,/FAMILY_DELEGATION_(CHANGED|CLOSED)/);if(closing)await closing;assert.deepEqual(f.row(),mode==='revoke'?{id:'profile',version:1,disabled:true}:before);}
});
test('revocation or close during put cannot persist renewed grant or rollback over revocation',async()=>{
 for(const mode of ['revoke','close']){const f=await fixture(),entered=deferred(),release=deferred(),before=f.row();f.change();let first=true;f.onPut(async()=>{if(first){first=false;entered.resolve();await release.promise;}});const pending=renew(f);await entered.promise;let closing;if(mode==='revoke'){f.rebind();f.service.routeState({sessionId:owner,bindingRevision:revision});}else closing=f.service.close();release.resolve();await assert.rejects(pending,/FAMILY_DELEGATION_(CHANGED|CLOSED)/);if(closing)await closing;assert.deepEqual(f.row(),mode==='revoke'?{id:'profile',version:1,disabled:true}:before);}
});
test('changed current Owner message during awaits cannot reuse earlier exact request',async()=>{
 const f=await fixture(),entered=deferred(),release=deferred(),before=f.row();f.change();f.onRead(async()=>{entered.resolve();await release.promise;});const pending=renew(f);await entered.promise;f.text('不要更新了');f.request('inbound-2');release.resolve();await assert.rejects(pending,/FAMILY_DELEGATION_CHANGED/);assert.deepEqual(f.row(),before);assert.equal(f.writes.length,0);
});
test('legacy binding changed while put awaited cannot complete renewal',async()=>{
 const f=await fixture(),entered=deferred(),release=deferred(),before=f.row();f.change();let first=true;f.onPut(async()=>{if(first){first=false;entered.resolve();await release.promise;}});const pending=renew(f);await entered.promise;f.rebindLegacy();release.resolve();await assert.rejects(pending,/FAMILY_DELEGATION_LEGACY_CHANGED/);assert.deepEqual(f.row(),before);
});
test('ordinary workbench refresh after source re-enabling does not revoke recovery identity',async()=>{
 const f=await fixture(),before=f.row();f.change();
 const read=createFamilyWorkbenchConnection({isEnabled:()=>true,readLegacyConnection:async()=>assert.fail('must not fall back'),delegation:f.service,readNativeRoute:async()=>assert.fail('stale source must stop before native route')});
 assert.deepEqual(await read(),{state:'unknown',readOnly:true});assert.deepEqual(f.row(),before);assert.equal(f.writes.length,0);
 assert.equal((await renew(f)).status,'renewed');
});
test('source change remains blocked but leaves original identity for explicit recovery even during background route inspection',async()=>{
 const f=await fixture(),old=await f.service.resolve(call),before=f.row();f.error(Object.assign(Error('credential changed'),{code:'CONTEXT_BINDING_CHANGED'}));
 assert.equal(f.service.routeState({sessionId:owner,bindingRevision:revision}),'changed');await new Promise(r=>setImmediate(r));assert.deepEqual(f.row(),before);assert.equal(f.writes.length,0);
 f.error(undefined);f.change();assert.equal(f.service.routeState({sessionId:owner,bindingRevision:revision}),'changed');assert.equal(f.service.current(old),false);await new Promise(r=>setImmediate(r));assert.deepEqual(f.row(),before);
 assert.equal((await renew(f)).status,'renewed');assert.equal(f.service.current(old),false);
});
test('binding generation is legacy-compatible until explicit renewal, then never matches old queued actions',async()=>{
 assert.equal(typeof delegation.familyDelegationBinding,'function');
 const f=await fixture(),old=await f.service.resolve(call),oldBinding=delegation.familyDelegationBinding(old);f.change();await renew(f);const next=await f.service.resolve(call),nextBinding=delegation.familyDelegationBinding(next);
 assert.equal(nextBinding.userHash,oldBinding.userHash);assert.notEqual(nextBinding.botHash,oldBinding.botHash);
 const currentRevision=next.grantRevision;await renew(f);assert.equal(f.row().grantRevision,currentRevision,'idempotent renewal cannot replace generation');
 const read=createFamilyWorkbenchConnection({isEnabled:()=>true,readLegacyConnection:async()=>assert.fail('no fallback'),delegation:f.service,readNativeRoute:async()=>({kind:'bound',binding:nextBinding})});
 assert.equal((await read()).state,'bound','current generation must work in native workbench');
});
