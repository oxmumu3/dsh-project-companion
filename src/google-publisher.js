/** Product-owned Desktop OAuth registration, never a user's Google credentials.
 * The publisher has not registered an application yet. A missing registration
 * intentionally leaves the ordinary Calendar connection in preparation state.
 * Do not substitute Codex/gws/another application's client here.
 */
export const GOOGLE_PUBLISHER = null;
export function readGooglePublisher(value=GOOGLE_PUBLISHER){
 if(!value||value.kind!=='desktop'||typeof value.clientId!=='string'||!value.clientId.endsWith('.apps.googleusercontent.com')||value.clientId.length>2048||/[\s\r\n]/.test(value.clientId)||Object.keys(value).some(k=>!['kind','clientId','clientSecret'].includes(k)))return null;
 if(value.clientSecret!==undefined&&(typeof value.clientSecret!=='string'||value.clientSecret.length>8192||/[\r\n]/.test(value.clientSecret)))return null;
 return Object.freeze({kind:'desktop',clientId:value.clientId,clientSecret:value.clientSecret??''});
}
