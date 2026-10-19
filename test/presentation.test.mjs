import test from 'node:test';
import assert from 'node:assert/strict';
import {formatWechatDigest} from '../src/presentation.js';

const at='2026-10-18T15:00:00Z';
const project=(overrides={})=>({label:'可读项目',files:[],events:[],...overrides});
const file=(text,overrides={})=>({path:'.agent/memory/progress.md',status:'ok',modifiedAt:at,text,...overrides});
const digest=projects=>formatWechatDigest({generatedAt:at,timeZone:'Asia/Shanghai',projects,reminders:[]});

test('mobile digest cleans the observed source Markdown without visible escaping or changing its inputs',()=>{
  const projects=[project({files:[
    file('# 可读项目\n\n## 当前进展\n**读取结果**：见 [README.md](README.md#L3-L13)，仍待验收。'),
    file('# context\n\n`account_id` 共 123 条，尚未独立验证。',{path:'.agent/memory/context.md'}),
    file('# README\n\n**用途**：只读项目简报。',{path:'README.md'}),
  ],events:[{kind:'assistant',at,text:'## 本次执行回复\n\n**本轮记录**：[README.md](README.md#L13) 已读取，仍待用户验收。'}]})];
  const before=structuredClone(projects);const text=digest(projects);
  assert.match(text,/progress\.md.*23:00/);assert.match(text,/context\.md.*23:00/);assert.match(text,/README\.md.*23:00/);
  assert.match(text,/读取结果：见 README\.md（第3–13行），仍待验收。/);
  assert.match(text,/`?account_id`? 共 123 条，尚未独立验证。/);assert.match(text,/助手记录.*23:00/);
  assert.match(text,/本轮记录：README\.md（第13行） 已读取，仍待用户验收。/);
  assert.doesNotMatch(text,/\\[#`*\[\]()_]|\[README\.md\]\(|\*\*读取结果|## 当前进展/);
  assert.equal((text.match(/本次执行回复/g)??[]).length,0);assert.deepEqual(projects,before);
});

test('source cleanup preserves names, numeric facts, comparisons, identifiers, arithmetic and array indices',()=>{
  const source='account_id = 2*3；arr[0] < 3；retry_count > 2；已读取 123 条，完成率为 75%。';
  const text=digest([project({label:'Project_data',files:[file(source,{path:'README_data.md'})]})]);
  const sourceLine=text.split('\n').find(line=>line.startsWith('  account_id'));
  assert.equal(sourceLine,`  ${source}`);assert.doesNotMatch(sourceLine,/\\[_*\[\]<>]/);
});

test('source excerpts omit repeated headings and long fenced code with an explicit omission note',()=>{
  const source='# 可读项目\n\n```js\n'+('CODE_SENTINEL();\n'.repeat(100))+'```\n\n人工验收尚未进行，共 7 项待核对。';
  const text=digest([project({files:[file(source)],events:[{kind:'assistant',at,text:'## 项目简报\n\n实际手机效果仍待确认。'}]})]);
  assert.match(text,/代码片段已略去/);assert.match(text,/人工验收尚未进行，共 7 项待核对。/);assert.doesNotMatch(text,/CODE_SENTINEL|```/);
  assert.equal((text.match(/可读项目/g)??[]).length,1);assert.equal((text.match(/项目简报/g)??[]).length,1);
  assert.match(text,/助手记录/);assert.match(text,/实际手机效果仍待确认。/);
});

test('long source excerpts finish at an available sentence boundary and retain their excerpt status',()=>{
  const text=digest([project({files:[file('已读取 123 条，仍待人工验收。'.repeat(40),{truncated:true})]})]);
  const sourceLine=text.split('\n').find(line=>line.startsWith('  已读取'));
  assert.match(sourceLine,/。…$/);assert.doesNotMatch(sourceLine,/已读取 12…|已读取 123…/);
  assert.match(text,/来源摘录/);assert.match(text,/原文件已截取/);assert.ok(text.length<=3200);
});

test('cleaned five-project excerpts remain bounded and never introduce source links or broken Unicode',()=>{
  const projects=Array.from({length:5},(_,i)=>project({label:`项目_${i}`,files:[file('**事实** [来源](file:///private/source.md#L2-L4) 😀 '.repeat(400))],events:[{kind:'assistant',at,text:'\\# 记录 \\`片段\\` \\*\\*仍待验收\\*\\* '.repeat(20)}]}));
  const text=digest(projects);assert.ok(text.length<=3200);
  for(let i=0;i<5;i++)assert.ok(text.includes(`项目\\_${i}`));
  const sourceLines=text.split('\n').filter(line=>line.startsWith('  ')).join('\n');
  assert.doesNotMatch(sourceLines,/\\[#`*\[\]()_]|file:\/\/|private\/source|\ud800(?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/);
  assert.equal((text.match(/(?<!\\)\*\*/g)??[]).length%2,0);
});

test('source cleanup never promotes code HTML or angle links into active Markdown',()=>{
  const source='<img src="https://evil.example/bare.png"> <a href="https://evil.example">文字</a> `<img src="https://x/a">` `Array<Item>` <https://evil.example/autolink>';
  const text=digest([project({files:[file(source)]})]);
  const body=text.split('\n').find(line=>line.startsWith('  '));
  assert.match(body,/文字/);assert.match(body,/`<img src="https:\/\/x\/a">`/);assert.match(body,/`Array<Item>`/);
  assert.doesNotMatch(body,/bare\.png|evil\.example|<https?:/);
  assert.equal((body.match(/`/g)??[]).length%2,0);
  const long=digest([project({files:[file('`'+('code_'.repeat(100))+'` 仍待验收。') ]})]);
  assert.match(long,/代码片段已略去/);assert.match(long,/仍待验收。/);assert.doesNotMatch(long,/code_code/);
});
