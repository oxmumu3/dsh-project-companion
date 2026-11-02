import {lstat,mkdir,readFile,writeFile,realpath} from 'node:fs/promises';
import {isAbsolute,join} from 'node:path';

const fail=reason=>Object.assign(Error(reason),{reason});
async function json(file,maximum){
  let info;try{info=await lstat(file);}catch(e){if(e.code==='ENOENT')return null;throw fail('storage_unavailable');}
  if(!info.isFile()||info.isSymbolicLink()||info.size>maximum)throw fail('storage_unavailable');
  try{return JSON.parse(await readFile(file,'utf8'));}catch{throw fail('storage_unavailable');}
}

/** Isolate new embedded state from legacy ~/.dsh-wechat and other profiles. */
export async function prepareOwnedWechatStorage(ctx){
  let profile;try{profile=ctx.get?.('profileContext',false)??ctx.get?.('pluginManager',false)?.profile;}catch{}
  if(typeof profile?.dir!=='string'||!isAbsolute(profile.dir))throw fail('storage_unavailable');
  const profileDir=await realpath(profile.dir),dir=join(profileDir,'dot-wechat');
  const marker=join(dir,'dot-owner.json'),owner={version:1,plugin:'dsh-project-companion',profileDir};
  let created=false;
  try{await mkdir(dir,{mode:0o700});created=true;}catch(e){if(e.code!=='EEXIST')throw fail('storage_unavailable');}
  const info=await lstat(dir);
  if(!info.isDirectory()||info.isSymbolicLink())throw fail('existing_storage');
  if(created)await writeFile(marker,JSON.stringify(owner)+'\n',{flag:'wx',mode:0o600});
  const prior=await json(marker,8192);
  if(prior?.version!==1||prior.plugin!==owner.plugin||prior.profileDir!==profileDir)throw fail('existing_storage');
  // Corrupt auth remains blocked. A missing token (including an interrupted
  // re-scan) can reach the embedded bridge's non-destructive QR recovery.
  const state=await json(join(dir,'state.json'),8*1024*1024);
  if(state!==null&&(!state||typeof state!=='object'||!state.users||typeof state.users!=='object'||Array.isArray(state.users)))throw fail('storage_unavailable');
  const token=await json(join(dir,'auth','token.json'),64*1024);
  // Older valid credentials may lack scanner identity. Let the fail-closed
  // pairing resolver expose local recovery; a persisted first sender is not
  // promoted to authority. Malformed credentials remain blocked here.
  if(token!==null&&(!token||typeof token!=='object'||!['token','baseUrl','accountId'].every(key=>typeof token[key]==='string'&&token[key].length>0)||(token.userId!==undefined&&(typeof token.userId!=='string'||!token.userId))))throw fail('bound_token_unavailable');
  return dir;
}
