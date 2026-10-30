import test from 'node:test';
import assert from 'node:assert/strict';
const imported=await import('../src/client-conversation.js').catch(()=>({}));
const {createDesktopConversationController:create,desktopConversationCanEmbed:canEmbed,createDotConversationViews:createViews}=imported;
const target={sessionId:'native-dot',revision:'native:native-dot'};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
function fixture(){
 const retained=[],released=[],focused=[],draft={text:'保留输入',references:['ref-file'],attachments:['browser-file']};
 let ready=Promise.resolve(),selection={status:'ready',writable:true,revision:1,value:{desktopConversationSessionId:'',desktopConversationSelectionVersion:0}},creates=0;
 const bindings=new Map(),rows=new Map([[target.sessionId,{id:target.sessionId,cwd:'/synthetic'}],['second-native',{id:'second-native',cwd:'/synthetic'}]]);
 const form={getSnapshot:()=>selection,mutate:async(ops,revision)=>{assert.equal(revision,selection.revision);const value={...selection.value};for(const op of ops)value[op.path[0]]=op.value;selection={...selection,revision:revision+1,value};return true;}};
 const ctx={configForms:{get:()=>form},sessions:{refresh:async()=>{},list:{getSnapshot:()=>({phase:'ready',ids:[...rows.keys()],byId:Object.fromEntries(rows)})},create:()=>{creates++;},binding:id=>bindings.get(id),retain(id,options){retained.push({id,options});const input={focus:()=>focused.push(id),state:{getSnapshot:()=>draft}};const scope={get:name=>name==='conversation'?{input:{for:arg=>{assert.equal(arg,scope);return input;}}}:null};const binding={sessionId:id,ctx:scope,session:{getSnapshot:()=>({})}};bindings.set(id,binding);return{binding,ready,release(){released.push(id);bindings.delete(id);}};}}};
 return{ctx,form,rows,bindings,retained,released,focused,draft,get creates(){return creates;},get selection(){return selection;},setSelection:value=>{selection=value;},setReady:value=>{ready=value;}};
}
test('continuous binding keeps native draft references and attachments across exclusive editor transfer',async()=>{
 assert.equal(typeof create,'function');const f=fixture(),c=create(f.ctx),changes=[];c.subscribe(()=>changes.push(c.getSnapshot()));
 const first=await c.acquire('home',target);await assert.rejects(c.acquire('overlay',target),/另一处/);c.release('home');
 assert.equal(f.released.length,0);const second=await c.acquire('overlay',target);assert.equal(first,second);assert.equal(f.retained.length,1);assert.deepEqual(f.draft,{text:'保留输入',references:['ref-file'],attachments:['browser-file']});assert.ok(changes.some(s=>s.owner===null));
 c.close();c.close();assert.deepEqual(f.released,['native-dot']);assert.equal(c.getSnapshot().closed,true);assert.equal(f.creates,0);
});
test('released delayed acquisition cannot claim ownership after a newer surface acquired',async()=>{
 assert.equal(typeof create,'function');const f=fixture(),gate=deferred();f.setReady(gate.promise);const c=create(f.ctx);
 const a=c.acquire('home',target);c.release('home');const b=c.acquire('overlay',target);gate.resolve();await assert.rejects(a);await b;
 assert.equal(c.getSnapshot().owner,'overlay');assert.equal(f.retained.length,1);c.close();assert.equal(f.released.length,1);
});
test('close during delayed readiness disposes once and never publishes a ready old editor',async()=>{
 assert.equal(typeof create,'function');const f=fixture(),gate=deferred();f.setReady(gate.promise);const c=create(f.ctx),p=c.acquire('home',target);c.close();gate.resolve();await assert.rejects(p);assert.equal(f.released.length,1);await assert.rejects(c.acquire('overlay',target));
});
test('new target waits for old editor release and releases its old lifetime reference',async()=>{
 assert.equal(typeof create,'function');const f=fixture(),c=create(f.ctx);await c.acquire('home',target);await assert.rejects(c.acquire('overlay',{sessionId:'second-native'}));assert.equal(f.retained.length,1);c.release('home');await c.acquire('overlay',{sessionId:'second-native'});assert.deepEqual(f.released,['native-dot']);c.close();assert.deepEqual(f.released,['native-dot','second-native']);
});
test('native readiness or mismatched binding failure releases unusable reference and permits explicit retry',async()=>{
 assert.equal(typeof create,'function');const f=fixture(),gate=deferred();f.setReady(gate.promise);const c=create(f.ctx),p=c.acquire('home',target);gate.reject(Error('unavailable'));await assert.rejects(p);assert.equal(f.released.length,1);f.setReady(Promise.resolve());const gate2=deferred();f.setReady(gate2.promise);const p2=c.acquire('home',target);f.bindings.set(target.sessionId,{sessionId:'wrong'});gate2.resolve();await assert.rejects(p2);assert.equal(f.released.length,2);f.setReady(Promise.resolve());await c.acquire('home',target);c.close();
});
test('uncertain native release fails closed and cannot mount a second editor',async()=>{
 assert.equal(typeof create,'function');const f=fixture(),original=f.ctx.sessions.retain;f.ctx.sessions.retain=(...args)=>{const ref=original(...args);return{...ref,release(){throw Error('uncertain');}};};const c=create(f.ctx);await c.acquire('home',target);c.release('home');await assert.rejects(c.acquire('overlay',{sessionId:'second-native'}));assert.equal(c.getSnapshot().closed,true);assert.equal(f.retained.length,1);c.close();
});
test('native identity validation rejects Family carriers, subagents and malformed targets',async()=>{
 assert.equal(typeof create,'function');const f=fixture(),c=create(f.ctx);for(const id of ['family_owner','family-no-legacy','',null,'../../private','x'.repeat(201)])await assert.rejects(c.acquire('home',{sessionId:id}));assert.equal(f.retained.length,0);
 f.rows.get(target.sessionId).origin='subagent';assert.equal(await c.resolve(target),null);await assert.rejects(c.acquire('home',target));assert.equal(f.retained.length,0);
});
test('unmarked legacy pointer is only a metadata candidate and never restored or retained',async()=>{
 assert.equal(typeof create,'function');const f=fixture();f.setSelection({...f.selection,value:{desktopConversationSessionId:target.sessionId,desktopConversationSelectionVersion:0}});const c=create(f.ctx);assert.equal(await c.restore(),null);assert.deepEqual(await c.candidate(),target);assert.equal(f.retained.length,0);assert.equal(f.creates,0);assert.equal(f.selection.value.desktopConversationSelectionVersion,0);
});
test('explicit remember atomically saves pointer and selection version then verifies native echo',async()=>{
 assert.equal(typeof create,'function');const f=fixture(),c=create(f.ctx),ops=[];const mutate=f.form.mutate;f.form.mutate=async(o,r)=>{ops.push(o);return mutate(o,r);};assert.equal(await c.remember(target.sessionId),true);assert.equal(ops.length,1);assert.deepEqual(ops[0].map(o=>o.path[0]),['desktopConversationSessionId','desktopConversationSelectionVersion']);assert.deepEqual(await c.restore(),target);assert.equal(await c.candidate(),null);assert.equal(f.retained.length,0);
 f.form.mutate=async()=>true;assert.equal(await c.remember('second-native'),false);assert.equal((await c.restore()).sessionId,target.sessionId);
});
test('native focus checks current ownership and binding and never falls back to DOM access',async()=>{
 assert.equal(typeof create,'function');const f=fixture(),c=create(f.ctx);assert.equal(c.focus(target),false);await c.acquire('home',target);assert.equal(c.focus(target),true);assert.deepEqual(f.focused,['native-dot']);c.release('home');assert.equal(c.focus(target),false);await c.acquire('overlay',target);f.bindings.set(target.sessionId,{sessionId:target.sessionId});assert.equal(c.focus(target),false);assert.equal(f.focused.length,1);c.close();
});
test('unknown native main cannot embed another editor',()=>{
 assert.equal(typeof canEmbed,'function');assert.equal(canEmbed({},target.sessionId),false);assert.equal(canEmbed({activePanelId:null,mainSessionId:target.sessionId},target.sessionId),false);assert.equal(canEmbed({activePanelId:null,mainSessionId:null,mainViewEmpty:true},target.sessionId),true);assert.equal(canEmbed({activePanelId:'dot',mainSessionId:target.sessionId},target.sessionId),true);
});
function viewFixture(){
 let cursor=0;const states=[],nativeCalls=[];const React={Fragment:'fragment',createElement:(type,props,...children)=>({type,props:{...props,children:children.flat(Infinity)}}),useState:initial=>{const i=cursor++;if(!(i in states))states[i]=initial;return[states[i],v=>{states[i]=v;}];}};
 const loc={kind:'step',turn:{turn:1},step:{step:1}};const answer={status:'settled',turn:1,step:1,time:3,blocks:[{kind:'text',text:'实际回复 <script>bad()</script>'}],finalNode:{seq:3,turn:1,step:1,messageId:'assistant-1'}};
 const user={key:'user',kind:'user',anchorSeq:1,location:loc,data:{kind:'user',seq:1,time:1,content:[{type:'text',text:'实际问题'}],source:{kind:'user'}}};
 const assistant={key:'assistant',kind:'assistant-step',anchorSeq:3,location:loc,data:answer};const tail={key:'tail',kind:'turn-tail',anchorSeq:4,location:loc,data:{turn:1,closing:answer}};
 const nodes=new Map([['user',user],['assistant',assistant],['tail',tail]]),chat={order:[...nodes.keys()],nodes,timeline:{turnOrder:[1],turns:new Map([[1,{status:'closed'}]])}};
 const session={openState:'open',running:false,pendingSubmissions:[],openError:null,promptError:null},input={phase:'plain',attachmentIds:[],occurrences:[],queue:[]},status=new Map();
 const props={sessionId:target.sessionId,useChat:fn=>fn(chat),useSession:fn=>fn(session),useInput:fn=>fn(input),useSessionStatus:fn=>fn(status),renderSlot:(name,options)=>{nativeCalls.push({name,options});return React.createElement('native-history');}};
 assert.equal(typeof createViews,'function');const Component=createViews(React);
 function walk(node){if(node===null||typeof node!=='object')return node;if(typeof node.type==='function')return walk(node.type(node.props));return{...node,props:{...node.props,children:(node.props.children??[]).map(walk)}};}
 return{props,chat,nodes,user,assistant,tail,answer,session,input,status,nativeCalls,render:()=>{cursor=0;return walk(React.createElement(Component,props));}};
}
function find(tree,predicate){if(!tree||typeof tree!=='object')return[];return[...(predicate(tree)?[tree]:[]),...(tree.props.children??[]).flatMap(n=>find(n,predicate))];}
function text(tree){return typeof tree==='string'?tree:(tree?.props?.children??[]).map(text).join(' ');}
test('compact view renders only actual user and finalized response as bounded React text',()=>{
 const f=viewFixture(),tree=f.render();assert.match(text(tree),/实际问题/);assert.match(text(tree),/实际回复 <script>bad\(\)<\/script>/);assert.equal(f.nativeCalls.length,0);assert.equal(find(tree,n=>n.props.dangerouslySetInnerHTML).length,0);
 f.user.data.content=[{type:'text',text:'问'.repeat(900)}];f.answer.blocks=[{kind:'text',text:'答'.repeat(5000)}];const long=f.render();assert.ok(text(long).length<3000);assert.match(text(long),/完整对话/);
});
test('full-history toggle replaces views only without mounting another Composer',()=>{
 const f=viewFixture();let tree=f.render();find(tree,n=>n.type==='button'&&text(n)==='查看完整对话')[0].props.onClick();tree=f.render();assert.equal(find(tree,n=>n.type==='native-history').length,1);assert.deepEqual(f.nativeCalls.at(-1),{name:'conversation.session',options:{view:'chat'}});find(tree,n=>n.type==='button'&&text(n)==='回到最近对话')[0].props.onClick();tree=f.render();assert.match(text(tree),/实际回复/);assert.equal(find(tree,n=>n.type==='native-history').length,0);
});
for(const mode of ['running','loading','error','approval','submitting','echo','rich-user','rich-assistant','draft-attachment','reference','interrupted','tool','unknown','unclosed','new-user','injected-user'])test(`native view preserves unsafe or rich state: ${mode}`,()=>{
 const f=viewFixture();if(mode==='running')f.session.running=true;if(mode==='loading')f.session.openState='loading';if(mode==='error')f.session.promptError={message:'failed'};if(mode==='approval')f.status.set(target.sessionId,{pendingInteraction:{kind:'approval'}});if(mode==='submitting')f.input.phase='submitting';if(mode==='echo')f.session.pendingSubmissions=[{requestId:'pending'}];if(mode==='rich-user')f.user.data.content.push({type:'image',data:'native-attachment'});if(mode==='rich-assistant')f.answer.blocks.push({kind:'image',attachment:'native'});if(mode==='draft-attachment')f.input.attachmentIds.push('file');if(mode==='reference')f.user.data.referenceLabels=['reference'];if(mode==='interrupted')f.answer.finalNode.interrupted=true;if(mode==='tool'||mode==='unknown'){f.chat.order.splice(1,0,mode);f.nodes.set(mode,{kind:mode,location:f.user.location,data:{}});}if(mode==='unclosed')f.chat.timeline.turns.get(1).status='open';if(mode==='new-user'){f.chat.order.push('later');f.nodes.set('later',{...f.user,key:'later',anchorSeq:5,data:{...f.user.data,seq:5}});}if(mode==='injected-user')f.user.data.source.kind='hook';
 const tree=f.render();assert.equal(find(tree,n=>n.type==='native-history').length,1);assert.equal(f.nativeCalls[0].name,'conversation.session');assert.equal(text(tree).includes('实际回复'),false);
});
test('pending native readiness cannot focus an unmounted Composer',async()=>{
 const f=fixture(),gate=deferred();f.setReady(gate.promise);const c=create(f.ctx),p=c.acquire('home',target);assert.equal(c.focus(target),false);assert.equal(f.focused.length,0);gate.resolve();await p;assert.equal(c.focus(target),true);c.close();
});
test('missing native focus capability stays unavailable without affecting editor ownership',async()=>{
 const f=fixture(),c=create(f.ctx);await c.acquire('home',target);f.bindings.get(target.sessionId).ctx.get=()=>null;assert.equal(c.focus(target),false);assert.equal(c.getSnapshot().owner,'home');c.close();
});
test('unknown interaction projection or missing ordered node uses native history',()=>{
 const f=viewFixture();f.props.useSessionStatus=fn=>fn(null);assert.equal(find(f.render(),n=>n.type==='native-history').length,1);
 const g=viewFixture();g.chat.order.push('missing-native-node');assert.equal(find(g.render(),n=>n.type==='native-history').length,1);
});
test('hidden user rows and intermediate assistant text do not replace the official final response',()=>{
 const f=viewFixture();f.chat.order.splice(1,0,'intermediate');f.nodes.set('intermediate',{...f.assistant,data:{...f.answer,blocks:[{kind:'text',text:'仅中间步骤'}],finalNode:{seq:2}}});f.chat.order.push('hidden');f.nodes.set('hidden',{...f.user,visibility:'hidden',data:{...f.user.data,seq:5,content:[{type:'text',text:'隐藏问题'}]}});const tree=f.render();assert.match(text(tree),/实际回复/);assert.doesNotMatch(text(tree),/仅中间步骤|隐藏问题/);assert.equal(f.nativeCalls.length,0);
});
test('unsupported standard hooks preserve native same-session controls',()=>{
 const f=viewFixture();delete f.props.useChat;assert.equal(find(f.render(),n=>n.type==='native-history').length,1);assert.equal(f.nativeCalls[0].name,'conversation.session');
});
test('draft reference chips remain with official native controls',()=>{
 const f=viewFixture();f.input.occurrences.push({source:'file',ref:'notes'});assert.equal(find(f.render(),n=>n.type==='native-history').length,1);
});
