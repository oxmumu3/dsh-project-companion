import test from 'node:test';
import assert from 'node:assert/strict';
import {buildContextCall,validateContextCall,projectContextResult} from '../src/context-contracts.js';

const module=await import('../src/dida-rest.js').catch(()=>null);
const create=options=>{assert.equal(typeof module?.createDidaRest,'function','Dida read-only REST adapter must exist');return module.createDidaRest(options);};
const fixed=new Date('2026-10-22T12:00:00Z');
const gates={authorize:async()=>true,authorizeSync:()=>true};
const args={offset:0,limit:2};
const response=value=>Response.json(value);
const code=expected=>e=>e.code===expected&&!e.message.includes('private');
const task=(id='t1',projectId='p1')=>({id,projectId,title:'Example task',content:'Short note',status:0,dueDate:'2026-10-23T12:00:00+0000',priority:3});

test('Dida catalog is passive, bundled and excludes unsupported account search',async()=>{
 let calls=0;const t=create({getToken:async()=>{calls++;return'token';},fetch:async()=>{calls++;return response([]);},clock:()=>fixed});
 const c=await t.catalog('dida',gates);assert.equal(c.provenance,'bundled-contract');assert.deepEqual(c.tools.map(t=>t.name),['list_projects','get_project_with_undone_tasks','get_task_in_project']);assert.deepEqual(c.unsupportedOperations,['search']);assert.equal(calls,0);
 assert.throws(()=>validateContextCall(buildContextCall('dida',{operation:'search',query:'work'}),c),code('CONTEXT_UNSUPPORTED_OPERATION'));
 const legacy={tools:[{name:'search',inputSchema:{type:'object',properties:{query:{type:'string'}}}}]};assert.equal(validateContextCall({name:'search',args:{query:'work'}},legacy).name,'search');
 for(const unsupportedOperations of [['delete'],['search','search'],'search',['search',42]])assert.throws(()=>validateContextCall({name:'list_projects',args}, {...c,unsupportedOperations}),code('CONTEXT_SCHEMA_MISMATCH'));
 await t.close();
});

test('project list sends one fixed GET with user limit and projects only leave as minimal fields',async()=>{
 const calls=[];const t=create({getToken:async()=> 'synthetic-bearer',fetch:async(url,init)=>{calls.push({url:new URL(url),init});return response([{id:'p1',name:'Current tasks',color:'private',members:['private']},{id:'p2',name:'Later'}]);},clock:()=>fixed});
 const r=await t.call('dida','list_projects',args,gates),request=calls[0];
 assert.equal(request.url.origin,'https://api.dida365.com');assert.equal(request.url.pathname,'/open/v1/project');assert.equal(request.url.search,'?offset=0&limit=2');assert.equal(request.init.method,'GET');assert.equal(request.init.redirect,'manual');assert.equal(request.init.body,undefined);assert.equal(request.init.headers.authorization,'Bearer synthetic-bearer');assert.equal(calls.length,1);
 assert.deepEqual(r.value.items,[{id:'p1',name:'Current tasks'},{id:'p2',name:'Later'}]);assert.equal(r.value.truncated,true,'full page is not proof of full account coverage');assert.equal(r.fetchedAt,fixed.toISOString());assert.equal(JSON.stringify(r).includes('private'),false);await t.close();
});

test('explicit project tasks use only that project and clip tasks without following other projects',async()=>{
 const calls=[];const t=create({getToken:async()=> 'x',fetch:async(url)=>{calls.push(url);return response({project:{id:'p1',name:'A project',private:'discard'},tasks:Array.from({length:12},(_,i)=>({...task('t'+i),assignee:'private',attachments:['private']})),columns:[{name:'private'}]});}});
 const r=await t.call('dida','get_project_with_undone_tasks',{project_id:'p1'},gates);assert.deepEqual(calls,['https://api.dida365.com/open/v1/project/p1/data']);assert.equal(r.value.items.length,10);assert.equal(r.value.truncated,true);assert.equal(r.value.items[0].projectId,'p1');assert.equal(r.value.items[0].status,0);assert.match(r.value.items[0].content,/2026-10-23/);assert.equal(JSON.stringify(r).includes('private'),false);assert.equal(projectContextResult('dida',r.value,{operation:'tasks'}).items.length,10);await t.close();
});

test('explicit task reads preserve identity and do not retrieve another project or attachments',async()=>{
 let url;const t=create({getToken:async()=> 'x',fetch:async(u)=>{url=u;return response({...task(),items:[{title:'private checklist'}],attachments:['private'],content:'x'.repeat(1300)});}});
 const r=await t.call('dida','get_task_in_project',{project_id:'p1',task_id:'t1'},gates);assert.equal(url,'https://api.dida365.com/open/v1/project/p1/task/t1');assert.equal(r.value.items[0].id,'t1');assert.equal(r.value.truncated,true);assert.ok(r.value.items[0].content.length<=1200);assert.equal(JSON.stringify(r).includes('private'),false);await t.close();
});

test('inbox is supported only when explicitly requested as the project',async()=>{
 let url;const t=create({getToken:async()=> 'x',fetch:async(u)=>{url=u;return response({project:{id:'inbox',name:'Inbox'},tasks:[task('t1','inbox')]});}});
 const r=await t.call('dida','get_project_with_undone_tasks',{project_id:'inbox'},gates);assert.equal(url,'https://api.dida365.com/open/v1/project/inbox/data');assert.equal(r.value.items[0].projectId,'inbox');await t.close();
});

test('unsupported operations, pagination overrides and injected paths fail before token or network',async()=>{
 let calls=0;const t=create({getToken:async()=>{calls++;return'x';},fetch:async()=>{calls++;return response([]);}});
 for(const [source,name,input]of [['dida','search',{query:'work'}],['dida','create_task',{}],['flomo','list_projects',args],['dida','list_projects',{offset:1,limit:2}],['dida','list_projects',{offset:0,limit:11}],['dida','list_projects',{offset:0,limit:0}],['dida','list_projects',{...args,url:'https://evil.example'}],['dida','get_project_with_undone_tasks',{project_id:'../p1'}],['dida','get_project_with_undone_tasks',{project_id:'p1?limit=100'}],['dida','get_task_in_project',{project_id:'p1',task_id:'t1/complete'}],['dida','get_task_in_project',{project_id:'p1',task_id:'x'.repeat(513)}]])await assert.rejects(t.call(source,name,input,gates),e=>['CONTEXT_UNSUPPORTED_OPERATION','CONTEXT_ARGUMENTS_INVALID'].includes(e.code));
 assert.equal(calls,0);await t.close();
});

test('malformed and cross-project results fail without publishing remote metadata',async()=>{
 for(const [name,input,value]of [['list_projects',args,{projects:[]}],['list_projects',args,[{id:'p1',name:42}]],['get_project_with_undone_tasks',{project_id:'p1'},{project:{id:'p2'},tasks:[task()]}],['get_project_with_undone_tasks',{project_id:'p1'},{project:{id:'p1'},tasks:[task('t1','p2')]}],['get_task_in_project',{project_id:'p1',task_id:'t1'},task('t2')]]){
  const t=create({getToken:async()=> 'x',fetch:async()=>response(value)});await assert.rejects(t.call('dida',name,input,gates),code('CONTEXT_PROTOCOL_INVALID'));await t.close();
 }
});

test('permission change while token is pending prevents private API dispatch',async()=>{
 let release,entered,http=0,allowed=true;const ready=new Promise(r=>entered=r);const t=create({getToken:()=>{entered();return new Promise(r=>release=r);},fetch:async()=>{http++;return response([]);}});
 const pending=t.call('dida','list_projects',args,{authorize:async()=>allowed,authorizeSync:()=>allowed});await ready;allowed=false;release('x');await assert.rejects(pending,code('CONTEXT_CANCELLED'));assert.equal(http,0);await t.close();
});

test('last synchronous gate catches revocation after asynchronous authorization',async()=>{
 let checks=0,http=0;const t=create({getToken:async()=> 'x',fetch:async()=>{http++;return response([]);}});
 await assert.rejects(t.call('dida','list_projects',args,{authorize:async()=>true,authorizeSync:()=>++checks<3}),code('CONTEXT_CANCELLED'));assert.equal(http,0);await t.close();
});

test('returned data is discarded when permission changed during HTTP',async()=>{
 let allowed=true;const t=create({getToken:async()=> 'x',fetch:async()=>{allowed=false;return response([{id:'p1',name:'private'}]);}});
 await assert.rejects(t.call('dida','list_projects',args,{authorize:async()=>allowed,authorizeSync:()=>allowed}),code('CONTEXT_CANCELLED'));await t.close();
});

test('missing gates, unusable token and pre-abort never dispatch',async()=>{
 let http=0;const t=create({getToken:async()=> 'bad\r\nprivate',fetch:async()=>{http++;return response([]);}});
 await assert.rejects(t.call('dida','list_projects',args,{}),code('CONTEXT_CANCELLED'));await assert.rejects(t.call('dida','list_projects',args,gates),code('CONTEXT_AUTH_REQUIRED'));await assert.rejects(t.call('dida','list_projects',args,{...gates,signal:AbortSignal.abort()}),code('CONTEXT_ABORTED'));assert.equal(http,0);await t.close();
});

test('HTTP failures and redirects never retry, follow or leak response bodies',async()=>{
 for(const [reply,expected]of [[new Response('private',{status:302,headers:{location:'https://evil.example'}}),'CONTEXT_REDIRECT'],[new Response('private',{status:401}),'CONTEXT_AUTH_REQUIRED'],[new Response('private',{status:403}),'CONTEXT_HTTP_ERROR'],[new Response('private',{status:403,headers:{'www-authenticate':'Bearer error="insufficient_scope"'}}),'CONTEXT_INSUFFICIENT_SCOPE'],[new Response('private',{status:429}),'CONTEXT_HTTP_ERROR'],[new Response('private',{headers:{'content-type':'text/html'}}),'CONTEXT_PROTOCOL_INVALID'],[new Response('{ private',{headers:{'content-type':'application/json'}}),'CONTEXT_PROTOCOL_INVALID']]){
  let count=0;const t=create({getToken:async()=> 'x',fetch:async()=>{count++;return reply;}});await assert.rejects(t.call('dida','list_projects',args,gates),code(expected));assert.equal(count,1);await t.close();
 }
});

for(const [title,status,header,expected] of [
 ['standard realm and error description',403,'Bearer realm="dida", error="insufficient_scope", error_description="Required scope: tasks:write"','CONTEXT_INSUFFICIENT_SCOPE'],
 ['unquoted auth parameter',403,'Bearer error=insufficient_scope','CONTEXT_INSUFFICIENT_SCOPE'],
 ['401 takes precedence over scope header',401,'Bearer error="insufficient_scope"','CONTEXT_AUTH_REQUIRED'],
 ['description mentioning a scope error is not a scope challenge',403,'Bearer error="invalid_token", error_description="insufficient_scope"','CONTEXT_HTTP_ERROR'],
 ['duplicated error parameters are ambiguous',403,'Bearer error="insufficient_scope", error="invalid_token"','CONTEXT_HTTP_ERROR'],
 ['malformed parameter suffix',403,'Bearer error="insufficient_scope", invalid','CONTEXT_HTTP_ERROR'],
 ['other auth scheme',403,'Basic error="insufficient_scope"','CONTEXT_HTTP_ERROR'],
 ['oversized challenge',403,'Bearer realm="'+ 'x'.repeat(8200)+'", error="insufficient_scope"','CONTEXT_HTTP_ERROR'],
])test('Dida REST scope classification: '+title,async()=>{
 let calls=0;const t=create({getToken:async()=> 'x',fetch:async()=>{calls++;return new Response('private-provider-payload',{status,headers:{'www-authenticate':header}});}});
 await assert.rejects(t.call('dida','list_projects',args,gates),code(expected));assert.equal(calls,1);await t.close();
});

test('declared and streamed response bodies are bounded to 1 MiB',async()=>{
 for(const reply of [new Response('[]',{headers:{'content-type':'application/json','content-length':'1048577'}}),new Response('x'.repeat(1048577),{headers:{'content-type':'application/json'}})]){
  const t=create({getToken:async()=> 'x',fetch:async()=>reply});await assert.rejects(t.call('dida','list_projects',args,gates),code('CONTEXT_RESPONSE_TOO_LARGE'));await t.close();
 }
});

test('close cancels waiting token and blocked body; late fetch responses are released',async()=>{
 let tokenEntered,bodyEntered,cancelled=false,release,http=0;
 const tokenReady=new Promise(r=>tokenEntered=r);const t=create({getToken:()=>{tokenEntered();return new Promise(()=>{});},fetch:async()=>{http++;return response([]);}});
 const pending=t.call('dida','list_projects',args,gates);await tokenReady;await t.close();await assert.rejects(pending,code('CONTEXT_ABORTED'));assert.equal(http,0);await assert.rejects(t.catalog('dida'),code('CONTEXT_CLOSED'));
 const bodyReady=new Promise(r=>bodyEntered=r);const b=create({getToken:async()=> 'x',fetch:async()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('['));bodyEntered();},cancel(){cancelled=true;}}),{headers:{'content-type':'application/json'}})});
 const bp=b.call('dida','list_projects',args,gates);await bodyReady;await b.close();await assert.rejects(bp,code('CONTEXT_ABORTED'));assert.equal(cancelled,true);
 let requestEntered;const requestReady=new Promise(r=>requestEntered=r);const late=create({getToken:async()=> 'x',fetch:()=>{requestEntered();return new Promise(r=>release=r);}});const lp=late.call('dida','list_projects',args,gates);await requestReady;await late.close();await assert.rejects(lp,code('CONTEXT_ABORTED'));const reply=response([]);release(reply);await new Promise(r=>setImmediate(r));assert.equal(reply.bodyUsed,true);
});

test('request deadline bounds even a token getter that ignores abort',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let entered;const ready=new Promise(r=>entered=r);const adapter=create({getToken:()=>{entered();return new Promise(()=>{});}});const pending=adapter.call('dida','list_projects',args,gates);await ready;t.mock.timers.tick(20000);await assert.rejects(pending,code('CONTEXT_TIMEOUT'));await adapter.close();
});
