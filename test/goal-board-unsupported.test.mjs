import test from 'node:test';
import assert from 'node:assert/strict';
import {createGoalBoard} from '../src/goal-board-service.js';
import {createGoalBoardCollector} from '../src/goal-board-collect.js';
import {createGoalBoardModel} from '../src/goal-board-model.js';
import {validateGoalBoardResult} from '../src/goal-board-store.js';

const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
const fragment=(id,sessionId)=>({id,workspaceId:'w0',workspaceLabel:'合成',sessionId,kind:'user',reference:'message:'+id,text:'合成目标讨论',at:null,truncated:false});
const group=(key,evidenceIds,extra={})=>({key,projectId:null,title:'目标 '+key,goal:'交付 '+key,evidenceIds,lane:'active',progress:'来源提到正在推进',nextStep:'核对交付',...extra});
function syntheticModel(output){
 const calls=[];const llm={async prepareCall(config){return{config,stream(request){const input=JSON.parse(request.messages[0].content[0].text);calls.push(input);return(async function*(){yield{type:'block-end',index:0,block:{type:'text',text:JSON.stringify(await output(input,calls.length))}};yield{type:'usage',usage:{outputTokens:100,reasoningTokens:50}};yield{type:'finish',reason:{kind:'stop'}};})();}};}};
 return{model:createGoalBoardModel({get:name=>name==='llm'?llm:{currentSelection:()=>({provider:'synthetic',model:'synthetic'})}}),calls};
}
function mixedSweep({pauseBatch=0}={}){
 let row,sequence=0;const batches=[],bodyIds=[],entered=deferred(),gate=deferred();
 const scope={revision:'mixed-scope',grants:Array.from({length:21},(_,i)=>({id:'grant'+i,workspaceId:'w'+i,root:'/synthetic/mixed/'+i,label:'合成 '+i,sessionIds:Array.from({length:i%3},(_,n)=>'s'+i+'-'+n)}))};
 const access={capture:async()=>structuredClone(scope),assertCurrent:async s=>{if(JSON.stringify(s)!==JSON.stringify(scope))throw Error('changed');return true;},authorizeSync:s=>JSON.stringify(s)===JSON.stringify(scope)};
 const collector=createGoalBoardCollector({access,readProject:async()=>[{path:'README.md',status:'ok',text:'合成文件，不能单独证明项目'}],listSessions:async()=>scope.grants.flatMap(g=>g.sessionIds.map(sessionId=>({sessionId,cwd:g.root}))),readSession:async(g,sessionId)=>{bodyIds.push(sessionId);return{sessionId,cwd:g.root,records:Array.from({length:g.sessionIds.length===1?2:1},(_,seq)=>({role:'user',seq,text:'合成会话目标 '+g.workspaceId}))};}});
 const native=syntheticModel(({fragments})=>({groups:[...new Set(fragments.map(f=>f.workspaceId))].map(id=>group(id,fragments.filter(f=>f.workspaceId===id).map(f=>f.id))),standaloneIds:[],uncertainIds:[]}));
 const board=createGoalBoard({access,store:{get:async()=>row,put:async(_id,value)=>{row=structuredClone(value);}},collect:async(s,options)=>{batches.push(options.workspaceIds);const result=await collector(s,options);if(batches.length===pauseBatch){entered.resolve();await gate.promise;}return result;},model:native.model,createId:()=>`mixed-goal-${++sequence}`});
 const start=async()=>{const status=await board.status();return board.startRecognition({expectedRevision:status.revision,expectedAccessRevision:scope.revision,sweep:true});};
 return{board,native,scope,batches,bodyIds,entered,gate,start,get row(){return row;},close(){gate.resolve();board.close();native.model.close();}};
}
test('a synthetic 21-workspace sweep uses the real collector and model adapter to isolate unsupported proposals across 8/8/5 batches',async()=>{
 const f=mixedSweep();try{await f.start();await f.board.waitForIdle();const status=await f.board.status();assert.equal(status.scan.phase,'complete');assert.deepEqual(f.batches.map(b=>b.length),[8,8,5]);assert.equal(f.native.calls.length,3,'isolation requires no extra model call');assert.equal(status.scan.processed,21);assert.equal(status.scan.coverage.length,21);assert.equal(status.scan.coverage.reduce((n,c)=>n+c.sessionsRead,0),21,'committed coverage carries the session read total; the B-only live scan.run progress projection is not part of this port');assert.equal(status.projects.length,7);assert.ok(status.projects.every(p=>p.sessionCount===2&&p.progress==='来源提到正在推进'&&!p.stale));assert.equal(status.uncertainCount,28);assert.equal(f.row.evidence.length,49);assert.equal(f.row.standaloneIds.length,0);
  assert.deepEqual(new Set(f.bodyIds),new Set(f.scope.grants.flatMap(g=>g.sessionIds)));for(const call of f.native.calls)for(const source of call.fragments.filter(f=>f.kind!=='file'))assert.ok(f.scope.grants.find(g=>g.workspaceId===source.workspaceId).sessionIds.includes(source.sessionId));
 }finally{f.close();}
});
test('cancellation and a manual revision after an isolated batch retain its commit and stop remaining batches',async()=>{
 for(const action of ['cancel','manual']){const f=mixedSweep({pauseBatch:2});try{const displayed=await f.start();await f.entered.promise;const before=await f.board.status();assert.equal(before.scan.processed,8);assert.equal(before.projects.length,2);if(action==='cancel')await f.board.cancelRecognition({expectedRevision:displayed.revision,expectedAccessRevision:f.scope.revision});else await f.board.vision({projectId:null,title:'人工目标',goal:'保留人工修改',constraints:[],expectedRevision:before.revision});f.gate.resolve();await f.board.waitForIdle();const status=await f.board.status();assert.equal(status.scan.code,action==='cancel'?'GOAL_CANCELLED':'GOAL_CHANGED');assert.equal(status.scan.processed,8);assert.equal(f.batches.length,2);assert.equal(f.native.calls.length,1);assert.equal(f.row.evidence.length,18);assert.equal(status.projects.length,action==='cancel'?2:3);}finally{f.close();}}
});
test('unsupported proposals retain confirmed associations and manual locks without claiming fresh progress',async()=>{
 let row,sequence=0;const sources=[fragment('a','s1'),fragment('b','s2')],scope={revision:'ownership-scope',grants:[{id:'grant',workspaceId:'w0',root:'/synthetic/ownership',label:'合成',sessionIds:['s1','s2']}]};
 const access={capture:async()=>structuredClone(scope),assertCurrent:async()=>true,authorizeSync:()=>true};
 const native=syntheticModel((_input,call)=>call===1?{groups:[group('seed',['a','b'])],standaloneIds:[],uncertainIds:[]}:{groups:[group('renamed-a',['a']),group('renamed-b',['b'])],standaloneIds:[],uncertainIds:[]});
 const board=createGoalBoard({access,store:{get:async()=>row,put:async(_id,value)=>{row=structuredClone(value);}},collect:async()=>({fragments:sources,coverage:[]}),model:native.model,createId:()=>`owner-${++sequence}`});
 const recognize=async()=>{const s=await board.status();await board.startRecognition({expectedRevision:s.revision,expectedAccessRevision:scope.revision});await board.waitForIdle();return board.status();};
 try{let status=await recognize();const original=status.projects[0].id;status=await board.accept({projectId:original,expectedRevision:status.revision});status=await board.vision({projectId:null,title:'人工归属',goal:'保留锁定',constraints:[],expectedRevision:status.revision});const target=status.projects[1].id;status=await board.correct({projectId:original,evidenceId:'a',targetProjectId:target,expectedRevision:status.revision});status=await recognize();assert.equal(status.scan.phase,'complete');assert.equal(status.projects.length,2);assert.equal(status.uncertainCount,0);assert.deepEqual((await board.detail({projectId:original})).evidence.map(e=>e.id),['b']);assert.deepEqual((await board.detail({projectId:target})).evidence.map(e=>e.id),['a']);assert.ok(status.projects.every(p=>p.stale&&p.progress===null&&p.nextStep===null));assert.equal(native.calls.length,2);assert.equal(row.locks[0].targetProjectId,target);}finally{board.close();native.model.close();}
});
test('service revalidates raw adapter proposals while ordinary uncertainty retains its existing meaning',async()=>{
 let row,call=0,sequence=0;const sources=[fragment('a','s1'),fragment('b','s2'),fragment('c','s3')],scope={revision:'raw-scope',grants:[{id:'grant',workspaceId:'w0',root:'/synthetic/raw',label:'合成',sessionIds:['s1','s2','s3']}]};
 const access={capture:async()=>structuredClone(scope),assertCurrent:async()=>true,authorizeSync:()=>true};
 const board=createGoalBoard({access,store:{get:async()=>row,put:async(_id,value)=>{row=structuredClone(value);}},collect:async()=>({fragments:sources,coverage:[]}),model:{recognize:async()=>++call===1?{groups:[group('seed',['a','b'])],standaloneIds:['c'],uncertainIds:[]}:call===2?{groups:[group('unsupported',['c'])],standaloneIds:[],uncertainIds:['a','b']}:{groups:[group('one',['a']),group('valid',['b','c'])],standaloneIds:[],uncertainIds:[]}},createId:()=>`raw-${++sequence}`});
 const recognize=async()=>{const s=await board.status();await board.startRecognition({expectedRevision:s.revision,expectedAccessRevision:scope.revision});await board.waitForIdle();return board.status();};
 try{let status=await recognize();const original=status.projects[0].id;status=await board.accept({projectId:original,expectedRevision:status.revision});status=await recognize();assert.equal(status.scan.phase,'complete');assert.equal((await board.detail({projectId:original})).evidence.length,0,'ordinary uncertainty must not acquire isolation-only owner protection');assert.equal(status.uncertainCount,3);status=await recognize();assert.equal(status.scan.phase,'complete');assert.equal(status.projects.length,2);assert.equal(status.uncertainCount,1);assert.equal(status.projects.find(p=>p.id!==original).sessionCount,2);}finally{board.close();}
});
test('the strict validator still rejects insufficient conversation support',()=>{
 for(const sources of [[fragment('a','same'),fragment('b','same')],[{...fragment('a','s1'),kind:'file'},{...fragment('b','s2'),kind:'file'}],[fragment('a',null),fragment('b',null)]])assert.throws(()=>validateGoalBoardResult({groups:[group('bad',['a','b'])],standaloneIds:[],uncertainIds:[]},sources,[]),error=>error.goalOutputRule==='new_project_support');
});
test('isolation never hides another invalid partition, target, canonical vision or extra model field',async()=>{
 const sources=[fragment('a','s1'),fragment('b','s2'),fragment('c','s3')],unsupported=group('unsupported',['a']),valid=group('valid',['b','c']),existing={id:'confirmed',title:'人工标题',goal:'人工目标',constraints:[],state:'confirmed',ignored:false,evidenceIds:[]};
 const cases=[
  [{groups:[unsupported],standaloneIds:['b'],uncertainIds:[]},'partition_missing'],
  [{groups:[unsupported,valid],standaloneIds:['a'],uncertainIds:[]},'partition_duplicate'],
  [{groups:[unsupported,{...valid,evidenceIds:['b','unknown']}],standaloneIds:['c'],uncertainIds:[]},'partition_unknown'],
  [{groups:[unsupported,{...valid,projectId:'confirmed'}],standaloneIds:[],uncertainIds:[]},'canonical_changed'],
  [{groups:[unsupported,{...valid,projectId:'unknown'}],standaloneIds:[],uncertainIds:[]},'project_unknown'],
  [{groups:[unsupported,{...valid,key:unsupported.key}],standaloneIds:[],uncertainIds:[]},'duplicate_group'],
  [{groups:[unsupported,group('b',['b'],{projectId:existing.id,title:existing.title,goal:existing.goal}),group('c',['c'],{projectId:existing.id,title:existing.title,goal:existing.goal})],standaloneIds:[],uncertainIds:[]},'duplicate_target'],
  [{groups:[unsupported,valid],standaloneIds:[],uncertainIds:[],quarantinedIds:['a']},'shape'],
 ];
 for(const[output,rule]of cases){const native=syntheticModel(()=>output),quarantined=[];try{await assert.rejects(native.model.recognize({fragments:sources,existingProjects:[existing],onQuarantined:ids=>quarantined.push(...ids)}),error=>error.code==='MODEL_INVALID_OUTPUT'&&error.goalOutputRule===rule,rule);assert.deepEqual(quarantined,[],rule+' cannot report a successful isolation');assert.ok(native.calls.length<=2);}finally{native.model.close();}}
});
test('the direct model API rechecks cancellation and authorization after reporting isolated evidence',async()=>{
 for(const mode of ['abort','guard','sync','close']){const controller=new AbortController(),native=syntheticModel(()=>({groups:[group('unsupported',['a'])],standaloneIds:[],uncertainIds:[]}));let allowed=true,reported=0;try{await assert.rejects(native.model.recognize({fragments:[fragment('a','s1')],signal:controller.signal,guard:()=>mode==='guard'?allowed:true,authorizeSync:()=>mode==='sync'?allowed:true,onQuarantined:ids=>{reported++;assert.deepEqual(ids,['a']);if(mode==='abort')controller.abort();else if(mode==='close')native.model.close();else allowed=false;}}),{code:mode==='abort'?'MODEL_ABORTED':mode==='close'?'MODEL_CLOSED':'MODEL_AUTHORIZATION_CHANGED'},mode);assert.equal(reported,1);assert.equal(native.calls.length,1);}finally{native.model.close();}}
});
