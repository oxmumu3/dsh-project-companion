import {createHash} from 'node:crypto';
import {basename,dirname,isAbsolute,resolve} from 'node:path';

const clean=(value,max=80)=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
const normalized=value=>String(value).normalize('NFKC').toLocaleLowerCase().trim();
const error=code=>Object.assign(new Error(code),{code});
export const projectPublicId=root=>`project_${createHash('sha256').update(root).digest('hex').slice(0,24)}`;
const fingerprint=rows=>createHash('sha256').update(JSON.stringify(rows.map(p=>[p.workspaceId,p.root,p.label]))).digest('hex');

export function validateCatalogPage(input={}){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['query','offset','limit','expectedRevision'].includes(k)))throw error('CATALOG_ARGUMENT');
  const {query='',offset=0,limit=20,expectedRevision}=input;
  if(typeof query!=='string'||Array.from(query).length>80||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>50||expectedRevision!==undefined&&!/^[a-f0-9]{64}$/.test(expectedRevision))throw error('CATALOG_ARGUMENT');
  return{query:normalized(query),offset,limit,expectedRevision};
}

/** Metadata only. No filesystem, session activation, provider or persistent writes. */
export function createProjectCatalog({readRegistered,readWatched=async()=>[],isClosed=()=>false}={}){
  const snapshot=()=>{
    if(isClosed()||typeof readRegistered!=='function')throw error('CATALOG_UNAVAILABLE');
    let entries;try{entries=readRegistered();}catch{throw error('CATALOG_UNAVAILABLE');}
    if(!Array.isArray(entries))throw error('CATALOG_UNAVAILABLE');
    const roots=new Map(),ids=new Map();
    for(const row of entries){
      const root=row?.path??row?.root,id=row?.workspaceId??row?.id;
      if(typeof root!=='string'||!isAbsolute(root)||root.length>4096||resolve(root)!==root||typeof id!=='string'||!id||id.length>4096||!Array.isArray(row.sessionIds??[]))throw error('CATALOG_UNAVAILABLE');
      if(ids.has(id)&&ids.get(id)!==root||roots.has(root)&&roots.get(root).workspaceId!==id)throw error('CATALOG_UNAVAILABLE');
      const label=clean(row.title??row.label??basename(root))||'未命名项目';
      const sessionIds=[...new Set((row.sessionIds??[]).filter(s=>typeof s==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(s)))];
      const prior=roots.get(root);
      roots.set(root,{id:projectPublicId(root),workspaceId:id,root,label,sessionIds:[...new Set([...(prior?.sessionIds??[]),...sessionIds])],registered:true});ids.set(id,root);
    }
    const rows=[...roots.values()];return{rows,revision:fingerprint(rows)};
  };
  const assertRevision=(revision,expected)=>{if(expected!==undefined&&revision!==expected)throw error('CATALOG_CHANGED');};
  const target=reference=>{
    if(typeof reference!=='string'||!reference.trim()||reference.length>4096)throw error('CATALOG_ARGUMENT');
    const {rows}=snapshot(),ref=reference.trim();let matches=rows.filter(p=>p.id===ref||p.workspaceId===ref||p.root===ref);
    if(!matches.length&&!isAbsolute(ref)){const q=normalized(ref);matches=rows.filter(p=>normalized(p.label)===q);if(!matches.length&&Array.from(q).length>=2)matches=rows.filter(p=>normalized(p.label).includes(q)||normalized(basename(p.root)).includes(q));}
    if(matches.length>1)throw error('CATALOG_AMBIGUOUS');return matches.length?structuredClone(matches[0]):null;
  };
  return{
    targets:()=>structuredClone(snapshot().rows),
    assertCurrentRevision(revision){if(typeof revision!=='string'||!/^[a-f0-9]{64}$/.test(revision))throw error('CATALOG_ARGUMENT');assertRevision(snapshot().revision,revision);return true;},
    async page(input={}){
      const args=validateCatalogPage(input),initial=snapshot();assertRevision(initial.revision,args.expectedRevision);
      let watched;try{watched=await readWatched();}catch{throw error('CATALOG_UNAVAILABLE');}
      if(!Array.isArray(watched)||watched.length>5)throw error('CATALOG_UNAVAILABLE');
      const current=snapshot();assertRevision(current.revision,initial.revision);
      const watchedRoots=new Set(watched.filter(p=>typeof p?.root==='string').map(p=>p.root));
      const matches=current.rows.filter(p=>!args.query||normalized(p.label).includes(args.query)||normalized(basename(p.root)).includes(args.query));
      const labels=new Map();for(const p of current.rows)labels.set(normalized(p.label),(labels.get(normalized(p.label))??0)+1);
      const items=matches.slice(args.offset,args.offset+args.limit).map(p=>({id:p.id,label:p.label,...(labels.get(normalized(p.label))>1?{disambiguator:clean(basename(dirname(p.root)),60)}:{}),watched:watchedRoots.has(p.root),sessionCount:p.sessionIds.length,registered:true}));
      const hasMore=args.offset+items.length<matches.length;
      return{version:1,scope:'registered',complete:true,revision:current.revision,total:current.rows.length,matchedTotal:matches.length,offset:args.offset,limit:args.limit,items,hasMore,nextOffset:hasMore?args.offset+items.length:null,watchedCount:watchedRoots.size,watchLimit:5};
    },
    resolvePublicId({projectId,expectedRevision}={}){
      if(typeof projectId!=='string'||!/^project_[a-f0-9]{24}$/.test(projectId)||expectedRevision!==undefined&&!/^[a-f0-9]{64}$/.test(expectedRevision))throw error('CATALOG_ARGUMENT');
      const current=snapshot();assertRevision(current.revision,expectedRevision);const row=current.rows.find(p=>p.id===projectId);if(!row)throw error('CATALOG_UNKNOWN');return structuredClone(row);
    },
    registeredProjectTarget:target,
    // Registration/membership only; caller must ALSO enforce current Owner,
    // binding/call authority, effective cwd, non-subagent and pause gates.
    authorizeRegisteredCoordinationSync(scope){
      if(!scope||typeof scope.workspaceId!=='string'||typeof scope.projectRoot!=='string'||typeof scope.sessionId!=='string')return false;
      try{const row=snapshot().rows.find(p=>p.workspaceId===scope.workspaceId&&p.root===scope.projectRoot);return !!row&&row.sessionIds.includes(scope.sessionId);}catch{return false;}
    },
  };
}
