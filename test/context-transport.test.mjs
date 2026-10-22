import test from 'node:test';
import assert from 'node:assert/strict';

const modulePath = '../src/context-transport.js';
const load = () => import(modulePath);
const rpc = (id, result, headers = {}) => new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), { status: 200, headers: { 'content-type': 'application/json', ...headers } });
const tool = { name: 'search_threads', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } };
function server(handler) {
  const requests = [];
  return {
    requests,
    fetch: async (url, init) => {
      const request = { url, ...init, body: JSON.parse(init.body) };
      requests.push(request);
      if (request.body.method === 'initialize') return rpc(request.body.id, { protocolVersion: '2025-03-26', capabilities: { tools: {} }, instructions: 'secret server instruction' }, { 'mcp-session-id': 'private-session' });
      if (request.body.method === 'notifications/initialized') return new Response(null, { status: 202 });
      return handler(request, requests);
    }
  };
}
const code = expected => error => error.code === expected && !JSON.stringify(error).includes('private-token');

test('exports the context transport feature', async () => {
  let implementation;
  try { implementation = await load(); } catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
  assert.equal(typeof implementation?.createContextTransport, 'function');
});

test('account owners supply flomo and Dida OAuth without falling back after authorization failure', async () => {
  const { createContextTransport } = await load();
  const remote = server(({ body }) => rpc(body.id, { tools: [] }));
  const calls = [];
  const transport = createContextTransport({ fetch: remote.fetch, flomoAuth: { getToken: async ({ signal }) => { assert.equal(signal.aborted, false); calls.push('flomo'); return 'account-token'; } }, didaAuth: { getToken: async () => { calls.push('dida'); throw new Error('private-token'); } }, tokenForSource: async () => { calls.push('fallback'); return 'legacy-token'; } });
  try {
    await transport.catalog('flomo');
    assert.equal(remote.requests[0].headers.Authorization, 'Bearer account-token');
    await assert.rejects(transport.catalog('dida'), code('CONTEXT_AUTH_REQUIRED'));
    assert.equal(calls.includes('fallback'), false);
  } finally { await transport.close(); }
});

test('negotiates once, privately sends sessions, refreshes credentials per request and projects catalog', async () => {
  const { createContextTransport, CONTEXT_ENDPOINTS } = await load();
  let tokens = 0;
  const remote = server(({ body }) => rpc(body.id, { tools: [{ ...tool, description: 'not shared', annotations: { readOnlyHint: false } }] }));
  const transport = createContextTransport({ fetch: remote.fetch, tokenForSource: async source => { assert.equal(source, 'gmail'); tokens++; return 'private-token'; }, clock: () => new Date('2026-10-19T12:00:00Z') });
  const first = await transport.catalog('gmail');
  const second = await transport.catalog('gmail');
  assert.deepEqual(first, { tools: [tool], fetchedAt: '2026-10-19T12:00:00.000Z' });
  assert.deepEqual(second.tools, [tool]);
  assert.deepEqual(remote.requests.map(x => x.body.method), ['initialize', 'notifications/initialized', 'tools/list', 'tools/list']);
  assert.equal(tokens, 4);
  assert.equal(remote.requests[0].url, CONTEXT_ENDPOINTS.gmail);
  assert.equal(remote.requests[2].headers['Mcp-Session-Id'], 'private-session');
  assert.equal(remote.requests[2].headers.Authorization, 'Bearer private-token');
  assert.equal(remote.requests[2].headers['MCP-Protocol-Version'], '2025-03-26');
  assert.equal(remote.requests[2].redirect, 'manual');
  assert.equal(JSON.stringify(first).includes('private-session'), false);
  await transport.close();
});

test('calls tools through the exact fixed endpoint without propagating init instructions', async () => {
  const { createContextTransport, CONTEXT_ENDPOINTS } = await load();
  const value = { content: [{ type: 'text', text: '{"threads":[]}' }], structuredContent: { threads: [] } };
  const remote = server(({ body }) => rpc(body.id, value));
  const transport = createContextTransport({ fetch: remote.fetch, tokenForSource: async () => 'private-token' });
  const result = await transport.call('gmail', 'search_threads', { query: 'newer_than:1d' });
  assert.deepEqual(result.value, value);
  assert.deepEqual(remote.requests.at(-1).body.params, { name: 'search_threads', arguments: { query: 'newer_than:1d' } });
  assert.equal(remote.requests.at(-1).url, CONTEXT_ENDPOINTS.gmail);
  assert.equal(JSON.stringify(result).includes('secret server instruction'), false);
  assert.equal(Object.isFrozen(CONTEXT_ENDPOINTS), true);
  await assert.rejects(transport.catalog('https://evil.example/mcp'), code('CONTEXT_SOURCE_INVALID'));
  assert.equal(remote.requests.length, 3);
  await transport.close();
});

test('handles bounded SSE with notifications and multiline JSON result data', async () => {
  const { createContextTransport } = await load();
  const remote = server(({ body }) => new Response('event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress","params":{"message":"ignore"}}\n\nevent: message\ndata: {"jsonrpc":"2.0",\ndata: "id":' + JSON.stringify(body.id) + ',"result":{"tools":[]}}\n\n', { headers: { 'content-type': 'text/event-stream' } }));
  const transport = createContextTransport({ fetch: remote.fetch, tokenForSource: async () => 'private-token' });
  assert.deepEqual((await transport.catalog('gmail')).tools, []);
  await transport.close();
});

test('stops an SSE stream as soon as its matching response arrives', async () => {
  const { createContextTransport } = await load();
  let canceled = false;
  const remote = server(({ body }) => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('data: ' + JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { tools: [] } }) + '\n\n')); }, cancel() { canceled = true; } }), { headers: { 'content-type': 'text/event-stream' } }));
  const transport = createContextTransport({ fetch: remote.fetch, tokenForSource: async () => 'private-token' });
  assert.deepEqual((await transport.catalog('gmail')).tools, []);
  assert.equal(canceled, true);
  await transport.close();
});

test('catalog pagination is bounded, requires unique cursors, and rejects duplicate names', async () => {
  const { createContextTransport } = await load();
  const pages = [];
  const remote = server(({ body }) => { pages.push(body.params); return rpc(body.id, pages.length === 1 ? { tools: [tool], nextCursor: 'next' } : { tools: [{ name: 'get_thread', inputSchema: { type: 'object' } }] }); });
  const transport = createContextTransport({ fetch: remote.fetch, tokenForSource: async () => 'private-token' });
  assert.equal((await transport.catalog('gmail')).tools.length, 2);
  assert.deepEqual(pages, [{}, { cursor: 'next' }]);
  await transport.close();
  for (const mode of ['cursor', 'duplicate', 'excessive', 'pages']) {
    let n = 0;
    const broken = server(({ body }) => { n++; return rpc(body.id, mode === 'excessive' ? { tools: Array.from({ length: 201 }, (_, i) => ({ ...tool, name: 't' + i })) } : { tools: [{ ...tool, name: mode === 'duplicate' ? 'same' : 't' + n }], nextCursor: mode === 'cursor' ? 'same' : 'cursor' + n }); });
    const t = createContextTransport({ fetch: broken.fetch, tokenForSource: async () => 'private-token' });
    await assert.rejects(t.catalog('gmail'), code('CONTEXT_CATALOG_INVALID'));
    assert.ok(n <= 3);
    await t.close();
  }
});

test('rejects redirect, unexpected content type, mismatched id, remote errors, and oversized bodies without leaking server text', async () => {
  const { createContextTransport } = await load();
  const cases = [
    [() => new Response('private-token', { status: 302, headers: { location: 'https://evil.example' } }), 'CONTEXT_REDIRECT'],
    [() => new Response('private-token', { status: 401 }), 'CONTEXT_AUTH_REQUIRED'],
    [() => new Response('private-token', { status: 500 }), 'CONTEXT_HTTP_ERROR'],
    [() => new Response('private-token', { headers: { 'content-type': 'text/html' } }), 'CONTEXT_PROTOCOL_INVALID'],
    [() => rpc('wrong-id', { tools: [] }), 'CONTEXT_PROTOCOL_INVALID'],
    [({ body }) => new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { code: -32602, message: 'private-token' } }), { headers: { 'content-type': 'application/json' } }), 'CONTEXT_REMOTE_ERROR'],
    [() => new Response('private-token' + 'x'.repeat(1024 * 1024), { headers: { 'content-type': 'application/json' } }), 'CONTEXT_RESPONSE_TOO_LARGE']
  ];
  for (const [response, expected] of cases) {
    const remote = server(response);
    const t = createContextTransport({ fetch: remote.fetch, tokenForSource: async () => 'private-token' });
    await assert.rejects(t.catalog('gmail'), error => { assert.equal(error.code, expected); assert.equal(String(error).includes('private-token'), false); return true; });
    assert.equal(remote.requests.length, 3);
    await t.close();
  }
});

test('insufficient OAuth scope during initialization is distinct from expired authorization and never reads or echoes the rejection body', async () => {
  const { createContextTransport, CONTEXT_ENDPOINTS } = await load();
  for (const challenge of [
    'Bearer error="insufficient_scope", error_description="Required scope: tasks:write private-token"',
    'bearer realm="dida", error=insufficient_scope',
    'Bearer error_description="private-token, do not echo", Error = "insufficient_scope"',
  ]) {
    let requests = 0, bodyReads = 0, canceled = 0;
    const response = new Response('private-token: Required scope: tasks:write', { status: 403, headers: { 'WWW-Authenticate': challenge } });
    response.body.getReader = () => { bodyReads++; throw new Error('response body must not be read'); };
    response.body.cancel = async () => { canceled++; };
    const t = createContextTransport({ tokenForSource: async () => 'private-token', fetch: async (url, init) => {
      requests++;
      assert.equal(url, CONTEXT_ENDPOINTS.dida);
      const request = JSON.parse(init.body);
      assert.equal(request.method, 'initialize');
      assert.equal(JSON.stringify(request).includes('tasks:write'), false);
      return response;
    } });
    try {
      await assert.rejects(t.catalog('dida'), error => {
        assert.equal(error.code, 'CONTEXT_INSUFFICIENT_SCOPE');
        assert.doesNotMatch(String(error), /private-token|tasks:write/);
        return true;
      });
      assert.equal(requests, 1, 'no automatic retry or scope escalation');
      assert.equal(bodyReads, 0);
      assert.equal(canceled, 1);
    } finally { await t.close(); }
  }
});

test('scope rejection after initialization keeps its classification and resets only the protocol session', async () => {
  const { createContextTransport } = await load();
  const remote = server(() => new Response('private-token', { status: 403, headers: { 'WWW-Authenticate': 'Bearer error="insufficient_scope"' } }));
  const t = createContextTransport({ fetch: remote.fetch, tokenForSource: async () => 'private-token' });
  try {
    await assert.rejects(t.call('dida', 'list_projects', { limit: 2, offset: 0 }), code('CONTEXT_INSUFFICIENT_SCOPE'));
    assert.equal(remote.requests.length, 3);
    await assert.rejects(t.catalog('dida'), code('CONTEXT_INSUFFICIENT_SCOPE'));
    assert.equal(remote.requests.filter(row => row.body.method === 'initialize').length, 2);
  } finally { await t.close(); }
});

test('only a standard Bearer insufficient_scope error classifies a 403 as missing scope; 401 still requires authorization', async () => {
  const { createContextTransport } = await load();
  for (const [status, challenge, expected] of [
    [401, 'Bearer error="insufficient_scope"', 'CONTEXT_AUTH_REQUIRED'],
    [403, '', 'CONTEXT_HTTP_ERROR'],
    [403, 'Bearer error="access_denied"', 'CONTEXT_HTTP_ERROR'],
    [403, 'Basic error="insufficient_scope"', 'CONTEXT_HTTP_ERROR'],
    [403, 'Bearer error_description="error=insufficient_scope"', 'CONTEXT_HTTP_ERROR'],
    [403, 'Bearer error_description="private-token, error=insufficient_scope", error="invalid_token"', 'CONTEXT_HTTP_ERROR'],
    [403, 'Bearer error="insufficient_scope_extra"', 'CONTEXT_HTTP_ERROR'],
    [403, 'Bearer error="insufficient_scope", error="invalid_token"', 'CONTEXT_HTTP_ERROR'],
  ]) {
    let requests = 0;
    const t = createContextTransport({ tokenForSource: async () => 'private-token', fetch: async () => {
      requests++;
      return new Response('{"error":"insufficient_scope","private":"private-token"}', { status, headers: { 'WWW-Authenticate': challenge } });
    } });
    try {
      await assert.rejects(t.catalog('dida'), code(expected));
      assert.equal(requests, 1);
    } finally { await t.close(); }
  }
});

test('credential changes reinitialize sessions between operations and fail closed within an operation', async () => {
  const { createContextTransport } = await load();
  let token = 'first';
  const remote = server(({ body }) => rpc(body.id, { tools: [] }));
  const t = createContextTransport({ fetch: remote.fetch, tokenForSource: async () => token });
  await t.catalog('gmail'); token = 'second'; await t.catalog('gmail');
  assert.equal(remote.requests.filter(x => x.body.method === 'initialize').length, 2);
  await t.close();
  let requests = 0;
  const broken = server(({ body }) => rpc(body.id, { tools: [] }));
  const b = createContextTransport({ fetch: broken.fetch, tokenForSource: async () => ++requests === 1 ? 'one' : 'two' });
  await assert.rejects(b.catalog('gmail'), code('CONTEXT_CREDENTIALS_CHANGED'));
  assert.equal(broken.requests.length, 1);
  await b.close();
});

test('external cancellation aborts a pending request and close rejects future work', async () => {
  const { createContextTransport } = await load();
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const remote = server(({ signal }) => { started(); return new Promise((resolve, reject) => { signal.addEventListener('abort', () => reject(new Error('private-token')), { once: true }); }); });
  const t = createContextTransport({ fetch: remote.fetch, tokenForSource: async () => 'private-token' });
  const controller = new AbortController();
  const pending = t.catalog('gmail', { signal: controller.signal });
  await ready; controller.abort();
  await assert.rejects(pending, code('CONTEXT_ABORTED'));
  await t.close();
  await assert.rejects(t.catalog('gmail'), code('CONTEXT_CLOSED'));
});

test('close aborts even a credential provider which does not observe cancellation', async () => {
  const { createContextTransport } = await load();
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const t = createContextTransport({ fetch: async () => { throw new Error('should not fetch'); }, tokenForSource: async () => { started(); return new Promise(() => {}); } });
  const pending = t.catalog('gmail'); await ready; await t.close();
  await assert.rejects(pending, code('CONTEXT_ABORTED'));
});

test('serializes concurrent operations for one source without sharing sessions across sources', async () => {
  const { createContextTransport } = await load();
  let active = 0; let max = 0;
  const remote = server(async ({ body }) => { active++; max = Math.max(max, active); await new Promise(resolve => setTimeout(resolve, 5)); active--; return rpc(body.id, { tools: [] }); });
  const t = createContextTransport({ fetch: remote.fetch, tokenForSource: async () => 'private-token' });
  await Promise.all([t.catalog('gmail'), t.catalog('gmail')]);
  assert.equal(max, 1);
  await t.catalog('calendar');
  assert.equal(remote.requests.filter(x => x.body.method === 'initialize').length, 2);
  await t.close();
});

test('canceling a queued operation never releases a later operation ahead of the active one', async () => {
  const { createContextTransport } = await load();
  let begin; let finish;
  const ready = new Promise(resolve => { begin = resolve; });
  const gate = new Promise(resolve => { finish = resolve; });
  let calls = 0;
  const remote = server(async ({ body }) => { calls++; if (calls === 1) { begin(); await gate; } return rpc(body.id, { tools: [] }); });
  const t = createContextTransport({ fetch: remote.fetch, tokenForSource: async () => 'private-token' });
  const first = t.catalog('gmail'); await ready;
  const controller = new AbortController();
  const second = t.catalog('gmail', { signal: controller.signal });
  const secondRejected = assert.rejects(second, code('CONTEXT_ABORTED'));
  const third = t.catalog('gmail');
  controller.abort(); await secondRejected;
  await new Promise(resolve => setImmediate(resolve));
  try { assert.equal(calls, 1); } finally { finish(); await Promise.all([first, third]); await t.close(); }
});

test('enforces a total twenty-second budget including a stalled credential provider', async t => {
  const { createContextTransport } = await load();
  let expire;
  t.mock.method(globalThis, 'setTimeout', (callback, milliseconds) => { assert.equal(milliseconds, 20_000); expire = callback; return 0; });
  t.mock.method(globalThis, 'clearTimeout', () => {});
  let begin;
  const ready = new Promise(resolve => { begin = resolve; });
  const transport = createContextTransport({ fetch: async () => { throw new Error('not reached'); }, tokenForSource: async () => { begin(); return new Promise(() => {}); } });
  const pending = transport.catalog('gmail');
  const rejection = assert.rejects(pending, code('CONTEXT_TIMEOUT'));
  await ready; expire(); await rejection;
  await transport.close();
});

test('a failed initialization discards its incomplete session before the next attempt', async () => {
  const { createContextTransport } = await load();
  const requests = [];
  let attempts = 0;
  const transport = createContextTransport({ tokenForSource: async () => 'private-token', fetch: async (url, init) => {
    const body = JSON.parse(init.body); requests.push({ body, headers: init.headers });
    if (body.method === 'initialize') { attempts++; return rpc(body.id, { protocolVersion: '2025-03-26', capabilities: {} }, { 'mcp-session-id': 'session-' + attempts }); }
    if (body.method === 'notifications/initialized') return new Response(null, { status: attempts === 1 ? 500 : 202 });
    return rpc(body.id, { tools: [] });
  } });
  await assert.rejects(transport.catalog('gmail'), code('CONTEXT_HTTP_ERROR'));
  assert.deepEqual((await transport.catalog('gmail')).tools, []);
  assert.equal(requests.filter(x => x.body.method === 'initialize')[1].headers['Mcp-Session-Id'], undefined);
  await transport.close();
});

test('an expired remote session is reset for the next explicit operation without an automatic retry', async () => {
  const { createContextTransport } = await load();
  let lists = 0;
  const remote = server(({ body }) => { lists++; return lists === 1 ? new Response(null, { status: 404 }) : rpc(body.id, { tools: [] }); });
  const t = createContextTransport({ fetch: remote.fetch, tokenForSource: async () => 'private-token' });
  await assert.rejects(t.catalog('gmail'), code('CONTEXT_HTTP_ERROR'));
  assert.equal(lists, 1);
  await t.catalog('gmail');
  assert.equal(remote.requests.filter(x => x.body.method === 'initialize').length, 2);
  await t.close();
});

test('a source permission change during credential resolution prevents even initialization dispatch', async () => {
  const { createContextTransport } = await load();
  let allowed=true,fetches=0;
  const t=createContextTransport({tokenForSource:async()=>{allowed=false;return 'new-account-private-token';},fetch:async()=>{fetches++;throw new Error('must not fetch');}});
  await assert.rejects(t.catalog('gmail',{authorize:()=>allowed}),error=>error.code==='CONTEXT_CANCELLED');
  assert.equal(fetches,0);
  await t.close();
});

test('the final authorization lease is synchronous and is rechecked before every protocol dispatch', async () => {
  const { createContextTransport } = await load();
  for(const authorize of [()=>false,()=>{throw new Error('private-token');},async()=>true]){
    let fetches=0;
    const t=createContextTransport({tokenForSource:async()=> 'private-token',fetch:async()=>{fetches++;throw new Error('must not fetch');}});
    await assert.rejects(t.call('gmail','search_threads',{}, {authorizeSync:authorize}),error=>error.code==='CONTEXT_CANCELLED'&&!String(error).includes('private-token'));
    assert.equal(fetches,0);await t.close();
  }
  let allowed=true;
  const remote=server(({body})=>rpc(body.id,{tools:[]}));
  const t=createContextTransport({tokenForSource:async()=> 'private-token',fetch:async(url,init)=>{const response=await remote.fetch(url,init);if(JSON.parse(init.body).method==='notifications/initialized')allowed=false;return response;}});
  await assert.rejects(t.catalog('gmail',{authorizeSync:()=>allowed}),error=>error.code==='CONTEXT_CANCELLED');
  assert.deepEqual(remote.requests.map(x=>x.body.method),['initialize','notifications/initialized']);
  await t.close();
});

test('an async route authorization gate can approve each dispatch after credentials resolve',async()=>{
  const {createContextTransport}=await load();
  let approvals=0;
  const remote=server(({body})=>rpc(body.id,{tools:[]}));
  const transport=createContextTransport({tokenForSource:async()=> 'private-token',fetch:remote.fetch});
  const result=await transport.catalog('gmail',{authorize:async()=>{await Promise.resolve();approvals++;},authorizeSync:()=>true});
  assert.deepEqual(result.tools,[]);assert.equal(approvals,3);
  await transport.close();
});

test('a changed binding during token resolution is rejected by an async route gate before any fetch',async()=>{
  const {createContextTransport}=await load();
  let began,finish;const entered=new Promise(resolve=>began=resolve),tokens=new Promise(resolve=>finish=resolve);
  let binding='original',fetches=0,gates=0;
  const transport=createContextTransport({tokenForSource:async()=>{began();await tokens;return 'private-token';},fetch:async()=>{fetches++;throw new Error('must not dispatch');}});
  const pending=transport.catalog('gmail',{authorize:async()=>{await Promise.resolve();gates++;if(binding!=='original')throw new Error('private changed binding');},authorizeSync:()=>true});
  const rejected=assert.rejects(pending,error=>error.code==='CONTEXT_CANCELLED'&&!String(error).includes('private'));
  await entered;binding='different';finish();await rejected;
  assert.equal(gates,1);assert.equal(fetches,0);await transport.close();
});

test('a synchronous credential lease is checked again after asynchronous route authorization',async()=>{
  const {createContextTransport}=await load();
  let allowed=true,fetches=0;
  const transport=createContextTransport({tokenForSource:async()=> 'private-token',fetch:async()=>{fetches++;throw new Error('must not dispatch');}});
  await assert.rejects(transport.catalog('gmail',{authorize:async()=>{await Promise.resolve();allowed=false;},authorizeSync:()=>allowed}),error=>error.code==='CONTEXT_CANCELLED');
  assert.equal(fetches,0);await transport.close();
});
