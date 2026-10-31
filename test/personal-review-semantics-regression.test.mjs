import test from 'node:test';
import assert from 'node:assert/strict';
import {createPersonalReviewCollector} from '../src/personal-review-collect.js';
import {validatePersonalReviewSummary,mergeReviewItems,selectReviewItems,renderPersonalReview} from '../src/personal-review-ledger.js';
const now='2026-10-30T06:23:00.000Z',start='2026-10-30T16:30:00.000Z',end='2026-10-30T17:30:00.000Z';
const scope={caller:{sessionId:'synthetic',cwd:'/synthetic'},sources:[],projects:[],from:'2026-10-29T06:23:00.000Z',to:now,kind:'daily',signal:new AbortController().signal,guard:async()=>true};
const candidate=extra=>({key:'synthetic-event',kind:'event',title:'合成评审日程',summary:'已安排一次评审。',why:'日程临近，可以核对是否需要准备。',action:'查看日程安排。',unknown:'准备程度未知。',evidenceIds:['event1'],priority:'normal',confidence:'source',eventStartAt:start,eventEndAt:end,...extra});
const event={id:'event1',source:'calendar',title:'Synthetic meeting',text:`开始：${start}\n结束：${end}`,eventStartAt:start,eventEndAt:end,url:'https://www.google.com/calendar/event?eid=synthetic'};
const collector=query=>createPersonalReviewCollector({query,readProject:async()=>[]});

test('calendar meeting start/end survive as event times, never a task deadline',async()=>{
 const collect=collector(async()=>({items:[{id:'event1',title:'Synthetic meeting',text:`开始：${start}\n结束：${end}`,dueAt:start,url:event.url}]}));
 const result=await collect({...scope,sources:['calendar']});
 assert.equal(result.evidence[0].dueAt,undefined);
 assert.equal(result.evidence[0].eventStartAt,start);assert.equal(result.evidence[0].eventEndAt,end);
});

test('Drive metadata, supported empty return, unsupported and unread rows retain distinct evidence states',async()=>{
 const collect=collector(async(_owner,args)=>{
  if(args.operation==='recent')return{items:['read','empty','unsupported','unread'].map(id=>({id,title:'Synthetic '+id,text:''}))};
  return{items:[args.id==='read'?{id:args.id,text:'A verified body excerpt.'}:args.id==='empty'?{id:args.id,text:''}:{id:args.id,text:'Unsupported format',status:'unsupported_content'}]};
 });
 const result=await collect({...scope,sources:['drive']});const byTitle=new Map(result.evidence.map(e=>[e.title,e]));
 assert.equal(byTitle.get('Synthetic read').contentState,'read');
 assert.equal(byTitle.get('Synthetic empty').contentState,'actual_empty');assert.equal(byTitle.get('Synthetic empty').contentScope,'returned_text');
 assert.equal(byTitle.get('Synthetic unsupported').contentState,'unavailable');
 assert.equal(byTitle.get('Synthetic unread').contentState,'metadata_only');
 assert.equal(result.coverage[0].status,'partial');
});

test('failed and truncated Drive reads remain unknown or limited, not empty documents',async()=>{
 for(const outcome of ['failed','truncated']){
  const collect=collector(async(_owner,args)=>{
   if(args.operation==='recent')return{items:[{id:'x',title:'Synthetic file',text:''}]};
   if(outcome==='failed')throw Error('Synthetic failure');
   return{items:[{id:'x',text:'A limited excerpt.'}],truncated:true};
  });
  const result=await collect({...scope,sources:['drive']});
  assert.equal(result.evidence[0].contentState,outcome==='failed'?'unavailable':'truncated');
  assert.equal(result.coverage[0].status,'partial');
 }
});

test('calendar source cannot ground a deadline even when its ISO start appears in body text',()=>{
 const wrong=candidate({kind:'deadline',dueAt:start});delete wrong.eventStartAt;delete wrong.eventEndAt;
 assert.throws(()=>validatePersonalReviewSummary({items:[wrong]},[event]));
 assert.equal(validatePersonalReviewSummary({items:[candidate()]},[event]).items[0].eventStartAt,start);
 assert.throws(()=>validatePersonalReviewSummary({items:[candidate({eventStartAt:'2026-11-01T09:00:00.000Z'})]},[event]));
});

test('calendar-only prose cannot turn a meeting into a deadline without a dueAt field',()=>{
 for(const patch of [{summary:'今天有截止时间。'},{kind:'deadline',eventStartAt:undefined,eventEndAt:undefined},{why:'会议快到期了。'},{action:'处理这项 deadline。'}]){
  assert.throws(()=>validatePersonalReviewSummary({items:[candidate(patch)]},[event]));
 }
});

test('Drive missing or zero returned text never supports a claim that the file is empty or not updated',()=>{
 for(const contentState of ['metadata_only','unread','unavailable','truncated','actual_empty']){
  const drive={id:'drive1',source:'drive',title:'Synthetic related sheet',text:'',contentState,contentScope:'returned_text'};
  const item={...candidate({kind:'risk',eventStartAt:undefined,eventEndAt:undefined,evidenceIds:['drive1']}),title:'资料待核对'};
  for(const summary of ['相关表大多是空的。','这个文件为空。','表没有更新。','资料未更新，会议准备不足。'])assert.throws(()=>validatePersonalReviewSummary({items:[{...item,summary}]},[drive]));
  assert.equal(validatePersonalReviewSummary({items:[{...item,summary:'本次没有得到可用正文，内容仍未知。',why:'需要以可读原文判断。',action:'打开原文件核对。'}]},[drive]).items.length,1);
 }
 const explicit={id:'drive1',source:'drive',title:'Synthetic confirmed note',text:'负责人确认：资料未更新。',contentState:'read',contentScope:'returned_text'};
 assert.equal(validatePersonalReviewSummary({items:[candidate({kind:'risk',eventStartAt:undefined,eventEndAt:undefined,evidenceIds:['drive1'],summary:'负责人在文档中写明资料未更新。'})]},[explicit]).items.length,1);
});

test('reclassifying an old calendar deadline removes obsolete deadline fields but keeps stable feedback identity',()=>{
 const legacy={...candidate({kind:'deadline',eventStartAt:undefined,eventEndAt:undefined,dueAt:start}),evidenceIds:['event1']};
 const old=mergeReviewItems([],[legacy],[{...event,dueAt:start}],{now,scopeKey:'a'.repeat(64)});
 const updated=mergeReviewItems(old,[candidate()],[event],{now,scopeKey:'a'.repeat(64)});
 assert.equal(updated.length,1);assert.equal(updated[0].id,old[0].id);assert.equal(updated[0].dueAt,undefined);assert.equal(updated[0].dueAtBasis,undefined);assert.equal(updated[0].eventStartAt,start);
});

test('rendered upcoming event retains source and stable feedback identity without deadline wording',()=>{
 const checked=validatePersonalReviewSummary({items:[candidate()]},[event]);
 const items=mergeReviewItems([],checked.items,[event],{now,scopeKey:'a'.repeat(64)});
 const result=renderPersonalReview(items,[{source:'calendar',status:'ok',count:1}],{now,kind:'daily',timeZone:'America/Mexico_City'});
 assert.match(result,/日程：/);assert.doesNotMatch(result,/期限：/);assert.match(result,/https:\/\/www.google.com\/calendar/);assert.match(items[0].id,/^review_[a-f0-9]{32}$/);assert.doesNotMatch(result,/review_[a-f0-9]{32}/);assert.match(result,/个人回顾「事项原题」已处理/);
});

test('known event times repeated by the model render in the same local time zone as the event line',()=>{
 const checked=validatePersonalReviewSummary({items:[candidate({summary:`日程从${start}开始，到2026-10-30T17:30:00Z结束。`})]},[event]);
 const items=mergeReviewItems([],checked.items,[event],{now,scopeKey:'a'.repeat(64)});
 const result=renderPersonalReview(items,[{source:'calendar',status:'ok',count:1}],{now,kind:'daily',timeZone:'America/Mexico_City'});
 assert.doesNotMatch(result,/T16:30|T17:30/);assert.match(result,/日程从10月30日 10:30开始，到10月30日 11:30结束/);
});

test('short UTC clock values localize only when uniquely matched to this item’s verified times',()=>{
 const checked=validatePersonalReviewSummary({items:[candidate({summary:'日程从16:30Z到17:30:00Z；另一个18:30Z没有来源时间。'})]},[event]);
 const items=mergeReviewItems([],checked.items,[event],{now,scopeKey:'a'.repeat(64)});
 const result=renderPersonalReview(items,[{source:'calendar',status:'ok',count:1}],{now,kind:'daily',timeZone:'America/Mexico_City'});
 assert.match(result,/从10月30日 10:30到10月30日 11:30/);assert.match(result,/18:30Z/);
 const nextEnd='2026-10-31T16:30:00.000Z';const multiDay={...event,eventEndAt:nextEnd};
 const ambiguous=validatePersonalReviewSummary({items:[candidate({summary:'日程边界为16:30Z。',eventEndAt:nextEnd})]},[multiDay]);
 const ambiguousItems=mergeReviewItems([],ambiguous.items,[multiDay],{now,scopeKey:'a'.repeat(64)});
 assert.match(renderPersonalReview(ambiguousItems,[{source:'calendar',status:'ok',count:1}],{now,kind:'daily',timeZone:'America/Mexico_City'}),/日程边界为16:30Z/);
});

test('rendering preserves the exact item title used by human feedback while localizing body times',()=>{
 const title=`日程 ${start}`;
 const checked=validatePersonalReviewSummary({items:[candidate({title,summary:`会议从${start}开始。`})]},[event]);
 const items=mergeReviewItems([],checked.items,[event],{now,scopeKey:'a'.repeat(64)});
 const result=renderPersonalReview(items,[{source:'calendar',status:'ok',count:1}],{now,kind:'daily',timeZone:'America/Mexico_City'});
 assert.ok(result.includes(`1. ${title}\n`));assert.match(result,/会议从10月30日 10:30开始/);
});

test('past calendar events do not keep nagging in daily or weekly reviews',()=>{
 const checked=validatePersonalReviewSummary({items:[candidate()]},[event]);
 const items=mergeReviewItems([],checked.items,[event],{now,scopeKey:'a'.repeat(64)});
 for(const kind of ['daily','weekly'])assert.equal(selectReviewItems(items,{now:'2026-10-31T06:23:00.000Z',kind,occurrence:'next',scopeKey:'a'.repeat(64)}).length,0);
 const legacy={...items[0],kind:'deadline',dueAt:start,evidence:[{...event,dueAt:start,eventStartAt:undefined,eventEndAt:undefined}]};delete legacy.eventStartAt;delete legacy.eventEndAt;
 for(const kind of ['daily','weekly'])assert.equal(selectReviewItems([legacy],{now:'2026-10-31T06:23:00.000Z',kind,occurrence:'next',scopeKey:'a'.repeat(64)}).length,0);
});

test('rescheduled event changes revision and drops a no-longer-supplied end time',()=>{
 const original=mergeReviewItems([],[candidate()],[event],{now,scopeKey:'a'.repeat(64)});
 const changedStart='2026-10-30T18:00:00.000Z';
 const changedEvidence={...event,eventStartAt:changedStart,eventEndAt:undefined,text:event.text};
 const updated=mergeReviewItems(original,[candidate({eventStartAt:changedStart,eventEndAt:undefined})],[changedEvidence],{now,scopeKey:'a'.repeat(64)});
 assert.equal(updated[0].revision,original[0].revision+1);assert.equal(updated[0].eventEndAt,undefined);
});

test('legacy mixed-source deadline is not silently reclassified as an expired calendar event',()=>{
 const items=mergeReviewItems([],[candidate({kind:'deadline',eventStartAt:undefined,eventEndAt:undefined,dueAt:start})],[event],{now,scopeKey:'a'.repeat(64)});
 items[0].evidence=[{...event,dueAt:start},{id:'mail1',source:'gmail',title:'Explicit delivery deadline in original message'}];
 assert.equal(selectReviewItems(items,{now:'2026-10-31T06:23:00.000Z',kind:'weekly',occurrence:'next',scopeKey:'a'.repeat(64)}).length,1);
});
