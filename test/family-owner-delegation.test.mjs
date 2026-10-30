import test from 'node:test';
import assert from 'node:assert/strict';
const implementation=await import('../src/family-owner-delegation.js').catch(()=>({}));
const createFamilyOwnerDelegation=implementation.createFamilyOwnerDelegation;

const owner='family_owner_00000000-0000-4000-8000-000000000001';
const familyRevision='a'.repeat(64), oldBinding='b'.repeat(64), cred='c'.repeat(64);
const call={sessionId:owner,callId:'real-tool-call'};
function fixture(){
  let row, revision=familyRevision, authorized=true, online=true, legacy={state:'bound',sessionId:'old-dot-session',bindingKey:oldBinding}, leases=[{source:'flomo',sessionId:'old-dot-session',bindingKey:oldBinding,credentialKey:cred,grantId:'grant-a'}];
  const bridge={resolveOwnerCall:async input=>authorized&&online&&input.sessionId===owner&&input.callId==='real-tool-call'?{sessionId:input.sessionId,bindingRevision:revision}:null,isOwnerRevisionCurrent:(id,rev)=>authorized&&online&&id===owner&&revision===rev,ownerRouteStatus:({sessionId,bindingRevision})=>!authorized||sessionId!==owner||bindingRevision!==revision?'changed':online?'current':'offline'};
  const service=createFamilyOwnerDelegation({store:{get:async()=>structuredClone(row),put:async(_id,v)=>{row=structuredClone(v)}},getBridge:()=>bridge,readGrantedLeases:async()=>structuredClone(leases),readGrantedLeasesSync:()=>structuredClone(leases),readLegacySetup:async()=>legacy});
  return {service,bridge,row:()=>row,changeRevision:()=>revision='d'.repeat(64),revoke:()=>authorized=false,changeLease:()=>leases[0].credentialKey='e'.repeat(64),setLegacy:v=>legacy=v,online:v=>online=v};
}
test('privileged pairing reuses existing grant without copying source credentials or private data',async()=>{
  assert.equal(typeof createFamilyOwnerDelegation,'function','trusted family delegation must exist');
  const f=fixture();await f.service.pair({execution:call,originSessionId:'old-dot-session',userAuthorized:true});
  const delegated=await f.service.resolve(call);assert.equal(delegated.originSessionId,'old-dot-session');assert.equal(delegated.originBindingKey,oldBinding);assert.equal(delegated.bindingRevision,familyRevision);
  assert.doesNotMatch(JSON.stringify(f.row()),/synthetic-token|credentialKey|flomo/);
});
test('only the bridge-proved review token is transiently passed with the active Owner call',async()=>{
 const f=fixture(),token='f'.repeat(64),base=f.bridge.resolveOwnerCall;
 await f.service.pair({execution:call,originSessionId:'old-dot-session',userAuthorized:true});
 f.bridge.resolveOwnerCall=async input=>({...await base(input),previousReviewViewToken:token});
 assert.equal((await f.service.resolve(call)).previousReviewViewToken,token);assert.equal(f.row().previousReviewViewToken,undefined);
 f.bridge.resolveOwnerCall=async input=>({...await base(input),previousReviewViewToken:'invalid'});
 assert.equal((await f.service.resolve(call)).previousReviewViewToken,undefined);
});
test('untrusted or foreign sessions cannot create or use a pairing',async()=>{
  const f=fixture();await assert.rejects(f.service.pair({execution:call,originSessionId:'old-dot-session'}));await assert.rejects(f.service.pair({execution:{sessionId:'family_member_1',callId:'real-tool-call'},originSessionId:'old-dot-session',userAuthorized:true}));assert.equal(await f.service.resolve({sessionId:'family_member_1',callId:'real-tool-call'}),null);assert.equal(f.row(),undefined);
});
test('family rebind or role revocation invalidates mapping and synchronous use',async()=>{
  for(const mode of ['rebind','revoke']){const f=fixture();await f.service.pair({execution:call,originSessionId:'old-dot-session',userAuthorized:true});const scope=await f.service.resolve(call);assert.equal(f.service.current(scope),true);mode==='rebind'?f.changeRevision():f.revoke();assert.equal(f.service.current(scope),false);assert.equal(await f.service.resolve(call),null);}
});
test('changed old grant is rejected on async recheck and does not mutate the existing authorization',async()=>{
  const f=fixture();await f.service.pair({execution:call,originSessionId:'old-dot-session',userAuthorized:true});const original=structuredClone(f.row()),scope=await f.service.resolve(call);f.changeLease();assert.equal(f.service.current(scope),false);assert.equal(await f.service.recheck(scope),false);assert.equal(await f.service.resolve(call),null);assert.deepEqual(f.row(),original);
});
test('re-pair requires explicit authorization and never adopts another family revision automatically',async()=>{
  const f=fixture();await f.service.pair({execution:call,originSessionId:'old-dot-session',userAuthorized:true});f.changeRevision();assert.equal(await f.service.resolve(call),null);await assert.rejects(f.service.pair({execution:call,originSessionId:'old-dot-session'}));assert.equal(await f.service.resolve(call),null);
});
test('a fabricated call ID cannot use the paired Owner authority',async()=>{const f=fixture();await f.service.pair({execution:call,originSessionId:'old-dot-session',userAuthorized:true});assert.equal(await f.service.resolve({...call,callId:'fabricated'}),null);});
test('background scope is available only to the captured Owner session while its binding stays current',async()=>{const f=fixture();await f.service.pair({execution:call,originSessionId:'old-dot-session',userAuthorized:true});const saved=f.service.scopeFor(owner);assert.ok(saved);assert.equal(f.service.scopeFor('family_member_1'),null);f.changeRevision();assert.equal(f.service.scopeFor(owner),null);assert.equal(await f.service.recheck(saved),false);});
test('cannot create an owner mapping from a mix of old Dot bindings',async()=>{let saved;const f=fixture(),leases=[{source:'flomo',sessionId:'old-dot-session',bindingKey:oldBinding,credentialKey:cred},{source:'calendar',sessionId:'old-dot-session',bindingKey:'9'.repeat(64),credentialKey:cred}];const s=createFamilyOwnerDelegation({store:{get:async()=>undefined,put:async(_k,v)=>saved=v},getBridge:()=>f.bridge,readGrantedLeases:async()=>leases,readGrantedLeasesSync:()=>leases});await assert.rejects(s.pair({execution:call,originSessionId:'old-dot-session',userAuthorized:true}));assert.equal(saved,undefined);});
test('confirmed legacy rebind permanently disables the existing delegation; unavailable status does not claim rebind',async()=>{const f=fixture();await f.service.pair({execution:call,originSessionId:'old-dot-session',userAuthorized:true});const scope=await f.service.resolve(call);f.setLegacy({state:'unknown'});assert.equal(await f.service.recheck(scope),true);f.setLegacy({state:'bound',sessionId:'other-user',bindingKey:'f'.repeat(64)});assert.equal(await f.service.recheck(scope),false);assert.equal(f.row().disabled,true);f.setLegacy({state:'bound',sessionId:'old-dot-session',bindingKey:oldBinding});assert.equal(await f.service.resolve(call),null);assert.equal(f.service.isUnpaired(),false);});
test('offline family route does not revoke the plan, changed binding and source grants do',async()=>{const f=fixture();await f.service.pair({execution:call,originSessionId:'old-dot-session',userAuthorized:true});f.online(false);assert.equal(f.service.routeState({sessionId:owner,bindingRevision:familyRevision}),'offline');assert.equal(f.row().disabled,undefined);f.online(true);assert.equal(f.service.routeState({sessionId:owner,bindingRevision:familyRevision}),'current');f.changeRevision();assert.equal(f.service.routeState({sessionId:owner,bindingRevision:familyRevision}),'changed');assert.equal(f.service.current({familySessionId:owner,bindingRevision:familyRevision}),false);});
test('Owner can pair a route without a personal account grant and gains no source authorization',async()=>{let row;const f=fixture(),s=createFamilyOwnerDelegation({store:{get:async()=>row,put:async(_k,v)=>row=v},getBridge:()=>f.bridge,readGrantedLeases:async()=>[],readGrantedLeasesSync:()=>[]});await s.pair({execution:call,originSessionId:'family-no-legacy',userAuthorized:true});const scope=await s.resolve(call);assert.equal(scope.originSessionId,'family-no-legacy');assert.equal(scope.originBindingKey,'0'.repeat(64));assert.doesNotMatch(JSON.stringify(row),/token|credential/);});
