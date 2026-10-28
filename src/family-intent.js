// Conservative admission only. It uses the Family gateway's actual Owner
// message, never a model-provided interpretation or a retrieved document.
import {familyScopedContextAllowed,normalizeFamilyScopedContext} from './family-context-intent.js';
import {parseFamilyCatalogList} from './project-catalog-intent.js';
const effects={
  coordinate:{want:/(交给|交办|派给|派发|安排.+(?:做|执行)|让.{0,24}(?:做|处理|检查|核对|分析)|(?:帮我|请).{0,24}(?:执行|检查|核对|处理|分析))/,target:/(交办|派发|执行|处理|交给)/},
  context_handoff:{want:/(交给|交办|派给|派发|安排.+(?:做|执行)|让.{0,24}(?:做|处理|检查|核对|分析)|(?:帮我|请).{0,24}(?:执行|检查|核对|处理|分析))/,target:/(交办|派发|执行|处理|交给)/},
  check_once:{want:/(?:一次|一遍).{0,18}(?:检查|跟进|提醒)|(?:检查|跟进|提醒).{0,18}(?:一次|一遍)|(?:\d+|[一二两三四五六七八九十]+)\s*分钟后.{0,18}(?:检查|跟进|提醒)/,target:/(检查|跟进|提醒|一次|单次)/},
  configure_followup:{want:/(?:每|每日|每天|定期|周期).{0,24}(?:跟进|检查)|(?:跟进|检查).{0,24}(?:每|定期|周期)/,target:/(周期|定期|每天|每日|跟进|检查)/},
  configure_daily:{want:/(?:每天|每日|每早|每晚).{0,24}(?:日报|简报|汇报|报告)|(?:日报|简报|汇报).{0,24}(?:每天|每日|每早|每晚)/,target:/(日报|简报|汇报|每天|每日|定时)/},
  remind:{want:/(?:提醒|闹钟)/,target:/(提醒|闹钟)/},
  send_now:{want:/(?:发给我|发送|推送|发.{0,12}(?:日报|简报|资讯)|(?:日报|简报|资讯).{0,12}(?:发|推))/,target:/(发送|推送|发给|发.{0,12}(?:日报|简报|资讯))/},
  configure:{want:/(?:每天|每日|每早|每晚).{0,24}(?:日报|简报|资讯)|(?:日报|简报|资讯).{0,24}(?:每天|每日|每早|每晚)/,target:/(日报|简报|资讯|每天|每日|定时)/},
};
const cancellations={cancel_once:/(取消|关闭|停止|撤销).{0,20}(检查|跟进|提醒)/,cancel_followup:/(取消|关闭|停止|撤销).{0,20}(跟进|检查)/,cancel_daily:/(取消|关闭|停止|撤销).{0,20}(日报|简报|汇报)/,cancel_reminder:/(取消|关闭|停止|撤销).{0,20}(提醒|闹钟)/,cancel:/(取消|关闭|停止|撤销).{0,20}(日报|资讯|简报)/};
const sourceNames={gmail:/(gmail|邮件|邮箱)/i,calendar:/(calendar|日历|日程|会议安排)/i,drive:/(drive|云盘|网盘)/i,docs:/(docs|文档)/i,sheets:/(sheets|表格)/i,slides:/(slides|幻灯片|演示文稿)/i,dida:/(滴答|ticktick|待办清单|任务清单)/i,flomo:/(flomo|笔记)/i};
const readonly=new Set(['connections','query','brief','list','digest','project_update','context_brief','context_status','memory','once_status','followup_status','status','task_status','preview']);
const taskEffects=[/(删除|清空|清除|销毁|抹除|\brm\b|\bdrop\b)/i,/(修改|更改|写入|覆盖|新建|创建|新增|更新|编辑)/,/(上传|发布|发送|共享|外发|部署|合并|提交)/,/(执行命令|运行命令|运行脚本|shell|终端命令|\bsudo\b)/i];
// Timing, body and selected target are model arguments, not yet reconstructed
// from authenticated Owner text. Never schedule or send them from this route.
export function familyUnverifiedPlanAction(action){return ['check_once','configure_followup','configure_daily','remind','send_now','configure','cancel_once','cancel_followup','cancel_daily','cancel_reminder','cancel'].includes(action);}
// Only audited Owner entry points are reachable; new tool actions do not
// silently inherit Family authority when other plugins add capabilities.
export function familyActionAllowed(args){return ['connections','query','context_brief','context_handoff','coordinate','list'].includes(args?.action)||(args?.action==='task_status'&&typeof args.id==='string'&&(args.id.startsWith('family-read-')||/^task_[a-f0-9-]{36}$/.test(args.id)));}
// Derive a rolling calendar window from the verified Owner message, not the
// model's clock. All source, qualifier, count and denial checks still run below.
export function familyNormalizeCalendar(args,userText,now=new Date(),previousUserText){
  if(!args||typeof userText!=='string'||!(now instanceof Date)||!Number.isFinite(now.getTime()))return args;
  args=normalizeFamilyScopedContext(args,userText,previousUserText,now);
  const clauses=userText.split(/[，,。；;！？!?\n]/u).map(c=>c.trim()).filter(Boolean);
  const requested=clauses.filter(c=>sourceNames.calendar.test(c)&&/(?:未来|接下来|之后)\s*(?:24|二十四)\s*(?:小时|h)/i.test(c));
  if(requested.length!==1)return args;
  const normalize=q=>q?.source==='calendar'&&q.operation==='upcoming'?{...q,from:now.toISOString(),to:new Date(now.getTime()+86400000).toISOString()}:q;
  if(args.action==='context_brief'&&Array.isArray(args.queries))return{...args,queries:args.queries.map(normalize)};
  if(args.action==='query'&&args.source==='calendar')return normalize(args);
  return args;
}
const positive=(text,pattern)=>text.split(/[，,。；;！？!?\n]/u).some(clause=>{
  const matcher=new RegExp(pattern.source,[...new Set((pattern.flags+'g').split(''))].join(''));
  for(const match of clause.matchAll(matcher)){const prefix=clause.slice(Math.max(0,match.index-5),match.index);if(!/(?:不|无需|别|禁止).{0,2}$/u.test(prefix))return true;}
  return false;
});
export function familyReadOnlyIntent(text){
  if(typeof text!=='string'||!text.trim()||text.length>64000||/(?:不要|不|别|无需).{0,3}只读/.test(text))return false;
  return /只读|仅(?:看|查看|检查)|只(?:看|查看|检查)|不(?:要|能|得|许)?.{0,4}(?:修改|写入|创建|删除|更改|改文件)|(?:别|不得|禁止).{0,4}(?:修改|写入|创建|删除|更改|改文件)/.test(text);
}
export function familySelectedItemAllowed(text,items,itemId){
  if(typeof text!=='string'||!Array.isArray(items)||!items.length||typeof itemId!=='string')return false;
  const numbers={'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9};
  const matches=[...text.matchAll(/第([一二两三四五六七八九1-9])(?:项|条|个)/g)];
  if(matches.length>1)return false;
  let candidates=items;
  if(/建议下一步|下一步建议|建议的下一步/.test(text))candidates=items.filter(item=>item.section==='nextSteps');
  if(matches.length===1){const n=numbers[matches[0][1]]??Number(matches[0][1]);return candidates[n-1]?.id===itemId;}
  if(candidates.length===1&&/(这项|这一项|这条|第一步|下一步)/.test(text))return candidates[0].id===itemId;
  const named=items.filter(item=>typeof item.text==='string'&&item.text.length>=4&&text.includes(item.text));
  return named.length===1&&named[0].id===itemId;
}
export function familyIntentAllowed(tool,args,userText,previousUserText,now=new Date()){
  if(typeof userText!=='string'||!userText.trim()||userText.length>64000)return false;
  if(familyScopedContextAllowed(args,userText,previousUserText,now))return true;
  if(args?.action==='list')return parseFamilyCatalogList(args,userText)!==null;
  // Only the immediately preceding verified Owner message can inform an
  // explicit continuation; retrieved content never supplies user intent.
  const mentionsSource=Object.values(sourceNames).some(name=>name.test(userText));
  const sourceText=!mentionsSource&&/(继续|刚才|上一条|上次|那份|上述)/.test(userText)&&typeof previousUserText==='string'&&previousUserText.length<=64000?previousUserText+'。'+userText:userText;
  const action=args?.action;
  const requested=action==='context_brief'&&Array.isArray(args.queries)?args.queries.map(q=>q?.source):action==='query'?[args.source]:action==='brief'&&Array.isArray(args.sources)?args.sources:[];
  if(requested.length){
    if(args.userRequested!==true||requested.some(source=>!sourceNames[source]))return false;
    const clauses=sourceText.split(/[，,。；;！？!?\n]/u).map(x=>x.trim()).filter(Boolean);
    const currentClauses=userText.split(/[，,。；;！？!?\n]/u).map(x=>x.trim()).filter(Boolean);
    if(currentClauses.some(c=>/(?:不要|不用|无需|别|禁止|不准|不许|不得).{0,8}(?:读|看|查|搜索|读取)/.test(c)&&!Object.values(sourceNames).some(name=>name.test(c))))return false;
    const all=/(?:所有|全部|各个).{0,8}(?:资料|来源|账户)/.test(sourceText);
    if(clauses.some(clause=>/(?:不要|不需要|不用|无需|别|禁止|不准|先不|不).{0,12}(?:读取|查阅|查看|搜索|扫描|访问|读|看|查|取).{0,10}(?:任何|所有|全部|各个)?(?:个人)?(?:来源|资料|账户)/.test(clause)))return false;
    for(const source of requested){
      const name=sourceNames[source];
      if(!all&&!name.test(sourceText))return false;
      if(clauses.some(clause=>/(?:不要|不需要|不用|无需|别|禁止|不准|不许|不可|不得|不允许|不再|先不|排除|除外|以外|除了)/.test(clause)&&name.test(clause)))return false;
    }
    // Explicit quantity is an upper bound even if a model omits limit. Use
    // the smallest stated cap when attribution to sources is ambiguous.
    const nums={'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10};
    const caps=[...sourceText.matchAll(/([一二两三四五六七八九十]|\d+)\s*(?:条|项|个|篇)/g)].filter(x=>sourceText[x.index-1]!=='第').map(x=>nums[x[1]]??Number(x[1]));
    const queries=action==='context_brief'?args.queries:action==='query'?[args]:[];
    // Family private reads support only explicitly bounded templates. Arbitrary
    // natural-language qualifiers are not safely equivalent to provider query
    // parameters, so unsupported source/filters must stop before any read.
    if(action==='brief'||queries.some(q=>!['flomo','calendar'].includes(q.source))||new Set(queries.map(q=>q.source)).size!==queries.length)return false;
    // Individual resource IDs and structured mail/file filters require a
    // trusted parser; model-generated IDs and search syntax cannot grant access.
    if(queries.some(q=>q.id!==undefined||q.ids!==undefined||q.projectId!==undefined||q.range!==undefined))return false;
    for(const q of queries.filter(q=>['gmail','drive'].includes(q.source))){
      const related=clauses.filter(c=>sourceNames[q.source].test(c)||!Object.values(sourceNames).some(name=>name.test(c)));
      if(related.some(c=>/只查|仅查|只看|仅看|发的|发来|来自|发件人|收件人|标题|主题|名称|名字|文件名|名为|关键字|关键词|搜索|筛选|查找|包含|排除|有关|关于|发给|写的|from:|subject:/i.test(c)))return false;
    }
    if(caps.length&&action==='brief')return false; // brief hard-codes three.
    if(caps.length&&queries.some(q=>!Number.isInteger(q.limit)||q.limit>Math.min(...caps)))return false;
    // Search terms must be grounded in the verified message when explicitly
    // specified. If syntax is ambiguous, ask instead of widening the query.
    const searchClauses=clauses.filter(c=>sourceNames.flomo.test(c)&&/(搜索|查找|关键词)/.test(c));
    for(const clause of searchClauses){
      const match=clause.match(/(?:搜索|查找|关键词(?:是|为)?)\s*[“"「']?([a-zA-Z0-9_.-]{2,80})/i);
      if(!match)return false;
      for(const q of queries.filter(q=>q.source==='flomo'))if(q.operation!=='search'||typeof q.query!=='string'||q.query.toLowerCase()!==match[1].toLowerCase())return false;
    }
    for(const q of queries){
      const matched=clauses.filter(c=>sourceNames[q.source].test(c));if(matched.length!==1||!Number.isInteger(q.limit)||!caps.length)return false;
      let fragment=matched[0].toLowerCase();
      if(q.source==='flomo'){
        if(q.operation!=='search'||typeof q.query!=='string'||!searchClauses.includes(matched[0]))return false;
        fragment=fragment.replace(q.query.toLowerCase(),'').replace(/flomo|从|在|请|帮我|搜索|查找|关键词|为|是|笔记|内容|最多|不超过|至多|上限|只要|条|项|个|篇|的|[\d一二两三四五六七八九十]|[\s“”"「」']/g,'');
      }else{
        if(q.operation!=='upcoming'||!/(?:未来|接下来|之后)\s*(?:24|二十四)\s*(?:小时|h)/i.test(fragment))return false;
        fragment=fragment.replace(/calendar|日历|日程|请|帮我|查看|查一下|查|看一下|看看|读取|从|在|的|未来|接下来|之后|小时|h|最多|不超过|至多|上限|只要|条|项|个|篇|内|[\d一二两三四五六七八九十]|\s/g,'');
      }
      if(fragment)return false;
    }
    // Check the entire Owner utterance, not only clauses containing a source.
    // Any unrecognized additional clause might narrow the requested data (e.g.
    // "只看 Zoom 会议"), so do not let it silently disappear.
    for(const clause of clauses){
      if(queries.some(q=>sourceNames[q.source].test(clause)))continue;
      if(/^(?:请|帮我)?(?:生成|整理|查看)(?:一份|这份|项目的?)?(?:项目)?简报$/.test(clause)||/^(?:请|帮我)?(?:生成|整理|查看)\s*[\p{L}\p{N}_ -]{2,80}\s*(?:的)?项目简报$/u.test(clause)||/^(?:请|帮我)?继续(?:刚才|上次|上一条|那份|上述)?(?:的)?(?:那份|项目)?(?:简报)?$/.test(clause)||/^(?:先)?不要(?:执行任务|安排推送|设置提醒|建立计划)$/.test(clause))continue;
      return false;
    }
    // Calendar-day and relative ranges cannot be recovered safely from free
    // form text; do not let model-provided dates silently choose the scope.
    if(/今天|今日|昨天|昨日|明天|明日|本周|这周|下周|上周|本月|上月|下月|最近|过去|星期[一二三四五六日天]|周[一二三四五六日天]|\d{4}\s*年|\d{1,2}\s*月\s*\d{1,2}\s*[日号]|\d{4}[-/]\d{1,2}[-/]\d{1,2}|[一二两三四五六七八九十\d]+\s*点|\d{1,2}:\d{2}|(?:近|前|后)\s*[一二两三四五六七八九十\d]+\s*(?:天|日|周|月)/.test(sourceText))return false;
    const futureRanges=[...sourceText.matchAll(/(?:未来|接下来|之后)\s*([一二两三四五六七八九十\d]+)\s*(小时|h|天|日|周|月)/gi)];
    if(futureRanges.some(match=>!['24','二十四'].includes(match[1])||!['小时','h'].includes(match[2].toLowerCase())))return false;
    if(/(?:未来|接下来|之后)\s*(?:24|二十四)\s*(?:小时|h)/i.test(sourceText)){
      const timestamp=now instanceof Date?now.getTime():NaN;if(!Number.isFinite(timestamp))return false;
      for(const q of queries.filter(q=>q.source==='calendar')){
        if(q.operation!=='upcoming'||q.calendarId!==undefined&&q.calendarId!=='primary')return false;
        if(typeof q.from!=='string'||typeof q.to!=='string')return false;
        const from=Date.parse(q.from),to=Date.parse(q.to);
        if(!Number.isFinite(from)||!Number.isFinite(to)||from<timestamp-3000||to>timestamp+86400000+3000||to<=from)return false;
      }
    }
  }
  if(cancellations[action])return positive(userText,cancellations[action]);
  const rule=effects[action];
  if(!rule)return readonly.has(action);
  if(['coordinate','context_handoff'].includes(action)){
    if(typeof args.task!=='string'||!args.task.trim())return false;
    for(const effect of taskEffects)if(positive(args.task,effect)&&!positive(userText,effect))return false;
  }
  if(/(?:只|仅|先)(?:是)?预览|不要.{0,6}(?:实际|真正)?(?:启用|发送|执行)|先不.{0,6}(?:启用|发送|执行)/.test(userText))return false;
  if(args.userRequested!==true||/(?:能否|能不能|是否可以).{0,16}(?:支持|实现|做到)/.test(userText))return false;
  const clauses=userText.split(/[，,。；;！？!?\n]/u).map(x=>x.trim()).filter(Boolean);
  for(const clause of clauses){
    if(!/(?:不要|不需要|不用|无需|别|禁止|不准|不许|不可|不得|不允许|不再|只预览|仅预览|先不)/.test(clause))continue;
    if(rule.target.test(clause))return false;
    if(['check_once','configure_followup','configure_daily','remind','configure'].includes(action)&&/(?:任何|所有|全部)?(?:计划|安排)/.test(clause)&&!(action==='check_once'&&/(周期|每天|每日|定时|反复|重复)/.test(clause)))return false;
  }
  return rule.want.test(userText);
}
