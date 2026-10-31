import test from 'node:test';
import assert from 'node:assert/strict';
import {createPersonalContext} from '../src/context-service.js';

test('one explicit five-source brief grant stays binding-scoped and revokes atomically',async()=>{
  let state,reads=0;
  const owner={sessionId:'synthetic-five-source-owner',cwd:'/synthetic/project'};
  const sources=['gmail','calendar','drive','flomo','dida'];
  const tools=['search_threads','list_events','search_files','memo_search','list_projects'].map(name=>({name,inputSchema:{type:'object'}}));
  const service=createPersonalContext({store:{get:async()=>state,put:async(_k,v)=>{state=structuredClone(v);}},readConfig:()=>({}),credentialState:()=>({configured:true,key:'a'.repeat(64)}),readBinding:async()=>({kind:'unbound'}),transport:{catalog:async()=>({tools}),call:async()=>{reads++;throw Error('not expected');}}});
  try{
    for(const source of sources)await service.act(owner,{action:'connect',source,userRequested:true});
    const grant=await service.authorization(owner,sources);
    assert.match(grant,/^[a-f0-9]{64}$/);assert.equal(service.assertAuthorization(owner,sources,grant),true);
    assert.equal(reads,0,'building a grant does not read account content');
    await assert.rejects(service.authorization(owner,[...sources,'docs']),e=>e.code==='CONTEXT_INTENT_REQUIRED');
    await assert.rejects(service.authorization({...owner,sessionId:'foreign'},sources),e=>e.code==='CONTEXT_NOT_ENABLED');
    await service.act(owner,{action:'disconnect',source:'gmail',userRequested:true});
    assert.throws(()=>service.assertAuthorization(owner,sources,grant),e=>e.code==='CONTEXT_BINDING_CHANGED');
    assert.equal((await service.snapshot(owner)).sources.find(s=>s.id==='flomo').enabled,true);
  }finally{await service.close();}
});
