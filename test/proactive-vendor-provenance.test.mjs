import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=new URL('../vendor/proactive/',import.meta.url);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
test('proactive provenance preserves the upstream baseline and identifies exactly the local scheduler patch',async()=>{
 const manifest=JSON.parse(await readFile(new URL('SOURCE.json',root),'utf8'));
 assert.equal(manifest.license,'MIT');assert.equal(manifest.repository,'https://github.com/john-walks-slow/dsh-proactive');
 assert.deepEqual(Object.keys(manifest.files),Object.keys(manifest.upstreamFiles));
 const changed=[];
 for(const [path,expected]of Object.entries(manifest.files)){
  assert.equal(hash(await readFile(new URL(path,root))),expected,path);
  if(expected!==manifest.upstreamFiles[path])changed.push(path);
 }
 assert.deepEqual(changed,['lib/scheduler.js']);assert.equal(manifest.upstreamFiles['lib/scheduler.js'],'5806724d6b959a568ff8edf35fe040a1a3bb0be10b1d3b34c18dce7fa041f12c');
 assert.equal(manifest.localPatches.length,1);const patch=manifest.localPatches[0];assert.equal(patch.file,changed[0]);assert.equal(patch.upstreamSha256,manifest.upstreamFiles[patch.file]);assert.equal(patch.runtimeSha256,manifest.files[patch.file]);
 const notes=await readFile(new URL(patch.notes,root),'utf8');assert.ok(notes.includes(patch.upstreamSha256));assert.ok(notes.includes(patch.runtimeSha256));
 assert.deepEqual(await readFile(new URL('LICENSE',root)),await readFile(new URL('../third-party-licenses/dsh-proactive.txt',import.meta.url)));
});
