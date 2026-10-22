// Night mode (DGS 2026-10-04): Auto follows the device, as Claude Desktop's
// Appearance setting does; Light and Dark are fixed; embedded, Auto is light.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { FORCED_DARK_LINK, THEME_KEY, resolveTheme } from '../src/ui/theme.ts';

describe('night mode (src/ui/theme.ts)', () => {
  it('Auto follows the device; Light and Dark ignore it', () => {
    assert.equal(resolveTheme('auto', true, false), 'dark');
    assert.equal(resolveTheme('auto', false, false), 'light');
    assert.equal(resolveTheme('light', true, false), 'light');
    assert.equal(resolveTheme('dark', false, false), 'dark');
  });

  it('embedded in a light WordPress page, Auto stays light but Dark is honoured', () => {
    assert.equal(resolveTheme('auto', true, true), 'light');
    assert.equal(resolveTheme('dark', false, true), 'dark');
  });

  it('a browser forcing pages dark (Opera’s "Force dark pages") gets the page’s own dark theme on Auto — in the frame too; Light is still honoured', () => {
    assert.equal(resolveTheme('auto', false, false, true), 'dark');
    assert.equal(resolveTheme('auto', false, true, true), 'dark');
    assert.equal(resolveTheme('light', false, false, true), 'light');
    assert.equal(resolveTheme('auto', false, false, false), 'light');
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
      let rest = css.replace(/:root\s*\{[^}]*\}/, '').replace(/:root\[data-theme="dark"\]\s*\{[^}]*\}/, '');
      rest = rest.replace(/@media print\s*\{(?:[^{}]|\{[^{}]*\})*\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
      assert.deepEqual(rest.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [], [], file);
    }
  });
});
