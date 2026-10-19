import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const endpoint='/api/project_companion/workbench';
const sample=()=>({version:1,generatedAt:'2026-10-19T17:00:00.000Z',hostTimeZone:'America/Mexico_City',paused:false,availability:{projects:true,plans:true,jobs:true},
  connection:{state:'bound',sessionId:'dot-source'},counts:{projects:2,activeReminders:1},daily:null,
  projects:[{id:'p1',label:'公开项目 A',sessionIds:['session-a'],watchedAt:'2026-10-18T00:00:00.000Z',sources:[{name:'README.md',status:'ok',text:'<script>not executable</script>\n待验证的产品说明',updatedAt:'2026-10-19T16:00:00.000Z',truncated:false}],events:[{kind:'assistant',text:'本轮待用户验收',at:'2026-10-19T16:15:00.000Z'}]},
    {id:'p2',label:'公开项目 B',sessionIds:['session-b1','session-b2'],sources:[],events:[]}],
  jobs:[{id:'j1',projectLabel:'公开项目 A',task:'只读检查说明',status:'completed',createdAt:'2026-10-19T16:00:00.000Z',finishedAt:'2026-10-19T16:01:00.000Z',delivery:{status:'reported_sent'}}],
  reminders:[{id:'r1',title:'核对演示',dueAt:'2026-10-20T17:00:00.000Z',status:'scheduled'}],limitations:[]});

async function harness({layout=true}={}){
  const source=await readFile(new URL('../src/client.js',import.meta.url),'utf8');
  const registrations=[],cleanups=[],requests=[],opened=[],panels=[];
  let descriptor,cursor=0,values=[],pending=[];
  const react={createElement:(type,props,...children)=>({type,props:props??{},children:children.flat(Infinity).filter(x=>x!==null&&x!==undefined&&x!==false)}),
    useState:initial=>{const i=cursor++;if(!(i in values))values[i]=typeof initial==='function'?initial():initial;return[values[i],next=>{values[i]=typeof next==='function'?next(values[i]):next;}];},
    useRef:initial=>{const i=cursor++;if(!(i in values))values[i]={current:initial};return values[i];},
    useEffect:(fn,deps)=>{const i=cursor++;const old=values[i];if(!old||!deps||deps.some((x,j)=>x!==old.deps[j])){old?.cleanup?.();values[i]={deps,cleanup:null};pending.push(()=>{values[i].cleanup=fn();});}},
    useCallback:fn=>fn};
  const context={window:{__ModuleLoader__:{load:definition=>{descriptor=definition;}}},Date,URL,AbortController,AbortSignal,setInterval,clearInterval,fetch:async(url,options)=>{requests.push({url,options});return context.onFetch?context.onFetch(url,options):Response.json(context.snapshot);},snapshot:sample()};
  vm.runInNewContext(source,context);
  const module=descriptor.factory(id=>id==='react'?react:id==='@deepseek-ai/dsh-client-ui-primitives'?{Modal:'modal'}:(()=>{throw new Error(`unexpected module ${id}`);})());
  const ctx={effect:fn=>cleanups.push(fn()),slots:{inject:(_name,fn)=>fn(),register:(spec,component)=>{const item={spec,component,disposed:false};registrations.push(item);return()=>{item.disposed=true;};}},
    uiWorkspace:{openSession:id=>{opened.push(id);if(context.navError)throw new Error('synthetic navigation failure');}},...(layout?{layout:{selectPanel:id=>panels.push(id)}}:{})};
  module.apply(ctx);
  const panel=()=>registrations.find(row=>row.spec.name==='main'&&row.spec.key==='project-companion-dot');
  const render=()=>{cursor=0;assert.ok(panel(),'native Dot main panel must be registered');return panel().component({});};
  const flush=async()=>{const run=pending;pending=[];run.forEach(fn=>fn());await new Promise(resolve=>setImmediate(resolve));};
  const unmount=()=>{values.forEach(value=>value?.cleanup?.());values=[];pending=[];};
  return{module,source,ctx,context,registrations,requests,opened,panels,render,flush,unmount,dispose:()=>{unmount();cleanups.forEach(stop=>stop?.());}};
}
function nodes(tree,predicate){const result=[];const visit=value=>{if(!value||typeof value!=='object')return;if(predicate(value))result.push(value);for(const child of value.children??[])visit(child);};visit(tree);return result;}
function text(tree){if(typeof tree==='string'||typeof tree==='number')return String(tree);return(tree?.children??[]).map(text).join(' ');}
const button=(tree,label)=>nodes(tree,node=>node.type==='button'&&text(node).includes(label))[0];

test('adds a matching native sidebar/main pair without replacing the existing interface',async()=>{
  const h=await harness();const main=h.registrations.find(row=>row.spec.name==='main');
  const entry=h.registrations.find(row=>row.spec.name==='sidebar.panellist');
  assert.ok(main,'native main panel');assert.ok(entry,'persistent sidebar entry');assert.equal(main.spec.key,entry.spec.id);
  assert.equal(entry.spec.label,'DeepSeek Dot');assert.equal(h.registrations.some(row=>['root','sidebar','conversation.composer','conversation.chat.node'].includes(row.spec.name)),false);
  assert.ok(h.registrations.some(row=>row.spec.name==='settings.section'));assert.ok(h.registrations.some(row=>row.spec.name==='settings.onboarding'));
  assert.equal(h.requests.length,0);assert.equal(h.panels.length,0);assert.equal(h.opened.length,0);
  const icon=entry.component({size:18,active:false});assert.equal(nodes(icon,node=>node.type==='button').length,0);
  h.dispose();assert.ok(h.registrations.every(row=>row.disposed));
});

test('opening the page makes one GET and displays source content as text with honest result status',async()=>{
  const h=await harness();h.render();await h.flush();const view=h.render();
  assert.deepEqual(h.requests.map(row=>({url:row.url,method:row.options.method??'GET'})),[{url:endpoint,method:'GET'}]);
  assert.equal(h.requests[0].options.credentials,'same-origin');assert.equal(h.requests[0].options.cache,'no-store');
  assert.match(text(view),/公开项目 A/);assert.match(text(view),/README.md/);assert.match(text(view),/<script>not executable<\/script>/);
  assert.equal(nodes(view,node=>node.props.dangerouslySetInnerHTML).length,0);assert.equal(nodes(view,node=>node.type==='script').length,0);
  assert.match(text(view),/待验收/);assert.match(text(view),/手机送达未知/);assert.match(text(view),/核对演示/);
  assert.equal(h.opened.length,0);h.dispose();
});

test('project switching and navigation are explicit; multiple sessions are not picked automatically',async()=>{
  const h=await harness();h.render();await h.flush();let view=h.render();
  await button(view,'打开 Dot 会话').props.onClick();assert.deepEqual(h.opened,['dot-source']);
  await button(view,'打开项目会话').props.onClick();assert.deepEqual(h.opened,['dot-source','session-a']);
  button(view,'公开项目 B').props.onClick();view=h.render();assert.match(text(view),/选择会话/);
  assert.equal(h.opened.length,2);await button(view,'会话 2').props.onClick();assert.deepEqual(h.opened,['dot-source','session-a','session-b2']);
  assert.equal(h.requests.length,1);h.dispose();
});

test('unbound empty snapshot remains usable and never invents a connection or dispatch',async()=>{
  const h=await harness();h.context.snapshot={...sample(),connection:{state:'awaiting-message'},projects:[],jobs:[],reminders:[],counts:{projects:0,activeReminders:0}};
  h.render();await h.flush();const view=h.render();assert.match(text(view),/关注项目/);assert.match(text(view),/设置/);
  assert.equal(button(view,'打开 Dot 会话'),undefined);assert.equal(h.opened.length,0);assert.equal(h.requests.length,1);h.dispose();
});

test('failed refresh clears stale data, offers an explicit retry and does not repeat requests',async()=>{
  const h=await harness();h.render();await h.flush();let view=h.render();
  h.context.onFetch=()=>new Response('not available',{status:503});await button(view,'刷新').props.onClick();view=h.render();
  assert.match(text(view),/暂不可用/);assert.equal(text(view).includes('公开项目 A'),false);assert.equal(h.requests.length,2);
  assert.equal(button(view,'打开 Dot 会话'),undefined);h.dispose();
});

test('late responses after unmount are aborted and cannot navigate or show another project',async()=>{
  const h=await harness();let resolveResponse;h.context.onFetch=()=>new Promise(resolve=>{resolveResponse=resolve;});
  h.render();await h.flush();const signal=h.requests[0].options.signal;h.unmount();assert.equal(signal.aborted,true);
  resolveResponse(Response.json(sample()));await new Promise(resolve=>setImmediate(resolve));assert.equal(h.opened.length,0);h.dispose();
});

test('navigation failures surface without retrying or submitting work',async()=>{
  const h=await harness();h.render();await h.flush();h.context.navError=true;
  await button(h.render(),'打开 Dot 会话').props.onClick();assert.match(text(h.render()),/会话.*未能打开|无法打开.*会话/);
  assert.deepEqual(h.opened,['dot-source']);assert.equal(h.requests.length,1);h.dispose();
});

test('missing optional native layout service leaves existing settings usable',async()=>{
  const h=await harness({layout:false});assert.equal(h.registrations.some(row=>row.spec.name==='main'),false);
  assert.ok(h.registrations.some(row=>row.spec.name==='settings.section'));h.dispose();
});

test('unavailable lists and plans are shown as unknown rather than empty or disabled',async()=>{
  const h=await harness();h.context.snapshot={...sample(),availability:{projects:false,plans:false,jobs:false},projects:[],jobs:[],reminders:[],daily:null,paused:null,counts:{projects:0,activeReminders:0},limitations:['合成局部读取失败，未扩大范围。']};
  h.render();await h.flush();const view=h.render(),value=text(view);
  assert.match(value,/关注列表暂不可用/);assert.match(value,/交办状态尚未确认/);assert.match(value,/提醒与日报状态尚未确认/);
  assert.match(value,/合成局部读取失败/);assert.doesNotMatch(value,/还没有关注项目|暂无当前 Dot 会话的交办记录|暂无待触发|项目日报未开启/);
  h.dispose();
});

test('more active reminders than the visible window are labelled rather than called empty',async()=>{
  const h=await harness();h.context.snapshot={...sample(),reminders:sample().reminders,counts:{projects:2,activeReminders:25}};
  h.render();await h.flush();const view=h.render();assert.match(text(view),/仅显示.*条.*其余/);assert.match(text(view),/核对演示/);h.dispose();
});
