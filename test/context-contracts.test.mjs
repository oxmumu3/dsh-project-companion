import test from 'node:test';
import assert from 'node:assert/strict';
import { SOURCE_INFO, buildContextCall, validateContextCall, projectContextResult } from '../src/context-contracts.js';

const time = { now: new Date('2026-10-19T12:00:00Z'), timeZone: 'America/Mexico_City' };
const build = (source, input) => buildContextCall(source, input, time);
const catalog = (name, properties, required = [], extra = {}) => [{ name, inputSchema: { type: 'object', properties, required, additionalProperties: false, ...extra } }];

test('source inventory shares Google auth without representing other providers as connected', () => {
  assert.deepEqual(Object.keys(SOURCE_INFO).sort(), ['calendar', 'dida', 'docs', 'drive', 'flomo', 'gmail', 'sheets', 'slides']);
  assert.equal(SOURCE_INFO.gmail.authGroup, 'google');
  assert.equal(SOURCE_INFO.flomo.authGroup, 'flomo');
  assert.equal(SOURCE_INFO.dida.authGroup, 'dida');
  assert.equal(typeof SOURCE_INFO.dida.name, 'string');
});

test('Gmail maps bounded metadata search and explicit full message read only', () => {
  assert.deepEqual(build('gmail', { operation: 'search', query: 'subject:meeting', limit: 50 }), { name: 'search_threads', args: { query: 'subject:meeting', pageSize: 10, includeTrash: false, view: 'THREAD_VIEW_METADATA_ONLY' } });
  assert.deepEqual(build('gmail', { operation: 'read', id: 'abc123' }), { name: 'get_message', args: { messageId: 'abc123', messageFormat: 'FULL_CONTENT' } });
});

test('calendar defaults to primary and one day, requires timezone-aware bounded ranges', () => {
  assert.deepEqual(build('calendar', { operation: 'upcoming' }), { name: 'list_events', args: { calendarId: 'primary', startTime: '2026-10-19T12:00:00.000Z', endTime: '2026-10-20T12:00:00.000Z', orderBy: 'startTime', pageSize: 10 } });
  assert.equal(build('calendar', { operation: 'upcoming', from: '2026-10-19T06:00:00-06:00', to: '2026-10-20T06:00:00-06:00', calendarId: 'work@example.com', limit: 3 }).args.calendarId, 'work@example.com');
  for (const input of [{ from: '2026-10-19', to: '2026-10-20' }, { to: '2026-11-01T00:00:00Z' }, { to: '2026-10-18T00:00:00Z' }]) assert.throws(() => build('calendar', { operation: 'upcoming', ...input }));
});

test('Drive escapes only a literal title search and does not include snippets or comments', () => {
  assert.deepEqual(build('drive', { operation: 'search', query: "Joe's \\ plans" }), { name: 'search_files', args: { query: "title contains 'Joe\\'s \\\\ plans'", pageSize: 10, excludeContentSnippets: true } });
  assert.deepEqual(build('drive', { operation: 'read', id: 'file_1' }), { name: 'read_file_content', args: { fileId: 'file_1', includeComments: false } });
});

test('Docs and Slides read explicit documents, Sheets requires a small bounded A1 range', () => {
  assert.deepEqual(build('docs', { operation: 'read', id: 'doc_1' }), { name: 'read_doc', args: { documentId: 'doc_1', commentsIncluded: false } });
  const slides = build('slides', { operation: 'read', id: 'deck_1' });
  assert.equal(slides.name, 'read_presentation');
  assert.equal(slides.args.commentsIncluded, false);
  assert.deepEqual(build('sheets', { operation: 'read', id: 'sheet_1', range: "'My sheet'!A1:D20" }), { name: 'get_values', args: { spreadsheetId: 'sheet_1', range: "'My sheet'!A1:D20" } });
  for (const range of [undefined, 'A:A', '1:100', 'A1:Z10000', 'A1:ZZ200', '=IMPORTDATA("https://evil")']) assert.throws(() => build('sheets', { operation: 'read', id: 'sheet_1', range }));
});

test('Dida supports exact read operations and explicit project ownership', () => {
  assert.deepEqual(build('dida', { operation: 'projects' }), { name: 'list_projects', args: { limit: 10, offset: 0 } });
  assert.deepEqual(build('dida', { operation: 'tasks', projectId: 'project1' }), { name: 'get_project_with_undone_tasks', args: { project_id: 'project1' } });
  assert.deepEqual(build('dida', { operation: 'read', projectId: 'project1', id: 'task1' }), { name: 'get_task_in_project', args: { project_id: 'project1', task_id: 'task1' } });
  assert.deepEqual(build('dida', { operation: 'search', query: 'DeepSeek' }), { name: 'search', args: { query: 'DeepSeek' } });
  assert.throws(() => build('dida', { operation: 'tasks' }));
});

test('flomo searches at most five records and reads known ids without broad profile calls', () => {
  assert.deepEqual(build('flomo', { operation: 'search', query: '增长 AI', limit: 20 }), { name: 'memo_search', args: { keywords: '增长 AI', limit: 5 } });
  assert.deepEqual(build('flomo', { operation: 'read', ids: ['memo1', 'memo2'] }), { name: 'memo_batch_get', args: { ids: ['memo1', 'memo2'] } });
  assert.throws(() => build('flomo', { operation: 'read', ids: Array.from({ length: 6 }, (_, i) => `m${i}`) }));
  assert.throws(() => build('flomo', { operation: 'memory_user' }));
});

test('unknown methods, arbitrary endpoints, malformed values and control characters never become calls', () => {
  for (const [source, input] of [['unknown', { operation: 'search', query: 'x' }], ['gmail', { operation: 'send', query: 'x' }], ['gmail', { operation: 'search', query: 'x', url: 'https://evil' }], ['drive', { operation: 'read', id: 'https://evil' }], ['flomo', { operation: 'search', query: '\u0000' }], ['gmail', { operation: 'search', query: 'x', limit: NaN }]]) assert.throws(() => build(source, input));
});

test('live catalogue validation requires an exact read tool and valid JSON Schema', () => {
  const call = build('flomo', { operation: 'search', query: 'growth' });
  assert.deepEqual(validateContextCall(call, catalog('memo_search', { keywords: { type: 'string' }, limit: { type: 'integer', maximum: 50 } }, ['keywords'])), call);
  for (const tools of [[], catalog('memo_create', { content: { type: 'string' } }), catalog('memo_search', { keywords: { type: 'integer' }, limit: { type: 'integer' } }), catalog('memo_search', { keywords: { type: 'string' }, limit: { type: 'integer' }, newRequired: { type: 'string' } }, ['newRequired'])]) assert.throws(() => validateContextCall(call, tools));
  assert.throws(() => validateContextCall({ name: 'memo_create', args: { content: 'write' } }, catalog('memo_create', { content: { type: 'string' } })));
});

test('schema validation handles required, enums, nesting and rejects unrecognized properties or refs', () => {
  const call = build('gmail', { operation: 'search', query: 'x' });
  const props = { query: { type: 'string' }, pageSize: { type: 'integer' }, includeTrash: { type: 'boolean' }, view: { enum: ['THREAD_VIEW_METADATA_ONLY'] } };
  assert.deepEqual(validateContextCall(call, catalog('search_threads', props, ['query'])), call);
  assert.throws(() => validateContextCall(call, catalog('search_threads', { ...props, view: { enum: ['FULL'] } })));
  assert.throws(() => validateContextCall({ ...call, args: { ...call.args, credential: 'SECRET' } }, catalog('search_threads', props)));
  assert.throws(() => validateContextCall(call, [{ name: 'search_threads', inputSchema: { $ref: '#/$defs/changed' } }]));
});

test('flomo projection preserves omissions and truncation, dropping unknown metadata and attachment credentials', () => {
  const result = projectContextResult('flomo', { structuredContent: { memos: [{ id: 'm1', content: 'A useful thought', created_at: '2026-10-18T13:00:00Z', updated_at: '2026-10-19T11:00:00Z', url: 'https://v.flomoapp.com/mine/?memo_id=m1', content_truncated: true, files: [{ url: 'https://storage.example/file?token=SECRET' }], accessToken: 'SECRET', family: 'PRIVATE' }], omitted_ids: ['m2'], truncated: true } }, { operation: 'read', now: time.now });
  assert.equal(result.items[0].id, 'm1');
  assert.equal(result.items[0].text, 'A useful thought');
  assert.equal(result.truncated, true);
  assert.equal(result.omittedCount, 1);
  assert.doesNotMatch(JSON.stringify(result), /SECRET|PRIVATE|accessToken|files/);
});

test('MCP text JSON is unwrapped once and Dida status comes from remote fields', () => {
  const result = projectContextResult('dida', { content: [{ type: 'text', text: JSON.stringify({ tasks: [{ id: 't1', title: 'Prepare demo', content: 'Run a bounded demo', status: 2, dueDate: '2026-10-20T00:00:00Z', projectId: 'p1', user: { name: 'PRIVATE' } }] }) }] }, { operation: 'tasks', now: time.now });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].status, 'completed');
  assert.equal(result.items[0].title, 'Prepare demo');
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
});

test('Gmail search retains metadata snippets without presenting full message bodies', () => {
  const result = projectContextResult('gmail', { threads: [{ id: 'th1', snippet: 'Short excerpt', messages: [{ id: 'msg1', payload: { headers: [{ name: 'Subject', value: 'Meeting' }], body: { data: 'SECRET_FULL_BODY' } } }], unknown: 'PRIVATE' }] }, { operation: 'search', now: time.now });
  assert.equal(result.items[0].title, 'Meeting');
  assert.match(result.items[0].text, /Short excerpt/);
  assert.doesNotMatch(JSON.stringify(result), /SECRET_FULL_BODY|PRIVATE/);
});

test('Calendar, Drive and Google document projections retain only useful source text', () => {
  assert.equal(projectContextResult('calendar', { events: [{ id: 'e1', summary: 'Planning', description: 'Read project notes', start: { dateTime: '2026-10-19T13:00:00Z' }, end: { dateTime: '2026-10-19T14:00:00Z' }, htmlLink: 'https://calendar.google.com/calendar/event?eid=e1', organizer: { email: 'PRIVATE' } }] }, { operation: 'upcoming' }).items[0].title, 'Planning');
  assert.equal(projectContextResult('drive', { files: [{ id: 'f1', title: 'Research', modifiedTime: '2026-10-19T11:00:00Z', webViewLink: 'https://docs.google.com/document/d/f1/edit', owners: [{ emailAddress: 'PRIVATE' }] }] }, { operation: 'search' }).items[0].title, 'Research');
  assert.match(projectContextResult('docs', { documentId: 'd1', title: 'Plan', body: { content: [{ paragraph: { elements: [{ textRun: { content: 'Useful paragraph' } }] } }] }, revisionId: 'PRIVATE' }, { operation: 'read' }).items[0].text, /Useful paragraph/);
  assert.match(projectContextResult('slides', { presentationId: 's1', title: 'Deck', slides: [{ pageElements: [{ shape: { text: { textElements: [{ textRun: { content: 'One slide' } }] } } }] }] }, { operation: 'read' }).items[0].text, /One slide/);
  assert.match(projectContextResult('sheets', { range: 'A1:B2', values: [['Name', 'Value'], ['test', 2]], credential: 'PRIVATE' }, { operation: 'read' }).items[0].text, /Name.*Value/);
});

test('unsafe URLs are removed, external XML is text and unknown nested payloads do not escape', () => {
  for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'http://127.0.0.1/x', 'https://user:secret@example.com/x', 'https://example.com/x?access_token=SECRET']) {
    const r = projectContextResult('flomo', { memos: [{ id: 'm1', content: 'x', url }] }, { operation: 'read' });
    assert.equal(r.items[0].url, undefined);
  }
  const raw = '<!DOCTYPE x [<!ENTITY secret SYSTEM "file:///etc/passwd">]><x>&secret;</x>';
  assert.doesNotThrow(() => projectContextResult('docs', { content: [{ type: 'text', text: raw }] }, { operation: 'read' }));
  assert.doesNotMatch(JSON.stringify(projectContextResult('docs', { strange: { credential: 'SECRET' } }, { operation: 'read' })), /SECRET/);
});

test('projection enforces 10 items, 1200 characters each and 8000 overall with explicit truncation', () => {
  const r = projectContextResult('flomo', { memos: Array.from({ length: 20 }, (_, i) => ({ id: `m${i}`, content: 'x'.repeat(3000) })) }, { operation: 'read' });
  assert.ok(r.items.length <= 10);
  assert.ok(r.items.every(item => item.text.length <= 1200));
  assert.ok(r.items.reduce((n, item) => n + item.text.length + item.title.length, 0) <= 8000);
  assert.equal(r.truncated, true);
});

test('the full projected JSON envelope stays below 8000 characters, including citation fields', () => {
  const r = projectContextResult('flomo', { memos: Array.from({ length: 10 }, (_, i) => ({ id: `m${i}`, content: 'x'.repeat(2000), url: `https://v.flomoapp.com/mine/?memo_id=m${i}`, updated_at: '2026-10-19T11:00:00Z' })) }, { operation: 'read' });
  assert.ok(JSON.stringify(r).length <= 8000);
  assert.equal(r.truncated, true);
});

test('read-only tool validation rejects prototype-bearing arguments and schema-required type changes', () => {
  assert.throws(() => validateContextCall({ name: 'search', args: Object.create({ query: 'hidden' }) }, catalog('search', { query: { type: 'string' } }, ['query'])));
  const read = build('flomo', { operation: 'read', ids: ['m1'] });
  assert.throws(() => validateContextCall(read, catalog('memo_batch_get', { ids: { type: 'array', items: { type: 'integer' } } }, ['ids'])));
});

test('official Google MCP outputs use plaintextBody, fileContent and content wrappers', () => {
  const gmail = projectContextResult('gmail', { id: 'msg1', subject: 'Actual MCP subject', snippet: 'Small excerpt', plaintextBody: 'Complete plain message body', sender: 'PRIVATE_SENDER', attachments: [{ name: 'PRIVATE_ATTACHMENT' }] }, { operation: 'read' });
  assert.equal(gmail.items[0].text, 'Complete plain message body');
  assert.equal(gmail.items[0].title, 'Actual MCP subject');
  assert.doesNotMatch(JSON.stringify(gmail), /PRIVATE_/);
  const search = projectContextResult('gmail', { threads: [{ id: 'thread1', messages: [{ id: 'msg1', subject: 'MCP search subject', snippet: 'Allowed excerpt', plaintextBody: 'PRIVATE_FULL_BODY' }] }], nextPageToken: 'PRIVATE_CURSOR' }, { operation: 'search' });
  assert.equal(search.items[0].title, 'MCP search subject');
  assert.equal(search.truncated, true);
  assert.doesNotMatch(JSON.stringify(search), /PRIVATE_/);
  assert.equal(projectContextResult('drive', { fileContent: 'Document text', contentAnchoredComments: [{ content: 'PRIVATE_COMMENT' }] }, { operation: 'read' }).items[0].text, 'Document text');
  assert.equal(projectContextResult('docs', { content: { documentId: 'd1', title: 'MCP doc', body: { content: [{ paragraph: { elements: [{ textRun: { content: 'MCP paragraph' } }] } }] } } }, { operation: 'read' }).items[0].text, 'MCP paragraph');
  assert.match(projectContextResult('slides', { content: { presentationId: 's1', title: 'MCP deck', slides: [{ pageElements: [{ shape: { text: { textElements: [{ textRun: { content: 'MCP slide' } }] } } }] }] } }, { operation: 'read' }).items[0].text, /MCP slide/);
});

test('calendar does not silently ignore a text-search filter or normalize impossible dates', () => {
  assert.throws(() => build('calendar', { operation: 'search', query: 'budget' }));
  assert.throws(() => build('calendar', { operation: 'upcoming', query: 'budget' }));
  assert.throws(() => build('calendar', { operation: 'upcoming', from: '2026-02-31T12:00:00Z', to: '2026-03-04T12:00:00Z' }));
});

test('citation URLs stay within the source provider and never point to local or credential-bearing destinations', () => {
  for (const url of ['https://localhost./memo', 'https://evil.example/memo', 'https://example.com/memo#token=SECRET']) {
    assert.equal(projectContextResult('flomo', { memos: [{ id: 'm1', content: 'x', url }] }, { operation: 'read' }).items[0].url, undefined);
  }
  assert.equal(projectContextResult('flomo', { memos: [{ id: 'm1', content: 'x', url: 'https://v.flomoapp.com/mine/?memo_id=m1' }] }, { operation: 'read' }).items[0].url, 'https://v.flomoapp.com/mine/?memo_id=m1');
});

test('trusted read request ids supply stable citations when official document output omits ids', () => {
  const drive = projectContextResult('drive', { fileContent: 'Read content' }, { operation: 'read', id: 'file_123' });
  assert.equal(drive.items[0].id, 'file_123');
  assert.equal(drive.items[0].url, 'https://drive.google.com/file/d/file_123/view');
  const sheets = projectContextResult('sheets', { values: [['x', 1]] }, { operation: 'read', id: 'book_123', range: "'Sheet 1'!A1:B2" });
  assert.equal(sheets.items[0].id, 'book_123');
  assert.equal(sheets.items[0].title, "'Sheet 1'!A1:B2");
  assert.match(sheets.items[0].url, /^https:\/\/docs.google.com\/spreadsheets\/d\/book_123\/edit#range=/);
  assert.equal(projectContextResult('docs', { content: { body: { content: [{ paragraph: { elements: [{ textRun: { content: 'x' } }] } }] } } }, { operation: 'read', id: 'doc_123' }).items[0].url, 'https://docs.google.com/document/d/doc_123/edit');
  assert.equal(projectContextResult('slides', { content: { title: 'Deck' } }, { operation: 'read', id: 'deck_123' }).items[0].url, 'https://docs.google.com/presentation/d/deck_123/edit');
});

test('trusted citation hints do not overwrite provider ids or bleed into search rows', () => {
  const read = projectContextResult('dida', { id: 'actual_task', title: 'Task' }, { operation: 'read', id: 'requested_task', projectId: 'project_1' });
  assert.equal(read.items[0].id, 'actual_task');
  assert.equal(read.items[0].url, 'https://dida365.com/webapp/#p/project_1/tasks/actual_task');
  const search = projectContextResult('drive', { files: [{ id: 'f1', title: 'A' }, { id: 'f2', title: 'B' }] }, { operation: 'search', id: 'wrong_hint' });
  assert.deepEqual(search.items.map(item => item.id), ['f1', 'f2']);
  assert.throws(() => projectContextResult('drive', { fileContent: 'x' }, { operation: 'read', id: 'https://evil.example/x' }));
});

test('Drive uses the official viewUrl and Dida search retains the owning project id', () => {
  const drive = projectContextResult('drive', { files: [{ id: 'doc1', title: 'Doc', viewUrl: 'https://docs.google.com/document/d/doc1/edit' }] }, { operation: 'search' });
  assert.equal(drive.items[0].url, 'https://docs.google.com/document/d/doc1/edit');
  const tasks = projectContextResult('dida', { tasks: [{ id: 't1', projectId: 'p1', title: 'Task' }] }, { operation: 'search' });
  assert.equal(tasks.items[0].projectId, 'p1');
  assert.equal(tasks.items[0].url, 'https://dida365.com/webapp/#p/p1/tasks/t1');
  assert.equal(projectContextResult('dida', { tasks: [{ id: 't1', projectId: 'https://evil', title: 'Task' }] }, { operation: 'search' }).items[0].projectId, undefined);
});

test('nested document and slide extraction reports internal traversal truncation', () => {
  const paragraphs = Array.from({ length: 201 }, () => ({ paragraph: { elements: [{ textRun: { content: 'x' } }] } }));
  assert.equal(projectContextResult('docs', { documentId: 'd1', body: { content: paragraphs } }, { operation: 'read' }).truncated, true);
  const slides = Array.from({ length: 51 }, () => ({ pageElements: [{ shape: { text: { textElements: [{ textRun: { content: 'x' } }] } } }] }));
  assert.equal(projectContextResult('slides', { presentationId: 'p1', slides }, { operation: 'read' }).truncated, true);
  const runs = Array.from({ length: 101 }, () => ({ textRun: { content: 'x' } }));
  assert.equal(projectContextResult('docs', { documentId: 'd1', body: { content: [{ paragraph: { elements: runs } }] } }, { operation: 'read' }).truncated, true);
});

test('unsupported Drive text extraction is an explicit unsupported result rather than no matches', () => {
  const r = projectContextResult('drive', { fileContent: '', textFormattingNotSupported: true, commentsNotSupported: true }, { operation: 'read', id: 'f1' });
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].status, 'unsupported_content');
  assert.match(r.items[0].text, /不支持|未提供/);
  assert.equal(r.items[0].id, 'f1');
});

test('scope filters unsupported by an operation are rejected instead of widening the query', () => {
  const cases = [
    ['dida', { operation: 'search', query: 'budget', projectId: 'work_only' }],
    ['drive', { operation: 'search', query: 'budget', id: 'folder_only' }],
    ['gmail', { operation: 'search', query: 'budget', from: '2026-10-19T00:00:00Z' }],
    ['flomo', { operation: 'search', query: 'budget', ids: ['memo_only'] }],
    ['dida', { operation: 'tasks', projectId: 'work_only', query: 'budget' }],
    ['docs', { operation: 'read', id: 'doc1', range: 'A1:B2' }],
    ['sheets', { operation: 'read', id: 'sheet1', range: 'A1:B2', query: 'budget' }],
    ['slides', { operation: 'read', id: 'deck1', projectId: 'unrelated' }],
    ['flomo', { operation: 'read', id: 'm1', ids: ['m2'] }],
    ['dida', { operation: 'search', query: 'budget', limit: 3 }],
  ];
  for (const [source, input] of cases) assert.throws(() => build(source, input));
});

test('Sheets reports traversal clipping even when the source text remains short', () => {
  assert.equal(projectContextResult('sheets', { range: 'A1:A201', values: Array.from({ length: 201 }, () => ['x']) }, { operation: 'read' }).truncated, true);
});
