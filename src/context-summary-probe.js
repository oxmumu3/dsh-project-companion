import {safeValidationDiagnostic,validateProjectUpdateSummary} from './project-update-model.js';
const CODES=new Set(['MODEL_INVALID_OUTPUT','MODEL_INVALID_INPUT','MODEL_UNAVAILABLE','MODEL_REQUEST_FAILED','MODEL_TIMEOUT','MODEL_INCOMPLETE','MODEL_OUTPUT_LIMIT','MODEL_TOOL_OUTPUT','MODEL_TOKEN_LIMIT','MODEL_SOURCES_UNAVAILABLE']);
const reject=()=>{throw Error('SUMMARY_CHECK_UNAVAILABLE');};
// Fixed synthetic fixtures only. No owner cwd, account material or history is used.
function fixture(){return{project:{label:'合成项目'},sources:[
 {sourceId:'file:probe-progress',label:'progress.md',role:'progress_file',status:'ok',text:'界面改造已完成。记录显示测试者已确认手机收到一次提醒。个人资料简报仍未验收，下一步需要检查来源读取与整理格式。',at:'2026-10-20T12:00:00.000Z',truncated:false},
 {sourceId:'file:probe-note',label:'context',role:'file',status:'ok',text:'这是一条完全合成的产品研究笔记。优先复用已有能力，把变化、阻塞和下一步说明白。',at:'2026-10-20T12:00:00.000Z',truncated:false},
 {sourceId:'coverage:probe-calendar',label:'memory coverage',role:'coverage',status:'ok',text:'calendar 本次限定查询没有返回匹配项，不代表整个账号没有内容。',at:'2026-10-20T12:00:00.000Z',truncated:false}
],previous:null};}
/** One native Owner-requested synthetic call. Never reads or mutates a source. */
export function createContextSummaryProbe({summarize,guard,timeoutMs=60000}={}){
 let closed=false,active=null;
 return{
  async check(input){
   if(closed||active||typeof summarize!=='function'||!Number.isFinite(timeoutMs)||timeoutMs<=0||timeoutMs>60000)reject();
   const controller=new AbortController(),signal=controller.signal;active=controller;
   const timer=setTimeout(()=>controller.abort(),timeoutMs);
   const bounded=fn=>new Promise((resolve,rejectPromise)=>{
    if(signal.aborted){rejectPromise(Error('cancelled'));return;}
    const stop=()=>rejectPromise(Error('cancelled'));signal.addEventListener('abort',stop,{once:true});
    Promise.resolve().then(()=>{if(signal.aborted)reject();return fn();}).then(value=>{signal.removeEventListener('abort',stop);if(signal.aborted)rejectPromise(Error('cancelled'));else resolve(value);},error=>{signal.removeEventListener('abort',stop);rejectPromise(error);});
   });
   const check=async()=>{if(closed||signal.aborted)reject();await bounded(()=>guard(input));if(closed||signal.aborted)reject();};
   try{
    await check();const synthetic=fixture();let result;
    try{
     const answer=await bounded(()=>summarize({...synthetic,signal}));
     const value=validateProjectUpdateSummary(answer,synthetic.sources);
     result={summaryAvailable:true,synthetic:true,counts:Object.fromEntries(['changes','blockers','nextSteps'].map(k=>[k,value[k].length]))};
    }catch(error){result={summaryAvailable:false,synthetic:true,code:CODES.has(error?.code)?error.code:'MODEL_REQUEST_FAILED',...(error?.code==='MODEL_INVALID_OUTPUT'?{validationDiagnostic:safeValidationDiagnostic(error.validationDiagnostic)}:{})};}
    await check();return result;
   }finally{clearTimeout(timer);controller.abort();if(active===controller)active=null;}
  },
  close(){closed=true;active?.abort();}
 };
}
