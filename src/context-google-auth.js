import { createServer } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readContextConfig } from './context-config.js';

export const GOOGLE_READ_SCOPES = Object.freeze([
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/documents.readonly',
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/presentations.readonly',
]);
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const FLOW_TTL = 300000;
const REQUEST_TIMEOUT = 20000;
const MAX_BODY = 65536;
const safeError = (message = 'Google 连接失败，请在原生插件设置检查授权后重试。') => new Error(message);
const keyOf = (config) => createHash('sha256').update(JSON.stringify([config.googleClientId, config.googleClientSecret, config.googleRefreshToken])).digest('hex');
const constantEqual = (left, right) => {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};

/** Fixed-endpoint Google Desktop OAuth. Secrets stay in native Config or short-lived memory. */
export function createGoogleAuth({ readConfig, saveRefreshToken, fetch: fetchImpl = globalThis.fetch, clock = Date.now } = {}) {
  let closed = false, cache = null, pending = null, starting = null;
  const controllers = new Set(), flights = new Set(), closingServers = new Set();
  const now = () => Number(clock());
  const read = () => {
    try { return readContextConfig(typeof readConfig === 'function' ? readConfig() : undefined); }
    catch { throw safeError('Google 连接配置无效，请在原生插件设置中检查。'); }
  };
  const requireOpen = () => { if (closed) throw safeError('Google 连接已关闭。'); };
  const configured = (config) => Boolean(config.googleClientId.trim() && config.googleClientSecret.trim());
  const track = (promise) => {
    flights.add(promise);
    promise.then(() => flights.delete(promise), () => flights.delete(promise));
    return promise;
  };
  const stopServer = (flow) => {
    clearTimeout(flow.timer);
    if (pending === flow) pending = null;
    if (flow.stopped) return flow.stopped;
    flow.stopped = new Promise((resolve) => {
      flow.server.close(() => resolve());
      flow.server.closeIdleConnections?.();
    });
    closingServers.add(flow.stopped);
    flow.stopped.finally(() => closingServers.delete(flow.stopped));
    return flow.stopped;
  };
  const dropFlow = (flow) => {
    flow.used = true;
    flow.abort.abort();
    return stopServer(flow);
  };

  async function readJson(response, signal) {
    const length = Number(response.headers?.get?.('content-length'));
    if (length > MAX_BODY) throw safeError();
    let text;
    if (response.body?.getReader) {
      const reader = response.body.getReader();
      let size = 0;
      const chunks = [];
      try {
        while (true) {
          if (signal.aborted) throw safeError('Google 连接请求已取消。');
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > MAX_BODY) { await reader.cancel(); throw safeError(); }
          chunks.push(Buffer.from(chunk.value));
        }
      } finally { reader.releaseLock(); }
      text = Buffer.concat(chunks).toString('utf8');
    } else {
      text = await response.text();
      if (Buffer.byteLength(text) > MAX_BODY) throw safeError();
    }
    try { return JSON.parse(text); } catch { throw safeError(); }
  }

  async function tokenRequest(fields, signal) {
    requireOpen();
    if (signal?.aborted) throw safeError('Google 连接请求已取消。');
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    controllers.add(controller);
    const timer = setTimeout(cancel, REQUEST_TIMEOUT);
    try {
      const response = await fetchImpl(TOKEN_URL, {
        method: 'POST', redirect: 'error',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: new URLSearchParams(fields).toString(), signal: controller.signal,
      });
      if (!response.ok || controller.signal.aborted || closed) throw safeError();
      const value = await readJson(response, controller.signal);
      if (controller.signal.aborted || closed) throw safeError();
      if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.access_token !== 'string' || !value.access_token || value.access_token.length > 16384 || value.token_type?.toLowerCase() !== 'bearer') throw safeError();
      const ttl = Number(value.expires_in);
      if (!Number.isFinite(ttl) || ttl <= 0) throw safeError();
      if (value.scope !== undefined && (typeof value.scope !== 'string' || !GOOGLE_READ_SCOPES.every((scope) => value.scope.split(' ').includes(scope)))) throw safeError('Google 只读授权不完整，请重新连接并确认所需权限。');
      return { accessToken: value.access_token, refreshToken: typeof value.refresh_token === 'string' && value.refresh_token.length <= 16384 ? value.refresh_token : '', expiresAt: now() + Math.min(ttl, 3600) * 1000 };
    } catch {
      throw safeError(controller.signal.aborted || signal?.aborted || closed ? 'Google 连接请求已取消。' : undefined);
    } finally {
      clearTimeout(timer);
      controllers.delete(controller);
      signal?.removeEventListener('abort', cancel);
    }
  }

  const finishResponse = (response, status, success = false) => {
    response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; frame-ancestors 'none'", 'x-content-type-options': 'nosniff', connection: 'close' });
    response.end(success ? 'Google 已连接，可以关闭此页面并返回 DeepSeek Dot。' : 'Google 连接未完成，请返回 DeepSeek Dot 重新连接。');
  };

  async function handleCallback(flow, request, response) {
    let url;
    try { url = new URL(request.url, flow.redirectUri); } catch { finishResponse(response, 400); return; }
    if (request.method !== 'GET' || url.pathname !== '/oauth2/callback') { finishResponse(response, 404); return; }
    if (request.headers.host !== flow.host || url.origin !== new URL(flow.redirectUri).origin) { finishResponse(response, 400); return; }
    if (closed || pending !== flow || flow.used || now() >= flow.expiresAt) {
      finishResponse(response, 400);
      if (pending === flow && !flow.used) void dropFlow(flow);
      return;
    }
    const state = url.searchParams.getAll('state'), code = url.searchParams.getAll('code');
    if (state.length !== 1 || !constantEqual(state[0], flow.state) || code.length !== 1 || !code[0] || code[0].length > 8192 || url.searchParams.has('error')) { finishResponse(response, 400); return; }
    flow.used = true; // A valid callback can exchange its code at most once.
    try {
      if (keyOf(read()) !== flow.configKey) throw safeError();
      const result = await tokenRequest({ client_id: flow.clientId, client_secret: flow.clientSecret, code: code[0], code_verifier: flow.verifier, redirect_uri: flow.redirectUri, grant_type: 'authorization_code' }, flow.abort.signal);
      if (closed || pending !== flow || keyOf(read()) !== flow.configKey || !result.refreshToken) throw safeError();
      await saveRefreshToken(result.refreshToken);
      const current = read();
      if (closed || pending !== flow || current.googleClientId !== flow.clientId || current.googleClientSecret !== flow.clientSecret) throw safeError();
      if (current.googleRefreshToken === result.refreshToken) cache = { ...result, key: keyOf(current) };
      finishResponse(response, 200, true);
    } catch { cache = null; finishResponse(response, 400); }
    finally { void stopServer(flow); }
  }

  async function startInner() {
    requireOpen();
    if (typeof saveRefreshToken !== 'function') throw safeError('原生凭据保存不可用，不能开始 Google 连接。');
    const config = read();
    if (!configured(config)) throw safeError('请先在原生插件设置中配置 Google Desktop Client ID 和 Client Secret。');
    if (pending && !pending.used && now() < pending.expiresAt && pending.configKey === keyOf(config)) return { url: pending.url, expiresAt: new Date(pending.expiresAt).toISOString() };
    if (pending) await dropFlow(pending);
    requireOpen();
    const flow = {
      state: randomBytes(32).toString('base64url'), verifier: randomBytes(48).toString('base64url'),
      clientId: config.googleClientId, clientSecret: config.googleClientSecret, configKey: keyOf(config),
      expiresAt: now() + FLOW_TTL, used: false, abort: new AbortController(), server: null,
    };
    const server = createServer({ maxHeaderSize: 16384 }, (request, response) => {
      const call = handleCallback(flow, request, response).catch(() => { if (!response.headersSent) finishResponse(response, 400); else response.end(); });
      track(call);
    });
    flow.server = server;
    server.requestTimeout = 10000;
    server.headersTimeout = 10000;
    server.keepAliveTimeout = 1000;
    await new Promise((resolve, reject) => {
      server.once('error', () => reject(safeError('无法建立本机 Google 授权回调，请稍后重试。')));
      server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, resolve);
    });
    const port = server.address().port;
    flow.host = `127.0.0.1:${port}`;
    flow.redirectUri = `http://${flow.host}/oauth2/callback`;
    if (closed) { await dropFlow(flow); throw safeError('Google 连接已关闭。'); }
    const url = new URL(AUTH_URL);
    for (const [key, value] of Object.entries({ client_id: flow.clientId, redirect_uri: flow.redirectUri, response_type: 'code', scope: GOOGLE_READ_SCOPES.join(' '), access_type: 'offline', prompt: 'consent', state: flow.state, code_challenge: createHash('sha256').update(flow.verifier).digest('base64url'), code_challenge_method: 'S256' })) url.searchParams.set(key, value);
    flow.url = url.toString();
    pending = flow;
    flow.timer = setTimeout(() => { void dropFlow(flow); }, FLOW_TTL);
    flow.timer.unref?.();
    server.unref();
    return { url: flow.url, expiresAt: new Date(flow.expiresAt).toISOString() };
  }

  async function getTokenInner({ signal } = {}) {
    requireOpen();
    if (signal?.aborted) throw safeError('Google 连接请求已取消。');
    const config = read(), key = keyOf(config);
    if (cache?.key !== key) cache = null;
    if (!configured(config) || !config.googleRefreshToken) throw safeError('Google 尚未连接，请在原生插件设置完成授权。');
    if (cache && cache.expiresAt - 30000 > now()) return cache.accessToken;
    const result = await tokenRequest({ client_id: config.googleClientId, client_secret: config.googleClientSecret, refresh_token: config.googleRefreshToken, grant_type: 'refresh_token' }, signal);
    if (closed || signal?.aborted || keyOf(read()) !== key) throw safeError('Google 连接已变化，请重新查询。');
    cache = { ...result, key };
    return result.accessToken;
  }

  return {
    status() {
      let config;
      try { config = read(); } catch { config = readContextConfig(); }
      return { clientConfigured: configured(config), refreshConfigured: Boolean(config.googleRefreshToken), authInProgress: !closed && Boolean(pending && !pending.used && now() < pending.expiresAt), ...(pending && !pending.used && now() < pending.expiresAt ? { expiresAt: new Date(pending.expiresAt).toISOString() } : {}) };
    },
    start() {
      if (!starting) {
        const call = track(startInner());
        starting = call;
        call.then(() => { if (starting === call) starting = null; }, () => { if (starting === call) starting = null; });
      }
      return starting;
    },
    getToken(options) { return track(getTokenInner(options)); },
    async close() {
      closed = true;
      cache = null;
      for (const controller of controllers) controller.abort();
      if (pending) void dropFlow(pending);
      await Promise.allSettled([...flights]);
      await Promise.allSettled([...closingServers]);
    },
  };
}
