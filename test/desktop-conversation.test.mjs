import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const target={sessionId:'desktop-native',revision:'a'.repeat(64)};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
async function fixture(){
 let descriptor;vm.runInNewContext(await readFile(new URL('../src/client.js',import.meta.url),'utf8'),{window:{__ModuleLoader__:{load:value=>descriptor=value}},AbortController,AbortSignal});
 const api=descriptor.factory(name=>name==='react'?{createElement(){}}:{});assert.equal(typeof api.createDesktopConversationController,'function');
 const retained=[],released=[],drafts=[];let ready=Promise.resolve(),binding={sessionId:target.sessionId};
 const ctx={sessions:{retain:(id,options)=>{retained.push([id,options]);return{binding,ready,release:()=>released.push(id)};},binding:()=>binding}};
 return{api,ctx,retained,released,drafts,setReady:value=>ready=value,setBinding:value=>binding=value,controller:api.createDesktopConversationController(ctx)};
}
test('desktop conversation retains exactly one genuine native session and releases without sending or initializing drafts',async()=>{const f=await fixture();const ref=await f.controller.acquire('home',target);assert.equal(ref.binding.sessionId,target.sessionId);assert.equal(f.retained.length,1);f.controller.release('home');f.controller.release('home');assert.deepEqual(f.released,[target.sessionId]);assert.deepEqual(f.drafts,[]);});
test('a second editable occurrence cannot mount until the first releases',async()=>{const f=await fixture();await f.controller.acquire('home',target);await assert.rejects(f.controller.acquire('floating',target),/已在另一处/);assert.equal(f.retained.length,1);f.controller.release('home');await f.controller.acquire('floating',target);assert.equal(f.retained.length,2);f.controller.close();assert.equal(f.released.length,2);});
test('Family identity and malformed targets cannot become desktop conversation owners',async()=>{const f=await fixture();for(const sessionId of ['family_owner_synthetic','family_member_synthetic','family-no-legacy','',null])await assert.rejects(f.controller.acquire('home',{...target,sessionId}));assert.equal(f.retained.length,0);});
test('disposal during delayed native readiness cannot expose the old conversation',async()=>{const f=await fixture(),gate=deferred();f.setReady(gate.promise);const pending=f.controller.acquire('home',target);f.controller.release('home');gate.resolve();await assert.rejects(pending);assert.equal(f.released.length,1);});
test('changed or mismatched native binding is rejected without draft access',async()=>{const f=await fixture();f.setBinding({sessionId:'different'});await assert.rejects(f.controller.acquire('home',target));assert.equal(f.released.length,1);assert.deepEqual(f.drafts,[]);});
test('failed native readiness releases the reference and permits an explicit retry',async()=>{const f=await fixture(),gate=deferred();f.setReady(gate.promise);const pending=f.controller.acquire('home',target);gate.reject(Error('synthetic failure'));await assert.rejects(pending);assert.equal(f.released.length,1);f.setReady(Promise.resolve());await f.controller.acquire('home',target);f.controller.close();assert.equal(f.released.length,2);});

test('release failure prevents mounting a second editor with an uncertain first reference',async()=>{
 const f=await fixture();f.ctx.sessions.retain=()=>({binding:{sessionId:target.sessionId},ready:Promise.resolve(),release(){throw Error('synthetic release failure');}});delete f.ctx.sessions.binding;
 await f.controller.acquire('home',target);assert.doesNotThrow(()=>f.controller.release('home'));await assert.rejects(f.controller.acquire('overlay',target));
});

test('last desktop session pointer survives controller recreation using native metadata only',async()=>{
 const f=await fixture(),mutations=[];let view={status:'ready',writable:true,revision:4,value:{desktopConversationSessionId:'',otherSetting:'preserved'}};
 f.ctx.configForms={get:name=>{assert.equal(name,'project-companion');return{getSnapshot:()=>view,mutate:async(ops,revision)=>{assert.equal(revision,4);mutations.push(ops);view={...view,revision:5,value:{...view.value,desktopConversationSessionId:ops[0].value}};return true;}};}};
 let metadataReads=0;f.ctx.sessions.refresh=async()=>{metadataReads++;};f.ctx.sessions.list={getSnapshot:()=>({phase:'ready',ids:[target.sessionId],byId:{[target.sessionId]:{id:target.sessionId,cwd:'/synthetic/desktop'}}})};
 assert.equal(await f.controller.remember(target.sessionId),true);assert.equal(mutations.length,1);assert.equal(mutations[0][0].path[0],'desktopConversationSessionId');assert.equal(view.value.otherSetting,'preserved');const fresh=f.api.createDesktopConversationController(f.ctx),restored=await fresh.restore();assert.equal(restored.sessionId,target.sessionId);assert.equal(metadataReads,2);assert.equal(f.retained.length,0);
});
test('saved pointer cannot adopt a Family carrier, missing row or subagent',async()=>{
 for(const mode of ['family','missing','subagent']){const f=await fixture();const id=mode==='family'?'family_owner_synthetic':target.sessionId;f.ctx.configForms={get:()=>({getSnapshot:()=>({status:'ready',value:{desktopConversationSessionId:id}})})};f.ctx.sessions.refresh=async()=>{};f.ctx.sessions.list={getSnapshot:()=>({phase:'ready',ids:mode==='missing'?[]:[id],byId:{[id]:{id,cwd:'/synthetic/desktop',...(mode==='subagent'?{origin:'subagent'}:{})}}})};assert.equal(await f.controller.restore(),null);assert.equal(f.retained.length,0);}
});

test('unavailable optional pointer settings do not block the desktop entry',async()=>{
 const f=await fixture();f.ctx.configForms={get:()=>({getSnapshot(){throw Error('synthetic settings unavailable');}})};assert.equal(await f.controller.restore(),null);await f.controller.acquire('home',target);assert.equal(f.retained.length,1);f.controller.close();
});

test('overlay never mounts another editor for the visible native main session or an unknown main view',async()=>{
 const f=await fixture();assert.equal(typeof f.api.desktopConversationCanEmbed,'function');const can=f.api.desktopConversationCanEmbed;
 assert.equal(can({activePanelId:null,mainSessionId:target.sessionId},target.sessionId),false);
 assert.equal(can({activePanelId:null,mainSessionId:null},target.sessionId),false);
 assert.equal(can({},target.sessionId),false);
 assert.equal(can({activePanelId:null,mainSessionId:'another-native'},target.sessionId),true);
 assert.equal(can({activePanelId:'project-companion-dot',mainSessionId:target.sessionId},target.sessionId),true);
});

// Only a fully ready session list can establish that native main is empty.
test('a confirmed empty native main permits overlay; loading or ambiguous main remains closed',async()=>{
 const f=await fixture(),can=f.api.desktopConversationCanEmbed;
 assert.equal(can({activePanelId:null,mainSessionId:null,mainViewEmpty:true},target.sessionId),true);
 assert.equal(can({activePanelId:null,mainSessionId:null,mainViewEmpty:false},target.sessionId),false);
 assert.equal(can({activePanelId:null,mainSessionId:target.sessionId,mainViewEmpty:true},target.sessionId),false);
});
