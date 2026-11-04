import test from 'node:test';
import assert from 'node:assert/strict';
import {createGoalBoardModel} from '../src/goal-board-model.js';
import {validateGoalBoardResult} from '../src/goal-board-store.js';
const fragments=['s1','s2'].map((sessionId,i)=>({id:String(i),workspaceId:'w',workspaceLabel:'合成',sessionId,kind:'user',reference:'message:'+i,text:'合成资料',at:null,truncated:false}));
const valid={groups:[{key:'goal',projectId:null,title:'目标',goal:'合成目标',evidenceIds:['0','1'],lane:'mine',progress:null,nextStep:null}],standaloneIds:[],uncertainIds:[]};
function fixture(outputs,{usage={outputTokens:100,reasoningTokens:50}}={}){const calls=[],configs=[];const llm={async prepareCall(config){configs.push(config);return{config,stream(request){calls.push(request);const output=outputs[Math.min(calls.length-1,outputs.length-1)];return(async function*(){yield{type:'block-end',index:0,block:{type:'text',text:typeof output==='string'?output:JSON.stringify(output)}};if(usage)yield{type:'usage',usage};yield{type:'finish',reason:{kind:'stop'}};})();}};}};const model=createGoalBoardModel({get:name=>name==='llm'?llm:{currentSelection:()=>({provider:'synthetic',model:'configured'})}});return{model,calls,configs,llm};}
test('validation exposes only closed failure rules rather than source or rejected model text',()=>{
 for(const[output,rule]of [[{...valid,private:'PRIVATE_REJECTED'},'shape'],[{...valid,groups:[{...valid.groups[0],title:'x'.repeat(121)}]},'text_limit'],[{groups:[],standaloneIds:['0'],uncertainIds:[]},'partition_missing'],[{...valid,standaloneIds:['0']},'partition_duplicate'],[{...valid,standaloneIds:['foreign']},'partition_unknown'],[{...valid,groups:[{...valid.groups[0],evidenceIds:['0']}],standaloneIds:['1']},'new_project_support']])assert.throws(()=>validateGoalBoardResult(output,fragments,[]),error=>error.code==='MODEL_INVALID_OUTPUT'&&error.goalOutputRule===rule&&!error.message.includes('PRIVATE'));
});
test('one formatting correction uses identical immutable evidence and remaining original 8000-token budget',async()=>{
 for(const bad of ['PRIVATE_REJECTED_INVALID_JSON',{...valid,groups:[{...valid.groups[0],title:'x'.repeat(121)}]},{groups:[],standaloneIds:['0'],uncertainIds:[]}]){const f=fixture([bad,valid]);try{assert.deepEqual(await f.model.recognize({fragments}),valid);assert.deepEqual(f.configs.map(c=>c.maxTokens),[8000,7850]);assert.equal(f.calls.length,2);assert.equal(f.calls[0].messages[0].content[0].text,f.calls[1].messages[0].content[0].text);assert.doesNotMatch(f.calls[1].system,/PRIVATE_REJECTED/);}finally{f.model.close();}}
});
test('unknown accounting cannot authorize correction and a second invalid output is terminal with its closed rule',async()=>{
 const f=fixture(['INVALID_JSON',valid],{usage:null});try{await assert.rejects(f.model.recognize({fragments}),error=>error.code==='MODEL_INVALID_OUTPUT'&&error.goalOutputRule==='json');assert.equal(f.calls.length,1);}finally{f.model.close();}
 const g=fixture(['INVALID_JSON',{groups:[],standaloneIds:['0'],uncertainIds:[]}]);try{await assert.rejects(g.model.recognize({fragments}),error=>error.code==='MODEL_INVALID_OUTPUT'&&error.goalOutputRule==='partition_missing');assert.equal(g.calls.length,2);}finally{g.model.close();}
});
test('authorization is rechecked after correction provider preparation before another source transmission',async()=>{
 const f=fixture(['INVALID_JSON',valid]);let allowed=true;const prepare=f.llm.prepareCall;f.llm.prepareCall=async(...args)=>{const p=await prepare(...args);if(f.configs.length===2)allowed=false;return p;};try{await assert.rejects(f.model.recognize({fragments,guard:async()=>allowed,authorizeSync:()=>allowed}),{code:'MODEL_AUTHORIZATION_CHANGED'});assert.equal(f.calls.length,1);}finally{f.model.close();}
});
test('correction is observable as a fixed stage and does not reset the original total deadline',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=fixture(['INVALID_JSON',valid]),stages=[];const prepare=f.llm.prepareCall;let prepared=0;f.llm.prepareCall=async(...args)=>{prepared++;if(prepared===2){t.mock.timers.tick(90001);await new Promise(r=>setImmediate(r));}return prepare(...args);};try{await assert.rejects(f.model.recognize({fragments,onProgress:stage=>stages.push(stage)}),{code:'MODEL_TIMEOUT'});assert.deepEqual(stages,['correcting']);assert.equal(f.calls.length,1);}finally{f.model.close();t.mock.timers.reset();}
});
