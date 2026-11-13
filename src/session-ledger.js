import {z} from 'zod';
import {createHash} from 'node:crypto';
import {isAbsolute,resolve,sep} from 'node:path';
import {redactReviewText} from './personal-review-collect.js';

/** One current item per session, as defined by DIRECTION.md section 4. */
export const LEDGER_STATES = ['doing','needs_you','done','stuck','handled','snoozed'];
const identity = z.string().min(1).max(200);
const stamp = z.string().datetime();
const what = z.string().max(160);

export const ledgerSessionSchema = z.object({
  sessionId: identity,
  root: z.string().max(4096),
  projectLabel: z.string().max(120),
  title: z.string().max(300),
  state: z.enum(LEDGER_STATES),
  what,
  lastAssistant: what,
  turnAssistant: what,
  needs: z.object({kind: z.literal('approval'), askedAt: stamp, id: z.string().max(200).optional(), callId: z.string().max(200).optional()}).strict().nullable(),
  startedAt: stamp,
  lastEventAt: stamp,
  revision: z.number().int().nonnegative(),
  seenRevision: z.number().int().nonnegative(),
  pushedRevision: z.number().int().nonnegative(),
  snoozeUntil: stamp.nullable(),
}).strict();

export const sessionLedgerRowSchema = z.object({
  id: z.literal('profile'),
  version: z.literal(1),
  revision: z.number().int().nonnegative(),
  sessions: z.array(ledgerSessionSchema).max(500),
  projects: z.array(z.object({root: z.string().max(4096),label:z.string().max(120),lastMovedAt:stamp}).strict()).max(500),
}).strict();

export const emptyLedger = () => ({id:'profile',version:1,revision:0,sessions:[],projects:[]});

const at = value => typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
const line = (value,max=160) => redactReviewText(String(value??'').split(/\r?\n/).find(text=>text.trim())??'',max).trim();
const prefix = (value,max=160) => redactReviewText(String(value??'').replace(/\s+/g,' ').trim(),max);
export const projectPublicId = root => `project_${createHash('sha256').update(String(root)).digest('hex').slice(0,24)}`;

/** A cwd belongs to a grant only when it is the root or a real descendant. */
export function grantForCwd(cwd,grants){
  if(typeof cwd!=='string'||!isAbsolute(cwd)||!Array.isArray(grants))return null;
  const target=resolve(cwd);
  const rows=grants.filter(grant=>typeof grant?.root==='string'&&isAbsolute(grant.root)).map(grant=>({...grant,root:resolve(grant.root)}));
  return rows.filter(grant=>target===grant.root||target.startsWith(grant.root+sep)).sort((a,b)=>b.root.length-a.root.length)[0]??null;
}

/** Foreground Dot conversations and Family member sessions never enter the ledger. */
export function ledgerEligible(sessionId,{foreground=new Set(),familyPrefix='family_member_'}={}){
  return typeof sessionId==='string'&&sessionId.length>0&&sessionId.length<=200&&!sessionId.startsWith(familyPrefix)&&!foreground.has(sessionId);
}

/** Apply both scope rules in one place: eligibility first, then workspace grant. */
export function ledgerTarget(sessionId,cwd,grants,{foreground=new Set()}={}){
  if(!ledgerEligible(sessionId,{foreground}))return null;
  const grant=grantForCwd(cwd,grants);
  return grant?{sessionId,grant}:null;
}

const NAME = {doing:'正在做',needs_you:'等你',done:'做完了',stuck:'卡住',handled:'已处理',snoozed:'稍后'};
const visible = state => ['doing','needs_you','done','stuck'].includes(state);

function projectRow(state,root,label,time){
  const existing=state.projects.find(row=>row.root===root);
  if(existing){existing.label=label||existing.label;existing.lastMovedAt=time;}
  else state.projects.push({root,label:label||root.split('/').at(-1)||'项目',lastMovedAt:time});
  if(state.projects.length>500)state.projects.sort((a,b)=>Date.parse(b.lastMovedAt)-Date.parse(a.lastMovedAt)),state.projects.length=500;
}

/**
 * Pure reducer for one already-scoped and already-excluded session event.
 * It does not read storage or infer scope; callers must do both first.
 */
export function reduceLedger(input,event){
  const time=at(event?.at)??new Date().toISOString();
  const kind=event?.kind;
  if(!['start','assistant','approval-asked','approval-decided','turn-end'].includes(kind))return{state:input,changed:false};
  if(typeof event.sessionId!=='string'||!event.sessionId||typeof event.root!=='string'||!isAbsolute(event.root))return{state:input,changed:false};
  const state=structuredClone(input);
  const root=resolve(event.root);
  projectRow(state,root,String(event.projectLabel??'').slice(0,120),time);
  let row=state.sessions.find(item=>item.sessionId===event.sessionId);
  let created=false;
  if(!row){
    row={sessionId:event.sessionId,root,projectLabel:String(event.projectLabel??'').slice(0,120),title:String(event.title??'').slice(0,300),state:'doing',what:'',lastAssistant:'',turnAssistant:'',needs:null,startedAt:time,lastEventAt:time,revision:1,seenRevision:0,pushedRevision:0,snoozeUntil:null};
    state.sessions.push(row);
    state.revision+=1;
    created=true;
  }else{
    row.root=root;
    row.projectLabel=String(event.projectLabel??row.projectLabel).slice(0,120);
    if(typeof event.title==='string'&&event.title.trim())row.title=event.title.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,300);
  }
  const before={state:row.state,needs:row.needs?structuredClone(row.needs):null};
  let nextState=row.state;
  let nextWhat=row.what;
  let nextNeeds=row.needs?structuredClone(row.needs):null;
  if(kind==='start'){
    nextState='doing';nextNeeds=null;row.startedAt=time;row.turnAssistant='';
  }else if(kind==='assistant'){
    const text=prefix(event.text,160);
    if(text){
      nextWhat=text;
      row.lastAssistant=text;
      row.turnAssistant=text;
    }
  }else if(kind==='approval-asked'){
    nextState='needs_you';
    const approvalId=typeof event.approvalId==='string'?event.approvalId.slice(0,200):undefined;
    const callId=typeof event.callId==='string'?event.callId.slice(0,200):undefined;
    const sameApproval=row.state==='needs_you'&&nextNeeds&&((approvalId&&nextNeeds.id===approvalId)||(!approvalId&&!nextNeeds.id));
    if(!sameApproval){
      nextNeeds={kind:'approval',askedAt:time,...(approvalId?{id:approvalId}:{}),...(callId?{callId}:{})};
      const tool=String(event.toolName??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,80);
      const reason=line(event.reasonText,120);
      nextWhat=prefix([tool,reason].filter(Boolean).join('：')||'等你批准一次工具调用',160);
    }
  }else if(kind==='approval-decided'){
    const approvalId=typeof event.approvalId==='string'?event.approvalId.slice(0,200):undefined;
    if(row.state!=='needs_you')return{state:input,changed:false};
    if(approvalId&&row.needs?.id&&approvalId!==row.needs.id)return{state:input,changed:false};
    nextState='doing';nextNeeds=null;
  }else if(kind==='turn-end'){
    const reason=event.reason??{};
    const reasonKind=typeof reason.kind==='string'?reason.kind:'';
    if(reasonKind==='completed'){nextState='done';nextNeeds=null;nextWhat=row.turnAssistant||row.lastAssistant||'';}
    else if(reasonKind==='error'){nextState='stuck';nextNeeds=null;nextWhat=line(reason.message??reason.error?.message??'本轮执行发生错误',160)||'本轮执行发生错误';}
    else if(reasonKind==='max-tokens'){nextState='stuck';nextNeeds=null;nextWhat=prefix('回答太长，被截断了',160);}
    else if(reasonKind==='aborted'){nextState='handled';nextNeeds=null;nextWhat=prefix('停了',160);}
    else if(reasonKind==='blocked'||reasonKind==='interrupted'){nextState='stuck';nextNeeds=null;nextWhat=line(reason.message??reason.error?.message??reasonKind,160)||reasonKind;}
    else return{state:input,changed:false};
  }
  const transition=created||before.state!==nextState||JSON.stringify(before.needs)!==JSON.stringify(nextNeeds);
  row.state=nextState;
  row.what=nextWhat.slice(0,160);
  row.needs=nextNeeds;
  row.lastEventAt=time;
  if(transition&&!created){
    row.revision+=1;
    state.revision+=1;
  }
  // Keep storage inside the schema bound without dropping the row just updated.
  if(state.sessions.length>500){
    const rank=value=>value.state==='doing'||value.state==='needs_you'?0:1;
    state.sessions=[...state.sessions].sort((a,b)=>rank(a)-rank(b)||Date.parse(b.lastEventAt)-Date.parse(a.lastEventAt)).slice(0,500);
  }
  return{state,changed:true,transition};
}

const matchesCard = (row, expected) => !expected ||
  (row.root === expected.root && row.state === expected.state && row.revision === expected.revision);

/** Manual card actions (handled / snoozed) change only the visible state of one
 *  already-recorded session. They never invent a turn or touch the host agent. */
export function setSessionState(input, sessionId, nextState, at = new Date().toISOString(), expected = null) {
  if (!['handled', 'snoozed'].includes(nextState)) return {state: input, changed: false};
  const state = structuredClone(input);
  const row = state.sessions.find(item => item.sessionId === sessionId);
  if (!row || !visible(row.state) || !matchesCard(row, expected)) return {state: input, changed: false};
  row.state = nextState;
  row.snoozeUntil = nextState === 'snoozed' ? at : null;
  row.revision += 1;
  state.revision += 1;
  row.lastEventAt = at;
  return {state, changed: true, rowRevision: row.revision};
}

/** Undo restores the exact visible state the action replaced. Unlike a fresh
 *  ledger transition, this may return a row to needs_you / stuck / done. */
export function restoreSessionState(input, sessionId, nextState, at = new Date().toISOString(), expected = null) {
  if (!['doing', 'needs_you', 'stuck', 'done'].includes(nextState)) return {state: input, changed: false};
  const state = structuredClone(input);
  const row = state.sessions.find(item => item.sessionId === sessionId);
  if (!row || !['handled', 'snoozed'].includes(row.state) || !matchesCard(row, expected)) return {state: input, changed: false};
  row.state = nextState;
  row.snoozeUntil = null;
  row.revision += 1;
  state.revision += 1;
  row.lastEventAt = at;
  return {state, changed: true};
}

/** Turn the persisted row into the exact projection shape of DESIGN.md 3.8.
 *  `grants` is the current authorization snapshot. A null grant list means the
 *  caller is a synthetic test; production callers always pass current grants so
 *  revoked roots disappear from sessions, counts and project last-moved time. */
export function projectLedger(state,{connection='unknown',grants=null}={}){
  const allowed=root=>grants===null?true:!!grantForCwd(root,grants);
  const rows=(Array.isArray(state?.sessions)?state.sessions:[]).filter(row=>allowed(row.root));
  const visibleRows=rows.filter(row=>visible(row.state)).sort((a,b)=>Date.parse(b.lastEventAt)-Date.parse(a.lastEventAt));
  const counts={done:0,wait:0,stuck:0,run:0,total:visibleRows.length};
  for(const row of visibleRows){
    if(row.state==='done')counts.done+=1;
    else if(row.state==='needs_you')counts.wait+=1;
    else if(row.state==='stuck')counts.stuck+=1;
    else if(row.state==='doing')counts.run+=1;
  }
  const projects=(Array.isArray(state?.projects)?state.projects:[])
    .filter(row=>typeof row?.root==='string'&&isAbsolute(row.root)&&allowed(row.root))
    .sort((a,b)=>Date.parse(b.lastMovedAt)-Date.parse(a.lastMovedAt))
    .map((row,index)=>({id:projectPublicId(row.root),name:String(row.label??'').slice(0,80),slot:index,lastMovedAt:row.lastMovedAt}));
  return{
    revision:Number.isSafeInteger(state?.revision)?state.revision:0,
    reachable:true,
    counts,
    sessions:visibleRows.map(row=>({
      projectId:projectPublicId(row.root),state:row.state,title:String(row.title??'').slice(0,300),what:String(row.what??'').slice(0,160),
      short:NAME[row.state]??'状态待确认',at:row.lastEventAt,startedAt:row.startedAt,
      // Opaque card identity: binds the action to this session, its revision and
      // its visible state without exposing the session id to the page.
      cardId:createHash('sha256').update(`${row.sessionId}\n${row.revision}\n${row.state}`).digest('hex').slice(0,32),
    })),
    projects,
    promises:[],
    noticed:[],
    sources:[],
    connection:{wechat:['bound','none','unknown'].includes(connection)?connection:'unknown'},
    sample:false,
  };
}

/** One readable front-door answer over every project in the ledger. */
export function ledgerText(projection){
  if(!projection?.counts?.total&&!projection?.projects?.length)return '会话账本还是空的：升级后还没有看到任何已授权文件夹里的会话动静。';
  const byId=new Map((projection.projects??[]).map(project=>[project.id,project.name]));
  const lines=[`会话账本：${projection.projects?.length??0} 个项目，${projection.counts.total} 个会话。正在做 ${projection.counts.run}，等你 ${projection.counts.wait}，卡住 ${projection.counts.stuck}，做完待看 ${projection.counts.done}。`];
  for(const session of projection.sessions??[]){
    const name=byId.get(session.projectId)??'项目';
    const title=session.title?`「${session.title}」`:'';
    const detail=session.what?`：${session.what}`:'';
    lines.push(`- ${name}${title} · ${session.short}${detail}`);
  }
  return lines.join('\n').slice(0,4000);
}

/** Serialized persistence. `apply` never runs concurrently, so events cannot drop rows. */
export function createSessionLedger({store,clock=()=>new Date(),isClosed=()=>false}={}){
  if(!store?.get||!store?.put)throw new Error('Session ledger store required');
  let state=null,queue=Promise.resolve();
  const serial=work=>{const run=queue.then(work);queue=run.catch(()=>{});return run;};
  const load=async()=>{
    if(state)return state;
    const stored=await store.get('profile');
    state=stored==null?emptyLedger():sessionLedgerRowSchema.parse(stored);
    return state;
  };
  const save=next=>store.put('profile',structuredClone(next));
  return{
    async apply(event){
      if(isClosed())return{changed:false,revision:0};
      return serial(async()=>{
        await load();
        const next=reduceLedger(state,event);
        if(!next.changed)return{changed:false,revision:state.revision};
        // Persist first: a failed write must leave the in-memory view on the
        // last successfully saved revision instead of serving unsaved state.
        await save(next.state);
        state=next.state;
        return{changed:true,transition:next.transition===true,revision:state.revision};
      });
    },
    async snapshot({connection='unknown',grants=null}={}){
      if(isClosed())throw new Error('Session ledger closed');
      return serial(async()=>{await load();return projectLedger(state,{connection,grants});});
    },
    /** Internal lookup for card actions. Never returned by the activity route. */
    async internal(){
      if(isClosed())throw new Error('Session ledger closed');
      return serial(async()=>{await load();return structuredClone(state);});
    },
    async setState(sessionId,nextState,expected=null){
      if(isClosed())throw new Error('Session ledger closed');
      return serial(async()=>{
        await load();
        const next=setSessionState(state,sessionId,nextState,new Date().toISOString(),expected);
        if(!next.changed)return{changed:false,revision:state.revision};
        await save(next.state);
        state=next.state;
        return{changed:true,revision:state.revision,rowRevision:next.rowRevision};
      });
    },
    /** Undo only: restore the previous visible state of a handled/snoozed row. */
    async restoreState(sessionId,nextState,expected=null){
      if(isClosed())throw new Error('Session ledger closed');
      return serial(async()=>{
        await load();
        const next=restoreSessionState(state,sessionId,nextState,new Date().toISOString(),expected);
        if(!next.changed)return{changed:false,revision:state.revision};
        await save(next.state);
        state=next.state;
        return{changed:true,revision:state.revision};
      });
    },
    async close(){state=null;},
  };
}
