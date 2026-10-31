import test from 'node:test';
import assert from 'node:assert/strict';
import {createGoalBoard} from '../src/goal-board-service.js';
import {createGoalBoardCollector} from '../src/goal-board-collect.js';
import {createGoalBoardController} from '../src/goal-board-route.js';
import {PROJECT_FILES} from '../src/sources.js';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
function fixture({pauseBatch=0,failBatch=0}={}){
 let row,calls=0;const batches=[],reads=[],entered=deferred(),gate=deferred();
 const scope={revision:'scope-1',grants:Array.from({length:21},(_,i)=>({id:'g'+i,workspaceId:'w'+i,root:'/synthetic/'+i,label:'工作区 '+i,sessionIds:[]}))};
 const access={capture:async()=>structuredClone(scope),assertCurrent:async s=>{if(JSON.stringify(s)!==JSON.stringify(scope))throw Error('changed');return true;},authorizeSync:s=>JSON.stringify(s)===JSON.stringify(scope)};
 const collector=createGoalBoardCollector({access,readProject:async root=>{reads.push(root);return PROJECT_FILES.map(path=>({path,status:'ok',text:'合成说明 '+root}));}});
 const board=createGoalBoard({access,store:{get:async()=>row,put:async(_id,value)=>{row=structuredClone(value);}},collect:async(s,options)=>{batches.push(options.workspaceIds);const data=await collector(s,options);if(batches.length===pauseBatch){entered.resolve();await gate.promise;}return data;},model:{recognize:async({fragments})=>{if(++calls===failBatch)throw Error('synthetic failure');return{groups:[],standaloneIds:fragments.map(f=>f.id),uncertainIds:[]};}}});
 const controller=createGoalBoardController({board,host:{}});
 const start=async()=>{const s=await board.status();return controller.action({action:'recognize',expectedRevision:s.revision,expectedAccessRevision:scope.revision,sweep:true});};
 return{board,controller,start,scope,batches,reads,entered,gate,get row(){return row;}};
}
test('explicit sweep uses the real collector in 8/8/5 batches and duplicate starts never duplicate work',async()=>{
 const f=fixture({pauseBatch:1});try{const initial=await f.board.status();await f.start();await f.entered.promise;await f.controller.action({action:'recognize',expectedRevision:initial.revision,expectedAccessRevision:'scope-1',sweep:true});f.gate.resolve();await f.board.waitForIdle();const s=await f.board.status();assert.deepEqual(f.batches.map(b=>b.length),[8,8,5]);assert.equal(new Set(f.reads).size,21);assert.equal(f.reads.length,21);assert.equal(s.scan.phase,'complete');assert.equal(s.scan.processed,21);assert.equal(s.scan.total,21);assert.equal(s.scan.coverage.length,21);assert.ok(s.scan.coverage.every(c=>c.status==='ok'));}finally{f.board.close();}
});
test('explicit cancel during a later batch retains committed results and prevents a third batch',async()=>{
 const f=fixture({pauseBatch:2});try{await f.start();await f.entered.promise;const s=await f.board.status();await f.controller.action({action:'cancel',expectedRevision:s.revision,expectedAccessRevision:'scope-1'});f.gate.resolve();await f.board.waitForIdle();const result=await f.board.status();assert.equal(f.batches.length,2);assert.equal(result.scan.code,'GOAL_CANCELLED');assert.equal(result.scan.processed,8);assert.equal(result.scan.total,21);assert.equal(result.scan.coverage.length,8);assert.ok(f.row.evidence.length>0);}finally{f.board.close();}
});
test('access revision changes stop a sweep and retain honest prior coverage while masking old evidence',async()=>{
 const f=fixture({pauseBatch:2});try{await f.start();await f.entered.promise;f.scope.revision='scope-2';f.scope.grants=[];f.gate.resolve();await f.board.waitForIdle();const s=await f.board.status();assert.equal(f.batches.length,2);assert.equal(s.scan.code,'GOAL_ACCESS_CHANGED');assert.equal(s.scan.processed,8);assert.equal(s.scan.coverage.length,8);assert.equal(s.standaloneCount,0);}finally{f.board.close();}
});
test('manual revision races and later model failure retain prior results without collecting remaining work',async()=>{
 for(const mode of ['revision','model']){const f=fixture({pauseBatch:2,failBatch:mode==='model'?2:0});try{await f.start();await f.entered.promise;if(mode==='revision'){const s=await f.board.status();await f.board.vision({projectId:null,title:'人工目标',goal:'保留',constraints:[],expectedRevision:s.revision});}f.gate.resolve();await f.board.waitForIdle();const s=await f.board.status();assert.equal(f.batches.length,2);assert.equal(s.scan.phase,'failed');assert.equal(s.scan.processed,8);assert.equal(s.scan.coverage.length,8);assert.ok(f.row.evidence.length>0);if(mode==='revision'){assert.equal(s.scan.code,'GOAL_CHANGED');assert.equal(s.projects[0].goal,'保留');}}finally{f.board.close();}}
});
test('sweep and cancel keep strict route keys and both revision guards',async()=>{
 const f=fixture();try{const s=await f.board.status();await assert.rejects(f.controller.action({action:'recognize',expectedRevision:s.revision,expectedAccessRevision:'scope-1',sweep:'yes'}),{code:'GOAL_ARGUMENT'});await assert.rejects(f.controller.action({action:'recognize',expectedRevision:s.revision,expectedAccessRevision:'scope-1',sweep:true,workspaceIds:['w1']}),{code:'GOAL_ARGUMENT'});await assert.rejects(f.controller.action({action:'cancel',expectedRevision:s.revision,expectedAccessRevision:'wrong'}),{code:'GOAL_ACCESS_CHANGED'});assert.equal(f.reads.length,0);}finally{f.board.close();}
});

test('a later sweep batch does not erase the progress committed by an earlier batch',async()=>{
 let saved,sequence=0;const snapshot={revision:'scope',grants:Array.from({length:9},(_,i)=>({id:'g'+i,workspaceId:'w'+i,root:'/synthetic/'+i,label:'合成',sessionIds:['s'+i+'a','s'+i+'b']}))};
 const access={capture:async()=>structuredClone(snapshot),assertCurrent:async()=>true,authorizeSync:()=>true};
 const collector=createGoalBoardCollector({access,readProject:async()=>[],listSessions:async()=>snapshot.grants.flatMap(g=>g.sessionIds.map(sessionId=>({sessionId,cwd:g.root}))),readSession:async(g,sessionId)=>({sessionId,cwd:g.root,records:[{role:'user',seq:1,text:'共同目标 '+g.workspaceId}]})});
 const board=createGoalBoard({access,store:{get:async()=>saved,put:async(_id,value)=>{saved=structuredClone(value);}},collect:collector,createId:()=>`goal-${++sequence}`,model:{recognize:async({fragments})=>({groups:[...new Set(fragments.map(f=>f.workspaceId))].map(workspaceId=>({key:workspaceId,projectId:null,title:workspaceId,goal:'交付 '+workspaceId,evidenceIds:fragments.filter(f=>f.workspaceId===workspaceId).map(f=>f.id),lane:'active',progress:'本批已有进展',nextStep:'核对结果'})),standaloneIds:[],uncertainIds:[]})}});
 try{const s=await board.status();await board.startRecognition({expectedRevision:s.revision,expectedAccessRevision:'scope',sweep:true});await board.waitForIdle();const status=await board.status();assert.equal(status.projects.length,9);assert.ok(status.projects.every(p=>p.progress==='本批已有进展'&&!p.stale));}finally{board.close();}
});

test('real picker/access/collector/goal controllers save-only makes no reads and an unchanged saved scope starts one complete sweep',async()=>{
 const {createProjectCatalog}=await import('../src/project-catalog.js'),{createWorkspaceAccess}=await import('../src/workspace-access.js'),{createWorkspaceAccessController}=await import('../src/workspace-access-route.js'),{createWorkspaceScopeController,createLogicalProjectController}=await import('../src/client-goal-board.js');
 let scopeRow,boardRow,writes=0,reads=0;const catalog=createProjectCatalog({readRegistered:()=>Array.from({length:21},(_,i)=>({id:'w'+i,path:'/synthetic/e2e/'+i,title:'工作 '+i,sessionIds:[]}))});
 const access=createWorkspaceAccess({catalog,store:{get:async()=>scopeRow,put:async(_id,value)=>{scopeRow=structuredClone(value);writes++;}}});
 const board=createGoalBoard({access,store:{get:async()=>boardRow,put:async(_id,value)=>{boardRow=structuredClone(value);}},collect:createGoalBoardCollector({access,readProject:async()=>{reads++;return PROJECT_FILES.map(path=>({path,status:'ok',text:'合成说明'}));}}),model:{recognize:async({fragments})=>({groups:[],standaloneIds:fragments.map(f=>f.id),uncertainIds:[]})}});
 const goalRoute=createGoalBoardController({board,host:{}}),scopeRoute=createWorkspaceAccessController({access});const goals=createLogicalProjectController({request:body=>goalRoute.action(body)}),picker=createWorkspaceScopeController({request:body=>scopeRoute.action(body),onOrganize:revision=>goals.organize(revision)});
 try{await picker.open();await picker.selectAll();assert.equal(await picker.save(),true);assert.equal(reads,0);assert.equal(writes,1);await picker.open();assert.equal(await picker.save({organize:true}),true);assert.equal(writes,1);await board.waitForIdle();await goals.refresh();assert.equal(reads,21);assert.equal(goals.getSnapshot().status.scan.coverage.length,21);assert.equal((await access.list()).selectedCount,21);}finally{picker.close();goals.close();board.close();}
});

test('sweep coverage remains bound to its captured access revision after scope changes',async()=>{
 const f=fixture();try{await f.start();await f.board.waitForIdle();f.scope.revision='scope-2';const s=await f.board.status();assert.equal(s.accessRevision,'scope-2');assert.equal(s.scan.scopeRevision,'scope-1');}finally{f.board.close();}
});

async function mutationRaceFixture(stage='file'){
 let row,pause=false,modelCalls=0,id=0;const entered=deferred(),gate=deferred(),reads=[];
 const snapshot={revision:'mutation-scope',grants:Array.from({length:9},(_,i)=>({id:'g'+i,workspaceId:'w'+i,root:'/synthetic/mutation/'+i,label:'合成工作区 '+i,sessionIds:['s'+i+'a','s'+i+'b']}))};
 const access={capture:async()=>structuredClone(snapshot),assertCurrent:async()=>true,authorizeSync:()=>true};
 const wait=async kind=>{if(pause&&stage===kind){entered.resolve();await gate.promise;}};
 const collect=createGoalBoardCollector({access,readProject:async root=>{reads.push('file:'+root);await wait('file');return[];},listSessions:async()=>{reads.push('metadata');await wait('metadata');return snapshot.grants.flatMap(g=>g.sessionIds.map(sessionId=>({sessionId,cwd:g.root})));},readSession:async(g,sessionId)=>{reads.push('session:'+sessionId);await wait('session');return{sessionId,cwd:g.root,records:[{role:'user',seq:1,text:'合成目标 '+g.workspaceId}]};}});
 const board=createGoalBoard({access,store:{get:async()=>row,put:async(_id,value)=>{row=structuredClone(value);}},collect,createId:()=>`mutation-goal-${++id}`,model:{recognize:async({fragments})=>{modelCalls++;const evidenceIds=fragments.filter(f=>f.workspaceId==='w0').map(f=>f.id);return{groups:[{key:'seed',projectId:null,title:'原目标',goal:'保留原记录',evidenceIds,lane:'active',progress:'已提交批次的进展',nextStep:'核对结果'}],standaloneIds:fragments.filter(f=>!evidenceIds.includes(f.id)).map(f=>f.id),uncertainIds:[]};}}});
 let s=await board.status();await board.startRecognition({expectedRevision:s.revision,expectedAccessRevision:snapshot.revision});await board.waitForIdle();s=await board.status();pause=true;reads.length=0;const project=s.projects[0];await board.startRecognition({expectedRevision:s.revision,expectedAccessRevision:snapshot.revision,sweep:true});await entered.promise;
 return{board,project,reads,entered,gate,get modelCalls(){return modelCalls;},get row(){return row;}};
}
test('every accepted manual board mutation stops the real collector inside its current batch before more reads or model calls',async()=>{
 for(const action of ['accept','ignore','correct','vision','new-vision','conversation']){
  const f=await mutationRaceFixture();try{const before=f.reads.length,s=await f.board.status(),input={projectId:f.project.id,expectedRevision:s.revision};
   if(action==='correct')await f.board.correct({...input,evidenceId:f.row.projects[0].evidenceIds[0],targetProjectId:null});
   else if(action==='vision'||action==='new-vision')await f.board.vision({...input,projectId:action==='new-vision'?null:f.project.id,title:'人工目标',goal:'保留人工修改',constraints:[]});
   else if(action==='conversation')await f.board.conversation(input,{create:async()=>({sessionId:'dot-goal-manual'}),verify:async()=>true});
   else await f.board[action](input);
   f.gate.resolve();await f.board.waitForIdle();const result=await f.board.status();assert.equal(f.reads.length,before,action+' must stop further IO');assert.equal(f.modelCalls,1,action+' must stop before another model call');assert.equal(result.scan.code,'GOAL_CHANGED');assert.equal(result.scan.processed,0);assert.equal(result.scan.coverage.length,0);assert.equal(f.row.evidence.length,16);
   if(action==='accept')assert.equal(f.row.projects[0].state,'confirmed');if(action==='ignore')assert.equal(f.row.projects[0].ignored,true);if(action==='correct')assert.equal(f.row.locks[0].targetProjectId,null);if(action.includes('vision'))assert.ok(f.row.projects.some(p=>p.goal==='保留人工修改'));if(action==='conversation')assert.equal(f.row.projects[0].conversation.sessionId,'dot-goal-manual');
  }finally{f.gate.resolve();f.board.close();}
 }
});
test('manual revision guards stop before file or session IO when metadata or a session body was pending',async()=>{
 for(const stage of ['metadata','session']){const f=await mutationRaceFixture(stage);try{const before=f.reads.length,s=await f.board.status();await f.board.vision({projectId:null,title:'人工目标',goal:'保留',constraints:[],expectedRevision:s.revision});f.gate.resolve();await f.board.waitForIdle();assert.equal(f.reads.length,before,stage+' must stop at the IO boundary');assert.equal(f.modelCalls,1);assert.equal((await f.board.status()).scan.code,'GOAL_CHANGED');}finally{f.gate.resolve();f.board.close();}}
});

test('rejected stale or invalid manual edits do not cancel an otherwise authorized sweep',async()=>{
 const f=fixture({pauseBatch:1});try{await f.start();await f.entered.promise;const s=await f.board.status();await assert.rejects(f.board.vision({projectId:null,title:'错误修改',goal:'保留原任务',constraints:[],expectedRevision:'stale'}),{code:'GOAL_CHANGED'});await assert.rejects(f.board.vision({projectId:null,title:'',goal:'非法输入',constraints:[],expectedRevision:s.revision}),{code:'GOAL_ARGUMENT'});f.gate.resolve();await f.board.waitForIdle();const result=await f.board.status();assert.equal(result.scan.phase,'complete');assert.equal(result.scan.processed,21);assert.deepEqual(f.batches.map(b=>b.length),[8,8,5]);}finally{f.gate.resolve();f.board.close();}
});

test('a cancel queued behind an automatic batch commit still stops its displayed running job',async()=>{
 let row,batches=0;const entered=deferred(),gate=deferred(),scope={revision:'queued-cancel-scope',grants:Array.from({length:17},(_,i)=>({id:'g'+i,workspaceId:'w'+i,root:'/synthetic/cancel/'+i,label:'合成',sessionIds:[]}))};
 const access={capture:async()=>structuredClone(scope),assertCurrent:async()=>true,authorizeSync:()=>true};
 const collector=createGoalBoardCollector({access,readProject:async()=>PROJECT_FILES.map(path=>({path,status:'ok',text:'合成说明'}))});
 const board=createGoalBoard({access,store:{get:async()=>row,put:async(_id,value)=>{if(value.scan.phase==='running'&&value.scan.processed===8){entered.resolve();await gate.promise;}row=structuredClone(value);}},collect:(...args)=>{batches++;return collector(...args);},model:{recognize:async({fragments})=>({groups:[],standaloneIds:fragments.map(f=>f.id),uncertainIds:[]})}}),controller=createGoalBoardController({board,host:{}});
 try{const initial=await board.status(),displayed=await controller.action({action:'recognize',expectedRevision:initial.revision,expectedAccessRevision:scope.revision,sweep:true});await entered.promise;const cancellation=controller.action({action:'cancel',expectedRevision:displayed.revision,expectedAccessRevision:scope.revision}).then(value=>({value}),error=>({error}));gate.resolve();const receipt=await cancellation;await board.waitForIdle();assert.equal(receipt.error,undefined);const result=await board.status();assert.equal(result.scan.code,'GOAL_CANCELLED');assert.equal(result.scan.processed,8);assert.equal(result.scan.total,17);assert.equal(batches,1);assert.equal(result.scan.coverage.length,8);}finally{gate.resolve();board.close();}
});
test('job-bound cancellation rejects revisions from before the job and any accepted manual change',async()=>{
 const f=fixture({pauseBatch:2});try{const before=await f.board.status(),displayed=await f.start();await f.entered.promise;await assert.rejects(f.controller.action({action:'cancel',expectedRevision:before.revision,expectedAccessRevision:'scope-1'}),{code:'GOAL_CHANGED'});const latest=await f.board.status();await f.board.vision({projectId:null,title:'人工修改',goal:'保留',constraints:[],expectedRevision:latest.revision});await assert.rejects(f.controller.action({action:'cancel',expectedRevision:displayed.revision,expectedAccessRevision:'scope-1'}),{code:'GOAL_CHANGED'});f.gate.resolve();await f.board.waitForIdle();assert.equal((await f.board.status()).projects[0].goal,'保留');}finally{f.gate.resolve();f.board.close();}
});
