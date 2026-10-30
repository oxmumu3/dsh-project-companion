import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

// Mount the registered shell component and its real nested Dot components using
// synthetic hook storage. Native session transport is stubbed; no messages send.
async function fixture(){
 const instances=new Map(),registrations=[],requests=[],retained=[],released=[];let current,cursor,pending=[],definition,created=0;
 const React={createElement:(type,props,...children)=>({type,props:{...props,children:children.flat(Infinity)},children:children.flat(Infinity)}),
  useState(initial){const row=current,i=cursor++;if(!(i in row.values))row.values[i]=typeof initial==='function'?initial():initial;return[row.values[i],v=>{row.values[i]=typeof v==='function'?v(row.values[i]):v;}];},
  useRef(value){const row=current,i=cursor++;return row.values[i]??(row.values[i]={current:value});},
  useEffect(fn,deps){const row=current,i=cursor++,old=row.values[i];if(!old||deps.some((v,j)=>v!==old.deps[j])){old?.cleanup?.();const cell={deps};row.values[i]=cell;pending.push(()=>cell.cleanup=fn());}},useCallback:fn=>fn};
 const state={phase:'ready',ids:[],byId:{}},route={state:'unavailable'};
 vm.runInNewContext(await readFile(new URL('../src/client.js',import.meta.url),'utf8'),{window:{__ModuleLoader__:{load:d=>definition=d}},AbortController,AbortSignal,fetch:async(url)=>{requests.push(url);return Response.json(route);}});
 const api=definition.factory(id=>id==='react'?React:{Modal:'modal'});
 const cleanups=[],bindings=new Map();
 const ctx={effect:fn=>cleanups.push(fn()),layout:{selectPanel(){}},slots:{inject:(_name,fn)=>fn(),register:(spec,component)=>{registrations.push({spec,component});return()=>{};}},
  sessions:{refresh:async()=>{},list:{getSnapshot:()=>state},create:async()=>{created++;const id='synthetic-created';state.ids=[id];state.byId={[id]:{id,cwd:'/synthetic/project',retainedBy:{}}};return id;},
   retain:id=>{retained.push(id);const binding={sessionId:id};bindings.set(id,binding);return{binding,ready:Promise.resolve(),release:()=>released.push(id)};},binding:id=>bindings.get(id)}};
 api.apply(ctx);const root=registrations.find(row=>row.spec.name==='shell.overlay').component;
 const props={usePanelInfo:selector=>selector({activePanelId:'projects'}),useSessions:selector=>selector(state),SessionProvider:({children})=>React.createElement('native-session',null,children),renderSlot:()=>React.createElement('native-composer')};
 function render(){const seen=new Set();function walk(node,path='0'){
   if(node===null||node===undefined||typeof node!=='object')return node;
   if(typeof node.type==='function'){let row=instances.get(path);if(!row||row.type!==node.type){row?.values.forEach(v=>v?.cleanup?.());row={type:node.type,values:[]};instances.set(path,row);}seen.add(path);current=row;cursor=0;return walk(node.type(node.props),path+'.f');}
   return{...node,children:node.children.map((child,i)=>walk(child,path+'.'+i))};
  }const tree=walk(React.createElement(root,props));for(const[path,row]of instances)if(!seen.has(path)){row.values.forEach(v=>v?.cleanup?.());instances.delete(path);}return tree;
 }
 const settle=async()=>{let tree;for(let i=0;i<5;i++){tree=render();const run=pending;pending=[];run.forEach(fn=>fn());await new Promise(resolve=>setImmediate(resolve));}return render();};
 return{render,settle,state,route,props,requests,retained,released,get created(){return created;},dispose(){for(const row of instances.values())row.values.forEach(v=>v?.cleanup?.());cleanups.forEach(fn=>fn?.());}};
}
function nodes(tree,predicate){if(!tree||typeof tree!=='object')return[];return[...(predicate(tree)?[tree]:[]),...tree.children.flatMap(child=>nodes(child,predicate))];}
const text=tree=>typeof tree==='string'?tree:(tree?.children??[]).map(text).join(' ');
const button=(tree,label)=>nodes(tree,node=>node.type==='button'&&(node.props['aria-label']===label||text(node)===label))[0];

for(const deleted of [false,true])test(`overlay reopens an unsaved native session with metadata validation (deleted=${deleted})`,async()=>{
 const f=await fixture();try{
  let tree=await f.settle();assert.equal(f.requests.length,0);
  button(tree,'打开 Dot 对话').props.onClick();tree=await f.settle();
  await button(tree,'开始桌面对话').props.onClick();tree=await f.settle();assert.equal(nodes(tree,n=>n.type==='native-composer').length,1);assert.deepEqual(f.retained,['synthetic-created']);
  button(tree,'收起 Dot 对话').props.onClick();tree=await f.settle();assert.deepEqual(f.released,['synthetic-created']);
  // The old source route must not replace the explicitly created conversation.
  Object.assign(f.route,{state:'ready',sessionId:'older-native-route',revision:'old'});
  if(deleted){f.state.ids=[];f.state.byId={};}
  button(tree,'打开 Dot 对话').props.onClick();tree=await f.settle();
  assert.equal(f.requests.length,1,'cached identity must not fall back to an older source route');assert.equal(f.created,1);
  assert.deepEqual(f.retained,deleted?['synthetic-created']:['synthetic-created','synthetic-created']);
  assert.equal(nodes(tree,n=>n.type==='native-composer').length,deleted?0:1);
  if(deleted)assert.match(text(tree),/已有桌面对话暂不可用/);
 }finally{f.dispose();}
});

for(const map of [undefined,null,[], 'invalid'])test(`overlay treats a missing or invalid native session map as unknown (${String(map)})`,async()=>{
 const f=await fixture();try{
  f.props.usePanelInfo=selector=>selector({activePanelId:null});f.state.byId=map;
  Object.assign(f.route,{state:'ready',sessionId:'original-native-route',revision:'original'});
  let tree=await f.settle();button(tree,'打开 Dot 对话').props.onClick();tree=await f.settle();
  assert.equal(nodes(tree,n=>n.type==='native-composer').length,0);assert.deepEqual(f.retained,[]);
  assert.match(text(tree),/请打开完整工作台继续对话/);
 }finally{f.dispose();}
});
