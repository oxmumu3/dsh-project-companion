import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {goalBoardRowSchema,freshGoalBoardRow,goalFragmentSchema,goalCoverageSchema,goalIdentitySchema,validateGoalBoardResult} from './goal-board-store.js';
import {cleanGoalSource} from './goal-board-collect.js';
export {goalBoardRowSchema} from './goal-board-store.js';

const error=code=>Object.assign(new Error(code),{code});
const fail=code=>{throw error(code);};
const clone=value=>structuredClone(value);
const revision=()=>randomUUID();
const bounded=(value,signal)=>{
 if(signal.aborted)return Promise.reject(signal.reason);
 return new Promise((resolve,reject)=>{const stop=()=>{signal.removeEventListener('abort',stop);reject(signal.reason);};signal.addEventListener('abort',stop,{once:true});Promise.resolve(value).then(result=>{signal.removeEventListener('abort',stop);signal.aborted?reject(signal.reason):resolve(result);},err=>{signal.removeEventListener('abort',stop);reject(signal.aborted?signal.reason:err);});});
};
const safeCodes=new Set(['GOAL_CANCELLED','GOAL_ABORTED','GOAL_ACCESS_CHANGED','GOAL_CHANGED','GOAL_CLOSED','GOAL_TIMEOUT','GOAL_COLLECT_INVALID','GOAL_LIMIT','MODEL_UNAVAILABLE','MODEL_INVALID_INPUT','MODEL_INVALID_OUTPUT','MODEL_ABORTED','MODEL_CLOSED','MODEL_TIMEOUT','MODEL_AUTHORIZATION_CHANGED','MODEL_REQUEST_FAILED','MODEL_TOKEN_LIMIT','MODEL_INCOMPLETE','MODEL_OUTPUT_LIMIT','MODEL_TOOL_OUTPUT']);
const codeOf=err=>safeCodes.has(err?.code)?err.code:'GOAL_RECOGNITION_FAILED';

/** Profile-owned logical objectives. No source reads occur except explicit recognition. */
export function createGoalBoard({store,access,collect,model,clock=()=>new Date(),createId=()=>`goal_${randomUUID()}`,isClosed=()=>false,timeoutMs=90000}={}){
 if(!store||!access||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>90000)fail('GOAL_ARGUMENT');
 let state,failed=false,closed=false,queue=Promise.resolve(),flight=null;const conversationOpens=new Map();
 const ensure=()=>{if(closed||isClosed())fail('GOAL_CLOSED');if(failed)fail('GOAL_STORE_UNAVAILABLE');};
 const now=()=>{const date=new Date(clock());if(!Number.isFinite(date.getTime()))fail('GOAL_ARGUMENT');return date.toISOString();};
 const put=async(next,{manual=false}={})=>{
  let parsed;try{parsed=goalBoardRowSchema.parse(next);}catch{fail('GOAL_LIMIT');}
  try{await store.put('profile',clone(parsed));state=parsed;if(manual)flight?.controller.abort(error('GOAL_CHANGED'));}catch{failed=true;fail('GOAL_STORE_UNAVAILABLE');}
 };
 const load=async()=>{
  if(state)return;if(failed)fail('GOAL_STORE_UNAVAILABLE');
  try{state=goalBoardRowSchema.parse(await store.get('profile')??freshGoalBoardRow());}catch{failed=true;fail('GOAL_STORE_UNAVAILABLE');}
  if(state.scan.phase==='running')await put({...state,revision:revision(),scan:{...state.scan,phase:'failed',code:'GOAL_INTERRUPTED'}});
 };
 const serial=(fn,{allowClosed=false}={})=>{const operation=queue.then(async()=>{if(!allowClosed)ensure();await load();return fn();});queue=operation.catch(()=>{});return operation;};
 const checkRevision=expected=>{if(!goalIdentitySchema.safeParse(expected).success)fail('GOAL_ARGUMENT');if(expected!==state.revision)fail('GOAL_CHANGED');};
 const args=(value,keys)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key)))fail('GOAL_ARGUMENT');return value;};
 const project=id=>{if(!goalIdentitySchema.safeParse(id).success)fail('GOAL_ARGUMENT');const value=state.projects.find(p=>p.id===id&&!p.ignored);if(!value)fail('GOAL_UNKNOWN');return value;};
 const capture=async()=>{try{return await access.capture();}catch{return null;}};
 const available=(e,snapshot)=>snapshot!==null&&e.accessRevision===snapshot.revision&&snapshot.grants.some(g=>g.id===e.grant.id&&g.workspaceId===e.workspaceId&&g.root===e.grant.root&&(e.sessionId===null||g.sessionIds.includes(e.sessionId)));
 const publicProject=(p,snapshot)=>{
  const evidence=p.evidenceIds.map(id=>state.evidence.find(e=>e.id===id)).filter(Boolean),visible=evidence.filter(e=>available(e,snapshot));
  const stale=p.stale||visible.length!==evidence.length;
  return{id:p.id,title:p.title,goal:p.goal,constraints:clone(p.constraints),state:p.state,lane:stale?'unknown':p.lane,progress:stale?null:p.progress,nextStep:stale?null:p.nextStep,evidenceCount:visible.length,sessionCount:new Set(visible.map(e=>e.sessionId).filter(Boolean)).size,workspaceCount:new Set(visible.map(e=>e.workspaceId)).size,stale,updatedAt:p.updatedAt};
 };
 const statusFor=snapshot=>({version:1,revision:state.revision,accessRevision:snapshot?.revision??null,projects:state.projects.filter(p=>!p.ignored).map(p=>publicProject(p,snapshot)),scan:clone(state.scan),standaloneCount:state.standaloneIds.filter(id=>state.evidence.some(e=>e.id===id&&available(e,snapshot))).length,uncertainCount:state.uncertainIds.filter(id=>state.evidence.some(e=>e.id===id&&available(e,snapshot))).length});
 const newProject=(title,goal,constraints=[])=>{
  const id=createId();if(!goalIdentitySchema.safeParse(id).success||state.projects.some(p=>p.id===id))fail('GOAL_ARGUMENT');
  return{id,key:id,title,goal,constraints,state:'confirmed',ignored:false,lane:'unknown',progress:null,nextStep:null,evidenceIds:[],stale:false,updatedAt:now(),conversation:null};
 };
 const checkAccess=async snapshot=>{ensure();try{if(await access.assertCurrent(snapshot)===false)fail('GOAL_ACCESS_CHANGED');}catch{fail('GOAL_ACCESS_CHANGED');}syncAccess(snapshot);};
 const syncAccess=snapshot=>{ensure();let allowed=false;try{allowed=access.authorizeSync(snapshot);}catch{}if(allowed!==true)fail('GOAL_ACCESS_CHANGED');return true;};
 async function guardedPut(next,snapshot){
  await checkAccess(snapshot);syncAccess(snapshot);const previous=clone(state);await put(next);
  try{await checkAccess(snapshot);syncAccess(snapshot);}catch(err){await put({...previous,revision:revision()});throw err;}
 }
 function validateCollected(value,snapshot){
  let parsed;try{parsed=z.object({fragments:z.array(goalFragmentSchema).max(40),coverage:z.array(goalCoverageSchema).max(1000),nextCursor:z.number().int().min(0).max(1000000).optional()}).strict().parse(value);}catch{fail('GOAL_COLLECT_INVALID');}
  if(new Set(parsed.fragments.map(f=>f.id)).size!==parsed.fragments.length||new Set(parsed.coverage.map(c=>c.workspaceId)).size!==parsed.coverage.length)fail('GOAL_COLLECT_INVALID');
  for(const fragment of parsed.fragments){
   const grant=snapshot.grants.find(g=>g.workspaceId===fragment.workspaceId);if(!grant||fragment.sessionId!==null&&!grant.sessionIds.includes(fragment.sessionId))fail('GOAL_COLLECT_INVALID');
   const prior=state.evidence.find(e=>e.id===fragment.id);if(prior&&(prior.workspaceId!==fragment.workspaceId||prior.sessionId!==fragment.sessionId||prior.kind!==fragment.kind||prior.reference!==fragment.reference||prior.grant.root!==grant.root))fail('GOAL_COLLECT_INVALID');
  }
  if(parsed.coverage.some(c=>!snapshot.grants.some(g=>g.workspaceId===c.workspaceId)))fail('GOAL_COLLECT_INVALID');
  return{fragments:parsed.fragments.map(f=>({...f,workspaceLabel:cleanGoalSource(f.workspaceLabel,200),reference:cleanGoalSource(f.reference,1000),text:cleanGoalSource(f.text,3000)})),coverage:parsed.coverage,nextCursor:parsed.nextCursor};
 }
 function applyResult(result,fragments,snapshot,coverage,cursor,preserveUntouched=false){
  const projects=clone(state.projects),locks=new Map(state.locks.map(lock=>[lock.evidenceId,lock.targetProjectId])),incoming=new Set(fragments.map(f=>f.id));
  const sourceOwners=new Map();for(const p of projects)for(const id of p.evidenceIds)sourceOwners.set(id,p.id);
  const assigned=new Map(),modelAssignments=new Map(),standalone=new Set(result.standaloneIds),uncertain=new Set(result.uncertainIds),updated=new Set();
  for(const group of result.groups){
   let target=group.projectId&&projects.find(p=>p.id===group.projectId);
   if(!target){const priorIds=[...new Set(group.evidenceIds.map(id=>sourceOwners.get(id)).filter(Boolean))];if(priorIds.length===1)target=projects.find(p=>p.id===priorIds[0]);}
   if(!target)target=projects.find(p=>p.key===group.key);
   const remaining=group.evidenceIds.filter(id=>!locks.has(id));
   if(!target&&new Set(remaining.map(id=>fragments.find(f=>f.id===id)).filter(source=>source&&source.kind!=='file').map(source=>source.sessionId).filter(Boolean)).size>=2){target={...newProject(group.title,group.goal),key:group.key,state:'proposed'};projects.push(target);}
   for(const id of group.evidenceIds){const owner=locks.has(id)?locks.get(id):target?.id??null;if(owner===null)standalone.add(id);else assigned.set(id,owner);}
   if(target&&!target.ignored){
    modelAssignments.set(target.id,new Set([...(modelAssignments.get(target.id)??[]),...group.evidenceIds]));
    if(target.state!=='confirmed'){target.title=group.title;target.goal=group.goal;}
    target.lane=group.lane;target.progress=group.progress;target.nextStep=group.nextStep;target.stale=false;target.updatedAt=now();updated.add(target.id);
   }
  }
  // Manual assignments win over every model partition, including standalone.
  for(const f of fragments)if(locks.has(f.id)){const owner=locks.get(f.id);standalone.delete(f.id);uncertain.delete(f.id);if(owner===null){assigned.delete(f.id);standalone.add(f.id);}else assigned.set(f.id,owner);}
  for(const p of projects){
   const before=[...p.evidenceIds],added=[...assigned].filter(([,owner])=>owner===p.id).map(([id])=>id);
   p.evidenceIds=[...new Set([...p.evidenceIds.filter(id=>!incoming.has(id)),...added])];
   const modelIds=modelAssignments.get(p.id),actualIds=new Set(added);
   const correctedGroup=modelIds&&(modelIds.size!==actualIds.size||[...modelIds].some(id=>!actualIds.has(id)));
   if(correctedGroup||!preserveUntouched&&!updated.has(p.id)&&p.evidenceIds.length){p.progress=null;p.nextStep=null;p.lane='unknown';p.stale=true;}
   if(before.some(id=>incoming.has(id)&&!p.evidenceIds.includes(id))){p.progress=null;p.nextStep=null;p.lane='unknown';p.stale=true;}
  }
  const protectedIds=new Set([...projects.filter(p=>!p.ignored).flatMap(p=>p.evidenceIds),...state.locks.map(lock=>lock.evidenceId),...state.standaloneIds,...state.uncertainIds,...incoming]);
  const evidence=state.evidence.filter(e=>!incoming.has(e.id)&&protectedIds.has(e.id));
  for(const f of fragments){const grant=snapshot.grants.find(g=>g.workspaceId===f.workspaceId);evidence.push({...f,grant:{id:grant.id,workspaceId:grant.workspaceId,root:grant.root},accessRevision:snapshot.revision});}
  return{...state,revision:revision(),accessRevision:snapshot.revision,projects,evidence,standaloneIds:[...new Set([...state.standaloneIds.filter(id=>!incoming.has(id)),...standalone])],uncertainIds:[...new Set([...state.uncertainIds.filter(id=>!incoming.has(id)),...uncertain])],scan:{phase:'complete',at:now(),scopeRevision:snapshot.revision,coverage,...(cursor!==undefined?{cursor}:{cursor:state.scan.cursor??0})}};
 }
 // The captured board revision is part of the running intent, just like access.
 // Check it at IO/model boundaries as well as the serialized commit boundary.
 const checkJobRevision=job=>{job.controller.signal.throwIfAborted();ensure();if(state.revision!==job.revision)fail('GOAL_CHANGED');};
 const checkJob=async job=>{checkJobRevision(job);await checkAccess(job.snapshot);checkJobRevision(job);};
 const authorizeJob=job=>{checkJobRevision(job);return syncAccess(job.snapshot);};
 async function run(job){
  let coverage=[];
  try{
   if(typeof collect!=='function'||typeof model?.recognize!=='function')fail('GOAL_COLLECT_INVALID');
   do{
    await bounded(checkJob(job),job.controller.signal);syncAccess(job.snapshot);
    await serial(()=>{job.controller.signal.throwIfAborted();if(state.revision!==job.revision)fail('GOAL_CHANGED');});
    const workspaceIds=job.sweep?job.snapshot.grants.slice(job.processed,job.processed+8).map(g=>g.workspaceId):undefined;
    const raw=await bounded(Promise.resolve().then(()=>{checkJobRevision(job);return collect(clone(job.snapshot),{signal:job.controller.signal,cursor:job.cursor,guard:()=>checkJobRevision(job),...(job.sweep?{workspaceIds}:{})});}),job.controller.signal);
    await bounded(checkJob(job),job.controller.signal);const data=validateCollected(raw,job.snapshot);
    if(job.sweep&&(data.coverage.length!==workspaceIds.length||data.coverage.some(c=>!workspaceIds.includes(c.workspaceId))||data.fragments.some(f=>!workspaceIds.includes(f.workspaceId))))fail('GOAL_COLLECT_INVALID');
    if(!job.sweep)coverage=data.coverage;
    const inputIds=new Set(data.fragments.map(f=>f.id));
    const existingProjects=state.projects.map(({id,title,goal,constraints,state,ignored,evidenceIds})=>({id,title,goal,constraints,state,ignored,evidenceIds:evidenceIds.filter(id=>inputIds.has(id))}));
    const result=await bounded(Promise.resolve().then(()=>{checkJobRevision(job);return model.recognize({fragments:clone(data.fragments),existingProjects:clone(existingProjects),signal:job.controller.signal,guard:()=>checkJob(job),authorizeSync:()=>authorizeJob(job)});}),job.controller.signal);
    await bounded(checkJob(job),job.controller.signal);const validated=validateGoalBoardResult(result,data.fragments,existingProjects);
    await serial(async()=>{
     job.controller.signal.throwIfAborted();if(state.revision!==job.revision)fail('GOAL_CHANGED');
     const nextCoverage=job.sweep?[...coverage,...data.coverage]:coverage,processed=job.processed+(workspaceIds?.length??0);
     const next=applyResult(validated,data.fragments,job.snapshot,nextCoverage,data.nextCursor,job.sweep&&job.processed>0);
     if(job.sweep)next.scan={...next.scan,phase:processed<job.snapshot.grants.length?'running':'complete',processed,total:job.snapshot.grants.length};
     await guardedPut(next,job.snapshot);job.revision=state.revision;job.revisions.add(state.revision);job.cursor=data.nextCursor??job.cursor;job.processed=processed;coverage=nextCoverage;
    });
   }while(job.sweep&&job.processed<job.snapshot.grants.length);
  }catch(err){
   const code=codeOf(err);await serial(async()=>{if(failed)return;await put({...state,revision:revision(),scan:{phase:'failed',at:now(),scopeRevision:job.snapshot.revision,coverage:job.sweep?coverage:code==='GOAL_ACCESS_CHANGED'?[]:coverage,code,...(state.scan.cursor!==undefined?{cursor:state.scan.cursor}:{}),...(job.sweep?{processed:job.processed,total:job.snapshot.grants.length}:{})}});},{allowClosed:true}).catch(()=>{});
  }finally{clearTimeout(job.timer);job.signal?.removeEventListener('abort',job.stop);if(flight===job)flight=null;}
 }
 const unsubscribe=typeof access.subscribe==='function'?access.subscribe(()=>{flight?.controller.abort(error('GOAL_ACCESS_CHANGED'));}):null;
 return{
  status:()=>serial(async()=>statusFor(await capture())),
  detail:input=>serial(async()=>{args(input,['projectId']);const p=project(input.projectId),snapshot=await capture();return{version:1,revision:state.revision,accessRevision:snapshot?.revision??null,project:publicProject(p,snapshot),evidence:p.evidenceIds.map(id=>state.evidence.find(e=>e.id===id)).filter(Boolean).map(e=>{const{grant,accessRevision,...publicEvidence}=e;const allowed=available(e,snapshot);return{...publicEvidence,text:allowed?e.text:'',available:allowed};}),conversation:clone(p.conversation)};}),
  startRecognition:input=>serial(async()=>{
   args(input,['expectedRevision','expectedAccessRevision','signal','sweep']);if(input.sweep!==undefined&&typeof input.sweep!=='boolean')fail('GOAL_ARGUMENT');const snapshot=await capture();if(!snapshot||input.expectedAccessRevision!==snapshot.revision)fail('GOAL_ACCESS_CHANGED');
   if(flight&&(input.expectedRevision===flight.previousRevision||input.expectedRevision===state.revision))return statusFor(snapshot);
   checkRevision(input.expectedRevision);await checkAccess(snapshot);if(input.signal?.aborted)fail('GOAL_ARGUMENT');
   const previousRevision=state.revision,sweep=input.sweep===true,cursor=sweep?0:state.scan.cursor??0;if(sweep&&snapshot.grants.length>1000)fail('GOAL_LIMIT');await guardedPut({...state,revision:revision(),scan:{phase:'running',at:now(),scopeRevision:snapshot.revision,coverage:[],cursor,...(sweep?{processed:0,total:snapshot.grants.length}:{})}},snapshot);
   const controller=new AbortController(),job={snapshot,revision:state.revision,revisions:new Set([state.revision]),previousRevision,cursor,sweep,processed:0,controller,signal:input.signal};job.stop=()=>controller.abort(error('GOAL_ABORTED'));input.signal?.addEventListener('abort',job.stop,{once:true});job.timer=setTimeout(()=>controller.abort(error('GOAL_TIMEOUT')),timeoutMs);flight=job;job.promise=Promise.resolve().then(()=>run(job));return statusFor(snapshot);
  }),
  cancelRecognition:input=>serial(async()=>{
   args(input,['expectedRevision','expectedAccessRevision']);const snapshot=await capture();if(!snapshot||input.expectedAccessRevision!==snapshot.revision)fail('GOAL_ACCESS_CHANGED');
   if(!goalIdentitySchema.safeParse(input.expectedRevision).success)fail('GOAL_ARGUMENT');
   // Displayed revisions from this job remain cancellable across its own batch commits.
   // A different job, an accepted manual change, or new access cannot reuse that intent.
   if(flight){if(state.revision!==flight.revision||!flight.revisions.has(input.expectedRevision))fail('GOAL_CHANGED');if(snapshot.revision!==flight.snapshot.revision)fail('GOAL_ACCESS_CHANGED');await checkAccess(flight.snapshot);}
   else checkRevision(input.expectedRevision);
   await checkAccess(snapshot);flight?.controller.abort(error('GOAL_CANCELLED'));return statusFor(snapshot);
  }),
  accept:input=>serial(async()=>{args(input,['projectId','expectedRevision']);checkRevision(input.expectedRevision);const p=project(input.projectId);const next=clone(state);next.projects.find(row=>row.id===p.id).state='confirmed';next.projects.find(row=>row.id===p.id).updatedAt=now();await put({...next,revision:revision()},{manual:true});return statusFor(await capture());}),
  ignore:input=>serial(async()=>{args(input,['projectId','expectedRevision']);checkRevision(input.expectedRevision);const p=project(input.projectId),next=clone(state);next.projects.find(row=>row.id===p.id).ignored=true;next.projects.find(row=>row.id===p.id).updatedAt=now();next.locks=next.locks.filter(lock=>!p.evidenceIds.includes(lock.evidenceId));next.locks.push(...p.evidenceIds.map(evidenceId=>({evidenceId,targetProjectId:p.id})));await put({...next,revision:revision()},{manual:true});return statusFor(await capture());}),
  correct:input=>serial(async()=>{
   args(input,['projectId','evidenceId','targetProjectId','expectedRevision']);checkRevision(input.expectedRevision);const p=project(input.projectId);if(!p.evidenceIds.includes(input.evidenceId))fail('GOAL_ARGUMENT');if(input.targetProjectId!==null)project(input.targetProjectId);
   const next=clone(state);next.locks=next.locks.filter(lock=>lock.evidenceId!==input.evidenceId);next.locks.push({evidenceId:input.evidenceId,targetProjectId:input.targetProjectId});
   for(const row of next.projects)if(row.id===p.id||row.id===input.targetProjectId){row.evidenceIds=row.evidenceIds.filter(id=>id!==input.evidenceId);if(row.id===input.targetProjectId)row.evidenceIds.push(input.evidenceId);row.progress=null;row.nextStep=null;row.lane='unknown';row.stale=true;row.updatedAt=now();}
   next.standaloneIds=next.standaloneIds.filter(id=>id!==input.evidenceId);next.uncertainIds=next.uncertainIds.filter(id=>id!==input.evidenceId);if(input.targetProjectId===null)next.standaloneIds.push(input.evidenceId);await put({...next,revision:revision()},{manual:true});return statusFor(await capture());
  }),
  vision:input=>serial(async()=>{
   args(input,['projectId','title','goal','constraints','expectedRevision']);checkRevision(input.expectedRevision);let vision;try{vision=z.object({title:z.string().trim().min(1).max(120),goal:z.string().trim().min(1).max(1200),constraints:z.array(z.string().trim().min(1).max(300)).max(12)}).strict().parse({title:input.title,goal:input.goal,constraints:input.constraints});}catch{fail('GOAL_ARGUMENT');}
   const next=clone(state);if(input.projectId===null)next.projects.push(newProject(vision.title,vision.goal,vision.constraints));else{const prior=project(input.projectId),changed=prior.title!==vision.title||prior.goal!==vision.goal||JSON.stringify(prior.constraints)!==JSON.stringify(vision.constraints);Object.assign(next.projects.find(p=>p.id===input.projectId),vision,{state:'confirmed',updatedAt:now()},changed?{progress:null,nextStep:null,lane:'unknown',stale:true}:{});}
   await put({...next,revision:revision()},{manual:true});return statusFor(await capture());
  }),
  conversation:(input,{create,verify}={})=>serial(async()=>{
   args(input,['projectId','expectedRevision']);const p=project(input.projectId);if(typeof verify!=='function'||typeof create!=='function')fail('GOAL_CONVERSATION_UNAVAILABLE');
   // Idempotent opens with the original card revision coalesce after creation.
   const open=conversationOpens.get(p.id);if(!p.conversation||input.expectedRevision!==state.revision&&!(open?.before===input.expectedRevision&&open.after===state.revision))checkRevision(input.expectedRevision);
   try{
    let link=p.conversation;if(link){if(await verify(link.sessionId,{projectId:p.id,linked:true})!==true)fail('GOAL_CONVERSATION_UNAVAILABLE');}
    else{const created=await create({projectId:p.id,title:p.title,goal:p.goal,constraints:clone(p.constraints)}),sessionId=typeof created==='string'?created:created?.sessionId;if(!goalIdentitySchema.safeParse(sessionId).success||state.projects.some(row=>row.conversation?.sessionId===sessionId)||await verify(sessionId,{projectId:p.id,linked:false})!==true)fail('GOAL_CONVERSATION_UNAVAILABLE');ensure();link={sessionId,revision:`native:${sessionId}`};const next=clone(state),before=state.revision;next.projects.find(row=>row.id===p.id).conversation=link;await put({...next,revision:revision()},{manual:true});conversationOpens.set(p.id,{before,after:state.revision});}
    return{version:1,projectId:p.id,conversation:clone(link)};
   }catch(err){if(err?.code==='GOAL_STORE_UNAVAILABLE'||err?.code==='GOAL_CLOSED')throw err;fail('GOAL_CONVERSATION_UNAVAILABLE');}
  }),
  getContextForSession:sessionId=>serial(async()=>{if(!goalIdentitySchema.safeParse(sessionId).success)return null;const p=state.projects.find(row=>!row.ignored&&row.conversation?.sessionId===sessionId);return p?{projectId:p.id,title:p.title,goal:p.goal,constraints:clone(p.constraints)}:null;}),
  close(){if(closed)return;closed=true;flight?.controller.abort(error('GOAL_CLOSED'));if(typeof unsubscribe==='function')unsubscribe();},
  async waitForIdle(){await queue;while(flight){await flight.promise;await queue;}},
 };
}
