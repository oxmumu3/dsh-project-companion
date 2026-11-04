import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizeSurfaceAction,LOOK_VIEWS,MANAGE_OPS,SURFACE_COPY} from '../src/action-surface.js';

const source=await readFile(new URL('../index.js',import.meta.url),'utf8');
function enumOf(tool){
  const at=source.indexOf(`name:'${tool}',\n    description:'`);
  assert.ok(at>0,tool);
  const match=/action:\{type:'string',required:true,enum:\[([^\]]*)\]/.exec(source.slice(at,at+8000));
  assert.ok(match,`${tool} action enum`);
  return match[1].split(',').map(value=>value.trim().replace(/^'|'$/g,'')).filter(Boolean);
}
const TOOLS=enumOf('project_companion');

// The composite entries must only ever translate into actions that the tool
// actually declares; a typo here would ship a call that the schema rejects.
test('every composite view and op translates into a declared legacy action',()=>{
  for(const view of LOOK_VIEWS){
    const target=normalizeSurfaceAction({action:'look',view,project:'/synthetic/p'});
    assert.ok(TOOLS.includes(target.action),`look.${view} -> ${target.action} must be declared`);
  }
  for(const op of MANAGE_OPS){
    const target=normalizeSurfaceAction({action:'manage',op,project:'/synthetic/p',time:'09:00',everyMinutes:60,memoryKind:'goal',memoryText:'x',sourceKind:'assistant'});
    assert.ok(TOOLS.includes(target.action),`manage.${op} -> ${target.action} must be declared`);
  }
  assert.ok(TOOLS.includes('look')&&TOOLS.includes('manage'),'both entries stay declared');
});

test('look views keep the parameters the legacy handlers already rely on',()=>{
  assert.deepEqual(normalizeSurfaceAction({action:'look',view:'progress',project:'p',detail:'analysis'}),
    {action:'digest',project:'p',detail:'analysis'});
  assert.equal(normalizeSurfaceAction({action:'look',view:'progress',project:'p'}).detail,undefined);
  assert.deepEqual(normalizeSurfaceAction({action:'look',view:'task',id:'job-1'}),{action:'task_status',id:'job-1'});
  assert.deepEqual(normalizeSurfaceAction({action:'look',view:'status'}),{action:'status'});
});

// project_update is gated on the user asking; the composite must not widen it.
test('look.change never invents the user request flag',()=>{
  assert.equal(normalizeSurfaceAction({action:'look',view:'change',project:'p'}).userRequested,false);
  assert.equal(normalizeSurfaceAction({action:'look',view:'change',project:'p',userRequested:true}).userRequested,true);
});

test('manage ops keep authorization flags exactly as the caller passed them',()=>{
  const remember=normalizeSurfaceAction({action:'manage',op:'remember',project:'p',memoryKind:'decision',memoryText:'t',sourceKind:'user'});
  assert.deepEqual(remember,{action:'remember',project:'p',memoryKind:'decision',memoryText:'t',sourceKind:'user',userRequested:false});
  const correct=normalizeSurfaceAction({action:'manage',op:'correct_memory',project:'p',memoryId:'m',memoryText:'t',userRequested:true});
  assert.equal(correct.action,'correct_memory');
  assert.equal(correct.userRequested,true);
  const daily=normalizeSurfaceAction({action:'manage',op:'daily',time:'09:10',timeZone:'America/Mexico_City'});
  assert.deepEqual(daily,{action:'configure_daily',time:'09:10',timeZone:'America/Mexico_City'});
});

test('a malformed composite fails loudly instead of guessing',()=>{
  assert.throws(()=>normalizeSurfaceAction({action:'look'}),/look 需要 view/);
  assert.throws(()=>normalizeSurfaceAction({action:'look',view:'nope'}),/look 需要 view/);
  assert.throws(()=>normalizeSurfaceAction({action:'manage',op:'nope'}),/manage 需要 op/);
  assert.equal(normalizeSurfaceAction({action:'digest',project:'p'}).action,'digest','legacy names pass through untouched');
});

test('the tool description teaches both entries and every discriminator',()=>{
  const at=source.indexOf("name:'project_companion',\n    description:'");
  const description=/description:'([^']*)'/.exec(source.slice(at,at+4000))[1];
  assert.match(description,/look/);
  assert.match(description,/manage/);
  for(const view of LOOK_VIEWS)assert.ok(description.includes(view),`description must name view ${view}`);
  for(const op of MANAGE_OPS)assert.ok(description.includes(op),`description must name op ${op}`);
  assert.equal(Object.keys(SURFACE_COPY).sort().join(','),'look,manage');
});
