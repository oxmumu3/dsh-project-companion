// Only trusted candidate URLs become links. Model and RSS prose is plain text.
import {normalizeNewsTopics} from './news-topics.js';
export const NEWS_MESSAGE_LIMIT = 3200;
const clean = value => String(value ?? '').toWellFormed().replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();
const clip = (text,n) => { let value=''; for(const c of clean(text)){if(value.length+c.length>n)break;value+=c;}return value; };
const ellipsis = (value,n) => {const source=clean(value);return source.length>n?`${clip(source,n-1)}…`:source;};
const prose = (value,n) => clip(String(value??'').replace(/<[^>]*>/g,' ').replace(/(?:https?:\/\/|www\.)\S+/gi,'').replace(/[\[\]()*_`#<>\\]/g,' '),n);
export function newsPublicUrl(value){
  if(typeof value!=='string'||value.length>1600||/[\s<>\\]/.test(value))throw new Error('原文 URL 无效');
  let url;try{url=new URL(value);}catch{throw new Error('原文 URL 无效');}
  const h=url.hostname.toLowerCase();
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password||!h.includes('.')||h.includes(':')||/(?:^|\.)(?:localhost|local|internal|invalid)$/.test(h)||/^(?:0|10|127)\.|^169\.254\.|^192\.168\.|^172\.(?:1[6-9]|2\d|3[01])\./.test(h))throw new Error('原文 URL 必须是公开链接');
  return url.href;
}
export function renderNewsDigest({items=[],generatedAt=new Date().toISOString(),stats={},timeZone='UTC',topics,topicSource='temporary',preview=true}={}){
  const focus=normalizeNewsTopics(topics);
  if(!Array.isArray(items)||items.length>10)throw new Error('资讯最多 10 篇');
  const source=items.map(item=>({id:item.id,sourceUrl:item.sourceUrl??null,publishedAt:item.publishedAt??null,truncated:item.truncated===true,url:newsPublicUrl(item.url),title:prose(item.title,54)||'未命名文章',sourceName:ellipsis(prose(item.sourceName,100),22)||'RSS 来源',summary:prose(item.summary,210),why:prose(item.why,70),coverage:item.coverage==='article'?'article':'feed-only'}));
  const localDate=value=>{if(!Number.isFinite(Date.parse(value)))return '日期未知';try{const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value)).map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}`;}catch{return new Date(value).toISOString().slice(0,10);}};
  const displayDate=localDate(generatedAt);
  const footer='来源为最近 24 小时 RSS 候选；摘要依据已取得的材料，未独立核验全部事实。';
  function render(rows,summaryLimit,whyLimit){
    const deep=Math.min(3,rows.length),brief=Math.max(0,rows.length-3);
    const lines=[`## AI 资讯日报 · ${displayDate}`,`${deep} 篇重点 · ${brief} 篇速览`];
    if(focus)lines.push(`${topicSource==='saved'?'已保存关注点':'本次关注点'}：${focus.map(topic=>prose(topic,80)||'（关注点文字已过滤）').join('、')}`);
    if(focus&&preview)lines.push('仅本次预览；未发送、未创建或修改推送计划。');
    if(rows.length<10)lines.push(`本次仅有 ${rows.length} 篇可用，来源不足 10 篇或受单条消息长度限制，不补凑。`);
    if(!rows.length)lines.push('没有符合本次窗口及去重条件的可用文章。');
    if(Number.isInteger(stats.totalFeeds))lines.push(`来源：${stats.succeededFeeds??0}/${stats.totalFeeds} 个获取成功${stats.failedFeeds?`；${stats.failedFeeds} 个未获取`:''}${stats.skippedFeeds?`，其中${stats.skippedFeeds}个未及扫描（45秒上限）`:''}。`);
    rows.forEach((item,i)=>{
      if(i===0)lines.push('\n### 重点阅读');if(i===3)lines.push('\n### 简短速览');
      const label=i<3?(item.coverage==='article'?(item.truncated?'原文节选':'原文材料'):'RSS 摘要·原文未获取'):'RSS 摘要';
      lines.push(`\n${i+1}. **${item.title}**`,`${item.sourceName} · ${localDate(item.publishedAt)} · ${label}`);
      const body=prose(item.summary,i<3?summaryLimit:Math.min(68,summaryLimit));if(body)lines.push(body);
      if(i<3&&whyLimit){const why=prose(item.why,whyLimit);if(why)lines.push(`值得关注：${why}`);}
      lines.push(item.url);
    });
    lines.push(`\n${footer}`);return lines.join('\n');
  }
  let rows=source;
  // Full URLs are indivisible. Remove complete trailing articles until the
  // minimal layout fits, then distribute the remaining budget to prose.
  while(rows.length&&render(rows,0,0).length>NEWS_MESSAGE_LIMIT)rows=rows.slice(0,-1);
  let text=render(rows,190,55);
  for(const [summaryLimit,whyLimit] of [[145,35],[110,20],[75,0],[45,0],[20,0],[0,0]]){if(text.length<=NEWS_MESSAGE_LIMIT)break;text=render(rows,summaryLimit,whyLimit);}
  if(text.length>NEWS_MESSAGE_LIMIT)throw new Error('资讯正文超过单条消息限制');
  return{text,items:rows,deepCount:Math.min(3,rows.length),briefCount:Math.max(0,rows.length-3),stats:{...stats,hours:24,selectedCount:rows.length},generatedAt,...(focus?{topics:focus}:{})};
}
