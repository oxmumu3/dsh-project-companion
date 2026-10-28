import {safeAuthDiagnostic} from './auth-diagnostics.js';
import {safeGoogleAuthAttempt} from './google-auth-attempt.js';
import {createContextSummaryProbe} from './context-summary-probe.js';
import {bindingRevision,matchesBindingRevision} from './workbench-scope.js';
const bound = value => value?.state === 'bound' && typeof value.sessionId === 'string' && value.sessionId.length > 0 && value.sessionId.length <= 200 && /^[a-f0-9]{64}$/.test(value.bindingKey ?? '');
const same = (left, right) => bound(left) && bound(right) && left.sessionId === right.sessionId && left.bindingKey === right.bindingKey;
const invalid = () => { throw new Error('Context 操作未完成，请刷新连接状态。'); };
const sourceIds = new Set(['gmail','calendar','drive','docs','sheets','slides','dida','flomo']);
const readStages=new Set(['scope','build','catalog','call','projection']);
const readErrors=new Set(['CONTEXT_AUTH_REQUIRED','CONTEXT_INSUFFICIENT_SCOPE','CONTEXT_TIMEOUT','CONTEXT_HTTP_ERROR','CONTEXT_PROTOCOL_INVALID','CONTEXT_SCHEMA_MISMATCH','CONTEXT_SCOPE_VIOLATION','CONTEXT_BINDING_CHANGED','CONTEXT_NOT_ENABLED','CONTEXT_STOPPED','CONTEXT_INVALID_INPUT','CONTEXT_UNSUPPORTED_OPERATION','CONTEXT_UNAVAILABLE']);

/** Owner-authenticated native settings facade. GET never resumes or queries a source. */
export function createContextRoute({context,googleAuth,googleCalendarAuth,googleSuiteAuth,flomoAuth,didaAuth,checkGoogleConnection,checkCalendarToken,readConnection,resolveOwner,activateOwner,canRun=async()=>true,isClosed=()=>false,authCheckTimeoutMs=30000,readCheckClock=()=>new Date(),summarizeSynthetic,summaryCheckTimeoutMs=60000}={}){
  let closed=false;
  const connectionChecks=new Set();
  const open=()=>{if(closed||isClosed())invalid();};
  const connection=async()=>{open();try{const value=await readConnection();return bound(value)?{state:'bound',sessionId:value.sessionId,bindingKey:value.bindingKey}:{state:'unknown'};}catch{return{state:'unknown'};}};
  const check=async expected=>{open();if(!same(expected,await connection()))invalid();};
  const summaryProbe=createContextSummaryProbe({summarize:summarizeSynthetic,timeoutMs:summaryCheckTimeoutMs,guard:async input=>{
    open();if(!await canRun())invalid();const expected=await connection();
    if(!bound(expected)||!matchesBindingRevision(input,expected))invalid();
    // The probe must not activate/resume a session just to run a diagnostic.
    const owner=resolveOwner(expected.sessionId);
    if(!owner||owner.sessionId!==expected.sessionId||typeof owner.cwd!=='string'||!owner.cwd.startsWith('/'))invalid();
    await check(expected);if(!await canRun())invalid();
  }});
  async function readyOwner(expected){
    let owner=resolveOwner(expected.sessionId);
    if(!owner&&typeof activateOwner==='function'){
      await activateOwner(expected.sessionId);
      await check(expected);
      owner=resolveOwner(expected.sessionId);
    }
    if(!owner||owner.sessionId!==expected.sessionId||typeof owner.cwd!=='string'||!owner.cwd.startsWith('/'))invalid();
    await check(expected);
    return owner;
  }
  function authStatus(controller=googleAuth){
    const status=controller?.status?.()??{};
    return{clientConfigured:status.clientConfigured===true,refreshConfigured:status.refreshConfigured===true,authInProgress:status.authInProgress===true,...(controller===googleSuiteAuth&&safeGoogleAuthAttempt(status.lastAttempt)?{lastAttempt:safeGoogleAuthAttempt(status.lastAttempt)}:{}),...(typeof status.expiresAt==='string'&&status.expiresAt.length<=40?{expiresAt:status.expiresAt}:{})};
  }
  async function snapshot(){
    const current=await connection();
    const owner=bound(current)?{sessionId:current.sessionId}:null;
    const value=await context.snapshot(owner);
    open();
    const after=await connection();
    if(bindingRevision(current)!==bindingRevision(after))invalid();
    return{bindingRevision:bindingRevision(current),sources:value.sources,googleAuth:authStatus(),...(googleCalendarAuth?{googleCalendarAuth:authStatus(googleCalendarAuth)}:{}),...(googleSuiteAuth?{googleSuiteAuth:{...authStatus(googleSuiteAuth),grantedSources:['gmail','calendar','drive'].filter(source=>googleSuiteAuth.status?.().grantedSources?.includes(source))}}:{}),...(flomoAuth?{flomoAuth:authStatus(flomoAuth)}:{}),...(didaAuth?{didaAuth:authStatus(didaAuth)}:{})};
  }
  async function checkAuthorization(input){
    if(!Number.isFinite(authCheckTimeoutMs)||authCheckTimeoutMs<=0||authCheckTimeoutMs>30000)invalid();
    const controller=new AbortController(),signal=controller.signal,timer=setTimeout(()=>controller.abort(),authCheckTimeoutMs);
    const live=()=>{if(signal.aborted)invalid();};
    const bounded=fn=>new Promise((resolve,reject)=>{
      if(signal.aborted){reject(new Error('cancelled'));return;}
      const stop=()=>reject(new Error('cancelled'));signal.addEventListener('abort',stop,{once:true});
      Promise.resolve().then(()=>{live();return fn();}).then(value=>{signal.removeEventListener('abort',stop);if(signal.aborted)reject(new Error('cancelled'));else resolve(value);},error=>{signal.removeEventListener('abort',stop);reject(error);});
    });
    try{
      if(!await bounded(canRun))invalid();
      const expected=await bounded(connection);live();if(!bound(expected)||!matchesBindingRevision(input,expected))invalid();
      const owner=await bounded(()=>readyOwner(expected)),source=input.source;
      const initial=await bounded(()=>context.snapshot(owner));
      if(!initial.sources?.some(item=>item.id===source&&item.configured===true&&item.enabled===true))invalid();
      await bounded(()=>check(expected));
      const grant=await bounded(()=>context.authorization(owner,[source]));
      const guard=async()=>{
        live();await bounded(()=>check(expected));if(!await bounded(canRun))invalid();
        if(await bounded(()=>context.authorization(owner,[source]))!==grant)invalid();live();
        if(context.assertAuthorization(owner,[source],grant)!==true)invalid();
        await bounded(()=>check(expected));live();return true;
      };
      await guard();
      if(input.action==='check_read'){
        let result,code,stage;
        try{
          let query;
          if(source==='flomo')query={action:'query',source,operation:'search',query:input.query,limit:2,userRequested:true,signal};
          else{const start=new Date(readCheckClock());if(!Number.isFinite(start.getTime()))invalid();const end=new Date(start.getTime()+86400000);if(!Number.isFinite(end.getTime()))invalid();query={action:'query',source,operation:'upcoming',from:start.toISOString(),to:end.toISOString(),limit:2,userRequested:true,signal};}
          const value=await bounded(()=>context.act(owner,query));
          if(value?.source!==source||!Array.isArray(value.items)||typeof value.truncated!=='boolean'){code='CONTEXT_PROTOCOL_INVALID';stage='projection';}
          else if(value.items.length>2){code='CONTEXT_SCOPE_VIOLATION';stage='projection';}
          else result={source,readAvailable:true,returnedCount:value.items.length,truncated:value.truncated};
        }catch(error){code=readErrors.has(error?.code)?error.code:'CONTEXT_UNAVAILABLE';if(readStages.has(error?.readStage))stage=error.readStage;}
        await guard();return result??{source,readAvailable:false,code,...(stage?{stage}:{})};
      }
      let available=false,diagnostic;
      try{
        const settings={signal,authorizeMutation:guard};
        const token=await bounded(()=>source==='calendar'?checkCalendarToken?.(settings):flomoAuth?.getToken?.(settings));
        available=typeof token==='string'&&token.length>0&&token.length<=8192&&!/[\r\n]/u.test(token);
        if(!available)diagnostic={stage:'parse'};
      }catch(error){diagnostic=safeAuthDiagnostic(error?.authDiagnostic);}
      await guard();return{source,tokenAvailable:available,...(!available?{diagnostic}:{})};
    }finally{clearTimeout(timer);controller.abort();}
  }
  return{
    snapshot,
    async action(input){
      open();
      if(!input||typeof input!=='object'||Array.isArray(input))invalid();
      const keys=Object.keys(input).filter(key=>key!=='expectedBindingRevision');
      if(['google_authorize','google_calendar_authorize','google_suite_authorize','flomo_authorize','dida_authorize'].includes(input.action)){
        if(keys.length!==1||!await canRun())invalid();
      }else if(input.action==='check_summary'){
        if(keys.length!==1||typeof input.expectedBindingRevision!=='string')invalid();
      }else if(input.action==='check_authorization'){
        if(keys.length!==2||!keys.includes('source')||!['calendar','flomo'].includes(input.source)||typeof input.expectedBindingRevision!=='string')invalid();
      }else if(input.action==='check_read'){
        if(typeof input.expectedBindingRevision!=='string'||!['calendar','flomo'].includes(input.source)||!keys.includes('source'))invalid();
        if(input.source==='flomo'?(keys.length!==3||input.query!=='DeepSeek'):(keys.length!==2||Object.hasOwn(input,'query')))invalid();
      }else if(!['connect','disconnect'].includes(input.action)||keys.length!==2||!keys.includes('source')||!sourceIds.has(input.source))invalid();
      if(input.action==='connect'&&!await canRun())invalid();
      if(input.action==='check_summary')return summaryProbe.check(input);
      if(['check_authorization','check_read'].includes(input.action))return checkAuthorization(input);
      const expected=await connection();
      if(!bound(expected)||!matchesBindingRevision(input,expected))invalid();
      const owner=await readyOwner(expected);
      if(['google_authorize','google_calendar_authorize','google_suite_authorize','flomo_authorize','dida_authorize'].includes(input.action)){
        if(!await canRun())invalid();
        await check(expected);
        const controller={google_authorize:googleAuth,google_calendar_authorize:googleCalendarAuth,google_suite_authorize:googleSuiteAuth,flomo_authorize:flomoAuth,dida_authorize:didaAuth}[input.action];
        if(typeof controller?.start!=='function')invalid();
        if(input.action==='google_suite_authorize'&&typeof checkGoogleConnection==='function'){
          const checkController=new AbortController();connectionChecks.add(checkController);
          try{if(await checkGoogleConnection({signal:checkController.signal})!==true)invalid();}
          catch(failure){await check(expected);if(!await canRun())invalid();throw failure;}
          finally{connectionChecks.delete(checkController);}
          await check(expected);if(!await canRun())invalid();
        }
        const value=await controller.start({authorizeMutation:async()=>{await check(expected);if(!await canRun())invalid();await check(expected);return true;}});
        await check(expected);
        return{url:value.url,expiresAt:value.expiresAt};
      }
      await context.act(owner,{action:input.action,source:input.source,userRequested:true,expectedBinding:{sessionId:expected.sessionId,bindingKey:expected.bindingKey},authorizeMutation:async()=>{await check(expected);return true;}});
      await check(expected);
      return snapshot();
    },
    close(){closed=true;for(const controller of connectionChecks)controller.abort();connectionChecks.clear();summaryProbe.close();},
  };
}

/** Registration only uses the carrier's authenticated owner connection layer. */
export function registerContextRoute(ctx,adapter){
  const connection=ctx.get('connection');
  if(typeof connection?.fetch?.register!=='function')return null;
  const stop=connection.fetch.register({path:'/api/project_companion/context',methods:['GET','POST'],requestBody:'buffered',async fetch(request){
    const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
    try{
      if(request.method==='GET')return json(await adapter.snapshot());
      if(request.method!=='POST')return json({error:'不支持此方法。'},405);
      if(request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/json')return json({error:'请使用 JSON 请求。'},415);
      const length=request.headers.get('Content-Length');
      if(length&&(!/^\d+$/.test(length)||Number(length)>4096))return json({error:'请求过大。'},413);
      const body=await request.text();
      if(Buffer.byteLength(body)>4096)return json({error:'请求过大。'},413);
      return json(await adapter.action(JSON.parse(body)));
    }catch(error){if(error?.code==='GOOGLE_CONNECTION_UNAVAILABLE')return json({code:'GOOGLE_CONNECTION_UNAVAILABLE',error:'尚未打开 Google 授权：本机暂时连不到授权交换接口。已有连接保留，请稍后再点连接；不会自动重复授权。'},503);return json({error:'未完成连接，请刷新状态后重新登录；未自动重试。'},400);}
  }});
  if(typeof stop==='function'&&typeof ctx.effect==='function')ctx.effect(()=>stop);
  return stop;
}
