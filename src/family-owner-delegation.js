import {createHash} from 'node:crypto';

const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const identity=value=>typeof value==='string'&&value.length>0&&value.length<=200;
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const copy=value=>value===undefined?undefined:structuredClone(value);
const renewalText='更新这个微信的 Dot 资料授权，使用我在电脑上启用的来源。';

// Old profiles keep their original binding until an explicit renewal. Renewed
// profiles get a new delivery epoch, so old jobs/plans cannot borrow new scope.
export function familyDelegationBinding(scope){
  if(!hex(scope?.bindingRevision)||scope.grantRevision!==undefined&&!hex(scope.grantRevision))return null;
  return{userHash:scope.bindingRevision,botHash:createHash('sha256').update('family-dot:'+scope.bindingRevision+(scope.grantRevision?':'+scope.grantRevision:'')).digest('hex')};
}

/**
 * Private integration primitive, not a model-facing pairing tool.
 * Call pair only under a separately authorized local setup action. The Family
 * service must verify the exact active Owner WeChat tool call independently;
 * an apparent owner session ID alone is not an identity assertion.
 */
export function createFamilyOwnerDelegation({store,getBridge,readGrantedLeases,readGrantedLeasesSync,readLegacySetup=async()=>({state:'unknown'})}={}){
  if(!store||typeof getBridge!=='function'||typeof readGrantedLeases!=='function'||typeof readGrantedLeasesSync!=='function')throw Error('FAMILY_DELEGATION_CONFIGURATION');
  let state,loaded=false,closed=false,generation=0,queue=Promise.resolve(),writes=Promise.resolve(),revocationWrite=Promise.resolve();
  const serial=fn=>{const next=queue.then(fn);queue=next.catch(()=>{});return next;};
  // Revocation can happen synchronously outside serial. All durable writes
  // share this queue so an in-flight grant write cannot overtake revocation.
  const write=(value,guard=()=>true)=>{const next=writes.then(async()=>{if(!guard())throw Error('FAMILY_DELEGATION_CHANGED');await store.put('profile',copy(typeof value==='function'?value():value));});writes=next.catch(()=>{});return next;};
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
  function valid(row){return row?.id==='profile'&&row.version===1&&identity(row.familySessionId)&&hex(row.bindingRevision)&&identity(row.originSessionId)&&hex(row.originBindingKey)&&hex(row.leaseFingerprint)&&(row.grantRevision===undefined||hex(row.grantRevision));}
  function revoke(){
    if(closed||!valid(state))return revocationWrite;
    const revoked={id:'profile',version:1,disabled:true};state=revoked;generation++;
    revocationWrite=write(revoked).catch(()=>{closed=true;generation++;});
    return revocationWrite;
  }
  function routeState({sessionId,bindingRevision}={}){
    if(closed||!loaded)return'unknown';
    if(state?.disabled===true)return'changed';
    if(!valid(state))return'unknown';
    if(sessionId!==state.familySessionId||bindingRevision!==state.bindingRevision)return'changed';
    let status;
    try{
      status=getBridge()?.ownerRouteStatus?.({sessionId,bindingRevision});
      if(!['current','offline','changed','unknown'].includes(status))return'unknown';
      if(status==='changed'){void revoke();return'changed';}
    }catch{return'unknown';}
    let rows,leases;try{rows=readGrantedLeasesSync();leases=select(rows,state.originSessionId);}catch(error){return error?.code==='CONTEXT_BINDING_CHANGED'?'changed':'unknown';}
    // A credential/grant update must stop old plans without destroying the
    // verified Owner identity needed for a new explicit recovery request.
    // A positively different origin/binding is still permanent revocation.
    if(Array.isArray(rows)&&rows.some(row=>row?.sessionId!==state.originSessionId||row?.bindingKey!==state.originBindingKey)){void revoke();return'changed';}
    if(!leases||leases.originBindingKey!==state.originBindingKey||leases.leaseFingerprint!==state.leaseFingerprint)return'changed';
    return status;
  }
  function current(scope){
    if(closed||!valid(state)||!scope||scope.familySessionId!==state.familySessionId||scope.bindingRevision!==state.bindingRevision||scope.originSessionId!==state.originSessionId||scope.originBindingKey!==state.originBindingKey||scope.leaseFingerprint!==state.leaseFingerprint||scope.grantRevision!==state.grantRevision)return false;
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
  const sameOwner=(a,b)=>a?.sessionId===b?.sessionId&&a?.bindingRevision===b?.bindingRevision;
  const requested=family=>family?.userText===renewalText;
  const fresh=family=>family?.sourceTimingState==='fresh'&&identity(family?.sourceRequestId);
  function strictLeases(rows,previous){
    if(!Array.isArray(rows)||rows.some(row=>row?.sessionId!==previous.originSessionId||row?.bindingKey!==previous.originBindingKey))return null;
    const selected=select(rows,previous.originSessionId);
    return selected?.originBindingKey===previous.originBindingKey?selected:null;
  }
  // Called only inside serial; never call the public pair from a renewal.
  async function pairTransaction({execution,originSessionId,family,renew=false}){
    const previous=state,admitted=generation;
    const unchanged=()=>!closed&&!execution?.signal?.aborted&&generation===admitted&&state===previous;
    const assertUnchanged=()=>{if(!unchanged())throw Error(closed?'FAMILY_DELEGATION_CLOSED':'FAMILY_DELEGATION_CHANGED');};
    const acceptOwner=actual=>sameOwner(actual,family)&&(!renew||(requested(actual)&&fresh(actual)&&actual.sourceRequestId===family.sourceRequestId));
    const selectRows=rows=>renew?strictLeases(rows,previous):select(rows,originSessionId);
    let rows;
    try{rows=await readGrantedLeases();}catch{assertUnchanged();throw Error(renew?'FAMILY_DELEGATION_SOURCES_NOT_READY':'FAMILY_DELEGATION_AUTHORITY_UNAVAILABLE');}
    assertUnchanged();
    const leases=selectRows(rows);
    if(!family||!leases)throw Error(renew?'FAMILY_DELEGATION_SOURCES_NOT_READY':'FAMILY_DELEGATION_AUTHORITY_UNAVAILABLE');
    const checkLegacy=async()=>{
      let legacy;try{legacy=await readLegacySetup();}catch{legacy={state:'unknown'};}
      assertUnchanged();
      if(leases.originSessionId!=='family-no-legacy'&&legacy?.state==='bound'&&(legacy.sessionId!==leases.originSessionId||legacy.bindingKey!==leases.originBindingKey))throw Error('FAMILY_DELEGATION_LEGACY_CHANGED');
    };
    await checkLegacy();
    const next={id:'profile',version:1,familySessionId:family.sessionId,bindingRevision:family.bindingRevision,...leases,...(previous?.grantRevision?{grantRevision:previous.grantRevision}:{})};
    const effective=()=>{try{const actual=selectRows(readGrantedLeasesSync());return actual?.originBindingKey===leases.originBindingKey&&actual?.leaseFingerprint===leases.leaseFingerprint&&getBridge()?.isOwnerRevisionCurrent?.(family.sessionId,family.bindingRevision)===true;}catch{return false;}};
    const again=await ownerCall(execution);assertUnchanged();
    if(!acceptOwner(again)||!effective())throw Error('FAMILY_DELEGATION_CHANGED');
    if(renew&&previous.leaseFingerprint===next.leaseFingerprint)return{status:'current',sources:rows.map(row=>({id:row.source,state:'enabled'}))};
    if(renew)next.grantRevision=hash(['family-grant-renewal-v1',previous.grantRevision??null,previous.leaseFingerprint,next.leaseFingerprint]);
    let started=false;
    try{
      await write(()=>{started=true;return next;},()=>unchanged()&&effective());
      assertUnchanged();
      const after=await ownerCall(execution);assertUnchanged();
      if(!acceptOwner(after)||!effective())throw Error('FAMILY_DELEGATION_CHANGED');
      let actual;try{actual=selectRows(await readGrantedLeases());}catch{actual=null;}
      assertUnchanged();
      if(!actual||actual.leaseFingerprint!==leases.leaseFingerprint||!effective())throw Error('FAMILY_DELEGATION_CHANGED');
      await checkLegacy();
      const final=await ownerCall(execution);assertUnchanged();
      if(!acceptOwner(final)||!effective())throw Error('FAMILY_DELEGATION_CHANGED');
      state=next;generation++;
      return renew?{status:'renewed',sources:rows.map(row=>({id:row.source,state:'enabled'}))}:copy(next);
    }catch(error){
      if(started){
        // Snapshot current state at execution time, never restore a captured
        // valid row over revoke/close. A concurrent revoke queues after this.
        try{await write(()=>state??{id:'profile',version:1,disabled:true});}catch{closed=true;generation++;}
      }
      throw error;
    }
  }
  return{
    async pair({execution,originSessionId,userAuthorized}={}){
      if(userAuthorized!==true)throw Error('FAMILY_DELEGATION_EXPLICIT_AUTHORIZATION_REQUIRED');
      return serial(async()=>{
        await load();await revocationWrite;if(closed)throw Error('FAMILY_DELEGATION_CLOSED');
        const family=await ownerCall(execution);
        if(!family)throw Error('FAMILY_DELEGATION_AUTHORITY_UNAVAILABLE');
        return pairTransaction({execution,originSessionId,family});
      });
    },
    async renewIfRequested({execution,wake=false}={}){
      if(wake)return null;
      return serial(async()=>{
        await load();await revocationWrite;
        const admitted=generation,previous=state,family=await ownerCall(execution);
        if(!requested(family))return null;
        if(closed||generation!==admitted||state!==previous||!valid(previous)||previous.disabled===true||family.sessionId!==previous.familySessionId||family.bindingRevision!==previous.bindingRevision)throw Error('FAMILY_DELEGATION_CHANGED');
        if(!fresh(family))throw Error('FAMILY_DELEGATION_FRESH_REQUEST_REQUIRED');
        return pairTransaction({execution,originSessionId:previous.originSessionId,family,renew:true});
      });
    },
    async resolve(execution){
      return serial(async()=>{
        await load();const family=await ownerCall(execution);
        if(!family||!valid(state)||family.sessionId!==state.familySessionId||family.bindingRevision!==state.bindingRevision)return null;
        const scope={...copy(state),...(typeof family.userText==='string'?{userText:family.userText}:{}),...(typeof family.previousUserText==='string'?{previousUserText:family.previousUserText}:{}),...(/^[a-f0-9]{64}$/.test(family.previousReviewViewToken??'')?{previousReviewViewToken:family.previousReviewViewToken}:{}),...(typeof family.sourceRequestId==='string'?{sourceRequestId:family.sourceRequestId}:{}),...(family.sourceTiming&&typeof family.sourceTiming==='object'?{sourceTiming:copy(family.sourceTiming)}:{}),...(typeof family.sourceTimingState==='string'?{sourceTimingState:family.sourceTimingState}:{})};return await recheck(scope)?scope:null;
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
    close(){closed=true;generation++;return queue.then(()=>writes);},
  };
}
