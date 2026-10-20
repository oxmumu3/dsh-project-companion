import {randomUUID} from 'node:crypto';
import {isAbsolute,resolve} from 'node:path';
import {createUserMessage} from '@deepseek-ai/dsh-llm';
import {safeProjectRoot} from './sources.js';

/** Read the committed official directory projection; header is only a compatibility fallback. */
export function effectiveCwd(ctx,subject){
  const session=subject?.session??subject;
  if(!session)return null;
  const directory=subject?.ctx?.get?.('workingDirectory')??ctx.get('workingDirectory');
  const value=typeof directory?.get==='function'?directory.get(session):session.header?.cwd;
  return typeof value==='string'&&isAbsolute(value)?resolve(value):null;
}

const clean=error=>String(error?.message??error).replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,200);
const blocked=text=>({status:'blocked',accepted:false,text});
const lifecycleNotice='本次恢复或新建会话由项目助理插件拥有；卸载插件会停止该会话。';
const sameBinding=(left,right)=>typeof left?.userHash==='string'&&/^[a-f0-9]{64}$/.test(left.userHash)&&left.userHash===right?.userHash&&(left.botHash??null)===(right?.botHash??null);

function sessionView(ctx,target){
  let values;
  try{values=ctx.get('sessionProjections')?.snapshot?.(target.session,['sessionListMetadata','title'])?.values;}catch{}
  const metadata=values?.sessionListMetadata;
  const valid=metadata&&typeof metadata.blank==='boolean'&&(metadata.lastPromptAt===null||(typeof metadata.lastPromptAt==='number'&&Number.isFinite(metadata.lastPromptAt)));
  const title=typeof values?.title==='string'?values.title.replace(/[\u0000-\u001f\u007f]/g,' ').trim().replace(/\s+/g,' '):'';
  return{target,blank:valid?metadata.blank:null,title};
}
const displayTitle=title=>title.length>120?`${title.slice(0,119)}…`:title||'未命名会话';
const candidates=views=>views.map(({target,title})=>({sessionId:String(target.id),title:displayTitle(title),status:target.status}));
function ambiguous(project,views){
  const choices=candidates(views);
  return{status:'ambiguous',accepted:false,projectId:project.id,candidates:choices,text:`「${project.label}」有多个可选会话。尚未提交，请告诉我想继续第几段或哪个会话标题：\n${choices.map((choice,index)=>`${index+1}. ${choice.title}`).join('\n')}`};
}
const currentSession=(project,task)=>({status:'current_session',accepted:false,projectId:project.id,task,text:`「${project.label}」就是当前会话的有效项目目录，请在当前会话直接继续这项任务；无需再次发送或唤醒自己。`});

/** Native scoped composition, matching the GUI/bridge precedence without changing global defaults. */
async function setupAgent(agentCtx,agent){
  const presets=agentCtx.get('agentPresets');
  if(typeof presets?.mount!=='function')throw new Error('宿主没有可用的原生会话预设');
  await presets.mount(agentCtx,agent.session.header.agentPreset);
  const logged=agent.session.requestHeader?.()?.config;
  const defaults=agentCtx.get('agentDefaultModel')?.currentSelection?.();
  const selected=logged?.provider&&logged?.model?logged:defaults;
  if(typeof selected?.provider!=='string'||!selected.provider||typeof selected?.model!=='string'||!selected.model)throw new Error('会话和宿主都没有可用的默认模型配置');
  const route={provider:selected.provider,model:selected.model,...(typeof selected.reasoningEffort==='string'?{reasoningEffort:selected.reasoningEffort}:{})};
  agentCtx.on('system-prompt/assemble',async(_assembly,_context,next)=>{
    const assembled=await next();return{...assembled,variables:{...assembled.variables,provider:route.provider,model:route.model}};
  });
  agentCtx.on('agent/request',async(_payload,next)=>{
    const {reasoningEffort:_inheritedEffort,...base}=await next();
    return{...base,...route};
  });
}

export function createCoordinator({ctx,service,owner,liveAgents,taskResults,readBinding=async()=>null,lifecycleSignal}){
  const pending=new Map();const handles=new Set();const lifecycle=new AbortController();
  ctx.effect(()=>async()=>{
    lifecycle.abort(new Error('Project companion unloaded'));
    await Promise.allSettled([...handles].map(handle=>handle.dispose()));handles.clear();
  });
  const signalFor=signal=>AbortSignal.any([lifecycle.signal,...(lifecycleSignal?[lifecycleSignal]:[]),...(signal?[signal]:[])]);
  const withinProject=(agent,project)=>project.sessionIds.includes(String(agent.id))&&effectiveCwd(ctx,agent)===project.root&&agent.session?.header?.origin!=='subagent';
  async function trustedRoute(project,agent,trusted,signal){
    if(!trusted)return true;
    signal.throwIfAborted();
    if(owner(agent).sessionId!==trusted.originSessionId)return false;
    const current=await service.coordinationTarget(project.id);
    if(!current||current.root!==project.root||!current.sessionIds.includes(trusted.sessionId))return false;
    let binding;try{binding=await readBinding(trusted.originSessionId);}catch{return false;}
    signal.throwIfAborted();
    return sameBinding(binding,trusted.binding);
  }
  async function submit(target,project,task,signal,{cold=false,agent,callId,trusted,retainHandle=()=>{}}={}){
    signal.throwIfAborted();
    if(!await trustedRoute(project,agent,trusted,signal))return blocked('上次交办的项目会话或原微信绑定已变化，尚未提交；请重新选定目标会话。');
    if(target.status!=='idle')return{status:'busy',accepted:false,text:`「${project.label}」正在处理其他任务。尚未提交，不会打断；等它空闲后再继续。`};
    if(typeof target.followup!=='function')return blocked(`「${project.label}」的会话暂时不能接收任务，请先在电脑上检查该会话。`);
    const message=createUserMessage({content:[{type:'text',text:task}],source:{kind:'user'}});
    let job;
    if(taskResults){
      if(typeof callId!=='string'||!callId)return blocked('宿主未提供这次工具调用的身份，尚未提交任务。');
      let returnBinding=null;
      try{returnBinding=await readBinding(owner(agent).sessionId);}catch{}
      signal.throwIfAborted();
      if(trusted&&!sameBinding(returnBinding,trusted.binding))return blocked('原微信绑定已经变化，尚未提交任务。');
      const prepared=await taskResults.prepare({originSessionId:owner(agent).sessionId,originToolCallId:callId,targetSessionId:String(target.id),targetMessageId:String(message.id),projectRoot:project.root,projectLabel:project.label,task,returnBinding});
      job=prepared.job;
      // A duplicate may refer to an earlier admission; do not stop that restored work.
      if(prepared.duplicate){retainHandle();return{status:'duplicate',accepted:false,text:'这次交办已经记录，不会重复提交；可以查询最近交办状态。'};}
      let routeUnchanged=false;
      try{routeUnchanged=await trustedRoute(project,agent,trusted,signal);}catch{}
      if(!routeUnchanged){await taskResults.notAdmitted(job.id,{uncertain:false});return blocked('原微信绑定或项目目标已变化，尚未提交任务。');}
    }
    // Durable preparation and route checks yield; the final target gate is synchronous.
    let projectAllowed=false;
    try{projectAllowed=service.canCoordinate?.({projectId:project.id,projectRoot:project.root,sessionId:String(target.id)})===true;}catch{}
    if(!projectAllowed||signal.aborted||effectiveCwd(ctx,target)!==project.root||target.session?.header?.origin==='subagent'||ctx.get('agents')?.get?.(String(target.id))!==target){
      if(job)await taskResults.notAdmitted(job.id,{uncertain:false});
      return blocked('目标会话或插件状态已变化，尚未提交任务。');
    }
    if(target.status!=='idle'){
      if(job)await taskResults.notAdmitted(job.id,{uncertain:false});
      return{status:'busy',accepted:false,text:`「${project.label}」正在处理其他任务。尚未提交，不会打断；等它空闲后再继续。`};
    }
    // No await between the final status check and official synchronous inbox admission.
    try{retainHandle();target.followup(message);}catch{
      if(job)await taskResults.notAdmitted(job.id,{uncertain:true});
      return blocked('目标会话的接收结果不确定，已停止自动重试；可以查询最近交办状态。');
    }
    if(job){try{await taskResults.admitted(job.id);}catch{return{status:'uncertain',accepted:false,text:'任务已经提交，但接收记录未能确认。不会重复派工，请查询最近交办状态。'};}}
    return{status:'accepted',accepted:true,projectId:project.id,sessionId:String(target.id),messageId:String(message.id),...(cold?{lifecycle:lifecycleNotice}:{}),text:`已把任务交给「${project.label}」的空闲会话。目标已接收，这还不是任务完成证明。${job?'已记录本次交办；执行回复返回后仍待验收。':''}${cold?lifecycleNotice:''}`};
  }
  async function coordinateNow(agent,reference,task,signal,meta,selector){
    signal.throwIfAborted();
    let project=await service.coordinationTarget(reference);
    if(!project){await service.act(owner(agent),{action:'watch',project:reference});project=await service.coordinationTarget(reference);}
    if(!project)return blocked('暂时找不到这个已知项目，请补充项目名称。');
    if(selector===undefined&&effectiveCwd(ctx,agent)===project.root)return currentSession(project,task);
    // Refresh host-known live session membership, then re-read under this project's lock.
    if(liveAgents(ctx).some(target=>effectiveCwd(ctx,target)===project.root))await service.act(owner(agent),{action:'watch',project:project.root});
    project=await service.coordinationTarget(project.id);
    if(!project)return blocked('这个项目已取消关注，尚未提交任务。');
    let live=liveAgents(ctx).filter(target=>withinProject(target,project));
    if(selector!==undefined){
      const views=live.map(target=>sessionView(ctx,target));
      const matches=views.filter(view=>String(view.target.id)===selector||(view.title&&view.title===selector)).filter((view,index,all)=>all.findIndex(other=>String(other.target.id)===String(view.target.id))===index);
      if(matches.length>1)return ambiguous(project,matches);
      if(!matches.length)return{...blocked(`「${project.label}」当前没有匹配这个会话标题的可用会话。尚未提交；请告诉我这个项目中想继续的准确会话标题。`),projectId:project.id,candidates:candidates(views)};
      if(String(matches[0].target.id)===String(agent.id))return currentSession(project,task);
      return submit(matches[0].target,project,task,signal,{agent,...meta});
    }
    let trusted=null;
    if(project.sessionIds.length>1&&typeof taskResults?.trustedLastTarget==='function'){
      const originSessionId=owner(agent).sessionId;
      let binding,prior;
      try{binding=await readBinding(originSessionId);prior=await taskResults.trustedLastTarget({originSessionId,projectRoot:project.root,returnBinding:binding});}catch{}
      signal.throwIfAborted();
      if(prior){
        if(typeof prior.targetSessionId!=='string'||!project.sessionIds.includes(prior.targetSessionId))return blocked('上次交办的目标已不属于这个项目，尚未提交；请重新选定目标会话。');
        trusted={sessionId:prior.targetSessionId,originSessionId,binding};
        if(!await trustedRoute(project,agent,trusted,signal))return blocked('原微信绑定或项目目标已变化，尚未提交；请重新选定目标会话。');
        const target=ctx.get('agents')?.get?.(trusted.sessionId);
        if(target){
          if(!withinProject(target,project))return blocked('上次交办的目标目录或会话身份已变化，尚未提交任务。');
          return submit(target,project,task,signal,{agent,...meta,trusted});
        }
      }
    }
    const idle=trusted?[]:live.filter(target=>target.status==='idle');
    if(idle.length>1){
      const views=idle.map(target=>sessionView(ctx,target));
      const used=views.filter(view=>view.blank===false);
      if(used.length===1&&views.every(view=>view===used[0]||view.blank===true))return submit(used[0].target,project,task,signal,{agent,...meta});
      return ambiguous(project,views);
    }
    if(idle.length===1)return submit(idle[0],project,task,signal,{agent,...meta});
    if(!trusted&&live.length)return{status:'busy',accepted:false,text:`「${project.label}」正在处理其他任务。尚未提交，不会打断；等它空闲后再继续。`};
    // A matching live id in another directory must never be replaced or resumed over.
    if((trusted?[trusted.sessionId]:project.sessionIds).some(id=>ctx.get('agents')?.get?.(id)))return blocked(`「${project.label}」的已知会话当前位于另一个目录或属于子任务，尚未提交；请先核对目标会话。`);
    const ids=trusted?[trusted.sessionId]:[...new Set(project.sessionIds)];
    if(ids.length>1)return{status:'ambiguous',accepted:false,text:`「${project.label}」有多个历史会话，暂时无法唯一确定要恢复哪一个。请先选定对应会话，我再继续。`};
    const agents=ctx.get('agents');const presets=ctx.get('agentPresets');
    if(typeof presets?.mount!=='function'||typeof agents?.[ids.length?'resume':'create']!=='function'||(ids.length&&!ctx.get('sessionPersistence')))return blocked(`「${project.label}」尚未载入，宿主缺少安全恢复所需的原生会话配置。请先在电脑上打开这个项目；尚未提交任务。`);
    await safeProjectRoot(project.root);signal.throwIfAborted();
    let handle;let retained=false;
    const release=async()=>{if(handle){handles.delete(handle);await handle.dispose().catch(()=>{});}};
    try{
      if(!await trustedRoute(project,agent,trusted,signal))throw new Error('原微信绑定或项目目标已变化');
      const setup=async(agentCtx,restored)=>{
        signal.throwIfAborted();
        if((ids.length&&String(restored?.id)!==ids[0])||effectiveCwd(ctx,restored)!==project.root||restored?.session?.header?.origin==='subagent')throw new Error('恢复的会话身份或目录与目标项目不一致');
        if(!await trustedRoute(project,agent,trusted,signal))throw new Error('原微信绑定或项目目标已变化');
        await setupAgent(agentCtx,restored);
      };
      handle=ids.length
        ?await agents.resume({resumeSessionId:ids[0],setup,signal})
        :await agents.create({sessionId:`session-${randomUUID()}`,meta:{cwd:project.root,...(presets.defaultId?{agentPreset:presets.defaultId}:{})},setup,signal});
      handles.add(handle);signal.throwIfAborted();
      if(!handle?.agent||String(handle.agent.id)!==String(ids[0]??handle.agent.id)||effectiveCwd(ctx,handle.agent)!==project.root||handle.agent.session?.header?.origin==='subagent')throw new Error('恢复后的会话目录或身份与目标项目不一致');
      if(!await trustedRoute(project,agent,trusted,signal))throw new Error('原微信绑定或项目目标已变化，未提交任务');
      // A trusted restore is already a member; re-watching could undo a concurrent unwatch.
      if(!trusted)await service.act(owner(agent),{action:'watch',project:project.root});
      const workspace=await ctx.get('workspaceRegistry')?.resolveByPath?.(project.root);
      // Workspace accounting belongs to the original project; changing the effective
      // directory must not reassign the persisted session to a different workspace.
      const original=handle.agent.session?.header?.cwd;
      if(typeof original==='string'&&isAbsolute(original)&&resolve(original)===project.root&&typeof workspace?.attachSession==='function')await workspace.attachSession(String(handle.agent.id));
      signal.throwIfAborted();
      // Revalidate after asynchronous mounting/accounting and before task admission.
      if(effectiveCwd(ctx,handle.agent)!==project.root)throw new Error('会话目录已经变化，未提交任务');
      if(!await trustedRoute(project,agent,trusted,signal))throw new Error('原微信绑定或项目目标已变化，未提交任务');
      const result=await submit(handle.agent,project,task,signal,{cold:true,agent,...meta,trusted,retainHandle:()=>{retained=true;}});
      if(!retained)await release();
      return result;
    }catch(error){
      if(retained)return blocked('目标会话的接收结果不确定，已保留会话并停止自动重试；可以查询最近交办状态。');
      await release();
      return blocked(`「${project.label}」暂时无法恢复或创建可用会话：${clean(error)}。尚未提交任务，也没有创建替代会话。`);
    }
  }
  return async function coordinate(agent,input,callerSignal,meta={}){
    if(input.userRequested!==true)return blocked('只有你明确要求执行或继续一项任务，我才会派给项目会话；查询进度不会派工。');
    if(typeof input.task!=='string'||!input.task.trim()||input.task.length>2000)return blocked('请告诉我希望项目继续做的具体任务，长度不超过2000字。');
    if(input.session!==undefined&&(typeof input.session!=='string'||!input.session.trim()||input.session.length>500))return blocked('请告诉我想继续的准确会话标题。');
    const signal=signalFor(callerSignal);
    try{
      owner(agent); // Reject agentless calls before loading or composing a cold session.
      const reference=input.project??owner(agent).cwd;
      let project=await service.coordinationTarget(reference);
      if(!project){signal.throwIfAborted();await service.act(owner(agent),{action:'watch',project:reference});project=await service.coordinationTarget(reference);}
      if(!project)return blocked('暂时找不到这个已知项目，请补充项目名称。');
      // Serializing admission also prevents two cold requests from creating duplicate sessions.
      const key=project.root;
      const previous=pending.get(key)??Promise.resolve();
      const run=previous.catch(()=>{}).then(()=>coordinateNow(agent,project.id,input.task.trim(),signal,meta,input.session?.trim().replace(/\s+/g,' ')));
      pending.set(key,run);
      try{return await run;}finally{if(pending.get(key)===run)pending.delete(key);}
    }catch(error){return blocked(clean(error));}
  };
}
