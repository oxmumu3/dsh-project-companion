import {z} from 'zod';
import {createHash} from 'node:crypto';
import {isAbsolute} from 'node:path';

const hash=z.string().regex(/^[a-f0-9]{64}$/),instant=z.string().datetime();
export const reviewOriginSchema=z.object({itemId:z.string().regex(/^review_[a-f0-9]{32}$/),scopeKey:hash,grantScopeKey:hash,revision:z.number().int().positive()}).strict();
export const reviewExecutionSchema=z.object({jobId:z.string().min(1).max(200),projectRoot:z.string().max(4096).refine(isAbsolute),status:z.enum(['in_progress','ready_for_review','blocked','unknown']),itemRevision:z.number().int().positive(),createdAt:instant,finishedAt:instant.nullable()}).strict();
const executionLabels={in_progress:'交办已记录，等待执行结果',ready_for_review:'执行回复已准备好，待你验收',blocked:'本次执行未完成，请核对原交办',unknown:'本次执行状态不确定，不会自动重派'};
export const reviewOrigin=item=>reviewOriginSchema.parse({itemId:item.id,scopeKey:item.scopeKey,grantScopeKey:item.grantScopeKey,revision:item.revision});

// This artifact reorganizes only the saved, already validated item. It performs
// no new query or model call and cannot turn its suggested action into consent.
export function prepareReviewContinuation(item){
 const sources=item.evidence.map(({source,title,at,url,contentState})=>({source,title,at:at??null,url:url??null,contentState:contentState??null}));
 const execution=item.execution?{...item.execution,label:executionLabels[item.execution.status],outdated:item.execution.itemRevision!==item.revision}:null;
 const preparation={summary:item.summary,reason:item.why,nextStep:item.action,unknown:item.unknown||'后续执行与业务结果仍需核对。',dueAt:item.dueAt??null,dueAtBasis:item.dueAtBasis??null,sources};
 const text=[`个人回顾「${item.title}」的下一步`,`已知：${preparation.summary}`,`建议先做：${preparation.nextStep}`,`待核对：${preparation.unknown}`,item.dueAt?`${item.dueAtBasis==='relative'?'估算期限（请核对原文）':'原来源时间'}：${item.dueAt}`:'未从来源确认截止时间，不另行推算。',...sources.slice(0,4).map(s=>`依据：${s.title}${s.at?` · ${s.at}`:''}${s.url?` ${s.url}`:''}`),execution?`${execution.label}。${execution.outdated?'执行依据是旧版事项，请先核对新变化。':''}`:'尚无关联交办。','本次仅整理已保存资料，没有派工、发送或建立计划。'].join('\n\n');
 return{status:'prepared',itemId:item.id,revision:item.revision,title:item.title,preparation,execution,text};
}

const known=new Set(['prepared','admitted','running','not_admitted','unknown','discarded','mixed','completed','blocked','aborted','error','max-tokens','interrupted','forked','no_text','expired']);
export function mergeReviewExecutions(items,executions,scope,now){
 const result=structuredClone(items);
 if(!Array.isArray(executions)||executions.length>50)return result;
 for(const row of executions){
  const parsed=reviewOriginSchema.safeParse(row?.reviewOrigin),created=Date.parse(row?.createdAt),finished=row?.finishedAt===null?null:Date.parse(row?.finishedAt);
  if(!parsed.success||row.originSessionId!==scope.caller.sessionId||!scope.projects.includes(row.projectRoot)||!known.has(row.status)||!Number.isFinite(created)||created>now.getTime()||finished!==null&&(!Number.isFinite(finished)||finished<created||finished>now.getTime()))continue;
  const ref=parsed.data;if(ref.grantScopeKey!==createHash('sha256').update(JSON.stringify({key:scope.key,grant:scope.grant})).digest('hex'))continue;
  const item=result.find(i=>i.id===ref.itemId&&i.scopeKey===scope.key&&i.grantScopeKey===ref.grantScopeKey&&i.scopeKey===ref.scopeKey&&ref.revision<=i.revision);
  if(!item||created<Date.parse(item.firstSeenAt)||item.execution&&Date.parse(item.execution.createdAt)>created)continue;
  const status=['prepared','admitted','running'].includes(row.status)?'in_progress':row.status==='completed'&&finished!==null?'ready_for_review':['unknown','mixed','forked','expired'].includes(row.status)?'unknown':'blocked';
  const projection=reviewExecutionSchema.safeParse({jobId:row.id,projectRoot:row.projectRoot,status,itemRevision:ref.revision,createdAt:row.createdAt,finishedAt:row.finishedAt});
  if(projection.success)item.execution=projection.data;
 }
 return result;
}
