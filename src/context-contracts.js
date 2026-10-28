/** Fixed read-only provider contracts. Provider content remains untrusted data. */
import { createHash } from 'node:crypto';

export const SOURCE_INFO = Object.freeze(Object.fromEntries([
  ['gmail', 'Gmail', 'google'], ['calendar', 'Google 日历', 'google'], ['drive', 'Google Drive', 'google'],
  ['docs', 'Google Docs', 'google'], ['sheets', 'Google Sheets', 'google'], ['slides', 'Google Slides', 'google'],
  ['dida', '滴答清单', 'dida'], ['flomo', 'flomo', 'flomo'],
].map(([id, name, authGroup]) => [id, Object.freeze({ name, authGroup })])));

const INPUT_KEYS = new Set(['operation', 'query', 'id', 'ids', 'projectId', 'range', 'from', 'to', 'calendarId', 'limit']);
const OPERATION_INPUTS = {
  gmail: { search: ['query', 'limit'], read: ['id'] }, calendar: { upcoming: ['from', 'to', 'calendarId', 'limit'] },
  drive: { search: ['query', 'limit'], read: ['id'] }, docs: { read: ['id'] }, sheets: { read: ['id', 'range'] }, slides: { read: ['id'] },
  dida: { projects: ['limit'], tasks: ['projectId', 'query', 'limit'], read: ['id', 'projectId'], search: ['query'] },
  flomo: { search: ['query', 'limit'], read: ['id', 'ids'] },
};
const READ_TOOLS = new Set(['search_threads', 'get_message', 'list_events', 'search_files', 'read_file_content', 'read_doc', 'get_values', 'read_presentation', 'list_projects', 'get_project_with_undone_tasks', 'get_named_project_with_undone_tasks', 'get_task_in_project', 'search', 'memo_search', 'memo_batch_get']);
const ARG_KEYS = {
  search_threads: ['query', 'pageSize', 'includeTrash', 'view'], get_message: ['messageId', 'messageFormat'],
  list_events: ['calendarId', 'startTime', 'endTime', 'orderBy', 'pageSize'], search_files: ['query', 'pageSize', 'excludeContentSnippets'],
  read_file_content: ['fileId', 'includeComments'], read_doc: ['documentId', 'commentsIncluded'], get_values: ['spreadsheetId', 'range'],
  read_presentation: ['presentationId', 'fields', 'commentsIncluded'], list_projects: ['limit', 'offset'],
  get_project_with_undone_tasks: ['project_id'], get_task_in_project: ['project_id', 'task_id'], search: ['query'],
  get_named_project_with_undone_tasks: ['project_name', 'limit'],
  memo_search: ['keywords', 'limit'], memo_batch_get: ['ids'],
};
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
function fail(code = 'CONTEXT_INVALID_INPUT') { throw Object.assign(new Error('Context request rejected by the read-only contract'), { code }); }
function string(value, maximum = 500) { if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) fail(); return value.trim(); }
function id(value) { const result = string(value, 512); if (!/^[\p{L}\p{N}_@.+:\-]+$/u.test(result) || result.includes('://')) fail(); return result; }
function limit(value, maximum = 10) { if (value === undefined) return maximum; if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1) fail(); return Math.min(value, maximum); }
function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) fail();
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  const dayCheck = new Date(Date.UTC(year, month - 1, day));
  if (dayCheck.getUTCFullYear() !== year || dayCheck.getUTCMonth() + 1 !== month || dayCheck.getUTCDate() !== day) fail();
  return new Date(value).toISOString();
}
function boundedRange(value) {
  const range = string(value, 180);
  const match = /^(?:(?:'[^'\r\n]+(?:''[^'\r\n]*)*'|[\p{L}\p{N}_ .-]+)!)?([A-Z]{1,3})([1-9]\d{0,5})(?::([A-Z]{1,3})([1-9]\d{0,5}))?$/u.exec(range);
  if (!match) fail();
  const col = text => [...text].reduce((n, letter) => n * 26 + letter.charCodeAt(0) - 64, 0);
  const width = col(match[3] || match[1]) - col(match[1]) + 1;
  const height = Number(match[4] || match[2]) - Number(match[2]) + 1;
  if (width < 1 || height < 1 || width > 26 || height > 200 || width * height > 2000) fail();
  return range;
}

/** Construct only known read operations, never a caller-provided tool name. */
export function buildContextCall(source, input, { now = new Date() } = {}) {
  if (!Object.hasOwn(SOURCE_INFO, source) || !plain(input) || Object.keys(input).some(key => !INPUT_KEYS.has(key))) fail();
  const operation = string(input.operation, 30), max = limit(input.limit);
  const accepted = OPERATION_INPUTS[source]?.[operation];
  if (!accepted || Object.keys(input).some(key => key !== 'operation' && input[key] !== undefined && !accepted.includes(key))) fail('CONTEXT_UNSUPPORTED_OPERATION');
  const make = (name, args) => ({ name, args });
  if (source === 'gmail') {
    if (operation === 'search') return make('search_threads', { query: string(input.query), pageSize: max, includeTrash: false, view: 'THREAD_VIEW_METADATA_ONLY' });
    if (operation === 'read') return make('get_message', { messageId: id(input.id), messageFormat: 'FULL_CONTENT' });
  }
  if (source === 'calendar' && operation === 'upcoming') {
    if (input.query !== undefined && input.query !== '') fail('CONTEXT_UNSUPPORTED_OPERATION');
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) fail();
    const startTime = input.from === undefined ? now.toISOString() : date(input.from);
    const endTime = input.to === undefined ? new Date(Date.parse(startTime) + 86_400_000).toISOString() : date(input.to);
    const duration = Date.parse(endTime) - Date.parse(startTime);
    if (duration <= 0 || duration > 7 * 86_400_000) fail();
    return make('list_events', { calendarId: input.calendarId === undefined ? 'primary' : id(input.calendarId), startTime, endTime, orderBy: 'startTime', pageSize: max });
  }
  if (source === 'drive') {
    if (operation === 'search') return make('search_files', { query: `title contains '${string(input.query).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`, pageSize: max, excludeContentSnippets: true });
    if (operation === 'read') return make('read_file_content', { fileId: id(input.id), includeComments: false });
  }
  if (source === 'docs' && operation === 'read') return make('read_doc', { documentId: id(input.id), commentsIncluded: false });
  if (source === 'sheets' && operation === 'read') return make('get_values', { spreadsheetId: id(input.id), range: boundedRange(input.range) });
  if (source === 'slides' && operation === 'read') return make('read_presentation', { presentationId: id(input.id), fields: ['presentationId', 'title', 'slides.pageElements(objectId,shape.text)'], commentsIncluded: false });
  if (source === 'dida') {
    if (operation === 'projects') return make('list_projects', { limit: max, offset: 0 });
    if (operation === 'tasks') {
      if (input.query !== undefined) { if (input.projectId !== undefined) fail(); return make('get_named_project_with_undone_tasks', { project_name: string(input.query,180), limit:max }); }
      if (input.limit !== undefined) fail('CONTEXT_UNSUPPORTED_OPERATION');
      return make('get_project_with_undone_tasks', { project_id: id(input.projectId) });
    }
    if (operation === 'read') return make('get_task_in_project', { project_id: id(input.projectId), task_id: id(input.id) });
    if (operation === 'search') return make('search', { query: string(input.query) });
  }
  if (source === 'flomo') {
    if (operation === 'search') return make('memo_search', { keywords: string(input.query), limit: limit(input.limit, 5) });
    if (operation === 'read') {
      if (input.id !== undefined && input.ids !== undefined) fail();
      const ids = input.ids === undefined ? [input.id] : input.ids;
      if (!Array.isArray(ids) || ids.length < 1 || ids.length > 5) fail();
      const clean = ids.map(id); if (new Set(clean).size !== clean.length) fail();
      return make('memo_batch_get', { ids: clean });
    }
  }
  fail('CONTEXT_UNSUPPORTED_OPERATION');
}

function matchesSchema(value, schema, depth = 0) {
  if (depth > 20 || !plain(schema) || '$ref' in schema || 'not' in schema || 'if' in schema) return false;
  if ('const' in schema && JSON.stringify(value) !== JSON.stringify(schema.const)) return false;
  if (Array.isArray(schema.enum) && !schema.enum.some(item => JSON.stringify(item) === JSON.stringify(value))) return false;
  if (Array.isArray(schema.allOf) && !schema.allOf.every(item => matchesSchema(value, item, depth + 1))) return false;
  if (Array.isArray(schema.anyOf) && !schema.anyOf.some(item => matchesSchema(value, item, depth + 1))) return false;
  if (Array.isArray(schema.oneOf) && schema.oneOf.filter(item => matchesSchema(value, item, depth + 1)).length !== 1) return false;
  const types = schema.type === undefined ? [] : Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types.length && !types.some(type => type === 'null' ? value === null : type === 'object' ? plain(value) : type === 'array' ? Array.isArray(value) : type === 'integer' ? Number.isInteger(value) : type === 'number' ? Number.isFinite(value) : type === 'string' ? typeof value === 'string' : type === 'boolean' ? typeof value === 'boolean' : false)) return false;
  if (typeof value === 'string') {
    if ((typeof schema.minLength === 'number' && value.length < schema.minLength) || (typeof schema.maxLength === 'number' && value.length > schema.maxLength)) return false;
    if (typeof schema.pattern === 'string') { try { if (schema.pattern.length > 500 || !new RegExp(schema.pattern).test(value)) return false; } catch { return false; } }
  }
  if (typeof value === 'number' && ((typeof schema.minimum === 'number' && value < schema.minimum) || (typeof schema.maximum === 'number' && value > schema.maximum))) return false;
  if (Array.isArray(value)) {
    if ((typeof schema.minItems === 'number' && value.length < schema.minItems) || (typeof schema.maxItems === 'number' && value.length > schema.maxItems)) return false;
    if (schema.items !== undefined && !value.every(item => matchesSchema(item, schema.items, depth + 1))) return false;
  }
  if (plain(value)) {
    if (Array.isArray(schema.required) && schema.required.some(key => !Object.hasOwn(value, key))) return false;
    for (const [key, item] of Object.entries(value)) {
      if (plain(schema.properties) && Object.hasOwn(schema.properties, key)) { if (!matchesSchema(item, schema.properties[key], depth + 1)) return false; }
      else if (schema.additionalProperties === false || (plain(schema.additionalProperties) && !matchesSchema(item, schema.additionalProperties, depth + 1))) return false;
    }
  }
  return true;
}

/** Missing, renamed or incompatible live contracts fail closed. */
export function validateContextCall(call, catalog) {
  if (!plain(call) || Object.keys(call).some(key => !['name', 'args'].includes(key)) || !READ_TOOLS.has(call.name) || !plain(call.args)) fail('CONTEXT_UNSUPPORTED_TOOL');
  if (Object.keys(call.args).some(key => !ARG_KEYS[call.name].includes(key))) fail('CONTEXT_SCHEMA_MISMATCH');
  if (catalog?.unsupportedOperations !== undefined) {
    // Bundled provider restrictions can only remove known operations, never grant tools.
    const known = new Set(Object.values(OPERATION_INPUTS).flatMap(operations => Object.keys(operations)));
    const denied = catalog.unsupportedOperations;
    if (catalog.provenance !== 'bundled-contract' || !Array.isArray(denied) || denied.length > known.size || new Set(denied).size !== denied.length || denied.some(operation => !known.has(operation))) fail('CONTEXT_SCHEMA_MISMATCH');
    const operation = { search: 'search', search_threads: 'search', search_files: 'search', memo_search: 'search', list_projects: 'projects', get_project_with_undone_tasks: 'tasks', list_events: 'upcoming' }[call.name] ?? 'read';
    if (denied.includes(operation)) fail('CONTEXT_UNSUPPORTED_OPERATION');
  }
  const tools = Array.isArray(catalog) ? catalog : catalog?.tools;
  const matching = Array.isArray(tools) ? tools.filter(tool => tool?.name === call.name) : [];
  if (matching.length !== 1 || !plain(matching[0].inputSchema) || !matchesSchema(call.args, matching[0].inputSchema)) fail('CONTEXT_SCHEMA_MISMATCH');
  return call;
}

const cleanText = value => typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '') : '';
function safeUrl(value, source) {
  if (typeof value !== 'string' || value.length > 1800) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || /^(?:localhost|.*\.(?:local|internal|lan))$/i.test(url.hostname) || /^\d+(?:\.\d+){3}$/.test(url.hostname) || url.hostname.includes(':')) return undefined;
    const roots = source === 'flomo' ? ['flomoapp.com', 'flomo.app'] : source === 'dida' ? ['dida365.com', 'ticktick.com'] : ['google.com', 'googleusercontent.com'];
    if (!roots.some(root => url.hostname === root || url.hostname.endsWith(`.${root}`))) return undefined;
    if ([...url.searchParams.keys()].some(key => /token|secret|auth|credential|signature|api.?key|password|x-goog-|x-amz-/i.test(key))) return undefined;
    return url.href;
  } catch { return undefined; }
}
function firstText(...values) { for (const value of values) if (typeof value === 'string' && value.trim()) return cleanText(value); return ''; }
function unwrap(raw) {
  if (!plain(raw)) return raw;
  if (raw.isError === true) fail('CONTEXT_REMOTE_ERROR');
  if (raw.structuredContent !== undefined) return raw.structuredContent;
  if (Array.isArray(raw.content)) {
    const texts = raw.content.filter(block => block?.type === 'text' && typeof block.text === 'string').map(block => block.text);
    if (texts.length === 1) { try { return JSON.parse(texts[0]); } catch { return texts[0]; } }
    if (texts.length > 1) return texts.join('\n');
  }
  return raw;
}
function rows(value, keys) {
  if (Array.isArray(value)) return value;
  if (!plain(value)) return [];
  for (const key of keys) if (Array.isArray(value[key])) return value[key];
  if (plain(value.result)) { for (const key of keys) if (Array.isArray(value.result[key])) return value.result[key]; return [value.result]; }
  if (Array.isArray(value.result)) return value.result;
  return [value];
}
function header(message, name) { return message?.payload?.headers?.find?.(entry => typeof entry?.name === 'string' && entry.name.toLowerCase() === name.toLowerCase())?.value; }
const INTERNAL_TRUNCATION = Symbol('contextExtractionTruncated');
function boundedItems(value, maximum, coverage) {
  if (!Array.isArray(value)) return [];
  if (value.length > maximum) coverage.truncated = true;
  return value.slice(0, maximum);
}
function docText(content, depth = 0, coverage = { truncated: false }) {
  if (depth > 12) { if (Array.isArray(content) && content.length) coverage.truncated = true; return ''; }
  return boundedItems(content, 200, coverage).map(part => {
    if (!plain(part)) return '';
    if (part.paragraph) return boundedItems(part.paragraph.elements, 100, coverage).map(element => cleanText(element?.textRun?.content)).join('');
    if (part.table) return boundedItems(part.table.tableRows, 30, coverage).map(row => boundedItems(row.tableCells, 20, coverage).map(cell => docText(cell.content, depth + 1, coverage)).join('\t')).join('\n');
    return '';
  }).join('\n');
}
function slideText(slides, coverage) { return boundedItems(slides, 50, coverage).map(slide => boundedItems(slide?.pageElements, 100, coverage).map(element => boundedItems(element?.shape?.text?.textElements, 100, coverage).map(run => cleanText(run?.textRun?.content)).join('')).join('\n')).join('\n'); }
function projectRow(source, row, operation) {
  if (!plain(row)) return null;
  const coverage = { truncated: false };
  const base = { id: firstText(row.id, row.documentId, row.presentationId, row.spreadsheetId, row.fileId, row.taskId), title: firstText(row.title, row.name, row.summary, row.subject), text: '' };
  const modified = firstText(row.updated_at, row.updatedAt, row.updated, row.modifiedTime, row.modifiedDate); if (modified && Number.isFinite(Date.parse(modified))) base.updatedAt = modified;
  const url = safeUrl(firstText(row.url, row.htmlLink, row.webViewLink, row.viewUrl), source); if (url) base.url = url;
  if (source === 'flomo') base.text = firstText(row.content, row.text);
  if (source === 'dida') {
    base.text = firstText(row.content, row.desc, row.text);
    const project = firstText(row.projectId, row.project_id);
    if (project) { try { base.projectId = id(project); } catch { /* A malformed ownership hint is not a citation. */ } }
    if (row.status === 2 || row.status === 'completed' || row.done === true) base.status = 'completed';
    else if (row.status === 0 || row.status === 'open' || row.done === false) base.status = 'open';
  }
  if (source === 'gmail') {
    const message = Array.isArray(row.messages) ? row.messages[0] : row;
    base.title = firstText(base.title, message?.subject, header(message, 'Subject'));
    base.text = firstText(row.snippet, message?.snippet, row.text);
    if (operation === 'read') base.text = firstText(row.plaintextBody, message?.plaintextBody, row.body?.text, row.bodyText, row.text, message?.text, base.text);
    base.status = operation === 'search' ? 'metadata_only' : 'read';
  }
  if (source === 'calendar') {
    const start = firstText(row.start?.dateTime, row.start?.date), end = firstText(row.end?.dateTime, row.end?.date);
    base.text = [start && `开始：${start}`, end && `结束：${end}`, cleanText(row.description)].filter(Boolean).join('\n');
    if (['confirmed', 'tentative', 'cancelled'].includes(row.status)) base.status = row.status;
  }
  if (source === 'drive') {
    base.text = operation === 'search' ? '' : firstText(row.fileContent, row.text, row.content, row.bodyText);
    if (operation === 'read' && !base.text && row.textFormattingNotSupported === true) { base.text = 'Google Drive 未提供此文件的可读正文；当前格式不支持。'; base.status = 'unsupported_content'; }
  }
  if (source === 'docs') base.text = firstText(row.text, typeof row.content === 'string' ? row.content : '', row.body?.text, docText(row.body?.content, 0, coverage));
  if (source === 'slides') base.text = firstText(row.text, slideText(row.slides, coverage));
  if (source === 'sheets') {
    base.title = firstText(base.title, row.range);
    base.text = Array.isArray(row.values) ? boundedItems(row.values, 200, coverage).map(values => boundedItems(values, 26, coverage).map(value => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? cleanText(String(value)) : '').join('\t')).join('\n') : firstText(row.text);
  }
  if (!base.id && !base.title && !base.text) return null;
  if (coverage.truncated) base[INTERNAL_TRUNCATION] = true;
  return base;
}

function resourceUrl(source, resourceId, projectId, range) {
  try { id(resourceId); } catch { return undefined; }
  const encoded = encodeURIComponent(resourceId);
  if (source === 'drive') return `https://drive.google.com/file/d/${encoded}/view`;
  if (source === 'docs') return `https://docs.google.com/document/d/${encoded}/edit`;
  if (source === 'slides') return `https://docs.google.com/presentation/d/${encoded}/edit`;
  if (source === 'sheets') return `https://docs.google.com/spreadsheets/d/${encoded}/edit${range ? `#range=${encodeURIComponent(range)}` : ''}`;
  if (source === 'gmail') return `https://mail.google.com/mail/u/0/#all/${encoded}`;
  if (source === 'dida' && projectId) return `https://dida365.com/webapp/#p/${encodeURIComponent(projectId)}/tasks/${encoded}`;
  return undefined;
}

/** Project provider data into a small source-labelled text envelope; never return raw metadata. */
export function projectContextResult(source, canonical, { operation, id: requestId, projectId, range } = {}) {
  if (!Object.hasOwn(SOURCE_INFO, source)) fail();
  const referenceId = operation === 'read' && requestId !== undefined ? id(requestId) : undefined;
  const referenceProject = operation === 'read' && projectId !== undefined ? id(projectId) : undefined;
  const referenceRange = source === 'sheets' && operation === 'read' && range !== undefined ? boundedRange(range) : undefined;
  let value = unwrap(canonical);
  if (['docs', 'slides'].includes(source) && plain(value?.content)) value = value.content;
  const omitted = Array.isArray(value?.omitted_ids) ? value.omitted_ids.length : 0;
  let truncated = value?.truncated === true || omitted > 0 || Boolean(value?.nextPageToken), omittedCount = omitted, remaining = 8000;
  const keys = source === 'flomo' ? ['memos', 'items', 'results'] : source === 'gmail' ? ['threads', 'messages', 'items'] : source === 'calendar' ? ['events', 'items'] : source === 'drive' ? ['files', 'items'] : source === 'dida' ? ['tasks', 'projects', 'items', 'results'] : ['items'];
  const candidates = typeof value === 'string' ? [{ text: cleanText(value) }] : rows(value, keys);
  const items = [];
  for (let i = 0; i < candidates.length; i++) {
    const row = candidates[i];
    const projected = projectRow(source, row, operation);
    if (!projected) continue;
    if (operation === 'read' && candidates.length === 1 && !projected.id && referenceId) projected.id = referenceId;
    if (source === 'sheets' && !projected.title && referenceRange) projected.title = referenceRange;
    if (!projected.url && projected.id) {
      const citation = resourceUrl(source, projected.id, projected.projectId || referenceProject, referenceRange);
      if (citation) projected.url = citation;
    }
    if (items.length >= 10 || remaining <= 0) { truncated = true; omittedCount++; continue; }
    if (row?.content_truncated === true || projected[INTERNAL_TRUNCATION]) truncated = true;
    delete projected[INTERNAL_TRUNCATION];
    const originalTitle = projected.title || `${SOURCE_INFO[source].name} 来源资料`;
    const originalText = projected.text;
    projected.title = originalTitle.slice(0, Math.min(180, remaining)); remaining -= projected.title.length;
    projected.text = originalText.slice(0, Math.min(1200, remaining)); remaining -= projected.text.length;
    if (projected.title.length < originalTitle.length || projected.text.length < originalText.length) truncated = true;
    projected.id = projected.id.slice(0, 512) || `${source}_${createHash('sha256').update(`${projected.title}\n${projected.text}`).digest('hex').slice(0, 16)}`;
    items.push(projected);
  }
  const envelope = () => ({ items, truncated, ...(omittedCount ? { omittedCount } : {}) });
  while (items.length && JSON.stringify(envelope()).length > 8000) {
    truncated = true;
    const last = items[items.length - 1];
    const excess = JSON.stringify(envelope()).length - 8000;
    if (last.text.length > excess + 32) last.text = last.text.slice(0, last.text.length - excess - 32);
    else { items.pop(); omittedCount++; }
  }
  return envelope();
}
