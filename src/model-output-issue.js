import {z} from 'zod';

// Fixed vocabulary only. Never retain the rejected value, dynamic key, array
// index, source ID, Zod message, provider text or full validation path.
export const modelOutputFields=['root','items','item','ids','id','key','kind','tier','title','summary','why','action','unknown','evidenceIds','priority','confidence','dueAt','deadlineId','eventStartAt','eventEndAt','coverage','other'];
export const modelOutputRules=['json','type','extra_field','count','enum','length','empty','format','content','language','link','identity','source_metadata','other'];
export const modelOutputIssueSchema=z.object({field:z.enum(modelOutputFields),rule:z.enum(modelOutputRules)}).strict();
export function safeModelOutputIssue(value){
 try{const result=modelOutputIssueSchema.safeParse(value);return result.success?result.data:undefined;}catch{return undefined;}
}
export function reviewSchemaOutputIssue(error){
 const issue=Array.isArray(error?.issues)?error.issues[0]:undefined,path=Array.isArray(issue?.path)?issue.path:[];
 let field='root';
 if(path.length){
  field=path[0]==='items'?(path.length===1?'items':Number.isInteger(path[1])?(path.length===2?'item':modelOutputFields.includes(path[2])?path[2]:'other'):'other'):'other';
 }
 const arrayField=['items','evidenceIds'].includes(field);
 const rule={invalid_type:'type',unrecognized_keys:'extra_field',invalid_value:'enum',invalid_format:'format',too_big:arrayField?'count':'length',too_small:arrayField?'count':'empty',custom:'content'}[issue?.code]??'other';
 return {field,rule};
}
