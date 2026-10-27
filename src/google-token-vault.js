import {withAuthDiagnostic} from './auth-diagnostics.js';
import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
import {spawn as spawnProcess} from 'node:child_process';

const SERVICE='com.oxmumu3.dsh-dot.google-token-vault';
const KIND='dsh-dot-google-keychain-aes256gcm';
const SOURCES=Object.freeze(['googleSuite','googleCalendar']);
const RECORD_SOURCES=Object.freeze({googleSuite:'google-suite',googleCalendar:'calendar'});
const MAX_RECORD_BYTES=32768,MAX_ENVELOPE_BYTES=49152,OPERATION_TIMEOUT=15000;
const ACCOUNT=/^v1-[a-f0-9]{32}-(?:googleSuite|googleCalendar)-[a-f0-9]{48}$/;
const unavailable=()=>Object.assign(new Error('Google 安全存储不可用，请解锁系统钥匙串后重试。'),{code:'GOOGLE_SECURE_STORAGE_UNAVAILABLE'});
const changed=()=>Object.assign(new Error('Google 连接已变化，请重新连接。'),{code:'GOOGLE_CREDENTIALS_CHANGED'});
const invalid=()=>Object.assign(new Error('Google 安全授权记录不可用，请重新连接。'),{code:'GOOGLE_SECURE_STORAGE_INVALID'});
const plain=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
const fieldFor=source=>source+'OAuthCredentials';
function validSource(source){if(!SOURCES.includes(source))throw invalid();return source;}
function selectedSources({source,sources}={}){
 if(source!==undefined&&sources!==undefined)throw invalid();
 if(source!==undefined)return[validSource(source)];
 if(sources===undefined)return SOURCES;
 if(!Array.isArray(sources)||!sources.length||sources.length>SOURCES.length||new Set(sources).size!==sources.length)throw invalid();
 return sources.map(validSource);
}
function bytes(value,length){
 if(typeof value!=='string'||!value.length||!/^[A-Za-z0-9_-]+$/.test(value))throw invalid();
 const decoded=Buffer.from(value,'base64url');
 if((length!==undefined&&decoded.length!==length)||decoded.toString('base64url')!==value)throw invalid();
 return decoded;
}
function record(value,source){
 if(typeof value!=='string'||!value.length||Buffer.byteLength(value)>MAX_RECORD_BYTES)throw invalid();
 let parsed;try{parsed=JSON.parse(value);}catch{throw invalid();}
 if(!plain(parsed)||parsed.source!==RECORD_SOURCES[source]||typeof parsed.refreshToken!=='string'||!parsed.refreshToken.length||parsed.refreshToken.length>8192)throw invalid();
 return value;
}
function looksEncrypted(value){
 if(typeof value!=='string')return false;
 try{return JSON.parse(value)?.kind===KIND;}catch{return false;}
}
function envelope(value,source,scopeHash){
 if(typeof value!=='string'||Buffer.byteLength(value)>MAX_ENVELOPE_BYTES)throw invalid();
 let parsed;try{parsed=JSON.parse(value);}catch{throw invalid();}
 if(!plain(parsed)||parsed.version!==1||parsed.kind!==KIND||parsed.source!==source||parsed.scope!==scopeHash||!ACCOUNT.test(parsed.account)||!parsed.account.startsWith(`v1-${scopeHash}-${source}-`)||Object.keys(parsed).some(key=>!['version','kind','source','scope','account','nonce','ciphertext','tag'].includes(key)))throw invalid();
 bytes(parsed.nonce,12);bytes(parsed.tag,16);const ciphertext=bytes(parsed.ciphertext);if(ciphertext.length>MAX_RECORD_BYTES)throw invalid();
 return parsed;
}
const aad=value=>Buffer.from(JSON.stringify([KIND,1,value.source,value.scope,value.account]));
function encrypt(value,source,scopeHash,key,account){
 const nonce=randomBytes(12),metadata={version:1,kind:KIND,source,scope:scopeHash,account};
 const cipher=createCipheriv('aes-256-gcm',key,nonce);cipher.setAAD(aad(metadata));
 return JSON.stringify({...metadata,nonce:nonce.toString('base64url'),ciphertext:Buffer.concat([cipher.update(value,'utf8'),cipher.final()]).toString('base64url'),tag:cipher.getAuthTag().toString('base64url')});
}
function decrypt(value,key){
 try{const cipher=createDecipheriv('aes-256-gcm',key,bytes(value.nonce,12));cipher.setAAD(aad(value));cipher.setAuthTag(bytes(value.tag,16));return record(Buffer.concat([cipher.update(bytes(value.ciphertext)),cipher.final()]).toString('utf8'),value.source);}catch{throw invalid();}
}

/** Narrow macOS Keychain adapter. Never enumerate, unlock or alter a keychain.
 * Only a 32-byte random AES key enters stdin; security's interactive line limit
 * is 4096 bytes. No token, key or password is passed as a process argument.
 */
export function createMacOSGoogleKeychain({platform=process.platform,spawn=spawnProcess,timeoutMs=OPERATION_TIMEOUT}={}){
 const supported=platform==='darwin';
 const accountValue=account=>{if(!supported||typeof account!=='string'||!ACCOUNT.test(account))throw unavailable();return account;};
 async function run(args,{input='',signal,maxBytes=1024}={}){
  if(!supported||signal?.aborted)throw unavailable();
  return new Promise((resolve,reject)=>{
   let child,settled=false,total=0,timer;const chunks=[];
   const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);};
   const finish=(error,value)=>{if(settled)return;settled=true;cleanup();error?reject(unavailable()):resolve(value);};
   const cancel=()=>{try{child?.kill('SIGTERM');}catch{}finish(true);};
   try{child=spawn('/usr/bin/security',args,{stdio:['pipe','pipe','pipe'],shell:false,windowsHide:true});}catch{finish(true);return;}
   child.once('error',()=>finish(true));
   child.stdout?.on('data',chunk=>{if(settled)return;const data=Buffer.from(chunk);total+=data.length;if(total>maxBytes){cancel();return;}chunks.push(data);});
   // Provider diagnostics can contain sensitive material. Drain, never retain.
   child.stderr?.on('data',()=>{});child.stdin?.on?.('error',()=>finish(true));
   child.once('close',code=>finish(false,{code,output:Buffer.concat(chunks).toString('utf8')}));
   signal?.addEventListener('abort',cancel,{once:true});
   timer=setTimeout(cancel,Math.max(1,Math.min(Number(timeoutMs)||OPERATION_TIMEOUT,OPERATION_TIMEOUT)));
   if(signal?.aborted){cancel();return;}
   try{child.stdin.end(input);}catch{finish(true);}
  });
 }
 return Object.freeze({
  supported,
  async write(account,value,{signal}={}){
   accountValue(account);let key;try{key=bytes(value,32);}catch{throw unavailable();}finally{key?.fill(0);}
   const input=`add-generic-password -a ${account} -s ${SERVICE} -w ${value}\n`;
   if(Buffer.byteLength(input)>=4096)throw unavailable();
   const result=await run(['-q','-i'],{input,signal});if(result.code!==0)throw unavailable();
  },
  async read(account,{signal}={}){
   accountValue(account);const result=await run(['find-generic-password','-s',SERVICE,'-a',account,'-w'],{signal,maxBytes:256});
   if(result.code===44)return null;
   if(result.code!==0)throw unavailable();
   const value=result.output.replace(/\r?\n$/,'');let key;try{key=bytes(value,32);return value;}catch{throw unavailable();}finally{key?.fill(0);}
  },
  async remove(account,{signal}={}){
   accountValue(account);const result=await run(['delete-generic-password','-s',SERVICE,'-a',account],{signal});if(result.code!==0&&result.code!==44)throw unavailable();
  },
 });
}

/** Read/write adapter around the host's existing revision-CAS credential writer.
 * Profile values are AES-GCM envelopes; independent random keys live in Keychain.
 * Legacy records remain visible to status so credential leases stay stable, but
 * callers MUST migrateLegacy and prepare before any Google token/API request.
 * readConfig/status alone never migrate, write or contact Keychain/Google.
 */
export function createGoogleTokenVault({rawReadConfig,rawWrite,keychain=createMacOSGoogleKeychain(),scope,isClosed=()=>false}={}){
 if(typeof rawReadConfig!=='function'||typeof rawWrite!=='function'||typeof scope!=='string'||!scope.length||scope.length>512)throw unavailable();
 const scopeHash=createHash('sha256').update(scope).digest('hex').slice(0,32),cache=new Map(),active=new Set(),cleanupTasks=new Set(),lifecycle=new AbortController();
 let closed=false;
 const open=signal=>{if(closed||isClosed()||lifecycle.signal.aborted||signal?.aborted)throw changed();};
 const raw=()=>{let value;try{value=rawReadConfig();}catch{throw unavailable();}if(!plain(value))throw unavailable();return value;};
 const current=(source,expected,signal)=>{open(signal);if((raw()[fieldFor(source)]??'')!==expected)throw changed();};
 const erase=source=>{const previous=cache.get(source);previous?.key.fill(0);cache.delete(source);};
 const track=promise=>{active.add(promise);promise.then(()=>active.delete(promise),()=>active.delete(promise));return promise;};
 function waitFor(value,signal){
  if(signal?.aborted)return Promise.reject(changed());
  return new Promise((resolve,reject)=>{
   let done=false;const finish=(error,result)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);error?reject(error):resolve(result);};
   const cancel=()=>finish(changed()),timer=setTimeout(cancel,OPERATION_TIMEOUT);signal?.addEventListener('abort',cancel,{once:true});
   Promise.resolve(value).then(result=>finish(null,result),error=>finish(error?.authDiagnostic?withAuthDiagnostic(unavailable(),error.authDiagnostic):error?.code==='GOOGLE_CREDENTIALS_CHANGED'?changed():unavailable()));
  });
 }
 async function affirm(guard,signal){try{open(signal);if(typeof guard!=='function'||await waitFor(Promise.resolve().then(guard),signal)!==true)throw changed();open(signal);}catch{throw withAuthDiagnostic(changed(),{stage:'guard'});}}
 function cleanup(account){
  const task=Promise.resolve().then(()=>keychain.remove(account)).catch(()=>{});cleanupTasks.add(task);task.finally(()=>cleanupTasks.delete(task));return task;
 }
 function readConfig(){
  const config={...raw()};
  for(const source of SOURCES){
   const field=fieldFor(source),value=config[field]??'',cached=cache.get(source);
   if(closed||isClosed()){erase(source);config[field]='';continue;}
   if(cached?.raw!==value)erase(source);
   if(!value||!looksEncrypted(value))continue;
   if(!cache.has(source))continue; // Nonempty sealed value prevents legacy fallback.
   try{config[field]=decrypt(envelope(value,source,scopeHash),cache.get(source).key);}catch{erase(source);}
  }
  return config;
 }
 async function prepareInner(options={}){
  const {authorizeMutation,signal}=options,sources=selectedSources(options);
  open(signal);const combined=AbortSignal.any([lifecycle.signal,...(signal?[signal]:[])]);
  for(const source of sources){
   const value=raw()[fieldFor(source)]??'';
   if(!value||!looksEncrypted(value)){if(cache.get(source)?.raw!==value)erase(source);continue;}
   const sealed=envelope(value,source,scopeHash);
   if(cache.get(source)?.raw===value){decrypt(sealed,cache.get(source).key);continue;}
   await affirm(authorizeMutation,combined);current(source,value,combined);
   let key;
   try{
    const stored=await waitFor(keychain.read(sealed.account,{signal:combined}),combined);key=bytes(stored,32);
    current(source,value,combined);await affirm(authorizeMutation,combined);current(source,value,combined);decrypt(sealed,key);
    erase(source);cache.set(source,{raw:value,key});key=null;
   }catch(error){if(error?.code==='GOOGLE_CREDENTIALS_CHANGED')throw error;throw unavailable();}finally{key?.fill(0);}
  }
 }
 async function store(source,value,expected,guard,signal){
  validSource(source);record(value,source);open(signal);
  if(keychain.supported===false)throw unavailable();
  const combined=AbortSignal.any([lifecycle.signal,...(signal?[signal]:[])]);
  await affirm(guard,combined);current(source,expected,combined);
  const key=randomBytes(32),account=`v1-${scopeHash}-${source}-${randomBytes(24).toString('hex')}`;
  const sealed=encrypt(value,source,scopeHash,key,account);let committed=false,hostWrite=null,hostSettled=false,stage='storage';
  try{
   await waitFor(keychain.write(account,key.toString('base64url'),{signal:combined}),combined);
   await affirm(guard,combined);current(source,expected,combined);
   stage='persist';hostWrite=Promise.resolve().then(()=>rawWrite(source,sealed,{expectedValue:expected,authorizeMutation:async()=>{await affirm(guard,combined);current(source,expected,combined);return true;}}));
   hostWrite.then(()=>{hostSettled=true;},()=>{hostSettled=true;});
   await waitFor(hostWrite,combined);
   current(source,sealed,combined);committed=true;erase(source);cache.set(source,{raw:sealed,key:Buffer.from(key)});
   if(looksEncrypted(expected)){try{const previous=envelope(expected,source,scopeHash);if(previous.account!==account)await cleanup(previous.account);}catch{}}
   current(source,sealed,combined);
   return value;
  }catch(error){
   // A late host commit must retain its corresponding key even after close.
   let pointsHere=true;try{pointsHere=raw()[fieldFor(source)]===sealed;}catch{}
   if(hostWrite&&!hostSettled){
    // Cancellation does not undo a settings mutation already inside the host.
    // Keep this key until the actual host promise settles. An indeterminate
    // host write may outlive close; an orphan key is safer than a dangling ref.
    const afterHost=()=>{let stillReferenced=true;try{stillReferenced=raw()[fieldFor(source)]===sealed;}catch{}return stillReferenced?undefined:cleanup(account);};
    void hostWrite.then(afterHost,afterHost).catch(()=>{});
   }else if(!committed&&!pointsHere)await cleanup(account);
   if(error?.code==='GOOGLE_CREDENTIALS_CHANGED')throw error?.authDiagnostic?withAuthDiagnostic(changed(),error.authDiagnostic):changed();if(error?.authDiagnostic)throw withAuthDiagnostic(unavailable(),error.authDiagnostic);throw withAuthDiagnostic(unavailable(),{stage});
  }finally{key.fill(0);}
 }
 return Object.freeze({
  readConfig,
  prepare:options=>track(prepareInner(options)),
  saveCredentials(source,value,conditions={}){
   return track((async()=>{validSource(source);open(conditions.signal);record(value,source);const expected=raw()[fieldFor(source)]??'';if((readConfig()[fieldFor(source)]??'')!==(conditions.expectedValue??''))throw changed();return store(source,value,expected,conditions.authorizeMutation,conditions.signal);})());
  },
  migrateLegacy(options={}){
   return track((async()=>{
    let migrated=0;
    for(const source of selectedSources(options)){open(options.signal);const value=raw()[fieldFor(source)]??'';if(!value||looksEncrypted(value))continue;record(value,source);await store(source,value,value,options.authorizeMutation,options.signal);migrated++;}
    return migrated;
   })());
  },
  status(){
   const config=raw();let encrypted=0,legacy=0,ready=0;
   for(const source of SOURCES){const value=config[fieldFor(source)]??'';if(!value)continue;if(looksEncrypted(value)){encrypted++;if(cache.get(source)?.raw===value&&!closed&&!isClosed())ready++;}else legacy++;}
   return{supported:keychain.supported!==false,encryptedRecords:encrypted,legacyRecords:legacy,readyRecords:ready};
  },
  async close(){closed=true;lifecycle.abort();for(const source of SOURCES)erase(source);await Promise.allSettled([...active]);await Promise.allSettled([...cleanupTasks]);},
 });
}
