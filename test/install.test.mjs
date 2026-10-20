import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm, chmod, realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';

const installer=await import('../src/installation.js').catch(error=>{
  if(error.code==='ERR_MODULE_NOT_FOUND')return {};
  throw error;
});
const license=await readFile(new URL('../LICENSE',import.meta.url),'utf8');
function tar(files){
  const chunks=[];
  for(const [name,value] of Object.entries(files)){
    const body=Buffer.from(value),header=Buffer.alloc(512);
    header.write(name);header.write('0000644\0',100);header.write('0000000\0',108);header.write('0000000\0',116);
    header.write(body.length.toString(8).padStart(11,'0')+'\0',124);header.write('00000000000\0',136);header.fill(32,148,156);
    header[156]=48;header.write('ustar\0',257);header.write('00',263);
    header.write([...header].reduce((a,b)=>a+b,0).toString(8).padStart(6,'0')+'\0 ',148);
    chunks.push(header,body,Buffer.alloc((512-body.length%512)%512));
  }
  return gzipSync(Buffer.concat([...chunks,Buffer.alloc(1024)]));
}
async function fixture(t,{installed={},enabled=true,bridgeVersion='0.11.0'}={}){
  const root=await realpath(await mkdtemp(join(tmpdir(),'dot-install-test-')));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const bundleDir=join(root,'bundle'),appPath=join(root,'DeepSeek Harness.app'),homeDir=join(root,'home');
  await mkdir(bundleDir,{recursive:true});await mkdir(join(appPath,'Contents','MacOS'),{recursive:true});
  const executable=join(appPath,'Contents','MacOS','DeepSeek Harness');await writeFile(executable,'fixture');await chmod(executable,0o755);
  const profile=join(homeDir,'.dsh','profiles','desktop');await mkdir(profile,{recursive:true});
  const manifest={schemaVersion:1,runtimeVersions:['0.2.0-rc.2','0.2.1-rc.2'],packages:[]};
  for(const [name,version] of [['dsh-wechat',bridgeVersion],['dsh-project-companion','0.3.2-preview.1']]){
    const files={'package/package.json':JSON.stringify({name,version,license:'MIT',dsh:{bundle:{patch:'./cordis.patch.yml'}}}),'package/LICENSE':license};
    if(name==='dsh-project-companion'){
      files['package/THIRD_PARTY_NOTICES.md']='fixture';
      for(const p of ['pan17-dsh-wechat','dsh-yolo','dsh-proactive'])files[`package/third-party-licenses/${p}.txt`]=license;
    }
    const bytes=tar(files),file=`${name}-${version}.tgz`;await writeFile(join(bundleDir,file),bytes);
    manifest.packages.push({name,version,file,sha256:createHash('sha256').update(bytes).digest('hex')});
  }
  await writeFile(join(bundleDir,'bundle-manifest.json'),JSON.stringify(manifest));
  await writeFile(join(profile,'package.json'),JSON.stringify({dependencies:Object.fromEntries(Object.keys(installed).map(name=>[name,'fixture'])),dsh:{profile:{bundles:enabled?Object.keys(installed):[]}}}));
  for(const [name,version]of Object.entries(installed)){
    await mkdir(join(profile,'node_modules',name),{recursive:true});await writeFile(join(profile,'node_modules',name,'package.json'),JSON.stringify({name,version}));
  }
  const calls=[];
  const runner=async(command,args,options)=>{
    calls.push({command,args,options});
    if(command==='/bin/ps')return {code:0,stdout:''};
    if(args.includes('--eval'))return {code:0,stdout:JSON.stringify({runtimeVersion:'0.2.1-rc.2',sdkVersion:'0.2.1-rc.2'})};
    const pkg=manifest.packages.find(p=>args.includes(join(bundleDir,p.file)));
    if(pkg){
      const p=JSON.parse(await readFile(join(profile,'package.json'),'utf8')),declared=Object.hasOwn(p.dependencies??{},pkg.name);
      await mkdir(join(profile,'node_modules',pkg.name),{recursive:true});await writeFile(join(profile,'node_modules',pkg.name,'package.json'),JSON.stringify({name:pkg.name,version:pkg.version}));
      p.dependencies??={};p.dependencies[pkg.name]=`file:${join(bundleDir,pkg.file)}`;
      if(!declared&&!p.dsh.profile.bundles.includes(pkg.name))p.dsh.profile.bundles.push(pkg.name);
      await writeFile(join(profile,'package.json'),JSON.stringify(p));
    }
    return {code:0,stdout:''};
  };
  return {bundleDir,appPath,homeDir,profile,manifest,calls,runner,platform:'darwin',ownPid:999999};
}
function ready(){assert.equal(typeof installer.runInstallation,'function','installer entry point is missing');return installer.runInstallation;}

test('installer previews exact packages without profile or package-manager writes',async t=>{
  const f=await fixture(t),before=await readFile(join(f.profile,'package.json'),'utf8');
  const result=await ready()(f);
  assert.equal(result.status,'ready');assert.equal(result.mode,'dry_run');assert.equal(result.steps.length,2);
  assert.equal(f.calls.filter(c=>c.args.includes('add')).length,0);assert.equal(await readFile(join(f.profile,'package.json'),'utf8'),before);
});
test('missing official App returns needs_harness without installing or downloading',async t=>{
  const f=await fixture(t);await rm(f.appPath,{recursive:true});const r=await ready()({...f,install:true});
  assert.equal(r.status,'needs_harness');assert.equal(f.calls.length,0);assert.match(r.officialUrl,/github.com\/deepseek-ai\/deepseek-harness\/releases/);
});
test('running Desktop blocks explicit install without stopping any process',async t=>{
  const f=await fixture(t),runner=async(command,args,o)=>command==='/bin/ps'?{code:0,stdout:`123 ${join(f.appPath,'Contents/MacOS/DeepSeek Harness')}\n`}:f.runner(command,args,o);
  const r=await ready()({...f,runner,install:true});assert.equal(r.status,'desktop_running');assert.equal(f.calls.some(c=>c.args.includes('add')),false);
});
test('tampered compressed package fails before a package-manager call',async t=>{
  const f=await fixture(t);await writeFile(join(f.bundleDir,f.manifest.packages[0].file),'tampered');
  await assert.rejects(ready()({...f,install:true}),e=>e.code==='PACKAGE_HASH_MISMATCH');assert.equal(f.calls.length,0);
});
test('manifest cannot select a package path outside the local bundle',async t=>{
  const f=await fixture(t);f.manifest.packages[0].file='../outside.tgz';await writeFile(join(f.bundleDir,'bundle-manifest.json'),JSON.stringify(f.manifest));
  await assert.rejects(ready()(f),e=>e.code==='INVALID_MANIFEST');assert.equal(f.calls.length,0);
});
test('inner name and version must match the pinned manifest',async t=>{
  const f=await fixture(t);f.manifest.packages[1].version='0.3.3-preview.1';await writeFile(join(f.bundleDir,'bundle-manifest.json'),JSON.stringify(f.manifest));
  await assert.rejects(ready()(f),e=>e.code==='PACKAGE_METADATA_MISMATCH');
});
test('exact installed versions require registered dependencies and bundles before preservation',async t=>{
  const f=await fixture(t,{installed:{'dsh-wechat':'0.11.0','dsh-project-companion':'0.3.2-preview.1'}});
  const r=await ready()({...f,install:true});assert.equal(r.status,'installed');assert.equal(r.steps.every(s=>s.action==='preserve'),true);
  assert.equal(f.calls.some(c=>c.args.includes('add')),false);
});
test('explicit install upgrades older companion through the official CLI and preserves bridge',async t=>{
  const f=await fixture(t,{installed:{'dsh-wechat':'0.11.0','dsh-project-companion':'0.3.1-preview.1'}});
  const r=await ready()({...f,install:true});assert.equal(r.status,'installed');const installs=f.calls.filter(c=>c.args.includes('add'));
  assert.equal(installs.length,1);assert.match(installs[0].args.at(-4),/dsh-project-companion.*\.tgz$/);
  assert.deepEqual(installs[0].args.slice(-3),['--ignore-scripts','--network-concurrency=1','--child-concurrency=1']);assert.equal(installs[0].options.shell,false);
  assert.equal(installs[0].options.env.ELECTRON_RUN_AS_NODE,'1');assert.equal(r.steps[1].action,'upgrade');
});
test('a different WeChat bridge version is not silently replaced',async t=>{
  const f=await fixture(t,{installed:{'dsh-wechat':'0.10.0'}});
  await assert.rejects(ready()({...f,install:true}),e=>e.code==='BRIDGE_VERSION_CONFLICT');assert.equal(f.calls.some(c=>c.args.includes('add')),false);
});
test('a newer companion cannot be downgraded',async t=>{
  const f=await fixture(t,{installed:{'dsh-project-companion':'0.4.0'}});
  await assert.rejects(ready()({...f,install:true}),e=>e.code==='COMPANION_DOWNGRADE');assert.equal(f.calls.some(c=>c.args.includes('add')),false);
});
test('unknown runtime SDK is rejected without version exemptions',async t=>{
  const f=await fixture(t),runner=async(c,a,o)=>a.includes('--eval')?{code:0,stdout:JSON.stringify({runtimeVersion:'0.3.0',sdkVersion:'0.3.0'})}:f.runner(c,a,o);
  await assert.rejects(ready()({...f,runner,install:true}),e=>e.code==='UNSUPPORTED_RUNTIME');assert.equal(f.calls.some(c=>c.args.includes('add')),false);
});
test('a failed second install reports partial completion and never edits profile itself',async t=>{
  const f=await fixture(t);
  const runner=async(c,a,o)=>a.includes('add')&&a.includes(join(f.bundleDir,f.manifest.packages[1].file))?{code:1,stderr:'synthetic install failure'}:f.runner(c,a,o);
  await assert.rejects(ready()({...f,runner,install:true}),e=>e.code==='INSTALL_FAILED'&&e.completed.length===1);
  const after=JSON.parse(await readFile(join(f.profile,'package.json'),'utf8'));
  assert.deepEqual(Object.keys(after.dependencies),['dsh-wechat']);assert.deepEqual(after.dsh.profile.bundles,['dsh-wechat']);
});
async function replaceArchive(f,index,files){
  const p=f.manifest.packages[index],bytes=tar(files);p.sha256=createHash('sha256').update(bytes).digest('hex');
  await writeFile(join(f.bundleDir,p.file),bytes);await writeFile(join(f.bundleDir,'bundle-manifest.json'),JSON.stringify(f.manifest));
}
test('manifest cannot change the verified bridge release',async t=>{
  const f=await fixture(t);f.manifest.packages[0].version='0.12.0';
  await replaceArchive(f,0,{'package/package.json':JSON.stringify({name:'dsh-wechat',version:'0.12.0',license:'MIT',dsh:{bundle:{patch:'./cordis.patch.yml'}}}),'package/LICENSE':license});
  await assert.rejects(ready()(f),e=>e.code==='INVALID_MANIFEST');
});
test('truncated MIT license is rejected before host probing',async t=>{
  const f=await fixture(t);
  await replaceArchive(f,0,{'package/package.json':JSON.stringify({name:'dsh-wechat',version:'0.11.0',license:'MIT',dsh:{bundle:{patch:'./cordis.patch.yml'}}}),'package/LICENSE':'MIT License\nCopyright fixture\nPermission is hereby granted'});
  await assert.rejects(ready()(f),e=>e.code==='MISSING_LICENSE');assert.equal(f.calls.length,0);
});
test('a disabled installed bundle is preserved and marked as requiring enablement',async t=>{
  const f=await fixture(t,{installed:{'dsh-wechat':'0.11.0','dsh-project-companion':'0.3.1-preview.1'},enabled:false});
  const r=await ready()({...f,install:true});assert.deepEqual(r.needsEnable,['dsh-wechat','dsh-project-companion']);
  assert.equal(r.steps[0].state,'preserved_disabled');assert.equal(r.steps[1].enabled,false);
});
test('installer ignores only its own bundled-Node PID',async t=>{
  const f=await fixture(t),runner=async(c,a,o)=>c==='/bin/ps'?{code:0,stdout:`999999 ${join(f.appPath,'Contents/MacOS/DeepSeek Harness')} --expose-internals installer\n`}:f.runner(c,a,o);
  const r=await ready()({...f,runner,install:true});assert.equal(r.status,'installed');
});
test('Desktop starting between package steps stops the remainder',async t=>{
  const f=await fixture(t);let psCalls=0;
  const runner=async(c,a,o)=>c==='/bin/ps'?{code:0,stdout:++psCalls>=3?`123 ${join(f.appPath,'Contents/MacOS/DeepSeek Harness')}\n`:''}:f.runner(c,a,o);
  await assert.rejects(ready()({...f,runner,install:true}),e=>e.code==='DESKTOP_STARTED'&&e.completed.length===1);
  assert.equal(f.calls.filter(c=>c.args.includes('add')).length,1);
});
test('process enumeration failure never falls through to installation',async t=>{
  const f=await fixture(t),runner=async(c,a,o)=>c==='/bin/ps'?{code:1,stdout:''}:f.runner(c,a,o);
  await assert.rejects(ready()({...f,runner,install:true}),e=>e.code==='PROCESS_CHECK_FAILED');assert.equal(f.calls.some(c=>c.args.includes('add')),false);
});
test('CLI success without matching installed metadata is not accepted',async t=>{
  const f=await fixture(t),runner=async(c,a,o)=>a.includes('add')?{code:0,stdout:''}:f.runner(c,a,o);
  await assert.rejects(ready()({...f,runner,install:true}),e=>e.code==='INSTALL_VERIFY_FAILED');
});
test('another copy of the official Desktop also blocks profile mutation',async t=>{
  const f=await fixture(t),runner=async(c,a,o)=>c==='/bin/ps'?{code:0,stdout:'123 /Another Location/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness\n'}:f.runner(c,a,o);
  const r=await ready()({...f,runner,install:true});assert.equal(r.status,'desktop_running');assert.equal(f.calls.some(c=>c.args.includes('add')),false);
});
test('Finder-renamed Desktop copy blocks installation into the shared profile',async t=>{
  const f=await fixture(t),runner=async(c,a,o)=>c==='/bin/ps'?{code:0,stdout:'123 /Applications/DeepSeek Harness 2.app/Contents/MacOS/DeepSeek Harness\n'}:f.runner(c,a,o);
  const r=await ready()({...f,runner,install:true});assert.equal(r.status,'desktop_running');assert.equal(f.calls.some(c=>c.args.includes('add')),false);
});
test('orphaned same-version module without a direct dependency blocks preservation',async t=>{
  const f=await fixture(t,{installed:{'dsh-wechat':'0.11.0'}}),p=JSON.parse(await readFile(join(f.profile,'package.json'),'utf8'));
  delete p.dependencies['dsh-wechat'];await writeFile(join(f.profile,'package.json'),JSON.stringify(p));
  await assert.rejects(ready()({...f,install:true}),e=>e.code==='INCONSISTENT_INSTALL');assert.equal(f.calls.some(c=>c.args.includes('add')),false);
});
test('same-version module with direct dependency but no bundle remains disabled',async t=>{
  const f=await fixture(t,{installed:{'dsh-wechat':'0.11.0'}}),p=JSON.parse(await readFile(join(f.profile,'package.json'),'utf8'));
  p.dsh.profile.bundles=[];await writeFile(join(f.profile,'package.json'),JSON.stringify(p));
  const r=await ready()(f);assert.equal(r.steps[0].state,'preserved_disabled');assert.deepEqual(r.needsEnable,['dsh-wechat']);assert.equal(f.calls.some(c=>c.args.includes('add')),false);
});
test('registered dependency and bundle with missing modules block automatic repair',async t=>{
  const f=await fixture(t,{installed:{'dsh-wechat':'0.11.0'}});await rm(join(f.profile,'node_modules','dsh-wechat'),{recursive:true});
  await assert.rejects(ready()({...f,install:true}),e=>e.code==='INCONSISTENT_INSTALL');assert.equal(f.calls.some(c=>c.args.includes('add')),false);
});

test('explicit reviewed bridge upgrade preserves pairing and does not reset existing enablement',async t=>{
 const f=await fixture(t,{installed:{'dsh-wechat':'0.11.0','dsh-project-companion':'0.3.1-preview.1'},enabled:false,bridgeVersion:'0.11.1-dot.1'});
 const privateDir=join(f.homeDir,'.dsh-wechat');await mkdir(privateDir);const state=join(privateDir,'state.json');await writeFile(state,'synthetic existing pairing');
 const before=await readFile(state,'utf8');const result=await ready()({...f,install:true});assert.equal(result.status,'installed');assert.equal(result.steps[0].action,'upgrade');assert.equal(result.steps[0].version,'0.11.1-dot.1');assert.equal(await readFile(state,'utf8'),before);assert.ok(result.needsEnable.includes('dsh-wechat'));assert.equal(result.steps[0].enabled,false);
});

test('a reviewed bridge fork cannot silently downgrade to the original bridge',async t=>{
 const f=await fixture(t,{installed:{'dsh-wechat':'0.11.1-dot.1'}});await assert.rejects(ready()({...f,install:true}),e=>e.code==='BRIDGE_VERSION_CONFLICT');assert.equal(f.calls.some(c=>c.args.includes('add')),false);
});

test('second audited maintenance bridge upgrades original or first maintenance without resetting pairing',async t=>{
 for(const prior of ['0.11.0','0.11.1-dot.1']){
  const f=await fixture(t,{installed:{'dsh-wechat':prior},bridgeVersion:'0.11.1-dot.2'});
  const result=await ready()({...f,install:true});assert.equal(result.status,'installed');assert.equal(result.steps[0].action,'upgrade');assert.equal(result.steps[0].version,'0.11.1-dot.2');
 }
});
test('second maintenance bridge cannot downgrade or accept an unknown intervening fork',async t=>{
 for(const [prior,next] of [['0.11.1-dot.2','0.11.1-dot.1'],['0.11.1-other.1','0.11.1-dot.2']]){
  const f=await fixture(t,{installed:{'dsh-wechat':prior},bridgeVersion:next});await assert.rejects(ready()({...f,install:true}),e=>e.code==='BRIDGE_VERSION_CONFLICT');assert.equal(f.calls.some(c=>c.args.includes('add')),false);
 }
});
