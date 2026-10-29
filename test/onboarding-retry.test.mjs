import test from 'node:test';
import assert from 'node:assert/strict';
import {createOnboarding} from '../src/onboarding.js';

const root='/synthetic/public-project',other='/synthetic/other-project',stamp='2026-10-29T12:00:00.000Z';
function fixture(){
 let stored,setup,connection={state:'bound',sessionId:'synthetic-owner',bindingKey:'a'.repeat(64)},watched=[{root,label:'公开样例'}],status='idle',putHook,readHook;
 const outcomes=new Map(),admitted=[];
 const open=()=>setup=createOnboarding({store:{get:async()=>structuredClone(stored),put:async(_key,value)=>{await putHook?.(value);stored=structuredClone(value);}},service:{watchedProjects:async()=>structuredClone(watched)},discoverProjects:async()=>structuredClone(watched),readConnection:async()=>structuredClone(connection),resolveOwner:sessionId=>({sessionId,cwd:root,status}),admitWelcome:value=>{admitted.push(value);return{accepted:true};},readWelcome:async input=>{await readHook?.(input);return outcomes.get(input.messageId)??{status:'running'};}});
 open();return{get setup(){return setup;},open,admitted,outcomes,row:()=>structuredClone(stored),replaceRow:value=>{stored=structuredClone(value);},watch:value=>{watched=value;},binding:value=>{connection=value;},status:value=>{status=value;},onPut:fn=>{putHook=fn;},onRead:fn=>{readHook=fn;}};
}
async function failed(h,status='stopped'){
 await h.setup.action({action:'complete'});const id=h.admitted[0].message.id;h.outcomes.set(id,{status,finishedAt:stamp});return h.setup.snapshot();
}

for(const status of ['stopped','no_text'])test('confirmed '+status+' first brief retries once only by explicit original attempt and retains scope/history',async()=>{
 const h=fixture(),before=await failed(h,status);assert.match(before.welcome.retryKey,/^retry_[a-f0-9]{64}$/);assert.equal(before.completed,false);assert.equal(h.admitted.length,1);
 await h.setup.action({action:'complete'});assert.equal(h.admitted.length,1,'ordinary complete and refresh never retry');
 h.watch([{root,label:'公开样例'},{root:other,label:'另一个项目'}]);
 const key=before.welcome.retryKey;await Promise.allSettled([h.setup.action({action:'retry',retryKey:key}),h.setup.action({action:'retry',retryKey:key})]);
 assert.equal(h.admitted.length,2);assert.notEqual(h.admitted[1].message.id,h.admitted[0].message.id);assert.deepEqual(h.admitted[1].roots,[root]);assert.deepEqual(h.row().welcomeRoots,[root]);
 assert.deepEqual(h.row().previousAttempts,[{messageId:h.admitted[0].message.id,status,finishedAt:stamp}]);assert.equal((await h.setup.snapshot()).welcome.retryKey,undefined);assert.equal((await h.setup.snapshot()).welcome.outcome.status,'running');
 await h.setup.close();h.open();await h.setup.action({action:'retry',retryKey:key}).catch(()=>{});assert.equal(h.admitted.length,2);assert.doesNotMatch(JSON.stringify(before),/synthetic\/public-project|bindingKey/);
});

test('retry refuses changed outcome, revoked original project and changed binding without admitting work',async()=>{
 for(const change of ['running','generated','unknown','mixed','revoked','binding']){
  const h=fixture(),before=await failed(h);assert.ok(before.welcome.retryKey);
  if(change==='revoked')h.watch([{root:other,label:'另一项目'}]);else if(change==='binding')h.binding({state:'bound',sessionId:'synthetic-owner',bindingKey:'b'.repeat(64)});else h.outcomes.set(h.admitted[0].message.id,{status:change,reply:'已生成'});
  await h.setup.action({action:'retry',retryKey:before.welcome.retryKey}).catch(()=>{});assert.equal(h.admitted.length,1,change);assert.equal(h.row().messageId,h.admitted[0].message.id);
 }
});

test('legacy stopped attempt is visible without guessing its original project scope',async()=>{
 const h=fixture();await failed(h);const row=h.row();delete row.welcomeRoots;h.replaceRow(row);await h.setup.close();h.open();const before=await h.setup.snapshot();
 assert.equal(before.welcome.outcome.status,'stopped');assert.equal(before.completed,false);assert.equal(before.welcome.retryKey,undefined);
 await h.setup.action({action:'retry',retryKey:'retry_'+'a'.repeat(64)}).catch(()=>{});assert.equal(h.admitted.length,1);
});

test('retry rechecks permission after persistence and does not auto-replay an uncertain intent',async()=>{
 for(const change of ['binding','project','storage']){
  const h=fixture(),before=await failed(h);assert.ok(before.welcome.retryKey);
  h.onPut(async value=>{if(value.welcomeStatus==='dispatching'&&value.messageId!==h.admitted[0].message.id){if(change==='binding')h.binding({state:'bound',sessionId:'synthetic-owner',bindingKey:'b'.repeat(64)});else if(change==='project')h.watch([]);else throw new Error('synthetic write failure');}});
  await h.setup.action({action:'retry',retryKey:before.welcome.retryKey}).catch(()=>{});assert.equal(h.admitted.length,1,change);
  // A complete action on a different binding is a new explicit action, not a
  // replay. Restore the original binding to exercise this attempt's fence.
  h.binding({state:'bound',sessionId:'synthetic-owner',bindingKey:'a'.repeat(64)});
  await h.setup.snapshot();await h.setup.action({action:'complete'}).catch(()=>{});assert.equal(h.admitted.length,1,'uncertain retry cannot be replayed');
 }
});

test('busy original session preserves failed attempt until explicit retry can be admitted',async()=>{
 const h=fixture(),before=await failed(h);assert.ok(before.welcome.retryKey);h.status('running');await h.setup.action({action:'retry',retryKey:before.welcome.retryKey}).catch(()=>{});assert.equal(h.admitted.length,1);assert.equal(h.row().messageId,h.admitted[0].message.id);
 h.status('idle');await h.setup.action({action:'retry',retryKey:before.welcome.retryKey});assert.equal(h.admitted.length,2);
});

test('late old result never replaces current attempt and bounded prior attempts survive restart',async()=>{
 const h=fixture();await failed(h);
 for(let i=0;i<7;i++){
  const current=h.row().messageId;h.outcomes.set(current,{status:i%2?'no_text':'stopped',finishedAt:stamp});
  const before=await h.setup.snapshot();await h.setup.action({action:'retry',retryKey:before.welcome.retryKey});
 }
 assert.equal(h.admitted.length,8);assert.equal(h.row().previousAttempts.length,5);
 assert.deepEqual(h.row().previousAttempts.map(p=>p.messageId),h.admitted.slice(2,7).map(a=>a.message.id));
 h.outcomes.set(h.admitted[0].message.id,{status:'generated',reply:'OLD RESULT MUST NOT APPEAR',finishedAt:stamp});
 await h.setup.close();h.open();const pending=await h.setup.snapshot();assert.equal(pending.welcome.outcome.status,'running');assert.doesNotMatch(JSON.stringify(pending),/OLD RESULT|previousAttempts/);
 h.outcomes.set(h.row().messageId,{status:'generated',reply:'Current attempt completed',finishedAt:stamp});const complete=await h.setup.snapshot();assert.equal(complete.welcome.outcome.reply,'Current attempt completed');assert.equal(complete.welcome.retryKey,undefined);
 await h.setup.action({action:'complete'});assert.equal(h.admitted.length,8);
});

test('retry admission followed by receipt-write failure stays unknown and cannot admit again after restart',async()=>{
 const h=fixture(),before=await failed(h);let rejected=false;
 h.onPut(async value=>{if(!rejected&&value.welcomeStatus==='accepted'&&value.messageId!==h.admitted[0].message.id){rejected=true;throw new Error('synthetic receipt write failure');}});
 await h.setup.action({action:'retry',retryKey:before.welcome.retryKey});assert.equal(h.admitted.length,2);assert.equal(h.row().welcomeStatus,'unknown');
 await h.setup.close();h.open();await h.setup.snapshot();await h.setup.action({action:'complete'});await h.setup.action({action:'retry',retryKey:before.welcome.retryKey}).catch(()=>{});assert.equal(h.admitted.length,2);
});

test('explicit phone confirmation prevents retry even if observation later reports an empty terminal turn',async()=>{
 const h=fixture(),before=await failed(h);await h.setup.action({action:'confirm_received'});assert.equal((await h.setup.snapshot()).welcome.retryKey,undefined);
 await h.setup.action({action:'retry',retryKey:before.welcome.retryKey}).catch(()=>{});assert.equal(h.admitted.length,1);
});
