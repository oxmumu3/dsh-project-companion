import test from 'node:test';
import assert from 'node:assert/strict';
import {installBundledWechat as actualInstall} from '../src/bundled-wechat.js';
const installBundledWechat=(ctx,options)=>actualInstall(ctx,{prepareStorage:async()=>'/synthetic-owned-wechat',...options});

function fixture({bundles=[],entries=[],services={},registryError=false}={}){
  const handlers=new Map(),provided=new Map(),forks=[];
  const registry={listBundles:()=>{if(registryError)throw Error('unavailable');return bundles;}};
  const ctx={
    get:(name)=>provided.get(name)??services[name]??(name==='pluginManager'?registry:name==='loader'?{entries:()=>entries.values()}:undefined),
    provide:(name,value)=>provided.set(name,value),
    on:(event,fn)=>{const set=handlers.get(event)??new Set();handlers.set(event,set);set.add(fn);return()=>set.delete(fn);},
    plugin:(module,config)=>{const fork={module,config,disposed:0,dispose(){this.disposed++;}};forks.push(fork);return fork;},
  };
  return {ctx,forks,provided,emit:(name,...args)=>{for(const fn of handlers.get(name)??[])fn(...args);}};
}
const bridge={name:'dsh-wechat',apply(){throw Error('fixture not actually executed');}};

test('fresh standard Dot owns one embedded bridge without package/profile/account operations',async()=>{
  const f=fixture();let loads=0;
  const result=await installBundledWechat(f.ctx,{loadBridge:async()=>{loads++;return bridge;}});
  assert.equal(result.mode,'embedded');assert.equal(loads,1);assert.equal(f.forks.length,1);
  assert.equal(f.forks[0].module,bridge);assert.deepEqual(f.forks[0].config,{storageDir:'/synthetic-owned-wechat'});
  assert.equal(f.provided.get('dotWechatComponent').snapshot().mode,'embedded');
});

for(const row of [
  {name:'dsh-wechat',enabled:true,installed:true,availability:'profile'},
  {name:'dsh-wechat',enabled:false,installed:true,availability:'profile'},
  {name:'dsh-wechat',enabled:true,installed:true,error:{code:'unsupported-version'}},
])test(`existing external bridge is preserved (${JSON.stringify(row)})`,async()=>{
  const f=fixture({bundles:[row]});const before=JSON.stringify(row);
  const result=await installBundledWechat(f.ctx,{loadBridge:async()=>{throw Error('must not load');}});
  assert.equal(result.mode,'external');assert.equal(f.forks.length,0);assert.equal(JSON.stringify(row),before);
});

test('pending external Loader entry wins before its service is available',async()=>{
  const f=fixture({entries:[{options:{name:'dsh-wechat',disabled:false}}]});
  const result=await installBundledWechat(f.ctx,{loadBridge:async()=>{throw Error('must not load');}});
  assert.equal(result.mode,'external');assert.equal(f.forks.length,0);
});

test('active guarded bridge service is reused even when registry is unavailable',async()=>{
  const current={binding(){}};const f=fixture({services:{dotWechatGuarded:current},registryError:true});
  const result=await installBundledWechat(f.ctx,{loadBridge:async()=>{throw Error('must not load');}});
  assert.equal(result.mode,'external');assert.equal(f.ctx.get('dotWechatGuarded'),current);
});

test('explicit Family delegation never starts an independent WeChat bridge',async()=>{
  const f=fixture();const result=await installBundledWechat(f.ctx,{familyDelegation:true,loadBridge:async()=>{throw Error('must not load');}});
  assert.equal(result.mode,'family');assert.equal(f.forks.length,0);
});

for(const kind of ['throws','missing','malformed'])test(`unknown registry cannot silently start another bridge (${kind})`,async()=>{
  const f=fixture({registryError:kind==='throws'});
  if(kind==='missing'){const get=f.ctx.get;f.ctx.get=name=>name==='pluginManager'?undefined:get(name);}
  if(kind==='malformed'){const get=f.ctx.get;f.ctx.get=name=>name==='pluginManager'?{listBundles:()=>null}:get(name);}
  const result=await installBundledWechat(f.ctx,{loadBridge:async()=>{throw Error('must not load');}});
  assert.equal(result.mode,'blocked');assert.equal(result.reason,'registry_unavailable');assert.equal(f.forks.length,0);
});

test('disposal while the bridge import is pending never starts a new poller',async()=>{
  const f=fixture();let release;
  const promise=installBundledWechat(f.ctx,{loadBridge:()=>new Promise(resolve=>{release=resolve;})});
  await new Promise(resolve=>setImmediate(resolve));f.emit('dispose');release(bridge);
  assert.equal((await promise).mode,'disposed');assert.equal(f.forks.length,0);
});

test('a foreign bridge arriving during import cancels the embedded startup',async()=>{
  const f=fixture();let release;
  const promise=installBundledWechat(f.ctx,{loadBridge:()=>new Promise(resolve=>{release=resolve;})});
  await new Promise(resolve=>setImmediate(resolve));f.emit('loader/patch-context',{options:{name:'dsh-wechat'}},()=>{});release(bridge);
  assert.equal((await promise).mode,'external');assert.equal(f.forks.length,0);
});

test('named external Loader entry stops the owned child before the foreign apply can run',async()=>{
  const f=fixture();await installBundledWechat(f.ctx,{loadBridge:async()=>bridge});
  f.emit('loader/entry-init',{options:{}});
  assert.equal(f.forks[0].disposed,0);
  let continued=false;
  f.emit('loader/patch-context',{options:{name:'dsh-wechat'}},()=>{continued=true;assert.equal(f.forks[0].disposed,1);});
  await f.provided.get('dotWechatComponent').refresh();
  assert.equal(continued,true);assert.equal(f.provided.get('dotWechatComponent').snapshot().mode,'external');
  f.emit('dispose');assert.equal(f.forks[0].disposed,1);
});

test('Dot disposal owns its child lifecycle',async()=>{
  const f=fixture();await installBundledWechat(f.ctx,{loadBridge:async()=>bridge});
  f.emit('dispose');await new Promise(resolve=>setImmediate(resolve));assert.equal(f.forks[0].disposed,1);
  assert.equal(f.provided.get('dotWechatComponent').snapshot().mode,'disposed');
});

test('live Family delegation changes stop and later recreate only the owned bridge',async()=>{
  const f=fixture();let enabled=false;
  await installBundledWechat(f.ctx,{familyDelegation:()=>enabled,loadBridge:async()=>bridge});
  const component=f.provided.get('dotWechatComponent');
  enabled=true;await component.refresh();assert.equal(component.snapshot().mode,'family');assert.equal(f.forks[0].disposed,1);
  enabled=false;await component.refresh();assert.equal(component.snapshot().mode,'embedded');assert.equal(f.forks.length,2);
});

test('a newly registered disabled external bundle releases the embedded component',async()=>{
  const bundles=[],f=fixture({bundles});await installBundledWechat(f.ctx,{loadBridge:async()=>bridge});
  bundles.push({name:'dsh-wechat',installed:true,enabled:false});f.emit('plugin-manager/changed',{reason:'package'});
  await f.provided.get('dotWechatComponent').refresh();assert.equal(f.forks[0].disposed,1);assert.equal(f.forks.length,1);
});

test('disposal while the registry is pending stays disposed rather than claiming reuse',async()=>{
  const f=fixture();let release;const get=f.ctx.get;
  f.ctx.get=name=>name==='pluginManager'?{listBundles:()=>new Promise(resolve=>{release=resolve;})}:get(name);
  const pending=installBundledWechat(f.ctx,{loadBridge:async()=>bridge});await new Promise(resolve=>setImmediate(resolve));
  f.emit('dispose');release([{name:'dsh-wechat'}]);assert.equal((await pending).mode,'disposed');assert.equal(f.forks.length,0);
});

test('failed import is a fixed diagnostic and cannot expose paths or error text',async()=>{
  const f=fixture();const result=await installBundledWechat(f.ctx,{loadBridge:async()=>{throw Error('/private/synthetic-token');}});
  assert.deepEqual(result,{mode:'blocked',reason:'embedded_unavailable'});assert.equal(f.forks.length,0);
});

test('wrong embedded module cannot mount a different plugin',async()=>{
  const f=fixture();const result=await installBundledWechat(f.ctx,{loadBridge:async()=>({name:'different',apply(){}})});
  assert.equal(result.mode,'blocked');assert.equal(f.forks.length,0);
});
