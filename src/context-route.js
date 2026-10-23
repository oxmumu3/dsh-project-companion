import {bindingRevision,matchesBindingRevision} from './workbench-scope.js';
const bound = value => value?.state === 'bound' && typeof value.sessionId === 'string' && value.sessionId.length > 0 && value.sessionId.length <= 200 && /^[a-f0-9]{64}$/.test(value.bindingKey ?? '');
const same = (left, right) => bound(left) && bound(right) && left.sessionId === right.sessionId && left.bindingKey === right.bindingKey;
const invalid = () => { throw new Error('Context 操作未完成，请刷新连接状态。'); };
const sourceIds = new Set(['gmail','calendar','drive','docs','sheets','slides','dida','flomo']);

/** Owner-authenticated native settings facade. GET never resumes or queries a source. */
export function createContextRoute({context,googleAuth,googleCalendarAuth,googleSuiteAuth,flomoAuth,didaAuth,readConnection,resolveOwner,activateOwner,canRun=async()=>true,isClosed=()=>false}={}){
  let closed=false;
  const open=()=>{if(closed||isClosed())invalid();};
  const connection=async()=>{open();try{const value=await readConnection();return bound(value)?{state:'bound',sessionId:value.sessionId,bindingKey:value.bindingKey}:{state:'unknown'};}catch{return{state:'unknown'};}};
  const check=async expected=>{open();if(!same(expected,await connection()))invalid();};
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
    return{clientConfigured:status.clientConfigured===true,refreshConfigured:status.refreshConfigured===true,authInProgress:status.authInProgress===true,...(typeof status.expiresAt==='string'&&status.expiresAt.length<=40?{expiresAt:status.expiresAt}:{})};
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
  return{
    snapshot,
    async action(input){
      open();
      if(!input||typeof input!=='object'||Array.isArray(input))invalid();
      const keys=Object.keys(input).filter(key=>key!=='expectedBindingRevision');
      if(['google_authorize','google_calendar_authorize','google_suite_authorize','flomo_authorize','dida_authorize'].includes(input.action)){
        if(keys.length!==1||!await canRun())invalid();
      }else if(!['connect','disconnect'].includes(input.action)||keys.length!==2||!keys.includes('source')||!sourceIds.has(input.source))invalid();
      if(input.action==='connect'&&!await canRun())invalid();
      const expected=await connection();
      if(!bound(expected)||!matchesBindingRevision(input,expected))invalid();
      const owner=await readyOwner(expected);
      if(['google_authorize','google_calendar_authorize','google_suite_authorize','flomo_authorize','dida_authorize'].includes(input.action)){
        if(!await canRun())invalid();
        await check(expected);
        const controller={google_authorize:googleAuth,google_calendar_authorize:googleCalendarAuth,google_suite_authorize:googleSuiteAuth,flomo_authorize:flomoAuth,dida_authorize:didaAuth}[input.action];
        if(typeof controller?.start!=='function')invalid();
        const value=await controller.start({authorizeMutation:async()=>{await check(expected);if(!await canRun())invalid();await check(expected);return true;}});
        await check(expected);
        return{url:value.url,expiresAt:value.expiresAt};
      }
      await context.act(owner,{action:input.action,source:input.source,userRequested:true,expectedBinding:{sessionId:expected.sessionId,bindingKey:expected.bindingKey},authorizeMutation:async()=>{await check(expected);return true;}});
      await check(expected);
      return snapshot();
    },
    close(){closed=true;},
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
    }catch{return json({error:'未完成连接，请刷新状态后重新登录；未自动重试。'},400);}
  }});
  if(typeof stop==='function'&&typeof ctx.effect==='function')ctx.effect(()=>stop);
  return stop;
}
