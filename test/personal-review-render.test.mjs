import test from 'node:test';
import assert from 'node:assert/strict';
import {renderPersonalReview} from '../src/personal-review-ledger.js';
const item = {id:'review_0123456789abcdef0123456789abcdef',title:'邀请尚待处理',summary:'邮件提供了只读团队邀请，接受状态未知。',why:'邀请处理窗口较短。',action:'核对邀请与权限。',unknown:'当前权限尚未核对。',confidence:'inferred',dueAt:'2026-11-01T08:30:00.000Z',dueAtBasis:'relative',evidence:[{id:'mail1',source:'gmail',at:'2026-10-29T08:30:00.000Z',url:'https://mail.google.com/mail/u/0/#all/mail1'}]};
const coverage=[{source:'gmail',status:'partial',count:1,truncated:true},{source:'calendar',status:'unavailable',count:null}];
test('review rendering uses Chinese sources, local readable dates and a single feedback footer',()=>{
  const text=renderPersonalReview([structuredClone(item)],coverage,{kind:'daily',now:'2026-10-29T09:00:00.000Z',timeZone:'America/Mexico_City'});
  assert.match(text,/America\/Mexico_City/);assert.match(text,/2026.*10.*29.*03:00/);assert.match(text,/估算期限.*11.*01.*02:30/);assert.match(text,/来源：邮件/);assert.match(text,/日历.*未获取.*未知/);
  assert.ok(text.includes(item.evidence[0].url));assert.ok(text.lastIndexOf('个人回顾「事项原题」已处理')>text.lastIndexOf('覆盖：'));assert.equal(text.match(/刚收到的预览也可按第几条反馈/g)?.length,1);assert.doesNotMatch(text,/review_[a-f0-9]+|T08:30:00|gmail|关联或期限为推断，尚未独立核实/);
});
test('UTC fallback and limited coverage remain explicit without repeated inference disclaimers',()=>{
  const text=renderPersonalReview([structuredClone(item)],coverage,{kind:'weekly',now:'2026-10-29T09:00:00.000Z'});
  assert.match(text,/UTC/);assert.match(text,/每周回顾/);assert.match(text,/估算期限/);assert.match(text,/核对原文/);assert.match(text,/限量|未完整覆盖/);assert.match(text,/待核对：当前权限尚未核对/);assert.ok(text.length<=3200);
});
