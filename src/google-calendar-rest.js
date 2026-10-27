import {withAuthDiagnostic} from './auth-diagnostics.js';
/** Bounded Google Calendar REST reads. This is a bundled contract, not MCP discovery. */
const ORIGIN='https://www.googleapis.com';
const PATH='/calendar/v3/calendars/primary/events';
const MAX_BYTES=1024*1024;
const REQUEST_MS=20_000;
const CONTROL=/[\u0000-\u001f\u007f]/u;
const CODES=new Set(['CONTEXT_ARGUMENTS_INVALID','CONTEXT_CANCELLED','CONTEXT_AUTH_REQUIRED','CONTEXT_ABORTED','CONTEXT_TIMEOUT','CONTEXT_CLOSED','CONTEXT_HTTP_ERROR','CONTEXT_REDIRECT','CONTEXT_PROTOCOL_INVALID','CONTEXT_RESPONSE_TOO_LARGE','CONTEXT_CREDENTIALS_CHANGED']);
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const error=code=>Object.assign(new Error(code),{code});
const fail=code=>{throw error(code);};
const text=(v,n)=>typeof v==='string'?v.replace(/[\u0000-\u001f\u007f]/gu,'').slice(0,n):undefined;
const isTime=v=>typeof v==='string'&&v.length<=60&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/u.test(v)&&Number.isFinite(Date.parse(v));

const CATALOG=Object.freeze({provenance:'bundled-contract',tools:[{name:'list_events',inputSchema:{type:'object',additionalProperties:false,required:['calendarId','startTime','endTime','orderBy','pageSize'],properties:{calendarId:{type:'string',enum:['primary']},startTime:{type:'string'},endTime:{type:'string'},orderBy:{type:'string',enum:['startTime']},pageSize:{type:'integer',minimum:1,maximum:10}}}}]});
function validate(source,name,args){
 if(source!=='calendar'||name!=='list_events'||!plain(args)||Object.keys(args).some(k=>!['calendarId','startTime','endTime','orderBy','pageSize'].includes(k))||args.calendarId!=='primary'||args.orderBy!=='startTime'||!Number.isInteger(args.pageSize)||args.pageSize<1||args.pageSize>10||!isTime(args.startTime)||!isTime(args.endTime))fail('CONTEXT_ARGUMENTS_INVALID');
 const duration=Date.parse(args.endTime)-Date.parse(args.startTime);
 if(duration<=0||duration>7*86400000)fail('CONTEXT_ARGUMENTS_INVALID');
 return{...args};
}
function wait(promise,signal){
 if(signal.aborted)return Promise.reject(error(signal.reason==='calendar-timeout'?'CONTEXT_TIMEOUT':'CONTEXT_ABORTED'));
 return new Promise((resolve,reject)=>{
  const abort=()=>{signal.removeEventListener('abort',abort);reject(error(signal.reason==='calendar-timeout'?'CONTEXT_TIMEOUT':'CONTEXT_ABORTED'));};
  signal.addEventListener('abort',abort,{once:true});
  Promise.resolve(promise).then(value=>{signal.removeEventListener('abort',abort);signal.aborted?abort():resolve(value);},reason=>{signal.removeEventListener('abort',abort);signal.aborted?abort():reject(reason);});
 });
}
function cancelled(settings){
 if(typeof settings.authorize!=='function'||typeof settings.authorizeSync!=='function')fail('CONTEXT_CANCELLED');
 let result;try{result=settings.authorizeSync();}catch{fail('CONTEXT_CANCELLED');}if(result!==true)fail('CONTEXT_CANCELLED');
}
async function authorized(settings,signal){
 if(typeof settings.authorize!=='function'||typeof settings.authorizeSync!=='function')fail('CONTEXT_CANCELLED');
 try{if(await wait(Promise.resolve().then(()=>settings.authorize()),signal)===false)fail('CONTEXT_CANCELLED');}catch(e){if(e?.code?.startsWith('CONTEXT_'))throw e;fail('CONTEXT_CANCELLED');}
 return true;
}
function officialLink(value){
 if(typeof value!=='string'||value.length>2048||CONTROL.test(value))return;
 try{const u=new URL(value);if(u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&['calendar.google.com','www.google.com'].includes(u.hostname)&&(u.hostname==='calendar.google.com'||u.pathname.startsWith('/calendar/')))return u.href;}catch{}
}
function eventTime(value){
 if(!plain(value))fail('CONTEXT_PROTOCOL_INVALID');
 if(typeof value.date==='string'&&/^\d{4}-\d\d-\d\d$/u.test(value.date)&&Number.isFinite(Date.parse(value.date))&&value.dateTime===undefined)return{date:value.date};
 if(isTime(value.dateTime)&&value.date===undefined){const r={dateTime:value.dateTime};if(typeof value.timeZone==='string'&&value.timeZone.length<=100&&!CONTROL.test(value.timeZone))r.timeZone=value.timeZone;return r;}
 fail('CONTEXT_PROTOCOL_INVALID');
}
function event(row){
 if(!plain(row)||typeof row.id!=='string'||!row.id.length||row.id.length>512||CONTROL.test(row.id)||!['confirmed','tentative',undefined].includes(row.status))fail('CONTEXT_PROTOCOL_INVALID');
 const item={id:row.id,start:eventTime(row.start),end:eventTime(row.end)};
 if(row.status)item.status=row.status;
 if(typeof row.summary==='string')item.summary=text(row.summary,500);
 if(isTime(row.updated))item.updated=row.updated;
 const link=officialLink(row.htmlLink);if(link)item.htmlLink=link;
 return item;
}
async function body(response,signal){
 if(!response||typeof response.status!=='number'||!response.headers||!response.body)fail('CONTEXT_PROTOCOL_INVALID');
 const cancel=()=>{try{void response.body.cancel().catch(()=>{});}catch{}};
 if(signal.aborted){cancel();fail('CONTEXT_ABORTED');}
 if(response.status>=300&&response.status<400){cancel();fail('CONTEXT_REDIRECT');}
 if([401,403].includes(response.status)){cancel();fail('CONTEXT_AUTH_REQUIRED');}
 if(!response.ok){cancel();fail('CONTEXT_HTTP_ERROR');}
 if((response.headers.get('content-type')??'').split(';')[0].trim().toLowerCase()!=='application/json'){cancel();fail('CONTEXT_PROTOCOL_INVALID');}
 const length=Number(response.headers.get('content-length'));if(Number.isFinite(length)&&length>MAX_BYTES){cancel();fail('CONTEXT_RESPONSE_TOO_LARGE');}
 const reader=response.body.getReader();const decoder=new TextDecoder('utf-8',{fatal:true});let count=0,result='';
 try{
  while(true){const part=await wait(reader.read(),signal);if(part.done)break;count+=part.value.byteLength;if(count>MAX_BYTES)fail('CONTEXT_RESPONSE_TOO_LARGE');try{result+=decoder.decode(part.value,{stream:true});}catch{fail('CONTEXT_PROTOCOL_INVALID');}}
  try{result+=decoder.decode();return JSON.parse(result);}catch{fail('CONTEXT_PROTOCOL_INVALID');}
 }finally{try{void reader.cancel().catch(()=>{});}catch{}reader.releaseLock();}
}
export function createGoogleCalendarRest({getToken,fetch:fetchImpl=globalThis.fetch,clock=()=>new Date()}={}){
 let closed=false;const active=new Set();
 async function operate(settings,fn){
  if(closed)fail('CONTEXT_CLOSED');
  const controller=new AbortController();const stop=()=>controller.abort('calendar-external');
  if(settings.signal?.aborted)stop();else settings.signal?.addEventListener('abort',stop,{once:true});
  const timer=setTimeout(()=>controller.abort('calendar-timeout'),REQUEST_MS);active.add(controller);
  try{controller.signal.throwIfAborted();return await fn(controller.signal);}catch(e){
   if(controller.signal.aborted)fail(controller.signal.reason==='calendar-timeout'?'CONTEXT_TIMEOUT':'CONTEXT_ABORTED');
   if(CODES.has(e?.code)){const safe=error(e.code);throw e.code==='CONTEXT_AUTH_REQUIRED'&&e.authDiagnostic?withAuthDiagnostic(safe,e.authDiagnostic):safe;}
   fail('CONTEXT_PROTOCOL_INVALID');
  }finally{clearTimeout(timer);settings.signal?.removeEventListener('abort',stop);active.delete(controller);}
 }
 return{
  async catalog(source,settings={}){if(source!=='calendar')fail('CONTEXT_ARGUMENTS_INVALID');return operate(settings,async()=>({...structuredClone(CATALOG),fetchedAt:new Date(clock()).toISOString()}));},
  async call(source,name,input,settings={}){
   const args=validate(source,name,input);
   return operate(settings,async signal=>{
    await authorized(settings,signal);cancelled(settings);
    let bearer;try{bearer=await wait(Promise.resolve().then(()=>{signal.throwIfAborted();cancelled(settings);return getToken?.({signal,authorizeMutation:()=>authorized(settings,signal)});}),signal);}catch(e){if(e?.code?.startsWith('CONTEXT_'))throw e;const safe=error('CONTEXT_AUTH_REQUIRED');throw e?.authDiagnostic?withAuthDiagnostic(safe,e.authDiagnostic):safe;}
    if(typeof bearer!=='string'||!bearer.length||bearer.length>8192||/\s/u.test(bearer)||CONTROL.test(bearer))fail('CONTEXT_AUTH_REQUIRED');
    await authorized(settings,signal);signal.throwIfAborted();
    const url=new URL(PATH,ORIGIN);for(const [key,value]of Object.entries({timeMin:args.startTime,timeMax:args.endTime,singleEvents:'true',orderBy:'startTime',showDeleted:'false',maxResults:String(args.pageSize),fields:'summary,timeZone,updated,nextPageToken,items(id,status,summary,htmlLink,updated,start,end)'}))url.searchParams.set(key,value);
    cancelled(settings); // No asynchronous boundary between this final gate and fetch admission.
    let reply;try{const pending=Promise.resolve(fetchImpl(url.href,{method:'GET',redirect:'manual',headers:{authorization:`Bearer ${bearer}`,accept:'application/json'},signal}));
     // An adapter may ignore abort and return a late body; release it without publishing.
     const owned=pending.then(response=>{if(signal.aborted){try{void response.body?.cancel().catch(()=>{});}catch{}}return response;});
     reply=await wait(owned,signal);}catch(e){if(e?.code?.startsWith('CONTEXT_'))throw e;fail('CONTEXT_HTTP_ERROR');}
    const raw=await body(reply,signal);await authorized(settings,signal);cancelled(settings);
    if(!plain(raw)||(raw.items!==undefined&&!Array.isArray(raw.items))||(raw.nextPageToken!==undefined&&(typeof raw.nextPageToken!=='string'||raw.nextPageToken.length>8192)))fail('CONTEXT_PROTOCOL_INVALID');
    const rows=raw.items??[];if(rows.length>1000)fail('CONTEXT_PROTOCOL_INVALID');const items=rows.slice(0,args.pageSize).map(event);const hasMore=Boolean(raw.nextPageToken)||rows.length>args.pageSize;
    const partial=rows.slice(0,args.pageSize).some(row=>typeof row.summary==='string'&&row.summary.length>500);
    return{value:{items,truncated:hasMore||partial},fetchedAt:new Date(clock()).toISOString(),coverage:{source:'calendar',calendarId:'primary',from:args.startTime,to:args.endTime,returned:items.length,hasMore}};
   });
  },
  async close(){closed=true;for(const controller of active)controller.abort('calendar-close');}
 };
}
