import {readProjectFiles,PROJECT_FILES,FILE_BYTES} from './sources.js';

const bound=c=>c?.state==='bound'&&typeof c.sessionId==='string'&&c.sessionId.length>0&&c.sessionId.length<=200&&!c.sessionId.startsWith('family_member_')&&/^[a-f0-9]{64}$/.test(c.bindingKey??'');
const same=(a,b)=>bound(a)&&bound(b)&&a.sessionId===b.sessionId&&a.bindingKey===b.bindingKey;
const unavailable=()=>{throw Object.assign(new Error('CATALOG_SCOPE_UNAVAILABLE'),{code:'CATALOG_SCOPE_UNAVAILABLE'});};
const clean=(text,root,binding)=>String(text??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').split(root).join('[项目目录]').split(binding).join('[已隐藏]').replace(/((?:access[_-]?token|refresh[_-]?token|api[_-]?key|client[_-]?secret|password|authorization)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi,'$1[已隐藏]');

/** The official connection carrier authenticates HTTP Owner access. */
export function createProjectCatalogController({catalog,readConnection,readProject=readProjectFiles,isPaused=async()=>false,isPausedSync=()=>true,isClosed=()=>false}={}){
  const connection=async()=>{if(isClosed())unavailable();const raw=await readConnection?.();if(isClosed()||!bound(raw))unavailable();return{state:'bound',sessionId:raw.sessionId,bindingKey:raw.bindingKey};};
  const recheck=async c=>{if(!same(c,await connection()))unavailable();};
  return{async action(input){
    if(!input||typeof input!=='object'||Array.isArray(input)||!['list','preview'].includes(input.action))unavailable();
    const allowed=input.action==='list'?['action','query','offset','limit','expectedRevision']:['action','projectId','expectedRevision'];
    if(Object.keys(input).some(k=>!allowed.includes(k)))unavailable();
    const c=await connection();
    if(input.action==='list'){const{action,...args}=input;const result=await catalog.page(args);await recheck(c);catalog.assertCurrentRevision(result.revision);return result;}
    if(typeof input.expectedRevision!=='string'||!/^[a-f0-9]{64}$/.test(input.expectedRevision)||await isPaused())unavailable();
    const target=catalog.resolvePublicId(input);await recheck(c);
    const admitted=catalog.resolvePublicId(input);
    if(isClosed()||isPausedSync()!==false||admitted.workspaceId!==target.workspaceId||admitted.root!==target.root)unavailable();
    const files=await readProject(target.root);if(await isPaused())unavailable();await recheck(c);
    const current=catalog.resolvePublicId(input);if(isPausedSync()!==false||current.workspaceId!==target.workspaceId||current.root!==target.root)unavailable();
    if(!Array.isArray(files))unavailable();
    const sources=files.filter(f=>PROJECT_FILES.includes(f?.path)).slice(0,3).map(f=>{
      if(f.status!=='ok')return{path:f.path,status:['missing','rejected'].includes(f.status)?f.status:'unavailable'};
      const bytes=Buffer.from(clean(f.text,target.root,c.bindingKey),'utf8'),capped=bytes.length>FILE_BYTES;
      return{path:f.path,status:'ok',text:new TextDecoder().decode(bytes.subarray(0,FILE_BYTES),{stream:capped}),truncated:capped||f.truncated===true,modifiedAt:typeof f.modifiedAt==='string'&&Number.isFinite(Date.parse(f.modifiedAt))?new Date(f.modifiedAt).toISOString():null};
    });
    return{version:1,project:{id:target.id,label:target.label},revision:input.expectedRevision,previewOnly:true,historyScan:false,sources};
  }};
}

export function registerProjectCatalogRoute(ctx,controller){
  const connection=ctx.get('connection');if(typeof connection?.fetch?.register!=='function')return null;
  let closed=false;const json=(v,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store'}});
  const off=connection.fetch.register({path:'/api/project_companion/catalog',methods:['POST'],requestBody:'buffered',async fetch(request){
    if(closed)return json({error:'项目目录已关闭。'},503);if(request.method!=='POST')return json({error:'仅支持 POST。'},405);
    try{
      if(new URL(request.url).search)return json({error:'查询请使用 JSON。'},400);
      if(request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/json')return json({error:'请使用 JSON。'},415);
      const length=request.headers.get('Content-Length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>4096))return json({error:'请求过大。'},413);
      const body=await request.text();if(Buffer.byteLength(body)>4096)return json({error:'请求过大。'},413);if(closed)return json({error:'项目目录已关闭。'},503);
      const result=await controller.action(JSON.parse(body));return closed?json({error:'项目目录已关闭。'},503):json(result);
    }catch(error){return json({error:error?.code==='CATALOG_CHANGED'?'项目目录已变化，请刷新后继续。':'项目目录暂不可用，未继续读取或更改安排。',...(error?.code==='CATALOG_CHANGED'?{code:'CATALOG_CHANGED'}:{})},error?.code==='CATALOG_CHANGED'?409:400);}
  }});
  const stop=()=>{if(closed)return;closed=true;off?.();};ctx.effect?.(()=>stop);return stop;
}
