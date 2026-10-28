import {createHash} from 'node:crypto';
import {familyDelegationBinding} from './family-owner-delegation.js';

const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const owner=value=>typeof value==='string'&&/^family_owner_[A-Za-z0-9._:-]+$/.test(value)&&value.length<=200;
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Passive UI route only: it cannot pair, resume a session or grant tool actions. */
export function createFamilyWorkbenchConnection({isEnabled,readLegacyConnection,delegation,readNativeRoute}={}){
  if(typeof isEnabled!=='function'||typeof readLegacyConnection!=='function'||typeof readNativeRoute!=='function'||!delegation)throw Error('FAMILY_WORKBENCH_CONFIGURATION');
  return async()=>{
    if(!isEnabled()||delegation.isUnpaired()===true)return readLegacyConnection();
    // A prior pairing which is offline or revoked must never adopt the legacy
    // route, which could now belong to another Owner.
    try{
      const sessionId=delegation.registeredSessionId();
      if(!owner(sessionId))return{state:'unknown',readOnly:true};
      const scope=structuredClone(delegation.scopeFor(sessionId));
      if(scope?.familySessionId!==sessionId||!hex(scope.bindingRevision)||!hex(scope.leaseFingerprint))return{state:'unknown',readOnly:true};
      const current=()=>isEnabled()&&delegation.registeredSessionId()===sessionId&&delegation.current(scope)===true&&delegation.routeState({sessionId,bindingRevision:scope.bindingRevision})==='current';
      if(!current()||!await delegation.recheck(scope)||!current())return{state:'unknown',readOnly:true};
      const native=await readNativeRoute(sessionId);
      const binding=familyDelegationBinding(scope);
      if(!current()||!binding||native?.kind!=='bound'||native.binding?.userHash!==binding.userHash||native.binding?.botHash!==binding.botHash)return{state:'unknown',readOnly:true};
      if(!await delegation.recheck(scope)||!current())return{state:'unknown',readOnly:true};
      return{state:'bound',sessionId,bindingKey:digest(['dsh-dot-family-workbench-v1',sessionId,scope.bindingRevision,scope.leaseFingerprint]),readOnly:true};
    }catch{return{state:'unknown',readOnly:true};}
  };
}
