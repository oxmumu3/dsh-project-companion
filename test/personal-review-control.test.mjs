import test from 'node:test';import assert from 'node:assert/strict';
import {createPersonalReviewControl,registerPersonalReviewControl} from '../src/personal-review-control.js';import {bindingRevision} from '../src/workbench-scope.js';
function fixture(){let state={state:'bound',sessionId:'family_owner_test',bindingKey:'a'.repeat(64),readOnly:true},current=true,schedule={dailyTime:'09:00'},closed=false;const calls=[];const caller={sessionId:state.sessionId,cwd:'/owner'};
 const control=createPersonalReviewControl({readConnection:async()=>structuredClone(state),resolveOwner:()=>caller,isOwnerCurrent:()=>current,isClosed:()=>closed,review:{snapshot:async()=>({schedule}),act:async(c,i)=>{assert.equal(i.authorizeSync(),true);await i.guard();calls.push(i);return{attention:{enabled:i.enabled}};}}});
 return{control,calls,input:()=>({enabled:true,expectedBindingRevision:bindingRevision(state)}),rebind:()=>state.bindingKey='b'.repeat(64),revoke:()=>current=false,noPlan:()=>schedule=null,member:()=>state.sessionId='family_member_test',close:()=>closed=true};}
test('native control toggles only existing shared Owner attention without changing source scope',async()=>{const f=fixture();await f.control.action(f.input());assert.equal(f.calls.length,1);assert.equal(f.calls[0].action,'attention');assert.equal(f.calls[0].sources,undefined);assert.equal(f.calls[0].projects,undefined);});
test('standalone Dot owner can enable existing attention without Family when guarded binding is current',async()=>{
 const c={state:'bound',sessionId:'standalone-owner',bindingKey:'c'.repeat(64)},calls=[];
 const control=createPersonalReviewControl({readConnection:async()=>c,resolveOwner:()=>({sessionId:c.sessionId,cwd:'/owner'}),isOwnerCurrent:()=>true,review:{snapshot:async()=>({schedule:{dailyTime:'09:00'}}),act:async(_caller,input)=>{calls.push(input);return{attention:{enabled:true}};}}});
 await control.action({enabled:true,expectedBindingRevision:bindingRevision(c)});assert.equal(calls.length,1);assert.equal(calls[0].sources,undefined);
});
test('stale UI, members, revoked grants, absent plan and unknown fields all fail before mutation',async()=>{for(const mode of ['rebind','revoke','noPlan','member','close','extra']){const f=fixture(),input=f.input();if(mode==='extra')input.sources=['gmail'];else f[mode]();await assert.rejects(f.control.action(input));assert.equal(f.calls.length,0);}});
test('route exists only on official connection carrier and rejects oversized/malformed mutations',async()=>{let route;registerPersonalReviewControl({get:()=>({fetch:{register:r=>{route=r;}}}),effect:()=>{}},{action:async()=>({ok:true})});
 assert.deepEqual(route.methods,['POST']);assert.equal((await route.fetch(new Request('http://local'+route.path,{method:'GET'}))).status,405);assert.equal((await route.fetch(new Request('http://local'+route.path,{method:'POST',headers:{'Content-Type':'application/json'},body:'x'.repeat(1025)}))).status,413);
});
test('native control rechecks while awaiting subscription lookup',async()=>{
 let current=true,started,release;const entered=new Promise(r=>started=r),wait=new Promise(r=>release=r);let calls=0;const c={state:'bound',sessionId:'family_owner_test',bindingKey:'a'.repeat(64)};
 const control=createPersonalReviewControl({readConnection:async()=>c,resolveOwner:()=>({sessionId:c.sessionId,cwd:'/owner'}),isOwnerCurrent:()=>current,review:{snapshot:async()=>{started();await wait;return{schedule:{dailyTime:'09:00'}};},act:async()=>calls++}});
 const pending=control.action({enabled:true,expectedBindingRevision:bindingRevision(c)});await entered;current=false;release();await assert.rejects(pending);assert.equal(calls,0);
});
