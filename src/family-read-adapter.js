import {isAbsolute,resolve} from 'node:path';

// Delegates only a verified Family Owner's bounded, independent read job.
// The Family bridge owns its durable receipt and sole outbound message.
export function createFamilyReadAdapter({getBridge,isCurrent,authorizeRoot,recheck}={}){
 if([getBridge,isCurrent,authorizeRoot,recheck].some(fn=>typeof fn!=='function'))throw new Error('FAMILY_READ_CONFIGURATION');
 const scopeValid=scope=>typeof scope?.familySessionId==='string'&&scope.familySessionId.length>0&&/^[a-f0-9]{64}$/.test(scope.bindingRevision);
 const current=scope=>{try{return scopeValid(scope)&&isCurrent(scope)===true;}catch{return false;}};
 const denied=()=>({status:'blocked',accepted:false,text:'这项独立只读检查暂不能安全开始；未派发任务。'});
 const allowed=fn=>{try{return typeof fn==='function'&&fn()===true;}catch{return false;}};
 return{
  async start({scope,root,requestId,reference,authorizeAdmission,authorizeAdmissionSync,authorizeDelivery,authorizeRegisteredRoot}={}){
   try{
    if(!current(scope)||typeof scope.callId!=='string'||!scope.callId||typeof root!=='string'||!isAbsolute(root)||resolve(root)!==root||typeof requestId!=='string'||!requestId||requestId.length>200||reference!==undefined&&(typeof reference!=='string'||reference.length>3000)||typeof authorizeDelivery!=='function')return denied();
    // Only an internal registry guard can replace the watched-project guard
    // for an explicit one-off read. Model arguments cannot supply callbacks.
    if(authorizeRegisteredRoot!==undefined&&typeof authorizeRegisteredRoot!=='function')return denied();
    const rootGuard=authorizeRegisteredRoot??authorizeRoot;
    if(!await rootGuard(root)||!await recheck(scope)||!current(scope))return denied();
    if(typeof authorizeAdmission==='function'&&!await authorizeAdmission())return denied();
    const authorize=()=>current(scope)&&allowed(authorizeDelivery);
    const bridge=getBridge();if(!authorize()||authorizeAdmissionSync!==undefined&&!allowed(authorizeAdmissionSync)||typeof bridge?.startOwnerProjectRead!=='function')return denied();
    const result=await bridge.startOwnerProjectRead({sessionId:scope.familySessionId,bindingRevision:scope.bindingRevision,callId:scope.callId,requestId,root,...(reference===undefined?{}:{reference}),authorize});
    if(result?.accepted===true&&typeof result.jobId==='string'&&result.jobId.startsWith('family-read-'))return{...result,text:'已安排独立只读检查，不会改动原项目会话；完成后回到当前微信。接收不等于执行完成。'};
    return result?.accepted===false?result: {status:'unknown',accepted:false,text:'只读检查的接收状态待核对，不会自动重复派发。'};
   }catch{return{status:'unknown',accepted:false,text:'只读检查的接收状态待核对，不会自动重复派发。'};}
  },
  async read({scope,id}={}){
   try{if(!current(scope)||typeof id!=='string'||!id.startsWith('family-read-')||!await recheck(scope)||!current(scope))return null;
    const bridge=getBridge();if(typeof bridge?.readOwnerProjectRead!=='function')return null;
    const result=await bridge.readOwnerProjectRead({sessionId:scope.familySessionId,bindingRevision:scope.bindingRevision,jobId:id,authorize:()=>current(scope)});
    return current(scope)&&result?.id===id?result:null;
   }catch{return null;}
  },
 };
}
