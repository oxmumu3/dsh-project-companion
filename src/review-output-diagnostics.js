/** Fixed local validation categories only: no output body, key, ID, path or provider message. */
export const reviewOutputRules=['json','schema','evidence_unknown_or_duplicate','calendar_deadline_claim','unsupported_file_claim','deadline_without_source','event_kind','event_time_without_source','event_time_order'];
export function safeReviewOutputRule(value){return reviewOutputRules.includes(value)?value:undefined;}
const repairHints={
 json:'只输出合法JSON对象，不要代码围栏、解释或其他文字。',
 schema:'完整遵守给定JSON结构、字段长度和枚举。可选时间没有精确来源就省略，不能写null。',
 evidence_unknown_or_duplicate:'每项evidenceIds只选本次evidence中逐字存在且实际支持该项的ID，去除重复，不造或映射ID。',
 calendar_deadline_claim:'日历日程不是任务期限；日程用event并逐字复制对应日历的eventStartAt，不填dueAt或写成截止。',
 unsupported_file_claim:'文件元数据或未读正文不能支持文件为空、数据未更新或准备不足；只保留已有正文实际支持的事实。',
 deadline_without_source:'只从deadlineCandidates选择与本项evidenceIds匹配的deadlineId，由程序回填精确时间。不要输出dueAt，不把自然语言日期换算成ISO。deadlineCandidates为空或无相关候选时必须省略deadlineId，在unknown保留待核对。',
 event_kind:'event项必须有来源支持的eventStartAt且不能有dueAt；其他类型省略eventStartAt和eventEndAt。',
 event_time_without_source:'eventStartAt及可选eventEndAt只能逐字复制同一条已引用日历证据中的对应字段，不换算、不补全、不借用其他日期。',
 event_time_order:'日程结束时间须晚于开始，且两者来自同一条被引用日历；不能修改日期制造顺序。'
};
export function reviewRepairInstruction(rule){
 if(!Object.hasOwn(repairHints,rule))return null;
 return `上次输出未通过 ${rule} 校验。仅用同一份输入重新整理一次，原结构、来源及权限规则完全有效。${repairHints[rule]}保留仍有依据的其他候选；不要通过改标签来规避校验，不新增来源、读取、工具或执行。不把本次内部校验过程或错误码写给用户。`;
}
