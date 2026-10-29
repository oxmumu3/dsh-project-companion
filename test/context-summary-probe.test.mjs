import test from 'node:test';
import assert from 'node:assert/strict';
import {createContextRoute,registerContextRoute} from '../src/context-route.js';
import {bindingRevision} from '../src/workbench-scope.js';
import {createHash} from 'node:crypto';
import {createFamilyWorkbenchConnection} from '../src/family-workbench-route.js';
const initial={state:'bound',sessionId:'synthetic-owner',bindingKey:'a'.repeat(64)};
function fixture({summarize,owner=true,timeoutMs=1000}={}){
 let binding=initial,paused=false,calls=0,restores=0;const inputs=[];
 const no=()=>{throw Error('PRIVATE_SERVICE_FORBIDDEN');};
 const route=createContextRoute({context:{snapshot:async()=>({sources:[]}),act:no,authorization:no},readConnection:async()=>binding,resolveOwner:sessionId=>owner?{sessionId,cwd:'/PRIVATE_OWNER_CWD'}:null,activateOwner:async()=>{restores++;},canRun:async()=>!paused,summaryCheckTimeoutMs:timeoutMs,summarizeSynthetic:async input=>{calls++;inputs.push(input);if(summarize)return summarize(input);return{changes:[{kind:'quote',text:'界面改造已完成。',sourceIds:['file:probe-progress']}],blockers:[],nextSteps:[]};}});
 return{route,calls:()=>calls,inputs,restores:()=>restores,change:()=>{binding={...initial,bindingKey:'b'.repeat(64)};},pause:()=>{paused=true;},run:extra=>route.action({action:'check_summary',expectedBindingRevision:bindingRevision(initial),...extra})};
}
test('synthetic model check uses one fixed input and returns counts only without context IO',async()=>{const h=fixture();const result=await h.run();assert.deepEqual(result,{summaryAvailable:true,synthetic:true,counts:{changes:1,blockers:0,nextSteps:0}});assert.equal(h.calls(),1);assert.doesNotMatch(JSON.stringify(h.inputs),/PRIVATE_OWNER_CWD/);assert.doesNotMatch(JSON.stringify(result),/界面|file:probe/);assert.equal(h.inputs[0].project.label,'合成项目');});
test('summary check rejects extra input stale binding missing Owner and never restores a session',async()=>{for(const extra of [{text:'PRIVATE'},{source:'flomo'},{expectedBindingRevision:'wrong'}]){const h=fixture();await assert.rejects(h.run(extra));assert.equal(h.calls(),0);}const h=fixture({owner:false});await assert.rejects(h.run());assert.equal(h.calls(),0);assert.equal(h.restores(),0);});
test('synthetic model failure is reduced to fixed error categories',async()=>{const h=fixture({summarize:async()=>{throw Object.assign(Error('PRIVATE_PROVIDER_BODY'),{code:'MODEL_INVALID_OUTPUT',validationDiagnostic:'QUOTE_MISMATCH',input:'PRIVATE'});}});assert.deepEqual(await h.run(),{summaryAvailable:false,synthetic:true,code:'MODEL_INVALID_OUTPUT',validationDiagnostic:'QUOTE_MISMATCH'});const u=fixture({summarize:async()=>{throw Object.assign(Error('PRIVATE'),{code:'PRIVATE',validationDiagnostic:'PRIVATE'});}});assert.deepEqual(await u.run(),{summaryAvailable:false,synthetic:true,code:'MODEL_REQUEST_FAILED'});});
test('synthetic output is validated again and cannot smuggle source IDs extra fields or oversized results',async()=>{for(const value of [{changes:[{kind:'quote',text:'FAKE',sourceIds:['file:private']}],blockers:[],nextSteps:[]},{changes:[],blockers:[],nextSteps:[],raw:'PRIVATE'}]){const h=fixture({summarize:async()=>value});const result=await h.run();assert.equal(result.summaryAvailable,false);assert.equal(result.code,'MODEL_INVALID_OUTPUT');assert.doesNotMatch(JSON.stringify(result),/FAKE|PRIVATE|file:/);}});
test('paused changed or closed binding discards slow synthetic reply without state IO',async()=>{for(const action of ['pause','change','close']){let release,entered;const held=new Promise(r=>{release=r;}),started=new Promise(r=>{entered=r;});const h=fixture({summarize:async()=>{entered();await held;return{changes:[],blockers:[],nextSteps:[]};}});const p=h.run();await started;if(action==='close')h.route.close();else h[action]();release();await assert.rejects(p);}});
test('deadline bounds noncooperative synthetic call and aborts its signal',async()=>{const h=fixture({timeoutMs:15,summarize:()=>new Promise(()=>{})});await assert.rejects(h.run());assert.equal(h.calls(),1);assert.equal(h.inputs[0].signal.aborted,true);});
test('concurrent synthetic checks never issue a second model request',async()=>{let release,entered;const held=new Promise(r=>{release=r;}),started=new Promise(r=>{entered=r;});const h=fixture({summarize:async()=>{entered();await held;return{changes:[],blockers:[],nextSteps:[]};}});const p=h.run();await started;await assert.rejects(h.run());assert.equal(h.calls(),1);release();await p;});
test('synthetic check exposes bounded token counters without model or provider content',async()=>{
 const counters={attempts:[{attempt:1,requestedMaxTokens:6000,preparedMaxTokens:6000,reasoningEffort:'low',finish:'max-tokens',textChars:0,reasoningChars:12000,outputTokens:6000,reasoningTokens:null}]};
 const h=fixture({summarize:async()=>{throw Object.assign(Error('PRIVATE_MODEL'),{code:'MODEL_TOKEN_LIMIT',modelRunDiagnostic:{...counters,raw:'PRIVATE_BODY'}});}});
 const result=await h.run();assert.deepEqual(result,{summaryAvailable:false,synthetic:true,code:'MODEL_TOKEN_LIMIT',modelRunDiagnostic:counters});assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
});
test('synthetic probe identifies inactive original Owner without asking for account authorization or activating it',async()=>{
 const h=fixture({owner:false});await assert.rejects(h.run(),{code:'SUMMARY_PROBE_UNAVAILABLE',summaryProbeStage:'owner_unavailable'});assert.equal(h.calls(),0);assert.equal(h.restores(),0);
 let endpoint;registerContextRoute({get:()=>({fetch:{register:spec=>{endpoint=spec;}}})},h.route);
 const response=await endpoint.fetch(new Request('http://localhost/api/project_companion/context',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'check_summary',expectedBindingRevision:bindingRevision(initial)})}));
 assert.equal(response.status,409);const value=await response.json();assert.equal(value.stage,'owner_unavailable');assert.match(value.error,/原.*会话/);assert.doesNotMatch(value.error,/登录|扫码|PRIVATE|synthetic-owner/);assert.equal(h.restores(),0);
 for(const [change,stage]of[['pause','paused'],['change','binding_changed']]){const h=fixture();h[change]();await assert.rejects(h.run(),{code:'SUMMARY_PROBE_UNAVAILABLE',summaryProbeStage:stage});assert.equal(h.calls(),0);}
});
function sharedFixture(){
 const scope={familySessionId:'family_owner_probe',bindingRevision:'b'.repeat(64),originSessionId:initial.sessionId,originBindingKey:initial.bindingKey,leaseFingerprint:'c'.repeat(64)};
 let current=true,wrongNative=false,live=true,paused=false,models=0,activations=0,privateReads=0;const owners=[],inputs=[];
 const readSummaryConnection=createFamilyWorkbenchConnection({isEnabled:()=>true,readLegacyConnection:async()=>assert.fail('paired Family must not fall back'),delegation:{isUnpaired:()=>false,registeredSessionId:()=>scope.familySessionId,scopeFor:()=>scope,current:()=>current,recheck:async()=>current,routeState:()=> 'current'},readNativeRoute:async()=>({kind:'bound',binding:{userHash:wrongNative?'e'.repeat(64):scope.bindingRevision,botHash:createHash('sha256').update('family-dot:'+scope.bindingRevision).digest('hex')}})});
 const forbidden=()=>{privateReads++;assert.fail('probe must not read or authorize private sources');};
 const route=createContextRoute({context:{snapshot:async owner=>{owners.push(owner.sessionId);return{sources:[]};},act:forbidden,authorization:forbidden},readConnection:async()=>initial,readSummaryConnection,resolveOwner:sessionId=>live&&sessionId===scope.familySessionId?{sessionId,cwd:'/synthetic/family'}:null,activateOwner:async()=>{activations++;},canRun:async()=>!paused,summarizeSynthetic:async input=>{models++;inputs.push(input);return{changes:[],blockers:[],nextSteps:[]};}});
 return{route,inputs,owners,counts:()=>({models,activations,privateReads}),revision:async()=>bindingRevision(await readSummaryConnection()),change:()=>{current=false;},wrong:()=>{wrongNative=true;},offline:()=>{live=false;},pause:()=>{paused=true;}};
}
test('paired summary probe uses exact Family route while source account snapshot keeps legacy scope',async()=>{
 const h=sharedFixture(),snapshot=await h.route.snapshot();assert.equal(snapshot.bindingRevision,bindingRevision(initial));assert.equal(snapshot.summaryBindingRevision,await h.revision());assert.notEqual(snapshot.bindingRevision,snapshot.summaryBindingRevision);assert.deepEqual(h.owners,[initial.sessionId]);
 const result=await h.route.action({action:'check_summary',expectedBindingRevision:snapshot.summaryBindingRevision});assert.equal(result.summaryAvailable,true);assert.deepEqual(h.counts(),{models:1,activations:0,privateReads:0});
 await assert.rejects(h.route.action({action:'connect',source:'flomo',expectedBindingRevision:snapshot.summaryBindingRevision}));assert.equal(h.counts().privateReads,0);
 const standalone=fixture(),standaloneSnapshot=await standalone.route.snapshot();assert.equal(standaloneSnapshot.bindingRevision,standaloneSnapshot.summaryBindingRevision);
});
test('Family summary rejects wrong native owner revoked route stale revision unavailable owner and pause',async()=>{
 for(const mutation of ['wrong','change','offline','pause','legacyRevision']){
  const h=sharedFixture(),expectedBindingRevision=await h.revision();if(mutation!=='legacyRevision')h[mutation]();
  await assert.rejects(h.route.action({action:'check_summary',expectedBindingRevision:mutation==='legacyRevision'?bindingRevision(initial):expectedBindingRevision}));assert.deepEqual(h.counts(),{models:0,activations:0,privateReads:0});
 }
});
test('complex probe preset is fixed five-source material with bounded synthetic project history',async()=>{
 const h=sharedFixture(),expectedBindingRevision=await h.revision();await h.route.action({action:'check_summary',expectedBindingRevision,preset:'five_source_complex'});
 const input=h.inputs[0];assert.equal(input.project.label,'合成五来源项目');assert.ok(input.sources.length>10);assert.ok(input.sources.find(s=>s.label==='progress.md').text.length>4000);assert.ok(input.sources.some(s=>s.sourceId==='coverage:probe-gmail'&&s.status==='unavailable'));
 for(const source of ['calendar','drive','flomo','dida'])assert.ok(input.sources.some(s=>s.sourceId.includes('probe-'+source)));
 assert.equal(input.previous,null);assert.doesNotMatch(JSON.stringify(input),/PRIVATE|experts@|finvo|真实账号/);assert.deepEqual(h.counts(),{models:1,activations:0,privateReads:0});
 for(const extra of [{preset:'private'},{preset:'five_source_complex',text:'PRIVATE'},{preset:'basic',sources:[]},{preset:null},{preset:'five_source_complex',model:'other'}])await assert.rejects(h.route.action({action:'check_summary',expectedBindingRevision,...extra}));
 assert.equal(h.counts().models,1);
});
test('late changed binding error does not claim the model was never called',async()=>{
 let h;h=fixture({summarize:async()=>{h.change();return{changes:[],blockers:[],nextSteps:[]};}});
 let endpoint;registerContextRoute({get:()=>({fetch:{register:spec=>{endpoint=spec;}}})},h.route);
 const response=await endpoint.fetch(new Request('http://localhost/api/project_companion/context',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'check_summary',expectedBindingRevision:bindingRevision(initial)})}));
 assert.equal(response.status,409);assert.equal(h.calls(),1);const result=await response.json();assert.equal(result.stage,'binding_changed');assert.doesNotMatch(result.error,/未调用模型/);
});
