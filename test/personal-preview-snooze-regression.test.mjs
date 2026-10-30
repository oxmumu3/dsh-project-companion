import test from 'node:test';
import assert from 'node:assert/strict';
import {createPersonalReviewService} from '../src/personal-review.js';

test('definite delivery failure preserves an elapsed snooze for the next occurrence',async t=>{
 const caller={sessionId:'synthetic-snooze',cwd:'/synthetic'};
 const evidence={id:'e1',source:'gmail',title:'Synthetic risk',text:'A review is required.',at:'2026-10-30T14:00:00.000Z'};
 const candidate={key:'synthetic-risk',kind:'risk',title:'合成风险',summary:'有待检查的合成风险。',why:'需要核对。',action:'检查通知。',unknown:'影响未知。',evidenceIds:['e1'],priority:'high',confidence:'source'};
 let stored,instant=new Date('2026-10-30T15:00:00.000Z'),sends=0;
 const service=createPersonalReviewService({store:{get:async()=>structuredClone(stored),put:async(_key,value)=>{stored=structuredClone(value);}},clock:()=>instant,readBinding:async()=>({bound:true,bindingKey:'a'.repeat(64)}),authorization:async()=>'b'.repeat(64),collect:async()=>({evidence:[evidence],coverage:[{source:'gmail',status:'ok',count:1}]}),summarize:async()=>({items:[candidate]}),send:async()=>({status:++sends===2?'failed':'reported_sent'})});
 t.after(()=>service.close());
 await service.act(caller,{action:'configure',sources:['gmail'],projects:[],schedule:{dailyTime:'09:00',timeZone:'America/Mexico_City'},requestId:'configure',userRequested:true});
 assert.equal((await service.tick())[0].status,'reported_sent');
 await service.act(caller,{action:'feedback',itemId:stored.items[0].id,feedback:'snoozed',snoozeUntil:'2026-10-31T14:00:00.000Z',requestId:'snooze',userRequested:true});
 instant=new Date('2026-10-31T15:00:00.000Z');
 assert.equal((await service.tick())[0].status,'failed');
 assert.equal(stored.items[0].status,'snoozed');
 assert.equal(stored.items[0].snoozeUntil,'2026-10-31T14:00:00.000Z');
 instant=new Date('2026-11-01T15:00:00.000Z');
 assert.equal((await service.tick())[0].status,'reported_sent');
 assert.equal(sends,3);
});
