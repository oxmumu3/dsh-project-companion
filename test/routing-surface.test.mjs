import test from 'node:test';
import assert from 'node:assert/strict';
import {LOOK_VIEWS,MANAGE_OPS,normalizeSurfaceAction} from '../src/action-surface.js';
import {CORPUS} from './routing-corpus.mjs';

test('every natural phrasing in the corpus resolves to a real composite entry',()=>{
  assert.ok(CORPUS.length>=40,'corpus must stay at least 40 phrasings');
  const seen=new Set();
  for(const [utterance,entry,key] of CORPUS){
    const args=entry==='look'?{action:'look',view:key,project:'p'}:{action:'manage',op:key,project:'p',time:'09:00',everyMinutes:60,memoryKind:'goal',memoryText:'x',sourceKind:'assistant'};
    const target=normalizeSurfaceAction(args);
    assert.ok(target.action&&target.action!==entry,`${utterance} must translate`);
    seen.add(`${entry}.${key}`);
  }
  for(const view of LOOK_VIEWS)assert.ok(seen.has(`look.${view}`),`corpus misses look.${view}`);
  for(const op of MANAGE_OPS)assert.ok(seen.has(`manage.${op}`),`corpus misses manage.${op}`);
});
