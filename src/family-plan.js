// Only fresh ingress plus a current, verified Family Owner call can grant a schedule.
// The model selects a tool; it never supplies the cadence, time or authority.
const actions=new Set(['check_once','configure_followup','configure_daily','cancel_once','cancel_followup','cancel_daily','once_status','followup_status']);
export const familyPlanAction=action=>actions.has(action);
const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&');
const stamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value?Date.parse(value):NaN;
const wordNumber=word=>{if(/^\d+$/u.test(word))return Number(word);const digits={'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9};if(word==='十')return 10;if(digits[word])return digits[word];const parts=word.split('十');return parts.length===2&&(!parts[0]||digits[parts[0]])&&(!parts[1]||digits[parts[1]])?(parts[0]?digits[parts[0]]:1)*10+(parts[1]?digits[parts[1]]:0):NaN;};
function fresh(scope,now,activeCallVerified){
 if(activeCallVerified!==true||!scope?.familySessionId?.startsWith('family_owner_')||!/^[a-f0-9]{64}$/u.test(scope.bindingRevision??'')||!/^wechat-[a-f0-9]{64}$/u.test(scope.sourceRequestId??'')||!['fresh','stale'].includes(scope.sourceTimingState))return false;
 const received=stamp(scope.sourceTiming?.receivedAt),created=stamp(scope.sourceTiming?.providerCreatedAt),current=now instanceof Date?now.getTime():NaN;
 // Ingress must be fresh, but legitimate model/tool processing may take
 // minutes. The independently checked active call, never this timestamp,
 // proves that this is still the same Owner request.
 return[received,created,current].every(Number.isFinite)&&created<=received+5000&&received<=current+5000&&received-created<=30000&&current-received<=600000&&current-created<=630000;
}
export function deriveFamilyPlan(scope,{action,aliases=[],now=new Date(),timeZone='UTC',activeCallVerified=false}={}){
 const invalid=()=>{throw new Error('请说明要跟进哪个项目，以及多久检查一次或每天几点；本次尚未创建或更改计划。');};
 if(!actions.has(action)||!fresh(scope,now,activeCallVerified)||typeof scope.userText!=='string'||scope.userText.length>1000)invalid();
 let text=scope.userText.trim(),zone=timeZone;
 try{zone=new Intl.DateTimeFormat('en',{timeZone:zone}).resolvedOptions().timeZone;}catch{invalid();}
 if(text.includes('北京时间')){zone='Asia/Shanghai';text=text.replace('北京时间','');}
 const names=[...new Set(aliases.filter(x=>typeof x==='string'&&x.trim()).map(x=>x.trim()))].sort((a,b)=>b.length-a.length);
 let matched=false;
 for(const alias of names){const rx=new RegExp(escape(alias),'giu');if(rx.test(text)){text=text.replace(rx,'@');matched=true;break;}}
 if(!matched&&/(?:继续|刚才|这份简报)/u.test(text)&&typeof scope.previousUserText==='string'&&names.some(alias=>scope.previousUserText.toLowerCase().includes(alias.toLowerCase()))){text=text.replace(/(?:刚才)?(?:这份|那份)简报/u,'@简报');matched=true;}
 if(!matched||(text.match(/@/gu)??[]).length!==1)invalid();
 text=text.replace(/^(?:请|帮我|麻烦)\s*/u,'').replace(/\s+/gu,'').replace(/[，,。.!！；;]/gu,'');
 text=text.replace(/([一二两三四五六七八九十]{1,3})(?=分钟|小时|点)/gu,word=>String(wordNumber(word))).replace(/每半小时/gu,'每30分钟').replace(/每(\d{1,2})小时/gu,(_all,n)=>`每${Number(n)*60}分钟`);
 // These clauses only narrow the read-only change notification contract.
 text=text.replace(/(?:有变化再告诉我|有变化才告诉我|只在有变化时告诉我|没变化不要发|没有变化不要发|不要重复发送|不要重复发|不要改文件|只读)/gu,'');
 text=text.replace(/的?(?:这份|资料|项目)?简报/gu,'简报');
 const result={sourceRequestId:scope.sourceRequestId};
 if(['cancel_once','cancel_followup','cancel_daily'].includes(action)){
  const kind=action==='cancel_once'?'(?:单次检查|一次检查)':action==='cancel_daily'?'(?:日报|每日简报)':'(?:主动跟进|跟进|定期跟进)';
  if(!new RegExp('^(?:取消|关闭|停止)@的?'+kind+'$','u').test(text))invalid();
  return{...result,action:action==='cancel_daily'?'cancel_followup':action,...(action==='cancel_daily'?{scheduleKind:'daily'}:{})};
 }
 if(['followup_status','once_status'].includes(action)){
  const kind=action==='once_status'?'(?:单次检查|一次检查)':'(?:主动跟进|跟进|定期跟进|日报)';
  if(!new RegExp('^(?:查看|看看|查询)@的?'+kind+'状态$','u').test(text))invalid();
  return{...result,action};
 }
 if(action==='check_once'){
  text=text.replace(/不要建立周期计划|不要建周期计划|不要设周期计划|不要建立计划|不要建计划/gu,'');
  const match=text.match(/^([1-5])分钟后(?:检查|跟进)(?:一次)?@简报(?:一次)?$/u);
  if(!match)invalid();const due=stamp(scope.sourceTiming.providerCreatedAt)+Number(match[1])*60000;
  if(due<=now.getTime())invalid();return{...result,action,dueAt:new Date(due).toISOString()};
 }
 if(action==='configure_daily'){
  const match=text.match(/^每天(早上|上午|中午|下午|晚上)?([01]?\d|2[0-3])(?:[:：]([0-5]\d)|点(?:([0-5]?\d)分)?)?(?:给我|发我|推送|发送|整理)@简报$/u);
  if(!match)invalid();let hour=Number(match[2]);const minute=Number(match[3]??match[4]??0);
  if(['下午','晚上'].includes(match[1])&&hour>=1&&hour<=11)hour+=12;
  if(['早上','上午'].includes(match[1])&&hour>11||match[1]==='中午'&&hour!==12)invalid();
  return{...result,action:'configure_followup',everyMinutes:1440,dailyTime:`${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`,timeZone:zone};
 }
 let match=text.match(/^(?:继续)?(?:跟进|关注|检查)@简报每(\d{1,4})分钟检查一次$/u)??text.match(/^每(\d{1,4})分钟(?:检查|跟进)@(?:简报)?(?:一次)?$/u);
 let minutes=match?Number(match[1]):null;
 if(/^(?:继续)?(?:跟进|关注|检查)@简报每小时检查一次$/u.test(text)||/^每小时(?:检查|跟进)@(?:简报)?(?:一次)?$/u.test(text))minutes=60;
 if(!Number.isInteger(minutes)||minutes<30||minutes>1440)invalid();
 return{...result,action:'configure_followup',everyMinutes:minutes};
}
