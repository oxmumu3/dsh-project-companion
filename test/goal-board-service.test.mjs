import test from 'node:test';
import assert from 'node:assert/strict';
test('manual vision changes invalidate prior derived progress but retain source and conversation history',async()=>{const f=fixture();let s=await recognize(f),p=s.projects[0];assert.equal(p.stale,false);s=await f.board.vision({projectId:p.id,title:'全新目标',goal:'与原目标不同',constraints:['不发消息'],expectedRevision:s.revision});p=s.projects[0];assert.equal(p.stale,true);assert.equal(p.lane,'unknown');assert.equal(p.progress,null);assert.equal(p.nextStep,null);assert.equal((await f.board.detail({projectId:p.id})).evidence.length,2);f.board.close();});
import {createGoalBoard} from '../src/goal-board-service.js';
const fragment=(id,sessionId='s1',extra={})=>({id,workspaceId:'w1',workspaceLabel:'Synthetic',sessionId,kind:'user',reference:'message:'+id,text:'Synthetic launch work '+id,at:null,truncated:false,...extra});
const sources=[fragment('a','s1'),fragment('b','s2')];
const grouped=(ids=['a','b'],extra={})=>({groups:[{key:'launch',projectId:null,title:'发布',goal:'交付发布',evidenceIds:ids,lane:'mine',progress:'来源讨论发布',nextStep:'核对验收',...extra}],standaloneIds:[],uncertainIds:[]});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
function fixture({raw,collect,model,createId,...options}={}){
 let row=raw;const writes=[],scope={revision:'access1',grants:[{id:'public1',workspaceId:'w1',root:'/synthetic/w1',label:'Synthetic',sessionIds:['s1','s2']}]};
 const access={capture:async()=>structuredClone(scope),assertCurrent:async snapshot=>{if(JSON.stringify(snapshot)!==JSON.stringify(scope))throw Object.assign(Error('changed'),{code:'WORKSPACE_ACCESS_CHANGED'});return true;},authorizeSync:snapshot=>JSON.stringify(snapshot)===JSON.stringify(scope)};
 const store={get:async()=>structuredClone(row),put:async(id,value)=>{assert.equal(id,'profile');row=structuredClone(value);writes.push(row);}};let reads=0,calls=0,id=0;
 const make=()=>createGoalBoard({store,access,collect:collect??(async()=>{reads++;return{fragments:sources,coverage:[{workspaceId:'w1',label:'Synthetic',status:'partial',filesRead:0,sessionsRead:2,truncated:true}]};}),model:model??{recognize:async()=>{calls++;return grouped();}},clock:()=>new Date('2026-10-30T10:00:00Z'),createId:createId??(()=>`objective-${++id}`),...options});
 return{board:make(),make,store,access,scope,writes,get row(){return row;},get reads(){return reads;},get calls(){return calls;}};
}
async function recognize(f){const status=await f.board.status();await f.board.startRecognition({expectedRevision:status.revision,expectedAccessRevision:f.scope.revision});await f.board.waitForIdle();return f.board.status();}
test('status is metadata-only and recognition is one owned async job, never restarted by polling',async()=>{
 const gate=deferred(),entered=deferred();let reads=0;const f=fixture({collect:async()=>{reads++;entered.resolve();await gate.promise;return{fragments:sources,coverage:[]};}});
 const initial=await f.board.status();assert.equal(initial.projects.length,0);assert.equal(reads,0);
 const started=await f.board.startRecognition({expectedRevision:initial.revision,expectedAccessRevision:'access1'});assert.equal(started.scan.phase,'running');await entered.promise;
 for(let i=0;i<3;i++)assert.equal((await f.board.status()).scan.phase,'running');
 await f.board.startRecognition({expectedRevision:initial.revision,expectedAccessRevision:'access1'});assert.equal(reads,1);gate.resolve();await f.board.waitForIdle();assert.equal((await f.board.status()).scan.phase,'complete');
 const restart=f.make();assert.equal((await restart.status()).projects[0].id,'objective-1');assert.equal(reads,1);f.board.close();restart.close();
});
test('confirmed canonical vision and IDs survive later recognition and restart',async()=>{
 const f=fixture({model:{recognize:async({existingProjects})=>grouped(['a','b'],{projectId:existingProjects[0]?.id??null})}});let status=await recognize(f);const id=status.projects[0].id;assert.equal(status.scan.coverage[0].status,'partial');
 status=await f.board.accept({projectId:id,expectedRevision:status.revision});assert.equal(status.projects[0].state,'confirmed');
 status=await f.board.vision({projectId:id,title:'正式目标',goal:'按用户目标交付',constraints:['用户验收'],expectedRevision:status.revision});
 const restarted=f.make();assert.equal((await restarted.detail({projectId:id})).project.goal,'按用户目标交付');
 // A model attempting to overwrite confirmed vision fails without touching it.
 f.board.close();f.board=restarted;const result=await recognize(f);assert.equal(result.scan.phase,'failed');assert.equal(result.projects[0].goal,'按用户目标交付');assert.equal(result.projects[0].id,id);restarted.close();
});
test('ignore persists across grouping keys; corrected fragment authority survives later recognition',async()=>{
 let run=0;const f=fixture({model:{recognize:async()=>grouped(['a','b'],{key:`key-${++run}`})}});let status=await recognize(f),id=status.projects[0].id;
 status=await f.board.correct({projectId:id,evidenceId:'a',targetProjectId:null,expectedRevision:status.revision});assert.equal(status.projects[0].stale,true);assert.equal(status.projects[0].progress,null);
 status=await recognize(f);const detail=await f.board.detail({projectId:id});assert.deepEqual(detail.evidence.map(e=>e.id),['b']);assert.equal(status.standaloneCount,1);
 await f.board.ignore({projectId:id,expectedRevision:status.revision});status=await recognize(f);assert.deepEqual(status.projects,[]);assert.equal(f.row.projects.length,1);assert.equal(f.row.projects[0].ignored,true);f.board.close();
});
test('user-created vision works with empty workspace scope and stale CAS cannot mutate',async()=>{
 const f=fixture();f.scope.grants=[];const initial=await f.board.status();const status=await f.board.vision({projectId:null,title:'人工目标',goal:'先明确目标',constraints:[],expectedRevision:initial.revision});assert.equal(status.projects[0].state,'confirmed');assert.equal(f.reads,0);assert.equal(f.calls,0);
 await assert.rejects(f.board.ignore({projectId:status.projects[0].id,expectedRevision:initial.revision}),{code:'GOAL_CHANGED'});assert.equal((await f.board.status()).projects.length,1);f.board.close();
});
test('revocation during collection prevents model; revocation after model prevents commit',async()=>{
 for(const stage of ['collect','model']){
  const entered=deferred(),gate=deferred();let calls=0;const f=fixture({collect:async()=>{if(stage==='collect'){entered.resolve();await gate.promise;}return{fragments:sources,coverage:[]};},model:{recognize:async()=>{calls++;if(stage==='model'){entered.resolve();await gate.promise;}return grouped();}}});
  const s=await f.board.status();await f.board.startRecognition({expectedRevision:s.revision,expectedAccessRevision:'access1'});await entered.promise;f.scope.revision='revoked';f.scope.grants=[];gate.resolve();await f.board.waitForIdle();const result=await f.board.status();assert.equal(result.scan.phase,'failed');assert.equal(result.projects.length,0);assert.equal(calls,stage==='collect'?0:1);f.board.close();
 }
});
test('revoked evidence and derived progress are masked and regrant never revives them',async()=>{
 const f=fixture();let s=await recognize(f),id=s.projects[0].id;assert.equal((await f.board.detail({projectId:id})).evidence[0].available,true);
 f.scope.revision='access2';f.scope.grants=[];s=await f.board.status();assert.equal(s.projects[0].stale,true);assert.equal(s.projects[0].progress,null);let detail=await f.board.detail({projectId:id});assert.equal(detail.evidence[0].text,'');assert.equal(detail.evidence[0].available,false);
 f.scope.revision='access3';f.scope.grants=[{id:'public1',workspaceId:'w1',root:'/synthetic/w1',label:'Synthetic',sessionIds:['s1','s2']}];detail=await f.board.detail({projectId:id});assert.equal(detail.evidence[0].available,false);f.board.close();
});
test('dedicated native conversation is created once under serialization, reused and never submits',async()=>{
 const f=fixture();let status=await recognize(f);const id=status.projects[0].id;let creates=0;const sessions=new Set();
 const callbacks={create:async args=>{assert.equal(args.projectId,id);creates++;sessions.add('native-project-1');return{sessionId:'native-project-1'};},verify:async sessionId=>sessions.has(sessionId)};
 const args={projectId:id,expectedRevision:status.revision};const [a,b]=await Promise.all([f.board.conversation(args,callbacks),f.board.conversation(args,callbacks)]);assert.deepEqual(a,b);assert.equal(creates,1);assert.equal(a.conversation.revision,'native:native-project-1');
 assert.deepEqual(await f.board.getContextForSession('native-project-1'),{projectId:id,title:'发布',goal:'交付发布',constraints:[]});assert.equal(await f.board.getContextForSession('global-dot'),null);
 const restarted=f.make();assert.equal((await restarted.conversation({projectId:id,expectedRevision:(await restarted.status()).revision},callbacks)).conversation.sessionId,'native-project-1');assert.equal(creates,1);f.board.close();restarted.close();
});
test('conversation rejects historical/global reuse and invalid callbacks without persistent linkage',async()=>{
 const f=fixture();const s=await recognize(f);const args={projectId:s.projects[0].id,expectedRevision:s.revision};await assert.rejects(f.board.conversation(args,{create:async()=>({sessionId:'historical'}),verify:async()=>false}),{code:'GOAL_CONVERSATION_UNAVAILABLE'});assert.equal(f.row.projects[0].conversation,null);f.board.close();
});
test('old running rows recover as interrupted with no automatic retry; close bounds hung collection',async()=>{
 const f=fixture();let s=await f.board.status();const created=await f.board.vision({projectId:null,title:'Persistent',goal:'Persistent goal',constraints:[],expectedRevision:s.revision});const raw=structuredClone(f.row);raw.scan={phase:'running',at:'2026-10-30T10:00:00Z',coverage:[]};f.board.close();
 const restored=fixture({raw});s=await restored.board.status();assert.equal(s.scan.phase,'failed');assert.equal(s.scan.code,'GOAL_INTERRUPTED');assert.equal(s.projects[0].id,created.projects[0].id);assert.equal(restored.reads,0);restored.board.close();
 const hung=fixture({collect:()=>new Promise(()=>{})});s=await hung.board.status();await hung.board.startRecognition({expectedRevision:s.revision,expectedAccessRevision:'access1'});hung.board.close();await hung.board.waitForIdle();
});
test('invalid or ungranted collected fragments never reach the model or storage',async()=>{
 for(const fragments of [[...sources,fragment('c','not-granted')],[...sources,fragment('c','s1',{workspaceId:'unselected'})],[...sources,sources[0]],[fragment('a','s1',{text:'x'.repeat(3001)})]]){
  const f=fixture({collect:async()=>({fragments,coverage:[]})});const result=await recognize(f);assert.equal(result.scan.phase,'failed');assert.equal(result.projects.length,0);assert.equal(f.calls,0);assert.equal(f.row.evidence.length,0);f.board.close();
 }
});
test('bounded scan cursor persists across recognition and untouched project progress becomes stale',async()=>{
 const cursors=[];let batch=0;const f=fixture({collect:async(_snapshot,{cursor})=>{cursors.push(cursor);return{fragments:batch++?[]:sources,coverage:[],nextCursor:batch};},model:{recognize:async({fragments})=>fragments.length?grouped():{groups:[],standaloneIds:[],uncertainIds:[]}}});
 let s=await recognize(f);assert.equal(s.scan.cursor,1);s=await recognize(f);assert.deepEqual(cursors,[0,1]);assert.equal(s.scan.cursor,2);assert.equal(s.projects[0].stale,true);assert.equal(s.projects[0].progress,null);assert.equal((await f.board.detail({projectId:s.projects[0].id})).evidence.length,2);f.board.close();
});
test('manual changes during recognition are never overwritten by a stale job',async()=>{
 const entered=deferred(),gate=deferred();const f=fixture({model:{recognize:async()=>{entered.resolve();await gate.promise;return grouped();}}});let s=await f.board.status();await f.board.startRecognition({expectedRevision:s.revision,expectedAccessRevision:'access1'});await entered.promise;s=await f.board.status();await f.board.vision({projectId:null,title:'User goal',goal:'Keep my goal',constraints:[],expectedRevision:s.revision});gate.resolve();await f.board.waitForIdle();s=await f.board.status();assert.equal(s.scan.phase,'failed');assert.equal(s.scan.code,'GOAL_CHANGED');assert.equal(s.projects.length,1);assert.equal(s.projects[0].title,'User goal');f.board.close();
});
test('post-write scope change rolls back the source commit before any status can expose it',async()=>{
 const f=fixture();const put=f.store.put;f.store.put=async(id,row)=>{await put(id,row);if(row.scan.phase==='complete'){f.scope.revision='revoked';f.scope.grants=[];}};
 const s=await recognize(f);assert.equal(s.scan.phase,'failed');assert.deepEqual(s.projects,[]);assert.equal(f.row.evidence.length,0);f.board.close();
});
test('opening a previously created conversation still rejects unrelated stale revisions',async()=>{
 const f=fixture();let s=await recognize(f),id=s.projects[0].id;const callbacks={create:async()=>({sessionId:'native1'}),verify:async()=>true};await f.board.conversation({projectId:id,expectedRevision:s.revision},callbacks);
 s=await f.board.status();await f.board.vision({projectId:id,title:'New goal',goal:'Canonical',constraints:[],expectedRevision:s.revision});await assert.rejects(f.board.conversation({projectId:id,expectedRevision:s.revision},callbacks),{code:'GOAL_CHANGED'});f.board.close();
});
test('same native conversation may contribute independent fragments to two user-created goals',async()=>{
 let a,b;const f=fixture({collect:async()=>({fragments:[fragment('a'),fragment('b')],coverage:[]}),model:{recognize:async()=>({groups:[{...grouped(['a']).groups[0],projectId:a,title:'A',goal:'Goal A'},{...grouped(['b']).groups[0],key:'other',projectId:b,title:'B',goal:'Goal B'}],standaloneIds:[],uncertainIds:[]})}});
 let s=await f.board.status();s=await f.board.vision({projectId:null,title:'A',goal:'Goal A',constraints:[],expectedRevision:s.revision});a=s.projects[0].id;s=await f.board.vision({projectId:null,title:'B',goal:'Goal B',constraints:[],expectedRevision:s.revision});b=s.projects[1].id;s=await recognize(f);assert.equal(s.scan.phase,'complete');assert.deepEqual((await f.board.detail({projectId:a})).evidence.map(e=>e.id),['a']);assert.deepEqual((await f.board.detail({projectId:b})).evidence.map(e=>e.id),['b']);f.board.close();
});
test('collector cannot reuse a known source ID for a different source locator',async()=>{
 let run=0;const f=fixture({collect:async()=>({fragments:run++?sources.map(s=>({...s,reference:'different'})):sources,coverage:[]})});await recognize(f);const s=await recognize(f);assert.equal(s.scan.phase,'failed');assert.equal(s.scan.code,'GOAL_COLLECT_INVALID');f.board.close();
});
test('scope change subscription cancels even an uncooperative collector without a retry',async()=>{
 let listener;const f=fixture({collect:()=>new Promise(()=>{})});f.board.close();f.access.subscribe=fn=>{listener=fn;return()=>{listener=null;};};f.board=f.make();const s=await f.board.status();await f.board.startRecognition({expectedRevision:s.revision,expectedAccessRevision:'access1'});listener();await f.board.waitForIdle();assert.equal((await f.board.status()).scan.code,'GOAL_ACCESS_CHANGED');f.board.close();assert.equal(listener,null);
});
test('ignored source associations persist even when a later model makes them standalone then regroups',async()=>{
 let run=0;const f=fixture({model:{recognize:async()=>++run===2?{groups:[],standaloneIds:['a','b'],uncertainIds:[]}:grouped(['a','b'],{key:'changed-'+run})}});let s=await recognize(f);await f.board.ignore({projectId:s.projects[0].id,expectedRevision:s.revision});await recognize(f);s=await recognize(f);assert.deepEqual(s.projects,[]);assert.equal(f.row.projects.length,1);f.board.close();
});
test('correction locks cannot be reused to manufacture a new one-session project',async()=>{
 let target,run=0;const f=fixture({model:{recognize:async()=>grouped(['a','b'],{key:'new-'+(++run)})}});let s=await recognize(f),origin=s.projects[0].id;s=await f.board.vision({projectId:null,title:'Separate',goal:'Other goal',constraints:[],expectedRevision:s.revision});target=s.projects[1].id;s=await f.board.correct({projectId:origin,evidenceId:'a',targetProjectId:target,expectedRevision:s.revision});s=await recognize(f);assert.equal(s.projects.length,2);assert.deepEqual((await f.board.detail({projectId:target})).evidence.map(e=>e.id),['a']);f.board.close();
});
test('malformed persisted references fail closed instead of presenting invented evidence',async()=>{
 const f=fixture();await recognize(f);const raw=structuredClone(f.row);raw.projects[0].evidenceIds.push('invented');const bad=fixture({raw});await assert.rejects(bad.board.status(),{code:'GOAL_STORE_UNAVAILABLE'});f.board.close();bad.board.close();
});
test('source cache accepts more than400 records but a quota failure preserves canonical history',async()=>{
 const f=fixture();await recognize(f);const raw=structuredClone(f.row),template=raw.evidence[0];raw.evidence=Array.from({length:2000},(_,i)=>({...template,id:'old-'+i,reference:'old:'+i,text:'x'}));raw.projects[0].evidenceIds=[];raw.projects[0].state='confirmed';raw.standaloneIds=raw.evidence.map(e=>e.id);raw.uncertainIds=[];
 const full=fixture({raw});const status=await full.board.status();assert.equal(status.standaloneCount,2000);const result=await recognize(full);assert.equal(result.scan.code,'GOAL_LIMIT');assert.equal(full.row.projects[0].state,'confirmed');assert.equal(full.row.evidence.length,2000);f.board.close();full.board.close();
});
test('fresh model progress can recover after respecting a persisted correction',async()=>{
 let id,run=0;const f=fixture({model:{recognize:async()=>++run===1?grouped():{groups:[{...grouped(['b']).groups[0],projectId:id}],standaloneIds:['a'],uncertainIds:[]}}});let s=await recognize(f);id=s.projects[0].id;await f.board.correct({projectId:id,evidenceId:'a',targetProjectId:null,expectedRevision:s.revision});s=await recognize(f);assert.equal(s.projects[0].stale,false);assert.equal(s.projects[0].progress,'来源讨论发布');f.board.close();
});
test('a reassigned source supports fresh progress when the model honors its corrected target',async()=>{
 let a,b,run=0;const f=fixture({model:{recognize:async()=>++run===1?grouped():{groups:[{...grouped(['b']).groups[0],projectId:a},{...grouped(['a']).groups[0],key:'other',projectId:b,title:'B',goal:'Goal B'}],standaloneIds:[],uncertainIds:[]}}});let s=await recognize(f);a=s.projects[0].id;s=await f.board.vision({projectId:null,title:'B',goal:'Goal B',constraints:[],expectedRevision:s.revision});b=s.projects[1].id;await f.board.correct({projectId:a,evidenceId:'a',targetProjectId:b,expectedRevision:s.revision});s=await recognize(f);assert.equal(s.projects.find(p=>p.id===b).stale,false);assert.equal(s.projects.find(p=>p.id===b).progress,'来源讨论发布');f.board.close();
});
