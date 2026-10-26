// The rules start downloading while the app's script does (efficiency round,
// 2026-10-26; src/data/head-start.ts): a few lines in each page's <head>,
// written at build from data/sheet-urls.json, start the five tab requests,
// and the loader's first request for each tab takes its request over instead
// of asking Google a second time. These tests run the <head> lines against a
// stub `fetch`, and the loader against a stubbed head start.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, describe, it } from 'node:test';
import sheetUrls from '../data/sheet-urls.json' with { type: 'json' };
import { HEAD_START_KEY, HEAD_START_MARK, headStartScript, RULES_TABS, SHEET_FETCH_INIT, takeHeadStart, type HeadStarted } from '../src/data/head-start.ts';
import { fetchCsvOnce, TAB_LABELS, type LoadProgress } from '../src/data/load.ts';

const CSV = 'course_id,title\r\nCSE 60641,Graduate Operating Systems\r\n';
const realFetch = globalThis.fetch;
const g = globalThis as Record<string, unknown>;

/** Run the <head> lines with a stub window whose fetch records each call. */
function runHeadLines(urls: Record<string, unknown>): { calls: { url: string; init: RequestInit }[]; started: Record<string, HeadStarted> | undefined } {
  const calls: { url: string; init: RequestInit }[] = [];
  const win: Record<string, unknown> = {
    fetch: (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Promise<Response>(() => {});
    },
  };
  new Function('window', headStartScript(urls))(win);
  return { calls, started: win[HEAD_START_KEY] as Record<string, HeadStarted> | undefined };
}

describe('the rules start downloading from the page’s <head> (src/data/head-start.ts)', () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
    delete g[HEAD_START_KEY];
  });

  it('the <head> lines ask for every published tab once, with the loader’s own options — and never the sheet’s edit link', () => {
    const { calls, started } = runHeadLines(sheetUrls);
    const want = RULES_TABS.map((t) => (sheetUrls as Record<string, string>)[t]).filter((u): u is string => typeof u === 'string' && u !== '');
    assert.deepEqual(calls.map((c) => c.url), want);
    for (const c of calls) {
      assert.equal(c.init.credentials, SHEET_FETCH_INIT.credentials);
      assert.equal(c.init.cache, SHEET_FETCH_INIT.cache);
      assert.ok(c.init.signal instanceof AbortSignal, 'each request can be stopped by the loader');
    }
    assert.ok(!calls.some((c) => c.url === sheetUrls.sheet_edit_url), 'the edit link is not a tab');
    assert.deepEqual(Object.keys(started ?? {}), RULES_TABS.filter((t) => want.includes((sheetUrls as Record<string, string>)[t]!)));
  });

  it('a tab not published yet (an empty link) is skipped, as the loader skips it; nothing but https links is asked for', () => {
    const { calls } = runHeadLines({ courses: 'https://example.test/c', parameters: '', categories: 'http://example.test/plain', external: undefined, universities: 'https://example.test/u' });
    assert.deepEqual(calls.map((c) => c.url), ['https://example.test/c', 'https://example.test/u']);
  });

  it('the loader and the <head> lines name the same tabs', () => {
    assert.deepEqual([...RULES_TABS].sort(), Object.keys(TAB_LABELS).sort());
  });

  it('both pages carry the line the build replaces, inside <head>, after the charset', () => {
    for (const page of ['index.html', 'courses.html']) {
      const html = readFileSync(new URL(`../${page}`, import.meta.url), 'utf8');
      const at = html.indexOf(HEAD_START_MARK);
      assert.ok(at > html.indexOf('<meta charset') && at < html.indexOf('</head>'), page);
      assert.ok(!html.slice(0, at).includes('rel="stylesheet"'), `${page}: no stylesheet above it (a script after one waits for it)`);
    }
  });

  it('a head request is taken once; one started for another link is stopped, not used', () => {
    const controller = new AbortController();
    g[HEAD_START_KEY] = { courses: { url: 'https://example.test/c', promise: Promise.resolve(new Response(CSV)), controller } };
    assert.ok(takeHeadStart('courses', 'https://example.test/c'));
    assert.equal(takeHeadStart('courses', 'https://example.test/c'), undefined, 'the second request asks afresh');
    const other = new AbortController();
    g[HEAD_START_KEY] = { courses: { url: 'https://example.test/old', promise: new Promise<Response>(() => {}), controller: other } };
    assert.equal(takeHeadStart('courses', 'https://example.test/c'), undefined);
    assert.ok(other.signal.aborted);
  });

  it('the loader takes the head request over: no second request to Google', async () => {
    let fetches = 0;
    globalThis.fetch = (async () => {
      fetches += 1;
      return new Response(CSV);
    }) as typeof fetch;
    g[HEAD_START_KEY] = { courses: { url: 'https://example.test/c', promise: Promise.resolve(new Response(CSV)), controller: new AbortController() } };
    const events: LoadProgress[] = [];
    assert.equal(await fetchCsvOnce('courses', 'https://example.test/c', (p) => events.push(p), 500, 20), CSV);
    assert.equal(fetches, 0);
    assert.deepEqual(events.map((e) => e.step), ['tab']);
    // The next attempt for the tab (a retry, "Try again") asks Google itself.
    assert.equal(await fetchCsvOnce('courses', 'https://example.test/c', () => {}, 500, 20), CSV);
    assert.equal(fetches, 1);
  });

  it('a head request that failed is asked again at once (the hedge), and one that stalls is stopped when the hedge wins', async () => {
    let fetches = 0;
    globalThis.fetch = (async () => {
      fetches += 1;
      return new Response(CSV);
    }) as typeof fetch;
    const failed = Promise.reject(new TypeError('Failed to fetch'));
    failed.catch(() => {});
    g[HEAD_START_KEY] = { courses: { url: 'https://example.test/c', promise: failed, controller: new AbortController() } };
    const events: LoadProgress[] = [];
    assert.equal(await fetchCsvOnce('courses', 'https://example.test/c', (p) => events.push(p), 500, 10_000), CSV);
    assert.equal(fetches, 1, 'one fresh request, sent at once — not after the hedge delay');
    assert.deepEqual(events.map((e) => e.step), ['retry', 'tab']);

    const stalled = new AbortController();
    g[HEAD_START_KEY] = {
      parameters: {
        url: 'https://example.test/p',
        promise: new Promise<Response>((_, reject) => stalled.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))),
        controller: stalled,
      },
    };
    assert.equal(await fetchCsvOnce('parameters', 'https://example.test/p', () => {}, 500, 20), CSV);
    assert.ok(stalled.signal.aborted, 'the stalled head request is stopped once the hedge has answered');
  });
});
