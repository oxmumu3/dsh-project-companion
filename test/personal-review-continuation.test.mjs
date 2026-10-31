import test from 'node:test';
import assert from 'node:assert/strict';
import {createPersonalReviewService} from '../src/personal-review.js';
import {deriveFamilyPersonalReviewRequest} from '../src/family-personal-review.js';
import {prepareReviewContinuation,mergeReviewExecutions} from '../src/review-continuation.js';

const caller={sessionId:'synthetic-owner',cwd:'/synthetic/origin'},root='/synthetic/project';
const binding='a'.repeat(64),grant='b'.repeat(64),at='2026-10-31T15:00:00.000Z';
const title='核对项目邀请';
async function fixture(){
 let row,allowed=grant,reads=0,executions=[];
 const service=createPersonalReviewService({store:{get:async()=>structuredClone(row),put:async(_k,v)=>{row=structuredClone(v);}},clock:()=>new Date(at),readBinding:async()=>({bound:true,bindingKey:binding}),readBindingSync:()=>({bound:true,bindingKey:binding}),authorization:async()=>allowed,authorizationSync:(_c,_s,_p,g)=>g===allowed,canRun:async()=>true,
  readExecutions:async()=>structuredClone(executions),
  collect:async()=>{reads++;return{evidence:[{id:'mail:1',source:'gmail',title:'Invitation',text:'Please verify access before responding.',at,url:'https://mail.google.com/mail/u/0/#all/synthetic'}],coverage:[{source:'gmail',status:'ok',count:1},{source:'project',status:'ok',count:0}]};},
  summarize:async()=>({items:[{key:'invite',kind:'invitation',title,summary:'收到项目权限邀请，尚未确认角色。',why:'回复前应核对权限。',action:'准备核对清单和回复草稿。',unknown:'邀请角色尚未确认。',evidenceIds:['mail:1'],priority:'high',confidence:'source'}]}),send:async()=>({status:'reported_sent'})});
 await service.act(caller,{action:'preview',sources:['gmail'],projects:[root]});
 return{service,row:()=>row,reads:()=>reads,revoke:()=>{allowed='c'.repeat(64);},executions:v=>{executions=v;}};
}
test('prepare reuses a stable saved item and makes no source read, model call, send or schedule',async()=>{
 const f=await fixture(),item=f.row().items[0],before=f.reads();
 const value=await f.service.act(caller,{action:'prepare',itemTitle:title,userRequested:true,requestId:'prepare-1'});
 assert.equal(value.status,'prepared');assert.equal(value.itemId,item.id);assert.equal(f.reads(),before);assert.equal(f.row().subscription,null);
 assert.match(value.text,/尚未确认|待核对/);assert.match(value.text,/未派工|没有派工/);assert.equal(value.preparation.sources.length,1);assert.equal(value.preparation.dueAt,null);
 assert.equal(f.row().items[0].status,'open');
});
test('handoff lease requires the named saved item, exact allowed project and current authority',async()=>{
 const f=await fixture(),item=f.row().items[0];
 const input={reviewItemId:item.id,project:root,task:`围绕个人回顾「${title}」准备核对清单，不发送。`,userRequested:true};
 const lease=await f.service.handoff(caller,input);
 assert.equal(lease.reference.itemId,item.id);assert.equal(await lease.authorize(),true);assert.equal(lease.authorizeSync(),true);
 f.revoke();assert.equal(lease.authorizeSync(),false);assert.equal(await lease.authorize(),false);lease.dispose();
 await assert.rejects(f.service.handoff(caller,{...input,project:'/synthetic/other'}));
 const g=await fixture();await assert.rejects(g.service.handoff(caller,{...input,task:'Read a different task.'}));
 await assert.rejects(g.service.handoff({...caller,sessionId:'other'},input));
});
test('linked execution becomes ready for review, never handled; duplicate outcomes and source revisions retain identity',async()=>{
 const f=await fixture(),item=f.row().items[0];
 const lease=await f.service.handoff(caller,{reviewItemId:item.id,project:root,task:`个人回顾「${title}」只读准备`,userRequested:true});
 f.executions([{id:'task_synthetic',originSessionId:caller.sessionId,projectRoot:root,reviewOrigin:lease.reference,status:'completed',finishedAt:at,createdAt:at}]);lease.dispose();
 await f.service.act(caller,{action:'prepare',itemId:item.id,userRequested:true,requestId:'result-1'});
 assert.equal(f.row().items[0].execution.status,'ready_for_review');assert.equal(f.row().items[0].status,'open');
 await f.service.act(caller,{action:'prepare',itemId:item.id,userRequested:true,requestId:'result-2'});
 assert.equal(f.row().items[0].execution.jobId,'task_synthetic');
 await f.service.act(caller,{action:'feedback',itemId:item.id,feedback:'handled',userRequested:true,requestId:'handled'});
 await f.service.act(caller,{action:'preview',sources:['gmail'],projects:[root]});
 assert.equal(f.row().items[0].id,item.id);assert.equal(f.row().items[0].status,'handled');
});
test('reconciling an outcome during a fresh run preserves the journaled active job identity',async()=>{
 const f=await fixture(),item=f.row().items[0],lease=await f.service.handoff(caller,{reviewItemId:item.id,project:root,task:`个人回顾「${title}」只读准备`,userRequested:true});
 f.executions([{id:'task_synthetic',originSessionId:caller.sessionId,projectRoot:root,reviewOrigin:lease.reference,status:'completed',finishedAt:at,createdAt:at}]);lease.dispose();
 const result=await f.service.act(caller,{action:'run_now',sources:['gmail'],projects:[root],requestId:'fresh-run',userRequested:true});
 assert.equal(result.status,'reported_sent');assert.equal(f.row().jobs.at(-1).status,'reported_sent');
});
test('wrong-scope, future, out-of-project or foreign execution cannot be associated',async()=>{
 for(const patch of [{originSessionId:'other'},{projectRoot:'/synthetic/other'},{finishedAt:'2027-01-01T00:00:00.000Z'},{reviewOrigin:{itemId:'review_unknown',scopeKey:'a'.repeat(64),grantScopeKey:'b'.repeat(64),revision:1}}]){
  const f=await fixture(),item=f.row().items[0],lease=await f.service.handoff(caller,{reviewItemId:item.id,project:root,task:`个人回顾「${title}」只读准备`,userRequested:true});
  f.executions([{id:'task_synthetic',originSessionId:caller.sessionId,projectRoot:root,reviewOrigin:lease.reference,status:'completed',finishedAt:at,createdAt:at,...patch}]);lease.dispose();
  await f.service.act(caller,{action:'prepare',itemId:item.id,userRequested:true,requestId:'prepare'});assert.equal(f.row().items[0].execution,undefined);
 }
});
test('Family preparation derives the exact title only from current original Owner words',()=>{
 const owner={familySessionId:'family_owner_synthetic',bindingRevision:binding,sourceRequestId:'wechat-'+grant,sourceTimingState:'fresh',sourceTiming:{receivedAt:at,providerCreatedAt:at}};
 const parse=text=>deriveFamilyPersonalReviewRequest({...owner,userText:text},{action:'prepare',activeCallVerified:true,now:new Date(at)});
 assert.equal(parse(`帮我准备个人回顾「${title}」的下一步。`).itemTitle,title);
 for(const text of [`不要帮我准备个人回顾「${title}」的下一步`,`帮我准备个人回顾「${title}」的下一步并发邮件`,`帮我准备个人回顾「${title}」的下一步，读取全部邮件`])assert.throws(()=>parse(text));
});
test('estimated deadlines stay estimated and unclaimed or expired execution never claims progress',async()=>{
 const f=await fixture(),item=f.row().items[0];
 const estimated=prepareReviewContinuation({...item,dueAt:at,dueAtBasis:'relative'});
 assert.match(estimated.text,/估算.*核对|核对.*估算/);assert.doesNotMatch(estimated.text,/原来源时间/);
 const scope=f.row().scope,reviewOrigin={itemId:item.id,scopeKey:item.scopeKey,grantScopeKey:item.grantScopeKey,revision:item.revision};
 for(const status of ['prepared','admitted','expired']){
  const next=mergeReviewExecutions([item],[{id:'task_synthetic',originSessionId:caller.sessionId,projectRoot:root,reviewOrigin,status,createdAt:at,finishedAt:status==='expired'?at:null}],scope,new Date(at))[0];
  const view=prepareReviewContinuation(next);assert.doesNotMatch(view.text,/项目正在处理|执行未完成/);
  assert.equal(view.execution.status,status==='expired'?'unknown':'in_progress');
 }
});
