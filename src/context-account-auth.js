import { createServer } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readContextConfig } from './context-config.js';

// Pinned first-party metadata verified 2026-10-19. Never accept discovery URLs from chat or servers.
const PROVIDERS = Object.freeze({
  flomo: Object.freeze({ label: 'flomo', issuer: 'https://flomoapp.com', authorization: 'https://flomoapp.com/integration/grant', registration: 'https://flomoapp.com/oauth/register', token: 'https://flomoapp.com/oauth/token', resource: 'https://flomoapp.com/mcp', scope: 'mcp', refresh: true }),
  dida: Object.freeze({ label: '滴答清单', issuer: 'https://dida365.com', authorization: 'https://dida365.com/oauth/authorize', registration: 'https://api.dida365.com/oauth/register', token: 'https://api.dida365.com/oauth/token', resource: 'https://mcp.dida365.com/', scope: 'tasks:read', refresh: false }),
});
const FLOW_TTL = 300_000, REQUEST_TIMEOUT = 20_000, MAX_BODY = 65_536;
const text = (value, max = 8192) => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\r\n]/.test(value);
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const same = (left, right) => typeof left === 'string' && typeof right === 'string' && Buffer.byteLength(left) === Buffer.byteLength(right) && timingSafeEqual(Buffer.from(left), Buffer.from(right));
function parseCredentials(source, serialized) {
  const value = JSON.parse(serialized);
  if (!plain(value) || value.version !== 1 || value.source !== source || !text(value.connectionId, 256) || !text(value.clientId, 2048) || !text(value.accessToken) || typeof value.refreshToken !== 'string' || value.refreshToken.length > 8192 || /[\r\n]/.test(value.refreshToken) || !Number.isFinite(value.expiresAt) || value.expiresAt < 0 || value.scope !== PROVIDERS[source].scope || Object.keys(value).some(name => !['version', 'source', 'connectionId', 'clientId', 'accessToken', 'refreshToken', 'expiresAt', 'scope'].includes(name))) throw new Error();
  return value;
}

/** Safe status and stable lease key: automatic token rotation does not change account identity. */
export function contextAccountCredentialState(source, config, now = Date.now()) {
  if (!Object.hasOwn(PROVIDERS, source)) throw new Error('不支持此资料来源。');
  const serialized = config?.[source + 'OAuthCredentials'] ?? '';
  let configured = false, identity = [serialized, config?.[source + 'Token'] ?? ''];
  if (serialized) {
    try {
      const current = parseCredentials(source, serialized);
      configured = current.expiresAt - 30000 > Number(now) || Boolean(PROVIDERS[source].refresh && current.refreshToken);
      identity = ['oauth', source, current.connectionId, current.clientId];
    } catch {}
  } else { configured = text(config?.[source + 'Token']); identity = [config?.[source + 'Token']]; }
  return { configured, key: createHash('sha256').update(JSON.stringify(identity)).digest('hex') };
}

/** User-initiated public-client DCR + PKCE. Passwords remain on the provider's sign-in page. */
export function createContextAccountAuth({ source, readConfig, saveCredentials, fetch: fetchImpl = globalThis.fetch, clock = Date.now } = {}) {
  if (!Object.hasOwn(PROVIDERS, source)) throw new Error('不支持此资料来源的账号连接。');
  const provider = PROVIDERS[source], field = source + 'OAuthCredentials', legacyField = source + 'Token';
  const error = (message = `${provider.label} 连接失败，请返回设置重新连接。`) => new Error(message);
  let closed = false, pending = null, starting = null, refreshing = null;
  const controllers = new Set(), flights = new Set(), closingServers = new Set();
  const now = () => Number(clock());
  const open = () => { if (closed) throw error(`${provider.label} 连接已关闭。`); };
  const read = () => { try { return readContextConfig(readConfig?.()); } catch { throw error(); } };
  const key = config => createHash('sha256').update(JSON.stringify([config[field], config[legacyField]])).digest('hex');
  const track = promise => { flights.add(promise); promise.then(() => flights.delete(promise), () => flights.delete(promise)); return promise; };
  async function authorizeMutation(guard, signal) {
    open();
    if (signal?.aborted || (guard !== undefined && typeof guard !== 'function')) throw error();
    if (!guard) return true;
    const controller = new AbortController(), cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    controllers.add(controller);
    const timer = setTimeout(cancel, REQUEST_TIMEOUT);
    try {
      if (await bounded(Promise.resolve().then(guard), controller.signal) === false) throw error();
      open();
      if (signal?.aborted || controller.signal.aborted) throw error();
      return true;
    } catch { throw error(); }
    finally { clearTimeout(timer); controllers.delete(controller); signal?.removeEventListener('abort', cancel); }
  }
  function credentials(config) {
    if (!config[field]) return null;
    try {
      return parseCredentials(source, config[field]);
    } catch { throw error(`${provider.label} 授权需要重新连接。`); }
  }
  function bounded(promise, signal) {
    if (signal.aborted) return Promise.reject(error());
    return new Promise((resolve, reject) => {
      const abort = () => { cleanup(); reject(error()); };
      const cleanup = () => signal.removeEventListener('abort', abort);
      signal.addEventListener('abort', abort, { once: true });
      Promise.resolve(promise).then(value => { cleanup(); signal.aborted ? reject(error()) : resolve(value); }, () => { cleanup(); reject(error()); });
    });
  }
  async function requestJson(url, fields, jsonBody, external) {
    open();
    const controller = new AbortController(), cancel = () => controller.abort();
    if (external?.aborted) cancel();
    else external?.addEventListener('abort', cancel, { once: true });
    controllers.add(controller);
    const timer = setTimeout(cancel, REQUEST_TIMEOUT);
    try {
      const response = await bounded(Promise.resolve().then(() => fetchImpl(url, { method: 'POST', redirect: 'error', headers: { accept: 'application/json', 'content-type': jsonBody ? 'application/json' : 'application/x-www-form-urlencoded' }, body: jsonBody ? JSON.stringify(fields) : new URLSearchParams(fields).toString(), signal: controller.signal })), controller.signal);
      if (!response.ok || closed || Number(response.headers?.get?.('content-length')) > MAX_BODY) throw error();
      let body;
      if (response.body?.getReader) {
        const reader = response.body.getReader(), chunks = []; let size = 0;
        try {
          while (true) {
            const chunk = await bounded(reader.read(), controller.signal);
            if (chunk.done) break;
            size += chunk.value.byteLength;
            if (size > MAX_BODY) throw error();
            chunks.push(Buffer.from(chunk.value));
          }
          body = Buffer.concat(chunks).toString('utf8');
        } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
      } else {
        body = await bounded(response.text(), controller.signal);
        if (Buffer.byteLength(body) > MAX_BODY) throw error();
      }
      const value = JSON.parse(body);
      if (!plain(value) || controller.signal.aborted || closed) throw error();
      return value;
    } catch { throw error(closed || external?.aborted ? `${provider.label} 连接请求已取消。` : undefined); }
    finally { clearTimeout(timer); controllers.delete(controller); external?.removeEventListener('abort', cancel); }
  }
  async function exchange(fields, signal, previousRefresh = '') {
    const value = await requestJson(provider.token, { ...fields, resource: provider.resource }, false, signal);
    if (!text(value.access_token) || typeof value.token_type !== 'string' || value.token_type.toLowerCase() !== 'bearer') throw error();
    // A missing expires_in gets a one-hour local reuse lease, never unlimited persistence.
    const ttl = value.expires_in === undefined ? 3600 : Number(value.expires_in);
    if (!Number.isFinite(ttl) || ttl <= 0 || (value.scope !== undefined && (typeof value.scope !== 'string' || value.scope.trim().split(/\s+/).length !== 1 || value.scope.trim() !== provider.scope))) throw error();
    if (value.refresh_token !== undefined && !text(value.refresh_token)) throw error();
    return { accessToken: value.access_token, refreshToken: provider.refresh ? value.refresh_token ?? previousRefresh : '', expiresAt: now() + Math.min(ttl, 31_536_000) * 1000, scope: provider.scope };
  }
  function stopServer(flow) {
    clearTimeout(flow.timer);
    if (pending === flow) pending = null;
    if (flow.stopped) return flow.stopped;
    flow.stopped = new Promise(resolve => { flow.server.close(resolve); flow.server.closeIdleConnections?.(); });
    closingServers.add(flow.stopped);
    flow.stopped.finally(() => closingServers.delete(flow.stopped));
    return flow.stopped;
  }
  function dropFlow(flow) { flow.used = true; flow.abort.abort(); return stopServer(flow); }
  function respond(response, status, success = false) {
    response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; frame-ancestors 'none'", 'x-content-type-options': 'nosniff', connection: 'close' });
    response.end(success ? `${provider.label} 已连接，可以关闭此页面并返回 DeepSeek Dot。` : `${provider.label} 连接未完成，请返回 DeepSeek Dot 重新连接。`);
  }
  async function persist(value, expectedConfig, signal, guard) {
    open();
    const expectedKey = key(expectedConfig);
    if (signal?.aborted || key(read()) !== expectedKey) throw error();
    const serialized = JSON.stringify({ version: 1, source, ...value });
    if (serialized.length > 32768) throw error();
    const controller = new AbortController(), cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    controllers.add(controller);
    const timer = setTimeout(cancel, REQUEST_TIMEOUT);
    // The native writer must invoke this guard immediately before its revision-CAS mutation.
    const commitGuard = async () => {
      await authorizeMutation(guard, controller.signal);
      if (key(read()) !== expectedKey) throw error();
      return true;
    };
    try {
      await bounded(Promise.resolve().then(async () => {
        await commitGuard();
        const result = await saveCredentials(serialized, { expectedValue: expectedConfig[field], expectedLegacy: expectedConfig[legacyField], authorizeMutation: commitGuard });
        if (result === false) throw error();
      }), controller.signal);
      if (closed || signal?.aborted || controller.signal.aborted || read()[field] !== serialized) throw error();
    } catch { throw error(); }
    finally { clearTimeout(timer); controllers.delete(controller); signal?.removeEventListener('abort', cancel); }
  }
  async function callback(flow, request, response) {
    let url;
    try { url = new URL(request.url, flow.redirectUri); } catch { respond(response, 400); return; }
    if (request.method !== 'GET' || url.pathname !== '/oauth2/callback') { respond(response, 404); return; }
    if (request.headers.host !== flow.host || url.origin !== new URL(flow.redirectUri).origin) { respond(response, 400); return; }
    if (closed || pending !== flow || flow.used || now() >= flow.expiresAt || key(read()) !== flow.configKey) { respond(response, 400); if (pending === flow && !flow.used) void dropFlow(flow); return; }
    const state = url.searchParams.getAll('state'), code = url.searchParams.getAll('code'), issuer = url.searchParams.getAll('iss'), errors = url.searchParams.getAll('error');
    if (state.length !== 1 || !same(state[0], flow.state) || issuer.length > 1 || (issuer.length === 1 && issuer[0] !== provider.issuer)) { respond(response, 400); return; }
    // Only a verified, unambiguous denial may end the flow and unlock a fresh login.
    if (errors.length) {
      if (errors.length !== 1 || code.length || !text(errors[0], 256)) { respond(response, 400); return; }
      flow.used = true; respond(response, 400); void stopServer(flow); return;
    }
    if (code.length !== 1 || !text(code[0])) { respond(response, 400); return; }
    flow.used = true;
    try {
      await authorizeMutation(flow.authorizeMutation, flow.abort.signal);
      if (pending !== flow || now() >= flow.expiresAt || key(read()) !== flow.configKey) throw error();
      const result = await exchange({ client_id: flow.clientId, code: code[0], code_verifier: flow.verifier, redirect_uri: flow.redirectUri, grant_type: 'authorization_code' }, flow.abort.signal);
      if (pending !== flow || now() >= flow.expiresAt) throw error();
      await persist({ connectionId: randomBytes(32).toString('base64url'), clientId: flow.clientId, ...result }, flow.expectedConfig, flow.abort.signal, flow.authorizeMutation);
      respond(response, 200, true);
    } catch { respond(response, 400); }
    finally { void stopServer(flow); }
  }
  async function startInner(options = {}) {
    open();
    if (typeof saveCredentials !== 'function') throw error('原生凭据保存不可用，不能开始账号连接。');
    await authorizeMutation(options.authorizeMutation);
    const expectedConfig = read(), configKey = key(expectedConfig);
    if (pending && !pending.used && now() < pending.expiresAt && pending.configKey === configKey && pending.url) {
      const existing = pending;
      try {
        await authorizeMutation(existing.authorizeMutation, existing.abort.signal);
        if (pending !== existing || now() >= existing.expiresAt) throw error();
        return { url: existing.url, expiresAt: new Date(existing.expiresAt).toISOString() };
      } catch { await dropFlow(existing); }
    }
    if (pending) await dropFlow(pending);
    open();
    const flow = { state: randomBytes(32).toString('base64url'), verifier: randomBytes(48).toString('base64url'), configKey, expectedConfig, authorizeMutation: options.authorizeMutation, expiresAt: now() + FLOW_TTL, used: false, abort: new AbortController() };
    const server = createServer({ maxHeaderSize: 16384 }, (request, response) => { track(callback(flow, request, response).catch(() => { if (!response.headersSent) respond(response, 400); else response.end(); })); });
    flow.server = server;
    server.requestTimeout = 10000; server.headersTimeout = 10000; server.keepAliveTimeout = 1000;
    try {
      await new Promise((resolve, reject) => { server.once('error', () => reject(error())); server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, resolve); });
      flow.host = `127.0.0.1:${server.address().port}`;
      flow.redirectUri = `http://${flow.host}/oauth2/callback`;
      open();
      pending = flow;
      flow.timer = setTimeout(() => { void dropFlow(flow); }, FLOW_TTL); flow.timer.unref?.(); server.unref();
      await authorizeMutation(flow.authorizeMutation, flow.abort.signal);
      if (key(read()) !== configKey) throw error();
      const registration = await requestJson(provider.registration, { client_name: `DeepSeek Dot (${provider.label})`, redirect_uris: [flow.redirectUri], token_endpoint_auth_method: 'none', grant_types: provider.refresh ? ['authorization_code', 'refresh_token'] : ['authorization_code'], response_types: ['code'], scope: provider.scope }, true, flow.abort.signal);
      if (!text(registration.client_id, 2048) || (registration.token_endpoint_auth_method !== undefined && registration.token_endpoint_auth_method !== 'none') || registration.client_secret !== undefined || closed || pending !== flow || key(read()) !== configKey || now() >= flow.expiresAt) throw error();
      flow.clientId = registration.client_id;
      const url = new URL(provider.authorization);
      for (const [name, value] of Object.entries({ client_id: flow.clientId, redirect_uri: flow.redirectUri, response_type: 'code', scope: provider.scope, resource: provider.resource, state: flow.state, code_challenge: createHash('sha256').update(flow.verifier).digest('base64url'), code_challenge_method: 'S256' })) url.searchParams.set(name, value);
      flow.url = url.toString();
      return { url: flow.url, expiresAt: new Date(flow.expiresAt).toISOString() };
    } catch { await dropFlow(flow); throw error(closed ? `${provider.label} 连接已关闭。` : undefined); }
  }
  async function getTokenInner({ signal, authorizeMutation: guard } = {}) {
    open();
    if (signal?.aborted) throw error();
    await authorizeMutation(guard, signal);
    const config = read(), current = credentials(config), configKey = key(config);
    if (!current) {
      if (text(config[legacyField])) return config[legacyField];
      throw error(`${provider.label} 尚未连接，请先完成账号授权。`);
    }
    if (current.expiresAt - 30000 > now()) return current.accessToken;
    if (!provider.refresh || !current.refreshToken) throw error(`${provider.label} 授权已过期，请重新连接。`);
    if (!refreshing || refreshing.key !== configKey) {
      const promise = track((async () => {
        const result = await exchange({ client_id: current.clientId, grant_type: 'refresh_token', refresh_token: current.refreshToken }, signal, current.refreshToken);
        await persist({ connectionId: current.connectionId, clientId: current.clientId, ...result }, config, signal, guard);
        return result.accessToken;
      })());
      const flight = { key: configKey, promise }; refreshing = flight;
      promise.then(() => { if (refreshing === flight) refreshing = null; }, () => { if (refreshing === flight) refreshing = null; });
    }
    const token = await (signal ? bounded(refreshing.promise, signal) : refreshing.promise);
    await authorizeMutation(guard, signal);
    return token;
  }
  return {
    status() {
      let current = null;
      try { current = credentials(read()); } catch {}
      // Consuming the code is not completion: keep polling through exchange and save.
      const active = !closed && pending && now() < pending.expiresAt;
      return { clientConfigured: true, refreshConfigured: Boolean(current && (current.expiresAt - 30000 > now() || (provider.refresh && current.refreshToken))), authInProgress: Boolean(active), ...(active ? { expiresAt: new Date(pending.expiresAt).toISOString() } : {}) };
    },
    start(options) {
      if (!starting) {
        const promise = track(startInner(options)); starting = promise;
        promise.then(() => { if (starting === promise) starting = null; }, () => { if (starting === promise) starting = null; });
      }
      return starting;
    },
    getToken(options) { return track(getTokenInner(options)); },
    async close() {
      closed = true;
      for (const controller of controllers) controller.abort();
      if (pending) void dropFlow(pending);
      await Promise.allSettled([...flights]);
      await Promise.allSettled([...closingServers]);
    },
  };
}
