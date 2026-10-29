import {safeValidationDiagnostic,validateProjectUpdateSummary,safeModelRunDiagnostic} from './project-update-model.js';
const CODES=new Set(['MODEL_INVALID_OUTPUT','MODEL_INVALID_INPUT','MODEL_UNAVAILABLE','MODEL_REQUEST_FAILED','MODEL_TIMEOUT','MODEL_INCOMPLETE','MODEL_OUTPUT_LIMIT','MODEL_TOOL_OUTPUT','MODEL_TOKEN_LIMIT','MODEL_SOURCES_UNAVAILABLE']);
const reject=()=>{throw Error('SUMMARY_CHECK_UNAVAILABLE');};
// Fixed synthetic fixtures only. No owner cwd, account material or history is used.
function fixture(){return{project:{label:'合成项目'},sources:[
 {sourceId:'file:probe-progress',label:'progress.md',role:'progress_file',status:'ok',text:'界面改造已完成。记录显示测试者已确认手机收到一次提醒。个人资料简报仍未验收，下一步需要检查来源读取与整理格式。',at:'2026-10-20T12:00:00.000Z',truncated:false},
 {sourceId:'file:probe-note',label:'context',role:'file',status:'ok',text:'这是一条完全合成的产品研究笔记。优先复用已有能力，把变化、阻塞和下一步说明白。',at:'2026-10-20T12:00:00.000Z',truncated:false},
 {sourceId:'coverage:probe-calendar',label:'memory coverage',role:'coverage',status:'ok',text:'calendar 本次限定查询没有返回匹配项，不代表整个账号没有内容。',at:'2026-10-20T12:00:00.000Z',truncated:false}
],previous:null};}
function complexFixture(){
 const at='2026-10-20T12:00:00.000Z';
 const row=(sourceId,text,{label='context',role='file',status='ok',truncated=false}={})=>({sourceId,label,role,status,text,at,truncated});
 const history=Array.from({length:80},(_,i)=>`合成历史记录 ${i+1}：样例团队完成了本轮界面草图与本地自动测试，但手机回传与连续运行仍待人工验收。本条仅描述当时记录，不代表当前状态，也不代表整体功能已完成。`).join('\n');
 return{project:{label:'合成五来源项目'},sources:[
  row('memory:probe-objective','整理样例项目的新变化、阻塞和下一步。不要发送消息或建立计划。',{label:'goal',role:'user'}),
  row('coverage:probe-gmail','gmail 读取未完成，相关内容未知。',{label:'memory coverage',role:'coverage',status:'unavailable'}),
  row('file:probe-calendar-1','合成日历：产品讨论会，2026-10-20 16:00–17:00，America/Mexico_City。讨论样例界面。只返回限定时间窗中的两条。',{truncated:true}),
  row('file:probe-calendar-2','合成日历：设计评审，2026-10-20 17:00–18:00，America/Mexico_City。评审样例原型。',{truncated:true}),
  row('coverage:probe-drive','drive 本次限定查询没有返回匹配项，不代表整个账号没有内容。',{label:'memory coverage',role:'coverage'}),
  row('file:probe-flomo-1','合成笔记：值得研究如何把复杂资料整理成简单的下一步。本条是早期想法，未记录具体实施。'),
  row('file:probe-flomo-2','合成笔记：体验需要同时说明变化、来源和未知。旧笔记不能证明近期交付。'),
  row('file:probe-dida-1','合成清单：样例项目。仅返回清单名称，未展开清单内任务。',{truncated:true}),
  row('file:probe-dida-2','合成清单：样例日常。仅返回清单名称，未展开清单内任务。',{truncated:true}),
  row('file:probe-progress',`当前合成进展：来源接通与模型整理需要分开检查。两条日历、两条笔记、两个清单已提供；邮件读取未完成，云盘本次没有匹配项。下面是历史记录。\n${history}\n最新合成记录：手机闭环仍待测试者确认，不能从历史完成记录推出当前已验收。`,{label:'progress.md',role:'progress_file'}),
  row('file:probe-context','合成项目背景：使用已授权资料形成有来源的项目简报，用户明确交办后由项目处理。资料范围、交办和主动跟进分别受授权约束。未提供的私人背景均为未知。',{label:'context.md',role:'context_file'}),
  row('file:probe-readme','合成产品说明：可按明确范围整理资料，也可按明确要求检查公开样例文件；没有新增提醒或周期计划。功能说明不是本次验证记录。',{label:'README.md',role:'product_documentation'}),
  row('memory:probe-decision','样例决策：复用现有能力，简报要简短并保留未知；目前不扩展任何新权限。',{label:'decision',role:'user'})
 ],previous:null};
}
/** One native Owner-requested synthetic call. Never reads or mutates a source. */
export function createContextSummaryProbe({summarize,guard,timeoutMs=60000}={}){
 let closed=false,active=null;
 return{
  async check(input){
   if(closed||active||typeof summarize!=='function'||!Number.isFinite(timeoutMs)||timeoutMs<=0||timeoutMs>60000)reject();
   if(input?.preset!==undefined&&!['basic','five_source_complex'].includes(input.preset))reject();
   const controller=new AbortController(),signal=controller.signal;active=controller;
   const timer=setTimeout(()=>controller.abort(),timeoutMs);
   const bounded=fn=>new Promise((resolve,rejectPromise)=>{
    if(signal.aborted){rejectPromise(Error('cancelled'));return;}
    const stop=()=>rejectPromise(Error('cancelled'));signal.addEventListener('abort',stop,{once:true});
    Promise.resolve().then(()=>{if(signal.aborted)reject();return fn();}).then(value=>{signal.removeEventListener('abort',stop);if(signal.aborted)rejectPromise(Error('cancelled'));else resolve(value);},error=>{signal.removeEventListener('abort',stop);rejectPromise(error);});
   });
   const check=async()=>{if(closed||signal.aborted)reject();await bounded(()=>guard(input));if(closed||signal.aborted)reject();};
   try{
    await check();const synthetic=input?.preset==='five_source_complex'?complexFixture():fixture();let result;
    try{
     const answer=await bounded(()=>summarize({...synthetic,signal,beforeRequest:check}));
     const value=validateProjectUpdateSummary(answer,synthetic.sources);
     result={summaryAvailable:true,synthetic:true,counts:Object.fromEntries(['changes','blockers','nextSteps'].map(k=>[k,value[k].length]))};
    }catch(error){const diagnostic=safeModelRunDiagnostic(error?.modelRunDiagnostic);result={summaryAvailable:false,synthetic:true,code:CODES.has(error?.code)?error.code:'MODEL_REQUEST_FAILED',...(error?.code==='MODEL_INVALID_OUTPUT'?{validationDiagnostic:safeValidationDiagnostic(error.validationDiagnostic)}:{}),...(diagnostic?{modelRunDiagnostic:diagnostic}:{})};}
    await check();return result;
   }finally{clearTimeout(timer);controller.abort();if(active===controller)active=null;}
  },
  close(){closed=true;active?.abort();}
 };
}
