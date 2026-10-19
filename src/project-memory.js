import {constants} from 'node:fs';
import {lstat,mkdir,open,realpath} from 'node:fs/promises';
import {isAbsolute,join,resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {safeProjectRoot} from './sources.js';
import {openDb,getMeta,setMeta,withTransaction} from '../vendor/yolo/src/storage/db.js';
import {addEvent,listEvents} from '../vendor/yolo/src/storage/repository.js';
import {computeScopeKey} from '../vendor/yolo/src/domain/scope.js';

const OWNER='dsh-project-companion/dot-memory-v1';
const KINDS=new Set(['goal','decision','blocker','next_step','context']);
const LABELS={goal:'目标',decision:'决策',blocker:'阻塞',next_step:'下一步建议',context:'上下文'};
const ROLES={user:'用户来源',assistant:'助手记录',file:'文件来源'};
const LIMITS={goals:10,entries:100};
const MAX_HANDLES=5;
const fingerprint=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sameFile=(a,b)=>a?.dev===b?.dev&&a?.ino===b?.ino;

function boundedString(value,max,label){
  if(typeof value!=='string'||!value.trim()||Array.from(value).length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value))throw new Error(`Invalid ${label}`);
  return value;
}
function session(value){return boundedString(value,200,'sessionId');}
function provenance(value,sessionId){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['kind','reference'].includes(key))||!['user','assistant','file'].includes(value.kind))throw new Error('Source must retain its user, assistant or file role');
  const reference=boundedString(value.reference,500,'source reference');
  if(value.kind==='file'){
    const path=reference.split('#')[0];
    if(!path||isAbsolute(path)||path.includes('\\')||/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(path)||path.split('/').some(part=>!part||part==='.'||part==='..'))throw new Error('File source must stay within the selected project');
  }else if(reference!==`session:${sessionId}`&&!reference.startsWith(`session:${sessionId}#`))throw new Error('User and assistant source must reference the actual caller session');
  return {kind:value.kind,reference};
}
function clockDate(clock){
  const value=clock();const now=value instanceof Date?new Date(value):new Date(value);
  if(!Number.isFinite(now.getTime()))throw new Error('Invalid project memory clock');
  return now;
}
function fileSafety(stat){
  if(stat.isSymbolicLink()||!stat.isFile()||stat.nlink!==1)throw new Error('Unsafe symlink, hardlink or non-regular memory file rejected');
}
async function maybeStat(path){try{return await lstat(path);}catch(error){if(error?.code==='ENOENT')return null;throw error;}}

// This adapter deliberately does not load the upstream Yolo Cordis service.
// Only its repository/domain libraries operate on our separate selected-root DB.
export function createProjectMemory({clock=()=>new Date(),authorizeRoot=async()=>false,hostTimeZone=()=>Intl.DateTimeFormat().resolvedOptions().timeZone}={}){
  const handles=new Map();let tail=Promise.resolve();let accepting=true;let closing;
  function enqueue(operation){
    if(!accepting)return Promise.reject(new Error('Project memory is closed'));
    const result=tail.then(operation);tail=result.catch(()=>{});return result;
  }
  async function selectedRoot(root){
    if(typeof root!=='string'||!isAbsolute(root)||root!==resolve(root)||root.split(sep).some(part=>part==='..'||part==='.'))throw new Error('Canonical absolute project root required');
    // Check the caller's current watched set before probing the filesystem.
    if(await authorizeRoot(root)!==true)throw new Error('Project root is not currently authorized or watched');
    return safeProjectRoot(root);
  }
  async function paths(root,create){
    let cursor=root;
    for(const piece of ['.dsh','dot-memory']){
      cursor=join(cursor,piece);let stat=await maybeStat(cursor);
      if(!stat&&create){try{await mkdir(cursor,{mode:0o700});}catch(error){if(error?.code!=='EEXIST')throw error;}stat=await lstat(cursor);}
      if(!stat)return null;
      if(stat.isSymbolicLink()||!stat.isDirectory()||await realpath(cursor)!==cursor)throw new Error('Unsafe symlink or non-directory memory ancestor rejected');
    }
    const path=join(cursor,'memory.sqlite');
    for(const suffix of ['','-wal','-shm','-journal']){
      const stat=await maybeStat(path+suffix);if(stat)fileSafety(stat);
    }
    return {path,stat:await maybeStat(path)};
  }
  async function database(root,create){
    const cached=handles.get(root);let info=await paths(root,create);
    if(!info||!info.stat){
      if(cached)throw new Error('Project memory path changed while its handle was open');
      if(!create)return null;
    }
    if(cached){
      if(!sameFile(cached.stat,info.stat))throw new Error('Project memory file changed while its handle was open');
      handles.delete(root);handles.set(root,cached);
      return cached;
    }
    let reserved;let db;
    try{
      if(!info.stat){
        try{reserved=await open(info.path,constants.O_RDWR|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);}
        catch(error){if(error?.code!=='EEXIST')throw error;}
      }
      reserved??=await open(info.path,constants.O_RDWR|constants.O_NOFOLLOW|constants.O_NONBLOCK);
      const stat=await reserved.stat();fileSafety(stat);
      info=await paths(root,false);
      if(!info?.stat||!sameFile(stat,info.stat))throw new Error('Memory file changed during opening');
      if(stat.size){
        let check;
        try{
          check=new DatabaseSync(info.path,{readOnly:true});
          const marker=check.prepare("SELECT value FROM meta WHERE key='dot_memory_owner'").get()?.value;
          const ownerRoot=check.prepare("SELECT value FROM meta WHERE key='dot_memory_root'").get()?.value;
          if(marker!==OWNER||ownerRoot!==root)throw new Error('Foreign project memory owner rejected');
        }catch(error){throw new Error('Unrecognized or foreign project memory database',{cause:error});}
        finally{check?.close();}
      }
      if(handles.size>=MAX_HANDLES){
        const oldest=handles.keys().next().value;
        handles.get(oldest).db.close();handles.delete(oldest);
      }
      db=openDb(info.path);
      const after=await paths(root,false);
      if(!after?.stat||!sameFile(stat,after.stat))throw new Error('Memory path changed while SQLite was opening');
      setMeta(db,'dot_memory_owner',OWNER);setMeta(db,'dot_memory_root',root);
      if(getMeta(db,'dot_memory_owner')!==OWNER)throw new Error('Project memory owner marker unavailable');
      const handle={db,path:info.path,stat:after.stat,scope:computeScopeKey(root)};
      handles.set(root,handle);return handle;
    }catch(error){db?.close();throw error;}
    finally{await reserved?.close();}
  }
  function storedEntries(handle){
    const entries=[];
    for(const row of listEvents(handle.db,handle.scope,110)){
      let data;try{data=JSON.parse(row.detail??'');}catch{continue;}
      if(data.owner!==OWNER||!KINDS.has(data.kind))continue;
      entries.push({id:row.id,kind:data.kind,text:data.text,source:data.source,role:data.source.kind,sessionId:row.session_id,at:new Date(row.occurred_at).toISOString(),verified:false,fingerprint:data.fingerprint});
    }
    return entries;
  }
  function projection(handle,now){
    const all=handle?storedEntries(handle):[];
    const publicEntry=({fingerprint:_key,...entry})=>entry;
    const goals=all.filter(entry=>entry.kind==='goal').slice(0,LIMITS.goals).map(publicEntry);
    const entries=all.filter(entry=>entry.kind!=='goal').slice(0,LIMITS.entries).map(publicEntry);
    const zone=typeof hostTimeZone==='function'?hostTimeZone():hostTimeZone;
    const day=new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'});
    const today=day.format(now);
    const changes=all.filter(entry=>day.format(new Date(entry.at))===today&&Date.parse(entry.at)<=now.getTime()).map(publicEntry);
    const lines=['项目记忆（仅来源记录，未独立验收；下一步仅为建议，不是任务状态或执行授权）'];
    if(!all.length)lines.push('尚无已保存的项目记忆。');
    // Keep the model-facing prose bounded; structured rows retain all capped records.
    for(const entry of [...goals,...entries].slice(0,30))lines.push(`- ${LABELS[entry.kind]}：${entry.text.slice(0,500)}\n  ${ROLES[entry.role]} · ${entry.at} · ${entry.source.reference}`);
    return {goals,entries,changes,text:lines.join('\n')};
  }
  return {
    read({root,sessionId}={}){return enqueue(async()=>{session(sessionId);const selected=await selectedRoot(root);return projection(await database(selected,false),clockDate(clock));});},
    remember({root,sessionId,kind,text,source}={}){return enqueue(async()=>{
      session(sessionId);if(!KINDS.has(kind))throw new Error('Invalid project memory kind');
      text=boundedString(text,2000,'memory text');source=provenance(source,sessionId);
      const selected=await selectedRoot(root);const handle=await database(selected,true);const now=clockDate(clock);
      const key=fingerprint([kind,text,source]);
      withTransaction(handle.db,()=>{
        if(storedEntries(handle).some(entry=>entry.fingerprint===key))return;
        addEvent(handle.db,{kind:'note',summary:`${LABELS[kind]}：${text}`,detail:JSON.stringify({owner:OWNER,kind,text,source,fingerprint:key}),session_id:sessionId,source:source.kind==='user'?'manual':'tool',occurred_at:now.getTime(),scope_key:handle.scope});
        // These are context notes, never upstream todos or formal task updates.
        const rows=listEvents(handle.db,handle.scope,111);let goals=0;let notes=0;
        for(const row of rows){
          const data=JSON.parse(row.detail);const keep=data.kind==='goal'?++goals<=LIMITS.goals:++notes<=LIMITS.entries;
          if(!keep)handle.db.prepare('DELETE FROM events WHERE id=? AND scope_key=?').run(row.id,handle.scope);
        }
      });
      return projection(handle,now);
    });},
    close(){
      if(closing)return closing;accepting=false;
      closing=tail.then(()=>{for(const handle of handles.values())handle.db.close();handles.clear();});
      return closing;
    },
  };
}
