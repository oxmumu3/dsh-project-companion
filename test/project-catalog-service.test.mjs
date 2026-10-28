import test from 'node:test';
import assert from 'node:assert/strict';
import {createService} from '../src/service.js';
import {createOnboarding} from '../src/onboarding.js';
import {projectPublicId,createProjectCatalog} from '../src/project-catalog.js';

async function fixture(){const known=Array.from({length:137},(_,i)=>({id:`registered-${i}`,root:`/SYNTHETIC-NOT-ON-DISK/project-${i}`,label:`项目 ${i}`,sessionIds:[`s-${i}`]}));let row;const reads=[];let writes=0;const service=createService({store:{get:async()=>row,put:async(_k,value)=>{writes++;row=structuredClone(value);}},discover:()=>known,readProject:async root=>{reads.push(root);return[{path:'README.md',status:'ok',text:'synthetic project',modifiedAt:'2026-10-28T00:00:00Z'}];}});await service.ready();return{known,service,owner:{sessionId:'s-0',cwd:known[0].root},reads,writes:()=>writes,row:()=>structuredClone(row)};}
test('legacy project list gains real pagination and search after item100 without reading files',async()=>{
 const f=await fixture(),seen=[];let offset=0,revision;
 do{const p=await f.service.act(f.owner,{action:'list',offset,limit:20,...(revision?{catalogRevision:revision}:{})});assert.equal(p.candidateCount,137);assert.ok(p.candidates.length<=20);revision=p.catalogRevision;seen.push(...p.candidates.map(x=>x.id));offset=p.nextOffset;}while(offset!==null);
 assert.equal(new Set(seen).size,137);const p=await f.service.act(f.owner,{action:'list',query:'项目 136'});assert.equal(p.candidates.length,1);assert.equal(p.matchedTotal,1);assert.equal(f.reads.length,0);assert.equal(f.writes(),0);
 assert.equal(p.complete,false);assert.equal(p.scope,'live_compatibility');
});
test('five watched projects do not prevent explicit one-off public catalog id read',async()=>{
 const f=await fixture();for(const p of f.known.slice(0,5))await f.service.act(f.owner,{action:'watch',project:p.root});const before=f.row(),writes=f.writes();const result=await f.service.act(f.owner,{action:'digest',project:projectPublicId(f.known[136].root),detail:'analysis'});assert.equal(result.analysis.project.root,f.known[136].root);assert.deepEqual(f.row(),before);assert.equal(f.writes(),writes);assert.equal((await f.service.watchedProjects()).length,5);
});
test('onboarding no longer hides registered projects after index100',async()=>{
 const f=await fixture();const onboarding=createOnboarding({service:f.service,store:{get:async()=>null,put:async()=>assert.fail('snapshot must not persist')},readConnection:async()=>({state:'bound',sessionId:'s-0',bindingKey:'a'.repeat(64)}),discoverProjects:()=>f.known,resolveOwner:()=>f.owner});const value=await onboarding.snapshot();assert.equal(value.projects.length,137);assert.equal(value.projects[136].label,'项目 136');assert.equal(f.reads.length,0);assert.equal(f.writes(),0);
});
test('service registered coordination resolution is fresh and synchronous admission enforces pause',async()=>{
 let rows=[{id:'registry-id',root:'/SYNTHETIC-NOT-ON-DISK/registered',label:'已登记',sessionIds:['synthetic-target']}];let stored;const catalog=createProjectCatalog({readRegistered:()=>rows});
 const service=createService({store:{get:async()=>stored,put:async(_k,v)=>{stored=structuredClone(v);}},catalog});await service.ready();
 const scope={workspaceId:'registry-id',projectRoot:rows[0].root,sessionId:'synthetic-target'};
 assert.equal((await service.registeredProjectTarget('已登记')).workspaceId,'registry-id');assert.equal(service.authorizeRegisteredCoordinationSync(scope),true);
 await service.act({sessionId:'owner',cwd:rows[0].root},{action:'pause'});assert.equal(service.authorizeRegisteredCoordinationSync(scope),false);
 await service.act({sessionId:'owner',cwd:rows[0].root},{action:'resume'});rows=[];assert.equal(service.authorizeRegisteredCoordinationSync(scope),false);assert.equal(await service.registeredProjectTarget('已登记'),null);
});
