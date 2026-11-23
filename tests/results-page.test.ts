// "Print" downloads the results as a web page (DGS 2026-11-22: "When 'Print'
// is clicked, can you generate an HTML page instead of a PDF?" — "1. A
// download; 2. the results only."). The pure parts of src/ui/results-page.ts;
// the copy of the page itself is checked in a real browser
// (scripts/e2e/drive-app.mjs checkResultsPage).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deviceDarkRules, deviceDarkSelector, fileCss, resultsFileName, resultsPageHtml, type CssRuleLike } from '../src/ui/results-page.ts';

describe('the downloaded results page (DGS 2026-11-22)', () => {
  it('is named like the record file, told apart by "-results.html"', () => {
    assert.equal(resultsFileName('phd', '2026-11-22'), 'cse-degree-audit-phd-2026-11-22-results.html');
    assert.equal(resultsFileName('mscse', '2026-11-22'), 'cse-degree-audit-mscse-2026-11-22-results.html');
    // A plan's file names its semester, as the simulation's record file does.
    assert.equal(resultsFileName('phd', '2027-01-11', { season: 'spring', year: 2027 }), 'cse-degree-audit-phd-simulation-SP27-results.html');
  });

  it('is a whole page that fetches nothing: its styles are in it, and no script', () => {
    const html = resultsPageHtml({ title: 'CSE degree self-check — results, November 22, 2026', css: ':root { --navy: #0c2340; }', bodyHtml: '<p>x</p>' });
    assert.match(html, /^<!doctype html>\n<html lang="en">/);
    assert.match(html, /<meta charset="utf-8">/);
    assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
    assert.match(html, /<style>\n:root \{ --navy: #0c2340; \}\n<\/style>/);
    assert.match(html, /<div id="app" class="results-file">\n<p>x<\/p>\n<\/div>/);
    assert.doesNotMatch(html, /<script|<link|src=/i);
  });

  it('escapes its title, and a stylesheet cannot close its own <style>', () => {
    const html = resultsPageHtml({ title: 'A & <B>', css: 'a::after { content: "</style><script>"; }', bodyHtml: '' });
    assert.match(html, /<title>A &amp; &lt;B&gt;<\/title>/);
    assert.equal(html.match(/<\/style>/g)?.length, 2, 'only the two <style> blocks close');
  });

  it('paints the night colours on a dark device: the theme switch’s rules, re-keyed on prefers-color-scheme', () => {
    assert.equal(deviceDarkSelector(':root[data-theme="dark"]'), ':root:not([data-theme="light"])');
    assert.equal(deviceDarkSelector(':where(html[data-theme="dark"]) a:where(:visited)'), ':where(html:not([data-theme="light"])) a:where(:visited)');
    const style = (selectorText: string, body: string): CssRuleLike => ({ selectorText, cssText: `${selectorText} { ${body} }` });
    const sheet: CssRuleLike[] = [
      style(':root', '--bg: #f4f6f9;'),
      { cssText: '@media screen { :root[data-theme="dark"] { --bg: #091b34; } }', cssRules: [style(':root[data-theme="dark"]', '--bg: #091b34;')] },
      style('.x', 'color: red;'),
    ];
    assert.deepEqual(deviceDarkRules(sheet), ['@media screen {\n:root:not([data-theme="light"]) { --bg: #091b34; }\n}']);
    const css = fileCss([sheet]);
    // Every rule as it was, then the night block for a dark device.
    assert.ok(css.startsWith(':root { --bg: #f4f6f9; }\n@media screen { :root[data-theme="dark"] { --bg: #091b34; } }\n.x { color: red; }\n'));
    assert.ok(css.endsWith('@media (prefers-color-scheme: dark) {\n@media screen {\n:root:not([data-theme="light"]) { --bg: #091b34; }\n}\n}'));
    // A sheet with no night rules adds no block.
    assert.equal(fileCss([[style('.x', 'color: red;')]]), '.x { color: red; }');
  });
});
