import {reviewInstant} from './personal-review-ledger.js';

// Like project quote candidates: select a source-bound ID, never synthesize time.
// A timestamp occurring in text is not proof that it is a task deadline.
export function reviewDeadlineCatalog(evidence,{maxChars=20000}={}){
 if(!Number.isSafeInteger(maxChars)||maxChars<2||maxChars>20000)throw new RangeError('Invalid deadline catalogue budget');
 const pools=evidence.filter(e=>e.source!=='calendar').map(e=>({evidenceId:e.id,values:[...new Set([e.dueAt,...Array.from(e.text.matchAll(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z/gu),m=>m[0])].filter(value=>reviewInstant.safeParse(value).success))]}));
 const candidates=[];let size=2,truncated=false;
 // Round robin avoids one long document consuming all candidate positions.
 for(let i=0;i<Math.max(0,...pools.map(p=>p.values.length));i++)for(const pool of pools){
  const dueAt=pool.values[i];if(dueAt===undefined)continue;
  const candidate={deadlineId:`d${candidates.length+1}`,evidenceId:pool.evidenceId,dueAt};
  const cost=JSON.stringify(candidate).length+(candidates.length?1:0);
  if(candidates.length>=160||size+cost>maxChars){truncated=true;continue;}
  candidates.push(candidate);size+=cost;
 }
 return{candidates,truncated};
}

export function resolveReviewDeadlines(value,candidates){
 if(!value||!Array.isArray(value.items))return value;
 const known=new Map(candidates.map(candidate=>[candidate.deadlineId,candidate]));
 return{...value,items:value.items.map(item=>{
  if(!item||typeof item!=='object'||!Object.hasOwn(item,'deadlineId'))return item;
  const candidate=typeof item.deadlineId==='string'?known.get(item.deadlineId):undefined;
  if(!candidate||Object.hasOwn(item,'dueAt')||!Array.isArray(item.evidenceIds)||!item.evidenceIds.includes(candidate.evidenceId))throw Object.assign(new Error('Invalid deadline selection'),{reviewValidationRule:'deadline_without_source'});
  const{deadlineId,...rest}=item;return{...rest,dueAt:candidate.dueAt};
 })};
}
