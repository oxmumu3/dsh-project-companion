import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';

// Public address facts only. All fetching/parsing below is independently written.
export const NEWS_FEEDS = Object.freeze(JSON.parse(readFileSync(new URL('../assets/news-feeds.json', import.meta.url), 'utf8')).map(Object.freeze));
const MAX_BYTES = 512 * 1024;
const REQUEST_MS = 8000;
const RUN_MS = 45000;
const MAX_ARTICLE_TEXT = 24 * 1024;
const USER_AGENT = 'DSH-Project-Companion/AI-Digest';
const digest = value => createHash('sha256').update(value).digest('hex');
const abortError = () => Object.assign(new Error('News fetch aborted'), { name: 'AbortError' });
const timeoutError = () => Object.assign(new Error('News source timed out'), { name: 'TimeoutError' });

function checkAbort(signal) {
  if (signal?.aborted) throw abortError();
}

function withAbort(promise, signal) {
  checkAbort(signal);
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const aborted = () => reject(signal.reason?.name === 'TimeoutError' ? timeoutError() : abortError());
    signal.addEventListener('abort', aborted, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
  });
}

function ipv6Number(address) {
  if (address.includes('.') || address.includes('%')) return null;
  const split = address.toLowerCase().split('::');
  if (split.length > 2) return null;
  const left = split[0] ? split[0].split(':') : [];
  const right = split[1] ? split[1].split(':') : [];
  const chunks = split.length === 1 ? left : [...left, ...Array(8 - left.length - right.length).fill('0'), ...right];
  if (chunks.length !== 8 || chunks.some(x => !/^[0-9a-f]{1,4}$/.test(x))) return null;
  return chunks.reduce((value, part) => (value << 16n) | BigInt(parseInt(part, 16)), 0n);
}

function publicAddress(address) {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
  }
  if (isIP(address) !== 6) return false;
  const n = ipv6Number(address);
  if (n === null || (n >> 125n) !== 1n) return false; // Only global-unicast 2000::/3.
  return (n >> 105n) !== (0x20010000000000000000000000000000n >> 105n)
    && (n >> 112n) !== 0x2002n
    && (n >> 96n) !== 0x20010db8n
    && (n >> 108n) !== 0x3fff0n;
}

function allowedHosts(feed) {
  const hosts = new Set();
  for (const field of ['xmlUrl', 'htmlUrl']) {
    const host = new URL(feed[field]).hostname.toLowerCase();
    hosts.add(host);
    hosts.add(host.startsWith('www.') ? host.slice(4) : `www.${host}`);
  }
  return hosts;
}

function safeURL(value, hosts, base) {
  const url = new URL(value, base);
  const host = url.hostname.toLowerCase();
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || (url.port && !((url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443'))) || isIP(host.replace(/^\[|\]$/g, '')) || !hosts.has(host) || /(?:^|\.)(?:localhost|local|internal|home|lan)$/.test(host)) throw new Error('Unsafe or unknown news destination');
  url.hash = '';
  return url;
}

async function resolvePublic(hostname, lookup, signal) {
  const result = await withAbort(Promise.resolve().then(() => lookup(hostname, { all: true, verbatim: true })), signal);
  const addresses = Array.isArray(result) ? result : [result];
  if (!addresses.length || addresses.some(x => !x || !publicAddress(x.address) || ![4, 6].includes(x.family))) throw new Error('News DNS address is not public');
  return addresses;
}

// Pin the checked address into the socket lookup. A later DNS change cannot
// redirect this request into a private network. Host/SNI remain the original host.
function pinnedRequest(url, addresses, signal) {
  return new Promise((resolve, reject) => {
    const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = request(url, {
      method: 'GET', signal, agent: false,
      headers: { 'user-agent': USER_AGENT, accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html, text/plain;q=0.8', 'accept-encoding': 'identity' },
      lookup(_hostname, options, callback) {
        if (options?.all) callback(null, addresses);
        else callback(null, addresses[0].address, addresses[0].family);
      },
    }, res => {
      const chunks = [];
      let size = 0;
      const encoded = res.headers['content-encoding'];
      if (encoded && encoded !== 'identity') {
        res.destroy();
        reject(new Error('Unsupported encoded news response'));
        return;
      }
      res.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_BYTES) {
          res.destroy(new Error('News response exceeds byte limit'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('error', reject);
      res.on('end', () => {
        try {
          const headers = new Headers();
          for (const [name, value] of Object.entries(res.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : String(value));
          const body = [204, 205, 304].includes(res.statusCode) ? null : Buffer.concat(chunks);
          resolve(new Response(body, { status: res.statusCode, headers }));
        } catch (error) {
          // This callback runs after request() has returned; construction errors
          // must reject the owned promise, never become host-level exceptions.
          reject(error);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function boundedBody(response, signal) {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > MAX_BYTES) throw new Error('News response exceeds byte limit');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await withAbort(reader.read(), signal);
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) throw new Error('News response exceeds byte limit');
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readURL(value, feed, options = {}) {
  checkAbort(options.signal);
  const controller = new AbortController();
  const outerAbort = () => controller.abort(abortError());
  options.signal?.addEventListener('abort', outerAbort, { once: true });
  const timer = setTimeout(() => controller.abort(timeoutError()), REQUEST_MS);
  const signal = controller.signal;
  const hosts = allowedHosts(feed);
  let url = safeURL(value, hosts);
  try {
    for (let redirects = 0; redirects <= 3; redirects++) {
      const addresses = await resolvePublic(url.hostname, options.lookup || dnsLookup, signal);
      const response = await withAbort(options.fetch
        ? options.fetch(url.href, { redirect: 'manual', signal, headers: { 'user-agent': USER_AGENT, 'accept-encoding': 'identity' } })
        : pinnedRequest(url, addresses, signal), signal);
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        void response.body?.cancel().catch(() => {});
        if (redirects === 3 || !response.headers.get('location')) throw new Error('News redirect limit exceeded');
        url = safeURL(response.headers.get('location'), hosts, url);
        continue;
      }
      if (!response.ok) throw new Error(`News HTTP ${response.status}`);
      const type = response.headers.get('content-type')?.split(';')[0].toLowerCase() || '';
      const text = await boundedBody(response, signal);
      return { text, type, url: url.href };
    }
    throw new Error('News redirect limit exceeded');
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', outerAbort);
  }
}

function entities(value) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (whole, key) => {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
    if (!key.startsWith('#')) return named[key.toLowerCase()];
    const number = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
    return number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff) ? String.fromCodePoint(number) : ' ';
  });
}

const NAME_START = /[a-z_]/i;
const NAME_CHAR = /[a-z\d_:.-]/i;
const SPACE = /\s/;
const BLOCKED_HTML = new Set(['script', 'style', 'noscript', 'svg', 'nav', 'header', 'footer']);

// Monotonic scanning only: never retry a missing closing tag at every later
// opening tag. Limits bound both malformed input and otherwise valid tag floods.
function markup(text, strict = false) {
  const tokens = [];
  let position = 0;
  while (position < text.length) {
    const start = text.indexOf('<', position);
    if (start < 0) break;
    if (tokens.length >= 12000) throw new Error('News markup token limit exceeded');
    let stop, kind, name = '';
    if (text.startsWith('<!--', start)) {
      stop = text.indexOf('-->', start + 4);
      if (stop < 0) throw new Error('Unclosed news comment');
      stop += 3;
      kind = 'comment';
    } else if (text.startsWith('<![CDATA[', start)) {
      stop = text.indexOf(']]>', start + 9);
      if (stop < 0) throw new Error('Unclosed news CDATA');
      stop += 3;
      kind = 'cdata';
    } else if (text.startsWith('<?', start)) {
      stop = text.indexOf('?>', start + 2);
      if (stop < 0) throw new Error('Unclosed news processing instruction');
      stop += 2;
      kind = 'instruction';
    } else {
      let cursor = start + 1;
      kind = text[cursor] === '/' ? 'close' : 'open';
      if (kind === 'close') cursor++;
      if (text[cursor] === '!') {
        if (strict) throw new Error('Unsafe news XML declaration');
        kind = 'declaration';
        cursor++;
      } else {
        if (!NAME_START.test(text[cursor] || '')) {
          if (strict) throw new Error('Malformed news markup');
          position = start + 1;
          continue;
        }
        const nameStart = cursor++;
        while (cursor < text.length && NAME_CHAR.test(text[cursor])) cursor++;
        name = text.slice(nameStart, cursor).toLowerCase();
        if (cursor < text.length && !SPACE.test(text[cursor]) && !['/', '>'].includes(text[cursor])) {
          if (strict) throw new Error('Malformed news tag');
          position = cursor;
          continue;
        }
      }
      let quote;
      while (cursor < text.length && cursor - start <= 8192) {
        const character = text[cursor++];
        if (quote) { if (character === quote) quote = undefined; }
        else if (character === '"' || character === "'") quote = character;
        else if (character === '>') { stop = cursor; break; }
      }
      if (stop === undefined) throw new Error('Unclosed or oversized news tag');
    }
    tokens.push({ start, end: stop, kind, name, selfClosing: kind === 'open' && text[stop - 2] === '/' });
    position = stop;
  }
  if (strict) {
    const stack = [];
    for (const token of tokens) {
      if (token.kind === 'open' && !token.selfClosing) {
        stack.push(token.name);
        if (stack.length > 128) throw new Error('News XML nesting limit exceeded');
      } else if (token.kind === 'close' && stack.pop() !== token.name) throw new Error('Mismatched news XML tag');
    }
    if (stack.length) throw new Error('Unclosed news XML tag');
  }
  return tokens;
}

function element(text, tokens, names) {
  for (const rawName of names) {
    const name = rawName.toLowerCase();
    const index = tokens.findIndex(token => token.kind === 'open' && token.name === name);
    if (index < 0) continue;
    const opening = tokens[index];
    if (opening.selfClosing) return '';
    let depth = 1;
    for (let i = index + 1; i < tokens.length; i++) {
      const token = tokens[i];
      if (token.name !== name) continue;
      if (token.kind === 'open' && !token.selfClosing) depth++;
      else if (token.kind === 'close' && --depth === 0) return text.slice(opening.end, token.start);
    }
    throw new Error('Unclosed news element');
  }
  return '';
}

function unwrapCDATA(text) {
  const parts = [];
  let position = 0;
  while (position < text.length) {
    const start = text.indexOf('<![CDATA[', position);
    if (start < 0) { parts.push(text.slice(position)); break; }
    const end = text.indexOf(']]>', start + 9);
    if (end < 0) throw new Error('Unclosed news CDATA');
    parts.push(text.slice(position, start), text.slice(start + 9, end));
    position = end + 3;
  }
  return parts.join('');
}

function plain(value) {
  const text = entities(entities(unwrapCDATA(String(value))));
  const tokens = markup(text);
  const parts = [];
  let position = 0, blocked = '', depth = 0;
  for (const token of tokens) {
    if (!blocked) parts.push(text.slice(position, token.start), ' ');
    if (token.kind === 'open' && !token.selfClosing && ((!blocked && BLOCKED_HTML.has(token.name)) || blocked === token.name)) {
      blocked = token.name;
      depth++;
    } else if (token.kind === 'close' && token.name === blocked && --depth === 0) blocked = '';
    position = token.end;
  }
  if (!blocked) parts.push(text.slice(position));
  return parts.join('').replace(/[<>]/g, ' ').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
}

function attributes(tag) {
  const result = {};
  let position = 1;
  while (position < tag.length && NAME_CHAR.test(tag[position])) position++;
  while (position < tag.length) {
    while (position < tag.length && !NAME_START.test(tag[position])) position++;
    if (position >= tag.length) break;
    const start = position++;
    while (position < tag.length && NAME_CHAR.test(tag[position])) position++;
    const name = tag.slice(start, position).toLowerCase();
    while (position < tag.length && SPACE.test(tag[position])) position++;
    if (tag[position] !== '=') continue;
    position++;
    while (position < tag.length && SPACE.test(tag[position])) position++;
    const quote = tag[position];
    if (quote !== '"' && quote !== "'") {
      while (position < tag.length && !SPACE.test(tag[position]) && tag[position] !== '>') position++;
      continue;
    }
    const valueStart = ++position;
    const end = tag.indexOf(quote, position);
    if (end < 0) throw new Error('Unclosed news attribute');
    result[name] = entities(tag.slice(valueStart, end));
    position = end + 1;
  }
  return result;
}

function canonicalURL(value, feed, base) {
  const url = safeURL(entities(value.trim()), allowedHosts(feed), base);
  for (const key of [...url.searchParams.keys()]) if (/^utm_/i.test(key) || ['fbclid', 'gclid', 'mc_cid', 'mc_eid'].includes(key)) url.searchParams.delete(key);
  return url.href;
}

function parseFeed(text, feed, base) {
  const tokens = markup(text, true);
  if (!['rss', 'feed', 'rdf:rdf'].includes(tokens.find(token => token.kind === 'open')?.name)) throw new Error('Unsupported news XML root');
  const rows = [];
  let entry;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!['item', 'entry'].includes(token.name)) continue;
    if (token.kind === 'open') {
      if (entry) throw new Error('Nested news entry');
      if (!token.selfClosing) entry = { name: token.name, index: i };
      continue;
    }
    if (token.kind !== 'close' || !entry || token.name !== entry.name) continue;
    if (rows.length >= 200) break;
    const fields = tokens.slice(entry.index + 1, i);
    const field = names => element(text, fields, names);
    let rawURL = '';
    if (entry.name === 'entry') {
      const links = fields.filter(x => x.kind === 'open' && x.name === 'link').map(x => attributes(text.slice(x.start, x.end)));
      rawURL = links.find(x => (!x.rel || x.rel === 'alternate') && (!x.type || x.type === 'text/html'))?.href || '';
    } else rawURL = field(['link']) || field(['guid']);
    const title = plain(field(['title'])).slice(0, 300);
    const date = new Date(plain(field(['pubDate', 'published', 'updated', 'dc:date'])));
    let url;
    try { url = canonicalURL(unwrapCDATA(rawURL), feed, base); } catch { url = null; }
    rows.push({ id: url ? digest(url) : null, title, url, publishedAt: Number.isFinite(date.getTime()) ? date.toISOString() : null, sourceName: feed.name, sourceUrl: feed.htmlUrl, excerpt: plain(field(['content:encoded', 'description', 'summary', 'content'])).slice(0, 800) });
    entry = undefined;
  }
  return rows;
}

function knownFeed(value) {
  return NEWS_FEEDS.find(x => x.xmlUrl === value?.xmlUrl && x.htmlUrl === value?.htmlUrl && x.name === value?.name);
}

export async function fetchNewsCandidates({ feeds = NEWS_FEEDS, hours = 24, now = new Date(), fetch, lookup, signal } = {}) {
  checkAbort(signal);
  const timestamp = new Date(now).getTime();
  if (!Array.isArray(feeds) || feeds.length > NEWS_FEEDS.length || feeds.some(x => !knownFeed(x)) || new Set(feeds.map(x => x.xmlUrl)).size !== feeds.length) throw new Error('Only known news feed sources are allowed');
  if (!Number.isFinite(hours) || hours <= 0 || hours > 168 || !Number.isFinite(timestamp)) throw new Error('Invalid news time window');
  // The bounded scan must not always starve the same tail of the fixed list.
  // Rotate only priority, once per UTC day; source facts and safety stay fixed.
  const offset = feeds.length ? ((Math.floor(timestamp / 86400000) % feeds.length) + feeds.length) % feeds.length : 0;
  const scanFeeds = [...feeds.slice(offset), ...feeds.slice(0, offset)];
  const results = Array.from({ length: feeds.length }, () => ({ rows: [], failed: true, skipped: true }));
  const warnings = [];
  const deadline = new AbortController();
  const deadlineTimer = setTimeout(() => deadline.abort(timeoutError()), RUN_MS);
  const runSignal = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
  let next = 0;
  try {
    await Promise.all(Array.from({ length: Math.min(4, feeds.length) }, async () => {
      while (next < feeds.length) {
        checkAbort(signal);
        if (deadline.signal.aborted) break;
        const index = next++;
        const feed = knownFeed(scanFeeds[index]);
        try {
          const body = await readURL(feed.xmlUrl, feed, { fetch, lookup, signal: runSignal });
          if (body.type && !/(?:xml|rss|atom|text\/plain)/.test(body.type)) throw new Error('Unsupported news feed content type');
          results[index] = { rows: parseFeed(body.text, feed, body.url) };
        } catch (error) {
          checkAbort(signal);
          results[index] = { rows: [], failed: true };
          warnings.push(`${feed.name}: source unavailable or rejected`);
        }
      }
    }));
  } finally {
    clearTimeout(deadlineTimer);
  }
  checkAbort(signal);
  if (deadline.signal.aborted) warnings.push('The 45-second source scan deadline was reached; successful sources were retained and remaining sources were skipped.');
  const rows = results.flatMap(x => x.rows);
  const cutoff = timestamp - hours * 3600000;
  const unique = new Map();
  for (const row of rows) if (row.url && row.title && row.publishedAt && Date.parse(row.publishedAt) >= cutoff && Date.parse(row.publishedAt) <= timestamp && !unique.has(row.url)) unique.set(row.url, row);
  const eligible = [...unique.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const articles = eligible.slice(0, 100);
  if (articles.length < 10) warnings.push(`Only ${articles.length} dated articles in the ${hours}h window; do not invent or pad to 10.`);
  if (eligible.length > 100) warnings.push('Candidates capped at the 100 most recent dated articles.');
  return { articles, stats: { totalFeeds: feeds.length, succeededFeeds: results.filter(x => !x.failed).length, failedFeeds: results.filter(x => x.failed).length, skippedFeeds: results.filter(x => x.skipped).length, totalArticles: rows.length, eligibleArticles: eligible.length }, warnings };
}

export async function readNewsArticle(article, { fetch, lookup, signal } = {}) {
  checkAbort(signal);
  const fallback = warning => ({ article, content: plain(article?.excerpt || '').slice(0, 800), coverage: 'feed-only', truncated: false, warning });
  try {
    const feed = NEWS_FEEDS.find(x => x.name === article?.sourceName && x.htmlUrl === article?.sourceUrl);
    if (!feed || typeof article.url !== 'string' || article.id !== digest(canonicalURL(article.url, feed))) throw new Error('Unknown news article');
    const body = await readURL(article.url, feed, { fetch, lookup, signal });
    if (body.type && !['text/html', 'application/xhtml+xml', 'text/plain'].includes(body.type)) throw new Error('Unsupported news article content type');
    const main = element(body.text, markup(body.text), ['article', 'main']) || body.text;
    const content = plain(main);
    if (content.length < 100) throw new Error('Insufficient article text');
    return { article, content: content.slice(0, MAX_ARTICLE_TEXT), coverage: 'article', truncated: content.length > MAX_ARTICLE_TEXT };
  } catch (error) {
    checkAbort(signal);
    return fallback('Original article unavailable or rejected; only the RSS excerpt was read.');
  }
}
