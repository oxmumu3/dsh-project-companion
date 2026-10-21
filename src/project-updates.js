import {createHash} from 'node:crypto';
import {isAbsolute,resolve} from 'node:path';
import {z} from 'zod';
import {validateProjectUpdateSummary} from './project-update-model.js';

const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const ROLES=['progress_file','context_file','product_documentation','user','assistant','file','coverage'];
const FILES=[['.agent/memory/progress.md','progress','progress_file'],['.agent/memory/context.md','context','context_file'],['README.md','readme','product_documentation']];
const string=(v,n)=>typeof v==='string'&&v.length>0&&v.length<=n&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(v);
const clean=(v,n)=>String(v??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu,'').slice(0,n);
const inline=(v,n)=>clean(v,n).replace(/\s+/gu,' ').replace(/[\\`*_\[\]()<>#]/gu,'\\$&');
const date=v=>typeof v==='string'&&v.length<=40&&Number.isFinite(Date.parse(v))?v:null;
const hashSchema=z.string().regex(/^[a-f0-9]{64}$/);
const itemSchema=z.object({kind:z.enum(['quote','inference','suggestion']),text:z.string().min(1).max(200),sourceIds:z.array(z.string().min(1).max(100)).min(1).max(3)}).strict();
const summarySchema=z.object({changes:z.array(itemSchema).max(3),blockers:z.array(itemSchema).max(3),nextSteps:z.array(itemSchema).max(3)}).strict();
export const projectUpdateRowSchema=z.object({id:z.literal('profile'),version:z.literal(1),checkpoints:z.array(z.object({key:hashSchema,originSessionId:z.string().min(1).max(200),bindingKey:hashSchema.nullable(),projectId:z.string().min(1).max(256),projectRoot:z.string().min(1).max(4096),fingerprint:hashSchema,checkedAt:z.string().datetime(),summary:summarySchema}).strict()).max(20)}).strict();
export class ProjectUpdateError extends Error{constructor(code){super(code);this.name='ProjectUpdateError';this.code=code;}}
const fail=code=>{throw new ProjectUpdateError(code);};
function validOwner(o){if(!string(o?.sessionId,200)||!string(o.cwd,4096)||!isAbsolute(o.cwd)||resolve(o.cwd)!==o.cwd)fail('UPDATE_INTENT_REQUIRED');return{sessionId:o.sessionId,cwd:o.cwd};}
function request(input){if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['project','userRequested','signal'].includes(k))||input.userRequested!==true||!string(input.project,4096)||!isAbsolute(input.project)||resolve(input.project)!==input.project)fail('UPDATE_INTENT_REQUIRED');return{project:input.project,userRequested:true,signal:input.signal};}
function projectSources(value,root){
 if(value?.project?.root!==root||!Array.isArray(value.sources)||value.sources.length>3)fail('UPDATE_SOURCES_UNAVAILABLE');
 const seen=new Set();for(const row of value.sources)if(!FILES.some(([path])=>row?.path===path)||seen.has(row.path))fail('UPDATE_SOURCES_UNAVAILABLE');else seen.add(row.path);
 return FILES.map(([path,id,role])=>{const row=value.sources.find(s=>s.path===path),status=['ok','missing','rejected'].includes(row?.status)?row.status:'unavailable';if(row?.role!==undefined&&row.role!==role)fail('UPDATE_SOURCES_UNAVAILABLE');const label=path.split('/').at(-1);const original=status==='ok'?row.text:'';if(status==='ok'&&typeof original!=='string')fail('UPDATE_SOURCES_UNAVAILABLE');const text=status==='ok'?clean(original,16384):`${label} ${status==='missing'?'未找到':status==='rejected'?'拒绝读取':'读取未完成'}，内容未知；不能据此判断项目完成。`;return{sourceId:'file:'+id,label,role,status,text,at:date(row?.modifiedAt),truncated:status==='ok'?(row.truncated===true||original.length>16384):null};});
}
function memorySources(value){
 if(!Array.isArray(value?.goals)||!Array.isArray(value?.entries)||value.goals.length>10||value.entries.length>100)fail('UPDATE_SOURCES_UNAVAILABLE');
 const rows=[...value.goals,...value.entries],seen=new Set(),sources=[];
 for(const row of rows.slice(0,20)){
  if(!string(row?.id,200)||seen.has(row.id)||!['goal','decision','blocker','next_step','context'].includes(row.kind)||!string(row.text,2000)||!['user','assistant','file'].includes(row.source?.kind)||(row.role!==undefined&&row.role!==row.source.kind))fail('UPDATE_SOURCES_UNAVAILABLE');seen.add(row.id);
  const origin=row.origin?.source?.kind;if(origin!==undefined&&!['user','assistant','file'].includes(origin))fail('UPDATE_SOURCES_UNAVAILABLE');
  const text=(origin?`本条经过用户纠正；原始来源角色为 ${origin}。\n`:'')+row.text;
  sources.push({sourceId:'memory:'+hash(row.id).slice(0,32),label:row.kind,role:row.source.kind,status:'ok',text,at:date(row.at),truncated:false});
 }
 if(!rows.length)sources.push({sourceId:'memory:empty',label:'memory coverage',role:'coverage',status:'ok',text:'当前未保存项目记忆；不是没有目标或阻塞的证明。',at:null,truncated:false});
 if(rows.length>20)sources.push({sourceId:'memory:coverage',label:'memory coverage',role:'coverage',status:'ok',text:`项目记忆仅提供前20条；其余${rows.length-20}条未展开，内容未知。`,at:null,truncated:true});
 return sources;
}
function boundedWait(promise,signal){if(signal.aborted)return Promise.reject(new ProjectUpdateError('UPDATE_STOPPED'));return new Promise((resolve,reject)=>{const stop=()=>{signal.removeEventListener('abort',stop);reject(new ProjectUpdateError('UPDATE_STOPPED'));};signal.addEventListener('abort',stop,{once:true});Promise.resolve(promise).then(v=>{signal.removeEventListener('abort',stop);signal.aborted?reject(new ProjectUpdateError('UPDATE_STOPPED')):resolve(v);},()=>{signal.removeEventListener('abort',stop);reject(new ProjectUpdateError(signal.aborted?'UPDATE_STOPPED':'UPDATE_UNAVAILABLE'));});});}
const roleText={progress_file:'进度文件·未验收',context_file:'背景文件',product_documentation:'产品文档·非运行证据',user:'用户来源',assistant:'助手记录·未验收',file:'文件来源',coverage:'读取范围说明'};
function render(label,summary,sources,first,at,unknown){
 const selected=structuredClone(summary);let clipped=false;
 function build(){const used=[...new Set(Object.values(selected).flat().flatMap(i=>i.sourceIds))];const index=new Map(used.map((id,i)=>[id,i+1]));const lines=[`## ${inline(label,80)} · ${first?'首次概览':'项目变化'}`,`\n检查于 ${at}；仅比较本次可见资料。`];for(const [key,title]of [['changes','变化'],['blockers','阻塞与未知'],['nextSteps','建议下一步']]){lines.push(`\n### ${title}`);if(!selected[key].length)lines.push(key==='blockers'?'给定材料中未提炼到明确阻塞；不代表不存在。':'本次未提炼出有依据的新条目。');for(const item of selected[key])lines.push(`- ${item.kind==='quote'?'来源摘录':item.kind==='inference'?'推断·未验证':'建议·未执行'}：${inline(item.text,200)} [${item.sourceIds.map(id=>index.get(id)).join(',')}]`);}if(unknown.length)lines.push(`\n读取限制：${unknown.map(s=>`${s.label}${s.status==='ok'?'已截断':s.status==='missing'?'缺失':'不可读'}`).join('；')}，相关内容仍未知。`);lines.push('\n来源：');for(const id of used){const s=sources.find(row=>row.sourceId===id);lines.push(`[${index.get(id)}] ${s.label} · ${roleText[s.role]} · ${s.at??'来源时间未知'}${s.truncated?' · 截断':''}`);}lines.push('\n来源记录不等于独立验收；建议没有执行。未写项目记忆、未派工、未推送。');if(clipped)lines.push('卡片已缩减，未扩大读取范围。');return lines.join('\n');}
 let text=build();while(text.length>3200){const key=['nextSteps','changes','blockers'].find(k=>selected[k].length);if(!key)fail('UPDATE_OUTPUT_TOO_LARGE');selected[key].pop();clipped=true;text=build();}return{text,truncated:clipped};
}
function modelPrevious(previous){
 if(!previous)return null;
 const result={checkedAt:previous.checkedAt,summary:structuredClone(previous.summary),truncated:false};
 while(JSON.stringify(result).length>2800){const key=['nextSteps','changes','blockers'].find(k=>result.summary[k].length);if(!key)fail('UPDATE_MODEL_INVALID_OUTPUT');result.summary[key].pop();result.truncated=true;}
 return result;
}
/** Explicit preview only. The small independent watermarks never modify a project,
 * schedule, source memory, external account or message channel.
 */
export function createProjectUpdateService({store,readScope,authorizeSync,readProject,readMemory,summarize,clock=()=>new Date()}={}){
 let state,failed=false,closed=false,generation=0,queue=Promise.resolve(),nativeWrite=Promise.resolve();const active=new Set();
 const serial=fn=>{const p=queue.then(fn);queue=p.catch(()=>{});return p;};
 const fresh=()=>({id:'profile',version:1,checkpoints:[]});
 const load=async()=>{if(failed)fail('UPDATE_STORE_UNAVAILABLE');if(!state)try{state=projectUpdateRowSchema.parse(await store.get('profile')??fresh());}catch{failed=true;fail('UPDATE_STORE_UNAVAILABLE');}};
 function stop(){generation++;for(const c of active)c.abort();}
 async function execute(owner,input,admitted){
  const control=new AbortController(),signal=AbortSignal.any([control.signal,AbortSignal.timeout(90000),...(input.signal?[input.signal]:[])]);active.add(control);
  const live=()=>{if(closed||failed||signal.aborted||generation!==admitted)fail('UPDATE_STOPPED');};
  let lease;
  const sync=()=>{live();if(typeof authorizeSync!=='function'||authorizeSync(owner,lease)!==true)fail('UPDATE_SCOPE_CHANGED');};
  async function guard(){live();let current;try{current=await boundedWait(Promise.resolve().then(()=>readScope(owner,input.project)),signal);}catch{fail('UPDATE_SCOPE_CHANGED');}live();if(!current||current.projectRoot!==input.project||!string(current.projectId,256)||!string(current.label,80)||!(current.bindingKey===null||/^[a-f0-9]{64}$/.test(current.bindingKey??'')))fail('UPDATE_SCOPE_CHANGED');if(lease&&(current.projectId!==lease.projectId||current.projectRoot!==lease.projectRoot||current.bindingKey!==lease.bindingKey))fail('UPDATE_SCOPE_CHANGED');lease??=structuredClone(current);sync();return true;}
  const unavailable=()=>({status:'unavailable',quiet:false,coverage:'visible-only',text:'本次项目资料读取未完成，相关内容未知；没有建立检查水位，不能据此判断没有变化。'});
  try{
   await boundedWait(nativeWrite,signal);await load();await guard();const key=hash([owner.sessionId,lease.bindingKey,lease.projectRoot,lease.projectId]);const previous=state.checkpoints.find(c=>c.key===key);
   let project,memory;
   try{await guard();project=await boundedWait(Promise.resolve().then(()=>{sync();return readProject(input.project,owner,{signal});}),signal);await guard();memory=await boundedWait(Promise.resolve().then(()=>{sync();return readMemory(input.project,owner,{signal});}),signal);await guard();}
   catch(error){if(error instanceof ProjectUpdateError&&['UPDATE_STOPPED','UPDATE_SCOPE_CHANGED'].includes(error.code))throw error;await guard();return unavailable();}
   let sources;try{sources=[...projectSources(project,input.project),...memorySources(memory)];}catch{await guard();return unavailable();}
   if(!sources.some(s=>s.status==='ok'&&s.role!=='coverage'&&s.text.trim()))return unavailable();
   const unknown=sources.filter(s=>s.status!=='ok'||s.truncated===true);if(unknown.length)sources.push({sourceId:'coverage:unknown',label:'memory coverage',role:'coverage',status:'ok',text:unknown.map(s=>`${s.label}${s.status==='ok'?'提供内容已截断':s.status==='missing'?'未找到':'不可读'}，相关内容未知。`).join(' ').slice(0,200),at:null,truncated:false});
   const fingerprint=hash(sources.map(({sourceId,role,status,text,truncated})=>({sourceId,role,status,text,truncated})));await guard();
   const unknownSources=unknown.map(({sourceId,label,status,truncated})=>({sourceId,label,status,truncated}));
   if(previous?.fingerprint===fingerprint){sync();return{status:'quiet',quiet:true,text:'',coverage:'visible-only',unknownSources,checkedAt:previous.checkedAt};}
   const answer=await boundedWait(Promise.resolve().then(()=>{sync();return summarize({project:{label:lease.label},sources:structuredClone(sources),previous:modelPrevious(previous),signal});}),signal);await guard();
   let summary;try{summary=validateProjectUpdateSummary(answer,sources);}catch{fail('UPDATE_MODEL_INVALID_OUTPUT');}
   if(unknown.length)summary={...summary,blockers:[{kind:'quote',text:sources.at(-1).text,sourceIds:['coverage:unknown']},...summary.blockers].slice(0,3)};
   const at=new Date(clock()).toISOString(),card=render(lease.label,summary,sources,!previous,at,unknown);const checkpoint={key,originSessionId:owner.sessionId,bindingKey:lease.bindingKey,projectId:lease.projectId,projectRoot:lease.projectRoot,fingerprint,checkedAt:at,summary};
   const next=projectUpdateRowSchema.parse({...state,checkpoints:[...state.checkpoints.filter(c=>c.key!==key),checkpoint].slice(-20)});await guard();sync();
   const prior=structuredClone(state);
   // Native storage has no abortable transaction with the remote binding. Keep
   // admitted writes owned until they settle, and restore the preceding small
   // watermark if authority changed during that write. A later preview waits
   // for this recovery instead of racing a stale write or claiming it quiet.
   const commit=nativeWrite.then(async()=>{
    await guard();sync();
    try{await store.put('profile',structuredClone(next));}catch{failed=true;fail('UPDATE_STORE_UNAVAILABLE');}
    try{await guard();sync();}
    catch(error){try{await store.put('profile',prior);}catch{failed=true;fail('UPDATE_STORE_UNAVAILABLE');}throw error;}
   });
   nativeWrite=commit.catch(()=>{});
   await boundedWait(commit,signal);
   try{await guard();sync();}
   catch(error){const restore=nativeWrite.then(()=>store.put('profile',prior));nativeWrite=restore.catch(()=>{failed=true;});await restore.catch(()=>{});throw error;}
   state=next;sync();return{status:previous?'updated':'overview',quiet:false,coverage:'visible-only',unknownSources,checkedAt:at,summary,...card};
  }catch(error){if(error instanceof ProjectUpdateError)throw error;fail('UPDATE_UNAVAILABLE');}finally{active.delete(control);}
 }
 return{ready:()=>serial(load),preview(owner,input){let caller,parsed;try{caller=validOwner(owner);parsed=request(input);}catch(e){return Promise.reject(e);}const admitted=generation;return serial(()=>execute(caller,parsed,admitted));},suspend:stop,close(){closed=true;stop();return Promise.allSettled([queue,nativeWrite]);}};
}
