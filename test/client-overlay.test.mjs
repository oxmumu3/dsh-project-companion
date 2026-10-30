import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createDotOverlay, registerDotOverlay } from '../src/client-overlay.js';

const nodes=(tree,p)=>{const out=[];const walk=n=>{if(!n||typeof n!=='object')return;if(p(n))out.push(n);for(const child of n.children??[])walk(child);};walk(tree);return out;};
const text=tree=>typeof tree==='string'?tree:(tree?.children??[]).map(text).join(' ');
function harness(overrides={}){
  let values=[],cursor=0,pending=[];const rendered=[],activated=[];let focusCount=0;
  const React={createElement:(type,props,...children)=>({type,props:props??{},children:children.flat(Infinity).filter(x=>x!==null&&x!==false&&x!==undefined)}),
    useState:initial=>{const i=cursor++;if(!(i in values))values[i]=typeof initial==='function'?initial():initial;return[values[i],v=>{values[i]=typeof v==='function'?v(values[i]):v;}];},
    useRef:initial=>{const i=cursor++;if(!(i in values))values[i]={current:initial};return values[i];},
    useEffect:(fn,deps)=>{const i=cursor++,old=values[i];if(!old||deps.some((v,j)=>v!==old.deps[j])){old?.cleanup?.();values[i]={deps};pending.push(()=>{values[i].cleanup=fn();});}},
  };
  const adapters={renderConversation:props=>{rendered.push(props);return React.createElement('native-conversation',props);},activateDesktop:()=>{activated.push(true);},...overrides};
  const Component=createDotOverlay(React,adapters);
  const props={SessionProvider:'session-provider',renderSlot:()=>{},};
  return{React,adapters,Component,props,rendered,activated,render:()=>{cursor=0;const tree=Component(props);for(const n of nodes(tree,n=>n.props.ref)){n.props.ref.current={isConnected:true,focus:()=>{focusCount++;}};}return tree;},
    flush:async()=>{const run=pending;pending=[];run.forEach(fn=>fn());await new Promise(resolve=>setImmediate(resolve));},focusCount:()=>focusCount,
    dispose:()=>{values.forEach(v=>v?.cleanup?.());},};
}
const button=(tree,label)=>nodes(tree,n=>n.type==='button'&&n.props['aria-label']===label)[0];

test('mount only exposes a labelled launcher and does not acquire a conversation',async()=>{
  const c=harness();const tree=c.render();await c.flush();
  assert.equal(c.rendered.length,0);assert.equal(c.activated.length,0);
  const launch=button(tree,'打开 Dot 对话');assert.ok(launch);assert.equal(launch.props['aria-expanded'],false);
  assert.equal(nodes(tree,n=>n.props.role==='dialog').length,0);
  assert.doesNotMatch(text(tree),/未读|\b99\+\b/);
});

test('ready Today editor removes redundant launcher instead of offering a second editor',async()=>{
 const c=harness({useSurface:()=>({homeActive:true,homeReady:true})});const tree=c.render();await c.flush();assert.equal(button(tree,'打开 Dot 对话'),undefined);assert.equal(nodes(tree,n=>n.props.role==='dialog').length,0);assert.equal(c.rendered.length,0);
});

test('Today start surface focuses the existing entry without opening an overlay',async()=>{
 let focused=0;const c=harness({useSurface:()=>({homeActive:true,homeReady:false}),focusHome:()=>{focused++;return true;}});button(c.render(),'打开 Dot 对话').props.onClick();const tree=c.render();await c.flush();assert.equal(focused,1);assert.equal(nodes(tree,n=>n.props.role==='dialog').length,0);assert.equal(c.rendered.length,0);
});

test('returning to Today removes floating editor before home is eligible to acquire',async()=>{
 let homeActive=false;const c=harness({useSurface:()=>({homeActive,homeReady:false})});button(c.render(),'打开 Dot 对话').props.onClick();let tree=c.render();await c.flush();assert.equal(nodes(tree,n=>n.type==='native-conversation').length,1);homeActive=true;tree=c.render();assert.equal(nodes(tree,n=>n.type==='native-conversation').length,0);await c.flush();assert.equal(nodes(c.render(),n=>n.props.role==='dialog').length,0);
});

test('native-main handoff suspends and closes the overlay before another editor can open',async()=>{
 let suspended=false;const c=harness({useSurface:()=>({suspended})});button(c.render(),'打开 Dot 对话').props.onClick();let tree=c.render();await c.flush();assert.equal(nodes(tree,n=>n.type==='native-conversation').length,1);suspended=true;tree=c.render();assert.equal(nodes(tree,n=>n.type==='native-conversation').length,0);assert.equal(button(tree,'打开 Dot 对话'),undefined);await c.flush();suspended=false;tree=c.render();assert.equal(nodes(tree,n=>n.type==='native-conversation').length,0);
});

test('opening delegates the original provider and slot props to one overlay conversation',async()=>{
  const c=harness();button(c.render(),'打开 Dot 对话').props.onClick();const tree=c.render();await c.flush();
  assert.equal(nodes(tree,n=>n.props.role==='dialog').length,1);assert.equal(c.rendered.length,1);
  assert.equal(nodes(tree,n=>n.props.role==='dialog')[0].props.tabIndex,-1);assert.equal(c.focusCount(),1,'keyboard opening focuses the dialog');
  assert.equal(c.rendered[0].location,'overlay');assert.equal(c.rendered[0].SessionProvider,c.props.SessionProvider);assert.equal(c.rendered[0].renderSlot,c.props.renderSlot);
  assert.equal(nodes(tree,n=>n.type==='textarea'||n.type==='input').length,0,'native conversation owns the editor');
});

test('closing removes the native conversation subtree and restores launcher focus',async()=>{
  const c=harness();button(c.render(),'打开 Dot 对话').props.onClick();let tree=c.render();await c.flush();
  button(tree,'收起 Dot 对话').props.onClick();tree=c.render();await c.flush();
  assert.equal(nodes(tree,n=>n.type==='native-conversation').length,0);assert.equal(c.activated.length,0);assert.equal(c.focusCount(),2);
});

test('Escape only closes this panel after native child handling and outside IME composition',async()=>{
  const c=harness();button(c.render(),'打开 Dot 对话').props.onClick();let tree=c.render();await c.flush();
  let panel=nodes(tree,n=>n.props.role==='dialog')[0];
  for(const extra of[{defaultPrevented:true},{isComposing:true},{nativeEvent:{isComposing:true}},{altKey:true}])panel.props.onKeyDown({key:'Escape',...extra});
  assert.equal(nodes(c.render(),n=>n.props.role==='dialog').length,1);
  let prevented=0,stopped=0;panel.props.onKeyDown({key:'Escape',preventDefault:()=>prevented++,stopPropagation:()=>stopped++});
  tree=c.render();await c.flush();assert.equal(nodes(tree,n=>n.props.role==='dialog').length,0);assert.equal(prevented,1);assert.equal(stopped,1);
});

test('workbench activation runs only after the overlay conversation has been removed',async()=>{
  const c=harness();button(c.render(),'打开 Dot 对话').props.onClick();let tree=c.render();await c.flush();
  button(tree,'打开完整工作台').props.onClick();assert.equal(c.activated.length,0);
  tree=c.render();assert.equal(nodes(tree,n=>n.type==='native-conversation').length,0);await c.flush();assert.equal(c.activated.length,1);
  c.render();await c.flush();assert.equal(c.activated.length,1,'render does not reopen the workbench');
});

test('workbench failure is visible without exposing exception content or retaining the editor',async()=>{
  const c=harness({activateDesktop:()=>{throw new Error('PRIVATE_ACCOUNT_TOKEN');}});button(c.render(),'打开 Dot 对话').props.onClick();let tree=c.render();await c.flush();
  button(tree,'打开完整工作台').props.onClick();c.render();await c.flush();tree=c.render();
  assert.match(text(tree),/工作台暂未打开/);assert.doesNotMatch(text(tree),/PRIVATE/);assert.equal(nodes(tree,n=>n.type==='native-conversation').length,0);
});

test('layout leaves the surrounding page interactive and constrains the panel to the viewport',()=>{
  const c=harness();const tree=c.render();assert.equal(tree.props.style.pointerEvents,'none');
  const style=text(nodes(tree,n=>n.type==='style')[0]);assert.match(style,/pointer-events:auto/);assert.match(style,/100dvh/);assert.match(style,/safe-area-inset-bottom/);assert.match(style,/--dsh-frame-overlay-top/);
  assert.doesNotMatch(style,/z-index:\s*(?:999|214748)/);
});

test('official root overlay registration declares the shared native session child and disposes once',()=>{
  let injections=[],registered=[],effects=[],disposed=0;const Component=()=>{};
  const ctx={effect:fn=>effects.push(fn()),slots:{inject:(name,fn)=>{injections.push(name);return fn();},register:(spec,c)=>{registered.push({spec,c});return()=>{disposed++;};}}};
  registerDotOverlay(ctx,Component);assert.deepEqual(injections,['shell.overlay']);assert.equal(registered[0].c,Component);
  assert.equal(registered[0].spec.id,'dsh-dot-launcher');assert.deepEqual(registered[0].spec.children,{'dot.overlay.conversation':{kind:'single',scope:'session'}});
  effects.forEach(dispose=>dispose());assert.equal(disposed,1);
});

test('the export can be embedded verbatim in the existing official single-file loader',()=>{
  const factory=vm.runInNewContext(`(${createDotOverlay.toString()})`);const register=vm.runInNewContext(`(${registerDotOverlay.toString()})`);
  const c=harness();assert.equal(typeof factory(c.React,c.adapters),'function');
  assert.doesNotThrow(()=>register({},()=>{}));
});


test('unmount cancels deferred workbench activation',async()=>{
  const c=harness();button(c.render(),'打开 Dot 对话').props.onClick();let tree=c.render();await c.flush();
  button(tree,'打开完整工作台').props.onClick();c.render();const flushing=c.flush();c.dispose();await flushing;
  assert.equal(c.activated.length,0);
});
