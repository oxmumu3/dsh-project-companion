import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeReviewItems,hashReview,reviewItemSchema} from '../src/personal-review-ledger.js';
import {bindingRevision} from '../src/workbench-scope.js';
import {createPersonalReviewService} from '../src/personal-review.js';

const now='2026-10-30T16:00:00.000Z',caller={sessionId:'synthetic-owner',cwd:'/synthetic/owner'};
const binding='a'.repeat(64),grant='b'.repeat(64),route={state:'bound',sessionId:caller.sessionId,bindingKey:binding};
const scope={caller,sources:['gmail'],projects:[],bindingKey:binding,grant};scope.key=hashReview(JSON.stringify({caller,sources:scope.sources,projects:scope.projects,bindingKey:binding}));
const grantScopeKey=hashReview(JSON.stringify({key:scope.key,grant}));
const evidence={id:'gmail:private-source-id',source:'gmail',title:'synthetic-private-source-title',text:'synthetic-private-body',url:'https://mail.google.com/mail/u/0/#all/message1',at:now};
const candidate={key:'attention',kind:'risk',title:'需要核对的真实事项',summary:'来源显示一项变化。',why:'变化将影响后续安排。',action:'核对原通知。',unknown:'实际影响待核对。',evidenceIds:[evidence.id],priority:'high',confidence:'source'};
const items=(options={})=>mergeReviewItems([], [candidate], [evidence], {now,scopeKey:scope.key,grantScopeKey,...options});
const raw=(extra={})=>({id:'profile',version:1,scope:structuredClone(scope),subscription:null,items:items(),jobs:[],occurrences:[],watermarks:{},receipts:[],...extra});
const input=(extra={})=>({reviewState:raw(),newsState:null,caller,bindingKey:binding,grant,newsBindingKey:binding,projects:[],now:new Date(now),...extra});
async function api(){const a=await import('../src/review-workbench-projection.js').catch(()=>({}));assert.equal(typeof a.projectReviewWorkbench,'function','passive review projection export exists');assert.equal(typeof a.createReviewWorkbenchReader,'function','guarded raw-row reader export exists');return a;}

test('only current trusted candidates receive a compatible grant marker and old evidence is replaced on regrant',()=>{
 const legacy=mergeReviewItems([], [candidate], [evidence], {now,scopeKey:scope.key});assert.equal(reviewItemSchema.safeParse(legacy[0]).success,true);assert.equal(legacy[0].grantScopeKey,undefined);
 const untouched={...structuredClone(legacy[0]),id:'review_'+'f'.repeat(32),key:'untouched',aliases:['untouched'],title:'旧事项'};
 const newer={...evidence,id:'gmail:current-source-id',text:'Current evidence',url:'https://mail.google.com/mail/u/0/#all/current'};
 const value=mergeReviewItems([...legacy,untouched],[{...candidate,evidenceIds:[newer.id]}],[newer],{now,scopeKey:scope.key,grantScopeKey});
 assert.equal(value.find(i=>i.id===legacy[0].id).grantScopeKey,grantScopeKey);
 assert.deepEqual(value.find(i=>i.id===legacy[0].id).evidence.map(e=>e.id),[newer.id]);
 assert.equal(value.find(i=>i.id===legacy[0].id).evidenceDigests.some(d=>d.locator.includes(evidence.id)),false);
 assert.equal(value.find(i=>i.id===untouched.id).grantScopeKey,undefined);
 assert.equal(reviewItemSchema.safeParse(value.find(i=>i.id===legacy[0].id)).success,true);
});

test('current grant candidates cannot inherit an unreferenced deadline from prior grant evidence',()=>{
 const prior=mergeReviewItems([], [{...candidate,dueAt:'2026-11-01T16:00:00.000Z'}], [{...evidence,dueAt:'2026-11-01T16:00:00.000Z'}], {now,scopeKey:scope.key});
 const value=mergeReviewItems(prior,[candidate],[evidence],{now,scopeKey:scope.key,grantScopeKey});assert.equal(value[0].dueAt,undefined);assert.equal(value[0].dueAtBasis,undefined);assert.equal(value[0].grantScopeKey,grantScopeKey);
});

test('exact owner binding and grant expose only bounded actionable metadata from stored current items',async()=>{
 const {projectReviewWorkbench}=await api(),p=projectReviewWorkbench(input());
 assert.equal(p.attentionItems.available,true);assert.equal(p.attentionItems.coverage,'stored-only');assert.equal(p.attentionItems.items.length,1);
 const row=p.attentionItems.items[0];assert.equal(row.summary,candidate.summary);assert.equal(row.why,candidate.why);assert.equal(row.action,candidate.action);assert.equal(row.unknown,candidate.unknown);
 assert.equal(row.sources[0].source,'gmail');assert.equal(row.sources[0].url,evidence.url);assert.equal(row.lastSeenAt,now);
 for(const forbidden of ['synthetic-private-body','synthetic-private-source-title',evidence.id,'scopeKey','grantScopeKey','evidenceDigests','sourceTask',caller.cwd,binding,grant])assert.equal(JSON.stringify(p).includes(forbidden),false,forbidden);
 assert.deepEqual(Object.keys(row.sources[0]).sort(),['source','label','at','contentState','truncated','url'].sort());
});

test('wrong owner member binding grant malformed storage and unconfirmed items never reveal private card fields',async()=>{
 const {projectReviewWorkbench}=await api();
 for(const change of [{caller:{...caller,sessionId:'another-owner'}},{caller:{...caller,sessionId:'family_member_synthetic'}},{caller:{...caller,cwd:'/another'}},{bindingKey:'c'.repeat(64)},{grant:'d'.repeat(64)},{reviewState:{invalid:'synthetic-private-body'}},{reviewState:raw({items:mergeReviewItems([], [candidate], [evidence], {now,scopeKey:scope.key})})}]){
  const p=projectReviewWorkbench(input(change));assert.equal(p.attentionItems.available,false,JSON.stringify(change));assert.deepEqual(p.attentionItems.items,[]);assert.equal(p.attentionItems.coverage,'unconfirmed');assert.equal(JSON.stringify(p).includes('synthetic-private-body'),false);assert.equal(JSON.stringify(p).includes(candidate.title),false);
 }
});

test('stored-only selection excludes handled dismissed future-snoozed past meetings and another source or scope',async()=>{
 const {projectReviewWorkbench}=await api(),base=items()[0],variants=[base,...['handled','dismissed','snoozed'].map((status,i)=>({...base,id:'review_'+String(i).repeat(32),status,...(status==='snoozed'?{snoozeUntil:'2026-11-01T00:00:00.000Z'}:{})})),{...base,id:'review_'+'4'.repeat(32),scopeKey:'f'.repeat(64)},{...base,id:'review_'+'5'.repeat(32),evidence:[{...base.evidence[0],source:'flomo'}]},{...base,id:'review_'+'6'.repeat(32),kind:'event',eventStartAt:'2026-10-29T00:00:00.000Z',eventEndAt:'2026-10-29T01:00:00.000Z'}];
 const p=projectReviewWorkbench(input({reviewState:raw({items:variants})}));assert.deepEqual(p.attentionItems.items.map(i=>i.id),[base.id]);assert.equal(p.attentionItems.coverage,'unconfirmed');
});

test('projection redacts local paths and credential material and accepts only provider https references without query',async()=>{
 const {projectReviewWorkbench}=await api(),base=items()[0];
 const refs=[evidence,{...evidence,id:'query',url:'https://mail.google.com/mail/u/0/?token=secret-query'},{...evidence,id:'foreign',url:'https://attacker.invalid/private'},{...evidence,id:'path',url:'https://mail.google.com/Users/shan/secret'},{...evidence,id:'insecure',url:'http://mail.google.com/mail/u/0/#all/id'}];
 const malicious={...base,title:'/Users/shan/private/report.md api_key=private-key',summary:'Bearer abcdef123456 /private/tmp/private-file C:\\Users\\shan\\private.txt',why:'configured-secret',evidence:refs.map(({text,...ref})=>ref)};
 const p=projectReviewWorkbench(input({reviewState:raw({items:[malicious]}),cleanText:value=>String(value).replaceAll('configured-secret','[已隐藏]')}));
 for(const secret of ['/Users/shan','private-key','abcdef123456','/private/tmp','C:\\Users','configured-secret','attacker.invalid','secret-query','user:password'])assert.equal(JSON.stringify(p).includes(secret),false,secret);
 assert.equal(p.attentionItems.items[0].sources[0].url,evidence.url);assert.ok(p.attentionItems.items[0].sources.slice(1).every(r=>r.url===null));assert.equal(p.attentionItems.items[0].truncated,true);
 const malformed=projectReviewWorkbench(input({reviewState:raw({items:[{...base,evidence:[{...base.evidence[0],url:'https://user:password@mail.google.com/private'}]}]})}));assert.equal(malformed.attentionItems.available,false);assert.deepEqual(malformed.attentionItems.items,[]);
});

test('cards are bounded to five and preserve incomplete body coverage instead of asserting no changes',async()=>{
 const {projectReviewWorkbench}=await api(),base=items()[0],many=Array.from({length:8},(_,i)=>({...base,id:'review_'+String(i).repeat(32),evidence:[{...base.evidence[0],contentState:'truncated'}]}));
 const p=projectReviewWorkbench(input({reviewState:raw({items:many})}));assert.equal(p.attentionItems.items.length,5);assert.equal(p.attentionItems.truncated,true);assert.equal(p.attentionItems.items[0].sources[0].truncated,true);assert.doesNotMatch(p.attentionItems.note,/没有变化|全部已处理/);
});

test('saved schedules require original owner and binding and never claim runtime or phone receipt',async()=>{
 const {projectReviewWorkbench}=await api(),subscription={...scope,schedule:{dailyTime:'09:00',weeklyDay:1,weeklyTime:'09:00',timeZone:'America/Mexico_City'},createdAt:now,paused:true};
 const newsState={id:'profile',version:2,schedule:{time:'08:00',timeZone:'UTC',sessionId:caller.sessionId,bindingKey:binding,createdAt:now},preferences:null,jobs:[],articleHistory:[],dailyDates:[],receipts:[]};
 const p=projectReviewWorkbench(input({reviewState:raw({subscription}),newsState}));assert.equal(p.schedules.available,true);assert.equal(p.schedules.items.length,2);assert.equal(p.schedules.items.find(i=>i.source==='personal-review').status,'paused');
 for(const row of p.schedules.items){assert.equal(row.runtime,'unverified');assert.equal(row.phoneReceipt,'unverified');assert.equal(JSON.stringify(row).includes(binding),false);assert.equal(JSON.stringify(row).includes(caller.sessionId),false);}
 const changed=projectReviewWorkbench(input({reviewState:raw({subscription}),newsState,newsBindingKey:'c'.repeat(64)}));assert.equal(changed.schedules.available,false);assert.equal(changed.schedules.items.some(i=>i.source==='news'),false);
});

test('guarded raw-row reader discards private projections when ownership changes during awaits without service or write calls',async()=>{
 const {createReviewWorkbenchReader}=await api();let current=true,release,entered,sourceReads=0,modelCalls=0,stateWrites=0;
 const waiting=new Promise(r=>release=r),started=new Promise(r=>entered=r),deps={readReviewState:async()=>{entered();await waiting;return raw();},readNewsState:async()=>null,readConnection:async()=>current?route:{...route,bindingKey:'c'.repeat(64)},resolveOwner:()=>caller,authorizeReview:async()=>({bindingKey:binding,grant}),readNewsBinding:async()=>({bound:true,bindingKey:binding}),readProjects:async()=>[],clock:()=>new Date(now),isClosed:()=>false,collect:()=>sourceReads++,summarize:()=>modelCalls++,put:()=>stateWrites++};
 const read=createReviewWorkbenchReader(deps),pending=read({bindingRevision:bindingRevision(route)});await started;current=false;release();const p=await pending;
 assert.equal(p.available,false);assert.equal(p.attentionItems.available,false);assert.deepEqual(p.attentionItems.items,[]);assert.equal(JSON.stringify(p).includes(candidate.title),false);assert.equal(sourceReads,0);assert.equal(modelCalls,0);assert.equal(stateWrites,0);
});

test('guarded reader authorizes stored exact scope and returns no repair or automatic generation',async()=>{
 const {createReviewWorkbenchReader}=await api();let authorizations=0,sourceReads=0,modelCalls=0,stateWrites=0;
 const read=createReviewWorkbenchReader({readReviewState:async()=>raw(),readNewsState:async()=>null,readConnection:async()=>route,resolveOwner:()=>caller,authorizeReview:async(actual,selected)=>{assert.deepEqual(actual,caller);assert.equal(selected.grant,grant);authorizations++;return{bindingKey:binding,grant};},readNewsBinding:async()=>({bound:true,bindingKey:binding}),readProjects:async()=>[],clock:()=>new Date(now),isClosed:()=>false,collect:()=>sourceReads++,summarize:()=>modelCalls++,put:()=>stateWrites++});
 const p=await read({bindingRevision:bindingRevision(route)});assert.equal(p.available,true);assert.equal(p.attentionItems.items.length,1);assert.ok(authorizations>=2);assert.equal(sourceReads,0);assert.equal(modelCalls,0);assert.equal(stateWrites,0);
});

test('actual synthetic generation marks only touched candidates and leaves old stored items unconfirmed',async()=>{
 const legacy=mergeReviewItems([], [candidate,{...candidate,key:'old-independent',title:'未重新观察的旧事项'}], [evidence], {now,scopeKey:scope.key});let stored=raw({items:legacy}),reads=0,models=0;
 const service=createPersonalReviewService({store:{get:async()=>structuredClone(stored),put:async(_key,value)=>stored=structuredClone(value)},readBinding:async()=>({bound:true,bindingKey:binding}),authorization:async()=>grant,collect:async()=>{reads++;return{evidence:[evidence],coverage:[{source:'gmail',status:'ok',count:1}]};},summarize:async()=>{models++;return{items:[candidate]};},send:async()=>assert.fail('preview cannot send'),clock:()=>new Date(now)});
 await service.ready();await service.act(caller,{action:'preview',sources:['gmail'],projects:[]});
 assert.equal(stored.items.find(i=>i.title===candidate.title).grantScopeKey,grantScopeKey);assert.equal(stored.items.find(i=>i.title==='未重新观察的旧事项').grantScopeKey,undefined);assert.equal(reads,1);assert.equal(models,1);await service.close();
});

test('credential-shaped strings and arbitrary absolute paths are removed and malformed schedule zones fail closed',async()=>{
 const {projectReviewWorkbench}=await api(),base=items()[0],secret='sk-proj-'+'A'.repeat(48),malicious={...base,summary:`/secret/folder/report.txt ${secret}`};
 const p=projectReviewWorkbench(input({reviewState:raw({items:[malicious]})}));assert.equal(p.attentionItems.items.length,1);assert.equal(JSON.stringify(p).includes('/secret/folder'),false);assert.equal(JSON.stringify(p).includes(secret),false);
 const subscription={...scope,schedule:{dailyTime:'09:00',timeZone:'/Users/shan/private'},createdAt:now,paused:false};const bad=projectReviewWorkbench(input({reviewState:raw({subscription})}));assert.equal(bad.available,false);assert.equal(JSON.stringify(bad).includes('/Users/shan'),false);
});

test('changed final grant and foreign news settings remain unavailable without exposing saved private fields',async()=>{
 const {createReviewWorkbenchReader,projectReviewWorkbench}=await api();let checks=0;
 const read=createReviewWorkbenchReader({readReviewState:async()=>raw(),readNewsState:async()=>null,readConnection:async()=>route,resolveOwner:()=>caller,authorizeReview:async()=>({bindingKey:binding,grant:++checks===1?grant:'c'.repeat(64)}),readNewsBinding:async()=>({bound:true,bindingKey:binding}),readProjects:async()=>[],clock:()=>new Date(now)});
 const result=await read({bindingRevision:bindingRevision(route)});assert.equal(result.available,false);assert.deepEqual(result.attentionItems.items,[]);
 const newsState={id:'profile',version:2,schedule:{time:'08:00',timeZone:'UTC',sessionId:'foreign-owner',bindingKey:binding,createdAt:now},preferences:{topics:['synthetic-private-topic'],source:'explicit',sessionId:'foreign-owner',bindingKey:binding,updatedAt:now},jobs:[],articleHistory:[],dailyDates:[],receipts:[]};
 const projected=projectReviewWorkbench(input({newsState}));assert.equal(projected.schedules.available,false);assert.equal(JSON.stringify(projected).includes('synthetic-private-topic'),false);assert.equal(projected.schedules.items.length,0);
});
