import { createHash } from 'node:crypto';

// Fixed public origins. A conversation cannot supply an endpoint, redirect or header.
export const CONTEXT_ENDPOINTS = Object.freeze({
  gmail: 'https://gmailmcp.googleapis.com/mcp/v1',
  calendar: 'https://calendarmcp.googleapis.com/mcp/v1',
  drive: 'https://drivemcp.googleapis.com/mcp/v1',
  docs: 'https://docsmcp.googleapis.com/mcp/v1',
  sheets: 'https://sheetsmcp.googleapis.com/mcp/v1',
  slides: 'https://slidesmcp.googleapis.com/mcp/v1',
  dida: 'https://mcp.dida365.com',
  flomo: 'https://flomoapp.com/mcp'
});

const PROTOCOL = '2025-03-26';
const MAX_BYTES = 1024 * 1024;
const MAX_REQUEST_BYTES = 256 * 1024;
const MESSAGES = Object.freeze({
  CONTEXT_SOURCE_INVALID: 'Unknown context source.',
  CONTEXT_ARGUMENTS_INVALID: 'Invalid context request.',
  CONTEXT_AUTH_REQUIRED: 'Connect this source in the settings first.',
  CONTEXT_INSUFFICIENT_SCOPE: 'The context service requires additional permissions; the current read-only grant was not expanded.',
  CONTEXT_CREDENTIALS_CHANGED: 'Source credentials changed. Run the request again.',
  CONTEXT_REDIRECT: 'Context endpoint redirects are not allowed.',
  CONTEXT_HTTP_ERROR: 'The context service request failed.',
  CONTEXT_PROTOCOL_INVALID: 'The context service returned an invalid protocol response.',
  CONTEXT_REMOTE_ERROR: 'The context service rejected this request.',
  CONTEXT_RESPONSE_TOO_LARGE: 'The context response exceeds the size limit.',
  CONTEXT_CATALOG_INVALID: 'The context tool catalog is invalid or exceeds the limits.',
  CONTEXT_ABORTED: 'The context request was canceled.',
  CONTEXT_CANCELLED: 'Context permission changed. No request was dispatched.',
  CONTEXT_TIMEOUT: 'The context request timed out.',
  CONTEXT_CLOSED: 'The context transport is closed.'
});
function failure(code) {
  const error = new Error(MESSAGES[code]);
  error.code = code;
  return error;
}
function plain(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
export function insufficientScope(response) {
  const header = response.headers.get('www-authenticate');
  if (typeof header !== 'string' || header.length > 8192) return false;
  const challenge = /^Bearer[ \t]+(.+)$/i.exec(header.trim());
  if (!challenge) return false;
  // Parse whole auth parameters, not descriptions or arbitrary response text.
  const parameter = /([!#$%&'*+.^_\x60|~0-9A-Za-z-]+)[ \t]*=[ \t]*(?:"((?:[^"\\\r\n]|\\[\x20-\x7e])*)"|([!#$%&'*+.^_\x60|~0-9A-Za-z-]+))[ \t]*(?:,[ \t]*|$)/gy;
  const errors = [];
  while (parameter.lastIndex < challenge[1].length) {
    const match = parameter.exec(challenge[1]);
    if (!match) return false;
    if (match[1].toLowerCase() === 'error') errors.push(match[2] ?? match[3]);
  }
  return errors.length === 1 && errors[0] === 'insufficient_scope';
}
function canonical(value) {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error();
    return JSON.parse(serialized);
  } catch { throw failure('CONTEXT_ARGUMENTS_INVALID'); }
}
function abortError(signal) { return failure(signal.reason === 'context-timeout' ? 'CONTEXT_TIMEOUT' : 'CONTEXT_ABORTED'); }
function bounded(promise, signal) {
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(abortError(signal)); };
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(value => { signal.removeEventListener('abort', abort); if (signal.aborted) reject(abortError(signal)); else resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(signal.aborted ? abortError(signal) : error); });
  });
}
function decodeRpc(value, id) {
  if (!plain(value) || value.jsonrpc !== '2.0' || value.id !== id || (Object.hasOwn(value, 'result') === Object.hasOwn(value, 'error'))) throw failure('CONTEXT_PROTOCOL_INVALID');
  if (Object.hasOwn(value, 'error')) throw failure('CONTEXT_REMOTE_ERROR');
  return value.result;
}
function parseJson(text) {
  try { return JSON.parse(text); } catch { throw failure('CONTEXT_PROTOCOL_INVALID'); }
}
async function readRpc(response, id, signal) {
  const type = (response.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase();
  if (type !== 'application/json' && type !== 'text/event-stream') {
    void response.body?.cancel().catch(() => {});
    throw failure('CONTEXT_PROTOCOL_INVALID');
  }
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    void response.body?.cancel().catch(() => {});
    throw failure('CONTEXT_RESPONSE_TOO_LARGE');
  }
  if (!response.body || typeof response.body.getReader !== 'function') throw failure('CONTEXT_PROTOCOL_INVALID');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let buffer = '';
  function eventResult(event) {
    const data = event.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
    if (data === '') return undefined;
    const value = parseJson(data);
    // Server notifications never become tool context or executable instructions.
    if (plain(value) && value.jsonrpc === '2.0' && typeof value.method === 'string' && !Object.hasOwn(value, 'id')) return undefined;
    return { value: decodeRpc(value, id) };
  }
  try {
    while (true) {
      const { value, done } = await bounded(reader.read(), signal);
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) throw failure('CONTEXT_RESPONSE_TOO_LARGE');
      try { buffer += decoder.decode(value, { stream: true }); } catch { throw failure('CONTEXT_PROTOCOL_INVALID'); }
      if (type === 'text/event-stream') {
        buffer = buffer.replace(/\r\n/g, '\n');
        let end;
        while ((end = buffer.indexOf('\n\n')) !== -1) {
          const result = eventResult(buffer.slice(0, end));
          buffer = buffer.slice(end + 2);
          if (result !== undefined) return result.value;
        }
      }
    }
    try { buffer += decoder.decode(); } catch { throw failure('CONTEXT_PROTOCOL_INVALID'); }
    if (type === 'application/json') return decodeRpc(parseJson(buffer), id);
    const result = eventResult(buffer);
    if (result !== undefined) return result.value;
    throw failure('CONTEXT_PROTOCOL_INVALID');
  } finally {
    // MCP SSE responses can remain open after their one matching result.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function createContextTransport(options = {}) {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const tokenForSource = options.tokenForSource;
  const clock = options.clock ?? (() => new Date());
  const states = new Map();
  const active = new Set();
  let nextId = 0;
  let closed = false;
  function sourceState(source) {
    if (typeof source !== 'string' || !Object.hasOwn(CONTEXT_ENDPOINTS, source)) throw failure('CONTEXT_SOURCE_INVALID');
    if (!states.has(source)) states.set(source, { hash: null, sessionId: null, initialized: false, queue: Promise.resolve() });
    return states.get(source);
  }
  function reset(state) { state.hash = null; state.sessionId = null; state.initialized = false; }
  async function token(source, signal, authorizeMutation) {
    try {
      const accountAuth = source === 'flomo' ? options.flomoAuth : source === 'dida' ? options.didaAuth : null;
      const value = await bounded(Promise.resolve().then(() => accountAuth ? accountAuth.getToken({ signal, authorizeMutation }) : tokenForSource?.(source, { signal })), signal);
      if (typeof value !== 'string' || value.length === 0 || value.length > 8192 || /[\r\n]/.test(value)) throw failure('CONTEXT_AUTH_REQUIRED');
      return value;
    } catch (error) {
      if (signal.aborted) throw abortError(signal);
      throw failure('CONTEXT_AUTH_REQUIRED');
    }
  }
  const hash = value => createHash('sha256').update(value).digest('hex');
  function timestamp() {
    const now = clock();
    return new Date(now).toISOString();
  }
  async function request(source, state, operation, method, params, notification = false) {
    const bearer = operation.primedToken ?? await token(source, operation.signal, operation.authorize);
    operation.primedToken = undefined;
    if (hash(bearer) !== state.hash) { reset(state); throw failure('CONTEXT_CREDENTIALS_CHANGED'); }
    const id = ++nextId;
    const body = JSON.stringify({ jsonrpc: '2.0', ...(notification ? {} : { id }), method, ...(params === undefined ? {} : { params }) });
    if (Buffer.byteLength(body) > MAX_REQUEST_BYTES) throw failure('CONTEXT_ARGUMENTS_INVALID');
    const headers = { Authorization: 'Bearer ' + bearer, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': PROTOCOL };
    if (state.sessionId !== null) headers['Mcp-Session-Id'] = state.sessionId;
    if(operation.authorize!==undefined){
      try{
        if(typeof operation.authorize!=='function')throw failure('CONTEXT_CANCELLED');
        const authorization=await bounded(Promise.resolve().then(()=>operation.authorize()),operation.signal);
        if(authorization===false)throw failure('CONTEXT_CANCELLED');
      }catch{
        if(operation.signal.aborted)throw abortError(operation.signal);
        throw failure('CONTEXT_CANCELLED');
      }
    }
    if(operation.authorizeSync!==undefined){
      let authorized=false;
      try{authorized=typeof operation.authorizeSync==='function'&&operation.authorizeSync()===true;}catch{}
      if(!authorized)throw failure('CONTEXT_CANCELLED');
    }
    if(operation.signal.aborted)throw abortError(operation.signal);
    let response;
    try { response = await bounded(fetchImpl(CONTEXT_ENDPOINTS[source], { method: 'POST', headers, body, redirect: 'manual', signal: operation.signal }), operation.signal); }
    catch (error) { if (operation.signal.aborted) throw abortError(operation.signal); throw failure('CONTEXT_HTTP_ERROR'); }
    if (response.status >= 300 && response.status < 400) { void response.body?.cancel().catch(() => {}); throw failure('CONTEXT_REDIRECT'); }
    if (response.status === 401 || response.status === 403) {
      const code = response.status === 401 ? 'CONTEXT_AUTH_REQUIRED'
        : insufficientScope(response) ? 'CONTEXT_INSUFFICIENT_SCOPE' : 'CONTEXT_HTTP_ERROR';
      reset(state);
      void response.body?.cancel().catch(() => {});
      throw failure(code);
    }
    if (!response.ok) {
      if (response.status === 404 || response.status === 410) reset(state);
      void response.body?.cancel().catch(() => {});
      throw failure('CONTEXT_HTTP_ERROR');
    }
    const sessionId = response.headers.get('mcp-session-id');
    if (sessionId !== null) {
      if (!/^[\x21-\x7e]{1,256}$/.test(sessionId) || (state.sessionId !== null && sessionId !== state.sessionId)) { void response.body?.cancel().catch(() => {}); throw failure('CONTEXT_PROTOCOL_INVALID'); }
      state.sessionId = sessionId;
    }
    if (notification) { void response.body?.cancel().catch(() => {}); return undefined; }
    return readRpc(response, id, operation.signal);
  }
  async function initialized(source, state, operation) {
    const bearer = await token(source, operation.signal, operation.authorize);
    const current = hash(bearer);
    if (state.hash !== current) reset(state);
    state.hash = current;
    operation.primedToken = bearer;
    if (state.initialized) return;
    state.sessionId = null;
    const result = await request(source, state, operation, 'initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'deepseek-dot-context', version: '1' } });
    if (!plain(result) || result.protocolVersion !== PROTOCOL || !plain(result.capabilities)) { reset(state); throw failure('CONTEXT_PROTOCOL_INVALID'); }
    await request(source, state, operation, 'notifications/initialized', undefined, true);
    state.initialized = true;
  }
  async function operate(source, settings, work) {
    if (closed) throw failure('CONTEXT_CLOSED');
    const state = sourceState(source);
    const controller = new AbortController();
    const signal = controller.signal;
    const external = settings?.signal;
    const abort = () => controller.abort('context-external');
    if (external?.aborted) abort();
    else external?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort('context-timeout'), 20_000);
    active.add(controller);
    const previous = state.queue;
    let release;
    const held = new Promise(resolve => { release = resolve; });
    state.queue = previous.then(() => held);
    try {
      await bounded(previous, signal);
      if (closed) throw failure('CONTEXT_CLOSED');
      const operation = { signal, primedToken: undefined, authorize:settings?.authorize,authorizeSync:settings?.authorizeSync };
      await initialized(source, state, operation);
      return await work(state, operation);
    } catch (error) {
      if (signal.aborted) throw abortError(signal);
      if (typeof error?.code === 'string' && Object.hasOwn(MESSAGES, error.code)) throw error;
      throw failure('CONTEXT_PROTOCOL_INVALID');
    } finally {
      clearTimeout(timer);
      external?.removeEventListener('abort', abort);
      active.delete(controller);
      release();
    }
  }
  return {
    catalog(source, settings = {}) {
      return operate(source, settings, async (state, operation) => {
        const tools = [];
        const names = new Set();
        const cursors = new Set();
        let cursor;
        for (let page = 0; page < 3; page++) {
          const result = await request(source, state, operation, 'tools/list', cursor === undefined ? {} : { cursor });
          if (!plain(result) || !Array.isArray(result.tools) || result.tools.length > 200) throw failure('CONTEXT_CATALOG_INVALID');
          for (const entry of result.tools) {
            if (!plain(entry) || typeof entry.name !== 'string' || entry.name.length === 0 || entry.name.length > 160 || names.has(entry.name) || !plain(entry.inputSchema)) throw failure('CONTEXT_CATALOG_INVALID');
            names.add(entry.name);
            tools.push({ name: entry.name, inputSchema: canonical(entry.inputSchema) });
          }
          if (result.nextCursor === undefined) return { tools, fetchedAt: timestamp() };
          if (typeof result.nextCursor !== 'string' || result.nextCursor.length === 0 || result.nextCursor.length > 2048 || cursors.has(result.nextCursor) || page === 2) throw failure('CONTEXT_CATALOG_INVALID');
          cursors.add(result.nextCursor);
          cursor = result.nextCursor;
        }
        throw failure('CONTEXT_CATALOG_INVALID');
      });
    },
    call(source, name, args, settings = {}) {
      if (typeof name !== 'string' || name.length === 0 || name.length > 160 || !plain(args)) return Promise.reject(failure('CONTEXT_ARGUMENTS_INVALID'));
      let argumentsValue;
      try { argumentsValue = canonical(args); } catch (error) { return Promise.reject(error); }
      return operate(source, settings, async (state, operation) => {
        const value = await request(source, state, operation, 'tools/call', { name, arguments: argumentsValue });
        return { value: canonical(value), fetchedAt: timestamp() };
      });
    },
    async close() {
      if (closed) return;
      closed = true;
      for (const controller of active) controller.abort('context-close');
      for (const state of states.values()) reset(state);
    }
  };
}
