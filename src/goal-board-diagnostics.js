/** Fixed validation predicates only. Never persist rejected prose or provider fields. */
export const GOAL_OUTPUT_RULES=['json','shape','text_limit','partition_missing','partition_duplicate','partition_unknown','new_project_support','canonical_changed','project_unknown','duplicate_group','duplicate_target'];
const rules=new Set(GOAL_OUTPUT_RULES);
export const safeGoalOutputRule=value=>rules.has(value)?value:undefined;
export function goalRepairInstruction(rule){return{
 json:'上次回复不是有效 JSON。本次仅输出规定的 JSON 对象，不要代码围栏、解释或额外文字。',
 shape:'上次回复的字段结构不符合要求。逐字遵守规定字段、类型、枚举与数量上限；没有进展或下一步时填 null。',
 text_limit:'上次有文字字段超过字符上限。重新从原资料简明提炼：title不超过60字符，goal不超过600字符，progress不超过300字符，nextStep不超过150字符；字符包含中英数、空格和标点。',
 partition_missing:'上次遗漏了输入片段。先逐一核对全部 fragments.id：每个id必须在groups.evidenceIds、standaloneIds、uncertainIds三个分区中恰好出现一次；无法归类就放入uncertainIds。',
 new_project_support:'上次新建项目的会话依据不足。仅至少两个不同且非空sessionId的对话片段可以新建项目；文件和同一会话的多个片段不满足条件。依据不足的片段放入standaloneIds或uncertainIds。'
 }[safeGoalOutputRule(rule)];}
