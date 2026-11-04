import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateCompatibility} from '../scripts/compatibility.mjs';
const metadata=JSON.parse(await readFile(new URL('../package.json',import.meta.url)));
test('published compatibility gate accepts RC4 and RC5 without an override',()=>{for(const version of ['0.2.1-rc.4','0.2.1-rc.5'])assert.equal(validateCompatibility(metadata,version),version);});
test('validated desktop rc1 is explicitly included without an override',()=>{assert.equal(validateCompatibility(metadata,'0.2.2-rc.1'),'0.2.2-rc.1');});
test('exact rc1 carrier plan selects the actual Cordis and schema ABI',async()=>{const {planSdk}=await import('../scripts/ci-sdk.mjs');const plan=await planSdk(['--sdk','0.2.2-rc.1','--plan']);assert.equal(plan.dependencies['@deepseek-ai/cordis'],'4.1.0');assert.equal(plan.dependencies['@deepseek-ai/schemastery'],'3.19.0');for(const name of ['dsh-tool-executor-native','dsh-tool-executor-ptc'])assert.equal(plan.dependencies['@deepseek-ai/'+name],'0.2.2-rc.1');for(const [name,version]of Object.entries(plan.dependencies))if(name.startsWith('@deepseek-ai/dsh-'))assert.equal(version,'0.2.2-rc.1',name);});
test('new official releases fail closed until compatibility is validated',()=>{for(const version of ['0.2.1-rc.6','0.2.2-alpha.2','arbitrary',''])assert.throws(()=>validateCompatibility(metadata,version));});
test('host engine acceptance cannot hide an incompatible required peer',()=>{const changed=structuredClone(metadata);changed.peerDependencies['@deepseek-ai/dsh-agent']='0.2.1-rc.3';assert.throws(()=>validateCompatibility(changed,'0.2.1-rc.4'));});

test('widening only host and peers cannot omit the corresponding matrix run',()=>{const changed=structuredClone(metadata);changed.engines.dsh+=' || 0.2.1-rc.6';for(const name of Object.keys(changed.peerDependencies))if(name.startsWith('@deepseek-ai/dsh-'))changed.peerDependencies[name]+=' || 0.2.1-rc.6';assert.throws(()=>validateCompatibility(changed,'0.2.1-rc.6'));});
test('a missing required peer or duplicate matrix entry cannot create a green gate',()=>{const changed=structuredClone(metadata);delete changed.peerDependencies['@deepseek-ai/dsh-agent'];assert.throws(()=>validateCompatibility(changed,'0.2.1-rc.4'));assert.throws(()=>validateCompatibility(metadata,'0.2.1-rc.4',['0.2.1-rc.4','0.2.1-rc.4']));});
test('CI consumes the same version manifest as the compatibility validator',async()=>{const workflow=await readFile(new URL('../.github/workflows/sdk-compatibility.yml',import.meta.url),'utf8');assert.match(workflow,/node scripts\/compatibility\.mjs --matrix/);assert.match(workflow,/fromJSON\(needs\.latest-official\.outputs\.matrix\)/);});
