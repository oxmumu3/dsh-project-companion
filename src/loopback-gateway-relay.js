import {randomUUID, timingSafeEqual} from 'node:crypto';
import {mkdir, readFile, rename, rm, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {join} from 'node:path';
import {createOperationLedger, validOperationId} from './operation-idempotency.js';
import {stringifyWire} from './mobile-wire.js';

const host = '127.0.0.1';
const unavailable = {ok: false, fallbackHeadless: true, error: '桌面会话服务不可用。'};
const bodyLimit = 256 * 1024;
const routes = new Map([
  ['/gateway/prompt', 'prompt'],
  ['/gateway/control', 'control'],
  ['/gateway/questions/answer', 'answer'],
  ['/gateway/schedule/create', 'schedule'],
]);

function sendJson(res, status, payload) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'});
  res.end(stringifyWire(payload));
}

function authorized(req, token) {
  if (typeof token !== 'string' || token.length < 32 || typeof req.headers.authorization !== 'string') return false;
  const expected = Buffer.from(`Bearer ${token}`);
  const received = Buffer.from(req.headers.authorization);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  let oversized = false;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > bodyLimit) oversized = true;
    if (!oversized) chunks.push(chunk);
  }
  if (oversized) throw Object.assign(new Error('请求过大。'), {status: 413});
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!body || typeof body !== 'object' || Array.isArray(body) || !validOperationId(body.operationId)) {
    throw Object.assign(new Error('请求编号无效。'), {status: 400});
  }
  return body;
}

export function createLoopbackGatewayRelay({stateDir, readBearerToken, gateway, clock = Date.now, signal} = {}) {
  const file = join(stateDir, 'desktop-gateway.json');
  const lifecycle = new AbortController();
  const operations = createOperationLedger({clock});
  let record;
  let starting;
  let closing;
  const server = createServer(async (req, res) => {
    const route = routes.get(req.url);
    const streamPrompt = route === 'prompt';
    try {
      if (lifecycle.signal.aborted) return sendJson(res, 503, unavailable);
      if (!authorized(req, await readBearerToken())) return sendJson(res, 401, {ok: false, error: '凭证已失效。'});
      if (req.method === 'GET' && req.url === '/gateway/health') {
        const health = await gateway.health?.();
        const pendingInput = health?.pendingInput ?? [];
        return sendJson(res, 200, {ok: true, version: 1, pid: process.pid, liveReady: Boolean(health && health.ok !== false && health.liveReady !== false),
          foregroundSessionId: health?.foregroundSessionId ?? null,
          pendingInput, needsInputSessionIds: health?.needsInputSessionIds ??
            [...new Set(pendingInput.map(item => item.sessionId).filter(Boolean))]});
      }
      if (!route || req.method !== 'POST') return sendJson(res, 404, {ok: false, error: '接口不存在。'});
      if (typeof gateway[route] !== 'function') return sendJson(res, 503, unavailable);
      const body = await readBody(req);
      const {operationId, ...input} = body;
      const beginStream = () => {
        if (res.headersSent || res.destroyed || res.writableEnded) return;
        res.writeHead(200, {'Content-Type': 'application/x-ndjson; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no'});
        res.flushHeaders();
      };
      const emit = frame => {
        if (res.destroyed || res.writableEnded) return;
        beginStream();
        res.write(stringifyWire(frame) + '\n');
      };
      const accepted = await operations.run(operationId, [route, input], async () => {
        const operationSignal = AbortSignal.any([lifecycle.signal, AbortSignal.timeout(streamPrompt ? 600_000 : 60_000)]);
        const admit = await gateway.preflight?.(route, input, operationSignal);
        if (admit?.ok === false) return {error: admit};
        if (operationSignal.aborted) return {error: {...unavailable, status: 503}};
        const completion = Promise.resolve()
          .then(() => gateway[route]({...input, operationId, signal: operationSignal, onEvent: streamPrompt ? emit : undefined}))
          .then(value => value ?? {ok: false, error: '桌面会话操作未完成。'})
          .catch(() => ({ok: false, error: '桌面会话操作未完成。'}));
        return {completion};
      });
      if (accepted.error) return sendJson(res, accepted.error.status ?? 409, accepted.error);
      if (!streamPrompt) return sendJson(res, 200, await accepted.completion);
      beginStream();
      const value = await accepted.completion;
      emit({...value, type: 'done'});
      res.end();
    } catch (error) {
      if (res.headersSent) return res.end();
      const status = error?.status ?? (error instanceof SyntaxError ? 400 : 500);
      return sendJson(res, status, {ok: false, error: status < 500 && !(error instanceof SyntaxError)
        ? error.message : '请求处理异常。'});
    }
  });

  async function startRelay() {
    if (lifecycle.signal.aborted) return null;
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, host, () => {server.off('error', reject); resolve();});
    });
    server.unref();
    if (lifecycle.signal.aborted) return null;
    const opened = {version: 1, pid: process.pid, host, port: server.address().port,
      updatedAt: new Date(clock()).toISOString()};
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await mkdir(stateDir, {recursive: true, mode: 0o700});
      await writeFile(temporary, JSON.stringify(opened) + '\n', {mode: 0o600, flag: 'wx'});
      if (lifecycle.signal.aborted) {
        await rm(temporary, {force: true});
        return null;
      }
      await rename(temporary, file);
      record = opened;
      return record;
    } catch (error) {
      await rm(temporary, {force: true}).catch(() => {});
      await new Promise(resolve => server.close(resolve));
      throw error;
    }
  }

  function start() {
    return starting ??= startRelay();
  }

  function dispose() {
    if (closing) return closing;
    lifecycle.abort();
    signal?.removeEventListener('abort', dispose);
    closing = (async () => {
      await starting?.catch(() => {});
      if (server.listening) {
        const closed = new Promise(resolve => server.close(resolve));
        server.closeAllConnections();
        await closed;
      }
      operations.clear();
      if (record) {
        // A newer plugin instance may already own the discovery file.
        const current = await readFile(file, 'utf8').catch(() => null);
        if (current === JSON.stringify(record) + '\n') await rm(file, {force: true});
      }
    })();
    return closing;
  }

  if (signal?.aborted) void dispose();
  else signal?.addEventListener('abort', dispose, {once: true});
  return {start, dispose};
}
