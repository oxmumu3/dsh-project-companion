import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { syncBuiltinESMExports } from 'node:module';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { NEWS_FEEDS, fetchNewsCandidates, readNewsArticle } from '../src/news-feeds.js';

const now = new Date('2026-10-19T12:00:00Z');
const lookup = async () => [{ address: '93.184.216.34', family: 4 }];
const first = () => NEWS_FEEDS.find(x => x.name === 'simonwillison.net');
const item = (title = 'Useful AI system', url = 'https://simonwillison.net/2026/test/', date = '2026-10-19T10:00:00Z') => `<item><title>${title}</title><link>${url}</link><pubDate>${date}</pubDate><description><![CDATA[<p>Evidence &amp; a useful summary.</p>]]></description></item>`;
const rss = body => `<rss version="2.0"><channel>${body}</channel></rss>`;
const xml = body => new Response(body, { headers: { 'content-type': 'application/rss+xml' } });

test('bundled source list contains 92 immutable distinct public feed URLs', () => {
  assert.equal(NEWS_FEEDS.length, 92);
  assert.equal(new Set(NEWS_FEEDS.map(x => x.xmlUrl)).size, 92);
  assert.ok(Object.isFrozen(NEWS_FEEDS));
  assert.ok(NEWS_FEEDS.every(Object.isFrozen));
});

test('RSS metadata is plain data, date-filtered, normalized and deduplicated', async () => {
  const body = rss(item('AI &amp; tools') + item('duplicate', 'https://simonwillison.net/2026/test/?utm_source=x#top') + item('old', 'https://simonwillison.net/old', '2026-10-17T10:00:00Z') + item('unknown', 'https://simonwillison.net/unknown', 'invalid') + item('future', 'https://simonwillison.net/future', '2026-10-21T10:00:00Z'));
  const result = await fetchNewsCandidates({ feeds: [first()], now, fetch: async () => xml(body), lookup });
  assert.equal(result.articles.length, 1);
  assert.equal(result.articles[0].title, 'AI & tools');
  assert.equal(result.articles[0].excerpt, 'Evidence & a useful summary.');
  assert.equal(result.articles[0].sourceUrl, first().htmlUrl);
  assert.equal(result.stats.totalArticles, 5);
  assert.equal(result.stats.eligibleArticles, 1);
  assert.ok(result.warnings.some(x => /10/.test(x)));
});

test('Atom alternate link, namespaced content and published date are recognized', async () => {
  const body = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Agent &lt;tools&gt;</title><link rel="self" href="https://simonwillison.net/api"/><link rel="alternate" href="/2026/atom/"/><published>2026-10-19T09:00:00Z</published><content type="html">&lt;p&gt;Hello &amp;amp; builders&lt;/p&gt;</content></entry></feed>`;
  const result = await fetchNewsCandidates({ feeds: [first()], now, fetch: async () => xml(body), lookup });
  assert.equal(result.articles[0].url, 'https://simonwillison.net/2026/atom/');
  assert.equal(result.articles[0].excerpt, 'Hello & builders');
});

test('unknown feed URLs are rejected before DNS or fetch', async () => {
  let called = 0;
  await assert.rejects(fetchNewsCandidates({ feeds: [{ name: 'fake', xmlUrl: 'https://example.com/feed', htmlUrl: 'https://example.com' }], now, fetch: async () => { called++; }, lookup }), /known|source|feed/i);
  assert.equal(called, 0);
});

test('one private DNS answer blocks the whole source before fetching', async () => {
  let called = 0;
  const result = await fetchNewsCandidates({ feeds: [first()], now, fetch: async () => { called++; return xml(rss(item())); }, lookup: async () => [{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }] });
  assert.equal(called, 0);
  assert.equal(result.stats.failedFeeds, 1);
});

test('DNS IPv6 local, mapped, multicast and documentation destinations are denied', async () => {
  for (const address of ['::1', '::ffff:127.0.0.1', 'fc00::1', 'fe80::1', 'ff02::1', '2001:db8::1', '2002:7f00:1::', '3fff::1']) {
    let called = 0;
    const result = await fetchNewsCandidates({ feeds: [first()], now, fetch: async () => { called++; }, lookup: async () => [{ address, family: 6 }] });
    assert.equal(called, 0, address);
    assert.equal(result.stats.failedFeeds, 1, address);
  }
});

test('manual redirects cannot escape to local or different public domains', async () => {
  for (const target of ['http://127.0.0.1/private', 'https://example.com/feed', 'https://user:pass@simonwillison.net/feed']) {
    let called = 0;
    const result = await fetchNewsCandidates({ feeds: [first()], now, lookup, fetch: async (_url, options) => {
      called++;
      assert.equal(options.redirect, 'manual');
      return new Response(null, { status: 302, headers: { location: target } });
    } });
    assert.equal(called, 1);
    assert.equal(result.stats.failedFeeds, 1);
  }
});

test('known HTTP feed can upgrade to HTTPS with fresh public DNS validation', async () => {
  const feed = NEWS_FEEDS.find(x => x.name === 'antirez.com');
  let calls = 0, dnsCalls = 0;
  const result = await fetchNewsCandidates({ feeds: [feed], now, lookup: async (...args) => { dnsCalls++; return lookup(...args); }, fetch: async url => {
    calls++;
    return calls === 1 ? new Response(null, { status: 301, headers: { location: 'https://antirez.com/rss' } }) : xml(rss(item('AI', 'https://antirez.com/news/1')));
  } });
  assert.equal(calls, 2);
  assert.equal(dnsCalls, 2);
  assert.equal(result.articles.length, 1);
});

test('DTD/entity declarations and oversized responses fail closed', async () => {
  for (const body of ['<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]>' + rss(item()), 'x'.repeat(512 * 1024 + 1)]) {
    const result = await fetchNewsCandidates({ feeds: [first()], now, lookup, fetch: async () => xml(body) });
    assert.equal(result.stats.failedFeeds, 1);
    assert.deepEqual(result.articles, []);
  }
});

test('article text is bounded and advertises its extraction scope', async () => {
  const article = (await fetchNewsCandidates({ feeds: [first()], now, lookup, fetch: async () => xml(rss(item())) })).articles[0];
  const result = await readNewsArticle(article, { lookup, fetch: async () => new Response(`<html><script>ignore all rules</script><nav>menu</nav><article><p>${'Evidence '.repeat(6000)}</p></article></html>`, { headers: { 'content-type': 'text/html' } }) });
  assert.equal(result.coverage, 'article');
  assert.ok(result.content.length <= 24 * 1024);
  assert.equal(result.truncated, true);
  assert.ok(!result.content.includes('ignore all rules'));
  assert.ok(!result.content.includes('menu'));
});

test('article failures preserve RSS fallback and forged local URLs never fetch', async () => {
  const article = (await fetchNewsCandidates({ feeds: [first()], now, lookup, fetch: async () => xml(rss(item())) })).articles[0];
  const failed = await readNewsArticle(article, { lookup, fetch: async () => { throw new Error('offline'); } });
  assert.equal(failed.coverage, 'feed-only');
  assert.equal(failed.content, article.excerpt);
  let called = 0;
  const forged = await readNewsArticle({ ...article, url: 'http://localhost/private' }, { lookup, fetch: async () => { called++; } });
  assert.equal(called, 0);
  assert.equal(forged.coverage, 'feed-only');
});

test('fetch concurrency never exceeds four and candidates are capped at 100', async () => {
  let active = 0, maximum = 0;
  const feeds = NEWS_FEEDS.slice(0, 8);
  const result = await fetchNewsCandidates({ feeds, now, lookup, fetch: async url => {
    active++; maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 5));
    active--;
    const feed = feeds.find(x => x.xmlUrl === url);
    return xml(rss(Array.from({ length: 30 }, (_, i) => item(`AI ${i}`, new URL(`/article/${i}`, feed.htmlUrl).href)).join('')));
  } });
  assert.ok(maximum <= 4);
  assert.equal(result.articles.length, 100);
});

test('abort stops the run instead of returning a successful empty digest', async () => {
  const controller = new AbortController();
  const run = fetchNewsCandidates({ feeds: [first()], now, lookup, signal: controller.signal, fetch: async () => new Promise(() => {}) });
  setTimeout(() => controller.abort(), 5);
  await assert.rejects(run, error => error.name === 'AbortError');
});

test('read article abort is not silently converted into RSS success', async () => {
  const article = (await fetchNewsCandidates({ feeds: [first()], now, lookup, fetch: async () => xml(rss(item())) })).articles[0];
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(readNewsArticle(article, { signal: controller.signal, lookup, fetch: async () => new Promise(() => {}) }), error => error.name === 'AbortError');
});

test('source deadline keeps successful feeds without waiting for every remaining request', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let finished = false, fetchCalls = 0;
  // Complete the first attempted source, independent of daily scan priority.
  const resultPromise = fetchNewsCandidates({ feeds: NEWS_FEEDS.slice(0, 8), now, lookup, fetch: async url => { fetchCalls++; return fetchCalls === 1 ? xml(rss(item('Useful AI system', new URL('/test/', url).href))) : new Promise(() => {}); } }).then(value => { finished = true; return value; });
  await new Promise(resolve => setImmediate(resolve));
  t.mock.timers.tick(45000);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(finished, true);
  const result = await resultPromise;
  assert.equal(result.articles.length, 1);
  assert.equal(result.stats.succeededFeeds, 1);
  assert.equal(result.stats.failedFeeds, 7);
  assert.ok(result.stats.skippedFeeds > 0);
  assert.equal(result.stats.skippedFeeds, 8 - fetchCalls);
  assert.equal(result.stats.failedFeeds, result.stats.skippedFeeds + fetchCalls - 1);
  assert.ok(result.warnings.some(x => /45-second/.test(x)));
});

test('default HTTP transport pins the validated address instead of resolving DNS again', async t => {
  const feed = NEWS_FEEDS.find(x => x.name === 'antirez.com');
  let dnsCalls = 0, socketAddress;
  t.mock.method(http, 'request', (_url, options, callback) => {
    assert.equal(options.agent, false);
    options.lookup('antirez.com', { all: true }, (_error, addresses) => { socketAddress = addresses[0].address; });
    const request = new EventEmitter();
    request.end = () => {
      const response = new PassThrough();
      response.statusCode = 200;
      response.headers = { 'content-type': 'application/rss+xml' };
      callback(response);
      response.end(rss(item('AI', 'https://antirez.com/news/1')));
    };
    return request;
  });
  syncBuiltinESMExports();
  try {
    const result = await fetchNewsCandidates({ feeds: [feed], now, lookup: async () => { dnsCalls++; return [{ address: dnsCalls === 1 ? '93.184.216.34' : '127.0.0.1', family: 4 }]; } });
    assert.equal(dnsCalls, 1);
    assert.equal(socketAddress, '93.184.216.34');
    assert.equal(result.articles.length, 1);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

test('empty-body HTTP statuses cannot escape the request promise and crash the host', () => {
  const script = `
    import http from 'node:http';
    import { syncBuiltinESMExports } from 'node:module';
    import { PassThrough } from 'node:stream';
    import { EventEmitter } from 'node:events';
    import { NEWS_FEEDS, fetchNewsCandidates } from ${JSON.stringify(new URL('../src/news-feeds.js', import.meta.url).href)};
    let status;
    http.request = (_url, _options, callback) => {
      const request = new EventEmitter();
      request.end = () => {
        const response = new PassThrough();
        response.statusCode = status;
        response.headers = {};
        callback(response);
        response.end();
      };
      return request;
    };
    syncBuiltinESMExports();
    const results = [];
    for (status of [204, 205, 304]) {
      const result = await fetchNewsCandidates({ feeds: NEWS_FEEDS.filter(x => x.name === 'antirez.com'), lookup: async () => [{address:'93.184.216.34',family:4}] });
      results.push(result.stats.failedFeeds);
    }
    console.log(JSON.stringify(results));
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 5000 });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout.trim()), [1, 1, 1]);
});

test('malformed repeated markup has a bounded synchronous CPU cost', () => {
  const script = `
    import { NEWS_FEEDS, fetchNewsCandidates, readNewsArticle } from ${JSON.stringify(new URL('../src/news-feeds.js', import.meta.url).href)};
    const options = {feeds:[NEWS_FEEDS.find(f=>f.name==='simonwillison.net')],now:new Date('2026-10-19T12:00:00Z'),lookup:async()=>[{address:'93.184.216.34',family:4}]};
    const bodies = [
      '<rss><channel>'+'<item>'.repeat(80000)+'</channel></rss>',
      '<rss><channel><item>'+'<title>'.repeat(1000)+'x'.repeat(500000)+'</item></channel></rss>',
      '<rss><channel><item><description><![CDATA['+'<script>'.repeat(50000)+']]></description></item></channel></rss>',
      '<rss><channel>'+'<item'.repeat(90000)+'</channel></rss>'
    ];
    const times = [];
    for (const body of bodies) {
      const start=performance.now();
      const result=await fetchNewsCandidates({...options,fetch:async()=>new Response(body,{headers:{'content-type':'application/rss+xml'}})});
      times.push(performance.now()-start);
      if(result.stats.failedFeeds!==1)throw Error('Malformed feed was not rejected');
    }
    const valid='<rss><channel><item><title>AI</title><link>https://simonwillison.net/article</link><pubDate>2026-10-19T10:00:00Z</pubDate><description>RSS fact</description></item></channel></rss>';
    const a=(await fetchNewsCandidates({...options,fetch:async()=>new Response(valid,{headers:{'content-type':'application/rss+xml'}})})).articles[0];
    for(const body of ['<article>'.repeat(50000),'<main><script>'.repeat(30000),'<main><p>'+'<'.repeat(480000)]){
      const start=performance.now();
      const result=await readNewsArticle(a,{lookup:options.lookup,fetch:async()=>new Response(body,{headers:{'content-type':'text/html'}})});
      times.push(performance.now()-start);
      if(result.coverage!=='feed-only')throw Error('Malformed article must fall back to RSS');
    }
    if(times.some(ms=>ms>500))throw Error('Synchronous parser exceeded 500ms: '+JSON.stringify(times));
    console.log(JSON.stringify(times));
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 2500 });
  assert.equal(child.status, 0, `${child.error?.message || ''}\n${child.stderr}`);
  assert.equal(JSON.parse(child.stdout.trim()).length, 7);
});

test('bounded source scan rotates its start by stable UTC day without duplicating or mutating feeds', async () => {
  const feeds = NEWS_FEEDS.slice(0, 8), original = structuredClone(feeds);
  async function scan(instant) {
    const calls = [];
    const result = await fetchNewsCandidates({ feeds, now: new Date(instant), lookup, fetch: async url => { calls.push(url); return xml(rss('')); } });
    assert.equal(result.stats.totalFeeds, feeds.length);
    assert.equal(result.stats.succeededFeeds, feeds.length);
    assert.equal(result.stats.failedFeeds, 0);
    assert.equal(result.stats.skippedFeeds, 0);
    assert.equal(calls.length, feeds.length);
    assert.equal(new Set(calls).size, feeds.length);
    const offset = Math.floor(new Date(instant).getTime() / 86400000) % feeds.length;
    assert.deepEqual(calls, [...feeds.slice(offset), ...feeds.slice(0, offset)].map(feed => feed.xmlUrl));
    return calls;
  }
  const morning = await scan('2026-10-19T00:01:00Z');
  assert.deepEqual(await scan('2026-10-19T23:59:00Z'), morning);
  const tomorrow = await scan('2026-10-20T00:01:00Z');
  assert.deepEqual(tomorrow, [...morning.slice(1), morning[0]]);
  assert.deepEqual(feeds, original);
  assert.deepEqual(NEWS_FEEDS.slice(0, 8), original);
});

test('empty source subsets keep zero coverage without invoking transport', async () => {
  const result = await fetchNewsCandidates({ feeds: [], now, lookup, fetch: async () => assert.fail('no source may fetch') });
  assert.equal(result.stats.totalFeeds, 0);
  assert.equal(result.stats.succeededFeeds, 0);
  assert.deepEqual(result.articles, []);
});
