// Fixed non-sensitive categories only. Never copy provider text or credentials.
const STAGES=new Set(['storage','guard','token_endpoint_http','network','parse','persist','unknown']);
const STATUS=new Set(['400','401','403','429','5xx','other']);
const NETWORK_FAILURES=new Set(['connect_timeout','dns','refused','tls','timeout','other']);
const OAUTH_ERRORS=new Set(['invalid_request','invalid_client','invalid_grant','unauthorized_client','unsupported_grant_type','invalid_scope','access_denied','temporarily_unavailable','server_error']);
export function safeAuthDiagnostic(value){
 if(!value||typeof value!=='object'||!STAGES.has(value.stage))return{stage:'unknown'};
 return{stage:value.stage,...(value.stage==='token_endpoint_http'&&STATUS.has(value.statusClass)?{statusClass:value.statusClass}:{}),...(value.stage==='token_endpoint_http'&&OAUTH_ERRORS.has(value.oauthError)?{oauthError:value.oauthError}:{}),...(value.stage==='network'&&NETWORK_FAILURES.has(value.networkFailure)?{networkFailure:value.networkFailure}:{})};
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

// These codes describe failure before an HTTP request can reach the endpoint.
// Everything else, including a reset or timeout after connection, is not replayable.
const BEFORE_SEND=new Map([['UND_ERR_CONNECT_TIMEOUT','connect_timeout'],['EAI_AGAIN','dns'],['ENOTFOUND','dns'],['ECONNREFUSED','refused']]);
const TLS_CODES=new Set(['CERT_HAS_EXPIRED','ERR_TLS_CERT_ALTNAME_INVALID','DEPTH_ZERO_SELF_SIGNED_CERT','SELF_SIGNED_CERT_IN_CHAIN','UNABLE_TO_VERIFY_LEAF_SIGNATURE','UNABLE_TO_GET_ISSUER_CERT','UNABLE_TO_GET_ISSUER_CERT_LOCALLY','CERT_SIGNATURE_FAILURE','ERR_TLS_CERT_SIGNATURE_ALGORITHM_UNSUPPORTED']);
const TIMEOUT_CODES=new Set(['ETIMEDOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','ABORT_ERR']);
function inspectNetworkFailure(error,depth=0,seen=new Set()){
 const unknown={networkFailure:'other',beforeSend:false};
 if(!error||typeof error!=='object'||depth>=4||seen.has(error))return unknown;
 seen.add(error);
 if(error.name==='AbortError'||error.name==='TimeoutError')return{networkFailure:'timeout',beforeSend:false};
 if(error instanceof AggregateError){
  if(!Array.isArray(error.errors)||!error.errors.length||error.errors.length>8)return unknown;
  const outcomes=error.errors.map(item=>inspectNetworkFailure(item,depth+1,new Set(seen)));
  return{networkFailure:outcomes.every(item=>item.networkFailure===outcomes[0].networkFailure)?outcomes[0].networkFailure:'other',beforeSend:outcomes.every(item=>item.beforeSend)};
 }
 if(typeof error.code==='string'&&error.code){
  if(BEFORE_SEND.has(error.code))return{networkFailure:BEFORE_SEND.get(error.code),beforeSend:true};
  if(TLS_CODES.has(error.code))return{networkFailure:'tls',beforeSend:false};
  if(TIMEOUT_CODES.has(error.code))return{networkFailure:'timeout',beforeSend:false};
  return unknown;
 }
 // Native fetch wraps transport failures in TypeError. Do not search arbitrary
 // causes/messages: they may describe an earlier operation or contain secrets.
 return error instanceof TypeError&&error.cause?inspectNetworkFailure(error.cause,depth+1,seen):unknown;
}
export function oauthNetworkDiagnostic(error){return{stage:'network',networkFailure:inspectNetworkFailure(error).networkFailure};}
export function canRetryOAuthBeforeSend(error){return inspectNetworkFailure(error).beforeSend;}
