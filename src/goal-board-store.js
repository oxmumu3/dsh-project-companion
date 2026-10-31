import {z} from 'zod';

const control=/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const text=max=>z.string().max(max).refine(value=>!control.test(value));
export const goalIdentitySchema=text(200).min(1);
const workspaceIdentitySchema=text(4096).min(1);
const instant=z.string().datetime();
export const goalLaneSchema=z.enum(['mine','active','waiting','unknown']);
export const goalFragmentSchema=z.object({id:goalIdentitySchema,workspaceId:workspaceIdentitySchema,workspaceLabel:text(200),sessionId:goalIdentitySchema.nullable(),kind:z.enum(['file','user','assistant']),reference:text(1000).min(1),text:text(3000),at:instant.nullable(),truncated:z.boolean()}).strict();
export const goalCoverageSchema=z.object({workspaceId:workspaceIdentitySchema,label:text(200),status:z.enum(['ok','partial','unavailable']),filesRead:z.number().int().min(0).max(1000),sessionsRead:z.number().int().min(0).max(1000),truncated:z.boolean()}).strict();
const grantSchema=z.object({id:goalIdentitySchema,workspaceId:workspaceIdentitySchema,root:text(4096).min(1)}).strict();
const evidenceSchema=goalFragmentSchema.extend({grant:grantSchema,accessRevision:goalIdentitySchema});
const projectSchema=z.object({id:goalIdentitySchema,key:text(200).min(1),title:text(120).min(1),goal:text(1200).min(1),constraints:z.array(text(300).min(1)).max(12),state:z.enum(['proposed','confirmed']),ignored:z.boolean(),lane:goalLaneSchema,progress:text(600).nullable(),nextStep:text(300).nullable(),evidenceIds:z.array(goalIdentitySchema).max(2000),stale:z.boolean(),updatedAt:instant,conversation:z.object({sessionId:goalIdentitySchema,revision:text(220).min(1)}).strict().nullable()}).strict();
export const goalScanSchema=z.object({phase:z.enum(['idle','running','complete','failed']),at:instant.nullable(),coverage:z.array(goalCoverageSchema).max(1000),code:text(80).min(1).optional(),cursor:z.number().int().min(0).max(1000000).optional()}).strict();
export const goalBoardRowSchema=z.object({id:z.literal('profile'),version:z.literal(1),revision:goalIdentitySchema,accessRevision:goalIdentitySchema.nullable(),projects:z.array(projectSchema).max(100),evidence:z.array(evidenceSchema).max(2000),locks:z.array(z.object({evidenceId:goalIdentitySchema,targetProjectId:goalIdentitySchema.nullable()}).strict()).max(2000),standaloneIds:z.array(goalIdentitySchema).max(2000),uncertainIds:z.array(goalIdentitySchema).max(2000),scan:goalScanSchema}).strict().superRefine((row,ctx)=>{
 for(const values of [row.projects.map(p=>p.id),row.evidence.map(e=>e.id),row.locks.map(l=>l.evidenceId)]) if(new Set(values).size!==values.length)ctx.addIssue({code:'custom',message:'Duplicate identity'});
 const ids=new Set(row.projects.map(p=>p.id));
 if(row.locks.some(lock=>lock.targetProjectId!==null&&!ids.has(lock.targetProjectId)))ctx.addIssue({code:'custom',message:'Unknown correction target'});
 const sessions=row.projects.flatMap(p=>p.conversation?[p.conversation.sessionId]:[]);
 if(new Set(sessions).size!==sessions.length)ctx.addIssue({code:'custom',message:'Conversation must be dedicated'});
 const known=new Set(row.evidence.map(e=>e.id)),partition=[...row.projects.flatMap(p=>p.evidenceIds),...row.standaloneIds,...row.uncertainIds];
 if(partition.some(id=>!known.has(id))||partition.length!==known.size||new Set(partition).size!==partition.length)ctx.addIssue({code:'custom',message:'Evidence partition must be exact'});
 if(row.locks.some(lock=>!known.has(lock.evidenceId)))ctx.addIssue({code:'custom',message:'Correction must reference known evidence'});
});
export const freshGoalBoardRow=()=>({id:'profile',version:1,revision:'0',accessRevision:null,projects:[],evidence:[],locks:[],standaloneIds:[],uncertainIds:[],scan:{phase:'idle',at:null,coverage:[]}});

const groupSchema=z.object({key:text(200).min(1),projectId:goalIdentitySchema.nullable(),title:text(120).min(1),goal:text(1200).min(1),evidenceIds:z.array(goalIdentitySchema).min(1).max(40),lane:goalLaneSchema,progress:text(600).nullable(),nextStep:text(300).nullable()}).strict();
const resultSchema=z.object({groups:z.array(groupSchema).max(20),standaloneIds:z.array(goalIdentitySchema).max(40),uncertainIds:z.array(goalIdentitySchema).max(40)}).strict();
export function validateGoalBoardResult(value,fragments,existingProjects){
 const fail=()=>{throw Object.assign(new Error('MODEL_INVALID_OUTPUT'),{code:'MODEL_INVALID_OUTPUT'});};
 const parsed=resultSchema.safeParse(value);if(!parsed.success)fail();
 const result=parsed.data,known=new Map(fragments.map(f=>[f.id,f])),projects=new Map(existingProjects.map(p=>[p.id,p])),seen=new Set(),keys=new Set(),targets=new Set();
 for(const group of result.groups){
  if(keys.has(group.key))fail();keys.add(group.key);
  if(group.projectId!==null){
   const project=projects.get(group.projectId);if(!project||targets.has(group.projectId))fail();targets.add(group.projectId);
   if(project.state==='confirmed'&&(group.title!==project.title||group.goal!==project.goal))fail();
  }else if(new Set(group.evidenceIds.map(id=>known.get(id)).filter(source=>source&&source.kind!=='file').map(source=>source.sessionId).filter(Boolean)).size<2)fail();
 }
 for(const id of [...result.groups.flatMap(group=>group.evidenceIds),...result.standaloneIds,...result.uncertainIds]){
  if(!known.has(id)||seen.has(id))fail();seen.add(id);
 }
 if(seen.size!==known.size)fail();return result;
}
