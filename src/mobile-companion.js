import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { URL } from 'node:url';
import { promisify } from 'node:util';
import { qrSvgFor } from '../vendor/dsh-wechat/dist/qr.js';

const execFileAsync = promisify(execFile);

export const DEFAULT_MOBILE_PORT = 58471;
export const MOBILE_PIN_TTL_MS = 15 * 60 * 1000;

function cleanDeviceName(raw = os.hostname()) {
  const cleaned = String(raw || 'Mac')
    .replace(/\.local$/i, '')
    .replace(/[^a-zA-Z0-9\u4e00-\u9fa5 _.-]/g, ' ')
    .trim();
  return cleaned || 'MacBook';
}

export function sanitizeForMobile(text, fallback = '') {
  if (typeof text !== 'string') return fallback;
  let out = text
    .replace(/\/Users\/[^\s"'`)\]}]+/g, '[本机工作区]')
    .replace(/分身/g, '协办事项')
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return out || fallback;
}

export function computeTokenFingerprint(bearerToken) {
  return crypto
    .createHash('sha256')
    .update(`dot-mobile-fp:v1:${String(bearerToken || '')}`)
    .digest('hex')
    .slice(0, 12);
}

export function deriveRendezvousTopic(bearerToken) {
  const mac = crypto
    .createHmac('sha256', Buffer.from(String(bearerToken || ''), 'utf8'))
    .update('dot-mobile-rendezvous-topic-v1')
    .digest('hex')
    .slice(0, 18);
  return `dotbox1-${mac}`;
}

export function listLanIPv4Addresses() {
  try {
    const nets = os.networkInterfaces();
    const out = [];
    for (const [name, entries] of Object.entries(nets)) {
      if (!Array.isArray(entries)) continue;
      if (/^(lo|utun|llw|awdl|bridge|gif|stf|anpi)/i.test(name)) continue;
      for (const entry of entries) {
        if (entry && entry.family === 'IPv4' && !entry.internal && entry.address) {
          out.push(entry.address);
        }
      }
    }
    return [...new Set(out)];
  } catch {
    return [];
  }
}

export function buildMobilePairUrl({ pin, lanUrl, remoteUrl, deviceName }) {
  const params = new URLSearchParams();
  params.set('pin', String(pin || ''));
  if (lanUrl) params.set('lan', String(lanUrl));
  if (remoteUrl) params.set('remote', String(remoteUrl));
  if (deviceName) params.set('name', String(deviceName));
  return `dotmobile://pair?${params.toString()}`;
}

export function extractQrSvgParts(text) {
  const raw = qrSvgFor(String(text || ''));
  const viewBoxMatch = /viewBox="([^"]+)"/i.exec(raw);
  const pathMatch = /<path[^>]*\bd="([^"]+)"/i.exec(raw);
  return {
    qrViewBox: viewBoxMatch?.[1] || '0 0 64 64',
    qrPathD: pathMatch?.[1] || '',
  };
}

function generatePin() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

function safeTimingEqualString(a, b) {
  const bufA = Buffer.from(String(a || ''), 'utf8');
  const bufB = Buffer.from(String(b || ''), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function ensureSecureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dirPath, 0o700);
  } catch {
    // Ignore on filesystems without POSIX chmod
  }
}

function atomicWriteJson(filePath, data) {
  const dir = path.dirname(filePath);
  ensureSecureDir(dir);
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  try {
    fs.chmodSync(tmpPath, 0o600);
  } catch {
    // Ignore
  }
  fs.renameSync(tmpPath, filePath);
}

function isLanOrLoopbackRequest(req) {
  if (
    req.headers['cf-connecting-ip'] ||
    req.headers['cf-ray'] ||
    req.headers['x-forwarded-for']
  ) {
    return false;
  }
  const rawAddr = String(req.socket?.remoteAddress || '').trim();
  if (!rawAddr) return false;
  const ipv4Candidate = rawAddr.toLowerCase().startsWith('::ffff:')
    ? rawAddr.slice(7)
    : rawAddr;
  const ipv4Parts = ipv4Candidate.split('.');
  if (ipv4Parts.length === 4 && ipv4Parts.every((p) => /^\d+$/.test(p))) {
    const [a, b] = ipv4Parts.map(Number);
    if (a === 127 || a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  const normalizedV6 = rawAddr.split('%')[0].toLowerCase();
  if (normalizedV6 === '::1') return true;
  if (
    normalizedV6.startsWith('fe80:') ||
    normalizedV6.startsWith('fc') ||
    normalizedV6.startsWith('fd')
  ) {
    return true;
  }
  return false;
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  });
  res.end(body);
}

function readJsonBody(req, maxBytes = 256 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function startBonjour({ port, deviceName, lanUrl = '', fingerprint = '' }) {
  const dnsSdBin = '/usr/bin/dns-sd';
  if (!fs.existsSync(dnsSdBin)) return { active: false, stop() {} };
  let stopped = false;
  let child = null;
  const launch = () => {
    if (stopped) return;
    const txtRecords = ['v=1', 'app=dot-mobile', `host=${deviceName}`];
    if (lanUrl) txtRecords.push(`lan=${String(lanUrl).trim()}`);
    if (fingerprint) txtRecords.push(`fp=${String(fingerprint).trim()}`);
    child = spawn(
      dnsSdBin,
      ['-R', `Dot · ${deviceName}`, '_dotmobile._tcp', 'local', String(port), ...txtRecords],
      { stdio: 'ignore' }
    );
    child.on('exit', () => {
      if (!stopped) setTimeout(launch, 3000).unref();
    });
    child.on('error', () => {});
  };
  launch();
  return {
    active: true,
    stop() {
      stopped = true;
      if (child && !child.killed) {
        try {
          child.kill('SIGTERM');
        } catch {
          // Ignore
        }
      }
    },
  };
}

async function notifyMacPin({ pin, deviceName, dryRun = false }) {
  if (
    dryRun ||
    process.env.DOT_MOBILE_DISABLE_NOTIFY === '1' ||
    process.env.NODE_ENV === 'test' ||
    Boolean(process.env.NODE_TEST_CONTEXT) ||
    globalThis.__dshCiNetwork
  ) {
    return { ok: true, simulated: true };
  }
  const cleanPin = String(pin || '').replace(/\D/g, '').slice(0, 6);
  const formatted = cleanPin.length === 6 ? `${cleanPin.slice(0, 3)} ${cleanPin.slice(3)}` : cleanPin;
  try {
    await execFileAsync(
      '/usr/bin/osascript',
      [
        '-e',
        'on run argv',
        '-e',
        'display notification (item 1 of argv) with title (item 2 of argv) subtitle (item 3 of argv)',
        '-e',
        'end run',
        '--',
        `配对码 ${formatted}（也可在 DSH Dot 点「连手机」扫码）`,
        'DSH Dot · 手机配对码',
        String(deviceName || 'Mac'),
      ],
      { timeout: 5_000 }
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || '通知发送失败' };
  }
}

export function createMobileCompanion(options = {}) {
  const isTestOrSynthetic = Boolean(
    process.env.NODE_TEST_CONTEXT || globalThis.__dshCiNetwork || options.syntheticHost
  );
  const isClosed = typeof options.isClosed === 'function' ? options.isClosed : () => false;
  const persistToDisk = Boolean(options.stateDir || options.dshHome || !isTestOrSynthetic);
  const resolvedDshHome = options.dshHome
    ? path.resolve(options.dshHome)
    : path.join(os.homedir(), '.dsh');
  const stateDir = persistToDisk
    ? options.stateDir
      ? path.resolve(options.stateDir)
      : path.join(resolvedDshHome, 'dot-mobile-bridge')
    : null;
  const configPath = stateDir ? path.join(stateDir, 'config.json') : null;

  const configuredPort = Number.isInteger(options.port) ? options.port : DEFAULT_MOBILE_PORT;
  const host = options.host || '0.0.0.0';
  const embeddedEnabled =
    options.embeddedServer !== false && (options.embeddedServer === true || !isTestOrSynthetic);
  const shouldAutoStart =
    options.autoStart === true || (options.autoStart !== false && !isTestOrSynthetic);
  const allowLoopbackProbe = Boolean(options.allowLoopbackProbe ?? !isTestOrSynthetic);
  const enableBonjour = options.enableBonjour !== false && !isTestOrSynthetic;
  const enableNotifications = options.enableNotifications !== false && !isTestOrSynthetic;
  const fetchImpl = options.fetchImpl || globalThis.fetch;

  let memoryConfig = null;
  const mobileState = {
    dismissedCardIds: new Set(),
    deferredCards: [],
    appleCalendarItems: [],
    rhythm: {
      mode: 'normal',
      morningTime: '08:30',
      delayedMorningTime: '09:45',
      calendarAuthorized: false,
      remindersAuthorized: false,
      healthRhythmEnabled: false,
      focusFilterEnabled: false,
    },
    messages: [],
    notes: [],
    traits: [],
    dossiers: [],
    undoHistory: new Map(),
    processedOfflineIds: new Set(),
  };

  let externalHealth = null;
  let embeddedServer = null;
  let bonjourHandle = { stop() {} };
  let heartbeatTimer = null;
  let boundPort = configuredPort;
  let startingPromise = null;
  const sseClients = new Set();
  const pairAttemptsByKey = new Map();

  function loadOrCreateConfig({ rotate = false, deviceHint } = {}) {
    const now = Date.now();
    let current = memoryConfig;
    if (configPath && fs.existsSync(configPath)) {
      try {
        current = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      } catch {
        current = memoryConfig;
      }
    }
    const port =
      Number.isInteger(configuredPort) && configuredPort > 0
        ? configuredPort
        : Number.isInteger(current?.port) && current.port > 0
          ? current.port
          : DEFAULT_MOBILE_PORT;
    const bearerToken =
      typeof current?.bearerToken === 'string' && current.bearerToken.length >= 32
        ? current.bearerToken
        : crypto.randomBytes(32).toString('hex');
    const pinValid =
      !rotate &&
      typeof current?.pairingPin === 'string' &&
      /^\d{6}$/.test(current.pairingPin) &&
      typeof current?.pinExpiresAt === 'number' &&
      current.pinExpiresAt > now + 30_000;
    const pairingPin = pinValid ? current.pairingPin : generatePin();
    const pinExpiresAt = pinValid ? current.pinExpiresAt : now + MOBILE_PIN_TTL_MS;

    const next = {
      version: 1,
      port,
      bearerToken,
      pairingPin,
      pinExpiresAt,
      deviceName: cleanDeviceName(deviceHint || options.deviceName || current?.deviceName || os.hostname()),
      remoteUrl: typeof current?.remoteUrl === 'string' ? current.remoteUrl : null,
      lastPairedAt: typeof current?.lastPairedAt === 'string' ? current.lastPairedAt : null,
      pairedCount: Number.isFinite(Number(current?.pairedCount)) ? Number(current.pairedCount) : 0,
      lastPairedDevice:
        typeof current?.lastPairedDevice === 'string' ? current.lastPairedDevice : null,
      createdAt: current?.createdAt || new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
    };
    memoryConfig = next;
    if (configPath) {
      const changed =
        !current ||
        rotate ||
        current.pairingPin !== next.pairingPin ||
        current.bearerToken !== next.bearerToken;
      if (changed) {
        try {
          atomicWriteJson(configPath, next);
        } catch {
          // Non-fatal in read-only environments
        }
      }
    }
    return next;
  }

  function recordPairingSuccess(deviceInfo = {}) {
    const cfg = loadOrCreateConfig();
    const nowIso = new Date().toISOString();
    cfg.pairedCount = Number(cfg.pairedCount || 0) + 1;
    cfg.lastPairedAt = nowIso;
    if (deviceInfo?.deviceName) {
      cfg.lastPairedDevice = cleanDeviceName(deviceInfo.deviceName);
    }
    cfg.updatedAt = nowIso;
    memoryConfig = cfg;
    if (configPath) {
      try {
        atomicWriteJson(configPath, cfg);
      } catch {
        // Ignore
      }
    }
    return cfg;
  }

  async function probeExternalBridge() {
    if (!allowLoopbackProbe || typeof fetchImpl !== 'function') {
      externalHealth = null;
      return null;
    }
    const cfg = loadOrCreateConfig();
    const probePort = configuredPort > 0 ? configuredPort : cfg.port;
    try {
      const res = await fetchImpl(`http://127.0.0.1:${probePort}/api/health`, {
        signal: AbortSignal.timeout(600),
      });
      if (!res?.ok) {
        externalHealth = null;
        return null;
      }
      const data = await res.json();
      if (data?.ok) {
        externalHealth = data;
        return data;
      }
    } catch {
      // No external bridge listening
    }
    externalHealth = null;
    return null;
  }

  async function buildSnapshot() {
    const cfg = loadOrCreateConfig();
    const live =
      typeof options.readLiveState === 'function'
        ? await options.readLiveState().catch(() => null)
        : null;
    const nowIso = new Date().toISOString();
    const hr = new Date().getHours();
    const greetingPrefix = hr < 11 ? '早安' : hr < 14 ? '午安' : hr < 18 ? '下午好' : '晚上好';

    const saMilestones = Array.isArray(live?.superagent?.milestones) ? live.superagent.milestones : [];
    const wsList = Array.isArray(live?.workspaceBrief?.workspaces) ? live.workspaceBrief.workspaces : [];
    const desktopTraits = Array.isArray(live?.profile?.traits) ? live.profile.traits : [];
    const desktopNotes = Array.isArray(live?.profile?.notes) ? live.profile.notes : [];

    const dossiers = [];
    for (const m of saMilestones.slice(0, 8)) {
      const id = sanitizeForMobile(String(m?.id || m?.cardId || `sa-${dossiers.length + 1}`));
      const st = m?.status === 'in_review' ? 'wait' : m?.status === 'done' ? 'done' : 'run';
      dossiers.push({
        id,
        title: sanitizeForMobile(m?.title || m?.text || '协同事项', '协同事项'),
        status: st,
        statusLabel: st === 'wait' ? '等你拍板' : st === 'done' ? '已完成' : '电脑推进中',
        summary: sanitizeForMobile(m?.summary || m?.note || '由电脑端 Dot 协同推进并整理阶段结论。'),
        draftText: null,
        category: 'work',
        source: 'dot',
        updatedAt: m?.updatedAt || nowIso,
        relativeTime: '刚刚',
        timeline: [],
      });
    }
    for (const d of mobileState.dossiers) {
      dossiers.push(d);
    }

    const candidates = saMilestones
      .filter((m) => m?.status === 'in_review')
      .map((m, idx) => ({
        id: `fc-${sanitizeForMobile(String(m?.id || idx))}`,
        eyebrow: '电脑协同 · 待你点头',
        title: sanitizeForMobile(m?.title || m?.text || '有一条协同进展等你确认', '待你确认'),
        summary: sanitizeForMobile(m?.summary || '电脑上的后台协办已完成阶段整理，等你拍板后继续。'),
        draftSlip: sanitizeForMobile(m?.draftSlip || '按当前方向继续推进，有结果再通知我。'),
        primaryActionLabel: '按此推进',
        secondaryActionLabel: '推迟到下午',
        dossierId: sanitizeForMobile(String(m?.id || '')),
        category: 'work',
        status: 'pending',
        updatedAt: m?.updatedAt || nowIso,
      }))
      .filter((c) => !mobileState.dismissedCardIds.has(c.id));

    const todayFocus = candidates[0] || null;
    const secondaryQueue = candidates.slice(1).map((c) => ({
      id: c.id,
      title: c.title,
      summary: c.summary,
      eyebrow: c.eyebrow,
      dossierId: c.dossierId,
      category: c.category,
    }));

    const counts = {
      wait: dossiers.filter((d) => d.status === 'wait').length,
      run: dossiers.filter((d) => d.status === 'run').length,
      done: dossiers.filter((d) => d.status === 'done').length,
    };

    const wsNames = wsList
      .map((w) => sanitizeForMobile(w?.label || w?.name || ''))
      .filter(Boolean)
      .slice(0, 4);
    const effectiveWs = wsNames.length > 0 ? wsNames : ['DeepSeek Harness 工作台'];

    const traits = [
      ...desktopTraits.map((t) => ({
        id: String(t.id),
        label: sanitizeForMobile(t.value ? `${t.label}：${t.value}` : t.label),
        category: sanitizeForMobile(t.category || '长期偏好'),
        active: true,
        updatedAt: t.updatedAt || nowIso,
      })),
      ...mobileState.traits,
    ].slice(0, 24);

    const notes = [
      ...mobileState.notes,
      ...desktopNotes.map((n) => ({
        id: String(n.id),
        text: sanitizeForMobile(n.text),
        source: n.source === 'wechat' ? '微信随记' : '电脑桌面',
        createdAt: n.createdAt || nowIso,
        relativeTime: '最近',
      })),
    ].slice(0, 30);

    const scheduleItems = [
      ...mobileState.appleCalendarItems.slice(0, 6),
      {
        id: 'sch-morning-brief',
        timeLabel: live?.digest?.dailyTime || mobileState.rhythm.morningTime,
        title: '晨间简报 · 今日重点与日程预判',
        subtitle: '只保留急需拍板的一件事，其余静默排期',
        source: 'dot',
      },
    ];

    const rhythm = {
      ...mobileState.rhythm,
      morningTime: live?.digest?.dailyTime || mobileState.rhythm.morningTime,
    };

    return {
      generatedAt: nowIso,
      deviceName: sanitizeForMobile(cfg.deviceName, 'Mac'),
      dshDetected: true,
      greetingTitle: `${greetingPrefix}，今天幕僚台很清净`,
      rhythmBanner: todayFocus
        ? `后台 ${counts.run} 件事平稳推进中，眼下只有 1 件事等你拍板。`
        : '今天急需你拍板的事项已全部清零，安心忙你的即可。',
      spokenBriefingText: todayFocus
        ? `${greetingPrefix}。今天只需拍板一件事：${todayFocus.title}。`
        : `${greetingPrefix}。今天所有待拍板事项都已处理妥当。`,
      rhythm,
      counts,
      firstAha: {
        headline: `已与「${sanitizeForMobile(cfg.deviceName, 'Mac')}」建立加密默契`,
        subheadline: '不搬运复杂代码与终端屏幕，只把电脑上需要你拿主意的结论轻轻递到手里。',
        workspaceCount: effectiveWs.length,
        workspaceSummary: effectiveWs.join(' · '),
        activeDossierCount: counts.wait + counts.run,
        pendingDecisionTitle: todayFocus ? todayFocus.title : '今日暂无需紧急拍板的事项',
        bullets: [
          `已连接电脑工作台：${effectiveWs.join('、')}`,
          `后台共有 ${counts.wait + counts.run} 件在办事项，已自动过滤路径与噪音`,
          todayFocus ? `首件待你拍板：「${todayFocus.title}」` : '随时可在底部输入栏口述或写一句话交办',
        ],
      },
      todayFocus,
      secondaryQueue,
      scheduleItems,
      dossiers,
      traits,
      notes,
      messages: mobileState.messages.slice(-30),
    };
  }

  async function broadcastSnapshot() {
    if (sseClients.size === 0) return;
    const snap = await buildSnapshot();
    const frame = `event: snapshot\ndata: ${JSON.stringify(snap)}\n\n`;
    for (const client of sseClients) {
      try {
        client.write(frame);
      } catch {
        sseClients.delete(client);
      }
    }
  }

  function currentLanUrls() {
    const p = boundPort > 0 ? boundPort : loadOrCreateConfig().port;
    const ips = listLanIPv4Addresses();
    return ips.map((ip) => `http://${ip}:${p}`);
  }

  function checkRateLimit(req) {
    const cfIp = String(req.headers['cf-connecting-ip'] || '').trim();
    const sockIp = String(req.socket?.remoteAddress || 'unknown');
    const key = cfIp ? `cf:${cfIp}` : `sock:${sockIp}`;
    const now = Date.now();
    const rec = pairAttemptsByKey.get(key) || { count: 0, resetAt: now + 60_000 };
    if (now > rec.resetAt) {
      rec.count = 0;
      rec.resetAt = now + 60_000;
    }
    rec.count += 1;
    pairAttemptsByKey.set(key, rec);
    return rec.count <= 8;
  }

  function isAuthorized(req, urlObj, cfg) {
    const authHeader = String(req.headers.authorization || '');
    const headerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const queryToken = urlObj.searchParams.get('token') || '';
    const candidate = headerToken || queryToken;
    if (!candidate) return false;
    return safeTimingEqualString(candidate.toLowerCase(), cfg.bearerToken.toLowerCase());
  }

  async function handleCommandBody(body = {}) {
    const text = sanitizeForMobile(String(body.text || ''));
    if (!text) return { ok: false, error: '内容不能为空', snapshot: await buildSnapshot() };
    const nowIso = new Date().toISOString();
    mobileState.messages.push({
      id: `m-u-${Date.now()}`,
      role: 'user',
      text,
      createdAt: nowIso,
    });
    if (/^(记住|以后|偏好|不要|习惯)/.test(text)) {
      if (typeof options.onAddNote === 'function') {
        await options.onAddNote({ text, category: 'preference', source: 'mobile' }).catch(() => {});
      }
      mobileState.notes.unshift({
        id: `nt-${Date.now()}`,
        text,
        source: '手机随手记',
        createdAt: nowIso,
        relativeTime: '刚刚',
      });
      const reply = `已记下这条长期偏好：「${text}」。`;
      mobileState.messages.push({ id: `m-a-${Date.now() + 1}`, role: 'assistant', text: reply, tier: 'tier_a', createdAt: nowIso });
      return { ok: true, tier: 'tier_a', reply, snapshot: await buildSnapshot() };
    }
    if (body.confirmTierC !== true && /删|清空|重置|发送邮件|发给|覆盖/.test(text)) {
      const proposal = {
        originalText: text,
        topicTitle: text.slice(0, 32),
        prompt: '涉及对外或高影响动作，请确认后再写入电脑待办台。',
      };
      mobileState.messages.push({
        id: `m-a-${Date.now() + 1}`,
        role: 'assistant',
        text: proposal.prompt,
        tier: 'tier_c',
        createdAt: nowIso,
      });
      return { ok: true, tier: 'tier_c', requiresConfirm: true, proposal, snapshot: await buildSnapshot() };
    }
    if (typeof options.onQueuePending === 'function') {
      await options.onQueuePending({ text, title: text.slice(0, 48) }).catch(() => {});
    }
    const dosId = `dos-${Date.now()}`;
    const dossier = {
      id: dosId,
      title: text.slice(0, 48),
      status: 'run',
      statusLabel: '电脑推进中',
      summary: `已由手机交办给电脑幕僚台：${text}`,
      category: 'work',
      source: 'mobile',
      updatedAt: nowIso,
      relativeTime: '刚刚',
      timeline: [{ id: `tl-${Date.now()}`, timeLabel: '刚刚', detail: '手机发起交办', state: 'run' }],
    };
    mobileState.dossiers.unshift(dossier);
    const briefCard = {
      dossierId: dosId,
      title: dossier.title,
      status: 'run',
      statusLabel: '已交给电脑跟进',
      summary: dossier.summary,
    };
    const reply = `已收下并放进电脑协办台：「${dossier.title}」。`;
    mobileState.messages.push({
      id: `m-a-${Date.now() + 1}`,
      role: 'assistant',
      text: reply,
      tier: 'tier_b',
      briefCard,
      createdAt: nowIso,
    });
    return { ok: true, tier: 'tier_b', reply, briefCard, snapshot: await buildSnapshot() };
  }

  async function startEmbeddedServer() {
    if (embeddedServer || isClosed() || !embeddedEnabled) {
      return { active: Boolean(embeddedServer), port: boundPort };
    }
    const cfg = loadOrCreateConfig();
    const server = http.createServer(async (req, res) => {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        });
        res.end();
        return;
      }
      const urlObj = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
      const pathname = urlObj.pathname;
      let latestCfg = loadOrCreateConfig();
      try {
        if (req.method === 'GET' && pathname === '/api/health') {
          const lanUrls = currentLanUrls();
          sendJson(res, 200, {
            ok: true,
            app: 'dsh-dot-embedded',
            version: '0.38.0',
            deviceName: latestCfg.deviceName,
            port: boundPort,
            fingerprint: computeTokenFingerprint(latestCfg.bearerToken),
            lanUrl: lanUrls[0] || null,
            paired: Boolean(latestCfg.lastPairedAt || Number(latestCfg.pairedCount || 0) > 0),
            pairedCount: Number(latestCfg.pairedCount || 0),
            lastPairedAt: latestCfg.lastPairedAt || null,
            dshDetected: true,
            tunnelReady: Boolean(latestCfg.remoteUrl),
          });
          return;
        }

        if (req.method === 'POST' && pathname === '/api/pair/request-pin') {
          if (!isLanOrLoopbackRequest(req)) {
            sendJson(res, 403, { ok: false, error: '仅支持同一局域网触发 Mac 配对提示。' });
            return;
          }
          if (!checkRateLimit(req)) {
            sendJson(res, 429, { ok: false, error: '请求过于频繁，请稍候一分钟再试' });
            return;
          }
          const body = await readJsonBody(req);
          if (body?.rotate === true || latestCfg.pinExpiresAt <= Date.now()) {
            latestCfg = loadOrCreateConfig({ rotate: true });
          }
          const notifyRes =
            body?.silent === true
              ? { ok: false, skipped: true }
              : await notifyMacPin({
                  pin: latestCfg.pairingPin,
                  deviceName: latestCfg.deviceName,
                  dryRun: !enableNotifications,
                });
          sendJson(res, 200, {
            ok: true,
            notified: Boolean(notifyRes?.ok),
            deviceName: latestCfg.deviceName,
            expiresAt: latestCfg.pinExpiresAt,
            message: '请在 DeepSeek Harness → DSH Dot 点击右上角「连手机」查看 6 位码或扫码',
          });
          return;
        }

        if (req.method === 'POST' && pathname === '/api/pair') {
          if (!checkRateLimit(req)) {
            sendJson(res, 429, { ok: false, error: '尝试过于频繁，请稍候一分钟再试' });
            return;
          }
          const body = await readJsonBody(req);
          const submittedPin = String(body?.pin ?? '').trim();
          if (!/^\d{6}$/.test(submittedPin)) {
            sendJson(res, 400, { ok: false, error: '请输入完整的 6 位数字配对码' });
            return;
          }
          if (latestCfg.pinExpiresAt <= Date.now()) {
            latestCfg = loadOrCreateConfig({ rotate: true });
            sendJson(res, 401, { ok: false, error: '配对码已过期，电脑端已自动刷新新码' });
            return;
          }
          if (!safeTimingEqualString(submittedPin, latestCfg.pairingPin)) {
            sendJson(res, 401, { ok: false, error: '6 位配对码不匹配，请核对电脑端「连手机」页面' });
            return;
          }
          latestCfg = recordPairingSuccess({ deviceName: body?.deviceName });
          const lanUrls = currentLanUrls();
          sendJson(res, 200, {
            ok: true,
            token: latestCfg.bearerToken,
            fingerprint: computeTokenFingerprint(latestCfg.bearerToken),
            deviceName: latestCfg.deviceName,
            port: boundPort,
            lanUrl: lanUrls[0] || `http://127.0.0.1:${boundPort}`,
            lanUrls,
            remoteUrl: latestCfg.remoteUrl || null,
            rendezvousTopic: deriveRendezvousTopic(latestCfg.bearerToken),
            snapshot: await buildSnapshot(),
          });
          return;
        }

        if (!isAuthorized(req, urlObj, latestCfg)) {
          sendJson(res, 401, { ok: false, error: '凭证已失效，请在电脑端重新扫码配对' });
          return;
        }

        if (req.method === 'GET' && pathname === '/api/bootstrap') {
          const lanUrls = currentLanUrls();
          sendJson(res, 200, {
            ok: true,
            connection: {
              deviceName: latestCfg.deviceName,
              port: boundPort,
              lanUrl: lanUrls[0] || null,
              lanUrls,
              remoteUrl: latestCfg.remoteUrl || null,
              rendezvousTopic: deriveRendezvousTopic(latestCfg.bearerToken),
            },
            snapshot: await buildSnapshot(),
          });
          return;
        }

        if (req.method === 'GET' && pathname === '/api/events') {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
          });
          const snap = await buildSnapshot();
          res.write(`event: snapshot\ndata: ${JSON.stringify(snap)}\n\n`);
          sseClients.add(res);
          req.on('close', () => sseClients.delete(res));
          return;
        }

        if (req.method === 'POST' && pathname === '/api/today/act') {
          const body = await readJsonBody(req);
          const cardId = String(body?.cardId || '');
          const undoToken = crypto.randomUUID();
          if (cardId) mobileState.dismissedCardIds.add(cardId);
          mobileState.undoHistory.set(undoToken, { cardId, expiresAt: Date.now() + 10_000 });
          const snap = await buildSnapshot();
          void broadcastSnapshot();
          sendJson(res, 200, { ok: true, undoToken, snapshot: snap });
          return;
        }

        if (req.method === 'POST' && pathname === '/api/undo') {
          const body = await readJsonBody(req);
          const item = mobileState.undoHistory.get(String(body?.undoToken || ''));
          if (item && item.expiresAt > Date.now() && item.cardId) {
            mobileState.dismissedCardIds.delete(item.cardId);
            mobileState.undoHistory.delete(String(body.undoToken));
            const snap = await buildSnapshot();
            void broadcastSnapshot();
            sendJson(res, 200, { ok: true, snapshot: snap });
            return;
          }
          sendJson(res, 409, { ok: false, error: '撤回窗口已过', snapshot: await buildSnapshot() });
          return;
        }

        if (req.method === 'POST' && pathname.startsWith('/api/dossiers/') && pathname.endsWith('/act')) {
          const id = decodeURIComponent(pathname.slice('/api/dossiers/'.length, -'/act'.length));
          const body = await readJsonBody(req);
          const existing = mobileState.dossiers.find((d) => d.id === id);
          if (existing) {
            existing.summary = sanitizeForMobile(body?.instruction || body?.draftText || existing.summary);
            existing.updatedAt = new Date().toISOString();
            existing.relativeTime = '刚刚';
          }
          const snap = await buildSnapshot();
          void broadcastSnapshot();
          sendJson(res, 200, { ok: true, snapshot: snap });
          return;
        }

        if (req.method === 'POST' && pathname === '/api/command') {
          const body = await readJsonBody(req);
          const out = await handleCommandBody(body);
          void broadcastSnapshot();
          sendJson(res, 200, out);
          return;
        }

        if (req.method === 'POST' && pathname === '/api/memory/traits') {
          const body = await readJsonBody(req);
          if (body?.remove && body?.id) {
            mobileState.traits = mobileState.traits.filter((t) => t.id !== body.id);
            if (typeof options.onRemoveTrait === 'function') {
              await options.onRemoveTrait({ id: body.id }).catch(() => {});
            }
          } else if (body?.label) {
            const label = sanitizeForMobile(body.label);
            if (typeof options.onSetTrait === 'function') {
              await options.onSetTrait({ category: 'custom', label, value: label }).catch(() => {});
            } else {
              mobileState.traits.unshift({
                id: String(body.id || `tr-${Date.now()}`),
                label,
                category: '手机补充',
                active: body.active !== false,
                updatedAt: new Date().toISOString(),
              });
            }
          }
          const snap = await buildSnapshot();
          void broadcastSnapshot();
          sendJson(res, 200, { ok: true, snapshot: snap });
          return;
        }

        if (req.method === 'POST' && pathname === '/api/memory/notes') {
          const body = await readJsonBody(req);
          if (body?.remove && body?.id) {
            mobileState.notes = mobileState.notes.filter((n) => n.id !== body.id);
          } else if (body?.text) {
            const text = sanitizeForMobile(body.text);
            if (typeof options.onAddNote === 'function') {
              await options.onAddNote({ text, category: 'note', source: 'mobile' }).catch(() => {});
            } else {
              mobileState.notes.unshift({
                id: `nt-${Date.now()}`,
                text,
                source: sanitizeForMobile(body.source || '随手记'),
                createdAt: new Date().toISOString(),
                relativeTime: '刚刚',
              });
            }
          }
          const snap = await buildSnapshot();
          void broadcastSnapshot();
          sendJson(res, 200, { ok: true, snapshot: snap });
          return;
        }

        if (req.method === 'POST' && pathname === '/api/apple/sync') {
          const body = await readJsonBody(req);
          if (body?.clear) {
            mobileState.appleCalendarItems = [];
          } else if (Array.isArray(body?.items)) {
            mobileState.appleCalendarItems = body.items.slice(0, 12).map((ev, idx) => ({
              id: sanitizeForMobile(String(ev?.id || `apple-${idx}`)),
              timeLabel: sanitizeForMobile(ev?.timeLabel || '今天'),
              title: sanitizeForMobile(ev?.title || '日程'),
              subtitle: sanitizeForMobile(ev?.subtitle || '来自 iPhone 日历'),
              source: ev?.kind === 'reminder' ? 'apple_reminder' : 'apple_calendar',
            }));
          }
          const snap = await buildSnapshot();
          void broadcastSnapshot();
          sendJson(res, 200, { ok: true, snapshot: snap });
          return;
        }

        if (req.method === 'POST' && pathname === '/api/rhythm') {
          const body = await readJsonBody(req);
          mobileState.rhythm = { ...mobileState.rhythm, ...body };
          if (typeof options.onConfigureRhythm === 'function' && body?.morningTime) {
            await options.onConfigureRhythm({ dailyTime: body.morningTime }).catch(() => {});
          }
          const snap = await buildSnapshot();
          void broadcastSnapshot();
          sendJson(res, 200, { ok: true, snapshot: snap });
          return;
        }

        if (req.method === 'POST' && pathname === '/api/offline/flush') {
          const body = await readJsonBody(req);
          const items = Array.isArray(body?.items) ? body.items : [];
          for (const item of items) {
            const clientId = String(item?.clientRequestId || item?.id || '');
            if (clientId && mobileState.processedOfflineIds.has(clientId)) continue;
            if (clientId) mobileState.processedOfflineIds.add(clientId);
            if (item?.text) await handleCommandBody({ text: item.text });
          }
          const snap = await buildSnapshot();
          void broadcastSnapshot();
          sendJson(res, 200, { ok: true, snapshot: snap });
          return;
        }

        sendJson(res, 404, { ok: false, error: 'Not Found' });
      } catch (err) {
        sendJson(res, 400, { ok: false, error: err?.message || '请求处理异常' });
      }
    });

    return await new Promise((resolve) => {
      const onErr = () => {
        embeddedServer = null;
        resolve({ active: false, reason: 'listen_error', port: boundPort });
      };
      server.once('error', onErr);
      server.listen(configuredPort, host, () => {
        server.off('error', onErr);
        embeddedServer = server;
        const addr = server.address();
        boundPort = typeof addr === 'object' && addr ? addr.port : configuredPort;
        if (enableBonjour) {
          bonjourHandle = startBonjour({
            port: boundPort,
            deviceName: cfg.deviceName,
            lanUrl: currentLanUrls()[0] || '',
            fingerprint: computeTokenFingerprint(cfg.bearerToken),
          });
        }
        heartbeatTimer = setInterval(() => {
          for (const client of sseClients) {
            try {
              client.write(`event: ping\ndata: {"ts":${Date.now()}}\n\n`);
            } catch {
              sseClients.delete(client);
            }
          }
        }, 20_000);
        heartbeatTimer.unref?.();
        resolve({ active: true, port: boundPort });
      });
    });
  }

  async function ensureStarted() {
    if (isClosed()) return { active: false };
    if (startingPromise) return startingPromise;
    startingPromise = (async () => {
      const ext = await probeExternalBridge();
      if (ext?.ok) return { active: true, mode: 'external', port: ext.port || configuredPort };
      if (!embeddedEnabled) return { active: false, mode: 'disabled' };
      const res = await startEmbeddedServer();
      return { ...res, mode: 'embedded' };
    })().finally(() => {
      startingPromise = null;
    });
    return startingPromise;
  }

  async function summary() {
    const cfg = loadOrCreateConfig();
    if (allowLoopbackProbe && !embeddedServer) {
      await probeExternalBridge();
    }
    const lanUrls = currentLanUrls();
    const pairedCount = Math.max(
      Number(cfg.pairedCount || 0),
      Number(externalHealth?.pairedCount || 0)
    );
    const paired = Boolean(cfg.lastPairedAt || pairedCount > 0 || externalHealth?.paired);
    return {
      available: true,
      deviceName: cfg.deviceName,
      port: boundPort || cfg.port,
      paired,
      pairedCount,
      lastPairedAt: cfg.lastPairedAt || externalHealth?.lastPairedAt || null,
      lastPairedDevice: cfg.lastPairedDevice || null,
      tunnelReady: Boolean(cfg.remoteUrl || externalHealth?.tunnelReady),
      bridgeActive: Boolean(embeddedServer || externalHealth?.ok),
      lanUrl: lanUrls[0] || externalHealth?.lanUrl || null,
    };
  }

  async function pairInfo({ rotate = false } = {}) {
    if (isClosed()) {
      return { ok: false, code: 'CLOSED', error: 'Dot 正在关闭，无法读取手机配对码。' };
    }
    const ext = await probeExternalBridge();
    if (!ext?.ok && embeddedEnabled && !embeddedServer) {
      await startEmbeddedServer();
    }
    const cfg = loadOrCreateConfig({ rotate });
    if (ext?.ok && allowLoopbackProbe && typeof fetchImpl === 'function') {
      const probePort = configuredPort > 0 ? configuredPort : cfg.port;
      fetchImpl(`http://127.0.0.1:${probePort}/api/pair/request-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ silent: true }),
        signal: AbortSignal.timeout(450),
      }).catch(() => {});
    }
    const lanUrls = currentLanUrls();
    const lanUrl = lanUrls[0] || `http://127.0.0.1:${boundPort || cfg.port}`;
    const qrUrl = buildMobilePairUrl({
      pin: cfg.pairingPin,
      lanUrl,
      remoteUrl: cfg.remoteUrl,
      deviceName: cfg.deviceName,
    });
    const { qrViewBox, qrPathD } = extractQrSvgParts(qrUrl);
    const pairedCount = Math.max(Number(cfg.pairedCount || 0), Number(ext?.pairedCount || 0));
    const paired = Boolean(cfg.lastPairedAt || pairedCount > 0 || ext?.paired);
    return {
      ok: true,
      pair: {
        pin: cfg.pairingPin,
        pinFormatted: `${cfg.pairingPin.slice(0, 3)} · ${cfg.pairingPin.slice(3)}`,
        expiresAt: cfg.pinExpiresAt,
        deviceName: cfg.deviceName,
        port: boundPort || cfg.port,
        lanUrl,
        remoteUrl: cfg.remoteUrl || null,
        tunnelReady: Boolean(cfg.remoteUrl || ext?.tunnelReady),
        bridgeActive: Boolean(embeddedServer || ext?.ok),
        paired,
        pairedCount,
        qrUrl,
        qrViewBox,
        qrPathD,
      },
    };
  }

  async function dispose() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    try {
      bonjourHandle.stop();
    } catch {
      // Ignore
    }
    for (const client of sseClients) {
      try {
        client.end();
      } catch {
        // Ignore
      }
    }
    sseClients.clear();
    if (embeddedServer) {
      const s = embeddedServer;
      embeddedServer = null;
      await new Promise((resolve) => s.close(() => resolve()));
    }
  }

  if (shouldAutoStart && !isClosed()) {
    void ensureStarted();
  }

  return {
    ensureStarted,
    summary,
    pairInfo,
    notifyChange: broadcastSnapshot,
    dispose,
    getBoundPort: () => boundPort,
  };
}
