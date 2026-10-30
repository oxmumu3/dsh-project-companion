// Only trusted candidate URLs become links. Model and RSS prose is plain text.
import {normalizeNewsTopics} from './news-topics.js';
export const NEWS_MESSAGE_LIMIT = 3200;
const clean = value => String(value ?? '').toWellFormed().replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();
const clip = (text,n) => { let value=''; for(const c of clean(text)){if(value.length+c.length>n)break;value+=c;}return value; };
const ellipsis = (value,n) => {if(n<=0)return '';const source=clean(value);return source.length>n?`${clip(source,n-1)}…`:source;};
const prose = (value,n) => ellipsis(String(value??'').replace(/<[^>]*>/g,' ').replace(/(?:https?:\/\/|www\.)\S+/gi,'').replace(/[\[\]()*_`#<>\\]/g,' '),n);
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
  const ranked=items.map(item=>({...item,url:newsPublicUrl(item.url)})).filter(item=>item.tier!=='omit'&&item.kind!=='insufficient');
  const domains=new Map();let deepTotal=0;
  // Quality is explicit, never inferred from ordinal position or item count.
  // Older adapters without editorial metadata conservatively remain briefs.
  const graded=ranked.map(item=>{const domain=new URL(item.url).hostname.toLowerCase().replace(/^www\./,'');const deep=item.tier==='deep'&&item.kind==='substantive'&&item.coverage==='article'&&clean(item.why)&&deepTotal<3&&(domains.get(domain)??0)<2;if(deep){deepTotal++;domains.set(domain,(domains.get(domain)??0)+1);}return{...item,tier:deep?'deep':'brief'};});
  const ordered=[...graded.filter(item=>item.tier==='deep'),...graded.filter(item=>item.tier==='brief').slice(0,7)];
  const source=ordered.map(item=>({tier:item.tier,kind:item.kind==='substantive'?'substantive':'commentary',id:item.id,sourceUrl:item.sourceUrl??null,publishedAt:item.publishedAt??null,truncated:item.truncated===true,url:newsPublicUrl(item.url),title:prose(item.title,54)||'未命名文章',sourceName:ellipsis(prose(item.sourceName,100),22)||'RSS 来源',summary:prose(item.summary,360),why:prose(item.why,90),coverage:item.coverage==='article'?'article':'feed-only'}));
  const localDate=value=>{if(!Number.isFinite(Date.parse(value)))return '日期未知';try{const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value)).map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}`;}catch{return new Date(value).toISOString().slice(0,10);}};
  const displayDate=localDate(generatedAt);
  const footer='来源为最近 24 小时 RSS 候选；摘要依据已取得的材料，未独立核验全部事实。';
  function render(rows,summaryLimit,whyLimit){
    const deep=rows.filter(item=>item.tier==='deep').length,brief=rows.length-deep;
    const lines=[`## AI 资讯日报 · ${displayDate}`,`${deep} 篇重点 · ${brief} 篇速览`];
    if(focus)lines.push(`${topicSource==='saved'?'已保存关注点':'本次关注点'}：${focus.map(topic=>prose(topic,80)||'（关注点文字已过滤）').join('、')}`);
    if(preview)lines.push('本次预览通过当前对话回复；未另行推送、未更改计划。');
    if(!deep&&rows.length)lines.push('本期材料不足以形成重点解读；以下速览仅供线索。');
    if(rows.length&&!rows.some(item=>item.kind==='substantive'&&item.why))lines.push('本期未形成可直接使用的实践建议，请先核对原文。');
    if(rows.length<10)lines.push(`本次仅有 ${rows.length} 篇可用，按相关性、材料质量与消息长度筛选，不补凑 10 篇。`);
    if(!rows.length)lines.push('没有符合本次窗口及去重条件的可用文章。');
    if(Number.isInteger(stats.totalFeeds))lines.push(`来源：${stats.succeededFeeds??0}/${stats.totalFeeds} 个获取成功${stats.failedFeeds?`；${stats.failedFeeds} 个未获取`:''}${stats.skippedFeeds?`，其中${stats.skippedFeeds}个未及扫描（45秒上限）`:''}。`);
    rows.forEach((item,i)=>{
      if(i===0&&deep)lines.push('\n### 重点阅读');if(i===deep)lines.push('\n### 简短速览');
      const label=item.tier==='deep'?(item.coverage==='article'?(item.truncated?'原文节选':'原文材料'):'RSS 摘要·原文未获取'):(item.coverage==='article'?(item.truncated?'原文节选·速览':'原文材料·速览'):'RSS 摘要');
      lines.push(`\n${i+1}. **${item.title}**`,`${item.sourceName} · ${localDate(item.publishedAt)} · ${label}`);
      const body=prose(item.summary,item.tier==='deep'?summaryLimit:Math.min(120,summaryLimit));if(body)lines.push(body);
      if((item.tier==='deep'||!deep&&item.kind==='substantive'&&i===rows.findIndex(row=>row.kind==='substantive'))&&whyLimit){const why=prose(item.why,whyLimit);if(why)lines.push(`值得关注：${why}`);}
      lines.push(item.url);
    });
    lines.push(`\n${footer}`);return lines.join('\n');
  }
  let rows=source;
  // Full URLs are indivisible. Remove complete trailing articles until the
  // minimal layout fits, then distribute the remaining budget to prose.
  while(rows.length&&render(rows,0,0).length>NEWS_MESSAGE_LIMIT)rows=rows.slice(0,-1);
  let text=render(rows,360,90);
  for(const [summaryLimit,whyLimit] of [[190,55],[145,35],[110,20],[75,0],[45,0],[20,0],[0,0]]){if(text.length<=NEWS_MESSAGE_LIMIT)break;text=render(rows,summaryLimit,whyLimit);}
  if(text.length>NEWS_MESSAGE_LIMIT)throw new Error('资讯正文超过单条消息限制');
  return{text,items:rows,deepCount:rows.filter(item=>item.tier==='deep').length,briefCount:rows.filter(item=>item.tier==='brief').length,stats:{...stats,hours:24,selectedCount:rows.length},generatedAt,...(focus?{topics:focus}:{})};
}
