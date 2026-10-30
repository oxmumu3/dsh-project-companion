import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

// Execute the actual Workbench, overlay, retained DesktopConversation and their
// hooks together. Only Host transport/native editor rendering is synthetic.
async function fixture(){
 const instances=new Map(),registrations=[],cleanups=[],requests=[],retained=[],released=[];
 let current,cursor,pending=[],definition;
 const React={createElement:(type,props,...children)=>({type,props:{...props,children:children.flat(Infinity)},children:children.flat(Infinity)}),
  useState(initial){const row=current,i=cursor++;if(!(i in row.values))row.values[i]=typeof initial==='function'?initial():initial;return[row.values[i],value=>{row.values[i]=typeof value==='function'?value(row.values[i]):value;}];},
  useRef(value){const row=current,i=cursor++;return row.values[i]??(row.values[i]={current:value});},
  useEffect(fn,deps){const row=current,i=cursor++,old=row.values[i];if(!old||deps.some((v,j)=>v!==old.deps[j])){old?.cleanup?.();const cell={deps};row.values[i]=cell;pending.push(()=>cell.cleanup=fn());}},useCallback:fn=>fn};
 const snapshot={version:1,generatedAt:'2026-10-30T17:00:00Z',hostTimeZone:'America/Mexico_City',availability:{projects:true,jobs:true,plans:true},connection:{state:'bound',readOnly:true,sessionId:'family_owner_synthetic'},projects:[],jobs:[],reminders:[],limitations:[],personalReview:{available:true,attentionItems:{available:true,items:[]},schedules:{available:true,items:[]},review:{status:'off'},news:{topics:[]}}};
 const state={phase:'ready',ids:['selected-native'],byId:{'selected-native':{id:'selected-native',cwd:'/synthetic/project',retainedBy:{}}}};
 const draft={text:'用户已有的未发送草稿',attachments:['synthetic-local-attachment'],approvals:['synthetic-pending-approval']};
 const binding={sessionId:'selected-native',ctx:{get:()=>({input:{for:()=>({focus(){}})}})}};
 vm.runInNewContext(await readFile(new URL('../src/client.js',import.meta.url),'utf8'),{window:{__ModuleLoader__:{load:d=>definition=d}},AbortController,AbortSignal,Date,setInterval,clearInterval,fetch:async(url,options)=>{requests.push({url,options});return Response.json(snapshot);}});
 const api=definition.factory(id=>id==='react'?React:{Modal:'modal'});
 const ctx={effect:fn=>cleanups.push(fn()),layout:{selectPanel(){}},uiWorkspace:{openSession(){throw Error('lifecycle test must stay on Dot');}},
  slots:{inject:(_name,fn)=>fn(),register:(spec,component)=>{registrations.push({spec,component});return()=>{};}},
  configForms:{get:()=>({getSnapshot:()=>({status:'ready',writable:false,revision:1,value:{desktopConversationSessionId:'selected-native',desktopConversationSelectionVersion:1}})})},
  sessions:{refresh:async()=>{},list:{getSnapshot:()=>state},binding:()=>binding,retain:id=>{assert.equal(id,'selected-native');retained.push(id);return{binding,ready:Promise.resolve(),release(){released.push(id);draft.text='';draft.attachments=[];draft.approvals=[];}};}}};
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
