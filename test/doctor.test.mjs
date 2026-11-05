import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDoctorReport} from '../src/doctor.js';

const NOW = new Date('2026-11-04T20:00:00Z'), ZONE = 'America/Mexico_City';
const good = (detail = '运行中') => async () => ({state: 'ok', detail});
const healthy = () => ({
  assistant: good('运行中，关注 2 个项目，活动提醒 1 条'),
  wechat: good('当前会话绑定了微信，推送走这条原绑定'),
  sources: good('已启用 2 个来源：Gmail、滴答'),
  review: good('已启用，每天 09:00；本次只读计划，没有执行回顾'),
  news: good('每天 09:30 发送；最近一次：通道报告已发出'),
  delivery: good('没有卡住的待发消息'),
});

test('全正常时每行一个方面，末尾一条建议', async () => {
  const text = await buildDoctorReport({now: NOW, hostTimeZone: ZONE, probes: healthy()});
  const lines = text.split('\n');
  assert.deepEqual(lines.map(line => line.split('：')[0]), ['助理', '微信', '资料来源', '个人回顾', 'AI 资讯', '投递', '建议']);
  assert.ok(!text.includes('未知'), text);
  assert.ok(!text.includes('需要留意'), text);
  assert.match(lines[0], /正常 · 运行中，关注 2 个项目/);
  assert.match(lines[0], /自检于 11\/4 14:00，America\/Mexico_City/);
  assert.match(lines.at(-1), /^建议：各项本机状态正常/);
});

test('有告警时逐行给出原因，建议指向第一处告警', async () => {
  const probes = healthy();
  probes.wechat = async () => ({state: 'warn', detail: '微信绑定状态读不到，可能已经换绑'});
  probes.delivery = async () => ({state: 'warn', detail: '有 1 条投递结果不确定，不会自动重发'});
  const text = await buildDoctorReport({now: NOW, hostTimeZone: ZONE, probes});
  const lines = text.split('\n');
  assert.match(lines[1], /^微信：需要留意 · 微信绑定状态读不到/);
  assert.match(lines[5], /^投递：需要留意 · 有 1 条投递结果不确定/);
  assert.match(lines.at(-1), /^建议：先处理「微信」这一项/);
});

test('抛错和超时的探测都显示未知，绝不算成正常', async () => {
  const probes = healthy();
  probes.review = async () => { throw new Error('synthetic storage failure'); };
  probes.news = () => new Promise(() => {});
  const text = await buildDoctorReport({now: NOW, hostTimeZone: ZONE, probes, timeoutMs: 60});
  const lines = text.split('\n');
  assert.match(lines[3], /^个人回顾：未知 · 探测没有完成/);
  assert.match(lines[4], /^AI 资讯：未知 · 探测没有完成/);
  assert.match(lines.at(-1), /^建议：有项目状态未知/);
  assert.ok(!text.includes('异常'), '原始错误不进正文');
  assert.equal(lines.filter(line => line.startsWith('个人回顾：正常')).length, 0);
});

test('正文不出现内部编号、ISO 时刻与英文状态码', async () => {
  const probes = healthy();
  probes.assistant = async () => ({state: 'warn', detail: '2026-11-04T20:00:00Z 时 reported_sent 之后 p_1a2b3c4d 变成 blocked'});
  probes.delivery = async () => ({state: 'warn', detail: 'job_01234567-89ab-cdef-0123-456789abcdef 已 uncertain'});
  const text = await buildDoctorReport({now: NOW, hostTimeZone: ZONE, probes});
  assert.ok(!/\d{4}-\d\d-\d\dT\d\d:\d\d/.test(text), text);
  assert.ok(!/\bp_[0-9a-f]{8}\b/.test(text), text);
  assert.ok(!/\bjob_[0-9a-f]{8}\b/.test(text), text);
  assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/.test(text), text);
  assert.ok(!/reported_sent|blocked|uncertain|queued|pending/.test(text), text);
  assert.match(text, /需要留意/);
});

test('总长压到 1500 字符以内，并且建议行一定保留', async () => {
  const probes = healthy();
  for (const key of Object.keys(probes)) probes[key] = async () => ({state: 'warn', detail: '很长的一句中文说明。'.repeat(40)});
  const text = await buildDoctorReport({now: NOW, hostTimeZone: ZONE, probes});
  assert.ok(text.length <= 1500, `report is ${text.length} chars`);
  assert.match(text.split('\n').at(-1), /^建议：/);
  assert.equal(text.split('\n').length, 7);
});

test('时区或时间读不出来时助理行明确提醒，而不是报正常', async () => {
  const text = await buildDoctorReport({now: NOW, hostTimeZone: 'Not/AZone', probes: healthy()});
  assert.match(text.split('\n')[0], /^助理：需要留意 · 本机时间或时区读不出来/);
  assert.match(text.split('\n')[0], /时间未知/);
});

test('缺探测、返回非法状态或非对象都按未知处理', async () => {
  const probes = {assistant: async () => ({state: 'ok', detail: '运行中'}), wechat: async () => 'bound', sources: async () => ({state: 'healthy', detail: '已启用'})};
  const text = await buildDoctorReport({now: NOW, hostTimeZone: ZONE, probes});
  const lines = text.split('\n');
  assert.match(lines[1], /^微信：未知/);
  assert.match(lines[2], /^资料来源：未知/);
  for (const line of lines.slice(1, 6)) assert.ok(!line.includes('：正常'), line);
});

// --- 工具接线：doctor 动作与 look 的 health 视角都真的跑在同一份本机状态上 ---
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Context} from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import CommandRuntime from '@deepseek-ai/dsh-commands';
import Storage from '@deepseek-ai/dsh-storage';
import * as JsonStorage from '@deepseek-ai/dsh-storage-json';
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain';
import SessionStore,{SessionId} from '@deepseek-ai/dsh-session';
import {executeHostTool} from '../src/host-tool-call.js';

async function mount(t){
  const {installCompanion}=await import('../index.js');
  const root=await mkdtemp(join(tmpdir(),'doctor-host-'));
  const ctx=new Context();const live=new Map();
  await ctx.plugin(SystemPrompt,{});
  const batchTools=typeof ToolRuntime.prototype?.selectExecutor==='function';
  await ctx.plugin(ToolRuntime,batchTools?{}:{mode:'native'});
  if(batchTools)await ctx.plugin(await import('@deepseek-ai/dsh-tool-executor-native'));
  await ctx.plugin(CommandRuntime);
  await ctx.plugin(Storage);await ctx.plugin(JsonStorage,{root:join(root,'storage')});await ctx.plugin(StorageDomain,{backend:'json'});await ctx.plugin(SessionStore);
  ctx.provide('agents',{get:id=>live.get(id),list:()=>[...live.values()]});
  ctx.provide('workspaceRegistry',{list:()=>[],resolveByPath:async()=>undefined});
  ctx.provide('workingDirectory',{get:session=>session.header.cwd});
  const session=ctx.sessions.create(SessionId('synthetic-owner'),{meta:{cwd:root}});
  const owner={id:session.id,session,ctx,status:'idle',followup:()=>{}};live.set(owner.id,owner);
  await ctx.plugin({name:'synthetic-doctor-mount',inject:['tools','commands','storageDomain','sessions','systemPrompt'],async apply(scope){await installCompanion(scope,{clock:()=>new Date('2026-11-04T20:00:00Z'),hostTimeZone:()=>'America/Mexico_City',readSetup:async()=>({state:'unbound'}),readNativeRoute:async()=>({kind:'unbound'})});}});
  t.after(async()=>{await ctx.fiber.dispose();await rm(root,{recursive:true,force:true});});
  const call=async(args,callId)=>{const r=await executeHostTool(ctx.tools,{callId,name:'project_companion',arguments:args,agent:owner,signal:new AbortController().signal});assert.equal(r.isError,false,JSON.stringify(r));return r.value;};
  return {ctx,owner,call};
}

test('工具动作 doctor 与 look 的 health 视角都产出同一份本机自检',async t=>{
  const h=await mount(t);
  const schema=h.ctx.tools.schemas(h.owner).find(item=>item.name==='project_companion');
  assert.ok(schema.parameters.properties.action.enum.includes('doctor'));
  assert.ok(schema.parameters.properties.view.enum.includes('health'));
  assert.match(schema.description,/doctor/);assert.match(schema.description,/health/);
  const direct=await h.call({action:'doctor'},'doctor-direct');
  assert.equal(direct.status,'ok');assert.equal(direct.view,'health');
  assert.match(direct.text,/(^|\n)助理：/);assert.match(direct.text,/建议：/);
  assert.ok(!/\d{4}-\d\d-\d\dT\d\d:\d\d/.test(direct.text),direct.text);
  const viaLook=await h.call({action:'look',view:'health'},'doctor-look');
  assert.equal(viaLook.view,'health');
  assert.match(viaLook.text,/(^|\n)微信：未启用/);
});
