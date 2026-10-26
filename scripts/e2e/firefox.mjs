// The Firefox backend of the e2e harness — Gecko, the third engine after
// Chrome's Blink (cdp.mjs; Edge, Opera and Brave are Blink too) and Safari's
// WebKit (webkit.mjs). E2E_BROWSER=firefox npm run e2e runs the SAME four
// drivers in real, installed Firefox: this module gives them a session of the
// same shape as cdp.mjs (send / evalJs / waitFor / settle / setViewport / shot /
// shotElement / setFileInput / open / close), translating the few
// DevTools-Protocol commands the drivers send directly — the same table as
// webkit.mjs — and refusing any other loudly, so a new CDP call in a driver is
// noticed here.
//
// How it talks to Firefox: WebDriver BiDi, the W3C protocol Firefox speaks
// natively when started with --remote-debugging-port (Firefox dropped its
// partial CDP in 2024). Node's built-in WebSocket is the whole client — no
// dependency, nothing like geckodriver to install. Firefox runs headless from a
// fresh profile in os.tmpdir() that is deleted at the end, so a run never
// touches (or is affected by) the person's own Firefox profile.
//
// Binary: FIREFOX_BIN, else the standard macOS / Linux install paths. A Snap
// Firefox (Ubuntu's default) cannot read a profile under /tmp — point
// FIREFOX_BIN at a tarball or .deb build there.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sessionHelpers, settleIn } from './session-common.mjs';

export function findFirefox() {
  if (process.env.FIREFOX_BIN) return process.env.FIREFOX_BIN;
  const candidates = [
    '/Applications/Firefox.app/Contents/MacOS/firefox',
    '/Applications/Firefox Developer Edition.app/Contents/MacOS/firefox',
    '/Applications/Firefox Nightly.app/Contents/MacOS/firefox',
    '/usr/lib/firefox/firefox',
    '/usr/bin/firefox',
    '/usr/bin/firefox-esr',
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  throw new Error('No Firefox found — install it, or set FIREFOX_BIN to the browser binary.');
}

// The fresh profile's user.js. Each line keeps the run quiet, private and
// deterministic: no first-run or what's-new pages, no default-browser question,
// no updates or telemetry phoning home from a test run, downloads kept inside
// the throwaway profile (the drivers intercept the app's Save, but a stray
// download must never land in ~/Downloads), and a LIGHT device — headless
// Chrome and WebKit report light, and the night-mode check expects "Auto" to
// come back light; without this a Mac in dark mode would make Firefox report
// dark and fail that check for a reason that is not the app's. (Firefox's
// remote agent sets many of these itself; spelling them out keeps the run
// independent of that list.)
function userJs(profileDir) {
  const prefs = {
    // First run, start page, default browser
    'browser.shell.checkDefaultBrowser': false,
    'browser.startup.page': 0,
    'browser.startup.homepage': 'about:blank',
    'browser.startup.homepage_override.mstone': 'ignore',
    'startup.homepage_welcome_url': '',
    'startup.homepage_welcome_url.additional': '',
    'browser.aboutwelcome.enabled': false,
    'trailhead.firstrun.didSeeAboutWelcome': true,
    'browser.newtabpage.enabled': false,
    'browser.tabs.warnOnClose': false,
    'browser.warnOnQuit': false,
    'datareporting.policy.firstRunURL': '',
    // Updates (the browser's and its add-ons')
    'app.update.disabledForTesting': true,
    'app.update.auto': false,
    'extensions.update.enabled': false,
    'extensions.getAddons.cache.enabled': false,
    'browser.search.update': false,
    // Telemetry, health report, studies, background network
    'datareporting.policy.dataSubmissionEnabled': false,
    'datareporting.healthreport.uploadEnabled': false,
    'toolkit.telemetry.enabled': false,
    'toolkit.telemetry.unified': false,
    'toolkit.telemetry.archive.enabled': false,
    'toolkit.telemetry.server': '',
    'app.shield.optoutstudies.enabled': false,
    'app.normandy.enabled': false,
    'browser.discovery.enabled': false,
    'browser.safebrowsing.malware.enabled': false,
    'browser.safebrowsing.phishing.enabled': false,
    'browser.safebrowsing.downloads.enabled': false,
    'network.captive-portal-service.enabled': false,
    'network.connectivity-service.enabled': false,
    // Downloads stay in the profile, without a panel
    'browser.download.folderList': 2,
    'browser.download.dir': join(profileDir, 'downloads'),
    'browser.download.useDownloadDir': true,
    'browser.download.always_ask_before_handling_new_types': false,
    'browser.download.panel.shown': true,
    // A light device, as headless Chrome and WebKit report
    'ui.systemUsesDarkTheme': 0,
    'layout.css.prefers-color-scheme.content-override': 1,
  };
  return Object.entries(prefs)
    .map(([k, v]) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`)
    .join('\n') + '\n';
}

/**
 * Start headless Firefox and open a WebDriver BiDi session on it.
 * `port` is the BiDi port; 0 lets Firefox pick a free one (it prints the
 * address it chose, which is read back from its stderr).
 * Returns { version, url, process, removeProfile(), openSession(outDir), close() }.
 */
export async function launchFirefox({ port = 0 } = {}) {
  const bin = findFirefox();
  const profile = mkdtempSync(join(tmpdir(), 'cse-audit-e2e-firefox-'));
  writeFileSync(join(profile, 'user.js'), userJs(profile));
  const proc = spawn(bin, ['--headless', '--no-remote', '--profile', profile, '--remote-debugging-port', String(port), 'about:blank'], {
    stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, MOZ_CRASHREPORTER_DISABLE: '1' },
  });
  const removeProfile = () => rmSync(profile, { recursive: true, force: true });
  // Until this function returns, nothing else owns the process: a start that
  // fails or is interrupted (Ctrl-C, a timeout) must not leave a headless
  // Firefox or its profile behind. A missing binary emits 'error', not 'exit'.
  const abandon = () => {
    try {
      proc.kill('SIGKILL');
    } catch {
      /* already gone */
    }
    removeProfile();
  };
  process.on('exit', abandon);
  proc.on('error', () => {});
  // stderr is read to the end of the run (an unread pipe that fills would
  // stall Firefox); the last few KB are kept for an error message.
  let stderr = '';
  proc.stderr.on('data', (d) => {
    stderr = (stderr + d).slice(-8000);
  });
  const exited = new Promise((resolve) => proc.once('exit', resolve));

  let wsBase;
  let conn;
  let version = '';
  try {
    // Firefox prints "WebDriver BiDi listening on ws://127.0.0.1:<port>" once
    // the remote agent is up.
    const t0 = Date.now();
    while (!(wsBase = stderr.match(/WebDriver BiDi listening on (ws:\/\/\S+)/)?.[1])) {
      if (proc.exitCode !== null || Date.now() - t0 > 30000) {
        throw new Error(`Firefox did not start its WebDriver BiDi server (${bin}):\n${stderr.slice(-1500)}`);
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    conn = await connect(`${wsBase}/session`);
    // A native alert / confirm / prompt is dismissed (and logged below) rather
    // than left open: under the Chrome backend it would hang the run until a
    // timeout; here the run goes on and the log says what the page asked.
    const { capabilities } = await conn.send('session.new', {
      capabilities: { alwaysMatch: { unhandledPromptBehavior: { default: 'dismiss', beforeUnload: 'accept' } } },
    });
    version = capabilities.browserVersion;
    await conn.send('session.subscribe', { events: ['log.entryAdded', 'browsingContext.userPromptOpened'] });
  } catch (err) {
    conn?.close();
    abandon();
    process.off('exit', abandon);
    throw err;
  }
  // From here the caller owns the process (run.mjs kills it and removes the
  // profile in its own cleanup).
  process.off('exit', abandon);

  const close = async () => {
    // browser.close ends the session and quits Firefox; the kill is the
    // fallback if it does not quit within five seconds.
    await Promise.race([conn.send('browser.close').catch(() => {}), new Promise((r) => setTimeout(r, 5000))]);
    conn.close();
    const timer = setTimeout(() => proc.kill('SIGKILL'), 5000);
    await exited;
    clearTimeout(timer);
    removeProfile();
  };

  return { version, url: wsBase, process: proc, removeProfile, openSession: (outDir) => openFirefoxSession(conn, outDir), close };
}

// One WebSocket, many browsing contexts: commands carry an id and resolve on
// the matching reply; events go to whichever session subscribed to them.
async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error('could not connect to Firefox at ' + url));
  });
  let id = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    } else if (msg.type === 'event') {
      for (const fn of listeners) fn(msg);
    }
  };
  ws.onclose = () => {
    for (const [, done] of pending) done({ type: 'error', error: 'connection closed', message: 'Firefox closed the connection' });
    pending.clear();
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      if (ws.readyState !== WebSocket.OPEN) return reject(new Error(`${method}: the connection to Firefox is closed`));
      const mid = ++id;
      pending.set(mid, (m) => (m.type === 'error' ? reject(new Error(`${method}: ${m.error} — ${m.message}`)) : resolve(m.result)));
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  return { send, onEvent: (fn) => (listeners.add(fn), () => listeners.delete(fn)), close: () => ws.close() };
}

// A BiDi RemoteValue → the plain value CDP's `returnByValue` would have given:
// primitives as such, arrays and objects rebuilt, anything that is not data
// (a DOM node, a function, a window) as an empty object, as Chrome returns it.
function fromRemote(v) {
  if (!v) return undefined;
  switch (v.type) {
    case 'undefined':
      return undefined;
    case 'null':
      return null;
    case 'string':
    case 'boolean':
      return v.value;
    case 'number':
      return v.value === 'NaN' ? NaN : v.value === '-0' ? -0 : v.value === 'Infinity' ? Infinity : v.value === '-Infinity' ? -Infinity : v.value;
    case 'bigint':
      return BigInt(v.value);
    case 'array':
    case 'set':
      return (v.value ?? []).map(fromRemote);
    case 'object':
    case 'map':
      return Object.fromEntries((v.value ?? []).map(([k, val]) => [typeof k === 'string' ? k : String(fromRemote(k)), fromRemote(val)]));
    case 'date':
      return v.value;
    default:
      return {};
  }
}

// CDP key names (what the drivers pass as `key`) → WebDriver's key values.
// A printable key is its own character; the rest come from the WebDriver
// spec's table. \uE006 is the main Enter key (\uE007 would be the keypad's).
export const WEBDRIVER_KEYS = {
  Tab: '\uE004',
  Enter: '\uE006',
  Escape: '\uE00C',
  Backspace: '\uE003',
  Delete: '\uE017',
  ' ': ' ',
  Space: ' ',
  ArrowLeft: '\uE012',
  ArrowUp: '\uE013',
  ArrowRight: '\uE014',
  ArrowDown: '\uE015',
  Home: '\uE011',
  End: '\uE010',
  PageUp: '\uE00E',
  PageDown: '\uE00F',
  Shift: '\uE008',
  Control: '\uE009',
  Alt: '\uE00A',
  Meta: '\uE03D',
};
export const webdriverKey = (key) => {
  if (typeof key === 'string' && [...key].length === 1) return key;
  if (key in WEBDRIVER_KEYS) return WEBDRIVER_KEYS[key];
  throw new Error(`firefox session: no WebDriver key for "${key}" — add it to WEBDRIVER_KEYS in scripts/e2e/firefox.mjs`);
};

// Print-media emulation. CDP has Emulation.setEmulatedMedia and Playwright has
// page.emulateMedia; WebDriver BiDi has NO way to switch the CSS media type,
// and Firefox offers none to a web page. So the page's own stylesheets are
// rewritten through the CSSOM: every media query whose media type is `print`
// becomes `screen` and every `screen` becomes `print` — on @media and @import
// rules, at any nesting depth, and on <link media> / <style media> sheets.
// The page really IS on screen, so swapping the two types makes exactly the
// print rules apply and the screen-only rules stop, with width and every
// other media feature untouched — which is what Chrome's emulation does too
// (it changes the media type, not the viewport). The original texts are kept
// on window.__e2ePrintMedia and put back by `media: ''`; a navigation drops
// them with the document. What this does NOT emulate: matchMedia('print')
// from script still answers false (the app keys nothing on it — its
// beforeprint handlers are driven by the drivers' own events), and a
// cross-origin stylesheet cannot be read (the app has none).
export const PRINT_MEDIA_ON = `(() => {
  if (window.__e2ePrintMedia) return window.__e2ePrintMedia.length;
  const swapped = [];
  const swapQuery = (q) => q.replace(/^(\\s*(?:not\\s+|only\\s+)?)(print|screen)\\b/i, (_, pre, type) => pre + (type.toLowerCase() === 'print' ? 'screen' : 'print'));
  const swap = (list) => {
    if (!list || !list.mediaText) return;
    const before = list.mediaText;
    // Split at top-level commas only (a comma inside parentheses is not a query break).
    const queries = [];
    let depth = 0, start = 0;
    for (let i = 0; i < before.length; i++) {
      const c = before[i];
      if (c === '(') depth++;
      else if (c === ')') depth--;
      else if (c === ',' && depth === 0) { queries.push(before.slice(start, i)); start = i + 1; }
    }
    queries.push(before.slice(start));
    const after = queries.map(swapQuery).join(',');
    if (after !== before) { list.mediaText = after; swapped.push([list, before]); }
  };
  const walk = (rules) => {
    for (const rule of rules) {
      if (rule.media) swap(rule.media);
      if (rule.styleSheet) walkSheet(rule.styleSheet);
      if (rule.cssRules) walk(rule.cssRules);
    }
  };
  const walkSheet = (sheet) => {
    swap(sheet.media);
    let rules;
    try { rules = sheet.cssRules; } catch { return; } // cross-origin: unreadable
    walk(rules);
  };
  for (const sheet of document.styleSheets) walkSheet(sheet);
  window.__e2ePrintMedia = swapped;
  return swapped.length;
})()`;
export const PRINT_MEDIA_OFF = `(() => {
  for (const [list, text] of window.__e2ePrintMedia ?? []) list.mediaText = text;
  delete window.__e2ePrintMedia;
  return true;
})()`;

export async function openFirefoxSession(conn, outDir) {
  const { context } = await conn.send('browsingContext.create', { type: 'tab' });

  // What the page reports while this session is open: an uncaught exception or
  // a native dialog is printed, since either may be the reason a check fails.
  const off = conn.onEvent((ev) => {
    const p = ev.params ?? {};
    if (ev.method === 'log.entryAdded' && p.source?.context === context && p.type === 'javascript') {
      console.log(`  page error (Firefox): ${p.text}`);
    } else if (ev.method === 'browsingContext.userPromptOpened' && p.context === context) {
      // Dismissed here rather than trusting the session's prompt handler
      // alone: Firefox 147 leaves a confirm() raised by script.evaluate open,
      // and the evaluation then never returns. A beforeunload prompt is
      // accepted (the navigation goes ahead, as it would after a click).
      console.log(`  page opened a ${p.type} dialog (dismissed): ${JSON.stringify(p.message ?? '')}`);
      conn.send('browsingContext.handleUserPrompt', { context, accept: p.type === 'beforeunload' }).catch(() => {});
    }
  });

  // Same contract as cdp.mjs's evalJs: the string runs in the page's own realm
  // (statements allowed, globals it sets stay visible to the page), a returned
  // promise is awaited, and the value comes back serialized.
  const evalJs = async (expression) => {
    const r = await conn.send('script.evaluate', { expression, target: { context }, awaitPromise: true, resultOwnership: 'none' });
    if (r.type === 'exception') {
      throw new Error('page JS failed: ' + JSON.stringify(r.exceptionDetails?.text ?? r.exceptionDetails));
    }
    return fromRemote(r.result);
  };

  // Navigation resolves at the load event, like Playwright's page.goto (the
  // WebKit backend). Chrome's Page.navigate returns earlier, but every driver
  // waits for what it needs afterwards anyway.
  const navigate = (url) => conn.send('browsingContext.navigate', { context, url, wait: 'complete' });

  const viewport = (width, height) =>
    conn.send('browsingContext.setViewport', { context, viewport: { width, height }, devicePixelRatio: 1 });

  const settle = settleIn(evalJs);
  const save = (name, base64) => {
    writeFileSync(join(outDir, `${name}.png`), Buffer.from(base64, 'base64'));
    console.log('  screenshot:', `${name}.png`);
  };

  // The visible viewport, as cdp.mjs's Page.captureScreenshot gives it.
  const captureViewport = async () => (await conn.send('browsingContext.captureScreenshot', { context, origin: 'viewport' })).data;

  const shot = async (name) => {
    await settle(120);
    save(name, await captureViewport());
  };

  // A cropped screenshot of one element, scrolled into view first and then
  // clipped in document coordinates — the same steps as cdp.mjs.
  const shotElement = async (name, selector) => {
    await settle(120);
    const rect = await evalJs(`(() => {
      const e = document.querySelector(${JSON.stringify(selector)});
      if (!e) return null;
      e.scrollIntoView({ block: 'start' });
      const r = e.getBoundingClientRect();
      return { x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height };
    })()`);
    if (!rect) throw new Error('shotElement: nothing matches ' + selector);
    const { data } = await conn.send('browsingContext.captureScreenshot', {
      context,
      origin: 'document',
      clip: { type: 'box', ...rect },
    });
    save(name, data);
  };

  // Same contract as cdp.mjs's setViewport. Chrome's `mobile` flag (touch and
  // meta-viewport handling) has no BiDi equivalent; the app's breakpoints are
  // width-only, so the width and height are what the layout checks measure.
  const setViewport = async ({ width, height, settleMs = 150 }) => {
    await viewport(width, height);
    await settle(settleMs);
  };

  // input.setFiles fires input + change, like DOM.setFileInputFiles.
  const setFileInput = async (selector, filePath) => {
    const r = await conn.send('script.evaluate', {
      expression: `document.querySelector(${JSON.stringify(selector)})`,
      target: { context },
      awaitPromise: false,
      resultOwnership: 'root',
    });
    if (r.type === 'exception' || r.result?.type !== 'node') throw new Error('setFileInput: nothing matches ' + selector);
    try {
      await conn.send('input.setFiles', { context, element: { sharedId: r.result.sharedId }, files: [filePath] });
    } finally {
      if (r.result.handle) await conn.send('script.disown', { handles: [r.result.handle], target: { context } }).catch(() => {});
    }
  };

  const keyAction = (type, value) =>
    conn.send('input.performActions', { context, actions: [{ type: 'key', id: 'keyboard', actions: [{ type, value }] }] });

  // The DevTools-Protocol commands the drivers send directly — the same set
  // webkit.mjs translates.
  const send = async (method, params = {}) => {
    switch (method) {
      case 'Page.navigate':
        await navigate(params.url);
        return {};
      case 'Emulation.setDeviceMetricsOverride':
        await viewport(params.width, params.height);
        return {};
      case 'Emulation.setEmulatedMedia':
        // A device setting (prefers-color-scheme) has no BiDi equivalent: the
        // profile reports a light device (user.js), and the check is skipped.
        if (params.features?.length) throw new Error('firefox session: no translation for media features (' + params.features.map((f) => f.name).join(', ') + ') — the profile reports a light device');
        // Only "print" and "back to the page's own" are used; see PRINT_MEDIA_ON.
        if (params.media && params.media !== 'print') throw new Error(`firefox session: only print media can be emulated, not "${params.media}"`);
        await evalJs(params.media ? PRINT_MEDIA_ON : PRINT_MEDIA_OFF);
        return {};
      case 'Input.dispatchKeyEvent':
        if (params.type === 'keyDown' || params.type === 'rawKeyDown') await keyAction('keyDown', webdriverKey(params.key));
        else if (params.type === 'keyUp') await keyAction('keyUp', webdriverKey(params.key));
        else if (params.type === 'char') {
          for (const ch of params.text ?? '') {
            await keyAction('keyDown', ch);
            await keyAction('keyUp', ch);
          }
        }
        return {};
      case 'Page.captureScreenshot':
        return { data: await captureViewport() };
      case 'Page.enable':
      case 'DOM.enable':
        return {};
      default:
        throw new Error(`firefox session: no translation for the DevTools command ${method} — add one in scripts/e2e/firefox.mjs`);
    }
  };

  const { waitFor, open } = sessionHelpers({ navigate, evalJs, shot });

  // The same 1400×1900 window as the Chrome and WebKit runs.
  await viewport(1400, 1900);

  const close = async () => {
    off();
    await conn.send('browsingContext.close', { context }).catch(() => {});
  };

  // `bidi` and `context` are for one-off driving (a real pointer click, say:
  // input.performActions); the drivers use only the shared shape above.
  const bidi = (method, params = {}) => conn.send(method, params);

  return { send, evalJs, waitFor, settle, setViewport, shot, shotElement, setFileInput, open, close, bidi, context };
}
