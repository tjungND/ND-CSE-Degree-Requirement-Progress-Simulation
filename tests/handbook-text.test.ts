// The CSE handbook's text behind the section chips (DGS 2026-10-05: "when the
// cursor hovers over the section of CSE handbook …, show its relevant texts").
// src/ui/handbook-text.ts (the edition and the section index) and
// public/handbook-text.json (the words, fetched on the first hover — W2,
// 2026-10-22) are both GENERATED from the handbook PDF by `npm run
// handbook-text`; these tests fail when either disagrees with the PDF, so a
// new edition of the PDF cannot ship with the old edition's words.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { HANDBOOK_INDEX, HANDBOOK_SOURCE, type HandbookText } from '../src/ui/handbook-text.ts';
import { handbookText, sectionsFor } from '../src/ui/section-ref.ts';

const TEXT_FILE = new URL('../public/handbook-text.json', import.meta.url);
const text = JSON.parse(readFileSync(TEXT_FILE, 'utf8')) as HandbookText;
const HANDBOOK_SECTIONS = text.sections;

describe('the handbook text behind the section chips', () => {
  it('was generated from the handbook PDF in policy-sources (run `npm run handbook-text` after replacing it)', () => {
    const pdf = readFileSync(new URL(`../${HANDBOOK_SOURCE.file}`, import.meta.url));
    const sha = createHash('sha256').update(pdf).digest('hex');
    assert.equal(sha, HANDBOOK_SOURCE.sha256, 'the handbook PDF changed — run `npm run handbook-text` and commit src/ui/handbook-text.ts and public/handbook-text.json');
    assert.equal(text.sha256, HANDBOOK_SOURCE.sha256, 'public/handbook-text.json is from another edition than src/ui/handbook-text.ts — run `npm run handbook-text` and commit both');
    assert.equal(text.file, HANDBOOK_SOURCE.file);
    assert.equal(text.edition, HANDBOOK_SOURCE.edition);
  });

  it('the bundled index names every section of the JSON, in order, with its title', () => {
    assert.deepEqual(
      HANDBOOK_INDEX.map((s) => ({ id: s.id, title: s.title })),
      HANDBOOK_SECTIONS.map((s) => ({ id: s.id, title: s.title })),
    );
    // The index must stay small — it is what every visit downloads (W2).
    assert.ok(readFileSync(new URL('../src/ui/handbook-text.ts', import.meta.url), 'utf8').length < 8_000, 'src/ui/handbook-text.ts should hold only the edition and the index');
  });

  it('holds the sections the pages cite, in the handbook’s own words', () => {
    const byId = new Map(HANDBOOK_SECTIONS.map((s) => [s.id, s]));
    for (const id of ['2.3', '3.2', '3.4', '4.2', '4.4', '4.4.1', '4.4.2', '4.4.3', '4.5', '4.6', '4.7']) assert.ok((byId.get(id)?.paragraphs.length ?? 0) > 0, id);
    assert.equal(byId.get('4.4.1')!.title, 'Core Knowledge Requirement');
    assert.equal(byId.get('3.5')!.title, 'Integrated B.S. + M.S. in Computer Science and Engineering', 'a wrapped title is joined');
    const paragraphs = (id: string) => byId.get(id)!.paragraphs.join(' ');
    assert.match(paragraphs('4.4.1'), /All PhD students are required to pass \(or have previously passed\) an Operating Systems course, an Algorithms course, and a Computer Architecture course/);
    assert.match(paragraphs('4.2'), /Up to six \(6\) credits from CSE 4xxxx may count toward both the graduate school’s 60-credit requirement/);
    assert.match(paragraphs('2.3'), /A research advisor must be a Tenure and Tenure Track \(TTT\) faculty member of the department\./);
    // §4.4.2's five groups are their own lines, not run into the next sentence.
    assert.ok(byId.get('4.4.2')!.paragraphs.includes('5. Systems and Software'));
  });

  it('reads ligatures as letters ("first", not "fi rst")', () => {
    const all = HANDBOOK_SECTIONS.flatMap((s) => s.paragraphs).join(' ');
    assert.doesNotMatch(all, /\b\w* f[il] [a-z]+/);
    assert.match(all, /\bfirst\b/);
  });

  it('a chip’s sections: one number with its subsections, a range through its last number', () => {
    const ids = (ref: string) => sectionsFor(ref).map((s) => s.id);
    assert.deepEqual(ids('§4.2'), ['4.2']);
    assert.deepEqual(ids('§4.4'), ['4.4', '4.4.1', '4.4.2', '4.4.3']);
    assert.deepEqual(ids('§2.3, §4.4–4.7'), ['2.3', '4.4', '4.4.1', '4.4.2', '4.4.3', '4.5', '4.6', '4.7']);
    assert.deepEqual(ids('§2.3, §3.4'), ['2.3', '3.4']);
    assert.deepEqual(ids('§9.9'), []);
  });

  // The words are fetched on the first hover (W2): one request per page,
  // shared by every chip; a failed request is forgotten so the next hover
  // asks again, and a file from another edition is refused.
  it('fetches the text once, retries after a failure, and refuses another edition', async () => {
    let calls = 0;
    const answers: (() => Response)[] = [
      () => new Response('', { status: 503 }),
      () => new Response(JSON.stringify({ ...text, sha256: 'not this edition' }), { status: 200 }),
      () => new Response(readFileSync(TEXT_FILE, 'utf8'), { status: 200 }),
    ];
    const stub = ((url: string) => {
      assert.equal(url, 'handbook-text.json', 'outside a page the bare path is asked for');
      return Promise.resolve(answers[Math.min(calls++, answers.length - 1)]!());
    }) as unknown as typeof fetch;
    await assert.rejects(handbookText(stub), /HTTP 503/);
    await assert.rejects(handbookText(stub), /another handbook edition/);
    const sections = await handbookText(stub);
    assert.equal(sections.length, HANDBOOK_SECTIONS.length);
    assert.equal(sections.find((s) => s.id === '4.4.1')?.title, 'Core Knowledge Requirement');
    assert.equal(calls, 3);
    // Settled: every later call shares the answer without a request.
    assert.equal((await handbookText(stub)).length, HANDBOOK_SECTIONS.length);
    assert.equal(calls, 3);
  });
});
