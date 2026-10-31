import test from 'node:test';
import assert from 'node:assert/strict';
const module=await import('../src/client-goal-board.js').catch(()=>({}));
const {createWorkspaceScopeController:workspace,createLogicalProjectController:goals}=module;
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
const catalog=Array.from({length:137},(_,i)=>({id:'workspace-'+i,label:'工作区 '+i,sessionCount:i,available:true,selected:i===1}));
function scopeFixture(){
 let revision='scope-1',catalogRevision='catalog-1',selectedIds=['workspace-1'];const calls=[];
 const request=async body=>{calls.push(body);if(body.action==='save'){assert.equal(body.expectedRevision,revision);assert.equal(body.expectedCatalogRevision,catalogRevision);selectedIds=[...body.workspaceIds];revision='scope-2';}const rows=catalog.filter(r=>!body.query||r.label.includes(body.query)),offset=body.offset??0,limit=body.limit??20,items=rows.slice(offset,offset+limit).map(row=>({...row,selected:selectedIds.includes(row.id)}));return{version:1,revision,catalogRevision,total:catalog.length,matchedTotal:rows.length,offset,limit,hasMore:offset+items.length<rows.length,nextOffset:offset+items.length<rows.length?offset+items.length:null,items,selectedIds:[...selectedIds],selectedCount:selectedIds.length};};
 return{calls,request,change:()=>{revision='scope-changed';}};
}
test('removed registered workspace grant can be cleared without changing valid selections',async()=>{
 const f=scopeFixture();let cleared=false;const c=workspace({request:async body=>{const value=await f.request(body);if(body.action==='save')cleared=true;return{...value,unavailableCount:cleared?0:1};}});await c.open();assert.deepEqual(c.getSnapshot().delta,{added:0,removed:1});assert.equal(await c.save(),true);assert.deepEqual(f.calls.at(-1).workspaceIds,['workspace-1']);c.close();
});
test('workspace selection is explicit and preserves all selections beyond visible pages and search',async()=>{
 assert.equal(typeof workspace,'function');const f=scopeFixture(),c=workspace({request:f.request});assert.equal(c.getSnapshot().summary,null);assert.equal(f.calls.length,0);await c.open();assert.deepEqual(c.getSnapshot().selectedIds,['workspace-1']);c.toggle('workspace-0');await c.load({offset:120});c.toggle('workspace-136');await c.load({query:'工作区 2'});assert.deepEqual(new Set(c.getSnapshot().selectedIds),new Set(['workspace-1','workspace-0','workspace-136']));assert.deepEqual(c.getSnapshot().delta,{added:2,removed:0});await c.save();assert.equal(c.getSnapshot().open,false);assert.deepEqual(f.calls.at(-1),{action:'save',expectedRevision:'scope-1',expectedCatalogRevision:'catalog-1',workspaceIds:['workspace-1','workspace-0','workspace-136']});assert.equal(f.calls.some(r=>r.action==='recognize'),false);c.close();
});
test('cancel and Escape-equivalent close discard local changes without any grant request',async()=>{
 assert.equal(typeof workspace,'function');const f=scopeFixture(),c=workspace({request:f.request});await c.open();c.toggle('workspace-1');c.selectVisible();assert.equal(c.getSnapshot().delta.removed,0);c.cancel();assert.equal(c.getSnapshot().open,false);assert.equal(f.calls.some(r=>r.action==='save'),false);await c.open();assert.deepEqual(c.getSnapshot().selectedIds,['workspace-1']);c.close();
});
test('empty scope stays empty and visible multi-select never selects unlisted rows',async()=>{
 assert.equal(typeof workspace,'function');const f=scopeFixture(),c=workspace({request:async body=>({...await f.request(body),selectedIds:[],selectedCount:0,items:(await f.request(body)).items.map(r=>({...r,selected:false}))})});await c.open();assert.deepEqual(c.getSnapshot().selectedIds,[]);c.selectVisible();assert.equal(c.getSnapshot().selectedIds.length,20);assert.equal(c.getSnapshot().selectedIds.includes('workspace-136'),false);c.close();
});
test('stale save preserves the reviewable selection and requires explicit reload without destructive retry',async()=>{
 assert.equal(typeof workspace,'function');const f=scopeFixture(),c=workspace({request:body=>body.action==='save'?Promise.reject(Object.assign(Error('stale'),{status:409})):f.request(body)});await c.open();c.toggle('workspace-1');c.toggle('workspace-2');await c.save();const state=c.getSnapshot();assert.equal(state.open,true);assert.equal(state.stale,true);assert.deepEqual(state.selectedIds,['workspace-2']);assert.deepEqual(state.delta,{added:1,removed:1});assert.match(state.error,/范围.*变化.*重新加载/);assert.equal(await c.save(),false);c.close();
});
test('closing during a late metadata response cannot reopen selection or overwrite current scope',async()=>{
 assert.equal(typeof workspace,'function');const gate=deferred(),f=scopeFixture(),c=workspace({request:async body=>{await gate.promise;return f.request(body);}});const pending=c.open();c.cancel();gate.resolve();await pending;assert.equal(c.getSnapshot().open,false);assert.equal(c.getSnapshot().page,null);c.close();
});
test('select all traverses every metadata page and only saves after explicit confirmation',async()=>{
 const f=scopeFixture(),c=workspace({request:f.request});await c.open();
 assert.equal(typeof c.selectAll,'function');assert.equal(await c.selectAll(),true);
 assert.equal(c.getSnapshot().selectedIds.length,137);assert.ok(c.getSnapshot().selectedIds.includes('workspace-136'));
 const reads=f.calls.slice(1);assert.deepEqual(reads.map(x=>[x.action,x.offset,x.limit,x.expectedCatalogRevision]),[['list',0,100,'catalog-1'],['list',100,100,'catalog-1']]);
 assert.equal(f.calls.some(x=>x.action==='save'||x.action==='recognize'),false);
 await c.save();assert.equal(f.calls.at(-1).workspaceIds.length,137);c.close();
});
test('select all search results preserves prior selections outside that search',async()=>{
 const f=scopeFixture(),c=workspace({request:f.request});await c.open();await c.load({query:'工作区 2'});
 await c.selectAll();assert.deepEqual(new Set(c.getSnapshot().selectedIds),new Set(['workspace-1',...catalog.filter(r=>r.label.includes('工作区 2')).map(r=>r.id)]));
 assert.equal(f.calls.at(-1).query,'工作区 2');assert.equal(f.calls.some(x=>x.action==='save'),false);c.close();
});
test('clear selection changes only the pending selection and cancellation restores saved scope',async()=>{
 const f=scopeFixture(),c=workspace({request:f.request});await c.open();c.clearSelection();assert.deepEqual(c.getSnapshot().selectedIds,[]);assert.equal(f.calls.some(x=>x.action==='save'),false);
 c.cancel();await c.open();assert.deepEqual(c.getSnapshot().selectedIds,['workspace-1']);c.close();
});
test('a failed later page never leaves a partially selected set',async()=>{
 const f=scopeFixture(),c=workspace({request:args=>args.offset===100?Promise.reject(Error('offline')):f.request(args)});await c.open();c.toggle('workspace-2');const before=c.getSnapshot().selectedIds;
 assert.equal(await c.selectAll(),false);assert.deepEqual(c.getSnapshot().selectedIds,before);assert.match(c.getSnapshot().error,/保留/);assert.equal(f.calls.some(x=>x.action==='save'),false);c.close();
});
test('a revision change during select all preserves the current selection and marks it stale',async()=>{
 const f=scopeFixture(),c=workspace({request:async args=>{const value=await f.request(args);return args.offset===100?{...value,catalogRevision:'new-catalog'}:value;}});await c.open();
 assert.equal(await c.selectAll(),false);assert.deepEqual(c.getSnapshot().selectedIds,['workspace-1']);assert.equal(c.getSnapshot().stale,true);assert.equal(await c.save(),false);c.close();
});
test('cancel during select all discards the local action without saving or reopening',async()=>{
 const f=scopeFixture(),gate=deferred(),c=workspace({request:async args=>{if(args.limit===100)await gate.promise;return f.request(args);}});await c.open();const pending=c.selectAll();c.cancel();gate.resolve();await pending;
 assert.equal(c.getSnapshot().open,false);assert.equal(c.getSnapshot().page,null);assert.deepEqual(c.getSnapshot().selectedIds,[]);assert.equal(f.calls.some(x=>x.action==='save'),false);c.close();
});
test('a new search supersedes an outstanding select-all response',async()=>{
 const f=scopeFixture(),gate=deferred(),c=workspace({request:async args=>{if(args.limit===100)await gate.promise;return f.request(args);}});await c.open();const pending=c.selectAll();await c.load({query:'工作区 2'});gate.resolve();await pending;
 assert.equal(c.getSnapshot().query,'工作区 2');assert.deepEqual(c.getSnapshot().selectedIds,['workspace-1']);assert.equal(c.getSnapshot().selectingAll,false);c.close();
});
test('select all rejects duplicate workspace ids instead of claiming complete coverage',async()=>{
 const f=scopeFixture(),c=workspace({request:async args=>{const v=await f.request(args);if(args.offset===100)v.items[0]={...v.items[0],id:'workspace-0'};return v;}});await c.open();assert.equal(await c.selectAll(),false);assert.deepEqual(c.getSnapshot().selectedIds,['workspace-1']);c.close();
});
test('select all respects the existing 1000-workspace save limit without expanding it',async()=>{
 const f=scopeFixture(),c=workspace({request:async args=>({...await f.request(args),total:1001,matchedTotal:1001})});await c.open();assert.equal(await c.selectAll(),false);assert.deepEqual(c.getSnapshot().selectedIds,['workspace-1']);assert.match(c.getSnapshot().error,/1000/);c.close();
});
const project=(id='goal-1')=>({id,title:'同一目标',goal:'交付可核对的结果',constraints:['先验证'],state:'proposed',lane:'mine',progress:'已有本地初稿',nextStep:'核对结果',evidenceCount:2,sessionCount:2,workspaceCount:1,stale:false,updatedAt:'2026-10-30T00:00:00Z'});
function goalFixture(){let revision='board-1';const calls=[],row=project();const status=()=>({version:1,revision,accessRevision:'scope-1',projects:[{...row}],scan:{phase:'idle',at:null,coverage:[]},standaloneCount:1,uncertainCount:1});const request=async body=>{calls.push(body);if(body.action==='detail')return{version:1,revision,accessRevision:'scope-1',project:{...row},evidence:[{id:'e1',workspaceId:'actual-1',workspaceLabel:'资料',sessionId:'s1',kind:'user',reference:'session:s1',text:'真实合成来源',at:null,truncated:false,available:true}],conversation:null};if(body.action==='conversation')return{version:1,projectId:row.id,conversation:{sessionId:'dot-goal-1',revision:'native:dot-goal-1'}};if(body.action==='recognize')return{...status(),scan:{phase:'running',at:null,coverage:[]}};if(body.action==='accept'){row.state='confirmed';revision='board-2';}return status();};return{calls,request,row};}
test('logical project load is passive and recognition requires one explicit action with both revisions',async()=>{
 assert.equal(typeof goals,'function');const f=goalFixture(),c=goals({request:f.request});await c.refresh();assert.deepEqual(f.calls,[{action:'status'}]);await c.recognize();assert.deepEqual(f.calls.at(-1),{action:'recognize',expectedRevision:'board-1',expectedAccessRevision:'scope-1'});assert.equal(c.getSnapshot().status.scan.phase,'running');await c.recognize();assert.equal(f.calls.filter(r=>r.action==='recognize').length,1);c.close();
});
test('opening a project uses its canonical detail and dedicated trusted conversation without global selection writes',async()=>{
 assert.equal(typeof goals,'function');const f=goalFixture(),c=goals({request:f.request});await c.refresh();await c.open('goal-1');assert.equal(c.getSnapshot().detail.project.goal,'交付可核对的结果');assert.deepEqual(c.getSnapshot().target,{sessionId:'dot-goal-1',revision:'native:dot-goal-1'});assert.deepEqual(f.calls.slice(1),[{action:'detail',projectId:'goal-1'},{action:'conversation',projectId:'goal-1',expectedRevision:'board-1'},{action:'detail',projectId:'goal-1'}]);c.dismiss();assert.equal(c.getSnapshot().projectId,null);await c.open('goal-1');assert.equal(f.calls.some(r=>r.action==='submit'||r.action==='remember'),false);c.close();
});
test('late project selection never creates a conversation or shows sources in a newer side sheet',async()=>{
 assert.equal(typeof goals,'function');const f=goalFixture(),gate=deferred(),c=goals({request:async body=>{if(body.action==='detail')await gate.promise;return f.request(body);}});await c.refresh();const pending=c.open('goal-1');c.dismiss();gate.resolve();await pending;assert.equal(c.getSnapshot().detail,null);assert.equal(c.getSnapshot().target,null);assert.equal(f.calls.some(r=>r.action==='conversation'),false);c.close();
});
test('accept and source correction use CAS then refresh canonical detail while failures preserve visible context',async()=>{
 assert.equal(typeof goals,'function');const f=goalFixture(),c=goals({request:f.request});await c.refresh();await c.open('goal-1');await c.mutate('accept');assert.equal(c.getSnapshot().detail.project.state,'confirmed');assert.ok(f.calls.some(r=>r.action==='accept'&&r.expectedRevision==='board-1'));await c.mutate('correct',{evidenceId:'e1',targetProjectId:null});assert.ok(f.calls.some(r=>r.action==='correct'&&r.expectedRevision==='board-2'));c.close();
});

test('native registry preserves separate project bindings and global drafts while allowing only one editable surface',async()=>{
 const {createGoalConversationRegistry:create}=module;assert.equal(typeof create,'function');const {createDesktopConversationController}=await import('../src/client-conversation.js');
 const retained=[],released=[],drafts=new Map(),bindings=new Map();let remembers=0;
 const ctx={sessions:{list:{getSnapshot:()=>({byId:{}})},binding:id=>bindings.get(id),retain(id){retained.push(id);const draft=drafts.get(id)??{text:'草稿 '+id,attachments:['file-'+id],approval:'pending'};drafts.set(id,draft);const binding={sessionId:id,ctx:{},session:{getSnapshot:()=>({})}};bindings.set(id,binding);return{binding,draft,ready:Promise.resolve(),release:()=>{released.push(id);bindings.delete(id);}};}}};
 const global=createDesktopConversationController(ctx);global.remember=()=>{remembers++;};const registry=create({globalController:global,createController:()=>createDesktopConversationController(ctx)});
 const target=id=>({sessionId:id,revision:'native:'+id});const main=await registry.acquire(null,'home',target('main'));await assert.rejects(registry.acquire('p1','sheet',target('dot-goal-1')),/另一处/);registry.release(null,'home');const first=await registry.acquire('p1','sheet',target('dot-goal-1'));registry.release('p1','sheet');const second=await registry.acquire('p2','sheet',target('dot-goal-2'));registry.release('p2','sheet');assert.equal(await registry.acquire('p1','sheet-again',target('dot-goal-1')),first);registry.release('p1','sheet-again');assert.equal(await registry.acquire(null,'home-again',target('main')),main);assert.deepEqual(first.draft,{text:'草稿 dot-goal-1',attachments:['file-dot-goal-1'],approval:'pending'});assert.equal(second.draft.text,'草稿 dot-goal-2');assert.deepEqual(retained,['main','dot-goal-1','dot-goal-2']);assert.deepEqual(released,[]);assert.equal(remembers,0);registry.close();assert.deepEqual(new Set(released),new Set(retained));
});

test('explicit new-goal text creates a canonical vision without history or grants and opens its dedicated native conversation',async()=>{
 assert.equal(typeof goals,'function');const calls=[],row=project('new-goal');const c=goals({request:async body=>{calls.push(body);if(body.action==='status')return{version:1,revision:'b1',accessRevision:null,projects:[],scan:{phase:'idle',coverage:[]},standaloneCount:0,uncertainCount:0};if(body.action==='vision')return{version:1,revision:'b2',accessRevision:null,projects:[row],scan:{phase:'idle',coverage:[]},standaloneCount:0,uncertainCount:0};if(body.action==='detail')return{version:1,revision:'b2',project:row,evidence:[],conversation:null};if(body.action==='conversation')return{version:1,projectId:row.id,conversation:{sessionId:'dot-goal-new',revision:'native:dot-goal-new'}};throw Error('unexpected');}});await c.refresh();assert.equal(typeof c.createGoal,'function');await c.createGoal('  我要把这次发布走完，并核对真实收到。  ');assert.deepEqual(calls[1],{action:'vision',projectId:null,title:'我要把这次发布走完，并核对真实收到。',goal:'我要把这次发布走完，并核对真实收到。',constraints:[],expectedRevision:'b1'});assert.equal(c.getSnapshot().projectId,'new-goal');assert.equal(c.getSnapshot().target.sessionId,'dot-goal-new');assert.equal(calls.some(row=>row.action==='recognize'||row.action==='save'||row.action==='submit'),false);c.close();
});

test('an older status request cannot replace a newly started recognition with idle',async()=>{
 assert.equal(typeof goals,'function');const f=goalFixture(),gate=deferred();let reads=0;const c=goals({request:async body=>{if(body.action==='status'&&++reads===2)await gate.promise;return f.request(body);}});await c.refresh();const old=c.refresh();await c.recognize();gate.resolve();await old;assert.equal(c.getSnapshot().status.scan.phase,'running');c.close();
});
test('scope changes hide old evidence immediately during authoritative detail refresh and keep native draft target',async()=>{
 assert.equal(typeof goals,'function');const f=goalFixture(),gate=deferred();let changed=false;const c=goals({request:async body=>{if(changed&&body.action==='detail'){await gate.promise;return{version:1,revision:'b2',accessRevision:'scope-2',project:{...project(),stale:true},evidence:[{id:'e1',available:false}],conversation:null};}const value=await f.request(body);return changed&&body.action==='status'?{...value,accessRevision:'scope-2',projects:value.projects.map(p=>({...p,stale:true}))}:value;}});await c.refresh();await c.open('goal-1');changed=true;const pending=c.refresh();await new Promise(r=>setImmediate(r));assert.equal(c.getSnapshot().detail.evidence[0].available,false);assert.equal(c.getSnapshot().detail.evidence[0].text,undefined);assert.equal(c.getSnapshot().detail.project.stale,true);assert.equal(c.getSnapshot().target.sessionId,'dot-goal-1');gate.resolve();await pending;c.close();
});
test('uncertain native release closes the entire registry before another project may acquire an editor',async()=>{
 const {createGoalConversationRegistry:create}=module;assert.equal(typeof create,'function');let closed=false;const broken={getSnapshot:()=>({closed}),acquire:async()=>{closed=true;throw Error('release uncertain');},release(){},close(){closed=true;}};let projectCreated=0;const c=create({globalController:broken,createController:()=>{projectCreated++;return broken;}});await assert.rejects(c.acquire(null,'home',{sessionId:'main'}));await assert.rejects(c.acquire('p1','sheet',{sessionId:'dot-goal-1'}));assert.equal(projectCreated,0);assert.equal(c.getSnapshot().closed,true);c.close();
});

test('first dedicated conversation creation advances CAS revision before a project mutation',async()=>{
 const calls=[],row=project();let revision='b1';const status=()=>({version:1,revision,accessRevision:null,projects:[row],scan:{phase:'idle',coverage:[]},standaloneCount:0,uncertainCount:0});const c=goals({request:async body=>{calls.push(body);if(body.action==='status')return status();if(body.action==='detail')return{version:1,revision,accessRevision:null,project:row,evidence:[],conversation:null};if(body.action==='conversation'){revision='b2';return{version:1,projectId:row.id,conversation:{sessionId:'dot-goal-1',revision:'native:dot-goal-1'}};}if(body.action==='accept'){assert.equal(body.expectedRevision,'b2');return status();}}});await c.refresh();await c.open(row.id);assert.equal(c.getSnapshot().detail.revision,'b2');assert.equal(await c.mutate('accept'),true);assert.equal(calls.filter(r=>r.action==='conversation').length,1);c.close();
});
