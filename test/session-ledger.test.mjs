import test from 'node:test';
import assert from 'node:assert/strict';
import {createSessionLedger,emptyLedger,reduceLedger,projectLedger,ledgerText,grantForCwd,ledgerEligible,ledgerTarget,projectPublicId,sessionLedgerRowSchema} from '../src/session-ledger.js';

const T=(second)=>new Date(Date.UTC(2026,10,11,2,0,second)).toISOString();
const base={sessionId:'session-synthetic-a',root:'/synthetic/project-a',projectLabel:'合成项目 A',title:'合成会话 A'};
const ev=(kind,second,extra={})=>({...base,kind,at:T(second),...extra});

function fixture(initial=undefined){
  let saved=initial;
  const writes=[];
  const store={get:async()=>saved===undefined?undefined:structuredClone(saved),put:async(_key,value)=>{await new Promise(resolve=>setTimeout(resolve,0));saved=structuredClone(value);writes.push(value);}};
  return{ledger:createSessionLedger({store,clock:()=>new Date(T(0))}),writes,get saved(){return saved},store};
}

test('empty ledger starts from empty and never invents states',async()=>{
  const f=fixture();
  const snapshot=await f.ledger.snapshot();
  assert.equal(snapshot.revision,0);
  assert.deepEqual(snapshot.counts,{done:0,wait:0,stuck:0,run:0,total:0});
  assert.deepEqual(snapshot.sessions,[]);
  assert.deepEqual(snapshot.projects,[]);
  assert.equal(snapshot.sample,false);
  assert.equal(f.writes.length,0);
});

test('every state transition in the M1 table, with duplicate same-state events not bumping revision',async()=>{
  const f=fixture();
  const view=()=>f.ledger.snapshot();
  let r=await f.ledger.apply(ev('start',1));
  assert.equal(r.transition,true);
  let s=await view();
  assert.equal(s.sessions[0].state,'doing');
  assert.equal(s.sessions[0].what,'');
  assert.equal(s.revision,1);

  await f.ledger.apply(ev('assistant',2,{text:'第一条回复\n第二行'}));
  s=await view();
  assert.equal(s.sessions[0].state,'doing');
  assert.equal(s.sessions[0].what,'第一条回复 第二行');
  assert.equal(s.revision,1);

  r=await f.ledger.apply(ev('approval-asked',3,{toolName:'bash',reasonText:'在临时目录建一个空文件'}));
  assert.equal(r.transition,true);
  s=await view();
  assert.equal(s.sessions[0].state,'needs_you');
  assert.equal(s.sessions[0].short,'等你');
  assert.match(s.sessions[0].what,/bash/);
  assert.equal(s.revision,2);

  r=await f.ledger.apply(ev('approval-asked',4,{toolName:'bash',reasonText:'在临时目录建一个空文件'}));
  assert.equal(r.transition,false);
  s=await view();
  assert.equal(s.revision,2);

  await f.ledger.apply(ev('approval-decided',5,{outcome:'allowed-once'}));
  s=await view();
  assert.equal(s.sessions[0].state,'doing');
  assert.equal(s.revision,3);

  await f.ledger.apply(ev('turn-end',6,{reason:{kind:'completed'}}));
  s=await view();
  assert.equal(s.sessions[0].state,'done');
  assert.equal(s.sessions[0].what,'第一条回复 第二行');
  assert.equal(s.revision,4);

  r=await f.ledger.apply(ev('turn-end',7,{reason:{kind:'completed'}}));
  assert.equal(r.transition,false);
  s=await view();
  assert.equal(s.revision,4);

  await f.ledger.apply(ev('start',8));
  s=await view();
  assert.equal(s.sessions[0].state,'doing');
  assert.equal(s.sessions[0].what,'第一条回复 第二行','a new turn keeps the previous reply as the opening what');
  assert.equal(s.revision,5);

  await f.ledger.apply(ev('assistant',9,{text:'第二条回复'}));
  await f.ledger.apply(ev('turn-end',10,{reason:{kind:'error',message:'第一行错误\n第二行细节'}}));
  s=await view();
  assert.equal(s.sessions[0].state,'stuck');
  assert.equal(s.sessions[0].what,'第一行错误');
  assert.equal(s.revision,6);

  await f.ledger.apply(ev('start',11));
  await f.ledger.apply(ev('turn-end',12,{reason:{kind:'max-tokens'}}));
  s=await view();
  assert.equal(s.sessions[0].state,'stuck');
  assert.equal(s.sessions[0].what,'回答太长，被截断了');
  assert.equal(s.revision,8);

  await f.ledger.apply(ev('start',13));
  await f.ledger.apply(ev('turn-end',14,{reason:{kind:'aborted'}}));
  s=await view();
  const handled=f.saved.sessions[0];
  assert.equal(handled.state,'handled');
  assert.equal(handled.what,'停了');
  assert.equal(s.counts.total,0,'handled is not on the first screen');
  assert.equal(s.revision,10);

  await f.ledger.apply(ev('start',15));
  await f.ledger.apply(ev('turn-end',16,{reason:{kind:'blocked',message:'等外部条件'}}));
  s=await view();
  assert.equal(s.sessions[0].state,'stuck');
  assert.equal(s.sessions[0].what,'等外部条件');
  assert.equal(s.revision,12);

  await f.ledger.apply(ev('start',17));
  await f.ledger.apply(ev('turn-end',18,{reason:{kind:'interrupted'}}));
  s=await view();
  assert.equal(s.sessions[0].state,'stuck');
  assert.equal(s.sessions[0].what,'interrupted');
  assert.equal(s.revision,14);

  await f.ledger.apply(ev('start',19));
  const before=(await view()).revision;
  r=await f.ledger.apply(ev('turn-end',20,{reason:{kind:'forked'}}));
  assert.equal(r.changed,false);
  s=await view();
  assert.equal(s.sessions[0].state,'doing');
  assert.equal(s.revision,before);
});

test('a session first seen at turn/end gets one clean row without guessing a start',async()=>{
  const f=fixture();
  await f.ledger.apply(ev('turn-end',1,{reason:{kind:'completed'}}));
  const s=await f.ledger.snapshot();
  assert.equal(s.sessions.length,1);
  assert.equal(s.sessions[0].state,'done');
  assert.equal(s.sessions[0].startedAt,T(1));
});

test('what is redacted and capped at 160 characters',async()=>{
  const f=fixture();
  await f.ledger.apply(ev('start',1));
  await f.ledger.apply(ev('assistant',2,{text:`Bearer abc.def.ghi ${'字'.repeat(300)}`}));
  const s=await f.ledger.snapshot();
  assert.equal(s.sessions[0].what.includes('abc.def.ghi'),false);
  assert.match(s.sessions[0].what,/Bearer \[已隐藏\]/);
  assert.equal(s.sessions[0].what.length,160);
});

test('scope is the authorized workspace root or a real descendant, never a sibling prefix',()=>{
  const grants=[{id:'a',root:'/synthetic/project-a',label:'A'},{id:'b',root:'/synthetic/project-ab',label:'AB'},{id:'nested',root:'/synthetic/project-a/sub',label:'Nested'}];
  assert.equal(grantForCwd('/synthetic/project-a',grants).id,'a');
  assert.equal(grantForCwd('/synthetic/project-b',grants),null);
  assert.equal(grantForCwd('/synthetic/project-ab',grants).id,'b');
  assert.equal(grantForCwd('/synthetic/project-a/sub/deep',grants).id,'nested');
  assert.equal(grantForCwd('relative/path',grants),null);
});

test('foreground Dot sessions and family_member_ sessions are excluded',()=>{
  const foreground=new Set(['session-dot-front']);
  assert.equal(ledgerEligible('session-project',{foreground}),true);
  assert.equal(ledgerEligible('session-dot-front',{foreground}),false);
  assert.equal(ledgerEligible('family_member_1',{foreground}),false);
  assert.equal(ledgerEligible('',{foreground}),false);
  assert.equal(ledgerEligible(null,{foreground}),false);
});

test('combined target helper admits only eligible, authorized project sessions',()=>{
  const grants=[{id:'a',root:'/synthetic/project-a',label:'A'}];
  assert.deepEqual(ledgerTarget('session-one','/synthetic/project-a',grants,{foreground:new Set()}),{sessionId:'session-one',grant:grants[0]});
  assert.equal(ledgerTarget('session-one','/synthetic/outside',grants,{foreground:new Set()}),null);
  assert.equal(ledgerTarget('session-dot','/synthetic/project-a',grants,{foreground:new Set(['session-dot'])}),null);
  assert.equal(ledgerTarget('family_member_1','/synthetic/project-a',grants,{foreground:new Set()}),null);
});

test('reducer ignores out-of-scope or malformed events without writing',async()=>{
  const f=fixture();
  for(const event of [null,{kind:'start'},{...base,root:'relative',kind:'start',at:T(1)},{...base,kind:'unknown',at:T(1)}]){
    const r=await f.ledger.apply(event);
    assert.equal(r.changed,false);
  }
  assert.equal(f.writes.length,0);
});

test('concurrent events serialize and never lose rows',async()=>{
  const f=fixture();
  await Promise.all(Array.from({length:30},(_,i)=>f.ledger.apply({sessionId:`session-${i}`,root:`/synthetic/p${i%3}`,projectLabel:`P${i%3}`,title:`T${i}`,kind:'start',at:T(i)})));
  const s=await f.ledger.snapshot();
  assert.equal(s.sessions.length,30);
  assert.equal(s.projects.length,3);
  assert.equal(s.revision,30);
});

test('projection has the DESIGN 3.8 shape, count semantics and project last-moved time',async()=>{
  const f=fixture();
  await f.ledger.apply(ev('start',1));
  await f.ledger.apply({...base,sessionId:'session-b',kind:'start',at:T(2),title:'B'});
  await f.ledger.apply({...base,sessionId:'session-b',kind:'approval-asked',at:T(3),toolName:'bash',reasonText:'test'});
  await f.ledger.apply({...base,sessionId:'session-c',root:'/synthetic/project-c',projectLabel:'C',kind:'turn-end',at:T(4),reason:{kind:'completed'}});
  await f.ledger.apply({...base,sessionId:'session-d',kind:'turn-end',at:T(5),reason:{kind:'aborted'}});
  const s=await f.ledger.snapshot({connection:'bound'});
  assert.deepEqual(Object.keys(s).sort(),['connection','counts','noticed','projects','promises','reachable','revision','sample','sessions','sources']);
  assert.deepEqual(s.connection,{wechat:'bound'});
  assert.deepEqual(s.counts,{done:1,wait:1,stuck:0,run:1,total:3});
  assert.equal(s.sessions.length,3);
  assert.equal(s.sessions.some(row=>row.state==='handled'),false);
  assert.equal(s.projects.length,2);
  assert.equal(s.projects.find(project=>project.id===projectPublicId('/synthetic/project-a')).lastMovedAt,T(5));
  assert.equal(s.projects[0].slot,0);
  assert.deepEqual([s.promises,s.noticed,s.sources],[[],[],[]]);
  assert.equal(s.sample,false);
});

test('front-door text names every project and session state',async()=>{
  const f=fixture();
  await f.ledger.apply(ev('start',1));
  await f.ledger.apply({...base,sessionId:'session-b',root:'/synthetic/project-c',projectLabel:'合成项目 C',kind:'turn-end',at:T(2),reason:{kind:'error',message:'失败了'}});
  const text=ledgerText(await f.ledger.snapshot());
  assert.match(text,/合成项目 A/);
  assert.match(text,/合成项目 C/);
  assert.match(text,/正在做/);
  assert.match(text,/卡住/);
  assert.match(text,/失败了/);
});

test('persisted row is schema-checked and reloads as the same state',async()=>{
  const f=fixture();
  await f.ledger.apply(ev('start',1));
  assert.equal(sessionLedgerRowSchema.safeParse(f.saved).success,true);
  const reloaded=createSessionLedger({store:f.store});
  const s=await reloaded.snapshot();
  assert.equal(s.sessions.length,1);
  assert.equal(s.revision,1);
});

test('pure reducer leaves its input untouched',()=>{
  const input=emptyLedger();
  const out=reduceLedger(input,ev('start',1));
  assert.equal(input.revision,0);
  assert.equal(input.sessions.length,0);
  assert.equal(out.state.revision,1);
  assert.equal(out.state.sessions.length,1);
});

test('a late approval decision cannot reopen a finished or next-turn session',async()=>{
  const f=fixture();
  await f.ledger.apply(ev('start',1));
  await f.ledger.apply(ev('assistant',2,{text:'真正的回复'}));
  await f.ledger.apply(ev('approval-asked',3,{toolName:'bash',reasonText:'需要批准',approvalId:'a1'}));
  let s=await f.ledger.snapshot();
  assert.equal(s.sessions[0].state,'needs_you');
  const wrong=await f.ledger.apply(ev('approval-decided',4,{approvalId:'a2'}));
  assert.equal(wrong.changed,false);
  s=await f.ledger.snapshot();
  assert.equal(s.sessions[0].state,'needs_you');
  await f.ledger.apply(ev('approval-decided',5,{approvalId:'a1'}));
  await f.ledger.apply(ev('turn-end',6,{reason:{kind:'completed'}}));
  s=await f.ledger.snapshot();
  assert.equal(s.sessions[0].state,'done');
  assert.equal(s.sessions[0].what,'真正的回复');
  const late=await f.ledger.apply(ev('approval-decided',7,{approvalId:'a1'}));
  assert.equal(late.changed,false);
  s=await f.ledger.snapshot();
  assert.equal(s.sessions[0].state,'done');
});

test('two approvals in one turn only clear the matching request',async()=>{
  const f=fixture();
  await f.ledger.apply(ev('start',1));
  await f.ledger.apply(ev('approval-asked',2,{toolName:'bash',reasonText:'第一条',approvalId:'one'}));
  await f.ledger.apply(ev('approval-asked',3,{toolName:'write',reasonText:'第二条',approvalId:'two'}));
  let s=await f.ledger.snapshot();
  assert.equal(s.sessions[0].state,'needs_you');
  const first=await f.ledger.apply(ev('approval-decided',4,{approvalId:'one'}));
  assert.equal(first.changed,false);
  s=await f.ledger.snapshot();
  assert.equal(s.sessions[0].state,'needs_you');
  await f.ledger.apply(ev('approval-decided',5,{approvalId:'two'}));
  s=await f.ledger.snapshot();
  assert.equal(s.sessions[0].state,'doing');
});

test('an empty assistant event never erases the last useful reply',async()=>{
  const f=fixture();
  await f.ledger.apply(ev('start',1));
  await f.ledger.apply(ev('assistant',2,{text:'保留这句'}));
  await f.ledger.apply(ev('assistant',3,{text:'   '}));
  const s=await f.ledger.snapshot();
  assert.equal(s.sessions[0].what,'保留这句');
  await f.ledger.apply(ev('turn-end',4,{reason:{kind:'completed'}}));
  assert.equal((await f.ledger.snapshot()).sessions[0].what,'保留这句');
});

test('completed without an assistant reply does not use the approval command as summary',async()=>{
  const f=fixture();
  await f.ledger.apply(ev('start',1));
  await f.ledger.apply(ev('approval-asked',2,{toolName:'bash',reasonText:'不要当摘要',approvalId:'x'}));
  await f.ledger.apply(ev('turn-end',3,{reason:{kind:'completed'}}));
  const s=await f.ledger.snapshot();
  assert.equal(s.sessions[0].state,'done');
  assert.equal(s.sessions[0].what,'');
});

test('projection drops revoked roots from sessions, counts and project last-moved time',async()=>{
  const f=fixture();
  await f.ledger.apply(ev('start',1));
  await f.ledger.apply({...base,sessionId:'session-b',root:'/synthetic/project-b',projectLabel:'B',kind:'start',at:T(2)});
  const all=await f.ledger.snapshot();
  assert.equal(all.counts.total,2);
  const onlyA=await f.ledger.snapshot({grants:[{root:base.root,label:'A'}]});
  assert.equal(onlyA.counts.total,1);
  assert.equal(onlyA.projects.length,1);
  assert.equal(onlyA.projects[0].name,'合成项目 A');
  assert.equal(onlyA.sessions[0].projectId,projectPublicId(base.root));
  const none=await f.ledger.snapshot({grants:[]});
  assert.deepEqual(none.counts,{done:0,wait:0,stuck:0,run:0,total:0});
  assert.deepEqual(none.projects,[]);
});

test('failed disk writes leave the in-memory view on the last successful save',async()=>{
  let saved=undefined,fail=true,writes=0;
  const store={get:async()=>saved===undefined?undefined:structuredClone(saved),put:async(_key,value)=>{if(fail)throw new Error('disk full');writes+=1;saved=structuredClone(value);}};
  const ledger=createSessionLedger({store});
  await assert.rejects(ledger.apply(ev('start',1)),/disk full/);
  assert.equal((await ledger.snapshot()).sessions.length,0);
  fail=false;
  await ledger.apply(ev('start',2));
  assert.equal(writes,1);
  assert.equal((await ledger.snapshot()).sessions.length,1);
});

test('capacity keeps the row count inside the schema bound',()=>{
  let state=emptyLedger();
  for(let i=0;i<501;i+=1)state=reduceLedger(state,{sessionId:'session-'+i,root:'/synthetic/p',projectLabel:'P',kind:'start',at:T(i%60)}).state;
  assert.equal(state.sessions.length,500);
  assert.equal(sessionLedgerRowSchema.safeParse(state).success,true);
});
