import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,realpath,rm,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const now='2026-10-19T15:00:00.000Z';
const binding={state:'bound',sessionId:'original-owner',bindingKey:'a'.repeat(64)};
const project={root:'/synthetic/watched-project',label:'已关注项目',sessionIds:['project-session']};
const projectId=`project_${createHash('sha256').update(project.root).digest('hex').slice(0,24)}`;
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
async function api(){const m=await import('../src/workbench-actions.js').catch(()=>({}));assert.equal(typeof m.createWorkbenchActions,'function','owner-authenticated workbench actions must exist');assert.equal(typeof m.registerWorkbenchActionsRoute,'function');return m;}
async function fixture(extra={}){
  const {createWorkbenchActions}=await api();let connection={...binding},projects=[{...project}],paused=false,live=true;
  const calls=[];
  const recorded=args=>{const {authorizeMutation,expectedBinding,...visible}=args;return visible;};
  const followup={status:async args=>{calls.push(['status',args]);return{enabled:true,running:true,everyMinutes:30,nextDueAt:'2026-10-19T15:30:00.000Z',sessionId:binding.sessionId,bindingKey:binding.bindingKey};},onceStatus:async args=>{calls.push(['onceStatus',args]);return{enabled:false,running:false};}};
  for(const method of ['configure','cancel','checkOnce','cancelOnce'])followup[method]=async args=>{calls.push([method,recorded(args)]);return{enabled:!method.startsWith('cancel'),running:false,delivery:'wechat',nextDueAt:now};};
  const adapter=createWorkbenchActions({service:{watchedProjects:async()=>projects,isPaused:async()=>paused},memory:{revise:async args=>{calls.push(['revise',recorded(args)]);return{entry:{id:args.id,kind:'context',text:args.text,at:now,source:{kind:'user',reference:'session:original-owner'},private:'never export'}};},forget:async args=>{calls.push(['forget',recorded(args)]);return{forgotten:true};}},followup,taskResults:{status:async(sessionId,args)=>{calls.push(['task',sessionId,args]);return{jobs:[{id:args.id,projectLabel:'项目',task:'检查',status:'completed',createdAt:now,reply:`正文 ${project.root} ${binding.bindingKey} api_key=secret`,replyTruncated:false,finishedAt:now,delivery:{status:'reported_sent',detail:'通道报告已发',text:'PRIVATE'},projectRoot:project.root,returnBinding:{userHash:binding.bindingKey},targetSessionId:'PRIVATE'}]};}},readConnection:async()=>connection,resolveOwner:sessionId=>live?{sessionId,cwd:'/synthetic/dot'}:null,activateOwner:async sessionId=>{calls.push(['activate',sessionId]);live=true;},clock:()=>new Date(now),...extra});
  return{adapter,calls,setBinding:value=>{connection=value;},unwatch:()=>{projects=[];},pause:()=>{paused=true;},cold:()=>{live=false;},followup};
}

test('detail reads only the requested original-owner job and exports bounded safe fields',async()=>{
  const f=await fixture();f.cold();const value=await f.adapter.action({action:'task_detail',id:'job-1'});
  assert.deepEqual(f.calls,[['task','original-owner',{id:'job-1'}]]);assert.equal(value.jobs[0].replyTruncated,false);assert.match(value.jobs[0].reply,/正文/);assert.equal(value.jobs[0].delivery.status,'reported_sent');
  for(const secret of [project.root,binding.bindingKey,'secret','PRIVATE','projectRoot','returnBinding','targetSessionId'])assert.equal(JSON.stringify(value).includes(secret),false,secret);
  assert.ok(value.limitations.some(text=>text.includes('手机')));
});

test('deliberate followup status is passive, exact-owner scoped and includes the real next due time',async()=>{
  const f=await fixture();f.cold();const value=await f.adapter.action({action:'followup_status',projectId});
  assert.deepEqual(f.calls,[['status',{root:project.root,sessionId:'original-owner'}],['onceStatus',{root:project.root,sessionId:'original-owner'}]]);
  assert.equal(value.followup.nextDueAt,'2026-10-19T15:30:00.000Z');assert.equal(value.followup.delivery,'wechat');assert.equal(value.followup.everyMinutes,30);
  assert.equal(JSON.stringify(value).includes('sessionId'),false);assert.equal(JSON.stringify(value).includes(binding.bindingKey),false);
});

test('memory detail passively returns the complete selected note beyond the overview preview',async()=>{
  const text='完整项目上下文'.repeat(150)+'FULL_MEMORY_TAIL';
  const inspectCalls=[],row={id:'memory-full',kind:'context',text,at:now,source:{kind:'assistant',reference:'session:project-session#turn3'},verified:false,sessionId:'PRIVATE',fingerprint:'PRIVATE',private:'PRIVATE'};
  const f=await fixture({memory:{inspect:async args=>{inspectCalls.push(args);return{goals:[],entries:[row],changes:[{text:'OTHER_PRIVATE_RECORD'}]};},read:async()=>{throw new Error('must never open the write-capable memory read path');}}});f.cold();
  const value=await f.adapter.action({action:'memory_detail',projectId,id:row.id});
  assert.deepEqual(inspectCalls,[{root:project.root,sessionId:'original-owner'}]);assert.deepEqual(f.calls,[],'a read must never activate an owner or change any plan');
  assert.deepEqual(value,{action:'memory_detail',projectId,record:{id:row.id,kind:row.kind,text,at:now,source:row.source,verified:false},editable:true,redacted:false});
  assert.ok(value.record.text.length>500);assert.ok(value.record.text.endsWith('FULL_MEMORY_TAIL'));
  assert.equal(JSON.stringify(value).includes('PRIVATE'),false);
});

test('memory detail retains full Unicode notes within the 2000-character storage bound',async()=>{
  const text='😀'.repeat(1995)+'尾部保留';
  const f=await fixture({memory:{inspect:async()=>({goals:[{id:'unicode-note',kind:'goal',text,at:now,source:{kind:'user',reference:'session:original-owner'},verified:false}],entries:[]})}});
  const value=await f.adapter.action({action:'memory_detail',projectId,id:'unicode-note'});
  assert.equal(value.record.text,text);assert.ok(Array.from(value.record.text).length<=2000);
});

test('memory detail rejects foreign projects, missing or duplicate IDs and malformed records without exposing another note',async()=>{
  const row={id:'memory-safe',kind:'context',text:'SENSITIVE_FOREIGN_CONTENT',at:now,source:{kind:'file',reference:'README.md#L2'},verified:false};
  const fixtures=[{goals:[],entries:[]},{goals:[],entries:[{...row,id:'other-note'}]},{goals:[row],entries:[row]},{goals:[],entries:[{...row,text:'x'.repeat(2001)}]},{goals:[],entries:[{...row,verified:true}]},{goals:[],entries:[{...row,source:{kind:'file',reference:'../outside.md'}}]},{goals:[],entries:[{...row,source:{kind:'file',reference:'/private/outside.md'}}]},{goals:[],entries:[{...row,source:{kind:'user',reference:'https://untrusted'}}]}];
  for(const value of fixtures){
    const f=await fixture({memory:{inspect:async()=>value}});f.cold();
    await assert.rejects(f.adapter.action({action:'memory_detail',projectId,id:'memory-safe'}),error=>!error.message.includes('SENSITIVE_FOREIGN_CONTENT'));
    assert.deepEqual(f.calls,[]);
  }
  let reads=0;const f=await fixture({memory:{inspect:async()=>{reads++;return{goals:[],entries:[row]};}}});
  const foreign=`project_${createHash('sha256').update('/synthetic/foreign-project').digest('hex').slice(0,24)}`;
  for(const input of [{action:'memory_detail',projectId:foreign,id:row.id},{action:'memory_detail',projectId,id:'../memory-safe'},{action:'memory_detail',projectId,id:row.id,root:'/synthetic/foreign-project'},{action:'memory_detail',projectId,id:row.id,sessionId:'other-owner'}])await assert.rejects(f.adapter.action(input));
  assert.equal(reads,0);assert.deepEqual(f.calls,[]);
});

test('memory detail sanitizes text and source fields without exporting hidden record metadata',async()=>{
  const f=await fixture({memory:{inspect:async()=>({goals:[],entries:[{id:'safe-note',kind:'decision',text:`正文 ${project.root} api_key=MEMORY_SECRET ${binding.bindingKey}`,at:now,source:{kind:'file',reference:'notes/context.md#L1'},verified:false,private:'PRIVATE_METADATA',origin:{text:'PRIVATE_METADATA'}}]})}});
  const value=await f.adapter.action({action:'memory_detail',projectId,id:'safe-note'});
  for(const hidden of [project.root,binding.bindingKey,'MEMORY_SECRET','PRIVATE_METADATA'])assert.equal(JSON.stringify(value).includes(hidden),false,hidden);
  assert.deepEqual(value.record.source,{kind:'file',reference:'notes/context.md#L1'});assert.equal(value.record.verified,false);
  assert.equal(value.editable,false,'sanitized display text must not replace the original source note');assert.equal(value.redacted,true);
});

test('memory detail rechecks the binding, watched project, pause and closure after its awaited inspection',async()=>{
  for(const kind of ['binding','unwatch','paused','close']){
    const gate=deferred(),entered=deferred();
    const f=await fixture({memory:{inspect:async()=>{entered.resolve();await gate.promise;return{goals:[],entries:[{id:'memory-safe',kind:'context',text:'NEVER_EXPORT_AFTER_SCOPE_CHANGE',at:now,source:{kind:'assistant',reference:'session:original-owner'},verified:false}]};}}});f.cold();
    const pending=f.adapter.action({action:'memory_detail',projectId,id:'memory-safe'});await entered.promise;
    if(kind==='binding')f.setBinding({...binding,bindingKey:'b'.repeat(64)});if(kind==='unwatch')f.unwatch();if(kind==='paused')f.pause();if(kind==='close')f.adapter.close();
    gate.resolve();await assert.rejects(pending);assert.deepEqual(f.calls,[]);
  }
});

test('real full memory detail leaves database, metadata and sidecar files byte-identical',async t=>{
  const {createProjectMemory}=await import('../src/project-memory.js');
  const root=await realpath(await mkdtemp(join(tmpdir(),'dot-workbench-memory-detail-'))),text='真实存储中的完整上下文'.repeat(100)+'PERSISTED_FULL_TAIL';
  let memory=createProjectMemory({authorizeRoot:async value=>value===root,clock:()=>new Date(now)});
  t.after(async()=>{await memory.close();await rm(root,{recursive:true,force:true});});
  const saved=await memory.remember({root,sessionId:'original-owner',kind:'context',text,source:{kind:'assistant',reference:'session:original-owner'}});await memory.close();
  memory=createProjectMemory({authorizeRoot:async value=>value===root});
  const directory=join(root,'.dsh','dot-memory'),files=async()=>Object.fromEntries(await Promise.all((await readdir(directory)).map(async name=>[name,await readFile(join(directory,name))]))),before=await files();
  const f=await fixture({memory:{inspect:args=>memory.inspect(args),read:async()=>{throw new Error('write-capable read forbidden');}},service:{watchedProjects:async()=>[{...project,root}],isPaused:async()=>false}});f.cold();
  const key=`project_${createHash('sha256').update(root).digest('hex').slice(0,24)}`,value=await f.adapter.action({action:'memory_detail',projectId:key,id:saved.receipt.id});
  assert.equal(value.record.text,text);assert.deepEqual(await files(),before);assert.deepEqual(f.calls,[]);
});

test('the authenticated route saves an existing 1999-astral-character memory without truncating its tail',async t=>{
  const {createProjectMemory}=await import('../src/project-memory.js'),{registerWorkbenchActionsRoute}=await api();
  const root=await realpath(await mkdtemp(join(tmpdir(),'dot-workbench-unicode-save-'))),text='😀'.repeat(1998)+'尾';
  const memory=createProjectMemory({authorizeRoot:async value=>value===root,clock:()=>new Date(now)});
  t.after(async()=>{await memory.close();await rm(root,{recursive:true,force:true});});
  const saved=await memory.remember({root,sessionId:'original-owner',kind:'context',text,source:{kind:'assistant',reference:'session:original-owner'}});
  const f=await fixture({memory,service:{watchedProjects:async()=>[{...project,root}],isPaused:async()=>false}});let route;
  registerWorkbenchActionsRoute({get:()=>({fetch:{register:value=>{route=value;return()=>{};}}})},f.adapter);
  const key=`project_${createHash('sha256').update(root).digest('hex').slice(0,24)}`;
  const request=input=>new Request('http://localhost/api/project_companion/workbench/actions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
  const detailResponse=await route.fetch(request({action:'memory_detail',projectId:key,id:saved.receipt.id}));assert.equal(detailResponse.status,200);
  const detail=await detailResponse.json();assert.equal(detail.record.text,text);
  const response=await route.fetch(request({action:'memory_update',projectId:key,id:saved.receipt.id,text:detail.record.text,userRequested:true}));
  assert.equal(response.status,200);const result=await response.json();assert.equal(result.updated,true);
  assert.equal((await memory.inspect({root,sessionId:'view'})).entries[0].text,text);assert.equal(Array.from(text).length,1999);
  const tooLong=await route.fetch(request({action:'memory_update',projectId:key,id:saved.receipt.id,text:'😀'.repeat(2001),userRequested:true}));
  assert.equal(tooLong.status,400);assert.equal((await memory.inspect({root,sessionId:'view'})).entries[0].text,text);
});

test('explicit writes activate only the original owner and map opaque IDs to watched roots',async()=>{
  const f=await fixture();f.cold();await f.adapter.action({action:'followup_configure',projectId,everyMinutes:45,userRequested:true});
  assert.deepEqual(f.calls[0],['activate','original-owner']);assert.deepEqual(f.calls[1],['configure',{root:project.root,sessionId:'original-owner',everyMinutes:45,projectLabel:project.label}]);
  const receipt=await f.adapter.action({action:'memory_update',projectId,id:'memory-1',text:'修正后的内容',userRequested:true});assert.equal(receipt.record.text,'修正后的内容');assert.equal(receipt.record.verified,false);assert.equal(JSON.stringify(receipt).includes('never export'),false);
  assert.deepEqual(f.calls.find(row=>row[0]==='revise'),['revise',{root:project.root,sessionId:'original-owner',id:'memory-1',text:'修正后的内容',userRequested:true}]);
  await f.adapter.action({action:'memory_forget',projectId,id:'memory-1',userRequested:true});assert.deepEqual(f.calls.find(row=>row[0]==='forget'),['forget',{root:project.root,sessionId:'original-owner',id:'memory-1',userRequested:true}]);
});

test('one-off accepts an explicit future time or a short delay and uses the original WeChat route',async()=>{
  const f=await fixture();const dueAt='2026-10-20T15:00:00.000Z';
  await f.adapter.action({action:'check_once',projectId,dueAt,userRequested:true});assert.deepEqual(f.calls[0],['checkOnce',{root:project.root,sessionId:'original-owner',projectLabel:project.label,delivery:'wechat',dueAt}]);
  await f.adapter.action({action:'cancel_once',projectId,userRequested:true});assert.ok(f.calls.some(row=>row[0]==='cancelOnce'&&row[1].sessionId==='original-owner'));
  await f.adapter.action({action:'followup_cancel',projectId,userRequested:true});assert.ok(f.calls.some(row=>row[0]==='cancel'&&row[1].root===project.root));
});

test('malformed actions, forged scope, missing consent and invalid schedules cause no delegate calls',async()=>{
  const f=await fixture();const bad=[null,[],{}, {action:'task_detail',id:'job',sessionId:'other'}, {action:'followup_status',projectId:'/arbitrary/path'}, {action:'followup_status',projectId:projectId+'x'}, {action:'followup_configure',projectId,everyMinutes:30}, {action:'followup_configure',projectId,everyMinutes:29,userRequested:true}, {action:'memory_update',projectId,id:'m',text:' ',userRequested:true},{action:'memory_forget',projectId,id:'../m',userRequested:true},{action:'check_once',projectId,delaySeconds:60,dueAt:'2026-10-20T15:00:00Z',userRequested:true},{action:'check_once',projectId,dueAt:now,userRequested:true},{action:'check_once',projectId,dueAt:'2026-10-20T15:00',userRequested:true},{action:'check_once',projectId,dueAt:'2026-10-27T15:00:00Z',userRequested:true}];
  for(const input of bad)await assert.rejects(f.adapter.action(input));assert.deepEqual(f.calls,[]);
});

test('binding changes and unwatch during activation prevent all writes',async()=>{
  for(const kind of ['binding','unwatch','paused','close']){
    const gate=deferred(),entered=deferred();let f;
    f=await fixture({activateOwner:async()=>{entered.resolve();await gate.promise;}});f.cold();
    const pending=f.adapter.action({action:'followup_configure',projectId,everyMinutes:30,userRequested:true});await entered.promise;
    if(kind==='binding')f.setBinding({...binding,bindingKey:'b'.repeat(64)});if(kind==='unwatch')f.unwatch();if(kind==='paused')f.pause();if(kind==='close')f.adapter.close();gate.resolve();await assert.rejects(pending);assert.deepEqual(f.calls,[]);
  }
});

for(const [action,method] of [['memory_update','revise'],['memory_forget','forget'],['followup_configure','configure'],['followup_cancel','cancel'],['check_once','checkOnce'],['cancel_once','cancelOnce']])test(action+' passes a final mutation guard that rejects binding revocation during delegate awaits',async()=>{
  const gate=deferred(),entered=deferred();let mutations=0,captured;
  const delegate=async args=>{captured=args;entered.resolve();await gate.promise;assert.equal(await args.authorizeMutation(),true);mutations++;return{};};
  const f=await fixture(action.startsWith('memory_')?{memory:{[method]:delegate}}:{followup:{[method]:delegate}});
  const input={action,projectId,userRequested:true,...(action==='memory_update'?{id:'memory-1',text:'correction'}:action==='memory_forget'?{id:'memory-1'}:action==='followup_configure'?{everyMinutes:30}:action==='check_once'?{delaySeconds:60}:{})};
  const pending=f.adapter.action(input);await entered.promise;f.setBinding({...binding,bindingKey:'b'.repeat(64)});gate.resolve();await assert.rejects(pending);assert.equal(mutations,0);
  assert.equal(typeof captured.authorizeMutation,'function');if(!action.startsWith('memory_'))assert.deepEqual(captured.expectedBinding,{sessionId:'original-owner',bindingKey:binding.bindingKey});
});

test('an in-place changed binding cannot expose old-owner detail after an awaited read',async()=>{
  const gate=deferred(),entered=deferred(),mutable={...binding};
  const f=await fixture({readConnection:async()=>mutable,taskResults:{status:async()=>{entered.resolve();await gate.promise;return{jobs:[{id:'job-1',status:'completed',task:'PRIVATE',projectLabel:'PRIVATE',createdAt:now,reply:'PRIVATE'}]};}}});
  const pending=f.adapter.action({action:'task_detail',id:'job-1'});await entered.promise;mutable.bindingKey='b'.repeat(64);gate.resolve();await assert.rejects(pending);
});

test('a caller cannot change a validated operation while binding reads are pending',async()=>{
  const gate=deferred(),entered=deferred();let first=true;
  const f=await fixture({readConnection:async()=>{if(first){first=false;entered.resolve();await gate.promise;}return binding;}});
  const input={action:'task_detail',id:'job-safe'},pending=f.adapter.action(input);await entered.promise;input.id='job-replaced';gate.resolve();await pending;assert.deepEqual(f.calls,[['task','original-owner',{id:'job-safe'}]]);
});

test('negative or mismatched memory receipts cannot become a success claim',async()=>{
  for(const memory of [{revise:async()=>({accepted:false})},{revise:async()=>({code:'invalid_action'})},{revise:async()=>({receipt:{id:'different-record',kind:'context',text:'wrong',at:now,source:{kind:'user',reference:'session:original-owner'},status:'revised'}})}]){
    const f=await fixture({memory});await assert.rejects(f.adapter.action({action:'memory_update',projectId,id:'memory-safe',text:'correct',userRequested:true}));
  }
});

test('forget accepts its real minimal receipt after deletion without exporting forgotten content',async()=>{
  let deletions=0;
  const receipt={action:'forget',status:'forgotten',id:'memory-1',kind:'context'};
  const f=await fixture({memory:{forget:async()=>{deletions++;return{receipt,entries:[],changes:[{text:'FORGOTTEN PRIVATE CONTENT'}]};}}});
  const {registerWorkbenchActionsRoute}=await api();let route;
  registerWorkbenchActionsRoute({get:()=>({fetch:{register:value=>{route=value;return()=>{};}}})},f.adapter);
  const response=await route.fetch(new Request('http://localhost/api/project_companion/workbench/actions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'memory_forget',projectId,id:'memory-1',userRequested:true})}));
  assert.equal(response.status,200);const result=await response.json();assert.equal(result.forgotten,true);assert.deepEqual(result.receipt,receipt);assert.deepEqual(result.record,receipt);assert.equal(deletions,1);assert.equal(JSON.stringify(result).includes('FORGOTTEN'),false);
});

test('the real memory adapter deletion remains a confirmed workbench success',async t=>{
  const {createProjectMemory}=await import('../src/project-memory.js');
  const root=await realpath(await mkdtemp(join(tmpdir(),'dot-workbench-forget-')));
  const memory=createProjectMemory({authorizeRoot:async value=>value===root,clock:()=>new Date(now)});
  t.after(async()=>{await memory.close();await rm(root,{recursive:true,force:true});});
  const saved=await memory.remember({root,sessionId:'original-owner',kind:'context',text:'REMOVED PRIVATE MEMORY',source:{kind:'assistant',reference:'session:original-owner'}});
  const id=saved.receipt.id,key=`project_${createHash('sha256').update(root).digest('hex').slice(0,24)}`;
  const f=await fixture({memory,service:{watchedProjects:async()=>[{...project,root}],isPaused:async()=>false}});
  const result=await f.adapter.action({action:'memory_forget',projectId:key,id,userRequested:true});
  assert.equal(result.forgotten,true);assert.deepEqual(result.receipt,{action:'forget',status:'forgotten',id,kind:'context'});assert.equal(JSON.stringify(result).includes('REMOVED PRIVATE MEMORY'),false);assert.deepEqual((await memory.inspect({root,sessionId:'workbench-view'})).entries,[]);
});

test('paused, closed and missing-bound owners cannot act or wake a session',async()=>{
  const f=await fixture();f.pause();await assert.rejects(f.adapter.action({action:'followup_status',projectId}));assert.deepEqual(f.calls,[]);
  const missing=await fixture();missing.setBinding({state:'awaiting-message'});await assert.rejects(missing.adapter.action({action:'memory_forget',projectId,id:'m',userRequested:true}));assert.deepEqual(missing.calls,[]);
  const closed=await fixture();closed.adapter.close();await assert.rejects(closed.adapter.action({action:'task_detail',id:'job'}));assert.deepEqual(closed.calls,[]);
});

test('owner conflict is surfaced without cancelling either project or one-off plan',async()=>{
  const f=await fixture({followup:{cancel:async()=>{throw new Error('Follow-up belongs to another original source session');}}});await assert.rejects(f.adapter.action({action:'followup_cancel',projectId,userRequested:true}));assert.deepEqual(f.calls,[]);
});

test('authenticated POST route rejects redirects, query scope, invalid JSON and oversized bodies',async()=>{
  const {registerWorkbenchActionsRoute}=await api();let route,reads=0,stops=0;const effects=[];
  const stop=registerWorkbenchActionsRoute({get:()=>({fetch:{register:value=>{route=value;return()=>stops++;}}}),effect:fn=>effects.push(fn)},{action:async input=>{reads++;return input;}});
  assert.equal(route.path,'/api/project_companion/workbench/actions');assert.deepEqual(route.methods,['POST']);
  const req=(body='{}',headers={'Content-Type':'application/json'},suffix='')=>new Request('http://localhost/api/project_companion/workbench/actions'+suffix,{method:'POST',headers,body});
  const ok=await route.fetch(req());assert.equal(ok.status,200);assert.equal(ok.headers.get('cache-control'),'no-store');
  assert.equal((await route.fetch(req('{}',{},''))).status,415);assert.equal((await route.fetch(req('{}',undefined,'?sessionId=other'))).status,400);
  assert.equal((await route.fetch(req('{'))).status,400);assert.equal((await route.fetch(req('x'.repeat(12289)))).status,413);assert.equal((await route.fetch(req('{}',{'Content-Type':'application/json','Content-Length':'12289'}))).status,413);
  assert.equal((await route.fetch(new Request('http://localhost/api/project_companion/workbench/actions'))).status,405);assert.equal(reads,1);
  stop();assert.equal(stops,1);assert.equal((await route.fetch(req())).status,503);assert.equal(registerWorkbenchActionsRoute({get:()=>null},{}),null);assert.equal(effects.length,1);
});
