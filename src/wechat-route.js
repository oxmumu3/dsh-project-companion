import {createHash} from 'node:crypto';

const hash=value=>createHash('sha256').update(value).digest('hex');
const identity=value=>typeof value==='string'&&value.length>0&&value.length<=4096;
const maximumBytes=64*1024;

async function readStatus(response){
  if(!response?.ok||response.redirected)return null;
  const length=response.headers?.get?.('content-length');
  if(length&&(!/^\d+$/.test(length)||Number(length)>maximumBytes))return null;
  const reader=response.body?.getReader?.();
  if(!reader)return null;
  const chunks=[];let size=0;
  try{
    while(true){
      const {done,value}=await reader.read();if(done)break;
      size+=value.byteLength;if(size>maximumBytes)return null;
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks,size).toString('utf8'));
  }finally{void reader.cancel().catch(()=>{});}
}

/** A failed lookup is unknown, never evidence that a session is unbound. */
export async function readWechatRoute(ctx,sessionId,{fetch=globalThis.fetch}={}){
  const unknown=()=>({kind:'unknown'});
  let timeout;const controller=new AbortController();
  try{
    if(!identity(sessionId)||typeof fetch!=='function')return unknown();
    const origin=await ctx.get('webServer')?.getOrigin?.();
    if(typeof origin!=='string')return unknown();
    const url=new URL(origin);
    if(!['http:','https:'].includes(url.protocol)||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)return unknown();
    const deadline=new Promise(resolve=>{timeout=setTimeout(()=>{controller.abort();resolve(unknown());},2000);});
    const result=await Promise.race([(async()=>{
      const response=await fetch(new URL('/wechat/api/status',url),{method:'GET',redirect:'error',signal:controller.signal});
      const status=await readStatus(response);
      if(!status||!Array.isArray(status.users)||![0,1].includes(status.userCount)||status.users.length!==status.userCount)return unknown();
      if(status.botId!==undefined&&status.botId!==null&&!identity(status.botId))return unknown();
      if(status.userCount===0)return{kind:'unbound'};
      const user=status.users[0];
      if(!identity(user?.userId)||!identity(user.sessionId))return unknown();
      if(user.sessionId!==sessionId)return{kind:'unbound'};
      return{kind:'bound',binding:{userHash:hash(user.userId),...(identity(status.botId)?{botHash:hash(status.botId)}:{})}};
    })(),deadline]);
    return result;
  }catch{return unknown();}
  finally{if(timeout!==undefined)clearTimeout(timeout);controller.abort();}
}

/** Backwards-compatible single-user route; never returns raw identities. */
export async function readWechatBinding(ctx,sessionId,options){
  const route=await readWechatRoute(ctx,sessionId,options);
  return route.kind==='bound'?route.binding:null;
}

/** Sanitized setup state. Reads existing state only; never resets login or exposes QR material. */
export async function readWechatSetup(ctx,{fetch=globalThis.fetch}={}){
  const unknown=()=>({state:'unknown'});let timeout;const controller=new AbortController();
  try{
    const origin=await ctx.get('webServer')?.getOrigin?.();if(typeof origin!=='string')return{state:'missing'};
    const url=new URL(origin);
    if(!['http:','https:'].includes(url.protocol)||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)return unknown();
    const deadline=new Promise(resolve=>{timeout=setTimeout(()=>{controller.abort();resolve(unknown());},2000);});
    return await Promise.race([(async()=>{
      const response=await fetch(new URL('/wechat/api/status',url),{method:'GET',redirect:'error',signal:controller.signal});
      if(response.status===404)return{state:'missing'};
      const status=await readStatus(response);
      if(!status||!Array.isArray(status.users)||![0,1].includes(status.userCount)||status.users.length!==status.userCount)return unknown();
      if(status.userCount===1){
        const user=status.users[0];
        if(!identity(user?.userId)||!identity(user.sessionId)||status.phase!=='logged-in'||status.monitorRunning===false)return status.phase==='failed'?{state:'failed'}:unknown();
        if(status.botId!==undefined&&status.botId!==null&&!identity(status.botId))return unknown();
        return{state:'bound',sessionId:user.sessionId,bindingKey:hash(JSON.stringify([user.userId,status.botId??null]))};
      }
      if(status.phase==='logged-in')return{state:'awaiting-message'};
      if(status.phase==='scaned'||status.phase==='scanned')return{state:'scanned'};
      if(status.phase==='failed')return{state:'failed'};
      if(status.phase==='waiting-qr')return{state:'waiting-qr',qrAvailable:identity(status.qrUrl),...(identity(status.qrUrl)?{qrRevision:hash(status.qrUrl).slice(0,16)}:{})};
      return unknown();
    })(),deadline]);
  }catch{return unknown();}
  finally{if(timeout!==undefined)clearTimeout(timeout);controller.abort();}
}
