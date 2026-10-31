const labels={off:'尚未开启定时回顾',paused:'定时回顾已暂停',waiting:'安排已保存，等待下次检查',running:'正在整理这次回顾',stalled:'处理时间超过预期，结果待核对',channel_accepted:'最近一份已交给微信通道',uncertain:'发送结果待核对，不会自动重发',failed:'最近一次回顾未完成',quiet:'最近一次已检查，没有达到提醒门槛的新事项',unknown:'最近一次来源覆盖不完整，不能判断没有变化'};

// Pure display projection. Missing work and unknown delivery never become
// successful execution or phone receipt. It does not retry or alter schedules.
export function reviewRuntimeHealth({subscription,jobs=[],now=new Date()}={}){
 let state=!subscription?'off':subscription.paused?'paused':'waiting',latest=null;
 if(subscription&&!subscription.paused&&now instanceof Date&&Number.isFinite(now.getTime())){
  latest=jobs.filter(j=>Number.isFinite(Date.parse(j.createdAt))&&Date.parse(j.createdAt)>=Date.parse(subscription.createdAt)&&Date.parse(j.createdAt)<=now.getTime()).sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt))[0]??null;
  if(latest){
   const age=now.getTime()-Date.parse(latest.createdAt);
   state=['generating','dispatching'].includes(latest.status)?(age>180000?'stalled':'running'):['reported_sent','queued'].includes(latest.status)?'channel_accepted':latest.status==='uncertain'?'uncertain':latest.status==='quiet'?'quiet':latest.status==='unknown'?'unknown':'failed';
  }
 }
 return{state,label:labels[state],kind:latest?.kind??null,at:latest?.createdAt??null,phoneReceipt:'unverified',retryAllowed:false};
}
