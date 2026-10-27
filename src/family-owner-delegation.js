import {createHash} from 'node:crypto';

const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const identity=value=>typeof value==='string'&&value.length>0&&value.length<=200;
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const copy=value=>value===undefined?undefined:structuredClone(value);

/**
 * Private integration primitive, not a model-facing pairing tool.
 * Call pair only under a separately authorized local setup action. The Family
 * service must verify the exact active Owner WeChat tool call independently;
 * an apparent owner session ID alone is not an identity assertion.
 */
export function createFamilyOwnerDelegation({store,getBridge,readGrantedLeases,readGrantedLeasesSync,readLegacySetup=async()=>({state:'unknown'})}={}){
  if(!store||typeof getBridge!=='function'||typeof readGrantedLeases!=='function'||typeof readGrantedLeasesSync!=='function')throw Error('FAMILY_DELEGATION_CONFIGURATION');
  let state,loaded=false,closed=false,queue=Promise.resolve(),revocationWrite=Promise.resolve();
  const serial=fn=>{const next=queue.then(fn);queue=next.catch(()=>{});return next;};
  async function load(){if(closed)throw Error('FAMILY_DELEGATION_CLOSED');if(!loaded){state=await store.get('profile');loaded=true;}return state;}
  function select(leases,originSessionId){
    if(!Array.isArray(leases)||!identity(originSessionId))return null;
    if(originSessionId==='family-no-legacy')return leases.length===0?{originSessionId,originBindingKey:'0'.repeat(64),leaseFingerprint:hash([])}:null;
    const rows=leases.filter(row=>row?.sessionId===originSessionId);
    if(!rows.length||rows.length>8||rows.some(row=>!identity(row.source)||!hex(row.bindingKey)||!hex(row.credentialKey)||row.grantId!==undefined&&!identity(row.grantId)))return null;
    const binding=rows[0].bindingKey;
    if(rows.some(row=>row.bindingKey!==binding)||new Set(rows.map(row=>row.source)).size!==rows.length)return null;
    const fingerprint=hash(rows.map(row=>[row.source,row.sessionId,row.bindingKey,row.credentialKey,row.grantId??'legacy']).sort((a,b)=>a[0].localeCompare(b[0])));
    return{originSessionId,originBindingKey:binding,leaseFingerprint:fingerprint};
  }
  function valid(row){return row?.id==='profile'&&row.version===1&&identity(row.familySessionId)&&hex(row.bindingRevision)&&identity(row.originSessionId)&&hex(row.originBindingKey)&&hex(row.leaseFingerprint);}
  function revoke(){
    if(closed||!valid(state))return revocationWrite;
    const revoked={id:'profile',version:1,disabled:true};state=revoked;
    revocationWrite=revocationWrite.then(()=>store.put('profile',copy(revoked))).catch(()=>{closed=true;});
    return revocationWrite;
  }
  function routeState({sessionId,bindingRevision}={}){
    if(closed||!loaded)return'unknown';
    if(state?.disabled===true)return'changed';
    if(!valid(state))return'unknown';
    if(sessionId!==state.familySessionId||bindingRevision!==state.bindingRevision)return'changed';
    let leases;try{leases=select(readGrantedLeasesSync(),state.originSessionId);}catch(error){if(error?.code==='CONTEXT_BINDING_CHANGED'){void revoke();return'changed';}return'unknown';}
    if(!leases||leases.originBindingKey!==state.originBindingKey||leases.leaseFingerprint!==state.leaseFingerprint){void revoke();return'changed';}
    try{
      const status=getBridge()?.ownerRouteStatus?.({sessionId,bindingRevision});
      if(!['current','offline','changed','unknown'].includes(status))return'unknown';
      if(status==='changed')void revoke();
      return status;
    }catch{return'unknown';}
  }
  function current(scope){
    if(closed||!valid(state)||!scope||scope.familySessionId!==state.familySessionId||scope.bindingRevision!==state.bindingRevision||scope.originSessionId!==state.originSessionId||scope.originBindingKey!==state.originBindingKey||scope.leaseFingerprint!==state.leaseFingerprint)return false;
    try{const leases=select(readGrantedLeasesSync(),scope.originSessionId);return leases?.leaseFingerprint===scope.leaseFingerprint&&leases.originBindingKey===scope.originBindingKey&&getBridge()?.isOwnerRevisionCurrent?.(state.familySessionId,state.bindingRevision)===true;}catch{return false;}
  }
  async function recheck(scope){
    if(!current(scope))return false;
    let legacy;try{legacy=await readLegacySetup();}catch{legacy={state:'unknown'};}
    if(scope.originSessionId!=='family-no-legacy'&&legacy?.state==='bound'&&(legacy.sessionId!==scope.originSessionId||legacy.bindingKey!==scope.originBindingKey)){
      // Only a positively observed different binding revokes; offline or
      // unavailable status is not evidence of a different owner.
      if(current(scope))await revoke();
      return false;
    }
    if(!current(scope))return false;
    let actual;try{actual=select(await readGrantedLeases(),scope.originSessionId);}catch{return false;}
    return current(scope)&&actual?.originBindingKey===scope.originBindingKey&&actual?.leaseFingerprint===scope.leaseFingerprint;
  }
  async function ownerCall(execution){
    if(!identity(execution?.sessionId)||!identity(execution?.callId))return null;
    try{
      const bridge=getBridge();if(typeof bridge?.resolveOwnerCall!=='function')return null;
      const result=await bridge.resolveOwnerCall({sessionId:execution.sessionId,callId:execution.callId,...(execution.signal?{signal:execution.signal}:{})});
      return result?.sessionId===execution.sessionId&&hex(result.bindingRevision)&&bridge.isOwnerRevisionCurrent?.(result.sessionId,result.bindingRevision)===true?result:null;
    }catch{return null;}
  }
  return{
    async pair({execution,originSessionId,userAuthorized}={}){
      if(userAuthorized!==true)throw Error('FAMILY_DELEGATION_EXPLICIT_AUTHORIZATION_REQUIRED');
      return serial(async()=>{
        await load();await revocationWrite;if(closed)throw Error('FAMILY_DELEGATION_CLOSED');const family=await ownerCall(execution),leases=select(await readGrantedLeases(),originSessionId);
        if(!family||!leases)throw Error('FAMILY_DELEGATION_AUTHORITY_UNAVAILABLE');
        let legacy;try{legacy=await readLegacySetup();}catch{legacy={state:'unknown'};}
        if(leases.originSessionId!=='family-no-legacy'&&legacy?.state==='bound'&&(legacy.sessionId!==leases.originSessionId||legacy.bindingKey!==leases.originBindingKey))throw Error('FAMILY_DELEGATION_LEGACY_CHANGED');
        const previous=copy(state),next={id:'profile',version:1,familySessionId:family.sessionId,bindingRevision:family.bindingRevision,...leases};
        const again=await ownerCall(execution);
        if(again?.bindingRevision!==family.bindingRevision)throw Error('FAMILY_DELEGATION_CHANGED');
        await store.put('profile',copy(next));state=next;
        const after=await ownerCall(execution);
        if(after?.bindingRevision!==family.bindingRevision||!await recheck(next)){
          // Never grant from an ambiguous/changed source. If rollback fails,
          // disable the in-memory service; a future load must revalidate it.
          try{await store.put('profile',previous??{id:'profile',version:1,disabled:true});state=previous;}catch{closed=true;}
          throw Error('FAMILY_DELEGATION_CHANGED');
        }
        return copy(next);
      });
    },
    async resolve(execution){
      return serial(async()=>{
        await load();const family=await ownerCall(execution);
        if(!family||!valid(state)||family.sessionId!==state.familySessionId||family.bindingRevision!==state.bindingRevision)return null;
        const scope={...copy(state),...(typeof family.userText==='string'?{userText:family.userText}:{}),...(typeof family.previousUserText==='string'?{previousUserText:family.previousUserText}:{})};return await recheck(scope)?scope:null;
      });
    },
    // Background wake paths may use only a scope captured from a verified
    // owner call, and must recheck it again immediately before each effect.
    ready:()=>serial(load),
    isUnpaired(){return loaded&&!closed&&state==null;},
    matchesSession(sessionId){return loaded&&valid(state)&&state.familySessionId===sessionId;},
    registeredSessionId(){return loaded&&valid(state)?state.familySessionId:null;},
    routeState,
    scopeFor(sessionId){const scope=copy(state);return scope?.familySessionId===sessionId&&current(scope)?scope:null;},
    current,recheck,
    close(){closed=true;return revocationWrite;},
  };
}
