import test from 'node:test';
import assert from 'node:assert/strict';
import {createOnboarding} from '../src/onboarding.js';

const sessionId='source',messageId='original-welcome';
const stamp='2026-10-19T17:00:00.000Z';
const start=(turn=7)=>({type:'turn/start',data:{turn}});
const user=(id=messageId,turn=7,kind='user')=>({type:'user/message',data:{id,turn,source:{kind},content:[{type:'text',text:'PRIVATE PROMPT'}]}});
const answer=(text='第一份项目简报',turn=7,extra={})=>({type:'assistant/message',data:{turn,message:{role:'assistant',content:[{type:'reasoning',text:'PRIVATE REASONING'},{type:'text',text}]},...extra}});
const end=(turn=7,reason='completed')=>({type:'turn/end',time:stamp,data:{turn,reason:{kind:reason}}});
async function observe(events,overrides={}){
  const api=await import('../src/onboarding-outcome.js').catch(()=>({}));
  assert.equal(typeof api.observeWelcomeOutcome,'function','a passive exact-message outcome observer is required');
  return api.observeWelcomeOutcome({session:{id:sessionId,events},sessionId,messageId,...overrides});
}

test('outcome distinguishes claimed work from a completed original reply',async()=>{
  assert.deepEqual(await observe([start(),user()]),{status:'running'});
  const result=await observe([start(),user(),answer(),end()]);
  assert.deepEqual(result,{status:'generated',reply:'第一份项目简报',finishedAt:stamp});
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE|source|original-welcome/);
});
test('foreign message ids, source kinds and sessions cannot produce the welcome outcome',async()=>{
  for(const events of [[start(),user('other'),answer(),end()],[start(),user(messageId,7,'plugin'),answer(),end()]]){
    assert.deepEqual(await observe(events),{status:'unknown'});
  }
  assert.deepEqual(await observe([start(),user(),answer(),end()],{session:{id:'foreign',events:[start(),user(),answer(),end()]}}),{status:'unknown'});
});
test('duplicate anchors and missing or inconsistent committed turn boundaries stay unknown',async()=>{
  for(const events of [[user(),answer(),end()],[start(8),user(),answer(),end()],[start(),user(),user(),answer(),end()],[start(),user(),answer(),end(8)]]){
    assert.deepEqual(await observe(events),{status:'unknown'});
  }
});
test('mixed direct user inputs before or after the original input discard the reply',async()=>{
  for(const events of [[start(),user('other'),user(),answer(),end()],[start(),user(),answer(),user('other'),end()]]){
    assert.deepEqual(await observe(events),{status:'mixed'});
  }
});
test('later user turns cannot supply a missing or late reply to the original turn',async()=>{
  assert.deepEqual(await observe([start(),user(),end(),start(8),user('new-user',8),answer('FOREIGN REPLY',8),end(8)]),{status:'no_text',finishedAt:stamp});
  assert.deepEqual(await observe([start(),user(),start(8),user('new-user',8),answer('LATE OLD REPLY',7),end(7)]),{status:'unknown'});
  assert.deepEqual(await observe([start(),user(),answer('ORIGINAL'),end(),start(8),user('new-user',8),answer('FOREIGN',8),end(8)]),{status:'generated',reply:'ORIGINAL',finishedAt:stamp});
});
test('only noninterrupted exact-turn assistant text from a successful committed turn is exposed',async()=>{
  assert.deepEqual(await observe([start(),answer('BEFORE THE ORIGINAL REQUEST'),user(),end()]),{status:'no_text',finishedAt:stamp});
  assert.deepEqual(await observe([start(),user(),answer('WRONG TURN',8),answer('INTERRUPTED',7,{interrupted:true}),end()]),{status:'no_text',finishedAt:stamp});
  for(const reason of ['aborted','error','max-tokens','blocked','interrupted','forked','made-up']){
    assert.deepEqual(await observe([start(),user(),answer('PARTIAL'),end(7,reason)]),{status:'stopped',finishedAt:stamp});
  }
  assert.deepEqual(await observe([start(),user(),answer('UNCOMMITTED')]),{status:'running'});
});
test('the observer is bounded, strips controls and never leaks reasoning or invalid timestamps',async()=>{
  const text='\u0000简报\n'+'😀'.repeat(2000);
  const result=await observe([start(),user(),answer(text),{...end(),time:'UNTRUSTED TIME'}]);
  assert.equal(result.status,'generated');assert.equal(result.replyTruncated,true);
  assert.ok(result.reply.length<=3200);assert.equal(result.reply.toWellFormed(),result.reply);
  assert.doesNotMatch(result.reply,/\u0000|PRIVATE/);assert.equal(result.finishedAt,undefined);
  assert.deepEqual(await observe([start(),user(),answer(),end(),...Array.from({length:2000},()=>({type:'other',data:{}}))]),{status:'unknown'});
  assert.deepEqual(await observe([start(),user(),answer(),end()],{session:{id:sessionId,snapshotEvents:()=>[start(),user(),answer(),end()]}}),{status:'generated',reply:'第一份项目简报',finishedAt:stamp});
});

function setupFixture({readWelcome,initial,clock=()=>new Date(stamp),put,watchedProjects=async()=>[],mutableCarrier=false}={}){
  let row=structuredClone(initial??{id:'profile',version:1,completed:true,welcomeStatus:'accepted',sessionId,bindingKey:'a'.repeat(64),messageId});
  let connection={state:'bound',sessionId,bindingKey:'a'.repeat(64)},writes=0,admissions=0,activations=0;
  const setup=createOnboarding({store:{get:async()=>structuredClone(row),put:async(_key,value)=>{if(put)await put(value);row=structuredClone(value);writes++;}},
    service:{watchedProjects},discoverProjects:async()=>[],readConnection:async()=>mutableCarrier?connection:structuredClone(connection),
    resolveOwner:()=>assert.fail('passive observation or receipt must not resolve/resume a source'),
    activateOwner:()=>{activations++;},admitWelcome:()=>{admissions++;return{accepted:true};},readWelcome,clock});
  return{setup,row:()=>row,writes:()=>writes,admissions:()=>admissions,activations:()=>activations,connection:value=>{if(mutableCarrier)Object.assign(connection,value);else connection=value;}};
}
test('accepted welcome and generated reply leave phone receipt explicitly unconfirmed',async()=>{
  const absent=setupFixture();const first=await absent.setup.snapshot();
  assert.equal(first.completed,true);assert.equal(first.welcome.status,'accepted');
  assert.deepEqual(first.welcome.outcome,{status:'unknown'});assert.deepEqual(first.welcome.receipt,{status:'unconfirmed'});assert.equal(absent.writes(),0);
  const calls=[];const h=setupFixture({readWelcome:async input=>{calls.push(input);return{status:'generated',reply:'已生成',finishedAt:stamp,receivedAt:stamp,delivery:'sent'};}});
  const result=await h.setup.snapshot();assert.deepEqual(calls,[{sessionId,messageId}]);
  assert.deepEqual(result.welcome.outcome,{status:'generated',reply:'已生成',finishedAt:stamp});
  assert.deepEqual(result.welcome.receipt,{status:'unconfirmed'});assert.equal(h.writes(),0);assert.equal(h.admissions(),0);assert.equal(h.activations(),0);
});
test('phone confirmation uses only the exact explicit action and a server timestamp and is idempotent across reload',async()=>{
  const h=setupFixture();
  for(const extra of [{receivedAt:'1999-01-01T00:00:00.000Z'},{userReceivedAt:stamp},{text:'received'},{messageId:'other'},{confirmed:true}]){
    await assert.rejects(h.setup.action({action:'confirm_received',...extra}));
  }
  assert.equal(h.writes(),0);
  const first=await h.setup.action({action:'confirm_received'});
  assert.deepEqual(first.welcome.receipt,{status:'user_confirmed',receivedAt:stamp});
  assert.equal(first.welcome.status,'accepted');assert.equal(h.row().userReceivedAt,stamp);assert.equal(h.writes(),1);
  await h.setup.action({action:'confirm_received'});assert.equal(h.writes(),1);
  const reloaded=setupFixture({initial:h.row(),clock:()=>new Date('2026-10-20T00:00:00.000Z')});
  assert.deepEqual((await reloaded.setup.action({action:'confirm_received'})).welcome.receipt,first.welcome.receipt);
  assert.equal(reloaded.writes(),0);assert.equal(reloaded.admissions(),0);
});
test('a phone confirmation cannot attach to a changed pairing or a nonexistent welcome',async()=>{
  const h=setupFixture();h.connection({state:'bound',sessionId,bindingKey:'b'.repeat(64)});
  await assert.rejects(h.setup.action({action:'confirm_received'}));assert.equal(h.writes(),0);assert.equal((await h.setup.snapshot()).welcome,undefined);
  const fresh=setupFixture({initial:{id:'profile',version:1,completed:false,welcomeStatus:'none',sessionId:null,bindingKey:null,messageId:null}});
  await assert.rejects(fresh.setup.action({action:'confirm_received'}));assert.equal(fresh.writes(),0);
});
test('a changed binding during observation suppresses the old reply and cannot confirm receipt',async()=>{
  let h;h=setupFixture({readWelcome:async()=>{h.connection({state:'bound',sessionId,bindingKey:'b'.repeat(64)});return{status:'generated',reply:'OLD BINDING',finishedAt:stamp};}});
  const snapshot=await h.setup.snapshot();assert.equal(snapshot.welcome,undefined);assert.doesNotMatch(JSON.stringify(snapshot),/OLD BINDING/);
  await assert.rejects(h.setup.action({action:'confirm_received'}));assert.equal(h.writes(),0);
});
for(const during of ['projectRows','readWelcome'])test(`a shared mutable connection carrier changed during ${during} cannot expose the original binding's brief or confirmation`,async()=>{
  const initial={id:'profile',version:1,completed:true,welcomeStatus:'accepted',sessionId,bindingKey:'a'.repeat(64),messageId,userReceivedAt:stamp};
  let h,reads=0;
  const mutate=()=>h.connection({state:'bound',sessionId,bindingKey:'b'.repeat(64)});
  h=setupFixture({initial,mutableCarrier:true,
    watchedProjects:async()=>{if(during==='projectRows')mutate();return[];},
    readWelcome:async()=>{reads++;if(during==='readWelcome')mutate();return{status:'generated',reply:'PRIVATE ORIGINAL BRIEF',finishedAt:stamp};},
  });
  const snapshot=await h.setup.snapshot();
  assert.equal(snapshot.completed,false);
  assert.equal(snapshot.welcome,undefined);
  assert.doesNotMatch(JSON.stringify(snapshot),/PRIVATE ORIGINAL BRIEF|user_confirmed|receivedAt/);
  assert.equal(reads,during==='projectRows'?0:1);
  await assert.rejects(h.setup.action({action:'confirm_received'}));assert.equal(h.writes(),0);
});
test('an in-memory project preview is also withheld when a shared carrier changes during awaited project discovery',async()=>{
  const carrier={state:'bound',sessionId,bindingKey:'a'.repeat(64)},project={root:'/synthetic/selected-project',label:'selected'};
  let watched=false,change=false;
  const setup=createOnboarding({store:{get:async()=>undefined,put:async()=>assert.fail('selection must not submit a welcome')},
    service:{watchedProjects:async()=>{if(change)carrier.bindingKey='b'.repeat(64);return watched?[project]:[];},act:async(_owner,input)=>{if(input.action==='watch')watched=true;return{wechatText:'PRIVATE PROJECT PREVIEW'};}},
    discoverProjects:async()=>[project],readConnection:async()=>carrier,resolveOwner:()=>({sessionId,cwd:project.root,status:'idle'}),admitWelcome:()=>assert.fail('must not admit'),
  });
  const before=await setup.snapshot();
  assert.equal((await setup.action({action:'select_projects',projectIds:[before.projects[0].id]})).firstBrief,'PRIVATE PROJECT PREVIEW');
  change=true;const snapshot=await setup.snapshot();
  assert.equal(snapshot.firstBrief,undefined);assert.equal(snapshot.completed,false);
  assert.doesNotMatch(JSON.stringify(snapshot),/PRIVATE PROJECT PREVIEW/);
});
test('binding is checked immediately before passive observation and receipt persistence',async()=>{
  let h,calls=0;
  h=setupFixture({readWelcome:()=>{calls++;return{status:'generated',reply:'OLD BINDING'};},watchedProjects:async()=>{h.connection({state:'bound',sessionId,bindingKey:'b'.repeat(64)});return[];}});
  assert.equal((await h.setup.snapshot()).welcome,undefined);assert.equal(calls,0);
  const changed=setupFixture({put:async()=>{changed.connection({state:'bound',sessionId,bindingKey:'b'.repeat(64)});}});
  await assert.rejects(changed.setup.action({action:'confirm_received'}),/变化/);
  assert.equal((await changed.setup.snapshot()).welcome,undefined);
});
test('failed confirmation persistence cannot appear as a saved phone confirmation',async()=>{
  const h=setupFixture({put:async()=>{throw new Error('storage unavailable');}});
  await assert.rejects(h.setup.action({action:'confirm_received'}));
  assert.deepEqual((await h.setup.snapshot()).welcome.receipt,{status:'unconfirmed'});assert.equal(h.row().userReceivedAt,undefined);
});
test('unavailable and stalled passive observations remain unknown without resubmitting',async()=>{
  for(const readWelcome of [async()=>{throw new Error('unavailable');},()=>new Promise(()=>{})]){
    const h=setupFixture({readWelcome});
    const snapshot=await Promise.race([h.setup.snapshot(),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('observation exceeded its bound')),1500);timer.unref();})]);
    assert.deepEqual(snapshot.welcome.outcome,{status:'unknown'});
    assert.equal((await h.setup.action({action:'complete'})).welcome.status,'accepted');
    assert.equal(h.writes(),0);assert.equal(h.admissions(),0);
  }
});
