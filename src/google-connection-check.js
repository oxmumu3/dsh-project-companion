// A click-only reachability check before opening consent. No account data,
// registration fields, tokens, codes, alternate endpoint or proxy overrides.
const unavailable=()=>Object.assign(new Error('Google 授权连接暂不可用。'),{code:'GOOGLE_CONNECTION_UNAVAILABLE'});
export async function checkGoogleConnection({fetch:fetchImpl=globalThis.fetch,signal,timeoutMs=8000}={}){
 const controller=new AbortController(),cancel=()=>controller.abort();
 if(signal?.aborted)cancel();else signal?.addEventListener('abort',cancel,{once:true});
 const timer=setTimeout(cancel,Math.min(8000,Math.max(1,timeoutMs)));
 let abort;
 try{
  if(controller.signal.aborted)throw unavailable();
  const stopped=new Promise((_,reject)=>{abort=()=>reject(unavailable());controller.signal.addEventListener('abort',abort,{once:true});});
  const request=Promise.resolve().then(()=>{
   if(controller.signal.aborted)throw unavailable();
   return fetchImpl('https://oauth2.googleapis.com/token',{method:'GET',redirect:'error',credentials:'omit',signal:controller.signal});
  }).then(response=>{
   try{void response.body?.cancel()?.catch(()=>{});}catch{}
   if(controller.signal.aborted||response.redirected||![400,404,405].includes(response.status))throw unavailable();
   return true;
  });
  return await Promise.race([request,stopped]);
 }catch{throw unavailable();}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);if(abort)controller.signal.removeEventListener('abort',abort);}
}
