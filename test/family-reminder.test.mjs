import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFamilyReminder} from '../src/family-reminder.js';

const reference=new Date('2026-10-26T12:00:10.000Z');
const owner={familySessionId:'family_owner_1',bindingRevision:'a'.repeat(64),sourceRequestId:'wechat-'+'b'.repeat(64),sourceTimingState:'fresh',sourceTiming:{receivedAt:'2026-10-26T12:00:02.000Z',providerCreatedAt:'2026-10-26T12:00:00.000Z'},userText:'2分钟后提醒我「喝水」'};

test('one complete owner message determines content and time, independently of model arguments',()=>{const result=parseFamilyReminder(owner,reference);assert.equal(result.title,'喝水');assert.equal(result.dueAt,'2026-10-26T12:02:00.000Z');assert.deepEqual(result,parseFamilyReminder({...owner,userText:'2分钟后提醒我「喝水」'},reference));});
test('common Chinese minute expressions use the same fixed source-time anchor',()=>{for(const [word,minutes] of [['一',1],['两',2],['十',10],['十二',12],['二十',20],['五十九',59],['六十',60]]){const r=parseFamilyReminder({...owner,userText:`麻烦${word}分钟后提醒我「喝水」`},reference);assert.equal(Date.parse(r.dueAt)-Date.parse(owner.sourceTiming.providerCreatedAt),minutes*60000);}});
test('unknown, stale, missing, forged or expired timing is rejected',()=>{for(const bad of [{sourceTimingState:'unknown'},{sourceTimingState:'stale'},{sourceTiming:{receivedAt:'2026-10-26T12:00:02.000Z'}},{sourceRequestId:'bogus'},{bindingRevision:'b'},{sourceTiming:{receivedAt:'2026-10-26T12:01:00.000Z',providerCreatedAt:'2026-10-26T12:01:00.000Z'}}])assert.throws(()=>parseFamilyReminder({...owner,...bad},reference));assert.throws(()=>parseFamilyReminder(owner,new Date('2026-10-26T12:02:01.000Z')));});
test('ambiguous, multi-action, preview and unquoted requests do not become schedules',()=>{for(const text of ['提醒我喝水','2分钟后提醒我喝水','2 分钟后提醒我「喝水」','2分钟后提醒我 「喝水」','2分钟后提醒我「喝水」，再发邮件','不要2分钟后提醒我「喝水」','如果可以，2分钟后提醒我「喝水」','2分钟后提醒我「喝水」和「吃饭」','0分钟后提醒我「喝水」','999分钟后提醒我「喝水」'])assert.throws(()=>parseFamilyReminder({...owner,userText:text},reference),text);});
