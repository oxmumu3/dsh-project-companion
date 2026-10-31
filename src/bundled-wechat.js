/** A single standard Dot package owns its prerequisite only on a verified fresh profile. */
import {prepareOwnedWechatStorage} from './bundled-wechat-storage.js';
const bridgeName=value=>value==='dsh-wechat'||(typeof value==='string'&&value.startsWith('dsh-wechat/'));
const optional=(ctx,name)=>{try{return ctx.get?.(name,false);}catch{return undefined;}};

export async function installBundledWechat(ctx,{
  familyDelegation=false,
  loadBridge=()=>import('../vendor/dsh-wechat/dist/index.js'),
  prepareStorage=prepareOwnedWechatStorage,
}={}){
  let closed=false,externalSeen=false,owned,teardownFailed=false;
  let serial=Promise.resolve(),stopping=Promise.resolve();
  let state=Object.freeze({mode:'starting'});
  const update=next=>(state=Object.freeze(next));
  const family=()=>typeof familyDelegation==='function'?familyDelegation()===true:familyDelegation===true;
  const stop=()=>{
    if(!owned)return stopping;
    const fork=owned;owned=undefined;
    try{stopping=Promise.resolve(fork.dispose());}catch{stopping=Promise.reject(Error('teardown'));}
    stopping=stopping.catch(()=>{teardownFailed=true;});
    return stopping;
  };
  const select=async()=>{
    if(closed)return state;
    if(family()){await stop();return closed?state:update(teardownFailed?{mode:'blocked',reason:'teardown_failed'}:{mode:'family'});}
    if(externalSeen){await stop();return closed?state:update(teardownFailed?{mode:'blocked',reason:'teardown_failed'}:{mode:'external'});}
    if(!owned&&optional(ctx,'dotWechatGuarded'))return update({mode:'external'});
    try{
      const loader=optional(ctx,'loader');
      const entries=loader?.entries?[...loader.entries()]:[];
      const manager=optional(ctx,'pluginManager');
      if(typeof manager?.listBundles!=='function')return update({mode:'blocked',reason:'registry_unavailable'});
      const bundles=await manager.listBundles();
      if(closed)return state;
      if(!Array.isArray(bundles))return update({mode:'blocked',reason:'registry_unavailable'});
      // A disabled/starting/failed installation still owns its saved binding.
      if(entries.some(row=>bridgeName(row?.options?.name))||bundles.some(row=>bridgeName(row?.name)||row?.rows?.some?.(entry=>bridgeName(entry?.name)))){
        externalSeen=true;await stop();return closed?state:update(teardownFailed?{mode:'blocked',reason:'teardown_failed'}:{mode:'external'});
      }
    }catch{return closed?state:update({mode:'blocked',reason:'registry_unavailable'});}
    if(closed)return state;
    if(externalSeen||family())return select();
    if(owned)return update({mode:'embedded'});
    await stopping;
    if(teardownFailed)return update({mode:'blocked',reason:'teardown_failed'});
    let storageDir;
    try{storageDir=await prepareStorage(ctx);}
    catch(error){const reason=['existing_storage','bound_token_unavailable'].includes(error.reason)?error.reason:'storage_unavailable';return update({mode:'blocked',reason});}
    try{
      const bridge=await loadBridge();
      if(closed)return state;
      if(externalSeen||family())return select();
      if(optional(ctx,'dotWechatGuarded'))return update({mode:'external'});
      if(bridge?.name!=='dsh-wechat'||typeof bridge.apply!=='function'||typeof ctx.plugin!=='function')return update({mode:'blocked',reason:'embedded_unavailable'});
      // Cordis owns the child and all bridge disposers. No package operation,
      // profile edit, binding migration or additional private permission here.
      owned=ctx.plugin(bridge,{storageDir});
      if(!owned||typeof owned.dispose!=='function')return update({mode:'blocked',reason:'embedded_unavailable'});
      return update({mode:'embedded'});
    }catch{return closed?state:update({mode:'blocked',reason:'embedded_unavailable'});}
  };
  const refresh=()=>{const pending=serial.then(select,select);serial=pending.catch(()=>{});return pending;};
  ctx.on('dispose',()=>{closed=true;void stop();update({mode:'disposed'});});
  // entry-init precedes options assignment. patch-context runs after naming
  // and before the foreign apply; begin disposal synchronously before next().
  ctx.on('loader/patch-context',(entry,next)=>{
    if(bridgeName(entry?.options?.name)){externalSeen=true;void stop();void refresh();}
    return next();
  });
  ctx.on('plugin-manager/changed',()=>{void refresh();});
  ctx.provide?.('dotWechatComponent',{snapshot:()=>state,refresh});
  return refresh();
}
