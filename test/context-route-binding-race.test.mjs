import test from 'node:test';
import assert from 'node:assert/strict';
import {createPersonalContext} from '../src/context-service.js';
import {createContextRoute} from '../src/context-route.js';
import {bindingRevision} from '../src/workbench-scope.js';

const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};

for(const action of ['connect','disconnect'])for(const differentOwner of [false,true]){
  test(`queued ${action} cannot change the new lease after ${differentOwner?'owner and binding':'same-owner binding'} rotation`,async()=>{
    const entered=deferred(),release=deferred(),admitted=deferred();
    const original={state:'bound',sessionId:'original-owner',bindingKey:'a'.repeat(64)};
    const replacement={state:'bound',sessionId:differentOwner?'replacement-owner':original.sessionId,bindingKey:'b'.repeat(64)};
    let connection=original,writes=0,catalogs=0,hold=false;
    const saved={id:'profile',version:1,sources:[{source:'flomo',sessionId:replacement.sessionId,bindingKey:replacement.bindingKey,credentialKey:'c'.repeat(64)}]};
    const service=createPersonalContext({
      store:{get:async()=>structuredClone(saved),put:async()=>{writes++;}},
      readConfig:()=>({}),credentialState:()=>({configured:true,key:'c'.repeat(64)}),
      readBinding:async sessionId=>{
        if(hold){hold=false;entered.resolve();await release.promise;}
        return sessionId===connection.sessionId?{kind:'bound',bindingKey:connection.bindingKey}:{kind:'unknown'};
      },
      transport:{catalog:async()=>{catalogs++;return{tools:[{name:'memo_search',inputSchema:{type:'object'}}]};}},
    });
    const route=createContextRoute({
      context:{snapshot:owner=>service.snapshot(owner),act:(owner,input)=>{const result=service.act(owner,input);admitted.resolve();return result;}},
      readConnection:async()=>connection,
      resolveOwner:sessionId=>({sessionId,cwd:'/synthetic/project'}),
    });
    try{
      await service.ready();hold=true;
      const blocker=service.snapshot({sessionId:original.sessionId});
      await entered.promise;
      const pending=route.action({action,source:'flomo',expectedBindingRevision:bindingRevision(original)});
      const rejected=assert.rejects(pending);
      await admitted.promise;
      await new Promise(resolve=>setImmediate(resolve));
      connection=replacement;release.resolve();await blocker;await rejected;
      assert.equal(catalogs,0,'stale intent must not discover or enable a replacement binding');
      assert.equal(writes,0,'stale intent must not write or remove the replacement lease');
      const status=await service.snapshot({sessionId:replacement.sessionId});
      assert.equal(status.sources.find(source=>source.id==='flomo').enabled,true,'replacement lease remains enabled');
    }finally{release.resolve();await service.close();}
  });
}

test('connect rechecks the original binding after delayed initial storage load',async()=>{
  const entered=deferred(),release=deferred();let connection={state:'bound',sessionId:'original-owner',bindingKey:'a'.repeat(64)},saved,writes=0,catalogs=0;
  const original={...connection};
  const service=createPersonalContext({
    store:{get:async()=>{entered.resolve();await release.promise;return saved;},put:async(_key,value)=>{writes++;saved=structuredClone(value);}},
    readConfig:()=>({}),credentialState:()=>({configured:true,key:'c'.repeat(64)}),
    readBinding:async()=>({kind:'bound',bindingKey:connection.bindingKey}),
    transport:{catalog:async()=>{catalogs++;return{tools:[{name:'memo_search',inputSchema:{type:'object'}}]};}},
  });
  const route=createContextRoute({context:service,readConnection:async()=>connection,resolveOwner:sessionId=>({sessionId,cwd:'/synthetic/project'})});
  try{
    const rejected=assert.rejects(route.action({action:'connect',source:'flomo',expectedBindingRevision:bindingRevision(original)}));
    await entered.promise;connection={...connection,bindingKey:'b'.repeat(64)};release.resolve();await rejected;
    assert.equal(writes,0);assert.equal(catalogs,0);
    assert.equal((await service.snapshot({sessionId:connection.sessionId})).sources.find(source=>source.id==='flomo').enabled,false);
  }finally{release.resolve();await service.close();}
});

test('a stale UI disconnect cannot abort a replacement owner private read',async()=>{
  const entered=deferred(),release=deferred();
  const old={state:'bound',sessionId:'old-owner',bindingKey:'a'.repeat(64)},current={state:'bound',sessionId:'current-owner',bindingKey:'b'.repeat(64)};
  let connection=current,writes=0;
  const service=createPersonalContext({
    store:{get:async()=>({id:'profile',version:1,sources:[{source:'dida',sessionId:old.sessionId,bindingKey:old.bindingKey,credentialKey:'c'.repeat(64)},{source:'flomo',sessionId:current.sessionId,bindingKey:current.bindingKey,credentialKey:'c'.repeat(64)}]}),put:async()=>{writes++;}},
    readConfig:()=>({}),credentialState:()=>({configured:true,key:'c'.repeat(64)}),
    readBinding:async sessionId=>sessionId===connection.sessionId?{kind:'bound',bindingKey:connection.bindingKey}:{kind:'unknown'},
    transport:{
      catalog:async()=>({tools:[{name:'memo_search',inputSchema:{type:'object',properties:{keywords:{type:'string'},limit:{type:'integer'}},additionalProperties:false}}]}),
      call:async()=>{entered.resolve();await release.promise;return{value:{structuredContent:{memos:[]}}};},
    },
  });
  const route=createContextRoute({
    context:{snapshot:owner=>service.snapshot(owner),act:(owner,input)=>{connection=current;return service.act(owner,input);}},
    readConnection:async()=>connection,resolveOwner:sessionId=>({sessionId,cwd:'/synthetic/project'}),
  });
  try{
    const pending=service.act({sessionId:current.sessionId,cwd:'/synthetic/project'},{action:'query',source:'flomo',operation:'search',query:'specific request',userRequested:true});
    const settled=pending.then(value=>({value}),error=>({error}));
    await entered.promise;connection=old;
    await assert.rejects(route.action({action:'disconnect',source:'dida',expectedBindingRevision:bindingRevision(old)}));
    release.resolve();const result=await settled;
    assert.equal(result.error,undefined,'stale disconnect must not invalidate another binding read');
    assert.equal(result.value.source,'flomo');assert.equal(writes,0);
  }finally{release.resolve();await service.close();}
});
