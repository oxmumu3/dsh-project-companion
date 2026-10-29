import test from 'node:test';
import assert from 'node:assert/strict';
const mod=await import('../src/family-news-intent.js').catch(()=>({}));
const owner={familySessionId:'family_owner_synthetic',bindingRevision:'a'.repeat(64),sourceRequestId:'wechat-'+'b'.repeat(64),sourceTimingState:'fresh',sourceTiming:{receivedAt:'2026-10-29T12:00:02.000Z',providerCreatedAt:'2026-10-29T12:00:00.000Z'}};
const parse=(userText,action)=>{assert.equal(typeof mod.deriveFamilyNewsRequest,'function');return mod.deriveFamilyNewsRequest({...owner,userText},{action,now:new Date('2026-10-29T12:00:10.000Z'),activeCallVerified:true});};
test('persistent news interests come only from explicitly provided short phrases',()=>{
 assert.deepEqual(parse('把我的资讯兴趣设为：AI Agent、墨西哥创业、开发者工具。','set_topics'),{action:'set_topics',topics:['AI Agent','墨西哥创业','开发者工具'],sourceRequestId:owner.sourceRequestId});
 assert.equal(parse('清空我的资讯兴趣。','clear_topics').action,'clear_topics');
 assert.equal(parse('查看我的资讯兴趣。','status').action,'status');
});
test('natural AI digest interest phrases preserve exact user topics',()=>{
 for(const text of ['AI 日报关注：Agent 产品、插件生态、增长实践。','我的AI日报主要关注Agent 产品、插件生态、增长实践。'])assert.deepEqual(parse(text,'set_topics').topics,['Agent 产品','插件生态','增长实践']);
 assert.equal(parse('清空AI日报关注点。','clear_topics').action,'clear_topics');
 for(const text of ['如果可以AI 日报关注：Agent','AI 日报关注：Agent。并转发给妈妈','我的AI日报主要关注邮件里提到的所有话题'])assert.throws(()=>parse(text,'set_topics'));
});
test('private-context extraction, hypothetical changes, unknown effects and foreign recipients never become interests',()=>{
 for(const text of ['根据我的邮件设置资讯兴趣','不要把资讯兴趣设为：AI','如果可以把资讯兴趣设为：AI','把妈妈的资讯兴趣设为：AI','把资讯兴趣设为：AI。并发送给爸爸','把资讯兴趣设为：','把资讯兴趣设为：AI、AI'])assert.throws(()=>parse(text,'set_topics'));
 assert.throws(()=>parse('查看我的资讯兴趣','clear_topics'));
});
