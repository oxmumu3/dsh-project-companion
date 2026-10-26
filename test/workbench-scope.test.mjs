import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {bindingRevision,matchesBindingRevision} from '../src/workbench-scope.js';
import {createContextRoute} from '../src/context-route.js';
import {createWorkbenchActions} from '../src/workbench-actions.js';
const first={state:'bound',sessionId:'owner-a',bindingKey:'a'.repeat(64)};
const next={...first,bindingKey:'b'.repeat(64)};
const root='/synthetic/project';
const projectId='project_'+createHash('sha256').update(root).digest('hex').slice(0,24);
function fixture(){
 let current=first;const calls=[];
 const connection=async()=>current;
 const context=createContextRoute({readConnection:connection,resolveOwner:sessionId=>({sessionId,cwd:'/synthetic/dot'}),context:{snapshot:async()=>({sources:[]}),act:async()=>{calls.push('source');}},googleSuiteAuth:{status:()=>({clientConfigured:true}),start:async()=>{calls.push('oauth');return{url:'https://accounts.google.com/',expiresAt:'2026-10-24T00:00:00Z'};}}});
 const actions=createWorkbenchActions({readBinding:async()=>({userHash:'c'.repeat(64)}),readConnection:connection,service:{watchedProjects:async()=>[{root,label:'Synthetic'}],isPaused:async()=>false},resolveOwner:sessionId=>({sessionId,cwd:'/synthetic/dot'}),memory:{revise:async a=>{calls.push('memory');return{entry:{id:a.id,kind:'context',text:a.text,at:'2026-10-23T07:00:00Z',source:{kind:'user',reference:'session:owner-a'}}};}},followup:{configure:async()=>{calls.push('followup');return{enabled:true,running:false,everyMinutes:60};}},taskResults:{inspect:async()=>{calls.push('detail');return{jobs:[]};}}});
 return{context,actions,calls,change:value=>{current=value;}};
}
test('binding revision is opaque, deterministic and changes for owner or same-session rebind',()=>{
 const revision=bindingRevision(first);assert.match(revision,/^[a-f0-9]{64}$/);assert.notEqual(revision,first.bindingKey);assert.equal(revision,bindingRevision({...first}));assert.notEqual(revision,bindingRevision(next));assert.notEqual(revision,bindingRevision({...first,sessionId:'owner-b'}));assert.equal(bindingRevision({state:'unknown'}),null);
 for(const bad of [null,7,'',first.bindingKey,'z'.repeat(64)])assert.equal(matchesBindingRevision({expectedBindingRevision:bad},first),false);
 assert.equal(matchesBindingRevision({expectedBindingRevision:revision},first),true);
});
test('new UI stale scope is rejected before source mutation or OAuth startup',async()=>{
 const f=fixture(),old=(await f.context.snapshot()).bindingRevision;f.change(next);
 for(const input of [{action:'connect',source:'gmail'},{action:'disconnect',source:'calendar'},{action:'google_suite_authorize'}])await assert.rejects(f.context.action({...input,expectedBindingRevision:old}));
 assert.deepEqual(f.calls,[]);
 const fresh=(await f.context.snapshot()).bindingRevision;await f.context.action({action:'connect',source:'calendar',expectedBindingRevision:fresh});assert.deepEqual(f.calls,['source']);
});
test('stale scope cannot edit memory, create followup or read task result on another binding',async()=>{
 const f=fixture(),old=bindingRevision(first);f.change(next);
 for(const input of [{action:'memory_update',projectId,id:'m1',text:'revised',userRequested:true},{action:'followup_configure',projectId,everyMinutes:60,userRequested:true},{action:'task_detail',id:'j1'}])await assert.rejects(f.actions.action({...input,expectedBindingRevision:old}));
 assert.deepEqual(f.calls,[]);
 await f.actions.action({action:'memory_update',projectId,id:'m1',text:'revised',userRequested:true,expectedBindingRevision:bindingRevision(next)});assert.deepEqual(f.calls,['memory']);
});
test('connection snapshot drops a response when owner changes during source status read',async()=>{
 let current=first,release;const gate=new Promise(r=>{release=r;});let enter;const entered=new Promise(r=>{enter=r;});
 const context=createContextRoute({readConnection:async()=>current,context:{snapshot:async()=>{enter();await gate;return{sources:[{id:'gmail',status:'enabled'}]};}}});
 const read=context.snapshot();await entered;current=next;release();await assert.rejects(read);
});
test('older clients without revision remain compatible, malformed explicit revisions fail closed',async()=>{
 const f=fixture();await f.context.action({action:'connect',source:'gmail'});await f.actions.action({action:'task_detail',id:'j1'});assert.deepEqual(f.calls,['source','detail']);
 await assert.rejects(f.context.action({action:'connect',source:'gmail',expectedBindingRevision:null}));
 await assert.rejects(f.actions.action({action:'task_detail',id:'j1',expectedBindingRevision:null}));
 assert.equal(f.calls.length,2);
});
