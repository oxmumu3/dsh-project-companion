import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createMobileCompanion } from '../src/mobile-companion.js';
import { createMuseController } from '../src/muse-route.js';
import { buildMuseViewModel } from '../client/muse/muse-model.js';

async function loadMuseViews(tmpDir) {
  const outfile = path.join(tmpDir, 'muse-views.cjs');
  await build({
    absWorkingDir: fileURLToPath(new URL('../', import.meta.url)),
    entryPoints: ['client/muse/muse-views.jsx'],
    outfile,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node20',
    logLevel: 'error',
  });
  return createRequire(import.meta.url)(outfile).createMuseViews({
    createElement: (type, props, ...children) => ({
      type,
      props: { ...(props || {}), children },
    }),
    useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
    useRef: (init) => ({ current: init }),
    useEffect: () => {},
    useMemo: (fn) => fn(),
  });
}

function collectElements(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const item of node) collectElements(item, out);
    return out;
  }
  if (node.type) out.push(node);
  if (node.props?.children) collectElements(node.props.children, out);
  return out;
}

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dot-mobile-companion-test-'));
}

test('Mobile Companion: embedded server, QR SVG extraction, pairing, PIN rotation and Muse controller integration', async (t) => {
  const tmpDir = makeTempDir();
  const queuedPending = [];
  const addedNotes = [];

  const mobile = createMobileCompanion({
    dshHome: tmpDir,
    port: 0,
    host: '127.0.0.1',
    autoStart: true,
    embeddedServer: true,
    allowLoopbackProbe: false,
    enableBonjour: false,
    enableNotifications: false,
    readLiveState: async () => ({
      profile: { traits: [{ id: 'tr-1', category: 'tone', label: '先给结论', value: '后附依据' }], notes: [] },
      digest: { dailyTime: '08:30', timeZone: 'Asia/Shanghai' },
      superagent: {
        mode: 'synergy',
        milestones: [{ id: 'sa-1', status: 'in_review', title: '确认 0.38.0 手机配对流' }],
      },
      workspaceBrief: { workspaces: [{ name: 'Agent' }] },
    }),
    onQueuePending: async (item) => { queuedPending.push(item); },
    onAddNote: async (item) => { addedNotes.push(item); },
  });

  t.after(async () => {
    await mobile.dispose();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const started = await mobile.ensureStarted();
  assert.equal(started.active, true);
  assert.ok(started.port > 0);
  const baseUrl = `http://127.0.0.1:${started.port}`;

  // 1. Muse controller exposes mobile summary & pairInfo / rotate actions
  const controller = createMuseController({
    personalProfile: { snapshot: async () => ({ traits: [], notes: [] }) },
    mobileCompanion: mobile,
  });

  const snapBefore = await controller.snapshot();
  assert.equal(snapBefore.mobile.available, true);
  assert.equal(snapBefore.mobile.paired, false);

  const pairAct = await controller.act({ action: 'mobile_pair_info' });
  assert.equal(pairAct.ok, true);
  assert.match(pairAct.pair.pin, /^\d{6}$/);
  assert.match(pairAct.pair.pinFormatted, /^\d{3} · \d{3}$/);
  assert.ok(pairAct.pair.qrUrl.startsWith('dotmobile://pair?'));
  assert.match(pairAct.pair.qrViewBox, /^\d+\s+\d+\s+\d+\s+\d+$/);
  assert.ok(pairAct.pair.qrPathD.length > 40);

  // 2. Public health & LAN-only request-pin
  const healthRes = await fetch(`${baseUrl}/api/health`);
  assert.equal(healthRes.status, 200);
  const health = await healthRes.json();
  assert.match(health.fingerprint, /^[a-f0-9]{12}$/);
  assert.equal(health.token, undefined);
  assert.equal(health.pairingPin, undefined);

  const remotePinRes = await fetch(`${baseUrl}/api/pair/request-pin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.2' },
    body: JSON.stringify({}),
  });
  assert.equal(remotePinRes.status, 403);

  const localPinRes = await fetch(`${baseUrl}/api/pair/request-pin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(localPinRes.status, 200);
  const localPinBody = await localPinRes.json();
  assert.equal(JSON.stringify(localPinBody).includes(pairAct.pair.pin), false);

  // 3. Pair via 6-digit PIN & verify Codable snapshot + summary flip
  const badPair = await fetch(`${baseUrl}/api/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: '000000' === pairAct.pair.pin ? '111111' : '000000' }),
  });
  assert.equal(badPair.status, 401);

  const goodPair = await fetch(`${baseUrl}/api/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: pairAct.pair.pin, deviceName: 'Shan iPhone' }),
  });
  assert.equal(goodPair.status, 200);
  const paired = await goodPair.json();
  assert.ok(paired.token);
  assert.ok(paired.snapshot.todayFocus);
  const serialized = JSON.stringify(paired.snapshot);
  assert.equal(serialized.includes('分身'), false);
  assert.equal(serialized.includes('/Users/'), false);

  const summaryAfter = await mobile.summary();
  assert.equal(summaryAfter.paired, true);
  assert.equal(summaryAfter.pairedCount, 1);

  // 4. Authed bootstrap & command forwarding
  const cmdRes = await fetch(`${baseUrl}/api/command`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${paired.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: '记住以后周日晚上不安排工作推送' }),
  });
  assert.equal(cmdRes.status, 200);
  const cmd = await cmdRes.json();
  assert.equal(cmd.tier, 'tier_a');
  assert.equal(addedNotes.length, 1);

  const taskRes = await fetch(`${baseUrl}/api/command`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${paired.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: '帮我整理本周五会议议程' }),
  });
  assert.equal(taskRes.status, 200);
  assert.equal(queuedPending.length, 1);

  // 5. Rotate PIN & verify UI tree contains 连手机 + SVG QR without CLI jargon
  const rotated = await controller.act({ action: 'mobile_pair_rotate' });
  assert.equal(rotated.ok, true);
  assert.match(rotated.pair.pin, /^\d{6}$/);

  const views = await loadMuseViews(tmpDir);
  const model = buildMuseViewModel({ muse: snapBefore, now: new Date() });
  const topbarTree = views.MuseTopbar({ tab: 'today', model });
  const pairBtn = collectElements(topbarTree).find((el) => el.props?.['data-muse-open-mobile-pair']);
  assert.ok(pairBtn, 'MuseTopbar must expose 连手机 trigger');

  const dialogTree = views.MuseMobilePairDialog({ open: true, pair: rotated.pair });
  const dialogEls = collectElements(dialogTree);
  assert.ok(dialogEls.some((el) => el.props?.['data-muse-mobile-pin'] === rotated.pair.pin));
  assert.ok(dialogEls.some((el) => el.type === 'svg' && el.props?.className === 'muse-pair-qr-svg'));
  assert.equal(JSON.stringify(dialogTree).includes('dot-mobile-bridge'), false);
});
