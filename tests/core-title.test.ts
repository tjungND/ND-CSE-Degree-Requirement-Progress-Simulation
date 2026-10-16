// §4.4.1 core-area title keywords, abbreviations included (DGS 2026-10-15:
// "DSGN&ANAL COMP ALGOR" — "I can confirm this is an algorithm course").
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CORE_TITLE_RE, coreTitleMatchesArea, coreTitleSuggestion } from '../src/engine/core-title.ts';

describe('core-area title keywords', () => {
  it('reads the full words, as before', () => {
    assert.equal(coreTitleSuggestion('Design and Analysis of Algorithms'), 'Algorithms');
    assert.equal(coreTitleSuggestion('Operating Systems'), 'Operating Systems');
    assert.equal(coreTitleSuggestion('Computer Architecture'), 'Computer Architecture');
  });
  it('reads a registrar’s abbreviations', () => {
    for (const [title, area] of [
      ['DSGN&ANAL COMP ALGOR', 'Algorithms'],
      ['DATA STRUC & ALGOS', 'Algorithms'],
      ['INTRO TO ALGO', 'Algorithms'],
      ['OPER SYS DESIGN', 'Operating Systems'],
      ['PRIN OP SYS', 'Operating Systems'],
      ['COMPUTER ARCHITEC', 'Computer Architecture'],
      ['COMP ARCH', 'Computer Architecture'],
      ['COMPUTER SYS ARCH', 'Computer Architecture'],
    ] as const) {
      assert.equal(coreTitleSuggestion(title), area, title);
      assert.ok(CORE_TITLE_RE.test(title), title);
    }
    assert.ok(coreTitleMatchesArea('DSGN&ANAL COMP ALGOR', 'algorithms'));
    assert.ok(!coreTitleMatchesArea('DSGN&ANAL COMP ALGOR', 'os'));
  });
  it('never a bare ALG, OS or ARCH, nor words that merely contain them', () => {
    for (const title of ['LINEAR ALG', 'ALGEBRA I', 'OS AND NETWORKS LAB', 'ARCH HISTORY', 'OPERATIONS RESEARCH', 'MONARCHY AND EMPIRE', 'COMPUTER SYSTEMS', 'COMPOSITION', 'SEARCH ENGINES', 'OPTICS SYSTEMS']) {
      assert.equal(coreTitleSuggestion(title), undefined, title);
      assert.ok(!CORE_TITLE_RE.test(title), title);
    }
  });
});
