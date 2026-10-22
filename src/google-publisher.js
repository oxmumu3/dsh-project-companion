/** Product-owned DSH Dot Desktop OAuth registration, never user credentials.
 * Registered in the separate dsh-dot project for External / Testing on 2026-10-22.
 * Desktop registration metadata is public-client configuration; it cannot keep
 * a server-side secret. Every user still authorizes their own Calendar access.
 * A missing or invalid registration keeps the connection in preparation state.
 * Never substitute another app client, Web secret, or user access/refresh token.
 */
export const GOOGLE_PUBLISHER = Object.freeze({
  "kind": "desktop",
  "clientId": "704381378743-k98h51tklm8anv41gqkm2kelgnvmt2bp.apps.googleusercontent.com",
  "clientSecret": "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"
});
export function readGooglePublisher(value=GOOGLE_PUBLISHER){
 if(!value||value.kind!=='desktop'||typeof value.clientId!=='string'||!value.clientId.endsWith('.apps.googleusercontent.com')||value.clientId.length>2048||/[\s\r\n]/.test(value.clientId)||Object.keys(value).some(k=>!['kind','clientId','clientSecret'].includes(k)))return null;
 if(value.clientSecret!==undefined&&(typeof value.clientSecret!=='string'||value.clientSecret.length>8192||/[\r\n]/.test(value.clientSecret)))return null;
 return Object.freeze({kind:'desktop',clientId:value.clientId,clientSecret:value.clientSecret??''});
}
