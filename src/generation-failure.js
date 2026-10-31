import {safeModelCallDiagnostic} from './news-model.js';

const codes=new Set(['MODEL_UNAVAILABLE','MODEL_INVALID_INPUT','MODEL_INVALID_OUTPUT','MODEL_INCOMPLETE','MODEL_TOKEN_LIMIT','MODEL_OUTPUT_LIMIT','MODEL_TOOL_OUTPUT','MODEL_ABORTED','MODEL_TIMEOUT','MODEL_REQUEST_FAILED','MODEL_AUTHORIZATION_CHANGED','MODEL_CLOSED','NEWS_CANCELLED','NEWS_PAUSED','NEWS_TIMEOUT','NEWS_SOURCE_FAILED','NEWS_SELECTION_FAILED','NEWS_SUMMARY_FAILED','NEWS_ARTICLE_FAILED','NEWS_AUTHORIZATION_CHANGED','REVIEW_TIMEOUT','REVIEW_SOURCE_FAILED','REVIEW_AUTHORIZATION_UNAVAILABLE','REVIEW_AUTHORIZATION_REQUIRED','REVIEW_BINDING_CHANGED','REVIEW_REQUEST_EXPIRED','REVIEW_PAUSED','REVIEW_VALIDATION_FAILED','REVIEW_DELIVERY_FAILED','REVIEW_FAILED','REVIEW_COLLECTION_FAILED','REVIEW_MODEL_FAILED','REVIEW_AUTHORIZATION_CHANGED','REVIEW_REQUEST_CHANGED','REVIEW_CANCELLED','FAMILY_PERSONAL_REQUEST_CHANGED','FAMILY_PERSONAL_REQUEST_UNAVAILABLE','FAMILY_PERSONAL_AUTHORIZATION_CHANGED','GENERATION_FAILED']);
const stages=new Set(['authorization','sources','collection','model','selection','summary','article','delivery','validation','cancelled','unknown']);
const countKeys=['sourceCount','evidenceCount','candidateCount','selectedCount','completedSourceCount','projectCount','coverageCount','elapsedMs'];
const authorizationCodes=new Set(['MODEL_AUTHORIZATION_CHANGED','NEWS_AUTHORIZATION_CHANGED','REVIEW_AUTHORIZATION_CHANGED','REVIEW_REQUEST_CHANGED','REVIEW_CANCELLED','REVIEW_AUTHORIZATION_UNAVAILABLE','REVIEW_AUTHORIZATION_REQUIRED','REVIEW_BINDING_CHANGED','REVIEW_REQUEST_EXPIRED','REVIEW_PAUSED','FAMILY_PERSONAL_REQUEST_CHANGED','FAMILY_PERSONAL_REQUEST_UNAVAILABLE','FAMILY_PERSONAL_AUTHORIZATION_CHANGED']);

/** Only fixed codes, stages and bounded counts can cross the tool boundary. */
export function generationFailure(kind,error){
 const raw=kind==='news'?error?.newsDiagnostic:error?.reviewDiagnostic;
 const candidate=typeof error?.code==='string'?error.code:raw?.code;
 const code=codes.has(candidate)?candidate:'GENERATION_FAILED';
 const diagnostic={code,stage:stages.has(raw?.stage)?raw.stage:authorizationCodes.has(code)?'authorization':code.startsWith('MODEL_')?'model':'unknown'};
 for(const key of countKeys)if(Number.isSafeInteger(raw?.[key])&&raw[key]>=0&&raw[key]<=1000000000)diagnostic[key]=raw[key];
 const model=safeModelCallDiagnostic(raw?.model??error?.modelCallDiagnostic);if(model)diagnostic.model=model;
 const label=kind==='news'?'AI 日报':'个人回顾';
 let text,status='failed';
 if(['NEWS_CANCELLED','NEWS_PAUSED','REVIEW_CANCELLED','REVIEW_PAUSED','MODEL_ABORTED','MODEL_CLOSED'].includes(code)){status='blocked';text=`本次${label}已取消或暂停，处理已停止。`;}
 else if(code==='REVIEW_DELIVERY_FAILED')text=`本次${label}发送未完成，不能视为已送达。`;
 else if(code==='REVIEW_VALIDATION_FAILED')text=`本次${label}的资料格式未通过校验，未生成结果。`;
 else if(authorizationCodes.has(code)){
  status='blocked';text=`本次${label}的请求或授权范围已变化，已停止处理，未返回资料内容。请在前一条回复结束后再发预览请求。`;
 }else if(['MODEL_TIMEOUT','REVIEW_TIMEOUT','NEWS_TIMEOUT'].includes(code))text=`本次${label}整理未在限定时间内完成，未生成结果。`;
 else if(['MODEL_TOKEN_LIMIT','MODEL_OUTPUT_LIMIT'].includes(code))text=`本次${label}的模型输出达到上限，整理未完成。`;
 else if(code==='MODEL_UNAVAILABLE')text=`本次${label}无法连接到已配置的模型，整理未完成。`;
 else if(code.startsWith('MODEL_')||['NEWS_SELECTION_FAILED','NEWS_SUMMARY_FAILED','REVIEW_MODEL_FAILED'].includes(code))text=`本次${label}的整理环节未返回可用结果，尚未生成${label}。`;
 else if(['NEWS_SOURCE_FAILED','NEWS_ARTICLE_FAILED','REVIEW_SOURCE_FAILED','REVIEW_COLLECTION_FAILED'].includes(code))text=`本次${label}的资料读取未完成，覆盖情况仍未知，尚未生成${label}。`;
 else text=`本次${label}未能完成，具体失败环节尚未确认；不能据此判断账号授权有问题。`;
 return{status,text,diagnostic};
}

export function renderGenerationResult(value){
 const content=[{type:'text',text:value.text??JSON.stringify(value)}];
 if(value.diagnostic)content.push({type:'text',text:`内部脱敏诊断：${JSON.stringify(value.diagnostic)}。仅用于排障，不包含资料正文。准确解释失败环节，不推断未读取、账号失效或计划已取消，不自行重复执行本次预览。`});
 return content;
}
