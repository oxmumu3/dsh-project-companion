import {personalReviewRowSchema} from './personal-review.js';
import {newsRowSchema} from './news-service.js';
import {hashReview} from './personal-review-ledger.js';
import {redactReviewText} from './personal-review-collect.js';
import {attentionStatus} from './personal-review-attention.js';
import {bindingRevision} from './workbench-scope.js';
import {localProjection,makeLocalFormatter} from '../vendor/proactive/lib/domain.js';

const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const sameCaller=(a,b)=>a?.sessionId===b?.sessionId&&a?.cwd===b?.cwd;
const validCaller=value=>value&&typeof value.sessionId==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value.sessionId)&&!value.sessionId.startsWith('family_member_')&&typeof value.cwd==='string'&&value.cwd.startsWith('/');
const sourceLabels={gmail:'邮件',calendar:'日历',drive:'云盘',flomo:'flomo 笔记',dida:'滴答',project:'项目资料',memory:'项目记忆'};
const statusLabels={generating:'正在整理',dispatching:'正在提交通道',reported_sent:'通道报告已发出，手机送达与已读未知',queued:'通道已排队，手机送达未知',uncertain:'发送结果不确定，不自动重发',failed:'本次回顾失败，不自动重试',cancelled:'本次已取消',expired:'已错过本次检查窗口，不补发',quiet:'本次未达到提醒门槛',unknown:'来源覆盖未知'};
const storedNote='仅展示当前授权范围的已保存回顾；本页没有重新读取来源。';
const unknownNote='部分已保存事项缺少当前授权依据，暂未展示；请在原会话重新核对。';
const scheduleNote='保存的安排不代表已运行；通道回执不代表手机收到。';
const unavailable=()=>({available:false,attentionItems:{available:false,items:[],truncated:false,coverage:'unconfirmed',note:'个人回顾暂无法核对，请查看连接。'},schedules:{available:false,items:[],truncated:false,note:'保存的安排暂无法核对。'+scheduleNote}});
const freshReview=()=>({id:'profile',version:1,scope:null,subscription:null,items:[],jobs:[],occurrences:[],watermarks:{},receipts:[]});
const parseReview=value=>personalReviewRowSchema.safeParse(value??freshReview());
const at=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
const validZone=value=>{try{return typeof value==='string'&&Boolean(new Intl.DateTimeFormat('en',{timeZone:value}));}catch{return false;}};

function safeUrl(value,source){
  if(typeof value!=='string'||value.length>1600)return null;
  try{
    const url=new URL(value),roots={gmail:['mail.google.com'],calendar:['calendar.google.com'],drive:['drive.google.com','docs.google.com'],dida:['dida365.com','ticktick.com'],flomo:['flomoapp.com','flomo.app']}[source]??[];
    if(url.protocol!=='https:'||url.username||url.password||url.port||url.search||!roots.some(root=>url.hostname===root||url.hostname.endsWith('.'+root)))return null;
    let decoded=value;for(let i=0;i<2;i++)try{decoded=decodeURIComponent(decoded);}catch{break;}
    if(/(?:token|secret|password|credential|authorization|signature|api[_-]?key)[=:/]|\/(?:Users|home|private|etc|var)\//iu.test(decoded))return null;
    return url.href;
  }catch{return null;}
}

function textCleaner(scope,cleanText){
  const roots=[scope?.caller?.cwd,...(scope?.projects??[])].filter(value=>typeof value==='string'&&value.length>1).sort((a,b)=>b.length-a.length);
  return(value,max)=>{
    let result=typeof value==='string'?value:'';
    for(const root of roots)result=result.split(root).join('[已隐藏]');
    result=String(cleanText(result));
    result=redactReviewText(result,16384)
      .replace(/(?:file:\/\/)?\/(?:Users|home|private|tmp|var|etc|synthetic)\/[^\s，。；、！？<>"']*/gu,'[已隐藏]')
      .replace(/[A-Za-z]:\\[^\s，。；、！？<>"']*/gu,'[已隐藏]')
      .replace(/(^|[\s（(：:])\/(?:[^\s/，。；、！？<>"']+\/)*[^\s，。；、！？<>"']+/gu,'$1[已隐藏]')
      .replace(/\b(?:sk-(?:proj-)?|ghp_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]{20,}\b/gu,'[已隐藏]')
      .replace(/\b[a-f\d]{64}\b/giu,'[已隐藏]')
      .replace(/(?:https?:\/\/|www\.)[^\s，。；、！？<>"']*/giu,'[已隐藏]');
    return result.slice(0,max);
  };
}

function scopeMatches(scope,{caller,bindingKey,grant,projects}){
  if(!scope||!sameCaller(scope.caller,caller)||scope.bindingKey!==bindingKey||scope.grant!==grant)return false;
  if(scope.projects.some(root=>!projects.some(project=>project.root===root)))return false;
  return scope.key===hashReview(JSON.stringify({caller:scope.caller,sources:scope.sources,projects:scope.projects,bindingKey:scope.bindingKey}));
}

function attentionView(state,plan,now){
  if(!plan)return{enabled:false,nextRun:null,quiet:true,remaining:0};
  const day=value=>{const p=localProjection(makeLocalFormatter(plan.schedule.timeZone),value);return `${p.year}-${p.month}-${p.day}`;};
  const today=day(now.getTime()),usedMessages=state.attentionClaims.filter(row=>day(Date.parse(row.at))===today).length;
  return attentionStatus({now,timeZone:plan.schedule.timeZone,attention:plan.paused?undefined:plan.attention,createdAt:plan.attention?.createdAt??plan.createdAt,occurrences:state.occurrences,...plan.schedule,usedMessages});
}

/** Pure, bounded metadata projection. The caller must supply independently verified current proofs. */
export function projectReviewWorkbench({reviewState,newsState,caller,bindingKey,grant,newsBindingKey,projects=[],now=new Date(),cleanText=value=>value}={}){
  const parsed=parseReview(reviewState);
  if(!parsed.success||!validCaller(caller)||!hex(bindingKey)||!(now instanceof Date)||!Number.isFinite(now.getTime())||!Array.isArray(projects)||projects.some(project=>!project||typeof project.root!=='string'))return unavailable();
  const state=parsed.data,scope=state.subscription??state.scope;
  if(state.subscription&&!validZone(state.subscription.schedule.timeZone))return unavailable();
  if(scope&&!scopeMatches(scope,{caller,bindingKey,grant,projects})||state.scope&&!sameCaller(state.scope.caller,caller))return unavailable();
  if(!scope&&(state.items.length||state.jobs.length))return unavailable();
  const clean=textCleaner(scope,cleanText),plan=state.subscription,grantKey=scope?hashReview(JSON.stringify({key:scope.key,grant:scope.grant})):null;
  const scoped=scope?state.items.filter(item=>item.scopeKey===scope.key):[];
  let unconfirmed=false;
  const actionable=scoped.filter(item=>{
    if(item.status==='handled'||item.status==='dismissed'||item.status==='snoozed'&&Date.parse(item.snoozeUntil)>now.getTime())return false;
    if(item.kind==='event'&&Date.parse(item.eventEndAt??item.eventStartAt)<=now.getTime())return false;
    const allowed=item.grantScopeKey===grantKey&&/^review_[a-f0-9]{32}$/.test(item.id)&&item.evidence.length>0&&(!item.sourceTask||item.sourceTask.scopeKey===grantKey&&scope.sources.includes(item.sourceTask.source))&&item.evidence.every(ref=>{
      if(['project','memory'].includes(ref.source))return typeof ref.projectRoot==='string'&&scope.projects.includes(ref.projectRoot);
      return scope.sources.includes(ref.source)&&(!ref.sourceTask||ref.sourceTask.scopeKey===grantKey&&ref.sourceTask.source===ref.source);
    });
    if(!allowed)unconfirmed=true;return allowed;
  }).sort((a,b)=>({high:0,normal:1,low:2}[a.priority]-{high:0,normal:1,low:2}[b.priority])||(Date.parse(a.dueAt??a.eventStartAt??'9999-01-01')-Date.parse(b.dueAt??b.eventStartAt??'9999-01-01'))||b.lastSeenAt.localeCompare(a.lastSeenAt));
  const cards=actionable.slice(0,5).map(item=>{
    const prose=Object.fromEntries([['title',100],['summary',360],['why',160],['action',160],['unknown',180]].map(([key,max])=>[key,clean(item[key],max)]));
    const sources=item.evidence.slice(0,3).map(ref=>({source:ref.source,label:sourceLabels[ref.source],at:at(ref.at),contentState:ref.contentState??null,truncated:ref.contentState==='truncated',url:safeUrl(ref.url,ref.source)}));
    return{id:item.id,kind:item.kind,...prose,status:item.status,priority:item.priority,confidence:item.confidence,dueAt:at(item.dueAt),dueAtBasis:item.dueAtBasis??null,eventStartAt:at(item.eventStartAt),eventEndAt:at(item.eventEndAt),snoozeUntil:at(item.snoozeUntil),lastSeenAt:at(item.lastSeenAt),sources,truncated:item.evidence.length>3||sources.some(ref=>ref.truncated)||Object.keys(prose).some(key=>prose[key]!==item[key])};
  });
  const attentionItems={available:!unconfirmed||cards.length>0,items:cards,truncated:actionable.length>5,coverage:unconfirmed?'unconfirmed':'stored-only',note:unconfirmed?unknownNote:storedNote};
  const review={status:plan?plan.paused?'paused':'enabled':'off',schedule:plan?structuredClone(plan.schedule):null,attention:attentionView(state,plan,now),sources:scope?[...scope.sources]:[],projects:scope?scope.projects.map(root=>clean(projects.find(p=>p.root===root)?.label??'已选项目',80)):[],
    items:cards.map(item=>({id:item.id,title:item.title,status:item.status,dueAt:item.dueAt,snoozeUntil:item.snoozeUntil})),goals:scope?state.goals.filter(goal=>goal.scopeKey===scope.key&&goal.grant===scope.grant).slice(0,5).map(goal=>({title:clean(goal.title,100),status:goal.status,meetingTitle:goal.meetingTitle?clean(goal.meetingTitle,100):null})):[],
    jobs:state.jobs.filter(job=>job.sessionId===caller.sessionId).slice(-8).map(job=>({kind:job.kind,status:job.status,createdAt:job.createdAt,detail:statusLabels[job.status]})),lastGeneration:null,text:`个人回顾：${plan?plan.paused?'已暂停':'已保存定时安排':'未启用定时计划'}。只读取已确认的来源与项目；电脑与宿主须在线。`};
  const scheduleItems=[];
  if(plan)scheduleItems.push({id:'personal-review',kind:'review',title:'个人回顾',status:plan.paused?'paused':'stored',source:'personal-review',timeZone:plan.schedule.timeZone,dailyTime:plan.schedule.dailyTime??null,weeklyDay:plan.schedule.weeklyDay??null,weeklyTime:plan.schedule.weeklyTime??null,everyMinutes:null,nextDueAt:null,runtime:'unverified',phoneReceipt:'unverified'});
  let news={topics:null,topicSource:'default',text:'尚未保存资讯关注点。'},newsAvailable=true;
  if(newsState!=null){
    const parsedNews=newsRowSchema.safeParse(newsState);newsAvailable=parsedNews.success;
    if(parsedNews.success){
      const n=parsedNews.data,routes=[n.schedule,n.preferences,...n.jobs.filter(job=>['generating','pending','dispatching'].includes(job.status))].filter(Boolean);
      newsAvailable=routes.every(row=>row.sessionId===caller.sessionId&&row.bindingKey===newsBindingKey)&&(!routes.length||hex(newsBindingKey))&&(!n.schedule||validZone(n.schedule.timeZone));
      if(newsAvailable){
        news={topics:n.preferences?.topics?.map(topic=>clean(topic,100))??null,topicSource:n.preferences?'explicit':'default',text:n.preferences?'已保存资讯关注点。':'尚未保存资讯关注点。'};
        if(n.schedule)scheduleItems.push({id:'news-daily',kind:'news',title:'AI 资讯日报',status:'stored',source:'news',timeZone:n.schedule.timeZone,dailyTime:n.schedule.time,weeklyDay:null,weeklyTime:null,everyMinutes:null,nextDueAt:null,runtime:'unverified',phoneReceipt:'unverified'});
      }
    }
    if(!newsAvailable)news={topics:null,topicSource:'unavailable',text:'原绑定的资讯设置暂无法核对。'};
  }
  return{available:true,review,news,attentionItems,schedules:{available:newsAvailable,items:scheduleItems.slice(0,12),truncated:scheduleItems.length>12,note:(newsAvailable?'':'部分保存安排暂无法核对。')+scheduleNote}};
}

/** Read raw local rows and bracket every projection with the existing owner/grant gates. */
export function createReviewWorkbenchReader({readReviewState,readNewsState,readConnection,resolveOwner,authorizeReview,readNewsBinding,readProjects,clock=()=>new Date(),isClosed=()=>false,cleanText,deliverySupported=()=>false,deliveryNote=()=>''}={}){
  return async snapshot=>{
    const denied=()=>({...unavailable(),bindingRevision:snapshot?.bindingRevision??null});
    try{
      const initial=structuredClone(await readConnection()),revision=bindingRevision(initial),caller=structuredClone(await resolveOwner(initial.sessionId));
      if(isClosed()||initial.state!=='bound'||!revision||revision!==snapshot?.bindingRevision||!validCaller(caller)||caller.sessionId!==initial.sessionId)return denied();
      const current=async()=>{const route=await readConnection(),owner=await resolveOwner(initial.sessionId);return !isClosed()&&bindingRevision(route)===revision&&sameCaller(caller,owner);};
      const [reviewState,newsState,projects]=await Promise.all([readReviewState(),readNewsState(),readProjects()]);
      if(!await current())return denied();
      const parsed=parseReview(reviewState);if(!parsed.success)return denied();
      const scope=parsed.data.subscription??parsed.data.scope;
      if(scope&&!sameCaller(scope.caller,caller))return denied();
      const proof=scope?await authorizeReview(caller,structuredClone(scope)):{bindingKey:initial.bindingKey,grant:null};
      const newsProof=await readNewsBinding(caller.sessionId);
      if(!await current())return denied();
      if(scope&&(!proof||proof.bindingKey!==scope.bindingKey||proof.grant!==scope.grant))return denied();
      const value=projectReviewWorkbench({reviewState,newsState,caller,bindingKey:proof?.bindingKey,grant:proof?.grant,newsBindingKey:newsProof?.bound?newsProof.bindingKey:null,projects,now:clock(),cleanText});
      if(scope){const final=await authorizeReview(caller,structuredClone(scope));if(final?.bindingKey!==proof.bindingKey||final?.grant!==proof.grant)return denied();}
      if(!await current())return denied();
      if(!value.available)return denied();
      const supported=Boolean(deliverySupported(caller)),note=deliveryNote(supported);
      if(note)value.review.text+='\n'+note;
      return{...value,bindingRevision:revision,deliverySupported:supported,deliveryNote:note};
    }catch{return denied();}
  };
}
