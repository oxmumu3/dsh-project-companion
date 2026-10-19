import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,symlink,link,rm,realpath,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';

async function api(){
  const module=await import('../src/project-memory.js').catch(()=>({}));
  assert.equal(typeof module.createProjectMemory,'function','scoped persistent project memory must exist');
  return module.createProjectMemory;
}
async function fixture(t){
  const base=await realpath(await mkdtemp(join(tmpdir(),'companion-memory-')));
  const root=join(base,'one');const other=join(base,'two');
  await mkdir(root);await mkdir(other);
  t.after(()=>rm(base,{recursive:true,force:true}));
  return {base,root,other};
}
const source={kind:'user',reference:'session:same-session#turn7'};
const allowed=(create,options={})=>create({authorizeRoot:async()=>true,...options});
const memoryInput=(root,kind='decision',text='先完成只读闭环')=>({root,sessionId:'same-session',kind,text,source});

test('project memory persists goals, decisions and original provenance across close and reopen',async t=>{
  const create=await api();const {root}=await fixture(t);
  let memory=allowed(create,{clock:()=>new Date('2026-10-19T05:30:00Z')});
  await memory.remember(memoryInput(root,'goal','让项目上下文持续可用'));
  await memory.remember(memoryInput(root));
  await memory.close();
  memory=allowed(create,{clock:()=>new Date('2026-10-19T05:31:00Z')});t.after(()=>memory.close());
  const view=await memory.read({root,sessionId:'another-session'});
  assert.equal(view.goals.length,1);assert.equal(view.entries.length,1);
  assert.equal(view.goals[0].text,'让项目上下文持续可用');
  assert.deepEqual(view.entries[0].source,source);
  assert.equal(view.entries[0].role,'user');
  assert.equal(view.entries[0].at,'2026-10-19T05:30:00.000Z');
  assert.equal(view.entries[0].sessionId,'same-session');
  assert.match(view.text,/先完成只读闭环/);assert.match(view.text,/turn7/);
  assert.match(view.text,/未.*验|不.*验|来源/);
  assert.ok((await stat(join(root,'.dsh','dot-memory','memory.sqlite'))).isFile());
});

test('identical memory is idempotent across concurrent calls and instances; source changes retain evidence',async t=>{
  const create=await api();const {root}=await fixture(t);
  const memory=allowed(create,);t.after(()=>memory.close());
  await Promise.all(Array.from({length:8},()=>memory.remember(memoryInput(root))));
  const second=allowed(create,);t.after(()=>second.close());
  await second.remember(memoryInput(root));
  await memory.remember({...memoryInput(root),source:{kind:'assistant',reference:'session:same-session#assistant'}});
  const view=await memory.read({root,sessionId:'same-session'});
  assert.equal(view.entries.length,2);
  assert.deepEqual(view.entries.map(e=>e.role).sort(),['assistant','user']);
});

test('different roots stay isolated even when they use the same session id; existing YOLO is untouched',async t=>{
  const create=await api();const {root,other}=await fixture(t);const memory=allowed(create,);t.after(()=>memory.close());
  await mkdir(join(root,'.dsh','yolo'),{recursive:true});
  const sentinel=join(root,'.dsh','yolo','private.db');await writeFile(sentinel,'PRIVATE_YOLO_UNTOUCHED');
  await memory.remember(memoryInput(root,'context','只属于第一个项目'));
  await memory.remember(memoryInput(other,'context','只属于第二个项目'));
  const a=await memory.read({root,sessionId:'same-session'});const b=await memory.read({root:other,sessionId:'same-session'});
  assert.match(a.text,/第一个项目/);assert.doesNotMatch(a.text,/第二个项目/);
  assert.match(b.text,/第二个项目/);assert.doesNotMatch(b.text,/第一个项目/);
  assert.equal(await readFile(sentinel,'utf8'),'PRIVATE_YOLO_UNTOUCHED');
});

test('empty reads do not create a directory or database',async t=>{
  const create=await api();const {root}=await fixture(t);const memory=allowed(create,);t.after(()=>memory.close());
  const result=await memory.read({root,sessionId:'s'});
  assert.deepEqual(result.goals,[]);assert.deepEqual(result.entries,[]);assert.deepEqual(result.changes,[]);
  await assert.rejects(stat(join(root,'.dsh')),{code:'ENOENT'});
});

test('authorization fails closed and is rechecked before using cached memory',async t=>{
  const create=await api();const {root,other}=await fixture(t);
  const denied=create();t.after(()=>denied.close());
  await assert.rejects(denied.read({root,sessionId:'s'}),/authoriz|watched/i);
  await assert.rejects(denied.remember(memoryInput(root)),/authoriz|watched/i);
  await assert.rejects(stat(join(root,'.dsh')),{code:'ENOENT'});
  let enabled=true;const calls=[];
  const memory=create({authorizeRoot:async candidate=>{calls.push(candidate);return enabled&&candidate===root;}});
  t.after(()=>memory.close());await memory.remember(memoryInput(root));
  await assert.rejects(memory.read({root:other,sessionId:'s'}),/authoriz|watched/i);
  enabled=false;await assert.rejects(memory.read({root,sessionId:'s'}),/authoriz|watched/i);
  await assert.rejects(memory.remember(memoryInput(root)),/authoriz|watched/i);
  assert.deepEqual(calls,[root,other,root,root]);
  await assert.rejects(stat(join(other,'.dsh')),{code:'ENOENT'});
});

test('source roles stay explicit, unsafe references are rejected and suggestions never become tasks',async t=>{
  const create=await api();const {root}=await fixture(t);const memory=allowed(create,);t.after(()=>memory.close());
  await memory.remember({...memoryInput(root,'blocker','助手声称已完成'),source:{kind:'assistant',reference:'session:same-session#assistant-unverified'}});
  await memory.remember({...memoryInput(root,'next_step','下一步仅作建议'),source:{kind:'file',reference:'README.md#L1'}});
  const result=await memory.read({root,sessionId:'s'});
  const raw=result.entries.find(e=>e.kind==='next_step');
  assert.deepEqual(raw.source,{kind:'file',reference:'README.md#L1'});assert.equal(raw.role,'file');
  assert.equal(result.entries.find(e=>e.kind==='blocker').role,'assistant');
  assert.ok(result.entries.every(e=>e.verified===false));
  const db=new DatabaseSync(join(root,'.dsh','dot-memory','memory.sqlite'),{readOnly:true});
  try{assert.equal(db.prepare('SELECT count(*) AS n FROM todos').get().n,0);}finally{db.close();}
});

test('memory has independent durable bounds of ten goals and one hundred notes',async t=>{
  const create=await api();const {root}=await fixture(t);let tick=Date.parse('2026-10-19T05:00:00Z');
  const memory=allowed(create,{clock:()=>new Date(tick++)});t.after(()=>memory.close());
  for(let i=0;i<13;i++)await memory.remember(memoryInput(root,'goal',`目标 ${i}`));
  for(let i=0;i<105;i++)await memory.remember(memoryInput(root,'context',`记录 ${i}`));
  const result=await memory.read({root,sessionId:'s'});
  assert.equal(result.goals.length,10);assert.equal(result.entries.length,100);
  assert.ok(result.goals.some(e=>e.text==='目标 12'));assert.ok(!result.goals.some(e=>e.text==='目标 0'));
  assert.ok(result.entries.some(e=>e.text==='记录 104'));assert.ok(!result.entries.some(e=>e.text==='记录 0'));
  const db=new DatabaseSync(join(root,'.dsh','dot-memory','memory.sqlite'),{readOnly:true});
  try{assert.equal(db.prepare('SELECT count(*) AS n FROM events').get().n,110);}finally{db.close();}
});

test('changes show only the current computer day without changing or executing stored suggestions',async t=>{
  const create=await api();const {root}=await fixture(t);let now=new Date(2026,9,17,12);
  const memory=allowed(create,{clock:()=>now});t.after(()=>memory.close());
  await memory.remember(memoryInput(root,'context','昨天的上下文'));
  now=new Date(2026,9,18,12);
  await memory.remember(memoryInput(root,'next_step','今天的建议'));
  const result=await memory.read({root,sessionId:'s'});
  assert.equal(result.entries.length,2);assert.equal(result.changes.length,1);
  assert.equal(result.changes[0].text,'今天的建议');
});

test('changes follow the supplied computer IANA day across UTC midnight',async t=>{
  const create=await api();const {root}=await fixture(t);let now=new Date('2026-10-18T12:00:00Z');
  let zone='America/Mexico_City';
  const memory=allowed(create,{clock:()=>now,hostTimeZone:()=>zone});t.after(()=>memory.close());
  await memory.remember(memoryInput(root,'context','墨西哥当地上午的记录'));
  now=new Date('2026-10-19T00:30:00Z');
  await memory.remember(memoryInput(root,'next_step','UTC跨日后仍是墨西哥同一天'));
  let result=await memory.read({root,sessionId:'s'});
  assert.equal(result.changes.length,2);
  zone='Asia/Shanghai';result=await memory.read({root,sessionId:'s'});
  assert.equal(result.changes.length,1);
  assert.equal(result.changes[0].text,'UTC跨日后仍是墨西哥同一天');
  const utc=allowed(create,{clock:()=>now,hostTimeZone:'UTC'});t.after(()=>utc.close());
  assert.equal((await utc.read({root,sessionId:'s'})).changes.length,1);
});

test('at most five SQLite handles stay open and LRU eviction preserves old memory',async t=>{
  const create=await api();const {base,root,other}=await fixture(t);
  const roots=[root,other];for(let i=2;i<6;i++){const path=join(base,`root-${i}`);await mkdir(path);roots.push(path);}
  const memory=allowed(create);t.after(()=>memory.close());
  for(let i=0;i<5;i++)await memory.remember(memoryInput(roots[i],'context',`项目 ${i}`));
  const wal=index=>join(roots[index],'.dsh','dot-memory','memory.sqlite-wal');
  assert.ok((await stat(wal(0))).isFile(),'the first connection is initially open');
  await memory.remember(memoryInput(roots[5],'context','项目 5'));
  await assert.rejects(stat(wal(0)),{code:'ENOENT'},'opening a sixth root closes the oldest SQLite connection');
  assert.ok((await stat(wal(5))).isFile());
  const reopened=await memory.read({root:roots[0],sessionId:'s'});
  assert.equal(reopened.entries[0].text,'项目 0');
  await assert.rejects(stat(wal(1)),{code:'ENOENT'},'reopening the oldest root evicts the next least recently used root');
  assert.equal((await memory.read({root:roots[5],sessionId:'s'})).entries[0].text,'项目 5');
});

test('user-sourced distilled memory does not claim a verbatim quotation',async t=>{
  const create=await api();const {root}=await fixture(t);const memory=allowed(create);t.after(()=>memory.close());
  const result=await memory.remember(memoryInput(root,'context','对用户请求的提炼'));
  assert.match(result.text,/用户来源/);assert.doesNotMatch(result.text,/用户原话/);
  assert.equal(result.entries[0].verified,false);assert.deepEqual(result.entries[0].source,source);
});

test('root and every data path component reject symlinks without reading the outside target',async t=>{
  const create=await api();const {base,root,other}=await fixture(t);
  await writeFile(join(other,'secret'),'PRIVATE_SENTINEL');
  const memory=allowed(create,);t.after(()=>memory.close());
  const alias=join(base,'alias');await symlink(root,alias);
  await assert.rejects(memory.remember(memoryInput(alias)),/symlink|symbolic|project root/i);
  for(const where of ['.dsh','.dsh/dot-memory','.dsh/dot-memory/memory.sqlite','.dsh/dot-memory/memory.sqlite-wal','.dsh/dot-memory/memory.sqlite-shm','.dsh/dot-memory/memory.sqlite-journal']){
    await rm(join(root,'.dsh'),{recursive:true,force:true});
    const target=join(root,where);await mkdir(join(target,'..'),{recursive:true});
    await symlink(other,target);
    await assert.rejects(memory.remember(memoryInput(root)),/symlink|symbolic|non.regular|unsafe/i,where);
  }
  assert.equal(await readFile(join(other,'secret'),'utf8'),'PRIVATE_SENTINEL');
});

test('cached database handles are not used after a file path is replaced; hardlinks are refused',async t=>{
  const create=await api();const {root,other}=await fixture(t);const memory=allowed(create,);t.after(()=>memory.close());
  await memory.remember(memoryInput(root));
  const path=join(root,'.dsh','dot-memory','memory.sqlite');
  await rm(path);await symlink(join(other,'foreign.db'),path);
  await assert.rejects(memory.read({root,sessionId:'s'}),/symlink|changed|unsafe/i);
  await memory.close();await rm(join(root,'.dsh'),{recursive:true,force:true});
  await mkdir(join(root,'.dsh','dot-memory'),{recursive:true});
  const foreign=join(other,'foreign.db');await writeFile(foreign,'untouched');await link(foreign,path);
  const second=allowed(create,);t.after(()=>second.close());
  await assert.rejects(second.remember(memoryInput(root)),/hardlink|link|unsafe/i);
  assert.equal(await readFile(foreign,'utf8'),'untouched');
});

test('adapter validates inputs, rejects foreign databases and closes permanently',async t=>{
  const create=await api();const {root}=await fixture(t);const memory=allowed(create,);
  for(const input of [
    {...memoryInput(root),kind:'task'},
    {...memoryInput(root),text:''},
    {...memoryInput(root),text:'x'.repeat(2001)},
    {...memoryInput(root),source:{kind:'tool',reference:'x'}},
    {...memoryInput(root),source:'unknown-role'},
    {...memoryInput(root),source:{kind:'user',reference:'session:someone-else'}},
    {...memoryInput(root),source:{kind:'file',reference:'../secret.md'}},
    {...memoryInput(root),source:{kind:'file',reference:'/private/secret.md'}},
    {...memoryInput(root),source:{kind:'file',reference:'x'.repeat(501)}},
    {...memoryInput(root),root:join(root,'..','one')+'/../one'},
  ])await assert.rejects(memory.remember(input));
  await mkdir(join(root,'.dsh','dot-memory'),{recursive:true});
  const path=join(root,'.dsh','dot-memory','memory.sqlite');const db=new DatabaseSync(path);
  db.exec('CREATE TABLE foreign_data(value TEXT)');db.close();const before=await readFile(path);
  await assert.rejects(memory.remember(memoryInput(root)),/owner|foreign|unrecogn/i);
  assert.deepEqual(await readFile(path),before);
  await memory.close();await memory.close();
  await assert.rejects(memory.read({root,sessionId:'s'}),/closed/i);
  await assert.rejects(memory.remember(memoryInput(root)),/closed/i);
});

test('vendored runtime matches its pinned-source manifest and retains the complete MIT notice',async()=>{
  const root=new URL('../vendor/yolo/',import.meta.url);
  const source=JSON.parse(await readFile(new URL('SOURCE.json',root),'utf8'));
  const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
  assert.equal(source.commit,'c87d70105f975d86c5c0f98f34fbce66657a6934');
  assert.equal(source.compilation.tool,'node:module.stripTypeScriptTypes');
  for(const file of source.files){
    assert.match(file.upstreamSha256,/^[a-f0-9]{64}$/);
    const runtime=await readFile(new URL(file.runtimePath,root));
    assert.equal(sha(runtime),file.runtimeSha256,file.runtimePath);
    assert.doesNotMatch(runtime.toString('utf8'),/from ['"]@deepseek-ai\//);
  }
  const license=await readFile(new URL('LICENSE',root));
  assert.equal(sha(license),source.licenseSha256);
  assert.match(license.toString('utf8'),/Copyright \(c\) 2026 dsh-plugin-yolo contributors/);
  assert.match(license.toString('utf8'),/THE SOFTWARE IS PROVIDED "AS IS"/);
});
