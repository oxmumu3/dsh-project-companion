import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,readdir,rm,realpath,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createProjectMemory} from '../src/project-memory.js';

async function fixture(t){
  const base=await realpath(await mkdtemp(join(tmpdir(),'companion-memory-edit-')));
  const root=join(base,'one'),other=join(base,'two');
  await mkdir(root);await mkdir(other);t.after(()=>rm(base,{recursive:true,force:true}));
  return {root,other};
}
const create=options=>createProjectMemory({authorizeRoot:async()=>true,...options});
const input=(root,text='原始助手推断')=>({root,sessionId:'original',kind:'decision',text,source:{kind:'assistant',reference:'session:original#turn1'}});
const edit=(root,id,text='用户纠正后的决定')=>({root,sessionId:'correction-session',id,text,userRequested:true});
const files=async root=>{
  const directory=join(root,'.dsh','dot-memory');
  return Object.fromEntries(await Promise.all((await readdir(directory)).map(async name=>[name,await readFile(join(directory,name))])));
};
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};

test('remember receipts identify saved and deduplicated notes without losing the bounded projection',async t=>{
  const {root}=await fixture(t),memory=create();t.after(()=>memory.close());
  const first=await memory.remember(input(root,'字'.repeat(2000))),again=await memory.remember(input(root,'字'.repeat(2000)));
  assert.equal(first.receipt?.status,'saved');assert.equal(again.receipt?.status,'deduped');
  assert.equal(first.receipt.action,'remember');assert.equal(first.receipt.id,first.entries[0].id);
  assert.equal(again.receipt.id,first.receipt.id);assert.equal(again.entries.length,1);
  assert.equal(first.receipt.text.length,280);assert.equal(first.receipt.truncated,true);
  assert.deepEqual(first.receipt.source,input(root).source);assert.equal(first.receipt.verified,false);
  assert.equal(first.entries[0].text.length,2000);
  assert.equal((await memory.inspect({root,sessionId:'view'})).receipt,undefined);
});

test('a correction is current-session user evidence while original assistant or file provenance survives restart',async t=>{
  const {root}=await fixture(t);let now=new Date('2026-10-18T20:00:00Z'),memory=create({clock:()=>now});
  const saved=await memory.remember(input(root));
  const file=await memory.remember({...input(root,'文件中的旧判断'),source:{kind:'file',reference:'README.md#L7'}});
  const originals=[saved.entries[0],file.entries.find(row=>row.text==='文件中的旧判断')];
  now=new Date('2026-10-19T20:00:00Z');
  for(const original of originals){
    const result=await memory.revise(edit(root,original.id,`纠正：${original.role}`));
    const changed=result.entries.find(row=>row.id===original.id);
    assert.equal(result.receipt.status,'revised');assert.equal(result.receipt.id,original.id);
    assert.equal(changed.role,'user');assert.deepEqual(changed.source,{kind:'user',reference:'session:correction-session'});
    assert.equal(changed.sessionId,'correction-session');assert.equal(changed.at,now.toISOString());assert.equal(changed.verified,false);
    assert.deepEqual(changed.origin,{source:original.source,sessionId:'original',at:original.at});
    assert.match(result.text,/用户纠正/);assert.match(result.text,/原始.*来源/);
  }
  await memory.close();memory=create();t.after(()=>memory.close());
  const restarted=await memory.inspect({root,sessionId:'view'});
  assert.equal(restarted.entries.length,2);
  assert.deepEqual(restarted.entries.find(row=>row.id===originals[0].id).origin.source,input(root).source);
  assert.deepEqual(restarted.entries.find(row=>row.id===originals[1].id).origin.source,{kind:'file',reference:'README.md#L7'});
  assert.doesNotMatch(restarted.text,/原始助手推断|文件中的旧判断/);
});

test('later corrections preserve the first provenance and refresh safe inspection without any inspection writes',async t=>{
  const {root}=await fixture(t),memory=create();t.after(()=>memory.close());
  const saved=await memory.remember(input(root));const original=saved.entries[0];
  await memory.revise(edit(root,original.id));
  const result=await memory.revise({...edit(root,original.id,'最终纠正内容'),sessionId:'later-session'});
  assert.equal(result.entries.length,1);assert.equal(result.entries[0].origin.source.kind,'assistant');
  assert.equal(result.entries[0].source.reference,'session:later-session');
  const before=await files(root),inspected=await memory.inspect({root,sessionId:'view'});
  assert.equal(inspected.entries[0].text,'最终纠正内容');assert.deepEqual(await files(root),before);
});

test('forget removes exactly the selected event and its searchable text durably',async t=>{
  const {root}=await fixture(t);let memory=create();
  const saved=await memory.remember(input(root,'应遗忘的内容'));
  await memory.remember(input(root,'需要保留的内容'));
  const id=saved.entries[0].id,result=await memory.forget(edit(root,id));
  assert.deepEqual(result.receipt,{action:'forget',status:'forgotten',id,kind:'decision'});
  assert.equal(result.entries.length,1);assert.equal(result.entries[0].text,'需要保留的内容');
  const before=await files(root);assert.doesNotMatch((await memory.inspect({root,sessionId:'view'})).text,/应遗忘的内容/);assert.deepEqual(await files(root),before);
  await memory.close();memory=create();t.after(()=>memory.close());
  assert.doesNotMatch((await memory.inspect({root,sessionId:'view'})).text,/应遗忘的内容/);
  await assert.rejects(memory.forget(edit(root,id)),/not found|不存在/i);
  const db=new DatabaseSync(join(root,'.dsh','dot-memory','memory.sqlite'),{readOnly:true});
  try{
    assert.equal(db.prepare('SELECT count(*) AS n FROM events WHERE id=?').get(id).n,0);
    assert.equal(db.prepare("SELECT count(*) AS n FROM yolo_fts WHERE row_type='event' AND row_id=?").get(id).n,0);
  }finally{db.close();}
});

test('correction replaces searchable text and keeps a dedupe receipt tied to the corrected current source',async t=>{
  const {root}=await fixture(t),memory=create();t.after(()=>memory.close());
  const saved=await memory.remember(input(root,'原始检索文本'));
  await memory.revise(edit(root,saved.entries[0].id,'替换后的检索文本'));
  const duplicate=await memory.remember({root,sessionId:'correction-session',kind:'decision',text:'替换后的检索文本',source:{kind:'user',reference:'session:correction-session'}});
  assert.equal(duplicate.receipt.status,'deduped');assert.equal(duplicate.receipt.id,saved.entries[0].id);
  const db=new DatabaseSync(join(root,'.dsh','dot-memory','memory.sqlite'),{readOnly:true});
  try{
    const rows=db.prepare("SELECT title,body FROM yolo_fts WHERE row_type='event' AND row_id=?").all(saved.entries[0].id);
    assert.equal(rows.length,1);assert.doesNotMatch(JSON.stringify(rows),/原始检索文本/);assert.match(JSON.stringify(rows),/替换后的检索文本/);
  }finally{db.close();}
});

test('edits require explicit intent, bounded values and a currently watched canonical root',async t=>{
  const {root,other}=await fixture(t);let enabled=true;const memory=create({authorizeRoot:async candidate=>enabled&&candidate===root});t.after(()=>memory.close());
  const saved=await memory.remember(input(root)),id=saved.entries[0].id,before=await files(root);
  for(const invalid of [{userRequested:false},{userRequested:'true'},{userRequested:undefined},{id:''},{id:'x'.repeat(201)},{sessionId:''}]){
    await assert.rejects(memory.revise({...edit(root,id),...invalid}));await assert.rejects(memory.forget({...edit(root,id),...invalid}));
  }
  for(const text of ['', 'x'.repeat(2001),'unsafe\u0000text'])await assert.rejects(memory.revise(edit(root,id,text)));
  await assert.rejects(memory.revise(edit(root+'/../one',id)),/canonical/i);
  await assert.rejects(memory.forget(edit(other,id)),/authoriz|watched/i);
  enabled=false;await assert.rejects(memory.revise(edit(root,id)),/authoriz|watched/i);await assert.rejects(memory.forget(edit(root,id)),/authoriz|watched/i);
  assert.deepEqual(await files(root),before);await assert.rejects(stat(join(other,'.dsh')),{code:'ENOENT'});
});

test('unknown and cross-project ids cannot edit another root or create an empty store',async t=>{
  const {root,other}=await fixture(t),memory=create();t.after(()=>memory.close());
  const first=await memory.remember(input(root)),id=first.entries[0].id;
  await assert.rejects(memory.revise(edit(other,id)),/not found|不存在/i);await assert.rejects(memory.forget(edit(other,id)),/not found|不存在/i);
  await assert.rejects(stat(join(other,'.dsh')),{code:'ENOENT'});
  const second=await memory.remember(input(other,'第二项目的记录')),otherId=second.entries[0].id;
  for(const method of ['revise','forget'])await assert.rejects(memory[method](edit(root,otherId)),/not found|不存在/i);
  assert.equal((await memory.read({root,sessionId:'view'})).entries[0].text,'原始助手推断');
  assert.equal((await memory.read({root:other,sessionId:'view'})).entries[0].text,'第二项目的记录');
});

test('foreign events and a changed owner are rejected without modifying their content',async t=>{
  const {root,other}=await fixture(t),memory=create();t.after(()=>memory.close());
  const saved=await memory.remember(input(root)),id=saved.entries[0].id;
  const path=join(root,'.dsh','dot-memory','memory.sqlite'),external=new DatabaseSync(path);
  external.prepare('UPDATE events SET detail=? WHERE id=?').run(JSON.stringify({owner:'foreign',kind:'decision',text:'foreign untouched',source:{kind:'user',reference:'session:external'}}),id);
  external.close();
  for(const method of ['revise','forget'])await assert.rejects(memory[method](edit(root,id)),/not found|owned|foreign|changed|不存在/i);
  const changedOwner=new DatabaseSync(path);changedOwner.prepare("UPDATE meta SET value=? WHERE key='dot_memory_root'").run(other);changedOwner.close();
  const before=await files(root);
  for(const method of ['revise','forget'])await assert.rejects(memory[method](edit(root,id)),/owner|foreign|changed/i);
  assert.deepEqual(await files(root),before);
});

test('remember capacity pruning preserves foreign events and their search index in the owned store',async t=>{
  const {root}=await fixture(t),memory=create();t.after(()=>memory.close());
  for(let index=0;index<10;index++)await memory.remember({...input(root,`目标 ${index}`),kind:'goal'});
  const path=join(root,'.dsh','dot-memory','memory.sqlite'),external=new DatabaseSync(path);
  const scope=external.prepare('SELECT scope_key FROM events LIMIT 1').get().scope_key;
  external.prepare('INSERT INTO events(id,kind,summary,detail,session_id,occurred_at,scope_key) VALUES(?,?,?,?,?,?,?)').run('foreign-entry','note','FOREIGN_UNTOUCHED',JSON.stringify({owner:'another-plugin',kind:'goal',text:'FOREIGN_UNTOUCHED'}),'foreign-session',0,scope);
  external.close();
  const result=await memory.remember({...input(root,'最新目标'),kind:'goal'});
  assert.equal(result.goals.length,10);
  const db=new DatabaseSync(path,{readOnly:true});
  try{
    assert.equal(db.prepare('SELECT summary FROM events WHERE id=?').get('foreign-entry')?.summary,'FOREIGN_UNTOUCHED');
    assert.equal(db.prepare("SELECT title FROM yolo_fts WHERE row_type='event' AND row_id=?").get('foreign-entry')?.title,'FOREIGN_UNTOUCHED');
  }finally{db.close();}
});

test('a binding revoked during asynchronous root selection prevents both memory edits before commit',async t=>{
  const {root}=await fixture(t);let selectionGate;
  const memory=create({authorizeRoot:async()=>{if(selectionGate){const gate=selectionGate;selectionGate=undefined;gate.entered.resolve();await gate.release.promise;}return true;}});t.after(()=>memory.close());
  const saved=await memory.remember(input(root,'绑定变更时必须保留的原文')),id=saved.receipt.id;
  const before=await files(root);
  for(const method of ['revise','forget']){
    const gate={entered:deferred(),release:deferred()};selectionGate=gate;
    let bound=true,guardCalls=0;
    const pending=memory[method]({...edit(root,id),authorizeMutation:async()=>{guardCalls++;return bound;}});
    await gate.entered.promise;bound=false;gate.release.resolve();
    await assert.rejects(pending,/mutation.*authoriz|no longer authorized/i);
    assert.equal(guardCalls,1);assert.deepEqual(await files(root),before);
    assert.equal((await memory.inspect({root,sessionId:'view'})).entries[0].text,'绑定变更时必须保留的原文');
  }
  const db=new DatabaseSync(join(root,'.dsh','dot-memory','memory.sqlite'),{readOnly:true});
  try{
    assert.equal(JSON.parse(db.prepare('SELECT detail FROM events WHERE id=?').get(id).detail).text,'绑定变更时必须保留的原文');
    assert.match(db.prepare("SELECT title FROM yolo_fts WHERE row_type='event' AND row_id=?").get(id).title,/绑定变更时必须保留的原文/);
  }finally{db.close();}
});

test('an optional asynchronous memory commit guard must explicitly return true',async t=>{
  const {root}=await fixture(t),memory=create();t.after(()=>memory.close());
  const saved=await memory.remember(input(root)),id=saved.receipt.id;
  for(const value of [undefined,null,false,'true']){
    await assert.rejects(memory.revise({...edit(root,id),authorizeMutation:async()=>value}),/mutation.*authoriz|no longer authorized/i);
    await assert.rejects(memory.forget({...edit(root,id),authorizeMutation:async()=>value}),/mutation.*authoriz|no longer authorized/i);
  }
  const revised=await memory.revise({...edit(root,id),authorizeMutation:async()=>true});
  assert.equal(revised.receipt.status,'revised');
  const forgotten=await memory.forget({...edit(root,id),authorizeMutation:async()=>true});
  assert.equal(forgotten.receipt.status,'forgotten');assert.deepEqual(forgotten.entries,[]);
});
