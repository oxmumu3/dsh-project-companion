import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createService} from '../src/service.js';

async function fixture(t){
  const api=await import('../src/onboarding.js');
  const root=await realpath(await mkdtemp(join(tmpdir(),'dot-onboarding-')));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const roots=[join(root,'public-a'),join(root,'public-b')];
  for(const p of roots){await mkdir(p);await writeFile(join(p,'README.md'),'SYNTHETIC public source');}
  const known=roots.map((root,i)=>({root,label:`项目${i+1}`,sessionIds:[]}));
  let serviceRow,setupRow,writes=0,connection={state:'bound',sessionId:'source',bindingKey:'a'.repeat(64)},status='idle';
  const accepted=[];
  const service=createService({store:{get:async()=>serviceRow,put:async(_k,v)=>{serviceRow=structuredClone(v);}},discover:()=>known});
  await service.ready();
  const setup=api.createOnboarding({service,store:{get:async()=>setupRow,put:async(_k,v)=>{writes++;setupRow=structuredClone(v);}},
    readConnection:async()=>structuredClone(connection),discoverProjects:()=>known,
    resolveOwner:sessionId=>({sessionId,cwd:roots[0],status}),
    admitWelcome:request=>{accepted.push(request);return{accepted:true};}});
  return{api,setup,service,roots,known,accepted,writes:()=>writes,row:()=>setupRow,connection:v=>{connection=v;},status:v=>{status=v;}};
}

function coldSetup(h,activate,initialRow){
  let live=false,row=initialRow,connection={state:'bound',sessionId:'source',bindingKey:'a'.repeat(64)};
  const activations=[],accepted=[];
  const controls={live:value=>{live=value;},connection:value=>{connection=value;}};
  const setup=h.api.createOnboarding({service:h.service,store:{get:async()=>row,put:async(_k,value)=>{row=structuredClone(value);}},discoverProjects:()=>h.known,
    readConnection:async()=>structuredClone(connection),resolveOwner:sessionId=>live?{sessionId,cwd:h.roots[0],status:'idle'}:null,
    activateOwner:async sessionId=>{activations.push(sessionId);if(activate)await activate(controls);else live=true;},admitWelcome:request=>{accepted.push(request);return{accepted:true};}});
  return{setup,activations,accepted,...controls};
}

test('cold bound source activates only for explicit valid actions and previews without manual navigation',async t=>{
  const h=await fixture(t),c=coldSetup(h);const before=await c.setup.snapshot();
  assert.equal(before.connection.state,'bound');assert.equal(c.activations.length,0);assert.equal(c.accepted.length,0);
  await assert.rejects(c.setup.action({action:'select_projects',projectIds:['not-known']}));assert.equal(c.activations.length,0);
  const selected=await c.setup.action({action:'select_projects',projectIds:[before.projects[0].id]});
  assert.deepEqual(c.activations,['source']);assert.match(selected.firstBrief,/SYNTHETIC/);assert.equal(selected.projects.filter(p=>p.watched).length,1);assert.equal(c.accepted.length,0);
  c.live(false);const completed=await c.setup.action({action:'complete'});assert.equal(completed.welcome.status,'accepted');assert.deepEqual(c.activations,['source','source']);assert.equal(c.accepted.length,1);
  c.live(false);await c.setup.action({action:'complete'});assert.equal(c.activations.length,2);assert.equal(c.accepted.length,1,'accepted welcome must not resume or resend');
});

test('binding change during source activation stops selection and welcome before side effects',async t=>{
  for(const action of ['select_projects','complete']){
    const h=await fixture(t);
    if(action==='complete')await h.service.act({sessionId:'source',cwd:h.roots[0]},{action:'watch',project:h.roots[0]});
    const c=coldSetup(h,async controls=>{controls.live(true);controls.connection({state:'bound',sessionId:'source',bindingKey:'b'.repeat(64)});});const before=await c.setup.snapshot();
    await assert.rejects(c.setup.action(action==='complete'?{action}:{action,projectIds:[before.projects[1].id]}),/变化/);
    assert.deepEqual(c.activations,['source']);assert.equal(c.accepted.length,0);assert.equal((await h.service.watchedProjects()).length,action==='complete'?1:0);
  }
});

test('source activation failure does not watch projects, persist welcome or admit model work',async t=>{
  const h=await fixture(t),c=coldSetup(h,async()=>{throw new Error('SYNTHETIC activation failure');});const before=await c.setup.snapshot();
  await assert.rejects(c.setup.action({action:'select_projects',projectIds:[before.projects[0].id]}));
  assert.deepEqual(c.activations,['source']);
  assert.equal((await h.service.watchedProjects()).length,0);assert.equal(c.accepted.length,0);
  assert.equal((await c.setup.snapshot()).welcome,undefined);
});

test('uncertain welcome on a cold source remains uncertain without activation or resubmission',async t=>{
  const h=await fixture(t),c=coldSetup(h,()=>assert.fail('unknown welcome must not resume'),{id:'profile',version:1,completed:false,welcomeStatus:'unknown',sessionId:'source',bindingKey:'a'.repeat(64),messageId:'existing-message'});
  assert.equal((await c.setup.snapshot()).welcome.status,'unknown');
  assert.equal((await c.setup.action({action:'complete'})).welcome.status,'unknown');assert.equal(c.activations.length,0);assert.equal(c.accepted.length,0);
  c.connection({state:'unknown'});await assert.rejects(c.setup.action({action:'complete'}));assert.equal(c.activations.length,0);
});

test('an activation result that never publishes the exact source cannot use a fallback owner',async t=>{
  const h=await fixture(t),c=coldSetup(h,async()=>{});const before=await c.setup.snapshot();
  await assert.rejects(c.setup.action({action:'select_projects',projectIds:[before.projects[0].id]}),/尚未准备/);
  assert.deepEqual(c.activations,['source']);assert.equal((await h.service.watchedProjects()).length,0);assert.equal(c.accepted.length,0);
});

test('closing during source activation prevents any later watch or welcome admission',async t=>{
  const h=await fixture(t);let entered,release;
  const started=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});
  const c=coldSetup(h,async controls=>{entered();await gate;controls.live(true);});const before=await c.setup.snapshot();
  const action=c.setup.action({action:'select_projects',projectIds:[before.projects[0].id]});await Promise.race([started,action]);const closing=c.setup.close();release();await assert.rejects(action,/变化|关闭/);await closing;
  assert.equal((await h.service.watchedProjects()).length,0);assert.equal(c.accepted.length,0);
});

test('onboarding snapshot is passive and exposes no path, user identity or binding key',async t=>{
  const h=await fixture(t);const s=await h.setup.snapshot();
  assert.equal(s.connection.state,'bound');assert.equal(s.projects.length,2);
  assert.equal(h.writes(),0);assert.equal((await h.service.watchedProjects()).length,0);assert.equal(h.accepted.length,0);
  const text=JSON.stringify(s);assert.ok(!text.includes(h.roots[0]));assert.ok(!text.includes('bindingKey'));assert.ok(!text.includes('userId'));
});
test('onboarding selection is explicit, additive, bounded and rejects unknown ids before writes',async t=>{
  const h=await fixture(t);const s=await h.setup.snapshot();
  await assert.rejects(h.setup.action({action:'select_projects',projectIds:[s.projects[0].id,'missing']}));
  assert.equal((await h.service.watchedProjects()).length,0);
  const first=await h.setup.action({action:'select_projects',projectIds:[s.projects[0].id]});
  assert.match(first.firstBrief,/SYNTHETIC/);assert.equal(first.projects.filter(p=>p.watched).length,1);
  const second=await h.setup.action({action:'select_projects',projectIds:[s.projects[1].id]});
  assert.equal(second.projects.filter(p=>p.watched).length,2);assert.equal(h.accepted.length,0);
  assert.equal((await h.service.act({sessionId:'source',cwd:h.roots[0]},{action:'status'})).daily,null);
});
test('onboarding completion admits one exact-session initial brief and repeated clicks do not resend',async t=>{
  const h=await fixture(t);const s=await h.setup.snapshot();
  await h.setup.action({action:'select_projects',projectIds:[s.projects[0].id]});
  const [a,b]=await Promise.all([h.setup.action({action:'complete'}),h.setup.action({action:'complete'})]);
  assert.equal(a.welcome.status,'accepted');assert.equal(b.welcome.status,'accepted');assert.equal(h.accepted.length,1);
  assert.equal(h.accepted[0].sessionId,'source');assert.equal(a.completed,true);
  assert.match(JSON.stringify(h.accepted[0].message),/首份|第一份/);
  assert.doesNotMatch(JSON.stringify(h.accepted[0].message),/configure_daily/);
});
test('onboarding refuses ambiguous binding, busy source, excess keys and implicit schedules',async t=>{
  const h=await fixture(t);const s=await h.setup.snapshot();
  await h.setup.action({action:'select_projects',projectIds:[s.projects[0].id]});
  h.status('running');assert.equal((await h.setup.action({action:'complete'})).welcome.status,'blocked');assert.equal(h.writes(),0);
  h.status('idle');h.connection({state:'unknown'});
  await assert.rejects(h.setup.action({action:'select_projects',projectIds:[s.projects[1].id]}));
  await assert.rejects(h.setup.action({action:'complete',daily:'09:00'}));assert.equal(h.accepted.length,0);
});
test('onboarding uncertain admission is persisted and never automatically retried',async t=>{
  const h=await fixture(t);const s=await h.setup.snapshot();
  await h.setup.action({action:'select_projects',projectIds:[s.projects[0].id]});
  const options={service:h.service,store:{get:async()=>h.row(),put:async()=>{}},readConnection:async()=>({state:'bound',sessionId:'source',bindingKey:'a'.repeat(64)}),discoverProjects:()=>h.known,resolveOwner:()=>({sessionId:'source',cwd:h.roots[0],status:'idle'}),admitWelcome:()=>{throw new Error('SYNTHETIC uncertainty');}};
  const setup=h.api.createOnboarding(options);
  assert.equal((await setup.action({action:'complete'})).welcome.status,'unknown');
  assert.equal((await setup.action({action:'complete'})).welcome.status,'unknown');assert.equal(h.accepted.length,0);
});
test('onboarding HTTP registration uses only owner authenticated connection fetch and disposes',async t=>{
  const h=await fixture(t);let route;let disposed=false;
  const ctx={get:key=>key==='connection'?{fetch:{register:r=>{route=r;return()=>{disposed=true;};}}}:undefined};
  const stop=h.api.registerOnboardingRoute(ctx,h.setup);assert.equal(route.path,'/api/project_companion/onboarding');
  assert.deepEqual(route.methods,['GET','POST']);
  const response=await route.fetch(new Request('http://localhost/api/project_companion/onboarding'));
  assert.equal(response.status,200);assert.equal((await response.json()).connection.state,'bound');
  assert.equal((await route.fetch(new Request('http://localhost/api/project_companion/onboarding',{method:'POST',headers:{'Content-Type':'text/plain'},body:'{}'}))).status,415);
  stop();assert.equal(disposed,true);assert.equal(h.api.registerOnboardingRoute({get:()=>undefined},h.setup),null);
});

test('changed binding during selection is refused before a new project is watched',async t=>{
  const h=await fixture(t);let reads=0;
  const setup=h.api.createOnboarding({service:h.service,store:{get:async()=>undefined,put:async()=>{}},discoverProjects:()=>h.known,
    readConnection:async()=>({state:'bound',sessionId:'source',bindingKey:(reads++===0?'a':'b').repeat(64)}),resolveOwner:()=>({sessionId:'source',cwd:h.roots[0],status:'idle'}),admitWelcome:()=>assert.fail('must not admit')});
  const id=(await h.setup.snapshot()).projects[0].id;
  await assert.rejects(setup.action({action:'select_projects',projectIds:[id]}),/变化/);
  assert.equal((await h.service.watchedProjects()).length,0);
});

test('closing while welcome intent is persisted prevents later admission',async t=>{
  const h=await fixture(t);const first=await h.setup.snapshot();await h.setup.action({action:'select_projects',projectIds:[first.projects[0].id]});
  let entered,release;const waiting=new Promise(resolve=>{entered=resolve;});const gate=new Promise(resolve=>{release=resolve;});let puts=0;
  const setup=h.api.createOnboarding({service:h.service,store:{get:async()=>undefined,put:async()=>{if(puts++===0){entered();await gate;}}},discoverProjects:()=>h.known,
    readConnection:async()=>({state:'bound',sessionId:'source',bindingKey:'a'.repeat(64)}),resolveOwner:()=>({sessionId:'source',cwd:h.roots[0],status:'idle'}),admitWelcome:()=>assert.fail('closing must not admit')});
  const action=setup.action({action:'complete'});await waiting;const closing=setup.close();release();await assert.rejects(action,/关闭/);await closing;
});
