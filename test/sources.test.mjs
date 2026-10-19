import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
async function api(){const m=await import('../src/sources.js').catch(()=>({}));assert.equal(typeof m.readProjectFiles,'function','bounded project source reader must exist');return m;}
test('source reader uses fixed paths, byte caps and never follows file or parent symlinks',async t=>{
  const {readProjectFiles}=await api();
  const root=await realpath(await mkdtemp(join(tmpdir(),'companion-sources-')));t.after(()=>rm(root,{recursive:true,force:true}));
  const project=join(root,'project');await mkdir(project);await mkdir(join(project,'.agent','memory'),{recursive:true});
  await writeFile(join(project,'README.md'),'x'.repeat(20000));
  await writeFile(join(root,'secret.md'),'PRIVATE_SENTINEL');
  await symlink(join(root,'secret.md'),join(project,'.agent','memory','progress.md'));
  await writeFile(join(project,'.agent','memory','context.md'),'Synthetic context');
  let rows=await readProjectFiles(project);
  assert.equal(rows.length,3);
  assert.equal(rows.find(r=>r.path.endsWith('progress.md')).status,'rejected');
  assert.equal(rows.find(r=>r.path==='README.md').truncated,true);
  assert.ok(Buffer.byteLength(rows.find(r=>r.path==='README.md').text)<=16384);
  assert.doesNotMatch(JSON.stringify(rows),/PRIVATE_SENTINEL/);
  await rm(join(project,'.agent'),{recursive:true});await symlink(root,join(project,'.agent'));
  rows=await readProjectFiles(project);assert.equal(rows[0].status,'rejected');
});
test('GitHub fetch fixes the API host, rejects redirects and enforces bytes and timeout',async()=>{
  const {readGithubRelease}=await api();
  let call;
  const result=await readGithubRelease('example/public-project',{fetch:async(url,options)=>{call={url,options};return new Response(JSON.stringify({tag_name:'v2',html_url:'https://github.com/example/public-project/releases/tag/v2',published_at:'2026-10-17T00:00:00Z',body:'ignored'}),{status:200});}});
  assert.equal(call.url,'https://api.github.com/repos/example/public-project/releases/latest');assert.equal(call.options.redirect,'error');assert.ok(call.options.signal);assert.equal(result.tag,'v2');
  await assert.rejects(readGithubRelease('evil/../secret'),/owner\/repo/);
  await assert.rejects(readGithubRelease('example/repo',{fetch:async()=>new Response('',{status:302})}),/HTTP 302/);
  await assert.rejects(readGithubRelease('example/repo',{fetch:async()=>new Response('x'.repeat(262145))}),/size|large/);
});
