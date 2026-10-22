import test from 'node:test';
import assert from 'node:assert/strict';
const owner={sessionId:'synthetic-owner',cwd:'/synthetic/project'};
async function api(){const m=await import('../src/context-service.js').catch(()=>({}));assert.equal(typeof m.createPersonalContext,'function','personal context service must exist');return m;}
async function fixture(){const {createPersonalContext}=await api();let state,config={flomoToken:'synthetic-token'},binding='a'.repeat(64),paused=false;const calls=[];const store={get:async()=>structuredClone(state),put:async(_key,v)=>{state=structuredClone(v);}};const transport={catalog:async source=>({tools:[{name:'memo_search',inputSchema:{type:'object',properties:{keywords:{type:'string'},limit:{type:'integer'}},additionalProperties:false}}]}),call:async(source,name,args)=>{calls.push({source,name,args});return{value:{structuredContent:{memos:[{id:'m1',content:'Synthetic requested note',created_at:'2026-10-19T00:00:00Z',content_truncated:true}]}},fetchedAt:'2026-10-19T15:00:00Z'};},close(){}};const service=createPersonalContext({store,transport,readConfig:()=>config,readBinding:async()=>({kind:'bound',bindingKey:binding}),canRun:async()=>!paused,clock:()=>new Date('2026-10-19T15:00:00Z')});return{service,calls,stored:()=>state,setConfig:v=>{config=v;},setBinding:v=>{binding=v;},pause:()=>{paused=true;service.suspend();}};}
test('connections default off and do not read private data or save config',async()=>{const f=await fixture();const r=await f.service.act(owner,{action:'connections'});assert.equal(r.sources.length,8);assert.equal(r.sources.find(s=>s.id==='flomo').enabled,false);assert.equal(f.calls.length,0);assert.equal(f.stored(),undefined);assert.doesNotMatch(JSON.stringify(r),/synthetic-token/);});
test('explicit connected query is bounded and private body never enters stored preferences',async()=>{const f=await fixture();await f.service.act(owner,{action:'connect',source:'flomo',userRequested:true});const r=await f.service.act(owner,{action:'query',source:'flomo',operation:'search',query:'requested',userRequested:true});assert.equal(f.calls.length,1);assert.match(r.text,/Synthetic requested note/);assert.doesNotMatch(JSON.stringify(f.stored()),/Synthetic requested note|synthetic-token/);assert.ok(r.text.length<=10000);});
test('query without human intent or source opt-in cannot reach MCP',async()=>{const f=await fixture();await assert.rejects(f.service.act(owner,{action:'query',source:'flomo',operation:'search',query:'x',userRequested:true}));await f.service.act(owner,{action:'connect',source:'flomo',userRequested:true});await assert.rejects(f.service.act(owner,{action:'query',source:'flomo',operation:'search',query:'x'}));assert.equal(f.calls.length,0);});
test('changed binding, credential or owner fails closed before private read',async()=>{for(const mode of ['binding','credential','owner']){const f=await fixture();await f.service.act(owner,{action:'connect',source:'flomo',userRequested:true});if(mode==='binding')f.setBinding('b'.repeat(64));if(mode==='credential')f.setConfig({flomoToken:'changed'});await assert.rejects(f.service.act(mode==='owner'?{...owner,sessionId:'other'}:owner,{action:'query',source:'flomo',operation:'search',query:'x',userRequested:true}));assert.equal(f.calls.length,0);}});
test('disconnect stops subsequent reads and removes only selected opt-in',async()=>{const f=await fixture();await f.service.act(owner,{action:'connect',source:'flomo',userRequested:true});await f.service.act(owner,{action:'disconnect',source:'flomo',userRequested:true});await assert.rejects(f.service.act(owner,{action:'query',source:'flomo',operation:'search',query:'x',userRequested:true}));assert.equal(f.calls.length,0);});

test('disconnect aborts an in-flight read even if provider ignores cancellation',async()=>{
 const {createPersonalContext}=await api();let state,release,started;const entered=new Promise(r=>started=r),waiting=new Promise(r=>release=r);
 const service=createPersonalContext({store:{get:async()=>state,put:async(_k,v)=>state=structuredClone(v)},readConfig:()=>({flomoToken:'synthetic'}),readBinding:async()=>({kind:'unbound'}),transport:{catalog:async()=>({tools:[{name:'memo_search',inputSchema:{type:'object'}}]}),call:async()=>{started();await waiting;return{value:{structuredContent:{memos:[{id:'secret',content:'must not escape after disconnect'}]}}};}}});
 await service.act(owner,{action:'connect',source:'flomo',userRequested:true});
 const read=service.act(owner,{action:'query',source:'flomo',operation:'search',query:'x',userRequested:true});
 await entered;const stopped=assert.rejects(read,e=>e.code==='CONTEXT_STOPPED');const disconnect=service.act(owner,{action:'disconnect',source:'flomo',userRequested:true});await stopped;await disconnect;release();assert.equal((await service.snapshot(owner)).sources.find(s=>s.id==='flomo').enabled,false);await service.close();
});
test('account rotation during provider call discards the private response',async()=>{
 const {createPersonalContext}=await api();let state,token='synthetic-old';const service=createPersonalContext({store:{get:async()=>state,put:async(_k,v)=>state=v},readConfig:()=>({flomoToken:token}),readBinding:async()=>({kind:'unbound'}),transport:{catalog:async()=>({tools:[{name:'memo_search',inputSchema:{type:'object'}}]}),call:async()=>{token='synthetic-new';return{value:{structuredContent:{memos:[{id:'m',content:'old account private body'}]}}};}}});
 await service.act(owner,{action:'connect',source:'flomo',userRequested:true});await assert.rejects(service.act(owner,{action:'query',source:'flomo',operation:'search',query:'x',userRequested:true}),e=>e.code==='CONTEXT_BINDING_CHANGED');assert.doesNotMatch(JSON.stringify(state),/private body|synthetic-old|synthetic-new/);await service.close();
});
test('save failure never authorizes private reads from an in-memory opt-in',async()=>{
 const {createPersonalContext}=await api();let calls=0;const service=createPersonalContext({store:{get:async()=>undefined,put:async()=>{throw Error('synthetic store failure');}},readConfig:()=>({flomoToken:'synthetic'}),readBinding:async()=>({kind:'unbound'}),transport:{catalog:async()=>({tools:[{name:'memo_search',inputSchema:{type:'object'}}]}),call:async()=>{calls++;}}});
 await assert.rejects(service.act(owner,{action:'connect',source:'flomo',userRequested:true}),e=>e.code==='CONTEXT_STORE_UNAVAILABLE');await assert.rejects(service.act(owner,{action:'query',source:'flomo',operation:'search',query:'x',userRequested:true}),e=>e.code==='CONTEXT_STORE_UNAVAILABLE');assert.equal(calls,0);await service.close().catch(()=>{});
});
test('mixed brief reports unavailable source explicitly and never persists private bodies',async()=>{
 const f=await fixture();await f.service.act(owner,{action:'connect',source:'flomo',userRequested:true});const r=await f.service.act(owner,{action:'brief',sources:['flomo','dida'],query:'requested',userRequested:true});assert.equal(r.results.length,2);assert.equal(r.results[1].unavailable,true);assert.match(r.results[0].text,/Synthetic requested note/);assert.doesNotMatch(JSON.stringify(f.stored()),/Synthetic requested note/);
});
test('brief cannot disclose earlier private results after a later source suspends it',async()=>{
 const {createPersonalContext}=await api();let state,service,readCalls=0;const catalog=()=>({tools:[{name:'memo_search',inputSchema:{type:'object'}},{name:'search_files',inputSchema:{type:'object'}}]});
 service=createPersonalContext({store:{get:async()=>state,put:async(_k,v)=>state=v},readConfig:()=>({flomoToken:'synthetic',googleClientId:'synthetic',googleClientSecret:'synthetic',googleRefreshToken:'synthetic'}),readBinding:async()=>({kind:'unbound'}),transport:{catalog,call:async source=>{readCalls++;if(source==='drive'){service.suspend();throw Error('cancel');}return{value:{structuredContent:{memos:[{id:'m',content:'prior private note'}]}}};}}});
 for(const source of ['flomo','drive'])await service.act(owner,{action:'connect',source,userRequested:true});
 await assert.rejects(service.act(owner,{action:'brief',sources:['flomo','drive'],query:'requested',userRequested:true}),e=>e.code==='CONTEXT_STOPPED');assert.equal(readCalls,2);await service.close();
});
test('connection status does not claim enabled after original binding changes',async()=>{const f=await fixture();await f.service.act(owner,{action:'connect',source:'flomo',userRequested:true});f.setBinding('b'.repeat(64));assert.equal((await f.service.snapshot(owner)).sources.find(s=>s.id==='flomo').enabled,false);});
test('unknown native route after opt-in cannot read a private source',async()=>{
 const {createPersonalContext}=await api();let state,route={kind:'unbound'},calls=0;const service=createPersonalContext({store:{get:async()=>state,put:async(_k,v)=>state=v},readConfig:()=>({flomoToken:'synthetic'}),readBinding:async()=>route,transport:{catalog:async()=>({tools:[{name:'memo_search',inputSchema:{type:'object'}}]}),call:async()=>{calls++;return{value:{structuredContent:{memos:[]}}};}}});await service.act(owner,{action:'connect',source:'flomo',userRequested:true});route=undefined;await assert.rejects(service.act(owner,{action:'query',source:'flomo',operation:'search',query:'x',userRequested:true}));assert.equal(calls,0);await service.close();
});
test('account changed during async route check is rejected before private read',async()=>{
 const {createPersonalContext}=await api();let state,token='synthetic-a',rotate=false,routeCalls=0,calls=0;const service=createPersonalContext({store:{get:async()=>state,put:async(_k,v)=>state=v},readConfig:()=>({flomoToken:token}),readBinding:async()=>{if(rotate&&++routeCalls===2)token='synthetic-b';return{kind:'unbound'};},transport:{catalog:async()=>({tools:[{name:'memo_search',inputSchema:{type:'object'}}]}),call:async()=>{calls++;return{value:{structuredContent:{memos:[]}}};}}});await service.act(owner,{action:'connect',source:'flomo',userRequested:true});rotate=true;await assert.rejects(service.act(owner,{action:'query',source:'flomo',operation:'search',query:'x',userRequested:true}));assert.equal(calls,0);await service.close();
});
test('a foreign or invalid disconnect cannot cancel an authorized in-flight read',async()=>{
 const {createPersonalContext}=await api();let state,release,entered;const started=new Promise(r=>entered=r),wait=new Promise(r=>release=r);
 const service=createPersonalContext({store:{get:async()=>state,put:async(_k,v)=>state=v},readConfig:()=>({flomoToken:'synthetic'}),readBinding:async()=>({kind:'unbound'}),transport:{catalog:async()=>({tools:[{name:'memo_search',inputSchema:{type:'object'}}]}),call:async()=>{entered();await wait;return{value:{structuredContent:{memos:[{id:'m',content:'authorized synthetic note'}]}}};}}});
 await service.act(owner,{action:'connect',source:'flomo',userRequested:true});const read=service.act(owner,{action:'query',source:'flomo',operation:'search',query:'x',userRequested:true});await started;
 await assert.rejects(service.act(owner,{action:'disconnect',source:'flomo'}),e=>e.code==='CONTEXT_INTENT_REQUIRED');const foreign=service.act({...owner,sessionId:'foreign'},{action:'disconnect',source:'flomo',userRequested:true});release();assert.match((await read).text,/authorized synthetic note/);await foreign;assert.equal((await service.snapshot(owner)).sources.find(s=>s.id==='flomo').enabled,true);await service.close();
});
test('Calendar bundled capabilities enable an independent lease without claiming a verified API and preserve read coverage',async()=>{
 const {createPersonalContext}=await api();let state,calls=0,key='a'.repeat(64);const service=createPersonalContext({store:{get:async()=>state,put:async(_k,v)=>state=v},readConfig:()=>({}),credentialState:source=>source==='calendar'?{configured:true,key}:null,readBinding:async()=>({kind:'unbound'}),transport:{catalog:async()=>({provenance:'bundled-contract',tools:[{name:'list_events',inputSchema:{type:'object'}}]}),call:async()=>{calls++;return{value:{items:[{id:'event',summary:'全天',start:{date:'2026-10-20'},end:{date:'2026-10-21'}}],truncated:true},coverage:{source:'calendar',calendarId:'primary',from:'2026-10-20T00:00:00Z',to:'2026-10-21T00:00:00Z',returned:1,hasMore:true}};}}});
 try{const result=await service.act(owner,{action:'connect',source:'calendar',userRequested:true});assert.match(result.text,/尚未验证.*读取/);assert.doesNotMatch(result.text,/接口已.*验证/);assert.equal(calls,0);const read=await service.act(owner,{action:'query',source:'calendar',operation:'upcoming',userRequested:true});assert.equal(read.coverage.calendarId,'primary');assert.equal(read.coverage.hasMore,true);assert.match(read.text,/结束日期.*不包含/);assert.match(read.text,/主日历/);assert.equal(calls,1);key='b'.repeat(64);assert.equal((await service.snapshot(owner)).sources.find(s=>s.id==='calendar').enabled,false);assert.doesNotMatch(JSON.stringify(state),/全天/);}finally{await service.close();}
});
test('service does not silently shorten a Calendar title already bounded by the projection',async()=>{const {createPersonalContext}=await api();let state;const title='长'.repeat(170);const s=createPersonalContext({store:{get:async()=>state,put:async(_k,v)=>state=v},readConfig:()=>({googleClientId:'legacy',googleClientSecret:'legacy',googleRefreshToken:'legacy'}),readBinding:async()=>({kind:'unbound'}),transport:{catalog:async()=>({tools:[{name:'list_events',inputSchema:{type:'object'}}]}),call:async()=>({value:{items:[{id:'event',summary:title,start:{date:'2026-10-20'},end:{date:'2026-10-21'}}]}})}});try{await s.act(owner,{action:'connect',source:'calendar',userRequested:true});const r=await s.act(owner,{action:'query',source:'calendar',operation:'upcoming',userRequested:true});assert.equal(r.items[0].title,title);assert.equal(r.truncated,false);}finally{await s.close();}});
test('expired account authorization keeps a safe actionable login error without upstream private text',async()=>{const {createPersonalContext,contextErrorText}=await api();let state;const s=createPersonalContext({store:{get:async()=>state,put:async(_k,v)=>state=v},readConfig:()=>({googleClientId:'legacy',googleClientSecret:'legacy',googleRefreshToken:'legacy'}),readBinding:async()=>({kind:'unbound'}),transport:{catalog:async()=>({tools:[{name:'search_threads',inputSchema:{type:'object'}}]}),call:async()=>{throw Object.assign(Error('private refresh body'),{code:'CONTEXT_AUTH_REQUIRED'});}}});try{await s.act(owner,{action:'connect',source:'gmail',userRequested:true});await assert.rejects(s.act(owner,{action:'query',source:'gmail',operation:'search',query:'today',userRequested:true}),e=>e.code==='CONTEXT_AUTH_REQUIRED'&&!e.message.includes('private')&&/连接与设置.*登录/.test(contextErrorText(e)));}finally{await s.close();}});

test('insufficient scope during connect or query survives the service boundary without prescribing repeated login or leaking provider text', async () => {
  const { createPersonalContext, contextErrorText } = await api();
  for (const stage of ['connect', 'query']) {
    let state, calls = 0;
    const rejectScope = () => { throw Object.assign(new Error('private-token Required scope: tasks:write'), { code: 'CONTEXT_INSUFFICIENT_SCOPE' }); };
    const service = createPersonalContext({
      store: { get: async () => state, put: async (_key, value) => { state = structuredClone(value); } },
      readConfig: () => ({ didaToken: 'private-token' }), readBinding: async () => ({ kind: 'unbound' }),
      transport: {
        catalog: async () => { if (stage === 'connect') rejectScope(); return { tools: [{ name: 'list_projects', inputSchema: { type: 'object' } }] }; },
        call: async () => { calls++; rejectScope(); },
      },
    });
    try {
      if (stage === 'query') await service.act(owner, { action: 'connect', source: 'dida', userRequested: true });
      const input = stage === 'connect'
        ? { action: 'connect', source: 'dida', userRequested: true }
        : { action: 'query', source: 'dida', operation: 'projects', limit: 2, userRequested: true };
      await assert.rejects(service.act(owner, input), error => {
        assert.equal(error.code, 'CONTEXT_INSUFFICIENT_SCOPE');
        const text = contextErrorText(error);
        assert.match(text, /服务商.*额外权限/);
        assert.match(text, /重复登录.*只读权限.*不能解决/);
        assert.match(text, /未扩大权限/);
        assert.doesNotMatch(String(error) + text, /private-token|tasks:write|Required scope/);
        return true;
      });
      assert.equal(calls, stage === 'query' ? 1 : 0);
      if (stage === 'connect') assert.equal(state, undefined);
    } finally { await service.close(); }
  }
});
