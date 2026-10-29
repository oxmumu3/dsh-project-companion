// Bounded explicit reading interests. No inference, storage or external IO.
export function normalizeNewsTopics(value) {
  const invalid = () => { throw Object.assign(new Error('News topics must be 1–8 unique strings, at most 80 characters each and 400 in total'), { code: 'NEWS_INVALID_TOPICS' }); };
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) invalid();
  const topics = [];
  for (let index = 0; index < value.length; index++) {
    if (!Object.hasOwn(value, index)) invalid();
    const item = value[index];
    if (typeof item !== 'string' || item.length > 80 || !item.isWellFormed() || /\p{Cc}/u.test(item)) invalid();
    const topic = item.trim();
    if (!topic || topic.length > 80) invalid();
    topics.push(topic);
  }
  if (new Set(topics).size !== topics.length || topics.reduce((total, topic) => total + topic.length, 0) > 400) invalid();
  return topics;
}
