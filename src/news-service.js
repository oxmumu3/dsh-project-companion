import {randomUUID} from 'node:crypto';
import {isAbsolute,resolve} from 'node:path';
import {z} from 'zod';
import {renderNewsDigest,newsPublicUrl} from './news-render.js';
import {normalizeNewsTopics} from './news-topics.js';
import {safeModelCallDiagnostic} from './news-model.js';
const NEWS_MODEL_CODES = new Set(['MODEL_UNAVAILABLE','MODEL_INVALID_INPUT','MODEL_INVALID_OUTPUT','MODEL_TOOL_OUTPUT','MODEL_INCOMPLETE','MODEL_TOKEN_LIMIT','MODEL_OUTPUT_LIMIT','MODEL_TIMEOUT','MODEL_ABORTED','MODEL_CLOSED','MODEL_AUTHORIZATION_CHANGED','MODEL_REQUEST_FAILED']);
const NEWS_STAGE_CODES = {sources:'NEWS_SOURCE_FAILED',selection:'NEWS_SELECTION_FAILED',summary:'NEWS_SUMMARY_FAILED',article:'NEWS_ARTICLE_FAILED'};
const NEWS_DIAGNOSTIC_STAGES = ['sources','selection','summary','article','authorization','cancelled','unknown'];
const NEWS_DIAGNOSTIC_CODES = [...NEWS_MODEL_CODES,...Object.values(NEWS_STAGE_CODES),'NEWS_AUTHORIZATION_CHANGED','NEWS_REQUEST_FAILED','NEWS_CANCELLED','NEWS_PAUSED','NEWS_TIMEOUT'];
const diagnosticCount=z.number().int().min(0).max(1000000000).nullable();
const newsDiagnosticSchema=z.object({stage:z.enum(NEWS_DIAGNOSTIC_STAGES),code:z.enum(NEWS_DIAGNOSTIC_CODES),model:z.object({requestedMaxTokens:diagnosticCount,preparedMaxTokens:diagnosticCount,reasoningEffort:z.enum(['off','none','minimal','low','medium','high','max','other','unset']),finish:z.enum(['none','stop','max-tokens','other']),textChars:diagnosticCount,reasoningChars:diagnosticCount,outputTokens:diagnosticCount,reasoningTokens:diagnosticCount}).strict().optional()}).strict();
function jobDiagnostic(error) {
  const code=NEWS_DIAGNOSTIC_CODES.includes(error?.code)?error.code:'NEWS_REQUEST_FAILED';
  const stage=code==='NEWS_AUTHORIZATION_CHANGED'?'authorization':['NEWS_CANCELLED','NEWS_PAUSED'].includes(code)?'cancelled':NEWS_DIAGNOSTIC_STAGES.includes(error?.newsDiagnostic?.stage)?error.newsDiagnostic.stage:'unknown';
  const model=safeModelCallDiagnostic(error?.newsDiagnostic?.model);
  return newsDiagnosticSchema.parse({stage,code,...(model?{model}:{})});
}
function pipelineFailure(error, stage, label) {
  const code = NEWS_MODEL_CODES.has(error?.code) ? error.code : NEWS_STAGE_CODES[stage];
  const model = safeModelCallDiagnostic(error?.modelCallDiagnostic);
  return Object.assign(new Error(label), {code, newsDiagnostic:{stage,code,...(model?{model}:{})}});
}

const SIX_HOURS=21600000,PIPELINE_TIMEOUT=240000;
const id=z.string().min(1).max(200),at=z.string().datetime(),binding=z.string().regex(/^[a-f0-9]{64}$/);
const statuses=['generating','pending','dispatching','blocked','reported_sent','queued','uncertain','failed','expired','cancelled'];
const legacyJobSchema=z.object({id,kind:z.enum(['manual','daily']),requestId:id,sessionId:id,bindingKey:binding,date:z.string().regex(/^\d{4}-\d\d-\d\d$/).nullable(),createdAt:at,expiresAt:at,status:z.enum(statuses),articleIds:z.array(id).max(10),text:z.string().max(3200),detail:z.string().max(160)}).strict();
const legacyRowSchema=z.object({id:z.literal('profile'),version:z.literal(1),schedule:z.object({time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),timeZone:z.string().min(1).max(100),sessionId:id,bindingKey:binding,createdAt:at}).strict().nullable(),jobs:z.array(legacyJobSchema).max(50),articleHistory:z.array(z.object({id,at}).strict()).max(400),dailyDates:z.array(z.string().regex(/^\d{4}-\d\d-\d\d$/)).max(400),receipts:z.array(z.object({sessionId:id,requestId:id,action:z.enum(['configure','cancel']),createdAt:at}).strict()).max(100)}).strict();
const topicsSchema=z.array(z.string()).superRefine((value,ctx)=>{try{const normalized=normalizeNewsTopics(value);if(normalized.some((topic,i)=>topic!==value[i]))throw new Error();}catch{ctx.addIssue({code:'custom',message:'Invalid explicit news topics'});}});
const currentRowSchema=legacyRowSchema.extend({version:z.literal(2),preferences:z.object({topics:topicsSchema,source:z.literal('explicit'),sessionId:id,bindingKey:binding,updatedAt:at}).strict().nullable(),jobs:z.array(legacyJobSchema.extend({topics:topicsSchema.nullable(),timeZone:z.string().min(1).max(100),diagnostic:newsDiagnosticSchema.optional()}).strict()).max(50),receipts:z.array(z.object({sessionId:id,requestId:id,action:z.enum(['configure','cancel','set_topics','clear_topics']),createdAt:at}).strict()).max(100)}).strict().superRefine((value,ctx)=>{if(value.preferences&&value.schedule&&value.preferences.bindingKey!==value.schedule.bindingKey)ctx.addIssue({code:'custom',message:'News preferences and schedule bindings differ'});});
// The existing host domain can read v1 rows before the service migrates them.
// All new writes use currentRowSchema; no preferences are inferred on upgrade.
export const newsRowSchema=z.union([currentRowSchema,legacyRowSchema]);
const fresh=()=>({id:'profile',version:2,schedule:null,preferences:null,jobs:[],articleHistory:[],dailyDates:[],receipts:[]});
const copy=x=>structuredClone(x);
const clip=(s,n)=>String(s??'').toWellFormed().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').slice(0,n);
const deliveryLabels={generating:'正在生成',pending:'等待发送',dispatching:'正在提交通道',blocked:'原绑定或助理暂不可用，尚未发送',reported_sent:'通道报告已发出，手机送达与已读未知',queued:'通道已排队，手机送达未知',uncertain:'结果不确定，不自动重发',failed:'本次失败，不自动重发',expired:'超过六小时窗口，不补发',cancelled:'本次已取消'};
function requireOwner(owner){if(typeof owner?.sessionId!=='string'||!owner.sessionId||owner.sessionId.length>200||typeof owner.cwd!=='string'||!isAbsolute(owner.cwd))throw new Error('需要真实本地会话');return{sessionId:owner.sessionId,cwd:resolve(owner.cwd)};}
function mutation(input){if(input.userRequested!==true)throw new Error('需要用户明确要求');if(typeof input.requestId!=='string'||!input.requestId||input.requestId.length>200)throw new Error('需要本次真实请求 ID');}
function parts(now,zone){const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(now).map(x=>[x.type,x.value]));return{date:`${p.year}-${p.month}-${p.day}`,epoch:Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second)};}
function scheduleInput(input){if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time??''))throw new Error('日报时间需要 HH:mm');if(typeof input.timeZone!=='string'||!input.timeZone||input.timeZone.length>100)throw new Error('需要明确 IANA 时区');try{parts(new Date(0),input.timeZone);}catch{throw new Error('日报时区无效');}return{time:input.time,timeZone:input.timeZone};}
function dueSchedule(now,schedule){function instant(date){const target=Date.parse(`${date}T${schedule.time}:00Z`);let guess=target;const attempts=[];for(let i=0;i<5;i++){attempts.push(guess);const delta=target-parts(new Date(guess),schedule.timeZone).epoch;if(!delta)return guess;guess+=delta;}return Math.max(...attempts);}let date=parts(now,schedule.timeZone).date,epoch=instant(date);if(epoch>now.getTime()){date=new Date(Date.parse(`${date}T00:00:00Z`)-86400000).toISOString().slice(0,10);epoch=instant(date);}return{date,epoch};}
function candidate(article){if(!article||typeof article.id!=='string'||!article.id||article.id.length>200||typeof article.title!=='string'||!article.title.trim())throw new Error('候选文章 ID 或标题无效');return{id:article.id,url:newsPublicUrl(article.url),title:clip(article.title,300),sourceName:clip(article.sourceName??article.name??'RSS 来源',100),sourceUrl:typeof article.sourceUrl==='string'?newsPublicUrl(article.sourceUrl):null,publishedAt:typeof article.publishedAt==='string'?clip(article.publishedAt,80):null,excerpt:clip(article.excerpt??article.summary,2500)};}
function summaryItems(result,articles){if(!result||Object.keys(result).some(k=>k!=='items')||!Array.isArray(result.items)||result.items.length!==articles.length)throw new Error('摘要必须对应全部选中 ID');const known=new Map(articles.map(a=>[a.id,a])),seen=new Set();for(const item of result.items){if(!item||Object.keys(item).some(k=>!['id','title','summary','why'].includes(k))||!known.has(item.id)||seen.has(item.id))throw new Error('摘要存在未知、重复 ID 或多余字段');seen.add(item.id);for(const key of ['summary','title','why']){if(key==='summary'&&(typeof item[key]!=='string'||!item[key].trim()))throw new Error('摘要正文不能为空');if(item[key]!==undefined&&(typeof item[key]!=='string'||item[key].length>2500||/(?:[a-z][a-z\d+.-]*:\/\/|www\.|\]\s*\()/i.test(item[key])))throw new Error('摘要包含无效文字或新增 URL 链接');}}
  return articles.map(a=>{const s=result.items.find(item=>item.id===a.id);return{...a,title:s.title??a.title,summary:s.summary,why:s.why??''};});
}
function stoppedError(signal,message='操作已取消或停止'){return Object.assign(new Error(message),{code:signal?.aborted&&signal.reason instanceof DOMException&&signal.reason.name==='TimeoutError'?'NEWS_TIMEOUT':'NEWS_CANCELLED'});}
const pausedError=message=>Object.assign(new Error(message),{code:'NEWS_PAUSED'});
function external(fn,signal){if(signal.aborted)throw stoppedError(signal);return new Promise((resolve,reject)=>{const abort=()=>reject(stoppedError(signal));signal.addEventListener('abort',abort,{once:true});Promise.resolve().then(()=>{if(signal.aborted)throw stoppedError(signal);return fn();}).then(value=>{signal.removeEventListener('abort',abort);if(signal.aborted)reject(stoppedError(signal));else resolve(value);},error=>{signal.removeEventListener('abort',abort);reject(error);});});}

export function createNewsService({store,fetchCandidates,selectArticles,readArticle,summarizeArticles,send,readBinding,canRun=async()=>true,canRunSync,clock=()=>new Date(),hostTimeZone=()=>Intl.DateTimeFormat().resolvedOptions().timeZone}={}){
  if(typeof store?.get!=='function'||typeof store?.put!=='function')throw new Error('需要持久化存储');
  if(canRunSync!==undefined&&typeof canRunSync!=='function')throw new Error('无效同步资讯暂停检查');
  for(const [name,value] of Object.entries({fetchCandidates,selectArticles,readArticle,summarizeArticles,send,readBinding}))if(typeof value!=='function')throw new Error(`Missing news dependency: ${name}`);
  let state,loading,queue=Promise.resolve(),storageFailed=false,closing=false,closePromise,generation=0,changeSequence=0,lastAcceptedChange=0;const controllers=new Set();
  const serial=work=>{const p=queue.then(work);queue=p.catch(()=>{});return p;};
  const now=()=>{const n=clock();if(!(n instanceof Date)||!Number.isFinite(n.getTime()))throw new Error('资讯时钟不可用');return n;};
  const save=async()=>{if(storageFailed)throw new Error('资讯存储不可用');try{await store.put('profile',currentRowSchema.parse(copy(state)));}catch{storageFailed=true;throw new Error('资讯存储不可用');}};
  function history(job){for(const articleId of job.articleIds){state.articleHistory=state.articleHistory.filter(x=>x.id!==articleId);state.articleHistory.push({id:articleId,at:now().toISOString()});}state.articleHistory=state.articleHistory.slice(-400);}
  function load(){
    if(storageFailed)return Promise.reject(new Error('资讯存储不可用'));
    if(loading)return loading;
    loading=(async()=>{
      let raw;try{raw=await store.get('profile');}catch{storageFailed=true;throw new Error('资讯存储不可用');}
      const parsed=newsRowSchema.safeParse(raw??fresh());
      if(!parsed.success)throw new Error('资讯状态不兼容或已损坏');
      state=parsed.data;
      let changed=state.version===1;
      if(changed)state={...state,version:2,preferences:null,jobs:state.jobs.map(job=>({...job,topics:null,timeZone:job.kind==='daily'?state.schedule?.timeZone??'UTC':'UTC'}))};
      for(const job of state.jobs){
        if(job.status==='dispatching'){job.status='uncertain';job.detail=deliveryLabels.uncertain;history(job);changed=true;}
        else if(job.status==='generating'){job.status='failed';job.detail='宿主在生成期间停止，本次不自动重试';changed=true;}
      }
      if(changed)await save();
    })();
    return loading;
  }
  function invalidate(){generation++;for(const controller of controllers)controller.abort();}
  function current(scope){
    if(closing||storageFailed||scope.signal.aborted||scope.generation!==generation)return false;
    try{authorizeSync(scope.request);if(canRunSync){const allowed=canRunSync();if(allowed&&typeof allowed.then==='function')Promise.resolve(allowed).catch(()=>{});if(allowed!==true)return false;}return true;}catch{return false;}
  }
  async function active(scope){if(closing||scope.signal.aborted||scope.generation!==generation)throw stoppedError(scope.signal,'操作已取消、关闭或停止');if(!await external(()=>canRun(),scope.signal))throw pausedError('助理已暂停，资讯操作不可用');if(closing||scope.signal.aborted||scope.generation!==generation)throw stoppedError(scope.signal);if(scope.bindingKey){let route;try{route=await external(()=>readBinding(scope.sessionId),scope.signal);}catch{if(scope.signal.aborted)throw stoppedError(scope.signal);throw authorizationError('微信绑定暂不可用');}if(!route?.bound||route.bindingKey!==scope.bindingKey)throw authorizationError('原微信绑定已变化或不可用');}await external(()=>authorizeRequest(scope.request),scope.signal);if(!current(scope))throw stoppedError(scope.signal);}
  async function connection(sessionId){let route;try{route=await readBinding(sessionId);}catch{throw authorizationError('微信绑定暂不可用');}if(!route?.bound||!binding.safeParse(route.bindingKey).success)throw authorizationError('请在原微信绑定会话明确设置日报');return route.bindingKey;}
  function scopeFor(sessionId,bindingKey,signal,requestedGeneration=generation,timeZone=typeof hostTimeZone==='function'?hostTimeZone():hostTimeZone,request={}){const controller=new AbortController();controllers.add(controller);const signals=[controller.signal,AbortSignal.timeout(PIPELINE_TIMEOUT)];if(signal)signals.push(signal);return{sessionId,bindingKey,timeZone,request:{guard:request.guard,authorizeSync:request.authorizeSync},generation:requestedGeneration,signal:AbortSignal.any(signals),dispose:()=>controllers.delete(controller)};}
  const modelGuards=scope=>({guard:()=>active(scope),authorizeSync:()=>current(scope)});
  async function pipelineCall(fn,scope,label,stage){try{return await external(async()=>{await active(scope);return fn();},scope.signal);}catch(error){await active(scope);throw pipelineFailure(error,stage,label);}}
  async function generate(scope,topics,{preview=true,topicSource='temporary'}={}){await active(scope);const result=await pipelineCall(()=>fetchCandidates({hours:24,now:now(),signal:scope.signal}),scope,'资讯来源获取失败，本次未发送','sources');await active(scope);const list=Array.isArray(result)?result:result?.articles;if(!Array.isArray(list))throw new Error('资讯来源返回无效候选');const delivered=new Set(state.articleHistory.map(x=>x.id)),seen=new Set(),articles=[];for(const raw of list.slice(0,100)){const a=candidate(raw);if(seen.has(a.id))throw new Error('候选文章存在重复 ID');seen.add(a.id);const published=Date.parse(a.publishedAt);if(!delivered.has(a.id)&&Number.isFinite(published)&&published<=now().getTime()&&published>=now().getTime()-86400000)articles.push(a);}const stats={hours:24,candidateCount:articles.length,fetchedCount:Math.min(100,list.length)};for(const key of ['totalFeeds','succeededFeeds','failedFeeds','skippedFeeds','totalArticles','eligibleArticles']){const value=result?.stats?.[key];if(Number.isSafeInteger(value)&&value>=0&&value<=100000)stats[key]=value;}if(!articles.length)return renderNewsDigest({items:[],generatedAt:now().toISOString(),stats,timeZone:scope.timeZone,preview,topicSource,...(topics?{topics}:{})});
    const selectionInput=copy(articles);let excerptLimit=1000;for(const a of selectionInput)a.excerpt=clip(a.excerpt,excerptLimit);const selectionSize=()=>JSON.stringify(selectionInput.map(({id,title,sourceName,publishedAt,excerpt})=>({id,title,sourceName,publishedAt,excerpt}))).length;while(selectionSize()>150000&&excerptLimit>0){excerptLimit=Math.floor(excerptLimit/2);for(const a of selectionInput)a.excerpt=clip(a.excerpt,excerptLimit);}if(selectionSize()>150000)throw new Error('资讯选择材料超过限制');
    const ids=await pipelineCall(()=>selectArticles({articles:selectionInput,signal:scope.signal,...modelGuards(scope),...(topics?{topics:copy(topics)}:{})}),scope,'资讯选择生成失败，本次未发送','selection');await active(scope);if(!Array.isArray(ids)||ids.length>10||new Set(ids).size!==ids.length||ids.some(value=>typeof value!=='string'||!articles.some(a=>a.id===value)))throw new Error('资讯选择包含未知或重复 ID');
    if(!ids.length)return renderNewsDigest({items:[],generatedAt:now().toISOString(),stats,timeZone:scope.timeZone,preview,topicSource,...(topics?{topics}:{})});
    const selected=ids.map(articleId=>({...articles.find(a=>a.id===articleId),coverage:'feed-only',content:articles.find(a=>a.id===articleId).excerpt,truncated:false}));
    await Promise.all(selected.slice(0,3).map(async(a,index)=>{try{const read=await pipelineCall(()=>readArticle(copy(a),{signal:scope.signal}),scope,'资讯正文读取失败','article');await active(scope);if(read?.coverage==='article'&&typeof read.content==='string'&&read.content.trim()){selected[index]={...a,content:clip(read.content,16000),coverage:'article',truncated:read.truncated===true||read.content.length>16000};}}catch(error){await active(scope);/* Missing article is explicitly RSS-only; no raw error is published. */}}));
    await active(scope);const summaries=await pipelineCall(()=>summarizeArticles({articles:copy(selected),signal:scope.signal,...modelGuards(scope),...(topics?{topics:copy(topics)}:{})}),scope,'资讯摘要生成失败，本次未发送','summary');await active(scope);return renderNewsDigest({items:summaryItems(summaries,selected),generatedAt:now().toISOString(),stats,timeZone:scope.timeZone,preview,topicSource,...(topics?{topics}:{})});
  }
  function knownRoutes(){return[state.preferences,state.schedule,...state.jobs.filter(job=>['generating','pending','dispatching'].includes(job.status))].filter(Boolean);}
  function ownsKnownRoute(owner){return knownRoutes().some(route=>route.sessionId===owner.sessionId);}
  function verifyKnownBinding(key){if(knownRoutes().some(route=>route.bindingKey!==key))throw authorizationError('请回到原微信绑定会话管理资讯与关注点；换绑不会迁移旧设置');}
  async function authorizedKey(owner){const key=await connection(owner.sessionId);verifyKnownBinding(key);return key;}
  async function savedTopics(owner){
    if(!state.preferences)return undefined;
    const key=await connection(owner.sessionId);
    if(key!==state.preferences.bindingKey)throw authorizationError('已保存关注点仅能在原微信绑定会话使用');
    return copy(state.preferences.topics);
  }
  function status({topics=state.preferences?.topics,available=true,editable=true}={}){
    const focus=topics?copy(topics):null;
    const topicText=!available?'已保存关注点在当前绑定不可用。':focus?`已保存关注点：${focus.join('、')}。`:'未保存关注点，使用通用 AI 资讯范围。';
    return{schedule:state.schedule?{time:state.schedule.time,timeZone:state.schedule.timeZone}:null,topics:focus,topicSource:!available?'unavailable':focus?'explicit':'default',topicsEditable:editable,jobs:state.jobs.slice(-8).map(j=>({kind:j.kind,status:j.status,createdAt:j.createdAt,detail:deliveryLabels[j.status],...(j.diagnostic?{diagnostic:copy(j.diagnostic)}:{})})),counts:{jobs:state.jobs.length,articleHistory:state.articleHistory.length},text:`AI 资讯日报：${state.schedule?`每天 ${state.schedule.time}（${state.schedule.timeZone}），3 篇重点＋7 篇简讯`:'未启用'}。${topicText}${state.jobs.length?`最近一次任务：${deliveryLabels[state.jobs.at(-1).status]}。`:'尚无发送任务。'}电脑与宿主须在线；超过六小时不补发。通道回执不等于手机送达或已读。`};
  }
  async function visibleStatus(owner){
    try{const key=await connection(owner.sessionId);verifyKnownBinding(key);return status();}
    catch{return status({topics:null,available:!state.preferences,editable:false});}
  }
  function jobView(job,duplicate=false){return{status:job.status,duplicate,text:`AI 资讯日报：${deliveryLabels[job.status]}。${duplicate?'本次请求已有记录，不会重复发送。':''}`};}
  function receiptCapacity(){state.receipts=state.receipts.filter(r=>now().getTime()-Date.parse(r.createdAt)<SIX_HOURS);if(state.receipts.length>=100)throw new Error('六小时内资讯设置请求过多，请稍后再试');}
  function pruneJobs(){if(state.jobs.length<50)return;const i=state.jobs.findIndex(j=>now().getTime()>=Date.parse(j.expiresAt)&&!['generating','dispatching'].includes(j.status));if(i<0)throw new Error('六小时内资讯任务过多，请稍后再试');state.jobs.splice(i,1);}
  async function deliver(job,scope){await active(scope);if(now().getTime()>=Date.parse(job.expiresAt)){job.status='expired';job.detail=deliveryLabels.expired;await save();return jobView(job);}job.status='dispatching';job.detail=deliveryLabels.dispatching;await save();await active(scope);const authorize=()=>current(scope)&&job.status==='dispatching'&&now().getTime()<Date.parse(job.expiresAt);let result;try{result=await external(()=>send({sessionId:job.sessionId,bindingKey:job.bindingKey,text:job.text,signal:scope.signal,requestId:'news-'+job.id,authorize}),scope.signal);}catch{result={status:'uncertain'};}job.status=['reported_sent','queued','uncertain','failed'].includes(result?.status)?result.status:'uncertain';job.detail=deliveryLabels[job.status];if(['reported_sent','queued','uncertain'].includes(job.status))history(job);await save();return jobView(job);}
  async function runJob(job,signal,requestedGeneration=generation,request={}){const scope=scopeFor(job.sessionId,job.bindingKey,signal,requestedGeneration,job.timeZone,request);try{await active(scope);const output=await generate(scope,job.topics??undefined,{preview:false,topicSource:'saved'});await active(scope);job.text=output.text;job.articleIds=output.items.map(a=>a.id);if(!job.articleIds.length){job.status='failed';job.detail='没有符合窗口与去重条件的可用文章，本次未发送';await save();return jobView(job);}job.status='pending';await save();return await deliver(job,scope);}catch(error){if(!storageFailed&&job.status!=='uncertain'&&!['reported_sent','queued','failed','expired'].includes(job.status)){job.status=closing||scope.generation!==generation||scope.signal.aborted&&stoppedError(scope.signal).code!=='NEWS_TIMEOUT'?'cancelled':'failed';job.detail=deliveryLabels[job.status];job.diagnostic=jobDiagnostic(error);await save();}throw error;}finally{scope.dispose();}}
  const changes=new Set(['configure','cancel','set_topics','clear_topics']);
  const authorizationError=(message='本次资讯操作授权已变化或不可用')=>Object.assign(new Error(message),{code:'NEWS_AUTHORIZATION_CHANGED'});
  function authorizeSync(input){
    if(!input.authorizeSync)return;
    let allowed;try{allowed=input.authorizeSync();}catch{throw authorizationError();}
    if(allowed&&typeof allowed.then==='function')Promise.resolve(allowed).catch(()=>{});
    if(allowed!==true)throw authorizationError();
  }
  async function authorizeRequest(input){
    try{if(input.guard&&await input.guard()===false)throw authorizationError();}catch{throw authorizationError();}
    authorizeSync(input);
  }
  const duplicateSetting=(owner,input)=>state.receipts.some(r=>r.sessionId===owner.sessionId&&r.requestId===input.requestId);
  function acceptChange(sequence){if(sequence<lastAcceptedChange)throw stoppedError(undefined,'已有更新的用户设置，本次操作已取消或停止');lastAcceptedChange=sequence;invalidate();return generation;}
  function stopped(input,expectedGeneration){if(closing||input.signal?.aborted||expectedGeneration!==generation)throw stoppedError(input.signal);}
  function recordSetting(owner,input){state.receipts.push({sessionId:owner.sessionId,requestId:input.requestId,action:input.action,createdAt:now().toISOString()});}
  function setTopics(owner,key,topics){state.preferences={topics:copy(topics),source:'explicit',sessionId:owner.sessionId,bindingKey:key,updatedAt:now().toISOString()};}
  // Snapshot inputs before asynchronous admission; source/provider code never
  // gets a reference to saved preferences or another job's topic snapshot.
  const act=(caller,input={})=>{
    let owner,value,topics,requestedGeneration=generation,invalidated=false,sequence;
    try{
      input={...input};owner=requireOwner(caller);
      if(!['preview','send_now','configure','cancel','status','set_topics','clear_topics'].includes(input.action))throw new Error('未知资讯操作');
      if(Object.hasOwn(input,'topics')&&!['preview','configure','set_topics'].includes(input.action))throw new Error('本操作不接受关注点；请使用保存关注点或临时预览');
      if(Object.hasOwn(input,'topics')||input.action==='set_topics'){
        topics=normalizeNewsTopics(input.topics);
        if(!topics)throw Object.assign(new Error('保存或指定关注点需要非空主题数组'),{code:'NEWS_INVALID_TOPICS'});
      }
      if(input.action==='send_now'||changes.has(input.action))mutation(input);
      if(input.action==='configure')value=scheduleInput(input);
      if(input.signal!==undefined&&!(input.signal instanceof AbortSignal))throw new Error('无效取消信号');
      if(input.guard!==undefined&&typeof input.guard!=='function'||input.authorizeSync!==undefined&&typeof input.authorizeSync!=='function')throw authorizationError();
      authorizeSync(input);
      if(input.signal?.aborted)throw stoppedError(input.signal);
      if(changes.has(input.action))sequence=++changeSequence;
      // Original callers may stop their own outstanding work immediately. A
      // different caller must first prove the same live binding; replays never
      // invalidate generation. The actual write is still rechecked below.
      if(changes.has(input.action)&&!input.guard&&state&&!duplicateSetting(owner,input)&&ownsKnownRoute(owner)){
        requestedGeneration=acceptChange(sequence);invalidated=true;
      }
    }catch(error){return Promise.reject(error);}
    const admit=async()=>{
      await load();
      if(closing)throw stoppedError(undefined,'资讯服务已关闭');
      await authorizeRequest(input);
      if(changes.has(input.action)&&!duplicateSetting(owner,input)){
        await authorizedKey(owner);
        if(input.action==='configure'&&!await canRun())throw pausedError('助理已暂停，未启用日报');
        if(closing||input.signal?.aborted)throw stoppedError(input.signal);
        await authorizeRequest(input);
        if(!invalidated){requestedGeneration=acceptChange(sequence);invalidated=true;}
      }
      return serial(async()=>{
        await load();if(closing)throw stoppedError(undefined,'资讯服务已关闭');
        await authorizeRequest(input);
        if(input.action==='status'){const result=await visibleStatus(owner);authorizeSync(input);return result;}
        if(input.action==='preview'){
          let focus=topics,bindingKey=null;
          if(!focus&&state.preferences){focus=await savedTopics(owner);bindingKey=state.preferences.bindingKey;}
          const scope=scopeFor(owner.sessionId,bindingKey,input.signal,requestedGeneration,undefined,input);
          try{await authorizeRequest(input);const result={status:'preview',...await generate(scope,focus,{preview:true,topicSource:topics?'temporary':'saved'})};authorizeSync(input);return result;}finally{scope.dispose();}
        }
        if(changes.has(input.action)){
          if(duplicateSetting(owner,input)){const result={...await visibleStatus(owner),duplicate:true};authorizeSync(input);return result;}
          stopped(input,requestedGeneration);
          const key=await authorizedKey(owner);
          if(input.action==='configure'&&!await canRun())throw pausedError('助理已暂停，未启用日报');
          await authorizeRequest(input);
          stopped(input,requestedGeneration);receiptCapacity();
          const previous=state;state=copy(state);
          try{
          if(input.action==='configure'){
            state.schedule={...value,sessionId:owner.sessionId,bindingKey:key,createdAt:now().toISOString()};
            if(topics)setTopics(owner,key,topics);
          }else if(input.action==='set_topics')setTopics(owner,key,topics);
          else if(input.action==='clear_topics')state.preferences=null;
          else state.schedule=null;
          for(const job of state.jobs)if(['generating','pending','blocked'].includes(job.status)){job.status='cancelled';job.detail=deliveryLabels.cancelled;}
          recordSetting(owner,input);authorizeSync(input);
          }catch(error){state=previous;throw error;}
          await save();
          const result=status();
          if(input.action==='cancel')return{...result,text:`AI 资讯日报已关闭；未开始发送的任务已取消，已提交通道或结果不确定的消息无法撤回。${state.preferences?'已保存关注点保留。':''}`};
          if(input.action==='set_topics')return{...result,text:`已保存关注点：${topics.join('、')}。后续预览、立即发送和每日资讯都会使用；当前未发送。${state.schedule?'原推送时间保留。':'尚未开启每日推送。'}`};
          if(input.action==='clear_topics')return{...result,text:'已清空保存的关注点，后续使用通用 AI 资讯范围；原推送时间保留，当前未发送。'};
          return{...result,text:`已设置每天 ${value.time}（${value.timeZone}）发送 AI 资讯日报：3 篇重点＋7 篇简讯。${state.preferences?`已保存关注点：${state.preferences.topics.join('、')}。`:''}电脑和宿主在线时运行，超过六小时不补发。`};
        }
        const prior=state.jobs.find(j=>j.kind==='manual'&&j.sessionId===owner.sessionId&&j.requestId===input.requestId);
        if(prior)return jobView(prior,true);
        const key=await authorizedKey(owner);
        if(!await canRun())throw pausedError('助理已暂停，未发送资讯');
        await authorizeRequest(input);
        stopped(input,requestedGeneration);pruneJobs();
        const createdAt=now().toISOString(),job={id:`news_${randomUUID()}`,kind:'manual',requestId:input.requestId,sessionId:owner.sessionId,bindingKey:key,date:null,createdAt,expiresAt:new Date(now().getTime()+SIX_HOURS).toISOString(),status:'generating',articleIds:[],text:'',detail:deliveryLabels.generating,topics:state.preferences?copy(state.preferences.topics):null,timeZone:typeof hostTimeZone==='function'?hostTimeZone():hostTimeZone};
        state.jobs.push(job);await save();return runJob(job,input.signal,requestedGeneration,input);
      });
    };
    return admit();
  };
  const tick=()=>{const requestedGeneration=generation;return serial(async()=>{if(closing)return;await load();if(!state.schedule||!await canRun()||closing||requestedGeneration!==generation)return;const current=now(),due=dueSchedule(current,state.schedule);if(due.epoch<Date.parse(state.schedule.createdAt))return;if(state.dailyDates.includes(due.date)||state.jobs.some(j=>j.kind==='daily'&&j.date===due.date))return;pruneJobs();const schedule=copy(state.schedule),expired=current.getTime()-due.epoch>SIX_HOURS,job={id:`news_${randomUUID()}`,kind:'daily',requestId:`daily:${due.date}`,sessionId:schedule.sessionId,bindingKey:schedule.bindingKey,date:due.date,createdAt:current.toISOString(),expiresAt:new Date(due.epoch+SIX_HOURS).toISOString(),status:expired?'expired':'generating',articleIds:[],text:'',detail:deliveryLabels[expired?'expired':'generating'],topics:state.preferences?copy(state.preferences.topics):null,timeZone:schedule.timeZone};state.jobs.push(job);state.dailyDates=[...state.dailyDates,due.date].slice(-400);await save();if(!expired){try{await runJob(job,undefined,requestedGeneration);}catch(error){if(storageFailed)throw error;}}});};
  const close=()=>{if(!closing){closing=true;invalidate();}closePromise??=serial(async()=>{await load();});return closePromise;};
  return{ready:()=>serial(load),act,tick,needsTimer:()=>!closing&&!!state?.schedule,suspend:invalidate,close};
}
