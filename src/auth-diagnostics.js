// Fixed non-sensitive categories only. Never copy provider text or credentials.
const STAGES=new Set(['storage','guard','token_endpoint_http','network','parse','persist','unknown']);
const STATUS=new Set(['400','401','403','429','5xx','other']);
const OAUTH_ERRORS=new Set(['invalid_request','invalid_client','invalid_grant','unauthorized_client','unsupported_grant_type','invalid_scope','access_denied','temporarily_unavailable','server_error']);
export function safeAuthDiagnostic(value){
 if(!value||typeof value!=='object'||!STAGES.has(value.stage))return{stage:'unknown'};
 return{stage:value.stage,...(value.stage==='token_endpoint_http'&&STATUS.has(value.statusClass)?{statusClass:value.statusClass}:{}),...(value.stage==='token_endpoint_http'&&OAUTH_ERRORS.has(value.oauthError)?{oauthError:value.oauthError}:{})};
}
export function statusClass(status){return [400,401,403,429].includes(status)?String(status):status>=500&&status<=599?'5xx':'other';}
export function withAuthDiagnostic(error,diagnostic){
 const safe=error instanceof Error?error:new Error('授权检查未完成。');safe.authDiagnostic=safeAuthDiagnostic(diagnostic);return safe;
}
export async function oauthHttpDiagnostic(response,signal){
 const result={stage:'token_endpoint_http',statusClass:statusClass(response?.status)};
 if(!response?.body?.getReader||signal?.aborted)return result;
 const reader=response.body.getReader(),chunks=[];let size=0;
 try{
  while(true){
   const part=await new Promise((resolve,reject)=>{
    if(signal?.aborted)return reject(new Error('cancelled'));
    const stop=()=>reject(new Error('cancelled'));signal?.addEventListener('abort',stop,{once:true});
    Promise.resolve(reader.read()).then(v=>{signal?.removeEventListener('abort',stop);resolve(v);},e=>{signal?.removeEventListener('abort',stop);reject(e);});
   });
   if(part.done)break;size+=part.value.byteLength;if(size>65536)return result;chunks.push(Buffer.from(part.value));
  }
  const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(OAUTH_ERRORS.has(data?.error))result.oauthError=data.error;
 }catch{}finally{try{void reader.cancel().catch(()=>{});}catch{}try{reader.releaseLock();}catch{}}
 return result;
}
