import {matchesBindingRevision} from './workbench-scope.js';
import {createHash} from 'node:crypto';
import {isAbsolute,resolve,parse} from 'node:path';

const identity=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
const bound=value=>value?.state==='bound'&&identity(value.sessionId)&&/^[a-f0-9]{64}$/.test(value.bindingKey??'');
const same=(a,b)=>bound(a)&&bound(b)&&a.sessionId===b.sessionId&&a.bindingKey===b.bindingKey;
const validReturnBinding=value=>value&&/^[a-f0-9]{64}$/.test(value.userHash??'')&&(value.botHash===undefined||/^[a-f0-9]{64}$/.test(value.botHash));
const sameReturnBinding=(a,b)=>validReturnBinding(a)&&validReturnBinding(b)&&a.userHash===b.userHash&&(a.botHash??null)===(b.botHash??null);
const projectKey=root=>`project_${createHash('sha256').update(root).digest('hex').slice(0,24)}`;
const timestamp=value=>typeof value==='string'&&value.length<=40&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
const explicitTime=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)&&timestamp(value);
const JOB_STATES=new Set(['prepared','admitted','running','not_admitted','unknown','discarded','mixed','completed','blocked','aborted','error','max-tokens','interrupted','forked','no_text','expired']);
const DELIVERY_STATES=new Set(['pending','blocked','dispatching','queued','reported_sent','failed','uncertain','expired','cancelled','history_pruned']);
const ONCE_STATES=new Set(['queued','running','completed','failed','cancelled','blocked']);
const MEMORY_KINDS=new Set(['goal','decision','blocker','next_step','context']);
const limitations=['执行回复仍待验收；通道报告发送不代表手机收到或已读。','只读跟进只检查这个已关注项目；没有实质变化时保持安静。'];
const unavailable=()=>{throw new Error('工作台操作未完成，请刷新后核对原绑定、项目和暂停状态；未自动重试。');};
const rootValid=root=>typeof root==='string'&&isAbsolute(root)&&root===resolve(root)&&root!==parse(root).root&&root.length<=4096;

/** Explicit owner-authenticated controls. It owns no scheduler, store or model. */
export function createWorkbenchActions({service,memory,followup,taskResults,readBinding,readConnection,resolveOwner,activateOwner,isClosed=()=>false,clock=()=>new Date()}={}){
  let closed=false;
  const open=()=>{if(closed||isClosed())unavailable();};
  const now=()=>{const value=clock();const epoch=value instanceof Date?value.getTime():Number(value);if(!Number.isFinite(epoch))unavailable();return epoch;};
  const connection=async()=>{
    open();const value=await readConnection?.();open();
    // Never retain a mutable carrier object across another await.
    return bound(value)?{state:'bound',sessionId:value.sessionId,bindingKey:value.bindingKey}:{state:'unknown'};
  };
  const checkBinding=async expected=>{if(!same(expected,await connection()))unavailable();};
  async function scope(expected,projectId){
    open();const projects=await service.watchedProjects();await checkBinding(expected);
    if(!Array.isArray(projects)||projects.length>5||projects.some(row=>!rootValid(row?.root)))unavailable();
    const project=projectId===undefined?null:projects.find(row=>projectKey(row.root)===projectId);
    if(projectId!==undefined&&(!project||typeof project.label!=='string'||!project.label.trim()||project.label.length>80))unavailable();
    if(typeof service.isPaused!=='function'||await service.isPaused()!==false)unavailable();
    await checkBinding(expected);
    return{project:project?{root:project.root,label:project.label}:null,roots:projects.map(row=>row.root)};
  }
  const liveOwner=sessionId=>{
    const value=resolveOwner?.(sessionId);
    return value&&value.sessionId===sessionId&&rootValid(value.cwd)?{sessionId,cwd:value.cwd}:null;
  };
  async function readyOwner(expected,projectId){
    let owner=liveOwner(expected.sessionId);
    if(!owner&&typeof activateOwner==='function'){
      await activateOwner(expected.sessionId);await scope(expected,projectId);owner=liveOwner(expected.sessionId);
    }
    if(!owner)unavailable();
    await scope(expected,projectId);
    const current=liveOwner(expected.sessionId);
    if(!current||current.cwd!==owner.cwd)unavailable();
    return current;
  }
  function validate(input){
    if(!input||typeof input!=='object'||Array.isArray(input))unavailable();
    const fields={task_detail:['action','id'],memory_detail:['action','projectId','id'],followup_status:['action','projectId'],followup_configure:['action','projectId','everyMinutes','userRequested'],followup_cancel:['action','projectId','userRequested'],check_once:['action','projectId','delaySeconds','dueAt','userRequested'],cancel_once:['action','projectId','userRequested'],memory_update:['action','projectId','id','text','userRequested'],memory_forget:['action','projectId','id','userRequested']}[input.action];
    if(!fields||Object.keys(input).some(key=>key!=='expectedBindingRevision'&&!fields.includes(key)))unavailable();
    const write=!['task_detail','memory_detail','followup_status'].includes(input.action);
    if(write&&input.userRequested!==true)unavailable();
    if(input.action!=='task_detail'&&!/^project_[a-f0-9]{24}$/.test(input.projectId??''))unavailable();
    if(['task_detail','memory_detail','memory_update','memory_forget'].includes(input.action)&&!identity(input.id))unavailable();
    if(input.action==='followup_configure'&&(!Number.isSafeInteger(input.everyMinutes)||input.everyMinutes<30||input.everyMinutes>1440))unavailable();
    if(input.action==='memory_update'&&(typeof input.text!=='string'||!input.text.trim()||Array.from(input.text).length>2000||/[\0]/.test(input.text)))unavailable();
    if(input.action==='check_once'){
      if(input.dueAt!==undefined&&input.delaySeconds!==undefined)unavailable();
      if(input.dueAt!==undefined){const at=explicitTime(input.dueAt);if(!at||Date.parse(at)<=now()||Date.parse(at)>now()+7*86400000)unavailable();}
      else if(!Number.isSafeInteger(input.delaySeconds??60)||(input.delaySeconds??60)<30||(input.delaySeconds??60)>300)unavailable();
    }
    return write;
  }
  const cleaner=(roots,expected)=>(value,max)=>{
    let text=typeof value==='string'?value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,''):'';
    for(const hidden of [...roots,expected.bindingKey].sort((a,b)=>b.length-a.length))text=text.split(hidden).join('[已隐藏]');
    text=text.replace(/((?:access[_-]?token|refresh[_-]?token|api[_-]?key|client[_-]?secret|password|authorization)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi,'$1[已隐藏]');
    let out='';for(const char of text){if(out.length+char.length>max)break;out+=char;}return out;
  };
  function plan(value,{once=false,clean}){
    if(!value||typeof value!=='object'||typeof value.enabled!=='boolean'||typeof value.running!=='boolean')unavailable();
    if(once&&value.status!==undefined&&!ONCE_STATES.has(value.status))unavailable();
    const out={enabled:value.enabled,running:value.running,delivery:once&&['native','wechat'].includes(value.delivery)?value.delivery:'wechat'};
    if(once&&ONCE_STATES.has(value.status))out.status=value.status;
    if(!once&&Number.isSafeInteger(value.everyMinutes)&&value.everyMinutes>=30&&value.everyMinutes<=1440)out.everyMinutes=value.everyMinutes;
    for(const key of ['nextDueAt','lastRunAt','lastReviewedAt'])out[key]=timestamp(value[key]);
    if(typeof value.blocked==='string')out.blocked=clean(value.blocked,200);
    if(Number.isSafeInteger(value.runCount)&&value.runCount>=0)out.runCount=value.runCount;
    return out;
  }
  function memoryReceipt(value,clean,{forget=false,textLimit=500}={}){
    const source=value?.receipt??value?.record??value?.entry;
    if(forget){
      // Deletion receipts deliberately omit the removed record's text and
      // provenance. A successful forget must remain successful after removal.
      return source?.action==='forget'&&source.status==='forgotten'&&identity(source.id)&&MEMORY_KINDS.has(source.kind)
        ?{action:'forget',status:'forgotten',id:source.id,kind:source.kind}:null;
    }
    if(!source||!identity(source.id)||!MEMORY_KINDS.has(source.kind)||typeof source.text!=='string'||!timestamp(source.at))return null;
    const reference=source.source?.reference,kind=source.source?.kind;
    if(!['user','assistant','file'].includes(kind)||typeof reference!=='string'||!reference.trim())return null;
    if(kind==='file'&&(isAbsolute(reference.split('#')[0])||reference.includes('\\')||reference.split('#')[0].split('/').some(part=>!part||part==='.'||part==='..')||/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(reference)))return null;
    if(kind!=='file'&&(!reference.startsWith('session:')||!identity(reference.slice(8).split('#')[0])))return null;
    return{id:source.id,kind:source.kind,text:clean(source.text,textLimit),at:timestamp(source.at),source:{kind,reference:clean(reference,500)},verified:false,...(typeof source.status==='string'&&['revised','forgotten','saved','deduped'].includes(source.status)?{status:source.status}:{}),...(typeof source.truncated==='boolean'?{truncated:source.truncated}:{})};
  }
  return{
    async action(input){
      open();input=structuredClone(input);const write=validate(input),expected=await connection();if(!bound(expected)||!matchesBindingRevision(input,expected))unavailable();
      let authorized=await scope(expected,input.projectId);
      if(write){await readyOwner(expected,input.projectId);authorized=await scope(expected,input.projectId);}
      const clean=cleaner(authorized.roots,expected),base={action:input.action,...(input.projectId?{projectId:input.projectId}:{})};
      if(input.action==='task_detail'){
        if(typeof taskResults?.inspect!=='function'||typeof readBinding!=='function')unavailable();
        const originalBinding=structuredClone(await readBinding(expected.sessionId));await scope(expected);
        if(!validReturnBinding(originalBinding))unavailable();
        const result=await taskResults.inspect(expected.sessionId,{id:input.id,expectedBinding:originalBinding});await scope(expected);
        if(!sameReturnBinding(originalBinding,await readBinding(expected.sessionId)))unavailable();await scope(expected);
        const clean=cleaner([...authorized.roots,originalBinding.userHash,...(originalBinding.botHash?[originalBinding.botHash]:[])],expected);
        if(!Array.isArray(result?.jobs)||result.jobs.length>10)unavailable();
        const jobs=result.jobs.filter(row=>row?.id===input.id).map(row=>{
          if(!identity(row.id)||!JOB_STATES.has(row.status)||!timestamp(row.createdAt)||typeof row.projectLabel!=='string'||typeof row.task!=='string'||typeof row.reply!=='string')unavailable();
          return{id:row.id,projectLabel:clean(row.projectLabel,80),task:clean(row.task,160),status:row.status,createdAt:timestamp(row.createdAt),reply:clean(row.reply,8000),replyTruncated:row.replyTruncated===true||row.reply.length>8000,...(timestamp(row.finishedAt)?{finishedAt:timestamp(row.finishedAt)}:{}),...(timestamp(row.expiresAt)?{expiresAt:timestamp(row.expiresAt)}:{}),...(Number.isSafeInteger(row.turn)&&row.turn>=0?{turn:row.turn}:{}),...(row.delivery?{delivery:{status:DELIVERY_STATES.has(row.delivery.status)?row.delivery.status:'uncertain',detail:clean(row.delivery.detail,160)}}:{})};
        });
        return{...base,jobs,limitations:[...limitations]};
      }
      const args={root:authorized.project.root,sessionId:expected.sessionId};
      if(input.action==='memory_detail'){
        if(typeof memory?.inspect!=='function')unavailable();
        // Inspect returns the validated full snapshot without opening a writer,
        // migrating metadata, or waking the original owner's agent.
        const value=await memory.inspect(args);await scope(expected,input.projectId);
        if(!Array.isArray(value?.goals)||value.goals.length>10||!Array.isArray(value?.entries)||value.entries.length>100)unavailable();
        const matches=[...value.goals,...value.entries].filter(row=>row?.id===input.id);
        if(matches.length!==1)unavailable();
        const row=matches[0];
        if(row.verified!==false||typeof row.text!=='string'||!row.text.trim()||Array.from(row.text).length>2000)unavailable();
        // The overview's 500-character preview must never become the editor's
        // source. Keep the entire bounded safe note, including astral Unicode.
        const record=memoryReceipt({record:row},clean,{textLimit:Infinity});
        if(!record||Array.from(record.text).length>2000)unavailable();
        const redacted=record.text!==row.text;
        return{...base,record:{id:record.id,kind:record.kind,text:record.text,source:record.source,at:record.at,verified:false},editable:!redacted,redacted};
      }
      const authorizeMutation=async()=>{await scope(expected,input.projectId);return true;};
      if(input.action==='followup_status'){
        if(typeof followup?.inspect!=='function')unavailable();
        const value=await followup.inspect({...args,expectedBinding:{sessionId:expected.sessionId,bindingKey:expected.bindingKey}});await scope(expected,input.projectId);
        return{...base,followup:plan(value?.followup===null?{enabled:false,running:false}:value?.followup,{clean}),once:plan(value?.once===null?{enabled:false,running:false}:value?.once,{once:true,clean}),limitations:[...limitations]};
      }
      if(input.action==='memory_update'||input.action==='memory_forget'){
        const update=input.action==='memory_update',method=update?'revise':'forget';if(typeof memory?.[method]!=='function')unavailable();
        const value=await memory[method]({...args,id:input.id,...(update?{text:input.text}:{}),userRequested:true,authorizeMutation});await scope(expected,input.projectId);
        if(!value||value.accepted===false||value.ok===false||typeof value.code==='string')unavailable();
        const receipt=memoryReceipt(value,clean,{forget:!update});
        if((value.receipt||value.entry||value.record)&&(!receipt||receipt.id!==input.id)||receipt?.status&&receipt.status!==(update?'revised':'forgotten'))unavailable();
        return{...base,id:input.id,...(update?{updated:true}:{forgotten:true}),...(receipt?{receipt,record:receipt}:{})};
      }
      const method={followup_configure:'configure',followup_cancel:'cancel',check_once:'checkOnce',cancel_once:'cancelOnce'}[input.action];if(typeof followup?.[method]!=='function')unavailable();
      const once=['check_once','cancel_once'].includes(input.action);
      const params={...args,authorizeMutation,expectedBinding:{sessionId:expected.sessionId,bindingKey:expected.bindingKey},...(input.action==='followup_configure'?{everyMinutes:input.everyMinutes,projectLabel:authorized.project.label}:{}),...(input.action==='check_once'?{projectLabel:authorized.project.label,delivery:'wechat',...(input.dueAt!==undefined?{dueAt:timestamp(input.dueAt)}:{delaySeconds:input.delaySeconds??60})}:{})};
      const value=await followup[method](params);await scope(expected,input.projectId);
      return{...base,[once?'once':'followup']:plan(value,{once,clean}),limitations:[...limitations]};
    },
    close(){closed=true;},
  };
}

/** Only the official connection layer supplies owner authentication. */
export function registerWorkbenchActionsRoute(ctx,adapter){
  const connection=ctx.get('connection');if(typeof connection?.fetch?.register!=='function')return null;
  let closed=false;
  // A full 2000-codepoint memory may occupy 8000 UTF-8 bytes, plus JSON scope.
  const maxBodyBytes=12*1024;
  const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
  const unregister=connection.fetch.register({path:'/api/project_companion/workbench/actions',methods:['POST'],requestBody:'buffered',async fetch(request){
    if(closed)return json({error:'工作台操作已关闭。'},503);
    if(request.method!=='POST')return json({error:'仅支持 POST。'},405);
    try{
      if(new URL(request.url).search)return json({error:'操作不接受 URL 参数。'},400);
      if(request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/json')return json({error:'请使用 JSON 请求。'},415);
      const length=request.headers.get('Content-Length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>maxBodyBytes))return json({error:'请求过大。'},413);
      const body=await request.text();if(Buffer.byteLength(body)>maxBodyBytes)return json({error:'请求过大。'},413);
      if(closed)return json({error:'工作台操作已关闭。'},503);
      const value=await adapter.action(JSON.parse(body));return closed?json({error:'工作台操作已关闭。'},503):json(value);
    }catch{return json({error:'操作未确认完成，请刷新后核对；未自动重试。'},400);}
  }});
  const stop=()=>{if(closed)return;closed=true;unregister?.();};if(typeof ctx.effect==='function')ctx.effect(()=>stop);return stop;
}
