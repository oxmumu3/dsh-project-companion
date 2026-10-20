import {sessionLogOf} from '../vendor/proactive/lib/wake.js';

const MAX_EVENTS=2000,MAX_REPLY=3200;
const identity=value=>typeof value==='string'&&value.length>0&&value.length<=200;
const turnOf=event=>Number.isInteger(event?.data?.turn)&&event.data.turn>=0?event.data.turn:null;
const boundary=event=>event?.type==='turn/start'||event?.type==='turn/end';
const statuses=new Set(['pending','running','generated','no_text','stopped','mixed','unknown']);
const unknown=()=>({status:'unknown'});
function iso(value){
  if(typeof value!=='string'||value.length>32||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value))return undefined;
  const epoch=Date.parse(value);return Number.isFinite(epoch)?new Date(epoch).toISOString():undefined;
}
function excerpt(value){
  if(typeof value!=='string')return{reply:'',truncated:false};
  // The source itself may be arbitrarily large. Only clean the bounded prefix.
  const prefix=value.slice(0,MAX_REPLY+2).toWellFormed().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').trim();
  let reply='';for(const char of prefix){if(reply.length+char.length>MAX_REPLY)break;reply+=char;}
  return{reply,truncated:value.length>MAX_REPLY+2||prefix.length>reply.length};
}

/** Only the small public result shape crosses the onboarding HTTP boundary. */
export function normalizeWelcomeOutcome(value){
  if(!value||!statuses.has(value.status))return unknown();
  const result={status:value.status};
  if(value.status==='generated'){
    const text=excerpt(value.reply);if(!text.reply)return unknown();
    result.reply=text.reply;
    if(text.truncated||value.replyTruncated===true)result.replyTruncated=true;
  }
  if(['generated','no_text','stopped'].includes(value.status)){
    const finishedAt=iso(value.finishedAt);if(finishedAt)result.finishedAt=finishedAt;
  }
  return result;
}

/**
 * Passive evidence from one existing live Session. No resume, inbox operation,
 * transport inspection, model invocation or raw history is exposed here.
 * The original committed user message must sit inside its own explicit turn.
 */
export function observeWelcomeOutcome({session,sessionId,messageId}={}){
  if(!identity(sessionId)||!identity(messageId)||String(session?.id??'')!==sessionId)return unknown();
  let events;
  try{const log=sessionLogOf(session);if(!Array.isArray(log))return unknown();events=log.slice(-MAX_EVENTS);}catch{return unknown();}
  const matches=[];
  for(let index=0;index<events.length;index++){
    const event=events[index];
    if(event?.type==='user/message'&&event.data?.id===messageId)matches.push(index);
  }
  if(matches.length!==1)return unknown();
  const anchor=matches[0],input=events[anchor],turn=turnOf(input);
  if(input.data?.source?.kind!=='user'||turn===null)return unknown();
  let first=anchor-1;while(first>=0&&!boundary(events[first]))first--;
  if(first<0||events[first].type!=='turn/start'||turnOf(events[first])!==turn)return unknown();
  let last=anchor+1;while(last<events.length&&!boundary(events[last]))last++;
  if(last<events.length&&(events[last].type!=='turn/end'||turnOf(events[last])!==turn))return unknown();
  // Scan the complete claimed turn, including inputs before the anchor. A new
  // direct user input makes attribution ambiguous even if its turn is omitted.
  let reply='',replyTruncated=false;
  for(let index=first+1;index<last;index++){
    const event=events[index],data=event?.data;
    if(event?.type==='user/message'&&data?.source?.kind==='user'&&data.id!==messageId)return{status:'mixed'};
    if(index<=anchor||event?.type!=='assistant/message'||turnOf(event)!==turn||data?.interrupted===true||data?.message?.role&&data.message.role!=='assistant')continue;
    const blocks=Array.isArray(data.blocks)?data.blocks:Array.isArray(data.message?.content)?data.message.content:null;
    let text='',truncated=false;
    if(blocks){
      for(const block of blocks.slice(0,100)){
        if(block?.type!=='text'||typeof block.text!=='string'||!block.text.slice(0,MAX_REPLY+2).trim())continue;
        if(text)text+='\n';
        const remaining=MAX_REPLY+2-text.length;
        if(remaining<=0){truncated=true;break;}
        text+=block.text.slice(0,remaining);if(block.text.length>remaining)truncated=true;
      }
      if(blocks.length>100)truncated=true;
    }else if(typeof data.text==='string')text=data.text;
    const clean=excerpt(text);
    if(clean.reply){reply=clean.reply;replyTruncated=truncated||clean.truncated;}
  }
  if(last===events.length)return{status:'running'};
  const finishedAt=iso(events[last].time),metadata=finishedAt?{finishedAt}:{};
  const reason=events[last].data?.reason;
  if((typeof reason==='string'?reason:reason?.kind)!=='completed')return{status:'stopped',...metadata};
  return reply?{status:'generated',reply,...(replyTruncated?{replyTruncated:true}:{}),...metadata}:{status:'no_text',...metadata};
}
