import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {login} from '../vendor/dsh-wechat/dist/weixin/auth.js';
import {apply} from '../vendor/dsh-wechat/dist/index.js';
import {WeChatDSHBridge} from '../vendor/dsh-wechat/dist/bridge/bridge.js';
import {defaultConfig} from '../vendor/dsh-wechat/dist/config.js';
const confirmed={status:'confirmed',bot_token:'synthetic-nonusable',baseurl:'https://synthetic.invalid',ilink_bot_id:'synthetic-bot',ilink_user_id:'synthetic-user'};
const json=value=>new Response(JSON.stringify(value),{status:200});
async function fixture(t){const dir=await mkdtemp(join(tmpdir(),'dot-auth-lifecycle-'));const previous=globalThis.fetch;t.after(()=>{globalThis.fetch=previous;return rm(dir,{recursive:true,force:true});});return dir;}
const wait=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await new Promise(r=>setTimeout(r,2));}assert.fail('synthetic request not reached');};

test('aborted login cannot save a late confirmed token even if a transport ignores cancellation',async t=>{
 const dir=await fixture(t),controller=new AbortController();let release;
 globalThis.fetch=async u=>new URL(u).pathname.endsWith('get_bot_qrcode')?json({qrcode:'synthetic',qrcode_img_content:'https://synthetic.invalid/qr'}):new Promise(resolve=>{release=()=>resolve(json(confirmed));});
 const pending=login({baseUrl:'https://synthetic.invalid',storageDir:dir,signal:controller.signal,log:()=>{},renderQrUrl:()=>{}});
 await wait(()=>release);controller.abort();release();
 await assert.rejects(pending,e=>e.name==='AbortError');await assert.rejects(readFile(join(dir,'auth','token.json')),e=>e.code==='ENOENT');
});

test('already aborted login performs no QR request',async t=>{
 const dir=await fixture(t),controller=new AbortController();controller.abort();let calls=0;
 globalThis.fetch=async()=>{calls++;return json(confirmed);};
 await assert.rejects(login({baseUrl:'https://synthetic.invalid',storageDir:dir,signal:controller.signal,log:()=>{}}),e=>e.name==='AbortError');assert.equal(calls,0);
});

test('login passes cancellation to both provider requests and still supports a normal confirmation',async t=>{
 const dir=await fixture(t),controller=new AbortController(),signals=[];
 globalThis.fetch=async(u,options)=>{signals.push(options.signal);return json(new URL(u).pathname.endsWith('get_bot_qrcode')?{qrcode:'synthetic',qrcode_img_content:'https://synthetic.invalid/qr'}:confirmed);};
 await login({baseUrl:'https://synthetic.invalid',storageDir:dir,signal:controller.signal,log:()=>{},renderQrUrl:()=>{}});
 assert.deepEqual(signals,[controller.signal,controller.signal]);assert.equal(JSON.parse(await readFile(join(dir,'auth','token.json'))).token,confirmed.bot_token);
});

test('real embedded plugin disposal prevents an outstanding QR flow from writing token',async t=>{
 const dir=await fixture(t);let release;const quiet=()=>{};
 globalThis.fetch=async u=>new URL(u).pathname.endsWith('get_bot_qrcode')?json({qrcode:'synthetic',qrcode_img_content:'https://synthetic.invalid/qr'}):new Promise(resolve=>{release=()=>resolve(json(confirmed));});
 const cleanup=apply({on:()=>quiet,provide:quiet,inject:()=>quiet},{storageDir:dir});
 try{await wait(()=>release);await cleanup();release();await new Promise(r=>setTimeout(r,10));await assert.rejects(readFile(join(dir,'auth','token.json')),e=>e.code==='ENOENT');}
 finally{await cleanup();}
});

test('logout cancels a pending QR confirmation without saving a token or restarting the monitor',async t=>{
 const dir=await fixture(t);let release,starts=0;
 globalThis.fetch=async u=>new URL(u).pathname.endsWith('get_bot_qrcode')?json({qrcode:'synthetic',qrcode_img_content:'https://synthetic.invalid/qr'}):new Promise(resolve=>{release=()=>resolve(json(confirmed));});
 const bridge=new WeChatDSHBridge({get:()=>undefined},{...defaultConfig(),storageDir:dir});bridge.startMonitor=async()=>{starts++;};
 try{const pending=bridge.startLoginFlow();await wait(()=>release);await bridge.logout();release();await pending;
  await assert.rejects(readFile(join(dir,'auth','token.json')),e=>e.code==='ENOENT');assert.equal(starts,0);
 }finally{await bridge.stop();}
});

test('a stopped component rejects a late relogin handler without issuing another QR request',async t=>{
 const dir=await fixture(t);let calls=0;globalThis.fetch=async()=>{calls++;throw Error('must not request');};
 const bridge=new WeChatDSHBridge({get:()=>undefined},{...defaultConfig(),storageDir:dir});
 await bridge.stop();await bridge.startLoginFlow();assert.equal(calls,0);
});
