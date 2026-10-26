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

async function harness({layout=true,sessions,appearance=false}={}){
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
  const themeLayers=[];let formState={status:'ready',writable:true,revision:1,value:{dotAppearance:'native'}},formListeners=new Set();
  if(appearance){ctx.configForms={get:()=>({getSnapshot:()=>formState,subscribe:fn=>{formListeners.add(fn);return()=>formListeners.delete(fn);},mutate:async(ops,revision)=>{assert.equal(revision,formState.revision);assert.equal(ops[0].path[0],'dotAppearance');formState={...formState,revision:revision+1,value:{dotAppearance:ops[0].value}};formListeners.forEach(fn=>fn());return true;}})};ctx.theme={overrideTokens:()=>{const layer={active:true};themeLayers.push(layer);return()=>{layer.active=false;};}};}
  module.apply(ctx);
  const panel=()=>registrations.find(row=>row.spec.name==='main'&&row.spec.key==='project-companion-dot');
  const render=()=>{cursor=0;assert.ok(panel(),'native Dot main panel must be registered');return panel().component(sessions?{useSessions:selector=>selector({byId:sessions})}:{});};
  const flush=async()=>{const run=pending;pending=[];run.forEach(fn=>fn());await new Promise(resolve=>setImmediate(resolve));};
  const unmount=()=>{values.forEach(value=>value?.cleanup?.());values=[];pending=[];};
  return{module,source,ctx,context,registrations,requests,opened,panels,themeLayers,render,flush,unmount,dispose:()=>{unmount();cleanups.forEach(stop=>stop?.());}};
}
function nodes(tree,predicate){const result=[];const visit=value=>{if(!value||typeof value!=='object')return;if(predicate(value))result.push(value);for(const child of value.children??[])visit(child);};visit(tree);return result;}
function text(tree){if(typeof tree==='string'||typeof tree==='number')return String(tree);return(tree?.children??[]).map(text).join(' ');}
const button=(tree,label)=>nodes(tree,node=>node.type==='button'&&text(node).includes(label))[0];
const drawer=tree=>nodes(tree,node=>node.type==='modal'&&node.props.className==='pc_dot_modal')[0];
const actionPosts=h=>h.requests.filter(row=>row.options.method==='POST').map(row=>({url:row.url,body:JSON.parse(row.options.body)}));
const posts=h=>actionPosts(h).filter(row=>row.body.action!=='memory_detail');
const memoryReads=h=>actionPosts(h).filter(row=>row.body.action==='memory_detail');
const memoryDetail=row=>Response.json({action:'memory_detail',projectId:'p1',record:row});
const memoryRow=(id,kind,value,source='user')=>({id,kind,text:value,at:'2026-10-19T17:00:00Z',source:{kind:source,reference:'session:session-a'},verified:false});
function seedMemory(h,row){h.context.snapshot.projects[0].overview={available:true,goals:[],blockers:[],nextSteps:[],recent:[row]};}
async function openMemory(h){button(h.render(),'公开项目 A').props.onClick();button(h.render(),'记住的事').props.onClick();await button(h.render(),'纠正或忘记').props.onClick();return h.render();}

test('adds a matching native sidebar/main pair without replacing the existing interface',async()=>{
  const h=await harness();const main=h.registrations.find(row=>row.spec.name==='main');
  const entry=h.registrations.find(row=>row.spec.name==='sidebar.panellist');
  assert.ok(main,'native main panel');assert.ok(entry,'persistent sidebar entry');assert.equal(main.spec.key,entry.spec.id);
  assert.equal(entry.spec.label,'DSH Dot');assert.equal(h.registrations.some(row=>['root','sidebar','conversation.composer','conversation.chat.node'].includes(row.spec.name)),false);
  assert.ok(h.registrations.some(row=>row.spec.name==='settings.section'));assert.ok(h.registrations.some(row=>row.spec.name==='settings.onboarding'));
  assert.equal(h.requests.length,0);assert.equal(h.panels.length,0);assert.equal(h.opened.length,0);
  const icon=entry.component({size:18,active:false});assert.equal(nodes(icon,node=>node.type==='button').length,0);
  h.dispose();assert.ok(h.registrations.every(row=>row.disposed));
});

test('opening the page makes one read-only GET and evidence requires the selected project source tab',async()=>{
  const h=await harness();h.context.snapshot.projects[1].sources=[{name:'README.md',status:'ok',text:'SECOND_PROJECT_SOURCE_SENTINEL'}];h.render();await h.flush();const view=h.render();
  assert.deepEqual(h.requests.map(row=>({url:row.url,method:row.options.method??'GET'})),[{url:endpoint,method:'GET'}]);
  assert.equal(h.requests[0].options.credentials,'same-origin');assert.equal(h.requests[0].options.cache,'no-store');
  assert.match(text(view),/公开项目 A/);assert.doesNotMatch(text(view),/README.md|not executable/);
  assert.match(text(view),/待验收/);assert.match(text(view),/手机送达未知/);assert.match(text(view),/核对演示/);
  button(view,'公开项目 A').props.onClick();assert.doesNotMatch(text(h.render()),/README.md|not executable/);
  button(h.render(),'来源与记录').props.onClick();const evidence=h.render();
  assert.match(text(evidence),/README.md/);assert.match(text(evidence),/<script>not executable<\/script>/);
  assert.doesNotMatch(text(evidence),/SECOND_PROJECT_SOURCE_SENTINEL/,'a project drawer must show only its selected project sources');
  assert.equal(nodes(evidence,node=>node.props.dangerouslySetInnerHTML).length,0);assert.equal(nodes(evidence,node=>node.type==='script').length,0);
  assert.equal(h.requests.length,1);assert.deepEqual(posts(h),[]);
  assert.equal(h.opened.length,0);h.dispose();
});

test('project switching and navigation are explicit; multiple sessions are not picked automatically',async()=>{
  const h=await harness();h.render();await h.flush();let view=h.render();
  await button(view,'打开 Dot 会话').props.onClick();assert.deepEqual(h.opened,['dot-source']);
  button(view,'公开项目 A').props.onClick();view=h.render();
  await button(view,'打开项目会话').props.onClick();assert.deepEqual(h.opened,['dot-source','session-a']);
  assert.deepEqual(h.panels,[null,null],'same-session navigation must explicitly leave the custom main panel');
  button(view,'公开项目 B').props.onClick();view=h.render();assert.match(text(view),/选择会话/);
  assert.equal(h.opened.length,2);await button(view,'会话 2').props.onClick();assert.deepEqual(h.opened,['dot-source','session-a','session-b2']);
  assert.equal(h.requests.length,1);h.dispose();
});

test('project summary shows recorded goals and blockers while raw evidence remains behind its own tab',async()=>{
  const h=await harness();
  const row=memoryRow;
  h.context.snapshot.projects[0].overview={available:true,goals:[row('g','goal','交付首版项目助理')],blockers:[row('b','blocker','手机闭环尚待核对','assistant')],nextSteps:[row('n','next_step','检查真实送达')],recent:[row('g','goal','交付首版项目助理')]};
  h.render();await h.flush();button(h.render(),'公开项目 A').props.onClick();const view=h.render(),value=text(view);
  assert.match(value,/项目目标.*交付首版项目助理/);assert.match(value,/已记录的阻塞.*手机闭环尚待核对/);assert.match(value,/已记录的下一步.*检查真实送达/);
  assert.doesNotMatch(value,/README.md|not executable/);
  assert.equal(value.split('交付首版项目助理').length-1,1,'a recent goal already shown above should not repeat');
  assert.match(value,/助手记录.*未独立核验/);assert.equal(h.requests.length,1);h.dispose();
  assert.doesNotMatch(value,/session:session-a/,'provenance should use a human-readable label, not internal session ids');
});

test('missing or empty structured memory stays explicit without inventing goals or next steps',async()=>{
  for(const overview of [undefined,{available:true,goals:[],blockers:[],nextSteps:[],recent:[]},{available:true,goals:[null],blockers:[],nextSteps:[],recent:[]}]){
    const h=await harness();h.context.snapshot.projects[0].overview=overview;h.render();await h.flush();button(h.render(),'公开项目 A').props.onClick();const value=text(h.render());
    assert.match(value,/尚未记录|项目记忆暂不可用/);assert.doesNotMatch(value,/建议先完成|已经完成/);h.dispose();
  }
});

test('desktop appearance controls apply and restore only after explicit clicks, with no task request',async()=>{
  const h=await harness({appearance:true});h.render();await h.flush();let view=h.render();
  assert.equal(button(view,'启用 Dot 外观'),undefined);button(view,'连接').props.onClick();view=h.render();
  assert.equal(h.themeLayers.length,0);const enable=button(view,'启用 Dot 外观');assert.ok(enable);assert.equal(enable.props.disabled,false);
  await enable.props.onClick();view=h.render();assert.equal(h.themeLayers.filter(x=>x.active).length,1);assert.ok(button(view,'恢复原生外观'));
  await button(view,'恢复原生外观').props.onClick();assert.equal(h.themeLayers.filter(x=>x.active).length,0);assert.equal(h.requests.length,1);assert.equal(h.opened.length,0);h.dispose();
});

test('known native session titles aid explicit choice and missing cache stays unconfirmed',async()=>{
  const h=await harness({sessions:{'session-b1':{displayTitle:'制定公开发布计划',running:false}}});h.render();await h.flush();button(h.render(),'公开项目 B').props.onClick();const view=h.render();
  assert.ok(button(view,'制定公开发布计划'));assert.match(text(view),/当前无运行任务/);assert.match(text(view),/会话 2.*标题尚未加载/);
  assert.equal(h.opened.length,0);await button(view,'制定公开发布计划').props.onClick();assert.deepEqual(h.opened,['session-b1']);assert.deepEqual(h.panels,[null]);h.dispose();
});

test('unbound empty snapshot remains usable and never invents a connection or dispatch',async()=>{
  const h=await harness();h.context.snapshot={...sample(),connection:{state:'awaiting-message'},projects:[],jobs:[],reminders:[],counts:{projects:0,activeReminders:0}};
  h.render();await h.flush();let view=h.render();assert.match(text(view),/先连接，再选一个项目/);assert.ok(button(view,'项目'));assert.ok(button(view,'连接'));
  assert.match(text(view),/微信尚未确认连接/);assert.equal(button(view,'打开 Dot 会话'),undefined);
  button(view,'项目').props.onClick();view=h.render();assert.match(text(view),/还没有关注项目/);
  assert.equal(h.opened.length,0);assert.equal(h.requests.length,1);assert.deepEqual(posts(h),[]);h.dispose();
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

test('first-use home puts WeChat connection in primary position without dispatching on mount',async()=>{
 const h=await harness();h.context.snapshot={...sample(),connection:{state:'awaiting-message'},projects:[],jobs:[],reminders:[]};h.render();await h.flush();const view=h.render();
 assert.match(text(view),/把 Dot 接到微信里/);const connect=button(view,'连接微信');assert.ok(connect);assert.equal(connect.props.className,'pc_dot_primary');assert.ok(button(view,'先在电脑了解'));assert.equal(h.requests.length,1);assert.equal(h.opened.length,0);h.dispose();
});

test('home natural-language entry preserves input when native preparation is unavailable',async()=>{
 const h=await harness();h.render();await h.flush();let view=h.render();const input=nodes(view,n=>n.type==='textarea'&&n.props['aria-label']==='交代给 Dot 的事情')[0];assert.ok(input);
 input.props.onChange({target:{value:'只读看看项目进展'}});view=h.render();await button(view,'开始对话').props.onClick();view=h.render();assert.match(text(view),/原生草稿|Dot 会话/);assert.equal(nodes(view,n=>n.type==='textarea')[0].props.value,'只读看看项目进展');assert.equal(h.requests.length,1);h.dispose();
});

test('project quick chat prepares its own native prompt without erasing a different unsent home draft',async()=>{
  const h=await harness(),prepared=[];let releases=0;const binding={sessionId:'dot-source'};
  h.ctx.sessions={retain:id=>{assert.equal(id,'dot-source');return{binding,ready:Promise.resolve(binding),release:()=>releases++};}};
  h.ctx.conversation={input:{requestDraftInitialization:(target,options)=>{assert.equal(target,binding);prepared.push(options);return'applied';}}};binding.ctx={get:()=>h.ctx.conversation};
  h.render();await h.flush();nodes(h.render(),n=>n.type==='textarea'&&n.props['aria-label']==='交代给 Dot 的事情')[0].props.onChange({target:{value:'另一个尚未发送的具体问题'}});
  button(h.render(),'公开项目 A').props.onClick();await button(h.render(),'和 Dot 聊这个项目').props.onClick();
  assert.equal(prepared.length,1);assert.match(prepared[0].prompt,/关于项目「公开项目 A」.*请结合这个项目的最新资料/s);assert.equal(prepared[0].clearPreviousDraft,false);
  assert.equal(nodes(h.render(),n=>n.type==='textarea'&&n.props['aria-label']==='交代给 Dot 的事情')[0].props.value,'另一个尚未发送的具体问题');
  assert.deepEqual(h.opened,['dot-source']);assert.deepEqual(h.panels,[null]);assert.equal(releases,1);assert.equal(h.requests.length,2);assert.deepEqual(actionPosts(h),[]);h.dispose();
});

test('follow-up requires a separate review and explicit confirmation before POST mutation',async()=>{
 const h=await harness();h.context.onFetch=(url,options)=>url===endpoint?Response.json(h.context.snapshot):Response.json({action:'followup_status',projectId:'p1',followup:{enabled:false},once:{enabled:false,status:'none'}});
 h.render();await h.flush();let view=h.render();button(view,'公开项目 A').props.onClick();view=h.render();assert.ok(button(view,'查看或安排跟进'));await button(view,'查看或安排跟进').props.onClick();view=h.render();
 assert.equal(h.requests.filter(r=>r.options.method==='POST').length,1,'only deliberate status read');assert.ok(button(view,'核对安排'));assert.equal(button(view,'确认跟进'),undefined);h.dispose();
});

test('task reply details are read only after an explicit click and remain escaped with delivery unknown',async()=>{
  const h=await harness();let completeDetail;
  h.context.onFetch=(url,options)=>url===endpoint?Response.json(h.context.snapshot):new Promise(resolve=>{completeDetail=resolve;});
  h.render();await h.flush();let view=h.render();assert.deepEqual(posts(h),[]);assert.doesNotMatch(text(view),/DETAIL_REPLY_SENTINEL/);
  const loading=button(view,'看看这次结果').props.onClick();view=h.render();
  assert.match(text(drawer(view)),/正在读取本次回复/);
  assert.deepEqual(posts(h),[{url:endpoint+'/actions',body:{action:'task_detail',id:'j1'}}]);
  completeDetail(Response.json({action:'task_detail',jobs:[{...h.context.snapshot.jobs[0],reply:'DETAIL_REPLY_SENTINEL <script>never run</script>',replyTruncated:true}]}));await loading;
  view=h.render();const detail=drawer(view);assert.match(text(detail),/DETAIL_REPLY_SENTINEL <script>never run<\/script>/);
  assert.match(text(detail),/待验收/);assert.match(text(detail),/手机送达未知/);assert.match(text(detail),/已截取/);
  assert.equal(nodes(detail,n=>n.props.dangerouslySetInnerHTML||n.type==='script').length,0);
  assert.equal(posts(h).length,1);assert.equal(h.requests.length,2);assert.equal(h.opened.length,0);h.dispose();
});

test('cancelling a correction preserves the original note and save writes only the selected memory',async()=>{
  const h=await harness(),row=memoryRow('memory-goal','goal','助手记录的旧目标','assistant');seedMemory(h,row);
  h.context.onFetch=(url,options)=>{
    if(url===endpoint)return Response.json(h.context.snapshot);
    const body=JSON.parse(options.body);if(body.action==='memory_detail')return memoryDetail(row);assert.equal(body.action,'memory_update');
    seedMemory(h,{...row,text:body.text,source:{kind:'user',reference:'session:dot-source'}});
    return Response.json({action:'memory_update',projectId:'p1',id:row.id,updated:true,receipt:{id:row.id,status:'revised',verified:false}});
  };
  h.render();await h.flush();let view=await openMemory(h);
  assert.match(text(drawer(view)),/只修改「公开项目 A」/);assert.match(text(drawer(view)),/保留原来源身份/);assert.deepEqual(posts(h),[]);
  assert.deepEqual(memoryReads(h),[{url:endpoint+'/actions',body:{action:'memory_detail',projectId:'p1',id:row.id}}]);
  const editor=nodes(view,n=>n.type==='textarea'&&n.props['aria-label']==='纠正项目记忆')[0];assert.equal(editor.props.maxLength,4000);assert.equal(editor.props.value,row.text);
  editor.props.onChange({target:{value:'   '}});assert.equal(button(h.render(),'保存纠正').props.disabled,true);assert.deepEqual(posts(h),[]);
  editor.props.onChange({target:{value:'字'.repeat(2001)}});assert.equal(button(h.render(),'保存纠正').props.disabled,true);assert.deepEqual(posts(h),[]);
  editor.props.onChange({target:{value:'尚未保存的纠正'}});drawer(h.render()).props.onClose();assert.match(text(drawer(h.render())),/这次修改还没保存/);button(h.render(),'放弃修改并离开').props.onClick();assert.deepEqual(posts(h),[]);
  view=await openMemory(h);assert.equal(nodes(view,n=>n.type==='textarea'&&n.props['aria-label']==='纠正项目记忆')[0].props.value,row.text,'cancel must not replace the stored source note');
  nodes(view,n=>n.type==='textarea'&&n.props['aria-label']==='纠正项目记忆')[0].props.onChange({target:{value:'  用户明确纠正后的目标  '}});
  await button(h.render(),'保存纠正').props.onClick();view=h.render();
  assert.deepEqual(posts(h),[{url:endpoint+'/actions',body:{action:'memory_update',projectId:'p1',id:row.id,text:'用户明确纠正后的目标',userRequested:true}}]);
  assert.equal(memoryReads(h).length,2,'each deliberate editor opening reads the exact complete record');
  assert.equal(h.requests.length,5,'two full-text reads precede one save and one readback');assert.match(text(view),/已记住你.*纠正/);assert.match(text(drawer(view)),/用户明确纠正后的目标/);assert.match(text(drawer(view)),/未独立核验/);assert.equal(h.opened.length,0);h.dispose();
});

test('forgetting a memory requires a separate confirmation and returning or closing does not mutate it',async()=>{
  const h=await harness(),row=memoryRow('memory-context','context','要忘记的项目背景');seedMemory(h,row);
  h.context.onFetch=(url,options)=>{
    if(url===endpoint)return Response.json(h.context.snapshot);
    const body=JSON.parse(options.body);if(body.action==='memory_detail')return memoryDetail(row);assert.equal(body.action,'memory_forget');
    h.context.snapshot.projects[0].overview={available:true,goals:[],blockers:[],nextSteps:[],recent:[]};
    return Response.json({action:'memory_forget',projectId:'p1',id:row.id,forgotten:true,receipt:{action:'forget',status:'forgotten',id:row.id,kind:row.kind}});
  };
  h.render();await h.flush();let view=await openMemory(h);
  button(view,'忘记这条').props.onClick();view=h.render();assert.match(text(drawer(view)),/确认.*忘记.*原始项目文件不会被修改/);assert.deepEqual(posts(h),[]);
  button(view,'返回').props.onClick();view=h.render();assert.ok(button(view,'保存纠正'));assert.equal(button(view,'确认忘记'),undefined);assert.deepEqual(posts(h),[]);
  button(view,'忘记这条').props.onClick();drawer(h.render()).props.onClose();assert.deepEqual(posts(h),[]);
  view=await openMemory(h);button(view,'忘记这条').props.onClick();await button(h.render(),'确认忘记').props.onClick();view=h.render();
  assert.deepEqual(posts(h),[{url:endpoint+'/actions',body:{action:'memory_forget',projectId:'p1',id:row.id,userRequested:true}}]);
  assert.deepEqual(memoryReads(h),Array.from({length:2},()=>({url:endpoint+'/actions',body:{action:'memory_detail',projectId:'p1',id:row.id}})));
  assert.equal(h.requests.length,5);assert.match(text(view),/已忘记「公开项目 A」/);assert.doesNotMatch(text(drawer(view)),/要忘记的项目背景/);assert.equal(h.opened.length,0);h.dispose();
});

test('a rejected memory edit retains the unsaved text and never claims success or retries',async()=>{
  const h=await harness(),row=memoryRow('memory-blocker','blocker','原始阻塞记录','assistant');seedMemory(h,row);
  h.context.onFetch=(url,options)=>url===endpoint?Response.json(h.context.snapshot):JSON.parse(options.body).action==='memory_detail'?memoryDetail(row):Response.json({error:'原微信绑定已变化。'},{status:400});
  h.render();await h.flush();let view=await openMemory(h);
  nodes(view,n=>n.type==='textarea'&&n.props['aria-label']==='纠正项目记忆')[0].props.onChange({target:{value:'尚未保存的阻塞纠正'}});
  await button(h.render(),'保存纠正').props.onClick();view=h.render();
  assert.match(text(view),/绑定已变化.*未自动重试/);assert.doesNotMatch(text(view),/已记住你|已忘记/);
  assert.equal(nodes(view,n=>n.type==='textarea'&&n.props['aria-label']==='纠正项目记忆')[0].props.value,'尚未保存的阻塞纠正');
  assert.deepEqual(memoryReads(h),[{url:endpoint+'/actions',body:{action:'memory_detail',projectId:'p1',id:row.id}}]);
  assert.equal(posts(h).length,1);assert.equal(h.requests.length,3);assert.equal(h.context.snapshot.projects[0].overview.recent[0].text,'原始阻塞记录');h.dispose();
});

test('editing a long memory loads its complete record and preserves the tail beyond the overview preview',async()=>{
  const h=await harness(),full=memoryRow('memory-long','context','旧开头：'+'完整背景'.repeat(240)+' ONLY_FULL_TEXT_TAIL');
  assert.ok(full.text.length>500&&full.text.length<=2000);seedMemory(h,{...full,text:full.text.slice(0,500),truncated:true});
  h.context.onFetch=(url,options)=>{
    if(url===endpoint)return Response.json(h.context.snapshot);
    const body=JSON.parse(options.body);if(body.action==='memory_detail')return memoryDetail(full);
    assert.equal(body.action,'memory_update');seedMemory(h,{...full,text:body.text.slice(0,500),truncated:true});
    return Response.json({action:'memory_update',projectId:'p1',id:full.id,updated:true,receipt:{id:full.id,status:'revised'}});
  };
  h.render();await h.flush();assert.deepEqual(actionPosts(h),[]);const view=await openMemory(h);
  const editor=nodes(view,n=>n.type==='textarea'&&n.props['aria-label']==='纠正项目记忆')[0];assert.equal(editor.props.value,full.text);
  assert.deepEqual(memoryReads(h),[{url:endpoint+'/actions',body:{action:'memory_detail',projectId:'p1',id:full.id}}]);
  const revised=full.text.replace('旧开头：','用户纠正后的开头：');editor.props.onChange({target:{value:revised}});await button(h.render(),'保存纠正').props.onClick();
  assert.deepEqual(posts(h),[{url:endpoint+'/actions',body:{action:'memory_update',projectId:'p1',id:full.id,text:revised,userRequested:true}}]);
  assert.ok(posts(h)[0].body.text.endsWith('ONLY_FULL_TEXT_TAIL'));assert.equal(h.requests.length,4);assert.equal(h.opened.length,0);h.dispose();
});

test('a failed or mismatched complete-memory read never opens an editor using the overview preview',async()=>{
  const row=memoryRow('memory-preview','context','PREVIEW_MUST_NEVER_BECOME_EDITABLE');
  for(const failure of ['unavailable','missing','wrong-record','wrong-project']){
    const h=await harness();seedMemory(h,row);let completeRead;
    h.context.onFetch=(url,options)=>url===endpoint?Response.json(h.context.snapshot):new Promise(resolve=>{completeRead=resolve;});
    h.render();await h.flush();const opening=openMemory(h);let view=h.render();
    assert.match(text(drawer(view)),/正在读取完整记忆/);assert.equal(nodes(drawer(view),n=>n.type==='textarea').length,0);
    const value={action:'memory_detail',projectId:failure==='wrong-project'?'p2':'p1',record:failure==='missing'?undefined:{...row,id:failure==='wrong-record'?'foreign-memory':row.id}};
    completeRead(failure==='unavailable'?Response.json({error:'完整记忆读取失败。'},{status:503}):Response.json(value));await opening;view=h.render();
    assert.match(text(drawer(view)),/完整记忆尚未读取.*未开放编辑/);assert.equal(nodes(drawer(view),n=>n.type==='textarea').length,0);
    assert.equal(button(view,'保存纠正'),undefined);assert.equal(button(view,'忘记这条'),undefined);assert.doesNotMatch(text(drawer(view)),/PREVIEW_MUST_NEVER_BECOME_EDITABLE/);
    assert.deepEqual(memoryReads(h),[{url:endpoint+'/actions',body:{action:'memory_detail',projectId:'p1',id:row.id}}]);assert.deepEqual(posts(h),[]);assert.equal(h.requests.length,2);assert.equal(h.opened.length,0);h.dispose();
  }
});

test('noneditable or redacted memory detail cannot become a saved redacted copy and directs the current Dot session',async()=>{
  const row=memoryRow('memory-redacted','context','正文中的 [已隐藏] 副本不能保存');
  for(const flags of [{editable:false},{redacted:true}]){
    const h=await harness();seedMemory(h,row);h.context.onFetch=(url,options)=>url===endpoint?Response.json(h.context.snapshot):Response.json({action:'memory_detail',projectId:'p1',record:row,...flags});
    h.render();await h.flush();const view=await openMemory(h),detail=drawer(view);
    assert.match(text(detail),/隐藏内容.*Dot 会话.*纠正或忘记.*未将隐藏后的副本作为编辑原文/);
    assert.equal(nodes(detail,n=>n.type==='textarea').length,0);assert.equal(button(view,'保存纠正'),undefined);assert.equal(button(view,'忘记这条'),undefined);assert.deepEqual(posts(h),[]);
    assert.deepEqual(memoryReads(h),[{url:endpoint+'/actions',body:{action:'memory_detail',projectId:'p1',id:row.id}}]);
    await button(view,'打开 Dot 会话').props.onClick();assert.deepEqual(h.opened,['dot-source']);assert.deepEqual(h.panels,[null]);assert.equal(h.requests.length,2);assert.deepEqual(posts(h),[]);h.dispose();
  }
});

test('an in-flight memory save locks its text and cannot reopen a drawer closed before the response',async()=>{
  const h=await harness(),row=memoryRow('memory-saving','context','旧背景');seedMemory(h,row);let completeSave;
  h.context.onFetch=(url,options)=>{
    if(url===endpoint)return Response.json(h.context.snapshot);
    return JSON.parse(options.body).action==='memory_detail'?memoryDetail(row):new Promise(resolve=>{completeSave=resolve;});
  };
  h.render();await h.flush();let view=await openMemory(h);nodes(view,n=>n.type==='textarea'&&n.props['aria-label']==='纠正项目记忆')[0].props.onChange({target:{value:'已确认提交的纠正'}});
  const saving=button(h.render(),'保存纠正').props.onClick();view=h.render();const editor=nodes(view,n=>n.type==='textarea'&&n.props['aria-label']==='纠正项目记忆')[0];
  assert.equal(editor.props.disabled,true);assert.equal(button(view,'保存纠正').props.disabled,true);editor.props.onChange({target:{value:'并发输入不能覆盖提交内容'}});
  assert.equal(nodes(h.render(),n=>n.type==='textarea'&&n.props['aria-label']==='纠正项目记忆')[0].props.value,'已确认提交的纠正');
  drawer(h.render()).props.onClose();assert.equal(drawer(h.render()),undefined);
  seedMemory(h,{...row,text:'已确认提交的纠正'});completeSave(Response.json({action:'memory_update',projectId:'p1',id:row.id,updated:true,receipt:{id:row.id,status:'revised'}}));await saving;
  view=h.render();assert.equal(drawer(view),undefined,'completion and readback must respect the later explicit close');
  assert.match(text(view),/已记住你.*纠正/);assert.deepEqual(posts(h),[{url:endpoint+'/actions',body:{action:'memory_update',projectId:'p1',id:row.id,text:'已确认提交的纠正',userRequested:true}}]);
  assert.deepEqual(memoryReads(h),[{url:endpoint+'/actions',body:{action:'memory_detail',projectId:'p1',id:row.id}}]);assert.equal(h.requests.length,4);assert.equal(h.opened.length,0);h.dispose();
});

test('task continuation with duplicate or unwatched labels preserves the draft and requires a project choice',async()=>{
  for(const labelState of ['duplicate','unwatched']){
    const h=await harness();if(labelState==='duplicate')h.context.snapshot.projects[1].label='公开项目 A';else h.context.snapshot.jobs[0].projectLabel='已经取消关注的旧项目';
    h.render();await h.flush();let view=h.render();nodes(view,n=>n.type==='select'&&n.props['aria-label']==='这句话关联的项目')[0].props.onChange({target:{value:'p2'}});
    nodes(h.render(),n=>n.type==='textarea'&&n.props['aria-label']==='交代给 Dot 的事情')[0].props.onChange({target:{value:'已有的未发送草稿'}});
    button(h.render(),'和 Dot 接着聊').props.onClick();view=h.render();assert.match(text(view),/项目范围需要你核对.*选择对应项目/);
    assert.equal(nodes(view,n=>n.type==='textarea'&&n.props['aria-label']==='交代给 Dot 的事情').length,0,'ambiguous task scope must open project selection');
    button(view,'今天').props.onClick();view=h.render();assert.equal(nodes(view,n=>n.type==='textarea'&&n.props['aria-label']==='交代给 Dot 的事情')[0].props.value,'已有的未发送草稿');
    assert.equal(nodes(view,n=>n.type==='select'&&n.props['aria-label']==='这句话关联的项目')[0].props.value,'p2');assert.equal(h.requests.length,1);assert.deepEqual(actionPosts(h),[]);assert.equal(h.opened.length,0);h.dispose();
  }
});

test('a one-time follow-up needs an explicit local time, a review and final confirmation',async()=>{
  const h=await harness();
  h.context.onFetch=(url,options)=>{
    if(url===endpoint)return Response.json(h.context.snapshot);
    const body=JSON.parse(options.body);
    return Response.json(body.action==='followup_status'?{action:body.action,projectId:'p1',followup:{enabled:false,running:false},once:{enabled:false,running:false,status:'none'}}:{action:body.action,projectId:'p1',once:{enabled:true,running:false,status:'queued',nextDueAt:body.dueAt}});
  };
  h.render();await h.flush();button(h.render(),'公开项目 A').props.onClick();await button(h.render(),'查看或安排跟进').props.onClick();let view=h.render();
  button(view,'核对安排').props.onClick();view=h.render();assert.match(text(view),/请选择检查时间/);assert.equal(button(view,'确认跟进'),undefined);assert.equal(posts(h).length,1);
  const future=new Date(Date.now()+2*3600000),pad=n=>String(n).padStart(2,'0');
  const local=`${future.getFullYear()}-${pad(future.getMonth()+1)}-${pad(future.getDate())}T${pad(future.getHours())}:${pad(future.getMinutes())}`;
  nodes(view,n=>n.type==='input'&&n.props.type==='datetime-local')[0].props.onChange({target:{value:local}});
  button(h.render(),'核对安排').props.onClick();view=h.render();assert.match(text(drawer(view)),/项目：公开项目 A/);assert.ok(text(drawer(view)).includes(local.replace('T',' ')));assert.match(text(drawer(view)),/本机浏览器时区/);assert.equal(posts(h).length,1);
  button(view,'返回修改').props.onClick();view=h.render();assert.equal(button(view,'确认跟进'),undefined);assert.equal(posts(h).length,1);
  button(view,'核对安排').props.onClick();await button(h.render(),'确认跟进').props.onClick();view=h.render();
  assert.deepEqual(posts(h),[{url:endpoint+'/actions',body:{action:'followup_status',projectId:'p1'}},{url:endpoint+'/actions',body:{action:'check_once',projectId:'p1',dueAt:new Date(local).toISOString(),userRequested:true}}]);
  assert.match(text(view),/已为「公开项目 A」保存跟进安排/);assert.match(text(view),/没有实质变化时保持安静/);assert.doesNotMatch(text(view),/手机已收到|已经送达/);assert.equal(h.opened.length,0);h.dispose();
});

test('recurring follow-up uses the explicitly reviewed cadence without enabling the default on open',async()=>{
  const h=await harness();
  h.context.onFetch=(url,options)=>{
    if(url===endpoint)return Response.json(h.context.snapshot);
    const body=JSON.parse(options.body);return Response.json({action:body.action,projectId:'p1',followup:{enabled:body.action==='followup_configure',running:false,everyMinutes:body.everyMinutes},once:{enabled:false,running:false,status:'none'}});
  };
  h.render();await h.flush();button(h.render(),'公开项目 A').props.onClick();await button(h.render(),'查看或安排跟进').props.onClick();let view=h.render();
  nodes(view,n=>n.type==='select'&&n.props.value==='once')[0].props.onChange({target:{value:'repeat'}});view=h.render();
  nodes(view,n=>n.type==='select'&&n.props.value===60)[0].props.onChange({target:{value:'180'}});
  button(h.render(),'核对安排').props.onClick();view=h.render();assert.match(text(drawer(view)),/每 180 分钟，只读检查/);assert.equal(posts(h).length,1);
  await button(view,'确认跟进').props.onClick();
  assert.deepEqual(posts(h),[{url:endpoint+'/actions',body:{action:'followup_status',projectId:'p1'}},{url:endpoint+'/actions',body:{action:'followup_configure',projectId:'p1',everyMinutes:180,userRequested:true}}]);
  assert.equal(h.opened.length,0);h.dispose();
});

test('preparing a native draft locks local input so delayed readiness cannot erase newer edits',async()=>{
 const h=await harness();let release;h.ctx.sessions={retain:()=>({binding:{sessionId:'dot-source'},ready:new Promise(resolve=>release=resolve),release(){}})};h.ctx.conversation={input:{requestDraftInitialization:()=> 'preserved'}};const retainOriginal=h.ctx.sessions.retain;h.ctx.sessions.retain=(...args)=>{const ref=retainOriginal(...args);ref.binding.ctx={get:()=>h.ctx.conversation};return ref;};
 h.render();await h.flush();let view=h.render();nodes(view,n=>n.type==='textarea')[0].props.onChange({target:{value:'Original input'}});view=h.render();const pending=button(view,'开始对话').props.onClick();view=h.render();const input=nodes(view,n=>n.type==='textarea')[0];assert.equal(input.props.disabled,true);input.props.onChange({target:{value:'New concurrent edit'}});assert.equal(nodes(h.render(),n=>n.type==='textarea')[0].props.value,'Original input');release();await pending;assert.equal(nodes(h.render(),n=>n.type==='textarea')[0].props.value,'Original input');h.dispose();
});

test('connection controls precede appearance and project-free questions have an explicit scope',async()=>{
 const h=await harness({appearance:true});try{h.context.snapshot.projects=[];h.render();await h.flush();let view=h.render();
  const selector=nodes(view,n=>n.type==='select'&&n.props['aria-label']==='这句话关联的项目')[0];assert.ok(selector);assert.match(text(selector),/不关联项目/);assert.equal(nodes(selector,n=>n.type==='option')[0].props.value,'');
  button(view,'连接').props.onClick();view=h.render();const sequence=nodes(view,n=>typeof n.type==='function'&&n.type.name==='ContextPanel'||n.type==='section'&&text(n).includes('界面外观'));
  assert.equal(sequence[0].type.name,'ContextPanel');assert.equal(h.requests.length,1);assert.deepEqual(posts(h),[]);
 }finally{h.dispose();}
});
test('reminder and daily shortcuts stage a project-free draft without sending or overwriting',async()=>{
 for(const label of ['安排提醒','设置日报']){
  const h=await harness();try{h.render();await h.flush();let view=h.render();const action=button(view,label);assert.ok(action);action.props.onClick();view=h.render();
   const editor=nodes(view,n=>n.type==='textarea'&&n.props['aria-label']==='交代给 Dot 的事情')[0];assert.match(editor.props.value,label==='安排提醒'?/提醒/:/日报/);assert.equal(nodes(view,n=>n.type==='select'&&n.props['aria-label']==='这句话关联的项目')[0].props.value,'');assert.equal(h.opened.length,0);assert.deepEqual(posts(h),[]);assert.equal(h.requests.length,1);
   editor.props.onChange({target:{value:'我的未发送草稿'}});button(h.render(),label).props.onClick();view=h.render();assert.equal(nodes(view,n=>n.type==='textarea'&&n.props['aria-label']==='交代给 Dot 的事情')[0].props.value,'我的未发送草稿');assert.match(text(view),/保留.*草稿/);assert.equal(h.requests.length,1);assert.deepEqual(posts(h),[]);
  }finally{h.dispose();}
 }
});
test('choosing no project survives a status refresh and project shortcuts preserve an existing draft',async()=>{
 const h=await harness();try{h.render();await h.flush();let view=h.render();nodes(view,n=>n.type==='select'&&n.props['aria-label']==='这句话关联的项目')[0].props.onChange({target:{value:''}});
  await button(h.render(),'刷新').props.onClick();view=h.render();assert.equal(nodes(view,n=>n.type==='select'&&n.props['aria-label']==='这句话关联的项目')[0].props.value,'');
  nodes(view,n=>n.type==='textarea'&&n.props['aria-label']==='交代给 Dot 的事情')[0].props.onChange({target:{value:'保留这个草稿'}});button(h.render(),'和 Dot 接着聊').props.onClick();view=h.render();assert.equal(nodes(view,n=>n.type==='textarea'&&n.props['aria-label']==='交代给 Dot 的事情')[0].props.value,'保留这个草稿');assert.equal(nodes(view,n=>n.type==='select'&&n.props['aria-label']==='这句话关联的项目')[0].props.value,'');
  button(view,'项目').props.onClick();button(h.render(),'继续聊').props.onClick();view=h.render();button(view,'今天').props.onClick();view=h.render();assert.equal(nodes(view,n=>n.type==='textarea'&&n.props['aria-label']==='交代给 Dot 的事情')[0].props.value,'保留这个草稿');assert.equal(h.opened.length,0);assert.deepEqual(posts(h),[]);
 }finally{h.dispose();}
});

test('V2 navigation preserves a conversation draft and its scope while inspecting another project',async()=>{
  const h=await harness();try{h.render();await h.flush();let view=h.render();
    for(const name of ['今天','项目','记忆','连接'])assert.ok(nodes(view,n=>n.type==='button'&&text(n)===name).length);
    nodes(view,n=>n.type==='select'&&n.props['aria-label']==='这句话关联的项目')[0].props.onChange({target:{value:'p1'}});
    nodes(h.render(),n=>n.type==='textarea'&&n.props['aria-label']==='交代给 Dot 的事情')[0].props.onChange({target:{value:'只属于项目 A 的未发送问题'}});
    button(h.render(),'公开项目 B').props.onClick();drawer(h.render()).props.onClose();button(h.render(),'记忆').props.onClick();button(h.render(),'今天').props.onClick();view=h.render();
    assert.equal(nodes(view,n=>n.type==='textarea')[0].props.value,'只属于项目 A 的未发送问题');assert.equal(nodes(view,n=>n.type==='select'&&n.props['aria-label']==='这句话关联的项目')[0].props.value,'p1');
    assert.equal(h.requests.length,1);assert.deepEqual(actionPosts(h),[]);
  }finally{h.dispose();}
});

test('scoped memory page has source provenance and never mixes another project into the editor',async()=>{
  const h=await harness(),row=memoryRow('scope-a','context','项目 A 的背景');seedMemory(h,row);h.context.snapshot.projects[1].overview={available:true,goals:[],blockers:[],nextSteps:[],recent:[memoryRow('scope-b','context','项目 B 的另一份背景')]};
  h.context.onFetch=(url)=>url===endpoint?Response.json(h.context.snapshot):memoryDetail(row);
  try{h.render();await h.flush();button(h.render(),'记忆').props.onClick();let view=h.render();assert.match(text(view),/项目 A 的背景/);assert.doesNotMatch(text(view),/项目 B 的另一份背景/);assert.match(text(view),/不是跨项目的个人画像/);assert.ok(button(view,'查看项目来源'));
    await button(view,'纠正或忘记').props.onClick();view=h.render();assert.match(text(drawer(view)),/只修改「公开项目 A」/);assert.equal(memoryReads(h)[0].body.projectId,'p1');assert.equal(memoryReads(h)[0].body.id,'scope-a');
  }finally{h.dispose();}
});

test('dirty memory close offers continue, keep and discard; only explicit save writes',async()=>{
  const h=await harness(),row=memoryRow('kept','context','原始背景');seedMemory(h,row);h.context.onFetch=url=>url===endpoint?Response.json(h.context.snapshot):memoryDetail(row);
  try{h.render();await h.flush();let view=await openMemory(h);nodes(view,n=>n.type==='textarea'&&n.props['aria-label']==='纠正项目记忆')[0].props.onChange({target:{value:'保留的纠正草稿'}});
    drawer(h.render()).props.onClose();view=h.render();assert.ok(button(view,'继续编辑'));assert.ok(button(view,'保留草稿并离开'));assert.ok(button(view,'放弃修改并离开'));assert.equal(posts(h).length,0);
    button(view,'继续编辑').props.onClick();assert.equal(nodes(drawer(h.render()),n=>n.type==='textarea')[0].props.value,'保留的纠正草稿');
    drawer(h.render()).props.onClose();button(h.render(),'保留草稿并离开').props.onClick();assert.equal(drawer(h.render()),undefined);
    view=await openMemory(h);assert.equal(nodes(drawer(view),n=>n.type==='textarea')[0].props.value,'保留的纠正草稿');assert.equal(memoryReads(h).length,2,'resume rechecks the exact original record');
    drawer(h.render()).props.onClose();button(h.render(),'放弃修改并离开').props.onClick();view=await openMemory(h);assert.equal(nodes(drawer(view),n=>n.type==='textarea')[0].props.value,row.text);assert.equal(posts(h).length,0);
  }finally{h.dispose();}
});

test('switching pages uses the same dirty-memory policy and retained drafts reject changed source text',async()=>{
  const h=await harness(),row=memoryRow('conflict','context','原始背景');seedMemory(h,row);let current=row;h.context.onFetch=url=>url===endpoint?Response.json(h.context.snapshot):memoryDetail(current);
  try{h.render();await h.flush();let view=await openMemory(h);nodes(drawer(view),n=>n.type==='textarea')[0].props.onChange({target:{value:'旧版原文上的修改'}});button(h.render(),'项目').props.onClick();assert.match(text(drawer(h.render())),/这次修改还没保存/);
    button(h.render(),'保留草稿并离开').props.onClick();view=h.render();assert.match(text(view),/每件事的背景/);assert.equal(drawer(view),undefined);
    current={...row,text:'另一个入口已纠正的当前原文'};button(view,'今天').props.onClick();view=await openMemory(h);assert.equal(nodes(drawer(view),n=>n.type==='textarea')[0].props.value,current.text);assert.match(text(view),/原文已变化.*旧草稿未套用/);assert.match(text(nodes(view,n=>n.props['data-dot-conflict-draft'])[0]),/旧版原文上的修改/);assert.equal(posts(h).length,0);button(view,'使用保留草稿继续修改').props.onClick();assert.equal(nodes(drawer(h.render()),n=>n.type==='textarea')[0].props.value,'旧版原文上的修改');assert.equal(posts(h).length,0);
  }finally{h.dispose();}
});

test('follow-up drafts stay with their project and discard never schedules anything',async()=>{
  const h=await harness();h.context.onFetch=(url,options)=>url===endpoint?Response.json(h.context.snapshot):Response.json({action:'followup_status',projectId:JSON.parse(options.body).projectId,followup:null,once:null});
  try{h.render();await h.flush();button(h.render(),'公开项目 A').props.onClick();await button(h.render(),'查看或安排跟进').props.onClick();nodes(drawer(h.render()),n=>n.type==='select'&&n.props.value==='once')[0].props.onChange({target:{value:'repeat'}});nodes(drawer(h.render()),n=>n.type==='select'&&n.props.value===60)[0].props.onChange({target:{value:'180'}});
    drawer(h.render()).props.onClose();button(h.render(),'保留草稿并离开').props.onClick();button(h.render(),'公开项目 B').props.onClick();await button(h.render(),'查看或安排跟进').props.onClick();assert.ok(nodes(drawer(h.render()),n=>n.type==='select'&&n.props.value==='once').length);drawer(h.render()).props.onClose();
    button(h.render(),'公开项目 A').props.onClick();await button(h.render(),'查看或安排跟进').props.onClick();assert.ok(nodes(drawer(h.render()),n=>n.type==='select'&&n.props.value==='repeat').length);assert.ok(nodes(drawer(h.render()),n=>n.type==='select'&&n.props.value===180).length);
    drawer(h.render()).props.onClose();button(h.render(),'放弃修改并离开').props.onClick();assert.equal(actionPosts(h).filter(r=>r.body.action!=='followup_status').length,0);
  }finally{h.dispose();}
});

test('every scoped action uses its opening binding revision; rebinding closes drafts before further writes',async()=>{
  const h=await harness(),row=memoryRow('binding-memory','context','绑定一的背景');seedMemory(h,row);h.context.snapshot.bindingRevision='scope-revision-one';let writes=0;
  h.context.onFetch=(url,options)=>{if(url===endpoint)return Response.json(h.context.snapshot);const body=JSON.parse(options.body);assert.equal(body.expectedBindingRevision,'scope-revision-one');if(body.action==='memory_detail')return memoryDetail(row);writes++;return Response.json({error:'绑定已变化，请重新打开。'},{status:409});};
  try{h.render();await h.flush();let view=await openMemory(h);nodes(drawer(view),n=>n.type==='textarea')[0].props.onChange({target:{value:'不可交给新绑定的纠正'}});await button(h.render(),'保存纠正').props.onClick();assert.equal(writes,1);assert.match(text(h.render()),/绑定已变化/);
    h.context.snapshot={...h.context.snapshot,bindingRevision:'scope-revision-two'};await button(h.render(),'刷新').props.onClick();view=h.render();assert.equal(drawer(view),undefined);assert.match(text(view),/绑定已变化.*旧范围的草稿已关闭/);assert.equal(writes,1);
  }finally{h.dispose();}
});

test('late follow-up status after closing cannot reopen a drawer or populate a later project',async()=>{
  const h=await harness();let complete;h.context.onFetch=url=>url===endpoint?Response.json(h.context.snapshot):new Promise(resolve=>{complete=resolve;});
  try{h.render();await h.flush();button(h.render(),'公开项目 A').props.onClick();const pending=button(h.render(),'查看或安排跟进').props.onClick();drawer(h.render()).props.onClose();complete(Response.json({action:'followup_status',projectId:'p1',followup:{enabled:true,everyMinutes:180},once:null}));await pending;assert.equal(drawer(h.render()),undefined);assert.equal(actionPosts(h).length,1);
  }finally{h.dispose();}
});

test('passive result and upcoming projection show scope, truncation, cold-runner and full-history evidence',async()=>{
  const h=await harness();h.context.snapshot.projects[0].followup={available:true,followup:{enabled:true,running:false,everyMinutes:180,nextDueAt:'2026-10-23T20:00:00Z'},once:null};h.context.snapshot.projects[1].followup={available:true,followup:null,once:null};h.context.snapshot.jobs[0].result={available:true,text:'真实缓存原回复 <script>不会运行</script>',truncated:true};
  try{h.render();await h.flush();const view=h.render();assert.match(text(view),/真实缓存原回复 <script>不会运行<\/script>/);assert.match(text(view),/此处为摘录/);assert.match(text(view),/已保存，运行器未启动/);assert.ok(button(view,'打开完整会话历史'));assert.ok(nodes(view,n=>n.type==='details'&&n.props['data-dot-history']).length);assert.equal(nodes(view,n=>n.type==='script'||n.props.dangerouslySetInnerHTML).length,0);assert.equal(h.requests.length,1);assert.deepEqual(actionPosts(h),[]);
  }finally{h.dispose();}
});

test('native draft navigation unmount and remount retains unsent local text without browser persistence',async()=>{
  const h=await harness();try{h.render();await h.flush();nodes(h.render(),n=>n.type==='textarea'&&n.props['aria-label']==='交代给 Dot 的事情')[0].props.onChange({target:{value:'回来继续这个问题'}});h.unmount();h.render();await h.flush();assert.equal(nodes(h.render(),n=>n.type==='textarea'&&n.props['aria-label']==='交代给 Dot 的事情')[0].props.value,'回来继续这个问题');assert.doesNotMatch(h.source,/localStorage|sessionStorage/);
  }finally{h.dispose();}
});

test('native prefill rechecks the binding after delayed retain readiness and preserves stale local input',async()=>{
  const h=await harness();h.context.snapshot.bindingRevision='before-rebind';let ready,prepared=0;const binding={sessionId:'dot-source',ctx:{get:()=>({input:{requestDraftInitialization:()=>{prepared++;return'applied';}}})}};h.ctx.sessions={retain:()=>({binding,ready:new Promise(resolve=>{ready=resolve;}),release(){}})};
  try{h.render();await h.flush();nodes(h.render(),n=>n.type==='textarea')[0].props.onChange({target:{value:'只属于旧绑定的问题'}});const pending=button(h.render(),'开始对话').props.onClick();h.context.snapshot={...h.context.snapshot,bindingRevision:'after-rebind'};ready();await pending;const view=h.render();assert.equal(prepared,0);assert.equal(h.opened.length,0);assert.match(text(view),/绑定或项目范围已变化/);assert.equal(nodes(view,n=>n.type==='textarea')[0].props.value,'只属于旧绑定的问题');assert.equal(h.requests.length,2);
  }finally{h.dispose();}
});

test('superseded follow-up receipts cannot be reported as saved, and queued once does not imply a cold runner',async()=>{
  const h=await harness();h.context.snapshot.projects[0].followup={available:true,followup:null,once:{enabled:true,running:false,status:'queued',nextDueAt:'2026-10-23T20:00:00Z'}};h.context.onFetch=(url,options)=>url===endpoint?Response.json(h.context.snapshot):Response.json({action:JSON.parse(options.body).action,projectId:'p1',followup:{enabled:false,running:false},once:null});
  try{h.render();await h.flush();assert.match(text(h.render()),/等待到期/);assert.doesNotMatch(text(h.render()),/运行器未启动/);button(h.render(),'公开项目 A').props.onClick();await button(h.render(),'查看或安排跟进').props.onClick();nodes(drawer(h.render()),n=>n.type==='select'&&n.props.value==='once')[0].props.onChange({target:{value:'repeat'}});button(h.render(),'核对安排').props.onClick();await button(h.render(),'确认跟进').props.onClick();assert.match(text(h.render()),/安排结果需核对/);assert.doesNotMatch(text(h.render()),/已为.*保存跟进安排/);assert.equal(actionPosts(h).filter(row=>row.body.action==='followup_configure').length,1);
  }finally{h.dispose();}
});

test('continuing two same-title results carries the chosen stable task ID into distinct drafts',async()=>{
  const h=await harness();h.context.snapshot.jobs.push({...h.context.snapshot.jobs[0],id:'j2'});
  try{h.render();await h.flush();let view=h.render();const history=nodes(view,n=>n.props['data-dot-history'])[0],cards=nodes(history,n=>n.props['data-dot-job']);assert.equal(cards.length,2);button(cards.find(n=>n.props['data-dot-job']==='j1'),'和 Dot 接着聊').props.onClick();view=h.render();assert.match(nodes(view,n=>n.type==='textarea')[0].props.value,/交办记录 ID：j1.*已有交办结果.*不重新提交或重做任务/);nodes(view,n=>n.type==='textarea')[0].props.onChange({target:{value:''}});view=h.render();button(nodes(view,n=>n.props['data-dot-job']==='j2')[0],'和 Dot 接着聊').props.onClick();assert.match(nodes(h.render(),n=>n.type==='textarea')[0].props.value,/交办记录 ID：j2/);assert.deepEqual(actionPosts(h),[]);
  }finally{h.dispose();}
});

test('opening native conversation also resolves unsaved memory through the same keep/discard policy',async()=>{
  const h=await harness(),row=memoryRow('native-exit','context','原始背景');seedMemory(h,row);h.context.onFetch=url=>url===endpoint?Response.json(h.context.snapshot):memoryDetail(row);
  try{h.render();await h.flush();let view=await openMemory(h);nodes(drawer(view),n=>n.type==='textarea')[0].props.onChange({target:{value:'离开前的草稿'}});await button(h.render(),'打开 Dot 会话').props.onClick();assert.deepEqual(h.opened,[]);assert.match(text(drawer(h.render())),/这次修改还没保存/);button(h.render(),'保留草稿并离开').props.onClick();assert.deepEqual(h.opened,['dot-source']);assert.equal(posts(h).length,0);
  }finally{h.dispose();}
});

test('a cancellation receipt that still reports enabled cannot claim the plan was closed',async()=>{
  const h=await harness();h.context.onFetch=(url,options)=>url===endpoint?Response.json(h.context.snapshot):Response.json({action:JSON.parse(options.body).action,projectId:'p1',followup:{enabled:true,running:true,everyMinutes:60},once:null});
  try{h.render();await h.flush();button(h.render(),'公开项目 A').props.onClick();await button(h.render(),'查看或安排跟进').props.onClick();await button(h.render(),'关闭这项跟进').props.onClick();assert.match(text(h.render()),/关闭结果需核对/);assert.doesNotMatch(text(h.render()),/已关闭「/);assert.equal(actionPosts(h).filter(r=>r.body.action==='followup_cancel').length,1);
  }finally{h.dispose();}
});

test('applied home draft clears before native open synchronously unmounts the workbench',async()=>{
  const h=await harness();let applied=0,opened=0;const binding={sessionId:'dot-source',ctx:{get:()=>({input:{requestDraftInitialization:()=>{applied++;return'applied';}}})}};h.ctx.sessions={retain:()=>({binding,ready:Promise.resolve(),release(){}})};h.ctx.uiWorkspace.openSession=()=>{opened++;h.unmount();};
  try{h.render();await h.flush();nodes(h.render(),n=>n.type==='textarea')[0].props.onChange({target:{value:'成功交接后不应再次出现'}});await button(h.render(),'开始对话').props.onClick();assert.equal(applied,1);assert.equal(opened,1);h.render();await h.flush();assert.equal(nodes(h.render(),n=>n.type==='textarea')[0].props.value,'');
  }finally{h.dispose();}
});

test('native handoff preserves local home draft for preserved, blocked and navigation failure outcomes',async()=>{
  for(const outcome of ['preserved','blocked','navigation-failed']){
    const h=await harness(),binding={sessionId:'dot-source',ctx:{get:()=>({input:{requestDraftInitialization:()=>outcome==='navigation-failed'?'applied':outcome}})}};h.ctx.sessions={retain:()=>({binding,ready:Promise.resolve(),release(){}})};if(outcome==='navigation-failed')h.ctx.uiWorkspace.openSession=()=>{throw new Error('navigation failed');};
    try{h.render();await h.flush();nodes(h.render(),n=>n.type==='textarea')[0].props.onChange({target:{value:'尚未成功完成交接的输入'}});await button(h.render(),'开始对话').props.onClick();h.unmount();h.render();await h.flush();assert.equal(nodes(h.render(),n=>n.type==='textarea')[0].props.value,'尚未成功完成交接的输入',outcome);
    }finally{h.dispose();}
  }
});

test('applied project shortcut cannot clear a different home draft when native open unmounts',async()=>{
  const h=await harness(),binding={sessionId:'dot-source',ctx:{get:()=>({input:{requestDraftInitialization:()=>'applied'}})}};h.ctx.sessions={retain:()=>({binding,ready:Promise.resolve(),release(){}})};h.ctx.uiWorkspace.openSession=()=>h.unmount();
  try{h.render();await h.flush();nodes(h.render(),n=>n.type==='textarea')[0].props.onChange({target:{value:'另一个首页问题仍然保留'}});button(h.render(),'公开项目 A').props.onClick();await button(h.render(),'和 Dot 聊这个项目').props.onClick();h.render();await h.flush();assert.equal(nodes(h.render(),n=>n.type==='textarea')[0].props.value,'另一个首页问题仍然保留');
  }finally{h.dispose();}
});
