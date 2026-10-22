// The two pages' links to each other (DGS 2026-09-16): relative when
// standalone, the WordPress host page in the top window when the embed's
// iframe src names it; anything but an http(s) URL is ignored.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_HOST_PAGES, allowedHostPage, siblingAnchorAttrs, siblingLink } from '../src/ui/sibling-links.ts';

describe('links between the two pages', () => {
  it('standalone: the sibling file next to this one', () => {
    assert.deepEqual(siblingLink('course-rules', ''), { href: './courses.html' });
    assert.deepEqual(siblingLink('self-check', '?q=algorithms'), { href: './index.html' });
  });
  it('embedded: the host page named in the query string, in the top window', () => {
    assert.deepEqual(siblingLink('course-rules', '?course_rules_url=https%3A%2F%2Fcse.nd.edu%2Fgraduate%2Fcourse-rules%2F'), { href: 'https://cse.nd.edu/graduate/course-rules/', target: '_top' });
    assert.deepEqual(siblingLink('self-check', '?self_check_url=https://cse.nd.edu/graduate/self-check/&program=phd'), { href: 'https://cse.nd.edu/graduate/self-check/', target: '_top' });
  });
  it('only http(s) is honoured', () => {
    assert.deepEqual(siblingLink('course-rules', '?course_rules_url=javascript:alert(1)'), { href: './courses.html' });
    assert.deepEqual(siblingLink('self-check', '?self_check_url=data:text/html,hi'), { href: './index.html' });
  });
  // The parameter names the WordPress page that frames this one, and those are
  // always on an ND host. Anything else made an official-looking page into a
  // one-click hop to an attacker's site, under this page's own link text
  // (review R-2, 2026-09-18).
  it('only Notre Dame hosts are honoured', () => {
    assert.equal(allowedHostPage('https://cse.nd.edu/graduate/self-check/'), true);
    assert.equal(allowedHostPage('https://sites.nd.edu/cse/x'), true);
    assert.equal(allowedHostPage('https://nd.edu/'), true);
    assert.equal(allowedHostPage('https://evil.example/'), false);
    assert.equal(allowedHostPage('http://cse.nd.edu/x'), false, 'http is not honoured — the real host pages are https');
    assert.equal(allowedHostPage('https://nd.edu.evil.example/'), false, 'a suffix that only looks like nd.edu');
    assert.equal(allowedHostPage('https://nd.edu@evil.example/'), false, 'credentials hide the real host from a reader');
    assert.equal(allowedHostPage('https://notnd.edu/'), false);
    assert.equal(allowedHostPage(''), false);
    assert.deepEqual(siblingLink('self-check', '?self_check_url=https://evil.example/'), { href: './index.html' });
  });

  // DGS 2026-09-30: embedded, a cross-link goes to the ND page that frames the
  // sibling — not to the bare app page — unless the iframe src names another.
  it('embedded with no host page named: the ND page that frames the sibling, in the top window', () => {
    assert.deepEqual(siblingLink('self-check', '?embed=1', true), { href: 'https://sites.nd.edu/csedept/degree-requirement-self-checking/', target: '_top' });
    assert.deepEqual(siblingLink('course-rules', '?embed=1', true), { href: 'https://sites.nd.edu/csedept/courses-and-rules/', target: '_top' });
    assert.deepEqual(siblingLink('course-rules', '?embed=1&course_rules_url=https://cse.nd.edu/rules/', true), { href: 'https://cse.nd.edu/rules/', target: '_top' }, 'a named host page still wins');
    assert.deepEqual(siblingLink('course-rules', '?course_rules_url=https://evil.example/', true), { href: DEFAULT_HOST_PAGES['course-rules'], target: '_top' }, 'a refused host falls back to the ND page, not to the bare file');
    for (const url of Object.values(DEFAULT_HOST_PAGES)) assert.equal(allowedHostPage(url), true, 'the defaults pass their own allowlist: ' + url);
  });

  it('anchor attributes: a host page opens in the top window; standalone, the sibling file', () => {
    assert.deepEqual(siblingAnchorAttrs('course-rules', '', false), { href: './courses.html' });
    assert.deepEqual(siblingAnchorAttrs('course-rules', '?embed=1', true), { href: 'https://sites.nd.edu/csedept/courses-and-rules/', target: '_top', rel: 'noopener' });
    assert.deepEqual(siblingAnchorAttrs('course-rules', '?embed=1&course_rules_url=https://cse.nd.edu/rules/', true), { href: 'https://cse.nd.edu/rules/', target: '_top', rel: 'noopener' });
    assert.deepEqual(siblingAnchorAttrs('self-check', '?self_check_url=https://cse.nd.edu/self-check/', false), { href: 'https://cse.nd.edu/self-check/', target: '_top', rel: 'noopener' }, 'a named host page is honoured standalone too, as before');
  });

  // Blue-team review 2026-10-17, U29: the self-check's "course rules page"
  // links pass the student's program as the view, so the list opens on that
  // degree's columns — on the relative sibling only. A host page is a
  // WordPress page, which cannot take a query (DGS 2026-09-30).
  it('a query goes on the relative sibling only (U29)', () => {
    assert.deepEqual(siblingLink('course-rules', '', false, { view: 'phd' }), { href: './courses.html?view=phd' });
    assert.deepEqual(siblingAnchorAttrs('course-rules', '', false, { view: 'mscse' }), { href: './courses.html?view=mscse' });
    assert.deepEqual(siblingAnchorAttrs('course-rules', '?embed=1', true, { view: 'phd' }), { href: 'https://sites.nd.edu/csedept/courses-and-rules/', target: '_top', rel: 'noopener' }, 'the embedded default host page takes no query');
    assert.deepEqual(siblingAnchorAttrs('course-rules', '?course_rules_url=https://cse.nd.edu/rules/', false, { view: 'phd' }), { href: 'https://cse.nd.edu/rules/', target: '_top', rel: 'noopener' }, 'a named host page takes no query');
    assert.deepEqual(siblingLink('course-rules', '', false, {}), { href: './courses.html' }, 'an empty query adds nothing');
    assert.deepEqual(siblingLink('course-rules', '', false), { href: './courses.html' }, 'no query: as before');
  });
});
