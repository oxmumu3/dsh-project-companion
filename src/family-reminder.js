// Only the Family bridge's current verified Owner call supplies these fields.
// No fallback to a model timestamp, computer receipt time, or prior message.
export function parseFamilyReminder(scope,now=new Date()){
 const invalid=()=>{throw new Error('当前消息的时间或提醒内容无法安全确认，尚未创建提醒。');};
 if(typeof scope?.familySessionId!=='string'||!scope.familySessionId.startsWith('family_owner_')||!/^[a-f0-9]{64}$/.test(scope.bindingRevision??'')||!/^wechat-[a-f0-9]{64}$/.test(scope.sourceRequestId??'')||scope.sourceTimingState!=='fresh')invalid();
 const {receivedAt,providerCreatedAt}=scope.sourceTiming??{};
 const stamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value?Date.parse(value):NaN;
 const received=stamp(receivedAt),created=stamp(providerCreatedAt),current=now instanceof Date?now.getTime():NaN;
 if(![received,created,current].every(Number.isFinite)||created>received+5000||received>current+5000||received-created>30000||current-received>30000||current-created>35000)invalid();
 const match=typeof scope.userText==='string'?scope.userText.trim().match(/^(?:请|帮我|麻烦)?\s*([1-9]|[1-5]\d|60|[一二两三四五六七八九十]{1,3})分钟后提醒我「([^「」\r\n\u0000-\u001f]{1,80})」[。！!]?$/u):null;
 if(!match||match[2].trim()!==match[2]||!match[2].trim())invalid();
 const digit={'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9},word=match[1];let minutes;
 if(/^\d+$/.test(word))minutes=Number(word);else if(word==='十')minutes=10;else if(word.includes('十')){const parts=word.split('十');if(parts.length!==2||parts[0].length>1||parts[1].length>1)invalid();minutes=(parts[0]?digit[parts[0]]:1)*10+(parts[1]?digit[parts[1]]:0);}else minutes=digit[word];
 if(!Number.isInteger(minutes)||minutes<1||minutes>60)invalid();
 const due=created+minutes*60000;if(due<=current)invalid();
 return{title:match[2],dueAt:new Date(due).toISOString()};
}
