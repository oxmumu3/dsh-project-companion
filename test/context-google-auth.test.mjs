import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const configModule = await import('../src/context-config.js').catch(() => null);
const authModule = await import('../src/context-google-auth.js').catch(() => null);
const requireModules = () => {
  assert.equal(typeof configModule?.readContextConfig, 'function', 'native secret config reader must exist');
  assert.equal(typeof authModule?.createGoogleAuth, 'function', 'Google OAuth owner must exist');
};
const initial = () => ({ flomoToken: '', didaToken: '', flomoOAuthCredentials: '', didaOAuthCredentials: '', googleCalendarOAuthCredentials: '', googleSuiteOAuthCredentials: '', googleClientId: 'fixture.apps.googleusercontent.com', googleClientSecret: 'fixture-client-secret', googleRefreshToken: '' });
const tokenResponse = (extra = {}) => new Response(JSON.stringify({ access_token: 'fixture-access', refresh_token: 'fixture-refresh', expires_in: 3600, token_type: 'Bearer', scope: authModule.GOOGLE_READ_SCOPES.join(' '), ...extra }), { status: 200 });
function callback(url, override = {}) {
  const auth = new URL(url);
  const target = new URL(auth.searchParams.get('redirect_uri'));
  target.searchParams.set('state', override.state ?? auth.searchParams.get('state'));
  target.searchParams.set('code', override.code ?? 'fixture-code');
  return target;
}
function fixture(options = {}) {
  requireModules();
  let config = initial();
  let now = 1_800_000_000_000;
  const saved = [], requests = [];
  const auth = authModule.createGoogleAuth({
    readConfig: () => ({ ...config }),
    saveRefreshToken: async (token) => { saved.push(token); config.googleRefreshToken = token; },
    fetch: async (url, init) => { requests.push({ url, init }); return tokenResponse(); },
    clock: () => now,
    ...options,
  });
  return { auth, saved, requests, config, now: (value) => { now = value; }, set: (patch) => Object.assign(config, patch) };
}

test('native Config keeps live credential fields separate from normal Dot appearance', () => {
  requireModules();
  const schema = configModule.Config;
  assert.deepEqual(Object.keys(schema.dict).sort(), [...Object.keys(initial()),'dotAppearance'].sort());
  for (const key of Object.keys(initial())) {
    const value=schema.dict[key];
    assert.equal(value.meta.volatile, true);
    assert.equal(value.meta.role, key === 'googleClientId' ? undefined : 'secret');
  }
  assert.equal(schema.dict.dotAppearance.meta.default,'native');
  assert.notEqual(schema.dict.dotAppearance.meta.role,'secret');
  assert.equal(schema.dict.dotAppearance.meta.volatile,true,'changing only appearance must not restart the running backend');
  assert.deepEqual(configModule.readContextConfig({...initial(),dotAppearance:'dot'}),initial());
  const refs = Object.fromEntries(Object.entries(initial()).map(([key, value]) => [key, { get: () => value }]));
  assert.deepEqual(configModule.readContextConfig(refs), initial());
  assert.deepEqual(Object.keys(configModule.readContextConfig({ ...initial(), unrelated: 'ignored' })).sort(), Object.keys(initial()).sort());
});

test('OAuth requests fixed Google authorization, seven read scopes, offline access and S256 PKCE', async () => {
  const f = fixture();
  try {
    const result = await f.auth.start();
    const url = new URL(result.url), redirect = new URL(url.searchParams.get('redirect_uri'));
    assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
    assert.equal(url.searchParams.get('access_type'), 'offline');
    assert.equal(url.searchParams.get('prompt'), 'consent');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.deepEqual(url.searchParams.get('scope').split(' '), authModule.GOOGLE_READ_SCOPES);
    assert.equal(redirect.hostname, '127.0.0.1');
    assert.equal(redirect.pathname, '/oauth2/callback');
    assert.ok(Number(redirect.port) > 0);
    assert.equal(result.expiresAt, new Date(1_800_000_300_000).toISOString());
    const state = f.auth.status();
    assert.equal(state.authInProgress, true);
    assert.doesNotMatch(JSON.stringify(state), /fixture-client-secret|fixture-code|code_challenge|state=/);
  } finally { await f.auth.close(); }
});

test('exact loopback callback validates state, persists refresh token once, and does not echo secrets', async () => {
  const f = fixture();
  try {
    const started = await f.auth.start();
    const wrong = await fetch(callback(started.url, { state: 'wrong' }));
    assert.equal(wrong.status, 400);
    assert.equal(f.requests.length, 0);
    const unrelated = callback(started.url); unrelated.pathname = '/wrong';
    assert.equal((await fetch(unrelated)).status, 404);
    const res = await fetch(callback(started.url));
    assert.equal(res.status, 200);
    assert.doesNotMatch(await res.text(), /fixture-|access_token|refresh_token/);
    assert.deepEqual(f.saved, ['fixture-refresh']);
    assert.equal(f.requests.length, 1);
    const request = f.requests[0];
    assert.equal(request.url, 'https://oauth2.googleapis.com/token');
    assert.equal(request.init.redirect, 'error');
    const body = new URLSearchParams(request.init.body);
    assert.equal(body.get('grant_type'), 'authorization_code');
    assert.equal(createHash('sha256').update(body.get('code_verifier')).digest('base64url'), new URL(started.url).searchParams.get('code_challenge'));
    assert.equal(await f.auth.getToken({ signal: new AbortController().signal }), 'fixture-access');
    assert.equal(f.requests.length, 1, 'successful authorization access token may be reused');
    assert.equal(f.auth.status().authInProgress, false);
    await assert.rejects(fetch(callback(started.url)));
    assert.equal(f.saved.length, 1);
  } finally { await f.auth.close(); }
});

test('OAuth expires after five minutes and never exchanges an expired code', async () => {
  const f = fixture();
  try {
    const started = await f.auth.start();
    f.now(1_800_000_300_001);
    assert.equal((await fetch(callback(started.url))).status, 400);
    assert.equal(f.requests.length, 0);
    assert.equal(f.auth.status().authInProgress, false);
  } finally { await f.auth.close(); }
});

test('failure to persist credentials never reports successful connection or retains access', async () => {
  const f = fixture({ saveRefreshToken: async () => { throw new Error('sensitive-fixture-store-error'); } });
  try {
    const started = await f.auth.start();
    const res = await fetch(callback(started.url));
    assert.equal(res.status, 400);
    assert.doesNotMatch(await res.text(), /sensitive-fixture|fixture-access|fixture-refresh/);
    assert.equal(f.auth.status().refreshConfigured, false);
    await assert.rejects(f.auth.getToken({ signal: new AbortController().signal }), /未连接|not configured/);
  } finally { await f.auth.close(); }
});

test('refresh is fixed-endpoint, bounded-cache and invalidated immediately by config changes', async () => {
  const f = fixture();
  f.set({ googleRefreshToken: 'old-refresh' });
  try {
    assert.equal(await f.auth.getToken({ signal: new AbortController().signal }), 'fixture-access');
    assert.equal(new URLSearchParams(f.requests[0].init.body).get('grant_type'), 'refresh_token');
    assert.equal(new URLSearchParams(f.requests[0].init.body).get('refresh_token'), 'old-refresh');
    f.now(1_800_000_060_000);
    await f.auth.getToken({ signal: new AbortController().signal });
    assert.equal(f.requests.length, 1);
    f.set({ googleRefreshToken: 'rotated-refresh' });
    await f.auth.getToken({ signal: new AbortController().signal });
    assert.equal(f.requests.length, 2);
    assert.equal(new URLSearchParams(f.requests[1].init.body).get('refresh_token'), 'rotated-refresh');
    f.now(1_800_003_660_001);
    await f.auth.getToken({ signal: new AbortController().signal });
    assert.equal(f.requests.length, 3);
  } finally { await f.auth.close(); }
});

test('cancel and close abort active network calls and discard cached or late access tokens', async () => {
  let entered;
  const began = new Promise((resolve) => { entered = resolve; });
  const f = fixture({ fetch: async (_url, options) => { entered(); return await new Promise((_resolve, reject) => { options.signal.addEventListener('abort', () => reject(new Error('fixture-network-abort-secret')), { once: true }); }); } });
  f.set({ googleRefreshToken: 'fixture-refresh' });
  const controller = new AbortController();
  const request = f.auth.getToken({ signal: controller.signal });
  await began;
  controller.abort();
  await assert.rejects(request, (error) => !error.message.includes('fixture-network-abort-secret'));
  const request2 = f.auth.getToken({ signal: new AbortController().signal });
  const rejected = assert.rejects(request2);
  await f.auth.close();
  await rejected;
  assert.equal(f.auth.status().authInProgress, false);
  await assert.rejects(f.auth.start(), /关闭|closed/);
});

test('missing native credential writer and missing client credentials fail closed without network', async () => {
  requireModules();
  let requests = 0;
  const auth = authModule.createGoogleAuth({ readConfig: () => initial(), fetch: async () => { requests++; return tokenResponse(); } });
  await assert.rejects(auth.start(), /保存|store|writer/);
  assert.equal(requests, 0);
  await auth.close();
  const f = fixture();
  f.set({ googleClientSecret: '' });
  await assert.rejects(f.auth.start(), /配置|configured/);
  assert.equal(f.requests.length, 0);
  await f.auth.close();
});

test('config reference failures are redacted before leaving the credential reader', () => {
  requireModules();
  assert.throws(() => configModule.readContextConfig({ googleClientSecret: { get() { throw new Error('fixture-secret-in-getter'); } } }), (error) => !error.message.includes('fixture-secret'));
});

test('parallel duplicate callbacks consume the authorization code only once', async () => {
  let release, entered;
  const waiting = new Promise((resolve) => { entered = resolve; });
  const f = fixture({ fetch: async () => { entered(); return await new Promise((resolve) => { release = () => resolve(tokenResponse()); }); } });
  try {
    const started = await f.auth.start();
    const first = fetch(callback(started.url));
    await waiting;
    const duplicate = await fetch(callback(started.url));
    assert.equal(duplicate.status, 400);
    release();
    assert.equal((await first).status, 200);
    assert.equal(f.saved.length, 1);
  } finally { release?.(); await f.auth.close(); }
});

test('configuration changes during authorization reject the stale callback before credential persistence', async () => {
  let release, entered;
  const waiting = new Promise((resolve) => { entered = resolve; });
  const f = fixture({ fetch: async () => { entered(); return await new Promise((resolve) => { release = () => resolve(tokenResponse()); }); } });
  try {
    const started = await f.auth.start();
    const first = fetch(callback(started.url));
    await waiting;
    f.set({ googleClientSecret: 'rotated-client-secret' });
    release();
    assert.equal((await first).status, 400);
    assert.equal(f.saved.length, 0);
    assert.equal(f.auth.status().refreshConfigured, false);
  } finally { release?.(); await f.auth.close(); }
});

test('refresh responses arriving after config rotation are discarded instead of cached', async () => {
  let release, entered;
  const waiting = new Promise((resolve) => { entered = resolve; });
  const f = fixture({ fetch: async () => { entered(); return await new Promise((resolve) => { release = () => resolve(tokenResponse()); }); } });
  f.set({ googleRefreshToken: 'old-refresh' });
  try {
    const request = f.auth.getToken({ signal: new AbortController().signal });
    const rejected = assert.rejects(request, /变化/);
    await waiting;
    f.set({ googleRefreshToken: 'rotated-refresh' });
    release();
    await rejected;
  } finally { release?.(); await f.auth.close(); }
});

test('partial permissions, redirected requests and upstream errors cannot expose OAuth secrets', async () => {
  const f = fixture({ fetch: async () => tokenResponse({ scope: 'https://www.googleapis.com/auth/gmail.readonly' }) });
  try {
    const started = await f.auth.start();
    const response = await fetch(callback(started.url));
    assert.equal(response.status, 400);
    assert.equal(f.saved.length, 0);
    assert.doesNotMatch(await response.text(), /fixture-|access_token|refresh_token|scope=/);
  } finally { await f.auth.close(); }
  const g = fixture({ fetch: async () => { throw new Error('client_secret=fixture-secret-upstream'); } });
  g.set({ googleRefreshToken: 'fixture-refresh' });
  try { await assert.rejects(g.auth.getToken({ signal: new AbortController().signal }), (error) => !error.message.includes('fixture-secret')); }
  finally { await g.auth.close(); }
});
