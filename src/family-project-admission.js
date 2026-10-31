// Private capability adapter. Neither model flags nor project/session IDs can
// replace the Family bridge's exact active Owner-message authorization.
export function createFamilyProjectAdmission({getBridge,resolveTarget,isCurrent,recheck,isPaused,canCoordinate}={}){
 return{async acquire({scope,args,signal}={}){
  try{
   if(!scope||args?.userRequested!==true||typeof args.task!=='string'||!args.task.trim()||args.task!==args.task.trim()||args.task.length>2000||args.session!==undefined||typeof args.project!=='string'||!isCurrent(scope)||signal?.aborted||await isPaused())return null;
   const project=await resolveTarget(args.project);if(!project||!isCurrent(scope)||signal?.aborted)return null;
   const bridge=getBridge();if(typeof bridge?.acquireOwnerProjectAdmission!=='function')return null;
   const capability=await bridge.acquireOwnerProjectAdmission({sessionId:scope.familySessionId,bindingRevision:scope.bindingRevision,callId:scope.callId,root:project.root,task:args.task,...(signal?{signal}:{})});
   if(!capability||capability.root!==project.root||capability.task!==args.task||typeof capability.dedupeKey!=='string'||typeof capability.current!=='function'||typeof capability.recheck!=='function')return null;
   const current=()=>!signal?.aborted&&isCurrent(scope)&&capability.current()===true;
   const authorize=async()=>current()&&!await isPaused()&&await recheck(scope)&&await capability.recheck()===true&&current();
   if(!await authorize())return null;
   return{task:capability.task,project,meta:{ledgerKey:capability.dedupeKey,familyOrigin:capability.authority,resolveProject:async reference=>{const latest=await resolveTarget(reference);return current()&&latest?.root===project.root&&latest?.workspaceId===project.workspaceId?latest:null;},authorizeAdmission:authorize,authorizeAdmissionSync:current,authorizeProjectSync:input=>current()&&canCoordinate({...input,workspaceId:project.workspaceId})===true}};
  }catch{return null;}
 }};
}
