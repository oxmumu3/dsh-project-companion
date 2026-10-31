import test from 'node:test';
import assert from 'node:assert/strict';
import {createGoogleSuiteRest} from '../src/google-suite-rest.js';
import {buildContextCall,validateContextCall,projectContextResult} from '../src/context-contracts.js';

const gates={authorize:async()=>true,authorizeSync:()=>true};
const fixed=new Date('2026-10-22T08:00:00Z');
const json=(v,extra={})=>new Response(JSON.stringify(v),{headers:{'content-type':'application/json',...extra}});
const plain=v=>new Response(v,{headers:{'content-type':'text/plain; charset=utf-8'}});
const call=(t,s,input,settings=gates)=>{const c=buildContextCall(s,input);return t.call(s,c.name,c.args,settings);};
const fail=code=>e=>e.code===code&&!/private/.test(e.message);
const fixture=(fetch)=>createGoogleSuiteRest({getToken:async()=> 'fixture-bearer',fetch,clock:()=>fixed});

test('catalogs are passive and accept only existing read-only contracts',async()=>{
 let http=0,tokens=0;
 const t=createGoogleSuiteRest({getToken:async()=>{tokens++;return'x';},fetch:async()=>{http++;throw Error();}});
 for(const [source,input] of [['gmail',{operation:'search',query:'newer_than:1d'}],['gmail',{operation:'read',id:'abc1'}],['drive',{operation:'search',query:"a'b"}],['drive',{operation:'read',id:'file_1'}],['docs',{operation:'read',id:'doc_1'}],['sheets',{operation:'read',id:'sheet_1',range:'A1:B4'}],['slides',{operation:'read',id:'deck_1'}]]){
  const c=await t.catalog(source,gates);assert.equal(c.provenance,'bundled-contract');validateContextCall(buildContextCall(source,input),c);
 }
 assert.equal(http,0);assert.equal(tokens,0);await t.close();
});

test('Gmail search fetches bounded message metadata without bodies, attachments, writes or pagination',async()=>{
 const requests=[];const t=fixture(async(url,options)=>{const u=new URL(url);requests.push({u,options});
  if(u.pathname.endsWith('/messages'))return json({messages:[{id:'m1',threadId:'t1'},{id:'m2',threadId:'t2'}],nextPageToken:'private-next'});
  return json({id:u.pathname.split('/').at(-1),threadId:'t1',snippet:'Short preview',payload:{headers:[{name:'Subject',value:'Planning'},{name:'From',value:'a@example.test'}],body:{data:Buffer.from('private body').toString('base64url')}}});
 });
 const r=await call(t,'gmail',{operation:'search',query:'newer_than:7d',limit:2});
 assert.equal(requests.length,3);assert.equal(requests[0].u.origin,'https://gmail.googleapis.com');assert.equal(requests[0].u.searchParams.get('includeSpamTrash'),'false');assert.equal(requests[0].u.searchParams.get('maxResults'),'2');
 for(const x of requests){assert.equal(x.options.method,'GET');assert.equal(x.options.redirect,'manual');assert.equal(x.options.body,undefined);}
 assert.equal(requests[1].u.searchParams.get('format'),'metadata');assert.deepEqual(requests[1].u.searchParams.getAll('metadataHeaders'),['Subject','From','Date']);
 assert.equal(r.value.items.length,2);assert.equal(r.value.truncated,true);assert.equal(JSON.stringify(r).includes('private'),false);assert.equal(r.fetchedAt,fixed.toISOString());
 const projected=projectContextResult('gmail',r.value,{operation:'search'});assert.equal(projected.items[0].title,'Planning');assert.equal(projected.items[0].status,'metadata_only');await t.close();
});

test('Gmail read decodes text/plain only, omits attachments and marks missing plain text',async()=>{
 let mode=0;const t=fixture(async()=>json({id:'m1',snippet:'fallback',payload:mode?{mimeType:'text/html',body:{data:Buffer.from('<b>body</b>').toString('base64url')}}:{mimeType:'multipart/mixed',parts:[{mimeType:'text/plain',body:{data:Buffer.from('hello\nworld').toString('base64url')}},{mimeType:'text/plain',filename:'private.txt',body:{attachmentId:'private-attachment',data:Buffer.from('must not appear').toString('base64url')}}]}}));
 const r=await call(t,'gmail',{operation:'read',id:'m1'});assert.equal(r.value.plaintextBody,'hello\nworld');assert.equal(JSON.stringify(r).includes('private'),false);assert.equal(r.value.truncated,true,'attachment omitted is explicit');
 mode=1;const html=await call(t,'gmail',{operation:'read',id:'m1'});assert.equal(html.value.plaintextBody,'fallback');assert.equal(html.value.truncated,true);await t.close();
});

test('Drive translates only title-contains contract and caps result metadata',async()=>{
 let request;const t=fixture(async(url)=>{request=new URL(url);return json({files:[{id:'f1',name:'Report',mimeType:'application/pdf',webViewLink:'https://evil.invalid/private',description:'private data'}],nextPageToken:'private-next'});});
 const r=await call(t,'drive',{operation:'search',query:"a'b\\c",limit:3});assert.equal(request.origin,'https://www.googleapis.com');assert.equal(request.pathname,'/drive/v3/files');assert.equal(request.searchParams.get('q'),"name contains 'a\\'b\\\\c' and trashed = false");assert.equal(request.searchParams.get('pageSize'),'3');
 assert.equal(r.value.items[0].name,'Report');assert.equal(r.value.items[0].webViewLink,undefined);assert.equal(r.value.truncated,true);assert.equal(JSON.stringify(r).includes('private'),false);await t.close();
});

test('Drive native document exports text only; unsupported files do not download',async()=>{
 const requests=[];let mime='application/vnd.google-apps.document';
 const t=fixture(async(url)=>{const u=new URL(url);requests.push(u);return u.pathname.endsWith('/export')?plain('Document content'):json({id:'f1',name:'Report',mimeType:mime,size:'123'});});
 const r=await call(t,'drive',{operation:'read',id:'f1'});assert.equal(r.value.fileContent,'Document content');assert.equal(requests[1].searchParams.get('mimeType'),'text/plain');
 mime='application/pdf';requests.length=0;const unsupported=await call(t,'drive',{operation:'read',id:'f1'});assert.equal(requests.length,1);assert.equal(unsupported.value.textFormattingNotSupported,true);assert.equal(projectContextResult('drive',unsupported.value,{operation:'read',id:'f1'}).items[0].status,'unsupported_content');await t.close();
});

test('Docs and Slides use explicit file kinds; Sheets reads only bounded A1 values',async()=>{
 const requests=[];const t=fixture(async(url)=>{const u=new URL(url);requests.push(u);if(u.hostname==='sheets.googleapis.com')return json({range:'Sheet1!A1:B2',values:[['a','b'],[1,2]]});if(u.pathname.endsWith('/export'))return plain('native text');return json({id:u.pathname.split('/').at(-1),name:'Native',mimeType:u.pathname.endsWith('deck1')?'application/vnd.google-apps.presentation':'application/vnd.google-apps.document'});});
 assert.equal((await call(t,'docs',{operation:'read',id:'doc1'})).value.text,'native text');assert.equal((await call(t,'slides',{operation:'read',id:'deck1'})).value.text,'native text');
 const r=await call(t,'sheets',{operation:'read',id:'sheet1',range:'Sheet1!A1:B2'});assert.deepEqual(r.value.values,[['a','b'],[1,2]]);const u=requests.at(-1);assert.equal(u.origin,'https://sheets.googleapis.com');assert.equal(u.pathname,'/v4/spreadsheets/sheet1/values/Sheet1!A1%3AB2');assert.equal(u.searchParams.get('valueRenderOption'),'FORMATTED_VALUE');await t.close();
});

test('invalid tool, path injection, unbounded range and extra fields fail before token or HTTP',async()=>{
 let tokens=0,http=0;const t=createGoogleSuiteRest({getToken:async()=>{tokens++;return'x';},fetch:async()=>{http++;throw Error();}});
 for(const [s,n,a] of [['gmail','delete_message',{messageId:'a'}],['drive','read_file_content',{fileId:'../private',includeComments:false}],['drive','search_files',{query:"name contains 'a' or true",pageSize:10,excludeContentSnippets:true}],['sheets','get_values',{spreadsheetId:'a',range:'A1:ZZ99999'}],['gmail','get_message',{messageId:'a',messageFormat:'FULL_CONTENT',url:'https://evil.invalid'}]])await assert.rejects(t.call(s,n,a,gates),fail('CONTEXT_ARGUMENTS_INVALID'));
 assert.equal(tokens,0);assert.equal(http,0);await t.close();
});

test('owner change between metadata and body prevents second private request',async()=>{
 let allowed=true,http=0;const t=fixture(async()=>{http++;allowed=false;return json({id:'f1',name:'File',mimeType:'text/plain',size:'12'});});
 await assert.rejects(call(t,'drive',{operation:'read',id:'f1'},{authorize:async()=>allowed,authorizeSync:()=>allowed}),fail('CONTEXT_CANCELLED'));assert.equal(http,1);await t.close();
});

test('all requests reject redirects/auth errors/oversized bodies without retry or provider error text',async()=>{
 for(const [response,code] of [[new Response('private',{status:302,headers:{location:'https://evil.invalid'}}),'CONTEXT_REDIRECT'],[new Response('private',{status:401}),'CONTEXT_AUTH_REQUIRED'],[new Response('private',{status:429}),'CONTEXT_HTTP_ERROR'],[json({}, {'content-length':'1048577'}),'CONTEXT_RESPONSE_TOO_LARGE'],[new Response('x'.repeat(1048577),{headers:{'content-type':'application/json'}}),'CONTEXT_RESPONSE_TOO_LARGE'],[json({messages:'private'}),'CONTEXT_PROTOCOL_INVALID']]){
  let count=0;const t=fixture(async()=>{count++;return response;});await assert.rejects(call(t,'gmail',{operation:'search',query:'today'}),fail(code));assert.equal(count,1);await t.close();
 }
});

test('empty results stay empty and short body clipping is declared',async()=>{
 const empty=fixture(async()=>json({messages:[]}));const r=await call(empty,'gmail',{operation:'search',query:'today'});assert.deepEqual(r.value.items,[]);assert.equal(r.value.truncated,false);await empty.close();
 const long=fixture(async(url)=>new URL(url).searchParams.get('alt')==='media'?plain('x'.repeat(20000)):json({id:'f1',name:'large',mimeType:'text/plain',size:'20000'}));
 const result=await call(long,'drive',{operation:'read',id:'f1'});assert.equal(result.value.fileContent.length,16000);assert.equal(result.value.truncated,true);await long.close();
});

test('Gmail list retains resultSizeEstimate in its partial response without exposing an account total',async()=>{
 const requests=[];const t=fixture(async(url,options)=>{requests.push({u:new URL(url),options});return json({resultSizeEstimate:0});});
 try{
  const result=await call(t,'gmail',{operation:'search',query:'subject:DeepSeek',limit:1});
  assert.deepEqual(result.value,{items:[],truncated:false});assert.equal(requests.length,1);
  const {u,options}=requests[0];
  assert.equal(u.origin,'https://gmail.googleapis.com');assert.equal(u.pathname,'/gmail/v1/users/me/messages');
  assert.equal(u.searchParams.get('q'),'subject:DeepSeek');assert.equal(u.searchParams.get('maxResults'),'1');
  assert.equal(u.searchParams.get('includeSpamTrash'),'false');
  // Gmail documents this metadata field even when messages / nextPageToken are
  // absent. Keep it in the mask; a bodyless 204 still cannot establish emptiness.
  assert.equal(u.searchParams.get('fields'),'messages(id,threadId),nextPageToken,resultSizeEstimate');
  assert.equal(options.method,'GET');assert.equal(options.redirect,'manual');
  const projected=projectContextResult('gmail',result.value,{operation:'search'});
  assert.deepEqual(projected.items,[]);assert.equal(Object.hasOwn(result.value,'resultSizeEstimate'),false);
 }finally{await t.close();}
});

test('Gmail result estimates cannot enlarge metadata reads or become returned item counts',async()=>{
 let requests=0;const t=fixture(async(url)=>{
  requests++;return new URL(url).pathname.endsWith('/messages')
   ?json({messages:[{id:'m1',threadId:'t1'}],resultSizeEstimate:4294967295})
   :json({id:'m1',snippet:'Synthetic preview'});
 });
 try{
  const result=await call(t,'gmail',{operation:'search',query:'subject:DeepSeek',limit:1});
  assert.equal(requests,2);assert.equal(result.value.items.length,1);assert.equal(result.value.truncated,false);
  assert.equal(Object.hasOwn(result.value,'resultSizeEstimate'),false);assert.equal(JSON.stringify(result).includes('4294967295'),false);
 }finally{await t.close();}
});

test('close cancels blocked token/body reads and releases late bodies',async()=>{
 let http=0;const t=createGoogleSuiteRest({getToken:()=>new Promise(()=>{}),fetch:async()=>{http++;throw Error();}});const pending=call(t,'gmail',{operation:'read',id:'m1'});await t.close();await assert.rejects(pending,e=>['CONTEXT_ABORTED','CONTEXT_CLOSED'].includes(e.code));assert.equal(http,0);
 let started;const ready=new Promise(r=>started=r);let cancelled=false;const b=fixture(async()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{'));started();},cancel(){cancelled=true;}}),{headers:{'content-type':'application/json'}}));const read=call(b,'gmail',{operation:'read',id:'m1'});await ready;await b.close();await assert.rejects(read,fail('CONTEXT_ABORTED'));assert.equal(cancelled,true);
});

test('missing gates, malformed tokens and pre-aborted requests never reach private HTTP',async()=>{
 let http=0;const t=createGoogleSuiteRest({getToken:async()=> 'private\r\ninjection',fetch:async()=>{http++;throw Error();}});
 await assert.rejects(call(t,'gmail',{operation:'read',id:'m1'},{}),fail('CONTEXT_CANCELLED'));
 await assert.rejects(call(t,'gmail',{operation:'read',id:'m1'}),fail('CONTEXT_AUTH_REQUIRED'));
 await assert.rejects(call(t,'gmail',{operation:'read',id:'m1'},{...gates,signal:AbortSignal.abort()}),fail('CONTEXT_ABORTED'));
 assert.equal(http,0);await t.close();
});

test('body auth checks stop metadata fanout after binding changes and token guards stay affirmative',async()=>{
 let requests=0,allowed=true,affirmed=false;const t=createGoogleSuiteRest({getToken:async(source,{authorizeMutation})=>{assert.equal(source,'gmail');affirmed=await authorizeMutation();return'fixture';},fetch:async()=>{requests++;if(requests===1)return json({messages:[{id:'m1'},{id:'m2'}]});allowed=false;return json({id:'m1',snippet:'private'});}});
 await assert.rejects(call(t,'gmail',{operation:'search',query:'today'},{authorize:async()=>allowed,authorizeSync:()=>allowed}),fail('CONTEXT_CANCELLED'));assert.equal(affirmed,true);assert.equal(requests,2);await t.close();
});

test('Drive wrong-resource identities and oversized or unknown text files cannot download body',async()=>{
 for(const raw of [{id:'different',name:'File',mimeType:'text/plain',size:'1'},{id:'f1',name:'File',mimeType:'text/plain',size:'1048577'},{id:'f1',name:'File',mimeType:'text/plain'}]){
  let requests=0;const t=fixture(async()=>{requests++;return json(raw);});
  if(raw.id!=='f1')await assert.rejects(call(t,'drive',{operation:'read',id:'f1'}),fail('CONTEXT_PROTOCOL_INVALID'));
  else assert.equal((await call(t,'drive',{operation:'read',id:'f1'})).value.textFormattingNotSupported,true);
  assert.equal(requests,1);await t.close();
 }
});

test('Sheets clips out-of-range provider cells and rejects non-scalar values',async()=>{
 let malformed=false;const t=fixture(async()=>json({values:malformed?[[{private:'object'}]]:[['a','b','c'],['d'],['e']]}));
 const r=await call(t,'sheets',{operation:'read',id:'s1',range:'A1:B2'});assert.deepEqual(r.value.values,[['a','b'],['d']]);assert.equal(r.value.truncated,true);
 malformed=true;await assert.rejects(call(t,'sheets',{operation:'read',id:'s1',range:'A1:B2'}),fail('CONTEXT_PROTOCOL_INVALID'));await t.close();
});
