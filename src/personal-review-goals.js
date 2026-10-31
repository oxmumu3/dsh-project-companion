import {z} from 'zod';
import {basename} from 'node:path';
import {hashReview,reviewCandidateSchema} from './personal-review-ledger.js';

const prose=z.string().trim().min(1).max(100).refine(s=>!/[\x00-\x1f\x7f]|https?:\/\//iu.test(s));
export const reviewGoalSchema=z.object({id:z.string().max(80),scopeKey:z.string().length(64),grant:z.string().length(64),title:prose,objective:prose,project:z.string().max(4096),meetingTitle:prose.optional(),leadMinutes:z.literal(30),status:z.enum(['active','paused','completed']),createdAt:z.string().datetime(),updatedAt:z.string().datetime()}).strict();
export const meetingCacheSchema=z.object({scopeKey:z.string().length(64),grant:z.string().length(64),at:z.string().datetime(),events:z.array(z.object({id:z.string().max(240),title:z.string().max(400),eventStartAt:z.string().datetime(),eventEndAt:z.string().datetime().optional()}).strict()).max(10)}).strict().nullable();
export const activeReviewGoals=(goals,scope)=>(goals??[]).filter(g=>g.status==='active'&&g.scopeKey===scope.key&&g.grant===scope.grant&&scope.projects.includes(g.project));
export function meetingWorkHours(now,timeZone){const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone,hour:'2-digit',hourCycle:'h23'}).format(new Date(now)));return hour>=9&&hour<19;}

export function changeReviewGoal(goals,input,scope,now){
 if(input.sources!==undefined||input.projects!==undefined||input.schedule!==undefined)throw Error('目标沿用已确认的回顾范围，不能增加来源或项目');
 const title=prose.parse(input.goalTitle),operation=z.enum(['track','pause','resume','complete']).parse(input.goalAction);
 const next=structuredClone(goals),found=next.find(g=>g.scopeKey===scope.key&&g.grant===scope.grant&&g.title===title);
 const currentCount=next.filter(g=>g.scopeKey===scope.key&&g.grant===scope.grant&&g.status!=='completed').length;
 if(operation!=='track'){
  if(!found)throw Error('未找到当前授权范围的这个目标');if(operation==='resume'&&found.status==='completed'&&currentCount>=5)throw Error('当前范围最多跟进五个明确目标');found.status={pause:'paused',resume:'active',complete:'completed'}[operation];found.updatedAt=now;return next;
 }
 const name=prose.parse(input.projectName),matches=scope.projects.filter(p=>p===name||basename(p)===name);
 if(matches.length!==1)throw Error('请指定回顾范围内唯一的已关注项目');
 const meetingTitle=input.meetingTitle===undefined?undefined:prose.parse(input.meetingTitle);
 if(meetingTitle&&!scope.sources.includes('calendar'))throw Error('会前准备需要原回顾范围已启用日历');
 if((!found||found.status==='completed')&&currentCount>=5)throw Error('当前范围最多跟进五个明确目标');
 if(!found&&next.length>=50)throw Error('历史目标已满，需先整理历史目标；本次没有删除或创建目标');
 const goal=reviewGoalSchema.parse({id:found?.id??`goal_${hashReview(`${scope.key}:${scope.grant}:${title}`).slice(0,32)}`,scopeKey:scope.key,grant:scope.grant,title,objective:prose.parse(input.objective??title),project:matches[0],...(meetingTitle?{meetingTitle}:{}),leadMinutes:30,status:'active',createdAt:found?.createdAt??now,updatedAt:now});
 return found?next.map(g=>g.id===found.id?goal:g):[...next,goal];
}

export function calendarCoverageComplete(coverage){
 const entries=coverage.filter(c=>c.source==='calendar');
 return entries.length>0&&entries.every(c=>c.status==='ok'&&!c.truncated);
}
export function captureReviewMeetings(evidence,coverage,scope,now){
 if(!calendarCoverageComplete(coverage))return null;
 return{scopeKey:scope.key,grant:scope.grant,at:now,events:evidence.filter(e=>e.source==='calendar'&&e.eventStartAt).slice(0,10).map(({id,title,eventStartAt,eventEndAt})=>({id,title,eventStartAt,...(eventEndAt?{eventEndAt}:{})}))};
}
function matchingMeeting(goal,events){const matches=events.filter(e=>e.title===goal.meetingTitle);return matches.length===1?matches[0]:null;}
export function dueReviewMeeting(goals,cache,scope,now,occurrences=[]){
 if(!cache||cache.scopeKey!==scope.key||cache.grant!==scope.grant||Date.parse(now)-Date.parse(cache.at)>86400000||Date.parse(now)<Date.parse(cache.at))return null;
 for(const goal of activeReviewGoals(goals,scope)){
  if(!goal.meetingTitle)continue;const event=matchingMeeting(goal,cache.events);if(!event)continue;
  const delta=Date.parse(event.eventStartAt)-Date.parse(now),id=`meeting:${hashReview(`${goal.id}:${event.id}:${event.eventStartAt}`).slice(0,48)}`;
  if(delta>0&&delta<=goal.leadMinutes*60000&&!occurrences.includes(id))return{id,goalId:goal.id,eventId:event.id,eventStartAt:event.eventStartAt,epoch:Date.parse(event.eventStartAt)-goal.leadMinutes*60000};
 }return null;
}

/** The meeting link was explicitly supplied by the user; no semantic title guessing. */
export function prepareReviewMeeting(goals,scope,evidence,candidates,now){
 const prepared=[];
 for(const goal of activeReviewGoals(goals,scope)){
  if(!goal.meetingTitle)continue;const event=matchingMeeting(goal,evidence.filter(e=>e.source==='calendar'&&e.eventStartAt));if(!event)continue;
  const delta=Date.parse(event.eventStartAt)-Date.parse(now);if(delta<=0||delta>goal.leadMinutes*60000)continue;
  const docs=evidence.filter(e=>['project','memory'].includes(e.source)&&e.projectRoot===goal.project&&e.text.trim()).slice(0,3);
  // Include a summary only when every cited fact is in this exact project's
  // selected material; never truncate away an external supporting citation.
  const ids=new Set(docs.map(e=>e.id)),facts=candidates.filter(c=>c.evidenceIds.length>0&&c.evidenceIds.every(id=>ids.has(id))).slice(0,2);
  const summary=`需决定：围绕「${goal.objective}」确认本次下一步。已有依据：${facts.length?facts.map(c=>c.summary).join('；'):docs.length?'已读取关联项目资料；尚无可独立核实的新结论。':'本次未取得关联项目正文。'}`.slice(0,350);
  const item=reviewCandidateSchema.parse({key:`meeting-prep:${hashReview(`${goal.id}:${event.id}:${event.eventStartAt}`).slice(0,48)}`,kind:'event',title:`会前准备：${event.title}`.slice(0,100),summary,why:'你已关联这个目标与会议，现在进入会前30分钟。',action:`核对「${goal.objective}」本次要决定的一件事。`.slice(0,160),unknown:facts.map(c=>c.unknown).filter(Boolean).join('；').slice(0,180)||'会议议程、准备是否充分仍需本人核对。',evidenceIds:[...new Set([event.id,...docs.map(e=>e.id),...facts.flatMap(c=>c.evidenceIds)])],priority:'normal',confidence:'inferred',eventStartAt:event.eventStartAt,...(event.eventEndAt?{eventEndAt:event.eventEndAt}:{})});
  // The general model validator treats every occurrence of “deadline” in an
  // event title as a calendar deadline claim. Here title and goal are exact
  // user/source names, and all generated facts were separately validated;
  // assert the stronger, explicit source boundary instead of that heuristic.
  if(item.evidenceIds[0]!==event.id||item.evidenceIds.some(id=>id!==event.id&&!ids.has(id)))throw Error('会前准备引用超出目标项目');
  prepared.push(item);
 }return prepared;
}

export function selectMeetingPreparation(ledger,keys,{scopeKey,now}){
 return ledger.filter(i=>i.scopeKey===scopeKey&&keys.includes(i.key)&&i.status==='open'&&!i.notifications.includes(`meeting:${i.eventStartAt}`)&&Date.parse(i.eventStartAt)>Date.parse(now)).slice(0,1).map(item=>({item,reason:`meeting:${item.eventStartAt}`}));
}
