/** Fixed local validation categories only: no output body, key, ID, path or provider message. */
export const reviewOutputRules=['json','schema','evidence_unknown_or_duplicate','calendar_deadline_claim','unsupported_file_claim','deadline_without_source','event_kind','event_time_without_source','event_time_order'];
export function safeReviewOutputRule(value){return reviewOutputRules.includes(value)?value:undefined;}
