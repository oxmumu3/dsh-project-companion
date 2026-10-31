import {randomUUID} from 'node:crypto';
import {isAbsolute,resolve} from 'node:path';
import {z} from 'zod';
const id=z.string().regex(/^project_[a-f0-9]{24}$/),identity=z.string().min(1).max(4096).refine(s=>!/[\u0000-\u001f\u007f]/.test(s));
const root=identity.refine(s=>isAbsolute(s)&&resolve(s)===s),stamp=z.string().max(40).refine(s=>Number.isFinite(Date.parse(s)));
export const workspaceAccessRowSchema=z.object({version:z.literal(1),revision:z.string().min(1).max(100),grants:z.array(z.object({id,workspaceId:identity,root,grantedAt:stamp}).strict()).max(1000),updatedAt:stamp.nullable()}).strict().superRefine((s,c)=>{if(new Set(s.grants.map(g=>g.id)).size!==s.grants.length)c.addIssue({code:'custom',message:'Duplicate workspace grant'});});
const fail=code=>{throw Object.assign(new Error(code),{code});};
const empty=()=>({version:1,revision:'workspace-access:0',grants:[],updatedAt:null});
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const same=(a,b)=>a.id===b.id&&a.workspaceId===b.workspaceId&&a.root===b.root;
export function createWorkspaceAccess({store,catalog,clock=()=>new Date(),isClosed=()=>false}={}){
 let closed=false,cached=null,tail=Promise.resolve();const listeners=new Set();
 const open=()=>{if(closed||isClosed())fail('WORKSPACE_ACCESS_UNAVAILABLE');};
 const read=async()=>{open();try{const raw=await store.get('profile');open();cached=workspaceAccessRowSchema.parse(raw??empty());return cached;}catch(error){cached=null;if(error?.code)throw error;fail('WORKSPACE_ACCESS_UNAVAILABLE');}};
 const targets=()=>{open();try{return catalog.targets();}catch{fail('WORKSPACE_CATALOG_CHANGED');}};
 const currentRows=state=>{const rows=targets();return{rows,valid:state.grants.filter(g=>rows.some(r=>same(g,r)))};};
 const pageArgs=args=>{if(!record(args)||Object.keys(args).some(k=>!['query','offset','limit','expectedCatalogRevision'].includes(k)))fail('WORKSPACE_ACCESS_ARGUMENT');const {expectedCatalogRevision,...rest}=args;return{...rest,...(expectedCatalogRevision===undefined?{}:{expectedRevision:expectedCatalogRevision})};};
 const publish=()=>{for(const fn of [...listeners]){try{fn();}catch{}}};
 const serial=fn=>{const next=tail.then(fn,fn);tail=next.catch(()=>{});return next;};
 async function list(args={}){
  const input=pageArgs(args),state=await read();let page;
  try{page=await catalog.page(input);}catch(error){fail(error?.code==='CATALOG_CHANGED'?'WORKSPACE_CATALOG_CHANGED':'WORKSPACE_ACCESS_ARGUMENT');}
  open();const {valid}=currentRows(state),ids=valid.map(g=>g.id),selected=new Set(ids);
  // A newer save while metadata was awaited cannot be presented as old grants.
  const after=await read();if(after.revision!==state.revision)fail('WORKSPACE_ACCESS_CHANGED');
  try{catalog.assertCurrentRevision(page.revision);}catch{fail('WORKSPACE_CATALOG_CHANGED');}
  return{version:1,revision:state.revision,catalogRevision:page.revision,total:page.total,matchedTotal:page.matchedTotal,offset:page.offset,limit:page.limit,hasMore:page.hasMore,nextOffset:page.nextOffset,items:page.items.map(({id,label,sessionCount,disambiguator})=>({id,label,sessionCount,selected:selected.has(id),available:true,...(disambiguator?{disambiguator}:{})})),selectedIds:ids,selectedCount:ids.length,unavailableCount:state.grants.length-valid.length};
 }
 async function capture(){const state=await read(),{rows,valid}=currentRows(state);if(valid.length!==state.grants.length)fail('WORKSPACE_CATALOG_CHANGED');return{revision:state.revision,grants:valid.map(g=>{const r=rows.find(r=>same(g,r));return{id:r.id,workspaceId:r.workspaceId,root:r.root,label:r.label,sessionIds:[...r.sessionIds]};})};}
 function authorizeSync(snapshot){
  try{open();if(!record(snapshot)||!cached||snapshot.revision!==cached.revision||!Array.isArray(snapshot.grants)||snapshot.grants.length!==cached.grants.length)return false;const rows=targets();return cached.grants.every(g=>{const p=snapshot.grants.find(p=>same(p,g)),r=rows.find(r=>same(g,r));return p&&r&&Array.isArray(p.sessionIds)&&p.sessionIds.every(id=>r.sessionIds.includes(id));});}catch{return false;}
 }
 return{
  list,capture,authorizeSync,
  async assertCurrent(snapshot){const current=await capture();if(current.revision!==snapshot?.revision)fail('WORKSPACE_ACCESS_CHANGED');if(!authorizeSync(snapshot))fail('WORKSPACE_CATALOG_CHANGED');return true;},
  save(args){return serial(async()=>{
   open();if(!record(args)||Object.keys(args).sort().join(',')!=='expectedCatalogRevision,expectedRevision,workspaceIds'||typeof args.expectedRevision!=='string'||!Array.isArray(args.workspaceIds)||args.workspaceIds.length>1000||new Set(args.workspaceIds).size!==args.workspaceIds.length||args.workspaceIds.some(v=>!id.safeParse(v).success))fail('WORKSPACE_ACCESS_ARGUMENT');
   const state=await read();if(state.revision!==args.expectedRevision)fail('WORKSPACE_ACCESS_CHANGED');
   try{catalog.assertCurrentRevision(args.expectedCatalogRevision);}catch{fail('WORKSPACE_CATALOG_CHANGED');}
   const now=clock().toISOString();const grants=args.workspaceIds.map(projectId=>{let r;try{r=catalog.resolvePublicId({projectId,expectedRevision:args.expectedCatalogRevision});}catch(error){fail(error?.code==='CATALOG_CHANGED'?'WORKSPACE_CATALOG_CHANGED':'WORKSPACE_ACCESS_ARGUMENT');}return{id:r.id,workspaceId:r.workspaceId,root:r.root,grantedAt:state.grants.find(g=>same(g,r))?.grantedAt??now};});
   if(state.grants.length===grants.length&&state.grants.every(g=>grants.some(r=>same(g,r))))return list();
   open();const next=workspaceAccessRowSchema.parse({version:1,revision:'workspace-access:'+randomUUID(),grants,updatedAt:now});
   // No user file, historical session, model or schedule is touched here.
   try{await store.put('profile',next);}catch{cached=null;publish();fail('WORKSPACE_ACCESS_UNAVAILABLE');}
   cached=next;publish();open();return list();
  });},
  subscribe(fn){open();if(typeof fn!=='function')fail('WORKSPACE_ACCESS_ARGUMENT');listeners.add(fn);return()=>listeners.delete(fn);},
  close(){closed=true;cached=null;publish();listeners.clear();},
 };
}
