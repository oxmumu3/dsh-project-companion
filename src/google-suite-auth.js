import {withAuthDiagnostic,oauthHttpDiagnostic} from './auth-diagnostics.js';
import {createServer} from 'node:http';
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {readContextConfig} from './context-config.js';
import {readGooglePublisher} from './google-publisher.js';
import {safeGoogleAuthAttempt,googleAuthAttemptMessage,googleAuthFailureReason} from './google-auth-attempt.js';

export const GOOGLE_SUITE_SCOPES=Object.freeze(['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/calendar.events.readonly','https://www.googleapis.com/auth/drive.readonly']);
const SOURCE_SCOPE=Object.freeze({gmail:GOOGLE_SUITE_SCOPES[0],calendar:GOOGLE_SUITE_SCOPES[1],drive:GOOGLE_SUITE_SCOPES[2],docs:GOOGLE_SUITE_SCOPES[2],sheets:GOOGLE_SUITE_SCOPES[2],slides:GOOGLE_SUITE_SCOPES[2]});
const knownSource=s=>typeof s==='string'&&Object.hasOwn(SOURCE_SCOPE,s);
const FIELD='googleSuiteOAuthCredentials',AUTH='https://accounts.google.com/o/oauth2/v2/auth',TOKEN='https://oauth2.googleapis.com/token';
const TTL=300000,TIMEOUT=20000,MAX_BODY=65536;
const text=(v,max=8192)=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\r\n]/.test(v);
const plain=v=>v&&typeof v==='object'&&!Array.isArray(v);
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const error=(message='Google连接未完成，请返回连接页重新授权。')=>new Error(message);
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const hasScopes=scopes=>Array.isArray(scopes)&&scopes.length<=32&&scopes.every(s=>text(s,2048))&&GOOGLE_SUITE_SCOPES.some(s=>scopes.includes(s));
function parseRecord(serialized,publisher){
 const r=JSON.parse(serialized);
 if(!plain(r)||r.version!==1||r.source!=='google-suite'||r.profile!=='readonly'||!text(r.connectionId,256)||r.clientId!==publisher?.clientId||!text(r.refreshToken)||!text(r.authorizedAt,40)||!Number.isFinite(Date.parse(r.authorizedAt))||!hasScopes(r.requestedScopes)||r.requestedScopes.length!==GOOGLE_SUITE_SCOPES.length||!GOOGLE_SUITE_SCOPES.every(s=>r.requestedScopes.includes(s))||!hasScopes(r.grantedScopes)||Object.keys(r).some(k=>!['version','source','profile','connectionId','clientId','requestedScopes','grantedScopes','refreshToken','authorizedAt'].includes(k)))throw error();
 return r;
}
/** Product-owned Google suite Desktop OAuth. Records partial consent explicitly.
 * No DCR, no native incremental auth,
 * no private API read at login. Access tokens are held in memory only.
 */
export function createGoogleSuiteAuth({publisher,readConfig,saveCredentials,fetch:fetchImpl=globalThis.fetch,clock=Date.now}={}){
 const client=readGooglePublisher(publisher);
 let closed=false,pending=null,starting=null,cache=null,lastAttempt=null;
 const flights=new Set(),controllers=new Set(),servers=new Set();
 const now=()=>Number(clock()),open=()=>{if(closed)throw error('Google连接已关闭。');};
 const read=()=>{try{return readContextConfig(readConfig?.());}catch{throw error();}};
 const configKey=c=>hash([client,c[FIELD]]);
 const track=p=>{flights.add(p);p.then(()=>flights.delete(p),()=>flights.delete(p));return p;};
 function bounded(promise,signal){
  if(signal.aborted)return Promise.reject(error());
  return new Promise((resolve,reject)=>{const abort=()=>{cleanup();reject(error());};const cleanup=()=>signal.removeEventListener('abort',abort);signal.addEventListener('abort',abort,{once:true});Promise.resolve(promise).then(v=>{cleanup();signal.aborted?reject(error()):resolve(v);},reason=>{cleanup();reject(reason?.authDiagnostic?withAuthDiagnostic(error(),reason.authDiagnostic):error());});});
 }
 async function guarded(guard,signal){
  open();if(typeof guard!=='function'||signal?.aborted)throw error();
  const controller=new AbortController(),cancel=()=>controller.abort();
  signal?.addEventListener('abort',cancel,{once:true});controllers.add(controller);const timer=setTimeout(cancel,TIMEOUT);
  try{if(await bounded(Promise.resolve().then(guard),controller.signal)!==true)throw error();open();if(signal?.aborted||controller.signal.aborted)throw error();}
  finally{clearTimeout(timer);controllers.delete(controller);signal?.removeEventListener('abort',cancel);}
 }
 async function tokenRequest(fields,{signal,guard,expectedKey,previousScopes}={}){
  open();const controller=new AbortController(),cancel=()=>controller.abort();
  if(signal?.aborted)cancel();else signal?.addEventListener('abort',cancel,{once:true});controllers.add(controller);const timer=setTimeout(cancel,TIMEOUT);
  let stage='guard';
  try{
   await guarded(guard,controller.signal);if(configKey(read())!==expectedKey)throw error();
   stage='network';
   // Fixed token endpoint; Desktop client configuration is public registration,
   // not a server-side secret. No credentials or response bodies enter errors.
   const response=await bounded(Promise.resolve().then(()=>{open();if(controller.signal.aborted||configKey(read())!==expectedKey)throw error();return fetchImpl(TOKEN,{method:'POST',redirect:'error',headers:{accept:'application/json','content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...fields,client_id:client.clientId,...(client.clientSecret?{client_secret:client.clientSecret}:{})}).toString(),signal:controller.signal});}),controller.signal);
   if(!response.ok)throw withAuthDiagnostic(error(),await oauthHttpDiagnostic(response,controller.signal));
   if(response.status>=300||response.redirected||Number(response.headers?.get?.('content-length'))>MAX_BODY)throw withAuthDiagnostic(error(),{stage:'parse'});
   stage='parse';let body;
   if(response.body?.getReader){const reader=response.body.getReader(),chunks=[];let size=0;try{while(true){const chunk=await bounded(reader.read(),controller.signal);if(chunk.done)break;size+=chunk.value.byteLength;if(size>MAX_BODY)throw error();chunks.push(Buffer.from(chunk.value));}body=Buffer.concat(chunks).toString('utf8');}finally{void reader.cancel().catch(()=>{});reader.releaseLock();}}
   else{body=await bounded(response.text(),controller.signal);if(Buffer.byteLength(body)>MAX_BODY)throw error();}
   const v=JSON.parse(body);if(!plain(v)||!text(v.access_token,16384)||v.token_type?.toLowerCase()!=='bearer'||!Number.isFinite(Number(v.expires_in))||Number(v.expires_in)<=0||(v.refresh_token!==undefined&&!text(v.refresh_token)))throw error();
   const scopes=v.scope===undefined?previousScopes:typeof v.scope==='string'?v.scope.trim().split(/\s+/):null;
   if(!hasScopes(scopes))throw error('Google只读权限未确认，请重新授权。');
   stage='guard';await guarded(guard,controller.signal);if(configKey(read())!==expectedKey)throw error();
   return{accessToken:v.access_token,refreshToken:v.refresh_token??'',grantedScopes:[...new Set(scopes)],expiresAt:now()+Math.min(Number(v.expires_in),3600)*1000};
  }catch(failure){throw withAuthDiagnostic(error(closed||signal?.aborted?'Google连接请求已取消。':undefined),failure?.authDiagnostic??{stage});}
  finally{clearTimeout(timer);controllers.delete(controller);signal?.removeEventListener('abort',cancel);}
 }
 function stop(flow){clearTimeout(flow.timer);if(pending===flow)pending=null;if(flow.stopped)return flow.stopped;flow.stopped=new Promise(resolve=>{flow.server.close(resolve);flow.server.closeIdleConnections?.();});servers.add(flow.stopped);flow.stopped.then(()=>servers.delete(flow.stopped));return flow.stopped;}
 function drop(flow){flow.used=true;flow.abort.abort();return stop(flow);}
 function respond(res,status,success=false,reason='unknown'){res.writeHead(status,{'content-type':'text/plain; charset=utf-8','cache-control':'no-store','content-security-policy':"default-src 'none'; frame-ancestors 'none'",'x-content-type-options':'nosniff',connection:'close'});res.end(success?'Google 授权已保存。返回 DeepSeek Dot，选择启用已授权的来源，即可询问邮件、日程或文件。本次尚未读取私人资料。':googleAuthAttemptMessage(reason)+(reason==='storage'?'':' 本次失败不会清除已有连接。'));}
 async function persist(record,expected,guard,signal){
  const expectedKey=configKey(expected),serialized=JSON.stringify(record);if(serialized.length>32768)throw error();
  const commit=async()=>{await guarded(guard,signal);if(configKey(read())!==expectedKey)throw error();return true;};
  await commit();
  const controller=new AbortController(),cancel=()=>controller.abort();if(signal?.aborted)cancel();else signal?.addEventListener('abort',cancel,{once:true});controllers.add(controller);const timer=setTimeout(cancel,TIMEOUT);
  try{await bounded(Promise.resolve().then(()=>saveCredentials(serialized,{expectedValue:expected[FIELD],authorizeMutation:async()=>{if(controller.signal.aborted)throw error();return commit();}})),controller.signal);open();if(signal?.aborted||controller.signal.aborted||read()[FIELD]!==serialized)throw error();return serialized;}
  finally{clearTimeout(timer);controllers.delete(controller);signal?.removeEventListener('abort',cancel);}
 }
 async function callback(flow,req,res){
  let url;try{url=new URL(req.url,flow.redirectUri);}catch{respond(res,400);return;}
  if(req.method!=='GET'||url.pathname!=='/oauth2/callback'){respond(res,404);return;}
  if(req.headers.host!==flow.host||url.origin!==new URL(flow.redirectUri).origin){respond(res,400);return;}
  if(closed||pending!==flow||flow.used||now()>=flow.expiresAt||configKey(read())!==flow.configKey){const reason=now()>=flow.expiresAt?'expired':'connection_changed';if(pending===flow&&!flow.used){lastAttempt={status:'failed',reason};void drop(flow);}respond(res,400,false,reason);return;}
  const states=url.searchParams.getAll('state'),codes=url.searchParams.getAll('code'),issuers=url.searchParams.getAll('iss'),errors=url.searchParams.getAll('error');
  if(states.length!==1||!same(states[0],flow.state)||issuers.length>1||(issuers.length===1&&issuers[0]!=='https://accounts.google.com')){respond(res,400);return;}
  // Only a verified callback can end this authorization. A declined consent is
  // terminal, so the next click can create a fresh link without waiting for TTL.
  if(errors.length){if(errors.length!==1||codes.length||!text(errors[0],256)){respond(res,400);return;}flow.used=true;const reason=errors[0]==='access_denied'?'consent_not_granted':'unknown';lastAttempt={status:'failed',reason};respond(res,400,false,reason);void stop(flow);return;}
  if(codes.length!==1||!text(codes[0])){respond(res,400);return;}
  flow.used=true;
  const flowGuard=async()=>{await guarded(flow.guard,flow.abort.signal);if(pending!==flow||now()>=flow.expiresAt)throw error();return true;};
  let stage='guard';
  try{
   await flowGuard();
   stage='exchange';
   const result=await tokenRequest({code:codes[0],code_verifier:flow.verifier,redirect_uri:flow.redirectUri,grant_type:'authorization_code'},{signal:flow.abort.signal,guard:flowGuard,expectedKey:flow.configKey});
   stage='permissions';
   if(pending!==flow||now()>=flow.expiresAt||!result.refreshToken)throw error();
   const record={version:1,source:'google-suite',profile:'readonly',connectionId:randomBytes(32).toString('base64url'),clientId:client.clientId,requestedScopes:[...GOOGLE_SUITE_SCOPES],grantedScopes:result.grantedScopes,refreshToken:result.refreshToken,authorizedAt:new Date(now()).toISOString()};
   stage='persist';const serialized=await persist(record,flow.config,flowGuard,flow.abort.signal);
   cache={...result,key:configKey({[FIELD]:serialized})};lastAttempt={status:'saved'};respond(res,200,true);
  }catch(failure){cache=null;const reason=googleAuthFailureReason(failure,stage);lastAttempt={status:'failed',reason};respond(res,400,false,reason);}finally{void stop(flow);}
 }
 async function startInner({authorizeMutation:guard,signal}={}){
  open();if(!client)throw error('Google连接准备中：产品方尚未配置自己的 Google 应用。');if(typeof saveCredentials!=='function')throw error();
  await guarded(guard,signal);const config=read(),key=configKey(config);
  if(pending&&!pending.used&&now()<pending.expiresAt&&pending.configKey===key){await guarded(pending.guard,pending.abort.signal);if(configKey(read())!==key||!pending||pending.used||now()>=pending.expiresAt)throw error();return{url:pending.url,expiresAt:new Date(pending.expiresAt).toISOString()};}
  if(pending)await drop(pending);
  lastAttempt=null;const flow={guard,config,configKey:key,state:randomBytes(32).toString('base64url'),verifier:randomBytes(48).toString('base64url'),expiresAt:now()+TTL,used:false,abort:new AbortController()};
  const server=createServer({maxHeaderSize:16384},(req,res)=>track(callback(flow,req,res).catch(()=>{if(!res.headersSent)respond(res,400);else res.end();})));flow.server=server;server.requestTimeout=10000;server.headersTimeout=10000;server.keepAliveTimeout=1000;
  try{
   await new Promise((resolve,reject)=>{server.once('error',()=>reject(error()));server.listen({host:'127.0.0.1',port:0,exclusive:true},resolve);});flow.host=`127.0.0.1:${server.address().port}`;flow.redirectUri=`http://${flow.host}/oauth2/callback`;
   await guarded(guard,signal);if(configKey(read())!==key)throw error();
   const url=new URL(AUTH);for(const[k,v]of Object.entries({client_id:client.clientId,redirect_uri:flow.redirectUri,response_type:'code',scope:GOOGLE_SUITE_SCOPES.join(' '),access_type:'offline',prompt:'consent',state:flow.state,code_challenge:createHash('sha256').update(flow.verifier).digest('base64url'),code_challenge_method:'S256'}))url.searchParams.set(k,v);
   flow.url=url.toString();pending=flow;flow.timer=setTimeout(()=>{if(pending===flow&&!flow.used)lastAttempt={status:'failed',reason:'expired'};void drop(flow);},TTL);flow.timer.unref?.();server.unref();return{url:flow.url,expiresAt:new Date(flow.expiresAt).toISOString()};
  }catch{await drop(flow);throw error();}
 }
 async function getTokenInner(source,{signal,authorizeMutation:guard}={}){
  if(!knownSource(source))throw error('不支持这个 Google 来源。');
  open();try{await guarded(guard,signal);}catch{throw withAuthDiagnostic(error(),{stage:'guard'});}const config=read(),key=configKey(config);let record;try{record=parseRecord(config[FIELD],client);}catch{throw error('Google尚未连接，请先在连接页授权。');}
  if(!client||!record.grantedScopes.includes(SOURCE_SCOPE[source]))throw error('这个 Google 来源尚未授权，请在连接页重新登录并选择对应权限。');if(cache?.key!==key)cache=null;
  if(cache&&cache.expiresAt-30000>now())return cache.accessToken;
  const result=await tokenRequest({grant_type:'refresh_token',refresh_token:record.refreshToken},{signal,guard,expectedKey:key,previousScopes:record.grantedScopes});
  if((result.refreshToken&&result.refreshToken!==record.refreshToken)||JSON.stringify(result.grantedScopes)!==JSON.stringify(record.grantedScopes)){const serialized=await persist({...record,refreshToken:result.refreshToken||record.refreshToken,grantedScopes:result.grantedScopes},config,guard,signal);cache={...result,key:configKey({[FIELD]:serialized})};}
  else{await guarded(guard,signal);if(configKey(read())!==key)throw error();cache={...result,key};}
  if(!result.grantedScopes.includes(SOURCE_SCOPE[source])){cache=null;throw error('这个 Google 来源的权限已变化，请重新连接。');}
  return result.accessToken;
 }
 function credentialState(source){let config;try{config=read();const record=parseRecord(config[FIELD],client);return{configured:!closed&&Boolean(client)&&knownSource(source)&&record.grantedScopes.includes(SOURCE_SCOPE[source]),key:hash(['google-suite',source,record.connectionId,record.clientId,record.profile,[...new Set(record.grantedScopes)].sort()])};}catch{return{configured:false,key:hash(['google-suite',source,client,config?.[FIELD]??''])};}}
 return{
  credentialState,
  status(){const active=!closed&&pending&&now()<pending.expiresAt;return{clientConfigured:Boolean(client),publisherConfigured:Boolean(client),refreshConfigured:['gmail','calendar','drive'].some(s=>credentialState(s).configured),grantedSources:['gmail','calendar','drive'].filter(s=>credentialState(s).configured),authInProgress:Boolean(active),lastAttempt:safeGoogleAuthAttempt(lastAttempt),profile:'readonly',...(active?{expiresAt:new Date(pending.expiresAt).toISOString()}:{})};},
  start(options){if(starting)return Promise.reject(error('Google授权正在启动，请稍后重试。'));const call=track(startInner(options));starting=call;call.then(()=>{if(starting===call)starting=null;},()=>{if(starting===call)starting=null;});return call;},
  getToken:(source,options)=>track(getTokenInner(source,options)),
  async close(){closed=true;cache=null;for(const c of controllers)c.abort();if(pending)void drop(pending);await Promise.allSettled([...flights]);await Promise.allSettled([...servers]);},
 };
}
