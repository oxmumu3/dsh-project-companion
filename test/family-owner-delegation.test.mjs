import test from 'node:test';
import assert from 'node:assert/strict';
const implementation=await import('../src/family-owner-delegation.js').catch(()=>({}));
const createFamilyOwnerDelegation=implementation.createFamilyOwnerDelegation;

const owner='family_owner_00000000-0000-4000-8000-000000000001';
const familyRevision='a'.repeat(64), oldBinding='b'.repeat(64), cred='c'.repeat(64);
const call={sessionId:owner,callId:'real-tool-call'};
function fixture({onRouteDiagnostic}={}){
  let row, revision=familyRevision, authorized=true, online=true, legacy={state:'bound',sessionId:'old-dot-session',bindingKey:oldBinding}, leases=[{source:'flomo',sessionId:'old-dot-session',bindingKey:oldBinding,credentialKey:cred,grantId:'grant-a'}];
  const bridge={resolveOwnerCall:async input=>authorized&&online&&input.sessionId===owner&&input.callId==='real-tool-call'?{sessionId:input.sessionId,bindingRevision:revision}:null,isOwnerRevisionCurrent:(id,rev)=>authorized&&online&&id===owner&&revision===rev,ownerRouteStatus:({sessionId,bindingRevision})=>!authorized||sessionId!==owner||bindingRevision!==revision?'changed':online?'current':'offline'};
  const service=createFamilyOwnerDelegation({store:{get:async()=>structuredClone(row),put:async(_id,v)=>{row=structuredClone(v)}},getBridge:()=>bridge,readGrantedLeases:async()=>structuredClone(leases),readGrantedLeasesSync:()=>structuredClone(leases),readLegacySetup:async()=>legacy,onRouteDiagnostic});
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

test('public news scope ignores private grant churn but remains bound to the actual online Owner',async()=>{
 const f=fixture();await f.service.pair({execution:call,originSessionId:'old-dot-session',userAuthorized:true});const privateScope=await f.service.resolve(call),news=f.service.newsOwnerScopeFor(owner);assert.ok(news);f.changeLease();assert.equal(f.service.current(privateScope),false);assert.equal(f.service.newsOwnerCurrent(news),true);assert.equal(f.service.newsOwnerScopeFor('family_member_1'),null);f.online(false);assert.equal(f.service.newsOwnerCurrent(news),false);assert.equal(f.service.newsOwnerRouteState(owner),'offline');f.online(true);assert.equal(f.service.newsOwnerCurrent(news),true);f.changeRevision();assert.equal(f.service.newsOwnerCurrent(news),false);assert.equal(f.service.newsOwnerRouteState(owner),'changed');await f.service.close();
});

test('public news route treats missing or contradictory channel status as unknown',async()=>{
 const f=fixture();await f.service.pair({execution:call,originSessionId:'old-dot-session',userAuthorized:true});const scope=f.service.newsOwnerScopeFor(owner);f.bridge.ownerRouteStatus=()=>undefined;assert.equal(f.service.newsOwnerRouteState(owner),'unknown');assert.equal(f.service.newsOwnerCurrent(scope),false);f.bridge.ownerRouteStatus=()=> 'current';f.bridge.isOwnerRevisionCurrent=()=>false;assert.equal(f.service.newsOwnerRouteState(owner),'unknown');assert.equal(f.service.newsOwnerCurrent(scope),false);await f.service.close();
});

async function diagnosticFixture(onRouteDiagnostic){
 let saved,bridgeReads=0,leaseReads=0,bridgeOverride,leaseError;
 const base=fixture(),leases=[{source:'PRIVATE_SOURCE_CANARY',sessionId:'old-dot-session',bindingKey:oldBinding,credentialKey:cred,grantId:'PRIVATE_GRANT_CANARY'}];
 const service=createFamilyOwnerDelegation({store:{get:async()=>structuredClone(saved),put:async(_key,value)=>{saved=structuredClone(value);}},getBridge:()=>{bridgeReads++;return bridgeOverride===undefined?base.bridge:bridgeOverride;},readGrantedLeases:async()=>structuredClone(leases),readGrantedLeasesSync:()=>{leaseReads++;if(leaseError)throw leaseError;return structuredClone(leases);},readLegacySetup:async()=>({state:'bound',sessionId:'old-dot-session',bindingKey:oldBinding}),onRouteDiagnostic});
 await service.pair({execution:call,originSessionId:'old-dot-session',userAuthorized:true});
 return{service,bridge:base.bridge,saved:()=>structuredClone(saved),counts:()=>({bridgeReads,leaseReads}),bridgeValue:value=>{bridgeOverride=value;},leaseFailure:error=>{leaseError=error;},changeLease:()=>{leases[0].credentialKey='e'.repeat(64);},changeOrigin:()=>{leases[0].sessionId='PRIVATE_SESSION_CANARY';}};
}

test('natural Family route emits closed bridge categories with no extra reads or private metadata',async()=>{
 for(const [status,expected,leasesExpected] of [
  [null,{state:'unknown',reason:'BRIDGE_UNAVAILABLE'},0],
  [{},{state:'unknown',reason:'BRIDGE_UNAVAILABLE'},0],
  ['PRIVATE_BRIDGE_CANARY',{state:'unknown',reason:'BRIDGE_UNKNOWN'},0],
  ['unknown',{state:'unknown',reason:'BRIDGE_UNKNOWN'},1],
  ['offline',{state:'offline',reason:'BRIDGE_OFFLINE'},1],
  ['changed',{state:'changed',reason:'BRIDGE_CHANGED'},0],
  ['current',{state:'current',reason:'CURRENT'},1],
  [new Error('PRIVATE_ERROR_CANARY'),{state:'unknown',reason:'BRIDGE_FAILED'},0],
 ]){
  const observed=[],f=await diagnosticFixture(value=>observed.push(value));
  if(status===null||typeof status==='object'&&!(status instanceof Error))f.bridgeValue(status);
  else f.bridge.ownerRouteStatus=()=>{if(status instanceof Error)throw status;return status;};
  const before=f.counts();assert.equal(f.service.routeState({sessionId:owner,bindingRevision:familyRevision}),expected.state);
  assert.deepEqual(observed,[expected]);assert.deepEqual(f.counts(),{bridgeReads:before.bridgeReads+1,leaseReads:before.leaseReads+leasesExpected});
  assert.doesNotMatch(JSON.stringify(observed),/PRIVATE_|session|source|token|path|fingerprint|grant/i);
  if(status==='changed'){await f.service.ready();assert.equal(f.saved().disabled,true);}
  await f.service.close();
 }
});

test('natural Family route distinguishes credential, lease and origin changes without weakening revocation',async()=>{
 for(const [mode,expected] of [
  ['credential',{state:'changed',reason:'CREDENTIAL_BINDING_CHANGED'}],
  ['unavailable',{state:'unknown',reason:'LEASES_UNAVAILABLE'}],
  ['lease',{state:'changed',reason:'LEASE_CHANGED'}],
  ['origin',{state:'changed',reason:'LEASE_BINDING_CHANGED'}],
 ]){
  const observed=[],f=await diagnosticFixture(value=>observed.push(value));
  if(mode==='credential')f.leaseFailure(Object.assign(new Error('PRIVATE_CREDENTIAL_CANARY'),{code:'CONTEXT_BINDING_CHANGED',path:'/PRIVATE_PATH_CANARY'}));
  if(mode==='unavailable')f.leaseFailure(Object.assign(new Error('PRIVATE_CREDENTIAL_CANARY'),{code:'PRIVATE_CODE_CANARY'}));
  if(mode==='lease')f.changeLease();if(mode==='origin')f.changeOrigin();
  const before=f.counts();assert.equal(f.service.routeState({sessionId:owner,bindingRevision:familyRevision}),expected.state);assert.deepEqual(observed,[expected]);
  assert.deepEqual(f.counts(),{bridgeReads:before.bridgeReads+1,leaseReads:before.leaseReads+1});assert.doesNotMatch(JSON.stringify(observed),/PRIVATE_|session|source|token|path|fingerprint|grant/i);
  await f.service.ready();assert.equal(f.saved().disabled,mode==='origin'?true:undefined);await f.service.close();
 }
});

test('throwing or rejecting route observers cannot affect gate outcomes or permanent revocation',async()=>{
 for(const observer of [()=>{throw new Error('PRIVATE_OBSERVER_CANARY');},async()=>{throw new Error('PRIVATE_OBSERVER_CANARY');}]){
  const f=await diagnosticFixture(observer);assert.equal(f.service.routeState({sessionId:owner,bindingRevision:familyRevision}),'current');
  f.bridge.ownerRouteStatus=()=> 'changed';assert.equal(f.service.routeState({sessionId:owner,bindingRevision:familyRevision}),'changed');
  await f.service.ready();assert.equal(f.saved().disabled,true);assert.equal(f.service.routeState({sessionId:owner,bindingRevision:familyRevision}),'changed');await f.service.close();
 }
});

test('per-call route observer captures only its synchronous call and preserves the string API',async()=>{
 const defaults=[],f=await diagnosticFixture(value=>defaults.push(value)),first=[],second=[];
 assert.equal(f.service.routeState({sessionId:owner,bindingRevision:familyRevision},value=>first.push(value)),'current');
 f.bridge.ownerRouteStatus=()=> 'offline';assert.equal(f.service.routeState({sessionId:owner,bindingRevision:familyRevision},value=>second.push(value)),'offline');
 assert.deepEqual(first,[{state:'current',reason:'CURRENT'}]);assert.deepEqual(second,[{state:'offline',reason:'BRIDGE_OFFLINE'}]);assert.deepEqual(defaults,[]);await f.service.close();
});

test('early delegation route failures use closed categories and perform no bridge or credential reads',async()=>{
 for(const [mode,expected] of [
  ['unloaded',{state:'unknown',reason:'DELEGATION_NOT_READY'}],
  ['closed',{state:'unknown',reason:'DELEGATION_CLOSED'}],
  ['invalid',{state:'unknown',reason:'DELEGATION_INVALID'}],
  ['disabled',{state:'changed',reason:'DELEGATION_DISABLED'}],
 ]){
  const observed=[];let reads=0;
  const service=createFamilyOwnerDelegation({store:{get:async()=>mode==='disabled'?{id:'profile',version:1,disabled:true}:{private:'PRIVATE_PROFILE_CANARY'},put:async()=>{}},getBridge:()=>{reads++;},readGrantedLeases:async()=>[],readGrantedLeasesSync:()=>{reads++;return[];},onRouteDiagnostic:value=>observed.push(value)});
  if(mode!=='unloaded')await service.ready();if(mode==='closed')await service.close();
  assert.equal(service.routeState({sessionId:owner,bindingRevision:familyRevision}),expected.state);assert.deepEqual(observed,[expected]);assert.equal(reads,0);await service.close();
 }
 const observed=[],f=await diagnosticFixture(value=>observed.push(value)),before=f.counts();
 assert.equal(f.service.routeState({sessionId:'PRIVATE_FOREIGN_CANARY',bindingRevision:familyRevision}),'changed');
 assert.deepEqual(observed,[{state:'changed',reason:'DELEGATION_BINDING_CHANGED'}]);assert.deepEqual(f.counts(),before);assert.equal(f.saved().disabled,undefined);await f.service.close();
});
