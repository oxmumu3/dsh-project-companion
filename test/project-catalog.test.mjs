import test from 'node:test';
import assert from 'node:assert/strict';

async function api(){const m=await import('../src/project-catalog.js').catch(()=>({}));assert.equal(typeof m.createProjectCatalog,'function','pure registered project catalog must exist');return m;}
const rows=n=>Array.from({length:n},(_,i)=>({id:`workspace-${i}`,path:`/SYNTHETIC-NOT-ON-DISK/group-${i%3}/project-${i}`,title:`项目 ${i}`,sessionIds:[`session-${i}`]}));
async function fixture(n=137){const m=await api();let current=rows(n),watched=[];const c=m.createProjectCatalog({readRegistered:()=>current,readWatched:async()=>watched});return{m,c,set:v=>{current=v;},watch:v=>{watched=v;},rows:()=>current};}

test('all 137 registered projects are paginated without filesystem reads or a 100-row cut',async()=>{
 const f=await fixture(),seen=[];let offset=0,revision;
 do{const page=await f.c.page({offset,...(revision?{expectedRevision:revision}:{})});revision=page.revision;assert.equal(page.total,137);assert.equal(page.matchedTotal,137);assert.ok(page.items.length<=20);assert.equal(page.complete,true);assert.equal(page.scope,'registered');assert.equal(JSON.stringify(page).includes('/SYNTHETIC-NOT-ON-DISK'),false);seen.push(...page.items.map(x=>x.id));offset=page.nextOffset;}while(offset!==null);
 assert.equal(seen.length,137);assert.equal(new Set(seen).size,137);
 const found=await f.c.page({query:'项目 136'});assert.equal(found.items.length,1);assert.equal(found.total,137);assert.equal(found.items[0].label,'项目 136');assert.equal(found.hasMore,false);assert.equal(found.nextOffset,null);
});
test('literal normalized search is bounded and does not interpret regular expressions',async()=>{
 const f=await fixture(3);f.set([{id:'one',path:'/SYNTHETIC-NOT-ON-DISK/a',title:'ＡＩ [Plan]',sessionIds:[]}]);
 assert.equal((await f.c.page({query:'ai ['})).matchedTotal,1);assert.equal((await f.c.page({query:'.*'})).matchedTotal,0);
 for(const args of [{limit:0},{limit:51},{offset:-1},{offset:1.2},{query:'a'.repeat(81)},{query:1},{expectedRevision:'bad'},{unexpected:true}])await assert.rejects(f.c.page(args),/CATALOG_ARGUMENT/);
});
test('directory revision detects reorder, rename and removal between pages',async()=>{
 for(const alter of [v=>v.reverse(),v=>{v[0]={...v[0],title:'changed'};return v;},v=>v.slice(1)]){const f=await fixture(25),p=await f.c.page();f.set(alter([...f.rows()]));await assert.rejects(f.c.page({offset:20,expectedRevision:p.revision}),e=>e.code==='CATALOG_CHANGED');}
});
test('same labels remain distinct and ambiguous references are never guessed',async()=>{
 const f=await fixture(0);f.set([{id:'a',path:'/SYNTHETIC-NOT-ON-DISK/red/app',title:'同名项目',sessionIds:['s-a']},{id:'b',path:'/SYNTHETIC-NOT-ON-DISK/blue/app',title:'同名项目',sessionIds:['s-b']}]);
 const p=await f.c.page();assert.equal(p.items.length,2);assert.notEqual(p.items[0].id,p.items[1].id);assert.deepEqual(p.items.map(x=>x.disambiguator),['red','blue']);assert.throws(()=>f.c.registeredProjectTarget('同名项目'),e=>e.code==='CATALOG_AMBIGUOUS');
 assert.equal(f.c.registeredProjectTarget(p.items[1].id).workspaceId,'b');
});
test('opaque public id resolves only against fresh registered metadata and explicit revision',async()=>{
 const f=await fixture(3),p=await f.c.page();const selected=f.c.resolvePublicId({projectId:p.items[2].id,expectedRevision:p.revision});assert.equal(selected.root,f.rows()[2].path);
 f.set(f.rows().slice(0,2));assert.throws(()=>f.c.resolvePublicId({projectId:p.items[2].id,expectedRevision:p.revision}),e=>e.code==='CATALOG_CHANGED');assert.equal(f.c.registeredProjectTarget('/never-registered'),null);
});
test('conflicting registration ids or roots fail closed, exact duplicates deduplicate',async()=>{
 const f=await fixture(1),a=f.rows()[0];f.set([a,{...a}]);assert.equal((await f.c.page()).total,1);
 for(const bad of [[a,{...a,id:'other'}],[a,{...a,path:'/SYNTHETIC-NOT-ON-DISK/other'}],[{...a,path:'relative'}]]){f.set(bad);await assert.rejects(f.c.page(),e=>e.code==='CATALOG_UNAVAILABLE');}
});
test('five watched slots do not hide other registered projects or grant follow-up',async()=>{
 const f=await fixture(137);f.watch(f.rows().slice(0,5).map(p=>({root:p.path})));const p=await f.c.page({query:'136'});assert.equal(p.watchedCount,5);assert.equal(p.watchLimit,5);assert.equal(p.items[0].watched,false);assert.equal(p.items[0].registered,true);assert.equal(f.c.registeredProjectTarget(p.items[0].id).root,f.rows()[136].path);
});
test('synchronous registered coordination target check detects removal and membership change',async()=>{
 const f=await fixture(2);const target=f.c.registeredProjectTarget('项目 1');const scope={workspaceId:target.workspaceId,projectRoot:target.root,sessionId:'session-1'};assert.equal(f.c.authorizeRegisteredCoordinationSync(scope),true);
 f.set(f.rows().map(p=>p.id==='workspace-1'?{...p,sessionIds:[]}:p));assert.equal(f.c.authorizeRegisteredCoordinationSync(scope),false);f.set([]);assert.equal(f.c.authorizeRegisteredCoordinationSync(scope),false);
});
test('empty confirmed registry differs from unavailable registry and closed catalog',async()=>{
 const {createProjectCatalog}=await api();assert.equal((await createProjectCatalog({readRegistered:()=>[]}).page()).total,0);
 for(const readRegistered of [()=>null,()=>{throw new Error('PRIVATE ERROR');}])await assert.rejects(createProjectCatalog({readRegistered}).page(),e=>e.code==='CATALOG_UNAVAILABLE'&&!e.message.includes('PRIVATE'));
 await assert.rejects(createProjectCatalog({readRegistered:()=>[],isClosed:()=>true}).page(),e=>e.code==='CATALOG_UNAVAILABLE');
});
