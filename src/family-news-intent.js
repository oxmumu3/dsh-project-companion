import {assertFamilyOwnerRequest} from './family-personal-review.js';
import {normalizeNewsTopics} from './news-topics.js';
const fail=()=>{throw Object.assign(new Error('无法从本次原话核对 AI 日报操作；本次未读取私人资料、修改兴趣或发送资讯。'),{code:'FAMILY_NEWS_SCOPE_UNSUPPORTED'});};
export const familyNewsInterestAction=action=>['set_topics','clear_topics'].includes(action);
const savedFocus='(?:[，,](?:使用已保存的关注点|按我的关注点))?';
const number=word=>{if(/^\d+$/u.test(word))return Number(word);const d={'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9};if(word==='十')return 10;if(d[word])return d[word];const p=word.split('十');return p.length===2&&(!p[0]||d[p[0]])&&(!p[1]||d[p[1]])?(p[0]?d[p[0]]:1)*10+(p[1]?d[p[1]]:0):NaN;};
export function deriveFamilyNewsRequest(scope,{action,now=new Date(),timeZone='UTC',activeCallVerified=false}={}){
 let text=assertFamilyOwnerRequest(scope,{now,activeCallVerified,requireFresh:action!=='status'}).replace(/[。！!]+$/u,'').replace(/^(?:请|帮我|麻烦)\s*/u,'');
 const result={action,sourceRequestId:scope.sourceRequestId};
 if(action==='clear_topics'){if(!/^(?:清空|清除)(?:我的)?(?:AI\s*)?(?:资讯兴趣|日报关注点)$/iu.test(text))fail();return result;}
 if(action==='status'){if(!/^(?:查看|看看|查询)(?:我的)?(?:AI\s*)?(?:资讯(?:兴趣|状态)|日报(?:关注点|兴趣|状态))$/iu.test(text))fail();return result;}
 if(['preview','send_now','configure','cancel'].includes(action)){
  text=text.replace(/\s+/gu,'');
  if(action==='preview'){if(!new RegExp('^(?:AI(?:精选)?(?:日报|digest)|看(?:一下)?AI日报|今天的AI精选|(?:预览|先看看|查看)(?:一份)?AI日报)'+savedFocus+'$','iu').test(text))fail();return result;}
  if(action==='send_now'){if(!new RegExp('^(?:现在)?(?:给我)?(?:发送|发)(?:给我)?(?:一份|一次|今天的)?AI日报'+savedFocus+'$','iu').test(text))fail();return result;}
  if(action==='cancel'){if(!/^(?:取消|关闭|停止)(?:我的)?AI日报(?:推送)?$/iu.test(text))fail();return result;}
  if(/^(?:开启|启用)(?:我的)?AI日报$/iu.test(text))return{status:'needs_confirmation',sourceRequestId:scope.sourceRequestId,text:'请确认每天几点发送，例如“每天09:00发AI日报”。将沿用已保存的关注点；本次尚未开启或发送。'};
  let zone=timeZone;
  for(const [prefix,value]of[['北京时间','Asia/Shanghai'],['墨西哥城时间','America/Mexico_City']])if(text.startsWith(prefix)){zone=value;text=text.slice(prefix.length);break;}
  try{zone=new Intl.DateTimeFormat('en',{timeZone:zone}).resolvedOptions().timeZone;}catch{fail();}
  text=text.replace(/([一二两三四五六七八九十]{1,3})(?=点)/gu,word=>String(number(word)));
  const m=text.match(/^每天(早上|上午|中午|下午|晚上)?([01]?\d|2[0-3])(?:[:：]([0-5]\d)|点(?:([0-5]?\d)分)?)[，,]?(?:按我的关注点)?(?:给我)?(?:发|发送)AI日报(?:[，,]使用已保存的关注点)?$/iu);if(!m)fail();
  let hour=Number(m[2]);if(['下午','晚上'].includes(m[1])&&hour>=1&&hour<=11)hour+=12;if(['早上','上午'].includes(m[1])&&hour>11||m[1]==='中午'&&hour!==12)fail();
  return{...result,time:`${String(hour).padStart(2,'0')}:${String(Number(m[3]??m[4]??0)).padStart(2,'0')}`,timeZone:zone};
 }
 if(action!=='set_topics')fail();
 const m=text.match(/^(?:把|将)?(?:我的)?(?:AI\s*)?资讯兴趣(?:设为|设置为|改为)[：:]\s*([^。！？!?；;\n]+)$/iu)??text.match(/^(?:我的)?AI\s*日报(?:主要)?关注[：:]?\s*([^。！？!?；;\n]+)$/iu);if(!m||/(?:邮件|聊天记录|私人资料|笔记).{0,8}(?:提到|里面|里的|总结|推断)/u.test(m[1]))fail();
 const topics=normalizeNewsTopics(m[1].split(/[、，,]/u).map(x=>x.trim()));if(!topics?.length)fail();
 return{...result,topics};
}
