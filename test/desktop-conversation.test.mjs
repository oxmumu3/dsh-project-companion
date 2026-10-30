import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createDesktopConversationController,desktopConversationCanEmbed,createDotConversationViews} from '../src/client-conversation.js';
const target={sessionId:'desktop-native',revision:'a'.repeat(64)};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
async function fixture(){
 let descriptor;const source=await readFile(new URL('../src/client.js',import.meta.url),'utf8');vm.runInNewContext(source,{window:{__ModuleLoader__:{load:value=>descriptor=value}},AbortController,AbortSignal});
 const api=descriptor.factory(name=>name==='react'?{createElement(){}}:{});assert.equal(typeof api.createDesktopConversationController,'function');
 const retained=[],released=[],drafts=[];let ready=Promise.resolve(),binding={sessionId:target.sessionId};
 const ctx={sessions:{retain:(id,options)=>{retained.push([id,options]);return{binding,ready,release:()=>released.push(id)};},binding:()=>binding}};
 return{source,api,ctx,retained,released,drafts,setReady:value=>ready=value,setBinding:value=>binding=value,controller:api.createDesktopConversationController(ctx)};
}
test('browser entry embeds the audited conversation factories without drift',async()=>{
 const f=await fixture();for(const factory of [createDesktopConversationController,desktopConversationCanEmbed,createDotConversationViews])assert.equal(f.source.includes(factory.toString()),true,`${factory.name} must match its tested ESM source`);
});
test('desktop editor release preserves native lifetime without sending or initializing drafts',async()=>{
 const f=await fixture();const ref=await f.controller.acquire('home',target);assert.equal(ref.binding.sessionId,target.sessionId);assert.equal(f.retained.length,1);
 f.controller.release('home');f.controller.release('home');assert.deepEqual(f.released,[]);assert.equal(f.controller.getSnapshot().owner,null);assert.deepEqual(f.drafts,[]);
 f.controller.close();f.controller.close();assert.deepEqual(f.released,[target.sessionId]);
});
test('a second editable occurrence waits for release and reuses exactly the same native reference',async()=>{
 const f=await fixture(),first=await f.controller.acquire('home',target);await assert.rejects(f.controller.acquire('floating',target),/已在另一处/);assert.equal(f.retained.length,1);
 f.controller.release('home');const second=await f.controller.acquire('floating',target);assert.equal(first,second);assert.equal(f.retained.length,1);assert.equal(f.released.length,0);f.controller.close();assert.equal(f.released.length,1);
});
test('release publication lets the next surface retry while the same draft binding stays retained',async()=>{
 const f=await fixture(),first=await f.controller.acquire('home',target),snapshots=[];const stop=f.controller.subscribe(()=>snapshots.push(f.controller.getSnapshot()));
 await assert.rejects(f.controller.acquire('floating',target),/已在另一处/);f.controller.release('home');assert.equal(snapshots.at(-1).owner,null);const second=await f.controller.acquire('floating',target);assert.equal(first.binding,second.binding);assert.equal(snapshots.at(-1).owner,'floating');assert.equal(f.retained.length,1);stop();f.controller.release('floating');f.controller.close();assert.deepEqual(f.released,[target.sessionId]);
});
test('Family identity and malformed targets cannot become desktop conversation owners',async()=>{
 const f=await fixture();for(const sessionId of ['family_owner_synthetic','family_member_synthetic','family-no-legacy','',null,'../not-native','x'.repeat(201)])await assert.rejects(f.controller.acquire('home',{...target,sessionId}));assert.equal(f.retained.length,0);
});
test('a cancelled delayed editor cannot become current while its lifetime stays available for transfer',async()=>{
 const f=await fixture(),gate=deferred();f.setReady(gate.promise);const pending=f.controller.acquire('home',target);f.controller.release('home');const replacement=f.controller.acquire('floating',target);gate.resolve();await assert.rejects(pending);await replacement;assert.equal(f.controller.getSnapshot().owner,'floating');assert.equal(f.retained.length,1);assert.equal(f.released.length,0);f.controller.close();assert.equal(f.released.length,1);
});
test('controller disposal during delayed native readiness cannot expose the old conversation',async()=>{
 const f=await fixture(),gate=deferred();f.setReady(gate.promise);const pending=f.controller.acquire('home',target);f.controller.close();gate.resolve();await assert.rejects(pending);assert.equal(f.released.length,1);await assert.rejects(f.controller.acquire('floating',target));
});
test('changed or mismatched native binding is rejected without draft access',async()=>{
 const f=await fixture();f.setBinding({sessionId:'different'});await assert.rejects(f.controller.acquire('home',target));assert.equal(f.released.length,1);assert.deepEqual(f.drafts,[]);
});
test('failed native readiness releases the reference and permits an explicit retry',async()=>{
 const f=await fixture(),gate=deferred();f.setReady(gate.promise);const pending=f.controller.acquire('home',target);gate.reject(Error('synthetic failure'));await assert.rejects(pending);assert.equal(f.released.length,1);f.setReady(Promise.resolve());await f.controller.acquire('home',target);f.controller.close();assert.equal(f.released.length,2);
});
test('failed lifetime release prevents switching to a second session with an uncertain first reference',async()=>{
 const f=await fixture();let releases=0;f.ctx.sessions.retain=()=>({binding:{sessionId:target.sessionId},ready:Promise.resolve(),release(){releases++;throw Error('synthetic release failure');}});delete f.ctx.sessions.binding;
 await f.controller.acquire('home',target);assert.doesNotThrow(()=>f.controller.release('home'));assert.equal(releases,0,'editor release must preserve lifetime');await assert.rejects(f.controller.acquire('overlay',{sessionId:'other-native'}));assert.equal(releases,1);assert.equal(f.controller.getSnapshot().closed,true);await assert.rejects(f.controller.acquire('overlay',target));f.controller.close();assert.equal(releases,1);
});
test('failed final lifetime release fails closed and is not repeated',async()=>{
 const f=await fixture();let releases=0;f.ctx.sessions.retain=()=>({binding:{sessionId:target.sessionId},ready:Promise.resolve(),release(){releases++;throw Error('synthetic release failure');}});delete f.ctx.sessions.binding;
 await f.controller.acquire('home',target);assert.doesNotThrow(()=>f.controller.close());assert.doesNotThrow(()=>f.controller.close());assert.equal(releases,1);await assert.rejects(f.controller.acquire('overlay',target));
});
test('explicitly selected desktop pointer survives controller recreation using native metadata only',async()=>{
 const f=await fixture(),mutations=[];let view={status:'ready',writable:true,revision:4,value:{desktopConversationSessionId:'',desktopConversationSelectionVersion:0,otherSetting:'preserved'}};
 f.ctx.configForms={get:name=>{assert.equal(name,'project-companion');return{getSnapshot:()=>view,mutate:async(ops,revision)=>{assert.equal(revision,4);mutations.push(ops);const value={...view.value};for(const op of ops)value[op.path[0]]=op.value;view={...view,revision:5,value};return true;}};}};
 let metadataReads=0;f.ctx.sessions.refresh=async()=>{metadataReads++;};f.ctx.sessions.list={getSnapshot:()=>({phase:'ready',ids:[target.sessionId],byId:{[target.sessionId]:{id:target.sessionId,cwd:'/synthetic/desktop'}}})};
 assert.equal(await f.controller.remember(target.sessionId),true);assert.equal(mutations.length,1);assert.deepEqual(JSON.parse(JSON.stringify(mutations[0])),[{op:'set',path:['desktopConversationSessionId'],value:target.sessionId},{op:'set',path:['desktopConversationSelectionVersion'],value:1}]);assert.equal(view.value.otherSetting,'preserved');const fresh=f.api.createDesktopConversationController(f.ctx),restored=await fresh.restore();assert.equal(restored.sessionId,target.sessionId);assert.equal(metadataReads,2);assert.equal(f.retained.length,0);
});
test('legacy bare pointer remains an unconfirmed metadata candidate and is never auto-retained',async()=>{
 const f=await fixture();const value={desktopConversationSessionId:target.sessionId};f.ctx.configForms={get:()=>({getSnapshot:()=>({status:'ready',value})})};f.ctx.sessions.refresh=async()=>{};f.ctx.sessions.list={getSnapshot:()=>({phase:'ready',ids:[target.sessionId],byId:{[target.sessionId]:{id:target.sessionId,cwd:'/synthetic/desktop'}}})};assert.equal(await f.controller.restore(),null);assert.equal((await f.controller.candidate()).sessionId,target.sessionId);assert.equal(value.desktopConversationSelectionVersion,undefined);assert.equal(f.retained.length,0);assert.deepEqual(f.drafts,[]);
});
test('both confirmed and legacy pointers reject Family carriers, missing rows and subagents',async()=>{
 for(const version of [0,1])for(const mode of ['family','missing','subagent']){
  const f=await fixture(),id=mode==='family'?'family_owner_synthetic':target.sessionId;
  f.ctx.configForms={get:()=>({getSnapshot:()=>({status:'ready',value:{desktopConversationSessionId:id,desktopConversationSelectionVersion:version}})})};f.ctx.sessions.refresh=async()=>{};f.ctx.sessions.list={getSnapshot:()=>({phase:'ready',ids:mode==='missing'?[]:[id],byId:{[id]:{id,cwd:'/synthetic/desktop',...(mode==='subagent'?{origin:'subagent'}:{})}}})};
  assert.equal(await f.controller.restore(),null);assert.equal(await f.controller.candidate(),null);assert.equal(f.retained.length,0);
 }
});
test('unavailable optional pointer settings do not block the desktop entry',async()=>{
 const f=await fixture();f.ctx.configForms={get:()=>({getSnapshot(){throw Error('synthetic settings unavailable');}})};assert.equal(await f.controller.restore(),null);assert.equal(await f.controller.candidate(),null);await f.controller.acquire('home',target);assert.equal(f.retained.length,1);f.controller.close();
});
test('overlay never mounts another editor for the visible native main session or an unknown main view',async()=>{
 const f=await fixture();assert.equal(typeof f.api.desktopConversationCanEmbed,'function');const can=f.api.desktopConversationCanEmbed;
 assert.equal(can({activePanelId:null,mainSessionId:target.sessionId},target.sessionId),false);assert.equal(can({activePanelId:null,mainSessionId:null},target.sessionId),false);assert.equal(can({},target.sessionId),false);assert.equal(can({activePanelId:null,mainSessionId:'another-native'},target.sessionId),true);assert.equal(can({activePanelId:'project-companion-dot',mainSessionId:target.sessionId},target.sessionId),true);
});
// Only a fully ready session list can establish that native main is empty.
test('a confirmed empty native main permits overlay; loading or ambiguous main remains closed',async()=>{
 const f=await fixture(),can=f.api.desktopConversationCanEmbed;assert.equal(can({activePanelId:null,mainSessionId:null,mainViewEmpty:true},target.sessionId),true);assert.equal(can({activePanelId:null,mainSessionId:null,mainViewEmpty:false},target.sessionId),false);assert.equal(can({activePanelId:null,mainSessionId:target.sessionId,mainViewEmpty:true},target.sessionId),false);
});
