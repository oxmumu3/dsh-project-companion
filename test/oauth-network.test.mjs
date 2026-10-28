import test from 'node:test';
import assert from 'node:assert/strict';
import * as diagnostic from '../src/auth-diagnostics.js';
const coded=(code)=>Object.assign(Error('PRIVATE provider message host IP code credential'),{code});
const wrapped=code=>new TypeError('fetch failed PRIVATE',{cause:coded(code)});
const cases=[
 ['UND_ERR_CONNECT_TIMEOUT','connect_timeout',true],['EAI_AGAIN','dns',true],['ENOTFOUND','dns',true],['ECONNREFUSED','refused',true],
 ['CERT_HAS_EXPIRED','tls',false],['ERR_TLS_CERT_ALTNAME_INVALID','tls',false],['DEPTH_ZERO_SELF_SIGNED_CERT','tls',false],
 ['ETIMEDOUT','timeout',false],['UND_ERR_HEADERS_TIMEOUT','timeout',false],['UND_ERR_BODY_TIMEOUT','timeout',false],
 ['ECONNRESET','other',false],['PRIVATE_UNKNOWN','other',false],
];
for(const[code,networkFailure,retry]of cases)test(`network error ${code} maps to a fixed category; retry ${retry}`,()=>{
 const error=wrapped(code);assert.deepEqual(diagnostic.oauthNetworkDiagnostic?.(error),{stage:'network',networkFailure});
 assert.equal(diagnostic.canRetryOAuthBeforeSend?.(error),retry);
 assert.doesNotMatch(JSON.stringify(diagnostic.oauthNetworkDiagnostic?.(error)),/PRIVATE|host|credential/);
});
test('cancellation cannot be reclassified as retryable by a nested connection cause',()=>{
 const error=Object.assign(Error('PRIVATE'),{name:'AbortError',cause:coded('UND_ERR_CONNECT_TIMEOUT')});
 assert.deepEqual(diagnostic.oauthNetworkDiagnostic?.(error),{stage:'network',networkFailure:'timeout'});assert.equal(diagnostic.canRetryOAuthBeforeSend?.(error),false);
});
test('unknown outer code and ambiguous aggregate cannot inherit retry from one nested cause',()=>{
 for(const error of [Object.assign(coded('ECONNRESET'),{cause:coded('ENOTFOUND')}),new AggregateError([coded('ENOTFOUND'),coded('ECONNRESET')],'PRIVATE'),new Error('PRIVATE',{cause:coded('ENOTFOUND')})])assert.equal(diagnostic.canRetryOAuthBeforeSend?.(error),false);
});
test('aggregate of only known connect failures is still before-send; mixed categories sanitize',()=>{
 const error=new TypeError('fetch failed',{cause:new AggregateError([coded('ECONNREFUSED'),coded('ENOTFOUND')],'PRIVATE')});
 assert.equal(diagnostic.canRetryOAuthBeforeSend?.(error),true);assert.deepEqual(diagnostic.oauthNetworkDiagnostic?.(error),{stage:'network',networkFailure:'other'});
});
test('safe diagnostic keeps only known network classification and strips raw error fields',()=>{
 assert.deepEqual(diagnostic.safeAuthDiagnostic({stage:'network',networkFailure:'connect_timeout',code:'PRIVATE',message:'PRIVATE',cause:'PRIVATE'}),{stage:'network',networkFailure:'connect_timeout'});
 assert.deepEqual(diagnostic.safeAuthDiagnostic({stage:'network',networkFailure:'PRIVATE'}),{stage:'network'});
 assert.deepEqual(diagnostic.safeAuthDiagnostic({stage:'guard',networkFailure:'dns'}),{stage:'guard'});
});
