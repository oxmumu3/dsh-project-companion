import {createHash} from 'node:crypto';
import {isAbsolute} from 'node:path';
import {readProjectFiles,PROJECT_FILES,validateRepository} from './sources.js';

const CONNECTION_STATES=new Set(['missing','unknown','waiting-qr','scanned','awaiting-message','bound','failed']);
const JOB_STATES=new Set(['prepared','admitted','running','not_admitted','unknown','discarded','mixed','completed','blocked','aborted','error','max-tokens','interrupted','forked','no_text','expired']);
const DELIVERY_STATES=new Set(['pending','blocked','dispatching','queued','reported_sent','failed','uncertain','expired','cancelled','history_pruned']);
const REMINDER_STATES=new Set(['scheduled','enqueued','expired','cancelled']);
const MEMORY_KINDS=new Set(['goal','decision','blocker','next_step','context']);
const emptyOverview=()=>({available:false,goals:[],blockers:[],nextSteps:[],recent:[]});
const identity=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
const bound=value=>value?.state==='bound'&&identity(value.sessionId)&&/^[a-f0-9]{64}$/.test(value.bindingKey??'');
const same=(a,b)=>bound(a)&&bound(b)&&a.sessionId===b.sessionId&&a.bindingKey===b.bindingKey;
const at=value=>typeof value==='string'&&value.length<=40&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
const list=(value,max)=>Array.isArray(value)?value.slice(0,max):[];
const publicId=root=>`project_${createHash('sha256').update(root).digest('hex').slice(0,24)}`;
const validProject=value=>value&&typeof value.root==='string'&&isAbsolute(value.root)&&value.root.length<=4096&&typeof value.label==='string'&&value.label.length<=80&&Array.isArray(value.sessionIds)&&value.sessionIds.length<=30&&value.sessionIds.every(identity)&&at(value.watchedAt)&&Array.isArray(value.events)&&value.events.length<=30&&value.events.every(event=>['user','assistant','error'].includes(event?.kind)&&typeof event.text==='string'&&at(event.at));
const validDaily=value=>value===null||value&&/^([01]\d|2[0-3]):[0-5]\d$/.test(value.time??'')&&typeof value.timeZone==='string'&&value.timeZone.length<=100&&typeof value.enabled==='boolean';
const validPlans=value=>value&&!Array.isArray(value)&&typeof value.paused==='boolean'&&validDaily(value.daily)&&Array.isArray(value.reminders)&&value.reminders.length<=100&&value.reminders.every(row=>identity(row?.id)&&typeof row.title==='string'&&at(row.dueAt)&&REMINDER_STATES.has(row.status))&&Array.isArray(value.outbox)&&value.outbox.length<=100&&value.outbox.every(row=>identity(row?.id)&&DELIVERY_STATES.has(row.status));
const limitations=[
  '仅展示已关注项目的固定本地文件和启用后已观察记录；文件内容可能滞后。',
  '助手记录和执行完成状态仍待验收；通道报告发送不代表手机收到或已读。',
  '来源、动态、交办及提醒只显示有界窗口，截断内容不代表全文。',
  '交办仅属于当前已核对绑定的来源会话；此页面不会恢复冷会话或执行任务。',
];

/** A passive projection of existing state. It owns no store, agent or scheduler. */
export function createWorkbench({service,taskResults,memory,readState=async()=>null,readConnection=async()=>({state:'unknown'}),readProject=readProjectFiles,clock=()=>new Date(),hostTimeZone=()=>Intl.DateTimeFormat().resolvedOptions().timeZone,isClosed=()=>false}={}){
  let closed=false;
  const open=()=>{if(closed||isClosed())throw new Error('项目工作台已关闭。');};
  const connection=async()=>{open();try{const value=await readConnection();open();if(!CONNECTION_STATES.has(value?.state)||(value.state==='bound'&&!bound(value)))return{state:'unknown'};return bound(value)?{state:'bound',sessionId:value.sessionId,bindingKey:value.bindingKey}:{state:value.state};}catch(error){open();return{state:'unknown'};}};
  async function snapshot(){
    open();
    const issues=[...limitations];
    const [projectResult,stateResult,initial]=await Promise.allSettled([service.watchedProjects(),readState(),connection()]);
    open();
    const availability={projects:projectResult.status==='fulfilled'&&Array.isArray(projectResult.value)&&projectResult.value.length<=5&&projectResult.value.every(validProject),plans:stateResult.status==='fulfilled'&&Boolean(validPlans(stateResult.value)),jobs:false};
    const watched=projectResult.status==='fulfilled'?list(projectResult.value,5).filter(p=>typeof p?.root==='string'&&isAbsolute(p.root)&&p.root.length<=4096):[];
    if(!availability.projects)issues.push('已关注项目暂不可用；未扩展读取范围。');
    const state=availability.plans?stateResult.value:null;
    if(!state)issues.push('计划及提醒状态暂不可用。');
    const expected=initial.status==='fulfilled'?initial.value:{state:'unknown'};
    const hidden=[...watched.map(p=>p.root),...(bound(expected)?[expected.bindingKey]:[])].sort((a,b)=>b.length-a.length);
    const clean=(value,max)=>{
      let text=typeof value==='string'?value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,''):'';
      for(const secret of hidden)text=text.split(secret).join('[已隐藏]');
      // No config or account context is read. Mask common accidental credential
      // assignments in the selected files before returning a short preview.
      text=text.replace(/((?:access[_-]?token|refresh[_-]?token|api[_-]?key|client[_-]?secret|password|authorization)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi,'$1[已隐藏]');
      let result='';for(const char of text){if(result.length+char.length>max)break;result+=char;}return result;
    };
    const overviewOf=value=>{
      if(!Array.isArray(value?.goals)||value.goals.length>10||!Array.isArray(value?.entries)||value.entries.length>100)return emptyOverview();
      const rows=[];const seen=new Set();
      for(const row of [...value.goals,...value.entries]){
        if(!identity(row?.id)||seen.has(row.id)||!MEMORY_KINDS.has(row.kind)||typeof row.text!=='string'||!row.text.trim()||!at(row.at))continue;
        const source=row.source;
        if(!source||!['user','assistant','file'].includes(source.kind)||typeof source.reference!=='string'||!source.reference.trim())continue;
        const reference=source.reference;
        if(source.kind==='file'){
          const path=reference.split('#')[0];
          if(!path||isAbsolute(path)||path.includes('\\')||/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(path)||path.split('/').some(part=>!part||part==='.'||part==='..'))continue;
        }else if(!reference.startsWith('session:')||!identity(reference.slice(8).split('#')[0]))continue;
        seen.add(row.id);
        rows.push({id:row.id,kind:row.kind,text:clean(row.text,500),at:at(row.at),source:{kind:source.kind,reference:clean(reference,500)},verified:false});
      }
      rows.sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
      return{available:true,goals:rows.filter(row=>row.kind==='goal').slice(0,3),blockers:rows.filter(row=>row.kind==='blocker').slice(0,3),nextSteps:rows.filter(row=>row.kind==='next_step').slice(0,3),recent:rows.slice(0,4)};
    };
    const projects=await Promise.all(watched.map(async project=>{
      const root=project.root;
      let files;
      try{files=await readProject(root);}catch{files=PROJECT_FILES.map(path=>({path,status:'unavailable'}));}
      open();
      let overview=emptyOverview();
      if(typeof memory?.inspect==='function'){
        try{overview=overviewOf(await memory.inspect({root,sessionId:'workbench-view'}));}catch{open();}
      }
      open();
      const sources=[];
      for(const name of PROJECT_FILES){
        const row=list(files,12).find(file=>file?.path===name);if(!row)continue;
        const status=['ok','missing','rejected'].includes(row.status)?row.status:'unavailable';
        const text=status==='ok'?clean(row.text,1800):({missing:'文件缺失。',rejected:'文件未通过安全读取检查。',unavailable:'来源暂不可用。'}[status]);
        const updatedAt=at(row.modifiedAt);
        sources.push({name,status,text,...(updatedAt?{updatedAt}:{}),...(status==='ok'?{truncated:row.truncated===true||(typeof row.text==='string'&&row.text.length>1800)}:{})});
      }
      let github;try{github=validateRepository(project.github);}catch{}
      const watchedAt=at(project.watchedAt);
      return{id:publicId(root),label:clean(project.label,80)||'已关注项目',sessionIds:[...new Set(list(project.sessionIds,30).filter(identity))],...(github?{github}:{}),...(watchedAt?{watchedAt}:{}),overview,sources,
        events:list(project.events,30).slice(-5).filter(event=>['user','assistant','error'].includes(event?.kind)&&at(event.at)).map(event=>({kind:event.kind,text:clean(event.text,500),at:at(event.at),truncated:event.truncated===true||(typeof event.text==='string'&&event.text.length>500)}))};
    }));
    open();
    let current=await connection(),jobs=[];
    if(bound(expected)&&same(expected,current)&&typeof taskResults?.status==='function'){
      try{
        const result=await taskResults.status(expected.sessionId);
        open();
        if(!Array.isArray(result?.jobs)||result.jobs.length>10||result.jobs.some(job=>!identity(job?.id)||!at(job.createdAt)||!JOB_STATES.has(job.status)||typeof job.task!=='string'||typeof job.projectLabel!=='string'))throw new Error('交办状态格式不可用。');
        jobs=list(result?.jobs,10).filter(job=>identity(job?.id)&&at(job.createdAt)).map(job=>({id:job.id,projectLabel:clean(job.projectLabel,80),task:clean(job.task,160),status:JOB_STATES.has(job.status)?job.status:'unknown',createdAt:at(job.createdAt),
          ...(at(job.finishedAt)?{finishedAt:at(job.finishedAt)}:{}),...(job.delivery?{delivery:{status:DELIVERY_STATES.has(job.delivery.status)?job.delivery.status:'uncertain',detail:clean(job.delivery.detail,160)}}:{})}));
        availability.jobs=true;
      }catch(error){open();availability.jobs=false;jobs=[];issues.push('当前绑定会话的交办状态暂不可用。');}
      current=await connection();
    }
    if(bound(expected)&&!same(expected,current)){jobs=[];availability.jobs=false;current={state:'unknown'};issues.push('读取时原绑定已变化，已丢弃交办内容；请刷新核对。');}
    // An initially unbound snapshot never adopts a newly bound session midway.
    if(!bound(expected))current={state:expected.state};
    const outbox=list(state?.outbox,100);
    const reminders=list(state?.reminders,100).filter(row=>identity(row?.id)&&at(row.dueAt)&&REMINDER_STATES.has(row.status)).map(row=>{
      const deliveryStatus=row.outboxId?outbox.find(item=>item?.id===row.outboxId)?.status??'history_pruned':null;
      return{id:row.id,title:clean(row.title,200),dueAt:at(row.dueAt),status:row.status,...(DELIVERY_STATES.has(deliveryStatus)?{deliveryStatus}:{})};
    }).filter(row=>row.status==='scheduled'||row.status==='enqueued'&&['pending','blocked','dispatching'].includes(row.deliveryStatus));
    const daily=state?.daily;
    let zone='unknown';try{const value=typeof hostTimeZone==='function'?hostTimeZone():hostTimeZone;if(typeof value==='string'&&value.length<=100){new Intl.DateTimeFormat('en',{timeZone:value});zone=value;}}catch{}
    open();
    return{version:1,generatedAt:clock().toISOString(),hostTimeZone:zone,paused:typeof state?.paused==='boolean'?state.paused:null,availability,
      connection:{state:current.state,...(bound(current)?{sessionId:current.sessionId}:{})},projects,jobs,reminders:reminders.slice(0,20),daily:daily?{time:daily.time,timeZone:daily.timeZone,enabled:daily.enabled===true}:null,
      counts:{projects:projects.length,activeReminders:reminders.length},limitations:issues};
  }
  return{snapshot,close(){closed=true;}};
}

/** The official owner-authenticated connection layer is the only transport. */
export function registerWorkbenchRoute(ctx,adapter){
  const connection=ctx.get('connection');
  if(typeof connection?.fetch?.register!=='function')return null;
  let closed=false;
  const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
  const unregister=connection.fetch.register({path:'/api/project_companion/workbench',methods:['GET'],requestBody:'buffered',async fetch(request){
    if(closed)return json({error:'项目工作台已关闭。'},503);
    if(request.method!=='GET')return json({error:'仅支持只读 GET。'},405);
    try{
      if(new URL(request.url).search||request.body!=null)return json({error:'只读工作台不接受参数或请求正文。'},400);
      const value=await adapter.snapshot();
      return closed?json({error:'项目工作台已关闭。'},503):json(value);
    }catch{return json({error:'工作台暂不可用，请刷新后核对。'},503);}
  }});
  const stop=()=>{if(closed)return;closed=true;unregister?.();};
  if(typeof ctx.effect==='function')ctx.effect(()=>stop);
  return stop;
}
