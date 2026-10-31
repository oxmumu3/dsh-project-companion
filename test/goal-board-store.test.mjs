import test from 'node:test';
import assert from 'node:assert/strict';
import {goalBoardRowSchema, freshGoalBoardRow, validateGoalBoardResult} from '../src/goal-board-store.js';

const fragment=(id,sessionId)=>({id,workspaceId:'w1',workspaceLabel:'Synthetic',sessionId,kind:'user',reference:'message:1',text:'Synthetic objective discussion',at:null,truncated:false});
const group={key:'launch',projectId:null,title:'Launch',goal:'Ship a launch',evidenceIds:['a','b'],lane:'active',progress:'Discussed launch',nextStep:'Review'};
test('new strict profile is empty and rejects unknown/unbounded storage fields',()=>{
 const row=freshGoalBoardRow();assert.equal(row.id,'profile');assert.deepEqual(row.projects,[]);assert.equal(row.scan.phase,'idle');
 assert.equal(goalBoardRowSchema.safeParse(row).success,true);
 assert.equal(goalBoardRowSchema.safeParse({...row,legacyWatch:['/private']}).success,false);
 assert.equal(goalBoardRowSchema.safeParse({...row,revision:'x'.repeat(201)}).success,false);
});
test('model result must partition all and only known fragment IDs exactly once',()=>{
 const fragments=[fragment('a','s1'),fragment('b','s2')],output={groups:[group],standaloneIds:[],uncertainIds:[]};
 assert.deepEqual(validateGoalBoardResult(output,fragments,[]),output);
 for(const bad of [{...output,standaloneIds:['a']},{...output,groups:[{...group,evidenceIds:['a','unknown']}]},{...output,groups:[]},{...output,command:'run'}, {...output,groups:[{...group,projectId:'invented'}]}]) assert.throws(()=>validateGoalBoardResult(bad,fragments,[]),{code:'MODEL_INVALID_OUTPUT'});
});
test('files or one conversation cannot invent an objective; existing confirmed vision cannot be rewritten',()=>{
 const output={groups:[group],standaloneIds:[],uncertainIds:[]};
 assert.throws(()=>validateGoalBoardResult(output,[fragment('a','s1'),fragment('b','s1')],[]),{code:'MODEL_INVALID_OUTPUT'});
 assert.throws(()=>validateGoalBoardResult(output,[fragment('a',null),fragment('b',null)],[]),{code:'MODEL_INVALID_OUTPUT'});
 assert.throws(()=>validateGoalBoardResult(output,[{...fragment('a','s1'),kind:'file'},{...fragment('b','s2'),kind:'file'}],[]),{code:'MODEL_INVALID_OUTPUT'});
 const existing=[{id:'goal1',title:'Canonical',goal:'Canonical goal',state:'confirmed'}];
 assert.throws(()=>validateGoalBoardResult({...output,groups:[{...group,projectId:'goal1'}]},[fragment('a','s1'),fragment('b','s1')],existing),{code:'MODEL_INVALID_OUTPUT'});
 assert.equal(validateGoalBoardResult({...output,groups:[{...group,projectId:'goal1',title:'Canonical',goal:'Canonical goal'}]},[fragment('a','s1'),fragment('b','s1')],existing).groups.length,1);
});

test('sweep progress is paired, bounded and reconciles with committed workspace coverage',async()=>{
 const {goalScanSchema}=await import('../src/goal-board-store.js');const scan={phase:'running',at:null,coverage:[]};
 for(const invalid of [{processed:1,total:0},{processed:0},{total:1},{processed:1,total:2},{processed:0,total:1001}])assert.equal(goalScanSchema.safeParse({...scan,...invalid}).success,false);
 assert.equal(goalScanSchema.safeParse({...scan,processed:0,total:21}).success,true);
});
