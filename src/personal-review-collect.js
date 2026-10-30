import {createHash} from 'node:crypto';
import {basename,isAbsolute} from 'node:path';

const DAY=86400000;
const SOURCES=new Set(['gmail','calendar','drive','flomo','dida']);
const instant=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():undefined;
export const redactReviewText=(value,max=6000)=>String(value??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'')
 .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi,'Bearer [已隐藏]')
 .replace(/(["']?(?:access[_-]?token|refresh[_-]?token|api[_-]?key|client[_-]?secret|password|authorization)["']?\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi,'$1[已隐藏]').slice(0,max);
const clean=redactReviewText;
function link(value,source){
 try{const u=new URL(value),roots=source==='flomo'?['flomoapp.com','flomo.app']:source==='dida'?['dida365.com','ticktick.com']:['google.com'];
  if(u.protocol!=='https:'||u.username||u.password||u.port||u.href.length>1600||!roots.some(root=>u.hostname===root||u.hostname.endsWith(`.${root}`))||[...u.searchParams.keys()].some(k=>/token|secret|auth|credential|signature|password/i.test(k)))return;
  return u.href;
 }catch{return;}
}
function relativeEmailDeadline(row){
 const base=instant(row.createdAt);if(!base)return;
 const text=`${row.title??''}\n${row.text??''}`.slice(0,6000).split('\n').filter(line=>!/^\s*>/.test(line)).join('\n');
 if(/\b(?:not|no|never|if|unless|example|quoted)\b|不(?:用|必|需|会|是)|无需|取消|假如|如果|例如|示例|[“”「」]/iu.test(text))return;
 const days=new Set();
 for(const pattern of [/(?:accept|respond|confirm|complete|reply|expire[sd]?|valid)(?:\s+[a-z]+){0,5}\s+(?:in|within)\s+(\d{1,2})\s+days?\b/gi,/(\d{1,2})\s*天内[^。\n]{0,12}(?:接受|确认|回复|完成|处理)/g,/(\d{1,2})\s*天后(?:将)?(?:自动)?(?:升级|生效|过期|失效|到期)/g]){
  for(const match of text.matchAll(pattern)){const n=Number(match[1]);if(n>=1&&n<=31)days.add(n);}
 }
 if(days.size!==1)return;
 return new Date(Date.parse(base)+[...days][0]*DAY).toISOString();
}
/** Bounded discovery over a consented source set. Source text is evidence, never an instruction. */
export function createPersonalReviewCollector({query,readProject,readMemory}={}){
 if(typeof query!=='function'||typeof readProject!=='function')throw Error('Missing personal review readers');
 return async function collect(input){
  const {caller,sources,projects=[],kind,signal,guard}=input;
  const requestedFrom=instant(input.from),to=instant(input.to);
  if(!requestedFrom||!to||Date.parse(to)<=Date.parse(requestedFrom)||!['daily','weekly'].includes(kind)||!Array.isArray(sources)||sources.length>5||new Set(sources).size!==sources.length||sources.some(s=>!SOURCES.has(s))||!Array.isArray(projects)||projects.length>5||projects.some(p=>typeof p!=='string'||!isAbsolute(p))||typeof guard!=='function')throw Error('Invalid personal review collection scope');
  const from=new Date(Math.max(Date.parse(requestedFrom),Date.parse(to)-7*DAY)).toISOString(),clipped=from!==requestedFrom;
  const evidence=[],coverage=[];
  async function check(){signal?.throwIfAborted();if(await guard()!==true)throw Error('Personal review authorization revoked');signal?.throwIfAborted();}
  async function attempt(fn){await check();let value;try{value=await fn();}catch{await check();return null;}await check();return value;}
  const add=(source,row,resource,extra={})=>{
   if(!resource||typeof resource!=='string'||resource.length>4096)return false;
   const id=`${source}_${createHash('sha256').update(resource).digest('hex').slice(0,32)}`;
   const item={id,source,title:clean(row.title??resource,400),text:clean(row.text),...extra};
   const at=instant(row.updatedAt??row.createdAt),explicitDue=source==='calendar'?undefined:instant(row.dueAt),relativeDue=source==='gmail'&&!explicitDue?relativeEmailDeadline(row):undefined,url=link(row.url,source);
   if(source==='calendar'){
    const start=instant(row.startAt??String(row.text??'').match(/^开始：([^\n]+)$/m)?.[1]??row.dueAt),end=instant(row.endAt??String(row.text??'').match(/^结束：([^\n]+)$/m)?.[1]);
    if(start)item.eventStartAt=start;if(end&&(!start||Date.parse(end)>Date.parse(start)))item.eventEndAt=end;
   }
   if(at)item.at=at;
   if(explicitDue){item.dueAt=explicitDue;item.dueAtBasis='source';}
   else if(relativeDue){item.dueAt=relativeDue;item.dueAtBasis='relative';item.text=`${item.text.slice(0,5750)}\n估算相对期限：${relativeDue}（按邮件日期与原文天数推算，实际截止时间需核对原文）。`;}
   if(url)item.url=url;
   const i=evidence.findIndex(e=>e.id===id);if(i>=0)evidence[i]={...evidence[i],...item};else evidence.push(item);return true;
  };
  async function read(source,args){return attempt(()=>query(caller,{...args,source,action:'query',userRequested:true,signal}));}
  for(const source of sources){
   await check();let response,rows=[],partial=clipped,failed=false,windowFrom=from,windowTo=to;
   if(source==='gmail')response=await read(source,{operation:'search',query:`after:${Math.floor(Date.parse(from)/1000)} before:${Math.ceil(Date.parse(to)/1000)}`,limit:10});
   else if(source==='calendar'){
    windowFrom=to;windowTo=new Date(Date.parse(to)+(kind==='weekly'?7:1)*DAY).toISOString();
    response=await read(source,{operation:'upcoming',from:windowFrom,to:windowTo,limit:10});partial=false;
   }else if(source==='dida')response=await read(source,{operation:'projects',limit:5});
   else response=await read(source,{operation:'recent',from,to,limit:source==='flomo'?5:10});
   if(!response||!Array.isArray(response.items)||response.items.length>(['flomo','dida'].includes(source)?5:10))failed=true;
   else{
    rows=response.items;partial ||= response.truncated===true||response.coverage?.hasMore===true||rows.length>=(['flomo','dida'].includes(source)?5:10);
    if(source==='dida'){
     const lists=rows.slice(0,5);rows=[];partial ||= response.items.length>5;
     for(const list of lists){
      if(!list.id||!list.title){partial=true;continue;}
      const tasks=await read(source,{operation:'tasks',projectId:list.id,limit:3});
      if(!tasks||!Array.isArray(tasks.items)||tasks.items.length>3){partial=true;continue;}
      partial ||= tasks.truncated===true||tasks.items.length>=3;
      for(const task of tasks.items.slice(0,3)){if(task.projectId!==list.id){partial=true;continue;}rows.push(task);}
     }
    }
    if(source==='gmail')rows=rows.filter(row=>{const at=instant(row.receivedAt??row.createdAt);if(!at){partial=true;return true;}if(Date.parse(at)<Date.parse(from)||Date.parse(at)>Date.parse(to)){partial=true;return false;}return true;});
    for(const row of rows){if(row.status==='completed'||row.status==='cancelled')continue;
     const resource=source==='dida'?row.id&&`${row.projectId??''}/${row.id}`:row.id;
     if(!add(source,row,resource,source==='drive'?{contentState:'metadata_only',contentScope:'returned_text'}:{}))partial=true;
     if(String(row.text??'').length>6000)partial=true;
    }
    if(['gmail','drive'].includes(source)){
     partial ||= rows.length>3;
     for(const row of rows.slice(0,3)){
      if(!row.id){partial=true;continue;}
      const body=await read(source,{operation:'read',id:row.id});
      if(!body||!Array.isArray(body.items)||!body.items.length){partial=true;if(source==='drive')add(source,row,row.id,{contentState:'unavailable',contentScope:'returned_text'});continue;}
      partial ||= body.truncated===true;
      // Only expand the exact returned resource; provider identifiers cannot widen this read.
      const item=body.items.find(x=>x.id===row.id);
      if(!item||item.status==='unsupported_content'){partial=true;if(source==='drive')add(source,row,row.id,{contentState:'unavailable',contentScope:'returned_text'});continue;}
      const contentState=source==='drive'?(body.truncated===true||String(item.text??'').length>6000?'truncated':typeof item.text!=='string'?'unread':item.text.length===0?'actual_empty':'read'):undefined;
      if(contentState==='unread')partial=true;
      add(source,{...row,...item},row.id,contentState?{contentState,contentScope:'returned_text'}:{});if(String(item.text??'').length>6000)partial=true;
     }
    }
   }
   coverage.push({source,status:failed?'unavailable':partial?'partial':'ok',count:failed?null:evidence.filter(e=>e.source===source).length,truncated:!failed&&partial,from:windowFrom,to:windowTo});
  }
  for(const root of projects){
   const result=await attempt(()=>readProject(caller,root,{signal}));const rows=Array.isArray(result)?result:result?.sources;
   let partial=!Array.isArray(rows),count=0;
   for(const row of (rows??[]).slice(0,3)){
    if(row.status!=='ok'||!['README.md','.agent/memory/context.md','.agent/memory/progress.md'].includes(row.path)){partial=true;continue;}
    partial ||= row.truncated===true||String(row.text??'').length>6000;
    add('project',{title:`${basename(root)} / ${row.path}`,text:row.text,updatedAt:row.modifiedAt},`${root}/${row.path}`);count++;
   }
   coverage.push({source:'project',status:!count?'unavailable':partial?'partial':'ok',count:count||null,truncated:partial});
   if(typeof readMemory==='function'){
    const memory=await attempt(()=>readMemory(caller,root,{signal}));
    const entries=Array.isArray(memory)?memory:memory?[...(memory.goals??[]),...(memory.entries??[])]:null;
    let n=0,cut=(entries?.length??0)>5;
    for(const entry of (entries??[]).slice(0,5)){
     // Memories retain their provenance, including whether a claim came from an assistant.
     if(!entry.id||!entry.source?.kind||!entry.text){cut=true;continue;}
     add('memory',{title:`${basename(root)} / ${entry.kind??'记忆'}（${entry.source.kind}）`,text:entry.text,updatedAt:entry.at},`${root}/${entry.id}`);n++;
    }
    coverage.push({source:'memory',status:!entries?'unavailable':cut?'partial':'ok',count:entries?n:null,truncated:cut});
   }
  }
  // Keep a mixed-source review within the model input budget. Trim the longest
  // bodies first so a large document cannot crowd out the other sources.
  for(const item of evidence)item.contentDigest=createHash('sha256').update(item.text.normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ')).digest('hex');
  const limited=new Set();
  while(JSON.stringify(evidence).length>100000){
   const longest=evidence.reduce((a,b)=>b.text.length>a.text.length?b:a,evidence[0]);
   if(longest?.text.length>300){if(longest.source==='drive'&&['read','truncated'].includes(longest.contentState))longest.contentState='truncated';longest.text=longest.text.slice(0,Math.max(300,Math.floor(longest.text.length/2)));limited.add(longest.source);}
   else{
    // Extreme metadata can also consume the budget; omit whole evidence rows,
    // never produce a severed JSON record or pretend the scope was complete.
    let at=0;for(let i=1;i<evidence.length;i++)if(JSON.stringify(evidence[i]).length>JSON.stringify(evidence[at]).length)at=i;
    const [removed]=evidence.splice(at,1);if(removed)limited.add(removed.source);else break;
   }
  }
  for(const row of coverage)if(limited.has(row.source)&&!['unavailable','failed'].includes(row.status)){row.status='partial';row.truncated=true;}
  await check();return{evidence,coverage};
 };
}
