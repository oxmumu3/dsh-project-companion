import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,symlink,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {prepareOwnedWechatStorage} from '../src/bundled-wechat-storage.js';
async function profile(t){const root=await mkdtemp(join(tmpdir(),'dot-owned-storage-'));t.after(()=>rm(root,{recursive:true,force:true}));return{root,ctx:{get:name=>name==='profileContext'?{dir:root}:undefined}};}
test('fresh storage is inside the current profile and can be reopened without a new identity',async t=>{
 const {root,ctx}=await profile(t),dir=await prepareOwnedWechatStorage(ctx);assert.equal(dir,join(await realpath(root),'dot-wechat'));
 assert.equal(await prepareOwnedWechatStorage(ctx),dir);assert.equal(JSON.parse(await readFile(join(dir,'dot-owner.json'))).plugin,'dsh-project-companion');
});
test('existing unowned state is not claimed, read, overwritten or reset',async t=>{
 const {root,ctx}=await profile(t),dir=join(root,'dot-wechat');await mkdir(dir);const file=join(dir,'state.json');const original='PRIVATE_SYNTHETIC_BINDING_CANARY';await writeFile(file,original);
 await assert.rejects(prepareOwnedWechatStorage(ctx),e=>e.reason==='existing_storage');assert.equal(await readFile(file,'utf8'),original);
});
test('foreign profile marker is not silently rebound',async t=>{
 const {ctx}=await profile(t),dir=await prepareOwnedWechatStorage(ctx),marker=join(dir,'dot-owner.json');const text=JSON.stringify({version:1,plugin:'dsh-project-companion',profileDir:'/synthetic-other-profile'});await writeFile(marker,text);
 await assert.rejects(prepareOwnedWechatStorage(ctx),e=>e.reason==='existing_storage');assert.equal(await readFile(marker,'utf8'),text);
});
test('symlinked storage is rejected without following it',async t=>{
 const {root,ctx}=await profile(t);const other=join(root,'other');await mkdir(other);await symlink(other,join(root,'dot-wechat'));
 await assert.rejects(prepareOwnedWechatStorage(ctx),e=>e.reason==='existing_storage');
});
test('bound owned storage with a missing token cannot be reset by upstream start',async t=>{
 const {ctx}=await profile(t),dir=await prepareOwnedWechatStorage(ctx),file=join(dir,'state.json');const text=JSON.stringify({users:{synthetic:{userId:'synthetic',sessionId:'synthetic-session'}}});await writeFile(file,text);
 await assert.rejects(prepareOwnedWechatStorage(ctx),e=>e.reason==='bound_token_unavailable');assert.equal(await readFile(file,'utf8'),text);
});
test('malformed owned auth and malformed state remain unchanged',async t=>{
 const {ctx}=await profile(t),dir=await prepareOwnedWechatStorage(ctx);await mkdir(join(dir,'auth'));const file=join(dir,'auth','token.json');await writeFile(file,'{bad-synthetic');
 await assert.rejects(prepareOwnedWechatStorage(ctx),e=>e.reason==='storage_unavailable');assert.equal(await readFile(file,'utf8'),'{bad-synthetic');
});
test('valid own synthetic binding and token are resumed without rewriting either file',async t=>{
 const {ctx}=await profile(t),dir=await prepareOwnedWechatStorage(ctx);await mkdir(join(dir,'auth'));
 const state=JSON.stringify({users:{synthetic:{userId:'synthetic'}}}),token=JSON.stringify({token:'synthetic-nonusable',baseUrl:'https://synthetic.invalid',accountId:'synthetic',userId:'synthetic'});
 await writeFile(join(dir,'state.json'),state);await writeFile(join(dir,'auth','token.json'),token);
 assert.equal(await prepareOwnedWechatStorage(ctx),dir);assert.equal(await readFile(join(dir,'state.json'),'utf8'),state);assert.equal(await readFile(join(dir,'auth','token.json'),'utf8'),token);
});
