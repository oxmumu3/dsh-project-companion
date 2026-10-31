import {createHash} from 'node:crypto';
import {readProjectFiles,PROJECT_FILES} from './sources.js';
const MAX_FRAGMENTS=40,MAX_CHARS=100000,MAX_WORKSPACES=8,MAX_SESSIONS=4;
const hash=value=>createHash('sha256').update(value).digest('hex').slice(0,32);
const stamp=v=>{const n=typeof v==='number'?v:Date.parse(v);return Number.isFinite(n)?new Date(n).toISOString():null;};
export function cleanGoalSource(value,max=3000){
 let text=String(value??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'');
 text=text.replace(/\bBearer\s+[A-Za-z0-9._~+/-]{1,}/gi,'[已隐藏]').replace(/((?:["']?)(?:access[_-]?token|refresh[_-]?token|api[_-]?key|client[_-]?secret|password|authorization)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi,'$1[已隐藏]').replace(/\b(?:sk-|ghp_|gho_|github_pat_|AIza)[A-Za-z0-9_-]{12,}/g,'[已隐藏]');
 return text.slice(0,max).replace(/[\uD800-\uDBFF]$/,'');
}
/** Explicit read only; never activates Agents, mutates plans or sends results. */
export function createGoalBoardCollector({access,readProject=readProjectFiles,listSessions=async()=>[],readSession}={}){
 return async function collect(snapshot,{signal,cursor=0}={}){
  const check=async()=>{signal?.throwIfAborted();await access.assertCurrent(snapshot);signal?.throwIfAborted();};await check();
  if(!Number.isSafeInteger(cursor)||cursor<0)throw Error('GOAL_ARGUMENT');
  if(!snapshot.grants.length)return{fragments:[],coverage:[],nextCursor:0};
  const start=cursor%snapshot.grants.length,chosen=[];for(let i=0;i<Math.min(MAX_WORKSPACES,snapshot.grants.length);i++)chosen.push(snapshot.grants[(start+i)%snapshot.grants.length]);
  let metadata=[],metadataAvailable=true;try{metadata=await listSessions(snapshot,{signal});if(!Array.isArray(metadata))throw Error();}catch{metadataAvailable=false;}await check();
  const fragments=[],coverage=[];let chars=0;
  const add=(grant,row)=>{const remaining=Math.min(3000,MAX_CHARS-chars);if(remaining<=0||fragments.length>=MAX_FRAGMENTS)return false;const original=cleanGoalSource(row.text,3001),text=cleanGoalSource(row.text,remaining);if(!text.trim())return true;const reference=String(row.reference??'').slice(0,500);fragments.push({id:'src_'+hash(JSON.stringify([grant.workspaceId,grant.root,row.sessionId??null,reference,text])),workspaceId:grant.workspaceId,workspaceLabel:cleanGoalSource(grant.label,200),sessionId:row.sessionId??null,kind:row.kind,reference,text,at:stamp(row.at),truncated:row.truncated===true||original.length>text.length});chars+=text.length;return true;};
  for(const grant of chosen){
   await check();let filesRead=0,sessionsRead=0,partial=false,truncated=false;
   if(fragments.length>=MAX_FRAGMENTS||chars>=MAX_CHARS){coverage.push({workspaceId:grant.workspaceId,label:cleanGoalSource(grant.label,200),status:'partial',filesRead:0,sessionsRead:0,truncated:true});continue;}
   let files=[];try{files=await readProject(grant.root);if(!Array.isArray(files))throw Error();}catch{partial=true;}await check();
   for(const path of PROJECT_FILES){const row=files.find(f=>f?.path===path);if(row?.status!=='ok'||typeof row.text!=='string'){partial=true;continue;}filesRead++;const before=fragments.length;if(!add(grant,{kind:'file',reference:path,text:row.text,at:row.modifiedAt,truncated:row.truncated})){partial=true;truncated=true;break;}truncated||=fragments.length>before&&fragments.at(-1).truncated;}
   const members=metadata.filter(r=>grant.sessionIds.includes(r?.sessionId));
   const allowed=members.filter(r=>r.cwd===grant.root&&!r.parentSessionId&&r.origin!=='subagent'&&!r.isSeeded&&!/^family[_-]/.test(r.sessionId));
   if(!metadataAvailable||allowed.length<members.length||members.length<grant.sessionIds.length)partial=true;
   allowed.sort((a,b)=>(Number(b.updatedAt)||0)-(Number(a.updatedAt)||0)||a.sessionId.localeCompare(b.sessionId));
   if(allowed.length>MAX_SESSIONS){partial=true;truncated=true;}
   for(const row of allowed.slice(0,MAX_SESSIONS)){
    await check();if(fragments.length>=MAX_FRAGMENTS||chars>=MAX_CHARS){partial=true;truncated=true;break;}
    let session;try{if(typeof readSession!=='function')throw Error();session=await readSession(grant,row.sessionId,{signal,snapshot});}catch{partial=true;}await check();
    if(!session||session.sessionId!==row.sessionId||session.cwd!==grant.root||session.origin==='subagent'||session.parentSessionId||session.isSeeded||!Array.isArray(session.records)){partial=true;continue;}
    sessionsRead++;if(session.hasMore===true||session.records.length>12){partial=true;truncated=true;}
    for(const event of session.records.slice(-12)){if(!['user','assistant'].includes(event?.role)||typeof event.text!=='string'||!Number.isSafeInteger(event.seq)||event.seq<0)continue;const before=fragments.length;if(!add(grant,{kind:event.role,sessionId:row.sessionId,reference:`session:${row.sessionId}#seq=${event.seq}`,text:event.text,at:event.at,truncated:event.truncated})){partial=true;truncated=true;break;}truncated||=fragments.length>before&&fragments.at(-1).truncated;}
   }
   coverage.push({workspaceId:grant.workspaceId,label:cleanGoalSource(grant.label,200),status:filesRead+sessionsRead===0?'unavailable':partial||truncated?'partial':'ok',filesRead,sessionsRead,truncated});
  }
  await check();return{fragments,coverage,nextCursor:(start+chosen.length)%snapshot.grants.length};
 };
}
