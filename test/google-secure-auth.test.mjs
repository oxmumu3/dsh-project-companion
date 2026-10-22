import test from 'node:test';
import assert from 'node:assert/strict';
const mod=await import('../src/google-secure-auth.js').catch(()=>null);
function fixture(source='googleSuite'){
 const events=[];
 const controller={start:async x=>{events.push(['start',x]);return{url:'https://accounts.google.com/fixture'};},getToken:async(...args)=>{events.push(['token',...args]);return'synthetic-access';},status:()=>({clientConfigured:true}),credentialState:()=>({configured:true,key:'stable'}),close:async()=>events.push(['close'])};
 const vault={status:()=>({supported:true}),migrateLegacy:async x=>events.push(['migrate',x]),prepare:async x=>events.push(['prepare',x])};
 assert.equal(typeof mod?.secureGoogleAuth,'function','Google auth enforces secure storage before token use');
 return{events,controller,vault,auth:mod.secureGoogleAuth({controller,vault,source})};
}
test('Google suite migrates and hydrates only its exact record before any token request',async()=>{
 const h=fixture(),guard=async()=>true,signal=new AbortController().signal;
 assert.equal(await h.auth.getToken('gmail',{authorizeMutation:guard,signal}),'synthetic-access');
 assert.deepEqual(h.events.map(x=>x[0]),['migrate','prepare','token']);
 for(const e of h.events.slice(0,2)){assert.equal(e[1].source,'googleSuite');assert.equal(e[1].authorizeMutation,guard);assert.equal(e[1].signal,signal);}
});
test('Calendar uses its own record and failed or rejected security preparation cannot reach Google',async()=>{
 const h=fixture('googleCalendar');h.vault.prepare=async()=>{throw Error('locked');};
 await assert.rejects(h.auth.getToken({authorizeMutation:async()=>true}));assert.equal(h.events.some(e=>e[0]==='token'),false);
});
test('new login can replace a lost encrypted grant without reading old keychain items',async()=>{
 const h=fixture(),guard=async()=>true;await h.auth.start({authorizeMutation:guard});
 assert.deepEqual(h.events.map(x=>x[0]),['start']);assert.equal(h.auth.credentialState().key,'stable');assert.equal(h.auth.status().clientConfigured,true);
});
test('unsupported safe storage rejects login before it asks Google for consent',async()=>{
 const h=fixture();h.vault.status=()=>({supported:false});await assert.rejects(h.auth.start({authorizeMutation:async()=>true}));assert.equal(h.events.length,0);
});
test('closing one auth controller does not close the shared vault or another record',async()=>{
 const h=fixture();await h.auth.close();assert.deepEqual(h.events,[['close']]);
});
