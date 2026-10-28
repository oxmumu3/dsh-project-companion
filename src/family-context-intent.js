/** A small, deterministic scope parser. Its input is authenticated Owner text,
 * never retrieved content. It grants known read operations, not provider tools. */
const names={gmail:/Gmail|Google\s*邮箱|谷歌邮箱|邮箱|邮件/iu,calendar:/Google\s*日历|谷歌日历|calendar|日历|日程/iu,drive:/Google\s*Drive|Drive|谷歌云盘|云盘|网盘/iu,flomo:/flomo|笔记/iu,dida:/滴答清单|滴答|TickTick/iu};
const pairs={'「':'」','“':'”','"':'"',"'":"'"};
const requestPrefix=/^(?:(?:请|帮我|麻烦|从|在|看看|看一下|查看|查一下|查下|查询|读一下|读取|列出|结合|我的|我)\s*)/u;
const clean=text=>typeof text==='string'&&text.trim().length>0&&text.length<=64000&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text);
function tokenize(text){
  let quote=null,part='',masked='',parts=[];
  for(const ch of text){
    if(quote){part+=ch;if(ch===quote){quote=null;masked+=' Q ';}continue;}
    if(pairs[ch]){quote=pairs[ch];part+=ch;continue;}
    if(/[，,。；;！？!?\n]/u.test(ch)){if(part.trim())parts.push(part.trim());part='';masked+=ch;}
    else{part+=ch;masked+=ch;}
  }
  if(quote)return null;if(part.trim())parts.push(part.trim());
  return{parts,masked};
}
function outsideQuotes(text){let end=null,out='';for(const ch of text){if(end){if(ch===end){end=null;out+=' Q ';}}else if(pairs[ch])end=pairs[ch];else out+=ch;}return end?null:out;}
function number(text){if(/^\d+$/u.test(text))return Number(text);const d={'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9};if(text==='十')return 10;if(d[text])return d[text];const m=/^([一二三四五六七八九])?十([一二三四五六七八九])?$/u.exec(text);return m?(d[m[1]]??1)*10+(d[m[2]]??0):NaN;}
function stripPrefix(text){let value=text.trim(),next;while((next=value.replace(requestPrefix,'').trim())!==value)value=next;return value;}
function keyword(text){
  const m=/^(?:搜索|查找|检索|找一下|搜一下|搜|查|找)\s*(.+)$/u.exec(text);if(!m)return null;
  let q=m[1].trim();if(pairs[q[0]]){if(q.at(-1)!==pairs[q[0]])return null;q=q.slice(1,-1);}
  else if(!/^[A-Za-z0-9_.@:+-]{2,100}$/u.test(q))return null;
  return clean(q)&&q.length<=500&&!/[\r\n]/u.test(q)?q:null;
}
function sourceClause(clause,now){
  const outside=outsideQuotes(clause);if(outside===null)return null;
  const sources=Object.keys(names).filter(s=>names[s].test(outside));if(sources.length!==1)return null;
  const source=sources[0];let body=stripPrefix(clause),match=names[source].exec(body);
  if(!match||match.index!==0)return null;body=body.slice(match[0].length).trim().replace(/^(?:里面|里|中|的)\s*/u,'');
  const cap=/\s*(?:(?:最多|不超过|至多|上限|只要)\s*)?([一二两三四五六七八九十\d]+)\s*(?:条|项|个|篇)\s*$/u.exec(body);
  let limit=3;if(cap){const n=number(cap[1]);if(!Number.isSafeInteger(n)||n<1)return null;limit=Math.min(n,10);body=body.slice(0,cap.index).trim();}
  if(source==='calendar'){
    body=stripPrefix(body);let hours=24;
    if(body){const m=/^(?:未来|接下来|之后)\s*([一二两三四五六七八九十\d]+)\s*(小时|h|天|日)(?:内|的)?$/iu.exec(body);if(!m)return null;hours=number(m[1])*(/天|日/u.test(m[2])?24:1);}
    if(!Number.isFinite(hours)||hours<1||hours>168)return null;
    return{source,operation:'upcoming',from:now.toISOString(),to:new Date(now.getTime()+hours*3600000).toISOString(),limit};
  }
  if(source==='dida'){
    body=stripPrefix(body);
    if(pairs[body[0]]){const close=body.indexOf(pairs[body[0]],1);if(close>1&&/^(?:清单|项目)?(?:的)?(?:未完成|待办)任务$/u.test(body.slice(close+1).trim())){const query=body.slice(1,close);return clean(query)&&query.length<=180?{source,operation:'tasks',query,limit}:null;}}
    if(!/^(?:清单|项目|清单列表|项目列表)?$/u.test(body))return null;
    return{source,operation:'projects',limit};
  }
  const query=keyword(body);return query===null?null:{source,operation:'search',query,limit};
}
function harmless(clause){
  return /^(?:先)?不要(?:执行任务|安排推送|设置提醒|建立计划|修改文件)$/u.test(clause)
    ||/^(?:请|帮我)?(?:生成|整理|查看)\s*[\p{L}\p{N}_ -]{0,80}\s*(?:的)?项目简报$/u.test(clause)
    ||/^(?:请|帮我)?(?:生成|整理)(?:一份|这份)?简报$/u.test(clause)
    ||/^(?:请|帮我)?继续(?:刚才|上次|上一条|那份|上述)?(?:的)?(?:查询|简报)$/u.test(clause)
    ||/^完成后(?:把结果)?(?:回给我|回复我|回我)$/u.test(clause);
}
export function parseFamilyContextSelection(userText,previousUserText,now=new Date()){
  if(!clean(userText)||!(now instanceof Date)||!Number.isFinite(now.getTime()))return null;
  let token=tokenize(userText);if(!token)return null;
  if(!Object.values(names).some(n=>n.test(token.masked))&&/继续|刚才|上一条|上次|那份/u.test(userText)&&clean(previousUserText)){
    token=tokenize(previousUserText+'。'+userText);if(!token)return null;
  }
  if(/如果|假设|假如|示例|举例|(?:能否|能不能|是否可以).{0,16}(?:支持|实现|做到)/u.test(token.masked))return null;
  const queries=[];
  for(const clause of token.parts){
    if(harmless(clause))continue;
    const outside=outsideQuotes(clause);
    if(outside===null||/不要|不用|无需|禁止|不准|不许|不得|先不|别(?:查|看|读|搜索)/u.test(outside))return null;
    const query=sourceClause(clause,now);if(!query||queries.some(q=>q.source===query.source))return null;queries.push(query);
  }
  return queries.length>0&&queries.length<=5?{queries}:null;
}
function matches(query,expected,maximum){
  if(!query||typeof query!=='object'||Array.isArray(query)||Object.entries(query).some(([k,v])=>v!==undefined&&!['source','operation','query','limit','from','to','calendarId','rollingWindowHours'].includes(k)))return false;
  if(query.source!==expected.source||query.operation!==expected.operation||!Number.isInteger(query.limit)||query.limit<1||query.limit>Math.min(expected.limit,maximum))return false;
  if(expected.source==='calendar'){
    if(query.query!==undefined||query.calendarId!==undefined&&query.calendarId!=='primary')return false;
    if(query.rollingWindowHours!==undefined&&(query.rollingWindowHours!==24||Date.parse(expected.to)-Date.parse(expected.from)!==86400000))return false;
    // A saved loop deliberately stores the rolling window's meaning, rather
    // than yesterday's absolute dates. Only the same trusted 24h request can
    // authorize its reuse; the internal marker is stripped before provider I/O.
    if(query.rollingWindowHours===24&&query.from===undefined&&query.to===undefined)return true;
    const from=Date.parse(query.from),to=Date.parse(query.to);return Number.isFinite(from)&&Number.isFinite(to)&&to>from&&Math.abs(from-Date.parse(expected.from))<=3000&&Math.abs(to-Date.parse(expected.to))<=3000;
  }
  if(query.from!==undefined||query.to!==undefined||query.calendarId!==undefined||query.rollingWindowHours!==undefined)return false;
  return query.query===expected.query;
}
export function familyScopedContextAllowed(args,userText,previousUserText,now=new Date()){
  if(args?.userRequested!==true||!['query','context_brief'].includes(args.action))return false;
  const selected=parseFamilyContextSelection(userText,previousUserText,now);if(!selected)return false;
  const maximum=args.action==='context_brief'?3:10;
  const requested=args.action==='context_brief'?args.queries:[Object.fromEntries(['source','operation','query','limit','from','to','calendarId'].filter(k=>args[k]!==undefined).map(k=>[k,args[k]]))];
  if(!Array.isArray(requested)||requested.length<1||requested.length>5||new Set(requested.map(q=>q?.source)).size!==requested.length)return false;
  if(args.action==='context_brief'&&requested.length!==selected.queries.length)return false;
  return requested.every(q=>{const expected=selected.queries.find(e=>e.source===q?.source);return !!expected&&matches(q,expected,maximum);});
}
export function normalizeFamilyScopedContext(args,userText,previousUserText,now=new Date()){
  const selected=parseFamilyContextSelection(userText,previousUserText,now);if(!selected||!args)return args;
  const expected=selected.queries.find(q=>q.source==='calendar');if(!expected)return args;
  const normalize=q=>q?.source==='calendar'&&q.operation==='upcoming'?{...q,from:expected.from,to:expected.to,...(args.action==='context_brief'&&Date.parse(expected.to)-Date.parse(expected.from)===86400000?{rollingWindowHours:24}:{})}:q;
  return args.action==='context_brief'&&Array.isArray(args.queries)?{...args,queries:args.queries.map(normalize)}:args.action==='query'?normalize(args):args;
}
