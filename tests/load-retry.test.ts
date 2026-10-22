// The rules loader hedges and retries (2026-09-06): Google's publish-to-web
// endpoint stalls a fair share of requests outright, so a tab is asked for a
// second time after a short wait (the first answer wins) and afresh after a
// whole attempt is abandoned. `fetch` is stubbed here with a script that
// honours the abort signal; waits are milliseconds so the tests run fast.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, describe, it } from 'node:test';
import type { CsvTexts } from '../src/data/assemble.ts';
import { fetchCsv, fetchCsvOnce, forgetSnapshotMeta, loadLiveRules, RulesLoadError, SNAPSHOT_META_PATH, worthRetrying, type LoadProgress } from '../src/data/load.ts';
import { snapshotMetaOf } from '../src/data/snapshot-meta.ts';

const CSV = 'course_id,title\r\nCSE 60641,Graduate Operating Systems\r\n';
const realFetch = globalThis.fetch;
const noPause = async () => {};
type Step = 'stall' | 'network' | number | string;

/** A fetch stub answering from a script, one entry per request in order (the
 * last entry repeats): 'stall' never answers until aborted; 'network' throws
 * like a dropped connection; a number answers with that HTTP status; any other
 * string is a 200 body. Records how many requests were made and aborted. */
function stubFetch(script: Step[]): { calls: () => number; aborted: () => number } {
  let calls = 0;
  let aborted = 0;
  globalThis.fetch = ((_url: string, init?: RequestInit) => {
    const step = script[Math.min(calls, script.length - 1)]!;
    calls += 1;
    const signal = init?.signal as AbortSignal | undefined;
    return new Promise<Response>((resolve, reject) => {
      let answered = false; // an abort after the answer is a no-op, as in a real fetch
      signal?.addEventListener('abort', () => {
        if (answered) return;
        aborted += 1;
        reject(new DOMException('The operation was aborted', 'AbortError'));
      });
      if (step === 'stall') return;
      answered = true;
      if (step === 'network') return reject(new TypeError('Failed to fetch'));
      if (typeof step === 'number') return resolve(new Response('', { status: step }));
      resolve(new Response(step, { status: 200 }));
    });
  }) as typeof fetch;
  return { calls: () => calls, aborted: () => aborted };
}
const trace = (events: LoadProgress[]) =>
  events.map((e) => (e.step === 'retry' ? (e.hedged ? `hedge ${e.attempt}/${e.of}` : `attempt ${e.attempt}/${e.of}`) : e.step === 'tab' ? `tab ${e.tab} ${e.rows} rows` : e.step));

describe('rules loader: hedged attempts and retries', () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('a stalled request is joined by a second one, whose answer wins; the stalled one is dropped', async () => {
    const f = stubFetch(['stall', CSV]);
    const events: LoadProgress[] = [];
    const text = await fetchCsvOnce('courses', 'https://example.test/courses', (p) => events.push(p), 500, 20);
    assert.equal(text, CSV);
    assert.equal(f.calls(), 2);
    assert.equal(f.aborted(), 1, 'the stalled request is aborted once the hedge has answered');
    assert.deepEqual(trace(events), ['hedge 1/3', 'tab courses 1 rows']);
  });

  it('a request that fails early is hedged at once, without waiting', async () => {
    const f = stubFetch(['network', CSV]);
    const events: LoadProgress[] = [];
    const started = Date.now();
    assert.equal(await fetchCsvOnce('categories', 'https://example.test/c', (p) => events.push(p), 500, 400), CSV);
    assert.ok(Date.now() - started < 300, 'did not wait for the hedge timer');
    assert.equal(f.calls(), 2);
    assert.deepEqual(trace(events), ['hedge 1/3', 'tab categories 1 rows']);
  });

  it('when both requests stall the attempt is abandoned and a fresh one made', async () => {
    const f = stubFetch(['stall', 'stall', CSV]);
    const events: LoadProgress[] = [];
    const text = await fetchCsv('courses', 'https://example.test/courses', (p) => events.push(p), [20, 30, 40], 5, noPause);
    assert.equal(text, CSV);
    assert.equal(f.calls(), 3);
    assert.equal(f.aborted(), 2);
    assert.deepEqual(trace(events), ['hedge 1/3', 'attempt 2/3', 'tab courses 1 rows']);
  });

  it('gives up after the last attempt with a message that counts the attempts', async () => {
    const f = stubFetch(['stall']);
    await assert.rejects(
      fetchCsv('parameters', 'https://example.test/p', () => {}, [20, 20, 20], 5, noPause),
      (e: unknown) => e instanceof RulesLoadError && e.kind === 'timeout' && e.retryable && /3 attempts, 0.06 seconds in all/.test(e.message),
    );
    assert.equal(f.calls(), 6, 'two requests per attempt, three attempts');
  });

  it('a 5xx is hedged and retried; a 4xx or an unpublished sheet ends the attempt at once', async () => {
    let f = stubFetch([503, CSV]);
    assert.equal(await fetchCsv('categories', 'https://example.test/c', () => {}, [500], 400, noPause), CSV);
    assert.equal(f.calls(), 2);

    f = stubFetch([404, CSV]);
    await assert.rejects(fetchCsv('courses', 'https://example.test/x', () => {}, [500], 20, noPause), (e: unknown) => e instanceof RulesLoadError && e.kind === 'http' && e.status === 404);
    assert.equal(f.calls(), 1, 'a 404 is not asked again');

    f = stubFetch(['<!DOCTYPE html><html>Sign in</html>', CSV]);
    await assert.rejects(fetchCsv('courses', 'https://example.test/y', () => {}, [500], 20, noPause), (e: unknown) => e instanceof RulesLoadError && e.kind === 'unpublished' && !e.retryable);
    assert.equal(f.calls(), 1, 'an unpublished sheet is not asked again');
  });

  it('worthRetrying: only stalls, dropped connections and server errors', () => {
    assert.equal(worthRetrying(new RulesLoadError('timeout', 'courses', 'x', true)), true);
    assert.equal(worthRetrying(new RulesLoadError('unreachable', 'courses', 'x', true)), true);
    assert.equal(worthRetrying(new RulesLoadError('http', 'courses', 'x', true, 502)), true);
    assert.equal(worthRetrying(new RulesLoadError('http', 'courses', 'x', true, 404)), false);
    assert.equal(worthRetrying(new RulesLoadError('unpublished', 'courses', 'x', false)), false);
    assert.equal(worthRetrying(new Error('x')), false);
  });
});

// The Universities tab alone fails (a 404 ends its attempt at once): the page
// loads, and the warning says what it does without the tab — credits count as
// printed, each such line saying the DGS converts — not the deleted
// ExternalCourses column (policy review round 4, P4-data-4; DGS 2026-10-12).
describe('the Universities tab alone fails (P4-data-4)', () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
    forgetSnapshotMeta(); // a page asks for the meta once; each test here is its own page
  });
  it('the warning says credits count as printed', async () => {
    const urls = (await import('../data/sheet-urls.json', { with: { type: 'json' } })).default as Record<string, string>;
    // Read from disk (W1, 2026-10-22): the loader no longer imports the file.
    const snap = JSON.parse(readFileSync(new URL('../data/snapshot.json', import.meta.url), 'utf8')) as { syncedAt: string; csv: CsvTexts & Record<string, string | undefined> };
    // The saved copy's meta is asked for beside the tabs (W1); here it answers
    // too, so the rules are dated — and the failed optional tab counts as
    // matching (review 2026-10-10), so they are dated `known`.
    const meta = JSON.stringify(snapshotMetaOf({ syncedAt: snap.syncedAt, csv: snap.csv }));
    globalThis.fetch = ((url: string) => {
      if (url === SNAPSHOT_META_PATH) return Promise.resolve(new Response(meta, { status: 200 }));
      const tab = Object.keys(urls).find((k) => urls[k] === url);
      if (tab === undefined || tab === 'universities' || snap.csv[tab] === undefined) return Promise.resolve(new Response('', { status: 404 }));
      return Promise.resolve(new Response(snap.csv[tab], { status: 200 }));
    }) as typeof fetch;
    const rules = await loadLiveRules('2026-10-12T12:00:00Z');
    const issue = rules.issues.find((i) => i.tab === 'Universities');
    assert.ok(issue, JSON.stringify(rules.issues));
    assert.match(issue.message, /credit system is unknown until it is reachable again: a course whose transcript reading \(or the student's choice at import\) says quarter or trimester units is still converted; the others count their credits as the transcript prints them/);
    assert.doesNotMatch(issue.message, /credit_system/);
    assert.deepEqual(rules.rulesDate, { kind: 'known', at: snap.syncedAt }, 'a failed optional tab is dated as matching the saved copy');
  });
});

// The saved copy's date and fingerprints (data/snapshot-meta.json) are fetched
// beside the tabs (W1, 2026-10-22). When that one small file cannot be read
// the page still loads — the rules are simply undated (the masthead then says
// "those in effect for <term>") and the diagnostics panel says why.
describe('the saved copy’s meta cannot be read (W1)', () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
    forgetSnapshotMeta();
  });
  it('the rules load undated, with a warning in the diagnostics', async () => {
    const urls = (await import('../data/sheet-urls.json', { with: { type: 'json' } })).default as Record<string, string>;
    const snap = JSON.parse(readFileSync(new URL('../data/snapshot.json', import.meta.url), 'utf8')) as { csv: Record<string, string> };
    globalThis.fetch = ((url: string) => {
      if (url === SNAPSHOT_META_PATH) return Promise.reject(new TypeError('Failed to fetch'));
      const tab = Object.keys(urls).find((k) => urls[k] === url);
      if (tab === undefined || snap.csv[tab] === undefined) return Promise.resolve(new Response('', { status: 404 }));
      return Promise.resolve(new Response(snap.csv[tab], { status: 200 }));
    }) as typeof fetch;
    const rules = await loadLiveRules('2026-10-22T12:00:00Z');
    assert.ok(rules.courses.size > 0);
    assert.equal(rules.rulesDate, undefined);
    const issue = rules.issues.find((i) => /snapshot-meta\.json/.test(i.message));
    assert.ok(issue, JSON.stringify(rules.issues));
    assert.equal(issue.severity, 'warning');
  });
});
