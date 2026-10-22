import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const endpoint = '/api/project_companion/context';
const ids = ['gmail', 'calendar', 'drive', 'docs', 'sheets', 'slides', 'dida', 'flomo'];
const snapshot = () => ({ sources: ids.map(id => ({ id, name: id, configured: id === 'flomo', enabled: false, status: id === 'flomo' ? 'disabled' : 'needs_authorization', lastReadAt: null })), googleAuth: { clientConfigured: true, refreshConfigured: false, authInProgress: false }, googleSuiteAuth: { clientConfigured: true, refreshConfigured: false, authInProgress: false, grantedSources: [] } });
const nodes = (tree, predicate) => {
  const found = [];
  const visit = node => { if (!node || typeof node !== 'object') return; if (predicate(node)) found.push(node); for (const child of node.children ?? []) visit(child); };
  visit(tree); return found;
};
const text = tree => { let out = ''; const visit = node => { if (typeof node === 'string' || typeof node === 'number') out += `${node} `; else for (const child of node?.children ?? []) visit(child); }; visit(tree); return out; };

async function load(options = {}) {
  const source = await readFile(new URL('../src/client.js', import.meta.url), 'utf8');
  const intervals = new Map(), external = []; let intervalId = 0;
  const registrations = [], effects = [], requests = [], opened = [], configRequests = [], configNames = [], configListeners = new Set();
  let definition, values = [], cursor = 0, pending = [];
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat().filter(x => x !== null && x !== undefined && x !== false) }),
    useState: initial => { const frame = values, i = cursor++; if (!(i in frame)) frame[i] = typeof initial === 'function' ? initial() : initial; return [frame[i], next => { frame[i] = typeof next === 'function' ? next(frame[i]) : next; }]; },
    useRef: initial => { const i = cursor++; if (!(i in values)) values[i] = { current: initial }; return values[i]; },
    useEffect: (fn, deps) => { const frame = values, i = cursor++, old = frame[i]; if (!old || !deps || deps.some((x, j) => x !== old.deps[j])) { old?.cleanup?.(); frame[i] = { deps }; pending.push(() => { frame[i].cleanup = fn(); }); } },
  };
  const context = { window: { __ModuleLoader__: { load: d => { definition = d; } }, open: (...args) => { external.push(args); return null; } }, AbortController, AbortSignal, Response, URL, setInterval: fn => { intervals.set(++intervalId, fn); return intervalId; }, clearInterval: id => intervals.delete(id), fetch: async (url, options = {}) => { requests.push({ url, options }); return context.onFetch ? context.onFetch(url, options) : Response.json(context.snapshot); }, snapshot: snapshot() };
  vm.runInNewContext(source, context);
  const primitives = { Modal: 'modal', SettingsForm: 'native-form', SettingsSecretField: 'native-secret', SettingsValueField: 'native-value' };
  const module = definition.factory(name => name === 'react' ? React : primitives);
  context.formSnapshot = { status: 'ready', writable: true, revision: 7, value: { googleClientId: 'public-native-client-id' }, base: {}, user: {} };
  const form = { getSnapshot: () => context.formSnapshot, subscribe: fn => { configListeners.add(fn); return () => configListeners.delete(fn); }, mutate: async (ops, revision) => { configRequests.push({ ops: structuredClone(ops), revision }); context.formSnapshot = { ...context.formSnapshot, revision: context.formSnapshot.revision + 1 }; for (const fn of configListeners) fn(); return true; } };
  const configForms = options.native ? { get: namespace => { configNames.push(namespace); return form; } } : undefined;
  module.apply({ configForms, effect: fn => effects.push(fn()), slots: { inject: (_name, fn) => fn(), register: (spec, component) => { registrations.push({ spec, component }); return () => {}; } }, uiWorkspace: { openSession: id => opened.push(id) } });
  const section = registrations.find(r => r.spec.name === 'settings.section').component({});
  const panel = nodes(section, n => typeof n.type === 'function' && n.type.name === 'ContextPanel')[0];
  assert.ok(panel, 'settings must contain an independent ContextPanel');
  pending = []; values = [];
  const panelValues = values, credentialValues = [];
  return {
    context, requests, opened, registrations, configRequests, configNames, intervals, external,
    tick: async () => { for (const fn of [...intervals.values()]) await fn(); await new Promise(resolve => setImmediate(resolve)); },
    render: () => { values = panelValues; cursor = 0; return panel.type(panel.props); },
    renderCredentials: tree => { const component = nodes(tree, n => typeof n.type === 'function' && n.type.name === 'CredentialForm')[0]; assert.ok(component, 'Dot panel must expose its native credential form'); values = credentialValues; cursor = 0; return component.type(component.props); },
    flush: async () => { const work = pending; pending = []; work.forEach(fn => fn()); await new Promise(resolve => setImmediate(resolve)); },
    dispose: () => { [...panelValues, ...credentialValues].forEach(value => value?.cleanup?.()); effects.forEach(fn => fn?.()); },
  };
}

test('Context settings mount reads only sanitized state and exposes eight independent sources', async () => {
  const c = await load();
  try {
    c.render(); await c.flush(); const view = c.render();
    assert.equal(c.requests.length, 1); assert.equal(c.requests[0].url, endpoint);
    assert.equal(c.requests[0].options.method, 'GET'); assert.equal(c.requests[0].options.credentials, 'same-origin');
    assert.equal(nodes(view, n => n.props['data-context-source']).length, 8);
    assert.equal(nodes(view, n => n.type === 'input' || n.type === 'textarea').length, 0);
    assert.equal(c.opened.length, 0); assert.equal(c.requests.some(r => r.options.method === 'POST'), false);
    assert.match(text(view), /插件.*配置/); assert.match(text(view), /不会自动扫描/);
  } finally { c.dispose(); }
});

test('only an explicit source enable checks its interface and never claims a private read', async () => {
  const c = await load();
  try {
    c.render(); await c.flush(); let view = c.render();
    const flomo = nodes(view, n => n.props['data-context-source'] === 'flomo')[0];
    const enable = nodes(flomo, n => n.type === 'button')[0]; assert.equal(enable.props.disabled, false);
    c.context.snapshot.sources.find(s => s.id === 'flomo').enabled = true;
    c.context.snapshot.sources.find(s => s.id === 'flomo').status = 'enabled';
    await enable.props.onClick(); view = c.render();
    assert.deepEqual(JSON.parse(c.requests.at(-1).options.body), { action: 'connect', source: 'flomo' });
    assert.match(text(nodes(view, n => n.props['data-context-source'] === 'flomo')[0]), /当前对话已启用.*暂无读取记录/);
    assert.equal(c.requests.filter(r => r.options.method === 'POST').length, 1);
    assert.doesNotMatch(c.requests.at(-1).options.body, /query|token|secret|schedule/);
  } finally { c.dispose(); }
});

test('source disable is explicit and last read time is distinct from connection status', async () => {
  const c = await load(); c.context.snapshot.sources[7] = { ...c.context.snapshot.sources[7], enabled: true, status: 'enabled', lastReadAt: '2026-10-19T15:30:00Z' };
  try {
    c.render(); await c.flush(); let view = c.render();
    let flomo = nodes(view, n => n.props['data-context-source'] === 'flomo')[0]; assert.match(text(flomo), /2026-10-19T15:30:00Z/);
    const disable = nodes(flomo, n => n.type === 'button')[0]; c.context.snapshot.sources[7].enabled = false; c.context.snapshot.sources[7].status = 'disabled'; c.context.snapshot.sources[7].lastReadAt = null;
    await disable.props.onClick();
    assert.deepEqual(JSON.parse(c.requests.at(-1).options.body), { action: 'disconnect', source: 'flomo' });
    view = c.render(); flomo = nodes(view, n => n.props['data-context-source'] === 'flomo')[0]; assert.doesNotMatch(text(flomo), /上次读取/);
  } finally { c.dispose(); }
});

test('Google authorization is an explicit POST and displays a validated click-only Google link', async () => {
  const c = await load();
  try {
    c.render(); await c.flush(); let view = c.render();
    c.context.onFetch = () => Response.json({ url: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=fixture&state=fixture', expiresAt: '2030-01-01T01:05:00Z' });
    const button = nodes(view, n => n.type === 'button' && text(n).includes('连接 Google 账号'))[0]; await button.props.onClick(); view = c.render();
    assert.deepEqual(JSON.parse(c.requests.at(-1).options.body), { action: 'google_authorize' });
    const link = nodes(view, n => n.type === 'a')[0]; assert.match(link.props.href, /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/);
    assert.equal(link.props.target, '_blank'); assert.match(link.props.rel, /noreferrer/);
    assert.equal(c.opened.length, 0); assert.equal(c.requests.length, 2);
    assert.match(text(view), /Desktop/);
  } finally { c.dispose(); }
});

test('authorization rejects external or credential-bearing callback links without rendering them', async () => {
  for (const url of ['https://evil.example/authorize?token=PRIVATE', 'https://accounts.google.com.evil.example/o/oauth2/v2/auth', 'https://user:secret@accounts.google.com/o/oauth2/v2/auth', 'javascript:alert(1)']) {
    const c = await load();
    try {
      c.render(); await c.flush(); const view = c.render(); c.context.onFetch = () => Response.json({ url, expiresAt: '2030-01-01T01:05:00Z' });
      await nodes(view, n => n.type === 'button' && text(n).includes('连接 Google 账号'))[0].props.onClick();
      assert.equal(nodes(c.render(), n => n.type === 'a').length, 0); assert.doesNotMatch(text(c.render()), /evil.example|PRIVATE|user:secret/);
      assert.match(text(c.render()), /未完成|不确定|不可用/);
    } finally { c.dispose(); }
  }
});

test('lost status or mutation responses invalidate stale source actions and never retry automatically', async () => {
  const c = await load();
  try {
    c.render(); await c.flush(); const view = c.render(); const flomo = nodes(view, n => n.props['data-context-source'] === 'flomo')[0], oldEnable = nodes(flomo, n => n.type === 'button')[0];
    c.context.onFetch = () => { throw new Error('fixture-private-error'); };
    await oldEnable.props.onClick(); const count = c.requests.length; await oldEnable.props.onClick();
    assert.equal(c.requests.length, count); assert.equal(c.requests.filter(r => r.options.method === 'POST').length, 1);
    assert.doesNotMatch(text(c.render()), /fixture-private-error/); assert.match(text(c.render()), /刷新.*核对|刷新.*重试/);
  } finally { c.dispose(); }
});

test('unmount cancels pending native requests and late results cannot publish an authorization link', async () => {
  const c = await load(); let resolve, signal;
  c.render(); await c.flush(); const view = c.render();
  c.context.onFetch = (_url, options) => { signal = options.signal; return new Promise(done => { resolve = done; }); };
  const request = nodes(view, n => n.type === 'button' && text(n).includes('连接 Google 账号'))[0].props.onClick();
  c.dispose(); assert.equal(signal.aborted, true); resolve(Response.json({ url: 'https://accounts.google.com/o/oauth2/v2/auth?state=fixture', expiresAt: '2030-01-01T01:05:00Z' })); await request;
  assert.equal(c.opened.length, 0);
});

test('malformed or partial snapshots disable all source actions instead of inventing connection state', async () => {
  for (const broken of [{ sources: [], googleAuth: {} }, { sources: [...snapshot().sources.slice(0, 7), snapshot().sources[0]], googleAuth: {} }, { ...snapshot(), googleAuth: true }]) {
    const c = await load(); c.context.snapshot = broken;
    try {
      c.render(); await c.flush(); const view = c.render();
      assert.match(text(view), /状态暂不可用/);
      assert.ok(nodes(view, n => n.props['data-context-source']).every(row => nodes(row, n => n.type === 'button').every(button => button.props.disabled)));
      assert.equal(c.requests.length, 1);
    } finally { c.dispose(); }
  }
});

test('rapid enable clicks share one pending mutation and authoritative refresh restores lost status', async () => {
  const c = await load(); let release;
  try {
    c.render(); await c.flush(); const view = c.render();
    const button = nodes(nodes(view, n => n.props['data-context-source'] === 'flomo')[0], n => n.type === 'button')[0];
    c.context.onFetch = () => new Promise(resolve => { release = resolve; });
    const first = button.props.onClick(); await button.props.onClick();
    assert.equal(c.requests.filter(r => r.options.method === 'POST').length, 1);
    release(new Response('', { status: 403 })); await first;
    c.context.onFetch = null;
    await nodes(c.render(), n => n.type === 'button' && text(n).includes('刷新资料来源状态'))[0].props.onClick();
    assert.equal(nodes(nodes(c.render(), n => n.props['data-context-source'] === 'flomo')[0], n => n.type === 'button')[0].props.disabled, false);
    assert.equal(c.requests.filter(r => r.options.method === 'POST').length, 1);
  } finally { c.dispose(); }
});

test('native credential form is reachable in Dot and Plugin Configure without exposing stored secrets', async () => {
  const c = await load({ native: true });
  try {
    c.render(); await c.flush(); const panel = c.render(), form = c.renderCredentials(panel); await c.flush();
    assert.ok(c.registrations.some(row => row.spec.name === 'plugins.row.config' && row.spec.key === 'dsh-project-companion#project-companion'));
    assert.ok(c.configNames.length>=1);
    assert.ok(c.configNames.every(name=>name==='project-companion'));
    assert.equal(nodes(form, node => node.type === 'native-secret').length, 4);
    assert.ok(nodes(form, node => node.type === 'native-secret').every(field => field.props.text === ''));
    assert.equal(nodes(form, node => node.type === 'native-value')[0].props.text, 'public-native-client-id');
    assert.equal(c.configRequests.length, 0);
  } finally { c.dispose(); }
});

test('native credentials stage locally and only explicit Save uses the official revision-fenced config form', async () => {
  const c = await load({ native: true });
  try {
    c.render(); await c.flush(); const panel = c.render(); let view = c.renderCredentials(panel); await c.flush();
    nodes(view, node => node.type === 'native-secret' && node.props.id.endsWith('flomoToken'))[0].props.onEdit('typed-synthetic-secret');
    assert.equal(c.configRequests.length, 0); assert.equal(c.requests.length, 1);
    view = c.renderCredentials(panel); await nodes(view, node => node.type === 'native-form')[0].props.onSave();
    assert.deepEqual(c.configRequests, [{ ops: [{ op: 'set', path: ['flomoToken'], value: 'typed-synthetic-secret' }], revision: 7 }]);
    view = c.renderCredentials(panel); assert.ok(nodes(view, node => node.type === 'native-secret').every(field => field.props.text === ''));
    assert.ok(c.requests.every(request => !String(request.options.body ?? '').includes('typed-synthetic-secret')));
  } finally { c.dispose(); }
});

test('blank secret drafts retain stored credentials while explicit clear stages only an unset', async () => {
  const c = await load({ native: true });
  try {
    c.render(); await c.flush(); const panel = c.render(); let view = c.renderCredentials(panel); await c.flush();
    const token = nodes(view, node => node.type === 'native-secret' && node.props.id.endsWith('flomoToken'))[0];
    token.props.onEdit(''); view = c.renderCredentials(panel); await nodes(view, node => node.type === 'native-form')[0].props.onSave();
    assert.equal(c.configRequests.length, 0);
    await nodes(view, node => node.type === 'button' && text(node) === '清除 flomo MCP Token ')[0].props.onClick();
    view = c.renderCredentials(panel); await nodes(view, node => node.type === 'native-form')[0].props.onSave();
    assert.deepEqual(c.configRequests, [{ ops: [{ op: 'unset', path: ['flomoToken'] }], revision: 7 }]);
  } finally { c.dispose(); }
});

test('read-only native configuration prevents credential staging and writes', async () => {
  const c = await load({ native: true }); c.context.formSnapshot = { ...c.context.formSnapshot, writable: false };
  try {
    c.render(); await c.flush(); const panel = c.render(), view = c.renderCredentials(panel); await c.flush();
    assert.ok(nodes(view, node => node.type === 'native-secret').every(field => field.props.disabled));
    nodes(view, node => node.type === 'native-secret')[0].props.onEdit('synthetic-should-not-save');
    await nodes(view, node => node.type === 'native-form')[0].props.onSave();
    assert.equal(c.configRequests.length, 0);
  } finally { c.dispose(); }
});
test('credential form catches a ready snapshot published before its subscription',async()=>{
 const c=await load({native:true});try{c.render();await c.flush();const panel=c.render();c.context.formSnapshot={...c.context.formSnapshot,status:'loading'};let view=c.renderCredentials(panel);assert.equal(nodes(view,n=>n.type==='native-form')[0].props.state.available,false);c.context.formSnapshot={...c.context.formSnapshot,status:'ready'};await c.flush();view=c.renderCredentials(panel);assert.equal(nodes(view,n=>n.type==='native-form')[0].props.state.available,true);assert.equal(c.configRequests.length,0);}finally{c.dispose();}
});

test('flomo and Dida offer explicit official account login with legacy fields collapsed',async()=>{
 for(const source of ['flomo','dida']){
  const c=await load();c.context.snapshot[source+'Auth']={clientConfigured:true,refreshConfigured:false,authInProgress:false};
  try{c.render();await c.flush();let view=c.render();const labels={flomo:'flomo',dida:'滴答清单'};
   const advanced=nodes(view,n=>n.type==='details'&&n.props['data-context-advanced'])[0];assert.ok(advanced);assert.notEqual(advanced.props.open,true);assert.equal(c.requests.length,1);
   const url=source==='flomo'?'https://flomoapp.com/integration/grant?client_id=fixture&state=x':'https://dida365.com/oauth/authorize?client_id=fixture&state=x';c.context.onFetch=()=>Response.json({url,expiresAt:'2030-01-01T01:05:00Z'});
   await nodes(view,n=>n.type==='button'&&text(n).includes('登录 '+labels[source]+' 授权'))[0].props.onClick();view=c.render();assert.deepEqual(JSON.parse(c.requests.at(-1).options.body),{action:source+'_authorize'});
   const link=nodes(view,n=>n.type==='a')[0];assert.equal(link.props.href,url);assert.equal(link.props.target,'_blank');assert.match(link.props.rel,/noreferrer/);assert.equal(c.opened.length,0);assert.equal(c.requests.length,2);
  }finally{c.dispose();}
 }
});

test('account authorization refuses unexpected hosts and never accepts tokens from chat or page input',async()=>{
 for(const source of ['flomo','dida']){
  const c=await load();c.context.snapshot[source+'Auth']={clientConfigured:true,refreshConfigured:false,authInProgress:false};
  try{c.render();await c.flush();const view=c.render(),label=source==='flomo'?'flomo':'滴答清单';c.context.onFetch=()=>Response.json({url:'https://evil.example/login?token=PRIVATE',expiresAt:'2030-01-01T01:05:00Z'});
   await nodes(view,n=>n.type==='button'&&text(n).includes('登录 '+label+' 授权'))[0].props.onClick();const after=c.render();assert.equal(nodes(after,n=>n.type==='a').length,0);assert.doesNotMatch(text(after),/evil.example|PRIVATE/);assert.match(text(after),/不确定/);assert.equal(c.requests.filter(r=>r.options.method==='POST').length,1);
  }finally{c.dispose();}
 }
});

test('Calendar ordinary entry truthfully stays in preparation without a product publisher',async()=>{
 const c=await load();c.context.snapshot.googleCalendarAuth={clientConfigured:false,refreshConfigured:false,authInProgress:false};try{c.render();await c.flush();const view=c.render();assert.match(text(view),/Google 日历连接准备中/);const button=nodes(view,n=>n.type==='button'&&text(n).includes('登录 Google 日历'))[0];assert.equal(button.props.disabled,true);await button.props.onClick();assert.equal(c.requests.length,1);assert.equal(c.opened.length,0);}finally{c.dispose();}
});
test('Calendar login uses its own action and first-party link, without legacy credentials or an automatic read',async()=>{
 const c=await load();c.context.snapshot.googleCalendarAuth={clientConfigured:true,refreshConfigured:false,authInProgress:false};try{c.render();await c.flush();let view=c.render();const button=nodes(view,n=>n.type==='button'&&text(n).includes('登录 Google 日历'))[0];assert.equal(button.props.disabled,false);c.context.onFetch=()=>Response.json({url:'https://accounts.google.com/o/oauth2/v2/auth?state=calendar',expiresAt:'2030-01-01T01:05:00Z'});await button.props.onClick();view=c.render();assert.deepEqual(JSON.parse(c.requests.at(-1).options.body),{action:'google_calendar_authorize'});assert.match(text(view),/主日历/);assert.match(text(view),/登录不会自动查询/);assert.equal(c.requests.length,2);assert.equal(c.opened.length,0);assert.equal(nodes(view,n=>n.type==='a')[0].props.href,'https://accounts.google.com/o/oauth2/v2/auth?state=calendar');}finally{c.dispose();}
});

test('Calendar record can only be cleared via an explicit revision-CAS native form save',async()=>{const c=await load({native:true});try{c.render();await c.flush();const panel=c.render();let view=c.renderCredentials(panel);await c.flush();assert.equal(nodes(view,n=>n.type==='native-secret'&&n.props.id.endsWith('googleCalendarOAuthCredentials')).length,0);await nodes(view,n=>n.type==='button'&&text(n).includes('清除 Google 日历授权'))[0].props.onClick();assert.equal(c.configRequests.length,0);view=c.renderCredentials(panel);await nodes(view,n=>n.type==='native-form')[0].props.onSave();assert.deepEqual(c.configRequests,[{ops:[{op:'unset',path:['googleCalendarOAuthCredentials']}],revision:7}]);}finally{c.dispose();}});


const suiteButton = view => nodes(view, n => n.type === 'button' && n.props['data-google-suite-login'])[0];
const suiteState = () => ({clientConfigured:true,refreshConfigured:false,authInProgress:false,grantedSources:[]});
test('Google suite is the primary ordinary path with three clear services and no idle polling', async () => {
 const c = await load();
 try { c.render(); await c.flush(); const view=c.render(); const suite=nodes(view,n=>n.props['data-google-suite-connect'])[0];
  assert.ok(suite,'one ordinary suite block'); assert.match(text(suite),/Gmail/); assert.match(text(suite),/日历/); assert.match(text(suite),/Drive/);
  assert.equal(nodes(suite,n=>n.props['data-context-source']).length,3); assert.equal(suiteButton(view).props.disabled,false);
  assert.match(text(suite),/只读/); assert.match(text(suite),/内测/); assert.doesNotMatch(text(suite),/Client ID|Client Secret|Refresh Token/);
  assert.equal(c.intervals.size,0); assert.equal(c.external.length,0); assert.equal(c.requests.length,1);
 } finally {c.dispose();}
});
test('Google suite opens only its validated URL once and polls sanitized status until saved without enabling sources',async()=>{
 const c=await load();
 try{c.render();await c.flush();const initial=c.render(),button=suiteButton(initial);assert.ok(button);
  const expiry=new Date(Date.now()+240000).toISOString(); c.context.onFetch=(_url,o)=>o.method==='POST'?Response.json({url:'https://accounts.google.com/o/oauth2/v2/auth?state=suite',expiresAt:expiry}):Response.json(c.context.snapshot);
  await button.props.onClick();c.render();await c.flush();
  assert.deepEqual(JSON.parse(c.requests[1].options.body),{action:'google_suite_authorize'});
  assert.deepEqual(c.external,[['https://accounts.google.com/o/oauth2/v2/auth?state=suite','_blank','noopener,noreferrer']]);assert.equal(c.intervals.size,1);
  await suiteButton(c.render()).props.onClick();assert.equal(c.requests.filter(r=>r.options.method==='POST').length,1);assert.equal(c.external.length,1);
  c.context.snapshot.googleSuiteAuth={...suiteState(),refreshConfigured:true,grantedSources:['gmail','calendar','drive']};
  await c.tick();c.render();await c.flush();assert.equal(c.intervals.size,0);
  assert.match(text(c.render()),/授权已保存/);assert.ok(c.requests.every(r=>!String(r.options.body??'').includes('connect')));assert.equal(c.requests.filter(r=>r.options.method==='POST').length,1);
 }finally{c.dispose();}
});
test('Google suite refuses invalid authorization origins and neither opens nor polls',async()=>{
 const c=await load();try{c.render();await c.flush();const button=suiteButton(c.render());assert.ok(button);
  c.context.onFetch=()=>Response.json({url:'https://evil.example/login?secret=fixture',expiresAt:new Date(Date.now()+240000).toISOString()});
  await button.props.onClick();c.render();await c.flush();assert.equal(c.external.length,0);assert.equal(c.intervals.size,0);assert.equal(nodes(c.render(),n=>n.type==='a').length,0);assert.doesNotMatch(text(c.render()),/evil|secret=fixture/);
 }finally{c.dispose();}
});
test('Google authorization polling is bounded by expiry and disappears on unmount',async()=>{
 const c=await load();try{c.render();await c.flush();const button=suiteButton(c.render());assert.ok(button);
  c.context.onFetch=()=>Response.json({url:'https://accounts.google.com/o/oauth2/v2/auth?state=suite',expiresAt:new Date(Date.now()+25).toISOString()});
  await button.props.onClick();c.render();await c.flush();assert.equal(c.intervals.size,1);await new Promise(resolve=>setTimeout(resolve,35));await c.tick();c.render();await c.flush();assert.equal(c.intervals.size,0);assert.match(text(c.render()),/过期/);assert.equal(c.requests.filter(r=>r.options.method==='POST').length,1);
 }finally{c.dispose();assert.equal(c.intervals.size,0);}
});
test('Suite with partial consent never labels an ungranted source as connected',async()=>{
 const c=await load();c.context.snapshot.googleSuiteAuth={...suiteState(),refreshConfigured:true,grantedSources:['calendar']};c.context.snapshot.sources.find(s=>s.id==='calendar').configured=true;
 try{c.render();await c.flush();const view=c.render();assert.match(text(view),/部分/);const gmail=nodes(view,n=>n.props['data-context-source']==='gmail')[0];assert.match(text(gmail),/待账号授权/);assert.equal(nodes(gmail,n=>n.type==='button')[0].props.disabled,true);assert.equal(c.requests.length,1);assert.equal(c.intervals.size,0);
 }finally{c.dispose();}
});


test('Suite authorization can be cleared only by explicit native revision-fenced save',async()=>{
 const c=await load({native:true});try{c.render();await c.flush();const panel=c.render();let view=c.renderCredentials(panel);await c.flush();
  assert.equal(nodes(view,n=>n.type==='native-secret'&&n.props.id.endsWith('googleSuiteOAuthCredentials')).length,0);
  const clear=nodes(view,n=>n.type==='button'&&text(n).includes('清除 Google 三件套授权'))[0];assert.ok(clear);await clear.props.onClick();assert.equal(c.configRequests.length,0);
  view=c.renderCredentials(panel);await nodes(view,n=>n.type==='native-form')[0].props.onSave();assert.deepEqual(c.configRequests,[{ops:[{op:'unset',path:['googleSuiteOAuthCredentials']}],revision:7}]);
 }finally{c.dispose();}
});
test('Reauthorization keeps waiting while an older saved grant still exists',async()=>{
 const c=await load();c.context.snapshot.googleSuiteAuth={...suiteState(),refreshConfigured:true,grantedSources:['calendar']};
 try{c.render();await c.flush();const expiry=new Date(Date.now()+240000).toISOString();c.context.onFetch=(_url,o)=>o.method==='POST'?Response.json({url:'https://accounts.google.com/o/oauth2/v2/auth?state=suite',expiresAt:expiry}):Response.json(c.context.snapshot);
  await suiteButton(c.render()).props.onClick();c.render();await c.flush();c.context.snapshot.googleSuiteAuth={...c.context.snapshot.googleSuiteAuth,authInProgress:true,expiresAt:expiry};await c.tick();c.render();await c.flush();assert.equal(c.intervals.size,1);assert.equal(nodes(c.render(),n=>n.type==='a').length,1);assert.match(text(c.render()),/等待你完成 Google 授权/);
 }finally{c.dispose();assert.equal(c.intervals.size,0);}
});
test('Unmount aborts pending authorization status refresh and suppresses late updates',async()=>{
 const c=await load();let release,signal;try{c.render();await c.flush();c.context.onFetch=()=>Response.json({url:'https://accounts.google.com/o/oauth2/v2/auth?state=suite',expiresAt:new Date(Date.now()+240000).toISOString()});await suiteButton(c.render()).props.onClick();c.render();await c.flush();
  c.context.onFetch=(_url,o)=>{signal=o.signal;return new Promise(resolve=>{release=resolve;});};const pending=c.tick();await new Promise(resolve=>setImmediate(resolve));c.dispose();assert.equal(signal.aborted,true);assert.equal(c.intervals.size,0);release(Response.json(c.context.snapshot));await pending;assert.equal(c.external.length,1);assert.equal(c.requests.filter(r=>r.options.method==='POST').length,1);
 }finally{c.dispose();}
});
