import {reviewOutputRules,safeReviewOutputRule} from './review-output-diagnostics.js';
import {z} from 'zod';
import {safeModelCallDiagnostic} from './news-model.js';
import {reviewSourceDiagnosticsSchema,safeReviewSourceDiagnostics} from './personal-review-source-diagnostics.js';
const MODEL_CODES = new Set(['MODEL_UNAVAILABLE','MODEL_TIMEOUT','MODEL_ABORTED','MODEL_CLOSED','MODEL_REQUEST_FAILED','MODEL_INCOMPLETE','MODEL_OUTPUT_LIMIT','MODEL_TOKEN_LIMIT','MODEL_TOOL_OUTPUT','MODEL_INVALID_INPUT','MODEL_INVALID_OUTPUT','MODEL_AUTHORIZATION_CHANGED']);
const REVIEW_CODES = new Set(['REVIEW_AUTHORIZATION_UNAVAILABLE','REVIEW_AUTHORIZATION_REQUIRED','REVIEW_AUTHORIZATION_CHANGED','REVIEW_BINDING_CHANGED','REVIEW_REQUEST_EXPIRED','REVIEW_CANCELLED','REVIEW_TIMEOUT','REVIEW_PAUSED','REVIEW_COLLECTION_FAILED','REVIEW_VALIDATION_FAILED','REVIEW_MODEL_FAILED','REVIEW_DELIVERY_FAILED','REVIEW_FAILED']);
const stages = new Set(['authorization','collection','validation','model','delivery','cancelled','unknown']);
const labels = {authorization:'个人回顾授权已变化或不可用。',collection:'个人回顾来源读取未完成。',validation:'个人回顾资料格式未通过校验。',model:'个人回顾模型整理未完成。',delivery:'个人回顾发送未完成。',cancelled:'个人回顾已取消或停止。',unknown:'个人回顾本次未能完成。'};
const routeReasons={
 current:['CURRENT'],
 offline:['ROUTE_OFFLINE','BRIDGE_OFFLINE'],
 unknown:['ROUTE_UNKNOWN','ROUTE_FAILED','ROUTE_INVALID','DELEGATION_CLOSED','DELEGATION_NOT_READY','DELEGATION_INVALID','BRIDGE_UNAVAILABLE','BRIDGE_UNKNOWN','BRIDGE_FAILED','LEASES_UNAVAILABLE'],
 changed:['ROUTE_CHANGED','DELEGATION_DISABLED','DELEGATION_BINDING_CHANGED','BRIDGE_CHANGED','CREDENTIAL_BINDING_CHANGED','LEASE_BINDING_CHANGED','LEASE_CHANGED'],
};
const routeFields={state:z.enum(['current','offline','unknown','changed']),reason:z.enum(Object.values(routeReasons).flat())};
export const personalReviewAvailabilitySchema=z.object(routeFields).strict().refine(row=>routeReasons[row.state].includes(row.reason));
export const personalReviewGuardCodeSchema=z.enum(['REVIEW_AUTHORIZATION_UNAVAILABLE','REVIEW_AUTHORIZATION_REQUIRED','REVIEW_AUTHORIZATION_CHANGED','REVIEW_BINDING_CHANGED','REVIEW_REQUEST_EXPIRED','REVIEW_CANCELLED','REVIEW_TIMEOUT','REVIEW_PAUSED','REVIEW_FAILED']);
export const personalReviewRecoveryDiagnosticSchema=z.object({...routeFields,reason:z.enum([...Object.values(routeReasons).flat(),'GUARD_REJECTED']),guardCode:personalReviewGuardCodeSchema.optional()}).strict().refine(row=>row.reason==='GUARD_REJECTED'?row.state==='changed'&&row.guardCode!==undefined:row.state!=='current'&&row.guardCode===undefined&&routeReasons[row.state].includes(row.reason));
export const personalReviewDiagnosticSchema=z.object({stage:z.enum([...stages]),code:z.enum([...MODEL_CODES,...REVIEW_CODES]),...Object.fromEntries(['sourceCount','projectCount','evidenceCount','coverageCount','elapsedMs'].map(key=>[key,z.number().int().min(0).max(1000000000).optional()])),sourceDiagnostics:reviewSourceDiagnosticsSchema.optional(),outputRule:z.enum(reviewOutputRules).optional(),model:z.object({requestedMaxTokens:z.number().int().nullable(),preparedMaxTokens:z.number().int().nullable(),reasoningEffort:z.string().max(20),finish:z.string().max(20),finishDetail:z.enum(['error','aborted','tool-calls','other']).optional(),failureCode:z.enum(['NO_ADAPTER','MISSING_CREDENTIAL','INVALID_CREDENTIAL','AUTH','RATE_LIMIT','CONTEXT_WINDOW_EXCEEDED','QUOTA','ACCOUNT_QUOTA','ABORTED','other']).optional(),textChars:z.number().int().nullable(),reasoningChars:z.number().int().nullable(),outputTokens:z.number().int().nullable(),reasoningTokens:z.number().int().nullable()}).strict().optional()}).strict();
const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 1000000000 ? value : null;
export function personalReviewFailure(error, details = {}) {
 const code = MODEL_CODES.has(error?.code) || REVIEW_CODES.has(error?.code) ? error.code : REVIEW_CODES.has(details.code) ? details.code : 'REVIEW_FAILED';
 const stage = /AUTHORIZATION|BINDING|REQUEST_EXPIRED/.test(code) ? 'authorization' : code === 'REVIEW_CANCELLED' || code === 'MODEL_ABORTED' || code === 'MODEL_CLOSED' ? 'cancelled' : stages.has(details.stage) ? details.stage : stages.has(error?.reviewDiagnostic?.stage) ? error.reviewDiagnostic.stage : code.startsWith('MODEL_') ? 'model' : 'unknown';
 const diagnostic = {stage,code};
 const outputRule=safeReviewOutputRule(error?.outputRule ?? error?.reviewDiagnostic?.outputRule);if(code==='MODEL_INVALID_OUTPUT'&&outputRule)diagnostic.outputRule=outputRule;
 for(const key of ['sourceCount','projectCount','evidenceCount','coverageCount','elapsedMs']) {
  const value=count(details[key] ?? error?.reviewDiagnostic?.[key]); if(value!==null)diagnostic[key]=value;
 }
 const model=safeModelCallDiagnostic(details.model ?? error?.modelDiagnostic ?? error?.reviewDiagnostic?.model);if(model)diagnostic.model=model;
 const sourceDiagnostics=safeReviewSourceDiagnostics(details.sourceDiagnostics ?? error?.reviewDiagnostic?.sourceDiagnostics);if(sourceDiagnostics.length)diagnostic.sourceDiagnostics=sourceDiagnostics;
 const result = Object.assign(new Error(code==='REVIEW_TIMEOUT'?'个人回顾本次处理超时，尚未完成。':code==='REVIEW_BINDING_CHANGED'?'个人回顾原微信绑定已变化。':labels[stage]),{name:'PersonalReviewError',code,reviewDiagnostic:diagnostic});
 return result;
}
