import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createPersonalReviewService,personalReviewRowSchema} from '../src/personal-review.js';

const owner={sessionId:'owner-session',cwd:'/synthetic/project'},binding='a'.repeat(64),grant='b'.repeat(64);
const evidence=()=>({id:'mail:1',source:'gmail',title:'New access policy',text:'A new account policy may interrupt access.',at:'2026-10-29T08:00:00.000Z',dueAt:'2026-11-01T10:00:00.000Z',url:'https://example.test/event/1'});
const candidate=()=>({key:'access-policy',kind:'risk',title:'访问政策即将变化',summary:'来源提示可能影响访问，尚未确认实际生效。',why:'需要在生效前核对。',action:'核对服务商设置。',unknown:'实际生效状态未知。',evidenceIds:['mail:1'],priority:'high',confidence:'source',dueAt:'2026-11-01T10:00:00.000Z'});
const intent=(action,extra={})=>({action,requestId:`request-${action}-${Math.random()}`,userRequested:true,...extra});
const scope={sources:['gmail'],projects:[]};
const schedule={dailyTime:'09:00',weeklyDay:4,weeklyTime:'10:00',timeZone:'UTC'};

async function fixture(options={}){
  let stored=options.persisted,now=new Date('2026-10-29T09:00:00.000Z'),writes=0;
  const sends=[],reads=[],models=[];
  const service=createPersonalReviewService({
    store:options.store??{get:async()=>structuredClone(stored),put:async(_key,row)=>{writes++;stored=structuredClone(row);}},
    clock:()=>now,
    readBinding:async()=>({bound:true,bindingKey:binding}),
    authorization:async caller=>caller.sessionId===owner.sessionId?grant:null,
    canRun:async()=>true,
    collect:async args=>{reads.push(args);return{evidence:[evidence()],coverage:[{source:'gmail',status:'ok',count:1}]};},
    summarize:async args=>{models.push(args);return{items:[candidate()]};},
    send:async args=>{sends.push(args);return{status:'reported_sent'};},
    ...options.hooks,
  });
  return{service,sends,reads,models,stored:()=>stored,writes:()=>writes,time:value=>{now=new Date(value);}};
}

test('configure 保存关注点，status 能读回来，落库行仍合法',async()=>{
  const f=await fixture();
  const configured=await f.service.act(owner,intent('configure',{...scope,schedule,focus:'只看与账号安全、续费有关的邮件'}));
  assert.equal(configured.focus,'只看与账号安全、续费有关的邮件');
  const status=await f.service.act(owner,{action:'status'});
  assert.equal(status.focus,'只看与账号安全、续费有关的邮件');
  assert.equal(f.stored().subscription.focus,'只看与账号安全、续费有关的邮件');
  assert.equal(personalReviewRowSchema.safeParse(f.stored()).success,true);
  assert.equal(f.reads.length,0,'configure 不读取资料');
});

test('preview 的关注点只用于本次，不写订阅；缺失时行为与原来一致',async()=>{
  const f=await fixture();
  const preview=await f.service.act(owner,{action:'preview',...scope,focus:'优先截止日期'});
  assert.equal(f.models[0].focus,'优先截止日期');
  assert.equal(preview.items.length,1);
  assert.equal(f.stored().subscription,null,'preview 不建计划');
  assert.equal(f.sends.length,0);
  const plain=await fixture();
  await plain.service.act(owner,{action:'preview',...scope});
  assert.ok(!Object.hasOwn(plain.models[0],'focus'),'没有关注点时不下发 focus 字段');
});

test('保存的关注点会进入每天的回顾请求；临时 preview 关注点可覆盖本轮',async()=>{
  const f=await fixture();
  await f.service.act(owner,intent('configure',{...scope,schedule,focus:'跟进续费与发票'}));
  f.time('2026-10-29T09:00:00.000Z');
  await f.service.tick();
  assert.equal(f.models[0].focus,'跟进续费与发票');
  const override=await fixture();
  await override.service.act(owner,intent('configure',{...scope,schedule,focus:'跟进续费与发票'}));
  await override.service.act(owner,{action:'preview',...scope,focus:'只看今天的会'});
  assert.equal(override.models.at(-1).focus,'只看今天的会');
  assert.equal(override.stored().subscription.focus,'跟进续费与发票','临时关注点不改保存值');
});

test('关注点超长、空串、纯空白或含控制字符都直接报错，不静默截断',async()=>{
  for(const focus of ['看'.repeat(201),'','   ','账号\u0007安全']){
    const f=await fixture();
    await assert.rejects(()=>f.service.act(owner,intent('configure',{...scope,schedule,focus})),/关注点需要 1–200 字/);
    assert.equal(f.writes(),0,'非法关注点不落库');
    const preview=await fixture();
    await assert.rejects(()=>preview.service.act(owner,{action:'preview',...scope,focus}),/关注点需要 1–200 字/);
    assert.equal(preview.reads.length,0,'非法关注点不读取资料');
  }
  const exact=await fixture();
  await exact.service.act(owner,intent('configure',{...scope,schedule,focus:'看'.repeat(200)}));
  assert.equal(exact.stored().subscription.focus,'看'.repeat(200),'200 字正好合法');
});

test('关注点不扩大来源、项目和时间范围',async()=>{
  const plain=await fixture(),withFocus=await fixture();
  const base=intent('configure',{...scope,schedule});
  const first=await plain.service.act(owner,base);
  const second=await withFocus.service.act(owner,intent('configure',{...scope,schedule,focus:'只看风险'}));
  assert.deepEqual(second.sources,first.sources);
  assert.deepEqual(second.projects,first.projects);
  assert.deepEqual(second.schedule,first.schedule);
  assert.deepEqual(withFocus.stored().subscription.sources,plain.stored().subscription.sources);
  assert.deepEqual(withFocus.stored().subscription.projects,plain.stored().subscription.projects);
  assert.deepEqual(withFocus.stored().subscription.schedule,plain.stored().subscription.schedule);
  assert.equal(withFocus.reads.length,0);
});

test('重新配置时间不会丢掉已保存的关注点；其它操作不接受关注点',async()=>{
  const f=await fixture();
  await f.service.act(owner,intent('configure',{...scope,schedule,focus:'跟进续费'}));
  await f.service.act(owner,intent('configure',{...scope,schedule:{...schedule,dailyTime:'08:30'}}));
  assert.equal(f.stored().subscription.schedule.dailyTime,'08:30');
  assert.equal(f.stored().subscription.focus,'跟进续费');
  assert.equal(f.models.length,0);
  for(const action of ['run_now','status','pause','cancel']){
    const other=await fixture();
    await assert.rejects(()=>other.service.act(owner,{action,...scope,focus:'只看风险',userRequested:true,requestId:`reject-${action}`}),/本操作不接受关注点/);
  }
});

test('模型提示词把关注点写成「本人希望你重点关注」并要求它不扩大范围（静态契约）',async()=>{
  const source=await readFile(new URL('../src/personal-review-model.js',import.meta.url),'utf8');
  assert.ok(source.includes('本人希望你重点关注：'));
  assert.match(source,/focus 是本人这次希望重点关注的方向/);
  assert.match(source,/不扩大读取范围/);
});
