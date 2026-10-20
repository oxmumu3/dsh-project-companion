import test from 'node:test';
import assert from 'node:assert/strict';
import {registerGuidance} from '../src/guidance.js';
import {createTaskResults} from '../src/task-results.js';

function guidance(){
  let section;
  registerGuidance({systemPrompt:{section:value=>{section=value;}},tools:{get:()=>({})}},{clock:()=>new Date('2026-10-19T20:00:00Z'),hostTimeZone:()=> 'America/Mexico_City'});
  return section.text({scope:{id:'synthetic-source'}});
}

test('memory guidance offers natural correction and forgetting with exact internal selection and an honest receipt',()=>{
  const prompt=guidance();
  const memory=prompt.split('\n').find(line=>line.includes('correct_memory'));
  assert.ok(memory,'natural-language memory editing must be discoverable');
  for(const term of ['forget_memory','userRequested:true','memory','memoryId'])assert.ok(memory.includes(term),term);
  assert.match(memory,/同一项目|当前项目/);assert.match(memory,/准确|精确/);assert.match(memory,/歧义/);
  assert.match(memory,/不要求用户.*ID/);assert.match(memory,/原始来源/);assert.match(memory,/用户纠正/);
  assert.match(memory,/回执/);assert.match(memory,/不.*验收|不.*已验证/);
});

test('cache receipt recovery is transport-only and cannot become another result query or task',()=>{
  const prompt=guidance();
  const recovery=prompt.split('\n').find(line=>line.includes('传输恢复意图'));
  assert.ok(recovery,'guidance needs a separate policy for receiving cached replies');
  for(const tool of ['task_status','digest','memory','coordinate','remind','send_wechat'])assert.ok(recovery.includes(tool),tool);
  assert.match(recovery,/不重新执行任务/);assert.match(recovery,/不新增提醒/);assert.match(recovery,/不复述.*异步.*正文/);
  assert.match(recovery,/至多一次.*简短确认/);assert.match(recovery,/不声称.*清空缓存.*手机收到/);
  assert.match(recovery,/完整用户意图/);assert.match(recovery,/不用关键词.*吞掉自然语言/);
});

test('transport recovery leaves explicit result queries available and queued is not a live bridge receipt',()=>{
  const prompt=guidance();
  const ownership=prompt.split('\n').find(line=>line.includes('普通assistant回复是另一条发送'));
  assert.ok(ownership,'the independent job return and ordinary assistant reply need distinct ownership');
  assert.match(ownership,/task_status.*不.*刷新.*桥接队列/);
  assert.match(ownership,/queued.*不能.*当前仍有缓存.*手机收到/);
  assert.match(ownership,/用户明确.*原回复.*详情.*可以.*查询/);
});

test('task status explains independent delivery without resending or removing an explicitly queried reply',async t=>{
  let saved;let sends=0;
  const service=createTaskResults({store:{get:async()=>saved,put:async(_key,value)=>{saved=structuredClone(value);}},clock:()=>new Date('2026-10-19T20:00:00Z'),send:async()=>{sends++;return{status:'queued'};}});
  t.after(()=>service.close());await service.ready();
  const {job}=await service.prepare({originSessionId:'source-session',originToolCallId:'call-1',targetSessionId:'target-session',targetMessageId:'message-1',projectRoot:'/synthetic/public-project',projectLabel:'公开项目',task:'只读检查 README',returnBinding:{userHash:'a'.repeat(64),botHash:'b'.repeat(64)}});
  await service.admitted(job.id);await service.claimed({sessionId:'target-session',messageId:'message-1',turn:1,sourceKind:'user'});
  await service.observe({sessionId:'target-session',type:'assistant',turn:1,text:'EXPLICIT_REPLY_STILL_AVAILABLE'});
  await service.observe({sessionId:'target-session',type:'turn/end',turn:1,reason:{kind:'completed'}});
  const before=structuredClone(saved),listing=await service.status('source-session'),detail=await service.status('source-session',{id:job.id});
  assert.match(listing.text,/独立回传流程/);assert.match(listing.text,/本查询不补发.*不刷新.*桥接队列/);
  assert.match(listing.text,/queued.*不能.*当前仍有缓存.*手机收到/);
  assert.doesNotMatch(listing.text,/EXPLICIT_REPLY_STILL_AVAILABLE/);assert.match(detail.text,/EXPLICIT_REPLY_STILL_AVAILABLE/);
  assert.equal(detail.jobs[0].reply,'EXPLICIT_REPLY_STILL_AVAILABLE');assert.equal(detail.jobs[0].delivery.status,'queued');
  assert.equal(sends,1);assert.deepEqual(saved,before);
});
