/* Client half: reuse the official settings shell and the upstream QR viewer. */
window.__ModuleLoader__.load({
  id:'dsh-project-companion',
  factory:require=>{
    const React=require('react');
    const {Modal,SettingsForm,SettingsSecretField,SettingsValueField}=require('@deepseek-ai/dsh-client-ui-primitives');
    const h=React.createElement;
    const endpoint='/api/project_companion/onboarding';
    const inject=['slots','uiWorkspace','configForms','layout','sessions'];
    const css=`.pc_setup{display:flex;flex-direction:column;gap:18px;padding:0 24px 24px;line-height:1.6}.pc_setup h2,.pc_setup h3,.pc_setup p{margin:0}.pc_setup h2{font-size:21px;font-weight:600}.pc_setup h3{font-size:15px;font-weight:600}.pc_setup .pc_card{border:1px solid var(--dsw-alias-border-l3,rgba(128,128,128,.25));border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:10px}.pc_setup .pc_muted{font-size:12px;color:var(--dsw-alias-label-secondary,#888)}.pc_setup .pc_actions{display:flex;gap:10px;flex-wrap:wrap}.pc_setup button{border:1px solid var(--dsw-alias-border-l3,rgba(128,128,128,.4));border-radius:8px;background:transparent;color:inherit;font:inherit;font-size:13px;padding:8px 14px;cursor:pointer}.pc_setup button:disabled{opacity:.5;cursor:default}.pc_setup button.pc_primary{background:var(--dsw-alias-state-business-primary,#4d6bfe);border-color:transparent;color:white}.pc_setup button:focus-visible,.pc_setup input:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4d6bfe);outline-offset:3px}.pc_setup label{display:flex;gap:10px;align-items:flex-start;font-size:14px}.pc_setup input{margin-top:5px}.pc_setup .pc_brief{white-space:pre-wrap;font-size:13px;overflow-wrap:anywhere}.pc_setup .pc_error{color:var(--dsw-alias-state-error-primary,#b91c1c);font-size:13px}.pc_setup img{width:200px;height:200px;max-width:100%;align-self:center}.pc_setup .pc_connect_heading{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}.pc_setup .pc_connect_heading h2{margin-bottom:4px}.pc_setup .pc_connect_row{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:16px 0;border-top:1px solid var(--dsw-alias-border-l3,rgba(128,128,128,.2))}.pc_setup .pc_connect_row>div{min-width:0}.pc_setup .pc_connect_row button{flex-shrink:0}.pc_setup .pc_connect_status{font-size:12px;margin-top:4px}.pc_setup .pc_connect_badge{font-size:11px;padding:3px 8px;border:1px solid var(--dsw-alias-border-l3,rgba(128,128,128,.2));border-radius:20px;white-space:nowrap}.pc_setup .pc_google_connect{background:var(--dsw-alias-bg-layer-2,transparent)}.pc_setup .pc_connect_help{font-size:13px;border-top:1px solid var(--dsw-alias-border-l3,rgba(128,128,128,.2));padding-top:12px}.pc_setup .pc_connect_help summary{cursor:pointer}.pc_setup [data-google-auth-controls]{display:flex;flex-direction:column;gap:10px}.pc_setup .pc_connect_help p{margin:10px 0}.pc_setup .pc_connect_authorizing,.pc_setup .pc_connect_notice{padding:12px 14px;background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.07));border-radius:8px;font-size:13px;overflow-wrap:anywhere}.pc_setup .pc_connect_authorizing a{color:var(--dsw-alias-state-business-primary,#4176e6);display:inline-block;margin-top:8px}.pc_setup_modal{width:min(620px,100%);max-height:90vh;overflow-y:auto;padding:24px 0 0}.pc_setup_modal .pc_setup{padding-top:0}@media(max-width:560px){.pc_setup .pc_connect_heading,.pc_setup .pc_connect_row{align-items:flex-start;flex-direction:column;gap:8px}.pc_setup .pc_connect_row{padding:14px 0}.pc_setup{padding:0 16px 20px}.pc_setup .pc_actions button{flex:1}}`;

    // Public ui-theme token pairs form one disposable layer. The font token is
    // presented after persistent font variables, so removing this layer restores
    // the user's own preference without writing to the ui-theme namespace.
    const dotFont='-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Segoe UI", sans-serif';
    const dotAppearanceTokens={
      '--dsw-font-family':{light:dotFont,dark:dotFont},
      '--dsw-alias-bg-base':{light:'#f5f3ee',dark:'#17191c'},
      '--dsw-alias-bg-layer-1':{light:'#eeece6',dark:'#202328'},
      '--dsw-alias-bg-layer-2':{light:'#fffdf8',dark:'#272b31'},
      '--dsw-alias-bg-layer-3':{light:'#ffffff',dark:'#30363d'},
      '--dsw-alias-bg-module-platform':{light:'#eeece6',dark:'#202328'},
      '--dsw-alias-label-primary':{light:'#222b35',dark:'#e7ebf0'},
      '--dsw-alias-label-secondary':{light:'#5c6672',dark:'#aab4c1'},
      '--dsw-alias-label-tertiary':{light:'#747d88',dark:'#83909f'},
      '--dsw-alias-label-caption':{light:'#9098a2',dark:'#6d7887'},
      '--dsw-alias-border-l1':{light:'rgba(44,55,68,.22)',dark:'rgba(207,219,235,.24)'},
      '--dsw-alias-border-l2':{light:'rgba(44,55,68,.16)',dark:'rgba(207,219,235,.18)'},
      '--dsw-alias-border-l3':{light:'rgba(44,55,68,.12)',dark:'rgba(207,219,235,.14)'},
      '--dsw-alias-border-l4':{light:'rgba(44,55,68,.08)',dark:'rgba(207,219,235,.10)'},
      '--dsw-alias-interactive-bg-hover':{light:'rgba(48,63,79,.06)',dark:'rgba(190,207,230,.08)'},
      '--dsw-alias-interactive-bg-active':{light:'rgba(65,118,230,.12)',dark:'rgba(122,170,255,.16)'},
      '--dsw-alias-state-business-primary':{light:'#4176e6',dark:'#7aaaff'},
      '--dsw-radius-xs':{light:'4px',dark:'4px'},
      '--dsw-radius-sm':{light:'8px',dark:'8px'},
      '--dsw-radius-md':{light:'12px',dark:'12px'},
      '--dsw-radius-lg':{light:'16px',dark:'16px'},
      '--dsw-radius-xl':{light:'20px',dark:'20px'},
      '--dsw-radius-panel':{light:'24px',dark:'24px'},
    };

    function createDotAppearance(ctx){
      const listeners=new Set();
      let form,theme,offForm,releaseLayer,pending;
      let closed=false,saving=false,themeFailed=false,restorationUncertain=false,error='';
      let saved={ready:false,writable:false,revision:undefined,mode:'native'};
      let state=Object.freeze({mode:'native',applied:false,available:false,writable:false,busy:false,restorationUncertain:false,error:''});
      const optional=name=>{try{return(typeof ctx.get==='function'?ctx.get(name,false):undefined)??ctx[name];}catch{return undefined;}};
      const notify=next=>{
        if(closed)return;
        if(Object.keys(next).every(key=>state[key]===next[key]))return;
        state=Object.freeze(next);
        for(const fn of [...listeners]){try{fn();}catch{}}
      };
      const release=()=>{
        if(typeof releaseLayer!=='function')return;
        try{
          releaseLayer();releaseLayer=undefined;
          if(restorationUncertain)error='';
          restorationUncertain=false;
        }catch{restorationUncertain=true;error='原生外观恢复结果未确认，请重试恢复；若仍失败，请重新加载此页。';}
      };
      const supported=()=>Boolean(form&&typeof form.getSnapshot==='function'&&typeof form.subscribe==='function'&&typeof form.mutate==='function'&&typeof theme?.overrideTokens==='function');
      const publish=()=>notify({
        mode:releaseLayer?'dot':'native',applied:Boolean(releaseLayer),
        available:supported()&&!themeFailed&&saved.ready,
        writable:supported()&&!themeFailed&&saved.ready&&saved.writable,
        busy:saving,restorationUncertain,error,
      });
      const sync=(clearError=false)=>{
        if(closed)return;
        if(clearError&&!themeFailed&&!restorationUncertain)error='';
        try{
          const view=form?.getSnapshot();
          saved={ready:view?.status==='ready',writable:view?.writable===true&&view?.revision!==undefined&&view?.revision!==null,revision:view?.revision,mode:view?.value?.dotAppearance==='dot'?'dot':'native'};
        }catch{saved={ready:false,writable:false,revision:undefined,mode:'native'};error='外观配置暂不可用，请稍后重试。';}
        if(!supported()||!saved.ready||saved.mode==='native'){
          release();
          if(saved.mode==='native'){themeFailed=false;if(clearError&&!restorationUncertain)error='';}
          if(!supported()&&!restorationUncertain)error='当前宿主暂不支持 Dot 外观设置。';
        }else if(!releaseLayer&&!themeFailed){
          try{
            const dispose=theme.overrideTokens('dsh-project-companion',dotAppearanceTokens);
            if(typeof dispose!=='function')throw new Error('missing theme disposer');
            releaseLayer=dispose;
          }catch{themeFailed=true;error='Dot 外观暂不可用，已保留原生外观。';}
        }
        publish();
      };
      try{theme=optional('theme');form=optional('configForms')?.get('project-companion');}catch{}
      if(supported()){
        try{offForm=form.subscribe(()=>sync(true));}catch{form=undefined;}
      }
      sync();
      const setAppearance=mode=>{
        if(closed||!['native','dot'].includes(mode))return Promise.resolve(false);
        if(saving)return pending??Promise.resolve(false);
        if(mode==='native'&&saved.mode==='native'&&releaseLayer){sync(true);return Promise.resolve(!releaseLayer);}
        if(!state.writable||!saved.ready||saved.mode===mode)return Promise.resolve(false);
        const revision=saved.revision;
        saving=true;error='';publish();
        pending=(async()=>{
          try{
            const accepted=await form.mutate([{op:'set',path:['dotAppearance'],value:mode}],revision);
            if(closed)return false;
            if(accepted!==true){error='外观设置未保存，请刷新后重试。';return false;}
            // Acceptance alone is not a mode echo: read the official snapshot.
            sync();return true;
          }catch{
            if(!closed)error='外观设置未保存，请刷新后重试。';
            return false;
          }finally{
            saving=false;pending=undefined;
            if(!closed)sync();
          }
        })();
        return pending;
      };
      const close=()=>{
        if(!closed){
          closed=true;saving=false;
          try{offForm?.();}catch{}
          offForm=undefined;listeners.clear();
        }
        release();
        state=Object.freeze({...state,mode:releaseLayer?'dot':'native',applied:Boolean(releaseLayer),available:false,writable:false,busy:false,restorationUncertain,error});
      };
      return{getSnapshot:()=>state,subscribe:fn=>{if(closed||typeof fn!=='function')return()=>{};listeners.add(fn);return()=>listeners.delete(fn);},setAppearance,close};
    }

    async function prepareDotDraft(ctx,sessionId,prompt,signal,checkScope,onApplied,stayHere=false){
      const optional=name=>{try{return ctx[name]??ctx.get?.(name,false);}catch{return undefined;}};
      const sessions=optional('sessions');
      if(typeof sessionId!=='string'||!sessionId||typeof prompt!=='string'||!prompt.trim()||prompt.length>4000)throw new Error('请先写一句要交代的事。');
      if(typeof sessions?.retain!=='function'||typeof ctx.uiWorkspace?.openSession!=='function')throw new Error('当前宿主的原生会话入口不可用，请打开 Dot 会话继续。');
      signal?.throwIfAborted?.();
      const reference=sessions.retain(sessionId,{source:'controllerOperation',...(signal?{signal}:{})});
      try{
        await reference.ready;signal?.throwIfAborted?.();
        if(checkScope)await checkScope();signal?.throwIfAborted?.();
        const binding=reference.binding;
        if(binding?.sessionId!==sessionId||typeof sessions.binding==='function'&&sessions.binding(sessionId)!==binding)throw new Error('Dot 会话已变化，未放入草稿。');
        const scope=binding.ctx??sessions.scope?.(sessionId);
        const conversation=scope?.get?.('conversation',false);
        if(typeof conversation?.input?.requestDraftInitialization!=='function')throw new Error('目标会话的原生草稿服务尚未就绪，请在 Dot 会话核对。');
        const status=conversation.input.requestDraftInitialization(binding,{prompt,clearPreviousDraft:false});
        if(status==='blocked')throw new Error('Dot 会话正在提交或草稿暂不可用；未自动重试。');
        if(status!=='applied'&&status!=='preserved')throw new Error('原生草稿状态未知，请在 Dot 会话核对。');
        if(status==='preserved')return{status};
        // Applied is the native draft receipt. Commit its matching local handoff
        // before openSession can synchronously unmount the workbench.
        const rollback=onApplied?.();
        if(stayHere)return{status};
        try{await ctx.uiWorkspace.openSession(sessionId);}catch(error){rollback?.();throw error;}
        signal?.throwIfAborted?.();ctx.layout?.selectPanel?.(null);
        return{status};
      }finally{reference.release();}
    }

    // One editable occurrence across the workbench and any global Dot surface.
    // Native Conversation owns history, drafts, submission and permission UI.
function createDesktopConversationController(ctx) {
  const listeners = new Set();
  let lifetime = null, held = null, closed = false, revision = 0;
  let snapshot = Object.freeze({owner:null,sessionId:null,closed:false,revision});
  const publish = () => {
    snapshot = Object.freeze({owner:held?.owner??null,sessionId:lifetime?.id??null,closed,revision:++revision});
    for (const listener of [...listeners]) { try { listener(); } catch {} }
  };
  const nativeId = id => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(id) && !id.startsWith('family_') && id !== 'family-no-legacy';
  const unavailable = () => new Error('桌面对话范围不可用。');
  const cancelled = () => Object.assign(new Error('对话入口已经关闭。'), {code:'desktop-conversation-cancelled'});
  const form = () => { try { return (ctx.configForms??ctx.get?.('configForms',false))?.get('project-companion'); } catch { return null; } };
  const readSelection = () => { try { const current=form()?.getSnapshot(); return current?.status==='ready'?current:null; } catch { return null; } };
  const listedSubagent = id => { try { return ctx.sessions?.list?.getSnapshot()?.byId?.[id]?.origin === 'subagent'; } catch { return true; } };
  const validBinding = life => {
    const binding=life.reference.binding;
    if (binding?.sessionId!==life.id || typeof ctx.sessions?.binding==='function' && ctx.sessions.binding(life.id)!==binding || listedSubagent(life.id)) return false;
    try { if (binding.session?.getSnapshot?.()?.subagent) return false; } catch { return false; }
    return true;
  };
  const discardLifetime = () => {
    const life=lifetime; lifetime=null;
    if (!life || life.released) return;
    life.released=true;
    try { life.reference.release(); } catch { closed=true; held=null; }
  };
  const metadata = async id => {
    if (closed || !nativeId(id) || typeof ctx.sessions?.refresh!=='function' || typeof ctx.sessions?.list?.getSnapshot!=='function') return false;
    try {
      await ctx.sessions.refresh();
      const list=ctx.sessions.list.getSnapshot(),row=list?.byId?.[id];
      return !closed && list?.phase==='ready' && Array.isArray(list.ids) && list.ids.includes(id) && row?.id===id && typeof row.cwd==='string' && row.cwd.startsWith('/') && row.origin!=='subagent';
    } catch { return false; }
  };
  const pointer = async confirmed => {
    const current=readSelection(),id=current?.value?.desktopConversationSessionId;
    if (!current || (current.value?.desktopConversationSelectionVersion===1)!==confirmed || !await metadata(id)) return null;
    const after=readSelection();
    return !closed && after?.value?.desktopConversationSessionId===id && (after.value?.desktopConversationSelectionVersion===1)===confirmed ? {sessionId:id,revision:`native:${id}`} : null;
  };
  return {
    getSnapshot:()=>snapshot,
    subscribe(listener) { if (closed || typeof listener!=='function') return ()=>{}; listeners.add(listener); return ()=>listeners.delete(listener); },
    async acquire(owner,target) {
      if (closed || !['string','symbol'].includes(typeof owner) || !owner || !nativeId(target?.sessionId) || listedSubagent(target.sessionId)) throw unavailable();
      if (held) throw Object.assign(new Error('对话已在另一处打开，请继续已有对话。'), {code:'desktop-conversation-held'});
      if (typeof ctx.sessions?.retain!=='function') throw unavailable();
      const lease={owner,target,life:null}; held=lease;
      try {
        if (lifetime && lifetime.id!==target.sessionId) discardLifetime();
        if (closed) throw unavailable();
        if (!lifetime) {
          const reference=ctx.sessions.retain(target.sessionId,{source:'controllerOperation'});
          if (!reference || typeof reference.release!=='function') { closed=true; throw unavailable(); }
          const life={id:target.sessionId,reference,released:false,isReady:false}; lifetime=life;
          life.ready=(async()=>{
            await reference.ready;
            if (closed || lifetime!==life || life.released) throw cancelled();
            if (!validBinding(life)) throw unavailable();
            life.isReady=true;
            return reference;
          })();
        }
        const life=lifetime; lease.life=life; publish();
        await life.ready;
        if (closed || held!==lease || lifetime!==life || life.released) throw cancelled();
        if (!validBinding(life)) throw unavailable();
        return life.reference;
      } catch (error) {
        if (held===lease) held=null;
        // A cancelled surface must not dispose the binding a newer owner uses.
        if (error?.code!=='desktop-conversation-cancelled' && lease.life===lifetime) discardLifetime();
        publish(); throw error;
      }
    },
    release(owner) { if (!held || held.owner!==owner) return; held=null; publish(); },
    async resolve(target) { const id=target?.sessionId; return await metadata(id)?{sessionId:id,revision:`native:${id}`}:null; },
    restore:()=>pointer(true),
    candidate:()=>pointer(false),
    async remember(id) {
      if (!await metadata(id)) return false;
      const settings=form(),current=readSelection();
      if (closed || !current || current.writable!==true || current.revision===undefined || typeof settings?.mutate!=='function') return false;
      try {
        const accepted=await settings.mutate([
          {op:'set',path:['desktopConversationSessionId'],value:id},
          {op:'set',path:['desktopConversationSelectionVersion'],value:1},
        ],current.revision);
        const after=readSelection();
        return !closed && accepted===true && after?.value?.desktopConversationSessionId===id && after.value?.desktopConversationSelectionVersion===1;
      } catch { return false; }
    },
    focus(target) {
      const life=lifetime;
      if (closed || !held || held.life!==life || !life?.isReady || target?.sessionId!==life.id || target.revision!==undefined && held.target.revision!==undefined && target.revision!==held.target.revision) return false;
      try {
        if (!validBinding(life)) return false;
        const binding=life.reference.binding,input=binding.ctx?.get?.('conversation',false)?.input?.for?.(binding.ctx);
        if (typeof input?.focus!=='function') return false;
        input.focus(); return true;
      } catch { return false; }
    },
    close() { if (closed && !lifetime) return; closed=true; held=null; discardLifetime(); publish(); listeners.clear(); },
  };
}

function desktopConversationCanEmbed(view,targetId) {
  if (typeof view?.activePanelId==='string') return true;
  return view?.activePanelId===null && (typeof view.mainSessionId==='string' ? view.mainSessionId!==targetId : view.mainSessionId===null && view.mainViewEmpty===true);
}

function createDotConversationViews(React) {
  const h=React.createElement;
  const native = props => typeof props.renderSlot==='function' ? props.renderSlot('conversation.session',{view:'chat'}) : h('p',{role:'status'},'对话暂不可用，请打开原生会话继续。');
  const turnOf = node => ['step','turn'].includes(node?.location?.kind) ? node.location.turn?.turn : undefined;
  const bounded = (text,limit) => { const chars=Array.from(text); return {text:chars.length>limit?chars.slice(0,limit).join('')+'…':text,truncated:chars.length>limit}; };
  const preview = (chat,session,input,pending) => {
    if (!session || session.openState!=='open' || session.running!==false || session.openError || session.promptError || pending || !Array.isArray(session.pendingSubmissions) || session.pendingSubmissions.length || !input || !['plain','claimed'].includes(input.phase) || !Array.isArray(input.attachmentIds) || input.attachmentIds.length || !Array.isArray(input.occurrences) || input.occurrences.length || !Array.isArray(input.queue) || input.queue.length) return null;
    if (!Array.isArray(chat?.order) || typeof chat.nodes?.get!=='function' || !Array.isArray(chat.timeline?.turnOrder) || typeof chat.timeline.turns?.get!=='function') return null;
    const projected=chat.order.map(key=>chat.nodes.get(key));
    if (projected.some(node=>!node)) return null;
    const ordered=projected.filter(node=>node.visibility!=='hidden');
    const userIndex=ordered.findLastIndex(node=>['user','steering'].includes(node.kind) && node.data?.source?.kind==='user');
    if (userIndex<0) return null;
    const user=ordered[userIndex],turn=turnOf(user),currentTurn=chat.timeline.turnOrder.at(-1);
    if (turn===undefined || turn!==currentTurn || chat.timeline.turns.get(turn)?.status!=='closed') return null;
    const tailIndex=ordered.findLastIndex(node=>node.kind==='turn-tail' && turnOf(node)===turn);
    if (tailIndex<=userIndex) return null;
    const closing=ordered[tailIndex].data?.closing;
    if (closing?.status!=='settled' || !closing.finalNode || closing.finalNode.interrupted || closing.turn!==turn || !Number.isFinite(closing.finalNode.seq) || !Number.isFinite(user.data?.seq) || closing.finalNode.seq<=user.data.seq) return null;
    const safeKinds=new Set(['user','steering','assistant-step','turn-tail','turn-process','context','system-prompt']);
    for (const node of ordered) {
      if (turnOf(node)!==turn) continue;
      if (!safeKinds.has(node.kind)) return null;
      if (node.kind==='assistant-step' && (node.data?.status!=='settled' || node.data?.finalNode?.interrupted || !Array.isArray(node.data?.blocks) || node.data.blocks.some(block=>!['text','reasoning'].includes(block?.kind)))) return null;
    }
    if (!Array.isArray(user.data.content) || !user.data.content.length || user.data.content.some(block=>block?.type!=='text' || typeof block.text!=='string') || user.data.referenceLabels?.length || user.data.skillNames?.length) return null;
    if (!Array.isArray(closing.blocks) || closing.blocks.some(block=>!['text','reasoning'].includes(block?.kind) || typeof block.text!=='string')) return null;
    const question=user.data.content.map(block=>block.text).join(''),answer=closing.blocks.filter(block=>block.kind==='text').map(block=>block.text).join('');
    if (!question.trim() || !answer.trim()) return null;
    return {question:bounded(question,600),answer:bounded(answer,1800)};
  };
  function CompactHistory(props) {
    const chat=props.useChat(value=>value),session=props.useSession(value=>value),input=props.useInput(value=>value);
    const status=props.useSessionStatus(value=>value);
    const pending=typeof status?.get==='function'?status.get(props.sessionId)?.pendingInteraction:true;
    const [full,setFull]=React.useState(false);
    if (full) return h(React.Fragment,null,h('div',{className:'dot_compact_history_actions'},h('button',{type:'button',onClick:()=>setFull(false)},'回到最近对话')),native(props));
    const current=preview(chat,session,input,pending);
    if (!current) return native(props);
    return h('section',{className:'dot_compact_history','data-dot-compact-history':true,'aria-label':'最近对话'},
      h('div',{className:'dot_compact_history_heading'},h('span',null,'最近对话'),h('button',{type:'button',onClick:()=>setFull(true)},'查看完整对话')),
      h('div',{className:'dot_compact_history_user'},h('span',{className:'dot_compact_history_role'},'你'),h('p',{style:{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}},current.question.text)),
      h('div',{className:'dot_compact_history_assistant'},h('span',{className:'dot_compact_history_role'},'Dot'),h('p',{style:{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}},current.answer.text)),
      (current.question.truncated||current.answer.truncated)&&h('p',{className:'dot_compact_history_truncated'},'内容较长，完整对话中可继续查看。'));
  }
  return function CompactViews(props={}) {
    return ['useChat','useSession','useInput','useSessionStatus'].every(name=>typeof props[name]==='function') ? h(CompactHistory,props) : native(props);
  };
}

    // BEGIN synchronized Dot overlay factories
function createDotOverlay(React, adapters = {}) {
  const h = React.createElement;
  const css = `
.dot_overlay{font-family:var(--dsw-font-family,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif);color:var(--dsw-alias-label-primary,#222b35)}
.dot_overlay_dock{position:absolute;right:max(20px,env(safe-area-inset-right,0px));bottom:max(28px,calc(env(safe-area-inset-bottom,0px) + 24px));display:flex;flex-direction:column;align-items:flex-end;gap:10px;pointer-events:none}
.dot_overlay button{font:inherit;cursor:pointer;color:inherit}.dot_overlay button:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4176e6);outline-offset:3px}
.dot_overlay_launcher{pointer-events:auto;display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;padding:9px 15px;border:1px solid var(--dsw-alias-border-l3,rgba(44,55,68,.12));border-radius:24px;background:var(--dsw-alias-bg-layer-2,#fffdf8);box-shadow:0 5px 24px rgba(22,34,48,.14);font-size:14px!important;font-weight:600!important}
.dot_overlay_mark{display:inline-flex;color:var(--dsw-alias-state-business-primary,#4176e6)}
.dot_overlay_panel{pointer-events:auto;display:flex;flex-direction:column;width:min(440px,calc(100vw - 32px));height:min(620px,calc(100vh - var(--dsh-frame-overlay-top,68px) - 104px));height:min(620px,calc(100dvh - var(--dsh-frame-overlay-top,68px) - 104px));max-height:100%;border:1px solid #cbd2ce;border-radius:10px;background:#fff;color:#23313c;box-shadow:0 12px 48px rgba(22,34,48,.18);overflow:hidden;--dsw-alias-bg-base:#fff;--dsw-alias-bg-layer-1:#fff;--dsw-alias-bg-layer-2:#fff;--dsw-alias-bg-layer-3:#fff;--dsw-alias-label-primary:#23313c;--dsw-alias-label-secondary:#5b6973;--dsw-alias-state-business-primary:#345ec7}
.dot_overlay_header{display:flex;align-items:center;gap:10px;padding:13px 14px;border-bottom:1px solid var(--dsw-alias-border-l4,rgba(44,55,68,.08));flex-shrink:0}
.dot_overlay_heading{min-width:0;flex:1}.dot_overlay_title{font-size:15px;font-weight:650}.dot_overlay_subtitle{font-size:11px;color:var(--dsw-alias-label-secondary,#5c6672);margin-top:2px}
.dot_overlay_action{display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:44px;height:44px;border:0;border-radius:8px;background:transparent}.dot_overlay_action:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(48,63,79,.06))}
.dot_overlay_body{position:relative;display:flex;flex:1;min-height:0;overflow:hidden}.dot_overlay_body> *{flex:1;min-height:0;min-width:0}
.dot_overlay_fallback{padding:20px;font-size:13px;line-height:1.65;color:var(--dsw-alias-label-secondary,#5c6672)}
.dot_overlay_notice{pointer-events:auto;max-width:min(320px,calc(100vw - 40px));padding:10px 14px;border:1px solid var(--dsw-alias-border-l3,rgba(44,55,68,.12));border-radius:12px;background:var(--dsw-alias-bg-layer-2,#fffdf8);font-size:12px;line-height:1.5;box-shadow:0 4px 20px rgba(22,34,48,.1)}
.dot_overlay_notice button{display:block;min-height:44px;margin-top:6px;padding:7px 9px;border:1px solid #cbd2ce;border-radius:6px;background:#fff;color:#345ec7}
.dot_overlay_fallback{background:#fff;color:#5b6973}.dot_overlay_fallback button{display:inline-flex;min-height:44px;align-items:center;justify-content:center;margin:12px 8px 0 0;padding:8px 12px;border:1px solid #cbd2ce;border-radius:7px;background:#fff;color:#345ec7}.dot_overlay_body .pc_dot_conversation{height:100%;max-height:none;min-height:0;border:0;border-radius:0;margin:0}.dot_overlay_body .pc_dot_conversation>div{min-height:0}.dot_overlay_body .dot_compact_history{padding:16px;font-size:13px}.dot_overlay_body .dot_compact_history_heading{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:14px;font-size:12px;color:#5b6973}.dot_overlay_body .dot_compact_history button{min-height:44px;background:none;border:0;color:#345ec7}.dot_overlay_body .dot_compact_history_role{display:block;color:#5b6973;font-size:11px;margin-bottom:4px}.dot_overlay_body .dot_compact_history_assistant{margin-top:14px}.dot_overlay_body .dot_compact_history_truncated{color:#5b6973;font-size:12px}.dot_overlay_body .dot_compact_history_actions button{min-height:44px;color:#345ec7;border:0;background:#fff}
.dot_overlay_body .pc_dot_overlay_conversation{display:flex;flex-direction:column;min-height:0;overflow:hidden;background:#fff}.dot_overlay_body .pc_dot_overlay_conversation>.pc_dot_conversation{flex:1;min-height:160px;overflow:auto}.dot_overlay_body .pc_dot_overlay_status{flex-shrink:0;font-size:12px;line-height:1.6;padding:8px 14px;margin:0;color:#5b6973}.dot_overlay .pc_dot_retained_draft{flex-shrink:0;padding:10px 14px;margin:0;border-bottom:1px solid #cbd2ce;background:#edf2fc;color:#23313c;font-size:12px;line-height:1.6;max-height:220px;overflow:auto}.dot_overlay .pc_dot_retained_draft p{margin:4px 0;color:#5b6973}.dot_overlay .pc_dot_retained_draft pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere;max-height:120px;overflow:auto}.dot_overlay .pc_dot_retained_draft summary{min-height:44px;padding:10px 0;cursor:pointer}.dot_overlay .pc_dot_retained_draft button{min-height:44px;margin:4px 8px 0 0;padding:7px 9px;border:1px solid #cbd2ce;border-radius:6px;background:#fff;color:#345ec7}
@media(max-width:560px){.dot_overlay_dock{right:max(12px,env(safe-area-inset-right,0px));bottom:max(18px,calc(env(safe-area-inset-bottom,0px) + 14px))}.dot_overlay_panel{width:calc(100vw - 24px);height:calc(100dvh - var(--dsh-frame-overlay-top,68px) - 88px);border-radius:14px}.dot_overlay_subtitle{display:none}}
@media(max-height:440px){.dot_overlay_dock{bottom:max(8px,env(safe-area-inset-bottom,0px));gap:6px}.dot_overlay_panel{height:calc(100dvh - var(--dsh-frame-overlay-top,68px) - 66px)}.dot_overlay_header{padding:7px 12px}.dot_overlay_launcher{min-height:44px;padding:5px 13px}}
@media(prefers-reduced-motion:reduce){.dot_overlay *{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
`;
  const mark = () => h('span', { className: 'dot_overlay_mark', 'aria-hidden': true },
    h('svg', { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none' },
      h('circle', { cx: 12, cy: 12, r: 8, stroke: 'currentColor', strokeWidth: 1.7 }),
      h('circle', { cx: 12, cy: 12, r: 3, fill: 'currentColor' }),
      h('path', { d: 'M17.7 3.6l2.7 2.7', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' })));
  const icon = kind => h('svg', { width: 16, height: 16, viewBox: '0 0 20 20', fill: 'none', 'aria-hidden': true },
    h('path', { d: kind === 'close' ? 'M5 5l10 10M15 5L5 15' : 'M11 4h5v5M16 4l-7 7M7 4H4v12h12v-3', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }));
  return function DotOverlay(props = {}) {
    const surface=typeof adapters.useSurface==='function'?adapters.useSurface(props):{};
    const [open, setOpen] = React.useState(false);
    const [error, setError] = React.useState('');
    const [workbenchAttempt,setWorkbenchAttempt]=React.useState(0);
    const launcher = React.useRef(null);
    const panel = React.useRef(null);
    const pendingWorkbench = React.useRef(false);
    const returnFocus = React.useRef(false);
    const live = React.useRef(true);
    const showing=open&&surface.homeActive!==true&&surface.suspended!==true;
    React.useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
    React.useEffect(()=>{if((surface.homeActive||surface.suspended)&&open)setOpen(false);},[surface.homeActive,surface.suspended,open]);
    React.useEffect(() => {
      if (open) { panel.current?.focus?.(); return; }
      if (pendingWorkbench.current) {
        pendingWorkbench.current = false;
        returnFocus.current = false;
        // Child Conversation effects have unmounted before this passive effect.
        // Reuse the normal workbench action, rather than mount another editor.
        Promise.resolve().then(() => {
          if (!live.current) return;
          if (typeof adapters.activateDesktop !== 'function') throw new Error('workbench unavailable');
          return adapters.activateDesktop();
        }).catch(() => {
          if (live.current) setError('工作台暂未打开，请从左侧 DSH Dot 继续。');
        });
      } else if (returnFocus.current) {
        returnFocus.current = false;
        if (launcher.current?.isConnected !== false) launcher.current?.focus?.();
      }
    }, [open,workbenchAttempt]);
    const close = () => { returnFocus.current = true; setOpen(false); };
    const openWorkbench = () => { pendingWorkbench.current = true; setError(''); setOpen(false);setWorkbenchAttempt(value=>value+1); };
    const escape = event => {
      if (!open || event.key !== 'Escape' || event.defaultPrevented || event.isComposing || event.nativeEvent?.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
      event.preventDefault?.(); event.stopPropagation?.(); close();
    };
    const content = showing
      ? typeof adapters.renderConversation === 'function'
        ? adapters.renderConversation({ ...props, location: 'overlay', onOpenWorkbench: openWorkbench })
        : h('div', { className: 'dot_overlay_fallback' }, '请打开完整工作台，与 Dot 继续对话。')
      : null;
    return h('div', { className: 'dot_overlay', style: { position: 'absolute', inset: 0, pointerEvents: 'none' }, 'data-dot-overlay': true },
      h('style', null, css),
      h('div', { className: 'dot_overlay_dock' },
        error && h('div', { className: 'dot_overlay_notice', role: 'status' }, error,h('button',{type:'button','aria-label':'重试打开 Dot 工作台',onClick:openWorkbench},'重试打开 Dot 工作台')),
        showing && h('section', { className: 'dot_overlay_panel', id: 'dsh-dot-overlay-dialog', ref: panel, tabIndex: -1, role: 'dialog', 'aria-label': '与 Dot 对话', onKeyDown: escape },
          h('header', { className: 'dot_overlay_header' }, mark(),
            h('div', { className: 'dot_overlay_heading' }, h('div', { className: 'dot_overlay_title' }, 'Dot'), h('div', { className: 'dot_overlay_subtitle' }, '你的一句交代，我接着跟进。')),
            h('button', { className: 'dot_overlay_action', type: 'button', 'aria-label': '打开完整工作台', title: '打开完整工作台', onClick: openWorkbench }, icon('expand')),
            h('button', { className: 'dot_overlay_action', type: 'button', 'aria-label': '收起 Dot 对话', title: '收起', onClick: close }, icon('close'))),
          h('div', { className: 'dot_overlay_body' }, content)),
        !surface.suspended && !(surface.homeActive&&surface.homeReady) && h('button', { className: 'dot_overlay_launcher', type: 'button', ref: launcher, 'aria-label': showing ? '收起 Dot 对话' : '打开 Dot 对话', 'aria-expanded': showing, 'aria-controls': showing ? 'dsh-dot-overlay-dialog' : undefined, onKeyDown: escape,
          onClick: () => { setError(''); if(surface.homeActive){adapters.focusHome?.();return;} if (open) close(); else setOpen(true); } }, mark(), h('span', null, 'Dot'))));
  };
}

function registerDotOverlay(ctx, Component) {
  if (typeof ctx?.effect !== 'function' || typeof ctx?.slots?.inject !== 'function' || typeof ctx?.slots?.register !== 'function') return false;
  ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'dsh-dot-launcher', order: 30,
    children: { 'dot.overlay.conversation': { kind: 'single', scope: 'session' } },
  }, Component)));
  return true;
}
    // END synchronized Dot overlay factories

    function apply(ctx){
      const appearance=createDotAppearance(ctx);
      const desktopController=createDesktopConversationController(ctx);
      const CompactViews=createDotConversationViews(React);
      ctx.effect(()=>()=>desktopController.close());
      function DesktopConversation({target,owner='home',SessionProvider,renderSlot,onOpenHistory,onReady,slotName='dot.desktop.conversation'}){
        const [ready,setReady]=React.useState(null),[problem,setProblem]=React.useState('');
        const occurrence=React.useRef(Symbol(owner));
        React.useEffect(()=>{let live=true,acquiring=false,attached=false;setReady(null);setProblem('');
          const acquire=()=>{if(!live||acquiring||attached||workbenchSurface.suspended||desktopController.getSnapshot().owner!==null)return;acquiring=true;void desktopController.acquire(occurrence.current,target).then(reference=>{if(live&&!workbenchSurface.suspended){attached=true;setReady({reference,id:target.sessionId,revision:target.revision});onReady?.(true);}}).catch(error=>{if(live&&error?.code!=='desktop-conversation-cancelled')setProblem(error?.code==='desktop-conversation-held'?'正在交接同一个对话，原草稿会保留。':'对话暂未打开。请打开完整对话继续；原草稿会保留。');}).finally(()=>{acquiring=false;});};
          const unsubscribe=desktopController.subscribe(acquire);acquire();return()=>{live=false;unsubscribe();onReady?.(false);desktopController.release(occurrence.current);};
        },[owner,target.sessionId,target.revision]);
        const reference=ready?.id===target.sessionId&&ready?.revision===target.revision?ready.reference:null;
        return h('div',{className:'pc_dot_conversation','data-dot-desktop-conversation':target.sessionId},problem?h('div',{role:'status'},h('p',null,problem),h('button',{type:'button',onClick:onOpenHistory},'打开完整对话')):reference?h(SessionProvider,{session:reference},renderSlot(slotName,{})):h('p',{role:'status'},'正在打开对话…'));
      }
      function DesktopConversationContent({renderFactorySlot}){return renderFactorySlot('conversation.content',{variant:'embedded',phase:'active',hero:false},{slots:{views:CompactViews}});}
      ctx.effect(()=>()=>appearance.close());
      function useAppearance(){
        const [value,setValue]=React.useState(()=>appearance.getSnapshot());
        React.useEffect(()=>{const update=()=>setValue(appearance.getSnapshot());const stop=appearance.subscribe(update);update();return stop;},[]);
        return value;
      }
      function AppearancePanel(){
        const value=useAppearance();
        return h('section',{className:'pc_setup','data-dot-appearance':true},h('h3',null,'界面外观'),h('p',{className:'pc_muted'},'Dot 外观使用暖纸底色、清晰字体和配对深色主题。跟随原有明暗设置，随时恢复原生外观。'),h('div',{className:'pc_actions'},...['native','dot'].map(mode=>h('button',{type:'button',key:mode,disabled:!value.writable||value.busy,'aria-pressed':value.mode===mode,onClick:()=>appearance.setAppearance(mode)},mode==='native'?'原生外观':'Dot 外观'))),value.error?h('p',{className:'pc_muted',role:'status'},value.error):null);
      }
      ctx.effect(()=>{
        if(typeof document==='undefined')return;
        const tag=document.createElement('style');tag.dataset.pluginCss='dsh-project-companion/onboarding';tag.textContent=css;document.head.appendChild(tag);
        return()=>tag.remove();
      });
      function Surface(props,onboarding){
        const [snapshot,setSnapshot]=React.useState(null);
        const [selected,setSelected]=React.useState([]);
        const [busy,setBusy]=React.useState(false);
        const [error,setError]=React.useState('');
        const [pollStopped,setPollStopped]=React.useState(false);
        const active=React.useRef(false);
        const latest=React.useRef(null);
        const inFlight=React.useRef(false);
        const controllers=React.useRef(new Set());
        const finished=React.useRef(false);
        const startedWelcome=React.useRef(false);
        const mutationUncertain=React.useRef({selection:false,welcome:false});
        const pollStarted=React.useRef(Date.now());
        const update=(value,authoritativeRead=false)=>{
          if(!active.current)return;
          latest.current=value;
          if(value.connection.state==='bound'){
            // The selection action only adds known projects and is idempotent.
            // A fresh Host read reconciles a lost selection response safely.
            if(authoritativeRead)mutationUncertain.current.selection=false;
            mutationUncertain.current.welcome=value.welcome?.status==='unknown';
            const known=new Set(value.projects.map(project=>project.id));
            const watched=value.projects.filter(project=>project.watched).map(project=>project.id);
            setSelected(current=>[...new Set([...watched,...current.filter(id=>known.has(id))])].slice(0,5));
          }
          setSnapshot(value);
        };
        const invalidateConnection=()=>{
          if(!active.current)return;
          const value={...(latest.current??{version:1,projects:[]}),completed:false,connection:{state:'unknown'}};
          latest.current=value;setSnapshot(value);
        };
        const request=async body=>{
          const controller=new AbortController();controllers.current.add(controller);
          try{
            const response=await fetch(endpoint,{method:body?'POST':'GET',credentials:'same-origin',redirect:'error',cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(10000)]),...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
            if(!response.ok){
              const failure=new Error(response.status===401||response.status===403?'请在已登录的 Harness 窗口中打开此页，然后刷新连接状态。':response.status===404?'当前宿主尚不支持此引导，请核对项目助理版本。':'本次操作未完成，请刷新连接状态后重试。');
              failure.status=response.status;
              // A generic 400 can also follow a post-admission persistence error.
              failure.beforeAdmission=[401,403,404,405,413,415].includes(response.status);
              throw failure;
            }
            const value=await response.json();
            if(!value||value.version!==1||!value.connection||!Array.isArray(value.projects))throw new Error('连接状态暂不可用，请刷新后重试。');
            return value;
          }finally{controllers.current.delete(controller);}
        };
        const refresh=async()=>{
          if(inFlight.current)return;
          inFlight.current=true;
          try{const value=await request();update(value,true);if(active.current)setError(mutationUncertain.current.welcome?'首份简报的接收状态还不确定，未重复提交。请打开 Dot 会话核对。':mutationUncertain.current.selection?'项目关注状态还不确定，请恢复连接后刷新核对。':'');}
          catch(failure){if(active.current){invalidateConnection();setError(failure.message||'连接状态暂不可用。');}}
          finally{inFlight.current=false;}
        };
        React.useEffect(()=>{
          active.current=true;void refresh();
          return()=>{active.current=false;for(const controller of controllers.current)controller.abort();controllers.current.clear();};
        },[]);
        const state=snapshot?.connection?.state;
        React.useEffect(()=>{
          if(!state||['bound','missing'].includes(state))return;
          const timer=setInterval(()=>{
            if(Date.now()-pollStarted.current>=600000){clearInterval(timer);if(active.current)setPollStopped(true);return;}
            void refresh();
          },state==='unknown'?5000:2000);return()=>clearInterval(timer);
        },[state]);
        React.useEffect(()=>{
          if(onboarding&&snapshot?.completed&&(!startedWelcome.current||snapshot?.welcome?.receipt?.status==='user_confirmed')&&!finished.current){finished.current=true;props.complete?.();}
        },[onboarding,snapshot?.completed]);
        React.useEffect(()=>{
          if(!onboarding||!snapshot||snapshot.completed||typeof document==='undefined')return;
          const root=document.getElementById('root');if(!root)return;
          const previous=root.inert;root.inert=true;return()=>{root.inert=previous;};
        },[onboarding,Boolean(snapshot),snapshot?.completed]);

        const mutate=async body=>{
          const current=latest.current;
          if(inFlight.current||!active.current||current?.connection.state!=='bound')return;
          const submitting=body.action==='complete'||body.action==='retry';
          if(body.action==='retry'&&(body.retryKey!==current.welcome?.retryKey||!['stopped','no_text'].includes(current.welcome?.outcome?.status)))return;
          if(body.action==='complete'&&current.welcome?.status==='accepted'){await refresh();return;}
          if(submitting)startedWelcome.current=true;
          if(mutationUncertain.current.selection||(submitting&&mutationUncertain.current.welcome))return;
          inFlight.current=true;setBusy(true);setError('');
          try{
            const value=await request(body);if(!active.current)return;update(value);
            if(submitting&&value.welcome?.status!=='accepted')setError(value.welcome?.status==='unknown'?'首份简报的接收状态还不确定，未重复提交。请打开 Dot 会话核对。':'会话正在处理任务或连接已变化，尚未提交首份简报。');
            if(body.action==='retry'&&value.welcome?.retryKey===body.retryKey)setError('当前会话暂时不能重新生成，请稍后再试。');
            if(body.action==='confirm_received'&&value.welcome?.receipt?.status==='user_confirmed'){
              if(onboarding&&!finished.current){finished.current=true;props.complete?.();}props.close?.();
            }
          }catch(failure){
            if(active.current){
              if(failure.beforeAdmission){
                if([401,403].includes(failure.status))invalidateConnection();
                setError(failure.message);
              }else{
                mutationUncertain.current[submitting?'welcome':'selection']=true;
                setError('操作结果暂不确定，未自动重试。请刷新状态或打开 Dot 会话核对。');
              }
            }
          }finally{inFlight.current=false;if(active.current)setBusy(false);}
        };
        if(onboarding&&snapshot?.completed&&(!startedWelcome.current||snapshot?.welcome?.receipt?.status==='user_confirmed'))return null;
        const bound=state==='bound'&&typeof snapshot?.connection.sessionId==='string';
        const projects=snapshot?.projects??[];
        const saved=projects.filter(project=>project.watched).length;
        const selectedCount=new Set([...selected,...projects.filter(project=>project.watched).map(project=>project.id)]).size;
        const welcomeAccepted=bound&&snapshot?.welcome?.status==='accepted';
        const welcomeFailed=welcomeAccepted&&['stopped','no_text'].includes(snapshot?.welcome?.outcome?.status);
        const retryKey=welcomeFailed&&/^retry_[a-f0-9]{64}$/.test(snapshot?.welcome?.retryKey??'')?snapshot.welcome.retryKey:null;
        const connectionText={missing:'请先安装并启用微信桥接，然后刷新此页。',unknown:'连接状态暂不可用，请刷新后重试。','waiting-qr':'用微信扫描下方二维码，并在手机上确认登录。',scanned:'手机已扫码，请在微信确认登录。','awaiting-message':'扫码已完成。请在微信给小助手发送首条消息“你好”，它会建立你的 Dot 会话。',bound:'已连接微信，沿用当前会话。',failed:'微信连接暂时失败。请到微信设置页查看状态，此页不会重置已有连接。'}[state]??'正在读取连接状态…';
        const body=h('div',{className:'pc_setup'},
          h('h2',null,'DSH Dot'),
          h('p',null,'长在微信里的项目助理。选好要关注的项目，先看一份简报，再直接用自然语言交代事情。'),
          h('section',{className:'pc_card'},h('h3',null,'1 · 连接微信'),h('p',{role:'status'},connectionText),
            state==='waiting-qr'&&snapshot?.connection.qrAvailable===true?h('img',{src:'/wechat/api/qr-image'+(/^[a-f0-9]{16}$/.test(snapshot.connection.qrRevision??'')?`?v=${snapshot.connection.qrRevision}`:''),alt:'用微信扫描登录二维码'}):null,
            pollStopped&&!bound?h('p',{className:'pc_muted'},'已停止自动刷新。需要时点击“刷新连接状态”继续查看。'):null,
            h('div',{className:'pc_actions'},h('button',{type:'button',disabled:busy,onClick:refresh},'刷新连接状态'),bound?h('button',{type:'button',disabled:busy,onClick:()=>{ctx.uiWorkspace.openSession(snapshot.connection.sessionId);props.close?.();}},'打开 Dot 会话'):null,
              props.openSection?h('button',{type:'button',onClick:()=>{props.complete?.();props.openSection('wechat');}},'查看微信设置'):null)),
          h('section',{className:'pc_card'},h('h3',null,'2 · 选择关注的项目'),
            h('p',{className:'pc_muted'},'最多关注 5 个项目。只读取你选择的项目说明和已观察到的会话；不会自动扫全部历史。'),
            projects.length?projects.map(project=>h('label',{key:project.id},h('input',{type:'checkbox',checked:selected.includes(project.id)||project.watched,disabled:busy||!bound||project.watched||(!selected.includes(project.id)&&selectedCount>=5),onChange:event=>{setSelected(current=>event.target.checked?[...new Set([...current,...projects.filter(p=>p.watched).map(p=>p.id),project.id])].slice(0,5):current.filter(id=>id!==project.id));}}),h('span',null,project.label,project.watched?'（已关注）':''))):h('div',null,h('p',{className:'pc_muted'},'还没有可选择的项目。在 Harness 左侧的工作区区域添加一个本地项目文件夹，再回到这里。'),h('button',{type:'button',disabled:busy||!bound,onClick:refresh},'已添加，刷新项目')),
            h('div',{className:'pc_actions'},h('button',{type:'button',disabled:busy||!bound||!selected.length||mutationUncertain.current.selection,onClick:()=>mutate({action:'select_projects',projectIds:selected})},'保存关注并预览简报'))),
          bound&&snapshot?.firstBrief?h('section',{className:'pc_card'},h('h3',null,'项目资料预览'),h('div',{className:'pc_brief'},snapshot.firstBrief),h('p',{className:'pc_muted'},'这是有来源的资料预览。开始使用后，由 Dot 在当前微信会话整理第一份只读简报。')):null,
          welcomeAccepted?h('section',{className:'pc_card','data-dot-first-value':true},h('h3',null,welcomeFailed?'这次简报未完成':'首份简报到哪一步了'),h('p',{className:'pc_muted'},snapshot?.welcome?.outcome?.status==='generated'?'简报已生成，手机是否收到由你确认。':snapshot?.welcome?.outcome?.status==='running'?'Dot 正在整理这次简报。':snapshot?.welcome?.outcome?.status==='stopped'?'本次简报已停止，尚未生成可用结果。':snapshot?.welcome?.outcome?.status==='no_text'?'本次未生成简报，已结束此次尝试。':'结果暂时无法确认。请刷新状态，或打开原 Dot 会话核对；不会自动重发。'),snapshot?.welcome?.outcome?.reply?h('div',{className:'pc_brief'},snapshot.welcome.outcome.reply):null,welcomeFailed?h('p',{className:'pc_muted'},retryKey?'检查原 Dot 会话的模型或连接状态后，可重新生成；仍只读取原先选择的项目。':'请打开原 Dot 会话继续。原项目范围未能确认，不会替你猜测或自动重发。'):snapshot?.welcome?.receipt?.status==='user_confirmed'?h('p',{role:'status'},'你已确认在微信收到这份简报。'):h('div',{className:'pc_actions'},h('button',{type:'button',disabled:busy,onClick:refresh},'刷新简报状态'),h('button',{type:'button',className:'pc_primary',disabled:busy,onClick:()=>mutate({action:'confirm_received'})},'我已在微信收到这份简报')),welcomeFailed?null:h('p',{className:'pc_muted'},'只有你实际看见后才点确认；电脑收到回复不等于微信送达。')):null,
          error?h('p',{className:'pc_error',role:'alert'},error):null,
          h('p',{className:'pc_muted'},'电脑和 Harness 需保持在线。提醒、日报和周期跟进都由你另行指定时间，安装不会自动开启推送计划。'),
          h('div',{className:'pc_actions'},h('button',{type:'button',className:'pc_primary',disabled:busy||!bound||(!welcomeAccepted&&(!saved||mutationUncertain.current.selection||mutationUncertain.current.welcome)),onClick:()=>welcomeFailed?(retryKey?mutate({action:'retry',retryKey}):(ctx.uiWorkspace.openSession(snapshot.connection.sessionId),props.close?.())):mutate({action:'complete'})},busy?'正在处理…':welcomeFailed?(retryKey?'重新生成首份简报':'打开 Dot 会话继续'):welcomeAccepted?'查看已提交的首份简报':'生成首份简报并回到微信'),onboarding?h('button',{type:'button',disabled:busy,onClick:()=>props.complete?.()},'稍后设置'):null));
        return onboarding&&snapshot?h(Modal,{open:true,closeLabel:'关闭',title:'DSH Dot',headless:true,className:'pc_setup_modal',onClose:()=>props.complete?.()},body):body;
      }
      function CredentialForm(props={}){
        const formRef=React.useRef(null);
        if(formRef.current===null){try{const forms=typeof ctx.get==='function'?ctx.get('configForms',false):ctx.configForms;formRef.current=forms?.get('project-companion')??false;}catch{formRef.current=false;}}
        const form=formRef.current;
        const [view,setView]=React.useState(()=>form?form.getSnapshot():{status:'unavailable',writable:false});
        const [drafts,setDrafts]=React.useState({});
        const [saving,setSaving]=React.useState(false);
        const [failed,setFailed]=React.useState(false);
        const active=React.useRef(false),current=React.useRef(view),changes=React.useRef({}),baseline=React.useRef(undefined),inFlight=React.useRef(false);
        current.current=view;
        React.useEffect(()=>{
          active.current=true;
          const sync=()=>{if(active.current&&form){current.current=form.getSnapshot();setView(current.current);}};
          const stop=form?form.subscribe(sync):null;sync();
          return()=>{active.current=false;changes.current={};baseline.current=undefined;stop?.();};
        },[]);
        const fields=[['flomoToken','flomo MCP Token',true],['didaToken','滴答清单 API 口令',true],['googleClientId','Google Desktop Client ID',false],['googleClientSecret','Google Desktop Client Secret',true],['googleRefreshToken','Google Refresh Token',true]];
        const stage=(field,value)=>{
          if(!active.current||inFlight.current||current.current.status!=='ready'||!current.current.writable)return;
          if(!Object.keys(changes.current).length)baseline.current=current.current.revision;
          const next={...changes.current,[field]:value};
          if(value===''&&field!=='googleClientId')delete next[field];
          changes.current=next;setDrafts(next);setFailed(false);
          if(!Object.keys(next).length)baseline.current=undefined;
        };
        const discard=()=>{changes.current={};baseline.current=undefined;if(active.current){setDrafts({});setFailed(false);}};
        const invalid=Object.values(drafts).some(value=>value!==null&&(typeof value!=='string'||value.length>16384));
        const save=async()=>{
          if(!active.current||inFlight.current||!form||current.current.status!=='ready'||!current.current.writable||invalid)return;
          const ops=Object.entries(changes.current).map(([field,value])=>value===null||value===''?{op:'unset',path:[field]}:{op:'set',path:[field],value});
          if(!ops.length)return;
          inFlight.current=true;setSaving(true);setFailed(false);
          try{
            const accepted=await form.mutate(ops,baseline.current);
            if(active.current){if(accepted===true){discard();current.current=form.getSnapshot();setView(current.current);void props.onSaved?.();}else setFailed(true);}
          }catch{if(active.current)setFailed(true);}
          finally{inFlight.current=false;if(active.current)setSaving(false);}
        };
        if(typeof SettingsForm!=='function'&&typeof SettingsForm!=='string')return h('p',{className:'pc_error',role:'status'},'当前宿主的原生凭据表单不可用，请更新 Harness。');
        const blocked=view.status!=='ready'||!view.writable||saving;
        const configured=field=>field==='flomoToken'?props.sources?.some(row=>row.id==='flomo'&&row.configured):field==='didaToken'?props.sources?.some(row=>row.id==='dida'&&row.configured):field==='googleRefreshToken'?props.googleAuth?.refreshConfigured:props.googleAuth?.clientConfigured;
        return h(SettingsForm,{labels:{unavailable:'原生配置尚未就绪，请稍后重新打开此页；不会改用聊天接收密钥。',readOnly:'当前宿主配置只读，无法保存凭据。',saveFailed:'未确认保存成功，未自动重试。请核对原生配置后重试。',save:'保存连接凭据',saving:'正在保存…'},state:{available:view.status==='ready',writable:view.writable===true,dirty:Object.keys(drafts).length>0,invalid,saving,failed},onSave:save,onDiscard:discard},
          fields.map(([field,label,secret])=>{
            const staged=Object.hasOwn(drafts,field);
            const value=staged?drafts[field]??'':secret?'':typeof view.value?.[field]==='string'?view.value[field]:'';
            return h('div',{key:field},secret?h(SettingsSecretField,{id:`pc-credential-${field}`,label,hint:field==='googleRefreshToken'?'通常由 Google 授权自动保存；空白保留已有值，不会回显令牌。':'仅输入新值以替换；留空保留已有凭据，不会回显旧值。',text:value,disabled:blocked,onEdit:text=>stage(field,text),configured:configured(field)===true,stateLabel:staged&&drafts[field]===null?'保存后清除':configured(field)?'已配置，不回显':'尚未确认配置'}):h(SettingsValueField,{id:`pc-credential-${field}`,label,hint:'使用你自己创建的 Desktop OAuth 应用，Google 密钥不要发进聊天。',text:value,overridden:Object.hasOwn(view.user??{},field)||staged,invalid:false,overriddenLabel:'自定义值',resetLabel:'清除',invalidLabel:'请检查输入',disabled:blocked,onEdit:text=>stage(field,text),onReset:()=>stage(field,null)}),
              secret?h('button',{type:'button',disabled:blocked,onClick:()=>stage(field,null)},`清除 ${label}`):null);
          }),h('div',null,h('p',{className:'pc_muted'},'Google 授权记录由本人登录后自动保存，不在此显示或手填。清除本机记录后须重新授权并启用来源。'),...[['googleSuiteOAuthCredentials','Google 三件套'],['googleCalendarOAuthCredentials','Google 日历']].map(([field,label])=>h('button',{type:'button',key:field,disabled:blocked,onClick:()=>stage(field,null)},drafts[field]===null?`保存后清除 ${label}授权`:`清除 ${label}授权`))));
      }
      function ContextPanel(props={}){
        const contextEndpoint='/api/project_companion/context';
        const sourceNames={gmail:'Gmail',calendar:'Google 日历',drive:'Google Drive',docs:'Google Docs',sheets:'Google Sheets',slides:'Google Slides',dida:'滴答清单',flomo:'flomo'};
        const sourceIds=Object.keys(sourceNames),googleIds=['gmail','calendar','drive'];
        const [snapshot,setSnapshot]=React.useState(null),[busy,setBusy]=React.useState(false),[error,setError]=React.useState('');
        const [authorization,setAuthorization]=React.useState(null),[remaining,setRemaining]=React.useState(0),[notice,setNotice]=React.useState('');
        const active=React.useRef(false),inFlight=React.useRef(false),latest=React.useRef(null),authRef=React.useRef(null),controllers=React.useRef(new Set()),contextEpoch=React.useRef(0);
        const authNames={google:'Google 高级只读',googleCalendar:'Google 日历',googleSuite:'Google',flomo:'flomo',dida:'滴答清单'};
        const clearAuthorization=()=>{authRef.current=null;if(active.current)setAuthorization(null);};
        const invalidate=()=>{latest.current=null;if(active.current){setSnapshot(null);clearAuthorization();}};
        const authStatus=a=>{
          if(!a||typeof a!=='object'||Array.isArray(a)||!['clientConfigured','refreshConfigured','authInProgress'].every(k=>typeof a[k]==='boolean'))return null;
          const attempt=a.lastAttempt?.status==='saved'?{status:'saved'}:a.lastAttempt?.status==='failed'&&['expired','consent_not_granted','connection_changed','code_rejected','client_configuration','network','permissions','storage','response','unknown'].includes(a.lastAttempt.reason)?{status:'failed',reason:a.lastAttempt.reason}:null;
          return{clientConfigured:a.clientConfigured,refreshConfigured:a.refreshConfigured,authInProgress:a.authInProgress,lastAttempt:attempt,...(typeof a.expiresAt==='string'&&a.expiresAt.length<=40&&Number.isFinite(Date.parse(a.expiresAt))?{expiresAt:a.expiresAt}:{})};
        };
        const rememberAuthorization=value=>{authRef.current=value;setAuthorization(value);setRemaining(Math.max(0,Math.ceil((value.deadline-Date.now())/1000)));};
        const accept=value=>{
          if(!value||!Array.isArray(value.sources)||value.sources.length!==sourceIds.length||!authStatus(value.googleAuth))throw new Error('invalid context status');
          const rows=sourceIds.map(id=>{
            const matches=value.sources.filter(row=>row?.id===id);if(matches.length!==1)throw new Error('invalid context source');
            const row=matches[0];if(typeof row.configured!=='boolean'||typeof row.enabled!=='boolean')throw new Error('invalid context access');
            return{id,name:sourceNames[id],configured:row.configured,enabled:row.enabled,status:row.status??row.state,lastReadAt:typeof row.lastReadAt==='string'&&row.lastReadAt.length<=80&&Number.isFinite(Date.parse(row.lastReadAt))?row.lastReadAt:null};
          });
          const state={sources:rows,googleAuth:authStatus(value.googleAuth),bindingRevision:typeof value.bindingRevision==='string'?value.bindingRevision:null,summaryBindingRevision:typeof value.summaryBindingRevision==='string'?value.summaryBindingRevision:null};
          for(const field of ['flomoAuth','didaAuth','googleCalendarAuth','googleSuiteAuth'])state[field]=authStatus(value[field]);
          if(state.googleSuiteAuth){const granted=value.googleSuiteAuth.grantedSources;if(!Array.isArray(granted)||granted.some(id=>!googleIds.includes(id))||new Set(granted).size!==granted.length)throw new Error('invalid Google service grants');state.googleSuiteAuth.grantedSources=[...granted];}
          if(active.current){
            const previousRevision=latest.current?.bindingRevision;latest.current=state;setSnapshot(state);
            if(previousRevision&&previousRevision!==state.bindingRevision){clearAuthorization();setNotice('原微信绑定已变化。请重新核对账号授权和来源范围，再提出本次问题。');return state;}
            const current=authRef.current;
            if(current){const status=state[current.source+'Auth'];if(!status||!status.authInProgress){clearAuthorization();setNotice(status?.lastAttempt?.status==='failed'?`本次授权未完成。${status.lastAttempt.reason==='storage'?'本机保存结果尚未确认。':status.refreshConfigured?'原有已保存的连接仍保留。':'尚未保存新连接。'} 请查看 Google 卡片的原因与下一步。`:status?.refreshConfigured?(['flomo','dida'].includes(current.source)?'授权流程已结束。下方显示原有已保存的连接，不代表本次授权成功；如浏览器无法连接，请返回这里重新点击登录。':'授权流程已结束，以下为当前已保存的权限。可启用需要的来源；尚未读取资料。'):'授权流程已结束，尚未确认保存。可以重新连接。');}}
            else{const entry=Object.entries(authNames).find(([source])=>state[source+'Auth']?.authInProgress&&state[source+'Auth']?.expiresAt);if(entry){const[source]=entry,expiresAt=state[source+'Auth'].expiresAt,deadline=Math.min(Date.parse(expiresAt),Date.now()+300000);if(deadline>Date.now())rememberAuthorization({source,url:null,expiresAt,deadline});}}
          }
          return state;
        };
        const request=async body=>{
          const controller=new AbortController();controllers.current.add(controller);
          try{const response=await fetch(contextEndpoint,{method:body?'POST':'GET',credentials:'same-origin',redirect:'error',cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(25000)]),...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});if(!response.ok){let detail;try{detail=await response.json();}catch{}const failure=new Error('context operation failed');if(body?.action==='google_suite_authorize'&&response.status===503&&detail?.code==='GOOGLE_CONNECTION_UNAVAILABLE')failure.code='GOOGLE_CONNECTION_UNAVAILABLE';throw failure;}return await response.json();}
          finally{controllers.current.delete(controller);}
        };
        const refresh=async(quiet=false)=>{
          if(!active.current||inFlight.current)return;const epoch=contextEpoch.current;inFlight.current=true;if(!quiet){setBusy(true);setError('');}
          try{const value=await request();if(active.current&&contextEpoch.current===epoch)accept(value);}
          catch{if(active.current&&contextEpoch.current===epoch){invalidate();setError('资料来源状态暂不可用，请刷新状态后重试。');}}
          finally{if(contextEpoch.current===epoch){inFlight.current=false;if(active.current&&!quiet)setBusy(false);}}
        };
        React.useEffect(()=>{active.current=true;contextEpoch.current++;inFlight.current=false;latest.current=null;setSnapshot(null);clearAuthorization();void refresh();return()=>{active.current=false;contextEpoch.current++;authRef.current=null;for(const controller of controllers.current)controller.abort();controllers.current.clear();};},[props.bindingRevision]);
        // Observe only sanitized authorization state while this one flow is active.
        // No background source queries, retrying POSTs, or permanent polling.
        React.useEffect(()=>{
          if(!authorization)return;
          const timer=setInterval(async()=>{
            const current=authRef.current;if(!active.current||!current)return;
            const seconds=Math.max(0,Math.ceil((current.deadline-Date.now())/1000));setRemaining(seconds);
            if(!seconds){clearAuthorization();setNotice('授权链接已过期。点击重新连接即可再试，已有连接会保留。');return;}
            await refresh(true);
          },2000);
          return()=>clearInterval(timer);
        },[authorization?.source,authorization?.deadline]);
        const mutate=async(action,source)=>{
          if(!active.current||inFlight.current||!latest.current)return;
          const authSource={google_authorize:'google',google_calendar_authorize:'googleCalendar',google_suite_authorize:'googleSuite',flomo_authorize:'flomo',dida_authorize:'dida'}[action];
          if(authSource){
            if(authRef.current)return;
            if(authSource.startsWith('google')?!latest.current[authSource+'Auth']?.clientConfigured:!latest.current[authSource+'Auth'])return;
          }else{const row=latest.current.sources.find(item=>item.id===source);if(!row||(action==='connect'&&(!row.configured||row.enabled))||(action==='disconnect'&&!row.enabled))return;}
          const epoch=contextEpoch.current,revision=latest.current.bindingRevision;inFlight.current=true;setBusy(true);setError('');setNotice('');
          try{
            const value=await request({action,...(source?{source}:{}),...(revision?{expectedBindingRevision:revision}:{})});if(!active.current||epoch!==contextEpoch.current)return;
            if(authSource){
              const url=new URL(value?.url),target={google:['https://accounts.google.com','/o/oauth2/v2/auth'],googleCalendar:['https://accounts.google.com','/o/oauth2/v2/auth'],googleSuite:['https://accounts.google.com','/o/oauth2/v2/auth'],flomo:['https://flomoapp.com','/integration/grant'],dida:['https://dida365.com','/oauth/authorize']}[authSource];
              if(url.origin!==target[0]||url.pathname!==target[1]||url.username||url.password||url.hash||typeof value.expiresAt!=='string'||!Number.isFinite(Date.parse(value.expiresAt))||Date.parse(value.expiresAt)<=Date.now())throw new Error('invalid authorization link');
              rememberAuthorization({source:authSource,url:url.toString(),expiresAt:value.expiresAt,deadline:Math.min(Date.parse(value.expiresAt),Date.now()+300000)});
              // The official Desktop forwards http(s) window.open to the system browser.
              // Web hosts may block it; always retain the validated click-only link.
              try{window.open?.(url.toString(),'_blank','noopener,noreferrer');}catch{}
            }else accept(value);
          }catch(failure){if(active.current&&epoch===contextEpoch.current){if(failure?.code==='GOOGLE_CONNECTION_UNAVAILABLE')setError('尚未打开 Google 授权：本机暂时连不到授权交换接口。已有连接仍保留，请稍后再点连接；不会自动重复授权。');else{invalidate();setError('操作结果暂不确定，请刷新状态核对后重试；不会重复提交。');}}}
          finally{if(epoch===contextEpoch.current){inFlight.current=false;if(active.current)setBusy(false);}}
        };
        const rows=snapshot?.sources??sourceIds.map(id=>({id,name:sourceNames[id],configured:false,enabled:false,lastReadAt:null}));
        const rowFor=id=>rows.find(row=>row.id===id),google=snapshot?.googleAuth,suite=snapshot?.googleSuiteAuth,pending=Boolean(authorization);
        const statusText=row=>!snapshot?'状态未确认':!row.configured?'待账号授权':!row.enabled?'已授权，尚未启用':row.lastReadAt?'当前对话已启用':'当前对话已启用；本次启动暂无读取记录';
        const sourceRow=(id,description)=>{const row=rowFor(id);return h('div',{className:'pc_connect_row',key:id,'data-context-source':id},h('div',null,h('h3',null,row.name),description?h('p',{className:'pc_muted'},description):null,h('p',{className:'pc_connect_status',role:'status'},statusText(row)),row.enabled&&row.lastReadAt?h('p',{className:'pc_muted'},`上次读取：${row.lastReadAt}`):null),h('button',{type:'button',disabled:busy||!snapshot||(!row.enabled&&!row.configured),onClick:()=>mutate(row.enabled?'disconnect':'connect',id)},row.enabled?'停止此来源':row.configured?'启用只读来源':'等待授权'));};
        const authView=source=>authorization?.source===source?h('div',{className:'pc_connect_authorizing',role:'status'},h('strong',null,'请在浏览器完成授权'),h('p',{className:'pc_muted'},`返回这里后会自动更新 · 剩余 ${Math.floor(remaining/60)}:${String(remaining%60).padStart(2,'0')}`),authorization.url?h('a',{href:authorization.url,target:'_blank',rel:'noopener noreferrer'},`浏览器未打开？继续到 ${authNames[source]} 授权`):h('p',{className:'pc_muted'},'请继续刚才的授权页；此处不会重复打开浏览器。')):null;
        const attemptHints={expired:'链接已过期，请重新连接并在五分钟内完成，期间保持 Harness 运行。',consent_not_granted:'这次未同意授权；如仍希望连接，请重新核对只读权限。',connection_changed:'授权期间连接或权限状态已变化，请刷新后重新连接。',code_rejected:'本次授权码未被 Google 接受，请重新连接；不要刷新旧回调页。',client_configuration:'Google 应用配置需要产品方检查，请保留原连接，暂不反复授权。',network:'与 Google 交换授权时连接未完成，确认网络可用后再连接。',permissions:'未确认可用的只读权限，请重新核对授权范围。',storage:'本机保存结果尚未确认，请刷新并核对当前权限；不会自动重试或回滚。',response:'授权返回未通过校验，请重新连接。',unknown:'具体原因尚未确认，请刷新状态后重新连接。'};
        const suiteWaiting=Boolean(suite?.authInProgress||authorization?.source==='googleSuite');
        const suiteFailed=suite?.lastAttempt?.status==='failed'&&!suiteWaiting;
        const suiteConnected=Boolean(suite?.refreshConfigured&&!suiteFailed&&!suiteWaiting);
        const googleEnabled=googleIds.filter(id=>rowFor(id)?.enabled).length;
        const suiteStatus=suiteFailed?`本次 Google 授权未完成。${attemptHints[suite.lastAttempt.reason]} ${suite.lastAttempt.reason==='storage'?'下方展示当前可确认的权限，不能据此认定本次授权成功。':suite.refreshConfigured?'原有连接仍保留，可继续使用已启用的来源。':'尚未保存新连接。'}`:!suite?'连接状态待确认，请刷新。':!suite.clientConfigured?'Google 连接准备中。':suiteWaiting?'正在等待你完成 Google 授权。':suite.refreshConfigured?googleEnabled===3?(props.bound===false?'三个来源均已启用；微信入口状态尚待确认，账号无需重新登录。':'三个来源均已启用，可以在微信或 Dot 会话中按需提问。'):suite.grantedSources.length===3?'授权已保存。选择下面要使用的来源；启用后仅按你的请求读取。':'部分 Google 权限已保存。选择已授权的来源即可使用；缺少的权限可在下方重新授权。':'登录一次，连接你的 Gmail、日历和云盘。';
        const suiteAuthControls=()=>h('div',{'data-google-auth-controls':true},
            h('p',{'data-google-data-use-disclosure':true,className:'pc_connect_notice'},'同意连接后，Dot 仅按你的请求读取 Google 资料，内容会进入 Harness 会话并交给你配置的模型处理；从微信查询时，回复也会经过微信。请仅使用不将这些资料用于通用 AI 训练的模型服务。你可以随时停止来源或撤销授权。'),
            h('p',{className:'pc_muted'},h('a',{'data-google-privacy':true,href:'https://oxmumu3.github.io/dsh-project-companion/privacy.html',target:'_blank',rel:'noopener noreferrer'},'查看隐私说明与撤销授权的方法')),
            h('div',{className:'pc_actions'},h('button',{type:'button',className:suite?.refreshConfigured?'':'pc_primary','data-google-suite-login':true,disabled:busy||pending||!suite?.clientConfigured,onClick:()=>mutate('google_suite_authorize')},authorization?.source==='googleSuite'?'等待 Google 授权…':suite?.refreshConfigured?'同意并重新连接 Google':'同意并连接 Google')),
            h('p',{className:'pc_muted','data-google-unverified-help':true},'若 Google 显示“Google hasn’t verified this app”：先核对应用名 DSH Dot、开发者及只读权限；你确认愿意继续时，手动选择 Advanced（高级）→ Go to DSH Dot (unsafe) → 继续／允许。未验证提示仍然有效，这不是 Google 的安全背书。'),
            authView('googleSuite'));
        return h('div',{className:'pc_setup pc_connections','data-context-panel':true},
          h('div',{className:'pc_connect_heading'},props.compact?null:h('div',null,h('h2',null,'连接你的资料'),h('p',{className:'pc_muted'},'让 Dot 结合邮件、安排和文档，帮你推进手头的事。')),h('button',{type:'button',disabled:busy,onClick:()=>refresh()},busy?'正在更新…':'刷新资料来源状态')),
          props.compact?null:h('p',{className:'pc_muted'},'连接是可选的，本地项目和 AI 资讯可以直接使用。登录不会自动扫描资料或开启推送。'),
          props.compact?null:h('div',{className:'pc_connection_steps','aria-label':'资料使用步骤'},...['1 · 账号授权','2 · 启用所需来源','3 · 在会话中明确提问'].map(label=>h('span',{key:label},label))),
          props.bound===false&&!snapshot?.bindingRevision?h('p',{className:'pc_connect_notice'},'个人资料来源需要先绑定你的 Dot 微信会话。连接微信后，再启用来源和提出问题。'):null,
          error?h('p',{className:'pc_error',role:'alert'},error):null,
          notice?h('p',{className:'pc_connect_notice',role:'status'},notice):null,
          authorization?h('p',{className:'pc_connect_notice',role:'status','data-context-auth-pending':true},`正在完成 ${authNames[authorization.source]} 授权，其他登录按钮暂时不可用。请先完成当前授权；完成或超时后，未成功的来源可重新连接。`):null,
          h('section',{className:'pc_card pc_google_connect','data-google-suite-connect':true},
            h('div',{className:'pc_connect_heading'},h('div',null,h('h3',null,suiteConnected?'Google 已连接':'Google 三件套'),h('p',{className:'pc_muted'},'Gmail、Google 日历、Google Drive · 只读')),h('span',{className:'pc_connect_badge'},snapshot?`已启用 ${googleEnabled}/3`:'状态待确认')),
            h('p',{className:suiteFailed?'pc_connect_notice':'pc_connect_status',role:'status','aria-live':'polite','data-google-attempt-state':true},suiteStatus),
            h('p',{className:'pc_muted','data-google-preview-limit':true},'公众预览 · Google 审核中，尚有累计 100 个授权账号上限。授权成功不等于审核通过。'),
            !suiteConnected?suiteAuthControls():null,
            typeof props.onFirstValue==='function'&&googleIds.some(id=>rowFor(id)?.enabled)?h('div',{'data-google-first-value':true},h('p',{className:'pc_muted'},'已启用的资料可以用起来。选择一个问题，带入 Dot 会话后由你发送。'),h('div',{className:'pc_actions'},...[["calendar","看看接下来24小时","日历未来24小时最多2条，说明时区与来源。不要设置提醒，不要建立计划。"],["gmail","整理近期邮件","从 Gmail 搜索「newer_than:3d」最多3条，说明读取范围。不要发送邮件，不要建立计划。"],["drive","找一份项目资料","请帮我在 Google Drive 找一份项目资料，先等我补充文件关键词。不要建立计划。"]].filter(([id])=>rowFor(id)?.enabled).map(([id,label,prompt],index)=>h('button',{key:id,type:'button',className:index===0?'pc_primary':'',disabled:busy||props.bound===false,onClick:()=>{if(!inFlight.current&&latest.current?.sources.find(row=>row.id===id)?.enabled){if(props.bindingRevision&&latest.current.bindingRevision!==props.bindingRevision){setError('来源与工作台的绑定不同，请刷新两处状态后重试。');return;}props.onFirstValue(prompt);}}},label)))):null,
            googleIds.map(id=>sourceRow(id,{gmail:'按需找邮件，查看正文并整理待办。',calendar:'主日历近期安排，单次最多 7 天、10 条。',drive:'查找文件名，按需读取支持的文本内容。'}[id])),
            suiteConnected?h('details',{className:'pc_connect_help','data-google-reconnect':true},h('summary',null,'更换账号或重新授权'),h('p',{className:'pc_muted'},'当前授权已保存，无需重复登录。更换账号或重新授权后，需要重新启用相应来源。'),suiteAuthControls()):null,
            h('details',{className:'pc_connect_help'},h('summary',null,'授权范围与连接帮助'),h('p',{className:'pc_muted'},'Google 连接可用范围由当前应用受众和审核状态决定。公开预览可能显示未验证提示或人数限制；若显示仅限测试账号，请以 Google 页面提示为准。'),h('p',{className:'pc_muted'},'三项均为只读，不发送邮件、不修改日历或文件。授权与启用分开；来源启用后，Dot 仍只按你的请求读取。授权保存在这台电脑，查询所需内容会交给你在 Harness 配置的模型处理。'),h('p',{className:'pc_muted'},'Drive 支持文件名搜索、纯文本和 Google 文档／演示的文本读取；表格按指定范围读取。PDF、图片和其他二进制文件暂不读取全文。'),snapshot?.googleCalendarAuth?.refreshConfigured?h('p',{className:'pc_muted'},'你之前单独连接的日历继续使用，不会被新的三件套授权覆盖。'):null),
            h('details',{'data-google-calendar-connect':true,className:'pc_connect_help'},h('summary',null,'只连接 Google 日历'),h('p',{className:'pc_muted'},'仅请求主日历事件只读权限。登录不会自动查询或开启推送。'),h('button',{type:'button',disabled:busy||pending||!snapshot?.googleCalendarAuth?.clientConfigured,onClick:()=>mutate('google_calendar_authorize')},'同意并登录 Google 日历'),h('p',{className:'pc_muted',role:'status'},!snapshot?.googleCalendarAuth?'Google 日历连接状态待确认。':!snapshot.googleCalendarAuth.clientConfigured?'Google 日历连接准备中。':snapshot.googleCalendarAuth.refreshConfigured?'单独日历授权已保存。':snapshot.googleCalendarAuth.authInProgress?'正在等待日历授权。':'尚未单独连接日历。'),authView('googleCalendar'))),
          h('section',{className:'pc_card'},h('h3',null,'任务与笔记'),h('p',{className:'pc_muted'},'直接在官方页面登录授权，返回后自动更新连接状态。浏览器显示无法连接或 Harness 重启后，请返回这里重新点击登录，不要刷新旧授权页面。'),
            ...['flomo','dida'].map(source=>h('div',{key:source},h('div',{className:'pc_actions'},h('button',{type:'button',disabled:busy||pending||!snapshot?.[source+'Auth'],onClick:()=>mutate(source+'_authorize')},'登录 '+sourceNames[source]+' 授权')),authView(source),sourceRow(source,source==='flomo'?'找回笔记里的想法和背景。':'查看任务与截止时间，梳理下一步。')))),
          h('details',{className:'pc_card','data-context-advanced':true},h('summary',null,'高级连接设置与兼容凭据'),
            h('h3',null,'文档工具与兼容接口'),h('p',{className:'pc_muted'},'按需启用 Docs、Sheets、Slides 的独立读取工具。可用状态以各来源为准，不必为了连接 Google 三件套填写下方配置。'),
            ...['docs','sheets','slides'].map(id=>sourceRow(id)),
            h('h3',null,'开发者 MCP 连接'),h('p',{className:'pc_muted'},'这是旧 Google MCP Developer Preview 的兼容入口，需要相应资格和自己的 Desktop 应用。普通 Google 登录请使用上方按钮。'),
            h('p',{className:'pc_muted'},'下方原生插件配置仅供高级兼容。令牌不要发进聊天；日常登录不需要手填这些字段。'),
            h(CredentialForm,{sources:snapshot?.sources,googleAuth:google,onSaved:()=>refresh()}),
            h('p',{className:'pc_muted',role:'status'},!google?'兼容连接状态未确认':google.refreshConfigured?'兼容账号凭据已保存。':google.authInProgress?'正在等待兼容账号授权。':google.clientConfigured?'自定义 Desktop 应用已配置。':'尚未配置自定义 Desktop 应用。'),
            h('button',{type:'button',disabled:busy||pending||!google?.clientConfigured,onClick:()=>mutate('google_authorize')},'同意并连接 Google 账号（高级）'),authView('google')),
          typeof props.onFirstValue==='function'?h('section',{className:'pc_card','data-context-first-value':true},h('h3',null,'从一个具体问题开始'),h('p',{className:'pc_muted'},'这些入口只准备问题草稿，再带入原生 Dot 会话由你发送。网页不会自行查询；启用来源也不代表已经读到资料。'),h('div',{className:'pc_actions'},...[['gmail','整理待办邮件','从 Gmail 搜索「newer_than:3d」最多 3 条。'],['calendar','看看近期安排','请只读查看主 Google 日历未来三天的安排，最多十条，说明时区与截断；不要创建或修改日程。'],['drive','找一份项目资料','请帮我在 Google Drive 找一份项目资料。先等我补充项目名或文件关键词，再按明确范围查询。'],['dida','梳理待办','请帮我梳理滴答清单。先等我补充清单名，再只读查询这份清单未完成的任务，最多 2 条；不要跨清单扫描或改任务状态。'],['flomo','找回笔记背景','请帮我在 flomo 找回相关笔记。先等我补充关键词和时间范围，再查询。']].map(([id,label,prompt])=>h('button',{key:id,type:'button',disabled:busy||props.bound===false||!rowFor(id)?.enabled,onClick:()=>{if(!inFlight.current&&latest.current?.sources.find(row=>row.id===id)?.enabled){if(props.bindingRevision&&latest.current.bindingRevision!==props.bindingRevision){setError('来源与工作台的绑定不同，请刷新两处状态后重试。');return;}props.onFirstValue(prompt);}}},label))),h('p',{className:'pc_muted'},'先授权并启用对应来源，再选择问题。之后是否建立跟进计划，由你另外决定。')):null,
          h('p',{className:'pc_muted'},'停止来源后，Dot 不再通过当前对话读取它。需要彻底撤销授权，可前往对应服务的账号设置。读取记录不代表持续监控或内容完整。'));
      }
      const dotPanel='project-companion-dot';
      const workbenchEndpoint='/api/project_companion/workbench';
      const catalogEndpoint='/api/project_companion/catalog';
      const dotCss=`
        .pc_dot,.pc_dot_modal{--dot-paper:color-mix(in srgb,var(--dsw-alias-bg-base,#f6f4ef) 94%,#bda776);--dot-card:var(--dsw-alias-bg-layer-2,#fffdf8);--dot-ink:var(--dsw-alias-label-primary,#242d38);--dot-muted:var(--dsw-alias-label-secondary,#5c6672);--dot-line:var(--dsw-alias-border-l3,rgba(44,55,68,.14));--dot-blue:var(--dsw-alias-state-business-primary,#4176e6);color:var(--dot-ink);font-family:${dotFont};line-height:1.65}
        .pc_dot{height:100%;overflow:auto;background:var(--dot-paper);font-size:14px}.pc_dot *,.pc_dot_modal *{box-sizing:border-box}.pc_dot [hidden]{display:none!important}.pc_dot_inner{max-width:1180px;margin:auto;padding:25px 32px 38px}.pc_dot h1,.pc_dot h2,.pc_dot h3,.pc_dot p{margin:0}.pc_dot h1{font:500 29px/1.4 'Songti SC','STSong',serif;letter-spacing:.2px}.pc_dot h2{font-size:20px;line-height:1.4;font-weight:600}.pc_dot h3,.pc_dot_drawer h3{font-size:15px;font-weight:600}.pc_dot_eyebrow{font-size:11px;letter-spacing:1.5px;color:var(--dot-muted);font-weight:600;margin-bottom:5px}.pc_dot_muted{font-size:13px;line-height:1.7;color:var(--dot-muted)}
        .pc_dot_header{display:flex;align-items:center;justify-content:space-between;gap:20px}.pc_dot_brand{display:flex;align-items:center;gap:12px}.pc_dot_brand_mark{display:grid;place-items:center;width:40px;height:40px;border:1px solid var(--dot-line);border-radius:50%;color:var(--dot-blue)}.pc_dot_brand h2{font-size:18px}.pc_dot_brand p{font-size:12px;color:var(--dot-muted)}.pc_dot_actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
        .pc_dot button,.pc_dot_drawer button{min-height:44px;border:1px solid var(--dot-line);border-radius:8px;padding:9px 13px;font:inherit;font-size:13px;line-height:1.5;background:transparent;color:inherit;cursor:pointer}.pc_dot button:hover,.pc_dot_drawer button:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(48,63,79,.06))}.pc_dot button:disabled,.pc_dot_drawer button:disabled{opacity:.5;cursor:default}.pc_dot button.pc_dot_primary,.pc_dot_drawer button.pc_dot_primary{background:var(--dot-blue);color:#fff;border-color:transparent}.pc_dot :is(button,input,select,textarea,summary,a):focus-visible,.pc_dot_drawer :is(button,input,select,textarea,summary,a):focus-visible{outline:2px solid var(--dot-blue);outline-offset:3px}.pc_dot summary,.pc_dot_drawer summary{cursor:pointer;min-height:44px;padding:10px 0}
        .pc_dot_tabs{display:flex;gap:27px;border-bottom:1px solid var(--dot-line);margin:20px 0 26px}.pc_dot_tabs button,.pc_dot_drawer_tabs button{border:0;border-radius:0;border-bottom:2px solid transparent;padding:10px 2px;font-size:14px}.pc_dot_tabs button.active,.pc_dot_drawer_tabs button.active{border-bottom-color:var(--dot-blue);color:var(--dot-blue)}
        .pc_dot_hero{margin:0 0 25px;max-width:820px}.pc_dot_hero>p{margin:7px 0 12px}.pc_dot_composer{border:1px solid var(--dot-line);border-radius:14px;background:var(--dot-card);padding:16px 18px;margin:15px 0 7px}.pc_dot textarea,.pc_dot_drawer textarea{width:100%;resize:vertical;background:var(--dot-card);color:inherit;border:1px solid var(--dot-line);border-radius:8px;padding:12px;font:inherit;min-height:120px}.pc_dot_composer textarea{border:0;padding:0;min-height:67px;background:transparent}.pc_dot_compose_bottom{display:flex;align-items:center;justify-content:space-between;gap:15px}.pc_dot select,.pc_dot input,.pc_dot_drawer select,.pc_dot_drawer input{font:inherit;color:inherit;background:var(--dot-card);border:1px solid var(--dot-line);border-radius:7px;padding:9px;min-height:44px;max-width:100%}.pc_dot_shortcuts{margin-top:11px}.pc_dot_shortcuts button{font-size:12px;border-color:transparent;padding-left:0;padding-right:14px}.pc_dot_keyboard{font-size:11px;color:var(--dot-muted)}
        .pc_dot_conversation{height:min(580px,65vh);min-height:360px;display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--dot-line);border-radius:14px;background:var(--dot-card)}.pc_dot_conversation>p{padding:16px}.dot_overlay_body .pc_dot_conversation{height:100%;min-height:0;border:0;border-radius:0}.pc_dot_home_grid{display:grid;grid-template-columns:minmax(0,1.65fr) minmax(260px,1fr);gap:34px;align-items:start}.pc_dot_section{border-top:1px solid var(--dot-line);padding-top:18px;margin-top:22px;min-width:0}.pc_dot_section>h3{margin:0 0 13px}.pc_dot_home_grid>.pc_dot_column>.pc_dot_section:first-child{margin-top:0}.pc_dot_result{background:var(--dot-card);border:1px solid var(--dot-line);border-radius:12px;padding:20px;margin-top:12px}.pc_dot_result h3{font-size:18px;margin:9px 0;overflow-wrap:anywhere}.pc_dot_result .pc_dot_actions{margin-top:15px}.pc_dot_result header{display:flex;gap:8px;justify-content:space-between;align-items:center}.pc_dot_badge{display:inline-block;font-size:11px;padding:3px 8px;border-radius:5px;background:var(--dsw-alias-interactive-bg-active,rgba(65,118,230,.09));color:var(--dot-ink)}.pc_dot_update,.pc_dot_source{padding:14px 0;border-bottom:1px solid var(--dot-line);overflow-wrap:anywhere;font-size:14px}.pc_dot_update:last-child,.pc_dot_source:last-child{border-bottom:0}.pc_dot_update h3{margin:6px 0}.pc_dot_update .pc_dot_actions,.pc_dot_source .pc_dot_actions{margin-top:10px}.pc_dot_source pre,.pc_dot pre,.pc_dot_drawer pre{font:inherit;font-size:13px;white-space:pre-wrap;overflow-wrap:anywhere}.pc_dot_excerpt{white-space:pre-wrap;font-size:14px}.pc_dot_row{display:flex;justify-content:space-between;gap:16px;padding:13px 0;border-bottom:1px solid var(--dot-line);font-size:13px;overflow-wrap:anywhere}.pc_dot_row:last-child{border-bottom:0}.pc_dot_row small{display:block}.pc_dot_project_mini{display:block;width:100%;text-align:left;border-width:0 0 1px!important;border-radius:0!important;padding:13px 0!important}.pc_dot_project_mini small{display:block}.pc_dot_project_cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:15px;margin-top:20px}.pc_dot_project_card{border:1px solid var(--dot-line);border-radius:12px;padding:20px;background:var(--dot-card);min-width:0}.pc_dot_project_card p{margin:8px 0}.pc_dot_project_card .pc_dot_actions{margin-top:14px}.pc_dot_project_card h2{overflow-wrap:anywhere}.pc_dot_memory_scope{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:18px 0}.pc_dot_memory_scope select{min-width:210px}.pc_dot_empty{padding:14px 0;color:var(--dot-muted);font-size:14px}.pc_dot_notice{padding:12px 14px;margin-bottom:16px!important;border-left:3px solid var(--dot-blue);background:var(--dot-card);font-size:13px;color:var(--dot-muted)}.pc_dot_error{color:var(--dsw-alias-state-error-primary,#b91c1c);font-size:13px;padding:12px 0}.pc_dot_footer{margin-top:30px;padding-top:18px;border-top:1px solid var(--dot-line);font-size:12px;color:var(--dot-muted)}
        .pc_dot_welcome{max-width:760px;padding:16px 0 8px}.pc_dot_welcome h1{font-size:34px}.pc_dot_steps{display:flex;gap:20px;margin-top:28px}.pc_dot_steps>div{flex:1;border-top:1px solid var(--dot-line);padding-top:12px}.pc_dot_steps strong,.pc_dot_steps small{display:block;font-size:13px}.pc_dot_steps small{margin-top:5px;color:var(--dot-muted)}.pc_dot_modal{width:min(680px,100%);max-height:92vh;overflow:auto;padding:24px;background:var(--dot-paper)}.pc_dot_drawer{line-height:1.75}.pc_dot_drawer_tabs{display:flex;gap:22px;border-bottom:1px solid var(--dot-line);margin-bottom:20px}.pc_dot_drawer label{display:flex;flex-direction:column;gap:7px;margin:14px 0}.pc_dot_drawer .pc_dot_section{margin-top:20px}.pc_dot_drawer h3{margin:0 0 8px}.pc_dot_drawer p{margin:7px 0}.pc_dot_draft_review{border:1px solid var(--dot-line);border-radius:10px;padding:16px;margin-top:15px}.pc_dot .pc_connections{padding:20px 0 0}.pc_dot .pc_setup{font:inherit}.pc_setup :is(button,input,select),.pc_setup summary{min-height:44px}.pc_setup .pc_muted{font-size:13px}.pc_setup .pc_connect_badge{font-size:12px}.pc_setup .pc_first_value{margin-top:12px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l3,#ddd)}.pc_setup .pc_connection_steps{display:flex;gap:9px;flex-wrap:wrap}.pc_setup .pc_connection_steps span{border:1px solid var(--dsw-alias-border-l3,#ddd);border-radius:6px;padding:5px 9px;font-size:12px}
        @media(max-width:900px){.pc_dot_inner{padding:22px}.pc_dot_home_grid{gap:24px;grid-template-columns:minmax(0,1.4fr) minmax(240px,1fr)}.pc_dot_header>.pc_dot_actions>span{display:none}.pc_dot_brand p{max-width:180px}}
        @media(max-width:700px){.pc_dot_inner{padding:18px 16px 28px}.pc_dot_home_grid,.pc_dot_project_cards{grid-template-columns:1fr;gap:16px}.pc_dot_header{gap:12px;flex-wrap:wrap}.pc_dot_header .pc_dot_actions{gap:6px}.pc_dot_tabs{gap:24px;margin:16px 0 22px}.pc_dot h1{font-size:26px}.pc_dot_welcome h1{font-size:30px}.pc_dot_compose_bottom{gap:8px;flex-wrap:wrap}.pc_dot_compose_bottom select{min-width:0;max-width:100%;flex:1}.pc_dot_keyboard{display:none}.pc_dot_steps{gap:12px}.pc_dot_steps strong{font-size:12px}.pc_dot_modal{padding:18px}.pc_dot_row{flex-wrap:wrap}.pc_dot_result{padding:16px}.pc_dot_memory_scope{align-items:stretch;flex-direction:column}.pc_dot_drawer_tabs{gap:18px}}
        @media(prefers-reduced-motion:reduce){.pc_dot *,.pc_dot_modal *{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
        /* Approved paper/ink/blue workstation. The native writing surface is white. */
        .pc_dot,.pc_dot_modal{--dot-paper:#f6f5f0;--dot-card:#fffefa;--dot-white:#fff;--dot-ink:#23313c;--dot-muted:#5b6973;--dot-line:#cbd2ce;--dot-blue:#345ec7;font-family:${dotFont};font-size:14px;line-height:1.6}
        .pc_dot_inner{max-width:1192px;padding:24px 28px 32px}.pc_dot h1{font:400 24px/1.35 ${dotFont};letter-spacing:0}.pc_dot h2{font-size:18px;font-weight:600}.pc_dot h3{font-size:16px;line-height:1.45}.pc_dot p{max-width:75ch}.pc_dot_muted{font-size:12px;line-height:1.75}.pc_dot_brand_mark{border-radius:14px;width:43px;height:43px;background:var(--dot-card)}.pc_dot_brand h2{font-size:20px}.pc_dot_brand p{margin-top:4px}.pc_dot_header>.pc_dot_actions{font-size:12px;gap:12px}
        .pc_dot button,.pc_dot_drawer button{border-radius:7px;min-height:44px;font-size:13px}.pc_dot_tabs{width:max-content;max-width:100%;gap:4px;padding:4px;margin:20px 0 24px;background:#eeefea;border:1px solid var(--dot-line);border-radius:10px}.pc_dot_tabs button{min-width:76px;padding:7px 16px;border:0;border-radius:7px;font-size:14px}.pc_dot_tabs button.active{color:var(--dot-blue);background:var(--dot-white);box-shadow:0 1px 3px #23313c10}.pc_dot_home_grid{grid-template-columns:minmax(0,1fr) 268px;gap:32px}.pc_dot_column{min-width:0}.pc_dot_hero{max-width:none;margin:0 0 20px}.pc_dot_hero>p{margin:8px 0 12px}.pc_dot_composer,.pc_dot_conversation{background:var(--dot-white);border:1px solid #7e8e98;border-radius:8px;box-shadow:0 2px 10px #23313c08;color:#23313c;--dsw-alias-bg-base:#fff;--dsw-alias-bg-layer-1:#fff;--dsw-alias-bg-layer-2:#fff;--dsw-alias-bg-layer-3:#fff;--dsw-alias-label-primary:#23313c;--dsw-alias-label-secondary:#5b6973;--dsw-alias-state-business-primary:#345ec7}.pc_dot_composer{padding:16px;margin:14px 0 8px}.pc_dot_composer textarea{background:#fff;color:#23313c;min-height:68px;resize:vertical}.pc_dot_composer textarea::placeholder{color:#5b6973}.pc_dot_composer select{background:#fff;border-color:#cbd2ce;min-width:140px}.pc_dot_conversation{height:auto;min-height:180px;max-height:480px;margin-top:14px;overflow:auto}.pc_dot_conversation>div{min-height:0}.pc_dot_shortcuts{gap:8px}.pc_dot_shortcuts button{padding:6px 10px;border:1px solid var(--dot-line);background:var(--dot-card);font-size:12px;min-height:44px}.pc_dot_compose_bottom{gap:8px}.pc_dot_keyboard{font-size:11px}.pc_dot_section{padding-top:18px;margin-top:22px}.pc_dot_rail .pc_dot_section{margin:0 0 24px;padding:0 0 24px;border-top:0;border-bottom:1px solid var(--dot-line)}.pc_dot_rail h3{font-size:14px;margin-bottom:16px}
        .pc_dot_inline_wechat{display:grid;grid-template-columns:minmax(0,1fr) 188px;border:1px solid var(--dot-line);border-radius:8px;overflow:hidden;background:var(--dot-card);margin-bottom:22px}.pc_dot_pair_copy{padding:22px}.pc_dot_pair_copy h2{font-size:24px;font-weight:400;line-height:1.35}.pc_dot_pair_copy>p{font-size:14px;color:var(--dot-muted);margin-top:8px;line-height:1.75}.pc_dot_pair_copy>p.pc_dot_muted{font-size:12px}.pc_dot_text_button{border:0!important;padding-left:0!important;color:var(--dot-blue)!important;margin-top:8px}.pc_dot_inline_code{padding:16px 14px;background:#edf2fc;border-left:1px solid var(--dot-line);text-align:center;display:flex;flex-direction:column;align-items:center;gap:8px}.pc_dot_inline_code p{font-size:12px;line-height:1.5}.pc_dot_inline_code img{width:136px;height:136px;object-fit:contain;display:block;background:#fff;padding:4px;border-radius:6px}.pc_dot_inline_code button{font-size:12px;min-height:44px;background:#fff}.pc_dot_intro{font-size:14px;color:var(--dot-muted);padding:10px 0 20px}
        .pc_dot_attention_item{padding:18px 0;border-bottom:1px solid var(--dot-line);overflow-wrap:anywhere}.pc_dot_attention_item:first-of-type{border-top:1px solid var(--dot-line)}.pc_dot_item_kicker{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;color:var(--dot-muted);font-size:12px;margin-bottom:5px}.pc_dot_attention_item h3{font-size:16px;font-weight:600}.pc_dot_attention_item p{font-size:14px;color:var(--dot-muted);line-height:1.75;margin-top:6px}.pc_dot_attention_item p.pc_dot_item_next{color:var(--dot-ink)}.pc_dot_attention_item>.pc_dot_actions{margin-top:8px;justify-content:space-between;align-items:flex-start}.pc_dot_attention_item .pc_dot_actions>button{border:0;padding-left:0;color:var(--dot-blue);font-size:12px}.pc_dot_attention_item details{font-size:12px;color:var(--dot-muted);max-width:100%}.pc_dot_attention_item summary{padding:10px 0}.pc_dot_item_source{padding:8px 0;max-width:55ch}.pc_dot_item_source strong,.pc_dot_item_source span{display:block;font-size:12px}.pc_dot_item_source span{color:var(--dot-muted)}
        .pc_dot_schedule_item{position:relative;padding:0 0 18px 14px;margin:0 0 0 3px;border-left:1px solid var(--dot-line);overflow-wrap:anywhere}.pc_dot_schedule_item:before{content:'';position:absolute;left:-3px;top:7px;width:5px;height:5px;border-radius:50%;background:#7e8e98}.pc_dot_schedule_item strong{display:block;font-size:14px;font-weight:550}.pc_dot_schedule_item p{font-size:12px;color:var(--dot-muted);margin-top:3px;line-height:1.65}.pc_dot_plan_status{font-size:11px;color:var(--dot-muted)}.pc_dot_rail_note{font-size:12px;color:var(--dot-muted);line-height:1.75;margin-top:8px!important}.pc_dot_recovery{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;border:1px solid var(--dot-line);border-radius:8px;background:#f4ebdc;padding:12px 16px;margin-bottom:18px!important;color:var(--dot-ink)}.pc_dot_recovery strong{font-weight:600}.pc_dot_recovery p{font-size:12px;margin-top:4px}.pc_dot_recovery>button{flex-shrink:0;background:var(--dot-card)}.pc_dot_recovery details{font-size:12px;color:var(--dot-muted)}.pc_dot_recovery summary{padding:6px 0;min-height:44px}.pc_dot_history,.pc_dot_legacy_details,.pc_dot_review_details{border-top:1px solid var(--dot-line);margin-top:20px;font-size:12px;color:var(--dot-muted)}.pc_dot_history>summary,.pc_dot_legacy_details>summary,.pc_dot_review_details>summary{min-height:44px}.pc_dot_history .pc_dot_update{padding:14px 0}.pc_dot_history h3{font-size:14px}.pc_dot_footer{font-size:11px;margin-top:24px}.pc_dot_project_cards{display:block}.pc_dot_project_card{border-width:0 0 1px;border-radius:0;padding:18px 0;background:transparent}.pc_dot_project_card:first-child{border-top:1px solid var(--dot-line)}.pc_dot_project_card h2{font-size:17px}.pc_dot_project_card .pc_dot_eyebrow{display:none}
        .pc_dot_conversation .dot_compact_history{padding:16px;font-size:14px;line-height:1.75;color:#23313c;background:#fff}.pc_dot_conversation .dot_compact_history_heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px;font-size:12px;color:#5b6973}.pc_dot_conversation .dot_compact_history_heading button{border:0;min-height:44px;color:#345ec7;padding:6px 0}.pc_dot_conversation .dot_compact_history_role{display:block;font-size:11px;color:#5b6973;margin-bottom:4px}.pc_dot_conversation .dot_compact_history_user{padding-bottom:14px;border-bottom:1px solid #cbd2ce}.pc_dot_conversation .dot_compact_history_assistant{padding-top:14px}.pc_dot_conversation .dot_compact_history_truncated{font-size:12px;color:#5b6973;margin-top:12px}.pc_dot_conversation .dot_compact_history_actions{padding:0 16px}.pc_dot_conversation .dot_compact_history_actions button{border:0;min-height:44px;color:#345ec7;background:#fff}
        @media(max-width:1000px){.pc_dot_home_grid{grid-template-columns:minmax(0,1fr) 236px;gap:24px}.pc_dot_inner{padding:22px}.pc_dot_inline_wechat{grid-template-columns:minmax(0,1fr) 164px}.pc_dot_pair_copy{padding:18px}.pc_dot_inline_code{padding:14px 10px}.pc_dot_inline_code img{width:128px;height:128px}}
        @media(max-width:760px){.pc_dot_inner{padding:18px 16px 28px}.pc_dot_home_grid{grid-template-columns:1fr;gap:24px}.pc_dot_rail{border-top:1px solid var(--dot-line);padding-top:22px}.pc_dot_tabs{margin:16px 0 20px;gap:2px;width:100%}.pc_dot_tabs button{flex:1;min-width:0;padding:7px 9px}.pc_dot h1{font-size:22px}.pc_dot_header>.pc_dot_actions{gap:6px}.pc_dot_header>.pc_dot_actions>span{display:none}.pc_dot_brand p{max-width:none}.pc_dot_hero{margin-bottom:16px}.pc_dot_recovery{gap:8px;flex-wrap:wrap}.pc_dot_composer{padding:14px}.pc_dot_compose_bottom select{max-width:180px}.pc_dot_inline_wechat{grid-template-columns:minmax(0,1fr) 150px}.pc_dot_pair_copy{padding:16px}.pc_dot_pair_copy h2{font-size:21px}.pc_dot_pair_copy>p{font-size:13px}.pc_dot_inline_code{padding:14px 8px}.pc_dot_inline_code img{width:116px;height:116px}.pc_dot_pair_copy>p.pc_dot_muted{font-size:11px}.pc_dot_conversation{max-height:420px}}
        @media(max-width:400px){.pc_dot_brand p{font-size:11px}.pc_dot_header{gap:8px}.pc_dot_header>.pc_dot_actions button{font-size:12px;padding:7px 9px}.pc_dot_inline_wechat{grid-template-columns:minmax(0,1fr) 140px}.pc_dot_pair_copy{padding:14px 12px}.pc_dot_inline_code img{width:112px;height:112px}.pc_dot_composer select{max-width:148px;min-width:0}.pc_dot_shortcuts{gap:5px}.pc_dot_shortcuts button{padding:6px 8px;font-size:11px}}
        .pc_dot_inline_code{padding-top:12px;padding-bottom:12px}.pc_dot_inline_code img{width:128px;height:128px}.pc_dot_brand,.pc_dot_header>.pc_dot_actions{min-width:0}.pc_dot_column,.pc_dot_rail,.pc_dot_history,.pc_dot_legacy_details{overflow-wrap:anywhere}
        @media(max-width:400px){.pc_dot_inline_code img{width:112px;height:112px}}
        @media(max-width:340px){.pc_dot_inline_wechat{grid-template-columns:1fr}.pc_dot_inline_code{border-left:0;border-top:1px solid var(--dot-line)}.pc_dot_inline_code img{width:128px;height:128px}.pc_dot_tabs button{padding:7px 5px;font-size:12px}.pc_dot_header{align-items:flex-start}.pc_dot_header>.pc_dot_actions{flex-wrap:wrap}.pc_dot_brand p{max-width:130px}.pc_dot_compose_bottom{align-items:stretch}.pc_dot_compose_bottom select{max-width:100%;width:100%}.pc_dot_compose_bottom>.pc_dot_primary{width:100%}}
        /* Keep the approved full-width navigation rule and display hierarchy. */
        .pc_dot h1{font:500 29px/1.4 'Songti SC','STSong',serif;letter-spacing:.2px}.pc_dot_tabs{width:100%;max-width:none;gap:28px;padding:0;margin:20px 0 24px;background:transparent;border:0;border-bottom:1px solid var(--dot-line);border-radius:0}.pc_dot_tabs button{position:relative;min-width:0;padding:10px 2px;border:0;border-bottom:2px solid transparent;border-radius:0;background:transparent;color:var(--dot-muted);font-size:14px;font-weight:400;box-shadow:none}.pc_dot_tabs button.active{border-bottom-color:var(--dot-blue);color:var(--dot-blue);background:transparent;box-shadow:none}.pc_dot_tabs button:hover{background:transparent;color:var(--dot-blue)}.pc_dot_composer,.pc_dot_conversation{border-radius:6px;box-shadow:none}.pc_dot_inline_wechat{border-radius:8px}.pc_dot_inline_code{border-radius:0}.pc_dot_pair_copy h2{font-size:20px;font-weight:600;line-height:1.4}
        .pc_dot_retained_draft{padding:12px 14px;margin:12px 0;border:1px solid #cbd2ce;border-radius:6px;background:#edf2fc;color:#23313c;font-size:12px;line-height:1.6}.pc_dot_retained_draft strong{font-weight:600}.pc_dot_retained_draft p{font-size:12px;color:#5b6973;margin-top:4px}.pc_dot_retained_draft pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere;max-height:160px;overflow:auto;margin:6px 0}.pc_dot_retained_draft .pc_dot_actions{gap:8px}.pc_dot_retained_draft button{min-height:44px;font-size:12px;background:#fff;border:1px solid #cbd2ce;color:#345ec7}.pc_dot_retained_draft summary{min-height:44px;padding:10px 0}
        @media(max-width:760px){.pc_dot h1{font-size:26px}.pc_dot_tabs{gap:24px;margin:16px 0 20px}.pc_dot_tabs button{flex:none;padding:10px 2px;min-width:44px}.pc_dot_pair_copy h2{font-size:20px}}
        @media(max-width:340px){.pc_dot_tabs{gap:16px}.pc_dot_tabs button{font-size:13px}.pc_dot h1{font-size:24px}}
      `;
      const personalCss='';
      function DotIcon({size=20}={}){
        return h('svg',{width:size,height:size,viewBox:'0 0 24 24',fill:'none','aria-hidden':true},h('circle',{cx:12,cy:12,r:7.25,stroke:'currentColor',strokeWidth:1.5}),h('circle',{cx:12,cy:12,r:2.75,fill:'currentColor'}),h('path',{d:'M18 6l2-2',stroke:'currentColor',strokeWidth:1.5,strokeLinecap:'round'}));
      }
      // Keep drafts only for this plugin lifetime. No private text is stored in
      // browser storage, and a different owner/binding never inherits the cache.
      const workbenchCache={binding:null,draft:'',selected:'',localConversation:null,memory:new Map(),follow:new Map()};
      const needsInlineWechatSetup=connection=>connection?.readOnly!==true&&['missing','waiting-qr','scanned','awaiting-message'].includes(connection?.state);
      let workbenchSurface={page:null,ready:false,target:null,focus:null,suspended:false,navigationPhase:null};
      let nativeNavigation={phase:null,sawAway:false};
      const surfaceListeners=new Set();
      const publishWorkbenchSurface=value=>{workbenchSurface={...workbenchSurface,...value};surfaceListeners.forEach(fn=>fn());};
      const resumeDotSurface=()=>{nativeNavigation={phase:null,sawAway:false};publishWorkbenchSurface({suspended:false,navigationPhase:null});};
      const waitForDesktopRelease=signal=>new Promise((resolve,reject)=>{let unsubscribe=()=>{},done=false;const finish=error=>{if(done)return;done=true;unsubscribe();signal?.removeEventListener?.('abort',abort);error?reject(error):resolve();},abort=()=>finish(Error('native navigation cancelled')),check=()=>{const value=desktopController.getSnapshot();if(value.closed)finish(Error('native controller closed'));else if(value.owner===null)finish();};unsubscribe=desktopController.subscribe(check);signal?.addEventListener?.('abort',abort,{once:true});if(signal?.aborted)abort();else check();});
      const cachedDraftScope=value=>value?.connection?.state==='bound'?`${value.connection.sessionId}:${typeof value.bindingRevision==='string'?value.bindingRevision:'legacy'}`:null;
      async function prepareCachedDesktopDraft(target,signal){
        const captured={text:workbenchCache.draft,selected:workbenchCache.selected,binding:workbenchCache.binding};
        if(!captured.text.trim())return{status:'empty'};
        const unchanged=()=>workbenchCache.draft===captured.text&&workbenchCache.selected===captured.selected&&workbenchCache.binding===captured.binding&&workbenchCache.localConversation?.sessionId===target.sessionId;
        const check=async()=>{signal?.throwIfAborted?.();const response=await fetch(workbenchEndpoint,{method:'GET',credentials:'same-origin',redirect:'error',cache:'no-store',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)});const value=await response.json();signal?.throwIfAborted?.();
          if(!response.ok||value?.version!==1||!Array.isArray(value.projects)||value.projects.length>5||cachedDraftScope(value)!==captured.binding||!unchanged())throw Error('原草稿范围已变化或尚未确认，已保留原文，请核对后再继续。');
          const project=captured.selected?value.projects.find(p=>p?.id===captured.selected&&typeof p.label==='string'&&p.label.length<=80):null;
          if(captured.selected&&!project)throw Error('原草稿的项目范围尚未确认，已保留原文，请重新核对。');return project;
        };
        const project=await check(),prompt=project?`关于项目「${project.label}」：\n${captured.text}`:captured.text;
        // Establish the lifetime binding before the temporary draft operation
        // releases its reference, including first use before an editor exists.
        let temporaryOwner=null;
        try{const state=desktopController.getSnapshot();if(state.owner===null){temporaryOwner=Symbol('local-draft-handoff');await desktopController.acquire(temporaryOwner,target);}else if(state.sessionId!==target.sessionId)throw Error('原生对话正在切换，电脑草稿仍已保留。');
          return await prepareDotDraft(ctx,target.sessionId,prompt,signal,check,()=>{if(!unchanged())return;workbenchCache.draft='';publishWorkbenchSurface({});return()=>{if(workbenchCache.draft===''&&workbenchCache.selected===captured.selected&&workbenchCache.binding===captured.binding){workbenchCache.draft=captured.text;publishWorkbenchSurface({});}};},true);
        }finally{if(temporaryOwner)desktopController.release(temporaryOwner);}
      }
      const copyCachedDraft=async notify=>{const value=workbenchCache.draft;if(!value)return;try{if(typeof navigator==='undefined'||typeof navigator.clipboard?.writeText!=='function')throw Error('clipboard unavailable');await navigator.clipboard.writeText(value);notify('草稿已复制，原文仍保留在这里。');}catch{notify('请展开保留草稿，选择原文复制；草稿仍完整保留。');}};
      const retainedDraftView=(target,{busy=false,onApply,onCopy}={})=>workbenchCache.draft.trim()?h('aside',{className:'pc_dot_retained_draft','data-dot-retained-local-draft':true},h('strong',null,'电脑上还有一份保留草稿'),h('p',null,'原生会话已有草稿或原范围尚未确认时，不会覆盖。'),h('details',null,h('summary',null,'查看完整保留草稿'),h('pre',null,workbenchCache.draft)),h('div',{className:'pc_dot_actions'},h('button',{type:'button',disabled:busy||!target,onClick:onApply},'放入当前对话草稿'),h('button',{type:'button',disabled:busy,onClick:onCopy},'复制保留草稿'))):null;
      function useWorkbenchSurface(props={}){
        const [surface,setSurface]=React.useState(workbenchSurface);
        const activePanelId=typeof props.usePanelInfo==='function'?props.usePanelInfo(info=>info.activePanelId):undefined;
        React.useEffect(()=>{const update=()=>setSurface(workbenchSurface);surfaceListeners.add(update);update();return()=>surfaceListeners.delete(update);},[]);
        React.useEffect(()=>{if(nativeNavigation.phase!=='native')return;if(activePanelId===null||typeof activePanelId==='string'&&activePanelId!==dotPanel){nativeNavigation.sawAway=true;publishWorkbenchSurface({suspended:false});}else if(activePanelId===dotPanel&&nativeNavigation.sawAway)resumeDotSurface();},[activePanelId,surface.navigationPhase]);
        return{homeActive:activePanelId===dotPanel&&surface.page==='home',homeReady:surface.ready,focus:surface.focus,suspended:surface.suspended};
      }
      function OverlayDesktopConversation(props={}){
        const [target,setTarget]=React.useState(null),[candidate,setCandidate]=React.useState(null),[loaded,setLoaded]=React.useState(false),[problem,setProblem]=React.useState(''),[creating,setCreating]=React.useState(false);
        const live=React.useRef(false),creatingRef=React.useRef(false),draftOperation=React.useRef(null),requestedWorkbench=React.useRef(false);
        const activePanelId=typeof props.usePanelInfo==='function'?props.usePanelInfo(info=>info.activePanelId):undefined;
        const mainSessionId=typeof props.useSessions==='function'?props.useSessions(state=>{if(state.phase!=='ready'||Object.prototype.toString.call(state.byId)!=='[object Object]'||!Array.isArray(state.ids)||!state.ids.every(id=>state.byId?.[id]?.id===id))return null;const rows=state.ids.map(id=>state.byId[id]).filter(row=>(row.retainedBy?.mainView??0)>0);return rows.length===1?rows[0].id:null;}):null;
        const mainViewEmpty=typeof props.useSessions==='function'?props.useSessions(state=>state.phase==='ready'&&Object.prototype.toString.call(state.byId)==='[object Object]'&&Array.isArray(state.ids)&&state.ids.every(id=>state.byId?.[id]?.id===id)&&Object.values(state.byId??{}).every(row=>(row.retainedBy?.mainView??0)===0)):false;
        React.useEffect(()=>{live.current=true;const abort=new AbortController();void(async()=>{
          try{if(workbenchCache.localConversation){const cached=await desktopController.resolve(workbenchCache.localConversation);if(!cached)throw Error('cached desktop unavailable');if(live.current)setTarget(cached);return;}
            const saved=await desktopController.restore();if(saved){if(live.current){setTarget(saved);workbenchCache.localConversation=saved;}return;}
            const previous=await desktopController.candidate();if(live.current)setCandidate(previous);
          }catch{if(live.current)setProblem('已有桌面对话暂不可用；可以打开工作台核对。');}finally{if(live.current)setLoaded(true);}
        })();return()=>{live.current=false;abort.abort();draftOperation.current?.abort();};},[]);
        const create=async()=>{if(creatingRef.current||typeof ctx.sessions?.create!=='function')return;creatingRef.current=true;setCreating(true);setProblem('');
          try{const id=await ctx.sessions.create({});if(typeof id!=='string'||!id||id.startsWith('family_'))throw Error('native session unavailable');const created={sessionId:id,revision:`native:${id}`};workbenchCache.localConversation=created;const remembered=await desktopController.remember(id);if(live.current){const operation=new AbortController();draftOperation.current=operation;try{const receipt=await prepareCachedDesktopDraft(created,operation.signal);if(live.current&&receipt.status==='preserved')setProblem('原生对话已有草稿，电脑原文完整保留，可在下方继续处理。');}catch(failure){if(live.current)setProblem('草稿未能带入：原对话或草稿范围暂未确认。原文仍完整保留，可复制后继续。');}finally{draftOperation.current=null;}if(live.current){setTarget(created);if(!remembered)setProblem('本次会话可继续；入口暂未保存，可从原生历史找回。');}}}
          catch{if(live.current)setProblem('会话暂未创建，请打开完整工作台重试。');}finally{creatingRef.current=false;if(live.current)setCreating(false);}
        };
        const continueCandidate=async()=>{if(creatingRef.current||!candidate)return;creatingRef.current=true;setCreating(true);try{const verified=await desktopController.resolve(candidate);if(!verified)throw Error('candidate unavailable');const remembered=await desktopController.remember(verified.sessionId);if(live.current){workbenchCache.localConversation=verified;setTarget(verified);setCandidate(null);if(!remembered)setProblem('本次对话可继续；入口暂未保存。');}}catch{if(live.current)setProblem('上次对话暂不可用，可新建对话或到原生历史核对。');}finally{creatingRef.current=false;if(live.current)setCreating(false);}};
        const recoverDraft=async()=>{if(creatingRef.current||!target)return;creatingRef.current=true;setCreating(true);const operation=new AbortController();draftOperation.current=operation;try{const receipt=await prepareCachedDesktopDraft(target,operation.signal);if(live.current)setProblem(receipt.status==='applied'?'电脑草稿已放入当前原生会话，由你发送。':'原生对话已有草稿，电脑原文继续完整保留。');}catch(failure){if(live.current)setProblem('草稿未能带入：原对话或草稿范围暂未确认。原文仍完整保留，可复制后继续。');}finally{draftOperation.current=null;creatingRef.current=false;if(live.current)setCreating(false);}};
        const sameNativeMain=loaded&&Boolean(target)&&activePanelId===null&&mainSessionId===target.sessionId;
        React.useEffect(()=>{if(!sameNativeMain||requestedWorkbench.current||typeof props.onOpenWorkbench!=='function')return;requestedWorkbench.current=true;props.onOpenWorkbench();},[sameNativeMain,target?.sessionId,target?.revision]);
        if(!loaded)return h('div',{className:'dot_overlay_fallback',role:'status'},'正在打开桌面对话…');
        if(target){
          if(sameNativeMain&&typeof props.onOpenWorkbench==='function')return h('div',{className:'dot_overlay_fallback',role:'status'},'正在回到同一个 Dot 对话，原草稿会保留。');
          if(!desktopConversationCanEmbed({activePanelId,mainSessionId,mainViewEmpty},target.sessionId)||typeof props.SessionProvider!=='function'||typeof props.renderSlot!=='function')return h('div',{className:'dot_overlay_fallback'},h('p',null,mainSessionId===target.sessionId?'这个对话已在当前页面打开，可直接继续。':'请打开完整工作台继续对话。'),retainedDraftView(null,{onCopy:()=>copyCachedDraft(setProblem)}),h('button',{type:'button',onClick:props.onOpenWorkbench},'打开完整工作台'));
          return h('div',{className:'pc_dot_overlay_conversation'},problem?h('p',{className:'pc_dot_overlay_status',role:'status'},problem):null,retainedDraftView(target,{busy:creating,onApply:recoverDraft,onCopy:()=>copyCachedDraft(setProblem)}),h(DesktopConversation,{target,owner:'overlay',SessionProvider:props.SessionProvider,renderSlot:props.renderSlot,slotName:'dot.overlay.conversation',onOpenHistory:props.onOpenWorkbench}));
        }
        return h('div',{className:'dot_overlay_fallback'},h('p',null,problem||'从一句话开始，桌面对话无需连接微信。'),h('button',{type:'button',disabled:creating||typeof ctx.sessions?.create!=='function',onClick:create},creating?'正在打开…':'开始桌面对话'),candidate?h('button',{type:'button',disabled:creating,onClick:continueCandidate},'继续上次对话'):null);
      }
      function Workbench(props={}){
        const sessions=typeof props.useSessions==='function'?props.useSessions(s=>s.byId):null;
        const appearanceState=useAppearance();
        const [snapshot,setSnapshot]=React.useState(null),[selected,setSelectedState]=React.useState(workbenchCache.selected),[busy,setBusy]=React.useState(false),[error,setError]=React.useState(''),[notice,setNotice]=React.useState('');
        const [localConversation,setLocalConversation]=React.useState(workbenchCache.localConversation),[conversationCandidate,setConversationCandidate]=React.useState(null);
        const [inlineConnection,setInlineConnection]=React.useState(null),[inlineConnectionError,setInlineConnectionError]=React.useState(''),[qrFailed,setQrFailed]=React.useState(false),[nativeHomeReady,setNativeHomeReady]=React.useState(false),[nativeSuspended,setNativeSuspended]=React.useState(workbenchSurface.suspended||nativeNavigation.phase==='native');
        const activePanelId=typeof props.usePanelInfo==='function'?props.usePanelInfo(info=>info.activePanelId):undefined;
        const lastPanel=React.useRef(undefined);
        React.useEffect(()=>{const update=()=>setNativeSuspended(workbenchSurface.suspended||nativeNavigation.phase==='native');surfaceListeners.add(update);update();return()=>surfaceListeners.delete(update);},[]);
        React.useEffect(()=>{if(activePanelId===dotPanel&&lastPanel.current!==dotPanel&&nativeNavigation.phase==='native')resumeDotSurface();lastPanel.current=activePanelId;},[activePanelId]);
        const inlineFlight=React.useRef(false),composerStart=React.useRef(null);
        const [page,setPage]=React.useState('home'),[drawer,setDrawer]=React.useState(null),[tab,setTab]=React.useState('summary'),[setup,setSetup]=React.useState(false),[draft,setDraftState]=React.useState(workbenchCache.draft);
        const [detailProjectId,setDetailProjectId]=React.useState(null),[memoryProjectId,setMemoryProjectId]=React.useState(''),[connectionsSeen,setConnectionsSeen]=React.useState(false),[closeReview,setCloseReview]=React.useState(false);
        const [followView,setFollowView]=React.useState(null),[followMode,setFollowMode]=React.useState('once'),[followTime,setFollowTime]=React.useState(''),[cadence,setCadence]=React.useState(60),[reviewFollow,setReviewFollow]=React.useState(false);
        const [taskView,setTaskView]=React.useState(null),[editing,setEditing]=React.useState(null),[memoryText,setMemoryText]=React.useState(''),[forgetReview,setForgetReview]=React.useState(false),[staleMemoryDraft,setStaleMemoryDraft]=React.useState(null);
        const [catalog,setCatalog]=React.useState(null),[catalogQuery,setCatalogQuery]=React.useState(''),[catalogError,setCatalogError]=React.useState(''),[catalogBusy,setCatalogBusy]=React.useState(false),[catalogPreview,setCatalogPreview]=React.useState(null);
        const catalogFlight=React.useRef(false),catalogEpoch=React.useRef(0);
        const active=React.useRef(false),flight=React.useRef(false),controllers=React.useRef(new Set()),viewEpoch=React.useRef(0),currentSnapshot=React.useRef(null),scopeRef=React.useRef(null),pendingExit=React.useRef(null),followBaseline=React.useRef(''),submitted=React.useRef(false),returnFocus=React.useRef(null);
        const setDraft=value=>{workbenchCache.draft=value;setDraftState(value);};
        const setSelected=value=>{workbenchCache.selected=value;setSelectedState(value);};
        const validId=value=>typeof value==='string'&&value.length>0&&value.length<=200;
        const revisionOf=value=>typeof value?.bindingRevision==='string'?value.bindingRevision:null;
        const bindingOf=value=>value?.connection?.state==='bound'?`${value.connection.sessionId}:${revisionOf(value)??'legacy'}`:null;
        const scopeKey=scope=>`${scope?.binding??'unbound'}:${scope?.projectId??''}:${scope?.id??''}`;
        const scoped=(projectId,id)=>({binding:bindingOf(currentSnapshot.current),revision:revisionOf(currentSnapshot.current),projectId,id,projectLabel:currentSnapshot.current?.projects.find(p=>p.id===projectId)?.label});
        const stillCurrent=scope=>active.current&&scope?.binding===bindingOf(currentSnapshot.current);
        const captureFocus=()=>{if(typeof document!=='undefined')returnFocus.current=document.activeElement;};
        const restoreFocus=()=>{const element=returnFocus.current;if(element?.isConnected)element.focus?.();};
        const date=value=>{try{if(!value||!Number.isFinite(Date.parse(value)))return'时间未知';return new Intl.DateTimeFormat('zh-CN',{timeZone:snapshot?.hostTimeZone,dateStyle:'short',timeStyle:'short',hourCycle:'h23'}).format(new Date(value));}catch{return'时间未知';}};
        const followFrequency=plan=>plan?.dailyTime!==undefined?(/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(plan.dailyTime??'')?`每天${plan.dailyTime}（${typeof plan.timeZone==='string'&&plan.timeZone.length<=100&&plan.timeZone?plan.timeZone:'时区待核对'}）`:'每天固定时间（时间待核对）'):`每 ${plan?.everyMinutes} 分钟`;
        const request=async(url,body)=>{const controller=new AbortController();controllers.current.add(controller);try{const response=await fetch(url,{method:body?'POST':'GET',credentials:'same-origin',redirect:'error',cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)]),...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});const value=await response.json();if(!response.ok)throw Object.assign(new Error(value?.error||'操作未完成，请刷新核对；没有自动重试。'),{code:value?.code});return value;}finally{controllers.current.delete(controller);}};
        const clearCatalog=()=>{catalogEpoch.current++;catalogFlight.current=false;setCatalog(null);setCatalogPreview(null);setCatalogQuery('');setCatalogError('');setCatalogBusy(false);};
        const loadCatalog=async({query='',offset=0,expectedRevision}={})=>{
          if(!active.current||catalogFlight.current||!bindingOf(currentSnapshot.current))return;
          const binding=bindingOf(currentSnapshot.current),epoch=++catalogEpoch.current;catalogFlight.current=true;setCatalogBusy(true);setCatalogError('');setCatalogPreview(null);
          try{
            const value=await request(catalogEndpoint,{action:'list',query,offset,limit:20,...(expectedRevision?{expectedRevision}:{})});
            if(!active.current||epoch!==catalogEpoch.current||binding!==bindingOf(currentSnapshot.current))return;
            if(value?.version!==1||value.scope!=='registered'||value.complete!==true||!/^[a-f0-9]{64}$/.test(value.revision??'')||!Array.isArray(value.items)||value.items.length>20||![value.total,value.matchedTotal,value.offset].every(n=>Number.isSafeInteger(n)&&n>=0)||value.limit!==20||value.offset!==offset||value.matchedTotal>value.total||value.offset+value.items.length>value.matchedTotal||typeof value.hasMore!=='boolean'||value.nextOffset!==(value.hasMore?value.offset+value.items.length:null)||value.hasMore&&value.items.length===0||!value.items.every(p=>/^project_[a-f0-9]{24}$/.test(p?.id??'')&&typeof p.label==='string'&&p.label.length<=80&&typeof p.watched==='boolean'&&p.registered===true&&Number.isSafeInteger(p.sessionCount)&&p.sessionCount>=0&&(p.disambiguator===undefined||typeof p.disambiguator==='string'&&p.disambiguator.length<=60)))throw new Error('项目目录数据暂不可用。');
            setCatalog({...value,query});
          }catch(failure){if(active.current&&epoch===catalogEpoch.current&&binding===bindingOf(currentSnapshot.current)){setCatalog(null);setCatalogError(failure.code==='CATALOG_CHANGED'?'项目目录已变化，请刷新项目目录后继续。':'项目目录暂不可用，请刷新项目目录重试；未读取项目文件。');}}
          finally{if(epoch===catalogEpoch.current){catalogFlight.current=false;if(active.current)setCatalogBusy(false);}}
        };
        const previewCatalogProject=async item=>{
          if(!active.current||catalogFlight.current||!catalog||!bindingOf(currentSnapshot.current))return;
          const binding=bindingOf(currentSnapshot.current),revision=catalog.revision,epoch=++catalogEpoch.current;catalogFlight.current=true;setCatalogBusy(true);setCatalogPreview(null);setCatalogError('');
          try{
            const value=await request(catalogEndpoint,{action:'preview',projectId:item.id,expectedRevision:revision});
            if(!active.current||epoch!==catalogEpoch.current||binding!==bindingOf(currentSnapshot.current))return;
            if(value?.version!==1||value.project?.id!==item.id||value.revision!==revision||value.previewOnly!==true||value.historyScan!==false||!Array.isArray(value.sources)||value.sources.length>3||!value.sources.every(s=>['README.md','.agent/memory/context.md','.agent/memory/progress.md'].includes(s?.path)&&['ok','missing','rejected','unavailable'].includes(s.status)&&(s.status!=='ok'||typeof s.text==='string'&&s.text.length<=16384)))throw new Error('项目资料暂不可用。');
            setCatalogPreview({...value,project:{id:item.id,label:item.label}});
          }catch(failure){if(active.current&&epoch===catalogEpoch.current&&binding===bindingOf(currentSnapshot.current)){if(failure.code==='CATALOG_CHANGED')setCatalog(null);setCatalogError(failure.code==='CATALOG_CHANGED'?'项目目录已变化，请刷新项目目录后继续。':'这次项目资料未能读取，请核对后重试。没有加入关注或创建计划。');}}
          finally{if(epoch===catalogEpoch.current){catalogFlight.current=false;if(active.current)setCatalogBusy(false);}}
        };
        const refresh=async()=>{
          if(!active.current||flight.current)return;flight.current=true;setBusy(true);setError('');
          try{
            const value=await request(workbenchEndpoint);
            if(!value||value.version!==1||!value.availability||!['projects','plans','jobs'].every(k=>typeof value.availability[k]==='boolean')||!value.connection||!Array.isArray(value.projects)||value.projects.length>5||!Array.isArray(value.jobs)||value.jobs.length>10||!Array.isArray(value.reminders)||value.reminders.length>100||!value.projects.every(p=>validId(p?.id)&&typeof p.label==='string'&&Array.isArray(p.sessionIds)&&p.sessionIds.length<=30&&p.sessionIds.every(validId)&&Array.isArray(p.sources)&&p.sources.length<=3&&Array.isArray(p.events)&&p.events.length<=30)||value.connection.state==='bound'&&!validId(value.connection.sessionId))throw new Error('工作台数据暂不可用。');
            if(!active.current)return;
            const nextBinding=bindingOf(value);
            if(workbenchCache.binding!==null&&workbenchCache.binding!==nextBinding){
              clearCatalog();
              workbenchCache.memory.clear();workbenchCache.follow.clear();setDraft('');setSelected('');viewEpoch.current++;scopeRef.current=null;setDrawer(null);setCloseReview(false);setEditing(null);setStaleMemoryDraft(null);setFollowView(null);setNotice('微信会话或账号绑定已变化。旧范围的草稿已关闭，请重新核对项目和资料来源。');
            }
            workbenchCache.binding=nextBinding;currentSnapshot.current=value;setSnapshot(value);
            const restored=await desktopController.restore();if(active.current&&restored){workbenchCache.localConversation=restored;setLocalConversation(restored);}else if(active.current){const candidate=await desktopController.candidate();if(active.current)setConversationCandidate(candidate);}
            if(selected&& !value.projects.some(p=>p.id===selected)){setSelected('');setNotice('原草稿关联的项目已不在关注列表，请重新选择后继续。');}
            setMemoryProjectId(current=>value.projects.some(p=>p.id===current)?current:value.projects[0]?.id??'');
          }catch{if(active.current){clearCatalog();currentSnapshot.current=null;setSnapshot(null);setError('项目总览暂不可用。请确认 Harness 连接后，点击刷新重试。');}}
          finally{flight.current=false;if(active.current)setBusy(false);}
        };
        React.useEffect(()=>{active.current=true;void refresh();return()=>{active.current=false;viewEpoch.current++;for(const c of controllers.current)c.abort();controllers.current.clear();};},[]);
        // This is a passive view of the bridge's existing pairing state. Unknown
        // or Family bindings never enter the legacy pairing path.
        const readInlineConnection=async()=>{
          if(!active.current||inlineFlight.current||!needsInlineWechatSetup(currentSnapshot.current?.connection))return;
          inlineFlight.current=true;
          try{const value=await request(endpoint);if(!active.current||!needsInlineWechatSetup(currentSnapshot.current?.connection))return;
            if(value?.version!==1||!['missing','unknown','waiting-qr','scanned','awaiting-message','bound','failed'].includes(value.connection?.state))throw Error('connection unavailable');
            setInlineConnection(value.connection);setInlineConnectionError('');setQrFailed(false);
          }catch{if(active.current)setInlineConnectionError('微信连接状态暂未确认；电脑对话可以继续。');}
          finally{inlineFlight.current=false;}
        };
        React.useEffect(()=>{if(needsInlineWechatSetup(snapshot?.connection))void readInlineConnection();else{setInlineConnection(null);setInlineConnectionError('');}},[snapshot?.connection?.state,snapshot?.connection?.readOnly]);
        React.useEffect(()=>{if(!['waiting-qr','scanned','awaiting-message'].includes(inlineConnection?.state))return;const timer=setInterval(()=>void readInlineConnection(),5000);return()=>clearInterval(timer);},[inlineConnection?.state]);
        React.useEffect(()=>{if(page==='projects'&&bindingOf(snapshot)&&!catalog&&!catalogError)void loadCatalog();},[page,bindingOf(snapshot)]);
        const action=async(body,scope=scoped(body.projectId,body.id),epoch=viewEpoch.current)=>{
          if(!active.current||flight.current)return null;
          if(!stillCurrent(scope)){setError('原微信绑定已变化，请刷新并重新打开这项内容；未提交操作。');return null;}
          flight.current=true;setBusy(true);setError('');
          try{const result=await request(workbenchEndpoint+'/actions',{...body,...(scope.revision?{expectedBindingRevision:scope.revision}:{})});return stillCurrent(scope)?result:null;}
          catch(failure){if(stillCurrent(scope)&&viewEpoch.current===epoch)setError(`${failure.message||'操作结果待核对。'} 未自动重试；可先查询当前状态。`);return null;}
          finally{flight.current=false;if(active.current)setBusy(false);}
        };
        const navigate=async(id,skipGuard=false)=>{if(!active.current||!validId(id)||flight.current)return;if(dirty&&!submitted.current&&!skipGuard){leaveDrawer(()=>{void navigate(id,true);});return;}
          const operation=new AbortController();controllers.current.add(operation);flight.current=true;setBusy(true);setError('');let opened=false;
          nativeNavigation={phase:'opening',sawAway:false};publishWorkbenchSurface({suspended:true,ready:false,navigationPhase:'opening'});
          try{await waitForDesktopRelease(AbortSignal.any([operation.signal,AbortSignal.timeout(15000)]));operation.signal.throwIfAborted();await ctx.uiWorkspace.openSession(id);opened=true;nativeNavigation={phase:'native',sawAway:false};publishWorkbenchSurface({navigationPhase:'native'});if(!desktopController.getSnapshot().closed)await ctx.layout.selectPanel(null);}
          catch{if(!opened)resumeDotSurface();if(active.current)setError(opened?'完整会话已打开，页面切换尚未确认。请从原生会话列表继续；原草稿仍保留。':'会话未能打开，请在原项目列表中核对。原草稿仍保留，没有重新提交任务。');}
          finally{controllers.current.delete(operation);flight.current=false;if(active.current)setBusy(false);}
        };
        const projects=snapshot?.projects??[],project=projects.find(p=>p.id===detailProjectId),composerProject=projects.find(p=>p.id===selected),memoryProject=projects.find(p=>p.id===memoryProjectId),jobs=snapshot?.jobs??[],reminders=snapshot?.reminders??[],bound=snapshot?.connection.state==='bound';
        const readOnly=snapshot?.connection?.readOnly===true;
        const desktopTargetOf=value=>{
          const row=value?.desktopConversation;
          if(row)return row.state==='ready'&&validId(row.sessionId)&&!row.sessionId.startsWith('family_')&&row.sessionId!=='family-no-legacy'&&typeof row.revision==='string'?{sessionId:row.sessionId,revision:row.revision}:null;
          const connection=value?.connection;return connection?.state==='bound'&&connection.readOnly!==true&&validId(connection.sessionId)&&!connection.sessionId.startsWith('family_')?{sessionId:connection.sessionId,revision:revisionOf(value)}:null;
        };
        const desktopTarget=localConversation;
        const embedded=Boolean(desktopTarget&&typeof props.SessionProvider==='function'&&typeof props.renderSlot==='function'&&typeof ctx.sessions?.retain==='function');
        const contextRevision=snapshot&&Object.hasOwn(snapshot,'contextBindingRevision')?snapshot.contextBindingRevision:revisionOf(snapshot);
        React.useEffect(()=>{if(workbenchCache.localConversation!==localConversation)setLocalConversation(workbenchCache.localConversation);setDraftState(workbenchCache.draft);publishWorkbenchSurface({page,ready:page==='home'&&nativeHomeReady&&!nativeSuspended,target:desktopTarget,focus:()=>desktopTarget?desktopController.focus(desktopTarget):Boolean(composerStart.current?.focus?.()??composerStart.current)});return()=>publishWorkbenchSurface({page:null,ready:false,focus:null});},[page,nativeHomeReady,nativeSuspended,desktopTarget?.sessionId,desktopTarget?.revision]);
        const availability=snapshot?.availability??{projects:false,plans:false,jobs:false};
        const states={prepared:'等待提交',admitted:'等待处理',running:'正在处理',completed:'已有回复，待验收',blocked:'需要你核对',unknown:'执行状态未知',mixed:'输入变化，需核对',not_admitted:'未提交',discarded:'已取消',error:'执行出错',aborted:'已中止',interrupted:'被中断',expired:'跟踪已结束',no_text:'没有文本回复','max-tokens':'达到输出上限',forked:'分支结束，需核对'};
        const deliveries={pending:'等待回传',dispatching:'正在回传，结果未确认',queued:'交给通道时已排队，后续送达待核对',reported_sent:'通道报告已发出，手机送达未知',blocked:'回传通道受阻',uncertain:'回传结果不确定',failed:'回传失败',expired:'回传窗口已结束',cancelled:'回传已取消',history_pruned:'发送记录已不在当前窗口'};
        const kinds={goal:'目标',decision:'决定',blocker:'阻塞',next_step:'下一步',context:'背景'};
        const button=(label,onClick,options={})=>h('button',{type:'button',onClick,disabled:busy,...options},label);
        const section=(title,...children)=>h('section',{className:'pc_dot_section'},h('h3',null,title),...children);
        const latest=p=>[...p.sources.map(s=>s.updatedAt??s.modifiedAt),...p.events.map(e=>e.at)].filter(v=>typeof v==='string'&&Number.isFinite(Date.parse(v))).sort().at(-1);
        const followDraft=()=>({mode:followMode,time:followTime,cadence});
        const dirty=drawer==='memory'&&editing&&memoryText!==editing.text||drawer==='follow'&&JSON.stringify(followDraft())!==followBaseline.current;
        const finishExit=()=>{viewEpoch.current++;setDrawer(null);setCloseReview(false);setForgetReview(false);submitted.current=false;const next=pendingExit.current;pendingExit.current=null;if(next)next();else restoreFocus();};
        const leaveDrawer=next=>{pendingExit.current=next??null;if(dirty&&!submitted.current){setCloseReview(true);return;}finishExit();};
        const closeDrawer=()=>leaveDrawer();
        const chooseExit=choice=>{
          if(choice==='continue'){setCloseReview(false);pendingExit.current=null;return;}
          const key=scopeKey(scopeRef.current);
          if(drawer==='memory'&&editing){if(choice==='keep')workbenchCache.memory.set(key,{text:memoryText,original:editing.text});else workbenchCache.memory.delete(key);}
          if(drawer==='follow'){if(choice==='keep')workbenchCache.follow.set(key,followDraft());else workbenchCache.follow.delete(key);}
          setNotice(choice==='keep'?'草稿已保留在这项内容里，正式记录没有改变。':'已放弃这次修改，正式记录没有改变。');finishExit();
        };
        const changePage=key=>leaveDrawer(()=>{setPage(key);if(key==='settings')setConnectionsSeen(true);});
        const openProject=(id,initialTab='summary')=>leaveDrawer(()=>{captureFocus();scopeRef.current=scoped(id);setDetailProjectId(id);setTab(initialTab);setDrawer('project');setError('');});
        const promptFor=(value,p)=>p?`关于项目「${p.label}」：\n${value}`:value;
        const chat=async(value,p=undefined)=>{
          if(flight.current)return;const prompt=value??draft,target=p??(value===undefined?composerProject:project);
          if(!prompt.trim()){setNotice('先写一句你希望 Dot 帮忙的事。');return;}
          const scope=scoped(target?.id),desktop=localConversation;let id=desktop?.sessionId??null;
          if(!id&&typeof ctx.sessions?.create!=='function'){setNotice('原生会话入口尚未就绪，请在 Harness 新建一个本地会话继续。输入已保留。');return;}
          setError('');setNotice('');setBusy(true);flight.current=true;const controller=new AbortController();controllers.current.add(controller);let draftOwner=null;
          try{if(!id){id=await ctx.sessions.create({});if(!validId(id)||id.startsWith('family_'))throw new Error('原生会话创建未完成，输入已保留。');const created={sessionId:id,revision:`native:${id}`};workbenchCache.localConversation=created;if(active.current)setLocalConversation(created);const remembered=await desktopController.remember(id);if(active.current&&!remembered)setNotice('本次会话已创建；入口暂未保存，可从原生历史继续。');}
            const held=desktopController.getSnapshot();if(held.owner===null){draftOwner=Symbol('main-draft-handoff');await desktopController.acquire(draftOwner,{sessionId:id,revision:desktop?.revision??`native:${id}`});}else if(held.sessionId!==id)throw new Error('原生对话正在切换，输入仍已保留。');
            const result=await prepareDotDraft(ctx,id,promptFor(prompt,target),controller.signal,async()=>{const fresh=await request(workbenchEndpoint);if(!active.current||scope.binding!==bindingOf(fresh)||desktop&&workbenchCache.localConversation?.sessionId!==id||target&&!fresh.projects?.some(p=>p.id===target.id))throw new Error('原微信绑定或项目范围已变化，未放入原生草稿。请刷新后重新核对；输入仍保留。');},()=>{if(value!==undefined||workbenchCache.draft!==prompt||workbenchCache.selected!==selected||workbenchCache.binding!==scope.binding)return;workbenchCache.draft='';if(active.current)setDraftState('');return()=>{if(workbenchCache.draft===''&&workbenchCache.selected===selected&&workbenchCache.binding===scope.binding){workbenchCache.draft=prompt;if(active.current)setDraftState(prompt);}};},Boolean(typeof props.SessionProvider==='function'&&typeof props.renderSlot==='function'));if(active.current&&scope.binding===bindingOf(currentSnapshot.current)&&result.status==='preserved')setNotice('Dot 会话里已有草稿，已为你保留。请先打开会话处理；这里的新问题也保留着。');}
          catch(failure){if(active.current)setError(failure.message||'原生草稿未能准备，请打开 Dot 会话核对。');}
          finally{if(draftOwner)desktopController.release(draftOwner);flight.current=false;controllers.current.delete(controller);if(active.current)setBusy(false);}
        };
        const stageDraft=(prompt,scope=selected)=>{if(flight.current)return;if(embedded){leaveDrawer(()=>{setPage('home');void chat(prompt,projects.find(p=>p.id===scope));});return;}if(draft.trim()&&draft!==prompt){setNotice('已保留你尚未发送的草稿。请先处理当前内容。');return;}leaveDrawer(()=>{setDraft(prompt);setSelected(scope??'');setPage('home');setNotice('问题已放入草稿。点击“开始对话”带入原生会话后，由你发送。');});};
        const shortcuts=[['结合资料排下一步','请结合我指定的个人资料和这个项目，整理一份带来源的简报，列出值得推进的几件事。根据我已有的说明确定范围；确实缺少目标或资料范围时，只问缺少的部分。暂不交办、不设置跟进。'],['看看项目进展','请只读看看这个项目的最新进展、阻塞和下一步。'],['交代一件事','请帮我处理这个项目的一件事：'],['安排一个提醒','请提醒我：']];
        const openFollow=async(p=project,skipGuard=false)=>{
          if(!p||flight.current)return;
          if(dirty&&!skipGuard){leaveDrawer(()=>{void openFollow(p,true);});return;}
          captureFocus();const scope=scoped(p.id),epoch=++viewEpoch.current;scopeRef.current=scope;setDetailProjectId(p.id);setFollowView(null);setReviewFollow(false);setDrawer('follow');setCloseReview(false);submitted.current=false;
          const saved=workbenchCache.follow.get(scopeKey(scope)),initial=saved??{mode:'once',time:'',cadence:60};setFollowMode(initial.mode);setFollowTime(initial.time);setCadence(initial.cadence);followBaseline.current=JSON.stringify({mode:'once',time:'',cadence:60});
          const value=await action({action:'followup_status',projectId:p.id},scope,epoch);if(value&&viewEpoch.current===epoch&&value.projectId===p.id)setFollowView(value);
        };
        const confirmFollow=async()=>{
          const scope=scopeRef.current,epoch=viewEpoch.current;if(!scope?.projectId||!followView||!reviewFollow||flight.current)return;let body;
          if(followMode==='repeat')body={action:'followup_configure',projectId:scope.projectId,everyMinutes:Number(cadence),userRequested:true};
          else{const time=new Date(followTime);if(!followTime||!Number.isFinite(time.getTime())||time<=new Date()||time.getTime()>Date.now()+7*86400000){setError('请选择未来七天内的检查时间。');return;}body={action:'check_once',projectId:scope.projectId,dueAt:time.toISOString(),userRequested:true};}
          submitted.current=true;const value=await action(body,scope,epoch);submitted.current=false;
          const plan=value?.[followMode==='repeat'?'followup':'once'],confirmed=value?.projectId===scope.projectId&&plan?.enabled===true&&(followMode==='repeat'?plan.everyMinutes===Number(cadence):plan.status==='queued'&&Date.parse(plan.nextDueAt)===Date.parse(body.dueAt));
          if(confirmed){workbenchCache.follow.delete(scopeKey(scope));if(viewEpoch.current===epoch){setFollowView(previous=>({...previous,...value}));setReviewFollow(false);followBaseline.current=JSON.stringify(followDraft());}setNotice(`已为「${scope.projectLabel}」保存跟进安排。没有实质变化时保持安静；电脑与 Harness 需在线。`);void refresh();}
          else if(value){setNotice(`「${scope.projectLabel}」的安排结果需核对，尚未确认保存。请查看当前安排；没有自动重试。`);if(viewEpoch.current===epoch)setReviewFollow(false);void refresh();}
        };
        const cancelFollow=async which=>{const scope=scopeRef.current,epoch=viewEpoch.current;if(!scope?.projectId||flight.current)return;submitted.current=true;const value=await action({action:which==='once'?'cancel_once':'followup_cancel',projectId:scope.projectId,userRequested:true},scope,epoch);submitted.current=false;if(value&&value.projectId===scope.projectId&&value[which==='once'?'once':'followup']?.enabled===false){if(viewEpoch.current===epoch)setFollowView(previous=>({...previous,...value}));setNotice(`已关闭「${scope.projectLabel}」的这项跟进。`);void refresh();}else if(value){setNotice(`「${scope.projectLabel}」的关闭结果需核对，请查询当前安排；没有自动重试。`);void refresh();}};
        const openTask=async job=>{if(flight.current)return;captureFocus();const epoch=++viewEpoch.current,scope=scoped(undefined,job.id);scopeRef.current=scope;setTaskView(null);setDrawer('task');setCloseReview(false);const value=await action({action:'task_detail',id:job.id},scope,epoch);if(value&&viewEpoch.current===epoch&&Array.isArray(value.jobs)&&value.jobs.every(row=>row.id===job.id))setTaskView(value);};
        const memorySource=row=>{if(row.source.kind==='file')return row.source.reference;const id=row.source.reference.startsWith('session:')?row.source.reference.slice(8).split('#')[0]:null;const title=id&&sessions?.[id]?.displayTitle;return typeof title==='string'&&title.trim()?`来源会话：${title.slice(0,120)}`:'来源：项目会话记录';};
        const availableMemory=p=>p?.overview?.available===true&&['goals','blockers','nextSteps','recent'].every(k=>Array.isArray(p.overview[k])&&p.overview[k].length<=4&&p.overview[k].every(r=>r&&validId(r.id)&&typeof r.text==='string'&&r.source&&['user','assistant','file'].includes(r.source.kind)&&typeof r.source.reference==='string'&&r.verified===false));
        const rowsFor=p=>availableMemory(p)?[...new Map([...p.overview.goals,...p.overview.blockers,...p.overview.nextSteps,...p.overview.recent].map(r=>[r.id,r])).values()]:[];
        const overview=project?.overview,memoryAvailable=availableMemory(project),memoryRows=rowsFor(project);
        const openMemory=async(row,p=project,skipGuard=false)=>{
          if(!p||flight.current)return;if(dirty&&!skipGuard){leaveDrawer(()=>{void openMemory(row,p,true);});return;}
          captureFocus();const epoch=++viewEpoch.current,scope=scoped(p.id,row.id);scopeRef.current=scope;setDetailProjectId(p.id);setEditing(null);setMemoryText('');setStaleMemoryDraft(null);setForgetReview(false);setCloseReview(false);setDrawer('memory');submitted.current=false;
          const result=await action({action:'memory_detail',projectId:p.id,id:row.id},scope,epoch);if(!result||viewEpoch.current!==epoch)return;
          if(result.editable===false||result.redacted===true){setError('这条记忆含有隐藏内容，请在 Dot 会话中按原始内容纠正或忘记；未将隐藏后的副本作为编辑原文。');return;}
          const full=result.record;if(result.projectId!==p.id||!full||full.id!==row.id||typeof full.text!=='string'||!full.text.trim()||Array.from(full.text).length>2000||!full.source||!['user','assistant','file'].includes(full.source.kind)||typeof full.source.reference!=='string'){setError('完整记忆暂不可用，未加载预览片段作为编辑内容。');return;}
          const saved=workbenchCache.memory.get(scopeKey(scope));setEditing(full);setMemoryText(saved?.original===full.text?saved.text:full.text);
          if(saved&&saved.original!==full.text){setStaleMemoryDraft(saved.text);setNotice('这条记忆的原文已变化，旧草稿未套用。你可以展开保留的草稿，与当前原文核对后继续修改。');}
        };
        const memoryCard=(row,p=project)=>h('div',{className:'pc_dot_source',key:row.id},h('p',{className:'pc_dot_excerpt'},row.text),h('p',{className:'pc_dot_muted'},`${row.source.kind==='user'?'用户记录':row.source.kind==='assistant'?'助手记录 · AI 归纳':'文件记录'} · ${date(row.at)} · 未独立核验`),h('small',{className:'pc_dot_muted'},memorySource(row)),h('div',{className:'pc_dot_actions'},readOnly?null:button('纠正或忘记',()=>openMemory(row,p),{disabled:busy||!bound}),button('查看来源',()=>openProject(p.id,'sources'))));
        const memorySection=(title,rows,empty)=>section(title,rows?.length?rows.map(row=>memoryCard(row)):h('p',{className:'pc_dot_muted'},empty));
        const saveMemory=async forget=>{
          const scope=scopeRef.current,epoch=viewEpoch.current;if(!scope?.projectId||!editing||scope.id!==editing.id||flight.current)return;
          submitted.current=true;const value=await action({action:forget?'memory_forget':'memory_update',projectId:scope.projectId,id:scope.id,...(!forget?{text:memoryText.trim()}:{}),userRequested:true},scope,epoch);submitted.current=false;
          if(value&&value.projectId===scope.projectId&&value.id===scope.id&&(forget?value.forgotten===true:value.updated===true)){workbenchCache.memory.delete(scopeKey(scope));if(viewEpoch.current===epoch){setDrawer('project');setTab('memory');setCloseReview(false);}setNotice(forget?`已忘记「${scope.projectLabel}」的这条项目记忆。`:`已记住你对「${scope.projectLabel}」的纠正。`);await refresh();}
          else if(value&&viewEpoch.current===epoch)setError('保存回执与这条记忆不一致，未确认成功。请刷新状态核对，未自动重试。');
        };
        const sessionButtons=p=>p.sessionIds.map((id,index)=>{const row=sessions?.[id],title=typeof row?.displayTitle==='string'&&row.displayTitle.trim()?row.displayTitle.slice(0,120):`会话 ${index+1}`;return button(h('span',null,title,h('small',{style:{display:'block'},className:'pc_dot_muted'},!row?.displayTitle?'标题尚未加载 · 状态待确认':row.running===true?'正在运行':row.running===false?'当前无运行任务':'运行状态待确认')),()=>navigate(id),{key:id});});
        const projectDetails=()=>project?h('article',{'data-dot-project':project.id},h('div',{className:'pc_dot_drawer_tabs'},...[['summary','概况'],['memory','记住的事'],['sources','来源与记录']].map(([key,label])=>button(label,()=>setTab(key),{'aria-pressed':tab===key,className:tab===key?'active':''}))),
          tab==='summary'?h('div',null,memoryAvailable?h('div',{'data-dot-overview':true},memorySection('项目目标',overview.goals,'尚未记录项目目标。可以在 Dot 会话里告诉我你想达成什么。'),memorySection('已记录的阻塞',overview.blockers,'尚未记录阻塞；这不代表当前没有阻塞。'),memorySection('已记录的下一步',overview.nextSteps,'尚未记录下一步。')):section('项目记忆',h('p',{className:'pc_dot_muted'},'项目记忆暂不可用。可在来源中核对原始资料。')),
            section('接下来可以做什么',h('div',{className:'pc_dot_actions'},readOnly?h('p',{className:'pc_dot_muted'},'在原微信继续交代，这里保留项目背景、结果和后续安排。'):button('和 Dot 聊这个项目',()=>chat('请结合这个项目的最新资料，告诉我下一步先做什么。'),{className:'pc_dot_primary'}),button('查看或安排跟进',()=>openFollow(project)))),section('项目会话',project.sessionIds.length===1?button('打开项目会话',()=>navigate(project.sessionIds[0])):project.sessionIds.length?h('div',null,h('p',null,'选择会话'),h('div',{className:'pc_dot_actions'},sessionButtons(project))):h('p',{className:'pc_dot_muted'},'暂无可打开的项目会话。'))):
          tab==='memory'?h('div',null,section('你告诉 Dot 的事',memoryAvailable?memoryRows.length?memoryRows.map(row=>memoryCard(row)):h('p',{className:'pc_dot_muted'},'尚未记录项目记忆。'):h('p',{className:'pc_dot_muted'},'项目记忆暂不可用。')),readOnly?h('p',{className:'pc_dot_muted'},'共享微信入口的记忆可查看；本视图暂不开放记忆增改。'):button('告诉 Dot 要记住什么',()=>chat('请记住这个项目的一点背景：'))):
          h('details',{className:'pc_dot_section',open:true},h('summary',null,'原始资料与对话'),section('项目资料',project.sources.length?project.sources.map(source=>h('div',{className:'pc_dot_source',key:source.name},h('strong',null,source.name),h('p',{className:'pc_dot_muted'},source.status==='ok'?date(source.updatedAt??source.modifiedAt):source.status==='missing'?'尚未提供':'暂不可读取'),source.status==='ok'?h('pre',null,source.text):null,source.truncated?h('p',{className:'pc_dot_muted'},'来源内容较长，已截取；此处未展示完整文件。'):null)):h('p',null,'暂无项目资料。')),section('最近对话',project.events.length?project.events.slice().reverse().map((event,index)=>h('div',{className:'pc_dot_source',key:index},h('p',{className:'pc_dot_muted'},`${project.label} · ${event.kind==='user'?'用户交代':event.kind==='assistant'?'助手回复':'运行记录'} · ${date(event.at)}`),h('p',{className:'pc_dot_excerpt'},event.text),event.truncated?h('p',{className:'pc_dot_muted'},'对话片段已截取，请打开原始项目会话查看完整内容。'):null)):h('p',null,'启用后尚未观察到新对话。')))):null;
        const followDetails=()=>h('div',null,h('p',{className:'pc_dot_muted'},`只读检查「${project?.label??'所选项目'}」，有实质变化才通过原微信会话告诉你。电脑与 Harness 需在线。`),!followView?h('p',{role:'status'},error?'当前安排尚未确认；请重新查询。':'正在查询当前安排…'):h('div',null,
          ...[['followup','持续跟进'],['once','单次检查']].map(([key,label])=>{const plan=followView[key];return h('div',{className:'pc_dot_source',key},h('strong',null,label),h('p',null,plan?.enabled?`${key==='followup'?followFrequency(plan):'只检查一次'} · ${plan.nextDueAt?`下次 ${date(plan.nextDueAt)}`:'下次时间待核对'}`:'当前未开启'),plan?.blocked?h('p',{className:'pc_dot_muted'},'当前未运行，请核对原微信连接。'):plan?.enabled&&plan.running===false?h('p',{className:'pc_dot_muted'},key==='once'?'等待到期检查。':'安排已保存，运行器未启动；请核对 Harness 中的跟进状态。'):null,plan?.enabled&&!readOnly?button('关闭这项跟进',()=>cancelFollow(key)):null);}),
          readOnly?h('p',{className:'pc_dot_muted'},'请在原微信安排、调整或取消跟进；这里查看已保存的安排。'):h('div',{className:'pc_dot_source'},h('h3',null,reviewFollow?'核对这次安排':'安排下一次'),reviewFollow?h('div',null,h('p',null,`项目：${project?.label}`),h('p',null,followMode==='repeat'?`频率：每 ${cadence} 分钟，只读检查`:`时间：${followTime.replace('T',' ')}（本机浏览器时区：${Intl.DateTimeFormat().resolvedOptions().timeZone}）`),h('p',null,'通知：原微信会话；没有实质变化时保持安静。'),h('div',{className:'pc_dot_actions'},button('确认跟进',confirmFollow,{className:'pc_dot_primary',disabled:busy||!bound}),button('返回修改',()=>setReviewFollow(false)))):
          h('div',null,h('label',null,'方式',h('select',{value:followMode,disabled:busy,onChange:e=>{if(!flight.current)setFollowMode(e.target.value);}},h('option',{value:'once'},'在指定时间看一次'),h('option',{value:'repeat'},'按间隔持续跟进'))),followMode==='once'?h('label',null,'检查时间',h('input',{type:'datetime-local',value:followTime,disabled:busy,onChange:e=>{if(!flight.current)setFollowTime(e.target.value);}})):h('label',null,'每隔',h('select',{value:cadence,disabled:busy,onChange:e=>{if(!flight.current)setCadence(Number(e.target.value));}},...[30,60,180,360,1440].map(n=>h('option',{value:n,key:n},n===1440?'一天':`${n} 分钟`)))),h('p',{className:'pc_dot_muted'},'单次可安排未来七天内的检查。周期跟进遵守免打扰时段和消息预算；提交会更新这个项目同类型的安排。'),button('核对安排',()=>{if(followMode==='once'&&!followTime){setError('请选择检查时间。');return;}if(followMode==='once'){const time=new Date(followTime);if(!Number.isFinite(time.getTime())||time<=new Date()||time.getTime()>Date.now()+7*86400000){setError('请选择未来七天内的检查时间。');return;}}setError('');setReviewFollow(true);},{className:'pc_dot_primary',disabled:busy||!bound})))),button('刷新安排',()=>openFollow(project)));
        const taskDetails=()=>{const rows=Array.isArray(taskView?.jobs)?taskView.jobs:[];return h('div',null,!taskView?h('p',{role:'status'},error?'执行回复暂不可用。':'正在读取本次回复…'):rows.length?rows.map(job=>h('article',{key:job.id},h('h3',null,job.projectLabel),h('p',null,job.task),h('p',{className:'pc_dot_muted'},`执行：${states[job.status]??'状态待确认'} · ${date(job.finishedAt??job.createdAt)}`),h('p',{className:'pc_dot_muted'},`回传：${deliveries[job.delivery?.status]??'尚无发送回执'}`),h('pre',null,job.reply??job.text??'本轮没有可展示的文本回复。'),job.replyTruncated?h('p',{className:'pc_dot_muted'},'本次回复已截取，请打开会话看完整内容。'):null,h('p',{className:'pc_dot_muted'},'来源：这次交办的原始回复；仍需核对内容与实际成果。'),button('打开 Dot 会话',()=>navigate(snapshot?.connection.sessionId)))):h('p',null,'没有这次交办的可用详情。'));};
        const memoryDetails=()=>!editing?h('p',{role:'status'},error?'完整记忆尚未读取，未开放编辑。':'正在读取完整记忆…'):h('div',null,h('p',{className:'pc_dot_muted'},`只修改「${project?.label}」的这条项目记忆。纠正会记录为你的本次说明，并保留原来源身份。`),h('p',{className:'pc_dot_muted'},`${memorySource(editing)} · ${date(editing.at)} · 未独立核验`),forgetReview?h('div',null,h('p',null,'确认让 Dot 忘记这条记忆？原始项目文件不会被修改。'),h('div',{className:'pc_dot_actions'},button('确认忘记',()=>saveMemory(true),{className:'pc_dot_primary'}),button('返回',()=>setForgetReview(false)))):h('div',null,h('label',null,'记忆内容',h('textarea',{'aria-label':'纠正项目记忆',maxLength:4000,value:memoryText,disabled:busy,onChange:e=>{if(!flight.current)setMemoryText(e.target.value);}})),h('div',{className:'pc_dot_actions'},button('保存纠正',()=>saveMemory(false),{className:'pc_dot_primary',disabled:busy||!memoryText.trim()||memoryText===editing.text||Array.from(memoryText.trim()).length>2000}),button('忘记这条',()=>setForgetReview(true))),h('p',{className:'pc_dot_muted'},'不会改写原始对话、项目文件或其他项目的记忆。'),staleMemoryDraft?h('details',{'data-dot-conflict-draft':true},h('summary',null,'查看保留的旧草稿'),h('p',{className:'pc_dot_muted'},'当前原文已有更新。使用草稿只会放入编辑器，请结合上方原文核对后再保存。'),h('pre',null,staleMemoryDraft),button('使用保留草稿继续修改',()=>{setMemoryText(staleMemoryDraft);setStaleMemoryDraft(null);}),button('放弃这份旧草稿',()=>{workbenchCache.memory.delete(scopeKey(scopeRef.current));setStaleMemoryDraft(null);})):null));
        const continueJob=job=>{const matches=projects.filter(p=>p.label===job.projectLabel);if(matches.length!==1){setNotice('这次交办的项目范围需要你核对，请先在关注的项目中选择对应项目。');changePage('projects');return;}stageDraft(`关于「${job.projectLabel}」这次交办：${job.task}\n交办记录 ID：${job.id}。请先读取这次已有交办结果，不重新提交或重做任务，再解释本次结果和还需要我决定的事。`,matches[0].id);};
        const recentJobs=[...jobs].reverse().sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt));
        const reviewState=snapshot?.personalReview?.available===true?snapshot.personalReview:null;
        const reviewSchedule=reviewState?.review?.schedule;
        const toggleAttention=async()=>{
          if(!active.current||flight.current||!reviewState?.deliverySupported||!reviewSchedule)return;
          const expectedBindingRevision=reviewState.bindingRevision;flight.current=true;setBusy(true);setError('');
          try{const value=await request('/api/project_companion/review/attention',{enabled:reviewState.review.attention?.enabled!==true,expectedBindingRevision});if(active.current&&revisionOf(currentSnapshot.current)===expectedBindingRevision)setNotice(value.text);}
          catch{if(active.current)setError('主动关注设置未更改或结果待核对，请刷新后检查。');}
          finally{flight.current=false;if(active.current){setBusy(false);await refresh();}}
        };
        const reviewPreset='每天09:00、每周一09:00，使用我在电脑启用的资料和已关注项目做个人回顾，主动发现风险、截止事项和项目进展；无变化时保持安静。';
        const reviewCard=section('每天少漏一件重要的事',
          h('p',{className:'pc_dot_muted'},'把近期邮件、日程、笔记、待办和项目变化放在一起，看清需要处理的风险与截止事项。每天提醒重点，每周回看进展。'),
          reviewState?.deliverySupported===false?h('p',{className:'pc_dot_muted'},reviewState.deliveryNote??'当前通道只支持个人回顾预览，暂不能开启推送。'):null,
          h('p',null,!reviewState?'个人回顾状态暂无法确认。':reviewState.review?.status==='enabled'?'个人回顾已开启':reviewState.review?.status==='paused'?'个人回顾已暂停':'个人回顾未开启'),
          reviewState?.review?.status!=='off'&&reviewSchedule?h('p',{className:'pc_dot_muted'},[reviewSchedule.dailyTime?`每天 ${reviewSchedule.dailyTime}`:'',Number.isInteger(reviewSchedule.weeklyDay)&&reviewSchedule.weeklyTime?`每周${['日','一','二','三','四','五','六'][reviewSchedule.weeklyDay]} ${reviewSchedule.weeklyTime}`:'',reviewSchedule.timeZone].filter(Boolean).join(' · ')):null,
          reviewState?.review?.attention?h('p',{className:'pc_dot_muted'},reviewState.review.status==='paused'?'工作时段主动关注已暂停。':reviewState.review.attention.enabled===true?['工作时段主动关注已开启',reviewState.review.attention.quiet?'当前安静时段':'',reviewState.review.attention.nextRun?`下次检查 ${date(reviewState.review.attention.nextRun)}`:'',Number.isInteger(reviewState.review.attention.remaining)?`今天还可提醒 ${reviewState.review.attention.remaining} 次`:''].filter(Boolean).join(' · '):reviewState.review.attention.enabled===false?'工作时段主动关注未开启。':'工作时段主动关注状态待确认。'):null,
          reviewState?.deliverySupported&&reviewSchedule?button(reviewState.review.attention?.enabled?'关闭工作时段主动关注':'开启工作时段主动关注',toggleAttention,{disabled:busy||reviewState.review.status==='paused'}):null,
          h('p',{className:'pc_dot_muted'},'工作时段：09:00–19:00，每两小时检查；重要新风险或临期事项才提醒，每天最多额外两条。沿用现有资料范围。'),
          reviewState?.review?.sources?.length||reviewState?.review?.projects?.length?h('p',{className:'pc_dot_muted'},`范围：${reviewState.review.sources?.length??0} 个资料来源，${reviewState.review.projects?.length??0} 个项目。只读已确认范围，可随时暂停或取消。`):null,
          reviewState?.review?.jobs?.length?h('p',{className:'pc_dot_muted'},`最近一轮：${date(reviewState.review.jobs.at(-1).createdAt)} · ${reviewState.review.jobs.at(-1).detail??'状态待核对'}`):null,
          Array.isArray(reviewState?.review?.goals)&&reviewState.review.goals.length?h('div',null,h('h3',null,'正在跟进的目标'),...reviewState.review.goals.map((goal,index)=>h('p',{key:index,className:'pc_dot_muted'},`${goal.title} · ${{active:'跟进中',paused:'已暂停',completed:'已完成'}[goal.status]??'状态待确认'}${goal.meetingTitle?` · ${goal.meetingTitle}`:''}`))):null,
          h('div',{className:'pc_dot_actions'},...(readOnly?[]:[button('先看一份个人回顾',()=>stageDraft('预览一份个人回顾，使用我在电脑启用的资料和已关注项目，不建立计划。',''),{disabled:busy||!bound}),reviewState?.deliverySupported===false?null:button(reviewState?.review?.status==='enabled'?'调整个人回顾':'开启每日与每周回顾',()=>stageDraft(reviewPreset,''),{disabled:busy||!bound})])),
          readOnly?h('p',{className:'pc_dot_muted'},'在原微信告诉我「每天09:00、每周一09:00，使用我在电脑启用的资料和已关注项目做个人回顾」即可开启；也可以说「暂停个人回顾」。'):h('p',{className:'pc_dot_muted'},'先准备一句话，由你发送后启用。打开页面不会扫描资料或自动建计划。'),
          h('h3',null,'AI 日报，围绕你的关注点'),
          h('p',{className:'pc_dot_muted'},!reviewState?.news||reviewState.news.topicSource==='unavailable'?'资讯关注点暂无法确认，请刷新后核对。':reviewState.news.topicSource==='explicit'&&Array.isArray(reviewState.news.topics)?reviewState.news.topics.join(' · '):'尚未设置专属关注点，沿用公开 AI 资讯主题。'),
          readOnly?h('p',{className:'pc_dot_muted'},'在微信说「AI 日报关注：Agent 产品、插件生态……」即可保存。资讯只使用公开来源，不会带入私人邮件。'):button('调整资讯关注点',()=>stageDraft('AI 日报关注：',''),{disabled:busy||!bound}),
          h('p',{className:'pc_dot_muted'},'电脑与 Harness 需保持在线；来源限量读取，不代表全账号覆盖。'));
        const upcoming=projects.flatMap(p=>p.followup?.available===true?[['followup',p.followup.followup],['once',p.followup.once]].filter(([,plan])=>plan?.enabled===true).map(([kind,plan])=>({project:p,kind,plan})):[]).sort((a,b)=>(Date.parse(a.plan.nextDueAt)||Infinity)-(Date.parse(b.plan.nextDueAt)||Infinity));
        const recentChecks=projects.flatMap(p=>p.followup?.available===true?[['followup',p.followup.followup],['once',p.followup.once]].filter(([,plan])=>plan&&typeof plan.lastReviewedAt==='string'&&Number.isFinite(Date.parse(plan.lastReviewedAt))).map(([kind,plan])=>({project:p,kind,plan})):[]).sort((a,b)=>Date.parse(b.plan.lastReviewedAt)-Date.parse(a.plan.lastReviewedAt)).slice(0,5);
        const checkHistory=section('上次已核验检查',recentChecks.length?recentChecks.map(({project:p,kind,plan})=>h('div',{className:'pc_dot_row',key:`checked:${p.id}:${kind}`},h('div',null,h('strong',null,p.label),h('small',{className:'pc_dot_muted'},`${kind==='once'?'单次检查':'持续跟进'} · ${date(plan.lastReviewedAt)}`),h('p',{className:'pc_dot_muted'},plan.lastCheckOutcome==='quiet'?'本次可见范围无新变化，已静默；不代表全账号无变化。':plan.lastCheckOutcome==='partial'?'部分来源仍无法确认；这是检查记录，不代表资料已完整读取。':'已完成检查流程；具体资料与结果见原会话。'),['failed','blocked','cancelled'].includes(plan.status)?h('p',{className:'pc_dot_muted'},`当前${plan.status==='failed'?'检查失败':plan.status==='blocked'?'受阻':'已取消'}，上方为此前已核验记录。`):null),button('查看安排',()=>openFollow(p)))):h('p',{className:'pc_dot_muted'},projects.some(p=>p.followup?.available===true)?'尚无已核验检查记录。':'检查记录暂无法确认；不据此判断未执行。'));
        const plans=section('下一次跟进',upcoming.length?upcoming.map(({project:p,kind,plan})=>h('div',{className:'pc_dot_row',key:`${p.id}:${kind}`},h('div',null,h('strong',null,p.label),h('small',{className:'pc_dot_muted'},kind==='once'?'单次检查':followFrequency(plan),plan.blocked?' · 当前受阻':plan.running===false?(kind==='once'?' · 等待到期':' · 已保存，运行器未启动'):'',plan.loopId?' · 含已选个人资料':'',` · 原微信会话`),h('small',{className:'pc_dot_muted'},`下次 ${date(plan.nextDueAt)}`)),button('查看安排',()=>openFollow(p)))):projects.some(p=>p.followup?.available===false||!p.followup)?h('p',{className:'pc_dot_muted'},'项目跟进状态尚未确认，可在项目详情中查询。'):h('p',{className:'pc_dot_muted'},'还没有开启项目跟进。先交代目标，再决定什么时候回来看看。'),
          !availability.plans?h('p',{className:'pc_dot_muted'},readOnly?'共享微信的提醒与日报，请在原微信查询或安排；这里不混入独立 Dot 会话的旧计划。':'提醒与日报状态尚未确认，请刷新核对。'):h('div',null,...reminders.map(r=>h('div',{className:'pc_dot_row',key:r.id},h('div',null,h('strong',null,r.title),h('small',{className:'pc_dot_muted'},'明确提醒 · 原微信会话')),h('span',{className:'pc_dot_muted'},date(r.dueAt)))),!readOnly&&!reminders.length?h('p',{className:'pc_dot_muted'},'暂无待触发的明确提醒。'):null,snapshot?.counts?.activeReminders>reminders.length?h('p',{className:'pc_dot_muted'},`仅显示 ${reminders.length} 条活动提醒，其余请在 Dot 会话中查询。`):null,readOnly?null:h('p',{className:'pc_dot_muted'},snapshot?.daily?.enabled?`项目资料日报：每天 ${snapshot.daily.time}（${snapshot.daily.timeZone}）`:'项目资料日报未开启。'),h('div',{className:'pc_dot_actions'},readOnly?null:button('安排提醒',()=>stageDraft('请提醒我：','')),readOnly?null:button('设置日报',()=>stageDraft('请帮我设置项目资料日报。先和我确认每天的发送时间、时区和关注项目，再开启。','')))));
        const currentResult=recentJobs[0];
        const firstUse=needsInlineWechatSetup(snapshot?.connection);
        const attentionProjection=snapshot?.personalReview?.attentionItems;
        const scheduleProjection=snapshot?.personalReview?.schedules;
        const attentionItems=attentionProjection?.available===true&&Array.isArray(attentionProjection.items)?attentionProjection.items.slice(0,5):null;
        const scheduleItems=Array.isArray(scheduleProjection?.items)?scheduleProjection.items.slice(0,12):null;
        const unknownScopes=[!availability.projects?'关注项目':null,!availability.jobs?'交办记录':null,!availability.plans?'已有安排':null,!attentionItems?'当前事项':attentionProjection.coverage==='unconfirmed'?'部分事项覆盖':null,scheduleProjection?.available!==true?'下一次安排':null,['unknown','failed'].includes(snapshot?.connection?.state)?'微信连接':null].filter(Boolean);
        const recovery=!firstUse&&unknownScopes.length?h('div',{className:'pc_dot_notice pc_dot_recovery',role:'status','data-dot-recovery':true},h('div',null,h('strong',null,'部分状态暂未确认，电脑对话可以继续'),h('p',null,`${unknownScopes.join('、')}尚未核对。保留原安排，不会据此判断没有事项或重新创建。`),h('details',null,h('summary',null,'查看影响范围'),h('p',null,[attentionProjection?.note,scheduleProjection?.note].filter(v=>typeof v==='string'&&v).join(' ')||'恢复连接后重试状态，现有记录不会自动重做。'))),h('div',{className:'pc_dot_actions'},button('查看连接',()=>changePage('settings')),button('重试状态',refresh))):null;
        const jobCard=job=>h('article',{className:'pc_dot_update',key:job.id,'data-dot-job':job.id},h('p',{className:'pc_dot_muted'},`${job.projectLabel} · ${states[job.status]??'状态待核对'}`),h('h3',null,job.task),job.result?.available===true&&typeof job.result.text==='string'?h('p',{className:'pc_dot_excerpt'},job.result.text):null,job.result?.truncated?h('p',{className:'pc_dot_muted'},'原回复较长，此处为摘录。'):null,job.delivery?h('p',{className:'pc_dot_muted'},deliveries[job.delivery.status]??'回传状态待核对'):null,h('div',{className:'pc_dot_actions'},button('看看这次结果',()=>openTask(job)),readOnly?null:button('和 Dot 接着聊',()=>continueJob(job))));
        const focusComposer=()=>{composerStart.current?.focus?.();composerStart.current?.scrollIntoView?.({block:'nearest'});};
        const continueDesktopCandidate=async()=>{if(!conversationCandidate||flight.current)return;flight.current=true;setBusy(true);try{const candidate=await desktopController.resolve(conversationCandidate);if(!candidate)throw Error('candidate unavailable');const remembered=await desktopController.remember(candidate.sessionId);if(active.current){workbenchCache.localConversation=candidate;setLocalConversation(candidate);setConversationCandidate(null);setNotice(remembered?'已选择上次对话，沿用原草稿。':'本次可继续上次对话；入口暂未保存，可从原生历史找回。');}}catch{if(active.current)setError('上次对话暂不可用，请从原生历史核对；当前草稿仍保留。');}finally{flight.current=false;if(active.current)setBusy(false);}};
        const recoverLocalDraft=async()=>{if(flight.current||!desktopTarget)return;flight.current=true;setBusy(true);const operation=new AbortController();controllers.current.add(operation);try{const receipt=await prepareCachedDesktopDraft(desktopTarget,operation.signal);if(active.current){setDraftState(workbenchCache.draft);setNotice(receipt.status==='applied'?'保留草稿已放入当前原生会话，由你发送。':'原生会话已有草稿，电脑原文继续完整保留。');}}catch(failure){if(active.current)setError('草稿未能带入：原对话或草稿范围暂未确认。原文仍完整保留，可复制后继续。');}finally{controllers.current.delete(operation);flight.current=false;if(active.current)setBusy(false);}};
        const inlineState=inlineConnection?.state;
        const connectionCopy={missing:'微信桥接尚未就绪。先在电脑上聊，也可到连接页查看微信设置。',unknown:'微信连接状态暂未确认，保留原连接；先在电脑上继续。','waiting-qr':'微信扫一扫 · 等待扫码',scanned:'已扫码，请在手机上确认。','awaiting-message':'请在微信给小助手发送“你好”，完成入口确认。',bound:'微信已连接，沿用已有入口。',failed:'微信连接暂时受阻。先查看已有连接状态，不会重置绑定。'};
        const inlineWechat=firstUse?h('section',{className:'pc_dot_inline_wechat','data-dot-inline-wechat':true,'aria-label':'连接微信'},h('div',{className:'pc_dot_pair_copy'},h('h2',null,inlineState==='bound'?'微信已连接':'把 Dot 带到微信里'),h('p',null,'在手机上交代任务、收结果，也能收到你已开启的提醒。'),button('先在电脑上试试',focusComposer,{className:'pc_dot_text_button'}),h('p',{className:'pc_dot_muted'},'电脑和 Harness 需保持在线。扫码不会自动开启推送。')),h('div',{className:'pc_dot_inline_code'},h('p',{role:'status'},inlineConnectionError||(qrFailed?'二维码暂不可用，请刷新连接状态。':connectionCopy[inlineState]??'正在读取现有微信连接…')),inlineState==='waiting-qr'&&inlineConnection?.qrAvailable===true&&!qrFailed?h('img',{src:'/wechat/api/qr-image'+(/^[a-f0-9]{16}$/.test(inlineConnection.qrRevision??'')?`?v=${inlineConnection.qrRevision}`:''),alt:'用微信扫描，连接 Dot',onError:()=>setQrFailed(true)}):null,button('刷新连接状态',readInlineConnection),inlineState==='missing'||inlineState==='failed'?button('查看微信设置',()=>changePage('settings')):null)):null;
        const composer=embedded?h('section',{className:'pc_dot_hero','aria-label':'和 Dot 继续对话'},h('h1',null,'今天想推进哪件事？'),retainedDraftView(desktopTarget,{busy,onApply:recoverLocalDraft,onCopy:()=>copyCachedDraft(setNotice)}),nativeSuspended?h('p',{className:'pc_dot_notice',role:'status'},'正在切换完整对话，原草稿会保留。'):h(DesktopConversation,{target:desktopTarget,SessionProvider:props.SessionProvider,renderSlot:props.renderSlot,onOpenHistory:()=>navigate(desktopTarget.sessionId),onReady:setNativeHomeReady})):h('section',{className:'pc_dot_hero'},h('h1',null,firstUse?'先把一件事交给 Dot。':'今天想推进哪件事？'),h('p',{className:'pc_dot_muted'},'说说背景和目标，需要资料时再按需连接。'),h('div',{className:'pc_dot_composer'},h('textarea',{ref:composerStart,'aria-label':'交代给 Dot 的事情',placeholder:'把背景、想做的事，或刚刚变化的情况告诉我…',maxLength:3500,value:draft,disabled:busy,onChange:e=>{if(!flight.current)setDraft(e.target.value);},onKeyDown:e=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter'&&!e.isComposing&&e.keyCode!==229&&!e.nativeEvent?.isComposing){e.preventDefault();void chat();}}}),h('div',{className:'pc_dot_compose_bottom'},h('select',{'aria-label':'这句话关联的项目',value:selected??'',disabled:busy,onChange:e=>{if(!flight.current)setSelected(e.target.value);}},h('option',{value:''},'不关联项目'),...projects.map(p=>h('option',{value:p.id,key:p.id},p.label))),h('span',{className:'pc_dot_keyboard'},'⌘ / Ctrl + Enter'),button('开始对话',()=>chat(),{className:'pc_dot_primary'}))),h('p',{className:'pc_dot_muted'},'带入原生 Dot 会话后，由你发送；已有会话草稿会保留。'),conversationCandidate?button('继续上次对话',continueDesktopCandidate,{className:'pc_dot_text_button'}):null,h('div',{className:'pc_dot_actions pc_dot_shortcuts'},...shortcuts.slice(0,3).map(([label,prompt])=>button(label,()=>stageDraft(prompt),{key:label}))));
        const sourceMeta=source=>h('div',{className:'pc_dot_item_source',key:`${source.source??''}:${source.title??''}`},h('strong',null,source.label||source.title||source.source||'来源'),h('span',null,[source.source,source.at?date(source.at):null,['metadata_only','metadata-only'].includes(source.contentState)?'仅来源信息':null,source.contentState==='unread'?'正文未读':null,source.contentState==='unavailable'?'内容尚未确认':null,source.contentState==='actual_empty'?'返回内容为空':null,source.truncated?'内容已截断':null].filter(Boolean).join(' · ')));
        const attentionCard=item=>h('article',{className:'pc_dot_attention_item',key:item.id,'data-dot-attention-item':item.id},h('div',{className:'pc_dot_item_kicker'},h('span',null,({deadline:'截止事项',risk:'需要留意',invitation:'待确认邀请',reply:'待回复',change:'近期变化',progress:'项目进展',event:'近期安排'}[item.kind]??'当前事项')),h('span',null,item.dueAt?`${item.dueAtBasis==='relative'?'估算期限':'截止'} ${date(item.dueAt)}`:item.eventStartAt?`开始 ${date(item.eventStartAt)}`:item.time?date(item.time):'')),h('h3',null,item.title),typeof item.summary==='string'&&item.summary?h('p',{className:'pc_dot_item_summary'},item.summary):null,typeof item.why==='string'&&item.why?h('p',{className:'pc_dot_item_why'},item.why):null,typeof item.action==='string'&&item.action?h('p',{className:'pc_dot_item_next'},item.action):null,typeof item.unknown==='string'&&item.unknown?h('p',{className:'pc_dot_item_unknown'},`待确认：${item.unknown}`):null,item.confidence==='inferred'?h('p',{className:'pc_dot_muted'},'这是基于已保存资料的判断，仍需核对。'):null,h('div',{className:'pc_dot_actions'},button('和 Dot 接着聊',()=>stageDraft(`请围绕这条事项继续：${item.title}\n事项 ID：${item.id}\n请先核对原事项及已授权来源，再帮我梳理下一步；不要自动重做旧任务或扩大读取范围。`,'')),Array.isArray(item.sources)&&item.sources.length?h('details',null,h('summary',null,'查看依据'),...item.sources.slice(0,5).map(sourceMeta)):null));
        const attentionView=section('值得你留意',attentionItems?attentionItems.length?attentionItems.map(attentionCard):h('p',{className:'pc_dot_empty'},'当前已核对的范围内，没有待处理事项。有事可以直接告诉 Dot。'):h('p',{className:'pc_dot_empty'},'当前事项尚未核对，恢复入口见上方提示。'),typeof attentionProjection?.note==='string'&&attentionProjection.note?h('p',{className:'pc_dot_muted'},attentionProjection.note):null,attentionProjection?.truncated?h('p',{className:'pc_dot_muted'},'这里只展示最近 5 条事项，其他内容请在原会话核对。'):null);
        const scheduleTime=item=>item.nextDueAt?date(item.nextDueAt):[item.dailyTime?`每天 ${item.dailyTime}`:'',Number.isInteger(item.weeklyDay)&&item.weeklyTime?`每周${['日','一','二','三','四','五','六'][item.weeklyDay]} ${item.weeklyTime}`:'',Number.isInteger(item.everyMinutes)?`每 ${item.everyMinutes} 分钟`:''].filter(Boolean).join(' · ')||'下次时间待确认';
        const scheduleRail=h('section',{className:'pc_dot_section pc_dot_schedule','data-dot-schedule-rail':true},h('h3',null,'下一次安排'),scheduleItems?scheduleItems.length?scheduleItems.map(item=>h('div',{className:'pc_dot_schedule_item',key:item.id},h('strong',null,item.title),h('span',{className:'pc_dot_plan_status'},({stored:'已保存',paused:'已暂停',blocked:'当前受阻'}[item.status]??'状态待核对')),h('p',null,scheduleTime(item)),h('p',{className:'pc_dot_muted'},item.timeZone||'时区待核对'),h('p',{className:'pc_dot_muted'},({['personal-review']:'个人回顾',news:'AI 日报',['project-followup']:'项目跟进'}[item.source]??'原安排')))):scheduleProjection?.available===true?h('p',{className:'pc_dot_empty'},'当前范围没有已保存的安排。想跟进一件事，可以直接告诉 Dot。'):h('p',{className:'pc_dot_empty'},'安排状态见上方提示。'):h('p',{className:'pc_dot_empty'},'安排状态见上方提示。'),scheduleProjection?.available!==true&&scheduleItems?.length?h('p',{className:'pc_dot_muted'},'部分安排尚未确认；这里保留已核对的安排。'):null,scheduleItems?.length?h('p',{className:'pc_dot_rail_note'},'这里显示已保存的安排；运行尚未核验，手机收到仍未确认。'):null,scheduleProjection?.truncated?h('p',{className:'pc_dot_muted'},'此处为有限安排，其余请在原入口核对。'):null);
        const history=availability.jobs?h('details',{className:'pc_dot_history','data-dot-history':true},h('summary',null,`找到之前聊过的事（${jobs.length}）`),recentJobs.length?recentJobs.map(jobCard):h('p',{className:'pc_dot_muted'},'这个窗口里还没有交办记录。'),h('p',{className:'pc_dot_muted'},'这里展示最近的有限记录；更早的原始内容在 Dot 会话中。'),desktopTarget?button('打开完整会话历史',()=>navigate(desktopTarget.sessionId)):bound&&!readOnly?button('打开完整会话历史',()=>navigate(snapshot.connection.sessionId)):null):null;
        const home=h('div',null,recovery,h('div',{className:'pc_dot_home_grid'},h('div',{className:'pc_dot_column'},inlineWechat,composer,firstUse?h('p',{className:'pc_dot_intro'},'不用先把所有东西配好。先聊手上的任务，用到邮件、日程或项目时，再连接需要的资料。'):attentionView,history,h('details',{className:'pc_dot_legacy_details'},h('summary',null,'更多原会话安排与检查'),plans,checkHistory)),h('aside',{className:'pc_dot_column pc_dot_rail','aria-label':'后续安排与资料范围'},firstUse?section('从你手上的事开始',h('p',{className:'pc_dot_muted'},'先交代一个目标，Dot 会接着整理下一步。用到资料时再连接；想定时跟进时再安排。')):scheduleRail,section('正在关注',availability.projects?projects.length?projects.map(p=>button(h('span',null,h('strong',null,p.label),h('small',{className:'pc_dot_muted'},latest(p)?`资料更新 ${date(latest(p))}`:'尚无近期资料')),()=>openProject(p.id),{key:p.id,className:'pc_dot_project_mini'})):h('p',{className:'pc_dot_muted'},'先从手头的一件事开始，需要时再关注项目。'):h('p',{className:'pc_dot_muted'},'关注范围见上方提示。'),readOnly?null:button('选择关注项目',()=>setSetup(true))),reviewState?h('details',{className:'pc_dot_review_details'},h('summary',null,'个人回顾与资讯设置'),reviewCard):null)));
        const catalogView=section(`全部项目${catalog?` · ${catalog.total}`:''}`,
          h('p',{className:'pc_dot_muted'},'按名称找到 Harness 已登记的项目，单次查看不占持续关注名额。列目录不会读取项目内容。'),
          !bound?h('p',{className:'pc_dot_empty'},'先确认微信连接，再查看你的项目目录。'):h('div',null,
            h('form',{'aria-label':'搜索全部项目',className:'pc_dot_actions',onSubmit:event=>{event.preventDefault();void loadCatalog({query:catalogQuery});}},h('input',{'aria-label':'搜索全部项目',placeholder:'输入项目名称',maxLength:80,value:catalogQuery,disabled:catalogBusy,onChange:event=>setCatalogQuery(event.target.value)}),h('button',{type:'submit',disabled:catalogBusy},'搜索'),button('刷新项目目录',()=>loadCatalog({query:catalogQuery}),{disabled:catalogBusy})),
            catalogBusy?h('p',{role:'status',className:'pc_dot_muted'},'正在读取所选内容…'):null,
            catalogError?h('p',{role:'alert',className:'pc_dot_error'},catalogError):null,
            catalog?h('div',null,h('p',{className:'pc_dot_muted'},`本次匹配 ${catalog.matchedTotal} 个${catalog.items.length?` · 显示 ${catalog.offset+1}–${catalog.offset+catalog.items.length}`:''}`),
              catalog.items.length?catalog.items.map(item=>h('div',{className:'pc_dot_row',key:item.id,'data-catalog-project':item.id},h('div',null,h('strong',null,item.label),h('small',{className:'pc_dot_muted'},item.disambiguator?`${item.disambiguator} · `:'',item.watched?'正在持续关注':'按需查看')),button('单次查看',()=>previewCatalogProject(item),{disabled:catalogBusy||snapshot?.paused===true,'aria-label':`单次查看 ${item.label}${item.disambiguator?` ${item.disambiguator}`:''}`}))):h('p',{className:'pc_dot_empty'},catalog.total?'没有匹配的项目，试试其他名称。':'Harness 中还没有已登记项目。'),
              h('div',{className:'pc_dot_actions'},button('上一页',()=>loadCatalog({query:catalog.query,offset:Math.max(0,catalog.offset-catalog.limit),expectedRevision:catalog.revision}),{disabled:catalogBusy||catalog.offset===0}),button('下一页',()=>loadCatalog({query:catalog.query,offset:catalog.nextOffset,expectedRevision:catalog.revision}),{disabled:catalogBusy||!catalog.hasMore}))):null,
            catalogPreview?h('section',{className:'pc_dot_result','aria-label':'单次项目资料'},h('div',{className:'pc_dot_header'},h('h3',null,catalogPreview.project.label),button('收起资料',()=>setCatalogPreview(null))),h('p',{className:'pc_dot_muted'},'本次只读项目固定说明；不会加入持续关注、读取聊天历史或创建计划。'),...catalogPreview.sources.map(source=>h('div',{className:'pc_dot_source',key:source.path},h('strong',null,source.path),h('p',{className:'pc_dot_muted'},source.modifiedAt?`更新 ${date(source.modifiedAt)}`:'',source.truncated?' · 已截断，当前预览不是完整文件':''),source.status==='ok'?h('pre',null,source.text):h('p',{className:'pc_dot_muted'},source.status==='missing'?'这个文件不存在；不能据此判断项目进展。':'这个文件当前无法读取。')))):null));
        const projectsPage=h('div',null,h('div',{className:'pc_dot_header'},h('div',null,h('h1',null,'项目'),h('p',{className:'pc_dot_muted'},'所有项目都能按需查看，重要的事再持续关注。')),readOnly?null:button('选择关注项目',()=>setSetup(true))),catalogView,section(`持续关注 · ${projects.length}/5`,h('p',{className:'pc_dot_muted'},'背景、结果和后续安排，从这里接着走。关注名额只限制后台跟进。'),!availability.projects?h('p',{className:'pc_dot_empty'},'关注列表暂不可用。'):projects.length?h('div',{className:'pc_dot_project_cards'},projects.map(p=>h('article',{className:'pc_dot_project_card',key:p.id},h('p',{className:'pc_dot_eyebrow'},'项目'),h('h2',null,p.label),h('p',{className:'pc_dot_muted'},latest(p)?`上次资料更新 ${date(latest(p))}`:'尚无近期资料'),h('p',{className:'pc_dot_excerpt'},availableMemory(p)&&p.overview.nextSteps[0]?p.overview.nextSteps[0].text:'还没有记录下一步。直接说说你想推进什么。'),h('div',{className:'pc_dot_actions'},button('查看项目',()=>openProject(p.id)),readOnly?null:button('继续聊',()=>stageDraft(`请看看「${p.label}」的最新进展。`,p.id)),button('来源与记录',()=>openProject(p.id,'sources')))))):h('p',{className:'pc_dot_empty'},'还没有关注项目。可以先连接微信，再选一个项目开始。')));
        const memoryPage=h('div',null,h('h1',null,'Dot 记住的事'),h('p',{className:'pc_dot_muted'},'按项目查看背景与约定。每条都保留来源，可由你纠正或忘记；这里不是跨项目的个人画像。'),h('div',{className:'pc_dot_memory_scope'},h('label',{htmlFor:'pc-memory-project'},'适用项目'),h('select',{id:'pc-memory-project','aria-label':'记忆适用项目',value:memoryProjectId,onChange:e=>leaveDrawer(()=>setMemoryProjectId(e.target.value))},...projects.map(p=>h('option',{value:p.id,key:p.id},p.label))),memoryProject?button('查看项目来源',()=>openProject(memoryProject.id,'sources')):null),!availability.projects?h('p',{className:'pc_dot_empty'},'项目范围尚未确认，请刷新。'):!memoryProject?h('p',{className:'pc_dot_empty'},'关注一个项目后，可在这里回看 Dot 记住的背景。'):!availableMemory(memoryProject)?h('p',{className:'pc_dot_empty'},'项目记忆暂不可用，可先查看原始资料。'):rowsFor(memoryProject).length?rowsFor(memoryProject).map(row=>memoryCard(row,memoryProject)):h('p',{className:'pc_dot_empty'},'这个项目还没有记忆。告诉 Dot 一点背景，从你明确说过的事开始。'),memoryProject&&!readOnly?button('告诉 Dot 要记住什么',()=>stageDraft('请记住这个项目的一点背景：',memoryProject.id),{className:'pc_dot_primary'}):null);
        const exitReview=closeReview?h('div',{className:'pc_dot_draft_review',role:'group','aria-label':'未保存的修改'},h('h3',null,'这次修改还没保存'),h('p',null,'保留草稿后，下次打开同一项目的这项内容可继续。关闭不会保存正式记录。'),h('div',{className:'pc_dot_actions'},button('继续编辑',()=>chooseExit('continue'),{className:'pc_dot_primary',disabled:false,autoFocus:true}),button('保留草稿并离开',()=>chooseExit('keep'),{disabled:false}),button('放弃修改并离开',()=>chooseExit('discard'),{disabled:false}))):null;
        return h('div',{className:'pc_dot','data-dot-workbench':true},h('div',{className:'pc_dot_inner'},h('header',{className:'pc_dot_header'},h('div',{className:'pc_dot_brand'},h('span',{className:'pc_dot_brand_mark'},h(DotIcon,{size:24})),h('div',null,h('h2',null,'DSH Dot'),h('p',null,'你的一句交代，我接着跟进。'))),h('div',{className:'pc_dot_actions'},h('span',{className:'pc_dot_muted'},bound?'微信已连接':'微信尚未确认连接'),button(busy?'正在处理…':'刷新',refresh),desktopTarget?button(snapshot?.desktopConversation?'对话记录':'打开 Dot 会话',()=>navigate(desktopTarget.sessionId)):null)),h('nav',{className:'pc_dot_tabs','aria-label':'Dot 页面'},...[['home','今天'],['projects','项目'],['memory','记忆'],['settings','连接']].map(([key,label])=>button(label,()=>changePage(key),{'aria-current':page===key?'page':undefined,className:page===key?'active':''}))),
          error?h('p',{className:'pc_dot_error',role:'alert'},error):null,notice?h('p',{className:'pc_dot_notice',role:'status'},notice):null,snapshot?.paused?h('p',{className:'pc_dot_notice'},'Dot 当前已暂停主动任务。这里仍可查看已有记录。'):null,
          snapshot?(page==='projects'?projectsPage:page==='memory'?memoryPage:page==='home'?home:null):!error?h('p',{role:'status'},'正在读取项目总览…'):null,
          connectionsSeen?h('div',{hidden:page!=='settings'},h('h1',null,'按需连接，按你说的范围读取'),h('p',{className:'pc_dot_muted'},'账号授权、来源启用和实际查询分别发生。先从手头这件事需要的资料开始。'),readOnly?null:button('管理微信与关注项目',()=>setSetup(true)),h(ContextPanel,{compact:true,...(!readOnly?{onFirstValue:prompt=>stageDraft(prompt,'')}:{}),bindingRevision:contextRevision,bound:contextRevision!==null&&bound}),section('界面外观',button(appearanceState.mode==='dot'?'恢复原生外观':'启用 Dot 外观',()=>appearance.setAppearance(appearanceState.mode==='dot'?'native':'dot'),{disabled:!appearanceState.writable||appearanceState.busy}),appearanceState.error?h('p',{role:'status'},appearanceState.error):null)):null,
          h('footer',{className:'pc_dot_footer'},snapshot?`更新于 ${date(snapshot.generatedAt)} · ${snapshot.hostTimeZone??'电脑时区'}。打开页面不会启动任务或推送。`:'',snapshot?.limitations?.length?h('details',null,h('summary',null,'资料范围与状态说明'),h('ul',null,...snapshot.limitations.slice(0,12).map((t,i)=>h('li',{key:i},t)))):null)),
          drawer?h(Modal,{open:true,closeLabel:'关闭',title:drawer==='project'?project?.label??'项目详情':drawer==='follow'?'后续怎么跟进':drawer==='memory'?'纠正项目记忆':'本次执行回复',className:'pc_dot_modal',onClose:closeDrawer},h('div',{className:'pc_dot_drawer'},error?h('p',{className:'pc_dot_error',role:'alert'},error):null,closeReview?exitReview:drawer==='project'?projectDetails():drawer==='follow'?followDetails():drawer==='memory'?memoryDetails():taskDetails())):null,
          setup&&!readOnly?h(Modal,{open:true,closeLabel:'关闭',title:'连接微信与选择项目',className:'pc_setup_modal',onClose:()=>{setSetup(false);void refresh();}},h(SetupSection,{close:()=>{setSetup(false);void refresh();}})):null);
      }
      if(typeof ctx.layout?.selectPanel==='function'){
        ctx.effect(()=>{if(typeof document==='undefined')return;const tag=document.createElement('style');tag.dataset.pluginCss='dsh-project-companion/workbench';tag.textContent=dotCss+personalCss;document.head.appendChild(tag);return()=>tag.remove();});
        ctx.effect(()=>ctx.slots.inject('main',()=>ctx.slots.register({name:'main',key:dotPanel,children:{'dot.desktop.conversation':{kind:'single',scope:'session'}}},Workbench)));
        ctx.effect(()=>ctx.slots.inject('dot.desktop.conversation',()=>ctx.slots.register({name:'dot.desktop.conversation'},DesktopConversationContent)));
        ctx.effect(()=>ctx.slots.inject('dot.overlay.conversation',()=>ctx.slots.register({name:'dot.overlay.conversation'},DesktopConversationContent)));
        const DotOverlay=createDotOverlay(React,{renderConversation:props=>h(OverlayDesktopConversation,props),activateDesktop:()=>ctx.layout.selectPanel(dotPanel),useSurface:useWorkbenchSurface,focusHome:()=>workbenchSurface.focus?.()});
        registerDotOverlay(ctx,DotOverlay);
        ctx.effect(()=>ctx.slots.inject('sidebar.panellist',()=>ctx.slots.register({name:'sidebar.panellist',id:dotPanel,order:5,label:'DSH Dot'},DotIcon)));
      }
      const SetupSection=props=>Surface(props,false);
      const Section=props=>h('div',null,Surface(props,false),h(AppearancePanel),h(ContextPanel));
      ctx.effect(()=>ctx.slots.inject('settings.section',()=>ctx.slots.register({name:'settings.section',id:'project-companion',order:39,label:'DSH Dot'},Section)));
      const forms=typeof ctx.get==='function'?ctx.get('configForms',false):ctx.configForms;
      if(forms)ctx.effect(()=>ctx.slots.inject('plugins.row.config',()=>ctx.slots.register({name:'plugins.row.config',key:'dsh-project-companion#project-companion'},props=>props.view==='summary'?'DeepSeek Dot 的个人资料来源与原生凭据配置':h('div',{className:'pc_setup'},h('h3',null,'连接凭据'),h(CredentialForm)))));
    }
    return{inject,apply,createDotAppearance,prepareDotDraft,createDesktopConversationController,desktopConversationCanEmbed};
  },
});
