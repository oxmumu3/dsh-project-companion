import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {atText, buildToday} from '../client/today-model.js';

const app = await readFile(new URL('../client/app.jsx', import.meta.url), 'utf8');
const styles = await readFile(new URL('../client/styles.css', import.meta.url), 'utf8');

const lum = rgb => {
  const channel = value => { value /= 255; return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
};
const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
const mix = (a, b, t) => a.map((value, index) => Math.round(value * t + b[index] * (1 - t)));

test('the four pages map paper, card, ink, border and accent to host tokens', () => {
  assert.match(app, /--dot-paper:var\(--dsw-alias-bg-base\)/);
  assert.match(app, /--dot-card:var\(--dsw-alias-bg-layer-2\)/);
  assert.match(app, /--dot-ink:var\(--dsw-alias-label-primary\)/);
  assert.match(app, /--dot-muted:var\(--dsw-alias-label-secondary\)/);
  assert.match(app, /--dot-line:var\(--dsw-alias-border-l2\)/);
  assert.match(app, /--dot-blue:color-mix\(in srgb,var\(--dsw-alias-state-business-primary\) 78%,var\(--dsw-alias-label-primary\)\)/);
  assert.doesNotMatch(app, /--dot-paper:#[0-9a-f]{3,8}/i);
  assert.doesNotMatch(app, /--dot-ink:#[0-9a-f]{3,8}/i);
  assert.doesNotMatch(app, /--dot-paper:color-mix\([^\n]*#bda776/);
});

test('Google login uses a paired fill and foreground instead of white on host light blue', () => {
  assert.match(app, /\.pc_setup button\.pc_primary\{background:var\(--dot-blue-fill\);border-color:transparent;color:var\(--dot-on-blue\)\}/);
  assert.match(app, /--dot-on-blue:var\(--dsw-alias-label-primary-inverted\)/);
  assert.doesNotMatch(app, /\.pc_setup button\.pc_primary\{[^}]*color:(?:white|#fff)\b/i);
  assert.doesNotMatch(app, /\.pc_setup button\.pc_primary\{[^}]*background:var\(--dsw-alias-state-business-primary\)/);
});

test('the Google authorization disclosure and evidence link remain in place', () => {
  assert.match(app, /data-google-data-use-disclosure':true,className:'pc_connect_notice'\},'同意连接后，Dot 仅按你的请求读取 Google 资料/);
  assert.match(app, /data-google-privacy':true/);
});

test('legacy workbench controls never repaint the Today surface', () => {
  assert.match(app, /\.pc_dot button:not\(:where\(\.pc_dot_conversation \*,\.dotv2 \*\)\)/);
  assert.match(app, /\.pc_dot input:not\(:where\(\.pc_dot_conversation \*,\.dotv2 \*\)\)/);
  assert.match(app, /\.pc_dot \.dotv2 h2\{font-size:13px/);
});

test('Today secondary text uses the host secondary label and long names clamp instead of stretching', () => {
  assert.match(styles, /--ink3:var\(--dsw-alias-label-secondary\)/);
  assert.match(styles, /\.dotv2 \.row b\{[^}]*minmax\(0,150px\)|grid-template-columns:20px minmax\(0,150px\)/);
  assert.match(styles, /\.dotv2 \.row b\{[^}]*-webkit-line-clamp:2/);
  assert.match(styles, /\.dotv2 \.cell b\{[^}]*-webkit-line-clamp:2/);
});

test('the accent and paired control pass 4.5:1 in the host light and dark palettes', () => {
  const palettes = [
    {bg: [255, 255, 255], card: [255, 255, 255], ink: [15, 17, 21], secondary: [97, 102, 107], business: [65, 118, 230], inverted: [255, 255, 255]},
    {bg: [21, 21, 23], card: [44, 44, 46], ink: [249, 250, 251], secondary: [207, 211, 214], business: [122, 170, 255], inverted: [53, 54, 56]},
  ];
  for (const palette of palettes) {
    const accent = mix(palette.business, palette.ink, 0.78);
    const fill = mix(palette.business, palette.ink, 0.84);
    assert.ok(ratio(palette.ink, palette.bg) >= 4.5, 'primary text');
    assert.ok(ratio(palette.secondary, palette.card) >= 4.5, 'secondary text');
    assert.ok(ratio(accent, palette.bg) >= 4.5, 'accent link');
    assert.ok(ratio(palette.inverted, fill) >= 4.5, 'paired control foreground');
  }
});

test('Today times are human text, never ISO strings', () => {
  const now = new Date('2026-11-13T14:10:00+08:00');
  assert.equal(atText('2026-11-13T14:09:30+08:00', now), '刚刚');
  assert.equal(atText('2026-11-13T14:05:00+08:00', now), '5 分钟前');
  assert.equal(atText('2026-11-13T09:05:00+08:00', now), '今天 09:05');
  assert.equal(atText('2026-11-12T21:10:00+08:00', now), '昨天 21:10');
  assert.doesNotMatch(atText('2026-11-01T09:05:00+08:00', now), /\d{4}-\d{2}-\d{2}T/);
});

test('Today counts keep one sentence, Chinese punctuation and no spaces inside a count', () => {
  const activity = {reachable: true, revision: 1, counts: {done: 2, wait: 1, stuck: 0, run: 2, total: 5}, sessions: [], projects: [], promises: [], sources: []};
  const model = buildToday(activity, {now: new Date('2026-11-13T14:10:00+08:00')});
  assert.equal(model.headline.text, '到现在为止，两件做完了，一件在等你，还有两件在跑。');
  assert.doesNotMatch(model.headline.text, /\d\s+件/);
});

test('Today rows store the human time, not the raw ISO instant', () => {
  const at = '2026-11-13T14:05:00+08:00';
  const activity = {reachable: true, revision: 1, counts: {done: 0, wait: 1, stuck: 0, run: 0, total: 1}, sessions: [{projectId: 'p1', state: 'needs_you', title: '确认付款计划', what: '确认付款计划', at}], projects: [{id: 'p1', name: '跨境支付'}], promises: [], sources: []};
  const model = buildToday(activity, {now: new Date('2026-11-13T14:10:00+08:00')});
  assert.equal(model.urgent[0].at, '5 分钟前');
  assert.doesNotMatch(JSON.stringify(model.urgent), /\d{4}-\d{2}-\d{2}T/);
});
