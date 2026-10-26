// The real-Safari backend of the e2e harness — Safari itself, not Playwright's
// WebKit build (webkit.mjs): its own window, its own form controls, the
// version the DGS's Mac ships. E2E_BROWSER=safari npm run e2e runs the SAME
// four drivers through classic W3C WebDriver, which Safari speaks through
// `safaridriver` (part of macOS; no dependency, nothing to install). This
// module gives the drivers a session of the same shape as cdp.mjs (send /
// evalJs / waitFor / settle / setViewport / shot / shotElement / setFileInput /
// open / close), translating the few DevTools-Protocol commands the drivers
// send directly — the same table as webkit.mjs and firefox.mjs.
//
// One-time setup per Mac (the DGS did it on 2026-10-10): Safari → Settings →
// Advanced → "Show features for web developers", then Settings → Developer →
// "Allow remote automation" — or `safaridriver --enable` in Terminal (it asks
// for the Mac's login password).
//
// What real Safari cannot do here, by design of macOS rather than of the app:
//   - it is not headless: the run opens Safari's automation window (the
//     striped address bar) and the person must not click into it — Safari
//     ends the session if they do;
//   - its window is never narrower than 336 px, so a 320 px phone is drawn at
//     336 px (setViewport says so once per run, and the 320 px checks then
//     measure a 336 px page);
//   - it follows the Mac's light/dark setting (no emulation in WebDriver), so
//     a Mac in dark mode makes the night-mode check see dark;
//   - it runs one automation session at a time — never two Safari runs at once.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { sessionHelpers, settleIn } from './session-common.mjs';
import { PRINT_MEDIA_OFF, PRINT_MEDIA_ON, webdriverKey } from './firefox.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Start `safaridriver` on `port` and open ONE WebDriver session on Safari.
 * Each driver gets its own tab in that session (openSession), as the Chrome
 * and Firefox runs give each driver its own tab in one browser.
 * Returns { version, process, openSession(outDir), close() }.
 */
export async function launchSafari({ port = 4444 } = {}) {
  const proc = spawn('safaridriver', ['--port', String(port)], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  proc.stderr.on('data', (d) => {
    stderr = (stderr + d).slice(-4000);
  });
  proc.on('error', () => {});
  const abandon = () => {
    try {
      proc.kill('SIGTERM');
    } catch {
      /* gone */
    }
  };
  process.on('exit', abandon);
  const base = `http://localhost:${port}`;
  const call = async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.value?.error) {
      throw new Error(`${method} ${path}: ${json.value?.error ?? res.status} — ${json.value?.message ?? ''}`);
    }
    return json.value;
  };

  let sessionId;
  let version;
  try {
    const t0 = Date.now();
    for (;;) {
      try {
        if ((await call('GET', '/status')).ready !== undefined) break;
      } catch {
        /* not up yet */
      }
      if (proc.exitCode !== null || Date.now() - t0 > 15000) throw new Error(`safaridriver did not start:\n${stderr}`);
      await sleep(150);
    }
    let created;
    try {
      // A native alert / confirm left open is dismissed, never answered.
      created = await call('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'safari', unhandledPromptBehavior: 'dismiss' } } });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        /remote automation|Allow Remote Automation/i.test(msg)
          ? 'Safari refuses remote automation — turn on Settings → Developer → "Allow remote automation" (or run `safaridriver --enable` in Terminal), then run again.\n  (' + msg + ')'
          : msg,
      );
    }
    sessionId = created.sessionId;
    version = created.capabilities.browserVersion;
    // Generous script timeout: a driver's evalJs may wait on a whole transcript import.
    await call('POST', `/session/${sessionId}/timeouts`, { script: Number(process.env.E2E_SAFARI_SCRIPT_MS) || 180000, pageLoad: 120000, implicit: 0 });
  } catch (err) {
    abandon();
    process.off('exit', abandon);
    throw err;
  }
  process.off('exit', abandon);
  const s = (path) => `/session/${sessionId}${path}`;
  const home = await call('GET', s('/window'));

  const close = async () => {
    await call('DELETE', s('')).catch(() => {});
    const exited = new Promise((r) => proc.once('exit', r));
    proc.kill('SIGTERM');
    await Promise.race([exited, sleep(3000)]);
  };

  return {
    version,
    process: proc,
    openSession: (outDir) => openSafariSession({ call, s, home }, outDir),
    close,
  };
}

let narrowWarned = false;

async function openSafariSession({ call, s, home }, outDir) {
  // A tab of its own, switched to; closed again by close().
  const { handle } = await call('POST', s('/window/new'), { type: 'tab' });
  await call('POST', s('/window'), { handle });

  // Same contract as cdp.mjs's evalJs: the string is a global script
  // (statements allowed; globals it sets stay visible to the page), a returned
  // promise is awaited, and the value comes back as data — `undefined` as
  // undefined, a DOM node or anything else that is not data as {} (what
  // Chrome's returnByValue gives). Indirect eval runs it in the global scope.
  const EVAL = `
    const done = arguments[arguments.length - 1];
    const ship = (v) => {
      if (v === undefined) return done({ undef: true });
      let json;
      try { json = JSON.stringify(v); } catch { json = '{}'; }
      done({ json: json === undefined ? 'null' : json });
    };
    let r;
    try { r = (0, eval)(arguments[0]); } catch (e) { return done({ error: String(e && e.stack ? e.message + '\\n' + e.stack : e) }); }
    Promise.resolve(r).then(ship, (e) => done({ error: String(e && e.message ? e.message : e) }));`;
  const evalJs = async (expression) => {
    let r;
    try {
      r = await call('POST', s('/execute/async'), { script: EVAL, args: [expression] });
    } catch (err) {
      // A native dialog left open blocks every script; name it, dismiss it.
      const dialog = await call('GET', s('/alert/text')).catch(() => null);
      if (dialog !== null) await call('POST', s('/alert/dismiss')).catch(() => {});
      throw new Error('page JS failed: ' + (err instanceof Error ? err.message : String(err)) + (dialog !== null ? ` — a native dialog was open: ${JSON.stringify(dialog)}` : '') + ` [script: ${expression.slice(0, 160)}]`);
    }
    if (r === null || r === undefined) return undefined; // the page navigated away mid-script
    if (r.error) throw new Error('page JS failed: ' + r.error);
    return r.undef ? undefined : JSON.parse(r.json);
  };

  // Navigation resolves at the load event, like the WebKit and Firefox backends.
  const navigate = (url) => call('POST', s('/url'), { url });

  // The window's toolbar is the difference between the window and the page;
  // measured, then the window is sized so the PAGE is width × height.
  const viewport = async (width, height) => {
    let w = width;
    let chrome = 52;
    for (let i = 0; i < 3; i++) {
      await call('POST', s('/window/rect'), { width: w, height: height + chrome });
      const [iw, ih, ow, oh] = await evalJs('[innerWidth, innerHeight, outerWidth, outerHeight]');
      chrome = oh - ih;
      if (iw === width && ih === height) return;
      if (iw !== width) w += width - iw;
      if (ih === height && iw !== width && ow <= width) break; // the window will not go narrower
    }
    const [iw, ih] = await evalJs('[innerWidth, innerHeight]');
    if ((iw !== width || ih !== height) && !narrowWarned) {
      narrowWarned = true;
      console.log(`  note (Safari): asked for a ${width}×${height} page, got ${iw}×${ih} — Safari's window has a minimum width; checks at this size measure the page Safari draws`);
    }
  };

  const settle = settleIn(evalJs);
  const save = (name, base64) => {
    writeFileSync(join(outDir, `${name}.png`), Buffer.from(base64, 'base64'));
    console.log('  screenshot:', `${name}.png`);
  };
  const shot = async (name) => {
    await settle(120);
    save(name, await call('GET', s('/screenshot')));
  };
  const findCss = async (selector) => {
    const el = await call('POST', s('/element'), { using: 'css selector', value: selector }).catch(() => null);
    if (!el) return null;
    return Object.values(el)[0];
  };
  // Scrolled to the top of the window first, as the other backends do.
  const shotElement = async (name, selector) => {
    await settle(120);
    const there = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return false; e.scrollIntoView({ block: 'start' }); return true; })()`);
    if (!there) throw new Error('shotElement: nothing matches ' + selector);
    await settle(60);
    const id = await findCss(selector);
    save(name, await call('GET', s(`/element/${id}/screenshot`)));
  };

  const setViewport = async ({ width, height, settleMs = 150 }) => {
    await viewport(width, height);
    await settle(settleMs);
  };

  // A file input is given its file the way a person's pick would: WebDriver's
  // Element Send Keys with the path, which fires input and change. If Safari
  // refuses that (it does for an input the page keeps hidden), the same File
  // is built in the page and set through a DataTransfer, which fires the same
  // events.
  const setFileInput = async (selector, filePath) => {
    const id = await findCss(selector);
    if (!id) throw new Error('setFileInput: nothing matches ' + selector);
    try {
      await call('POST', s(`/element/${id}/value`), { text: filePath, value: [...filePath] });
      return;
    } catch {
      /* fall through */
    }
    const b64 = readFileSync(filePath).toString('base64');
    const ok = await evalJs(`(() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      if (!input) return false;
      const bin = atob(${JSON.stringify(b64)});
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], ${JSON.stringify(basename(filePath))}, { type: 'application/pdf' }));
      input.files = dt.files;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    if (!ok) throw new Error('setFileInput: nothing matches ' + selector);
  };

  const keyAction = (type, value) => call('POST', s('/actions'), { actions: [{ type: 'key', id: 'keyboard', actions: [{ type, value }] }] });

  // The DevTools-Protocol commands the drivers send directly — the same set
  // webkit.mjs and firefox.mjs translate; anything else is refused loudly.
  const send = async (method, params = {}) => {
    switch (method) {
      case 'Page.navigate':
        await navigate(params.url);
        return {};
      case 'Emulation.setDeviceMetricsOverride':
        await viewport(params.width, params.height);
        return {};
      case 'Emulation.setEmulatedMedia':
        // WebDriver cannot switch the CSS media type: the page's own
        // print/screen queries are swapped, as in firefox.mjs. A device
        // setting (prefers-color-scheme) cannot be emulated: the check is skipped.
        if (params.features?.length) throw new Error('safari session: no translation for media features (' + params.features.map((f) => f.name).join(', ') + ')');
        if (params.media && params.media !== 'print') throw new Error(`safari session: only print media can be emulated, not "${params.media}"`);
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
        return { data: await call('GET', s('/screenshot')) };
      case 'Page.enable':
      case 'DOM.enable':
        return {};
      default:
        throw new Error(`safari session: no translation for the DevTools command ${method} — add one in scripts/e2e/safari.mjs`);
    }
  };

  const { waitFor, open } = sessionHelpers({ navigate, evalJs, shot });

  // The same 1400×1900 page as the other runs.
  await navigate('about:blank');
  await viewport(1400, 1900);
  // Safari draws nothing in a window nobody can see — the Mac's screen
  // locked or asleep, the window minimized or on another Space: no animation
  // frame ever comes, and every check would wait out the script timeout.
  // Say so at once (2026-10-10: the screen locked after the first driver).
  const drawing = await evalJs(`new Promise((r) => { requestAnimationFrame(() => r(true)); setTimeout(() => r(false), 3000); })`);
  if (!drawing) {
    throw new Error("Safari's window is not being drawn (the page reports " + (await evalJs('document.visibilityState')) + ') — unlock the Mac, keep its screen awake and the Safari automation window visible on the current Space, then run again.');
  }

  const close = async () => {
    await call('DELETE', s('/window')).catch(() => {});
    await call('POST', s('/window'), { handle: home }).catch(() => {});
  };

  return { send, evalJs, waitFor, settle, setViewport, shot, shotElement, setFileInput, open, close };
}
