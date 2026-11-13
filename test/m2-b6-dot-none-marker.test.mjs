/**
 * M2 B.6: the dot for a promise nobody has picked up.
 *
 * DESIGN.md 2.3 (right rail) says such a row shows a grey dashed dot; after
 * 「让 Dot 去办」 it turns blue, and it turns green when the work is done. The
 * Today model already marks that row `none` (client/today-model.js), the design
 * prototype renders `<i class="d s none">` for it (design/dot-v2.html), and
 * styles.css already carries `.d.none{border:1.5px dashed …}`. Only the class
 * map in client/dots.jsx was missing the `none` key, so the dot fell back to
 * `.d.quiet` and drew a solid ring.
 *
 * This test renders the real Today view — today.jsx → dots.jsx — into a
 * browser-shaped element tree, reads the class attribute React would write on
 * the dot, and resolves the border/background that class gets from the shipped
 * stylesheet. A missing map entry therefore fails on the class and the border,
 * not only on a screenshot.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {buildToday} from '../client/today-model.js';

const HERE = new URL('../', import.meta.url);

/** Minimal React that expands function components once, like the host would. */
function createReactRuntime() {
  const stack = [];
  const React = {
    createElement: (type, props, ...children) => ({
      type,
      props: props ?? {},
      children: children.flat(Infinity).filter(child => child !== null && child !== undefined && child !== false && child !== true),
    }),
    useState: initial => {
      const frame = stack.at(-1);
      const index = frame.cursor++;
      if (!(index in frame.slots)) frame.slots[index] = typeof initial === 'function' ? initial() : initial;
      return [frame.slots[index], next => { frame.slots[index] = typeof next === 'function' ? next(frame.slots[index]) : next; }];
    },
    useRef: initial => {
      const frame = stack.at(-1);
      const index = frame.cursor++;
      if (!(index in frame.slots)) frame.slots[index] = {current: initial};
      return frame.slots[index];
    },
    useEffect: () => {},
    useMemo: factory => factory(),
  };
  function expand(node) {
    if (node === null || node === undefined || typeof node === 'boolean') return null;
    if (typeof node === 'string' || typeof node === 'number') return node;
    if (Array.isArray(node)) return node.map(expand).flat(Infinity).filter(item => item !== null);
    if (typeof node.type === 'function') {
      const frame = {cursor: 0, slots: []};
      stack.push(frame);
      let rendered;
      try {
        rendered = node.type(node.props);
      } finally {
        stack.pop();
      }
      return expand(rendered);
    }
    return {...node, children: (node.children ?? []).map(expand).flat(Infinity).filter(item => item !== null)};
  }
  return {React, expand};
}

const walk = (node, visit) => {
  if (!node || typeof node !== 'object') return;
  visit(node);
  for (const child of node.children ?? []) walk(child, visit);
};
const findAll = (node, predicate) => {
  const hits = [];
  walk(node, item => { if (predicate(item)) hits.push(item); });
  return hits;
};

/**
 * selector → declarations, in source order (later rules win, as in the browser).
 * Only top-level rules are read; @media and @keyframes blocks are skipped, the
 * same way this page's dot rules sit outside them.
 */
function readStyleSheet(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const sheet = new Map();
  let depth = 0;
  let selector = '';
  let body = '';
  for (const char of clean) {
    if (char === '{') {
      depth += 1;
      if (depth === 1) {
        selector = body.trim();
        body = '';
        continue;
      }
    } else if (char === '}') {
      if (depth === 1) {
        if (selector && !selector.startsWith('@')) {
          const declarations = Object.fromEntries(body.split(';')
            .map(part => part.trim())
            .filter(Boolean)
            .map(part => {
              const at = part.indexOf(':');
              return [part.slice(0, at).trim(), part.slice(at + 1).trim()];
            }));
          for (const name of selector.split(',')) sheet.set(name.trim(), declarations);
        }
        body = '';
      }
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth <= 1) body += char;
  }
  return sheet;
}

function styleOf(sheet, selector) {
  const declarations = sheet.get(selector);
  assert.ok(declarations, `styles.css 里没有 ${selector} 这条规则`);
  return declarations;
}

let view;
async function loadView(t) {
  if (view) return view;
  const dir = await mkdtemp(join(tmpdir(), 'dot-b6-dot-none-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const outfile = join(dir, 'today.cjs');
  await build({
    absWorkingDir: fileURLToPath(HERE),
    entryPoints: ['client/today.jsx'],
    outfile,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node20',
    jsx: 'transform',
    jsxFactory: 'React.createElement',
    jsxFragment: 'React.Fragment',
    logLevel: 'error',
  });
  view = createRequire(import.meta.url)(outfile);
  return view;
}

const project = {id: 'project_1', name: 'Finder'};
const promise = extra => ({
  id: 'promise_1',
  what: '把首屏截图换成浅色那张',
  from: '滴答',
  whenText: '周四之前',
  ...extra,
});
const activity = extra => ({
  reachable: true,
  revision: 3,
  counts: {done: 0, wait: 0, stuck: 0, run: 0, total: 0},
  sessions: [],
  projects: [project],
  promises: [promise()],
  sources: [{id: 'dida', state: 'ok'}],
  ...extra,
});

function render(model, t) {
  const {React, expand} = createReactRuntime();
  const TodayPage = view.createTodayView(React).TodayPage;
  return expand(React.createElement(TodayPage, {
    model,
    onAct: () => {},
    onSay: () => {},
    onOpenProject: () => {},
    onOpenSession: () => {},
    onClearSample: () => {},
    pending: new Set(),
  }));
}

/** The dot inside the first right-rail promise row, as the browser sees it. */
function promiseDot(tree) {
  const list = findAll(tree, node => node.props?.className === 'promise')[0];
  assert.ok(list, '今天页右栏没有渲染出「你答应过的事」列表');
  const row = list.children.find(child => child?.type === 'li');
  assert.ok(row, '右栏没有承诺行');
  const dots = findAll(row, node => node.type === 'i');
  assert.equal(dots.length, 1, '每条承诺后面只挂一个点');
  return {row, dot: dots[0]};
}

const cssOf = async () => readStyleSheet(await readFile(new URL('client/styles.css', HERE), 'utf8'));

test('未派工的承诺点：模型是 none，渲染出的 class 是 d s none，样式是灰色虚线', async t => {
  await loadView(t);
  const model = buildToday(activity());
  assert.equal(model.promises[0].state, 'none', '没有人认领的承诺，模型状态是 none');

  const {row, dot} = promiseDot(render(model, t));
  assert.equal(dot.props.className, 'd s none', '点必须落到 none，而不是 quiet');
  assert.equal(dot.props['aria-hidden'], 'true');
  assert.ok(findAll(row, node => node.type === 'button').some(button => button.children.includes('让 Dot 去办')), '没有人在处理时仍然给「让 Dot 去办」');

  const sheet = await cssOf();
  const none = styleOf(sheet, '.d.none');
  assert.equal(none.border, '1.5px dashed var(--ink4)', 'none 是虚线');
  assert.equal(none.background, 'transparent');
  const quiet = styleOf(sheet, '.d.quiet');
  assert.equal(quiet.border, '1.5px solid var(--ink4)', 'quiet 保持实线空心');
});

test('派出去以后：虚线点变蓝，做完变绿，两段都走宿主颜色变量', async t => {
  await loadView(t);
  const sheet = await cssOf();
  const tokens = styleOf(sheet, '.dotv2');
  assert.equal(tokens['--run'], 'var(--dsw-alias-link)', '做中用宿主链接色');
  assert.equal(tokens['--ok'], 'var(--dsw-alias-state-success-primary)', '做完用宿主成功色');

  const doing = buildToday(activity({promises: [promise({handledBy: {sessionId: 'session-a', state: 'doing', title: '正在改截图'}})]}));
  assert.equal(doing.promises[0].state, 'doing');
  assert.equal(promiseDot(render(doing, t)).dot.props.className, 'd s run');
  const run = styleOf(sheet, '.d.run');
  assert.equal(run.background, 'var(--run)');
  assert.equal(styleOf(sheet, '.d.done').background, 'var(--ok)');

  const done = buildToday(activity({promises: [promise({handledBy: {sessionId: 'session-a', state: 'done', title: '截图换好了'}})]}));
  assert.equal(done.promises[0].state, 'done');
  assert.equal(promiseDot(render(done, t)).dot.props.className, 'd s done');
});

test('其余状态不动：没动静的项目还是实线空心，只有未派工那条是虚线', async t => {
  await loadView(t);
  const model = buildToday(activity());
  const tree = render(model, t);
  const quietDots = findAll(tree, node => node.type === 'i' && /\bquiet$/.test(String(node.props?.className).trim()));
  assert.ok(quietDots.length >= 1, '没有动静的项目还是 quiet');
  const quiet = styleOf(await cssOf(), '.d.quiet');
  assert.equal(quiet.border, '1.5px solid var(--ink4)');
  assert.equal(quiet.background, 'transparent');

  const promiseClasses = findAll(tree, node => node.type === 'i' && node.props?.className?.includes(' s ')).map(node => node.props.className);
  assert.deepEqual(promiseClasses, ['d s none'], '右栏那一个点走虚线，不跟着项目点变');
});
