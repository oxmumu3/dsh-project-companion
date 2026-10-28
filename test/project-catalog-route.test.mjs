import test from 'node:test';
import assert from 'node:assert/strict';
import {createProjectCatalog} from '../src/project-catalog.js';

async function api(){const m=await import('../src/project-catalog-route.js').catch(()=>({}));assert.equal(typeof m.createProjectCatalogController,'function','authenticated catalog controller must exist');assert.equal(typeof m.registerProjectCatalogRoute,'function');return m;}
const binding={state:'bound',sessionId:'source',bindingKey:'a'.repeat(64)};
test('removal or pause during the last Owner check prevents any project file read',async()=>{
 const {createProjectCatalogController}=await api();
 for(const change of ['remove','pause']){
  let rows=[{id:'ws',root:'/SYNTHETIC-NOT-ON-DISK/admission',sessionIds:[]}],checks=0,paused=false,reads=0;
  const catalog=createProjectCatalog({readRegistered:()=>rows}),page=await catalog.page();
  const ctl=createProjectCatalogController({catalog,readConnection:async()=>{if(++checks===2){if(change==='remove')rows=[];else paused=true;}return binding;},isPaused:async()=>false,isPausedSync:()=>paused,readProject:async()=>{reads++;return[];}});
  await assert.rejects(ctl.action({action:'preview',projectId:page.items[0].id,expectedRevision:page.revision}));assert.equal(reads,0,change);
 }
});
async function fixture(){const m=await api();let c=binding,reads=0,previews=0;const catalog={assertCurrentRevision:()=>true,page:async()=>{reads++;return{version:1,revision:'b'.repeat(64),items:[],total:0};},resolvePublicId:()=>({root:'/SYNTHETIC-NOT-ON-DISK/a',label:'A',id:'project_'+'c'.repeat(24)})};const ctl=m.createProjectCatalogController({catalog,readConnection:async()=>c,isPausedSync:()=>false,readProject:async()=>{previews++;return[{path:'README.md',status:'ok',text:'Synthetic only',modifiedAt:'2026-10-28T00:00:00Z'}];}});return{m,ctl,catalog,set:v=>{c=v;},counts:()=>({reads,previews})};}
test('unbound or changed binding cannot list catalog or read files',async()=>{
 const f=await fixture();f.set({state:'unknown'});await assert.rejects(f.ctl.action({action:'list'}));assert.deepEqual(f.counts(),{reads:0,previews:0});
 f.set(binding);f.catalog.page=async()=>{f.set({...binding,bindingKey:'d'.repeat(64)});return{items:[]};};await assert.rejects(f.ctl.action({action:'list'}));assert.equal(f.counts().previews,0);
});
test('listing reads metadata only while explicit preview is bounded and returns no absolute root',async()=>{
 const f=await fixture();await f.ctl.action({action:'list',query:'A',offset:0,limit:20});assert.deepEqual(f.counts(),{reads:1,previews:0});
 const p=await f.ctl.action({action:'preview',projectId:'project_'+'c'.repeat(24),expectedRevision:'b'.repeat(64)});assert.equal(f.counts().previews,1);assert.equal(p.sources[0].text,'Synthetic only');assert.equal(JSON.stringify(p).includes('/SYNTHETIC-NOT-ON-DISK'),false);
});
test('catalog route requires official connection carrier and rejects unsafe transport',async()=>{
 const f=await fixture();assert.equal(f.m.registerProjectCatalogRoute({get:()=>null},f.ctl),null);let route;f.m.registerProjectCatalogRoute({get:()=>({fetch:{register:v=>{route=v;return()=>{};}}}),effect:()=>{}},f.ctl);assert.equal(route.path,'/api/project_companion/catalog');
 for(const request of [new Request('https://local/catalog',{method:'GET'}),new Request('https://local/catalog?query=private',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}),new Request('https://local/catalog',{method:'POST',body:'{}'}),new Request('https://local/catalog',{method:'POST',headers:{'Content-Type':'application/json'},body:'x'.repeat(4097)})])assert.notEqual((await route.fetch(request)).status,200);
 assert.deepEqual(f.counts(),{reads:0,previews:0});const response=await route.fetch(new Request('https://local/catalog',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"action":"list"}'}));assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');
});
test('catalog changes during the final asynchronous Owner recheck invalidate the page',async()=>{
 const {createProjectCatalogController}=await api();let rows=[{id:'synthetic-registry',root:'/SYNTHETIC-NOT-ON-DISK/final-list',sessionIds:[]}],checks=0;
 const catalog=createProjectCatalog({readRegistered:()=>rows});const ctl=createProjectCatalogController({catalog,readConnection:async()=>{if(++checks===2)rows=[];return binding;},readProject:async()=>assert.fail('list must not read files')});
 await assert.rejects(ctl.action({action:'list'}),{code:'CATALOG_CHANGED'});
});
test('preview rejects a binding change while awaiting the final pause check',async()=>{
 const {createProjectCatalogController}=await api();const catalog=createProjectCatalog({readRegistered:()=>[{id:'synthetic-registry',root:'/SYNTHETIC-NOT-ON-DISK/final-preview',sessionIds:[]}]});let c=binding,checks=0;
 const ctl=createProjectCatalogController({catalog,readConnection:async()=>c,isPausedSync:()=>false,isPaused:async()=>{if(++checks===2)c={...binding,bindingKey:'d'.repeat(64)};return false;},readProject:async()=>[{path:'README.md',status:'ok',text:'OLD_OWNER_SYNTHETIC_CONTENT'}]});const page=await catalog.page();
 await assert.rejects(ctl.action({action:'preview',projectId:page.items[0].id,expectedRevision:page.revision}));
});
test('preview synchronous pause gate catches pause changes during the final binding check',async()=>{
 const {createProjectCatalogController}=await api();const catalog=createProjectCatalog({readRegistered:()=>[{id:'synthetic-registry',root:'/SYNTHETIC-NOT-ON-DISK/final-pause',sessionIds:[]}]});let paused=false,checks=0;
 const ctl=createProjectCatalogController({catalog,readConnection:async()=>{if(++checks===3)paused=true;return binding;},isPaused:async()=>paused,isPausedSync:()=>paused,readProject:async()=>[{path:'README.md',status:'ok',text:'PAUSED_SYNTHETIC_CONTENT'}]});const page=await catalog.page();
 await assert.rejects(ctl.action({action:'preview',projectId:page.items[0].id,expectedRevision:page.revision}));
});
