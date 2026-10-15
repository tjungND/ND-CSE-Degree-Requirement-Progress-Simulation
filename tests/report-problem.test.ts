// "Does this look wrong?" (DGS 2026-10-11, item 18): mailto links to the DGS
// from each result card and each transcript preview. The page sends nothing;
// the email carries what the DGS needs to reproduce the problem and nothing
// else from the record — no course, grade or title in clear.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { audit } from '../src/engine/audit.ts';
import { ADGS, DGS, deciderContact } from '../src/ui/contacts.ts';
import { MAILTO_BODY_LIMIT } from '../src/ui/copy-dialog.ts';
import { maskShape, requirementProblemHref, transcriptProblemHref, type TranscriptProblem } from '../src/ui/report-problem.ts';
import { allScenarios, buildRules } from './helpers.ts';

const CHECKED = 'Checked with: course rules 3f9a2c1b (read live, last updated on October 9, 2026) · CSE Graduate Studies Handbook (Updated September 2026) · app version abc1234 of October 11, 2026.';
const parts = (href: string) => {
  const u = new URL(href);
  return { to: decodeURIComponent(u.pathname), subject: u.searchParams.get('subject') ?? '', body: u.searchParams.get('body') ?? '' };
};

describe('the result card’s link', () => {
  it('names the requirement, what the page shows and what it was checked with', () => {
    const sc = allScenarios().find((s) => s.name === 'clock-phd-candidacy-8th-semester-after')!;
    const report = audit(sc.student, buildRules(sc.rules.patch), sc.today);
    const row = report.requirements.find((r) => r.id === 'phd.candidacy')!;
    const m = parts(requirementProblemHref(row, 'Overdue', CHECKED)!);
    assert.equal(m.to, DGS.email);
    assert.equal(m.subject, `Self-check: this looks wrong — ${row.title} (§4.5)`);
    assert.ok(m.body.includes(`Requirement: ${row.title} (§4.5) — phd.candidacy\nThe page shows: Overdue (unmet [overdue])\n${CHECKED}\n`), m.body);
    assert.ok(m.body.endsWith('What looks wrong, and what I expected instead:\n'));
    // Nothing from the record: no course of the student's appears.
    for (const c of sc.student.courses) assert.ok(!m.body.includes(c.courseId), c.courseId);
  });

  it('goes to the student’s decider: the ADGS on the MSCSE tab, as everywhere on it', () => {
    const sc = allScenarios().find((s) => s.name === 'life-mscse-thesis-finished')!;
    const row = audit(sc.student, buildRules(sc.rules.patch), sc.today).requirements[0]!;
    assert.equal(deciderContact('mscse'), ADGS);
    assert.equal(parts(requirementProblemHref(row, 'Met', CHECKED, deciderContact('mscse'))!).to, ADGS.email);
    assert.equal(parts(transcriptProblemHref({ which: 'Notre Dame transcript', university: 'University of Notre Dame', readBy: 'the PDF’s text', rowsRead: 1, rowsTicked: 1, rowsTyped: 0, changed: [] }, CHECKED, deciderContact('mscse'))!).to, ADGS.email);
  });

  it('offers no link when the rules sheet’s DGS address is unusable', () => {
    const was = DGS.email;
    try {
      DGS.email = 'mailto:tjung at nd';
      const row = audit(allScenarios()[0]!.student, buildRules(), allScenarios()[0]!.today).requirements[0]!;
      assert.equal(requirementProblemHref(row, 'Met', CHECKED), undefined);
    } finally {
      DGS.email = was;
    }
  });
});

describe('the transcript preview’s link', () => {
  const problem = (n: number): TranscriptProblem => ({
    which: 'Previous Master’s Transcript',
    university: 'PURDUE UNIVERSITY',
    readBy: 'the PDF’s text',
    rowsRead: 12,
    rowsTicked: 11,
    rowsTyped: 1,
    changed: Array.from({ length: n }, (_, i) => ({ read: ['CS 50300', 'Operating Systems', '3', 'Fall 2024', 'B+'], fields: i % 2 ? ['grade'] : ['credits', 'term'] })),
  });

  it('masks every changed row: letters as A/a, digits as 9', () => {
    assert.equal(maskShape('CS 50300 | Operating Systems | 3 | Fall 2024 | B+'), 'AA 99999 | Aaaaaaaaa Aaaaaaa | 9 | Aaaa 9999 | A+');
    assert.equal(maskShape('Ünïversität 12'), 'Aaaaaaaaaaa 99');
    const m = parts(transcriptProblemHref(problem(2), CHECKED)!);
    assert.equal(m.subject, 'Self-check: the transcript reader got my transcript wrong — PURDUE UNIVERSITY');
    assert.ok(m.body.includes('Transcript: Previous Master’s Transcript — PURDUE UNIVERSITY\nRead from: the PDF’s text\nRows read: 12; ticked to add: 11; changed by me: 2; typed by me: 1\n'), m.body);
    assert.ok(m.body.includes('  1. AA 99999 | Aaaaaaaaa Aaaaaaa | 9 | Aaaa 9999 | A+ — I changed: credits, term\n'), m.body);
    for (const clear of ['CS 50300', 'Operating Systems', 'B+', '2024']) assert.ok(!m.body.includes(clear), clear);
    assert.ok(m.body.includes(CHECKED));
  });

  it('reads, for a plain-ASCII row, word for word as it did before every script was masked (2026-10-15)', () => {
    assert.equal(
      parts(transcriptProblemHref(problem(2), CHECKED)!).body,
      'The transcript reader got my transcript wrong.\n\nTranscript: Previous Master’s Transcript — PURDUE UNIVERSITY\nRead from: the PDF’s text\nRows read: 12; ticked to add: 11; changed by me: 2; typed by me: 1\n' +
        'The rows I changed, as the reader read them (letters shown as A/a, digits as 9 — no grades or courses):\n' +
        '  1. AA 99999 | Aaaaaaaaa Aaaaaaa | 9 | Aaaa 9999 | A+ — I changed: credits, term\n  2. AA 99999 | Aaaaaaaaa Aaaaaaa | 9 | Aaaa 9999 | A+ — I changed: grade\n' +
        `${CHECKED}\n\nWhat the reader got wrong (I can send a copy of the transcript with my name and ID removed if you ask):\n`,
    );
    // Every printable ASCII character keeps its old shape: letters A/a, digits 9, the rest as typed — a typed ? too.
    const ascii = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('');
    assert.equal(maskShape(ascii), ' !"#$%&\'()*+,-./9999999999:;<=>?@AAAAAAAAAAAAAAAAAAAAAAAAAA[\\]^_`aaaaaaaaaaaaaaaaaaaaaaaaaa{|}~');
  });

  // Until 2026-10-15 only cased letters and decimal digits were masked, so a
  // name in a script without case went into the email in clear.
  it('masks every script: letters without case as a, digits of every script as 9', () => {
    assert.equal(maskShape('王小明'), 'aaa', 'a Chinese name');
    assert.equal(maskShape('计算机科学导论 CS 101'), 'aaaaaaa AA 999', 'a Chinese title beside a Latin code');
    assert.equal(maskShape('김민수 컴퓨터공학'), 'aaa aaaaa', 'Hangul');
    assert.equal(maskShape('محمد'), 'aaaa', 'Arabic');
    assert.equal(maskShape('דוד'), 'aaa', 'Hebrew');
    assert.equal(maskShape('สมชาย'), 'aaaaa', 'Thai');
    assert.equal(maskShape('٢٠٢٤ ۱۴۰۳'), '9999 9999', 'Arabic-Indic and Persian digits');
    assert.equal(maskShape('２０２４ ＣＳ'), '9999 AA', 'full-width digits and capitals');
    assert.equal(maskShape('① Ⅻ ½'), '9 9 9', 'a circled digit, a Roman numeral, a fraction');
    // One pass for the letters: a second pass for "any other letter" would turn these capitals into a.
    assert.equal(maskShape('ÀÉ ΩΣ Жж ǅ'), 'AA AA Aa a');
  });

  it('shows an accent printed apart, a private-use glyph and an enclosed letter as ?, an invisible character as ¤', () => {
    assert.equal(maskShape('é'), 'a', 'an accented letter in one code point is a letter');
    assert.equal(maskShape('René'), 'Aaaa?', 'a combining accent');
    assert.equal(maskShape('राम'), 'a?a', 'a Devanagari vowel sign (a combining mark)');
    assert.equal(maskShape(''), '????', 'private-use glyphs a symbol font spells a name with');
    assert.equal(maskShape('\u{F0041}'), '?', 'a supplementary private-use code point is one ?');
    assert.equal(maskShape('ⒿⓄⒽⓃ 🅹'), '???? ?', 'enclosed letters');
    assert.equal(maskShape('Fall 2024 – “B”'), 'Aaaa?9999 ? ?A?', 'a non-breaking space, a dash and curly quotes');
    assert.equal(maskShape('A​B‮C\tD'), 'A¤A¤A¤A', 'a zero-width space, a direction override and a tab');
    // Nothing outside printable ASCII survives anywhere in Unicode — only A, a, 9, ¤ and ?.
    for (let cp = 0; cp <= 0x10ffff; cp++) {
      if (cp >= 0x20 && cp <= 0x7e) continue;
      const m = maskShape(String.fromCodePoint(cp));
      if (!/^[Aa9¤?]$/.test(m)) assert.fail(`U+${cp.toString(16).toUpperCase()} masked as ${JSON.stringify(m)}`);
    }
  });

  it('says what ? and ¤ stand for only when a row shown has one', () => {
    const rows = (read: string[][]): TranscriptProblem => ({ ...problem(0), changed: read.map((r) => ({ read: r, fields: ['title'] })) });
    const cjk = parts(transcriptProblemHref(rows([['CS 101', '王小明的课程', '３', 'Fall ٢٠٢٤', 'A']]), CHECKED)!).body;
    assert.ok(cjk.includes('(letters shown as A/a, digits as 9 — no grades or courses):\n  1. AA 999 | aaaaaa | 9 | Aaaa 9999 | A — I changed: title\n'), cjk);
    for (const clear of ['王', '小', '明', '课', '３', '٢', '٤']) assert.ok(!cjk.includes(clear), clear);
    const special = parts(transcriptProblemHref(rows([['CS 101', 'ⒿⓄⒽⓃ René', '3', 'Fall 2024', 'A']]), CHECKED)!).body;
    assert.ok(special.includes('(letters shown as A/a, digits as 9, special characters as ? — no grades or courses):\n  1. AA 999 | ????? Aaaa? | 9 | Aaaa 9999 | A — I changed: title\n'), special);
    const both = parts(transcriptProblemHref(rows([['CS​101', 'Algorithms – I', '3', 'Fall 2024', 'A']]), CHECKED)!).body;
    assert.ok(both.includes('(letters shown as A/a, digits as 9, special characters as ?, invisible characters as ¤ — no grades or courses):\n  1. AA¤999 | Aaaaaaaaaa ? A | 9 | Aaaa 9999 | A — I changed: title\n'), both);
    const invisible = parts(transcriptProblemHref(rows([['CS 101', 'Algo­rithms', '3', 'Fall 2024', 'A']]), CHECKED)!).body;
    assert.ok(invisible.includes('(letters shown as A/a, digits as 9, invisible characters as ¤ — no grades or courses):\n  1. AA 999 | Aaaa¤aaaaaa |'), invisible);
    // A typed ? is plain ASCII: shown as typed, and no legend for it.
    const typed = parts(transcriptProblemHref(rows([['CS 101', 'What? Why?', '3', 'Fall 2024', 'A']]), CHECKED)!).body;
    assert.ok(typed.includes('(letters shown as A/a, digits as 9 — no grades or courses):\n  1. AA 999 | Aaaa? Aaa? |'), typed);
  });

  it('stays short enough for every email app, saying how many rows it left out', () => {
    const href = transcriptProblemHref(problem(40), CHECKED)!;
    const body = new URL(href).searchParams.get('body') ?? '';
    assert.ok(encodeURIComponent(body).length <= MAILTO_BODY_LIMIT, String(encodeURIComponent(body).length));
    assert.match(body, /\n {2}… and \d+ more\n/);
  });

  it('the Notre Dame preview reports counts only', () => {
    const m = parts(transcriptProblemHref({ which: 'Notre Dame transcript', university: 'University of Notre Dame', readBy: 'the PDF’s text', rowsRead: 18, rowsTicked: 16, rowsTyped: 0, changed: [] }, CHECKED)!);
    assert.ok(m.body.includes('Rows read: 18; ticked to add: 16; changed by me: 0; typed by me: 0\n'));
    assert.ok(!m.body.includes('The rows I changed'));
  });
});
