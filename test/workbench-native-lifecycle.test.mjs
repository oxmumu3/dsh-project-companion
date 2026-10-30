import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

// Execute the actual Workbench, overlay, retained DesktopConversation and their
// hooks together. Only Host transport/native editor rendering is synthetic.
async function fixture({selected=true,draftStatus='applied',changeBinding=false}={}){
 const instances=new Map(),registrations=[],cleanups=[],requests=[],retained=[],released=[];
 let current,cursor,pending=[],definition;
 const React={createElement:(type,props,...children)=>({type,props:{...props,children:children.flat(Infinity)},children:children.flat(Infinity)}),
  useState(initial){const row=current,i=cursor++;if(!(i in row.values))row.values[i]=typeof initial==='function'?initial():initial;return[row.values[i],value=>{row.values[i]=typeof value==='function'?value(row.values[i]):value;}];},
  useRef(value){const row=current,i=cursor++;return row.values[i]??(row.values[i]={current:value});},
  useEffect(fn,deps){const row=current,i=cursor++,old=row.values[i];if(!old||deps.some((v,j)=>v!==old.deps[j])){old?.cleanup?.();const cell={deps};row.values[i]=cell;pending.push(()=>cell.cleanup=fn());}},useCallback:fn=>fn};
 const snapshot={version:1,generatedAt:'2026-10-30T17:00:00Z',hostTimeZone:'America/Mexico_City',availability:{projects:true,jobs:true,plans:true},connection:{state:'bound',readOnly:true,sessionId:'family_owner_synthetic'},projects:[],jobs:[],reminders:[],limitations:[],personalReview:{available:true,attentionItems:{available:true,items:[]},schedules:{available:true,items:[]},review:{status:'off'},news:{topics:[]}}};
 const state={phase:'ready',ids:['selected-native'],byId:{'selected-native':{id:'selected-native',cwd:'/synthetic/project',retainedBy:{}}}};
 const draft={text:selected?'用户已有的未发送草稿':'',attachments:selected?['synthetic-local-attachment']:[],approvals:selected?['synthetic-pending-approval']:[]};
 let binding,created=0,refCount=0,form={status:'ready',writable:true,revision:1,value:{desktopConversationSessionId:selected?'selected-native':'',desktopConversationSelectionVersion:selected?1:0}};
 const makeBinding=id=>({sessionId:id,ctx:{get:()=>({input:{for:()=>({focus(){}}),requestDraftInitialization:(_binding,options)=>{assert.equal(options.clearPreviousDraft,false);if(draftStatus==='preserved')return'preserved';draft.text=options.prompt;return'applied';}}})}});binding=makeBinding('selected-native');
 vm.runInNewContext(await readFile(new URL('../src/client.js',import.meta.url),'utf8'),{window:{__ModuleLoader__:{load:d=>definition=d}},AbortController,AbortSignal,Date,setInterval,clearInterval,fetch:async(url,options)=>{requests.push({url,options});return Response.json(changeBinding&&created?{...snapshot,bindingRevision:'changed-after-create'}:snapshot);}});
 const api=definition.factory(id=>id==='react'?React:{Modal:'modal'});
 const ctx={effect:fn=>cleanups.push(fn()),layout:{selectPanel(){}},uiWorkspace:{openSession(){throw Error('lifecycle test must stay on Dot');}},
  slots:{inject:(_name,fn)=>fn(),register:(spec,component)=>{registrations.push({spec,component});return()=>{};}},
  configForms:{get:()=>({getSnapshot:()=>form,mutate:async ops=>{const value={...form.value};for(const op of ops)value[op.path[0]]=op.value;form={...form,revision:form.revision+1,value};return true;}})},
  sessions:{refresh:async()=>{},list:{getSnapshot:()=>state},create:async()=>{created++;const id='created-native';binding=makeBinding(id);state.ids=[id];state.byId={[id]:{id,cwd:'/synthetic/project',retainedBy:{}}};if(draftStatus==='preserved')draft.text='原生会话中已有的另一份草稿';return id;},binding:()=>binding,retain:id=>{assert.equal(id,binding.sessionId);retained.push(id);refCount++;return{binding,ready:Promise.resolve(),release(){released.push(id);if(--refCount===0){draft.text='';draft.attachments=[];draft.approvals=[];}}};}}};
 api.apply(ctx);
 const main=registrations.find(r=>r.spec.name==='main').component,overlay=registrations.find(r=>r.spec.name==='shell.overlay').component;
 const props={usePanelInfo:selector=>selector({activePanelId:'project-companion-dot'}),useSessions:selector=>selector(state),SessionProvider:({children})=>React.createElement('native-session',null,children),renderSlot:()=>React.createElement('native-editor',{'data-native-editor':true,draft})};
 function render(){const seen=new Set();function walk(node,path='0'){
  if(node===null||node===undefined||typeof node!=='object')return node;
  if(typeof node.type==='function'){let row=instances.get(path);if(!row||row.type!==node.type){row?.values.forEach(v=>v?.cleanup?.());row={type:node.type,values:[]};instances.set(path,row);}seen.add(path);current=row;cursor=0;return walk(node.type(node.props),path+'.f');}
  return{...node,children:node.children.map((child,i)=>walk(child,path+'.'+i))};
 }const tree=walk(React.createElement('host',null,React.createElement(main,props),React.createElement(overlay,props)));for(const[path,row]of instances)if(!seen.has(path)){row.values.forEach(v=>v?.cleanup?.());instances.delete(path);}return tree;}
 const settle=async()=>{for(let i=0;i<8;i++){render();const run=pending;pending=[];run.forEach(fn=>fn());await new Promise(resolve=>setImmediate(resolve));}return render();};
 return{render,settle,props,state,snapshot,draft,retained,released,requests,dispose(){for(const row of instances.values())row.values.forEach(v=>v?.cleanup?.());cleanups.forEach(fn=>fn?.());}};
}
function nodes(tree,predicate){if(!tree||typeof tree!=='object')return[];return[...(predicate(tree)?[tree]:[]),...tree.children.flatMap(child=>nodes(child,predicate))];}
const text=tree=>typeof tree==='string'?tree:(tree?.children??[]).map(text).join(' ');
const button=(tree,label)=>nodes(tree,node=>node.type==='button'&&(node.props['aria-label']===label||text(node)===label))[0];
const editors=tree=>nodes(tree,n=>n.props['data-native-editor']);

test('Today, other-page floating conversation and return share one retained editor binding and native draft',async()=>{
 const f=await fixture();try{
  let tree=await f.settle();assert.equal(editors(tree).length,1);assert.equal(button(tree,'打开 Dot 对话'),undefined);assert.deepEqual(f.retained,['selected-native']);
  button(tree,'项目').props.onClick();tree=await f.settle();assert.equal(editors(tree).length,0);assert.deepEqual(f.released,[]);
  button(tree,'打开 Dot 对话').props.onClick();tree=await f.settle();assert.equal(editors(tree).length,1);assert.equal(nodes(tree,n=>n.props.role==='dialog').length,1);assert.deepEqual(f.retained,['selected-native']);
  f.draft.text='浮层补充后的草稿';button(tree,'收起 Dot 对话').props.onClick();tree=await f.settle();assert.equal(editors(tree).length,0);assert.equal(f.draft.text,'浮层补充后的草稿');assert.deepEqual(f.released,[]);
  button(tree,'打开 Dot 对话').props.onClick();tree=await f.settle();assert.equal(editors(tree).length,1);button(tree,'今天').props.onClick();tree=await f.settle();
  assert.equal(editors(tree).length,1);assert.equal(nodes(tree,n=>n.props.role==='dialog').length,0);assert.equal(button(tree,'打开 Dot 对话'),undefined);assert.equal(f.draft.text,'浮层补充后的草稿');assert.deepEqual(f.draft.attachments,['synthetic-local-attachment']);assert.deepEqual(f.draft.approvals,['synthetic-pending-approval']);assert.deepEqual(f.retained,['selected-native']);assert.deepEqual(f.released,[]);assert.ok(f.requests.every(r=>r.options.method==='GET'||r.url==='/api/project_companion/catalog'&&JSON.parse(r.options.body).action==='list'));
 }finally{f.dispose();assert.deepEqual(f.released,['selected-native']);}
});

for(const status of ['applied','preserved'])test(`first local draft survives explicit floating native creation (${status})`,async()=>{
 const f=await fixture({selected:false,draftStatus:status});const local='完整保留的首用草稿\n第二行 <保留原文> 不能丢失';try{
  let tree=await f.settle();assert.equal(editors(tree).length,0);const input=nodes(tree,n=>n.type==='textarea'&&n.props['aria-label']==='交代给 Dot 的事情')[0];input.props.onChange({target:{value:local}});button(tree,'项目').props.onClick();tree=await f.settle();button(tree,'打开 Dot 对话').props.onClick();tree=await f.settle();await button(tree,'开始桌面对话').props.onClick();tree=await f.settle();assert.equal(editors(tree).length,1);
  if(status==='applied'){assert.equal(f.draft.text,local);assert.equal(nodes(tree,n=>n.props['data-dot-retained-local-draft']).length,0);}else{assert.equal(f.draft.text,'原生会话中已有的另一份草稿');const recovery=nodes(tree,n=>n.props['data-dot-retained-local-draft'])[0];assert.ok(recovery);assert.equal(text(nodes(recovery,n=>n.type==='pre')[0]),local);assert.ok(button(recovery,'复制保留草稿'));assert.ok(button(recovery,'放入当前对话草稿'));}
  button(tree,'今天').props.onClick();tree=await f.settle();assert.equal(editors(tree).length,1);assert.equal(f.draft.text,status==='applied'?local:'原生会话中已有的另一份草稿');if(status==='preserved'){const recovery=nodes(tree,n=>n.props['data-dot-retained-local-draft'])[0];assert.ok(recovery);assert.equal(text(nodes(recovery,n=>n.type==='pre')[0]),local);}
 }finally{f.dispose();}
});

test('changed workbench scope during explicit floating creation keeps exact local draft recoverable',async()=>{
 const f=await fixture({selected:false,changeBinding:true});const local='只属于创建前范围的原始草稿';try{let tree=await f.settle();nodes(tree,n=>n.type==='textarea')[0].props.onChange({target:{value:local}});button(tree,'项目').props.onClick();tree=await f.settle();button(tree,'打开 Dot 对话').props.onClick();tree=await f.settle();await button(tree,'开始桌面对话').props.onClick();tree=await f.settle();assert.equal(f.draft.text,'');const recovery=nodes(tree,n=>n.props['data-dot-retained-local-draft'])[0];assert.ok(recovery);assert.equal(text(nodes(recovery,n=>n.type==='pre')[0]),local);assert.ok(button(recovery,'复制保留草稿'));assert.match(text(tree),/范围.*变化|原范围.*未确认/);}finally{f.dispose();}
});
