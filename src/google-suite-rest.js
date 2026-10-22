/** Product-owned, bounded Google reads. No MCP discovery, mutation or pagination.
 * Provider data is projected before leaving this adapter; source text is untrusted.
 */
import {validateContextCall} from './context-contracts.js';

const MAX_BYTES=1024*1024,MAX_TOTAL_BYTES=2*MAX_BYTES,MAX_TEXT=16000,REQUEST_MS=20000;
const CONTROL=/[\u0000-\u001f\u007f]/u;
const CODES=new Set(['CONTEXT_ARGUMENTS_INVALID','CONTEXT_CANCELLED','CONTEXT_AUTH_REQUIRED','CONTEXT_ABORTED','CONTEXT_TIMEOUT','CONTEXT_CLOSED','CONTEXT_HTTP_ERROR','CONTEXT_REDIRECT','CONTEXT_PROTOCOL_INVALID','CONTEXT_RESPONSE_TOO_LARGE','CONTEXT_CREDENTIALS_CHANGED']);
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const error=code=>Object.assign(new Error(code),{code});
const fail=code=>{throw error(code);};
const clean=v=>typeof v==='string'?v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu,''):'';
const validId=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,512}$/u.test(v);
const str={type:'string',minLength:1,maxLength:512};
const ident={...str,pattern:'^[A-Za-z0-9_-]{1,512}$'};
const fixed=v=>({enum:[v]});
const page={type:'integer',minimum:1,maximum:10};
const tool=(name,properties)=>({name,inputSchema:{type:'object',additionalProperties:false,required:Object.keys(properties),properties}});
const CATALOGS={
 gmail:[tool('search_threads',{query:{...str,maxLength:500},pageSize:page,includeTrash:fixed(false),view:fixed('THREAD_VIEW_METADATA_ONLY')}),tool('get_message',{messageId:ident,messageFormat:fixed('FULL_CONTENT')})],
 drive:[tool('search_files',{query:{...str,maxLength:1100},pageSize:page,excludeContentSnippets:fixed(true)}),tool('read_file_content',{fileId:ident,includeComments:fixed(false)})],
 docs:[tool('read_doc',{documentId:ident,commentsIncluded:fixed(false)})],
 sheets:[tool('get_values',{spreadsheetId:ident,range:{...str,maxLength:180}})],
 slides:[tool('read_presentation',{presentationId:ident,fields:fixed(['presentationId','title','slides.pageElements(objectId,shape.text)']),commentsIncluded:fixed(false)})],
};
function rangeSize(value){
 const m=/^(?:(?:'[^'\r\n]+(?:''[^'\r\n]*)*'|[\p{L}\p{N}_ .-]+)!)?([A-Z]{1,3})([1-9]\d{0,5})(?::([A-Z]{1,3})([1-9]\d{0,5}))?$/u.exec(value);
 if(!m)fail('CONTEXT_ARGUMENTS_INVALID');const col=s=>[...s].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0);
 const width=col(m[3]||m[1])-col(m[1])+1,height=Number(m[4]||m[2])-Number(m[2])+1;
 if(width<1||height<1||width>26||height>200||width*height>2000)fail('CONTEXT_ARGUMENTS_INVALID');return{width,height};
}
function validate(source,name,args){
 if(!Object.hasOwn(CATALOGS,source)||!plain(args))fail('CONTEXT_ARGUMENTS_INVALID');
 try{validateContextCall({name,args},{tools:CATALOGS[source]});}catch{fail('CONTEXT_ARGUMENTS_INVALID');}
 if(name==='search_threads'&&(CONTROL.test(args.query)||!args.query.trim()))fail('CONTEXT_ARGUMENTS_INVALID');
 if(name==='search_files'&&!/^title contains '(?:[^'\\\u0000-\u001f\u007f]|\\['\\])*'$/u.test(args.query))fail('CONTEXT_ARGUMENTS_INVALID');
 if(name==='get_values')rangeSize(args.range);
 return structuredClone(args);
}
function wait(promise,signal){
 const aborted=()=>error(signal.reason==='suite-timeout'?'CONTEXT_TIMEOUT':'CONTEXT_ABORTED');
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
function clipped(value,maximum,coverage){const v=clean(value);if(v.length>maximum)coverage.truncated=true;return v.slice(0,maximum);}
function officialLink(value){
 if(typeof value!=='string'||value.length>2048||CONTROL.test(value))return;
 try{const u=new URL(value);if(u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&['drive.google.com','docs.google.com'].includes(u.hostname)&&![...u.searchParams.keys()].some(k=>/token|auth|secret|credential|signature|key/i.test(k)))return u.href;}catch{}
}
function fileMetadata(raw,expected,coverage){
 if(!plain(raw)||!validId(raw.id)||(expected&&raw.id!==expected)||typeof raw.name!=='string'||typeof raw.mimeType!=='string'||raw.mimeType.length>200)fail('CONTEXT_PROTOCOL_INVALID');
 const row={id:raw.id,name:clipped(raw.name,500,coverage),mimeType:raw.mimeType};
 if(typeof raw.modifiedTime==='string'&&raw.modifiedTime.length<=60&&Number.isFinite(Date.parse(raw.modifiedTime)))row.modifiedTime=raw.modifiedTime;
 const link=officialLink(raw.webViewLink);if(link)row.webViewLink=link;
 return row;
}
function message(raw,expected,full,coverage){
 if(!plain(raw)||raw.id!==expected||!validId(raw.id))fail('CONTEXT_PROTOCOL_INVALID');
 const row={id:raw.id,snippet:clipped(raw.snippet,1200,coverage)};
 if(validId(raw.threadId))row.threadId=raw.threadId;
 const headers=Array.isArray(raw.payload?.headers)?raw.payload.headers:[];
 if(headers.length>100)coverage.truncated=true;
 row.payload={headers:headers.slice(0,100).filter(h=>plain(h)&&typeof h.name==='string'&&['subject','from','date'].includes(h.name.toLowerCase())&&typeof h.value==='string').slice(0,3).map(h=>({name:h.name,value:clipped(h.value,1000,coverage)}))};
 if(!full)return row;
 let parts=0;const texts=[];
 const visit=(p,depth)=>{
  if(!plain(p))return;if(depth>12||++parts>200){coverage.truncated=true;return;}
  if(p.filename||p.body?.attachmentId){coverage.truncated=true;return;}
  if(p.mimeType==='text/plain'&&typeof p.body?.data==='string'){
   if(!/^[A-Za-z0-9_-]*={0,2}$/u.test(p.body.data)||p.body.data.length>MAX_BYTES)fail('CONTEXT_PROTOCOL_INVALID');
   try{texts.push(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.from(p.body.data,'base64url')));}catch{fail('CONTEXT_PROTOCOL_INVALID');}
  }else if(p.mimeType==='text/html')coverage.truncated=true;
  if(Array.isArray(p.parts)){if(p.parts.length>200)coverage.truncated=true;for(const child of p.parts.slice(0,200))visit(child,depth+1);}
 };
 visit(raw.payload,0);
 if(!texts.length)coverage.truncated=true;
 row.plaintextBody=clipped(texts.length?texts.join('\n'):row.snippet,MAX_TEXT,coverage);
 row.content_truncated=coverage.truncated;return row;
}
async function readBody(response,signal,budget,kind='json'){
 const cancel=()=>{try{void response?.body?.cancel().catch(()=>{});}catch{}};
 if(!response||typeof response.status!=='number'||!response.headers||!response.body)fail('CONTEXT_PROTOCOL_INVALID');
 if(signal.aborted){cancel();fail('CONTEXT_ABORTED');}
 if(response.redirected||response.status>=300&&response.status<400){cancel();fail('CONTEXT_REDIRECT');}
 if([401,403].includes(response.status)){cancel();fail('CONTEXT_AUTH_REQUIRED');}
 if(!response.ok){cancel();fail('CONTEXT_HTTP_ERROR');}
 const type=(response.headers.get('content-type')??'').split(';')[0].trim().toLowerCase();
 if(kind==='json'?type!=='application/json':!type.startsWith('text/')){cancel();fail('CONTEXT_PROTOCOL_INVALID');}
 const length=Number(response.headers.get('content-length'));if(Number.isFinite(length)&&(length>MAX_BYTES||budget.bytes+length>MAX_TOTAL_BYTES)){cancel();fail('CONTEXT_RESPONSE_TOO_LARGE');}
 const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let bytes=0,result='';
 try{
  while(true){const part=await wait(reader.read(),signal);if(part.done)break;bytes+=part.value.byteLength;budget.bytes+=part.value.byteLength;if(bytes>MAX_BYTES||budget.bytes>MAX_TOTAL_BYTES)fail('CONTEXT_RESPONSE_TOO_LARGE');try{result+=decoder.decode(part.value,{stream:true});}catch{fail('CONTEXT_PROTOCOL_INVALID');}}
  try{result+=decoder.decode();return kind==='json'?JSON.parse(result):result;}catch{fail('CONTEXT_PROTOCOL_INVALID');}
 }finally{try{void reader.cancel().catch(()=>{});}catch{}reader.releaseLock();}
}

export function createGoogleSuiteRest({getToken,fetch:fetchImpl=globalThis.fetch,clock=()=>new Date()}={}){
 let closed=false;const active=new Set();
 async function operate(settings,fn){
  if(closed)fail('CONTEXT_CLOSED');const controller=new AbortController(),stop=()=>controller.abort('suite-external');
  if(settings.signal?.aborted)stop();else settings.signal?.addEventListener('abort',stop,{once:true});
  const timer=setTimeout(()=>controller.abort('suite-timeout'),REQUEST_MS);active.add(controller);
  try{controller.signal.throwIfAborted();return await fn(controller.signal);}catch(e){if(controller.signal.aborted)fail(controller.signal.reason==='suite-timeout'?'CONTEXT_TIMEOUT':'CONTEXT_ABORTED');if(CODES.has(e?.code))throw error(e.code);fail('CONTEXT_PROTOCOL_INVALID');}
  finally{clearTimeout(timer);settings.signal?.removeEventListener('abort',stop);active.delete(controller);}
 }
 return{
  async catalog(source,settings={}){if(!Object.hasOwn(CATALOGS,source))fail('CONTEXT_ARGUMENTS_INVALID');return operate(settings,async()=>({provenance:'bundled-contract',tools:structuredClone(CATALOGS[source]),fetchedAt:new Date(clock()).toISOString()}));},
  async call(source,name,input,settings={}){
   const args=validate(source,name,input);
   return operate(settings,async signal=>{
    await authorized(settings,signal);cancelled(settings);
    let bearer;try{bearer=await wait(Promise.resolve().then(()=>{signal.throwIfAborted();cancelled(settings);return getToken?.(source,{signal,authorizeMutation:()=>authorized(settings,signal)});}),signal);}catch(e){if(CODES.has(e?.code))throw error(e.code);fail('CONTEXT_AUTH_REQUIRED');}
    if(typeof bearer!=='string'||!bearer.length||bearer.length>8192||/\s/u.test(bearer)||CONTROL.test(bearer))fail('CONTEXT_AUTH_REQUIRED');
    const budget={bytes:0},coverage={truncated:false};
    const request=async(origin,path,params={},kind='json')=>{
     // Only call sites below select a fixed Google origin/path; no provider URL is followed.
     const url=new URL(path,origin);for(const[k,v]of Object.entries(params))for(const item of Array.isArray(v)?v:[v])url.searchParams.append(k,String(item));
     await authorized(settings,signal);signal.throwIfAborted();cancelled(settings);
     let response;try{const pending=Promise.resolve(fetchImpl(url.href,{method:'GET',redirect:'manual',headers:{authorization:`Bearer ${bearer}`,accept:kind==='json'?'application/json':'text/plain'},signal}));
      const owned=pending.then(r=>{if(signal.aborted){try{void r.body?.cancel().catch(()=>{});}catch{}}return r;});response=await wait(owned,signal);
     }catch(e){if(CODES.has(e?.code))throw error(e.code);fail('CONTEXT_HTTP_ERROR');}
     const value=await readBody(response,signal,budget,kind);await authorized(settings,signal);cancelled(settings);return value;
    };
    const gmail='https://gmail.googleapis.com',google='https://www.googleapis.com';
    const getMessage=async(id,full)=>message(await request(gmail,`/gmail/v1/users/me/messages/${encodeURIComponent(id)}`,{format:full?'full':'metadata',...(!full?{metadataHeaders:['Subject','From','Date']}:{}),fields:full?'id,threadId,snippet,payload':'id,threadId,snippet,payload(headers)'}),id,full,coverage);
    const readFile=async(id,wanted)=>{
     const raw=await request(google,`/drive/v3/files/${encodeURIComponent(id)}`,{fields:'id,name,mimeType,size,modifiedTime,webViewLink',supportsAllDrives:'true'}),row=fileMetadata(raw,id,coverage);
     const native=['application/vnd.google-apps.document','application/vnd.google-apps.presentation'].includes(row.mimeType);
     const supported=(!wanted||row.mimeType===wanted)&&(native||row.mimeType.startsWith('text/'));
     const size=raw.size===undefined?null:typeof raw.size==='string'&&/^\d{1,16}$/u.test(raw.size)?Number(raw.size):NaN;
     if(!supported||(!native&&(size===null||!Number.isSafeInteger(size)||size>MAX_BYTES))){return{...row,textFormattingNotSupported:true,...(wanted?{text:'当前文件格式不支持纯文本读取，未下载正文。'}:{})};}
     const content=await request(google,`/drive/v3/files/${encodeURIComponent(id)}${native?'/export':''}`,native?{mimeType:'text/plain'}:{alt:'media'},'text');
     return{...row,...(wanted?{text:clipped(content,MAX_TEXT,coverage)}:{fileContent:clipped(content,MAX_TEXT,coverage)})};
    };
    let value;
    if(name==='search_threads'){
     const raw=await request(gmail,'/gmail/v1/users/me/messages',{q:args.query,maxResults:args.pageSize,includeSpamTrash:'false',fields:'messages(id,threadId),nextPageToken'});
     if(!plain(raw)||(raw.messages!==undefined&&!Array.isArray(raw.messages))||(raw.nextPageToken!==undefined&&typeof raw.nextPageToken!=='string'))fail('CONTEXT_PROTOCOL_INVALID');
     const rows=raw.messages??[];if(rows.length>1000||rows.some(r=>!plain(r)||!validId(r.id)))fail('CONTEXT_PROTOCOL_INVALID');
     coverage.truncated=Boolean(raw.nextPageToken)||rows.length>args.pageSize;const items=[];
     for(const row of rows.slice(0,args.pageSize))items.push(await getMessage(row.id,false));value={items};
    }else if(name==='get_message')value=await getMessage(args.messageId,true);
    else if(name==='search_files'){
     const raw=await request(google,'/drive/v3/files',{q:`name${args.query.slice(5)} and trashed = false`,pageSize:args.pageSize,fields:'nextPageToken,files(id,name,mimeType,modifiedTime,webViewLink)',spaces:'drive'});
     if(!plain(raw)||(raw.files!==undefined&&!Array.isArray(raw.files))||(raw.nextPageToken!==undefined&&typeof raw.nextPageToken!=='string'))fail('CONTEXT_PROTOCOL_INVALID');
     const rows=raw.files??[];if(rows.length>1000)fail('CONTEXT_PROTOCOL_INVALID');coverage.truncated=Boolean(raw.nextPageToken)||rows.length>args.pageSize;value={items:rows.slice(0,args.pageSize).map(r=>fileMetadata(r,null,coverage))};
    }else if(name==='read_file_content')value=await readFile(args.fileId);
    else if(name==='read_doc')value=await readFile(args.documentId,'application/vnd.google-apps.document');
    else if(name==='read_presentation')value=await readFile(args.presentationId,'application/vnd.google-apps.presentation');
    else if(name==='get_values'){
     const bounds=rangeSize(args.range),raw=await request('https://sheets.googleapis.com',`/v4/spreadsheets/${encodeURIComponent(args.spreadsheetId)}/values/${encodeURIComponent(args.range)}`,{majorDimension:'ROWS',valueRenderOption:'FORMATTED_VALUE',fields:'range,values'});
     if(!plain(raw)||(raw.values!==undefined&&!Array.isArray(raw.values))||(raw.range!==undefined&&typeof raw.range!=='string'))fail('CONTEXT_PROTOCOL_INVALID');const rows=raw.values??[];
     if(rows.length>1000||rows.some(r=>!Array.isArray(r)||r.some(c=>!['string','number','boolean'].includes(typeof c))))fail('CONTEXT_PROTOCOL_INVALID');
     if(rows.length>bounds.height||rows.some(r=>r.length>bounds.width))coverage.truncated=true;
     value={spreadsheetId:args.spreadsheetId,range:clipped(raw.range??args.range,180,coverage),values:rows.slice(0,bounds.height).map(r=>r.slice(0,bounds.width).map(c=>typeof c==='string'?clipped(c,2000,coverage):c))};
    }else fail('CONTEXT_ARGUMENTS_INVALID');
    await authorized(settings,signal);cancelled(settings);
    return{value:{...value,truncated:coverage.truncated},fetchedAt:new Date(clock()).toISOString()};
   });
  },
  async close(){closed=true;for(const controller of active)controller.abort('suite-close');},
 };
}
