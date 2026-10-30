// This parser admits only an already independently verified Family Owner call.
// It never trusts model-supplied source IDs, projects, dates, or feedback values.
const actions=new Set(['configure','preview','run_now','status','pause','resume','cancel','feedback','attention']);
export const familyPersonalReviewAction=action=>actions.has(action);
const fail=()=>{throw Object.assign(new Error('无法从本次 Owner 原话核对个人回顾的范围或操作；本次未读取资料或更改计划。'),{code:'FAMILY_REVIEW_SCOPE_UNSUPPORTED'});};
const stamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value?Date.parse(value):NaN;
export function assertFamilyOwnerRequest(scope,{now=new Date(),activeCallVerified=false,requireFresh=true}={}){
 if(activeCallVerified!==true||!scope?.familySessionId?.startsWith('family_owner_')||!/^[a-f0-9]{64}$/u.test(scope.bindingRevision??'')||!/^wechat-[a-f0-9]{64}$/u.test(scope.sourceRequestId??'')||typeof scope.userText!=='string'||!scope.userText.trim()||scope.userText.length>1000||/[\x00-\x08\x0b\x0c\x0e-\x1f]/u.test(scope.userText))fail();
 if(requireFresh){
  const received=stamp(scope.sourceTiming?.receivedAt),created=stamp(scope.sourceTiming?.providerCreatedAt),current=now instanceof Date?now.getTime():NaN;
  if(!['fresh','stale'].includes(scope.sourceTimingState)||![received,created,current].every(Number.isFinite)||created>received+5000||received>current+5000||received-created>30000||current-received>600000||current-created>630000)fail();
 }
 return scope.userText.trim();
}
const number=word=>{if(/^\d+$/u.test(word))return Number(word);const d={'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9};if(word==='十')return 10;if(d[word])return d[word];const p=word.split('十');return p.length===2&&(!p[0]||d[p[0]])&&(!p[1]||d[p[1]])?(p[0]?d[p[0]]:1)*10+(p[1]?d[p[1]]:0):NaN;};
const clockPattern='(早上|上午|中午|下午|晚上)?([01]?\\d|2[0-3])(?:[:：]([0-5]\\d)|点(?:([0-5]?\\d)分)?)';
function clockValue(match,offset=0){let hour=Number(match[1+offset]),minute=Number(match[2+offset]??match[3+offset]??0);const part=match[offset];if(['下午','晚上'].includes(part)&&hour>=1&&hour<=11)hour+=12;if(['早上','上午'].includes(part)&&hour>11||part==='中午'&&hour!==12)fail();return`${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`;}
const preset='enabled_sources_watched_projects';
const scopeText=/(?:根据|使用|基于)我(?:在电脑(?:上)?启用的|已启用的)资料和(?:已关注|选定|已选定)项目/u;
const needsConfirmation=sourceRequestId=>({status:'needs_confirmation',sourceRequestId,text:'请确认持续回顾的资料范围、项目和时间，例如：“每天9点、每周一9点，使用我在电脑启用的资料和已关注项目做个人回顾”。系统会列出实际来源和项目；本次尚未读取或开启。'});
export function deriveFamilyPersonalReviewRequest(scope,{action,now=new Date(),timeZone='UTC',activeCallVerified=false}={}){
 if(!actions.has(action))fail();
 let text=assertFamilyOwnerRequest(scope,{now,activeCallVerified,requireFresh:action!=='status'}).replace(/[。！!]+$/u,'').replace(/^(?:请|帮我|麻烦)\s*/u,'');
 const result={action,sourceRequestId:scope.sourceRequestId};
 if(action==='feedback'){
  const m=text.match(/^(?:我的)?个人回顾(?:事项)?\s+([A-Za-z0-9][A-Za-z0-9_.:-]{2,159})\s+(已处理|不再提醒|延后(?:\d{1,3}|[一二两三四五六七八九十]{1,3})(?:小时|天))$/u);
  const titled=text.match(/^(?:我的)?个人回顾(?:事项)?\s*(?:「([^「」\r\n]{1,100})」|“([^“”\r\n]{1,100})”)\s*(已处理|不再提醒|延后(?:\d{1,3}|[一二两三四五六七八九十]{1,3})(?:小时|天))$/u);
  const short=text.replace(/\s+/gu,'').match(/^(?:(?:我的)?个人回顾(?:事项)?)?第([一二两三四五六七八九1-9])(?:条|项)(已处理|不再提醒|延后(?:\d{1,3}|[一二两三四五六七八九十]{1,3})(?:小时|天))$/u);if(!m&&!short&&!titled)fail();
  const target=m?{itemId:m[1]}:titled?{itemTitle:titled[1]??titled[2]}:{itemNumber:number(short[1]),...(/^[a-f0-9]{64}$/u.test(scope.previousReviewViewToken??'')?{confirmedViewToken:scope.previousReviewViewToken}:{})},operation=titled?titled[3]:(m??short)[2];
  if(operation==='已处理')return{...result,...target,feedback:'handled'};
  if(operation==='不再提醒')return{...result,...target,feedback:'dismissed'};
  const delay=operation.match(/^延后(.+)(小时|天)$/u),hours=number(delay[1])*(delay[2]==='天'?24:1);if(!Number.isInteger(hours)||hours<1||hours>168)fail();
  return{...result,...target,feedback:'snoozed',snoozeUntil:new Date(stamp(scope.sourceTiming.providerCreatedAt)+hours*3600000).toISOString()};
 }
 text=text.replace(/\s+/gu,'').replace(/[，,、；;]/gu,'，');
 if(action==='attention'){
  if(/^(?:开启|打开|启用)(?:我的)?个人回顾(?:的)?工作时段主动关注$/u.test(text)||text==='每天9点到19点，每2小时主动关注个人回顾，每天最多提醒2次')return{...result,enabled:true};
  if(/^(?:关闭|停止|取消|暂停)(?:我的)?个人回顾(?:的)?工作时段主动关注$/u.test(text))return{...result,enabled:false};
  fail();
 }
 const lifecycle={status:/^(?:查看|看看|查询)(?:我的)?个人回顾(?:状态|设置)?$/u,pause:/^(?:暂停|暂时关闭)(?:我的)?个人回顾$/u,resume:/^(?:恢复|继续)(?:我的)?个人回顾$/u,cancel:/^(?:取消|关闭|停止)(?:我的)?个人回顾$/u};
 if(lifecycle[action]){if(!lifecycle[action].test(text))fail();return result;}
 if(action==='configure'&&/^(?:(?:每天每周主动给我做|每天(?:早上)?(?:\d{1,2}|[一二两三四五六七八九十]{1,3})点做|开启)(?:我的)?个人回顾)$/u.test(text))return needsConfirmation(scope.sourceRequestId);
 if(action==='preview'||action==='run_now'){
  const prefix=action==='preview'?'(?:预览|先看看)':'(?:发送|发给我)';
  const m=text.match(new RegExp('^'+prefix+'(?:一份)?个人回顾，(.+)，(?:不|不要)(?:建立|创建)计划$','u'));
  if(!m||m[1].match(scopeText)?.[0]!==m[1])fail();return{...result,preset};
 }
 let zone=timeZone;try{zone=new Intl.DateTimeFormat('en',{timeZone:zone}).resolvedOptions().timeZone;}catch{fail();}
 if(text.startsWith('北京时间')){zone='Asia/Shanghai';text=text.slice(4);}
 text=text.replace(/([一二两三四五六七八九十]{1,3})(?=点)/gu,word=>String(number(word)));
 text=text.replace(/，主动发现风险，截止事项和项目进展，无变化时保持安静$/u,'');
 const parts=text.split('，').filter(Boolean),schedule={timeZone:zone};let hasScope=false;
 for(const part of parts){
  let m=part.match(new RegExp('^每天'+clockPattern+'$','u'));
  if(m){if(schedule.dailyTime)fail();schedule.dailyTime=clockValue(m.slice(1));continue;}
  m=part.match(new RegExp('^每周([一二三四五六日天])'+clockPattern+'$','u'));
  if(m){if(schedule.weeklyTime)fail();schedule.weeklyDay={'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'日':0,'天':0}[m[1]];schedule.weeklyTime=clockValue(m.slice(2));continue;}
  const scoped=part.match(scopeText)?.[0];if(scoped&&part===scoped+'做个人回顾'){if(hasScope)fail();hasScope=true;continue;}
  if(/^(?:有风险或临期事项告诉我|有值得处理的事项再告诉我|没有值得提醒的事项就安静|没变化不要发|不要重复提醒)$/u.test(part))continue;
  fail();
 }
 if(!hasScope||!schedule.dailyTime&&!schedule.weeklyTime)fail();
 return{...result,preset,schedule};
}
