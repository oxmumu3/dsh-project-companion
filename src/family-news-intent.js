import {assertFamilyOwnerRequest} from './family-personal-review.js';
import {normalizeNewsTopics} from './news-topics.js';
const fail=()=>{throw Object.assign(new Error('请明确要保存的资讯兴趣；本次未读取私人资料、修改兴趣或发送资讯。'),{code:'FAMILY_NEWS_SCOPE_UNSUPPORTED'});};
export const familyNewsInterestAction=action=>['set_topics','clear_topics'].includes(action);
export function deriveFamilyNewsRequest(scope,{action,now=new Date(),activeCallVerified=false}={}){
 let text=assertFamilyOwnerRequest(scope,{now,activeCallVerified,requireFresh:action!=='status'}).replace(/[。！!]+$/u,'').replace(/^(?:请|帮我|麻烦)\s*/u,'');
 const result={action,sourceRequestId:scope.sourceRequestId};
 if(action==='clear_topics'){if(!/^(?:清空|清除)(?:我的)?(?:AI\s*)?(?:资讯兴趣|日报关注点)$/iu.test(text))fail();return result;}
 if(action==='status'){if(!/^(?:查看|看看|查询)(?:我的)?(?:AI\s*)?(?:资讯(?:兴趣|状态)|日报(?:关注点|兴趣|状态))$/iu.test(text))fail();return result;}
 if(action!=='set_topics')fail();
 const m=text.match(/^(?:把|将)?(?:我的)?(?:AI\s*)?资讯兴趣(?:设为|设置为|改为)[：:]\s*([^。！？!?；;\n]+)$/iu)??text.match(/^(?:我的)?AI\s*日报(?:主要)?关注[：:]?\s*([^。！？!?；;\n]+)$/iu);if(!m||/(?:邮件|聊天记录|私人资料|笔记).{0,8}(?:提到|里面|里的|总结|推断)/u.test(m[1]))fail();
 const topics=normalizeNewsTopics(m[1].split(/[、，,]/u).map(x=>x.trim()));if(!topics?.length)fail();
 return{...result,topics};
}
