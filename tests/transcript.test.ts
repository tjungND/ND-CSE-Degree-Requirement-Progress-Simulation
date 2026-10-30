// Transcript text parsing (the PDF layer is a thin pdfjs wrapper tested in the
// browser; the parsing itself is pure text → data and lives here).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseTranscript } from '../src/transcript/parse.ts';

const ND_TRANSCRIPT = `
University of Notre Dame
Unofficial Academic Transcript
This is not an official transcript.
Name : Jane Q. Student
Program : Computer Science and Engineering

TRANSFER CREDIT ACCEPTED BY INSTITUTION
202010: Purdue University
CS 50300 GR Operating Systems A 3.000 12.000
CS 51400 GR Numerical Methods TR 3.000

INSTITUTION CREDIT
Fall Semester 2026
CSE 60641 GR Graduate Operating Systems A 3.000 12.000
CSE 63801 GR Research Seminar I S 1.000 0.000
ACMS 60855 GR Spatio-Temporal Statistics B+ 3.000 9.999
CSE 60111 GR Complexity and Algorithms W 3.000

Spring Semester 2027
CSE 60321 GR Advanced Computer Architecture B- 3.000 8.001 R
CSE 60111 GR Complexity and Algorithms A- 3.000 11.001

TRANSCRIPT TOTALS (GRADUATE)
Attempt Hours Passed Hours Earned Hours GPA Hours Quality Points GPA
Total Institution: 16.000 13.000 13.000 12.000 40.002 3.334
Total Transfer: 3.000 3.000 3.000 0.000 0.000 0.000
Overall: 19.000 16.000 16.000 12.000 40.002 3.334

COURSES IN PROGRESS
Fall Semester 2027
CSE 60876 GR Research Methods 3.000
CSE 98900 GR Research and Dissertation 6.000
`.split('\n');

describe('transcript parsing', () => {
  const parsed = parseTranscript(ND_TRANSCRIPT);

  it('a subject printed one letter at a time is read without the spaces (DGS 2026-09-20)', () => {
    const spaced = parseTranscript(ND_TRANSCRIPT.map((l) => l.replace('CSE 60641 GR', 'C S E 60641 GR')));
    assert.ok(spaced.courses.some((c) => c.courseId === 'CSE 60641' && c.title === 'Graduate Operating Systems'));
  });
  it('reads an insideND title wrapped in its cell whole, whichever way the row is laid out (DGS 2026-10-30)', async () => {
    // Page 1: the row's other cells on the title's first line, as insideND
    // prints it; page 2: centred against the two title lines, which puts the
    // first line above its row. Read through pdfjs, as the browser does.
    const { pdfToLinesNode } = await import('../scripts/dev/pdf-lines-node.mts');
    const p = parseTranscript(await pdfToLinesNode(new URL('./fixtures/nd-insidend-wrapped-titles.pdf', import.meta.url).pathname));
    const titles = p.courses.map((c) => `${c.courseId} ${c.title}`);
    for (const t of ['CSE 40175 Ethical & Professional Issues', 'CSE 40243 Compilers and Language Design', 'CSE 40113 Design/Analysis of Algorithms']) assert.equal(titles.filter((x) => x === t).length, 2, titles.join(' | '));
  });
  it('takes back the first line of a centred title from the course above it (DGS 2026-10-30)', () => {
    const p = parseTranscript(['University of Notre Dame', 'Unofficial Academic Transcript', 'Term: Spring Semester 2026', 'Subject   Course   Campus   Level   Title   Grade   Credit   Quality   R', 'Hours   Points',
      'CSE 40175   Main   UG   Ethical & Professional Issues   A   3.000   12.000', 'Design/Analysis of', 'CSE 40113   Main   UG   A-   3.000   11.001', 'Algorithms', 'Term Totals (Undergraduate)']);
    assert.deepEqual(p.courses.map((c) => c.title), ['Ethical & Professional Issues', 'Design/Analysis of Algorithms']);
  });
  it('joins a title that Banner wrapped onto the next line (DGS 2026-09-22)', () => {
    const wrapped = ND_TRANSCRIPT.flatMap((l) => (l.startsWith('CSE 60321 GR Advanced Computer Architecture') ? ['CSE 60321 GR Advanced Computer B- 3.000 8.001 R', 'Architecture'] : [l]));
    const c = parseTranscript(wrapped).courses.find((x) => x.courseId === 'CSE 60321');
    assert.equal(c?.title, 'Advanced Computer Architecture');
    assert.equal(c?.grade, 'B-');
    // A totals header or a standing note after a row is not a title.
    const totals = ND_TRANSCRIPT.flatMap((l) => (l.startsWith('CSE 60321 GR') ? [l, 'TRANSCRIPT TOTALS (GRADUATE)'] : [l]));
    assert.equal(parseTranscript(totals).courses.find((x) => x.courseId === 'CSE 60321')?.title, 'Advanced Computer Architecture');
    const noted = ND_TRANSCRIPT.flatMap((l) => (l.startsWith('CSE 60321 GR') ? [l, 'Good Standing'] : [l]));
    assert.equal(parseTranscript(noted).courses.find((x) => x.courseId === 'CSE 60321')?.title, 'Advanced Computer Architecture');
  });
  it('recognizes a Notre Dame transcript', () => {
    assert.equal(parsed.isNotreDame, true);
  });

  it('reads graded institution courses with term, grade, credits, title', () => {
    const os = parsed.courses.find((c) => c.courseId === 'CSE 60641');
    assert.deepEqual(os, {
      courseId: 'CSE 60641',
      title: 'Graduate Operating Systems',
      credits: 3,
      grade: 'A',
      term: { season: 'fall', year: 2026 },
      origin: 'nd',
      institution: undefined,
      level: 'graduate',
    });
    const seminar = parsed.courses.find((c) => c.courseId === 'CSE 63801');
    assert.equal(seminar?.grade, 'S');
    assert.equal(seminar?.credits, 1);
    const acms = parsed.courses.find((c) => c.courseId === 'ACMS 60855');
    assert.equal(acms?.grade, 'B+');
  });

  it('handles retakes, repeat markers, and withdrawn courses', () => {
    const attempts = parsed.courses.filter((c) => c.courseId === 'CSE 60111');
    // Since 2026-10-03 a W row is KEPT as grade 'W' (a registration for residency, Academic Code §3.3), beside the A- retake.
    assert.equal(attempts.length, 2, 'the W attempt is kept as a W row, the A- retake kept');
    assert.deepEqual(attempts.map((a) => a.grade).sort(), ['A-', 'W']);
    const arch = parsed.courses.find((c) => c.courseId === 'CSE 60321');
    assert.equal(arch?.grade, 'B-', "the trailing 'R' repeat marker is ignored");
    assert.ok(!parsed.warnings.some((w) => w.includes('CSE 60111 (W)')), 'a kept W row is no longer a skipped-row warning');
  });

  it('marks transfer-section courses with origin and institution', () => {
    const purdue = parsed.courses.find((c) => c.courseId === 'CS 50300');
    assert.equal(purdue?.origin, 'transfer');
    assert.equal(purdue?.institution, 'Purdue University');
    assert.equal(purdue?.grade, 'A');
    // "202010" is Banner-speak for Fall 2020 (needed for the §5.2 window check).
    assert.deepEqual(purdue?.term, { season: 'fall', year: 2020 });
    // TR rows (no real grade shown) are skipped with a warning, never guessed.
    assert.equal(parsed.courses.some((c) => c.courseId === 'CS 51400'), false);
    assert.ok(parsed.warnings.some((w) => w.includes('CS 51400')));
  });

  it('reads courses-in-progress as IP', () => {
    const rm = parsed.courses.find((c) => c.courseId === 'CSE 60876');
    assert.equal(rm?.grade, 'IP');
    assert.deepEqual(rm?.term, { season: 'fall', year: 2027 });
    const diss = parsed.courses.find((c) => c.courseId === 'CSE 98900');
    assert.equal(diss?.credits, 6);
  });

  it("takes the cumulative GPA from the Overall totals row's last column", () => {
    assert.equal(parsed.cumulativeGpa, 3.334);
  });

  it('rejects a non-ND transcript', () => {
    const other = parseTranscript([
      'Purdue University',
      'Unofficial Transcript',
      'Fall Semester 2026',
      'CS 50300 GR Operating Systems A 3.000 12.000',
    ]);
    assert.equal(other.isNotreDame, false);
    assert.equal(other.courses.length, 0);
  });

  it("parses ND's OFFICIAL PDF layout (credits BEFORE grade, Ehrs/GPA running totals)", () => {
    const official = parseTranscript([
      'UNIVERSITY OF NOTRE DAME NOTRE DAME, INDIANA 46556',
      'Fall Semester 2026',
      'BIOS 60574 Tpcs in Evol & Systematic Biol 3.000 B+ 9.999',
      'CSE 60641 Graduate Operating Systems 3.000 A 12.000',
      'NOTRE DAME Ehrs: 72.000 QPts: 106.000 GPA-Hrs: 28.000 GPA: 3.786',
    ]);
    const bios = official.courses.find((c) => c.courseId === 'BIOS 60574');
    assert.equal(bios?.credits, 3, 'credits column, not the 9.999 quality points');
    assert.equal(bios?.grade, 'B+');
    assert.equal(bios?.title, 'Tpcs in Evol & Systematic Biol');
    assert.equal(official.cumulativeGpa, 3.786, 'labeled GPA from the running-totals line');
  });

  it('accepts Banner 9 wording, bare term labels, and a footer-URL-only ND marker', () => {
    const b9 = parseTranscript([
      'Academic Transcript',
      'Institutional Credit',
      'Fall 2026',
      'CSE 60641 GR Graduate Operating Systems A 3.000 12.000',
      'Course(s) in Progress',
      'Spring 2027',
      'CSE 60876 GR Research Methods 3.000',
      'https://studentselfservice.nd.edu/StudentSelfService — Page 1 of 1',
    ]);
    assert.equal(b9.isNotreDame, true, 'nd.edu footer URL is an ND marker');
    assert.equal(b9.courses.find((c) => c.courseId === 'CSE 60641')?.grade, 'A');
    assert.deepEqual(b9.courses.find((c) => c.courseId === 'CSE 60641')?.term, { season: 'fall', year: 2026 });
    assert.equal(b9.courses.find((c) => c.courseId === 'CSE 60876')?.grade, 'IP');
  });

  it('handles empty/garbage text without throwing', () => {
    assert.equal(parseTranscript([]).isNotreDame, false);
    const nd = parseTranscript(['University of Notre Dame', 'no course data here at all']);
    assert.equal(nd.isNotreDame, true);
    assert.equal(nd.courses.length, 0);
    assert.equal(nd.entryTerm, undefined);
    assert.deepEqual(nd.degreesAwarded, []);
  });

  it('reads the entry term of a graduate-only transcript as its earliest term', () => {
    assert.deepEqual(parsed.entryTerm, { term: { season: 'fall', year: 2026 }, how: 'the first graduate-level term on your transcript', alternative: undefined });
  });
});

// A COMBINED Notre Dame transcript (bug report 2026-09-05): eight
// undergraduate semesters, the B.S. awarded, then the Ph.D. terms — the
// deadlines and the residency count must start at the Ph.D. entry term, not at
// the first undergraduate term or at "this fall".
const COMBINED = `
University of Notre Dame
Academic Transcript
Student Information
Name: Jane Q. Student
Curriculum Information
Current Program
Doctor of Philosophy
College: Graduate School
Major: Computer Science and Engineering
Degrees Awarded
Bachelor of Science
Degree Date: May 19, 2024
Major: Computer Science

INSTITUTION CREDIT
Term: Fall Semester 2020
College: College of Engineering
Student Type: New First Time
CSE 10001 UG Principles of Computing A 3.000 12.000
MATH 10550 UG Calculus I A- 4.000 14.668
Term Totals (Undergraduate)
Term: Spring Semester 2021
CSE 20110 UG Discrete Mathematics B+ 3.000 9.999
Term: Fall Semester 2023
CSE 30321 UG Computer Architecture A 3.000 12.000
CSE 60641 UG Graduate Operating Systems A 3.000 12.000
Term: Spring Semester 2024
CSE 40113 UG Design/Analysis of Algorithms A 3.000 12.000
Term Totals (Undergraduate)
Term: Fall Semester 2024
College: Graduate School
Major: Computer Science and Engineering
Student Type: New
CSE 63801 GR Research Seminar I S 1.000 0.000
CSE 60111 GR Complexity and Algorithms A 3.000 12.000
CSE 60321 GR Advanced Computer Architecture A- 3.000 11.001
CSE 98900 GR Research and Dissertation 3.000 S 0.000
Term Totals (Graduate)
Term: Spring Semester 2025
CSE 63802 GR Research Seminar II S 1.000 0.000
CSE 60770 GR Secure Software Engineering A 3.000 12.000
CSE 98900 GR Research and Dissertation 6.000 S 0.000
TRANSCRIPT TOTALS (GRADUATE)
Overall: 20.000 20.000 20.000 9.000 35.001 3.889
COURSES IN PROGRESS
Term: Fall Semester 2025
CSE 60876 GR Research Methods 3.000
`.split('\n');

describe('combined transcript: entry term, levels and degrees (2026-09-05)', () => {
  const parsed = parseTranscript(COMBINED);

  it('reads the level of every Notre Dame row from its UG/GR column', () => {
    const level = (id: string, term: string) => parsed.courses.find((c) => c.courseId === id && `${c.term.season} ${c.term.year}` === term)?.level;
    assert.equal(level('CSE 10001', 'fall 2020'), 'undergraduate');
    assert.equal(level('CSE 60641', 'fall 2023'), 'undergraduate', 'a graduate course taken as an undergraduate keeps the UG registration level');
    assert.equal(level('CSE 60111', 'fall 2024'), 'graduate');
    assert.equal(level('CSE 60876', 'fall 2025'), 'graduate');
  });

  it('reads the awarded degree with its date, never the current program', () => {
    assert.deepEqual(parsed.degreesAwarded, [{ name: 'Bachelor of Science', level: 'bachelors', date: '2024-05-19' }]);
  });

  it("puts the entry term at the graduate admission, not at the first undergraduate term", () => {
    assert.equal(parsed.entryTerm?.term.season, 'fall');
    assert.equal(parsed.entryTerm?.term.year, 2024);
    assert.equal(parsed.entryTerm?.how, 'the term your transcript marks as your admission at the graduate level');
    assert.equal(parsed.entryTerm?.alternative, undefined);
  });

  it('falls back to the first graduate-level term without a Student Type marker', () => {
    const noMarker = parseTranscript(COMBINED.filter((l) => !/Student Type/.test(l)));
    assert.deepEqual(noMarker.entryTerm?.term, { season: 'fall', year: 2024 });
    assert.equal(noMarker.entryTerm?.how, 'the first graduate-level term on your transcript');
  });

  it('a stated admit term wins over every other reading', () => {
    const stated = parseTranscript(['Admit Term: Spring 2025', ...COMBINED]);
    assert.deepEqual(stated.entryTerm, { term: { season: 'spring', year: 2025 }, how: 'the admit-term line on your transcript' });
    const banner = parseTranscript(['Matriculated: 202420', ...COMBINED]);
    assert.deepEqual(banner.entryTerm?.term, { season: 'spring', year: 2025 }, 'Banner code 202420 = Spring 2025');
  });

  it('two admit terms: the earlier one unless a master’s was awarded between them (DGS 2026-09-26 — a transfer into the Ph.D. keeps the MSCSE clock)', () => {
    const transfer = parseTranscript(['University of Notre Dame', 'Admit Term: Fall 2022', 'Admit Term: Fall 2024']);
    assert.deepEqual(transfer.entryTerm?.term, { season: 'fall', year: 2022 });
    assert.equal(transfer.entryTerm?.how, 'the earlier of the admit-term lines on your transcript — your matriculation at the Graduate School, which a transfer between Notre Dame programs does not reset');
    assert.deepEqual(transfer.entryTerm?.alternative?.term, { season: 'fall', year: 2024 });
    const finished = parseTranscript(['University of Notre Dame', 'Admit Term: Fall 2022', 'Degree Awarded: Master of Science in Computer Science and Engineering   May 19, 2024', 'Admit Term: Fall 2024']);
    assert.deepEqual(finished.entryTerm?.term, { season: 'fall', year: 2024 });
    assert.equal(finished.entryTerm?.alternative, undefined);
  });
  it('names the other reading when a degree is awarded between graduate-level terms (prior M.S. or along-the-way M.S.)', () => {
    const lines = [
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
    ];
    const p = parseTranscript(lines);
    assert.deepEqual(p.degreesAwarded, [{ name: 'Master of Science', level: 'masters', date: '2026-05-15' }]);
    assert.deepEqual(p.entryTerm?.term, { season: 'fall', year: 2024 }, 'the earlier reading is kept (earlier deadlines are the safe error)');
    assert.deepEqual(p.entryTerm?.alternative?.term, { season: 'fall', year: 2026 });
    assert.match(p.entryTerm?.alternative?.why ?? '', /Master of Science awarded 2026-05-15/);
    assert.match(p.entryTerm?.alternative?.why ?? '', /entry term is Fall 2026/);
  });

  // A 4+1 leaves a signature nothing else does: graduate-level terms that begin
  // BEFORE the bachelor's degree. "The first graduate-level term" is then the
  // student's third year of college, not the start of any graduate program
  // (DGS 2026-09-10: "if the student advances to our own PhD, the entry term
  // is when they start the PhD").
  it('a 4+1 transcript starts the program after the LAST degree it awards', () => {
    const p = parseTranscript([
      'UNIVERSITY OF NOTRE DAME',
      'Unofficial Academic Transcript',
      'DEGREE AWARDED Bachelor of Science  Degree Date: 05/18/2025',
      'DEGREE AWARDED Master of Science  Degree Date: 05/17/2026',
      'Term: Fall Semester 2024',
      'CSE 60641 GR Graduate Operating Systems A 3.000 12.000',
      'Term: Spring Semester 2025',
      'CSE 60111 GR Complexity and Algorithms A 3.000 12.000',
      'Term: Fall Semester 2025',
      'CSE 60321 GR Advanced Computer Architecture A 3.000 12.000',
      'Term: Fall Semester 2026',
      'CSE 63801 GR Research Seminar I A 1.000 4.000',
    ]);
    assert.deepEqual(p.entryTerm?.term, { season: 'fall', year: 2026 }, 'the Ph.D. starts after the master\u2019s, not in the junior year');
    assert.match(p.entryTerm?.how ?? '', /4\+1 pattern/);
  });

  // The MSCSE earned ALONG THE WAY (§4.5) looks similar — a master's awarded
  // with graduate terms after it — but its graduate terms all start after the
  // bachelor's degree, so the earlier reading is still the right one.
  it('a master\u2019s earned along the way does not move the entry term', () => {
    const p = parseTranscript([
      'UNIVERSITY OF NOTRE DAME',
      'Unofficial Academic Transcript',
      'DEGREE AWARDED Bachelor of Science  Degree Date: 05/18/2022',
      'DEGREE AWARDED Master of Science  Degree Date: 05/17/2026',
      'Term: Fall Semester 2024',
      'CSE 60641 GR Graduate Operating Systems A 3.000 12.000',
      'Term: Fall Semester 2026',
      'CSE 63801 GR Research Seminar I A 1.000 4.000',
    ]);
    assert.deepEqual(p.entryTerm?.term, { season: 'fall', year: 2024 });
    assert.deepEqual(p.entryTerm?.alternative?.term, { season: 'fall', year: 2026 }, 'the other reading is still offered');
  });

  it('without level markers, uses the course number and the term after the last awarded degree', () => {
    const official = parseTranscript([
      'UNIVERSITY OF NOTRE DAME NOTRE DAME, INDIANA 46556',
      'Bachelor of Science Awarded 05/19/2024',
      'Fall Semester 2022',
      'CSE 30321 Computer Architecture 3.000 A 12.000',
      'Fall Semester 2024',
      'CSE 60641 Graduate Operating Systems 3.000 A 12.000',
    ]);
    assert.equal(official.courses.find((c) => c.courseId === 'CSE 30321')?.level, 'undergraduate');
    assert.equal(official.courses.find((c) => c.courseId === 'CSE 60641')?.level, 'graduate');
    assert.deepEqual(official.degreesAwarded[0], { name: 'Bachelor of Science', level: 'bachelors', date: '2024-05-19' });
    assert.deepEqual(official.entryTerm?.term, { season: 'fall', year: 2024 });
    // Only undergraduate-numbered rows: no graduate-level term → after the degree.
    const ugOnly = parseTranscript([
      'University of Notre Dame',
      'Degree Awarded Bachelor of Science 19-MAY-2024',
      'Fall Semester 2022',
      'CSE 30321 UG Computer Architecture A 3.000 12.000',
      'Fall Semester 2024',
      'CSE 40113 UG Design/Analysis of Algorithms A 3.000 12.000',
    ]);
    assert.deepEqual(ugOnly.entryTerm, { term: { season: 'fall', year: 2024 }, how: 'the first term after your Bachelor of Science was awarded' });
  });
});

// The two REAL Notre Dame layouts (2026-09-05, from de-identified samples the
// DGS shared): Banner 9's web "Academic Transcript" (a Campus column before
// the Level, a "Transcript Level" table, "Term : Fall Semester 2026") and the
// official Parchment PDF ("UNIVERSITY OF NOTRE DAME CREDIT:", "Course Level:"
// per record, the transfer block's institution on the term line, credits
// BEFORE the grade, Roman-numeral titles on credit-only rows).
describe('Notre Dame layouts seen in real samples (2026-09-05)', () => {
  it('Banner 9 web transcript: Campus column, Transcript Level table, A+', () => {
    const p = parseTranscript([
      '7/10/27, 6:17 PM   Academic Transcript',
      'Transcript Level   Transcript Type',
      'Graduate   Web Transcript   Level',
      'Institution Credit',
      'Term : Fall Semester 2026',
      'College   Major   Academic Standing',
      'College of   Computer Science &   -',
      'Subject Course Campus Level Title   Grade Credit Hours Quality Points R',
      'CSE   60641   Main   GR   Graduate Operating Systems   A+   3.000   12.000',
      'CSE   63801   Main   GR   Research Seminar I   S   1.000   0.000',
      'Term Totals (Graduate)   Attempt Hours Passed Hours Earned Hours GPA Hours Quality Points GPA',
      'Course(s) in Progress',
      'Term : Spring Semester 2027',
      'Subject   Course   Campus   Level   Title   Credit Hours',
      'CSE   60111   Main   GR   Complexity and Algorithms   3.000',
      'https://bxestuprod.oit.nd.edu/StudentSelfService/ssb/academicTranscript#!/maintenance   1/2',
    ]);
    assert.equal(p.isNotreDame, true);
    const os = p.courses.find((c) => c.courseId === 'CSE 60641');
    assert.equal(os?.title, 'Graduate Operating Systems', 'the Campus and Level cells are not part of the title');
    assert.equal(os?.grade, 'A', 'A+ maps to A');
    assert.equal(os?.level, 'graduate');
    assert.equal(p.courses.find((c) => c.courseId === 'CSE 60111')?.grade, 'IP');
    assert.deepEqual(p.entryTerm?.term, { season: 'fall', year: 2026 });
  });

  it('official Parchment PDF: ND CREDIT section, Course Level per record, transfer institution on the term line', () => {
    const p = parseTranscript([
      'Jane Q. Student   Date Issued: 19-MAY-2031',
      'Degree Awarded: Bachelor of Arts',
      'Date Conferred: May 19, 2024',
      'Course Level: Undergraduate',
      'Program: Bachelor of Arts',
      'TRANSFER CREDIT ACCEPTED BY THE UNIVERSITY:',
      'Fall 2020   College Board',
      'MATH 10550   Calculus I   4.000',
      'UNIVERSITY OF NOTRE DAME CREDIT:',
      'Fall Semester 2020',
      'First Year of Studies',
      'CSE 10001   Principles of Computing   3.000 A   12.000',
      'CSE 60641   Graduate Operating Systems   3.000 A-   11.001',
      'Good Standing   Total   7.000   7.000   7.000   7.000   26.001   3.714',
      'Course Level: Graduate',
      'Program: Doctor of Philosophy',
      'UNIVERSITY OF NOTRE DAME CREDIT:',
      'Fall Semester 2024',
      'CSE 60111   Complexity and Algorithms   3.000 B+   9.999',
      'OVERALL   Ehrs:   6.000 QPts:   23.000',
      'GPA-Hrs:   6.000   GPA:   3.833',
    ]);
    assert.equal(p.isNotreDame, true);
    const calc = p.courses.find((c) => c.courseId === 'MATH 10550');
    assert.equal(calc?.origin, 'transfer');
    assert.equal(calc?.institution, 'College Board');
    assert.equal(calc?.title, 'Calculus I', 'a Roman numeral on a credit-only row is not an Incomplete');
    assert.equal(calc?.grade, 'IP');
    assert.equal(p.courses.find((c) => c.courseId === 'CSE 10001')?.level, 'undergraduate');
    assert.equal(p.courses.find((c) => c.courseId === 'CSE 60641')?.level, 'undergraduate', 'the record level beats the course number');
    assert.equal(p.courses.find((c) => c.courseId === 'CSE 60111')?.level, 'graduate');
    assert.deepEqual(p.degreesAwarded, [{ name: 'Bachelor of Arts', level: 'bachelors', date: '2024-05-19' }]);
    assert.deepEqual(p.entryTerm?.term, { season: 'fall', year: 2024 });
    assert.equal(p.cumulativeGpa, 3.833);
  });
});

// A new student's official Parchment PDF (DGS 2026-10-14: "This looks like an
// ND transcript, but no course lines could be read from it"). Its shape was read
// with scripts/diagnose-transcript.mjs — letters and digits masked, nothing else
// seen — and is rebuilt here with invented values: the in-progress rows end in
// "IN PROGRESS" after the credits, a one-letter cell sits beside each course
// number, and "IN PROGRESS WORK" heads the term's rows. (The "&amp;" in the
// relayed shapes was the chat's escaping of "&": the script would have masked a
// printed "&amp;" to "&aaa;" — review of the fix, 2026-10-14.)
const ND_PARCHMENT_NEW_STUDENT = [
  'Student, Sample   Date Issued: 14-OCT-2026',
  'Student ID: XXXXX0000   Page:   1',
  'Birth Date: 00-00-XXXX',
  'Record Of: Sam St',
  'Parchment DocumentID: ABCDEFGH',
  'sst0@nd.edu',
  'Course Level: Graduate',
  'Program: PhD - Computer Science & Engr',
  'College: College of Engineering',
  'Major: Computer Science & Engineering',
  '________________________________________________________________________________',
  'THE GRADUATE SCHOOL   STUDENT RECORD',
  'SUBJ   NO   COURSE TITLE   CRD   GRD   PNTS',
  'UNIVERSITY OF NOTRE DAME CREDIT:',
  'Fall Semester 2026',
  'IN PROGRESS WORK',
  'CSE   60111 F   Complexity and Algorithms   3.000 IN PROGRESS',
  'CSE   60641 F   Graduate Operating Systems   3.000 IN PROGRESS',
  'CSE   60321 F   Computer Architecture I   3.000 IN PROGRESS',
  'CSE   63801 F   Graduate Research Seminar   1.000 IN PROGRESS',
  'In Progress Credits   10.000',
  '********************** TRANSCRIPT TOTALS ***********************',
  'NOTRE DAME   Ehrs:   0.000 QPts:   0.000',
  'GPA-Hrs:   0.000   GPA:   0.000',
  'TRANSFER   Ehrs:   0.000 QPts:   0.000',
  'GPA-Hrs:   0.000   GPA:   0.000',
  'OVERALL   Ehrs:   0.000 QPts:   0.000',
  'GPA-Hrs:   0.000   GPA:   0.000',
  '********************** END OF TRANSCRIPT ***********************',
];
const ND_PARCHMENT_ROWS = [
  'CSE 60111 | Complexity and Algorithms | 3 | IP | fall 2026 | nd | graduate',
  'CSE 60641 | Graduate Operating Systems | 3 | IP | fall 2026 | nd | graduate',
  'CSE 60321 | Computer Architecture I | 3 | IP | fall 2026 | nd | graduate',
  'CSE 63801 | Graduate Research Seminar | 1 | IP | fall 2026 | nd | graduate',
];
const rowsOf = (p: ReturnType<typeof parseTranscript>) => p.courses.map((c) => `${c.courseId} | ${c.title} | ${c.credits} | ${c.grade} | ${c.term.season} ${c.term.year} | ${c.origin} | ${c.level}`);
/** One official-layout row under "IN PROGRESS WORK", for the variants below. */
const officialInProgress = (row: string) => parseTranscript(['Course Level: Graduate', 'UNIVERSITY OF NOTRE DAME CREDIT:', 'Fall Semester 2026', 'IN PROGRESS WORK', row]);

describe('official Parchment PDF of a new student: courses in progress (2026-10-14)', () => {
  it('reads every row as in progress, with its credits, term and level, and no letter cell in the title', () => {
    const p = parseTranscript(ND_PARCHMENT_NEW_STUDENT);
    assert.equal(p.isNotreDame, true);
    assert.deepEqual(rowsOf(p), ND_PARCHMENT_ROWS);
    assert.deepEqual(p.entryTerm?.term, { season: 'fall', year: 2026 });
    assert.equal(p.cumulativeGpa, undefined, 'no GPA hours yet: no GPA');
    assert.deepEqual(p.degreesAwarded, []);
    assert.deepEqual(p.warnings, []);
  });

  it('the generator’s PDF of this layout (cover page, landscape record, legend) reads the same through pdfjs', async () => {
    const { pdfToLinesNode } = await import('../scripts/dev/pdf-lines-node.mts');
    const p = parseTranscript(await pdfToLinesNode(new URL('./fixtures/nd-parchment-new-student-transcript.pdf', import.meta.url).pathname));
    assert.equal(p.isNotreDame, true);
    assert.deepEqual(rowsOf(p), ND_PARCHMENT_ROWS);
    assert.deepEqual(p.entryTerm?.term, { season: 'fall', year: 2026 });
    // Its legend's "Undergraduate" and "cumulative GPA of 3.0" lines come after END OF TRANSCRIPT.
    assert.equal(p.cumulativeGpa, undefined);
  });

  it('a graded row in the same layout keeps its credits and grade, and loses only the letter cell', () => {
    const p = parseTranscript(['Course Level: Graduate', 'UNIVERSITY OF NOTRE DAME CREDIT:', 'Fall Semester 2026', 'CSE   60111 F   Complexity and Algorithms   3.000 A-   11.001']);
    assert.deepEqual(p.courses.map((c) => [c.courseId, c.title, c.credits, c.grade]), [['CSE 60111', 'Complexity and Algorithms', 3, 'A-']]);
  });

  it('every spelling of the mark after the credits, and “IP” between the credits and the quality points', () => {
    for (const tail of ['3.000 IN PROGRESS', '3.000   In Progress', '3.000 IN-PROGRESS', '3.000 INPROG', '3.000 INPROGRESS', '3.000 IP', '3.000 IP   0.000']) {
      assert.deepEqual(officialInProgress(`CSE   60641 F   Graduate Operating Systems   ${tail}`).courses.map((c) => [c.title, c.credits, c.grade]), [['Graduate Operating Systems', 3, 'IP']], tail);
    }
  });

  it('a row marked in progress never reads its title’s last word as a grade', () => {
    for (const letter of ['A', 'B', 'P', 'S', 'W', 'X', 'I']) {
      const p = officialInProgress(`CSE   60321 F   Graduate Seminar ${letter}   3.000 IN PROGRESS`);
      assert.deepEqual(p.courses.map((c) => [c.title, c.credits, c.grade]), [[`Graduate Seminar ${letter}`, 3, 'IP']], letter);
      assert.deepEqual(p.warnings, [], letter);
    }
  });

  it('never reads a title’s own words as the mark or the letter cell', () => {
    // A title ending in "IP" before the credits (Banner web, in progress).
    const web = parseTranscript(['University of Notre Dame', 'COURSES IN PROGRESS', 'Term: Fall Semester 2026', 'CSE 60770 GR Voice over IP 3.000']).courses;
    assert.deepEqual(web.map((c) => [c.title, c.credits, c.grade]), [['Voice over IP', 3, 'IP']]);
    // A title that begins with a one-letter word, one space after it.
    const title = parseTranscript(['University of Notre Dame', 'INSTITUTION CREDIT', 'Fall Semester 2026', 'CSE   60111   A Survey of Algorithms   A   3.000   12.000']).courses;
    assert.deepEqual(title.map((c) => [c.title, c.grade]), [['A Survey of Algorithms', 'A']]);
    // A graded title whose last word looks like a grade, when no mark follows.
    const graded = parseTranscript(['Course Level: Graduate', 'UNIVERSITY OF NOTRE DAME CREDIT:', 'Fall Semester 2026', 'CSE   60321 F   Computer Architecture I   3.000 B+   9.999']).courses;
    assert.deepEqual(graded.map((c) => [c.title, c.credits, c.grade]), [['Computer Architecture I', 3, 'B+']]);
  });

  it('a course titled “… in Progress Workshop” is a course, not the in-progress heading', () => {
    const p = parseTranscript([
      'Course Level: Graduate',
      'TRANSFER CREDIT ACCEPTED BY THE UNIVERSITY:',
      'Fall 2024   Purdue University',
      'CS 59000   Research in Progress Workshop   3.000',
      'CS 50300   Operating Systems   3.000',
      'UNIVERSITY OF NOTRE DAME CREDIT:',
      'Fall Semester 2025',
      'CSE 60111   Complexity and Algorithms   3.000 A   12.000',
    ]);
    assert.deepEqual(
      p.courses.map((c) => [c.courseId, c.origin, c.institution]),
      [['CS 59000', 'transfer', 'Purdue University'], ['CS 50300', 'transfer', 'Purdue University'], ['CSE 60111', 'nd', undefined]],
    );
    assert.deepEqual(p.entryTerm?.term, { season: 'fall', year: 2025 });
    assert.deepEqual(officialInProgress('SOC   63001 F   Research in Progress Workshop   1.000 IN PROGRESS').courses.map((c) => [c.courseId, c.title, c.grade]), [['SOC 63001', 'Research in Progress Workshop', 'IP']]);
    // …nor “Work in Progress Seminar”, which the older headings swallowed too.
    const seminar = parseTranscript(['Course Level: Graduate', 'TRANSFER CREDIT ACCEPTED BY THE UNIVERSITY:', 'Fall 2024   Purdue University', 'PUBH 60900   Work in Progress Seminar   3.000', 'CS 50300   Operating Systems   3.000', 'UNIVERSITY OF NOTRE DAME CREDIT:', 'Fall Semester 2025', 'CSE 60111   Complexity and Algorithms   3.000 A   12.000']);
    assert.deepEqual(seminar.courses.map((c) => [c.courseId, c.origin, c.institution]), [['PUBH 60900', 'transfer', 'Purdue University'], ['CS 50300', 'transfer', 'Purdue University'], ['CSE 60111', 'nd', undefined]]);
  });

  it('“IN PROGRESS WORK” opens Notre Dame rows after a transfer block, and closes a degrees-awarded block', () => {
    const transfer = parseTranscript([
      'University of Notre Dame',
      'Course Level: Graduate',
      'TRANSFER CREDIT ACCEPTED BY THE UNIVERSITY:',
      'Fall 2025   Purdue University',
      'CS    50100   Compilers   3.000',
      'Fall Semester 2026',
      'IN PROGRESS WORK',
      'CSE   60111 F   Complexity and Algorithms   3.000 IN PROGRESS',
    ]);
    assert.deepEqual(transfer.courses.map((c) => [c.courseId, c.origin, c.institution]), [['CS 50100', 'transfer', 'Purdue University'], ['CSE 60111', 'nd', undefined]]);
    const degrees = parseTranscript([
      'University of Notre Dame',
      'DEGREES AWARDED',
      'Bachelor of Science   20-MAY-2026',
      'Fall Semester 2026',
      'IN PROGRESS WORK',
      'Master of Science Thesis Direction',
      'CSE   60111 F   Complexity and Algorithms   3.000 IN PROGRESS',
    ]);
    assert.deepEqual(degrees.degreesAwarded, [{ name: 'Bachelor of Science', level: 'bachelors', date: '2026-05-20' }]);
  });

  it('nothing after END OF TRANSCRIPT is the record — the legend — unless another record starts', () => {
    const legend = [
      'GRADING SYSTEM - GRADUATE STUDENTS   CAMPUS CODES',
      'Undergraduate',
      'Good standing requires a cumulative GPA of 3.0.',
      'Master of Science degrees are conferred in May, August and December.',
      'Course numbers changed to five digits effective Fall 2010.',
      'Graduate',
    ];
    const p = parseTranscript([...ND_PARCHMENT_NEW_STUDENT, ...legend]);
    assert.deepEqual(rowsOf(p), ND_PARCHMENT_ROWS);
    assert.deepEqual(p.entryTerm?.term, { season: 'fall', year: 2026 });
    assert.equal(p.cumulativeGpa, undefined);
    assert.deepEqual(p.degreesAwarded, []);
    // A combined transcript that ended a record with the marker and started another.
    const next = parseTranscript([...ND_PARCHMENT_NEW_STUDENT, 'Course Level: Graduate', 'UNIVERSITY OF NOTRE DAME CREDIT:', 'Spring Semester 2027', 'IN PROGRESS WORK', 'CSE   60770 F   Machine Learning   3.000 IN PROGRESS']);
    assert.equal(next.courses.length, 5);
    assert.deepEqual(next.courses[4] && [next.courses[4].courseId, next.courses[4].term], ['CSE 60770', { season: 'spring', year: 2027 }]);
  });
});

describe('cumulative GPA per level (combined-transcript bug report 2026-09-05)', () => {
  // Banner 9 "All Levels" web transcript: the Transcript Totals section lists
  // the levels alphabetically — Graduate BEFORE Undergraduate — so "the last
  // Overall row" was the undergraduate GPA (3.68 in the report).
  const ALL_LEVELS = [
    'Academic Transcript',
    'Transcript Level   Transcript Type',
    'All Levels   Web Transcript',
    'Institution Credit',
    'Term : Fall Semester 2019',
    'Subject Course Campus Level Title   Grade Credit Hours Quality Points R',
    'CSE   10001   Main   UG   Principles of Computing   A   3.000   12.000',
    'Term Totals (Undergraduate)   Attempt Hours Passed Hours Earned Hours GPA Hours Quality Points GPA',
    'Current Term   3.000   3.000   3.000   3.000   12.000   4.000',
    'Cumulative   3.000   3.000   3.000   3.000   12.000   4.000',
    'Term : Spring Semester 2020',
    'CSE   20110   Main   UG   Discrete Mathematics   B   3.000   9.000',
    'Term Totals (Undergraduate)   Attempt Hours Passed Hours Earned Hours GPA Hours Quality Points GPA',
    'Current Term   3.000   3.000   3.000   3.000   9.000   3.000',
    'Cumulative   6.000   6.000   6.000   6.000   21.000   3.500',
    'Term : Fall Semester 2024',
    'CSE   60641   Main   GR   Graduate Operating Systems   A   3.000   12.000',
    'CSE   60111   Main   GR   Complexity and Algorithms   B+   3.000   9.999',
    'Term Totals (Graduate)   Attempt Hours Passed Hours Earned Hours GPA Hours Quality Points GPA',
    'Current Term   6.000   6.000   6.000   6.000   21.999   3.667',
    'Cumulative   6.000   6.000   6.000   6.000   21.999   3.667',
    'Transcript Totals',
    'Transcript Totals - (Graduate)   Attempt Hours Passed Hours Earned Hours GPA Hours Quality Points GPA',
    'Total Institution   6.000   6.000   6.000   6.000   21.999   3.667',
    'Total Transfer   0.000   0.000   0.000   0.000   0.000   0.000',
    'Overall   6.000   6.000   6.000   6.000   21.999   3.667',
    'Transcript Totals - (Undergraduate)   Attempt Hours Passed Hours Earned Hours GPA Hours Quality Points GPA',
    'Total Institution   6.000   6.000   6.000   6.000   21.000   3.500',
    'Total Transfer   0.000   0.000   0.000   0.000   0.000   0.000',
    'Overall   6.000   6.000   6.000   6.000   21.000   3.500',
    'https://bxestuprod.oit.nd.edu/StudentSelfService/ssb/academicTranscript',
  ];

  it('takes the GRADUATE level’s cumulative GPA, whatever order the levels are printed in', () => {
    const p = parseTranscript(ALL_LEVELS);
    assert.equal(p.cumulativeGpa, 3.667, 'the graduate figure, not the undergraduate 3.500 printed last');
    assert.deepEqual(p.cumulativeGpaByLevel, { undergraduate: 3.5, graduate: 3.667 });
  });

  it('files a term’s Cumulative row under its Term Totals level even without a Transcript Totals section', () => {
    const p = parseTranscript([...ALL_LEVELS.slice(0, 22), ALL_LEVELS[ALL_LEVELS.length - 1]!]); // cut before "Transcript Totals", keep the nd.edu marker line
    assert.equal(p.cumulativeGpa, 3.667);
    assert.deepEqual(p.cumulativeGpaByLevel, { undergraduate: 3.5, graduate: 3.667 });
  });

  it('never offers an undergraduate figure as the §2.2 GPA', () => {
    const p = parseTranscript(ALL_LEVELS.filter((l) => !/GR|Graduate/.test(l)));
    assert.equal(p.cumulativeGpa, undefined);
    assert.deepEqual(p.cumulativeGpaByLevel, { undergraduate: 3.5 });
  });

  it('keeps the last figure read when a transcript labels no level', () => {
    const p = parseTranscript(['University of Notre Dame Academic Transcript', 'Term: Fall Semester 2026', 'CSE 60641 Graduate Operating Systems A 3.000 12.000', 'TRANSCRIPT TOTALS', 'Overall: 3.000 3.000 3.000 3.000 12.000 4.000']);
    assert.equal(p.cumulativeGpa, 4);
    assert.equal(p.cumulativeGpaByLevel, undefined);
  });

  it('official PDF: each record’s TRANSCRIPT TOTALS block belongs to its Course Level', () => {
    const p = parseTranscript([
      'Course Level: Undergraduate',
      'UNIVERSITY OF NOTRE DAME CREDIT:',
      'Fall Semester 2020',
      'CSE 10001   Principles of Computing   3.000 A   12.000',
      '********* TRANSCRIPT TOTALS *********',
      'OVERALL   Ehrs:   3.000 QPts:   12.000',
      'GPA-Hrs:   3.000   GPA:   4.000',
      'Course Level: Graduate',
      'UNIVERSITY OF NOTRE DAME CREDIT:',
      'Fall Semester 2024',
      'CSE 60111   Complexity and Algorithms   3.000 B+   9.999',
      '********* TRANSCRIPT TOTALS *********',
      'OVERALL   Ehrs:   3.000 QPts:   9.999',
      'GPA-Hrs:   3.000   GPA:   3.333',
    ]);
    assert.equal(p.cumulativeGpa, 3.333);
    assert.deepEqual(p.cumulativeGpaByLevel, { undergraduate: 4, graduate: 3.333 });
  });
});

// "Degree Completion Date" / "Conferral Date" labels (DGS request 2026-09-06,
// late evening) supply the date like "Degree Date:" does.
describe('degree date labels on a Notre Dame transcript (2026-09-06, late evening)', () => {
  it('reads "Degree Completion Date:", "Conferral Date:" and "Completion Date" like "Degree Date:"', () => {
    for (const label of ['Degree Completion Date: 05/16/2021', 'Conferral Date: May 16, 2021', 'Completion Date 16-MAY-2021']) {
      const p = parseTranscript(['University of Notre Dame', 'Degrees Awarded', 'Bachelor of Science', label, 'INSTITUTION CREDIT', 'Term: Fall Semester 2021', 'CSE 60641 GR Graduate Operating Systems A 3.000 12.000']);
      assert.deepEqual(p.degreesAwarded, [{ name: 'Bachelor of Science', level: 'bachelors', date: '2021-05-16' }], label);
    }
  });
});

// insideND's unofficial-transcript layout as the DGS's redacted copies show it
// (2026-10-08; this fixture is invented, only the layout is real): each term
// has a "College   Major   Academic Standing" table — the values on the next
// line, cells three spaces apart — and no degrees-awarded block, program or
// student type. A Transcript Totals block closes the record, each total under
// its own "( Graduate )" / "( Undergraduate )" line.
describe('insideND layout: each term’s college, major and level (2026-10-08)', () => {
  const T = (term: string, level: 'Undergraduate' | 'Graduate', college: string, major: string, rows: string[]) => [
    `Term: ${term}`,
    'College   Major   Academic Standing',
    `${college}   ${major}   Good Standing`,
    'Subject   Course   Campus   Level   Title   Grade   Credit Hours   Quality Points   R',
    ...rows,
    `Term Totals (${level})   Attempt Hours   Passed Hours   Earned Hours   GPA Hours   Quality Points   GPA`,
    'Current Term   15.000   15.000   15.000   15.000   57.000   3.80',
  ];
  const lines = [
    'University of Notre Dame',
    'Unofficial Academic Transcript',
    'INSTITUTION CREDIT',
    ...T('Fall Semester 2020', 'Undergraduate', 'First Year of Studies', 'Computer Science', ['MATH 10550   Main   UG   Calculus I   A   4.000   16.000']),
    ...T('Spring Semester 2024', 'Undergraduate', 'College of Engineering', 'Computer Engineering', ['CSE 40113   Main   UG   Algorithms   A   3.000   12.000', 'CSE 60641   Main   GR   Operating Systems   A   3.000   12.000']),
    ...T('Fall Semester 2024', 'Graduate', 'College of Engineering', 'Computer Science & Engineering', ['CSE 60111   Main   GR   Complexity   A   3.000   12.000']),
    ...T('Spring Semester 2025', 'Graduate', 'College of Engineering', 'Computer Science & Engineering', ['CSE 60321   Main   GR   Architecture   A   3.000   12.000']),
    'TRANSCRIPT TOTALS',
    'Transcript Totals   Attempt Hours   Passed Hours   Earned Hours   GPA Hours   Quality Points   GPA',
    '( Graduate )',
    'Overall   6.000   6.000   6.000   6.000   24.000   4.00',
    '( Undergraduate )',
    'Overall   130.000   130.000   130.000   120.000   456.000   3.80',
    'COURSE(S) IN PROGRESS',
    'Term: Fall Semester 2025',
    'College   Major',
    'College of Engineering   Computer Science & Engineering',
    'CSE 60876   Main   GR   Research Methods   3.000',
  ];
  const parsed = parseTranscript(lines);
  it('reads each term’s college and major from the table', () => {
    assert.deepEqual(parsed.terms?.map((t) => [`${t.term.season} ${t.term.year}`, t.level ?? '-', t.college, t.major]), [
      ['fall 2020', 'undergraduate', 'First Year of Studies', 'Computer Science'],
      ['spring 2024', 'undergraduate', 'College of Engineering', 'Computer Engineering'],
      ['fall 2024', 'graduate', 'College of Engineering', 'Computer Science & Engineering'],
      ['spring 2025', 'graduate', 'College of Engineering', 'Computer Science & Engineering'],
      ['fall 2025', '-', 'College of Engineering', 'Computer Science & Engineering'],
    ]);
  });
  it('the Transcript Totals’ "( Undergraduate )" does not relabel the last term or its courses', () => {
    assert.equal(parsed.terms?.find((t) => t.term.year === 2025 && t.term.season === 'spring')?.level, 'graduate');
    assert.equal(parsed.courses.find((c) => c.courseId === 'CSE 60321')?.level, 'graduate');
  });
  it('the graduate course in the undergraduate senior spring keeps its GR registration', () => {
    assert.equal(parsed.courses.find((c) => c.courseId === 'CSE 60641')?.level, 'graduate');
  });
});
