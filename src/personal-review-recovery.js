import {localProjection,makeLocalFormatter} from '../vendor/proactive/lib/domain.js';

const GAP=30*60000,DAY=86400000;
export const RECOVERY_CHECKPOINT_INTERVAL=5*60000;
export function recoveryWorkTime({now,timeZone,startHour=9,endHour=19}){
 const local=localProjection(makeLocalFormatter(timeZone),now.getTime());
 return local.hour>=startHour&&local.hour<endHour;
}

/** Pure resume admission. It never changes grants, sends or replays an old slot. */
export function recoveryCheck({now,key,previous,availability,enabled,timeZone,startHour=9,endHour=19,occurrences=[],remaining=0,regularDue=false}={}){
 const epoch=now.getTime(),at=now.toISOString();
 if(!enabled)return{observation:null,check:null};
 const prior=previous?.key===key&&Date.parse(previous.observedAt)<=epoch?previous:null;
 const observation={key,observedAt:at,offlineSince:null,blocked:false};
 if(availability==='offline'){
  observation.offlineSince=prior&&!prior.blocked?(prior.offlineSince??prior.observedAt):null;
  observation.blocked=!prior||prior.blocked;
  return{observation,check:null};
 }
 if(availability!=='current'){observation.blocked=true;return{observation,check:null};}
 if(!prior||prior.blocked)return{observation,check:null};
 const since=prior.offlineSince??prior.observedAt;
 if(epoch-Date.parse(since)<GAP)return{observation,check:null};
 const local=localProjection(makeLocalFormatter(timeZone),epoch);
 if(!recoveryWorkTime({now,timeZone,startHour,endHour})){observation.offlineSince=since;return{observation,check:null};}
 // A normally due review already performs a fresh read. Do not double-run it.
 if(regularDue)return{observation,check:null,regularRecovery:{since,coverageUnknown:epoch-Date.parse(since)>7*DAY}};
 if(remaining<=0)return{observation,check:null};
 const date=`${local.year}-${String(local.month).padStart(2,'0')}-${String(local.day).padStart(2,'0')}`;
 const id=`recovery:${date}:${key.slice(0,32)}`;
 if(occurrences.includes(id))return{observation,check:null};
 return{observation,check:{id,since,coverageUnknown:epoch-Date.parse(since)>7*DAY}};
}

export function recoveryWindow({from,to,check}){
 if(!check)return{from,coverageUnknown:false};
 const end=Date.parse(to),start=Math.min(Date.parse(from),Date.parse(check.since));
 return{from:new Date(Math.max(end-7*DAY,start)).toISOString(),coverageUnknown:check.coverageUnknown||start<end-7*DAY};
}
