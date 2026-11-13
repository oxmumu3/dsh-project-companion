import test from 'node:test';
import assert from 'node:assert/strict';
import {buildToday, inlineResponseAllowed, needsTodayWechatSetup, starterDraft} from '../client/today-model.js';
import {markSampleCleared, sampleActivity} from '../client/sample.js';
import {zh} from '../client/strings.zh.js';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {build} from 'esbuild';

let view;
async function loadView(t) {
  if (view) return view;
  const dir = await mkdtemp(join(tmpdir(), 'dot-today-first-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const outfile = join(dir, 'today.cjs');
  await build({absWorkingDir: fileURLToPath(new URL('../', import.meta.url)), entryPoints: ['client/today.jsx'], outfile, bundle: true, format: 'cjs', platform: 'node', target: 'node20', jsx: 'transform', jsxFactory: 'React.createElement', jsxFragment: 'React.Fragment', logLevel: 'error'});
  view = createRequire(import.meta.url)(outfile);
  return view;
}

function runtime() {
  const stack = [];
  const React = {
    createElement: (type, props, ...children) => ({type, props: props ?? {}, children: children.flat(Infinity).filter(c => c !== null && c !== undefined && c !== false && c !== true)}),
    useState: initial => {
      const frame = stack.at(-1), index = frame.cursor++;
      if (!(index in frame.slots)) frame.slots[index] = typeof initial === 'function' ? initial() : initial;
      return [frame.slots[index], next => { frame.slots[index] = typeof next === 'function' ? next(frame.slots[index]) : next; }];
    },
    useRef: initial => {
      const frame = stack.at(-1), index = frame.cursor++;
      if (!(index in frame.slots)) frame.slots[index] = {current: initial};
      return frame.slots[index];
    },
    useEffect: () => {},
    useMemo: fn => fn(),
  };
  const expand = node => {
    if (node === null || node === undefined || typeof node === 'boolean') return null;
    if (typeof node === 'string' || typeof node === 'number') return node;
    if (Array.isArray(node)) return node.map(expand).flat(Infinity).filter(x => x !== null);
    if (typeof node.type === 'function') {
      const frame = {cursor: 0, slots: []};
      stack.push(frame);
      try { return expand(node.type(node.props)); } finally { stack.pop(); }
    }
    return {...node, children: (node.children ?? []).map(expand).flat(Infinity).filter(x => x !== null)};
  };
  return {React, expand};
}
const walk = (node, out = []) => { if (!node || typeof node !== 'object') return out; out.push(node); for (const c of node.children ?? []) walk(c, out); return out; };
const all = (tree, predicate) => walk(tree).filter(predicate);
const activity = extra => ({reachable: true, revision: 1, counts: {done: 0, wait: 0, stuck: 0, run: 0, total: 0}, sessions: [], projects: [], promises: [], sources: [], connection: {wechat: 'none'}, ...extra});
function render(model, props = {}) {
  const {React, expand} = runtime();
  const TodayPage = view.createTodayView(React).TodayPage;
  return expand(React.createElement(TodayPage, {model, onAct: () => {}, onSay: () => {}, onOpenProject: () => {}, onOpenSession: () => {}, onClearSample: () => {}, pending: new Set(), ...props}));
}
function banner(tree) { return all(tree, node => node.props?.['data-dot-inline-wechat'] === true); }

test('first use with a real Today none shows one inline pairing banner and no QR without waiting-qr', async t => {
  await loadView(t);
  const model = buildToday(activity());
  const tree = render(model, {wechatMode: 'guide'});
  assert.equal(banner(tree).length, 1);
  assert.equal(all(tree, node => node.type === 'img').length, 0);
  assert.equal(all(tree, node => node.type === 'button' && node.children.includes('刷新连接状态')).length, 0, 'guide must not start pairing or a bridge request');
});

test('first use waiting-qr with a real QR revision renders exactly the existing QR endpoint', async t => {
  await loadView(t);
  const model = buildToday(activity());
  const tree = render(model, {wechatMode: 'pair', inlineConnection: {state: 'waiting-qr', qrAvailable: true, qrRevision: '0123456789abcdef'}});
  const imgs = all(tree, node => node.type === 'img');
  assert.equal(imgs.length, 1);
  assert.equal(imgs[0].props.src, '/wechat/api/qr-image?v=0123456789abcdef');
});

test('bound, unknown and absent setup render no banner and no QR', async t => {
  await loadView(t);
  for (const props of [{wechatMode: null, inlineConnection: {state: 'bound'}}, {wechatMode: null, inlineConnection: {state: 'unknown'}}, {}]) {
    const tree = render(buildToday(activity({connection: {wechat: props.wechatSetup ? 'none' : 'unknown'}})), props);
    assert.equal(banner(tree).length, 0);
    assert.equal(all(tree, node => node.type === 'img').length, 0);
  }
});

test('QR unavailable keeps the banner but never renders an image', async t => {
  await loadView(t);
  const tree = render(buildToday(activity()), {wechatMode: 'pair', inlineConnection: {state: 'waiting-qr', qrAvailable: false}});
  assert.equal(banner(tree).length, 1);
  assert.equal(all(tree, node => node.type === 'img').length, 0);
});

test('sample clear has one entry and starter clicks never call onSay', async t => {
  await loadView(t);
  let says = 0;
  const sample = buildToday(sampleActivity(), {sample: true});
  const tree = render(sample, {onSay: () => { says += 1; }});
  assert.equal(all(tree, node => node.type === 'button' && node.children.includes(zh.today.sampleClear)).length, 1);
  const starter = all(tree, node => node.type === 'button' && node.children.includes(zh.today.starters[0]))[0];
  assert.ok(starter);
  starter.props.onClick();
  assert.equal(says, 0, 'starter only fills the input; it must not submit or call /say');
});

test('the composer submit path still calls onSay exactly once', async t => {
  await loadView(t);
  let says = [];
  const {React, expand} = runtime();
  const Composer = view.createTodayView(React).Composer;
  const tree = expand(React.createElement(Composer, {draft: '一句话', onDraft: () => {}, onSay: value => says.push(value)}));
  const form = all(tree, node => node.type === 'form')[0];
  await form.props.onSubmit({preventDefault: () => {}});
  assert.deepEqual(says, ['一句话']);
});


test('stock Today/Workbench shapes: only known first-use pairing opens onboarding', () => {
  const empty = {empty: true, reachable: true};
  assert.equal(needsTodayWechatSetup({wechat: 'none'}, {state: 'missing'}, empty), true, 'Today none + Workbench missing guides setup');
  assert.equal(needsTodayWechatSetup({wechat: 'unknown'}, {state: 'waiting-qr'}, empty), true, 'Today unknown + Workbench waiting-qr is known pairing');
  assert.equal(needsTodayWechatSetup({wechat: 'unknown'}, {state: 'scanned'}, empty), true, 'scanned is known pairing');
  assert.equal(needsTodayWechatSetup({wechat: 'unknown'}, {state: 'awaiting-message'}, empty), true, 'awaiting-message is known pairing');
  assert.equal(needsTodayWechatSetup({wechat: 'bound'}, {state: 'waiting-qr'}, empty), false, 'real Today bound always rejects');
  assert.equal(needsTodayWechatSetup({wechat: 'none'}, {state: 'unknown'}, empty), false, 'Workbench unknown rejects');
  assert.equal(needsTodayWechatSetup({wechat: 'none'}, {state: 'failed'}, empty), false, 'Workbench failed rejects');
  assert.equal(needsTodayWechatSetup({wechat: 'none'}, {state: 'missing', readOnly: true}, empty), false, 'readOnly Workbench rejects');
  assert.equal(needsTodayWechatSetup({wechat: 'unknown'}, {state: 'unknown'}, empty), false, 'truly unknown both sides is zero QR');
  assert.equal(needsTodayWechatSetup({wechat: 'none'}, {state: 'missing'}, {empty: false, reachable: true}), false, 'normal items reject');
  assert.equal(needsTodayWechatSetup({wechat: 'none'}, {state: 'missing'}, {empty: true, reachable: false}), false, 'unreachable Today rejects');
  assert.equal(needsTodayWechatSetup({wechat: 'unknown'}, {state: 'missing'}, empty), false, 'Today unknown + missing pairing rejects');
});

test('active Workbench: real none with items or transient waiting on unknown never opens onboarding', () => {
  assert.equal(needsTodayWechatSetup({wechat: 'none'}, {state: 'waiting-qr'}, {empty: false, reachable: true}), false, 'real none but normal work does not show QR');
  assert.equal(needsTodayWechatSetup({wechat: 'unknown'}, {state: 'waiting-qr'}, {empty: true, reachable: true}), true, 'known pairing is the exception');
  assert.equal(needsTodayWechatSetup({wechat: 'unknown'}, {state: 'unknown'}, {empty: true, reachable: true}), false, 'both unknown stays closed');
});

test('starter text fills only an empty draft and never overwrites a user draft', () => {
  assert.equal(starterDraft('', zh.today.starters[0]), zh.today.starters[0]);
  assert.equal(starterDraft('我正在写的原话', zh.today.starters[0]), '我正在写的原话');
});

test('clearing the sample writes only the local preference and survives a reopen', () => {
  const memory = new Map();
  const storage = {setItem: (key, value) => memory.set(key, value), getItem: key => memory.get(key) ?? null};
  assert.equal(markSampleCleared(storage), true);
  assert.equal(memory.get('dot.sample.cleared'), '1');
  assert.equal(storage.getItem('dot.sample.cleared'), '1');
});


test('a late pairing response cannot land after bound/leave and scanned hides the image', async t => {
  await loadView(t);
  assert.equal(inlineResponseAllowed({active: true, page: 'home', gate: 'pair'}), true);
  assert.equal(inlineResponseAllowed({active: true, page: 'home', gate: ''}), false, 'workbench became bound');
  assert.equal(inlineResponseAllowed({active: true, page: 'projects', gate: 'pair'}), false, 'left Today');
  assert.equal(inlineResponseAllowed({active: false, page: 'home', gate: 'pair'}), false, 'unmounted');
  const scanned = render(buildToday(activity()), {wechatMode: 'pair', inlineConnection: {state: 'scanned'}});
  assert.equal(all(scanned, node => node.type === 'img').length, 0, 'scanned is progress only');
  const awaiting = render(buildToday(activity()), {wechatMode: 'pair', inlineConnection: {state: 'awaiting-message'}});
  assert.equal(all(awaiting, node => node.type === 'img').length, 0, 'awaiting-message is progress only');
});

test('Today first-use band uses host theme tokens and does not reintroduce light-card colors', async () => {
  const {readFile} = await import('node:fs/promises');
  const css = await readFile(new URL('../client/styles.css', import.meta.url), 'utf8');
  const rules = [...css.matchAll(/\.dotv2 \.pc_dot_inline_wechat[^{]*\{([^}]*)\}/g)].map(match => match[0]);
  const band = rules.find(rule => rule.startsWith('.dotv2 .pc_dot_inline_wechat{'));
  assert.ok(band, 'missing themed band rule');
  assert.match(band, /background:var\(--card\)/);
  assert.match(band, /border-color:var\(--line\)/);
  assert.match(band, /color:var\(--ink\)/);
  assert.ok(rules.some(rule => /\.pc_dot_pair_copy>p\{[^}]*color:var\(--ink2\)/.test(rule)), 'body copy must use --ink2');
  assert.ok(rules.some(rule => /\.pc_dot_pair_copy>p\.pc_dot_muted\{[^}]*color:var\(--ink2\)/.test(rule)), 'the small online/QR note must use the tested --ink2');
  assert.ok(rules.some(rule => /\.pc_dot_inline_code\{[^}]*background:var\(--bg\)/.test(rule)), 'status area must use host background');
  assert.ok(rules.some(rule => /\.pc_dot_inline_code button\{[^}]*background:var\(--card\)/.test(rule)), 'button must use host card');
  assert.ok(!rules.some(rule => !rule.includes('img') && /rgb\(255|#edf2fc|#fff/.test(rule)), 'no old light-card colors in the band');
});

test('Today headline joins its counts with Chinese punctuation and no stray spaces', async t => {
  await loadView(t);
  const model = buildToday(activity({counts: {done: 2, wait: 1, stuck: 0, run: 2, total: 5}}));
  assert.equal(model.headline.text, '到现在为止，两件做完了，一件在等你，还有两件在跑。');
  const tree = render(model);
  const line = all(tree, node => node.props?.className === 'line')[0];
  const textOf = node => typeof node === 'string' ? node : node && typeof node === 'object' ? (node.children ?? []).map(textOf).join('') : '';
  assert.equal(textOf(line).replace(/\s+/g, ''), '到现在为止，两件做完了，一件在等你，还有两件在跑。');
});

test('Today omits empty project totals and reports the actual overflow counts', async t => {
  await loadView(t);
  const sample = buildToday(sampleActivity(), {sample: true});
  const summary = field => {
    const tree = render({...sample, field});
    const parts = all(tree, node => node.props?.className === 'rest');
    return parts.map(node => node.children[0].children[0]);
  };
  const active = sample.field.active;
  const many = Array.from({length: 8}, (_, i) => ({id: 'p'+i, name: '项目 '+i, state: 'doing', count: 1}));
  assert.deepEqual(summary({active, quiet: 0}), []);
  assert.deepEqual(summary({active, quiet: 2}), ['另外 2 个今天没有动静']);
  assert.deepEqual(summary({active: many, quiet: 0}), ['另外 2 个也有动静']);
  assert.deepEqual(summary({active: many, quiet: 3}), ['另外 2 个也有动静，另外 3 个今天没有动静']);
});
