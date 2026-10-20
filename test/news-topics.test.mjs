import test from 'node:test';
import assert from 'node:assert/strict';
const api = async () => import('../src/news-topics.js').catch(() => ({}));

test('explicit topics are optional, bounded, trimmed and copied without inferred interests', async () => {
  const { normalizeNewsTopics } = await api();
  assert.equal(typeof normalizeNewsTopics, 'function');
  assert.equal(normalizeNewsTopics(undefined), undefined);
  const original = [' DeepSeek 插件 ', '创作者生态'];
  assert.deepEqual(normalizeNewsTopics(original), ['DeepSeek 插件', '创作者生态']);
  assert.deepEqual(original, [' DeepSeek 插件 ', '创作者生态']);
  assert.equal(normalizeNewsTopics(Array.from({ length: 8 }, (_, i) => `主题 ${i}`)).length, 8);
});

test('wrong topic types, empty values, duplicates, controls and oversized lists fail closed', async () => {
  const { normalizeNewsTopics } = await api();
  assert.equal(typeof normalizeNewsTopics, 'function');
  for (const value of [null, 'AI', {}, 3, [], [1], [''], [' '], ['AI', ' AI '], ['AI\n产品'], ['AI\u0000'], ['AI\u007f'], ['AI\u0085'], ['\ud800'], ['x'.repeat(81)], Array.from({ length: 9 }, (_, i) => `Topic ${i}`), Array.from({ length: 8 }, (_, i) => `${i}${'x'.repeat(50)}`)]) {
    assert.throws(() => normalizeNewsTopics(value), error => error.code === 'NEWS_INVALID_TOPICS');
  }
});

test('sparse arrays and oversized padded input cannot bypass topic limits', async () => {
  const { normalizeNewsTopics } = await api();
  for (const value of [new Array(1), [' '.repeat(1000) + 'AI'], ['x'.repeat(80) + ' ']]) {
    assert.throws(() => normalizeNewsTopics(value), { code: 'NEWS_INVALID_TOPICS' });
  }
});
