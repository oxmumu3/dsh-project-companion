import {canonicalizeTimeZone,makeLocalFormatter,localProjection,resolveLocalInstant} from '../vendor/proactive/lib/domain.js';
import {reviewNotificationReason} from './personal-review-ledger.js';

const DAY=86400000,GRACE=15*60000,DEADLINE_WINDOW=2*3600000;
const iso=epoch=>new Date(epoch).toISOString();
const datePart=(day)=>new Date(day).toISOString().slice(0,10);
const pad=value=>String(value).padStart(2,'0');
function epochOf(value){const stamp=value instanceof Date?value.getTime():Date.parse(value);if(!Number.isFinite(stamp))throw new Error('无效的主动关注时间');return stamp;}
function settings(value){
 if(!value||value.enabled===false)return null;
 if(value.enabled!==true||!Number.isInteger(value.intervalMinutes)||value.intervalMinutes<60||value.intervalMinutes>720||!Number.isInteger(value.startHour)||!Number.isInteger(value.endHour)||value.startHour<0||value.endHour>24||value.startHour>=value.endHour||!Number.isInteger(value.maxMessagesPerDay)||value.maxMessagesPerDay<1||value.maxMessagesPerDay>10)throw new Error('无效的主动关注设置');
 return value;
}
function slots(day,zone,policy,dailyTime,weeklyTime,weeklyDay){
 const date=new Date(day),result=[];
 for(let minute=policy.startHour*60;minute<policy.endHour*60;minute+=policy.intervalMinutes){
  const hh=pad(Math.floor(minute/60)),mm=pad(minute%60),time=`${hh}:${mm}`;if(time===dailyTime||time===weeklyTime&&date.getUTCDay()===weeklyDay)continue;
  try{const epoch=resolveLocalInstant({year:date.getUTCFullYear(),month:date.getUTCMonth()+1,day:date.getUTCDate(),hour:Number(hh),minute:Number(mm),second:0,millisecond:0},zone);result.push({id:`attention:${datePart(day)}:${time}`,epoch});}catch{/* A nonexistent local DST wall time is skipped. */}
 }
 return result;
}

/** Pure scheduling policy; the caller owns persistence, authority and sending. */
export function attentionDue({now,timeZone,attention,createdAt,occurrences=[],dailyTime,weeklyTime,weeklyDay}={}){
 const policy=settings(attention);if(!policy)return{status:'disabled',occurrence:null,nextRun:null,quiet:true};
 const current=epochOf(now),created=epochOf(createdAt),zone=canonicalizeTimeZone(timeZone),local=localProjection(makeLocalFormatter(zone),current);
 if(!Array.isArray(occurrences))throw new Error('主动关注记录无效');
 const day=Date.UTC(local.year,local.month-1,local.day),today=slots(day,zone,policy,dailyTime,weeklyTime,weeklyDay),tomorrow=slots(day+DAY,zone,policy,dailyTime,weeklyTime,weeklyDay);
 const latest=today.filter(slot=>slot.epoch<=current&&slot.epoch>=created).at(-1)??null;
 const next=[...today,...tomorrow].find(slot=>slot.epoch>current&&slot.epoch>=created&&!occurrences.includes(slot.id))??null;
 const quiet=local.hour<policy.startHour||local.hour>=policy.endHour;
 const result={status:'not_due',occurrence:null,nextRun:next?iso(next.epoch):null,quiet};
 const coincident=[dailyTime,...(new Date(day).getUTCDay()===weeklyDay?[weeklyTime]:[])].filter(value=>typeof value==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(value));
 for(const time of coincident){try{const when=resolveLocalInstant({year:local.year,month:local.month,day:local.day,hour:Number(time.slice(0,2)),minute:Number(time.slice(3)),second:0,millisecond:0},zone);if(current>=when&&current-when<=GRACE)return result;}catch{/* DST gaps have no occurrence. */}}
 if(!latest||occurrences.includes(latest.id)||quiet)return result;
 result.occurrence=latest;result.status=current-latest.epoch<=GRACE?'due':'expired';return result;
}

/** Existing ledger rows and source coverage in; no effects or ledger changes. */
export function selectAttentionItems(items,{now,scopeKey,coverage,remaining}={}){
 const instant=epochOf(now);if(!Array.isArray(items)||!Array.isArray(coverage)||typeof scopeKey!=='string'||!Number.isInteger(remaining)||remaining<0)throw new Error('主动关注输入无效');
 if(!coverage.some(row=>row&&['ok','partial'].includes(row.status)))return{status:'unknown',selected:[]};
 if(remaining===0)return{status:'budget_exhausted',selected:[]};
 const candidates=[];
 for(const item of items){
  if(item?.scopeKey!==scopeKey||!Array.isArray(item.evidence)||!item.evidence.length||!Array.isArray(item.notifications)||item.evidence.some(e=>!coverage.some(c=>c.source===e.source&&['ok','partial'].includes(c.status))))continue;
  const reason=reviewNotificationReason(item,iso(instant),'daily');if(!reason||item.notifications.includes(reason))continue;
  const delta=Date.parse(item.dueAt??'')-instant;
  const deadline=item.kind==='deadline'&&item.dueAtBasis==='source'&&Number.isFinite(delta)&&delta>=0&&delta<=DEADLINE_WINDOW&&!item.notifications.includes(`due:${item.dueAt}`);
  const freshRisk=item.kind==='risk'&&item.priority==='high'&&(reason==='new'||reason.startsWith('update:')||reason.startsWith('snooze:'));
  if(deadline||freshRisk)candidates.push({item,reason,deadline});
 }
 candidates.sort((a,b)=>Number(b.deadline)-Number(a.deadline)||Date.parse(a.item.dueAt??'9999-01-01')-Date.parse(b.item.dueAt??'9999-01-01')||String(a.item.id).localeCompare(String(b.item.id)));
 const selected=candidates.slice(0,2).map(({item,reason})=>({item,reason}));return{status:selected.length?'selected':coverage.some(row=>row.status!=='ok'||row.truncated===true)?'unknown':'quiet',selected};
}

export function attentionStatus(options={}){
 const policy=settings(options.attention),schedule=attentionDue(options),used=options.usedMessages??0;
 if(!Number.isInteger(used)||used<0)throw new Error('主动关注投递数量无效');
 return{enabled:!!policy,nextRun:schedule.nextRun,quiet:schedule.quiet,remaining:policy?Math.max(0,policy.maxMessagesPerDay-used):0};
}
