import test from 'node:test';
import assert from 'node:assert/strict';
import {createGoogleSuiteAuth,GOOGLE_SUITE_SCOPES} from '../src/google-suite-auth.js';
const publisher={clientId:'network-fixture.apps.googleusercontent.com',clientSecret:'public-desktop-fixture',kind:'desktop'};
const original=JSON.stringify({version:1,source:'google-suite',profile:'readonly',connectionId:'synthetic-existing',clientId:publisher.clientId,requestedScopes:[...GOOGLE_SUITE_SCOPES],grantedScopes:[...GOOGLE_SUITE_SCOPES],refreshToken:'synthetic-existing-refresh',authorizedAt:'2026-10-01T12:00:00.000Z'});
const reply=()=>Response.json({access_token:'synthetic-new-access',refresh_token:'synthetic-new-refresh',expires_in:3600,token_type:'Bearer',scope:GOOGLE_SUITE_SCOPES.join(' ')});
const failed=code=>new TypeError('fetch failed PRIVATE',{cause:Object.assign(Error('PRIVATE host address'),{code})});
function fixture(t,fetchImpl,options={}){
 let config={googleSuiteOAuthCredentials:original},allowed=true,reads=0;
 const calls=[],saves=[];const guard=async()=>allowed;
 const h={calls,saves,guard,deny:()=>{allowed=false;},replace:()=>{config={googleSuiteOAuthCredentials:'synthetic-replacement'};},current:()=>config.googleSuiteOAuthCredentials};
 const auth=createGoogleSuiteAuth({publisher,readConfig:()=>{reads++;return options.readConfig?.(reads,config)??{...config};},fetch:async(url,init)=>{calls.push({url,init});return fetchImpl(h,url,init);},saveCredentials:async(value,conditions)=>{assert.equal(await conditions.authorizeMutation(),true);assert.equal(config.googleSuiteOAuthCredentials,conditions.expectedValue);config.googleSuiteOAuthCredentials=value;saves.push(value);}});
 h.auth=auth;t.after(()=>auth.close());return h;
}
async function login(h){const s=await h.auth.start({authorizeMutation:h.guard}),u=new URL(s.url),cb=new URL(u.searchParams.get('redirect_uri'));cb.searchParams.set('state',u.searchParams.get('state'));cb.searchParams.set('code','synthetic-only-code');return fetch(cb);}
test('pre-fetch configuration read failure stays guard and sends nothing',async t=>{
 const h=fixture(t,()=>reply(),{readConfig:(count,config)=>{if(count===5)throw Error('PRIVATE config unavailable');return{...config};}});const response=await login(h);assert.equal(response.status,400);assert.equal(h.calls.length,0);assert.equal(h.auth.status().lastAttempt.reason,'connection_changed');assert.equal(h.current(),original);
});
for(const code of ['UND_ERR_CONNECT_TIMEOUT','EAI_AGAIN','ENOTFOUND','ECONNREFUSED'])test(`retry once only after ${code}, same fixed endpoint body signal and original deadline`,async t=>{
 const h=fixture(t,h=>{if(h.calls.length===1)throw failed(code);return reply();});const response=await login(h);assert.equal(response.status,200);assert.equal(h.calls.length,2);assert.equal(h.saves.length,1);assert.equal(h.calls[0].url,'https://oauth2.googleapis.com/token');assert.equal(h.calls[1].url,h.calls[0].url);assert.equal(h.calls[1].init.body,h.calls[0].init.body);assert.equal(h.calls[1].init.signal,h.calls[0].init.signal);
});
test('two connect failures stop at two, preserve old credentials, expose only fixed classification',async t=>{
 const h=fixture(t,()=>{throw failed('UND_ERR_CONNECT_TIMEOUT');});const response=await login(h);assert.equal(response.status,400);assert.equal(h.calls.length,2);assert.equal(h.current(),original);assert.equal(h.saves.length,0);assert.equal(h.auth.status().lastAttempt.reason,'network');assert.equal(h.auth.status().lastAttempt.networkFailure,'connect_timeout');assert.doesNotMatch(await response.text()+JSON.stringify(h.auth.status()),/PRIVATE|synthetic|code=|state=/);
});
for(const [label,error]of [['TLS',failed('CERT_HAS_EXPIRED')],['socket reset',failed('ECONNRESET')],['unknown',Error('PRIVATE')],['Abort',Object.assign(Error('PRIVATE'),{name:'AbortError',cause:failed('ENOTFOUND').cause})]])test(`${label} never retries`,async t=>{
 const h=fixture(t,()=>{throw error;});assert.equal((await login(h)).status,400);assert.equal(h.calls.length,1);assert.equal(h.current(),original);assert.equal(h.saves.length,0);
});
for(const status of [400,401,429,500])test(`HTTP ${status} does not retry an authorization code`,async t=>{
 const h=fixture(t,()=>Response.json({error:'server_error'},{status}));assert.equal((await login(h)).status,400);assert.equal(h.calls.length,1);assert.equal(h.current(),original);
});
test('known connect-looking error after response body begins is never retried',async t=>{
 const h=fixture(t,()=>new Response(new ReadableStream({start(controller){controller.error(failed('UND_ERR_CONNECT_TIMEOUT'));}}),{status:200}));assert.equal((await login(h)).status,400);assert.equal(h.calls.length,1);assert.equal(h.auth.status().lastAttempt.reason,'response');assert.equal(h.current(),original);
});
for(const action of ['revoke','replace'])test(`${action} after a connect failure blocks the retry`,async t=>{
 const h=fixture(t,h=>{action==='revoke'?h.deny():h.replace();throw failed('ENOTFOUND');});assert.equal((await login(h)).status,400);assert.equal(h.calls.length,1);assert.equal(h.saves.length,0);assert.equal(h.auth.status().lastAttempt.reason,'connection_changed');assert.equal(h.current(),action==='replace'?'synthetic-replacement':original);
});
test('closing during failed connection cannot launch retry or save credentials',async t=>{
 let reached,release;const entered=new Promise(r=>reached=r),held=new Promise((_,reject)=>release=()=>reject(failed('ENOTFOUND')));
 const h=fixture(t,async()=>{reached();return held;});const response=login(h);await entered;const close=h.auth.close();release();await close;assert.equal((await response).status,400);assert.equal(h.calls.length,1);assert.equal(h.current(),original);assert.equal(h.saves.length,0);
});
test('refresh token failures preserve the fixed network diagnostic without leaking its cause',async t=>{
 const h=fixture(t,()=>{throw failed('ECONNREFUSED');});await assert.rejects(h.auth.getToken('gmail',{authorizeMutation:h.guard}),error=>{assert.deepEqual(error.authDiagnostic,{stage:'network',networkFailure:'refused'});assert.doesNotMatch(JSON.stringify(error)+String(error),/PRIVATE|synthetic/);return true;});assert.equal(h.calls.length,2);assert.equal(h.current(),original);
});
test('a malformed null response is not mistaken for permission to replay',async t=>{
 const h=fixture(t,()=>null);assert.equal((await login(h)).status,400);assert.equal(h.calls.length,1);assert.equal(h.current(),original);
});
test('one total 20-second deadline includes both connection attempts',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let firstReached,secondReached,release;const first=new Promise(r=>firstReached=r),second=new Promise(r=>secondReached=r);
 const h=fixture(t,async h=>{if(h.calls.length===1){firstReached();return new Promise((_,reject)=>release=()=>reject(failed('UND_ERR_CONNECT_TIMEOUT')));}secondReached();return new Promise(()=>{});});
 const result=h.auth.getToken('gmail',{authorizeMutation:h.guard});
 const settled=result.then(()=>({saved:true}),error=>({saved:false,diagnostic:error.authDiagnostic}));
 await first;t.mock.timers.tick(19000);release();await second;t.mock.timers.tick(1000);
 assert.deepEqual(await settled,{saved:false,diagnostic:{stage:'network',networkFailure:'timeout'}});assert.equal(h.calls.length,2);assert.equal(h.current(),original);assert.equal(h.saves.length,0);
});
test('real Node fetch connection refusal carries only a safe diagnostic and retries at most once',async t=>{
 const {createServer}=await import('node:http'),server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));
 const h=fixture(t,()=>fetch(`http://127.0.0.1:${port}/unreachable`));
 await assert.rejects(h.auth.getToken('gmail',{authorizeMutation:h.guard}),error=>{assert.deepEqual(error.authDiagnostic,{stage:'network',networkFailure:'refused'});assert.doesNotMatch(JSON.stringify(error),/127\.0\.0\.1|unreachable|cause|synthetic/);return true;});assert.equal(h.calls.length,2);assert.equal(h.current(),original);
});
