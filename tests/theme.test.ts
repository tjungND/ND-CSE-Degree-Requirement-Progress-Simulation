// Night mode (DGS 2026-10-04): Auto follows the device, as Claude Desktop's
// Appearance setting does; Light and Dark are fixed; embedded, Auto follows the
// device too since 2026-10-25 (it stayed light before), in the host theme's
// navy palette.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { FORCED_DARK_LINK, THEME_KEY, resolveTheme } from '../src/ui/theme.ts';

describe('night mode (src/ui/theme.ts)', () => {
  it('Auto follows the device — in the WordPress frame as on the full page (DGS 2026-10-25); Light and Dark ignore it', () => {
    assert.equal(resolveTheme('auto', true), 'dark');
    assert.equal(resolveTheme('auto', false), 'light');
    assert.equal(resolveTheme('light', true), 'light');
    assert.equal(resolveTheme('dark', false), 'dark');
    // The frame is no argument any more: until 2026-10-25 Auto stayed light in it.
    assert.equal(resolveTheme.length, 2, 'resolveTheme(pref, deviceDark, forcedDark = false)');
  });

  it('a browser forcing pages dark (Opera’s "Force dark pages") gets the page’s own dark theme on Auto; Light is still honoured', () => {
    assert.equal(resolveTheme('auto', false, true), 'dark');
    assert.equal(resolveTheme('light', false, true), 'light');
    assert.equal(resolveTheme('auto', false, false), 'light');
  });

  it('both pages’ first-paint scripts follow the device in the frame too and mark the frame before the first paint', () => {
    for (const page of ['index.html', 'courses.html']) {
      const html = readFileSync(new URL(`../${page}`, import.meta.url), 'utf8');
      const head = html.slice(0, html.indexOf('</head>'));
      assert.ok(!head.includes('!e &&'), `${page}: the frame no longer keeps Auto light`);
      assert.ok(head.includes("if (e) document.documentElement.classList.add('embed');"), `${page}: the frame is marked in <head>`);
      // …before the storage read, which can throw.
      assert.ok(head.indexOf("classList.add('embed')") < head.indexOf('localStorage.getItem('), page);
    }
  });

  it('the frame’s night palette is the csedept host theme’s (ndt 4.0): navy page and surfaces, white headings, gold links', () => {
    const css = readFileSync(new URL('../src/style-base.css', import.meta.url), 'utf8');
    const block = /:root\.embed\[data-theme="dark"\]\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    const token = (name: string) => new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`).exec(block)?.[1];
    assert.equal(token('bg'), '#091b34');
    assert.equal(token('card'), '#0c2340');
    assert.equal(token('ink'), '#e9ebee');
    assert.equal(token('navy'), '#ffffff');
    assert.equal(token('link'), '#ddc278');
    // Inside the screen-only block, as the charcoal night palette is: paper stays light.
    const screen = css.indexOf('@media screen {');
    assert.ok(screen >= 0 && screen < css.indexOf(':root.embed[data-theme="dark"]'));
  });

  it('both pages’ first-paint scripts probe forced dark with the same link colour as theme.ts', () => {
    for (const page of ['index.html', 'courses.html']) {
      const html = readFileSync(new URL(`../${page}`, import.meta.url), 'utf8');
      const head = html.slice(0, html.indexOf('</head>'));
      assert.ok(head.includes(`getComputedStyle(a).color === '${FORCED_DARK_LINK}'`), `${page}: the inline script probes ${FORCED_DARK_LINK}`);
      assert.ok(head.includes("color-scheme:light") && head.includes('(forced-colors: active)'), page);
    }
  });

  it('both pages set the theme in <head> with the same storage key, before the first paint', () => {
    for (const page of ['index.html', 'courses.html']) {
      const html = readFileSync(new URL(`../${page}`, import.meta.url), 'utf8');
      const head = html.slice(0, html.indexOf('</head>'));
      assert.ok(head.includes(`localStorage.getItem('${THEME_KEY}')`), `${page}: the inline script reads ${THEME_KEY}`);
      assert.match(head, /<meta name="color-scheme" content="light dark" \/>/, page);
    }
  });

  it('every colour in the stylesheets outside :root and print is a token', () => {
    // Three sheets since 2026-10-22 (W4): the shared base and one per page.
    for (const file of ['style-base.css', 'style-app.css', 'style-courses.css']) {
      const css = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
      // Strip the token definitions and the @media print blocks (paper stays light).
      let rest = css.replace(/:root\s*\{[^}]*\}/, '').replace(/:root\[data-theme="dark"\]\s*\{[^}]*\}/, '').replace(/:root\.embed\[data-theme="dark"\]\s*\{[^}]*\}/, '');
      rest = rest.replace(/@media print\s*\{(?:[^{}]|\{[^{}]*\})*\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
      assert.deepEqual(rest.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [], [], file);
    }
  });
});
