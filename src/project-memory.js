import {constants} from 'node:fs';
import {lstat,mkdir,open,realpath} from 'node:fs/promises';
import {isAbsolute,join,resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
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
const RECEIPT_TEXT_LIMIT=280;
const fingerprint=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sameFile=(a,b)=>a?.dev===b?.dev&&a?.ino===b?.ino;
const publicEntry=({fingerprint:_key,...entry})=>entry;

function boundedString(value,max,label){
  if(typeof value!=='string'||!value.trim()||Array.from(value).length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value))throw new Error(`Invalid ${label}`);
  return value;
}
function session(value){return boundedString(value,200,'sessionId');}
function explicitEdit(userRequested,id){
  if(userRequested!==true)throw new Error('Project memory edits require an explicit user request');
  return boundedString(id,200,'memory id');
}
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
  async function filesFingerprint(root){
    const info=await paths(root,false);if(!info?.stat)throw new Error('Memory file changed while fingerprinting');
    const result=[];
    for(const suffix of ['','-wal','-shm','-journal']){
      const path=info.path+suffix,initial=await maybeStat(path);if(!initial){result.push({suffix,missing:true});continue;}
      fileSafety(initial);let file;
      try{
        file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
        const stat=await file.stat();fileSafety(stat);
        if(!sameFile(initial,stat)||stat.size>64*1024*1024)throw new Error('Memory fingerprint unavailable');
        const hash=createHash('sha256'),buffer=Buffer.alloc(64*1024);let position=0;
        while(position<stat.size){const {bytesRead}=await file.read(buffer,0,Math.min(buffer.length,stat.size-position),position);if(!bytesRead)throw new Error('Memory file changed while fingerprinting');hash.update(buffer.subarray(0,bytesRead));position+=bytesRead;}
        const after=await file.stat(),current=await maybeStat(path);
        if(!current||!sameFile(stat,current)||!sameFile(stat,after)||stat.size!==after.size||stat.mtimeMs!==after.mtimeMs||stat.ctimeMs!==after.ctimeMs)throw new Error('Memory file changed while fingerprinting');
        fileSafety(current);
        result.push({suffix,dev:stat.dev,ino:stat.ino,size:stat.size,mtimeMs:stat.mtimeMs,ctimeMs:stat.ctimeMs,hash:hash.digest('hex')});
      }finally{await file?.close();}
    }
    await paths(root,false);return result;
  }
  async function savedProjection(root,handle,now){
    if(!handle)return projection(null,now);
    let before,owned=false;
    try{before=await filesFingerprint(root);owned=getMeta(handle.db,'dot_memory_owner')===OWNER&&getMeta(handle.db,'dot_memory_root')===root;}catch{}
    const result=projection(handle,now);handle.inspection=null;
    if(before&&owned){
      try{
        const after=await filesFingerprint(root);
        // Ordinary read/remember may update SQLite's shared read marker. Data
        // files must stay stable around the projection; save its final marker.
        const data=rows=>JSON.stringify(rows.filter(row=>row.suffix!=='-shm'));
        if(data(before)===data(after))handle.inspection={fingerprint:JSON.stringify(after),projection:structuredClone(result)};
      }catch{}
    }
    // An unavailable inspection cache must not change read/remember behavior.
    return result;
  }
  async function inspect(root){
    const selected=await selectedRoot(root);let info=await paths(selected,false);
    const cached=handles.get(selected);let reserved,db;
    const noSidecars=async()=>{
      for(const suffix of ['-wal','-shm','-journal'])if(await maybeStat(info.path+suffix))throw new Error('Active SQLite sidecar requires an existing validated handle for read-only inspection');
    };
    try{
      if(!info?.stat){
        if(cached)throw new Error('Project memory path changed while its handle was open');
        const result=projection(null,clockDate(clock));await selectedRoot(root);return result;
      }
      reserved=await open(info.path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
      const stat=await reserved.stat();fileSafety(stat);
      info=await paths(selected,false);
      if(!info?.stat||!sameFile(stat,info.stat)||cached&&!sameFile(cached.stat,info.stat))throw new Error('Memory file changed during inspection');
      let result;
      if(cached){
        if(!cached.inspection)throw new Error('Safe memory inspection snapshot unavailable');
        result=structuredClone(cached.inspection.projection);
      }else{
        // Plain readOnly SQLite still creates WAL/SHM files and updates read
        // markers. Immutable reads avoid those writes, but ignore pending WAL.
        // Refuse that cold-store case instead of presenting stale memory.
        await noSidecars();
        db=new DatabaseSync(`${pathToFileURL(info.path).href}?mode=ro&immutable=1`,{readOnly:true});
        if(getMeta(db,'dot_memory_owner')!==OWNER||getMeta(db,'dot_memory_root')!==selected)throw new Error('Foreign project memory owner rejected');
        result=projection({db,scope:computeScopeKey(selected)},clockDate(clock));
      }
      // Cached inspection only compares ordinary file reads. It never queries
      // the live SQLite connection, which could write a WAL read marker.
      await selectedRoot(root);
      const after=await paths(selected,false);
      if(!after?.stat||!sameFile(stat,after.stat))throw new Error('Memory path changed while inspecting');
      if(cached){
        if(JSON.stringify(await filesFingerprint(selected))!==cached.inspection.fingerprint)throw new Error('Memory files changed since the safe inspection snapshot');
      }else{
        if(stat.size!==after.stat.size||stat.mtimeMs!==after.stat.mtimeMs||stat.ctimeMs!==after.stat.ctimeMs)throw new Error('Memory file changed while inspecting');
        await noSidecars();
      }
      return result;
    }finally{
      db?.close();
      await reserved?.close();
    }
  }
  function storedEntry(row){
    try{
      if(!row||row.kind!=='note')return null;
      const data=JSON.parse(row.detail??'');
      if(data?.owner!==OWNER||!KINDS.has(data.kind))return null;
      const text=boundedString(data.text,2000,'memory text'),sessionId=session(row.session_id),source=provenance(data.source,sessionId);
      const entry={id:boundedString(row.id,200,'memory id'),kind:data.kind,text,source,role:source.kind,sessionId,at:new Date(row.occurred_at).toISOString(),verified:false,fingerprint:data.fingerprint};
      if(data.origin){
        const originSession=session(data.origin.sessionId),originSource=provenance(data.origin.source,originSession);
        if(typeof data.origin.at!=='string'||new Date(data.origin.at).toISOString()!==data.origin.at)return null;
        entry.origin={source:originSource,sessionId:originSession,at:data.origin.at};
      }
      return entry;
    }catch{return null;}
  }
  function storedEntries(handle){
    return listEvents(handle.db,handle.scope,110).map(storedEntry).filter(Boolean);
  }
  function receipt(action,status,entry){
    if(action==='forget')return {action,status,id:entry.id,kind:entry.kind};
    const chars=Array.from(entry.text);
    return {action,status,id:entry.id,kind:entry.kind,text:chars.slice(0,RECEIPT_TEXT_LIMIT).join(''),truncated:chars.length>RECEIPT_TEXT_LIMIT,source:entry.source,at:entry.at,verified:false};
  }
  function removeEntry(handle,id){
    handle.db.prepare('DELETE FROM events WHERE id=? AND scope_key=?').run(id,handle.scope);
    handle.db.prepare("DELETE FROM yolo_fts WHERE row_type='event' AND row_id=?").run(id);
  }
  async function editEntry({root,sessionId,id,text,userRequested,authorizeMutation},action){
    session(sessionId);id=explicitEdit(userRequested,id);
    if(action==='revise')text=boundedString(text,2000,'memory text');
    // Validate/select with the side-effect-free path before obtaining a writer.
    // A foreign, changed or missing store cannot be migrated just to edit an ID.
    const view=await inspect(root),original=[...view.goals,...view.entries].find(entry=>entry.id===id);
    if(!original)throw new Error('Project memory record not found in the selected project');
    const selected=await selectedRoot(root),handle=await database(selected,false),now=clockDate(clock);
    if(!handle)throw new Error('Project memory record not found in the selected project');
    await selectedRoot(root);
    let changed;
    // UI binding may change during any preceding filesystem/root await. The
    // optional caller guard is the final async boundary before an atomic edit.
    if(authorizeMutation!==undefined&&(typeof authorizeMutation!=='function'||await authorizeMutation()!==true))throw new Error('Project memory mutation is no longer authorized');
    withTransaction(handle.db,()=>{
      if(getMeta(handle.db,'dot_memory_owner')!==OWNER||getMeta(handle.db,'dot_memory_root')!==selected)throw new Error('Foreign project memory owner rejected');
      const current=storedEntry(handle.db.prepare('SELECT * FROM events WHERE id=? AND scope_key=?').get(id,handle.scope));
      if(!current)throw new Error('Owned project memory record not found in the selected project');
      if(fingerprint(publicEntry(current))!==fingerprint(original))throw new Error('Project memory record changed; read it again before editing');
      if(action==='forget'){removeEntry(handle,id);changed=current;return;}
      const source={kind:'user',reference:`session:${sessionId}`};
      const origin=current.origin??{source:current.source,sessionId:current.sessionId,at:current.at};
      const key=fingerprint([current.kind,text,source]),summary=`${LABELS[current.kind]}：${text}`;
      const detail=JSON.stringify({owner:OWNER,kind:current.kind,text,source,origin,fingerprint:key});
      handle.db.prepare('UPDATE events SET summary=?,detail=?,session_id=?,source=?,occurred_at=? WHERE id=? AND scope_key=?').run(summary,detail,sessionId,'manual',now.getTime(),id,handle.scope);
      handle.db.prepare("DELETE FROM yolo_fts WHERE row_type='event' AND row_id=?").run(id);
      handle.db.prepare('INSERT INTO yolo_fts(row_type,row_id,title,body) VALUES(?,?,?,?)').run('event',id,summary,detail);
      changed={...current,text,source,role:'user',sessionId,at:now.toISOString(),origin,fingerprint:key};
    });
    return {...await savedProjection(selected,handle,now),receipt:receipt(action,action==='forget'?'forgotten':'revised',changed)};
  }
  function projection(handle,now){
    const all=handle?storedEntries(handle):[];
    const goals=all.filter(entry=>entry.kind==='goal').slice(0,LIMITS.goals).map(publicEntry);
    const entries=all.filter(entry=>entry.kind!=='goal').slice(0,LIMITS.entries).map(publicEntry);
    const zone=typeof hostTimeZone==='function'?hostTimeZone():hostTimeZone;
    const day=new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'});
    const today=day.format(now);
    const changes=all.filter(entry=>day.format(new Date(entry.at))===today&&Date.parse(entry.at)<=now.getTime()).map(publicEntry);
    const lines=['项目记忆（仅来源记录，未独立验收；下一步仅为建议，不是任务状态或执行授权）'];
    if(!all.length)lines.push('尚无已保存的项目记忆。');
    // Keep the model-facing prose bounded; structured rows retain all capped records.
    for(const entry of [...goals,...entries].slice(0,30)){
      const origin=entry.origin?`；原始来源：${ROLES[entry.origin.source.kind]} · ${entry.origin.at} · ${entry.origin.source.reference}`:'';
      lines.push(`- ${LABELS[entry.kind]}：${entry.text.slice(0,500)}\n  ${entry.origin?'用户纠正':ROLES[entry.role]} · ${entry.at} · ${entry.source.reference}${origin}`);
    }
    return {goals,entries,changes,text:lines.join('\n')};
  }
  return {
    inspect({root,sessionId}={}){return enqueue(async()=>{session(sessionId);return inspect(root);});},
    read({root,sessionId}={}){return enqueue(async()=>{session(sessionId);const selected=await selectedRoot(root);return savedProjection(selected,await database(selected,false),clockDate(clock));});},
    remember({root,sessionId,kind,text,source}={}){return enqueue(async()=>{
      session(sessionId);if(!KINDS.has(kind))throw new Error('Invalid project memory kind');
      text=boundedString(text,2000,'memory text');source=provenance(source,sessionId);
      const selected=await selectedRoot(root);const handle=await database(selected,true);const now=clockDate(clock);
      const key=fingerprint([kind,text,source]);
      let saved,status='saved';
      withTransaction(handle.db,()=>{
        saved=storedEntries(handle).find(entry=>entry.fingerprint===key);
        if(saved){status='deduped';return;}
        saved=storedEntry(addEvent(handle.db,{kind:'note',summary:`${LABELS[kind]}：${text}`,detail:JSON.stringify({owner:OWNER,kind,text,source,fingerprint:key}),session_id:sessionId,source:source.kind==='user'?'manual':'tool',occurred_at:now.getTime(),scope_key:handle.scope}));
        // These are context notes, never upstream todos or formal task updates.
        const rows=listEvents(handle.db,handle.scope,111);let goals=0;let notes=0;
        for(const row of rows){
          const entry=storedEntry(row);if(!entry)continue;
          const keep=entry.kind==='goal'?++goals<=LIMITS.goals:++notes<=LIMITS.entries;
          if(!keep)removeEntry(handle,row.id);
        }
      });
      return {...await savedProjection(selected,handle,now),receipt:receipt('remember',status,saved)};
    });},
    revise(input={}){return enqueue(()=>editEntry(input,'revise'));},
    forget(input={}){return enqueue(()=>editEntry(input,'forget'));},
    close(){
      if(closing)return closing;accepting=false;
      closing=tail.then(()=>{for(const handle of handles.values())handle.db.close();handles.clear();});
      return closing;
    },
  };
}
