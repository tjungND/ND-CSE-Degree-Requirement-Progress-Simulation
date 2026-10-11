// The Notre Dame corpus (DGS 2026-10-11, item 12: "measure the Notre Dame
// import"): every document in tests/fixtures/nd-transcripts/ — the
// generator's Notre Dame PDFs read through the app's layout stage, and the
// invented insideND and Banner line lists — must read exactly as pinned:
// every row (id, title, credits, grade, term, UG/GR level; a transfer-block
// row with its institution) and every field (isNotreDame, the cumulative GPA
// and each level's, the entry term, the degrees awarded). The scorer is
// scripts/dev/score-nd.mts, the same one `npm run replay -- --corpus nd` uses.
// Rebuild the line lists with scripts/dev/make-nd-corpus.mts after the
// fixture PDFs change; expected.json is the generator's truth, reviewed by hand.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { parseTranscript } from '../src/transcript/parse.ts';
import { scoreNdDocument, type ExpectedNdDocument } from '../scripts/dev/score-nd.mts';

const dir = new URL('./fixtures/nd-transcripts/', import.meta.url);
const expected = JSON.parse(readFileSync(new URL('expected.json', dir), 'utf8')) as Record<string, ExpectedNdDocument>;
const files = readdirSync(dir).filter((n) => n.endsWith('.json') && n !== 'expected.json');

describe('the Notre Dame corpus reads exactly', () => {
  it('every line list has an expectation, and every expectation a line list', () => {
    assert.deepEqual(files.map((f) => f.replace(/\.json$/, '')).sort(), Object.keys(expected).sort());
  });
  for (const file of files) {
    const name = file.replace(/\.json$/, '');
    it(name, () => {
      const score = scoreNdDocument(parseTranscript(JSON.parse(readFileSync(new URL(file, dir), 'utf8'))), expected[name]!);
      assert.ok(score.exact, `${name}:\n${score.diffs.join('\n')}`);
    });
  }
});
