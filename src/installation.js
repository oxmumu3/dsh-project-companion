/** Local macOS distribution installer. No daemon, profile editing, login or WeChat access. */
import {access, readFile, realpath, stat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {basename, dirname, join, resolve} from 'node:path';
import {homedir} from 'node:os';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {spawn} from 'node:child_process';

export const OFFICIAL_HARNESS_URL='https://github.com/deepseek-ai/deepseek-harness/releases';
const RUNTIMES=['0.2.0-rc.2','0.2.1-rc.2'];
const NAMES=['dsh-wechat','dsh-project-companion'];
const BRIDGE_VERSIONS=new Set(['0.11.0','0.11.1-dot.1','0.11.1-dot.2']);
const MAX_PACKAGE=20*1024*1024;
const MAX_TAR=64*1024*1024;
function failure(code,message,extra={}){return Object.assign(new Error(message),{code,...extra});}
async function optionalJson(file){
  try{return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw failure('INVALID_LOCAL_METADATA',`无法读取有效安装元数据：${file}`);}
}
function versionParts(value){
  if(typeof value!=='string'||!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.test(value))throw failure('INVALID_VERSION','版本必须为固定的 SemVer，不接受 latest、范围或 URL。');
  const [base,pre]=value.split(/-(.*)/s);return {base:base.split('.').map(Number),pre:pre?.split('.')};
}
function compareVersions(a,b){
  const x=versionParts(a),y=versionParts(b);
  for(let i=0;i<3;i++)if(x.base[i]!==y.base[i])return x.base[i]>y.base[i]?1:-1;
  if(!x.pre&&!y.pre)return 0;if(!x.pre)return 1;if(!y.pre)return -1;
  for(let i=0;i<Math.max(x.pre.length,y.pre.length);i++){
    if(x.pre[i]===undefined)return -1;if(y.pre[i]===undefined)return 1;
    const l=x.pre[i],r=y.pre[i];if(l===r)continue;
    const ln=/^\d+$/.test(l),rn=/^\d+$/.test(r);
    if(ln&&rn)return Number(l)>Number(r)?1:-1;
    if(ln!==rn)return ln?-1:1;return l>r?1:-1;
  }
  return 0;
}
function tarFiles(compressed){
  let tar;try{tar=gunzipSync(compressed,{maxOutputLength:MAX_TAR});}catch{throw failure('INVALID_PACKAGE','不是受支持的 gzip/tar 包。');}
  const files=new Map();
  for(let offset=0;offset+512<=tar.length;){
    const header=tar.subarray(offset,offset+512);if(header.every(b=>b===0))break;
    const string=(from,n)=>header.subarray(from,from+n).toString('utf8').split('\0')[0];
    const prefix=string(345,155),name=(prefix?`${prefix}/`:'')+string(0,100);
    if(!name||name.startsWith('/')||name.includes('\\')||name.split('/').includes('..')||/[\x00-\x1f]/.test(name))throw failure('INVALID_PACKAGE','压缩包含不安全的文件路径。');
    const sizeText=string(124,12).trim();if(!/^[0-7]+$/.test(sizeText))throw failure('INVALID_PACKAGE','压缩包文件长度无效。');
    const size=parseInt(sizeText,8),start=offset+512,end=start+size;
    if(!Number.isSafeInteger(size)||end>tar.length)throw failure('INVALID_PACKAGE','压缩包已截断。');
    const type=string(156,1);
    if(type==='0'||type===''){
      if(files.has(name))throw failure('INVALID_PACKAGE','压缩包含重复文件。');
      files.set(name,tar.subarray(start,end));
    }
    offset=start+Math.ceil(size/512)*512;
  }
  return files;
}
function hasMit(files,file){
  const value=files.get(file)?.toString('utf8');
  return value?.includes('MIT License')&&value.includes('Copyright')&&value.includes('Permission is hereby granted')&&value.includes('The above copyright notice and this permission notice')&&value.includes('"AS IS"')&&value.includes('IN NO EVENT SHALL');
}
async function validateBundle(bundleDir){
  const dir=await realpath(bundleDir),manifest=await optionalJson(join(dir,'bundle-manifest.json'));
  if(!manifest||manifest.schemaVersion!==1||!Array.isArray(manifest.runtimeVersions)||manifest.runtimeVersions.length===0||manifest.runtimeVersions.some(v=>!RUNTIMES.includes(v))||!Array.isArray(manifest.packages)||manifest.packages.length!==2)throw failure('INVALID_MANIFEST','bundle-manifest.json 格式或已验证宿主版本不正确。');
  const packages=[];
  for(let i=0;i<NAMES.length;i++){
    const p=manifest.packages[i];
    if(!p||p.name!==NAMES[i]||(p.name==='dsh-wechat'&&!BRIDGE_VERSIONS.has(p.version))||typeof p.file!=='string'||basename(p.file)!==p.file||!p.file.endsWith('.tgz')||! /^[a-f0-9]{64}$/.test(p.sha256??''))throw failure('INVALID_MANIFEST','包顺序、固定微信桥接版本、文件名或 SHA256 无效。');
    versionParts(p.version);
    const file=await realpath(join(dir,p.file));if(dirname(file)!==dir)throw failure('INVALID_MANIFEST','包文件不得通过符号链接指向分发目录之外。');
    if((await stat(file)).size>MAX_PACKAGE)throw failure('INVALID_PACKAGE','安装包超过本地校验大小限制。');
    const bytes=await readFile(file);
    if(createHash('sha256').update(bytes).digest('hex')!==p.sha256)throw failure('PACKAGE_HASH_MISMATCH',`${p.name} 安装包 SHA256 与 manifest 不一致。`);
    const files=tarFiles(bytes);let metadata;
    try{metadata=JSON.parse(files.get('package/package.json')?.toString('utf8'));}catch{throw failure('PACKAGE_METADATA_MISMATCH','压缩包缺少有效 package/package.json。');}
    if(metadata.name!==p.name||metadata.version!==p.version||metadata.license!=='MIT'||typeof metadata.dsh?.bundle?.patch!=='string')throw failure('PACKAGE_METADATA_MISMATCH',`${p.name} 的包名、固定版本、MIT 许可或 bundle 声明不匹配。`);
    const licenses=['package/LICENSE'];
    if(p.name==='dsh-project-companion'){
      if(!files.has('package/THIRD_PARTY_NOTICES.md'))throw failure('MISSING_LICENSE','缺少第三方来源与版权声明。');
      for(const n of ['pan17-dsh-wechat','dsh-yolo','dsh-proactive'])licenses.push(`package/third-party-licenses/${n}.txt`);
    }
    if(licenses.some(name=>!hasMit(files,name)))throw failure('MISSING_LICENSE',`${p.name} 缺少完整 MIT 许可声明。`);
    packages.push({...p,file});
  }
  return {dir,manifest,packages};
}

/** Fixed-argument child process; never invokes a shell or interpolates shell code. */
export function runProcess(command,args,options={}){
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{...options,shell:false,stdio:['ignore','pipe','pipe']});let stdout='',stderr='',size=0;
    const collect=which=>data=>{size+=data.length;if(size>4*1024*1024){child.kill();return;}if(which==='stdout')stdout+=data;else stderr+=data;};
    child.stdout.on('data',collect('stdout'));child.stderr.on('data',collect('stderr'));
    child.on('error',reject);child.on('close',code=>resolve({code,stdout,stderr}));
  });
}
function processOptions(env,dshHome){
  const safeEnv={...env,ELECTRON_RUN_AS_NODE:'1',DSH_HOME:dshHome};delete safeEnv.NODE_OPTIONS;
  return {shell:false,env:safeEnv};
}
async function runningDesktop(runner,executable,ownPid,options){
  const r=await runner('/bin/ps',['-axo','pid=,command='],options);
  if(r.code!==0)throw failure('PROCESS_CHECK_FAILED','无法确认 Desktop 是否已退出；未安装任何包。');
  return r.stdout.split('\n').some(line=>{
    const m=line.trim().match(/^(\d+)\s+(.*)$/);if(!m||Number(m[1])===ownPid)return false;
    return m[2]===executable||m[2].startsWith(executable+' ')||/\/[^/]+\.app\/Contents\/MacOS\/DeepSeek Harness(?: |$)/.test(m[2]);
  });
}
async function installedPackage(profile,name){
  const manifest=await optionalJson(join(profile,'package.json'));
  const declared=Object.hasOwn(manifest?.dependencies??{},name),enabled=manifest?.dsh?.profile?.bundles?.includes(name)===true;
  const value=await optionalJson(join(profile,'node_modules',name,'package.json'));
  if(!value&&!declared&&!enabled)return null;
  if(!value||!declared||typeof manifest.dependencies[name]!=='string'||manifest.dependencies[name].length===0)throw failure('INCONSISTENT_INSTALL',`${name} 的 direct dependency 与已装模块不一致，可能是安装残留；请在官方插件管理器检查修复，本安装器不会手改 profile 或假称已安装。`);
  if(value.name!==name)throw failure('INVALID_LOCAL_METADATA',`${name} 的现有安装元数据不一致。`);
  versionParts(value.version);
  const direct=manifest.dependencies[name];
  if(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(direct)&&direct!==value.version)throw failure('INCONSISTENT_INSTALL',`${name} 的 direct dependency 精确版本与模块版本不一致；请通过官方插件管理器修复。`);
  return {...value,enabled};
}

/** By default only validates and previews. install:true invokes the official Desktop CLI. */
export async function runInstallation({bundleDir,appPath='/Applications/DeepSeek Harness.app',homeDir=homedir(),dshHome,platform=process.platform,runner=runProcess,install=false,env=process.env,ownPid=process.pid}){
  if(platform!=='darwin')return {status:'unsupported_platform',message:'本候选安装入口仅支持 macOS。'};
  const bundle=await validateBundle(bundleDir);
  const executable=join(resolve(appPath),'Contents','MacOS','DeepSeek Harness');
  try{await access(executable,constants.X_OK);}catch{return {status:'needs_harness',officialUrl:OFFICIAL_HARNESS_URL,message:'请先从官方 Releases 安装 Harness，再运行同一个入口继续。'};}
  const actualHome=resolve(dshHome??env.DSH_HOME??join(homeDir,'.dsh')),profile=join(actualHome,'profiles','desktop');
  const options=processOptions(env,actualHome);
  const runtimeDir=join(resolve(appPath),'Contents','Resources','app.asar','dsh');
  const probe=`import fs from 'node:fs';const p=${JSON.stringify(runtimeDir)};console.log(JSON.stringify({runtimeVersion:JSON.parse(fs.readFileSync(p+'/package.json','utf8')).version,sdkVersion:JSON.parse(fs.readFileSync(p+'/node_modules/@deepseek-ai/dsh-agent/package.json','utf8')).version}));`;
  const sdk=await runner(executable,['--expose-internals','--max-old-space-size=128','--input-type=module','--eval',probe],options);let versions;
  try{if(sdk.code!==0)throw Error();versions=JSON.parse(sdk.stdout.trim());}catch{throw failure('RUNTIME_PROBE_FAILED','无法读取官方 App 自带的 Harness/SDK 版本。');}
  if(!bundle.manifest.runtimeVersions.includes(versions.runtimeVersion)||versions.runtimeVersion!==versions.sdkVersion)throw failure('UNSUPPORTED_RUNTIME','当前 Harness/SDK 不在此候选安装包已验证的精确版本范围。');
  const steps=[];
  for(const p of bundle.packages){
    const existing=await installedPackage(profile,p.name);let action='install';
    if(existing){
      if(existing.version===p.version)action='preserve';
      else if(p.name==='dsh-wechat'){if((existing.version==='0.11.0'&&['0.11.1-dot.1','0.11.1-dot.2'].includes(p.version))||(existing.version==='0.11.1-dot.1'&&p.version==='0.11.1-dot.2'))action='upgrade';else throw failure('BRIDGE_VERSION_CONFLICT','现有微信桥接与已验证升级路径不同；不会降级或重置配对。');}
      else if(compareVersions(existing.version,p.version)>0)throw failure('COMPANION_DOWNGRADE','已装 companion 版本更高；拒绝降级。');
      else action='upgrade';
    }
    steps.push({name:p.name,version:p.version,previousVersion:existing?.version??null,action,file:p.file,enabled:existing?.enabled??null,state:action==='preserve'?(existing.enabled?'preserved_enabled':'preserved_disabled'):`planned_${action}`});
  }
  const needsEnable=steps.filter(s=>s.previousVersion!==null&&s.enabled===false).map(s=>s.name);
  const result={status:'ready',mode:install?'install':'dry_run',runtimeVersion:versions.runtimeVersion,steps,needsEnable,profile};
  if(!install)return result;
  if(await runningDesktop(runner,executable,ownPid,options))return {...result,status:'desktop_running',message:'请正常退出 DeepSeek Harness，再运行同一安装入口；安装器不会停止正在运行的任务。'};
  const cli=join(runtimeDir,'node_modules','@deepseek-ai','dsh-desktop-host','lib','cli.js'),completed=[];
  for(const step of steps){
    if(step.action==='preserve')continue;
    if(await runningDesktop(runner,executable,ownPid,options))throw failure('DESKTOP_STARTED','安装过程中检测到 Desktop 启动，已停止后续安装。',{completed});
    // Recheck the immutable distribution just before handing each file to the official package manager.
    await validateBundle(bundle.dir);
    const args=['--expose-internals','--max-old-space-size=128',cli,'plugin','--profile','desktop','add',step.file,'--ignore-scripts','--network-concurrency=1','--child-concurrency=1'];
    const r=await runner(executable,args,options);
    if(r.code!==0)throw failure('INSTALL_FAILED',`${step.name} 官方 CLI 安装失败；此前已完成步骤不会假称自动回滚。`,{completed,detail:r.stderr?.slice(-800)??''});
    let after;try{after=await installedPackage(profile,step.name);}catch(error){throw failure('INSTALL_VERIFY_FAILED',`${step.name} 官方 CLI 返回成功，但安装登记与模块回读不一致。`,{completed,causeCode:error.code});}
    if(after?.version!==step.version)throw failure('INSTALL_VERIFY_FAILED',`${step.name} 的官方 CLI 返回成功，但安装版本回读未匹配。`,{completed});
    step.enabled=after.enabled;step.state=`${step.action==='upgrade'?'upgraded':'installed'}_${after.enabled?'enabled':'disabled'}`;
    completed.push({name:step.name,version:step.version});
  }
  for(const step of steps){
    let after;try{after=await installedPackage(profile,step.name);}catch(error){throw failure('INSTALL_VERIFY_FAILED',`${step.name} 最终安装回读不一致。`,{completed,causeCode:error.code});}
    if(after?.version!==step.version)throw failure('INSTALL_VERIFY_FAILED',`${step.name} 最终版本回读不匹配。`,{completed});
    step.enabled=after.enabled;
    if(step.action==='preserve')step.state=after.enabled?'preserved_enabled':'preserved_disabled';
  }
  return {...result,status:'installed',needsEnable:steps.filter(s=>!s.enabled).map(s=>s.name),completed,message:'固定版本已安装或保留；禁用组件仍需本人在官方管理器启用。请打开 Harness 核对运行状态，再由本人登录、配置模型及扫码；此结果不代表插件运行或微信送达。'};
}
