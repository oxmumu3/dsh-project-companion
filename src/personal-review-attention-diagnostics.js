import {z} from 'zod';

const count=z.number().int().min(0).max(300);
const source=z.enum(['gmail','calendar','drive','flomo','dida','project','memory']);
const coverage=z.object({source,status:z.enum(['ok','partial','unavailable']),count:z.number().int().min(0).max(5000000).nullable(),truncated:z.boolean()}).strict();
export const attentionDecisionSchema=z.object({
 checkedAt:z.string().datetime(),deadlineThrough:z.string().datetime(),
 outcome:z.enum(['selected','no_actionable_in_covered_scope','sources_unavailable','budget_exhausted']),
 observedItems:count,evaluatedItems:count,eligibleItems:count,selectedItems:z.number().int().min(0).max(3),
 reasonCounts:z.object({scope_or_evidence:count,already_handled_or_not_new:count,not_urgent:count,estimated_deadline:count,outside_deadline_window:count}).strict(),
 coverage:z.array(coverage).max(7).refine(rows=>new Set(rows.map(r=>r.source)).size===rows.length),
}).strict();

/** A local closed projection. Never retain source text, titles, IDs or errors. */
export function attentionCoverageSummary(rows){
 const groups=new Map();
 for(const row of rows){if(!source.safeParse(row?.source).success)continue;const values=groups.get(row.source)??[];values.push(row);groups.set(row.source,values);}
 return [...groups].map(([source,values])=>{
  const usable=values.some(r=>['ok','partial'].includes(r.status));
  const complete=values.every(r=>r.status==='ok'&&r.truncated!==true);
  const known=values.every(r=>Number.isSafeInteger(r.count)&&r.count>=0);
  return{source,status:complete?'ok':usable?'partial':'unavailable',count:usable&&known?values.reduce((sum,r)=>sum+r.count,0):null,truncated:values.some(r=>r.truncated===true)};
 });
}
