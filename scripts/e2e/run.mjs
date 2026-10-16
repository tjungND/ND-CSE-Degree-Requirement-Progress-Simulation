// End-to-end harness: builds if needed, serves dist/ with vite preview, drives
// a headless browser through the four drivers, and screenshots into .e2e-out/.
//
//   npm run e2e                      headless Chrome over the DevTools Protocol
//                                    (needs Chrome/Chromium; CHROME_BIN overrides the binary)
//   E2E_BROWSER=webkit npm run e2e   Playwright's WebKit — Safari's engine — through the
//     (= npm run e2e:webkit)         SAME drivers; screenshots in .e2e-out/webkit/. One-time
//                                    setup per Mac:  npx playwright-core install webkit
//   E2E_BROWSER=firefox npm run e2e  the installed Firefox (Gecko), headless, over WebDriver
//     (= npm run e2e:firefox)        BiDi (scripts/e2e/firefox.mjs) through the SAME drivers;
//                                    screenshots in .e2e-out/firefox/. FIREFOX_BIN overrides
//                                    the binary. Edge, Opera and Brave are Chromium — the
//                                    Chrome run covers their engine.
//   E2E_BROWSER=opera npm run e2e    the installed Opera (Blink, Opera's own Chromium build),
//     (= npm run e2e:opera)          headless, over the DevTools Protocol exactly as Chrome
//                                    (cdp.mjs); screenshots in .e2e-out/opera/. OPERA_BIN
//                                    overrides the binary.
//   E2E_HEADED=1                     Chrome or Opera in a real window instead of headless (the
//                                    browser's own window and UI; the page size is still set by
//                                    emulation, so the checks are the same)
//   E2E_BLINK_PREFS='<json>'         Chrome or Opera started with these browser preferences in
//                                    its fresh profile — a setting a student may have on, e.g.
//                                    Opera's "Force dark pages":
//                                    '{"ui":{"webkit":{"force_dark_mode_enabled_proxy":true}},
//                                      "webkit":{"webprefs":{"force_dark_mode_enabled":true}},
//                                      "profile":{"default_content_setting_values":{"force_dark_mode":1}}}'
//   E2E_BROWSER=safari npm run e2e   REAL Safari (not headless: its automation window opens;
//     (= npm run e2e:safari)         do not click into it) over classic WebDriver through
//                                    safaridriver (scripts/e2e/safari.mjs) and the SAME drivers;
//                                    screenshots in .e2e-out/safari/. One-time setup: Safari →
//                                    Settings → Developer → "Allow remote automation".
//   E2E_ONLY=<substring>             run a single driver while iterating (e.g. E2E_ONLY=access)
//   E2E_BUILD=1                      rebuild dist/ first even if it looks up to date
//   E2E_PORT=<port>                  the preview server's port (default 4273), so runs of
//                                    different engines can go on at the same time
//   E2E_DEBUG_PORT=<port>            the browser's remote-control port (Chrome default 9333;
//                                    Firefox default 0 = any free port); Chrome's throwaway
//                                    profile is per port, so two Chrome runs never share one
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openSession } from './cdp.mjs';
import { driveA11y } from './drive-a11y.mjs';
import { driveApp, driveCourses } from './drive-app.mjs';
import { driveTranscript } from './drive-transcript.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const browserKind = (process.env.E2E_BROWSER ?? 'chrome').toLowerCase();
if (!['chrome', 'webkit', 'firefox', 'safari', 'opera'].includes(browserKind)) {
  console.error(`E2E_BROWSER must be "chrome" (the default), "webkit", "firefox", "safari" or "opera", not "${process.env.E2E_BROWSER}".`);
  process.exit(2);
}

const portFrom = (name, fallback) => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 65535) {
    console.error(`${name} must be a port number, not "${raw}".`);
    process.exit(2);
  }
  return n;
};
const PREVIEW_PORT = portFrom('E2E_PORT', 4273); // not 4173, so a dev's own preview keeps running
// Chrome's DevTools port, or Firefox's WebDriver BiDi port (0: Firefox picks a
// free one and says which). WebKit is launched by Playwright, which needs none.
// safaridriver's port for Safari (default 4444).
// Opera's DevTools port defaults to 9334, so a Chrome run and an Opera run can go
// on side by side (with their own E2E_PORT).
const DEBUG_PORT = portFrom('E2E_DEBUG_PORT', browserKind === 'firefox' ? 0 : browserKind === 'safari' ? 4444 : browserKind === 'opera' ? 9334 : 9333);
/** Chrome and Opera are both Blink over the DevTools Protocol: one launch path. */
const blink = browserKind === 'chrome' || browserKind === 'opera';
if ((blink || browserKind === 'safari') && DEBUG_PORT === 0) {
  console.error('E2E_DEBUG_PORT=0 works for Firefox only; give Chrome, Opera or Safari a real port.');
  process.exit(2);
}

// Is something already answering on this port? A second run on the same ports
// would reuse the first run's preview server and drive its browser — and,
// since Chrome's profile is emptied at start, delete that browser's profile.
// Checked before anything is cleared or built. (Two runs started in the same
// instant can both pass; give concurrent runs their own E2E_PORT and
// E2E_DEBUG_PORT.)
async function answers(url) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(1500) });
    return true;
  } catch {
    return false;
  }
}
if (await answers(`http://localhost:${PREVIEW_PORT}/`)) {
  console.error(`Port ${PREVIEW_PORT} is already in use (another e2e run?) — set E2E_PORT to a free one.`);
  process.exit(2);
}
if (blink && (await answers(`http://127.0.0.1:${DEBUG_PORT}/json/version`))) {
  console.error(`Port ${DEBUG_PORT} is already in use by another browser — set E2E_DEBUG_PORT to a free one.`);
  process.exit(2);
}
// Safari runs one automation session at a time: a safaridriver already
// answering is another run's (or a stray one) — say so instead of failing later.
if (browserKind === 'safari' && (await answers(`http://localhost:${DEBUG_PORT}/status`))) {
  console.error(`Port ${DEBUG_PORT} is already in use (another Safari run?) — Safari drives one session at a time; wait for it, or set E2E_DEBUG_PORT.`);
  process.exit(2);
}

// Each browser clears only its own screenshots (Chrome: the top-level PNGs;
// WebKit and Firefox: their own folder), so one run never erases another's frames.
const outRoot = join(root, '.e2e-out');
const outDir = browserKind === 'chrome' ? outRoot : join(outRoot, browserKind);
if (browserKind !== 'chrome') rmSync(outDir, { recursive: true, force: true });
else if (existsSync(outRoot)) for (const f of readdirSync(outRoot)) if (f.endsWith('.png')) rmSync(join(outRoot, f));
mkdirSync(outDir, { recursive: true });

function findOpera() {
  if (process.env.OPERA_BIN) return process.env.OPERA_BIN;
  const candidates = ['/Applications/Opera.app/Contents/MacOS/Opera', '/usr/bin/opera', '/usr/lib/x86_64-linux-gnu/opera/opera', '/snap/bin/opera'];
  for (const c of candidates) if (existsSync(c)) return c;
  throw new Error('No Opera found — install it, or set OPERA_BIN to the browser binary.');
}

function findChrome() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  throw new Error('No Chrome/Chromium found — set CHROME_BIN to the browser binary.');
}

async function waitForHttp(url, timeoutMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`timed out waiting for ${url}`);
}

// The newest mtime under a path (a file, or a folder walked recursively).
function newestMtime(path) {
  const st = statSync(path);
  if (!st.isDirectory()) return st.mtimeMs;
  let newest = st.mtimeMs;
  for (const entry of readdirSync(path)) newest = Math.max(newest, newestMtime(join(path, entry)));
  return newest;
}

// Build when dist/ is missing, when E2E_BUILD=1, or when anything the build
// reads is newer than the last build — otherwise the run tests a stale page.
const distIndex = join(root, 'dist', 'index.html');
const buildInputs = ['src', 'index.html', 'courses.html', 'public', join('data', 'snapshot.json')].map((p) => join(root, p)).filter(existsSync);
const buildReason = !existsSync(distIndex)
  ? 'dist/ missing'
  : process.env.E2E_BUILD === '1'
    ? 'E2E_BUILD=1'
    : Math.max(...buildInputs.map(newestMtime)) > statSync(distIndex).mtimeMs
      ? 'dist/ is older than the sources'
      : null;
if (buildReason) {
  console.log(`${buildReason} — running npm run build first…`);
  const b = spawnSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' });
  if (b.status !== 0) process.exit(b.status ?? 1);
}

const children = [];
let webkitBrowser; // closed in the finally below (Playwright owns that process, not `children`)
let firefoxBrowser; // closed in the finally below; its process is also in `children`
let safariBrowser; // closed in the finally below; safaridriver is also in `children`
const cleanup = () => {
  for (const c of children) {
    try {
      c.kill('SIGTERM');
    } catch {
      /* already gone */
    }
  }
  firefoxBrowser?.removeProfile();
};
process.on('exit', cleanup);
// Ctrl-C, and a timeout wrapper ending the run (timeout(1) sends SIGTERM, a
// `perl -e 'alarm …'` wrapper SIGALRM): leave through process.exit so the
// cleanup above runs and no browser or preview server is left behind.
for (const [signal, n] of [['SIGINT', 2], ['SIGTERM', 15], ['SIGHUP', 1], ['SIGALRM', 14]]) {
  process.on(signal, () => process.exit(128 + n));
}

let failed = false;
const runStarted = Date.now();
const seconds = (since) => ((Date.now() - since) / 1000).toFixed(1);
try {
  // vite is spawned directly (not through npm) so kill() reaches the server.
  const vite = spawn(
    join(root, 'node_modules', '.bin', 'vite'),
    ['preview', '--port', String(PREVIEW_PORT), '--strictPort'],
    { cwd: root, stdio: 'ignore' },
  );
  children.push(vite);
  await waitForHttp(`http://localhost:${PREVIEW_PORT}/`);
  console.log(`preview server on :${PREVIEW_PORT}`);

  let openSessionFor;
  if (browserKind === 'webkit') {
    // Imported lazily: the Chrome run must never need playwright-core.
    const { launchWebkit, openWebkitSession } = await import('./webkit.mjs');
    webkitBrowser = await launchWebkit();
    const context = await webkitBrowser.newContext({ viewport: { width: 1400, height: 1900 } });
    console.log(`headless WebKit ${webkitBrowser.version()} up (Playwright)`);
    openSessionFor = () => openWebkitSession(context, outDir);
  } else if (browserKind === 'firefox') {
    // Imported lazily, like WebKit: only this run needs it. Firefox runs from a
    // fresh profile in the temp folder, removed when the run ends.
    const { launchFirefox } = await import('./firefox.mjs');
    firefoxBrowser = await launchFirefox({ port: DEBUG_PORT });
    children.push(firefoxBrowser.process);
    console.log(`headless Firefox ${firefoxBrowser.version} up (WebDriver BiDi, ${firefoxBrowser.url})`);
    openSessionFor = () => firefoxBrowser.openSession(outDir);
  } else if (browserKind === 'safari') {
    // Imported lazily, like WebKit and Firefox. Real Safari, in its automation
    // window; each driver gets a tab of one WebDriver session.
    const { launchSafari } = await import('./safari.mjs');
    safariBrowser = await launchSafari({ port: DEBUG_PORT });
    children.push(safariBrowser.process);
    console.log(`Safari ${safariBrowser.version} up (WebDriver, safaridriver on :${DEBUG_PORT}) — do not click into its window`);
    openSessionFor = () => safariBrowser.openSession(outDir);
  } else {
    // Chrome, or Opera (2026-10-10: Opera is Blink — Opera's own Chromium
    // build — and speaks the same DevTools Protocol, so cdp.mjs drives it).
    // One profile per port: a second Chrome on the same profile would hand its
    // tabs to the first and quit. Emptied first, as WebKit's context and
    // Firefox's profile start empty: a record the last run left in it made
    // Chrome's opening notice a returning student's (2026-10-10).
    const headed = process.env.E2E_HEADED === '1';
    const chromeProfile = join(tmpdir(), `cse-audit-e2e-profile-${browserKind === 'opera' ? 'opera-' : ''}${DEBUG_PORT}`);
    rmSync(chromeProfile, { recursive: true, force: true });
    if (process.env.E2E_BLINK_PREFS) {
      mkdirSync(join(chromeProfile, 'Default'), { recursive: true });
      writeFileSync(join(chromeProfile, 'Default', 'Preferences'), JSON.stringify(JSON.parse(process.env.E2E_BLINK_PREFS)));
      console.log('browser preferences seeded: ' + process.env.E2E_BLINK_PREFS);
    }
    const chrome = spawn(
      browserKind === 'opera' ? findOpera() : findChrome(),
      [
        ...(headed ? [] : ['--headless=new']),
        `--remote-debugging-port=${DEBUG_PORT}`,
        `--user-data-dir=${chromeProfile}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--no-sandbox', // required on CI runners; harmless locally
        'about:blank',
      ],
      { stdio: 'ignore' },
    );
    children.push(chrome);
    await waitForHttp(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
    const version = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)).json().catch(() => ({}));
    const opera = /OPR\/([\d.]+)/.exec(version['User-Agent'] ?? '')?.[1];
    console.log(`${headed ? '' : 'headless '}${browserKind === 'opera' ? `Opera ${opera ?? '?'} (${version.Browser ?? 'Chromium ?'})` : 'Chrome'} up`);
    openSessionFor = () => openSession(DEBUG_PORT, outDir);
  }

  const baseUrl = `http://localhost:${PREVIEW_PORT}/`;
  // The transcript fixtures, by name → path (all sanitized PDFs in tests/fixtures/).
  const pdfs = Object.fromEntries(
    Object.entries({
      nd: 'nd-transcript.pdf',
      other: 'other-transcript.pdf',
      external: 'external-transcript.pdf',
      externalUnofficial: 'external-unofficial-transcript.pdf',
      scan: 'external-transcript-scan.pdf',
      banner: 'banner-transcript.pdf',
      watermarked: 'banner-watermarked-transcript.pdf',
      combined: 'combined-transcript.pdf',
      ndUg: 'nd-undergrad-transcript.pdf',
      uc: 'uc-system-transcript.pdf',
      ndOfficial: 'nd-official-transcript.pdf',
      noLines: 'no-lines-transcript.pdf',
      ndUgInProgress: 'nd-undergrad-in-progress-transcript.pdf',
      ndInsideNd: 'nd-insidend-transcript.pdf',
      codeless: 'codeless-transcript.pdf',
      totalsMismatch: 'totals-mismatch-transcript.pdf',
      scanClean: 'external-transcript-scan-clean.pdf',
      scannerLayer: 'scanner-layer-transcript.pdf',
      outline: 'course-outline.pdf',
      ndParchmentNew: 'nd-parchment-new-student-transcript.pdf',
    }).map(([name, file]) => [name, join(root, 'tests', 'fixtures', file)]),
  );

  // E2E_ONLY=<substring> runs a single driver while iterating (e.g. E2E_ONLY=access).
  const only = process.env.E2E_ONLY;
  for (const [name, fn] of [
    ['app basics', (s) => driveApp(s, baseUrl)],
    ['transcript upload', (s) => driveTranscript(s, baseUrl, pdfs)],
    ['course rules list', (s) => driveCourses(s, baseUrl)],
    ['accessibility and phone layout', (s) => driveA11y(s, baseUrl)],
  ].filter(([name]) => !only || name.includes(only))) {
    console.log(`\n▶ ${name}`);
    const started = Date.now();
    const session = await openSessionFor();
    try {
      await fn(session);
      console.log(`✔ ${name} (${seconds(started)} s)`);
    } catch (err) {
      failed = true;
      console.error(`✖ ${name}:`, err instanceof Error ? err.message : err);
    } finally {
      await session.close();
    }
  }
} catch (err) {
  failed = true;
  console.error('e2e harness error:', err instanceof Error ? err.message : err);
} finally {
  if (webkitBrowser) await webkitBrowser.close().catch(() => {});
  if (firefoxBrowser) await firefoxBrowser.close().catch(() => {});
  if (safariBrowser) await safariBrowser.close().catch(() => {});
  cleanup();
}

console.log(`\n${seconds(runStarted)} s in all.`);
console.log(`Screenshots in ${relative(root, outDir)}/ (${browserKind}). ${failed ? 'E2E FAILED' : 'E2E passed.'}`);
process.exit(failed ? 1 : 0);
