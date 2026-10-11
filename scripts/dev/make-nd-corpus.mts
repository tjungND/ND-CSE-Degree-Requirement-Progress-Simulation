// Builds tests/fixtures/nd-transcripts/ — the Notre Dame corpus the replay
// scores (DGS 2026-10-11, item 12: "measure the Notre Dame import"). Every
// document is synthetic: the generator's Notre Dame PDFs
// (tests/fixtures/make-transcript-pdfs.mjs) read through the app's own layout
// stage, and the line lists the tests invent for the insideND and Banner
// layouts. No real transcript is ever read here (FERPA).
//
//   node --experimental-strip-types scripts/dev/make-nd-corpus.mts            # rewrite the line lists
//   node --experimental-strip-types scripts/dev/make-nd-corpus.mts --expect   # …and print the parser's
//                                                                              # reading as expected.json
//                                                                              # entries, for review
// expected.json is the TRUTH, written from the generator's own data and
// reviewed by hand — never copied from the parser without checking.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTranscript } from '../../src/transcript/parse.ts';
import { pdfToLinesNode } from './pdf-lines-node.mts';
import { ndFieldsOf, ndRowOf } from './score-nd.mts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(root, 'tests', 'fixtures', 'nd-transcripts');

const PDFS = ['nd-transcript', 'nd-official-transcript', 'nd-undergrad-transcript', 'nd-undergrad-in-progress-transcript', 'nd-insidend-transcript']; // combined-transcript.pdf is Purdue's (the external corpus)

// tests/transcript.test.ts, "insideND layout: each term’s college, major and
// level" — with each term's totals added up from its rows, as a real
// transcript prints them (the test's copy prints one constant line).
const T = (term: string, level: 'Undergraduate' | 'Graduate', college: string, major: string, rows: string[]) => {
  const cells = rows.map((r) => r.split(/ {3,}/));
  const hours = cells.reduce((n, c) => n + Number(c[c.length - 2]), 0);
  const points = cells.reduce((n, c) => n + Number(c[c.length - 1]), 0);
  const f = (n: number) => n.toFixed(3);
  return [
    `Term: ${term}`,
    'College   Major   Academic Standing',
    `${college}   ${major}   Good Standing`,
    'Subject   Course   Campus   Level   Title   Grade   Credit Hours   Quality Points   R',
    ...rows,
    `Term Totals (${level})   Attempt Hours   Passed Hours   Earned Hours   GPA Hours   Quality Points   GPA`,
    `Current Term   ${f(hours)}   ${f(hours)}   ${f(hours)}   ${f(hours)}   ${f(points)}   ${(points / hours).toFixed(2)}`,
  ];
};
const INVENTED: Record<string, string[]> = {
  'invented-insidend-terms': [
    'University of Notre Dame',
    'Unofficial Academic Transcript',
    'INSTITUTION CREDIT',
    ...T('Fall Semester 2020', 'Undergraduate', 'First Year of Studies', 'Computer Science', ['MATH 10550   Main   UG   Calculus I   A   4.000   16.000']),
    ...T('Spring Semester 2024', 'Undergraduate', 'College of Engineering', 'Computer Engineering', ['CSE 40113   Main   UG   Algorithms   A   3.000   12.000', 'CSE 60641   Main   GR   Operating Systems   A   3.000   12.000']),
    ...T('Fall Semester 2024', 'Graduate', 'College of Engineering', 'Computer Science & Engineering', ['CSE 60111   Main   GR   Complexity   A   3.000   12.000']),
    ...T('Spring Semester 2025', 'Graduate', 'College of Engineering', 'Computer Science & Engineering', ['CSE 60321   Main   GR   Architecture   A   3.000   12.000']),
    'TRANSCRIPT TOTALS',
    'Transcript Totals   Attempt Hours   Passed Hours   Earned Hours   GPA Hours   Quality Points   GPA',
    // The terms above added up by each term's level (the test's copy prints a
    // fragment, 130 undergraduate hours for 10 hours of rows).
    '( Graduate )',
    'Overall   6.000   6.000   6.000   6.000   24.000   4.00',
    '( Undergraduate )',
    'Overall   10.000   10.000   10.000   10.000   40.000   4.00',
    'COURSE(S) IN PROGRESS',
    'Term: Fall Semester 2025',
    'College   Major',
    'College of Engineering   Computer Science & Engineering',
    'CSE 60876   Main   GR   Research Methods   3.000',
  ],
  // tests/transcript.test.ts, "names the other reading when a degree is awarded between graduate-level terms".
  'invented-banner-degree-between-terms': [
    'University of Notre Dame',
    'Degrees Awarded',
    'Master of Science',
    'Degree Date: 15-MAY-2026',
    'INSTITUTION CREDIT',
    'Term: Fall Semester 2024',
    'CSE 60641 GR Graduate Operating Systems A 3.000 12.000',
    'Term: Spring Semester 2025',
    'CSE 60111 GR Complexity and Algorithms A 3.000 12.000',
    'Term: Fall Semester 2026',
    'CSE 60321 GR Advanced Computer Architecture A 3.000 12.000',
  ],
};

const docs: Record<string, string[]> = {};
for (const name of PDFS) docs[name] = await pdfToLinesNode(join(root, 'tests', 'fixtures', `${name}.pdf`));
Object.assign(docs, INVENTED);
for (const [name, lines] of Object.entries(docs)) writeFileSync(join(OUT, `${name}.json`), JSON.stringify(lines, null, 1) + '\n');
console.log(`wrote ${Object.keys(docs).length} line lists to tests/fixtures/nd-transcripts/`);

if (process.argv.includes('--expect')) {
  const out: Record<string, unknown> = {};
  for (const [name, lines] of Object.entries(docs)) {
    const p = parseTranscript(lines);
    const f = ndFieldsOf(p);
    out[name] = {
      isNotreDame: p.isNotreDame,
      courses: p.courses.map(ndRowOf),
      cumulativeGpa: p.cumulativeGpa ?? null,
      gpaGraduate: p.cumulativeGpaByLevel?.graduate ?? null,
      gpaUndergraduate: p.cumulativeGpaByLevel?.undergraduate ?? null,
      entryTerm: f.entryTerm,
      degrees: p.degreesAwarded.map((d) => `${d.level} ${d.date ?? '?'} ${d.name}`),
    };
  }
  console.log(JSON.stringify(out, null, 2));
}
