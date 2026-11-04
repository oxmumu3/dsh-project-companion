import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const metadata=JSON.parse(await readFile(new URL('../package.json',import.meta.url)));
const matrix=JSON.parse(await readFile(new URL('../compatibility.json',import.meta.url)));
const api=async()=>{const m=await import('../scripts/official-channels.mjs').catch(()=>({}));assert.equal(typeof m.parseDesktopVersion,'function');assert.equal(typeof m.readOfficialChannels,'function');const c=await import('../scripts/compatibility.mjs');assert.equal(typeof c.validateOfficialChannels,'function');return{...m,...c};};
const fixture=()=>{const versions=[...new Set([...matrix,'0.2.2-rc.1'])],value=structuredClone(metadata),union=versions.join(' || ');value.engines.dsh=union;for(const key of Object.keys(value.peerDependencies))if(key.startsWith('@deepseek-ai/dsh-'))value.peerDependencies[key]=union;return{versions,value};};

test('desktop rc1 is checked independently when registry latest remains rc5',async()=>{
 const {validateOfficialChannels}=await api();
 const old=fixture();old.versions=old.versions.filter(x=>x!=='0.2.2-rc.1');old.value.engines.dsh=old.versions.join(' || ');for(const k of Object.keys(old.value.peerDependencies))if(k.startsWith('@deepseek-ai/dsh-'))old.value.peerDependencies[k]=old.value.engines.dsh;
 assert.throws(()=>validateOfficialChannels(old.value,{sdkLatest:'0.2.1-rc.5',desktop:'0.2.2-rc.1'},old.versions),/absent|outside/);
 const {versions,value}=fixture();assert.deepEqual(validateOfficialChannels(value,{sdkLatest:'0.2.1-rc.5',desktop:'0.2.2-rc.1'},versions),{sdkLatest:'0.2.1-rc.5',desktop:'0.2.2-rc.1',targets:['0.2.1-rc.5','0.2.2-rc.1']});
});
test('unselected next and alpha tags never expand the validated target set',async()=>{
 const {validateOfficialChannels}=await api();const {versions,value}=fixture();
 assert.deepEqual(validateOfficialChannels(value,{sdkLatest:'0.2.1-rc.5',desktop:'0.2.1-rc.5',tags:{next:'0.2.2-rc.99',alpha:'0.3.0-alpha.1'}},versions).targets,['0.2.1-rc.5']);
 for(const x of [{},{sdkLatest:'0.2.1-rc.5'},{desktop:'0.2.1-rc.5'},{sdkLatest:'bad',desktop:'0.2.1-rc.5'}])assert.throws(()=>validateOfficialChannels(value,x,versions));
});
test('desktop YAML projection rejects duplicate, ambiguous, oversized and invalid versions',async()=>{
 const {parseDesktopVersion}=await api();
 for(const text of ['version: 0.2.2-rc.1\nfiles:\n  - url: host.zip\n','\ufeffversion: "0.2.2-rc.1" # current\n'])assert.equal(parseDesktopVersion(text),'0.2.2-rc.1');
 for(const text of ['', ' version: 0.2.2-rc.1', 'version: 0.2.2-rc.1\nversion: 0.2.1-rc.5', 'version: [0.2.2-rc.1]', 'version: 0.2.2-rc.01', 'x'.repeat(256*1024+1)])assert.throws(()=>parseDesktopVersion(text));
});
test('official observations bind the desktop version to an actually published exact SDK',async()=>{
 const {readOfficialChannels}=await api(),urls=[];
 const fetcher=async url=>{urls.push(url);return{ok:true,text:async()=>url.includes('nightly-mac.yml')?'version: 0.2.2-rc.1\n':JSON.stringify({'dist-tags':{latest:'0.2.1-rc.5',next:'0.2.2-rc.1'},versions:{'0.2.1-rc.5':{},'0.2.2-rc.1':{}}})};};
 const result=await readOfficialChannels({fetcher});assert.equal(result.desktop,'0.2.2-rc.1');assert.equal(result.sdkLatest,'0.2.1-rc.5');assert.equal(urls.length,2);assert.ok(urls.some(x=>x==='https://download.deepseek.com/dsh-desk/feeds/mac-arm64/nightly-mac.yml'));
});
test('official source failure or unpublished desktop never becomes a cached successful check',async()=>{
 const {readOfficialChannels}=await api();
 await assert.rejects(readOfficialChannels({fetcher:async()=>{throw Error('synthetic network unavailable');}}),/unavailable/);
 await assert.rejects(readOfficialChannels({fetcher:async()=>({ok:false,status:503})}),/503/);
 await assert.rejects(readOfficialChannels({fetcher:async url=>({ok:true,text:async()=>url.includes('nightly-mac.yml')?'version: 0.2.2-rc.1\n':JSON.stringify({'dist-tags':{latest:'0.2.1-rc.5'},versions:{'0.2.1-rc.5':{}}})})}),/published/);
});
