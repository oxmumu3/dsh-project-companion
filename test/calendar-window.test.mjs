import test from 'node:test';
import assert from 'node:assert/strict';
const api=()=>import('../src/calendar-window.js').catch(()=>({}));
test('calendar day bounds use source timezone and exclusive next date across DST',async()=>{
 const {calendarEventBounds}=await api();assert.equal(typeof calendarEventBounds,'function');
 const row={start:{date:'2026-11-01'},end:{date:'2026-11-02'},calendarTimeZone:'America/New_York'};
 const result=calendarEventBounds(row);
 assert.deepEqual(result,{startMs:Date.parse('2026-11-01T04:00:00Z'),endMs:Date.parse('2026-11-02T05:00:00Z'),allDay:true});
 assert.equal(result.endMs-result.startMs,25*3600000);
 assert.deepEqual(row.start,{date:'2026-11-01'});
});
test('timed bounds retain explicit offsets without needing calendar timezone',async()=>{
 const {calendarEventBounds}=await api();assert.equal(typeof calendarEventBounds,'function');
 assert.deepEqual(calendarEventBounds({start:{dateTime:'2026-10-29T10:00:00-06:00'},end:{dateTime:'2026-10-29T11:00:00-06:00'}}),{startMs:Date.parse('2026-10-29T16:00:00Z'),endMs:Date.parse('2026-10-29T17:00:00Z'),allDay:false});
});
test('all-day bounds never guess missing zones or normalize invalid source dates',async()=>{
 const {calendarEventBounds}=await api();assert.equal(typeof calendarEventBounds,'function');
 for(const row of [
  {start:{date:'2026-10-29'},end:{date:'2026-10-30'}},
  {start:{date:'2026-02-31'},end:{date:'2026-03-02'},calendarTimeZone:'UTC'},
  {start:{date:'2026-10-29'},end:{date:'2026-10-29'},calendarTimeZone:'UTC'},
  {start:{date:'2026-10-29'},end:{date:'2026-10-30'},calendarTimeZone:'not-a-zone'},
  {start:{date:'2026-10-29'},end:{dateTime:'2026-10-30T00:00:00Z'},calendarTimeZone:'UTC'},
 ])assert.throws(()=>calendarEventBounds(row));
});
