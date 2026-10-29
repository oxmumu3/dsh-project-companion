import {canonicalizeTimeZone,resolveLocalInstant} from '../vendor/proactive/lib/domain.js';

export function isCalendarDate(value){
  if(typeof value!=='string'||!/^\d{4}-\d\d-\d\d$/.test(value))return false;
  const epoch=Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(epoch)&&new Date(epoch).toISOString().slice(0,10)===value;
}
const reject=()=>{throw new Error('Calendar event bounds unavailable');};
function timed(value){
  if(typeof value!=='string'||value.length>60||!/^\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)||!isCalendarDate(value.slice(0,10)))reject();
  const result=Date.parse(value);if(!Number.isFinite(result))reject();return result;
}
/** Interval bounds only. An all-day event keeps dates and never gains a timed deadline. */
export function calendarEventBounds(row){
  if(!row?.start||!row?.end)reject();
  const allDay=row.start.date!==undefined||row.end.date!==undefined;
  let startMs,endMs;
  if(allDay){
    if(!isCalendarDate(row.start.date)||!isCalendarDate(row.end.date)||row.start.dateTime!==undefined||row.end.dateTime!==undefined||typeof row.calendarTimeZone!=='string')reject();
    const timeZone=canonicalizeTimeZone(row.calendarTimeZone);
    const boundary=date=>{const [year,month,day]=date.split('-').map(Number);return resolveLocalInstant({year,month,day,hour:0,minute:0,second:0,millisecond:0},timeZone);};
    startMs=boundary(row.start.date);endMs=boundary(row.end.date);
  }else{startMs=timed(row.start.dateTime);endMs=timed(row.end.dateTime);}
  if(endMs<=startMs)reject();
  return{startMs,endMs,allDay};
}
