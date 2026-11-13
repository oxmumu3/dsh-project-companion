/** Official Dida Open API reads for tasks:read OAuth. No MCP or permission fallback.
 * Contract: https://developer.dida365.com/docs/openapi.md (verified 2026-10-22).
 * Operations make bounded GETs, except the read-only Inbox window query, which
 * is the one official POST. Named tasks resolve exact project metadata before
 * reading only that project, with fresh authority on both requests.
 */
import {validateContextCall} from './context-contracts.js';
import {insufficientScope} from './context-transport.js';

const ORIGIN='https://api.dida365.com';
const MAX_BYTES=1024*1024,REQUEST_MS=20000,MAX_ITEMS=200,SEARCH_ITEMS=50,MAX_ALL=1000,CONCURRENCY=3;
const CONTROL=/[\u0000-\u001f\u007f]/u;
const CODES=new Set(['CONTEXT_ARGUMENTS_INVALID','CONTEXT_UNSUPPORTED_OPERATION','CONTEXT_CANCELLED','CONTEXT_AUTH_REQUIRED','CONTEXT_INSUFFICIENT_SCOPE','CONTEXT_ABORTED','CONTEXT_TIMEOUT','CONTEXT_CLOSED','CONTEXT_HTTP_ERROR','CONTEXT_REDIRECT','CONTEXT_PROTOCOL_INVALID','CONTEXT_RESPONSE_TOO_LARGE','CONTEXT_CREDENTIALS_CHANGED']);
export const DIDA_INBOX_PROTOCOL_STAGES=Object.freeze([
 'response','content_type','encoding','json','project_data','project_metadata','project_id','project_id_mismatch',
 'tasks_array','task_shape','task_id','task_project','task_title','task_status',
 'window_array','window_project','window_task_shape','window_task_id','window_task_title','window_task_status','window_dates','unknown',
]);
const WINDOW_DAYS=14;
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const error=code=>Object.assign(new Error(code),{code});
const fail=code=>{throw error(code);};
const failProtocol=stage=>{throw Object.assign(error('CONTEXT_PROTOCOL_INVALID'),{inboxProtocolStage:stage});};
const validId=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,512}$/u.test(v);
const isBoundedInbox=(name,args)=>name==='get_project_tasks_bounded'&&args.project_id==='inbox';
const ident={type:'string',minLength:1,maxLength:512,pattern:'^[A-Za-z0-9_-]{1,512}$'};
const tool=(name,properties)=>({name,inputSchema:{type:'object',additionalProperties:false,required:Object.keys(properties),properties}});
const searchTool=(name,required)=>({name,inputSchema:{type:'object',additionalProperties:false,required,properties:{...(required.includes('query')?{query:{type:'string',minLength:1,maxLength:120}}:{}) ,limit:{type:'integer',minimum:1,maximum:SEARCH_ITEMS}}}});
const CATALOG={provenance:'bundled-contract',tools:[
 tool('list_projects',{offset:{type:'integer',enum:[0]},limit:{type:'integer',minimum:1,maximum:MAX_ITEMS}}),
 tool('get_project_with_undone_tasks',{project_id:ident}),
 tool('get_project_tasks_bounded',{project_id:ident,limit:{type:'integer',minimum:1,maximum:MAX_ITEMS}}),
 tool('get_inbox_undone_window',{start_date:{type:'string',minLength:20,maxLength:40},end_date:{type:'string',minLength:20,maxLength:40}}),
 tool('get_named_project_with_undone_tasks',{project_name:{type:'string',minLength:1,maxLength:180},limit:{type:'integer',minimum:1,maximum:MAX_ITEMS}}),
 tool('get_task_in_project',{project_id:ident,task_id:ident}),
 searchTool('search_task',['query']),
 searchTool('search',['query']),
 searchTool('list_all_tasks',[]),
]};

function validate(source,name,args){
 if(source!=='dida'||!plain(args))fail('CONTEXT_ARGUMENTS_INVALID');
 if(!CATALOG.tools.some(t=>t.name===name))fail('CONTEXT_UNSUPPORTED_OPERATION');
 try{validateContextCall({name,args},CATALOG);}catch{fail('CONTEXT_ARGUMENTS_INVALID');}
 return structuredClone(args);
}
function windowRange(args){
 const start=Date.parse(args.start_date),end=Date.parse(args.end_date);
 if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end-start>WINDOW_DAYS*86400000)fail('CONTEXT_ARGUMENTS_INVALID');
 return[start,end];
}
function wait(promise,signal){
 const aborted=()=>error(signal.reason==='dida-timeout'?'CONTEXT_TIMEOUT':'CONTEXT_ABORTED');
 if(signal.aborted)return Promise.reject(aborted());
 return new Promise((resolve,reject)=>{
  const abort=()=>{signal.removeEventListener('abort',abort);reject(aborted());};signal.addEventListener('abort',abort,{once:true});
  Promise.resolve(promise).then(v=>{signal.removeEventListener('abort',abort);signal.aborted?abort():resolve(v);},e=>{signal.removeEventListener('abort',abort);signal.aborted?abort():reject(e);});
 });
}
function cancelled(settings){
 if(typeof settings.authorize!=='function'||typeof settings.authorizeSync!=='function')fail('CONTEXT_CANCELLED');
 let allowed;try{allowed=settings.authorizeSync();}catch{fail('CONTEXT_CANCELLED');}if(allowed!==true)fail('CONTEXT_CANCELLED');
}
async function authorized(settings,signal){
 if(typeof settings.authorize!=='function'||typeof settings.authorizeSync!=='function')fail('CONTEXT_CANCELLED');
 try{if(await wait(Promise.resolve().then(()=>settings.authorize()),signal)===false)fail('CONTEXT_CANCELLED');}catch(e){if(CODES.has(e?.code))throw error(e.code);fail('CONTEXT_CANCELLED');}return true;
}
function clipped(value,maximum,coverage){
 const clean=typeof value==='string'?value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu,''):'';
 if(clean.length>maximum)coverage.truncated=true;return clean.slice(0,maximum);
}
function project(row,coverage){
 if(!plain(row)||!validId(row.id)||typeof row.name!=='string')fail('CONTEXT_PROTOCOL_INVALID');
 return{id:row.id,name:clipped(row.name,180,coverage)};
}
function task(row,projectId,expectedId,coverage){
 if(!plain(row))failProtocol('task_shape');
 if(!validId(row.id)||(expectedId&&row.id!==expectedId))failProtocol('task_id');
 if(row.projectId!==undefined&&row.projectId!==projectId)failProtocol('task_project');
 if(typeof row.title!=='string')failProtocol('task_title');
 if(row.status!==undefined&&![0,2].includes(row.status))failProtocol('task_status');
 const content=[];
 const dueDate=typeof row.dueDate==='string'&&row.dueDate.length<=60&&Number.isFinite(Date.parse(row.dueDate))?new Date(row.dueDate).toISOString():undefined;
 if(dueDate)content.push(`截止：${row.dueDate}`);
 if(typeof row.content==='string')content.push(row.content);
 if(typeof row.desc==='string'&&row.desc!==row.content)content.push(row.desc);
 if(Array.isArray(row.items)&&row.items.length)coverage.truncated=true;
 return{id:row.id,projectId,title:clipped(row.title,180,coverage),content:clipped(content.join('\n'),1200,coverage),...(dueDate?{dueDate}:{}),...(row.status!==undefined?{status:row.status}:{})};
}
function windowDate(value){
 if(value===undefined||value===null)return null;
 if(typeof value!=='string'||value.length>60||!Number.isFinite(Date.parse(value)))failProtocol('window_dates');
 return new Date(value).toISOString();
}
/**
 * The Inbox window endpoint has no canonical Inbox project id. The only
 * ownership fact available is that a request scoped to Inbox returns one
 * non-empty project id for every row. Anything mixed or malformed drops the
 * whole window batch; callers keep the named-list reads that already succeeded.
 */
function inboxWindowResult(raw){
 if(!Array.isArray(raw))failProtocol('window_array');
 // The response body is already bounded to 1 MiB. Validate every row's
 // ownership and shape before applying the 200-row projection cap, so a mixed
 // owner after the cap cannot be silently accepted.
 let owner=null;const coverage={truncated:raw.length>MAX_ITEMS};const items=[];
 for(const row of raw){
  if(!plain(row))failProtocol('window_task_shape');
  if(!validId(row.id))failProtocol('window_task_id');
  if(typeof row.title!=='string')failProtocol('window_task_title');
  if(row.status!==undefined&&![0,2].includes(row.status))failProtocol('window_task_status');
  if(typeof row.projectId!=='string'||!validId(row.projectId))failProtocol('window_project');
  if(owner===null)owner=row.projectId;else if(owner!==row.projectId)failProtocol('window_project');
  const dueDate=windowDate(row.dueDate),startDate=windowDate(row.startDate);
  if(!dueDate&&!startDate)failProtocol('window_dates');
  if(items.length>=MAX_ITEMS)continue;
  items.push({
   id:row.id,projectId:row.projectId,title:clipped(row.title,180,coverage),
   ...(startDate?{startDate}:{}),...(dueDate?{dueDate}:{}),
   ...(row.status!==undefined?{status:row.status}:{}),
  });
 }
 return{items,truncated:coverage.truncated};
}
function projectResult(raw,name,args){
 const coverage={truncated:false};let items;
 if(name==='list_projects'){
  if(!Array.isArray(raw))fail('CONTEXT_PROTOCOL_INVALID');
  items=raw.slice(0,args.limit).map(row=>project(row,coverage));
  // This endpoint provides no next-page flag. A full requested page may have more.
  if(raw.length>=args.limit)coverage.truncated=true;
 }else if(['get_project_with_undone_tasks','get_project_tasks_bounded'].includes(name)){
  if(!plain(raw))failProtocol('project_data');
  const missingInboxMetadata=isBoundedInbox(name,args)&&(raw.project===undefined||raw.project===null);
  if(!missingInboxMetadata){
   if(!plain(raw.project))failProtocol('project_metadata');
   if(!validId(raw.project.id))failProtocol('project_id');
   if(raw.project.id!==args.project_id)failProtocol('project_id_mismatch');
  }
  if(!Array.isArray(raw.tasks))failProtocol('tasks_array');
  const limit=name==='get_project_tasks_bounded'?args.limit:MAX_ITEMS;
  // The upstream /data endpoint has no task limit. Its response is capped at
  // 1 MiB, then only the explicitly requested number of tasks is projected.
  items=raw.tasks.slice(0,limit).map(row=>task(row,args.project_id,null,coverage));
  if(raw.tasks.length>limit)coverage.truncated=true;
 }else items=[task(raw,args.project_id,args.task_id,coverage)];
 return{items,truncated:coverage.truncated};
}
async function readBody(response,signal){
 const cancel=()=>{try{void response?.body?.cancel().catch(()=>{});}catch{}};
 if(!response||typeof response.status!=='number'||!response.headers||!response.body)failProtocol('response');
 if(signal.aborted){cancel();fail('CONTEXT_ABORTED');}
 if(response.redirected||response.status>=300&&response.status<400){cancel();fail('CONTEXT_REDIRECT');}
 if([401,403].includes(response.status)){
  const code=response.status===401?'CONTEXT_AUTH_REQUIRED':insufficientScope(response)?'CONTEXT_INSUFFICIENT_SCOPE':'CONTEXT_HTTP_ERROR';
  cancel();
  // A raw 403 outside an explicit scope challenge keeps its existing
  // CONTEXT_HTTP_ERROR code, but the fixed numeric status must survive: the
  // reader decides loss of authority from it and drops the whole source.
  if(code==='CONTEXT_HTTP_ERROR'&&response.status===403){const httpError=error(code);httpError.status=403;throw httpError;}
  fail(code);
 }
 if(!response.ok){cancel();const httpError=error('CONTEXT_HTTP_ERROR');httpError.status=response.status;httpError.rateLimited=response.status===429;throw httpError;}
 if((response.headers.get('content-type')??'').split(';')[0].trim().toLowerCase()!=='application/json'){cancel();failProtocol('content_type');}
 const length=Number(response.headers.get('content-length'));if(Number.isFinite(length)&&length>MAX_BYTES){cancel();fail('CONTEXT_RESPONSE_TOO_LARGE');}
 const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let bytes=0,result='';
 try{
  while(true){const part=await wait(reader.read(),signal);if(part.done)break;bytes+=part.value.byteLength;if(bytes>MAX_BYTES)fail('CONTEXT_RESPONSE_TOO_LARGE');try{result+=decoder.decode(part.value,{stream:true});}catch{failProtocol('encoding');}}
  try{result+=decoder.decode();}catch{failProtocol('encoding');}
  try{return JSON.parse(result);}catch{failProtocol('json');}
 }finally{try{void reader.cancel().catch(()=>{});}catch{}reader.releaseLock();}
}

export function createDidaRest({getToken,fetch:fetchImpl=globalThis.fetch,clock=()=>new Date()}={}){
 let closed=false;const active=new Set();
 async function operate(settings,fn,inboxDiagnostic=false){
  if(closed)fail('CONTEXT_CLOSED');const controller=new AbortController(),stop=()=>controller.abort('dida-external');
  if(settings.signal?.aborted)stop();else settings.signal?.addEventListener('abort',stop,{once:true});
  const timer=setTimeout(()=>controller.abort('dida-timeout'),REQUEST_MS);active.add(controller);
  try{controller.signal.throwIfAborted();return await fn(controller.signal);}catch(e){
   if(controller.signal.aborted)fail(controller.signal.reason==='dida-timeout'?'CONTEXT_TIMEOUT':'CONTEXT_ABORTED');
   if(CODES.has(e?.code)){
    // Preserve the HTTP status and the explicit rate-limit marker through the
    // operation wrapper; a 429 is not the same failure as a generic HTTP error.
    const safe=error(e.code);
    if(Number.isInteger(e?.status))safe.status=e.status;
    if(e?.rateLimited===true)safe.rateLimited=true;
    if(inboxDiagnostic&&e.code==='CONTEXT_PROTOCOL_INVALID'){
     safe.inboxProtocolStage=DIDA_INBOX_PROTOCOL_STAGES.includes(e.inboxProtocolStage)?e.inboxProtocolStage:'unknown';
    }
    throw safe;
   }
   if(inboxDiagnostic)failProtocol('unknown');
   fail('CONTEXT_PROTOCOL_INVALID');
  }
  finally{clearTimeout(timer);settings.signal?.removeEventListener('abort',stop);active.delete(controller);}
 }
 return{
  async catalog(source,settings={}){if(source!=='dida')fail('CONTEXT_ARGUMENTS_INVALID');return operate(settings,async()=>({...structuredClone(CATALOG),fetchedAt:new Date(clock()).toISOString()}));},
  async call(source,name,input,settings={}){
   const args=validate(source,name,input);
   if(name==='get_inbox_undone_window')windowRange(args);
   return operate(settings,async signal=>{
    await authorized(settings,signal);cancelled(settings);
    let bearer;try{bearer=await wait(Promise.resolve().then(()=>{signal.throwIfAborted();cancelled(settings);return getToken?.({signal,authorizeMutation:()=>authorized(settings,signal)});}),signal);}catch(e){if(CODES.has(e?.code))throw e;fail('CONTEXT_AUTH_REQUIRED');}
    if(typeof bearer!=='string'||!bearer.length||bearer.length>8192||/\s/u.test(bearer)||CONTROL.test(bearer))fail('CONTEXT_AUTH_REQUIRED');
    const send=async(url,method,body)=>{
     await authorized(settings,signal);signal.throwIfAborted();
     cancelled(settings); // No asynchronous boundary between this gate and dispatch.
     let reply;try{
      const pending=Promise.resolve(fetchImpl(url.href,{
       method,redirect:'manual',
       headers:{authorization:`Bearer ${bearer}`,accept:'application/json',...(body===undefined?{}:{'content-type':'application/json'})},
       ...(body===undefined?{}:{body:JSON.stringify(body)}),signal,
      }));
      const owned=pending.then(response=>{if(signal.aborted){try{void response.body?.cancel().catch(()=>{});}catch{}}return response;});reply=await wait(owned,signal);
     }catch(e){if(CODES.has(e?.code))throw e;fail('CONTEXT_HTTP_ERROR');}
     const value=await readBody(reply,signal);await authorized(settings,signal);cancelled(settings);return value;
    };
    const get=url=>send(url,'GET');
    if(name==='get_inbox_undone_window'){
     windowRange(args);
     const raw=await send(new URL('/open/v1/task/undone',ORIGIN),'POST',{
      projectIds:['inbox'],startDate:args.start_date,endDate:args.end_date,
     });
     return{value:inboxWindowResult(raw),fetchedAt:new Date(clock()).toISOString()};
    }
    if(name==='list_all_tasks'||name==='search_task'||name==='search'){
     const take=Math.min(Number.isInteger(args.limit)?args.limit:20,SEARCH_ITEMS);
     const key=name==='list_all_tasks'?null:String(args.query).toLowerCase();
     const rows=await get(new URL('/open/v1/project',ORIGIN));
     if(!Array.isArray(rows)||rows.length>MAX_ALL)fail('CONTEXT_PROTOCOL_INVALID');
     const projects=rows.filter(row=>plain(row)&&validId(row.id)).slice(0,MAX_ALL);
     const coverage={truncated:rows.length>MAX_ALL},collected=[];
     for(let i=0;i<projects.length;i+=CONCURRENCY){
      const batch=projects.slice(i,i+CONCURRENCY);
      const pages=await Promise.all(batch.map(async row=>{
       const raw=await get(new URL(`/open/v1/project/${encodeURIComponent(row.id)}/data`,ORIGIN));
       if(!plain(raw)||!Array.isArray(raw.tasks))fail('CONTEXT_PROTOCOL_INVALID');
       if(raw.project!==undefined&&(!plain(raw.project)||raw.project.id!==row.id))fail('CONTEXT_PROTOCOL_INVALID');
       return raw.tasks.slice(0,MAX_ALL).map(t=>({row:t,projectId:row.id}));
      }));
      for(const page of pages)for(const entry of page)collected.push(entry);
     }
     collected.sort((a,b)=>{
      const ta=Date.parse(a.row?.createdTime??a.row?.modifiedTime??'')||0;
      const tb=Date.parse(b.row?.createdTime??b.row?.modifiedTime??'')||0;
      return tb-ta;
     });
     const matched=key===null?collected:collected.filter(entry=>plain(entry.row)&&typeof entry.row.title==='string'&&`${entry.row.title}\n${entry.row.content??''}\n${entry.row.desc??''}`.toLowerCase().includes(key));
     const items=matched.slice(0,take).map(entry=>task(entry.row,entry.projectId,null,coverage));
     if(matched.length>take)coverage.truncated=true;
     return{value:{items,truncated:coverage.truncated},fetchedAt:new Date(clock()).toISOString()};
    }
    if(name==='get_named_project_with_undone_tasks'){
     const rows=await get(new URL('/open/v1/project',ORIGIN));
     if(!Array.isArray(rows)||rows.length>2048)fail('CONTEXT_PROTOCOL_INVALID');
     // Equality only, never fuzzy-match a private list or fall back to Inbox.
     const matches=rows.filter(row=>plain(row)&&typeof row.name==='string'&&row.name===args.project_name);
     if(matches.length!==1||!validId(matches[0].id))fail('CONTEXT_ARGUMENTS_INVALID');
     const project_id=matches[0].id;
     const raw=await get(new URL(`/open/v1/project/${encodeURIComponent(project_id)}/data`,ORIGIN));
     if(!plain(raw)||!plain(raw.project)||raw.project.id!==project_id||!Array.isArray(raw.tasks))fail('CONTEXT_PROTOCOL_INVALID');
     const coverage={truncated:raw.tasks.length>args.limit};
     const items=raw.tasks.slice(0,args.limit).map(row=>task(row,project_id,null,coverage));
     return{value:{items,truncated:coverage.truncated},fetchedAt:new Date(clock()).toISOString()};
    }
    const path=name==='list_projects'?'/open/v1/project':`/open/v1/project/${encodeURIComponent(args.project_id)}/${['get_project_with_undone_tasks','get_project_tasks_bounded'].includes(name)?'data':`task/${encodeURIComponent(args.task_id)}`}`;
    const url=new URL(path,ORIGIN);if(name==='list_projects'){url.searchParams.set('offset','0');url.searchParams.set('limit',String(args.limit));}
    const raw=await get(url);
    return{value:projectResult(raw,name,args),fetchedAt:new Date(clock()).toISOString()};
   },isBoundedInbox(name,args)||name==='get_inbox_undone_window');
  },
  async close(){closed=true;for(const controller of active)controller.abort('dida-close');}
 };
}
