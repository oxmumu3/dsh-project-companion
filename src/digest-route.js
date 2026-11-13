/**
 * Owner-authenticated explicit UI action for the daily digest.
 *
 * The tool surface can read the digest status for the owner, but it has no
 * trusted "the human clicked this" signal. Manual sending therefore lives on
 * this same-origin, already-bound owner connection route. Ordinary sessions
 * cannot call it; the bound WeChat owner session and the desktop foreground
 * still use the `look view=digest` tool for read-back.
 */
import {bindingRevision,matchesBindingRevision} from './workbench-scope.js';

const bound = value => value?.state === 'bound' && typeof value.sessionId === 'string' && value.sessionId.length > 0 && value.sessionId.length <= 200 && /^[a-f0-9]{64}$/.test(value.bindingKey ?? '');
const invalid = () => { throw Object.assign(new Error('DIGEST_UI_ONLY'), {code: 'DIGEST_UI_ONLY'}); };

export function createDigestRoute({digest, readConnection, readOwner, canRun = async () => true, isClosed = () => false} = {}) {
  if (typeof digest?.view !== 'function' || typeof digest?.manual !== 'function' || typeof readConnection !== 'function' || typeof readOwner !== 'function') throw new Error('Digest route needs a digest and owner connection readers');
  const current = async () => { try { return await readConnection(); } catch { return {state: 'unknown'}; } };
  async function authorize(input) {
    if (isClosed()) invalid();
    if (!input || typeof input !== 'object' || Array.isArray(input)) invalid();
    const connection = await current();
    if (!bound(connection) || typeof input.expectedBindingRevision !== 'string' || !matchesBindingRevision(input, connection)) invalid();
    if (!await canRun()) invalid();
    const owner = await readOwner();
    if (isClosed() || !owner || owner.sessionId !== connection.sessionId || owner.setupBindingKey !== connection.bindingKey) invalid();
    return owner;
  }
  return {
    async view(input) { await authorize(input); return digest.view(); },
    async run(input) { return digest.manual({owner: await authorize(input)}); },
    async probe(input) { await authorize(input); return digest.probe(); },
    async bindingRevision() { const connection = await current(); return bound(connection) ? bindingRevision(connection) : null; },
  };
}

export function registerDigestRoute(ctx, adapter) {
  const connection = ctx.get('connection');
  if (typeof connection?.fetch?.register !== 'function') return null;
  const json = (value, status = 200) => Response.json(value, {status, headers: {'Cache-Control': 'no-store'}});
  const stop = connection.fetch.register({
    path: '/api/project_companion/digest',
    methods: ['POST'],
    requestBody: 'buffered',
    async fetch(request) {
      try {
        if (request.method !== 'POST') return json({error: '不支持此方法。'}, 405);
        if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return json({error: '请使用 JSON 请求。'}, 415);
        const length = request.headers.get('Content-Length');
        if (length && (!/^\d+$/.test(length) || Number(length) > 1024)) return json({error: '请求过大。'}, 413);
        const body = await request.text();
        if (Buffer.byteLength(body) > 1024) return json({error: '请求过大。'}, 413);
        const input = JSON.parse(body);
        if (!input || typeof input !== 'object' || Array.isArray(input)) return json({error: '未完成。'}, 400);
        if (input.action === 'view') return json(await adapter.view(input));
        if (input.action === 'run') return json(await adapter.run(input));
        if (input.action === 'probe') return json(await adapter.probe(input));
        return json({error: '不支持此动作。'}, 400);
      } catch (error) {
        const code = error?.code === 'DIGEST_UI_ONLY' ? 'DIGEST_UI_ONLY' : 'DIGEST_ROUTE_FAILED';
        return json({code, error: code === 'DIGEST_UI_ONLY' ? '需要已绑定的本人界面动作；未执行。' : '未完成；未自动重试。'}, code === 'DIGEST_UI_ONLY' ? 403 : 400);
      }
    },
  });
  if (typeof stop === 'function' && typeof ctx.effect === 'function') ctx.effect(() => stop);
  return stop;
}
