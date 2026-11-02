import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WeChatDSHBridge} from '../vendor/dsh-wechat/dist/bridge/bridge.js';
import {defaultConfig} from '../vendor/dsh-wechat/dist/config.js';
import {saveToken} from '../vendor/dsh-wechat/dist/weixin/auth.js';

const scanner='synthetic-scanner', stranger='synthetic-stranger';
const credentials={accountId:'synthetic-bot',userId:scanner,token:'synthetic-nonusable',baseUrl:'https://synthetic.invalid'};
const message=(userId,id=1)=>({message_type:1,message_id:id,from_user_id:userId,context_token:'synthetic-context',item_list:[{type:1,text_item:{text:'synthetic instruction'}}]});
async function fixture(t,{token=credentials,allowedUsers=[],savedUser}={}){
 const dir=await mkdtemp(join(tmpdir(),'dot-safe-pairing-'));
 const bridge=new WeChatDSHBridge({get:()=>undefined},{...defaultConfig(),storageDir:dir,allowedUsers});
 if(savedUser){bridge.state.ensureUser(savedUser,'/synthetic');bridge.state.update(savedUser,{sessionId:'synthetic-session'});}
 saveToken(dir,token);bridge.startMonitor=async()=>{};await bridge.start();
 t.after(async()=>{await bridge.stop();await rm(dir,{recursive:true,force:true});});
 return{bridge,dir};
}

test('QR scanner is pinned before the first inbound without creating a session or editing allowlist',async t=>{
 const {bridge}=await fixture(t);
 assert.equal(bridge.peerUserId,scanner);
 assert.deepEqual(bridge.state.all(),[]);
 assert.deepEqual(bridge.config.allowedUsers,[]);
});

test('a stranger arriving first cannot enter command handling or reserve dedupe state',async t=>{
 const {bridge}=await fixture(t),accepted=[];
 bridge.processMessage=async msg=>accepted.push(msg.from_user_id);
 await bridge.handleMessage(message(stranger));
 await bridge.handleMessage(message(scanner));
 assert.deepEqual(accepted,[scanner]);
 assert.equal(bridge.seenInbound.size,1);
 assert.equal(bridge.peerUserId,scanner);
});

test('missing QR identity and empty allowlist cannot turn any first sender into owner',async t=>{
 const {bridge}=await fixture(t,{token:{...credentials,userId:undefined}}),accepted=[];
 bridge.processMessage=async msg=>accepted.push(msg.from_user_id);
 await bridge.handleMessage(message(stranger));
 assert.deepEqual(accepted,[]);assert.equal(bridge.peerUserId,null);
 assert.equal(bridge.getStatus().phase,'failed');
 assert.match(bridge.getStatus().error,/重新扫码/);
});

test('a conflicting saved peer is preserved but cannot receive or execute',async t=>{
 const {bridge,dir}=await fixture(t,{savedUser:stranger});
 const before=await readFile(join(dir,'state.json'),'utf8'),accepted=[];
 bridge.processMessage=async msg=>accepted.push(msg.from_user_id);
 await bridge.handleMessage(message(stranger));await bridge.handleMessage(message(scanner));
 assert.deepEqual(accepted,[]);assert.equal(bridge.peerUserId,null);
 assert.equal(bridge.getStatus().phase,'failed');
 assert.equal(await readFile(join(dir,'state.json'),'utf8'),before);
 const fetch=globalThis.fetch;t.after(()=>{globalThis.fetch=fetch;});let sends=0;
 globalThis.fetch=async()=>{sends++;return Response.json({ret:0});};
 assert.equal(await bridge.deliverOutbound(stranger,{kind:'text',text:'synthetic private reply'}),'failed');
 assert.equal(sends,0);
});

test('matching saved scanner reuses its session unchanged after restart',async t=>{
 const {bridge,dir}=await fixture(t,{savedUser:scanner});
 const before=await readFile(join(dir,'state.json'),'utf8');
 assert.equal(bridge.peerUserId,scanner);
 assert.equal(bridge.state.all()[0].sessionId,'synthetic-session');
 assert.equal(await readFile(join(dir,'state.json'),'utf8'),before);
});

test('an explicit single local allowlist can authorize legacy credentials without a QR identity',async t=>{
 const {bridge}=await fixture(t,{token:{...credentials,userId:undefined},allowedUsers:[scanner],savedUser:scanner});
 const accepted=[];bridge.processMessage=async msg=>accepted.push(msg.from_user_id);
 await bridge.handleMessage(message(stranger));await bridge.handleMessage(message(scanner));
 assert.deepEqual(accepted,[scanner]);assert.equal(bridge.peerUserId,scanner);
});

test('revocation while an earlier flush waits stops the subsequent command mutation',async t=>{
 const {bridge}=await fixture(t);bridge.outboundCache=[{kind:'text',text:'synthetic'}];
 let release,reached;const entered=new Promise(resolve=>{reached=resolve;});
 bridge.flushPending=()=>{reached();return new Promise(resolve=>{release=()=>resolve({attempted:true,sent:0,remaining:1,dropped:0});});};
 const pending=bridge.processMessage({...message(scanner),item_list:[{type:1,text_item:{text:'/silent on'}}]});
 await entered;await bridge.updateConfig({allowedUsers:[stranger]});release();await pending;
 assert.equal(bridge.config.silent,false);
});

test('re-login retains the old session mapping instead of deleting users',async t=>{
 const {bridge,dir}=await fixture(t,{savedUser:scanner});
 const before=await readFile(join(dir,'state.json'),'utf8');bridge.startLoginFlow=async()=>{};
 await bridge.relogin();
 assert.equal(bridge.state.all()[0]?.sessionId,'synthetic-session');
 assert.equal(await readFile(join(dir,'state.json'),'utf8'),before);
});

test('config revocation prevents a transport retry after a definitely unsent attempt',async t=>{
 const {bridge}=await fixture(t,{savedUser:scanner});let sends=0;const previous=globalThis.fetch;t.after(()=>{globalThis.fetch=previous;});
 globalThis.fetch=async()=>{sends++;bridge.config.allowedUsers=[stranger];throw Object.assign(Error('synthetic refusal'),{code:'ECONNREFUSED'});};
 assert.equal(await bridge.deliverOutbound(scanner,{kind:'text',text:'synthetic reply'}),'failed');
 assert.equal(sends,1);
 assert.equal(bridge.outboundCache.length,0,'revoked payload must not be parked for another operator');
});

test('revocation while agent resolution waits cannot start a followup turn',async t=>{
 const {bridge}=await fixture(t,{savedUser:scanner});let release,reached,turns=0;
 const entered=new Promise(resolve=>{reached=resolve;});
 bridge.agents.ensure=()=>{reached();return new Promise(resolve=>{release=()=>resolve({agent:{id:'synthetic-session'}});});};
 bridge.agents.followup=()=>{turns++;};
 const pending=bridge.forwardToAgent(bridge.state.all()[0],message(scanner),{attempted:false,sent:0,remaining:0,dropped:0});
 await entered;await bridge.updateConfig({allowedUsers:[stranger]});release();await pending;
 assert.equal(turns,0);
});

test('re-login with a queued reply retains it locally without dispatching or changing its owner',async t=>{
 const {bridge,dir}=await fixture(t,{savedUser:scanner});
 bridge.outboundCache=[{kind:'text',text:'synthetic original queue'}];bridge.persistOutboundState(scanner);
 const before=await readFile(join(dir,'state.json'),'utf8');bridge.startLoginFlow=async()=>{};
 const previous=globalThis.fetch;t.after(()=>{globalThis.fetch=previous;});let sends=0;globalThis.fetch=async()=>{sends++;assert.fail('no network during re-login');};
 await bridge.relogin();
 assert.equal(await readFile(join(dir,'state.json'),'utf8'),before);
 assert.equal(bridge.outboundCache.length,1);assert.equal(sends,0);assert.equal(bridge.peerUserId,null);
});

test('media cannot upload after an upload-URL response revokes pairing',async t=>{
 const {bridge}=await fixture(t,{savedUser:scanner});
 const previous=globalThis.fetch;t.after(()=>{globalThis.fetch=previous;});let calls=0;
 globalThis.fetch=async url=>{calls++;assert.equal(new URL(url).pathname,'/ilink/bot/getuploadurl');bridge.config.allowedUsers=[stranger];return Response.json({upload_param:'synthetic',upload_full_url:'https://synthetic.invalid/upload'});};
 const {sendMediaMessage}=await import('../vendor/dsh-wechat/dist/weixin/send.js');
 await assert.rejects(sendMediaMessage(scanner,3,Buffer.from('synthetic'),{baseUrl:credentials.baseUrl,token:credentials.token,cdnBaseUrl:credentials.baseUrl,authorize:()=>bridge.isAuthorizedPeer(scanner)}),{code:'PEER_AUTHORIZATION_CHANGED'});
 assert.equal(calls,1);
});

test('conflicting allowlist cannot replace a verified scanner even when its sender arrives first',async t=>{
 const {bridge}=await fixture(t,{allowedUsers:[stranger]});let processed=0;bridge.processMessage=async()=>{processed++;};
 await bridge.handleMessage(message(stranger));await bridge.handleMessage(message(scanner));
 assert.equal(processed,0);assert.equal(bridge.peerUserId,null);assert.equal(bridge.getStatus().phase,'failed');
});

test('direct processMessage cannot bypass ingress authorization',async t=>{
 const {bridge}=await fixture(t);let created=0;bridge.ensureBoundUser=()=>{created++;assert.fail('stranger cannot create user');};
 await bridge.processMessage(message(stranger));assert.equal(created,0);assert.equal(bridge.wireContextToken,null);
});

test('the scanned owner can use the real command path without manual allowlist entry',async t=>{
 const {bridge}=await fixture(t);const previous=globalThis.fetch;t.after(()=>{globalThis.fetch=previous;});const recipients=[];
 globalThis.fetch=async(url,options)=>{assert.equal(new URL(url).hostname,'synthetic.invalid');recipients.push(JSON.parse(options.body).msg.to_user_id);return Response.json({ret:0});};
 await bridge.handleMessage({...message(scanner),item_list:[{type:1,text_item:{text:'/silent on'}}]});
 assert.equal(bridge.config.silent,true);assert.equal(bridge.state.all().length,1);assert.equal(bridge.state.all()[0].userId,scanner);
 assert.deepEqual(recipients,[scanner]);assert.deepEqual(bridge.config.allowedUsers,[]);
});

test('normal QR confirmation pins scanner before starting the poller and does not create a session',async t=>{
 const {bridge}=await fixture(t);await bridge.logout();let startedPeer;
 bridge.startMonitor=async()=>{startedPeer=bridge.peerUserId;};
 const previous=globalThis.fetch;t.after(()=>{globalThis.fetch=previous;});
 globalThis.fetch=async url=>{assert.equal(new URL(url).hostname,'ilinkai.weixin.qq.com');return Response.json(new URL(url).pathname.endsWith('get_bot_qrcode')?{qrcode:'synthetic',qrcode_img_content:'https://synthetic.invalid/qr'}:{status:'confirmed',bot_token:credentials.token,baseurl:credentials.baseUrl,ilink_bot_id:credentials.accountId,ilink_user_id:scanner});};
 await bridge.startLoginFlow();
 assert.equal(startedPeer,scanner);assert.equal(bridge.getStatus().phase,'logged-in');assert.deepEqual(bridge.state.all(),[]);
});

test('ambiguous legacy allowlist or malformed QR identity cannot authorize a saved first sender',async t=>{
 for(const token of [{...credentials,userId:undefined},{...credentials,userId:''},{...credentials,userId:'bad identity'}]){
  const {bridge}=await fixture(t,{token,allowedUsers:[scanner,stranger],savedUser:scanner});
  assert.equal(bridge.peerUserId,null);assert.equal(bridge.getStatus().phase,'failed');
 }
});

test('workspace resolution cannot commit a switch after the original admission is revoked',async t=>{
 const {bridge}=await fixture(t,{savedUser:scanner});let release,reached;
 const entered=new Promise(resolve=>{reached=resolve;});
 bridge.ops.resolveWorkspaceByPath=()=>{reached();return new Promise(resolve=>{release=()=>resolve({path:'/synthetic-after',title:'Synthetic',sessionIds:['replacement-session']});});};
 bridge.ops.listWorkspaces=()=>[{path:'/synthetic-after',sessionIds:['replacement-session']}];bridge.ops.archivedSessionIds=()=>[];bridge.sendReply=async()=>{};
 const pending=bridge.handleMessage({...message(scanner),item_list:[{type:1,text_item:{text:'/workspace switch /synthetic-after'}}]});
 await entered;await bridge.updateConfig({allowedUsers:[stranger]});release();await pending;
 assert.equal(bridge.state.all()[0].cwd,'/synthetic');assert.equal(bridge.state.all()[0].sessionId,'synthetic-session');
});

test('batch approvals stop after the first settlement revokes the original admission',async t=>{
 const {bridge}=await fixture(t,{savedUser:scanner});const settled=[];bridge.sendReply=async()=>{};
 bridge.pendingApprovals.set(scanner,[{rpcId:'one',sessionId:'synthetic-session',toolName:'synthetic',settleWechat:()=>{settled.push('one');bridge.config.allowedUsers=[stranger];}},{rpcId:'two',sessionId:'synthetic-session',toolName:'synthetic',settleWechat:()=>settled.push('two')}]);
 await bridge.handleMessage({...message(scanner),item_list:[{type:1,text_item:{text:'P1=1 P2=1'}}]});
 assert.deepEqual(settled,['one']);
});

test('real AgentStore cannot fall back to creating or rebinding after revoked resume fails',async t=>{
 const {bridge}=await fixture(t,{savedUser:scanner});let release,reached,created=0;
 const entered=new Promise(resolve=>{reached=resolve;});
 const agents={get:()=>undefined,resume:()=>{reached();return new Promise((_resolve,reject)=>{release=()=>reject(Error('synthetic resume unavailable'));});},create:async()=>{created++;return{agent:{id:'synthetic-created'}};}};
 bridge.ctx.get=name=>name==='agents'?agents:undefined;bridge.sendReply=async()=>{};
 const pending=bridge.handleMessage(message(scanner));await entered;await bridge.updateConfig({allowedUsers:[stranger]});release();await pending;
 assert.equal(created,0);assert.equal(bridge.state.all()[0].sessionId,'synthetic-session');
});

test('restart during re-scan preserves the old binding and keeps the recovery component mountable',async t=>{
 const {prepareOwnedWechatStorage}=await import('../src/bundled-wechat-storage.js');
 const {mkdir,writeFile}=await import('node:fs/promises');
 const root=await mkdtemp(join(tmpdir(),'dot-pairing-interrupted-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const ctx={get:name=>name==='profileContext'?{dir:root}:undefined};const dir=await prepareOwnedWechatStorage(ctx);
 const bridge=new WeChatDSHBridge(ctx,{...defaultConfig(),storageDir:dir});bridge.state.ensureUser(scanner,'/synthetic');bridge.state.update(scanner,{sessionId:'synthetic-session'});saveToken(dir,credentials);bridge.startMonitor=async()=>{};await bridge.start();
 bridge.startLoginFlow=async()=>{};const before=await readFile(join(dir,'state.json'),'utf8');await bridge.relogin();await bridge.stop();
 assert.equal(await prepareOwnedWechatStorage(ctx),dir);assert.equal(await readFile(join(dir,'state.json'),'utf8'),before);
 const restarted=new WeChatDSHBridge(ctx,{...defaultConfig(),storageDir:dir});restarted.startLoginFlow=async()=>{restarted.loginState={phase:'waiting-qr',qrUrl:'https://synthetic.invalid/recovery'};};
 try{await restarted.start();assert.equal(restarted.peerUserId,null);assert.equal(restarted.getStatus().phase,'waiting-qr');assert.equal(await readFile(join(dir,'state.json'),'utf8'),before);}finally{await restarted.stop();}
});
