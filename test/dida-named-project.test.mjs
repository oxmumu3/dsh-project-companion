import test from 'node:test';
import assert from 'node:assert/strict';
import {createDidaRest} from '../src/dida-rest.js';
import {buildContextCall,validateContextCall,projectContextResult} from '../src/context-contracts.js';
import {parseFamilyContextSelection,familyScopedContextAllowed} from '../src/family-context-intent.js';
import {createPersonalContext} from '../src/context-service.js';

const gates={authorize:async()=>true,authorizeSync:()=>true};
const task=(id,projectId='p2')=>({id,projectId,title:`Synthetic ${id}`,content:'Selected work only',status:0});
const input={operation:'tasks',query:'工作',limit:2};
const named={project_name:'工作',limit:2};
test('named Dida task scope is literal, bounded and requires no user-visible project id',()=>{
 const selected=parseFamilyContextSelection('滴答清单「工作」未完成任务最多 2 条');
 assert.deepEqual(selected,{queries:[{source:'dida',...input}]});
 assert.equal(familyScopedContextAllowed({action:'context_brief',userRequested:true,queries:selected.queries},'滴答清单「工作」未完成任务最多 2 条'),true);
 for(const changed of [{...input,query:'全部'},{...input,projectId:'p2'},{...input,limit:3}])assert.equal(familyScopedContextAllowed({action:'context_brief',userRequested:true,queries:[{source:'dida',...changed}]},'滴答清单「工作」未完成任务最多 2 条'),false);
 assert.equal(parseFamilyContextSelection('滴答清单所有任务最多 2 条'),null);
});
test('contract distinguishes a named list from a model-provided id and refuses combined scopes',async()=>{
 const adapter=createDidaRest({});const catalog=await adapter.catalog('dida');
 assert.deepEqual(buildContextCall('dida',input),{name:'get_named_project_with_undone_tasks',args:named});
 assert.equal(validateContextCall(buildContextCall('dida',input),catalog).name,'get_named_project_with_undone_tasks');
 assert.throws(()=>buildContextCall('dida',{...input,projectId:'p2'}));
 await adapter.close();
});
test('named list resolves exact metadata then reads only that list and caps returned tasks',async()=>{
 const calls=[];const adapter=createDidaRest({getToken:async()=> 'synthetic',fetch:async url=>{
   calls.push(url);return Response.json(calls.length===1?[{id:'p1',name:'私人'},{id:'p2',name:'工作'}]:{project:{id:'p2'},tasks:[task('a'),task('b'),task('c')]});
 }});
 const result=await adapter.call('dida','get_named_project_with_undone_tasks',named,gates);
 assert.equal(calls.length,2);assert.equal(new URL(calls[0]).pathname,'/open/v1/project');assert.equal(calls[1],'https://api.dida365.com/open/v1/project/p2/data');
 assert.equal(result.value.items.length,2);assert.equal(result.value.truncated,true);assert.ok(result.value.items.every(x=>x.projectId==='p2'));assert.doesNotMatch(JSON.stringify(result),/私人|Synthetic c/);
 assert.equal(projectContextResult('dida',result.value,{operation:'tasks'}).items.length,2);await adapter.close();
});
test('missing, ambiguous, malformed or oversized named-project metadata never fetches any tasks',async()=>{
 for(const rows of [[],[{id:'p1',name:'工作副本'}],[{id:'p1',name:'工作'},{id:'p2',name:'工作'}],[{id:'../bad',name:'工作'}],Array.from({length:2049},(_,i)=>({id:'p'+i,name:i===0?'工作':'other'}))]){
   let calls=0;const adapter=createDidaRest({getToken:async()=> 'synthetic',fetch:async()=>{calls++;return Response.json(rows);}});
   await assert.rejects(adapter.call('dida','get_named_project_with_undone_tasks',named,gates));assert.equal(calls,1);await adapter.close();
 }
});
test('revoking while list metadata is pending prevents the second GET',async()=>{
 let allowed=true,calls=0;const adapter=createDidaRest({getToken:async()=> 'synthetic',fetch:async()=>{calls++;allowed=false;return Response.json([{id:'p2',name:'工作'}]);}});
 await assert.rejects(adapter.call('dida','get_named_project_with_undone_tasks',named,{authorize:async()=>allowed,authorizeSync:()=>allowed}),e=>e.code==='CONTEXT_CANCELLED');assert.equal(calls,1);await adapter.close();
});
test('named operation rejects extra keys, oversized names and cross-list tasks without exposing any result',async()=>{
 let calls=0;const adapter=createDidaRest({getToken:async()=> 'synthetic',fetch:async()=>{calls++;return Response.json(calls===1?[{id:'p2',name:'工作'}]:{project:{id:'p2'},tasks:[task('a','other')]});}});
 for(const args of [{...named,project_id:'p1'},{...named,limit:11},{...named,project_name:'x'.repeat(181)}])await assert.rejects(adapter.call('dida','get_named_project_with_undone_tasks',args,gates));
 assert.equal(calls,0);await assert.rejects(adapter.call('dida','get_named_project_with_undone_tasks',named,gates),e=>e.code==='CONTEXT_PROTOCOL_INVALID');assert.equal(calls,2);await adapter.close();
});
test('the actual personal-context service passes only selected bounded tasks and citations to a brief caller',async()=>{
 let state,calls=0;const transport=createDidaRest({getToken:async()=> 'synthetic',fetch:async()=>Response.json(++calls===1?[{id:'p2',name:'工作'}]:{project:{id:'p2'},tasks:[task('a'),task('b'),task('c')]})});
 const service=createPersonalContext({store:{get:async()=>state,put:async(_k,v)=>{state=v;}},transport,readConfig:()=>({}),credentialState:()=>({configured:true,key:'c'.repeat(64)}),readBinding:async()=>({kind:'unbound'})});
 const owner={sessionId:'synthetic-owner',cwd:'/SYNTHETIC'};await service.act(owner,{action:'connect',source:'dida',userRequested:true});
 const result=await service.act(owner,{action:'query',source:'dida',...input,userRequested:true});
 assert.equal(calls,2);assert.equal(result.items.length,2);assert.equal(result.truncated,true);assert.ok(result.items.every(x=>x.url.startsWith('https://dida365.com/webapp/#p/p2/tasks/')));assert.doesNotMatch(JSON.stringify(state),/Selected work only/);await service.close();
});
