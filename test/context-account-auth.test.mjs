import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const module = await import('../src/context-account-auth.js').catch(() => null);
const requireModule = () => assert.equal(typeof module?.createContextAccountAuth, 'function', 'account login owner must exist');
const initial = () => ({ flomoOAuthCredentials: '', didaOAuthCredentials: '', flomoToken: '', didaToken: '' });
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
const token = (patch = {}) => ({ access_token: 'fixture-access', refresh_token: 'fixture-refresh', expires_in: 3600, token_type: 'Bearer', scope: 'mcp', ...patch });
function callback(started, patch = {}) {
  const auth = new URL(started.url), url = new URL(auth.searchParams.get('redirect_uri'));
  url.searchParams.set('state', patch.state ?? auth.searchParams.get('state'));
  url.searchParams.set('code', patch.code ?? 'fixture-code');
  if (patch.issuer) url.searchParams.set('iss', patch.issuer);
  return url;
}
function fixture(source = 'flomo', options = {}) {
  requireModule();
  const config = initial(), saved = [], requests = [], guards = [];
  let now = 1_800_000_000_000;
  const auth = module.createContextAccountAuth({ source, readConfig: () => ({ ...config }), clock: () => now,
    saveCredentials: async (value, guard) => {
      guards.push(guard);
      await options.beforeSave?.();
      await guard.authorizeMutation();
      if (config[source + 'OAuthCredentials'] !== guard.expectedValue || config[source + 'Token'] !== guard.expectedLegacy) throw new Error('fixture compare-and-set rejected');
      saved.push(value); config[source + 'OAuthCredentials'] = value;
    },
    fetch: async (url, init) => {
      requests.push({ url, init });
      return url.endsWith('/register') ? json({ client_id: 'fixture-client', token_endpoint_auth_method: 'none' }, 201) : json(token({ scope: source === 'dida' ? 'tasks:read' : 'mcp' }));
    }, ...options,
  });
  return { auth, saved, requests, guards, config, set: patch => Object.assign(config, patch), now: value => { now = value; } };
}

test('account connection registers only on explicit start, uses pinned issuers, loopback and S256 PKCE', async () => {
  for (const source of ['flomo', 'dida']) {
    const f = fixture(source);
    try {
      assert.equal(f.requests.length, 0);
      assert.deepEqual(f.auth.status(), { clientConfigured: true, refreshConfigured: false, authInProgress: false });
      const [started, duplicate] = await Promise.all([f.auth.start(), f.auth.start()]);
      assert.deepEqual(started, duplicate);
      assert.equal(f.requests.length, 1);
      const request = f.requests[0], registration = JSON.parse(request.init.body), auth = new URL(started.url);
      assert.equal(request.url, source === 'flomo' ? 'https://flomoapp.com/oauth/register' : 'https://api.dida365.com/oauth/register');
      assert.equal(request.init.redirect, 'error');
      assert.equal(registration.token_endpoint_auth_method, 'none');
      assert.deepEqual(registration.response_types, ['code']);
      assert.equal(new URL(registration.redirect_uris[0]).hostname, '127.0.0.1');
      assert.equal(auth.searchParams.get('redirect_uri'), registration.redirect_uris[0]);
      assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');
      assert.equal(auth.searchParams.get('scope'), source === 'flomo' ? 'mcp' : 'tasks:read');
      assert.equal(auth.searchParams.get('resource'), source === 'flomo' ? 'https://flomoapp.com/mcp' : 'https://mcp.dida365.com/');
      assert.doesNotMatch(JSON.stringify(f.auth.status()), /fixture-|client_id|code_challenge|state=/);
    } finally { await f.auth.close(); }
  }
});

test('valid callback stores own OAuth credentials and only consumes the code once', async () => {
  const f = fixture();
  try {
    const started = await f.auth.start();
    assert.equal((await fetch(callback(started, { state: 'wrong' }))).status, 400);
    assert.equal(f.requests.length, 1);
    const response = await fetch(callback(started));
    assert.equal(response.status, 200);
    assert.doesNotMatch(await response.text(), /fixture-|access_token|refresh_token/);
    assert.equal(f.saved.length, 1);
    const stored = JSON.parse(f.saved[0]);
    assert.equal(stored.clientId, 'fixture-client');
    assert.equal(stored.refreshToken, 'fixture-refresh');
    const request = f.requests[1], body = new URLSearchParams(request.init.body);
    assert.equal(request.url, 'https://flomoapp.com/oauth/token');
    assert.equal(body.get('grant_type'), 'authorization_code');
    assert.equal(createHash('sha256').update(body.get('code_verifier')).digest('base64url'), new URL(started.url).searchParams.get('code_challenge'));
    assert.equal(body.has('client_secret'), false);
    assert.equal(await f.auth.getToken(), 'fixture-access');
    assert.equal(f.requests.length, 2);
    assert.equal(f.auth.status().refreshConfigured, true);
    await assert.rejects(fetch(callback(started)));
    assert.equal(f.saved.length, 1);
  } finally { await f.auth.close(); }
});

test('OAuth credentials survive a restart, refresh at pinned endpoint and persist rotating refresh tokens', async () => {
  const f = fixture();
  f.set({ flomoOAuthCredentials: JSON.stringify({ version: 1, source: 'flomo', connectionId: 'fixture-connection', clientId: 'fixture-client', accessToken: 'old-access', refreshToken: 'old-refresh', expiresAt: 1, scope: 'mcp' }) });
  try {
    assert.equal(await f.auth.getToken(), 'fixture-access');
    const body = new URLSearchParams(f.requests[0].init.body);
    assert.equal(body.get('grant_type'), 'refresh_token');
    assert.equal(body.get('refresh_token'), 'old-refresh');
    assert.equal(body.get('resource'), 'https://flomoapp.com/mcp');
    assert.equal(JSON.parse(f.saved[0]).refreshToken, 'fixture-refresh');
  } finally { await f.auth.close(); }
});

test('Dida only requests read permission and access-only expiry requires explicit reconnect', async () => {
  const f = fixture('dida', { fetch: async url => url.endsWith('/register') ? json({ client_id: 'fixture-client', token_endpoint_auth_method: 'none' }, 201) : json(token({ refresh_token: undefined, scope: 'tasks:read' })) });
  try {
    const started = await f.auth.start();
    assert.equal((await fetch(callback(started, { issuer: 'https://dida365.com' }))).status, 200);
    assert.equal(await f.auth.getToken(), 'fixture-access');
    f.now(1_800_003_600_001);
    await assert.rejects(f.auth.getToken(), /重新连接|重新授权/);
    assert.equal(f.auth.status().refreshConfigured, false);
  } finally { await f.auth.close(); }
});

test('manual tokens remain a compatibility path only while OAuth credentials are empty', async () => {
  const f = fixture();
  try {
    f.set({ flomoToken: 'fixture-manual' });
    assert.equal(await f.auth.getToken(), 'fixture-manual');
    assert.equal(f.requests.length, 0);
    f.set({ flomoOAuthCredentials: 'invalid-private-json' });
    await assert.rejects(f.auth.getToken(), error => /重新连接|重新授权/.test(error.message) && !/invalid-private-json/.test(error.message));
    assert.equal(f.requests.length, 0);
  } finally { await f.auth.close(); }
});

test('wrong callback issuer, duplicate state, expired flow and changed config never exchange code', async () => {
  const f = fixture();
  try {
    const started = await f.auth.start();
    assert.equal((await fetch(callback(started, { issuer: 'https://attacker.invalid' }))).status, 400);
    const repeated = callback(started); repeated.searchParams.append('state', 'extra');
    assert.equal((await fetch(repeated)).status, 400);
    f.set({ flomoToken: 'changed-native-config' });
    assert.equal((await fetch(callback(started))).status, 400);
    assert.equal(f.requests.length, 1);
    assert.equal(f.saved.length, 0);
    const next = await f.auth.start();
    f.now(1_800_000_300_001);
    assert.equal((await fetch(callback(next))).status, 400);
    assert.equal(f.requests.length, 2);
  } finally { await f.auth.close(); }
});

test('credential writer failure, unsupported registration and excessive scopes never report connected', async () => {
  for (const options of [
    { saveCredentials: async () => { throw new Error('fixture-private-storage-error'); } },
    { fetch: async () => json({ client_id: 'fixture-client', token_endpoint_auth_method: 'client_secret_basic', client_secret: 'fixture-secret' }, 201) },
    { fetch: async url => url.endsWith('/register') ? json({ client_id: 'fixture-client', token_endpoint_auth_method: 'none' }, 201) : json(token({ scope: 'tasks:read tasks:write' })) },
  ]) {
    const f = fixture('dida', options);
    try {
      let started;
      try { started = await f.auth.start(); } catch (error) { assert.doesNotMatch(error.message, /fixture-/); }
      if (started) {
        const response = await fetch(callback(started));
        assert.equal(response.status, 400);
        assert.doesNotMatch(await response.text(), /fixture-|access_token|refresh_token/);
      }
      assert.equal(f.auth.status().refreshConfigured, false);
      assert.equal(f.saved.length, 0);
    } finally { await f.auth.close(); }
  }
});

test('close cancels non-cooperating registration requests without hanging or leaving loopback listener', async () => {
  let entered;
  const began = new Promise(resolve => { entered = resolve; });
  const f = fixture('flomo', { fetch: async () => { entered(); return await new Promise(() => {}); } });
  const started = f.auth.start();
  const rejected = assert.rejects(started, error => !/fixture-/.test(error.message));
  await began;
  await f.auth.close();
  await rejected;
  assert.equal(f.auth.status().authInProgress, false);
  await assert.rejects(f.auth.start(), /关闭/);
});

test('configuration rotation discards late refresh and authorization responses before persistence', async () => {
  for (const stage of ['refresh', 'callback']) {
    let entered, release;
    const began = new Promise(resolve => { entered = resolve; });
    const f = fixture('flomo', { fetch: async url => {
      if (url.endsWith('/register')) return json({ client_id: 'fixture-client', token_endpoint_auth_method: 'none' }, 201);
      entered(); return await new Promise(resolve => { release = () => resolve(json(token())); });
    } });
    try {
      let request;
      if (stage === 'refresh') {
        f.set({ flomoOAuthCredentials: JSON.stringify({ version: 1, source: 'flomo', connectionId: 'fixture-connection', clientId: 'fixture-client', accessToken: 'old-access', refreshToken: 'old-refresh', expiresAt: 1, scope: 'mcp' }) });
        request = assert.rejects(f.auth.getToken());
      } else request = fetch(callback(await f.auth.start()));
      await began;
      f.set({ flomoToken: 'rotated-native-config' }); release();
      const result = await request;
      if (stage === 'callback') assert.equal(result.status, 400);
      assert.equal(f.saved.length, 0);
    } finally { release?.(); await f.auth.close(); }
  }
});

test('source lease identity survives normal token refresh but changes on reconnect and invalid OAuth fails closed', () => {
  requireModule();
  assert.equal(typeof module.contextAccountCredentialState, 'function');
  const credential = { version: 1, source: 'flomo', connectionId: 'fixture-connection', clientId: 'fixture-client', accessToken: 'old-access', refreshToken: 'old-refresh', expiresAt: 1, scope: 'mcp' };
  const state = value => module.contextAccountCredentialState('flomo', { flomoOAuthCredentials: JSON.stringify(value), flomoToken: 'manual-token' }, 1000);
  assert.equal(state(credential).configured, true);
  assert.equal(state(credential).key, state({ ...credential, accessToken: 'new-access', refreshToken: 'new-refresh', expiresAt: 9000 }).key);
  assert.notEqual(state(credential).key, state({ ...credential, connectionId: 'other-connection' }).key);
  assert.equal(state({ ...credential, source: 'dida' }).configured, false);
  assert.equal(module.contextAccountCredentialState('dida', { didaOAuthCredentials: JSON.stringify({ ...credential, source: 'dida', scope: 'tasks:read', refreshToken: '' }) }, 1000).configured, false);
});

test('close interrupts an unresponsive native credential writer and never reports authorization success', { timeout: 1000 }, async () => {
  let entered;
  const began = new Promise(resolve => { entered = resolve; });
  const f = fixture('flomo', { saveCredentials: async () => { entered(); return await new Promise(() => {}); } });
  const started = await f.auth.start();
  const response = fetch(callback(started));
  await began;
  await f.auth.close();
  assert.equal((await response).status, 400);
  assert.equal(f.auth.status().refreshConfigured, false);
});

test('revoked owner authorization rejects the callback before exchanging the code', async () => {
  let authorized = true;
  const f = fixture();
  try {
    const started = await f.auth.start({ authorizeMutation: async () => authorized });
    authorized = false;
    assert.equal((await fetch(callback(started))).status, 400);
    assert.equal(f.requests.length, 1, 'no code exchange after the original owner loses the binding');
    assert.equal(f.saved.length, 0);
  } finally { await f.auth.close(); }
});

test('native writer compare-and-set prevents a pending authorization from overwriting cleared or replaced credentials', async () => {
  for (const replacement of ['', 'replacement-native-credentials']) {
    let entered, release;
    const began = new Promise(resolve => { entered = resolve; });
    const f = fixture('flomo', { beforeSave: async () => { entered(); await new Promise(resolve => { release = resolve; }); } });
    f.set({ flomoOAuthCredentials: 'old-native-credentials' });
    try {
      const response = fetch(callback(await f.auth.start()));
      await began;
      assert.equal(f.guards[0]?.expectedValue, 'old-native-credentials');
      assert.equal(f.guards[0]?.expectedLegacy, '');
      f.set({ flomoOAuthCredentials: replacement }); release();
      assert.equal((await response).status, 400);
      assert.equal(f.config.flomoOAuthCredentials, replacement);
      assert.equal(f.saved.length, 0);
    } finally { release?.(); await f.auth.close(); }
  }
});

test('owner revalidation inside the compliant writer blocks a late callback and refresh credential commit', async () => {
  for (const stage of ['callback', 'refresh']) {
    let entered, release, authorized = true;
    const began = new Promise(resolve => { entered = resolve; });
    const f = fixture('flomo', { beforeSave: async () => { entered(); await new Promise(resolve => { release = resolve; }); } });
    const authorizeMutation = async () => authorized;
    try {
      let request;
      if (stage === 'callback') request = fetch(callback(await f.auth.start({ authorizeMutation })));
      else {
        f.set({ flomoOAuthCredentials: JSON.stringify({ version: 1, source: 'flomo', connectionId: 'fixture-connection', clientId: 'fixture-client', accessToken: 'old-access', refreshToken: 'old-refresh', expiresAt: 1, scope: 'mcp' }) });
        request = assert.rejects(f.auth.getToken({ authorizeMutation }));
      }
      await began;
      assert.equal(typeof f.guards[0]?.authorizeMutation, 'function');
      const before = f.config.flomoOAuthCredentials;
      authorized = false; release();
      const result = await request;
      if (stage === 'callback') assert.equal(result.status, 400);
      assert.equal(f.saved.length, 0);
      assert.equal(f.config.flomoOAuthCredentials, before);
    } finally { release?.(); await f.auth.close(); }
  }
});

for (const source of ['flomo', 'dida']) {
  test(`${source} matching denial ends authorization and allows an immediate fresh retry`, async () => {
    const f = fixture(source);
    try {
      const first = await f.auth.start(), denied = callback(first);
      denied.searchParams.delete('code'); denied.searchParams.set('error', 'access_denied');
      assert.equal((await fetch(denied)).status, 400);
      assert.equal(f.auth.status().authInProgress, false);
      assert.equal(f.requests.length, 1, 'denial must not exchange a code');
      assert.equal(f.saved.length, 0);
      const next = await f.auth.start();
      assert.notEqual(next.url, first.url);
      assert.equal(f.auth.status().authInProgress, true);
    } finally { await f.auth.close(); }
  });

  test(`${source} unverified or ambiguous denial cannot cancel authorization`, async () => {
    const f = fixture(source);
    try {
      const first = await f.auth.start();
      for (const kind of ['wrong-state', 'duplicate-error', 'code-and-error', 'foreign-issuer']) {
        const denied = callback(first);
        denied.searchParams.set('error', 'access_denied');
        if (kind !== 'code-and-error') denied.searchParams.delete('code');
        if (kind === 'wrong-state') denied.searchParams.set('state', 'wrong');
        if (kind === 'duplicate-error') denied.searchParams.append('error', 'another');
        if (kind === 'foreign-issuer') denied.searchParams.set('iss', 'https://example.invalid');
        assert.equal((await fetch(denied)).status, 400);
        assert.equal(f.auth.status().authInProgress, true);
      }
      assert.equal(f.requests.length, 1);
      assert.equal(f.saved.length, 0);
    } finally { await f.auth.close(); }
  });

  for (const stage of ['token exchange', 'credential save']) {
    test(`${source} stays in progress during a slow ${stage}`, async () => {
      let enter, release, response;
      const began = new Promise(resolve => { enter = resolve; });
      const held = new Promise(resolve => { release = resolve; });
      const options = stage === 'token exchange' ? {
        fetch: async url => {
          if (url.endsWith('/register')) return json({ client_id: 'fixture-client', token_endpoint_auth_method: 'none' });
          enter(); await held;
          return json(token({ scope: source === 'dida' ? 'tasks:read' : 'mcp' }));
        },
      } : { beforeSave: async () => { enter(); await held; } };
      const f = fixture(source, options);
      try {
        response = fetch(callback(await f.auth.start()));
        await began;
        assert.equal(f.auth.status().authInProgress, true);
        assert.equal(f.auth.status().refreshConfigured, false);
        assert.equal(f.saved.length, 0);
        release();
        assert.equal((await response).status, 200);
        assert.equal(f.auth.status().authInProgress, false);
        assert.equal(f.auth.status().refreshConfigured, true);
        assert.equal(f.saved.length, 1);
      } finally { release(); await response?.catch(() => {}); await f.auth.close(); }
    });
  }
}
