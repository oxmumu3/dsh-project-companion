import {z} from 'zod';

// Fixed categories already used by the read-only context layer. Never retain
// provider messages, response bodies, IDs, paths, headers or credentials.
const codes=['CONTEXT_AUTH_REQUIRED','CONTEXT_INSUFFICIENT_SCOPE','CONTEXT_TIMEOUT','CONTEXT_HTTP_ERROR','CONTEXT_PROTOCOL_INVALID','CONTEXT_SCHEMA_MISMATCH','CONTEXT_SCOPE_VIOLATION','CONTEXT_BINDING_CHANGED','CONTEXT_NOT_ENABLED','CONTEXT_STOPPED','CONTEXT_INVALID_INPUT','CONTEXT_UNSUPPORTED_OPERATION','CONTEXT_UNAVAILABLE'];
const stages=['scope','build','catalog','call','projection','unknown'];
const operations=['search','upcoming','recent','projects','tasks','read','unknown'];
const sources=['gmail','calendar','drive','flomo','dida'];
export const reviewSourceFailureSchema=z.object({code:z.enum(codes),readStage:z.enum(stages),operation:z.enum(operations)}).strict();
export const reviewSourceDiagnosticSchema=reviewSourceFailureSchema.extend({source:z.enum(sources)}).strict();
export const reviewSourceDiagnosticsSchema=z.array(reviewSourceDiagnosticSchema).max(5).refine(rows=>new Set(rows.map(row=>row.source)).size===rows.length);

/** Fail-isolated classification of an existing read error; performs no IO. */
export function safeReviewSourceFailure(error,operation){
 const op=operations.includes(operation)?operation:'unknown';
 try{
  const code=error?.code,readStage=error?.readStage;
  return{code:codes.includes(code)?code:'CONTEXT_UNAVAILABLE',readStage:stages.includes(readStage)?readStage:'unknown',operation:op};
 }catch{return{code:'CONTEXT_UNAVAILABLE',readStage:'unknown',operation:op};}
}
export function safeReviewSourceDiagnostics(value){
 try{const parsed=reviewSourceDiagnosticsSchema.safeParse(value);return parsed.success?parsed.data:[];}catch{return[];}
}
export function reviewSourceDiagnosticsFromCoverage(coverage){
 return safeReviewSourceDiagnostics(coverage.filter(row=>sources.includes(row.source)&&row.diagnostic).map(row=>({source:row.source,...row.diagnostic})));
}
