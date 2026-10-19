import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const hash=value=>createHash('sha256').update(value).digest('hex');
const ctx=origin=>({get:name=>name==='webServer'?{getOrigin:()=>origin}:undefined});
const status=(overrides={})=>({userCount:1,users:[{userId:'synthetic-user',sessionId:'source-session'}],botId:'synthetic-bot',qrUrl:'DO_NOT_RETURN_QR',config:{secret:'DO_NOT_RETURN_CONFIG'},error:'DO_NOT_RETURN_ERROR',...overrides});
async function api(){const m=await import('../src/wechat-route.js').catch(()=>({}));assert.equal(typeof m.readWechatBinding,'function','safe WeChat route reader must exist');return m;}

test('route reads only official loopback status and returns identity hashes only',async()=>{
  const {readWechatBinding}=await api();let request;
  const binding=await readWechatBinding(ctx('http://127.0.0.1:12345'),'source-session',{fetch:async(url,options)=>{request={url:String(url),options,abortedAtFetch:options.signal.aborted};return Response.json(status());}});
  assert.deepEqual(binding,{userHash:hash('synthetic-user'),botHash:hash('synthetic-bot')});
  assert.equal(request.url,'http://127.0.0.1:12345/wechat/api/status');assert.equal(request.options.method,'GET');assert.equal(request.options.redirect,'error');
  assert.ok(request.options.signal instanceof AbortSignal);assert.equal(request.abortedAtFetch,false);
  assert.equal(JSON.stringify(binding).includes('synthetic-'),false);
});

test('route rejects missing or remote origins without fetching and accepts loopback IPv6',async()=>{
  const {readWechatBinding}=await api();let calls=0;const fetch=async()=>{calls++;return Response.json(status());};
  for(const origin of [undefined,'https://example.com','http://127.0.0.1.example.com','http://192.168.1.2:80','file:///tmp/socket','http://user:pass@localhost:1234','http://localhost:1234/path'])assert.equal(await readWechatBinding(ctx(origin),'source-session',{fetch}),null);
  assert.equal(await readWechatBinding({get:()=>undefined},'source-session',{fetch}),null);assert.equal(calls,0);
  assert.ok(await readWechatBinding(ctx('http://[::1]:12345'),'source-session',{fetch}));assert.equal(calls,1);
});

test('route requires exactly one real user bound to the exact original session',async()=>{
  const {readWechatBinding}=await api();
  const invalid=[{userCount:0,users:[]},{userCount:2},{userCount:1,users:[]},{users:[{userId:'synthetic-user',sessionId:'other-session'}]},{users:[{userId:'',sessionId:'source-session'}]},{users:[{sessionId:'source-session'}]},{users:[{userId:'a',sessionId:'source-session'},{userId:'b',sessionId:'source-session'}]},{userCount:'1'}];
  for(const value of invalid)assert.equal(await readWechatBinding(ctx('http://localhost:1234'),'source-session',{fetch:async()=>Response.json(status(value))}),null,JSON.stringify(value));
  assert.deepEqual(await readWechatBinding(ctx('http://localhost:1234'),'source-session',{fetch:async()=>Response.json(status({botId:undefined}))}),{userHash:hash('synthetic-user')});
});

test('route fails closed on redirects, errors, invalid JSON, oversized or timed-out status',async()=>{
  const {readWechatBinding}=await api();const host=ctx('http://localhost:1234');
  for(const fetch of [async()=>new Response('',{status:302,headers:{location:'/elsewhere'}}),async()=>new Response('',{status:500}),async()=>new Response('{'),async()=>Response.json(status(),{headers:{'content-length':'65537'}}),async()=>new Response('x'.repeat(65537)),async()=>{throw new Error('SYNTHETIC_PRIVATE_EXCEPTION');}])assert.equal(await readWechatBinding(host,'source-session',{fetch}),null);
  const started=Date.now();assert.equal(await readWechatBinding(host,'source-session',{fetch:async(_url,{signal})=>new Promise((_resolve,reject)=>{signal.addEventListener('abort',()=>reject(signal.reason),{once:true});})}),null);
  assert.ok(Date.now()-started<3500,'status check must stop within a short bounded timeout');
});

test('route classification proves an unbound session without confusing unavailable status',async()=>{
  const m=await api();assert.equal(typeof m.readWechatRoute,'function');const host=ctx('http://localhost:1234');
  assert.deepEqual(await m.readWechatRoute(host,'native-session',{fetch:async()=>Response.json(status())}),{kind:'unbound'});
  assert.deepEqual(await m.readWechatRoute(host,'native-session',{fetch:async()=>Response.json(status({userCount:0,users:[]}))}),{kind:'unbound'});
  assert.deepEqual(await m.readWechatRoute(host,'source-session',{fetch:async()=>Response.json(status())}),{kind:'bound',binding:{userHash:hash('synthetic-user'),botHash:hash('synthetic-bot')}});
  for(const fetch of [async()=>new Response('',{status:503}),async()=>Response.json(status({userCount:2})),async()=>Response.json(status({users:[{userId:'x'}]})),async()=>{throw new Error('SYNTHETIC_PRIVATE_FAILURE');}])assert.deepEqual(await m.readWechatRoute(host,'native-session',{fetch}),{kind:'unknown'});
});

test('setup route distinguishes QR, first-message and bound states without exposing bridge secrets',async()=>{
  const m=await api();assert.equal(typeof m.readWechatSetup,'function');const host=ctx('http://localhost:1234');
  const read=value=>m.readWechatSetup(host,{fetch:async()=>Response.json(status(value))});
  const bound=await read({phase:'logged-in'});assert.equal(bound.state,'bound');assert.equal(bound.sessionId,'source-session');assert.match(bound.bindingKey,/^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(bound).includes('synthetic-user'));assert.ok(!JSON.stringify(bound).includes('DO_NOT_RETURN'));
  const qr=await read({phase:'waiting-qr',userCount:0,users:[],qrUrl:'https://example.test/SYNTHETIC_QR'});
  assert.equal(qr.state,'waiting-qr');assert.equal(qr.qrAvailable,true);assert.match(qr.qrRevision,/^[a-f0-9]{16}$/);assert.ok(!JSON.stringify(qr).includes('example.test'));
  assert.equal((await read({phase:'logged-in',userCount:0,users:[]})).state,'awaiting-message');
  assert.equal((await read({phase:'scaned',userCount:0,users:[]})).state,'scanned');
  assert.equal((await read({phase:'waiting-qr',userCount:2})).state,'unknown');
  assert.equal((await m.readWechatSetup(host,{fetch:async()=>new Response('',{status:404})})).state,'missing');
});
