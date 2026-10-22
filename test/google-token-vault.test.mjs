import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createGoogleSuiteAuth,GOOGLE_SUITE_SCOPES} from '../src/google-suite-auth.js';

const mod=await import('../src/google-token-vault.js').catch(()=>null);
const source='googleSuite',field='googleSuiteOAuthCredentials';
const record=()=>JSON.stringify({version:1,source:'google-suite',profile:'readonly',connectionId:'synthetic-connection',clientId:'fixture.apps.googleusercontent.com',requestedScopes:['readonly'],grantedScopes:['readonly'],refreshToken:'synthetic-private-refresh',authorizedAt:'2026-10-22T00:00:00Z'});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
function fixture(t,options={}){
 assert.equal(typeof mod?.createGoogleTokenVault,'function','Google encrypted token vault is implemented');
 let config={googleSuiteOAuthCredentials:'',googleCalendarOAuthCredentials:'',flomoToken:'leave-this-other-source-alone',...options.config};
 const records=options.records??new Map(),calls=[],writes=[];
 const keychain={supported:true,async write(account,value){calls.push(['write',account]);records.set(account,value);await options.afterKeyWrite?.();},async read(account){calls.push(['read',account]);const value=records.get(account)??null;await options.afterKeyRead?.();return value;},async remove(account){calls.push(['remove',account]);records.delete(account);},...options.keychain};
 const rawReadConfig=()=>({...config});
 const rawWrite=async(src,value,conditions)=>{writes.push({source:src,value});await options.beforeRawWrite?.();assert.equal(await conditions.authorizeMutation(),true);assert.equal(config[src+'OAuthCredentials']??'',conditions.expectedValue??'');if(options.rejectRawWrite)throw Error('do not expose synthetic-private-refresh');await options.afterRawGuard?.();config={...config,[src+'OAuthCredentials']:value};};
 const vault=mod.createGoogleTokenVault({rawReadConfig,rawWrite,keychain,scope:options.scope??'native-entry-fixture'});
 t.after(()=>vault.close());
 return{vault,keychain,records,calls,writes,config:()=>config,set:patch=>{config={...config,...patch};},guard:async()=>true};
}

test('new Google records are encrypted in profile and keychain holds only a random key',async t=>{
 const h=fixture(t),clear=record();
 await h.vault.saveCredentials(source,clear,{expectedValue:'',authorizeMutation:h.guard});
 assert.equal(h.vault.readConfig()[field],clear);
 assert.doesNotMatch(h.config()[field],/synthetic-private-refresh|fixture\.apps/);
 const envelope=JSON.parse(h.config()[field]);
 assert.equal(envelope.kind,'dsh-dot-google-keychain-aes256gcm');
 assert.equal(h.records.size,1);const key=[...h.records.values()][0];assert.equal(Buffer.from(key,'base64url').length,32);assert.equal(key.includes(clear),false);
 assert.equal(h.vault.readConfig().flomoToken,'leave-this-other-source-alone');
});

test('cold prepare decrypts an exact reference without profile writes or Google HTTP',async t=>{
 const h=fixture(t),clear=record();await h.vault.saveCredentials(source,clear,{expectedValue:'',authorizeMutation:h.guard});
 const raw=h.config()[field],cold=fixture(t,{config:{[field]:raw},records:h.records});
 assert.equal(cold.vault.readConfig()[field],raw,'status does not touch keychain to hydrate');
 assert.equal(cold.calls.length,0);
 await cold.vault.prepare({authorizeMutation:cold.guard});
 assert.equal(cold.vault.readConfig()[field],clear);assert.equal(cold.writes.length,0);assert.deepEqual(cold.calls.map(c=>c[0]),['read']);
});

test('an existing valid near-32KiB Google record preserves the original authorization contract',async t=>{
 const clear=JSON.stringify({...JSON.parse(record()),requestedScopes:[...GOOGLE_SUITE_SCOPES],grantedScopes:[GOOGLE_SUITE_SCOPES[0],...Array.from({length:15},(_,i)=>`https://example.test/scope/${i}/`+'x'.repeat(1980))]});
 assert.ok(Buffer.byteLength(clear)>30000&&Buffer.byteLength(clear)<32768);
 const h=fixture(t);await h.vault.saveCredentials(source,clear,{expectedValue:'',authorizeMutation:h.guard});
 assert.ok(Buffer.byteLength(h.config()[field])>32768);assert.equal(h.vault.readConfig()[field],clear);
 const cold=fixture(t,{config:{[field]:h.config()[field]},records:h.records});await cold.vault.prepare({authorizeMutation:cold.guard});assert.equal(cold.vault.readConfig()[field],clear);
 const auth=createGoogleSuiteAuth({publisher:{kind:'desktop',clientId:'fixture.apps.googleusercontent.com',clientSecret:'synthetic-public-registration'},readConfig:cold.vault.readConfig});t.after(()=>auth.close());assert.equal(auth.credentialState('gmail').configured,true);
});

test('different nonces and keys are used for rotation and only the replaced own item is removed',async t=>{
 const h=fixture(t),first=record();h.records.set('foreign-keychain-item','never touch');
 await h.vault.saveCredentials(source,first,{expectedValue:'',authorizeMutation:h.guard});
 const firstEnvelope=JSON.parse(h.config()[field]);
 const next=JSON.stringify({...JSON.parse(first),refreshToken:'synthetic-rotated-refresh'});
 await h.vault.saveCredentials(source,next,{expectedValue:first,authorizeMutation:h.guard});
 const secondEnvelope=JSON.parse(h.config()[field]);
 assert.notEqual(firstEnvelope.account,secondEnvelope.account);assert.notEqual(firstEnvelope.nonce,secondEnvelope.nonce);
 assert.equal(h.records.has(firstEnvelope.account),false);assert.equal(h.records.has(secondEnvelope.account),true);assert.equal(h.records.get('foreign-keychain-item'),'never touch');
 assert.equal(h.vault.readConfig()[field],next);
});

test('missing, corrupted and cross-profile references never fall back to clear token',async t=>{
 const h=fixture(t);await h.vault.saveCredentials(source,record(),{expectedValue:'',authorizeMutation:h.guard});const raw=h.config()[field];
 for(const kind of ['missing','tampered','scope','source']){
  let altered=raw;const records=new Map(h.records);
  if(kind==='missing')records.clear();
  if(kind==='tampered'){const e=JSON.parse(raw);e.ciphertext=(e.ciphertext[0]==='a'?'b':'a')+e.ciphertext.slice(1);altered=JSON.stringify(e);}
  const cold=fixture(t,{config:{[kind==='source'?'googleCalendarOAuthCredentials':field]:altered},records,...(kind==='scope'?{scope:'another-native-entry'}:{})});
  await assert.rejects(cold.vault.prepare({authorizeMutation:cold.guard}),e=>e.code?.startsWith('GOOGLE_SECURE_STORAGE'));
  assert.doesNotMatch(JSON.stringify(cold.vault.readConfig()),/synthetic-private-refresh/);
  assert.equal(cold.writes.length,0);
  if(kind==='scope'||kind==='source')assert.equal(cold.calls.length,0,'reject wrong scope before a keychain read');
 }
});

test('source-scoped preparation does not let a broken Calendar record block Google suite',async t=>{
 const h=fixture(t);await h.vault.saveCredentials(source,record(),{expectedValue:'',authorizeMutation:h.guard});const sealed=h.config()[field];
 const bad=JSON.stringify({...JSON.parse(sealed),source:'googleCalendar'});
 const cold=fixture(t,{config:{[field]:sealed,googleCalendarOAuthCredentials:bad},records:h.records});
 await cold.vault.prepare({source:'googleSuite',authorizeMutation:cold.guard});assert.equal(cold.vault.readConfig()[field],record());assert.equal(cold.calls.length,1);
 const legacy=fixture(t,{config:{[field]:record(),googleCalendarOAuthCredentials:'broken-manual-calendar'}});
 assert.equal(await legacy.vault.migrateLegacy({sources:['googleSuite'],authorizeMutation:legacy.guard}),1);assert.equal(legacy.config().googleCalendarOAuthCredentials,'broken-manual-calendar');
});

test('unknown or ambiguous source selections never touch keychain or profile',async t=>{
 const h=fixture(t,{config:{[field]:record()}});
 for(const options of [{source:'gmail'},{sources:['flomo']},{source:'googleSuite',sources:['googleSuite']},{sources:[]},{sources:['googleSuite','googleSuite']}]){
  await assert.rejects(h.vault.prepare({...options,authorizeMutation:h.guard}));await assert.rejects(h.vault.migrateLegacy({...options,authorizeMutation:h.guard}));
 }
 assert.equal(h.calls.length,0);assert.equal(h.writes.length,0);
});

test('user clear is immediately visible and delayed keychain read cannot resurrect it',async t=>{
 const h=fixture(t);await h.vault.saveCredentials(source,record(),{expectedValue:'',authorizeMutation:h.guard});const raw=h.config()[field],held=deferred(),reached=deferred();
 const cold=fixture(t,{config:{[field]:raw},records:h.records,afterKeyRead:async()=>{reached.resolve();await held.promise;}});
 const pending=cold.vault.prepare({authorizeMutation:cold.guard});await reached.promise;cold.set({[field]:''});assert.equal(cold.vault.readConfig()[field],'');held.resolve();
 await assert.rejects(pending);assert.equal(cold.vault.readConfig()[field],'');assert.equal(cold.writes.length,0);
});

test('clear after hydration invalidates memory before a previous reference reappears',async t=>{
 const h=fixture(t);await h.vault.saveCredentials(source,record(),{expectedValue:'',authorizeMutation:h.guard});const raw=h.config()[field];
 h.set({[field]:''});assert.equal(h.vault.readConfig()[field],'');h.set({[field]:raw});assert.equal(h.vault.readConfig()[field],raw);
});

test('clear during save wins and cleanup only removes the new uncommitted key',async t=>{
 const held=deferred(),reached=deferred();const h=fixture(t,{config:{[field]:'old-user-value'},afterKeyWrite:async()=>{reached.resolve();await held.promise;}});
 h.records.set('foreign-keychain-item','untouched');
 const pending=h.vault.saveCredentials(source,record(),{expectedValue:'old-user-value',authorizeMutation:h.guard});await reached.promise;h.set({[field]:''});held.resolve();
 await assert.rejects(pending);assert.equal(h.config()[field],'');assert.equal(h.writes.length,0);assert.deepEqual([...h.records.keys()],['foreign-keychain-item']);
});

test('native CAS failure never overwrites user replacement and does not leak provider errors',async t=>{
 const h=fixture(t,{rejectRawWrite:true});
 await assert.rejects(h.vault.saveCredentials(source,record(),{expectedValue:'',authorizeMutation:h.guard}),e=>!String(e).includes('synthetic-private-refresh')&&e.code==='GOOGLE_SECURE_STORAGE_UNAVAILABLE');
 assert.equal(h.config()[field],'');assert.equal(h.records.size,0);
});

test('a user replacement immediately before the raw revision-CAS dispatch still wins',async t=>{
 let h;h=fixture(t,{beforeRawWrite:async()=>h.set({[field]:'manual-user-replacement'})});
 await assert.rejects(h.vault.saveCredentials(source,record(),{expectedValue:'',authorizeMutation:h.guard}));
 assert.equal(h.config()[field],'manual-user-replacement');assert.equal(h.records.size,0);
});

test('guard must affirm before any private storage mutation',async t=>{
 for(const guard of [undefined,async()=>false,async()=>undefined]){
  const h=fixture(t);await assert.rejects(h.vault.saveCredentials(source,record(),{expectedValue:'',authorizeMutation:guard}));assert.equal(h.calls.length,0);assert.equal(h.writes.length,0);
 }
});

test('old clear records migrate only through explicit guarded migration and keep exact auth view',async t=>{
 const clear=record(),h=fixture(t,{config:{[field]:clear}});
 assert.equal(h.vault.readConfig()[field],clear);assert.equal(h.calls.length,0);assert.equal(h.writes.length,0);
 await h.vault.prepare({authorizeMutation:h.guard});assert.equal(h.writes.length,0,'prepare does not migrate or persist');
 await assert.rejects(h.vault.migrateLegacy({authorizeMutation:async()=>false}));assert.equal(h.writes.length,0);
 assert.equal(await h.vault.migrateLegacy({authorizeMutation:h.guard}),1);assert.equal(h.vault.readConfig()[field],clear);assert.doesNotMatch(h.config()[field],/synthetic-private-refresh/);
 assert.equal(await h.vault.migrateLegacy({authorizeMutation:h.guard}),0);
});

test('close during key write cannot commit or return a stale token',async t=>{
 const held=deferred(),reached=deferred();const h=fixture(t,{afterKeyWrite:async()=>{reached.resolve();await held.promise;}});
 const pending=h.vault.saveCredentials(source,record(),{expectedValue:'',authorizeMutation:h.guard});await reached.promise;const closing=h.vault.close();held.resolve();
 await assert.rejects(pending);await closing;assert.equal(h.config()[field],'');assert.equal(h.vault.readConfig()[field],'');assert.equal(h.records.size,0);
});

test('close while old-key cleanup runs cannot return the newly saved clear record',async t=>{
 const held=deferred(),reached=deferred();let hold=false,h;
 h=fixture(t,{keychain:{async remove(account){h.records.delete(account);if(hold){reached.resolve();await held.promise;}}}});
 const first=record();await h.vault.saveCredentials(source,first,{expectedValue:'',authorizeMutation:h.guard});hold=true;
 const next=JSON.stringify({...JSON.parse(first),refreshToken:'synthetic-rotated-refresh'});
 const pending=h.vault.saveCredentials(source,next,{expectedValue:first,authorizeMutation:h.guard});await reached.promise;const closing=h.vault.close();held.resolve();
 await assert.rejects(pending);await closing;assert.equal(h.vault.readConfig()[field],'');assert.equal(h.records.size,1,'retain key for a host record already committed before close');
});

test('a late native commit after close keeps its encryption key and remains decryptable on restart',async t=>{
 const held=deferred(),reached=deferred();const h=fixture(t,{afterRawGuard:async()=>{reached.resolve();await held.promise;}});
 const pending=h.vault.saveCredentials(source,record(),{expectedValue:'',authorizeMutation:h.guard});await reached.promise;
 const closing=h.vault.close();await assert.rejects(pending);await closing;
 held.resolve();await new Promise(setImmediate);
 assert.ok(h.config()[field]);assert.equal(h.records.size,1,'unknown native dispatch must not delete a key before a late commit');
 const cold=fixture(t,{config:{[field]:h.config()[field]},records:h.records});await cold.vault.prepare({authorizeMutation:cold.guard});assert.equal(cold.vault.readConfig()[field],record());
});

test('an unreadable host state after commit cannot delete the committed encryption key',async t=>{
 let config={[field]:''},unreadable=false;const records=new Map();
 const vault=mod.createGoogleTokenVault({scope:'native-entry-fixture',rawReadConfig:()=>{if(unreadable)throw Error('private unavailable state');return{...config};},rawWrite:async(src,value,conditions)=>{assert.equal(await conditions.authorizeMutation(),true);config={[field]:value};unreadable=true;},keychain:{supported:true,async write(account,key){records.set(account,key);},async read(account){return records.get(account);},async remove(account){records.delete(account);}}});t.after(()=>vault.close());
 await assert.rejects(vault.saveCredentials(source,record(),{expectedValue:'',authorizeMutation:async()=>true}));unreadable=false;
 assert.equal(records.size,1,'unknown post-commit state retains key');
 const cold=fixture(t,{config,records});await cold.vault.prepare({authorizeMutation:cold.guard});assert.equal(cold.vault.readConfig()[field],record());
});

test('reject malformed or oversized records without any keychain mutation',async t=>{
 const h=fixture(t);
 for(const value of ['not-json','{}',JSON.stringify({source:'calendar',refreshToken:'x'}),JSON.stringify({...JSON.parse(record()),refreshToken:'x'.repeat(20000)})])await assert.rejects(h.vault.saveCredentials(source,value,{expectedValue:'',authorizeMutation:h.guard}));
 await assert.rejects(h.vault.saveCredentials('flomo',record(),{expectedValue:'',authorizeMutation:h.guard}));assert.equal(h.calls.length,0);
});

function fakeSpawnFactory(handler){
 const calls=[];
 const spawn=(command,args,options)=>{
  const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stderr.resume=()=>{};child.kill=()=>{queueMicrotask(()=>child.emit('close',null,'SIGTERM'));return true;};
  child.stdin={end(input=''){calls.push({command,args,options,input});queueMicrotask(()=>handler({child,command,args,input}));},on(){}};
  return child;
 };
 return{spawn,calls};
}

test('macOS adapter puts only the key in bounded stdin and never secret argv or permissive ACL',async()=>{
 assert.equal(typeof mod?.createMacOSGoogleKeychain,'function');
 const f=fakeSpawnFactory(({child})=>child.emit('close',0));const k=mod.createMacOSGoogleKeychain({platform:'darwin',spawn:f.spawn});const account='v1-'+ 'a'.repeat(32)+'-googleSuite-'+ 'b'.repeat(48),key=Buffer.alloc(32,7).toString('base64url');
 await k.write(account,key);const call=f.calls[0];assert.equal(call.command,'/usr/bin/security');assert.deepEqual(call.args,['-q','-i']);assert.equal(JSON.stringify(call.args).includes(key),false);assert.match(call.input,/^add-generic-password /);assert.ok(Buffer.byteLength(call.input)<4096);assert.equal(call.input.includes(' -A'),false);assert.equal(call.input.includes(' -U'),false);assert.equal(call.options.shell,false);assert.equal(call.options.stdio[0],'pipe');
});

test('macOS adapter reads only its exact namespace item and sanitizes child output failures',async()=>{
 assert.equal(typeof mod?.createMacOSGoogleKeychain,'function');const account='v1-'+ 'a'.repeat(32)+'-googleSuite-'+ 'b'.repeat(48),key=Buffer.alloc(32,2).toString('base64url');
 const f=fakeSpawnFactory(({child})=>{child.stdout.emit('data',Buffer.from(key+'\n'));child.emit('close',0);});const k=mod.createMacOSGoogleKeychain({platform:'darwin',spawn:f.spawn});assert.equal(await k.read(account),key);assert.deepEqual(f.calls[0].args,['find-generic-password','-s','com.oxmumu3.dsh-dot.google-token-vault','-a',account,'-w']);
 const bad=fakeSpawnFactory(({child})=>{child.stdout.emit('data',Buffer.from('private child diagnostic'));child.emit('close',1);});const unavailable=mod.createMacOSGoogleKeychain({platform:'darwin',spawn:bad.spawn});await assert.rejects(unavailable.read(account),e=>!String(e).includes('private child diagnostic'));
 await assert.rejects(k.read('foreign-account'));assert.equal(f.calls.length,1);
});

test('unsupported platforms fail closed without spawning or cleartext fallback',async()=>{
 assert.equal(typeof mod?.createMacOSGoogleKeychain,'function');let spawned=0;const k=mod.createMacOSGoogleKeychain({platform:'linux',spawn:()=>{spawned++;}});assert.equal(k.supported,false);await assert.rejects(k.write('foreign','secret'));assert.equal(spawned,0);
});

test('keychain output limits and bounded timeout fail without leaking returned material',async()=>{
 const account='v1-'+ 'a'.repeat(32)+'-googleSuite-'+ 'b'.repeat(48);
 const huge=fakeSpawnFactory(({child})=>child.stdout.emit('data',Buffer.from('synthetic-private-output'.repeat(100))));
 await assert.rejects(mod.createMacOSGoogleKeychain({platform:'darwin',spawn:huge.spawn}).read(account),e=>!String(e).includes('synthetic-private-output'));
 const stuck=fakeSpawnFactory(()=>{});await assert.rejects(mod.createMacOSGoogleKeychain({platform:'darwin',spawn:stuck.spawn,timeoutMs:5}).read(account));
});

test('already aborted keychain calls never spawn a process',async()=>{
 let spawned=0;const keychain=mod.createMacOSGoogleKeychain({platform:'darwin',spawn:()=>{spawned++;}}),controller=new AbortController();controller.abort();
 await assert.rejects(keychain.read('v1-'+ 'a'.repeat(32)+'-googleSuite-'+ 'b'.repeat(48),{signal:controller.signal}));assert.equal(spawned,0);
});
