import test from 'node:test';
import assert from 'node:assert/strict';
import {createContextCredentialWriter} from '../src/context-credential-writer.js';
function setup(){
 let config={flomoOAuthCredentials:'old',flomoToken:'legacy'},revision=1,closed=false,gate;
 const mutations=[];
 const settings={describe:()=>[{ns:'companion',revision}],async mutate(ns,ops,expected){mutations.push({ns,ops,expected});if(gate)await gate;if(revision!==expected)throw new Error('conflict');config={...config,[ops[0].path[0]]:ops[0].value};revision++;}};
 const ctx={get:()=>settings,fiber:{entry:{options:{id:'companion'}}}};
 const writer=createContextCredentialWriter({ctx,readConfig:()=>({...config}),isClosed:()=>closed});
 const options={expectedValue:'old',expectedLegacy:'legacy',authorizeMutation:async()=>true};
 return{writer,options,settings,mutations,read:()=>config,change:value=>{config={...config,...value};revision++;},close:()=>{closed=true;},block:promise=>{gate=promise;}};
}
test('native credential writer passes an exact revision and changes only its secret field',async()=>{
 const h=setup();await h.writer('flomo','new',h.options);assert.equal(h.read().flomoOAuthCredentials,'new');assert.equal(h.read().flomoToken,'legacy');assert.deepEqual(h.mutations,[{ns:'companion',ops:[{op:'set',path:['flomoOAuthCredentials'],value:'new'}],expected:1}]);
});
test('native CAS preserves a user clear or replacement while writer is pending',async()=>{
 for(const replacement of ['', 'replacement']){const h=setup();let release;h.block(new Promise(resolve=>{release=resolve;}));const write=h.writer('flomo','stale',h.options);while(!h.mutations.length)await new Promise(resolve=>setImmediate(resolve));h.change({flomoOAuthCredentials:replacement});release();await assert.rejects(write);assert.equal(h.read().flomoOAuthCredentials,replacement);}
});
test('authorization revocation, changed token, closure or missing revision prevent native writes',async()=>{
 for(const kind of ['revoked','changed','closed','noRevision']){const h=setup();if(kind==='revoked')h.options.authorizeMutation=async()=>false;if(kind==='changed')h.change({flomoToken:'new legacy'});if(kind==='closed')h.close();if(kind==='noRevision')h.settings.describe=()=>[{ns:'companion'}];await assert.rejects(h.writer('flomo','new',h.options));assert.equal(h.mutations.length,0);}
});
test('credential rotation during the owner authorization check cannot overwrite newer state',async()=>{
 const h=setup();h.options.authorizeMutation=async()=>{h.change({flomoOAuthCredentials:'rotated'});return true;};await assert.rejects(h.writer('flomo','stale',h.options));assert.equal(h.read().flomoOAuthCredentials,'rotated');assert.equal(h.mutations.length,0);
});
