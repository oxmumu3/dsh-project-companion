#!/usr/bin/env node
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runInstallation} from '../src/installation.js';

const args=process.argv.slice(2),known=new Set(['--install','--dry-run','--help','--bundle-dir','--app']);
if(args.includes('--help')){
  console.log('本地 macOS 安装预览：node scripts/install.mjs --bundle-dir <解压目录>\n明确安装：同一命令加 --install；请先正常退出 Harness。\n可选 --app <官方 .app 路径>。默认 dry-run，不下载或修改官方 App。');
  process.exit(0);
}
const options={bundleDir:resolve(dirname(fileURLToPath(import.meta.url)),'..'),install:false};
for(let i=0;i<args.length;i++){
  const arg=args[i];
  if(!known.has(arg))throw new Error(`不支持的参数：${arg}`);
  if(arg==='--bundle-dir'||arg==='--app'){
    const value=args[++i];if(!value||value.startsWith('--'))throw new Error(`${arg} 缺少路径`);
    options[arg==='--app'?'appPath':'bundleDir']=resolve(value);
  }else if(arg==='--install')options.install=true;
  else if(arg==='--dry-run')options.install=false;
}
try{
  const r=await runInstallation(options);
  console.log(`安装状态：${r.status}${r.mode==='dry_run'?'（仅预览，未安装）':''}`);
  for(const s of r.steps??[])console.log(`${s.name} ${s.version}：${{preserve:'保留已装版本',install:'待安装',upgrade:`升级现有 ${s.previousVersion}`}[s.action]}`);
  if(r.message)console.log(r.message);
  if(r.officialUrl)console.log(`官方安装入口：${r.officialUrl}`);
  if(r.needsEnable?.length)console.log(`以下已有插件保持原先禁用状态，请在官方插件管理器中启用：${r.needsEnable.join('、')}`);
  if(!['ready','installed'].includes(r.status))process.exitCode=2;
}catch(error){
  console.error(`安装停止：${error.code??'ERROR'} — ${error.message}`);
  if(error.completed?.length)console.error(`此前已完成：${error.completed.map(s=>`${s.name}@${s.version}`).join('、')}`);
  if(error.detail)console.error(error.detail);
  process.exitCode=1;
}
