import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { URL } from 'node:url';
import { promisify } from 'node:util';
import packageManifest from '../package.json' with { type: 'json' };
import { qrSvgFor } from '../vendor/dsh-wechat/dist/qr.js';
import {
  asArray, cleanWireText, projectCarousel, projectConnectorLedger, projectDossier, projectMemoryItem, projectMessages,
  projectRoutine, projectSchedule, stringifyWire,
} from './mobile-wire.js';

const execFileAsync = promisify(execFile);

export const DEFAULT_MOBILE_PORT = 58471;
export const MOBILE_PIN_TTL_MS = 15 * 60 * 1000;
const UNDO_TTL_MS = 12_000;

function cleanDeviceName(raw = os.hostname()) {
  const cleaned = String(raw || 'Mac')
    .replace(/\.local$/i, '')
    .replace(/[^a-zA-Z0-9\u4e00-\u9fa5 _.-]/g, ' ')
    .trim();
  return cleaned || 'MacBook';
}

export function sanitizeForMobile(text, fallback = '') {
  if (typeof text !== 'string') return fallback;
  const out = cleanWireText(text)
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, '')
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
  const body = stringifyWire(payload);
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
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid JSON body');
        resolve(value);
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
  const embeddedStatePath = stateDir ? path.join(stateDir, 'embedded-v10-state.json') : null;
  const now = options.clock || (() => new Date());

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
  let embeddedState = { reminders: [], memoryItems: [], messages: [] };
  if (embeddedStatePath && fs.existsSync(embeddedStatePath)) {
    const stored = JSON.parse(fs.readFileSync(embeddedStatePath, 'utf8'));
    embeddedState = {
      reminders: asArray(stored?.reminders),
      memoryItems: asArray(stored?.memoryItems),
      messages: asArray(stored?.messages),
    };
  }
  function writeEmbeddedState(patch) {
    const next = { ...embeddedState, ...patch };
    if (embeddedStatePath) atomicWriteJson(embeddedStatePath, next);
    embeddedState = next;
  }

  const mobileState = {
    dismissedCardIds: new Set(),
    deferredCards: [],
    appleCalendarItems: [],
    applePermissions: {},
    rhythm: {
      mode: 'normal',
      morningTime: '08:30',
      delayedMorningTime: '09:45',
      calendarAuthorized: false,
      remindersAuthorized: false,
      healthRhythmEnabled: false,
      focusFilterEnabled: false,
    },
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
  const chatQueues = new Map();
  const completedChat = new Map();

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

  async function readLiveState() {
    try {
      return (await options.readLiveState?.()) ?? {};
    } catch {
      return {};
    }
  }

  function connectorLedger(live) {
    return projectConnectorLedger(live.connectors, {
      bridgeActive: Boolean(embeddedServer || externalHealth?.ok),
      workspaces: live.workspaceBrief?.workspaces,
    });
  }

  async function readConnectorLedger() {
    if (typeof options.readConnectors === 'function') return connectorLedger({ connectors: await options.readConnectors() });
    return connectorLedger(await readLiveState());
  }

  async function buildSnapshot() {
    const cfg = loadOrCreateConfig();
    const live = await readLiveState();
    const date = new Date(now());
    const nowIso = date.toISOString();
    const hour = date.getHours();
    const greeting = hour < 11 ? '早安' : hour < 14 ? '午安' : hour < 18 ? '下午好' : '晚上好';

    // Older callers supplied SuperAgent milestones without a native ledger.
    const sessions = Array.isArray(live.sessions) ? live.sessions : asArray(live.superagent?.milestones).filter((row) => {
      const id = row?.id || row?.cardId;
      return !mobileState.dismissedCardIds.has(id) && !mobileState.dismissedCardIds.has(`fc-${id}`);
    });
    const uniqueSessions = new Map();
    for (const row of [...mobileState.dossiers, ...sessions]) {
      const id = row?.id || row?.cardId;
      if (typeof id === 'string' && id) uniqueSessions.set(id, { ...row, id });
    }
    const dossiers = Array.from(uniqueSessions.values(), (row) => projectDossier(row, nowIso));
    const { carouselCards, todayFocus, secondaryQueue } = projectCarousel(dossiers);
    const counts = {
      wait: carouselCards.filter((d) => d.status === 'wait').length,
      run: carouselCards.filter((d) => d.status === 'run').length,
      done: dossiers.filter((d) => d.status === 'done').length,
    };

    const desktopTraits = asArray(live.profile?.traits).filter((row) => row?.id);
    const desktopNotes = asArray(live.profile?.notes).filter((row) => row?.id);
    const legacyTraits = [...desktopTraits, ...mobileState.traits].map((row) => ({
      ...row,
      text: row.value && row.value !== row.label ? `${row.label}：${row.value}` : row.label,
      category: row.category || 'preference',
      provenance: row.provenance || '来自长期偏好',
    }));
    const legacyNotes = [...mobileState.notes, ...desktopNotes].map((row) => ({
      ...row,
      category: row.category || 'note',
      provenance: row.provenance || (row.source === 'wechat' ? '来自微信随记' : '来自随记'),
    }));
    const memoryIndex = new Map();
    for (const row of [...legacyTraits, ...legacyNotes, ...asArray(live.memoryItems ?? live.profile?.memoryItems), ...embeddedState.memoryItems]) {
      if (!row?.id || typeof row.text !== 'string') continue;
      const item = projectMemoryItem(row, nowIso);
      if (item.text) memoryIndex.set(item.id, item);
    }
    const memoryItems = [...memoryIndex.values()].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    const traitIds = new Set(legacyTraits.map((row) => String(row.id)));
    const isTrait = (row) => traitIds.has(row.id) || ['preference', 'boundary', '分寸', '偏好'].includes(row.category);
    const traits = memoryItems.filter(isTrait).map((row) => ({
      id: row.id, label: row.text, category: row.category, active: row.active,
      updatedAt: row.updatedAt, whenToUse: row.effect, source: row.provenance,
    }));
    const notes = memoryItems.filter((row) => !isTrait(row)).map((row) => ({
      id: row.id, text: row.text, source: row.provenance, createdAt: row.updatedAt,
      relativeTime: row.relativeTime, whenToUse: row.effect, active: row.active,
    }));

    const scheduleItems = [...mobileState.appleCalendarItems, ...asArray(live.scheduleItems)].filter(Boolean).map(projectSchedule);
    const routines = asArray(live.routines).filter(Boolean).map(projectRoutine);
    const rhythm = { ...mobileState.rhythm, morningTime: live.digest?.dailyTime || mobileState.rhythm.morningTime };
    const ledger = live.connectors || typeof options.readConnectors !== 'function'
      ? connectorLedger(live)
      : await readConnectorLedger().catch(() => connectorLedger(live));
    const workspaces = ledger.mountedWorkspaces;
    const pending = carouselCards.find((row) => row.status === 'wait');

    return {
      generatedAt: nowIso,
      deviceName: sanitizeForMobile(cfg.deviceName, 'Mac'),
      dshDetected: true,
      greetingTitle: greeting,
      rhythmBanner: pending ? `有 ${counts.wait} 件事待你拍板` : '今天没有待你拍板的事项',
      spokenBriefingText: pending ? `${greeting}。先看一件待你拍板的事：${pending.title}。` : `${greeting}。今天没有待你拍板的事项。`,
      rhythm,
      counts,
      firstAha: {
        headline: `已连接「${sanitizeForMobile(cfg.deviceName, 'Mac')}」`,
        subheadline: '随时查看工作进展、日程和提醒。',
        workspaceCount: workspaces.length,
        workspaceSummary: workspaces.join(' · '),
        activeDossierCount: carouselCards.length,
        pendingDecisionTitle: pending?.title || '今天暂无待你拍板的事项',
        bullets: [],
      },
      todayFocus,
      secondaryQueue,
      carouselCards,
      scheduleItems,
      reminders: embeddedState.reminders,
      dossiers,
      traits,
      notes,
      routines,
      memoryItems,
      ...ledger,
      messages: projectMessages(live.messages ?? embeddedState.messages, nowIso),
    };
  }

  async function broadcastSnapshot(snapshot) {
    if (sseClients.size === 0) return;
    const snap = snapshot ?? await buildSnapshot();
    const frame = `event: snapshot\ndata: ${stringifyWire(snap)}\n\n`;
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

  function fail(status, message) {
    throw Object.assign(new Error(message), { status });
  }

  function issueUndo(restore, scope) {
    const timestamp = Number(now());
    for (const [token, entry] of mobileState.undoHistory) {
      if (entry.expiresAt <= timestamp || (scope && entry.scope === scope)) mobileState.undoHistory.delete(token);
    }
    const undoToken = crypto.randomUUID();
    mobileState.undoHistory.set(undoToken, { restore, scope, expiresAt: timestamp + UNDO_TTL_MS });
    return undoToken;
  }

  function clearAppleReminderUndo() {
    for (const [token, entry] of mobileState.undoHistory) {
      if (entry.scope?.startsWith('reminder:rem-apple-')) mobileState.undoHistory.delete(token);
    }
  }

  async function finishMutation(res, fields = {}) {
    const snapshot = await buildSnapshot();
    void broadcastSnapshot(snapshot);
    sendJson(res, 200, { ok: true, ...fields, snapshot });
  }

  function reminderIdForEvent(eventKitIdentifier) {
    return `rem-apple-${crypto.createHash('sha256').update(eventKitIdentifier).digest('hex').slice(0, 24)}`;
  }

  function mutateReminder(body) {
    const { action, id } = body;
    const reminders = embeddedState.reminders;
    if (action === 'add') {
      const text = sanitizeForMobile(body.text);
      if (!text) fail(400, '请写下提醒内容');
      const eventKitIdentifier = typeof body.eventKitIdentifier === 'string' && body.eventKitIdentifier.trim()
        ? body.eventKitIdentifier.trim() : null;
      const reminder = {
        id: eventKitIdentifier ? reminderIdForEvent(eventKitIdentifier) : `rem-${crypto.randomUUID()}`,
        timeLabel: sanitizeForMobile(body.timeLabel, '随时'),
        text,
        sourceLabel: body.sourceLabel === '随记' ? '随记' : '提醒',
        done: false,
        eventKitIdentifier,
      };
      const duplicate = eventKitIdentifier && reminders.find((row) => row.eventKitIdentifier === eventKitIdentifier);
      if (duplicate) return { reminder: duplicate };
      writeEmbeddedState({ reminders: [...reminders, reminder] });
      const undoToken = issueUndo(() => {
        writeEmbeddedState({ reminders: embeddedState.reminders.filter((row) => row.id !== reminder.id) });
      }, `reminder:${reminder.id}`);
      return { reminder, undoToken };
    }

    if (action !== 'toggle' && action !== 'remove') fail(400, '请选择有效的提醒操作');
    const index = reminders.findIndex((row) => row.id === id);
    if (index === -1) fail(404, '找不到这条提醒');
    const previous = reminders[index];
    const reminder = action === 'toggle' ? { ...previous, done: !previous.done } : null;
    const next = [...reminders];
    next.splice(index, 1, ...(reminder ? [reminder] : []));
    writeEmbeddedState({ reminders: next });
    const undoToken = issueUndo(() => {
      const current = [...embeddedState.reminders];
      const at = current.findIndex((row) => row.id === id);
      if (at !== -1) current.splice(at, 1, previous);
      else current.splice(index, 0, previous);
      writeEmbeddedState({ reminders: current });
    }, `reminder:${id}`);
    return { reminder, undoToken };
  }

  async function mutateMemoryItem(body) {
    const { id, text, active, remove, category, provenance, effect, sourceKind } = body;
    if (id !== undefined && (typeof id !== 'string' || !id)) fail(400, '记忆编号无效');
    if (!id && !sanitizeForMobile(text)) fail(400, '请写下要记住的内容');
    if (active !== undefined && typeof active !== 'boolean') fail(400, '记忆状态无效');
    if (remove !== undefined && (typeof remove !== 'boolean' || (remove && !id))) fail(400, '忘掉记忆需要指定条目');
    if (sourceKind !== undefined && !['chat', 'workspace', 'flomo', 'manual'].includes(sourceKind)) fail(400, '记忆来源无效');
    const fields = {
      ...(id ? { id } : {}),
      ...(text !== undefined ? { text: sanitizeForMobile(text) } : {}),
      ...(category !== undefined ? { category: sanitizeForMobile(category, 'note') } : {}),
      ...(provenance !== undefined ? { provenance: sanitizeForMobile(provenance) } : {}),
      ...(effect !== undefined ? { effect: sanitizeForMobile(effect) } : {}),
      ...(active !== undefined ? { active } : {}),
      ...(remove !== undefined ? { remove } : {}),
      ...(sourceKind !== undefined ? { sourceKind } : {}),
    };

    if (typeof options.onMemoryItem === 'function') {
      const result = await options.onMemoryItem(fields);
      if (result?.ok !== true) fail(400, result?.error || '记忆未更新');
      const token = result.undoToken;
      if (!token || typeof options.onUndoMemory !== 'function') return {};
      return {
        undoToken: issueUndo(async () => {
          const restored = await options.onUndoMemory({ undoToken: token });
          if (restored?.ok !== true) fail(409, restored?.error || '记忆已变更');
        }, id ? `memory:${id}` : undefined),
      };
    }

    const index = embeddedState.memoryItems.findIndex((row) => row.id === id);
    if (id && index === -1) fail(404, '找不到这条记忆');
    const previous = embeddedState.memoryItems[index];
    const memoryId = id || `mem-${crypto.randomUUID()}`;
    const { remove: _remove, ...patch } = fields;
    const nowIso = new Date(now()).toISOString();
    const item = remove ? null : projectMemoryItem({
      ...previous, ...patch, id: memoryId, updatedAt: nowIso, relativeTime: '刚刚',
    }, nowIso);
    if (item && !item.text) fail(400, '请写下要记住的内容');
    const memoryItems = [...embeddedState.memoryItems];
    if (index === -1) memoryItems.unshift(item);
    else memoryItems.splice(index, 1, ...(item ? [item] : []));
    writeEmbeddedState({ memoryItems });
    const undoToken = issueUndo(() => {
      const current = [...embeddedState.memoryItems];
      const at = current.findIndex((row) => row.id === memoryId);
      if (at !== -1) current.splice(at, 1, ...(previous ? [previous] : []));
      else if (previous) current.splice(index, 0, previous);
      writeEmbeddedState({ memoryItems: current });
    }, `memory:${memoryId}`);
    return { undoToken };
  }

  async function readDossier(id) {
    if (typeof options.readSession === 'function') {
      const row = await options.readSession(id);
      if (row?.id === id) return projectDossier(row, new Date(now()).toISOString());
      const local = mobileState.dossiers.find((row) => row.id === id);
      return local ? projectDossier(local, new Date(now()).toISOString()) : null;
    }
    return (await buildSnapshot()).dossiers.find((row) => row.id === id) ?? null;
  }

  async function mutateDossier(id, body) {
    const local = mobileState.dossiers.find((row) => row.id === id);
    const dossier = await readDossier(id);
    if (!dossier) fail(404, '找不到这个会话');
    const action = body.action;
    const scope = `dossier:${id}`;
    if ((action === 'complete' && dossier.archived) || (action === 'reopen' && !dossier.archived)) return {};
    let checked = body.checked;
    if (action === 'toggle_checklist') {
      const item = dossier.checklist.find((row) => row.id === body.itemId);
      if (!item || dossier.archived) fail(404, '找不到可勾选的步骤');
      if (typeof checked !== 'boolean') checked = !item.checked;
    }
    if (!local) {
      if (typeof options.onDossierAct !== 'function') fail(503, '这个会话目前无法更新');
      const result = await options.onDossierAct({
        id,
        action,
        ...(typeof body.itemId === 'string' ? { itemId: body.itemId } : {}),
        ...(typeof checked === 'boolean' ? { checked } : {}),
        ...(typeof body.instruction === 'string' ? { instruction: body.instruction } : {}),
        ...(typeof body.draftText === 'string' ? { draftText: body.draftText } : {}),
      });
      if (result?.ok !== true) fail(409, result?.error || '会话未更新');
      if (action === 'complete' && result.undoState !== undefined) {
        return { undoToken: issueUndo(async () => {
          const restored = await options.onDossierAct({ id, action: 'undo', previous: result.undoState });
          if (restored?.ok !== true) fail(409, restored?.error || '会话已变更');
        }, scope) };
      }
    } else if (action === 'complete') {
      local.archived = true;
      return { undoToken: issueUndo(() => { local.archived = false; }, scope) };
    } else if (action === 'reopen') {
      local.archived = false;
    } else if (action === 'toggle_checklist') {
      local.checklist = local.checklist.map((row) => row.id === body.itemId ? { ...row, checked } : row);
    } else {
      local.summary = sanitizeForMobile(body.instruction || body.draftText || local.summary);
      local.updatedAt = new Date(now()).toISOString();
    }
    if (action === 'reopen') {
      for (const [token, entry] of mobileState.undoHistory) {
        if (entry.scope === scope) mobileState.undoHistory.delete(token);
      }
    }
    return {};
  }

  async function toggleConnector(body) {
    const { id, enabled, contextMode } = body;
    const ledger = await readConnectorLedger();
    const connector = ledger.connectors.find((row) => row.id === id);
    if (!connector) fail(404, '找不到这个连接');
    if (!connector.canToggle || (enabled === true && !connector.connected)) fail(403, '请先在电脑端完成授权');
    if (id === 'workspace_grants') {
      if (!['full_local', 'curated_only'].includes(contextMode) || enabled !== undefined) fail(400, '请选择工作区读取范围');
    } else if (typeof enabled !== 'boolean' || contextMode !== undefined) {
      fail(400, '请选择启用或暂停此连接');
    }
    if (typeof options.onToggleConnector !== 'function') fail(503, '此连接目前无法更新');
    const result = await options.onToggleConnector(id === 'workspace_grants' ? { id, contextMode } : { id, enabled });
    if (result?.ok !== true) fail(409, result?.error || '连接状态未更新');
    return Array.isArray(result.connectors) ? connectorLedger({ connectors: result }) : await readConnectorLedger();
  }

  function syncAppleContext(body) {
    if (body.clear) {
      writeEmbeddedState({ reminders: embeddedState.reminders.filter((row) => !row.eventKitIdentifier) });
      clearAppleReminderUndo();
      mobileState.appleCalendarItems = [];
      mobileState.applePermissions = {};
      mobileState.rhythm.calendarAuthorized = false;
      mobileState.rhythm.remindersAuthorized = false;
      return;
    }
    const legacy = asArray(body.items).filter(Boolean);
    const events = body.events ?? (body.items ? legacy.filter((item) => item.kind !== 'reminder') : null);
    const reminders = body.reminders ?? (body.items ? legacy.filter((item) => item.kind === 'reminder') : null);
    if (Array.isArray(events)) {
      mobileState.appleCalendarItems = events.filter(Boolean).map((row) => ({
        id: row.id,
        timeLabel: row.timeLabel,
        title: row.title,
        subtitle: row.subtitle || row.location || 'iPhone 日历',
        source: 'apple_calendar',
      }));
    }
    if (Array.isArray(reminders) || body.permissions?.reminders === false) {
      const captured = new Map();
      if (body.permissions?.reminders !== false) {
        const previous = new Map(embeddedState.reminders.map((row) => [row.eventKitIdentifier, row]));
        for (const row of asArray(reminders)) {
          const eventKitIdentifier = row?.eventKitIdentifier ?? row?.id;
          const text = sanitizeForMobile(row?.text || row?.title);
          if (typeof eventKitIdentifier !== 'string' || !eventKitIdentifier || !text) continue;
          const prior = previous.get(eventKitIdentifier);
          captured.set(eventKitIdentifier, {
            id: prior?.id || reminderIdForEvent(eventKitIdentifier),
            text,
            timeLabel: sanitizeForMobile(row.dueLabel || row.timeLabel, prior?.timeLabel || '随时'),
            sourceLabel: prior?.sourceLabel || '提醒',
            done: typeof row.done === 'boolean' ? row.done : prior?.done === true,
            eventKitIdentifier,
          });
        }
      }
      writeEmbeddedState({
        reminders: [...embeddedState.reminders.filter((row) => !row.eventKitIdentifier), ...captured.values()],
      });
      if (body.permissions?.reminders === false) clearAppleReminderUndo();
    }
    for (const [grant, field] of [['calendar', 'calendarAuthorized'], ['reminders', 'remindersAuthorized']]) {
      if (typeof body.permissions?.[grant] === 'boolean') {
        mobileState.applePermissions[grant] = body.permissions[grant];
        mobileState.rhythm[field] = body.permissions[grant];
      }
    }
    if (body.permissions?.calendar === false) mobileState.appleCalendarItems = [];
  }

  function appendMainMessage(role, text, fields = {}) {
    const message = { id: `message-${crypto.randomUUID()}`, role, text, createdAt: new Date(now()).toISOString(), ...fields };
    writeEmbeddedState({ messages: [...embeddedState.messages, message].slice(-120) });
  }

  async function streamChat(res, body) {
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) fail(400, '内容不能为空');
    if (body.sessionId != null && typeof body.sessionId !== 'string') fail(400, '会话编号无效');
    const sessionId = body.sessionId?.trim() || null;
    if (sessionId && !await readDossier(sessionId)) fail(404, '找不到这个会话');
    if (typeof options.onStreamChat !== 'function') fail(503, '当前无法打开对话');
    const clientRequestId = typeof body.clientRequestId === 'string' ? body.clientRequestId : null;
    const scope = sessionId || '';
    const cacheKey = clientRequestId ? JSON.stringify([sessionId, clientRequestId]) : null;
    const previous = chatQueues.get(scope);
    const abort = new AbortController();
    res.once('close', () => abort.abort());
    res.writeHead(200, {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no',
    });
    const emit = (obj) => {
      if (!res.destroyed && !res.writableEnded) res.write(stringifyWire(obj) + '\n');
    };
    emit({ type: 'ack', clientRequestId, sessionId });
    const work = (previous ?? Promise.resolve()).then(async () => {
      if (abort.signal.aborted) return;
      const before = sessionId ? await readDossier(sessionId) : null;
      if (sessionId && !before) fail(404, '找不到这个会话');
      let result = cacheKey ? completedChat.get(cacheKey) : null;
      if (result && result.text !== text) fail(409, '此请求编号已经用于另一条消息');
      if (!result) {
        const mainMessages = sessionId ? null : await options.readMainMessages?.();
        result = (await options.onStreamChat({
          sessionId,
          text,
          source: sanitizeForMobile(body.source, 'chat_drawer'),
          clientRequestId,
          scheduleItemId: typeof body.scheduleItemId === 'string' ? body.scheduleItemId : null,
          messages: before?.messages ?? projectMessages(mainMessages ?? embeddedState.messages, new Date(now()).toISOString()),
          signal: abort.signal,
          onEvent: (event) => {
            if (['tool_start', 'tool_done', 'text_delta', 'widgets'].includes(event?.type)) {
              emit({ ...event, ...(typeof event.delta === 'string' ? { delta: cleanWireText(event.delta) } : {}), sessionId });
            }
          },
        })) ?? {};
        if (result.ok === false) fail(409, result.error || '对话未完成');
        if (!sessionId && !Array.isArray(mainMessages)) {
          if (Array.isArray(result.messages)) writeEmbeddedState({ messages: result.messages.slice(-120) });
          else {
            const createdAt = new Date(now()).toISOString();
            const messages = [{ id: `message-${crypto.randomUUID()}`, role: 'user', text, createdAt }];
            if (typeof result.reply === 'string' && result.reply.trim()) {
              messages.push({ id: `message-${crypto.randomUUID()}`, role: 'assistant', text: result.reply, createdAt });
            }
            writeEmbeddedState({ messages: [...embeddedState.messages, ...messages].slice(-120) });
          }
        }
        if (cacheKey) {
          completedChat.set(cacheKey, { text, reply: result.reply, widgets: result.widgets });
          if (completedChat.size > 120) completedChat.delete(completedChat.keys().next().value);
        }
      }
      const dossier = sessionId ? await readDossier(sessionId) : null;
      if (sessionId && !dossier) fail(404, '找不到这个会话');
      const snapshot = await buildSnapshot();
      void broadcastSnapshot(snapshot);
      emit({
        type: 'done', ok: true, clientRequestId, sessionId, snapshot,
        ...(dossier ? { dossier } : {}),
        ...(typeof result.reply === 'string' ? { reply: cleanWireText(result.reply) } : {}),
        ...(Array.isArray(result.widgets) ? { widgets: result.widgets } : {}),
      });
    }).catch((error) => {
      emit({ type: 'error', error: error.status ? sanitizeForMobile(error.message) : '对话暂时中断', sessionId });
    });
    chatQueues.set(scope, work);
    await work;
    if (chatQueues.get(scope) === work) chatQueues.delete(scope);
    res.end();
  }

  async function handleCommandBody(body = {}) {
    const text = sanitizeForMobile(String(body.text || ''));
    if (!text) return { ok: false, error: '内容不能为空', snapshot: await buildSnapshot() };
    const nowIso = new Date().toISOString();
    appendMainMessage('user', text);
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
      appendMainMessage('assistant', reply, { tier: 'tier_a' });
      return { ok: true, tier: 'tier_a', reply, snapshot: await buildSnapshot() };
    }
    if (body.confirmTierC !== true && /删|清空|重置|发送邮件|发给|覆盖/.test(text)) {
      const proposal = {
        originalText: text,
        topicTitle: text.slice(0, 32),
        prompt: '涉及对外或高影响动作，请确认后再写入电脑待办台。',
      };
      appendMainMessage('assistant', proposal.prompt, { tier: 'tier_c' });
      return { ok: true, tier: 'tier_c', requiresConfirm: true, proposal, snapshot: await buildSnapshot() };
    }
    if (typeof options.onQueuePending === 'function') {
      await options.onQueuePending({ text, title: text.slice(0, 48) }).catch(() => {});
    }
    const dosId = `dos-${crypto.randomUUID()}`;
    const dossier = {
      id: dosId,
      title: text.slice(0, 48),
      status: 'run',
      statusLabel: '推进中',
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
    appendMainMessage('assistant', reply, { tier: 'tier_b', briefCard });
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
            version: packageManifest.version,
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
          res.write(`event: snapshot\ndata: ${stringifyWire(snap)}\n\n`);
          sseClients.add(res);
          res.on('close', () => sseClients.delete(res));
          return;
        }

        const sessionMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/);
        if (req.method === 'GET' && sessionMatch) {
          const dossier = await readDossier(decodeURIComponent(sessionMatch[1]));
          if (!dossier) fail(404, '找不到这个会话');
          sendJson(res, 200, { ok: true, dossier, messages: dossier.messages });
          return;
        }

        if (req.method === 'GET' && pathname === '/api/connectors') {
          sendJson(res, 200, { ok: true, ...await readConnectorLedger() });
          return;
        }

        if (req.method === 'POST' && pathname === '/api/chat/stream') {
          await streamChat(res, await readJsonBody(req));
          return;
        }

        if (req.method === 'POST' && pathname === '/api/reminders') {
          await finishMutation(res, mutateReminder(await readJsonBody(req)));
          return;
        }

        if (req.method === 'POST' && pathname === '/api/connectors/toggle') {
          await finishMutation(res, await toggleConnector(await readJsonBody(req)));
          return;
        }

        if (req.method === 'POST' && pathname === '/api/today/act') {
          const body = await readJsonBody(req);
          const cardId = String(body?.cardId || '');
          if (cardId && (body.action === 'complete' || body.action === 'reopen')) {
            const id = cardId.startsWith('fc-') ? cardId.slice(3) : cardId;
            await finishMutation(res, await mutateDossier(id, body));
            return;
          }
          if (cardId) mobileState.dismissedCardIds.add(cardId);
          const undoToken = issueUndo(() => mobileState.dismissedCardIds.delete(cardId), `card:${cardId}`);
          await finishMutation(res, { undoToken });
          return;
        }

        if (req.method === 'POST' && pathname === '/api/undo') {
          const body = await readJsonBody(req);
          const token = String(body?.undoToken || '');
          const item = mobileState.undoHistory.get(token);
          mobileState.undoHistory.delete(token);
          if (item && item.expiresAt > Number(now())) {
            await item.restore();
            await finishMutation(res);
            return;
          }
          sendJson(res, 409, { ok: false, error: '撤回窗口已过', snapshot: await buildSnapshot() });
          return;
        }

        const dossierMatch = pathname.match(/^\/api\/dossiers\/([^/]+)\/act$/);
        if (req.method === 'POST' && dossierMatch) {
          const id = decodeURIComponent(dossierMatch[1]);
          const result = await mutateDossier(id, await readJsonBody(req));
          await finishMutation(res, { ...result, dossier: await readDossier(id) });
          return;
        }

        if (req.method === 'POST' && pathname === '/api/widgets/act') {
          const { dossierId, action, itemId } = await readJsonBody(req);
          if (action !== 'checklist_toggle' || typeof dossierId !== 'string' || typeof itemId !== 'string') {
            fail(400, '找不到可勾选的步骤');
          }
          const result = await mutateDossier(dossierId, { action: 'toggle_checklist', itemId });
          await finishMutation(res, { ...result, dossier: await readDossier(dossierId) });
          return;
        }

        if (req.method === 'POST' && pathname === '/api/command') {
          const body = await readJsonBody(req);
          const out = await handleCommandBody(body);
          void broadcastSnapshot();
          sendJson(res, 200, out);
          return;
        }

        if (req.method === 'POST' && pathname === '/api/memory/items') {
          await finishMutation(res, await mutateMemoryItem(await readJsonBody(req)));
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
          syncAppleContext(await readJsonBody(req));
          await finishMutation(res);
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
        if (res.headersSent) {
          res.end();
          return;
        }
        sendJson(res, err?.status || 400, { ok: false, error: sanitizeForMobile(err?.message, '请求处理异常') });
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
    const { calendar, reminders } = mobileState.applePermissions;
    const iphoneSystem = [];
    if (paired && (calendar !== undefined || reminders !== undefined)) {
      const authorized = [calendar === true && '日历', reminders === true && '提醒'].filter(Boolean);
      const denied = [calendar === false && '日历', reminders === false && '提醒'].filter(Boolean);
      iphoneSystem.push({
        id: 'ios_eventkit',
        connected: authorized.length > 0,
        enabled: authorized.length > 0,
        statusText: authorized.length ? `${authorized.join('与')}已授权` : `${denied.join('与')}未授权`,
      });
    }
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
      iphoneSystem,
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
    notifyChange: () => broadcastSnapshot(),
    dispose,
    getBoundPort: () => boundPort,
  };
}
