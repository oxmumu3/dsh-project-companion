import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const endpoint='/api/project_companion/onboarding';
async function loadClient(){
  const source=await readFile(new URL('../src/client.js',import.meta.url),'utf8');
  const registrations=[],effects=[],requests=[],opened=[];
  let descriptor;
  let values=[],cursor=0,pending=[];
  const react={
    createElement:(type,props,...children)=>({type,props:props??{},children:children.flat().filter(x=>x!==null&&x!==undefined&&x!==false)}),
    useState:initial=>{const i=cursor++;if(!(i in values))values[i]=typeof initial==='function'?initial():initial;return[values[i],next=>{values[i]=typeof next==='function'?next(values[i]):next;}];},
    useEffect:(fn,deps)=>{const i=cursor++;const old=values[i];if(!old||!deps||deps.some((x,j)=>x!==old.deps[j])){old?.cleanup?.();values[i]={deps,cleanup:undefined};pending.push(()=>{values[i].cleanup=fn();});}},
    useRef:initial=>{const i=cursor++;if(!(i in values))values[i]={current:initial};return values[i];},
    useCallback:(fn)=>fn,
  };
  const timers=new Map(),intervals=[];let timerId=0;
  const context={now:0,Date:{now:()=>context.now},window:{__ModuleLoader__:{load:definition=>{descriptor=definition;}}},setInterval:(fn,ms)=>{intervals.push(ms);timers.set(++timerId,fn);return timerId;},clearInterval:id=>timers.delete(id),AbortController,AbortSignal,Response,fetch:async(url,options={})=>{requests.push({url,options});if(context.onFetch)return context.onFetch(url,options);return Response.json(context.snapshot);}};
  vm.runInNewContext(source,context);
  const module=descriptor.factory(name=>{if(name==='react')return react;if(name==='@deepseek-ai/dsh-client-ui-primitives')return{Modal:'modal'};throw new Error(`unexpected dependency ${name}`);});
  const ctx={slots:{inject:(_name,fn)=>fn(),register:(definition,component)=>{const row={definition,component,disposed:false};registrations.push(row);return()=>{row.disposed=true;};}},effect:fn=>effects.push(fn()),uiWorkspace:{openSession:id=>opened.push(id)}};
  module.apply(ctx);
  const render=(kind='settings.section',props={})=>{cursor=0;const entry=registrations.find(x=>x.definition.name===kind);return entry.component(props);};
  const flush=async()=>{const work=pending;pending=[];work.forEach(fn=>fn());await new Promise(resolve=>setImmediate(resolve));};
  return{source,module,descriptor,registrations,requests,opened,context,timers,intervals,render,flush,dispose:()=>{effects.forEach(fn=>fn?.());values.forEach(v=>v?.cleanup?.());}};
}
const nodes=(tree,predicate)=>{const result=[];const visit=value=>{if(!value||typeof value!=='object')return;if(predicate(value))result.push(value);for(const child of value.children??[])visit(child);};visit(tree);return result;};
const text=tree=>{let out='';const visit=value=>{if(typeof value==='string'||typeof value==='number'){out+=`${value} `;return;}for(const child of value?.children??[])visit(child);};visit(tree);return out;};
const snapshot=(connection,extra={})=>({version:1,completed:false,connection,projects:[{id:'p1',label:'公开项目',watched:false}],...extra});

test('client registers owned settings and onboarding surfaces; opening only reads sanitized state',async()=>{
  const c=await loadClient();c.context.snapshot=snapshot({state:'waiting-qr',qrAvailable:true,qrRevision:'1234567890abcdef'});
  assert.equal(c.descriptor.id,'@oxmumu3/dsh-project-companion');
  assert.equal(c.registrations.length,2);
  c.render();await c.flush();const view=c.render();
  assert.equal(c.requests.length,1);assert.equal(c.requests[0].url,endpoint);assert.equal(c.requests[0].options.method??'GET','GET');
  assert.equal(nodes(view,n=>n.type==='img')[0].props.src,'/wechat/api/qr-image?v=1234567890abcdef');
  assert.equal(c.opened.length,0);c.dispose();assert.ok(c.registrations.every(x=>x.disposed));assert.equal(c.timers.size,0);
});

test('existing binding is retained and QR or reconnect actions are never offered',async()=>{
  const c=await loadClient();c.context.snapshot=snapshot({state:'bound',sessionId:'existing-session'});
  c.render();await c.flush();const view=c.render();
  assert.match(text(view),/已连接/);assert.equal(nodes(view,n=>n.type==='img').length,0);
  assert.equal(c.requests.every(x=>(x.options.method??'GET')==='GET'),true);
  assert.equal(c.requests.every(x=>x.url===endpoint),true);
  c.dispose();
});

test('successful scan with no source session asks for first WeChat message without claiming connected',async()=>{
  const c=await loadClient();c.context.snapshot=snapshot({state:'awaiting-message'});
  c.render();await c.flush();const view=c.render();
  assert.match(text(view),/你好/);assert.match(text(view),/首条/);assert.equal(c.opened.length,0);
  const finish=nodes(view,n=>n.type==='button'&&/生成首份简报并回到微信|查看已提交的首份简报/.test(text(n)))[0];assert.equal(finish.props.disabled,true);
  c.dispose();
});

test('project selection is explicit and first brief appears as escaped text',async()=>{
  const c=await loadClient();c.context.snapshot=snapshot({state:'bound',sessionId:'real-session'});
  c.render();await c.flush();let view=c.render();
  const checkbox=nodes(view,n=>n.type==='input'&&n.props.type==='checkbox')[0];checkbox.props.onChange({target:{checked:true}});view=c.render();
  const preview=nodes(view,n=>n.type==='button'&&text(n).includes('保存关注并预览简报'))[0];assert.equal(preview.props.disabled,false);
  c.context.snapshot=snapshot({state:'bound',sessionId:'real-session'},{projects:[{id:'p1',label:'公开项目',watched:true}],firstBrief:'<script>private()</script>'});
  await preview.props.onClick();view=c.render();
  const post=c.requests.find(x=>x.options.method==='POST');assert.ok(post);assert.deepEqual(JSON.parse(post.options.body),{action:'select_projects',projectIds:['p1']});
  assert.match(text(view),/<script>private\(\)<\/script>/);assert.equal(nodes(view,n=>n.props.dangerouslySetInnerHTML).length,0);assert.equal(c.opened.length,0);
  c.dispose();
});

test('explicit first brief submits once and requires phone receipt confirmation before closing',async()=>{
  const c=await loadClient();c.context.snapshot=snapshot({state:'bound',sessionId:'real-session'},{projects:[{id:'p1',label:'公开项目',watched:true}],firstBrief:'变化：无；阻塞：待确认；下一步：继续。'});
  let completed=0,closed=0;c.render('settings.section',{close:()=>closed++});await c.flush();const view=c.render('settings.section',{close:()=>closed++});
  const finish=nodes(view,n=>n.type==='button'&&/生成首份简报并回到微信|查看已提交的首份简报/.test(text(n)))[0];assert.equal(finish.props.disabled,false);
  c.context.snapshot={...c.context.snapshot,completed:true,welcome:{status:'accepted',outcome:{status:'generated',reply:'<script>brief()</script>'},receipt:{status:'unconfirmed'}}};await finish.props.onClick();
  assert.deepEqual(c.opened,[]);assert.equal(closed,0);assert.deepEqual(JSON.parse(c.requests.at(-1).options.body),{action:'complete'});
  let receiptView=c.render('settings.section',{close:()=>closed++});assert.match(text(receiptView),/简报已生成/);assert.match(text(receiptView),/<script>brief\(\)<\/script>/);assert.equal(nodes(receiptView,n=>n.props.dangerouslySetInnerHTML).length,0);
  c.context.snapshot={...c.context.snapshot,welcome:{...c.context.snapshot.welcome,receipt:{status:'user_confirmed',receivedAt:'2026-10-19T18:00:00Z'}}};
  await nodes(receiptView,n=>n.type==='button'&&text(n).includes('我已在微信收到'))[0].props.onClick();
  assert.equal(closed,1);assert.deepEqual(JSON.parse(c.requests.at(-1).options.body),{action:'confirm_received'});assert.equal(completed,0);c.dispose();
});

test('unknown status does not show QR or enable project mutation; completed onboarding exits without navigation',async()=>{
  const c=await loadClient();c.context.snapshot=snapshot({state:'unknown'});c.render();await c.flush();const view=c.render();
  assert.equal(nodes(view,n=>n.type==='img').length,0);assert.match(text(view),/连接状态/);
  assert.equal(nodes(view,n=>n.type==='button'&&text(n).includes('保存关注并预览简报'))[0].props.disabled,true);
  c.dispose();
  const done=await loadClient();done.context.snapshot=snapshot({state:'bound',sessionId:'real-session'},{completed:true});let complete=0;
  done.render('settings.onboarding',{complete:()=>complete++});await done.flush();done.render('settings.onboarding',{complete:()=>complete++});await done.flush();
  assert.equal(complete,1);assert.equal(done.opened.length,0);assert.equal(done.requests.length,1);done.dispose();
});

test('uncertain first-brief submission is never retried automatically or by repeated click',async()=>{
  const c=await loadClient();c.context.snapshot=snapshot({state:'bound',sessionId:'real-session'},{projects:[{id:'p1',label:'公开项目',watched:true}]});
  c.render();await c.flush();let view=c.render();
  c.context.snapshot={...c.context.snapshot,welcome:{status:'unknown'}};
  const finish=nodes(view,n=>n.type==='button'&&/生成首份简报并回到微信|查看已提交的首份简报/.test(text(n)))[0];await finish.props.onClick();
  view=c.render();assert.match(text(view),/未重复提交/);assert.equal(nodes(view,n=>n.type==='button'&&/生成首份简报并回到微信|查看已提交的首份简报/.test(text(n)))[0].props.disabled,true);
  await finish.props.onClick();assert.equal(c.requests.filter(x=>x.options.method==='POST').length,1);assert.equal(c.opened.length,0);
  c.dispose();
});

test('leaving setup aborts pending submission and stale success cannot navigate the user',async()=>{
  const c=await loadClient();c.context.snapshot=snapshot({state:'bound',sessionId:'real-session'},{projects:[{id:'p1',label:'公开项目',watched:true}]});
  c.render();await c.flush();const view=c.render();let resolve,signal;
  c.context.onFetch=(_url,options)=>{signal=options.signal;return new Promise(done=>{resolve=done;});};
  const pending=nodes(view,n=>n.type==='button'&&/生成首份简报并回到微信|查看已提交的首份简报/.test(text(n)))[0].props.onClick();
  c.dispose();assert.equal(signal.aborted,true);resolve(Response.json({...c.context.snapshot,completed:true,welcome:{status:'accepted'}}));await pending;
  assert.equal(c.opened.length,0);
});

test('login polling stops after ten minutes, uses slower unknown checks, and binding stops timers',async()=>{
  const c=await loadClient();c.context.snapshot=snapshot({state:'waiting-qr',qrAvailable:true,qrRevision:'1234567890abcdef'});
  c.render();await c.flush();c.render();await c.flush();assert.equal(c.timers.size,1);assert.equal(c.intervals.at(-1),2000);
  c.context.now=600001;for(const tick of [...c.timers.values()])await tick();await c.flush();
  assert.equal(c.timers.size,0);assert.equal(c.requests.length,1);assert.match(text(c.render()),/已停止自动刷新/);
  const manual=nodes(c.render(),n=>n.type==='button'&&text(n).includes('刷新连接状态'))[0];await manual.props.onClick();assert.equal(c.requests.length,2);c.dispose();
  const unknown=await loadClient();unknown.context.snapshot=snapshot({state:'unknown'});unknown.render();await unknown.flush();unknown.render();await unknown.flush();assert.equal(unknown.intervals.at(-1),5000);
  unknown.context.snapshot=snapshot({state:'bound',sessionId:'real-session'});for(const tick of [...unknown.timers.values()])await tick();await unknown.flush();unknown.render();await unknown.flush();assert.equal(unknown.timers.size,0);unknown.dispose();
});

test('QR rotation updates image by safe revision and never accepts a raw URL as its source',async()=>{
  const c=await loadClient();c.context.snapshot=snapshot({state:'waiting-qr',qrAvailable:true,qrRevision:'1234567890abcdef'});c.render();await c.flush();let view=c.render();await c.flush();
  assert.equal(nodes(view,n=>n.type==='img')[0].props.src,'/wechat/api/qr-image?v=1234567890abcdef');
  c.context.snapshot=snapshot({state:'waiting-qr',qrAvailable:true,qrRevision:'fedcba0987654321'});for(const tick of [...c.timers.values()])await tick();await c.flush();view=c.render();
  assert.equal(nodes(view,n=>n.type==='img')[0].props.src,'/wechat/api/qr-image?v=fedcba0987654321');
  c.context.snapshot=snapshot({state:'waiting-qr',qrAvailable:true,qrRevision:'https://untrusted.example/secret'});for(const tick of [...c.timers.values()])await tick();await c.flush();view=c.render();assert.equal(nodes(view,n=>n.type==='img')[0].props.src,'/wechat/api/qr-image');c.dispose();
});

test('definite pre-admission HTTP rejections leave both setup actions retryable',async()=>{
  for(const status of [401,403,413,415]){
    const c=await loadClient();c.context.snapshot=snapshot({state:'bound',sessionId:'real-session'},{projects:[{id:'p1',label:'公开项目',watched:true}]});
    c.render();await c.flush();let view=c.render();c.context.onFetch=()=>new Response('',{status});
    await nodes(view,n=>n.type==='button'&&/生成首份简报并回到微信|查看已提交的首份简报/.test(text(n)))[0].props.onClick();view=c.render();
    c.context.onFetch=null;await nodes(view,n=>n.type==='button'&&text(n).includes('刷新连接'))[0].props.onClick();view=c.render();
    assert.equal(nodes(view,n=>n.type==='button'&&/生成首份简报并回到微信|查看已提交的首份简报/.test(text(n)))[0].props.disabled,false,`complete rejected ${status}`);
    assert.equal(nodes(view,n=>n.type==='button'&&text(n).includes('保存关注'))[0].props.disabled,false,`selection rejected ${status}`);
    c.dispose();
  }
});

test('selection errors recover from authoritative watched state and prune disappeared project drafts',async()=>{
  const c=await loadClient();c.context.snapshot=snapshot({state:'bound',sessionId:'real-session'});c.render();await c.flush();let view=c.render();
  nodes(view,n=>n.type==='input')[0].props.onChange({target:{checked:true}});view=c.render();
  c.context.onFetch=()=>{throw new Error('lost response');};await nodes(view,n=>n.type==='button'&&text(n).includes('保存关注'))[0].props.onClick();
  c.context.onFetch=null;c.context.snapshot=snapshot({state:'bound',sessionId:'real-session'},{projects:[{id:'p1',label:'公开项目',watched:true}]});
  await nodes(c.render(),n=>n.type==='button'&&text(n).includes('刷新连接'))[0].props.onClick();view=c.render();
  assert.equal(nodes(view,n=>n.type==='button'&&/生成首份简报并回到微信|查看已提交的首份简报/.test(text(n)))[0].props.disabled,false);
  assert.equal(nodes(view,n=>n.type==='button'&&text(n).includes('保存关注'))[0].props.disabled,false);
  c.context.onFetch=()=>new Response('',{status:400});await nodes(view,n=>n.type==='button'&&text(n).includes('保存关注'))[0].props.onClick();
  c.context.onFetch=null;c.context.snapshot=snapshot({state:'bound',sessionId:'real-session'},{projects:[{id:'p2',label:'新项目',watched:false}]});
  await nodes(c.render(),n=>n.type==='button'&&text(n).includes('刷新连接'))[0].props.onClick();view=c.render();
  nodes(view,n=>n.type==='input')[0].props.onChange({target:{checked:true}});view=c.render();await nodes(view,n=>n.type==='button'&&text(n).includes('保存关注'))[0].props.onClick();
  assert.deepEqual(JSON.parse(c.requests.at(-1).options.body),{action:'select_projects',projectIds:['p2']});c.dispose();
});

test('lost complete response reconciles by welcome state without duplicating an accepted brief',async()=>{
  for(const failureMode of ['network','generic-400'])for(const welcomeStatus of ['accepted','unknown','none','absent','blocked']){
    const c=await loadClient();c.context.snapshot=snapshot({state:'bound',sessionId:'real-session'},{projects:[{id:'p1',label:'公开项目',watched:true}]});c.render();await c.flush();let view=c.render();
    c.context.onFetch=()=>{if(failureMode==='generic-400')return new Response('',{status:400});throw new Error('lost complete response');};
    const oldFinish=nodes(view,n=>n.type==='button'&&/生成首份简报并回到微信|查看已提交的首份简报/.test(text(n)))[0];await oldFinish.props.onClick();
    c.context.onFetch=null;c.context.snapshot={...c.context.snapshot,completed:welcomeStatus==='accepted',...(welcomeStatus==='absent'?{}:{welcome:{status:welcomeStatus}})};
    await nodes(c.render(),n=>n.type==='button'&&text(n).includes('刷新连接'))[0].props.onClick();view=c.render();
    const finish=nodes(view,n=>n.type==='button'&&/生成首份简报并回到微信|查看已提交的首份简报/.test(text(n)))[0];
    if(welcomeStatus==='unknown'){assert.equal(finish.props.disabled,true);await finish.props.onClick();assert.equal(c.requests.filter(r=>r.options.method==='POST').length,1);}
    else if(welcomeStatus==='accepted'){assert.equal(finish.props.disabled,false);assert.match(text(finish),/查看已提交的首份简报/);await oldFinish.props.onClick();assert.deepEqual(c.opened,[]);assert.equal(c.requests.filter(r=>r.options.method==='POST').length,1);}
    else{assert.equal(finish.props.disabled,false);c.context.snapshot={...c.context.snapshot,completed:true,welcome:{status:'accepted'}};await finish.props.onClick();assert.equal(c.requests.filter(r=>r.options.method==='POST').length,2);}
    c.dispose();
  }
});

test('first binding merges four watched projects and permits only one additional choice',async()=>{
  const c=await loadClient();c.context.snapshot=snapshot({state:'awaiting-message'},{projects:[]});c.render();await c.flush();c.render();await c.flush();
  c.context.snapshot=snapshot({state:'bound',sessionId:'real-session'},{projects:Array.from({length:6},(_,i)=>({id:`p${i+1}`,label:`项目${i+1}`,watched:i<4}))});
  for(const tick of [...c.timers.values()])await tick();await c.flush();let view=c.render();
  let boxes=nodes(view,n=>n.type==='input');assert.equal(boxes.filter(n=>n.props.checked).length,4);
  boxes[4].props.onChange({target:{checked:true}});view=c.render();boxes=nodes(view,n=>n.type==='input');assert.equal(boxes[5].props.disabled,true);
  await nodes(view,n=>n.type==='button'&&text(n).includes('保存关注'))[0].props.onClick();assert.equal(JSON.parse(c.requests.at(-1).options.body).projectIds.length,5);c.dispose();
});

test('failed status refresh invalidates stale binding or QR and switches to slower unknown polling',async()=>{
  for(const connection of [{state:'bound',sessionId:'real-session'},{state:'waiting-qr',qrAvailable:true,qrRevision:'1234567890abcdef'}]){
    const c=await loadClient();c.context.snapshot=snapshot(connection,{projects:[{id:'p1',label:'公开项目',watched:true}]});c.render();await c.flush();let view=c.render();await c.flush();
    const oldComplete=nodes(view,n=>n.type==='button'&&/生成首份简报并回到微信|查看已提交的首份简报/.test(text(n)))[0];
    c.context.onFetch=()=>{throw new Error('offline');};await nodes(view,n=>n.type==='button'&&text(n).includes('刷新连接'))[0].props.onClick();view=c.render();await c.flush();
    assert.doesNotMatch(text(view),/已连接微信/);assert.equal(nodes(view,n=>n.type==='img').length,0);assert.equal(nodes(view,n=>n.type==='button'&&/生成首份简报并回到微信|查看已提交的首份简报/.test(text(n)))[0].props.disabled,true);assert.equal(nodes(view,n=>n.type==='button'&&text(n).includes('保存关注'))[0].props.disabled,true);assert.equal(c.intervals.at(-1),5000);
    assert.match(text(view),/公开项目/);const count=c.requests.length;await oldComplete.props.onClick();assert.equal(c.requests.length,count,'stale bound handler cannot mutate after failed GET');c.context.onFetch=null;await nodes(c.render(),n=>n.type==='button'&&text(n).includes('刷新连接'))[0].props.onClick();view=c.render();assert.match(text(view),connection.state==='bound'?/已连接微信/:/扫描/);c.dispose();
  }
});


test('new onboarding keeps generated outcome open until an explicit receipt, with no auto navigation',async()=>{
  const c=await loadClient();c.context.snapshot=snapshot({state:'bound',sessionId:'real-session'},{projects:[{id:'p1',label:'公开项目',watched:true}]});let complete=0;const props={complete:()=>complete++};
  c.render('settings.onboarding',props);await c.flush();let view=c.render('settings.onboarding',props);
  c.context.snapshot={...c.context.snapshot,completed:true,welcome:{status:'accepted',outcome:{status:'running'},receipt:{status:'unconfirmed'}}};
  await nodes(view,n=>n.type==='button'&&text(n).includes('生成首份简报并回到微信'))[0].props.onClick();view=c.render('settings.onboarding',props);await c.flush();
  assert.equal(complete,0);assert.match(text(view),/正在整理/);assert.equal(c.opened.length,0);
  c.context.snapshot={...c.context.snapshot,welcome:{status:'accepted',outcome:{status:'generated',reply:'本轮简报：等待核对'},receipt:{status:'unconfirmed'}}};
  await nodes(view,n=>n.type==='button'&&text(n).includes('刷新简报状态'))[0].props.onClick();view=c.render('settings.onboarding',props);await c.flush();assert.equal(complete,0);assert.match(text(view),/等待核对/);
  c.context.snapshot={...c.context.snapshot,welcome:{...c.context.snapshot.welcome,receipt:{status:'user_confirmed',receivedAt:'2026-10-19T18:00:00Z'}}};
  await nodes(view,n=>n.type==='button'&&text(n).includes('我已在微信收到'))[0].props.onClick();c.render('settings.onboarding',props);await c.flush();assert.equal(complete,1);assert.equal(c.requests.filter(r=>r.options.method==='POST').length,2);assert.equal(c.opened.length,0);c.dispose();
});
