/** Factories stay self-contained so the official ModuleLoader can embed them. */
export function createDesktopConversationController(ctx) {
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

export function desktopConversationCanEmbed(view,targetId) {
  if (typeof view?.activePanelId==='string') return true;
  return view?.activePanelId===null && (typeof view.mainSessionId==='string' ? view.mainSessionId!==targetId : view.mainSessionId===null && view.mainViewEmpty===true);
}

/** Same-session views only; the parent Conversation factory owns its Composer. */
export function createDotConversationViews(React) {
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
