/** Self-contained factories embedded verbatim by the official browser ModuleLoader. */
export function createWorkspaceScopeController({request}) {
  const listeners=new Set(),known=new Map();
  let closed=false,epoch=0,baseline=new Set(),selected=new Set();
  let state={open:false,loading:false,selectingAll:false,saving:false,stale:false,error:'',summary:null,page:null,query:'',selectedIds:[],delta:{added:0,removed:0}};
  const publish=patch=>{if(closed)return;state=Object.freeze({...state,...patch,selectedIds:[...selected],delta:{added:[...selected].filter(id=>!baseline.has(id)).length,removed:[...baseline].filter(id=>!selected.has(id)).length+(state.page?.unavailableCount??0)}});for(const fn of [...listeners]){try{fn();}catch{}}};
  const validate=value=>{
    if(value?.version!==1||typeof value.revision!=='string'||typeof value.catalogRevision!=='string'||!Array.isArray(value.items)||value.items.length>100||!Array.isArray(value.selectedIds)||value.selectedIds.length>10000||new Set(value.selectedIds).size!==value.selectedIds.length||!value.selectedIds.every(id=>typeof id==='string'&&id.length>0&&id.length<=200)||value.selectedCount!==value.selectedIds.length||![value.total,value.matchedTotal,value.offset,value.limit].every(n=>Number.isSafeInteger(n)&&n>=0)||value.matchedTotal>value.total||value.offset+value.items.length>value.matchedTotal||typeof value.hasMore!=='boolean'||value.nextOffset!==(value.hasMore?value.offset+value.items.length:null)||value.hasMore&&!value.items.length||!value.items.every(row=>typeof row?.id==='string'&&row.id.length>0&&row.id.length<=200&&typeof row.label==='string'&&row.label.length<=200&&Number.isSafeInteger(row.sessionCount)&&row.sessionCount>=0&&row.available===true&&typeof row.selected==='boolean'))throw Error('工作区目录暂不可用，请重新加载。');
    for(const row of value.items)known.set(row.id,row);
    return value;
  };
  const summary=value=>({...value,labels:value.selectedIds.map(id=>({id,label:known.get(id)?.label??'已选工作区'}))});
  const failure=error=>error?.code==='WORKSPACE_SELECTION_LIMIT'?'一次最多选择 1000 个工作区，请缩小搜索范围。当前选择仍保留。':error?.status===409||/CHANGED|STALE|REVISION/.test(error?.code??'')?'工作区范围或目录已变化。当前选择仍保留，请重新加载后核对；没有自动重试。':'工作区状态尚未确认，当前选择仍保留。请恢复连接后重新加载核对。';
  async function load({query='',offset=0,reset=false}={}){
    if(closed||state.saving)return false;
    const token=++epoch;publish({loading:true,selectingAll:false,error:'',...(reset?{open:true,page:null,query:''}:{})});
    try{
      const value=validate(await request({action:'list',query,offset,limit:20,...(!reset&&state.page?{expectedCatalogRevision:state.page.catalogRevision}:{})}));
      if(closed||token!==epoch)return false;
      if(reset){baseline=new Set(value.selectedIds);selected=new Set(value.selectedIds);}
      else if(state.page&&(value.revision!==state.page.revision||value.catalogRevision!==state.page.catalogRevision))throw Object.assign(Error('stale'),{status:409});
      publish({page:value,summary:summary(value),query,stale:false});return true;
    }catch(error){if(!closed&&token===epoch)publish({error:failure(error),stale:error?.status===409||/CHANGED|STALE|REVISION/.test(error?.code??'')});return false;}
    finally{if(!closed&&token===epoch)publish({loading:false});}
  }
  return {
    getSnapshot:()=>state,
    subscribe(fn){if(closed)return()=>{};listeners.add(fn);return()=>listeners.delete(fn);},
    async refresh(){if(closed||state.open)return false;const token=++epoch;try{const value=validate(await request({action:'list',offset:0,limit:20}));if(closed||token!==epoch)return false;publish({summary:summary(value),error:''});return true;}catch{if(!closed&&token===epoch)publish({error:'工作区范围尚未确认，请重新加载。'});return false;}},
    open:()=>load({reset:true}),load,
    toggle(id){if(closed||!state.open||state.loading||state.saving||!known.has(id))return;if(selected.has(id))selected.delete(id);else selected.add(id);publish({});},
    selectVisible(){if(closed||!state.open||state.loading||state.saving)return;for(const row of state.page?.items??[])selected.add(row.id);publish({});},
    async selectAll(){
      if(closed||!state.open||!state.page||state.loading||state.saving||state.stale)return false;
      const token=++epoch,page=state.page,query=state.query,ids=new Set();publish({loading:true,selectingAll:true,error:''});
      try{
        if(page.matchedTotal>1000)throw Object.assign(Error('limit'),{code:'WORKSPACE_SELECTION_LIMIT'});
        let offset=0;
        while(ids.size<page.matchedTotal){
          const raw=await request({action:'list',query,offset,limit:50,expectedCatalogRevision:page.catalogRevision});
          if(closed||token!==epoch)return false;
          const value=validate(raw);
          if(value.revision!==page.revision||value.catalogRevision!==page.catalogRevision)throw Object.assign(Error('stale'),{status:409});
          if(value.offset!==offset||value.limit!==50||value.total!==page.total||value.matchedTotal!==page.matchedTotal)throw Error('catalog pagination mismatch');
          for(const row of value.items){if(ids.has(row.id))throw Error('duplicate workspace');ids.add(row.id);}
          if(value.hasMore!==(ids.size<page.matchedTotal))throw Error('incomplete catalog');
          if(!value.hasMore)break;
          offset=value.nextOffset;
        }
        const next=new Set([...selected,...ids]);
        if(next.size>1000)throw Object.assign(Error('limit'),{code:'WORKSPACE_SELECTION_LIMIT'});
        selected=next;publish({});return true;
      }catch(error){if(!closed&&token===epoch)publish({error:failure(error),stale:error?.status===409||/CHANGED|STALE|REVISION/.test(error?.code??'')});return false;}
      finally{if(!closed&&token===epoch)publish({loading:false,selectingAll:false});}
    },
    clearSelection(){if(closed||!state.open||state.loading||state.saving)return;selected.clear();publish({});},
    cancel(){if(closed||state.saving)return;epoch++;selected=new Set();baseline=new Set();publish({open:false,loading:false,selectingAll:false,page:null,error:'',stale:false});},
    async save(){
      if(closed||!state.open||!state.page||state.loading||state.saving||state.stale||!state.delta.added&&!state.delta.removed)return false;
      const token=++epoch,expectedRevision=state.page.revision,expectedCatalogRevision=state.page.catalogRevision;publish({saving:true,error:''});
      try{
        const value=validate(await request({action:'save',expectedRevision,expectedCatalogRevision,workspaceIds:[...selected]}));
        if(closed||token!==epoch)return false;
        if(value.selectedIds.length!==selected.size||value.selectedIds.some(id=>!selected.has(id)))throw Error('save echo mismatch');
        baseline=new Set(value.selectedIds);selected=new Set(value.selectedIds);publish({summary:summary(value),page:value,open:false,stale:false});return true;
      }catch(error){if(!closed&&token===epoch)publish({error:failure(error),stale:error?.status===409||/CHANGED|STALE|REVISION/.test(error?.code??'')});return false;}
      finally{if(!closed&&token===epoch)publish({saving:false});}
    },
    close(){if(closed)return;epoch++;closed=true;listeners.clear();known.clear();selected.clear();baseline.clear();},
  };
}

export function createLogicalProjectController({request}) {
  const listeners=new Set();let closed=false,selectionEpoch=0,statusEpoch=0,detailReadEpoch=0,mutating=false;
  let state=Object.freeze({status:null,revision:null,loading:false,busy:false,error:'',projectId:null,detail:null,target:null,detailLoading:false});
  const publish=patch=>{if(closed)return;state=Object.freeze({...state,...patch});for(const fn of [...listeners]){try{fn();}catch{}}};
  const validProject=row=>typeof row?.id==='string'&&typeof row.title==='string'&&typeof row.goal==='string'&&Array.isArray(row.constraints)&&row.constraints.every(s=>typeof s==='string')&&['proposed','confirmed'].includes(row.state)&&['mine','active','waiting','unknown'].includes(row.lane)&&typeof row.stale==='boolean';
  const validate=value=>{if(value?.version!==1||typeof value.revision!=='string'||!Array.isArray(value.projects)||!value.projects.every(validProject)||!['idle','running','complete','failed'].includes(value.scan?.phase)||!Array.isArray(value.scan.coverage)||!Number.isSafeInteger(value.standaloneCount)||!Number.isSafeInteger(value.uncertainCount))throw Error('项目状态暂不可用。');return value;};
  const failure=error=>error?.status===409||/CHANGED|STALE|REVISION/.test(error?.code??'')?'项目或资料范围已变化，请刷新后核对。当前对话草稿仍保留，没有自动重试。':'本次项目操作尚未确认，请恢复连接后刷新。当前对话草稿仍保留，没有自动重试。';
  const readDetail=async(projectId,token)=>{const readToken=++detailReadEpoch,value=await request({action:'detail',projectId});if(closed||readToken!==detailReadEpoch||token!==selectionEpoch||state.projectId!==projectId)return null;if(value?.version!==1||typeof value.revision!=='string'||!validProject(value.project)||value.project.id!==projectId||!Array.isArray(value.evidence)||!value.evidence.every(e=>typeof e?.id==='string'&&typeof e.available==='boolean'&&(e.available===false||typeof e.text==='string')))throw Error('项目资料暂不可用。');publish({detail:value,revision:value.revision});return value;};
  async function refresh(){
    if(closed||mutating)return false;
    const token=++statusEpoch;publish({loading:true});
    try{
      const value=validate(await request({action:'status'}));
      if(closed||token!==statusEpoch)return false;
      const detail=state.detail,scopeChanged=detail&&detail.accessRevision!==value.accessRevision;
      const safeDetail=scopeChanged?{...detail,accessRevision:value.accessRevision,project:{...detail.project,stale:true},evidence:detail.evidence.map(({text,...row})=>({...row,available:false}))}:detail;
      publish({status:value,revision:value.revision,error:'',detail:safeDetail});
      if(detail&&(scopeChanged||detail.revision!==value.revision))await readDetail(state.projectId,selectionEpoch);
      return true;
    }catch(error){if(!closed&&token===statusEpoch)publish({error:failure(error)});return false;}
    finally{if(!closed&&token===statusEpoch)publish({loading:false});}
  }

  const api={
    getSnapshot:()=>state,
    subscribe(fn){if(closed)return()=>{};listeners.add(fn);return()=>listeners.delete(fn);},refresh,
    async createGoal(text){
      const goal=typeof text==='string'?text.trim():'';
      if(closed||mutating||!state.status||!goal||goal.length>1200)return false;
      const knownIds=new Set(state.status.projects.map(p=>p.id));mutating=true;statusEpoch++;publish({busy:true,loading:false,error:''});
      try{const value=validate(await request({action:'vision',projectId:null,title:Array.from(goal).slice(0,40).join(''),goal,constraints:[],expectedRevision:state.revision}));if(closed)return false;publish({status:value,revision:value.revision});const added=value.projects.filter(p=>!knownIds.has(p.id));if(added.length!==1)throw Error('new project echo unavailable');return await api.open(added[0].id);}
      catch(error){publish({error:failure(error)});return false;}
      finally{mutating=false;publish({busy:false});}
    },
    async recognize(){if(closed||mutating||!state.status||state.status.scan.phase==='running')return false;mutating=true;statusEpoch++;publish({busy:true,loading:false,error:''});try{const value=validate(await request({action:'recognize',expectedRevision:state.revision,expectedAccessRevision:state.status.accessRevision}));if(closed)return false;publish({status:value,revision:value.revision});return true;}catch(error){publish({error:failure(error)});return false;}finally{mutating=false;publish({busy:false});}},
    async open(projectId){if(closed||typeof projectId!=='string')return false;const token=++selectionEpoch;publish({projectId,detail:null,target:null,detailLoading:true,error:''});try{const detail=await readDetail(projectId,token);if(!detail)return false;const value=await request({action:'conversation',projectId,expectedRevision:detail.revision});if(closed||token!==selectionEpoch||state.projectId!==projectId)return false;const target=value?.conversation;if(value?.version!==1||value.projectId!==projectId||typeof target?.sessionId!=='string'||!/^dot-goal-[A-Za-z0-9._:-]+$/.test(target.sessionId)||target.revision!==`native:${target.sessionId}`)throw Error('项目对话暂不可用。');const current=await readDetail(projectId,token);if(!current)return false;if(current.conversation&&current.conversation.sessionId!==target.sessionId)throw Error('项目会话已变化。');publish({target});return true;}catch(error){if(!closed&&token===selectionEpoch)publish({error:failure(error)});return false;}finally{if(!closed&&token===selectionEpoch)publish({detailLoading:false});}},
    dismiss(){selectionEpoch++;publish({projectId:null,detail:null,target:null,detailLoading:false,error:''});},
    async reloadDetail(){if(!state.projectId||closed)return false;const token=selectionEpoch,projectId=state.projectId;try{await readDetail(projectId,token);return true;}catch(error){if(token===selectionEpoch)publish({error:failure(error)});return false;}},
    async mutate(action,args={}){
      if(closed||mutating||!state.detail||!['accept','ignore','correct','vision'].includes(action))return false;
      const projectId=state.projectId,token=selectionEpoch,expectedRevision=state.detail.revision;mutating=true;statusEpoch++;publish({busy:true,loading:false,error:''});
      try{const value=validate(await request({...args,action,projectId,expectedRevision}));if(closed)return false;publish({status:value,revision:value.revision});if(token===selectionEpoch){if(action==='ignore'){selectionEpoch++;publish({projectId:null,detail:null,target:null,detailLoading:false});}else await readDetail(projectId,token);}return true;}
      catch(error){if(token===selectionEpoch)publish({error:failure(error)});return false;}
      finally{mutating=false;publish({busy:false});}
    },
    close(){if(closed)return;closed=true;selectionEpoch++;statusEpoch++;listeners.clear();},
  };
  return api;
}

/** Lifetime bindings survive editor transfer; never persist a project as the global Dot pointer. */
export function createGoalConversationRegistry({globalController,createController}) {
  const controllers=new Map([[null,globalController]]),listeners=new Set();let held=null,closed=false;
  const publish=()=>{for(const fn of [...listeners]){try{fn();}catch{}}};
  const controller=id=>{if(closed)throw Error('对话入口已关闭。');if(!controllers.has(id))controllers.set(id,createController());return controllers.get(id);};
  return {
    controller,
    getSnapshot:()=>({owner:held?.owner??null,projectId:held?.id??null,closed}),
    subscribe(fn){if(closed)return()=>{};listeners.add(fn);return()=>listeners.delete(fn);},
    async acquire(id,owner,target){if(closed)throw Error('对话入口已关闭。');if(held)throw Error('对话已在另一处打开，原草稿会保留。');const lease={id,owner};held=lease;publish();try{const reference=await controller(id).acquire(owner,target);if(closed||held!==lease)throw Error('对话入口已切换。');return reference;}catch(error){if(controllers.get(id)?.getSnapshot().closed){closed=true;held=null;for(const value of controllers.values())value.close();publish();listeners.clear();}else if(held===lease){held=null;publish();}throw error;}},
    release(id,owner){if(!held||held.id!==id||held.owner!==owner)return;controllers.get(id)?.release(owner);held=null;publish();},
    close(){if(closed)return;closed=true;held=null;for(const value of controllers.values())value.close();controllers.clear();publish();listeners.clear();},
  };
}

export function createDotGoalBoardViews(React) {
  const h=React.createElement;
  const button=(label,onClick,props={})=>h('button',{type:'button',onClick,...props},label);
  function useController(controller){const [state,setState]=React.useState(()=>controller.getSnapshot());React.useEffect(()=>{const update=()=>setState(controller.getSnapshot());const stop=controller.subscribe(update);update();return stop;},[controller]);return state;}
  function useDialog(open,cancel){
    const ref=React.useRef(null),cancelRef=React.useRef(cancel);cancelRef.current=cancel;
    React.useEffect(()=>{if(!open)return;const before=typeof document==='undefined'?null:document.activeElement;ref.current?.focus?.();return()=>{if(before?.isConnected)before.focus?.({preventScroll:true});};},[open]);
    const keyDown=event=>{if(event.defaultPrevented||event.isComposing||event.nativeEvent?.isComposing||event.keyCode===229)return;if(event.key==='Escape'){event.preventDefault();event.stopPropagation?.();cancelRef.current();return;}if(event.key!=='Tab')return;const items=Array.from(ref.current?.querySelectorAll?.('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]')??[]).filter(item=>item.getClientRects?.().length!==0);const first=items[0],last=items.at(-1),active=typeof document==='undefined'?null:document.activeElement;if(!items.length){event.preventDefault();ref.current?.focus?.();}else if(event.shiftKey&&(active===first||active===ref.current)){event.preventDefault();last.focus();}else if(!event.shiftKey&&(active===last||active===ref.current)){event.preventDefault();first.focus();}};
    return{ref,keyDown};
  }
  function WorkspaceGuide({controller,compact=false}){
    const state=useController(controller),summary=state.summary,n=summary?.selectedCount??0;
    React.useEffect(()=>{if(!controller.getSnapshot().summary)void controller.refresh();},[controller]);
    return h('section',{className:`pc_scope_guide${compact?' compact':''}`,'aria-label':'工作区访问范围'},h('div',null,h('p',{className:'pc_goal_eyebrow'},'了解你的工作'),h('h3',null,n?`已选择 ${n} 个工作区`:'让 Dot 了解你正在做什么'),h('p',null,n?'项目围绕目标组织，可以跨会话、跨工作区。以后随时添加或移除。':'先选一两个常用工作区，Dot 可从相关对话和项目说明中识别正在推进的事。以后随时添加。'),state.error&&!state.open?h('p',{role:'status',className:'pc_dot_error'},state.error):null),h('div',{className:'pc_scope_guide_actions'},button(n?'管理工作区':'选择工作区',()=>controller.open(),{className:n?'':'pc_dot_primary'}),h('p',null,'选择后不会自动读取、安排或推送。')));
  }
  function WorkspaceConnection({controller}){
    const state=useController(controller),summary=state.summary;
    return h('section',{className:'pc_scope_connection','aria-label':'工作区连接'},h('div',{className:'pc_scope_connection_head'},h('div',null,h('h3',null,'工作区'),h('p',null,'让 Dot 从你允许的范围中，识别跨对话的目标与项目。')),button(summary?.selectedCount?'管理工作区':'选择工作区',()=>controller.open())),h('div',{className:'pc_scope_chips'},...(summary?.labels??[]).slice(0,8).map(row=>h('span',{key:row.id},row.label)),summary?.selectedCount>8?h('span',null,`另 ${summary.selectedCount-8} 个`):null,!summary?.selectedCount?h('p',null,'尚未选择。可以先聊天，需要本地资料时再选。'):null),h('p',{className:'pc_dot_muted'},summary?`已允许 ${summary.selectedCount} 个工作区。新工作区不会自动加入。移除后停止读取；已保存的项目和历史仍保留。`:'工作区范围尚未确认。'),h('p',{className:'pc_scope_note'},'访问范围与持续关注分开管理。保存选择不会启动后台扫描、提醒或推送。'));
  }
  function WorkspaceDialog({controller}){
    const state=useController(controller),[query,setQuery]=React.useState(''),dialog=useDialog(state.open,()=>controller.cancel());
    React.useEffect(()=>{if(state.open)setQuery('');},[state.open]);
    if(!state.open)return null;
    const page=state.page,locked=state.loading||state.saving;
    return h('div',{className:'pc_scope_backdrop',onKeyDown:dialog.keyDown},h('section',{ref:dialog.ref,tabIndex:-1,role:'dialog','aria-modal':true,'aria-labelledby':'pc-scope-title',className:'pc_scope_dialog'},h('header',null,h('div',null,h('p',{className:'pc_goal_eyebrow'},'由你决定资料范围'),h('h2',{id:'pc-scope-title'},'Dot 可以了解哪些工作区？')),button('关闭',()=>controller.cancel(),{disabled:state.saving,'aria-label':'关闭工作区选择'})),h('p',null,'勾选允许读取的本地工作区。这里只列目录；保存后仍需主动整理，才会读取有限资料。'),page?.unavailableCount?h('p',{role:'status'},`${page.unavailableCount} 个原工作区已移除或身份变化，本次保存会清除这些失效授权。`):null,h('form',{className:'pc_scope_search',onSubmit:event=>{event.preventDefault();void controller.load({query,offset:0});}},h('input',{type:'search','aria-label':'搜索工作区',value:query,maxLength:80,placeholder:'搜索名称',disabled:locked,onChange:event=>setQuery(event.target.value)}),h('button',{type:'submit',disabled:locked},'搜索')),state.error?h('p',{role:'alert',className:'pc_dot_error'},state.error):null,state.stale?button('重新加载并核对选择',()=>controller.open(),{disabled:locked}):null,page?h('div',null,h('div',{className:'pc_scope_list_heading'},h('span',{'aria-live':'polite'},`匹配 ${page.matchedTotal} 个 · 共 ${page.total} 个工作区 · 已选 ${state.selectedIds.length} 个`),h('div',{className:'pc_dot_actions'},button(state.selectingAll?'正在全选…':state.query?`全选搜索结果 ${page.matchedTotal} 个`:`全选全部 ${page.total} 个`,()=>controller.selectAll(),{disabled:locked||state.stale||!page.matchedTotal}),button(state.query?'清空已选':'取消全选',()=>controller.clearSelection(),{disabled:locked||!state.selectedIds.length,'aria-label':'取消全部工作区的选择'}))),h('div',{className:'pc_scope_choices'},page.items.length?page.items.map(row=>h('label',{className:'pc_scope_choice',key:row.id},h('input',{type:'checkbox',checked:state.selectedIds.includes(row.id),disabled:locked,onChange:()=>controller.toggle(row.id)}),h('span',null,h('strong',null,row.label),h('small',null,[row.disambiguator,`${row.sessionCount} 个会话`].filter(Boolean).join(' · '))),row.selected?h('small',null,'已允许'):null)):h('p',{className:'pc_dot_empty'},page.total?'没有匹配的工作区，换个名称试试。':'Harness 中还没有已登记的工作区。')),h('div',{className:'pc_scope_pagination'},button('上一页',()=>controller.load({query:state.query,offset:Math.max(0,page.offset-page.limit)}),{disabled:locked||page.offset===0}),h('span',null,page.items.length?`${page.offset+1}–${page.offset+page.items.length}`:'0'),button('下一页',()=>controller.load({query:state.query,offset:page.nextOffset}),{disabled:locked||!page.hasMore}))):null,state.loading?h('p',{role:'status'},'正在读取工作区目录…'):null,h('footer',null,h('p',{'aria-live':'polite'},`已选 ${state.selectedIds.length} 个 · 新增 ${state.delta.added} 个，移除 ${state.delta.removed} 个`),h('div',{className:'pc_dot_actions'},button('取消',()=>controller.cancel(),{disabled:state.saving}),button(state.saving?'正在保存…':state.selectedIds.length?`允许读取所选 ${state.selectedIds.length} 个工作区`:'移除全部工作区访问',()=>controller.save(),{className:'pc_dot_primary',disabled:locked||state.stale||!page||!state.delta.added&&!state.delta.removed}))),h('p',{className:'pc_scope_note'},'未勾选的工作区不会读取；关闭或按 Esc 取消未保存的选择。')));
  }
  function ProjectBoard({controller,workspaceController,onOpen}){
    const state=useController(controller),scope=workspaceController?useController(workspaceController):null,status=state.status,[creating,setCreating]=React.useState(false),[newGoal,setNewGoal]=React.useState('');
    React.useEffect(()=>{void controller.refresh();},[controller]);
    React.useEffect(()=>{if(status?.scan.phase!=='running')return;const timer=setInterval(()=>void controller.refresh(),1500);return()=>clearInterval(timer);},[controller,status?.scan.phase]);
    const open=id=>{onOpen?.(id);void controller.open(id);},rows=status?.projects??[],scan=status?.scan;
    return h('div',{className:'pc_goal_page','data-logical-project-board':true},h('header',{className:'pc_goal_page_heading'},h('div',null,h('h1',null,'事情走到哪，一眼看清。'),h('p',{className:'pc_dot_muted'},'按目标归在一起，背景、进展和下一步都接得上。')),status?h('div',{className:'pc_goal_summary'},h('span',null,h('strong',null,rows.length),' 个项目'),h('span',null,h('strong',null,rows.reduce((n,p)=>n+(p.sessionCount??0),0)),' 个会话关联')):null),workspaceController?h(WorkspaceGuide,{controller:workspaceController,compact:true}):null,h('div',{className:'pc_goal_toolbar'},button(scan?.phase==='running'?'正在整理所选资料…':'整理这些工作区的项目',()=>controller.recognize(),{className:'pc_dot_primary',disabled:state.busy||!status||scan?.phase==='running'||scope?.summary?.selectedCount===0}),button('交代一个新目标',()=>setCreating(true),{disabled:state.busy||!status}),button('刷新项目状态',()=>controller.refresh(),{disabled:state.loading}),h('p',{className:'pc_dot_muted'},'本次只读取已选范围的有限资料，不开启持续跟进。')),state.error?h('p',{role:'alert',className:'pc_dot_error'},state.error):null,creating?h('form',{className:'pc_goal_create',onSubmit:async event=>{event.preventDefault();if(await controller.createGoal(newGoal)){setNewGoal('');setCreating(false);}}},h('label',null,'想完成什么？',h('textarea',{'aria-label':'想完成什么？',value:newGoal,maxLength:1200,required:true,autoFocus:true,placeholder:'说说希望得到的结果，背景可以在接下来的对话里补充。',onChange:event=>setNewGoal(event.target.value)})),h('div',{className:'pc_dot_actions'},h('button',{type:'submit',className:'pc_dot_primary',disabled:state.busy||!newGoal.trim()},'建立目标并接着聊'),button('稍后再说',()=>setCreating(false),{disabled:state.busy}))):null,!status?h('p',{role:'status',className:'pc_dot_empty'},state.loading?'正在核对项目状态…':'项目状态尚未确认，请刷新重试。'):h('div',null,!rows.length?h('div',{className:'pc_goal_empty'},h('h3',null,scope?.summary?.selectedCount?'资料范围选好了，接下来组织项目':'还没有项目'),h('p',null,scope?.summary?.selectedCount?'点击“整理这些工作区的项目”，Dot 会基于所选资料提出关联。没有把握的片段会保留在原处。':'先选择一两个工作区，或先与 Dot 讨论你想完成什么。')):null,h('div',{className:'pc_goal_board'},...['mine','active','waiting'].map(lane=>{const laneRows=rows.filter(p=>(p.lane==='unknown'?'mine':p.lane)===lane),label={mine:'待我推进',active:'推进中',waiting:'等回复／确认'}[lane];return h('section',{key:lane,'data-goal-lane':lane,'aria-label':label,className:'pc_goal_lane'},h('h3',null,label,h('span',null,laneRows.length)),laneRows.length?laneRows.map(p=>h('article',{className:`pc_goal_card${p.state==='proposed'?' proposed':''}`,key:p.id,'data-logical-project':p.id},h('p',{className:'pc_goal_eyebrow'},p.state==='proposed'?'新发现的关联建议':'持续推进的目标'),button(p.title,()=>open(p.id),{className:'pc_goal_title'}),h('p',{className:'pc_goal_objective'},p.goal),h('div',{className:'pc_goal_progress'},h('strong',null,p.stale?'进展需重新核对':'当前进展'),h('p',null,p.stale?'资料范围或关联已变化，原进展暂作历史记录。':p.progress||'当前资料还不足以判断进展。')),h('p',{className:'pc_goal_next'},h('strong',null,p.stale?'下一步（待核对）':'下一步'),p.nextStep||'在项目里补充目标或核对相关资料。'),h('footer',null,h('span',null,`${p.sessionCount??0} 个会话 · ${p.workspaceCount??0} 个工作区`),button('接着推进',()=>open(p.id))),p.state==='proposed'?h('p',{className:'pc_goal_suggestion_note'},'可以先讨论，再决定是否保留为项目。'):null)):h('p',{className:'pc_goal_lane_empty'},'当前没有这类项目。'));})),h('p',{className:'pc_goal_boundary'},'卡片来自来源中的记录与归类判断，仍需核对，不代表任务已执行、上线或完成验收。'),scan?.phase==='failed'?h('p',{role:'status',className:'pc_dot_error'},'这次整理未完成，已保留原项目。核对资料范围后，可主动重新整理；没有自动重试。'):null,scan?.phase==='running'?h('p',{role:'status'},'正在核对所选工作区的有限资料。这里只查询状态，不会重新发起整理。'):null,scan?.coverage?.length?h('details',{className:'pc_goal_coverage'},h('summary',null,'本次资料范围与边界'),...scan.coverage.map((row,i)=>h('p',{key:i},row.label,' · ',row.status==='unavailable'?'资料不可用':row.status==='partial'?'部分资料可用':'已读取有限资料',` · ${row.filesRead} 个文件 · ${row.sessionsRead} 个会话`,row.truncated?' · 内容已截断':''))):null,status.uncertainCount||status.standaloneCount?h('p',{className:'pc_dot_muted'},`${status.standaloneCount} 段独立资料 · ${status.uncertainCount} 段归属尚不确定，仍留在原处。`):null));
  }
  function ProjectSheet({controller,renderConversation}){
    const state=useController(controller),dialog=useDialog(Boolean(state.projectId),()=>controller.dismiss()),[editing,setEditing]=React.useState(false),[title,setTitle]=React.useState(''),[goal,setGoal]=React.useState(''),[constraints,setConstraints]=React.useState('');
    React.useEffect(()=>{setEditing(false);},[state.projectId]);
    if(!state.projectId)return null;
    const p=state.detail?.project;
    const edit=()=>{setTitle(p.title);setGoal(p.goal);setConstraints(p.constraints.join('\n'));setEditing(true);};
    const save=async()=>{if(await controller.mutate('vision',{title,goal,constraints:constraints.split('\n').map(s=>s.trim()).filter(Boolean)}))setEditing(false);};
    return h('div',{className:'pc_goal_sheet_backdrop'},h('section',{className:'pc_goal_sheet',role:'dialog','aria-modal':true,'aria-labelledby':'pc-goal-sheet-title',ref:dialog.ref,tabIndex:-1,onKeyDown:dialog.keyDown},h('header',{className:'pc_goal_sheet_header'},h('div',null,h('p',{className:'pc_goal_eyebrow'},p?.state==='proposed'?'新发现的项目建议':'围绕这个项目继续'),h('h2',{id:'pc-goal-sheet-title'},p?.title??'正在打开项目…')),button('关闭项目',()=>controller.dismiss(),{'aria-label':'关闭项目'})),state.error?h('p',{role:'alert',className:'pc_dot_error'},state.error):null,state.detailLoading&&!p?h('p',{role:'status'},'正在核对目标与关联来源…'):null,p?h('div',{className:'pc_goal_sheet_body'},h('section',{className:'pc_goal_context'},h('strong',null,'共同目标'),h('p',null,p.goal),p.constraints.length?h('ul',null,...p.constraints.map((item,i)=>h('li',{key:i},item))):null,button('修正目标与约束',edit,{className:'pc_goal_text_button',disabled:state.busy})),editing?h('form',{className:'pc_goal_vision_form',onSubmit:event=>{event.preventDefault();void save();}},h('label',null,'项目名称',h('input',{value:title,maxLength:120,required:true,onChange:event=>setTitle(event.target.value)})),h('label',null,'共同目标',h('textarea',{value:goal,maxLength:1200,required:true,onChange:event=>setGoal(event.target.value)})),h('label',null,'约束与约定（每行一条）',h('textarea',{value:constraints,maxLength:4000,onChange:event=>setConstraints(event.target.value)})),h('div',{className:'pc_dot_actions'},h('button',{type:'submit',className:'pc_dot_primary',disabled:state.busy},'保存目标'),button('取消修改',()=>setEditing(false),{disabled:state.busy}))):null,h('section',{className:'pc_goal_status'},h('h3',null,p.stale?'进展需重新核对':'当前进展'),h('p',null,p.stale?'关联或访问范围已变化。以下是原有记录，需要重新核对。':p.progress||'当前资料还不足以判断进展。'),p.stale&&p.progress?h('p',{className:'pc_dot_muted'},`原记录：${p.progress}`):null,h('h3',null,'下一步'),h('p',null,p.nextStep||'补充当前目标，或核对关联来源。'),h('p',{className:'pc_dot_muted'},'来源归类与对话记录不代表任务已执行或验收。')),p.state==='proposed'?h('div',{className:'pc_goal_proposed_actions'},h('span',null,'这些片段可能在推进同一个目标。'),button('保留为项目',()=>controller.mutate('accept'),{disabled:state.busy}),button('暂不收录',()=>controller.mutate('ignore'),{disabled:state.busy})):null,h('details',{className:'pc_goal_evidence'},h('summary',null,`关联对话与来源 · ${state.detail.evidence.length}`),h('p',{className:'pc_dot_muted'},'只关联来源，不搬动原对话或文件。归错的资料可以直接修正。'),...state.detail.evidence.map(e=>h('article',{key:e.id,className:e.available?'':'unavailable'},h('small',null,e.workspaceLabel,' · ',e.reference),e.available?h('p',null,e.text):h('p',null,'这个工作区已移出访问范围或不可用，不再展示来源正文。'),e.truncated?h('p',{className:'pc_dot_muted'},'内容已截断，当前片段不是完整来源。'):null,e.available?h('select',{'aria-label':`修正来源 ${e.reference} 的归属`,value:'',disabled:state.busy,onChange:event=>{const id=event.target.value;if(id)void controller.mutate('correct',{evidenceId:e.id,targetProjectId:id==='__none__'?null:id});}},h('option',{value:''},'修正这条来源的归属…'),...(state.status?.projects??[]).filter(row=>row.id!==p.id).map(row=>h('option',{key:row.id,value:row.id},`移到 ${row.title}`)),h('option',{value:'__none__'},'先不归入这个项目')):null))),h('section',{className:'pc_goal_native','aria-label':'当前项目对话'},h('h3',null,'接着推进这个项目'),state.target&&typeof renderConversation==='function'?renderConversation({projectId:state.projectId,target:state.target}):h('p',{role:'status'},state.detailLoading?'正在打开项目专属对话…':'项目对话暂未打开。请关闭后重新打开；已有原生草稿仍保留。'))):null));
  }
  return{useController,WorkspaceGuide,WorkspaceConnection,WorkspaceDialog,ProjectBoard,ProjectSheet};
}
