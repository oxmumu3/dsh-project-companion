import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {registerGuidance} from '../src/guidance.js';

const source=await readFile(new URL('../index.js',import.meta.url),'utf8');
const TOOLS=['project_companion','personal_review','ai_digest','personal_context'];

function slice(tool){
  // The storage domain also declares name:'project_companion'; the tool block is
  // the one followed by a model-facing description.
  const at=source.indexOf(`name:'${tool}',\n    description:'`);
  assert.ok(at>0,`${tool} must be registered as a tool in index.js`);
  return source.slice(at,at+8000);
}
function actions(tool){
  const match=/action:\{type:'string',required:true,enum:\[([^\]]*)\]/.exec(slice(tool));
  assert.ok(match,`${tool} must declare a required action enum`);
  return match[1].split(',').map(value=>value.trim().replace(/^'|'$/g,'')).filter(Boolean);
}
function description(tool){
  const match=new RegExp(`name:'${tool}',\\n    description:'((?:[^'\\\\]|\\\\.)*)'`).exec(source);
  assert.ok(match,`${tool} must keep a model-facing description`);
  return match[1];
}
function prompt(){
  let section;
  registerGuidance({systemPrompt:{section:value=>{section=value;}},tools:{get:()=>({})}},{clock:()=>new Date('2026-11-04T20:00:00Z'),hostTimeZone:()=>'America/Mexico_City'});
  assert.ok(section,'guidance section must register');
  return section.text({scope:{id:'synthetic-contract'}});
}

// Guards the 0.22.0 refactor: the prompt teaches routing, the schemas teach
// parameters, and every model-facing action has to stay discoverable in one of
// them. Without this, compression silently drops capabilities.
test('every action of every model-facing tool stays discoverable in prompt or schema',()=>{
  const text=prompt();
  const missing=[];
  for(const tool of TOOLS){
    const described=new Set([...description(tool).matchAll(/[a-z]+(?:_[a-z]+)+/g)].map(match=>match[0]));
    for(const action of actions(tool)){
      if(!text.includes(action)&&!described.has(action))missing.push(`${tool}.${action}`);
    }
  }
  assert.deepEqual(missing,[],`undiscoverable actions: ${missing.join(', ')}`);
});

test('compact guidance keeps a size budget so duplicated policy cannot creep back',()=>{
  const text=prompt();
  assert.ok(text.length<7000,`prompt is ${text.length} chars; keep routing terse`);
  assert.ok(!/gettopics|todo_write/.test(text),'guidance must not teach unrelated host tools');
});

test('guidance names the real tool surface instead of invented actions',()=>{
  const text=prompt();
  const known=new Set(TOOLS.flatMap(actions));
  // Host-owned tools and field names the prompt is allowed to mention.
  const allowed=new Set([...TOOLS,'task_status','send_wechat','proactive_reclaim','todo_write','current_session','user_requested','user_requested_flag','detail_analysis','read_only','full_access','reported_sent','api_accepted','model_output_limit','model_invalid_output','review_view_token']);
  const unknown=[...new Set([...text.matchAll(/\b([a-z]+_[a-z_]+)\b/g)].map(match=>match[1]))]
    .filter(name=>!known.has(name)&&!allowed.has(name)&&!/^model_/.test(name)&&!/^context_/.test(name));
  assert.deepEqual(unknown,[],`guidance references actions that do not exist: ${unknown.join(', ')}`);
});

test('status text reports to the user without internal ids, ISO stamps or status codes',async()=>{
  const {createService}=await import('../src/service.js');
  let saved;
  const service=createService({clock:()=>new Date('2026-11-04T20:00:00Z'),store:{get:async()=>saved,put:async(_key,value)=>{saved=structuredClone(value);}},send:async()=>({status:'reported_sent'})});
  try{
    const value=await service.act({sessionId:'synthetic-status',cwd:'/synthetic/project'},{action:'status'});
    assert.ok(!/\bp_[0-9a-f]{8}\b/.test(value.text),'no project ids');
    assert.ok(!/\br_[0-9a-f]{8}\b/.test(value.text),'no reminder ids');
    assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/.test(value.text),'no uuid ids');
    assert.ok(!/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value.text),'no ISO timestamps');
    assert.ok(!/reported_sent|queued|pending|dispatching/.test(value.text),'no raw delivery codes');
    assert.match(value.text,/项目助理/);
  }finally{await service.close?.();}
});
