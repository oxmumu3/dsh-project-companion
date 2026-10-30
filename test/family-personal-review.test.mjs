import test from 'node:test';
import assert from 'node:assert/strict';
const mod=await import('../src/family-personal-review.js').catch(()=>({}));
const now=new Date('2026-10-29T12:00:10.000Z');
const owner={familySessionId:'family_owner_synthetic',bindingRevision:'a'.repeat(64),sourceRequestId:'wechat-'+'b'.repeat(64),sourceTimingState:'fresh',sourceTiming:{receivedAt:'2026-10-29T12:00:02.000Z',providerCreatedAt:'2026-10-29T12:00:00.000Z'}};
const parse=(userText,action='configure',patch={},options={})=>{assert.equal(typeof mod.deriveFamilyPersonalReviewRequest,'function');return mod.deriveFamilyPersonalReviewRequest({...owner,userText,...patch},{action,now,timeZone:'America/Mexico_City',activeCallVerified:true,...options});};
const request='每天早上9点、每周一早上9点，根据我已启用的资料和选定项目做个人回顾，有风险或临期事项告诉我。';
test('verified complete Owner request derives bounded personal scope and both calendar schedules',()=>{
 const r=parse(request);assert.equal(r.action,'configure');assert.equal(r.preset,'enabled_sources_watched_projects');assert.equal(r.sourceRequestId,owner.sourceRequestId);assert.deepEqual(r.schedule,{dailyTime:'09:00',weeklyDay:1,weeklyTime:'09:00',timeZone:'America/Mexico_City'});assert.equal(r.sources,undefined);assert.equal(r.projects,undefined);
 assert.equal(parse('北京时间每天九点、每周日21:30，使用我在电脑启用的资料和已关注项目做个人回顾。').schedule.timeZone,'Asia/Shanghai');
});
test('documented and workbench primary phrases round-trip through the verified parser',()=>{
 const r=parse('每天09:00、每周一09:00，使用我在电脑启用的资料和已关注项目做个人回顾，主动发现风险、截止事项和项目进展；无变化时保持安静。');assert.equal(r.action,'configure');assert.equal(r.schedule.dailyTime,'09:00');
 assert.equal(parse('查看个人回顾','status').action,'status');
 assert.equal(parse('个人回顾事项 pritem_123 延后一天','feedback').snoozeUntil,'2026-10-30T12:00:00.000Z');
});
test('an incomplete scope or cadence requests one clear scope confirmation without configuring',()=>{
 for(const text of ['每天每周主动给我做个人回顾','每天9点做个人回顾','帮我开启个人回顾']){const r=parse(text);assert.equal(r.status,'needs_confirmation');assert.equal(r.action,undefined);assert.match(r.text,/资料|范围/);}
});
test('status and lifecycle requests remain personal review specific',()=>{
 for(const [text,action]of[['查看个人回顾状态','status'],['暂停我的个人回顾','pause'],['恢复个人回顾','resume'],['关闭个人回顾','cancel']])assert.equal(parse(text,action).action,action);
 for(const text of ['暂停妈妈的个人回顾','关闭资讯日报','不要暂停个人回顾','如果可以恢复个人回顾','查看个人回顾状态并读取所有邮件'])assert.throws(()=>parse(text,'pause'));
});
test('one-off preview and send use actual words and never inherit schedule',()=>{
 for(const [verb,action]of[['预览','preview'],['发送','run_now']]){const r=parse(`${verb}一份个人回顾，使用我在电脑启用的资料和已关注项目，不建立计划。`,action);assert.equal(r.action,action);assert.equal(r.schedule,undefined);assert.equal(r.preset,'enabled_sources_watched_projects');}
 assert.throws(()=>parse('预览一份个人回顾，使用我在电脑启用的资料和已关注项目，不建立计划。','run_now'));
});
test('feedback must name the displayed stable item identifier and derive disposition from owner text',()=>{
 assert.deepEqual(parse('个人回顾事项 pritem_123 已处理。','feedback'),{action:'feedback',itemId:'pritem_123',feedback:'handled',sourceRequestId:owner.sourceRequestId});
 assert.equal(parse('个人回顾事项 pritem_123 不再提醒。','feedback').feedback,'dismissed');
 const snooze=parse('个人回顾事项 pritem_123 延后24小时。','feedback');assert.equal(snooze.feedback,'snoozed');assert.equal(snooze.snoozeUntil,'2026-10-30T12:00:00.000Z');
 assert.throws(()=>parse('已处理','feedback'));assert.throws(()=>parse('个人回顾事项 pritem_123 已处理，并发送邮件','feedback'));
});
test('Owner can refer to a numbered recent review item without exposing internal ids',()=>{
 assert.deepEqual(parse('个人回顾第1条已处理','feedback'),{action:'feedback',itemNumber:1,feedback:'handled',sourceRequestId:owner.sourceRequestId});
 assert.equal(parse('第1条已处理','feedback').itemNumber,1);
 assert.deepEqual(parse('第2条延后1天','feedback'),{action:'feedback',itemNumber:2,feedback:'snoozed',snoozeUntil:'2026-10-30T12:00:00.000Z',sourceRequestId:owner.sourceRequestId});
 assert.equal(parse('第3条不再提醒','feedback').feedback,'dismissed');
 for(const text of ['第0条已处理','第10条已处理','第1和第2条已处理','不要第1条已处理','第1条已处理并发邮件'])assert.throws(()=>parse(text,'feedback'),text);
});
test('numbered feedback carries only the authenticated bridge receipt token',()=>{
 const token='c'.repeat(64);
 assert.equal(parse('第1条已处理','feedback',{previousReviewViewToken:token}).confirmedViewToken,token);
 assert.equal(parse('第1条已处理','feedback',{previousReviewViewToken:'bad'}).confirmedViewToken,undefined);
 assert.equal(parse('个人回顾事项 pritem_123 已处理','feedback',{previousReviewViewToken:token}).confirmedViewToken,undefined);
});
test('verified Owner can name an exact review title without an internal identifier',()=>{
 assert.deepEqual(parse('个人回顾「访问政策即将变化」已处理','feedback'),{action:'feedback',itemTitle:'访问政策即将变化',feedback:'handled',sourceRequestId:owner.sourceRequestId});
 assert.equal(parse('个人回顾“项目 A · 续约”延后1天','feedback').snoozeUntil,'2026-10-30T12:00:00.000Z');
 for(const text of ['不要个人回顾「风险」已处理','个人回顾「风险」已处理并发邮件','个人回顾「风险”已处理','个人回顾「」已处理'])assert.throws(()=>parse(text,'feedback'),text);
});
test('attention is enabled or disabled only by a narrow verified Owner instruction',()=>{
 for(const text of ['开启个人回顾工作时段主动关注','每天9点到19点，每2小时主动关注个人回顾，每天最多提醒2次']){
  const value=parse(text,'attention');assert.deepEqual(value,{action:'attention',enabled:true,sourceRequestId:owner.sourceRequestId});assert.equal(value.sources,undefined);assert.equal(value.projects,undefined);
 }
 assert.equal(parse('关闭个人回顾工作时段主动关注','attention').enabled,false);
 for(const text of ['不要开启个人回顾工作时段主动关注','开启个人回顾工作时段主动关注并读取其他账号','每天9点到19点，每2小时主动关注个人回顾，每天最多提醒10次'])assert.throws(()=>parse(text,'attention'),text);
});
test('quoted, hypothetical, negative, expanded, mixed or model-reinterpreted requests cannot grant scope',()=>{
 for(const text of ['不要'+request,'如果可以'+request,'他说“'+request+'”',request+'顺便读取妈妈的日历',request+'只看某个未指定文件','每天9点和10点，使用我在电脑启用的资料和已关注项目做个人回顾','每天9点，使用所有账号和全部项目做个人回顾'])assert.throws(()=>parse(text),text);
});
test('mutations require current authentic ingress and active call; normal processing delay remains valid',()=>{
 for(const patch of [{familySessionId:'family_member_x'},{sourceRequestId:'invented'},{sourceTimingState:'unknown'},{bindingRevision:'fake'},{sourceTiming:{receivedAt:'2026-10-29T12:00:40.000Z',providerCreatedAt:'2026-10-29T12:00:00.000Z'}}])assert.throws(()=>parse(request,'configure',patch));
 assert.throws(()=>parse(request,'configure',{}, {activeCallVerified:false}));assert.throws(()=>parse(request,'configure',{}, {now:new Date('2026-10-29T12:11:00.000Z')}));
 assert.equal(parse(request,'configure',{sourceTimingState:'stale'},{now:new Date('2026-10-29T12:01:40.000Z')}).action,'configure');
});
