import {basename} from 'node:path';

const LIMIT=3200;
const excerpt=(value,max)=>{
  const chars=Array.from(String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim());
  return chars.length>max?`${chars.slice(0,max).join('')}…`:chars.join('');
};
// Source text is a quotation, never a new Markdown instruction or link.
const markdown=(value,max)=>excerpt(value,max).replace(/[\\`*_\[\]()<>#]/g,'\\$&');

function sourceExcerpt(value,max,repeatedTitles=[]){
  const text=String(value??'').toWellFormed().replace(/\\([\\`*_\[\]()<>#|~])/g,'$1');
  const lines=[];let fence;let first=true;
  for(const line of text.split('\n')){
    const marker=/^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if(fence){if(marker&&marker[1][0]===fence[0]&&marker[1].length>=fence.length)fence=null;continue;}
    if(marker){fence=marker[1];lines.push('（代码片段已略去）');first=false;continue;}
    const heading=/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if(first&&heading&&repeatedTitles.includes(heading[1].trim())){first=false;continue;}
    if(line.trim())first=false;
    lines.push(line.replace(/^\s{0,3}#{1,6}\s+/,'').replace(/^\s*(?:[-+*]|>)\s+(?=\D)/,''));
  }
  const plain=lines.join('\n').split(/(`[^`\n]+`)/g).map((part,index)=>{
    // Keep short code literal, including its angle brackets and operators.
    if(index%2)return Array.from(part).length>max?'（代码片段已略去）':part;
    return part.replace(/<(?:https?:\/\/|file:\/\/|vscode:|javascript:|data:)[^>\n]*>/gi,'（链接已略去）')
    .replace(/<\/?[a-z][a-z\d-]*(?:\s[^>]*|\/?)>/gi,'')
    .replace(/(!?)\[([^\]\n]*)\]\(([^)\n]*)\)/g,(_match,image,label,target)=>{
      const range=!image&&(!/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target)||/^file:/i.test(target))&&target.match(/#L(\d+)(?:-L?(\d+))?$/);
      return `${label}${range?`（第${range[1]}${range[2]?`–${range[2]}`:''}行）`:''}`;
    })
    .replace(/\[([^\]\n]+)\]\[[^\]\n]*\]/g,'$1').replace(/^\s*\[[^\]\n]+\]:\s+.*$/gm,'')
    .replace(/`+/g,'').replace(/\*\*([^*\n]+)\*\*|__([^_\n]+)__/g,(_match,bold,strong)=>bold??strong)
    .replace(/(?<![\p{L}\p{N}_])([*_])([^*_\n]+)\1(?![\p{L}\p{N}_])/gu,'$2')
    .replace(/(^|\s)(?:\*\*|__)(?=\S)|(?:\*\*|__)(?=\s|$)/g,'$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm,'');
  }).join('').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();
  const chars=Array.from(plain);
  if(chars.length<=max)return plain;
  let cut='',used=0,sentence='';
  for(const token of plain.match(/`[^`\n]+`|[\s\S]/gu)??[]){
    const size=Array.from(token).length;if(used+size>max)break;
    cut+=token;used+=size;if(/^[。！？；]$/.test(token))sentence=cut;
  }
  return `${sentence&&sentence.length>=cut.length/2?sentence:cut}…`;
}

function localTime(value,timeZone){
  const date=new Date(value);
  if(!Number.isFinite(date.getTime()))return '时间未知';
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date);
  const p=Object.fromEntries(parts.map(part=>[part.type,part.value]));
  return `${p.year}年${p.month}月${p.day}日 ${p.hour}:${p.minute}`;
}

function releaseLink(project){
  try{
    const url=new URL(project.release.url);
    if(url.protocol!=='https:'||url.hostname!=='github.com'||!url.pathname.startsWith(`/${project.github}/releases/`))return null;
    const href=url.href.replace(/[()[\]\\]/g,char=>`%${char.charCodeAt(0).toString(16).toUpperCase()}`);
    return href.length<=240?href:null;
  }catch{return null;}
}

export function formatWechatDigest({generatedAt,timeZone,projects,reminders}){
  const header=`## 项目简报\n\n${localTime(generatedAt,timeZone)} · 电脑时间\n\n已整理${projects.length}个项目。以下是来源摘录，完成情况尚未独立验证。`;
  const footer='时间按电脑时区显示。助手记录不等于完成或验收；资料缺失也不能据此判断未完成。想看详情，直接告诉我项目名称。';
  const remindersBlock=[`### 明确提醒（${reminders.length}项）`,...reminders.slice(0,3).map(r=>`- **${markdown(r.title,45)}**\n  ${localTime(r.dueAt,timeZone)} · ${r.status==='scheduled'?'已安排':'等待发送'}`),...(reminders.length>3?[`另有${reminders.length-3}项，可继续询问完整状态。`]:[]),...(!reminders.length?['暂无明确提醒。']:[])].join('\n');
  const render=({quote,event,events,links})=>{
    const groups=projects.map(project=>{
      const lines=[`### ${markdown(project.label,30)}`];
      if(project.readFailed)lines.push('本地资料读取失败，本次内容未知。');
      for(const file of project.files.slice(0,3)){
        const name=markdown(basename(file.path),28);
        if(file.status==='ok'){
          lines.push(`- ${name} · 更新 ${localTime(file.modifiedAt,timeZone)}${file.truncated?' · 原文件已截取':''}`);
          if(quote)lines.push(`  ${sourceExcerpt(file.text,quote,[project.label,basename(file.path,'.md')])}`);
        }else lines.push(`- ${name}：${file.status==='missing'?'未找到':'读取受限'}，内容未知。`);
      }
      if(!project.events.length)lines.push('近期会话暂无启用后记录，不能据此判断未完成。');
      else if(events){
        for(const record of project.events.slice(-events)){
          const kind={user:'用户请求',assistant:'助手记录',error:'错误记录'}[record.kind];
          lines.push(`- ${kind} · ${localTime(record.at,timeZone)}`,`  ${sourceExcerpt(record.text,event,[project.label,'项目简报','本次执行回复'])}`);
        }
      }else lines.push(`保留了${project.events.length}条近期记录，本条未展开。`);
      if(project.release){
        const tag=markdown(project.release.tag,24);const href=links?releaseLink(project):null;
        lines.push(href?`- GitHub：[最新版本 ${tag}](${href})`:`- GitHub：最新版本 **${tag}**`);
      }else if(project.releaseFailed)lines.push('- GitHub：本次查询失败，最新版本未知。');
      return lines.join('\n');
    });
    return [header,...groups,...(!projects.length?['还没有关注项目。告诉我想看的已知项目名称即可。']:[]),remindersBlock,footer].join('\n\n');
  };
  // Re-render complete blocks at a smaller excerpt budget; never slice Markdown.
  for(const mode of [{quote:120,event:80,events:2,links:true},{quote:65,event:40,events:1,links:true},{quote:30,event:25,events:1,links:false},{quote:12,event:12,events:1,links:false},{quote:0,event:0,events:0,links:false}]){
    const text=render(mode);
    if(text.length<=LIMIT)return text;
  }
  // Even unusual source labels cannot crowd out all five project identities.
  return [header,...projects.map(project=>`### ${markdown(project.label,24)}\n来源条目较长，本条仅保留项目索引；请询问该项目的完整来源。`),`明确提醒：${reminders.length}项，请询问完整状态。`,footer].join('\n\n');
}

export function formatWechatReminder({title,dueAt,timeZone}){
  return `## 提醒\n\n**${markdown(title,200)}**\n\n这是你安排的提醒。\n原定时间：${localTime(dueAt,timeZone)}（电脑时区）`;
}
