import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

// Run the production Workbench, goal views, providers, overlay and lifecycle
// controllers together. Only authenticated transport and Host UI are synthetic.
async function fixture({attention=[],geometry}={}){
 const instances=new Map(),registrations=[],cleanups=[],requests=[],retained=[],released=[],mutations=[],initializations=[];
 let current,cursor,pending=[],definition,bindingRevision=1,activePanel='project-companion-dot',boardRevision=1;
 const React={createElement:(type,props,...children)=>({type,props:{...props,children:children.flat(Infinity)},children:children.flat(Infinity)}),
  useState(initial){const row=current,i=cursor++;if(!(i in row.values))row.values[i]=typeof initial==='function'?initial():initial;return[row.values[i],value=>{row.values[i]=typeof value==='function'?value(row.values[i]):value;}];},
  useRef(value){const row=current,i=cursor++;return row.values[i]??(row.values[i]={current:value});},
  useEffect(fn,deps){const row=current,i=cursor++,old=row.values[i];if(!old||deps.some((v,j)=>v!==old.deps[j])){old?.cleanup?.();const cell={deps};row.values[i]=cell;pending.push(()=>cell.cleanup=fn());}},useCallback:fn=>fn};
 const drafts=new Map(),bindings=new Map(),counts=new Map(),sessionState={phase:'ready',ids:[],byId:{}};
 const addSession=id=>{if(bindings.has(id))return;const draft={text:'未发送 '+id,attachments:['attachment-'+id],approvals:['approval-'+id]};drafts.set(id,draft);bindings.set(id,{sessionId:id,ctx:{get:()=>({input:{for:()=>({focus(){}}),requestDraftInitialization:(_binding,options)=>{initializations.push(options);if(draft.text.trim())return 'preserved';draft.text=options.prompt;return 'applied';}}})},session:{getSnapshot:()=>({})}});sessionState.ids.push(id);sessionState.byId[id]={id,cwd:'/synthetic/workspace',retainedBy:{}};};
 addSession('global-native');
 const snapshot={version:1,generatedAt:'2026-10-30T17:00:00Z',hostTimeZone:'America/Mexico_City',availability:{projects:true,jobs:true,plans:false},connection:attention.length?{state:'bound',sessionId:'global-native'}:{state:'missing'},projects:[],jobs:[],reminders:[],limitations:[],personalReview:{available:true,attentionItems:{available:true,items:attention},schedules:{available:true,items:[]},review:{status:'off'},news:{topics:[]}}};
 const projects=[1,2].map(n=>({id:'goal-'+n,title:'目标 '+n,goal:'合成结果 '+n,constraints:['不自动发送'],state:'confirmed',lane:n===1?'mine':'waiting',progress:'已整理有限合成资料',nextStep:'核对结果',stale:false,evidenceCount:0,sessionCount:0,workspaceCount:0,updatedAt:'2026-10-30T00:00:00Z'}));
 const status=()=>({version:1,revision:'board-'+boardRevision,accessRevision:'scope-1',projects,scan:{phase:'idle',at:null,coverage:[]},standaloneCount:0,uncertainCount:0});
 const fetch=async(url,options)=>{const body=options.body?JSON.parse(options.body):null;requests.push({url,body,method:options.method});
  if(url==='/api/project_companion/workbench')return Response.json(snapshot);
  if(url==='/api/project_companion/onboarding')return Response.json({version:1,projects:[],connection:{state:'waiting-qr',qrAvailable:true,qrRevision:'a'.repeat(16)}});
  if(url==='/api/project_companion/workspaces')return Response.json({version:1,revision:'scope-1',catalogRevision:'catalog-1',total:1,matchedTotal:1,offset:0,limit:20,hasMore:false,nextOffset:null,items:[{id:'public-workspace',label:'合成工作区',sessionCount:2,available:true,selected:false}],selectedIds:[],selectedCount:0});
  if(url==='/api/project_companion/goals'){
   if(body.action==='status')return Response.json(status());
   if(body.action==='detail')return Response.json({version:1,revision:'board-'+boardRevision,accessRevision:'scope-1',project:projects.find(p=>p.id===body.projectId),evidence:[],conversation:null});
   if(body.action==='conversation'){const sessionId='dot-'+body.projectId;if(!bindings.has(sessionId)){addSession(sessionId);boardRevision++;}return Response.json({version:1,projectId:body.projectId,conversation:{sessionId,revision:'native:'+sessionId}});}
   if(body.action==='vision'){projects.push({...projects[0],id:'goal-3',title:body.title,goal:body.goal});boardRevision++;return Response.json(status());}
  }
  throw Error('Unexpected synthetic request '+url+' '+body?.action);
 };
 const resizeListeners=new Set(),observers=[],browserWindow={__ModuleLoader__:{load:d=>definition=d},addEventListener:(name,fn)=>{if(name==='resize')resizeListeners.add(fn);},removeEventListener:(name,fn)=>{if(name==='resize')resizeListeners.delete(fn);}};
 const Observer=geometry?class{constructor(callback){this.callback=callback;this.targets=new Set();this.disconnected=false;observers.push(this);}observe(target){this.targets.add(target);}disconnect(){this.disconnected=true;this.targets.clear();}}:undefined;
 vm.runInNewContext(await readFile(new URL('../src/client.js',import.meta.url),'utf8'),{window:browserWindow,ResizeObserver:Observer,AbortController,AbortSignal,Date,setInterval,clearInterval,fetch});
 const api=definition.factory(id=>id==='react'?React:{Modal:'modal'});
 let form={status:'ready',writable:true,revision:bindingRevision,value:{desktopConversationSessionId:'global-native',desktopConversationSelectionVersion:1}};
 const ctx={effect:fn=>cleanups.push(fn()),layout:{selectPanel:id=>{activePanel=id;}},uiWorkspace:{openSession(){throw Error('must continue in current view');}},slots:{inject:(_name,fn)=>fn(),register:(spec,component)=>{registrations.push({spec,component});return()=>{};}},configForms:{get:()=>({getSnapshot:()=>form,mutate:async ops=>{mutations.push(ops);form={...form,revision:++bindingRevision};return true;}})},sessions:{refresh:async()=>{},list:{getSnapshot:()=>sessionState},create:()=>{throw Error('per-project must use authenticated dedicated target');},binding:id=>bindings.get(id),retain:id=>{assert.ok(bindings.has(id));retained.push(id);counts.set(id,(counts.get(id)??0)+1);return{binding:bindings.get(id),ready:Promise.resolve(),release(){released.push(id);counts.set(id,counts.get(id)-1);if(!counts.get(id)){const draft=drafts.get(id);draft.text='';draft.attachments=[];draft.approvals=[];}}};}}};api.apply(ctx);
 const main=registrations.find(r=>r.spec.name==='main').component,overlay=registrations.find(r=>r.spec.name==='shell.overlay').component;
 const props={usePanelInfo:selector=>selector({activePanelId:activePanel}),useSessions:selector=>selector(sessionState),SessionProvider:({session,children})=>React.createElement('native-provider',{'data-native-session':session.binding.sessionId},children),renderSlot:()=>React.createElement('native-editor',{'data-native-editor':true})};
 function render(){const seen=new Set();function walk(node,path='0'){if(node===null||node===undefined||typeof node!=='object')return node;if(typeof node.type==='function'){let row=instances.get(path);if(!row||row.type!==node.type){row?.values.forEach(v=>v?.cleanup?.());row={type:node.type,values:[]};instances.set(path,row);}seen.add(path);current=row;cursor=0;return walk(node.type(node.props),path+'.f');}return{...node,children:node.children.map((child,i)=>walk(child,path+'.'+i))};}const tree=walk(React.createElement('host',null,React.createElement(main,props),React.createElement(overlay,props)));for(const[path,row]of instances)if(!seen.has(path)){row.values.forEach(v=>v?.cleanup?.());instances.delete(path);}if(geometry){for(const node of nodes(tree,n=>n.props.ref)){if(node.props['data-dot-workbench'])node.props.ref.current=geometry.root;if(node.props['data-dot-workbench-inner'])node.props.ref.current=geometry.inner;if(node.props['data-dot-home-conversation'])node.props.ref.current=geometry.anchor;}}return tree;}
 const settle=async()=>{for(let i=0;i<10;i++){render();const run=pending;pending=[];run.forEach(fn=>fn());await new Promise(resolve=>setImmediate(resolve));}return render();};
 return{render,settle,requests,retained,released,drafts,mutations,initializations,observers,resizeListeners,resize:()=>resizeListeners.forEach(fn=>fn()),grow:()=>observers.filter(o=>!o.disconnected).forEach(o=>o.callback()),form:()=>form,dispose(){for(const row of instances.values())row.values.forEach(v=>v?.cleanup?.());cleanups.forEach(fn=>fn?.());}};
}
function nodes(tree,predicate){if(!tree||typeof tree!=='object')return[];return[...(predicate(tree)?[tree]:[]),...tree.children.flatMap(child=>nodes(child,predicate))];}
const text=tree=>typeof tree==='string'?tree:(tree?.children??[]).map(text).join(' ');
const button=(tree,label)=>nodes(tree,n=>n.type==='button'&&(n.props['aria-label']===label||text(n)===label))[0];
const editors=tree=>nodes(tree,n=>n.props['data-native-editor']);
const nativeIds=tree=>nodes(tree,n=>n.props['data-native-session']).map(n=>n.props['data-native-session']);

test('actual Workbench switches global and two project native conversations with drafts, attachments and approvals retained',async()=>{
 const f=await fixture();try{
  let tree=await f.settle();assert.equal(editors(tree).length,1);assert.deepEqual(nativeIds(tree),['global-native']);assert.ok(nodes(tree,n=>n.props['data-dot-inline-wechat']).length);assert.ok(button(tree,'选择工作区'));
  button(tree,'项目').props.onClick();tree=await f.settle();assert.equal(editors(tree).length,0);button(tree,'目标 1').props.onClick();tree=await f.settle();assert.equal(editors(tree).length,1);assert.deepEqual(nativeIds(tree),['dot-goal-1']);assert.equal(button(tree,'打开 Dot 对话'),undefined);assert.equal(nodes(tree,n=>n.props.role==='dialog').length,1);f.drafts.get('dot-goal-1').text='项目一继续写，尚未发送';
  button(tree,'关闭项目').props.onClick();tree=await f.settle();button(tree,'目标 2').props.onClick();tree=await f.settle();assert.equal(editors(tree).length,1);assert.deepEqual(nativeIds(tree),['dot-goal-2']);f.drafts.get('dot-goal-2').text='项目二独立草稿';
  button(tree,'关闭项目').props.onClick();tree=await f.settle();button(tree,'目标 1').props.onClick();tree=await f.settle();assert.deepEqual(nativeIds(tree),['dot-goal-1']);assert.equal(f.drafts.get('dot-goal-1').text,'项目一继续写，尚未发送');assert.deepEqual(f.drafts.get('dot-goal-1').attachments,['attachment-dot-goal-1']);assert.deepEqual(f.drafts.get('dot-goal-1').approvals,['approval-dot-goal-1']);
  button(tree,'关闭项目').props.onClick();tree=await f.settle();button(tree,'今天').props.onClick();tree=await f.settle();assert.equal(editors(tree).length,1);assert.deepEqual(nativeIds(tree),['global-native']);assert.equal(f.drafts.get('global-native').text,'未发送 global-native');assert.equal(f.drafts.get('dot-goal-2').text,'项目二独立草稿');assert.deepEqual(f.released,[]);assert.deepEqual(f.retained,['global-native','dot-goal-1','dot-goal-2']);assert.deepEqual(f.mutations,[]);assert.equal(f.form().value.desktopConversationSessionId,'global-native');assert.equal(f.requests.some(r=>['save','recognize','submit'].includes(r.body?.action)),false);
 }finally{f.dispose();assert.deepEqual(new Set(f.released),new Set(['global-native','dot-goal-1','dot-goal-2']));}
});

test('first use may create an explicit one-sentence goal with empty workspace scope and continue in its visible native sheet',async()=>{
 const f=await fixture();try{let tree=await f.settle();button(tree,'项目').props.onClick();tree=await f.settle();button(tree,'交代一个新目标').props.onClick();tree=await f.settle();const inputs=nodes(tree,n=>n.type==='textarea'&&n.props['aria-label']==='想完成什么？');assert.equal(inputs.length,1);inputs[0].props.onChange({target:{value:'把首次真实验收走完'}});tree=f.render();const form=nodes(tree,n=>n.type==='form'&&n.props.className==='pc_goal_create')[0];await form.props.onSubmit({preventDefault(){}});tree=await f.settle();assert.deepEqual(nativeIds(tree),['dot-goal-3']);assert.equal(editors(tree).length,1);assert.match(text(tree),/把首次真实验收走完/);assert.deepEqual(f.requests.find(r=>r.body?.action==='vision').body,{action:'vision',projectId:null,title:'把首次真实验收走完',goal:'把首次真实验收走完',constraints:[],expectedRevision:'board-1'});assert.equal(f.requests.some(r=>['save','recognize','submit'].includes(r.body?.action)),false);}finally{f.dispose();}
});

test('scrolled Today transfers the same native editor into a floating conversation and restores scroll and attachments',async()=>{
 const f=await fixture();try{let tree=await f.settle();const workbench=nodes(tree,n=>n.props['data-dot-workbench'])[0],anchor=nodes(tree,n=>n.props['data-dot-home-conversation'])[0];assert.ok(anchor,'home native editor needs a measured placeholder');
 const scroller={scrollTop:640,scrollLeft:0,getBoundingClientRect:()=>({top:0,bottom:720})};let y=-280;
 workbench.props.ref.current=scroller;anchor.props.ref.current={getBoundingClientRect:()=>({top:y,bottom:y+240,height:240})};
 workbench.props.onScroll({currentTarget:scroller});tree=await f.settle();assert.ok(button(tree,'打开 Dot 对话'));button(tree,'打开 Dot 对话').props.onClick();tree=await f.settle();assert.equal(editors(tree).length,1);assert.deepEqual(nativeIds(tree),['global-native']);assert.ok(nodes(tree,n=>n.props['data-dot-native-placeholder']).length);f.drafts.get('global-native').text='浮层继续编辑';
 button(tree,'收起 Dot 对话').props.onClick();tree=await f.settle();assert.equal(editors(tree).length,1);assert.deepEqual(nativeIds(tree),['global-native']);assert.equal(scroller.scrollTop,640);assert.equal(f.drafts.get('global-native').text,'浮层继续编辑');assert.deepEqual(f.drafts.get('global-native').attachments,['attachment-global-native']);assert.deepEqual(f.released,[]);
 }finally{f.dispose();}
});

test('a scrolled attention continuation exposes its retained prompt when the native draft is already occupied',async()=>{
 const f=await fixture({attention:[{id:'saved-item',title:'核对真实交付',kind:'reply',sources:[]}]});try{let tree=await f.settle();const root=nodes(tree,n=>n.props['data-dot-workbench'])[0],anchor=nodes(tree,n=>n.props['data-dot-home-conversation'])[0];let revealed=0;root.props.ref.current={scrollTop:500,scrollLeft:0,getBoundingClientRect:()=>({top:0,bottom:720})};anchor.props.ref.current={getBoundingClientRect:()=>({top:-300,bottom:-60,height:240}),scrollIntoView:options=>{assert.equal(options.block,'nearest');revealed++;}};
 button(tree,'和 Dot 接着聊').props.onClick();tree=await f.settle();assert.equal(f.initializations.length,1);assert.equal(f.initializations[0].clearPreviousDraft,false);assert.equal(f.drafts.get('global-native').text,'未发送 global-native');assert.deepEqual(f.drafts.get('global-native').attachments,['attachment-global-native']);assert.ok(revealed>0);const retained=nodes(tree,n=>n.props['data-dot-retained-local-draft'])[0];assert.ok(retained);assert.match(text(retained),/请准备个人回顾「核对真实交付」的下一步/);assert.equal(f.requests.some(r=>['submit','coordinate'].includes(r.body?.action)),false);
 }finally{f.dispose();}
});

test('a preparation prompt accepted by the empty native composer clears only its matching temporary cache',async()=>{
 const f=await fixture({attention:[{id:'saved-item',title:'核对真实交付',kind:'reply',sources:[]}]});try{let tree=await f.settle();f.drafts.get('global-native').text='';f.drafts.get('global-native').attachments=[];button(tree,'和 Dot 接着聊').props.onClick();tree=await f.settle();assert.match(f.drafts.get('global-native').text,/请准备个人回顾「核对真实交付」的下一步/);assert.equal(nodes(tree,n=>n.props['data-dot-retained-local-draft']).length,0);assert.equal(editors(tree).length,1);assert.equal(f.initializations.length,1);}finally{f.dispose();}
});

test('floating entry remains available when only history is visible and the native composer is above the viewport',async()=>{
 const f=await fixture();try{let tree=await f.settle();const root=nodes(tree,n=>n.props['data-dot-workbench'])[0],anchor=nodes(tree,n=>n.props['data-dot-home-conversation'])[0];root.props.ref.current={scrollTop:400,getBoundingClientRect:()=>({top:0,bottom:720})};anchor.props.ref.current={getBoundingClientRect:()=>({top:-180,bottom:220,height:400}),querySelector:selector=>{assert.equal(selector,'[data-composer-seat]');return{getBoundingClientRect:()=>({top:-180,bottom:-20,height:160})};}};root.props.onScroll();tree=await f.settle();assert.ok(button(tree,'打开 Dot 对话'));assert.equal(editors(tree).length,1);}finally{f.dispose();}
});

test('native-ready, host resize and native content growth remeasure the actual composer and clean up observers',async()=>{
 let bottom=720,top=300,measurements=0;const seat={getBoundingClientRect:()=>{measurements++;return{top,bottom:top+180,height:180};}},root={getBoundingClientRect:()=>({top:0,bottom})},inner={},anchor={querySelector:selector=>selector==='[data-composer-seat]'?seat:null,getBoundingClientRect:()=>({top,bottom:top+380,height:380})};
 const f=await fixture({geometry:{root,inner,anchor}});try{let tree=await f.settle();assert.ok(measurements>0,'initial native readiness must measure the actual seat');assert.equal(button(tree,'打开 Dot 对话'),undefined);assert.ok(f.observers.some(o=>o.targets.has(seat)));bottom=240;f.resize();tree=await f.settle();assert.ok(button(tree,'打开 Dot 对话'),'host resize must reveal the floating entry');bottom=720;top=-200;f.grow();tree=await f.settle();assert.ok(button(tree,'打开 Dot 对话'),'composer growth/layout updates must be measured');top=300;f.grow();tree=await f.settle();assert.equal(button(tree,'打开 Dot 对话'),undefined);f.dispose();assert.equal(f.resizeListeners.size,0);assert.ok(f.observers.every(o=>o.disconnected));const before=measurements;for(const o of f.observers)o.callback();assert.equal(measurements,before,'late observer callbacks after cleanup must do nothing');}finally{f.dispose();}
});
