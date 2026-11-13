import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAIL_LIMIT, filterMails, mailQuery, validateDigestOutput, renderDigest, localDay, latestOccurrence,
  projectDigestLedger, digestCallerAllowed,
} from '../src/daily-digest.js';
import {createDailyDigest} from '../src/daily-digest-service.js';

const NOW = new Date('2026-11-12T01:00:00.000Z'); // 09:00 Asia/Shanghai
const ISO = value => new Date(value).toISOString();
const mail = (id, overrides = {}) => ({
  id: `m${id}`, threadId: `t${id}`, from: `Alice ${id} <alice${id}@example.test>`,
  subject: `项目 ${id} 的进展`, receivedAt: ISO('2026-11-12T00:30:00Z'), snippet: `第 ${id} 封的摘要`, ...overrides,
});
const task = (id, overrides = {}) => ({source: 'dida', sourceItemId: `task${id}`, what: `交预算表 ${id}`, when: ISO('2026-11-12T10:00:00Z'), projectId: 'p1', ...overrides});
const event = (id, overrides = {}) => ({id: `ev${id}`, title: `评审 ${id}`, startAt: ISO('2026-11-13T01:00:00Z'), ...overrides});

test('rule filter drops bulk/notification, dedupes threads, keeps newest 30 and reports the remainder', () => {
  const rows = [];
  for (let i = 0; i < 35; i++) rows.push(mail(i));
  rows.push(mail(90, {from: 'no-reply@shop.example', subject: '限时优惠'}));
  rows.push(mail(91, {from: 'news@substack.com', subject: 'Weekly digest'}));
  rows.push(mail(92, {threadId: 't1', from: 'Alice <alice1@example.test>', receivedAt: ISO('2026-11-11T23:00:00Z')})); // same thread t1, older
  rows.push(mail(93, {receivedAt: ISO('2026-11-09T00:00:00Z')})); // before since
  const result = filterMails(rows, {now: NOW.getTime(), since: ISO('2026-11-11T01:00:00Z')});
  assert.equal(result.kept.length, MAIL_LIMIT);
  assert.equal(result.total, 35);
  assert.equal(result.dropped, 3); // two bulk, one too old
  assert.equal(result.skipped, 5);
  assert.equal(result.kept[0].id, 'm0');
  assert.equal(new Set(result.kept.map(row => row.threadId)).size, 30);
  assert.equal(isNaN(Date.parse(result.kept[0].receivedAt)), false);
  assert.match(mailQuery('2026-11-11T01:00:00Z'), /^after:\d+ -from:me -in:chats -category:promotions -category:social$/);
});

test('model output is checked against exact evidence, deduped and capped at three', () => {
  const mails = [mail(1), mail(2)];
  const promises = [task(1)];
  const events = [event(1)];
  const base = {category: 'work', what: '报价更新了，等你选方案', progress: '', otherSays: true, missing: '金额没写币种', searchedMissing: '', evidence: {mailId: 'm1'}};
  const raw = {items: [
    base,
    {...base, what: base.what, evidence: {mailId: 'm1'}},
    {...base, what: '只有日程没有邮件', evidence: {eventId: 'ev1'}},
    {...base, what: '另一件事', evidence: {mailId: 'm2'}},
    {...base, what: '第三件', evidence: {taskId: 'task1'}, linkTo: {source: 'dida', id: 'task1', same: 'same'}},
  ]};
  const checked = validateDigestOutput(raw, {mails, promises, events});
  assert.equal(checked.items.length, 3);
  assert.deepEqual(checked.rejected.includes('duplicate'), true);
  assert.equal(checked.rejected.includes('no_link'), true);
  for (const bad of [{items: [{...base, evidence: {mailId: 'm404'}}]}, {items: [{...base, evidence: {}}]}, {items: [{...base, linkTo: {source: 'dida', id: 'nope', same: 'same'}}]}]) {
    assert.equal(validateDigestOutput(bad, {mails, promises, events}).items.length, 0);
  }
});

test('program renderer writes caveats, real links, counts, remainder and candidate line', () => {
  const items = [
    {category: 'work', what: '报价更新了，等你选方案', progress: '', otherSays: true, missing: '金额没写币种', searchedMissing: '', evidence: {mailId: 'm1'}},
    {category: 'work', what: '明天评审', progress: '', otherSays: false, missing: '', searchedMissing: '会议链接', evidence: {mailId: 'm2'}, linkTo: {source: 'dida', id: 'task1', same: 'same'}},
  ];
  const text = renderDigest({
    items, mails: [mail(1), mail(2)], promises: [task(1)], events: [],
    counts: {mailboxes: 1, mailRaw: 33, mailKept: 30, mailDropped: 3, mailSkipped: 5, mailTruncated: false, lists: 4, promises: 1, events: 0, since: ISO('2026-11-11T01:00:00Z'), unreadable: []},
    now: NOW.getTime(), timeZone: 'Asia/Shanghai', lastSentAt: null,
  }).text;
  assert.match(text, /今天的邮件与待办，有 2 件值得看/);
  assert.match(text, /这是对方的说法，没有核实。/);
  assert.match(text, /缺：金额没写币种/);
  assert.match(text, /邮件和日历里没找到会议链接，也可能是从别处发的。/);
  assert.match(text, /https:\/\/mail\.google\.com\/mail\/u\/0\/#all\/t1/);
  assert.match(text, /https:\/\/dida365\.com\/webapp\/#p\/p1\/tasks\/task1/);
  assert.match(text, /读了 1 个邮箱（最近 24 小时的 33 封，过了规则筛 30 封）、滴答 4 个清单、未来 7 天的日历。/);
  assert.match(text, /还有 5 封超出本次模型输入上限，没有交给模型。/);
  assert.match(text, /第 1 条没找到对应的待办/);
  assert.equal((text.match(/这是对方的说法/g) ?? []).length, 1);
});

test('service sends once a day, keeps a local copy and never sends on zero items', async () => {
  const store = new Map();
  let sent = 0, reads = 0, summaries = 0, sentText = '';
  const digest = createDailyDigest({
    store: {get: key => store.get(key), put: (key, value) => store.set(key, structuredClone(value))},
    readSource: async (source, request) => {
      reads += 1;
      if (source === 'gmail') return {items: [mail(1), mail(2)], truncated: false};
      if (source === 'dida' && request.operation === 'projects') return {items: [{id: 'p1', name: '工作'}]};
      if (source === 'dida' && request.operation === 'tasks') return {items: [{id: 'task1', title: '交预算表', dueAt: ISO('2026-11-12T10:00:00Z'), status: 'open'}]};
      if (source === 'dida' && request.operation === 'inboxWindow') return {items: []};
      if (source === 'calendar') return {items: [event(1)]};
      throw Error('unexpected');
    },
    readLedger: async () => [{project: 'Finder', state: 'doing', count: 2}],
    schedule: async () => ({dailyTime: '09:00', timeZone: 'Asia/Shanghai'}),
    summarize: async ({material}) => {
      summaries += 1;
      assert.equal(material.mails.length, 2);
      assert.equal(material.promises.length, 1);
      return {output: {items: [
        {category: 'work', what: '报价更新了，等你选方案', progress: '对方说已经改好', otherSays: true, missing: '', searchedMissing: '', evidence: {mailId: 'm1'}},
        {category: 'work', what: '今天要交预算表', progress: '', otherSays: false, missing: '', searchedMissing: '', evidence: {taskId: 'task1'}, linkTo: {source: 'dida', id: 'task1', same: 'same'}},
      ]}};
    },
    send: async ({text, day}) => { sent += 1; sentText = text; assert.equal(day, '2026-11-12'); return {status: 'reported_sent'}; },
    clock: () => NOW,
  });
  const first = await digest.manual();
  assert.equal(first.status, 'sent');
  assert.equal(sent, 1);
  assert.equal(summaries, 1);
  assert.match(sentText, /报价更新了/);
  assert.match(sentText, /https:\/\/dida365\.com/);
  const row = store.get('profile');
  assert.equal(row.lastDay, '2026-11-12');
  assert.equal(row.lastDigest.items.length, 2);
  assert.equal(row.lastDigest.links.length >= 1, true);
  const again = await digest.manual();
  assert.equal(again.status, 'already');
  assert.equal(sent, 1);
  const view = await digest.view();
  assert.equal(view.view, 'digest');
  assert.match(view.text, /已通过主人通道发出/);
  assert.equal(view.nextRunAt, ISO('2026-11-13T01:00:00Z'));
  await digest.close();
});

test('zero items stay quiet, source failure is reported, and the probe returns counts only', async () => {
  const store = new Map();
  let sent = 0;
  const digest = createDailyDigest({
    store: {get: key => store.get(key), put: (key, value) => store.set(key, structuredClone(value))},
    readSource: async source => {
      if (source === 'gmail') throw Object.assign(new Error('no'), {code: 'CONTEXT_AUTH_REQUIRED'});
      if (source === 'dida') return {items: []};
      if (source === 'calendar') return {items: []};
      throw Error('unexpected');
    },
    schedule: async () => ({dailyTime: '09:00', timeZone: 'Asia/Shanghai'}),
    summarize: async () => ({output: {items: []}}),
    send: async () => { sent += 1; return {status: 'reported_sent'}; },
    clock: () => NOW,
    hostTimeZone: () => 'Asia/Shanghai',
  });
  const quiet = await digest.manual();
  assert.equal(quiet.status, 'quiet');
  assert.equal(sent, 0);
  assert.equal(store.get('profile').lastStatus, 'quiet');
  const probe = await digest.probe();
  assert.deepEqual(probe, {status: 'blocked', source: 'gmail', count: 0, truncated: false, code: 'CONTEXT_AUTH_REQUIRED'});
  await digest.close();
});

test('a source failure still delivers the readable parts and says what failed', async () => {
  const store = new Map();
  let text = '';
  const digest = createDailyDigest({
    store: {get: key => store.get(key), put: (key, value) => store.set(key, structuredClone(value))},
    readSource: async (source, request) => {
      if (source === 'gmail') throw Object.assign(new Error('no'), {code: 'CONTEXT_TIMEOUT'});
      if (source === 'dida' && request.operation === 'projects') return {items: [{id: 'p1', name: '工作'}]};
      if (source === 'dida' && request.operation === 'tasks') return {items: [{id: 'task1', title: '交预算表', dueAt: ISO('2026-11-12T10:00:00Z'), status: 'open'}]};
      if (source === 'dida') return {items: []};
      if (source === 'calendar') throw Object.assign(new Error('no'), {code: 'CONTEXT_HTTP_ERROR'});
      throw Error('unexpected');
    },
    schedule: async () => ({dailyTime: '09:00', timeZone: 'Asia/Shanghai'}),
    summarize: async () => ({output: {items: [{category: 'work', what: '今天要交预算表', progress: '', otherSays: false, missing: '', searchedMissing: '', evidence: {taskId: 'task1'}, linkTo: {source: 'dida', id: 'task1', same: 'same'}}]}}),
    send: async input => { text = input.text; return {status: 'reported_sent'}; },
    clock: () => NOW,
  });
  const result = await digest.manual();
  assert.equal(result.status, 'sent');
  assert.match(text, /Gmail 这次没读到/);
  assert.match(text, /Google 日历这次没读到/);
  assert.match(text, /读了滴答 1 个清单/);
  assert.match(text, /https:\/\/dida365\.com\/webapp\/#p\/p1\/tasks\/task1/);
  await digest.close();
});

test('schedule helpers use the host zone and claim one occurrence per local day', () => {
  assert.equal(localDay(NOW, 'Asia/Shanghai'), '2026-11-12');
  const due = latestOccurrence(NOW, '09:00', 'Asia/Shanghai');
  assert.equal(due.id, 'daily:2026-11-12');
  assert.equal(due.epoch, NOW.getTime());
  assert.equal(latestOccurrence(new Date('2026-11-12T00:59:00Z'), '09:00', 'Asia/Shanghai').id, 'daily:2026-11-11');
  assert.equal(latestOccurrence(NOW, '25:00', 'Asia/Shanghai'), null);
});

test('a pending send is durable: restart recovers uncertain and never sends twice', async () => {
  const store = new Map();
  let sent = 0, requestIds = [];
  const reads = async source => {
    if (source === 'gmail') return {items: [mail(1)], truncated: false};
    if (source === 'dida') return {items: []};
    if (source === 'calendar') return {items: []};
    throw Error('unexpected');
  };
  const make = () => createDailyDigest({
    store: {get: key => store.get(key), put: (key, value) => store.set(key, structuredClone(value))},
    readSource: reads,
    schedule: async () => ({dailyTime: '09:00', timeZone: 'Asia/Shanghai'}),
    summarize: async () => ({output: {items: [{category: 'work', what: '报价更新了', progress: '', otherSays: false, missing: '', searchedMissing: '', evidence: {mailId: 'm1'}}]}}),
    send: async input => { sent += 1; requestIds.push(input.requestId); return {status: 'reported_sent'}; },
    clock: () => NOW,
  });
  const first = await make();
  assert.equal((await first.manual()).status, 'sent');
  assert.deepEqual(requestIds, ['digest:2026-11-12']);
  assert.equal(store.get('profile').pendingSend, null);
  assert.equal(store.get('profile').lastSentAt, ISO(NOW));
  assert.equal(store.get('profile').lastDigestAt, ISO(NOW));
  await first.close();
  const restarted = await make();
  assert.equal((await restarted.manual()).status, 'already');
  assert.equal(sent, 1);
  await restarted.close();

  // Simulate a crash after the row was persisted but before the channel call.
  const pendingStore = new Map([['profile', {
    ...store.get('profile'), lastDay: '2026-11-13', lastStatus: 'uncertain', lastSentAt: null,
    pendingSend: {day: '2026-11-13', requestId: 'digest:2026-11-13', at: ISO('2026-11-13T01:00:00Z'), textHash: 'a'.repeat(64)},
  }]]);
  let crashSent = 0;
  const crash = createDailyDigest({
    store: {get: key => pendingStore.get(key), put: (key, value) => pendingStore.set(key, structuredClone(value))},
    readSource: reads, schedule: async () => ({dailyTime: '09:00', timeZone: 'Asia/Shanghai'}),
    summarize: async () => { throw Error('must not run'); },
    send: async () => { crashSent += 1; return {status: 'reported_sent'}; },
    clock: () => new Date('2026-11-13T01:00:00Z'),
  });
  await crash.ready();
  const recovered = pendingStore.get('profile');
  assert.equal(recovered.pendingSend, null);
  assert.equal(recovered.lastStatus, 'uncertain');
  assert.equal(recovered.lastDigestAt, ISO('2026-11-13T01:00:00Z'));
  assert.equal((await crash.manual()).status, 'already');
  assert.equal(crashSent, 0);
  await crash.close();
});

test('recovering a pending send keeps the failed Gmail window for the next run', async () => {
  const store = new Map();
  const T1 = '2026-11-13T01:00:00Z', T2 = '2026-11-14T01:00:00Z';
  const queries = [];
  let gmailReadable = false;
  const readSource = async (source, request) => {
    if (source === 'gmail') {
      if (!gmailReadable) throw Object.assign(Error('blocked'), {code: 'CONTEXT_TIMEOUT'});
      queries.push(request.query);
      return {items: [], truncated: false};
    }
    if (source === 'dida' && request.operation === 'projects') return {items: [{id: 'p1'}]};
    if (source === 'dida' && request.operation === 'tasks') return {items: [{id: 'task1', title: '交预算表', dueAt: ISO('2026-11-13T09:00:00Z'), status: 'open'}]};
    if (source === 'dida') return {items: []};
    if (source === 'calendar') return {items: []};
    throw Error('unexpected');
  };
  const make = (clock, hang) => createDailyDigest({
    store: {get: key => store.get(key), put: (key, value) => store.set(key, structuredClone(value))},
    readSource,
    schedule: async () => ({dailyTime: '09:00', timeZone: 'Asia/Shanghai'}),
    summarize: async () => ({output: {items: [{category: 'work', what: '交预算表', progress: '', otherSays: false, missing: '', searchedMissing: '', evidence: {taskId: 'task1'}}]}}),
    send: () => hang ? new Promise(() => {}) : Promise.resolve({status: 'reported_sent'}),
    clock: () => new Date(clock),
  });
  const first = make(T1, true);
  void first.manual();
  for (let i = 0; i < 100 && !store.get('profile')?.pendingSend; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(store.get('profile')?.pendingSend, 'the attempt must be persisted before the hanging channel call');
  const second = make(T2, false);
  await second.ready();
  assert.equal(store.get('profile').gmailSince, ISO('2026-11-12T01:00:00Z'), 'recovery must keep the start of the failed Gmail window');
  gmailReadable = true;
  const run = await second.manual();
  assert.equal(run.status, 'sent');
  assert.equal(run.counts.since, ISO('2026-11-12T01:00:00Z'));
  assert.match(queries.at(-1), new RegExp(`after:${Math.floor(Date.parse(ISO('2026-11-12T01:00:00Z')) / 1000)}`));
  await second.close();
});

test('a quiet zero-item run advances the rendering cursor for the next window', async () => {
  const store = new Map();
  let clockValue = new Date(NOW);
  let materialSeen = null;
  const digest = createDailyDigest({
    store: {get: key => store.get(key), put: (key, value) => store.set(key, structuredClone(value))},
    readSource: async source => ({items: []}),
    schedule: async () => ({dailyTime: '09:00', timeZone: 'Asia/Shanghai'}),
    summarize: async ({material}) => { materialSeen = material; return {output: {items: []}}; },
    send: async () => { throw Error('must not send'); },
    clock: () => clockValue,
  });
  assert.equal((await digest.manual()).status, 'quiet');
  assert.equal(store.get('profile').lastDigestAt, ISO(NOW));
  clockValue = new Date('2026-11-13T01:00:00Z');
  assert.equal((await digest.manual()).status, 'quiet');
  assert.equal(materialSeen.counts.since, ISO(NOW));
  await digest.close();
});

test('a partially failing list counts only readable lists and still sends one digest', async () => {
  const store = new Map();
  let sent = 0, text = '';
  const digest = createDailyDigest({
    store: {get: key => store.get(key), put: (key, value) => store.set(key, structuredClone(value))},
    readSource: async (source, request) => {
      if (source === 'gmail') return {items: [mail(1)], truncated: false};
      if (source === 'dida' && request.operation === 'projects') return {items: [{id: 'p1'}, {id: 'p2'}]};
      if (source === 'dida' && request.operation === 'tasks' && request.projectId === 'p1') throw Object.assign(Error('blocked'), {code: 'CONTEXT_HTTP_ERROR'});
      if (source === 'dida' && request.operation === 'tasks') return {items: [{id: 'task2', title: '交预算表', dueAt: ISO('2026-11-12T10:00:00Z'), status: 'open'}]};
      if (source === 'dida') return {items: []};
      if (source === 'calendar') return {items: []};
      throw Error('unexpected');
    },
    schedule: async () => ({dailyTime: '09:00', timeZone: 'Asia/Shanghai'}),
    summarize: async () => ({output: {items: [{category: 'work', what: '今天要交预算表', progress: '', otherSays: false, missing: '', searchedMissing: '', evidence: {taskId: 'task2'}, linkTo: {source: 'dida', id: 'task2', same: 'same'}}]}}),
    send: async input => { sent += 1; text = input.text; return {status: 'reported_sent'}; },
    clock: () => NOW,
  });
  assert.equal((await digest.manual()).status, 'sent');
  assert.equal(sent, 1);
  assert.match(text, /滴答 1 个清单（1 个没读到）/);
  assert.doesNotMatch(text, /滴答这次没读到/);
  assert.doesNotMatch(text, /Gmail 这次没读到/);
  assert.equal(store.get('profile').lastDigest.counts.listsFailed, 1);
  await digest.close();
});

test('ledger projection drops revoked roots and caller guard accepts only owner routes', () => {
  const projected = projectDigestLedger(
    [{root: '/work/a', state: 'doing'}, {root: '/work/a', state: 'doing'}, {root: '/work/b', state: 'needs_you'}],
    ['/work/a'],
  );
  assert.deepEqual(projected, [{project: 'a', state: 'doing', count: 2}]);
  assert.equal(digestCallerAllowed({sessionId: 's1', foregroundSessionId: 's1'}), true);
  assert.equal(digestCallerAllowed({sessionId: 's1', setupSessionId: 's1', setupBindingKey: 'k', bindingKey: 'k', bridgePresent: true}), true);
  assert.equal(digestCallerAllowed({sessionId: 's2', foregroundSessionId: 's1', setupSessionId: 's1', setupBindingKey: 'k', bindingKey: 'k', bridgePresent: true}), false);
  assert.equal(digestCallerAllowed({sessionId: 's1', foregroundSessionId: 's1', family: true}), false);
  assert.equal(digestCallerAllowed({sessionId: 's1', setupSessionId: 's1', setupBindingKey: 'k', bindingKey: 'other', bridgePresent: true}), false);
  assert.equal(digestCallerAllowed({sessionId: 's1', setupSessionId: 's1', setupBindingKey: 'k', bindingKey: 'k', bridgePresent: false}), false);
});

test('a calendar-linked item is not listed as "no matching todo"', () => {
  const text = renderDigest({
    items: [{category: 'work', what: '明天评审', progress: '', otherSays: false, missing: '', searchedMissing: '', evidence: {mailId: 'm1'}, linkTo: {source: 'calendar', id: 'ev1', same: 'same'}}],
    mails: [mail(1)], promises: [], events: [event(1)],
    counts: {mailboxes: 1, mailRaw: 1, mailKept: 1, mailDropped: 0, mailSkipped: 0, mailTruncated: false, lists: 0, listsFailed: 0, promises: 0, events: 1, since: ISO('2026-11-11T01:00:00Z'), unreadable: []},
    now: NOW.getTime(), timeZone: 'Asia/Shanghai', lastDigestAt: null,
  }).text;
  assert.doesNotMatch(text, /第 1 条没找到对应的待办/);
});

test('tick and a manual run share one gate: a queued manual cannot overwrite the claim or send twice', async () => {
  const store = new Map();
  let sent = 0, release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const digest = createDailyDigest({
    store: {get: key => store.get(key), put: (key, value) => store.set(key, structuredClone(value))},
    readSource: async source => {
      if (source === 'gmail') return {items: [mail(1)], truncated: false};
      if (source === 'dida') return {items: []};
      if (source === 'calendar') return {items: []};
      throw Error('unexpected');
    },
    schedule: async () => ({dailyTime: '09:00', timeZone: 'Asia/Shanghai'}),
    summarize: async () => {
      entered();
      await gate;
      return {output: {items: [{category: 'work', what: '报价更新了', progress: '', otherSays: false, missing: '', searchedMissing: '', evidence: {mailId: 'm1'}}]}};
    },
    send: async () => { sent += 1; return {status: 'reported_sent'}; },
    clock: () => NOW,
  });
  const tick = digest.tick();
  await started;
  const manual = digest.manual();
  release();
  const [tickResult, manualResult] = await Promise.all([tick, manual]);
  assert.equal(tickResult.status, 'sent');
  assert.equal(manualResult.status, 'already');
  assert.equal(sent, 1);
  assert.equal(store.get('profile').lastOccurrence, 'daily:2026-11-12');
  await digest.close();
});

test('model prose cannot inject links; task evidence without linkTo still gets a verified task link', () => {
  const text = renderDigest({
    items: [{category: 'work', what: '看这个 https://evil.example/x', progress: '见 [点我](https://evil.example/y)', otherSays: false, missing: '', searchedMissing: '', evidence: {taskId: 'task1'}}],
    mails: [], promises: [task(1)], events: [],
    counts: {mailboxes: 0, mailRaw: 0, mailKept: 0, mailDropped: 0, mailSkipped: 0, mailTruncated: false, lists: 1, listsFailed: 0, promises: 1, events: 0, since: ISO('2026-11-11T01:00:00Z'), unreadable: ['gmail', 'calendar']},
    now: NOW.getTime(), timeZone: 'Asia/Shanghai', lastDigestAt: null,
  }).text;
  assert.doesNotMatch(text, /evil\.example/);
  assert.doesNotMatch(text, /未来 7 天的日历/);
  assert.match(text, /https:\/\/dida365\.com\/webapp\/#p\/p1\/tasks\/task1/);
  assert.doesNotMatch(text, /第 1 条没找到对应的待办/);
});

test('a Gmail failure keeps the last successful Gmail window for the next run', async () => {
  const store = new Map();
  let clockValue = new Date(NOW);
  let gmailQueries = [];
  let gmailFails = false;
  const digest = createDailyDigest({
    store: {get: key => store.get(key), put: (key, value) => store.set(key, structuredClone(value))},
    readSource: async (source, request) => {
      if (source === 'gmail') {
        if (gmailFails) throw Object.assign(Error('blocked'), {code: 'CONTEXT_TIMEOUT'});
        gmailQueries.push(request.query);
        return {items: [], truncated: false};
      }
      if (source === 'dida' && request.operation === 'projects') return {items: [{id: 'p1'}]};
      if (source === 'dida' && request.operation === 'tasks') return {items: [{id: 'task1', title: '交预算表', dueAt: ISO('2026-11-12T10:00:00Z'), status: 'open'}]};
      if (source === 'dida') return {items: []};
      if (source === 'calendar') return {items: []};
      throw Error('unexpected');
    },
    schedule: async () => ({dailyTime: '09:00', timeZone: 'Asia/Shanghai'}),
    summarize: async () => ({output: {items: []}}),
    send: async () => { throw Error('must not send'); },
    clock: () => clockValue,
  });
  assert.equal((await digest.manual()).status, 'quiet');
  const firstGmailAt = store.get('profile').lastGmailAt;
  assert.equal(firstGmailAt, ISO(NOW));
  gmailFails = true;
  clockValue = new Date('2026-11-13T01:00:00Z');
  assert.equal((await digest.manual()).status, 'quiet');
  assert.equal(store.get('profile').lastGmailAt, firstGmailAt);
  gmailFails = false;
  clockValue = new Date('2026-11-14T01:00:00Z');
  assert.equal((await digest.manual()).status, 'quiet');
  assert.match(gmailQueries.at(-1), new RegExp(`after:${Math.floor(Date.parse(firstGmailAt) / 1000)}`));
  await digest.close();
});

test('a live owner is frozen before reading and handed to the single send', async () => {
  const store = new Map();
  const owner = {sessionId: 'wechat-owner', setupBindingKey: 'a'.repeat(64), bindingKey: 'b'.repeat(64)};
  let reads = 0, sentOwner = null;
  const digest = createDailyDigest({
    store: {get: key => store.get(key), put: (key, value) => store.set(key, structuredClone(value))},
    readOwner: async () => owner,
    readSource: async source => {
      reads += 1;
      if (source === 'gmail') return {items: [mail(1)], truncated: false};
      if (source === 'dida') return {items: []};
      if (source === 'calendar') return {items: []};
      throw Error('unexpected');
    },
    schedule: async () => ({dailyTime: '09:00', timeZone: 'Asia/Shanghai'}),
    summarize: async () => ({output: {items: [{category: 'work', what: '报价更新了', progress: '', otherSays: false, missing: '', searchedMissing: '', evidence: {mailId: 'm1'}}]}}),
    send: async input => { sentOwner = input.owner; return {status: 'reported_sent'}; },
    clock: () => NOW,
  });
  assert.equal((await digest.manual()).status, 'sent');
  assert.ok(reads >= 1);
  assert.deepEqual(sentOwner, owner);
  await digest.close();
});

test('no live owner blocks before any source read or model call', async () => {
  let reads = 0, models = 0, sends = 0;
  const digest = createDailyDigest({
    store: {get: key => new Map().get(key), put: () => {}},
    readOwner: async () => null,
    readSource: async () => { reads += 1; return {items: []}; },
    schedule: async () => ({dailyTime: '09:00', timeZone: 'Asia/Shanghai'}),
    summarize: async () => { models += 1; return {output: {items: []}}; },
    send: async () => { sends += 1; return {status: 'reported_sent'}; },
    clock: () => NOW,
  });
  const result = await digest.manual();
  assert.equal(result.status, 'blocked');
  assert.equal(result.code, 'DIGEST_OWNER_UNAVAILABLE');
  assert.equal(reads, 0);
  assert.equal(models, 0);
  assert.equal(sends, 0);
  await digest.close();
});

test('a binding rotation during collection blocks before the model and before send', async () => {
  const store = new Map();
  const first = {sessionId: 'wechat-owner', setupBindingKey: 'a'.repeat(64), bindingKey: 'b'.repeat(64)};
  const second = {...first, bindingKey: 'c'.repeat(64)};
  let calls = 0, models = 0, sends = 0;
  const digest = createDailyDigest({
    store: {get: key => store.get(key), put: (key, value) => store.set(key, structuredClone(value))},
    readOwner: async () => (++calls === 1 ? first : second),
    sameOwner: (left, right) => JSON.stringify(left) === JSON.stringify(right),
    readSource: async source => {
      if (source === 'gmail') return {items: [mail(1)], truncated: false};
      if (source === 'dida') return {items: []};
      if (source === 'calendar') return {items: []};
      throw Error('unexpected');
    },
    schedule: async () => ({dailyTime: '09:00', timeZone: 'Asia/Shanghai'}),
    summarize: async () => { models += 1; return {output: {items: []}}; },
    send: async () => { sends += 1; return {status: 'reported_sent'}; },
    clock: () => NOW,
  });
  const result = await digest.manual();
  assert.equal(result.status, 'blocked');
  assert.equal(result.code, 'DIGEST_OWNER_CHANGED');
  assert.equal(calls, 2);
  assert.equal(models, 0, 'rotated owner must not reach the model');
  assert.equal(sends, 0);
  await digest.close();
});

test('a click-time owner is queued instead of being re-selected when the run starts', async () => {
  const store = new Map();
  const clicked = {sessionId: 'wechat-owner', setupBindingKey: 'a'.repeat(64), bindingKey: 'b'.repeat(64)};
  let calls = 0, seen = null;
  const digest = createDailyDigest({
    store: {get: key => store.get(key), put: (key, value) => store.set(key, structuredClone(value))},
    readOwner: async () => { calls += 1; return clicked; },
    sameOwner: (left, right) => JSON.stringify(left) === JSON.stringify(right),
    readSource: async source => {
      if (source === 'gmail') return {items: [mail(1)], truncated: false};
      if (source === 'dida') return {items: []};
      if (source === 'calendar') return {items: []};
      throw Error('unexpected');
    },
    schedule: async () => ({dailyTime: '09:00', timeZone: 'Asia/Shanghai'}),
    summarize: async () => ({output: {items: [{category: 'work', what: '报价更新了', progress: '', otherSays: false, missing: '', searchedMissing: '', evidence: {mailId: 'm1'}}]}}),
    send: async input => { seen = input.owner; return {status: 'reported_sent'}; },
    clock: () => NOW,
  });
  const result = await digest.manual({owner: clicked});
  assert.equal(result.status, 'sent');
  assert.deepEqual(seen, clicked);
  assert.equal(calls, 2, 'confirm the same owner before and after collection');
  await digest.close();
});

test('a manual request with a rotated click-time binding stops before reading any source', async () => {
  const clicked = {sessionId: 'wechat-owner', setupBindingKey: 'a'.repeat(64), bindingKey: 'b'.repeat(64)};
  const calls = [];
  const digest = createDailyDigest({
    store: {get: () => null, put: () => {}},
    readOwner: async () => ({...clicked, bindingKey: 'c'.repeat(64)}),
    readSource: async source => { calls.push(source); return {items: []}; },
    summarize: async () => { calls.push('model'); return {items: []}; },
    send: async () => { calls.push('send'); },
    clock: () => NOW,
  });
  const result = await digest.manual({owner: clicked});
  assert.equal(result.status, 'blocked');
  assert.equal(result.code, 'DIGEST_OWNER_CHANGED');
  assert.deepEqual(calls, []);
  await digest.close();
});

test('a timer tick without a ready owner does not consume today occurrence or read sources', async () => {
  const store = new Map();
  let reads = 0, owners = 0;
  const digest = createDailyDigest({
    store: {get: key => store.get(key), put: (key, value) => store.set(key, structuredClone(value))},
    readOwner: async () => { owners += 1; return null; },
    readSource: async () => { reads += 1; return {items: []}; },
    schedule: async () => ({dailyTime: '09:00', timeZone: 'Asia/Shanghai'}),
    summarize: async () => ({output: {items: []}}),
    send: async () => ({status: 'reported_sent'}),
    clock: () => NOW,
  });
  const first = await digest.tick();
  assert.equal(first.status, 'blocked');
  assert.equal(store.get('profile')?.lastOccurrence ?? null, null);
  assert.equal(reads, 0);
  assert.equal(owners, 1);
  await digest.close();
});

test('a guarded channel blocked result records blocked, never sent, and does not retry the same day', async () => {
  const store = new Map();
  let sends = 0;
  const digest = createDailyDigest({
    store: {get: key => store.get(key), put: (key, value) => store.set(key, structuredClone(value))},
    readSource: async source => source === 'gmail' ? {items: [mail(1)], truncated: false} : {items: []},
    schedule: async () => ({dailyTime: '09:00', timeZone: 'Asia/Shanghai'}),
    summarize: async () => ({output: {items: [{category: 'work', what: '报价更新了', progress: '', otherSays: false, missing: '', searchedMissing: '', evidence: {mailId: 'm1'}}]}}),
    send: async () => { sends += 1; return {status: 'blocked'}; },
    clock: () => NOW,
  });
  const first = await digest.manual();
  assert.equal(first.status, 'blocked');
  assert.equal(store.get('profile').lastStatus, 'blocked');
  assert.equal(store.get('profile').lastSentAt, null);
  assert.equal(store.get('profile').pendingSend, null);
  const second = await digest.manual();
  assert.equal(second.status, 'already');
  assert.equal(sends, 1);
  await digest.close();
});

test('an unknown transport result records uncertain, never sent, and does not retry the same day', async () => {
  const store = new Map();
  let sends = 0;
  const digest = createDailyDigest({
    store: {get: key => store.get(key), put: (key, value) => store.set(key, structuredClone(value))},
    readSource: async source => source === 'gmail' ? {items: [mail(1)], truncated: false} : {items: []},
    schedule: async () => ({dailyTime: '09:00', timeZone: 'Asia/Shanghai'}),
    summarize: async () => ({output: {items: [{category: 'work', what: '报价更新了', progress: '', otherSays: false, missing: '', searchedMissing: '', evidence: {mailId: 'm1'}}]}}),
    send: async () => { sends += 1; throw Error('synthetic transport timeout'); },
    clock: () => NOW,
  });
  const first = await digest.manual();
  assert.equal(first.status, 'uncertain');
  assert.equal(store.get('profile').lastStatus, 'uncertain');
  assert.equal(store.get('profile').lastSentAt, null);
  assert.equal(store.get('profile').pendingSend, null);
  const second = await digest.manual();
  assert.equal(second.status, 'already');
  assert.equal(sends, 1);
  await digest.close();
});
