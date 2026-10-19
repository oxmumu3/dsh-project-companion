/** Offline synthetic service demo. No DSH host/model, network or real WeChat. */
import {mkdtemp,mkdir,writeFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createService} from '../src/service.js';

const root=await realpath(await mkdtemp(join(tmpdir(),'companion-offline-demo-')));
try{
  const project=join(root,'synthetic-project');
  await mkdir(join(project,'.agent','memory'),{recursive:true});
  await writeFile(join(project,'README.md'),'SYNTHETIC project: prepare an example document. This is not a real user project.');
  await writeFile(join(project,'.agent','memory','progress.md'),'SYNTHETIC file record: a local outline exists; review is still needed.');
  await writeFile(join(project,'.agent','memory','context.md'),'SYNTHETIC context: show source attribution, explicit reminders and bridge queue states.');
  let persisted;
  let live=false;
  let attempts=0;
  let now=new Date('2026-10-18T15:00:00Z');
  const owner={sessionId:'SYNTHETIC_DEMO_SESSION',cwd:project};
  const service=createService({
    store:{get:async()=>structuredClone(persisted),put:async(_key,value)=>{persisted=structuredClone(value);}},
    discover:async()=>[{id:'synthetic-demo-project',root:project,label:'SYNTHETIC demo project',sessionIds:[owner.sessionId]}],
    clock:()=>now,
    readRelease:async repository=>({status:'ok',repository,tag:'SYNTHETIC_v1',publishedAt:'2026-10-17T00:00:00Z',url:'https://example.invalid/SYNTHETIC_RELEASE_NOT_FETCHED'}),
    send:async()=>{
      attempts++;
      return live?{status:'queued',detail:'SYNTHETIC fake bridge accepted; no network or real message'}:{status:'blocked',detail:'SYNTHETIC fake session is cold; no agent was created'};
    },
  });
  console.log('OFFLINE SYNTHETIC DEMO — service layer only; no real DSH/WeChat/cloud connection.');
  await service.act(owner,{action:'watch'});
  await service.record({root:project,sessionId:owner.sessionId,id:'synthetic-event-1',kind:'user',text:'SYNTHETIC request: review the outline before sharing.'});
  await service.record({root:project,sessionId:owner.sessionId,id:'synthetic-event-2',kind:'assistant',text:'SYNTHETIC assistant says the outline is ready. This is only an assistant record.'});
  await service.act(owner,{action:'link_github',repository:'example/synthetic-repo'});
  console.log((await service.act(owner,{action:'digest'})).text);
  await service.act(owner,{action:'configure_daily',time:'09:00',timeZone:'America/Mexico_City'});
  await service.tick();
  console.log('\nSYNTHETIC first tick:',(await service.act(owner,{action:'status'})).outbox[0].status);
  live=true;
  await service.tick();await service.tick();
  console.log('SYNTHETIC recovery:',(await service.act(owner,{action:'status'})).outbox[0].status,`(${attempts} fake adapter calls total; queued job not submitted again)`);
  const {reminder}=await service.act(owner,{action:'remind',dueAt:'2026-10-18T15:01:00Z',title:'SYNTHETIC reminder to cancel'});
  await service.act(owner,{action:'cancel_reminder',id:reminder.id});
  now=new Date('2026-10-18T15:01:02Z');await service.tick();
  console.log('SYNTHETIC cancellation:',(await service.act(owner,{action:'status'})).reminders[0].status);
  await service.act(owner,{action:'pause'});
  console.log('OFFLINE DEMO COMPLETE — temporary files removed; this is not a delivery or live-host proof.');
}finally{await rm(root,{recursive:true,force:true});}
