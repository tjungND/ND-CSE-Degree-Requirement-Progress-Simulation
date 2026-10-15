// The best-effort parser for transcripts from other universities (line-level —
// pdfToLines is exercised by the e2e run). Its contract: candidates only, never
// silent guesses — unmappable grades stay unchosen, scans are rejected, ND
// transcripts are redirected to the ND uploader.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findExternalRule } from '../src/data/external.ts';
import { looseDateOnLine, parseExternalTranscript } from '../src/transcript/external.ts';
import { previewRowOf, undergraduateInProgress } from '../src/ui/external-upload.ts';
import { buildRules } from './helpers.ts';

const PURDUE = [
  'Purdue University',
  'Office of the Registrar',
  'Unofficial Transcript',
  'Student: John Q. Boilermaker',
  '',
  'Fall 2023',
  'CS 50300   Operating Systems                 3.0   A',
  'CS 59000   Special Topics in Systems         3.0   A-',
  '',
  'Spring 2024',
  'CS 58000   Algorithm Design                  3.0   B+',
  '',
  'Cumulative GPA: 3.83',
  'Page 1 of 1   Generated 2024-06-01',
].concat(Array(20).fill('Purdue University Registrar record — not an official copy unless sealed.'));

describe('external transcript parsing', () => {
  it('a subject printed one letter at a time is read without the spaces (DGS 2026-09-20)', () => {
    const spaced = parseExternalTranscript([...PURDUE.slice(0, 6), 'C S 50300   Operating Systems                 3.0   A', 'C S E 60641   Graduate Operating Systems   3.0   A', 'E E   235   Circuits I   4.0   B', ...PURDUE.slice(12)]);
    assert.deepEqual(spaced.courses.map((c) => c.courseId), ['CS 50300', 'CSE 60641', 'EE 235']);
  });
  it('reports graduate-degree conferral only on positive same-line evidence', () => {
    const withMs = parseExternalTranscript([...PURDUE, 'Master of Science in Computer Science — Conferred: May 2021']);
    assert.equal(withMs.degreeConferred, true);
    // A bachelor's conferral on a graduate transcript is NOT graduate-degree
    // evidence; neither is a transcript with no conferral line at all.
    const bsOnly = parseExternalTranscript([...PURDUE, 'Bachelor of Science Awarded May 2019']);
    assert.equal(bsOnly.degreeConferred, undefined);
    assert.equal(parseExternalTranscript(PURDUE).degreeConferred, undefined);
  });

  it('reads "Degree Completed: Master of Science" as conferral, but never a negative', () => {
    // "complet" wording added 2026-09-04 (a real transcript printed it).
    const completed = parseExternalTranscript([...PURDUE, 'Degree Completed: Master of Science']);
    assert.equal(completed.degreeConferred, true);
    const notCompleted = parseExternalTranscript([...PURDUE, 'Master of Science — Not Completed']);
    assert.equal(notCompleted.degreeConferred, undefined);
    const incomplete = parseExternalTranscript([...PURDUE, 'Incomplete: Master of Science requirements outstanding']);
    assert.equal(incomplete.degreeConferred, undefined);
  });

  it('reads lowercase course codes (2026-09-04)', () => {
    const lines = [...PURDUE.slice(0, 6), 'cs 5321   advanced operating systems   3.0   A', ...PURDUE.slice(12)];
    const r = parseExternalTranscript(lines);
    const c = r.courses.find((x) => x.courseId === 'CS 5321');
    assert.ok(c, 'lowercase code row parsed');
    assert.equal(c!.credits, 3);
    assert.equal(c!.grade, 'A');
  });

  it('reads subjects of seven letters or more when printed in capitals (UMass "COMPSCI", "STATISTC" — DGS bug report 2026-09-06)', () => {
    const lines = [
      'University of Massachusetts Amherst',
      'Office of the University Registrar',
      '',
      'Fall 2022',
      'COMPSCI 501   Formal Language Theory        3.00   A',
      'STATISTC 501   Methods of Applied Statistics   3.00   A-',
      'ENGLWRIT 112   College Writing   3.00   A',
      'MUSIC 100   Music Appreciation   3.00   B+',
      'CICS 305   Social Issues in Computing   3.00   A',
      // Subject and number in separate columns (Banner layout), long subject.
      'BIOCHEM   285   Cellular and Molecular Biology   4.00   B',
      // Prose that also reads "word number …": a long word in lowercase is not
      // a subject (the capitals rule), a stopword never is.
      'Chapter 3   Not a course   3.00   A',
      'Building 12   Not a course either   3.00   A',
      'Semester 2   Nor this   3.00   A',
      'Cumulative GPA: 3.83',
    ].concat(Array(20).fill('University of Massachusetts Amherst record — not an official copy unless sealed.'));
    const r = parseExternalTranscript(lines);
    assert.deepEqual(
      r.courses.map((c) => `${c.courseId} ${c.credits} ${c.grade}`),
      ['COMPSCI 501 3 A', 'STATISTC 501 3 A-', 'ENGLWRIT 112 3 A', 'MUSIC 100 3 B+', 'CICS 305 3 A', 'BIOCHEM 285 4 B'],
    );
    assert.equal(r.courses.find((c) => c.courseId === 'STATISTC 501')!.title, 'Methods of Applied Statistics');
    // Short subjects stay case-insensitive (2026-09-04).
    assert.equal(parseExternalTranscript([...lines.slice(0, 4), 'cs 5321   advanced operating systems   3.0   A', ...lines.slice(15)]).courses[0]!.courseId, 'CS 5321');
  });

  it('keeps numeric grades as rawGrade for the student to map (2026-09-04)', () => {
    const lines = [
      ...PURDUE.slice(0, 6),
      '30240233   Data Structures and Algorithms   4   92',
      '30240551   Operating Systems   85',
      ...PURDUE.slice(12),
    ];
    const r = parseExternalTranscript(lines);
    const withCredits = r.courses.find((x) => x.courseId === '30240233');
    assert.ok(withCredits, 'numeric-grade row with credits parsed');
    assert.equal(withCredits!.credits, 4);
    assert.equal(withCredits!.grade, undefined);
    assert.equal(withCredits!.rawGrade, '92');
    const gradeOnly = r.courses.find((x) => x.courseId === '30240551');
    assert.ok(gradeOnly, 'numeric-grade row without credits parsed');
    assert.equal(gradeOnly!.rawGrade, '85');
  });

  it('merges two-line course rows — code+title, then the numbers (2026-09-04)', () => {
    const lines = [
      ...PURDUE.slice(0, 6),
      'CS 6210   Advanced Operating Systems and',
      'Distributed Computing   3.0   A-',
      ...PURDUE.slice(12),
    ];
    const r = parseExternalTranscript(lines);
    const c = r.courses.find((x) => x.courseId === 'CS 6210');
    assert.ok(c, 'two-line row parsed');
    assert.equal(c!.credits, 3);
    assert.equal(c!.grade, 'A-');
    assert.match(c!.title ?? '', /Distributed Computing/);
  });

  it('refuses term/summary lines that look like codes ("FALL 2023  GPA 3.85")', () => {
    const lines = [...PURDUE.slice(0, 6), 'FALL 2023   GPA 3.85', 'SEM 2   TOTAL 15.0   A', ...PURDUE.slice(12)];
    const r = parseExternalTranscript(lines);
    assert.ok(!r.courses.some((x) => /FALL|SEM|TOTAL|GPA/.test(x.courseId)), 'no phantom term/summary courses');
  });

  it('strips record/transcript suffixes from the university guess', () => {
    const lines = ['TSINGHUA UNIVERSITY STUDENT RECORD', ...PURDUE.slice(1)];
    assert.equal(parseExternalTranscript(lines).university, 'TSINGHUA UNIVERSITY');
  });

  it('extracts course candidates with credits, mapped grades and the term year', () => {
    const r = parseExternalTranscript(PURDUE);
    assert.equal(r.hasTextLayer, true);
    assert.equal(r.looksLikeNotreDame, false);
    assert.equal(r.university, 'Purdue University');
    assert.equal(r.courses.length, 3);
    assert.deepEqual(
      r.courses.map((c) => [c.courseId, c.credits, c.grade, c.year]),
      [
        ['CS 50300', 3, 'A', 2023],
        ['CS 59000', 3, 'A-', 2023],
        ['CS 58000', 3, 'B+', 2024],
      ],
    );
    assert.match(r.courses[0]?.title ?? '', /Operating Systems/);
  });

  it('handles all-digit course codes and foreign grade tokens (kept raw, not guessed)', () => {
    const r = parseExternalTranscript([
      'Tsinghua University   Academic Transcript',
      '2019-2020 Autumn Term',
      '30240233   Operating Systems        4    92',
      '30240551   Algorithm Design         3    A+',
      ...Array(10).fill('Record issued by the Registrar — verify with the issuing office before relying on it.'),
    ]);
    assert.equal(r.university?.includes('Tsinghua University'), true);
    assert.equal(r.courses.length, 2);
    assert.equal(r.courses[0]?.courseId, '30240233');
    assert.equal(r.courses[0]?.grade, undefined); // "92" is not guessed at
    assert.equal(r.courses[0]?.credits, 4);
    assert.equal(r.courses[0]?.year, 2019);
    assert.equal(r.courses[1]?.grade, 'A'); // A+ maps to A, the top of ND's scale (2026-09-05; the student can change it)
    assert.equal(r.courses[1]?.rawGrade, undefined);
  });

  it('rejects PDFs with no text layer (scans/photos — system-generated only)', () => {
    const r = parseExternalTranscript(['', '  ', '']);
    assert.equal(r.hasTextLayer, false);
    assert.equal(r.courses.length, 0);
  });

  it('recognizes a Notre Dame transcript and does not treat it as external', () => {
    const r = parseExternalTranscript(
      Array(10).fill('University of Notre Dame   Unofficial Academic Transcript   nd.edu').concat(['CSE 60641   Graduate Operating Systems   3.0   A']),
    );
    assert.equal(r.looksLikeNotreDame, true);
  });

  it('ignores prose, totals and header lines (code + credits-or-grade required)', () => {
    const r = parseExternalTranscript([
      'Some University   Transcript of Records',
      'GPA: 3.90   Credits earned: 120',
      'Dean’s List   Fall 2020',
      'MATH 21001   Linear Algebra   4.0   A',
      '2020   was a strange year for everyone',
      ...Array(10).fill('Record issued by the Registrar — verify with the issuing office before relying on it.'),
    ]);
    assert.equal(r.courses.length, 1);
    assert.equal(r.courses[0]?.courseId, 'MATH 21001');
  });
});

// The transcript's own word for its terms (DGS 2026-09-11: "Can you tell from
// the transcript whether a university is on a quarter system?"). A term header
// or a credits heading that says quarter; nothing weaker.
describe('quarter-system detection (2026-09-11)', () => {
  // Padded past the 200-character floor below which a PDF is treated as scanned.
  const HEAD = ['Office of the University Registrar', 'This is an unofficial transcript produced for the student named below and may not be released to any third party without consent.', 'Student: (name withheld)   Program: Master of Science, Computer Science'];
  const uw = ['University of Washington', ...HEAD, 'Autumn Quarter 2023', 'CSE 544   Principles of DBMS   4.0   A', 'Winter Quarter 2024', 'CSE 546   Machine Learning   4.0   A-'];
  it('reads "Autumn Quarter 2023" as a quarter system, and the courses still parse', () => {
    const r = parseExternalTranscript(uw);
    assert.equal(r.quarterSystem, true);
    assert.equal(r.courses.length, 2);
  });
  it('a "Quarter Units" heading is enough on its own', () => {
    assert.equal(parseExternalTranscript(['Stanford University', ...HEAD, 'Fall 2023', 'Course   Title   Quarter Units   Grade', 'CS 229   Machine Learning   3   A']).quarterSystem, true);
  });
  it('a trimester transcript is read the same way (red-team F6, 2026-09-12)', () => {
    const r = parseExternalTranscript(['Old Harbour University', ...HEAD, 'Fall Trimester 2023', 'CS 501   Algorithms   4.0   A']);
    assert.equal(r.trimesterSystem, true);
    assert.equal(r.quarterSystem, undefined);
    assert.equal(parseExternalTranscript(['Old Harbour University', ...HEAD, 'Fall 2023', 'Course   Title   Trimester Hours   Grade', 'CS 501   Algorithms   4   A']).trimesterSystem, true);
  });
  it('a term GPA labelled with the term’s name, printed with its value, says so too — never a key’s sentence (DGS 2026-10-10, answer 4c)', () => {
    const nsu = ['North South University', ...HEAD, 'Spring 2022', 'CSE 115   Programming Language I   3   A-', 'Trimester GPA: 3.47   CGPA: 3.47   Credits Earned: 10'];
    assert.equal(parseExternalTranscript(nsu).trimesterSystem, true);
    assert.equal(parseExternalTranscript(['Old Harbour University', ...HEAD, 'Fall 2023', 'CS 501   Algorithms   4   A', 'Trimester G.P.A.   3.50']).trimesterSystem, true);
    assert.equal(parseExternalTranscript(['Old Harbour University', ...HEAD, 'Autumn 2023', 'CS 501   Algorithms   4   A', 'Quarter GPA: 3.20   Cumulative GPA: 3.20']).quarterSystem, true);
    // A key's sentence, or the label inside a key, may describe another era.
    const key = ['North South University', ...HEAD, 'Spring 2022', 'CSE 115   Programming Language I   3   A-', 'CGPA: 3.47', 'Grading System', 'The University follows three academic terms in each academic year in the trimester system.', 'Trimester GPA: 4.00 is the highest attainable.'];
    assert.equal(parseExternalTranscript(key).trimesterSystem, undefined);
    // The label without its value is prose.
    assert.equal(parseExternalTranscript(['North South University', ...HEAD, 'Spring 2022', 'CSE 115   Programming Language I   3   A-', 'The Trimester GPA is computed on courses taken that trimester.']).trimesterSystem, undefined);
  });
  it('a semester transcript, or a lone Winter session, says nothing', () => {
    assert.equal(parseExternalTranscript(['Purdue University', ...HEAD, 'Fall 2023', 'CS 50300   Operating Systems   3.0   A']).quarterSystem, undefined);
    assert.equal(parseExternalTranscript(['Purdue University', ...HEAD, 'Winter 2024', 'CS 50300   Operating Systems   3.0   A']).quarterSystem, undefined);
  });
});

describe('OCR confidence flags', () => {
  it('flags rows whose source line read below the floor; leaves confident rows unflagged', () => {
    const lines = [
      'Some University   Transcript of Records',
      'MATH 21001   Linear Algebra   4.0   A',
      'CS 5321   Operating Systems   3.0   B',
      ...Array(10).fill('Record issued by the Registrar — verify with the issuing office before relying on it.'),
    ];
    const conf = lines.map(() => 96);
    conf[2] = 61; // the CS 5321 line was hard to read
    const r = parseExternalTranscript(lines, conf);
    assert.equal(r.courses.length, 2);
    assert.equal(r.courses[0]?.lowConfidence, undefined);
    assert.equal(r.courses[1]?.lowConfidence, true);
  });

  it('flags OCR rows whose credits are not a half-credit multiple (0→6 misreads)', () => {
    const lines = [
      'Some University   Transcript of Records',
      'MATH 21001   Linear Algebra   3.6   A',
      ...Array(10).fill('Record issued by the Registrar.'),
    ];
    const withConf = parseExternalTranscript(lines, lines.map(() => 96));
    assert.equal(withConf.courses[0]?.lowConfidence, true);
    const noConf = parseExternalTranscript(lines);
    assert.equal(noConf.courses[0]?.lowConfidence, undefined); // text layer: trust the file
  });

  it('never flags anything when no confidences are given (text-layer path)', () => {
    const r = parseExternalTranscript([
      'Some University   Transcript of Records',
      'MATH 21001   Linear Algebra   4.0   A',
      ...Array(10).fill('Record issued by the Registrar.'),
    ]);
    assert.equal(r.courses[0]?.lowConfidence, undefined);
  });
});

// Combined B.S.+M.S. / 4+1 transcripts (2026-09-05): the per-row level lets a
// single transcript feed both undergraduate (§4.4.1 only) and graduate (§5.2)
// coursework — from a UG/GR cell, a level block, or the bachelor's conferral date.
describe('per-row level on combined transcripts (2026-09-05)', () => {
  it('splits rows at a dated bachelor’s conferral by term', () => {
    const p = parseExternalTranscript([
      ...PURDUE.slice(0, 5),
      'Bachelor of Science in Computer Science — Conferred: May 11, 2024',
      'Fall 2023',
      'CS 25100   Data Structures and Algorithms   4.0   A',
      'Spring 2024',
      'CS 35400   Operating Systems                3.0   A-',
      'Fall 2024',
      'CS 50300   Operating Systems                3.0   A',
      'CS 58000   Algorithm Design                 3.0   B+',
      'Master of Science in Computer Science — Conferred: May 10, 2025',
      ...PURDUE.slice(13),
    ]);
    assert.equal(p.bachelorsConferredOn, '2024-05-11');
    assert.equal(p.mixedLevels, true);
    assert.equal(p.degreeConferred, true);
    assert.deepEqual(
      p.courses.map((c) => [c.courseId, c.level]),
      [
        ['CS 25100', 'undergraduate'],
        ['CS 35400', 'undergraduate'],
        ['CS 50300', 'graduate'],
        ['CS 58000', 'graduate'],
      ],
    );
  });

  it('reads UG/GR cells on the row and "Level:" / "Term Totals" blocks; leaves rows undecided otherwise', () => {
    const p = parseExternalTranscript([
      ...PURDUE.slice(0, 5),
      'Fall 2023',
      'CS 25100 UG  Data Structures and Algorithms   4.0   A',
      'CS 50300 GR  Operating Systems                3.0   A',
      'Level: Graduate',
      'Spring 2024',
      'CS 58000   Algorithm Design                 3.0   B+',
      'Term Totals (Undergraduate)',
      'Fall 2024',
      'CS 35400   Operating Systems                3.0   A-',
      ...PURDUE.slice(13),
    ]);
    assert.deepEqual(
      p.courses.map((c) => [c.courseId, c.level, c.title]),
      [
        ['CS 25100', 'undergraduate', 'Data Structures and Algorithms'],
        ['CS 50300', 'graduate', 'Operating Systems'],
        ['CS 58000', 'graduate', 'Algorithm Design'],
        ['CS 35400', 'undergraduate', 'Operating Systems'],
      ],
    );
    assert.equal(p.mixedLevels, true);
    const plain = parseExternalTranscript(PURDUE);
    assert.ok(plain.courses.every((c) => c.level === undefined), 'no marker → no level (the slot decides)');
    assert.equal(plain.mixedLevels, undefined);
    assert.equal(plain.bachelorsConferredOn, undefined);
  });

  it('a line that merely starts with "Graduate …" is not a level block', () => {
    const p = parseExternalTranscript([
      ...PURDUE.slice(0, 5),
      'Graduate Operating Systems is a core course.',
      'Fall 2023',
      'CS 50300   Operating Systems                3.0   A',
      ...PURDUE.slice(13),
    ]);
    assert.equal(p.courses.length, 1);
    assert.equal(p.courses[0]?.level, undefined);
  });
});

// The bachelor's date under other labels (DGS request 2026-09-06, late evening:
// "use the degree conferral date or degree completion date"): "Degree Completion
// Date", "Conferral Date", "Date Conferred", "05/2024" — before or after the
// degree name. It splits the rows and pre-fills "Bachelor's degree awarded".
describe('bachelor’s conferral or completion date wording (2026-09-06, late evening)', () => {
  const rows = ['Fall 2023', 'CS 35400   Operating Systems   3.0   A', 'Fall 2024', 'CS 50300   Operating Systems   3.0   A'];
  const parse = (degreeLines: string[]) => parseExternalTranscript([...PURDUE.slice(0, 5), ...degreeLines, ...rows, ...PURDUE.slice(13)]);

  it('reads a "Degree Completion Date" line after the degree name and splits the rows at it', () => {
    const p = parse(['Bachelor of Science in Computer Science', 'Major: Computer Science', 'Degree Completion Date: 05/17/2024']);
    assert.equal(p.bachelorsConferredOn, '2024-05-17');
    assert.deepEqual(
      p.courses.map((c) => [c.courseId, c.level]),
      [
        ['CS 35400', 'undergraduate'],
        ['CS 50300', 'graduate'],
      ],
    );
    assert.equal(p.degreeConferred, undefined, 'a bachelor’s is not graduate-degree evidence');
  });

  it('reads "Conferral Date" up to two lines BEFORE the name, "Date Conferred" after it, and a month/year date', () => {
    assert.equal(parse(['Conferral Date: May 17, 2024', 'Bachelor of Arts, Computer Science']).bachelorsConferredOn, '2024-05-17');
    assert.equal(parse(['Degree Completion Date: 05/17/2024', 'College of Science', 'Bachelor of Science']).bachelorsConferredOn, '2024-05-17');
    assert.equal(parse(['Bachelor of Science', 'Date Conferred 17-MAY-2024']).bachelorsConferredOn, '2024-05-17');
    assert.equal(parse(['Bachelor of Science', 'Degree Completion Date: 05/2024']).bachelorsConferredOn, '2024-05-15', 'month/year → the 15th; only the term matters');
  });

  it('never takes a forecast, a sought degree, a date too far away, or the next degree’s date', () => {
    assert.equal(parse(['Degree Sought: Bachelor of Science', 'Expected Graduation: May 2027']).bachelorsConferredOn, undefined);
    assert.equal(parse(['Bachelor of Science in Computer Science', 'Expected Graduation Date: 05/17/2027']).bachelorsConferredOn, undefined);
    assert.equal(parse(['Conferral Date: May 17, 2024', 'a', 'b', 'c', 'Bachelor of Science']).bachelorsConferredOn, undefined, 'a dated line four lines earlier is not this degree’s');
    assert.equal(parse(['Bachelor of Science', 'Master of Science — Conferred: May 10, 2025']).bachelorsConferredOn, undefined);
    assert.equal(parse(['Bachelor of Science', 'Master of Science — Conferred: May 10, 2025']).degreeConferred, true);
  });

  // DGS 2026-10-15: "It also shows the degree and the conferral month year
  // in the end, although it does not explicitly say 'awarded' or
  // 'conferred.' Just the degree name and the month year."
  // A record that ends in Spring 2024, every row graded.
  const finished = ['Fall 2023', 'CS 35400   Operating Systems   3.0   A', 'Spring 2024', 'CS 38100   Algorithms   3.0   A'];
  const closing = (degreeLines: string[], before: string[] = [], record = finished) => parseExternalTranscript([...PURDUE.slice(0, 5), ...before, ...record, ...degreeLines, ...PURDUE.slice(13)]);
  it('the record’s closing line — only the bachelor’s name and a month and year — is its conferral', () => {
    const p = closing(['DEGREE: BACHELOR OF ARTS   MAY   2024']);
    assert.deepEqual([p.bachelorsConferred, p.bachelorsConferredOn], [true, '2024-05-15']);
    assert.deepEqual(p.courses.map((c) => [c.courseId, c.level]), [['CS 35400', 'undergraduate'], ['CS 38100', 'undergraduate']]);
    for (const line of [
      'DEGREE:   BACHELOR OF ARTS   MAY   2024',
      'DEGREE: BACHELOR OF ARTS   MAY   2024.',
      'Bachelor of Science in Computer Science   May 2024',
      'Bachelor of Applied Science   May 2024',
      'Bachelor of Science in Construction Project Management   May 2024',
      'Bachelor’s Degree in Economics   May 2024',
      "Bachelor's Degree in Economics   May 2024",
    ]) assert.equal(closing([line]).bachelorsConferredOn, '2024-05-15', line);
  });
  it('…dated in the record’s last term or the one after it: an August conferral is a summer one, a January one follows the fall', () => {
    assert.equal(closing(['DEGREE: BACHELOR OF SCIENCE   AUGUST   2024']).bachelorsConferredOn, '2024-08-01');
    const fall = ['Fall 2023', 'CS 35400   Operating Systems   3.0   A', 'Fall 2024', 'CS 38100   Algorithms   3.0   A'];
    assert.equal(closing(['DEGREE: BACHELOR OF SCIENCE   JANUARY   2025'], [], fall).bachelorsConferredOn, '2025-01-15');
    // Two terms on, or years on, it is no record of this work's end.
    for (const line of ['DEGREE: BACHELOR OF SCIENCE   DECEMBER   2024', 'DEGREE: BACHELOR OF SCIENCE   MAY   2027']) assert.equal(closing([line]).bachelorsConferred, undefined, line);
  });
  // Re-review of the fix (2026-10-15).
  it('…never on a record still in progress: a row in progress, or a last term without a final grade', () => {
    const inProgress = [...finished, 'Fall 2024   IN PROGRESS', 'CS 50300   Operating Systems   3.0'];
    const ungraded = [...finished, 'Fall 2024', 'CS 50300   Operating Systems   3.0', 'CS 50100   Software Engineering   3.0'];
    const oneStillOpen = [...finished, 'Fall 2024', 'CS 50300   Operating Systems   3.0   A', 'CS 50100   Software Engineering   3.0   IP'];
    for (const record of [inProgress, ungraded, oneStillOpen]) {
      const q = closing(['DEGREE: BACHELOR OF SCIENCE   DECEMBER   2024'], [], record);
      assert.deepEqual([q.bachelorsConferred, q.bachelorsConferredOn], [undefined, undefined]);
    }
  });
  it('…never a prior degree, a key’s example or a line voided by a status beside another; of two, the later date', () => {
    assert.equal(closing(['Bachelor of Arts in Economics   May 2018']).bachelorsConferred, undefined, 'dated before the record’s work');
    assert.equal(closing(['TRANSCRIPT KEY', 'Bachelor of Arts   May 2024']).bachelorsConferred, undefined, 'in the key');
    assert.equal(closing(['Bachelor of Arts in Mathematics   May 2024', 'Bachelor of Science in Computer Science   August 2024', 'Status: IN PROGRESS - NOT CONFERRED']).bachelorsConferred, undefined);
    assert.equal(closing(['Bachelor of Science in Computer Science   August 2024', 'Bachelor of Arts in Mathematics   May 2024']).bachelorsConferredOn, '2024-08-01');
    assert.equal(closing(['Bachelor of Arts in Mathematics   May 2024', 'Bachelor of Science in Computer Science   August 2024']).bachelorsConferredOn, '2024-08-01');
    // Above the record's rows it is no closing line, whatever its date.
    assert.equal(closing([], ['DEGREE: BACHELOR OF SCIENCE   MAY   2024']).bachelorsConferred, undefined);
  });
  it('…only at the end of the record, and only when nothing else on it dated the degree', () => {
    assert.equal(parse(['DEGREE: BACHELOR OF ARTS   MAY   2024']).bachelorsConferredOn, undefined, 'above the courses it is no award');
    assert.equal(closing(['DEGREE: BACHELOR OF SCIENCE   MAY   2024'], ['Bachelor of Science — Conferred: May 10, 2023']).bachelorsConferredOn, '2023-05-10');
    // An entry date printed like it never displaces the award line (review of the fix).
    assert.equal(closing(['Degree Awarded: Bachelor of Science   May 2024'], ['Bachelor of Science   Admission   August 2019']).bachelorsConferredOn, '2024-05-15');
  });
  it('…never a forecast, an entry, a status, a stage, a thesis, an exam, a month-like word, or a line with more in it', () => {
    for (const line of [
      'Bachelor of Science   Expected May 2027',
      'Bachelor of Science Admission   August 2019',
      'Bachelor of Science Status Active   May 2024',
      'Bachelor of Science Catalog   August 2020',
      'Bachelor of Technology Examinations   May 2022',
      'Bachelor of Technology Semester VIII   May 2023',
      'Bachelor of Science Third Year   May 2023',
      'Bachelor of Science In-Progress   May 2023',
      'Bachelor of Science Thesis   May 2024',
      'Bachelor Thesis   May 2024',
      'Bachelor of Science   Marketing   2022',
      'Bachelor of Science   University of Maryland   2019',
      'Bachelor of Science   August 2020 - May 2026',
      'Program: Bachelor of Science   May 2027',
      'DEGREE: BACHELOR OF ARTS   MAY   2024   SUMMA CUM LAUDE',
      'Bachelor of Science and Master of Science   May 2024',
    ]) {
      const q = closing([line]);
      assert.deepEqual([q.bachelorsConferred, q.bachelorsConferredOn], [undefined, undefined], line);
    }
  });
  it('…nor with a forecast or a status beside it', () => {
    assert.equal(closing(['Degree Sought   Anticipated Graduation', 'Bachelor of Science   May 2025']).bachelorsConferred, undefined);
    assert.equal(closing(['Bachelor of Science   May 2025', 'Status: IN PROGRESS - NOT CONFERRED']).bachelorsConferred, undefined);
  });
  it('a master’s or doctor’s closing line is not read this way: the DGS spoke of a bachelor’s record', () => {
    for (const line of ['Master of Science   December 2024', 'DEGREE: DOCTOR OF PHILOSOPHY   MAY   2024']) {
      const q = closing([line]);
      assert.deepEqual([q.degreeConferred, q.bachelorsConferred], [undefined, undefined], line);
    }
  });
});

// Johns Hopkins (DGS 2026-09-08): the unofficial transcript shows the name in
// the letterhead IMAGE, so the text never spells it out — but it does say
// "JHU Degree and Date Conferred".
describe('a university whose name is printed only as an image (2026-09-08)', () => {
  const JHU = [
    'Office of the University Registrar',
    'Unofficial Transcript',
    'Name: A. Blue Jay                     Student ID: 000000000',
    'Program: Master of Science in Engineering, Computer Science',
    'This unofficial transcript is provided for the student. It is not certified.',
    'Grade scale: A 4.00  B 3.00  C 2.00  D 1.00  F 0.00. Credits are semester hours.',
    'JHU Degree and Date Conferred: Master of Science in Engineering, 05/2025',
    '',
    'Fall 2023',
    'EN.601.433   Intro Algorithms                    3.0   A',
    'EN.601.418   Operating Systems                   3.0   B+',
    '',
    'Cumulative GPA: 3.70',
    'Total credits earned: 30.0',
    'End of unofficial transcript.',
  ];

  it('recognises the school from the acronym and records its real name', () => {
    // The name the student, the DGS and the Grad Admin read, and the key the
    // ExternalCourses tab is matched on.
    assert.equal(parseExternalTranscript(JHU).university, 'Johns Hopkins University');
  });

  it('reads the dotted course code, and the two-cell layout of the same code', () => {
    assert.deepEqual(
      parseExternalTranscript(JHU).courses.map((c) => `${c.courseId} ${c.title} ${c.credits} ${c.grade}`),
      ['EN.601.433 Intro Algorithms 3 A', 'EN.601.418 Operating Systems 3 B+'],
    );
    const twoCells = JHU.map((l) => l.replace(/^EN\.(\d{3})\./, 'EN   $1.'));
    assert.deepEqual(parseExternalTranscript(twoCells).courses.map((c) => c.courseId), ['EN 601.433', 'EN 601.418']);
  });

  it('two dots are required, so a dotted word is not a course code', () => {
    const notCourses = JHU.map((l) => l.replace('EN.601.433   Intro Algorithms', 'VOL.12   Something Printed Here').replace('EN.601.418   Operating Systems', 'MAY.2025   Conferred'));
    assert.deepEqual(parseExternalTranscript(notCourses).courses, []);
  });

  it('a name printed as TEXT always wins — the acronym is only a last resort', () => {
    assert.equal(parseExternalTranscript(['Purdue University', ...JHU]).university, 'Purdue University');
  });

  it('the acronym must be capitals, so a lower-case look-alike renames nothing', () => {
    const lower = JHU.map((l) => l.replace('JHU Degree and Date Conferred', 'Jhu, Chen-Wei — Degree and Date Conferred'));
    assert.equal(parseExternalTranscript(lower).university, undefined);
  });

  it('a name worked out from an acronym is marked as a guess, so the preview lets it be corrected', () => {
    assert.equal(parseExternalTranscript(JHU).universityGuessed, true);
    assert.equal(parseExternalTranscript(['Purdue University', ...JHU]).universityGuessed, undefined, 'a name read as text is not a guess');
  });

  it('Rensselaer, whose name is only a vector wordmark, is guessed from the registrar’s address (DGS 2026-09-28)', () => {
    // The text layer of an RPI transcript, as the app's layout stage reads it
    // (a sanitized copy; the rows were blacked out). "Rensselaer" appears
    // nowhere in the text — only the ZIP+4 and the registrar's phone do.
    const rpi = [
      'ACADEMIC RECORD', '10/17/2024', 'Student Name:   DEGREES AWARDED:   DATE:',
      'Office of the Registrar', 'Troy, New York 12180-3590', 'Tel: 518-276-6231 Fax: 518-276-6180',
      'Official Transcript',
      'Course #   Course Title   Att Grd Ern Qpts   Course #   Course Title   Att Grd Ern Qpts',
      'CSCI 6140   Computer Operating Systems   4.00 A 4.00 16.00',
      'Page   1',
    ];
    const r = parseExternalTranscript(rpi);
    assert.equal(r.university, 'Rensselaer Polytechnic Institute');
    assert.equal(r.universityGuessed, true, 'a guess, so the student can correct it');
    assert.equal(parseExternalTranscript(['Rensselaer Polytechnic Institute', ...rpi]).universityGuessed, undefined, 'the name printed as text is not a guess');
    // The phone alone is enough (page 2 repeats it, the ZIP may wrap), but a
    // different Troy address is not Rensselaer.
    assert.equal(parseExternalTranscript(rpi.map((l) => l.replace('12180-3590', '12180'))).university, 'Rensselaer Polytechnic Institute');
    assert.equal(parseExternalTranscript(rpi.map((l) => l.replace('12180-3590', '12180').replace('518-276-6231', '518-244-2000'))).university, undefined);
  });

  it('the degree heading on a line of its own opens the degree block', () => {
    // "JHU Degree and Date Conferred" with the values BELOW it — the
    // column-gap test alone missed it, and the M.S. then read as not
    // completed, which halves the §5.2 cap (2026-09-08).
    const heading = JHU.map((l) =>
      l.startsWith('JHU Degree') ? 'JHU Degree and Date Conferred' : l,
    );
    heading.splice(heading.indexOf('JHU Degree and Date Conferred') + 1, 0, 'Master of Science in Engineering        05/2025');
    assert.equal(parseExternalTranscript(heading).degreeConferred, true);
  });

  it('a section number between the code and the title is not read as the credits', () => {
    const withSections = JHU.map((l) => l.replace(/^(EN\.\d{3}\.\d{3})   /, '$1   01   '));
    assert.deepEqual(parseExternalTranscript(withSections).courses.map((c) => c.credits), [3, 3]);
  });
});

// UC San Diego (DGS 2026-09-09): the logo is an image, the page is tiled with
// a "UNIVERSITY OF CALIFORNIA, SAN DIEGO" watermark whose fragments the parser
// read as the name, and another school's degree is listed above UCSD's own.
describe('a transcript whose watermark looks like its name (2026-09-09)', () => {
  const UCSD = [
    'UNIVERSITY OF CALIFORNIA, SAN DIEGO • UNIVERSITY OF CALIFORNIA, SAN DIEGO • UNIVERSITY OF CALIFORNIA, SAN DIEGO',
    'TRANSCRIPT OF ACADEMIC RECORD',
    'UNIVERSITY   OF CALIFORNIA, SAN DIE',
    'UNIVERSITY.',
    '--DEGREES AWARDED BY OTHER INSTITUTIONS---',
    'BS        06/24        College in China Peoples Republic',
    'STUDENT LEVEL          :  Graduate',
    'COLLEGE                :  Graduate Division',
    'DEPARTMENT(S)          :  Computer Science & Engineering',
    'MAJOR(S)               :  Computer Science',
    '------------UCSD DEGREES AWARDED-----------',
    'AWARD:      Master of Science          CONFERRED: 03/21/26',
    'TERM:       Winter Qtr 2026',
    '',
    'FALL QTR 2024',
    'CSE 202    Algorithm Design and Analysis        4.00   A',
    'CSE 221    Operating Systems                    4.00   B+',
    '',
    'WINTER QTR 2025',
    'CSE 240A   Principles of Computer Architecture  4.00   A-',
    '',
    'TERM CREDITS PASSED : 8.00     TERM GPA : 3.70',
    '----------------------End of Transcript----------------------',
  ];

  // The 2026 co-curricular / transcript layout (DGS 2026-09-12): the tiles
  // carry no comma, the margin cuts one to "UNIVERSITY OF CALIFORNIA", and no
  // "UCSD" appears anywhere — the name has to be read from the tiling itself.
  it('reads the full name from the tiled watermark, never a margin fragment of it (2026-09-12)', () => {
    const tiles = [
      'UNIVERSITY OF CALIFORNIA SAN DIEGO • UNIVERSITY OF CALIFORNIA SAN DIEGO • UNIVERSITY OF',
      'CALIFORNIA SAN DIEGO • UNIVERSITY OF CALIFORNIA SAN DIEGO • UNIVERSITY OF CALIFORNIA SAN',
      'DIEGO • UNIVERSITY OF CALIFORNIA SAN DIEGO • UNIVERSITY OF CALIFORNIA SAN DIEGO •',
      'UNIVERSITY OF CALIFORNIA',
      'Student ID: (withheld)',
      'STUDENT LEVEL          :  Graduate',
      'FALL QTR 2024',
      'CSE 202    Algorithm Design and Analysis        4.00   A',
      'WINTER QTR 2025',
      'CSE 240A   Principles of Computer Architecture  4.00   A-',
      'TERM CREDITS PASSED : 8.00     TERM GPA : 3.70',
    ];
    const r = parseExternalTranscript(tiles);
    assert.equal(r.university, 'University of California, San Diego');
    assert.equal(r.universityGuessed, undefined, 'read from the page, not recovered from an acronym');
    assert.equal(r.courses.length, 2);
    // An unknown school's tiling is Title-Cased as printed.
    const other = tiles.map((l) => l.replace(/UNIVERSITY OF CALIFORNIA SAN DIEGO/g, 'STATE UNIVERSITY OF EXAMPLE').replace(/UNIVERSITY OF CALIFORNIA$/, 'STATE UNIVERSITY OF'));
    assert.equal(parseExternalTranscript(other).university, 'State University of Example');
  });

  it('names the school from its own abbreviation, not from the watermark', () => {
    const r = parseExternalTranscript(UCSD);
    assert.equal(r.university, 'University of California, San Diego');
    assert.equal(r.universityGuessed, true, 'a guess, so the student can correct it');
  });

  it('a generic fragment is never a name on its own', () => {
    // "UNIVERSITY", and the tiled watermark line, used to be the answer.
    const watermarkOnly = UCSD.filter((l) => !/UCSD|OTHER INSTITUTIONS|College in China/.test(l));
    assert.equal(parseExternalTranscript(watermarkOnly).university, undefined);
  });

  it('the degree block of ANOTHER institution does not name this transcript', () => {
    assert.doesNotMatch(parseExternalTranscript(UCSD).university ?? '', /China/);
  });

  it('reads the courses, and puts a Winter quarter in spring rather than the term before it', () => {
    // Winter and Johns Hopkins' Intersession used to inherit the previous
    // header's season, dating a January course months late — and the term is
    // locked on a text-layer import, so the student could not fix it.
    assert.deepEqual(
      parseExternalTranscript(UCSD).courses.map((c) => `${c.courseId} ${c.season} ${c.year}`),
      ['CSE 202 fall 2024', 'CSE 221 fall 2024', 'CSE 240A spring 2025'],
    );
  });
});

// Georgia Tech (DGS bug report 2026-09-08): "ID" is Industrial Design, not an
// identifier, and the header abbreviates the institute.
describe('Georgia Tech: the "ID" subject and the abbreviated name (2026-09-08)', () => {
  const GT = [
    'Georgia Inst. of Technology',
    'Office of the Registrar',
    'Unofficial Transcript',
    'Student: A. Yellowjacket',
    '',
    'Fall 2023',
    'ID 4104    Industrial Design Studio           3.0   A',
    'CS 6250    Computer Networks                  3.0   B+',
    '',
    'Spring 2024',
    'ID 6202    Design Methods                     3.0   A-',
    '',
    'Cumulative GPA: 3.80',
  ];

  it('reads the institution even when it prints "Inst." for Institute, and spells it out', () => {
    // The unofficial transcript abbreviates it; students, the DGS and the Grad
    // Admin all read the real name (DGS 2026-09-08).
    assert.equal(parseExternalTranscript(GT).university, 'Georgia Institute of Technology');
  });

  it('keeps ID courses instead of mistaking the subject for an identifier', () => {
    const p = parseExternalTranscript(GT);
    assert.deepEqual(
      p.courses.map((c) => [c.courseId, c.title, c.credits, c.grade]),
      [
        ['ID 4104', 'Industrial Design Studio', 3, 'A'],
        ['CS 6250', 'Computer Networks', 3, 'B+'],
        ['ID 6202', 'Design Methods', 3, 'A-'],
      ],
    );
  });

  it('a record-number line is still not a course — no title after the number', () => {
    const p = parseExternalTranscript([...GT.slice(0, 4), 'ID   123456', 'ID   4104', ...GT.slice(5)]);
    const ids = p.courses.map((c) => c.courseId);
    assert.deepEqual(ids, ['ID 4104', 'CS 6250', 'ID 6202'], 'the bare identifier lines are left out: ' + JSON.stringify(ids));
  });

  it('a Master’s-only record names no bachelor’s, so nothing marks it a 4+1', () => {
    assert.equal(parseExternalTranscript(GT).bachelorsNamed, undefined);
    const withBs = parseExternalTranscript([...GT, 'Bachelor of Science in Industrial Design']);
    assert.equal(withBs.bachelorsNamed, true);
  });
});

// UMass Amherst (DGS 2026-09-13): the degrees block at the END of the PDF,
// "Degree(s) Awarded" with a parenthesis, and each degree as label/value lines
// — "Degree Completed: Bachelor of Science" with a bare "Date:" beneath it.
// The bachelor's date was not read; the master's date must not be taken for it.
describe('a degrees block of label/value lines (UMass Amherst, 2026-09-13)', () => {
  const HEAD = ['University of Massachusetts Amherst', 'Office of the University Registrar', 'This is an unofficial transcript produced for the student named below and may not be released to any third party without consent.', 'Student: (name withheld)'];
  const lines = [
    ...HEAD,
    'Fall 2024',
    'COMPSCI 611    Advanced Algorithms      3.00   A',
    '------------------------------ Degree(s) Awarded ------------------------------',
    'Degree Completed:                Bachelor of Science',
    'Date:                            5/17/2024',
    'Degree Honors:                   Cum Laude',
    'Major:                           Major in Computer Science',
    '',
    'Degree Completed:                Master of Science',
    'Date:                            5/16/2025',
    'Major:                           Computer Science (MS)',
    '---------------------------------No entries below this line---------------------------------',
  ];
  it('reads the bachelor\'s date from the "Date:" line under it, and sees the completed master\'s', () => {
    const r = parseExternalTranscript(lines);
    assert.equal(r.bachelorsConferredOn, '2024-05-17');
    assert.equal(r.bachelorsNamed, true);
    assert.equal(r.degreeConferred, true, 'the master\'s is completed');
    assert.equal(r.courses.length, 1);
  });
  it('a "Date:" line is never taken without a completed-degree line above it', () => {
    const noDegree = [...HEAD, 'Fall 2024', 'COMPSCI 611    Advanced Algorithms      3.00   A', 'Program: Bachelor of Science (sought)', 'Date:   5/17/2024'];
    assert.equal(parseExternalTranscript(noDegree).bachelorsConferredOn, undefined);
  });
});

// IUPUI (DGS 2026-09-13): Indiana University's registrar prints "Indiana
// University Bloomington" in the header of every IU transcript; the degree
// block names the school that awarded the degree. That one is the university.
describe('the awarding institution beats the issuing header (IUPUI, 2026-09-13)', () => {
  const lines = [
    'Unofficial Transcripts   11/4/24, 9:19 PM',
    'Student Unofficial Transcript',
    'Indiana University Bloomington',
    'Student ID :',
    'Print Date : 11-04-2024',
    '- - - - - Degrees Awarded - - - - -',
    'Purdue University Degree',
    'Indiana University Purdue University Indianapolis',
    'School of Engineering and Technology',
    'M. S. in Electrical & Computer Engineering',
    'Degree GPA: 3.127',
    'Degree Hours: 30.04',
    'Major: Electrical and Computer Engineering',
    'Non Thesis Option',
    'This is an unofficial transcript produced for the student named above; it is not valid without the registrar seal and may not be released to a third party.',
    'Fall 2022',
    'ECE 60000   Advanced Topics   3.00   A',
  ];
  it('names IUPUI, not the Bloomington header', () => {
    const r = parseExternalTranscript(lines);
    assert.equal(r.university, 'Indiana University Purdue University Indianapolis');
    assert.equal(r.universityGuessed, undefined);
  });
  it('a block "awarded by other institutions" never renames the transcript', () => {
    const other = ['Purdue University', 'Office of the Registrar', 'This is an unofficial transcript produced for the student named below and may not be released to any third party without consent.', '--DEGREES AWARDED BY OTHER INSTITUTIONS---', 'Example State University', 'Fall 2023', 'CS 50300   Operating Systems   3.0   A'];
    assert.equal(parseExternalTranscript(other).university, 'Purdue University');
  });
});

// "UNOFFICIAL University at Buffalo Transcript" (DGS 2026-09-14): the record
// words on both sides are stripped, and the name in the middle survives.
describe('a leading UNOFFICIAL is not part of the name (2026-09-14)', () => {
  const HEAD = ['Office of the University Registrar', 'This is an unofficial transcript produced for the student named below and may not be released to any third party without consent.', 'Student: (name withheld)'];
  it('strips it, with the trailing "Transcript"', () => {
    const r = parseExternalTranscript(['UNOFFICIAL University at Buffalo Transcript', ...HEAD, 'Fall 2023', 'CSE 531   Analysis of Algorithms   3.00   A']);
    assert.equal(r.university, 'University at Buffalo');
    assert.equal(parseExternalTranscript(['Official Example University Transcript', ...HEAD, 'Fall 2023', 'CSE 531   Analysis of Algorithms   3.00   A']).university, 'Example University');
  });
});

// "Graduated on 15 June 2020 with the degree of Bachelor of Science …" (DGS
// 2026-09-16): a conferral in other words. Its date is the bachelor's date.
describe('a "Graduated on … with the degree of Bachelor" line (2026-09-16)', () => {
  const HEAD = ['Example University', 'Office of the Registrar', 'This is an official transcript issued for the student named below and may not be released to any third party without consent.', 'Student: (name withheld)'];
  it('is read as the bachelor\'s conferral', () => {
    const r = parseExternalTranscript([...HEAD, 'Graduated on 15 June 2020 with the degree of Bachelor of Science in Computer Science & Engineering Major in Computer Engineering under Registration No. 123456', 'Fall 2018', 'CSE 301   Data Structures   3.0   A']);
    assert.equal(r.bachelorsConferredOn, '2020-06-15');
    assert.equal(r.bachelorsNamed, true);
  });
});

// The same remark through OCR (DGS 2026-09-16, a scanned official transcript):
// "Graduated on Aprill//09, Z2025/lwith the degree of Bachelor of ." — the
// conferral is stated even though the date is garbled, and the date is read
// through the noise.
describe('a conferral read through OCR noise (2026-09-16)', () => {
  const HEAD = ['Example University', 'Office of the Registrar', 'This is an official transcript issued for the student named below and may not be released to any third party without consent.', 'Course: Bachelor of Science in Computer Science & Engineering'];
  it('is a stated conferral, with the date recovered', () => {
    const r = parseExternalTranscript([...HEAD, '2022-2023, Spring COE3104 MICROPROCESSOR AND EMBEDDED SYSTEM 3 2.00', 'Remarks: Performance Summary:', 'Graduated on Aprill//09, Z2025/lwith the degree of Bachelor of . Credits Earned', 'iS nee &!|Engineering Major in\\Gomputer Engineering under 41H NE']);
    assert.equal(r.bachelorsConferred, true);
    assert.equal(r.bachelorsConferredOn, '2025-04-09');
  });
  it('stays a stated conferral when the date is beyond recovery', () => {
    const r = parseExternalTranscript([...HEAD, 'Graduated on Ap#i% 0%, 2#25 with the degree of Bachelor of Science']);
    assert.equal(r.bachelorsConferred, true);
    assert.equal(r.bachelorsConferredOn, undefined);
  });
  it('the loose reader never invents a date from an ordinary sentence', () => {
    assert.equal(looseDateOnLine('Computer Science 3 credits 2023'), undefined);
    assert.equal(looseDateOnLine('Passed with 12 of 2024 points'), undefined);
  });
});

// DGS 2026-10-07 (reverting policy review round 3, P3-sheet-1): “That GATech's
// name was read directly from an official transcript. Future transcripts will
// carry that exact name too.” The reader keeps it as printed, and the
// ExternalCourses rows filed under it are found by it.
describe('Georgia Tech’s name as its official transcript prints it (DGS 2026-10-07)', () => {
  const NAME = 'GEORGIA INSTITUTE OF TECHNOLOGY OFFICIAL DOCUMENT INFORMATION';
  it('the reader keeps the whole name', () => {
    assert.equal(parseExternalTranscript([NAME, ...PURDUE.slice(1)]).university, NAME);
  });
  it('that name finds the rulings filed under it', () => {
    const rules = buildRules({ external: [{ university: NAME, course_id: 'ECE 6122', course_title: 'Adv Prog Techniques', transferable_PhD: 'yes' }] });
    assert.ok(findExternalRule(rules.external, NAME, 'ECE 6122'));
  });
});

// A US undergraduate record that prints each course's TITLE first and its
// code as three number cells — school, subject, course — then the section,
// the credits, the grade and sometimes a flag (Rutgers' undergraduate layout;
// DGS 2026-10-14: "there were a lot of courses, but it says there were only
// two"). Its shape was read with scripts/diagnose-transcript.mjs on the DGS's
// machine (letters and digits masked) and is rebuilt here with invented
// values. It opens with credit transferred from another university, under a
// "TRANSFER …" heading and that school's name, in that school's own terms;
// its own terms name the division ("Fall   2019 SCHOOL OF ARTS AND
// SCIENCES"); the issuer's name is only in an image; on the last page a
// summary box shares two course rows' lines.
const H = ['RECORD OF: DOE   JO', 'STUDENT NUMBER: 000000000'];
const head = (page: number, extra = '') => [...H, `ISSUED DATE: 10/14/26   PAGE:   ${page}`, `TITLE   SCH   DEPT NUM   SEC CRD   GRDE${extra}`];
const TITLE_FIRST_NUMERIC = [
  ...head(1),
  'TRANSFER COURSES',
  'JIAO TONG UNIVERSITY-SHANGHAI',
  'Fall   2017',
  'CALCULUS I   01   640   151   4.0',
  'GENERAL CHEMISTRY   01   160   161   4.0',
  'INTRO TO CHINESE CULTURE   TR   T01   EL1   2.0',
  'ACADEMIC WRITING   TR   T01   EL1   2.0',
  'Spring   2018',
  'CALCULUS II (H)   01   640   152   4.0',
  'LINEAR ALGEBRA   01   640   250   3.0',
  'PROGRAMMING BASICS   TR   T01   EL2   3.0',
  'Fall   2018',
  'DISCRETE STRUCTURES   01   198   205   4.0',
  'PROBABILITY THEORY   TR   T01   EL   3.0',
  'Spring   2019',
  'DATA STRUCTURES   01   198   112   4.0',
  'IN TRANSFER   COURSE   SCH   DEPT NUM   SEC CRD   GRDE   QQ CODES',
  'MULTIVARIABLE CALCULUS   01   640   251   4.0',
  '.',
  'ORDINARY DIFFERENTIAL EQUATIONS   TR   T01   EL   3.0',
  'TOTAL TRANSFER CREDITS:   36.0',
  'TOTAL TRANSFER CREDITS:   36.0',
  '(EQUIVALENTS OF INSTITUTION COURSES)',
  '.',
  'Fall   2019 SCHOOL OF ARTS AND SCIENCES',
  'MAJOR: MATHEMATICS',
  'CLASS: 03   DEANS LIST',
  'INTRO TO REAL ANALYSIS   01   640   311   01   4.0   A   QQ',
  'ABSTRACT ALGEBRA I   01   640   351   02   3.0   A',
  'COMPUTER ARCHITECTURE   01   198   211   03   4.0   B+   QR',
  'OPERATING SYSTEMS   01   198   416   01   4.0   A',
  'NUMERICAL ANALYSIS I   01   640   373   H1   3.0   A',
  'THEORY OF COMPUTATION   01   198   452   01   4.0   B',
  'TOTAL SEMESTER CREDITS:   22.0',
  'DEGREE CREDITS EARNED: 58.0   TERM GPA: 3.800   CUMULATIVE GPA: 3.800',
  '.',
  '** CONTINUED ON NEXT PAGE **',
  '',
  ...head(2, '   QQ CODES'),
  'Spring 2020 SCHOOL OF ARTS AND SCIENCES',
  'MAJOR: MATHEMATICS',
  'CLASS: 03   DEANS LIST',
  'DESIGN AND ANALYSIS OF ALGORITHMS   01   198   344   01   4.0   A',
  'COMPLEX VARIABLES   01   640   403   01   3.0   A',
  'SOFTWARE METHODOLOGY   01   198   213   AB   4.0   A',
  'ABSTRACT ALGEBRA II   01   640   352   01   3.0   A-',
  'PRINCIPLES OF DATA SCIENCE   01   198   439   01   4.0   A',
  'MATHEMATICAL LOGIC   01   640   461   01   3.0   A',
  'TOTAL SEMESTER CREDITS:   21.0',
  'DEGREE CREDITS EARNED: 79.0   TERM GPA: 3.950   CUMULATIVE GPA: 3.870',
  'Summer 2020 SCHOOL OF ARTS AND SCIENCES',
  'MAJOR: MATHEMATICS',
  'MINOR: COMPUTER SCIENCE',
  'CLASS: 04',
  'TOPICS IN GEOMETRY A   01   640   495   B1   3.0   A',
  'TOTAL SEMESTER CREDITS:   3.0',
  'DEGREE CREDITS EARNED: 82.0   TERM GPA: 4.000   CUMULATIVE GPA: 3.880',
  'TITLE   SCH   DEPT NUM   SEC CRD   GRDE   QQ CODES',
  'Fall   2020 SCHOOL OF ARTS AND SCIENCES',
  'MAJOR: MATHEMATICS',
  'MINOR: COMPUTER SCIENCE',
  'CLASS: 04   DEANS LIST',
  'COMPUTER SECURITY   01   198   419   01   4.0   A',
  'GRAPH THEORY BASICS I   01   640   428   C1   3.0   A',
  'MACHINE LEARNING   01   198   461   01   4.0   A',
  'NUMERICAL METHODS & PDES   01   640   374   01   3.0   A',
  'TOTAL SEMESTER CREDITS:   14.0',
  'DEGREE CREDITS EARNED: 96.0   TERM GPA: 4.000   CUMULATIVE GPA: 3.900',
  '.',
  '.',
  'Spring 2021 SCHOOL OF ARTS AND SCIENCES',
  'MAJOR: MATHEMATICS',
  'MINOR: COMPUTER SCIENCE',
  'CLASS: 04   DEANS LIST',
  'DATA&SYSTEMS WEB DESIGN   01   198   336   01   4.0   B+',
  'STOCHASTIC MODELS   01   640   477   01   3.0   A',
  'DISTRIBUTED COMPUTING   01   198   417   01   4.0   A',
  'NUMBER THEORY TOPICS   01   640   356   01   3.0   A',
  'TOTAL SEMESTER CREDITS:   14.0',
  '.',
  'DEGREE CREDITS EARNED: 110.0   TERM GPA: 3.900   CUMULATIVE GPA: 3.900',
  '.',
  '** CONTINUED ON NEXT PAGE **',
  '',
  ...head(3, '   QQ CODES   TITLE   SCH   DEPT NUM   SEC CRD   GRDE   QQ CODES'),
  'Fall   2021 SCHOOL OF ARTS AND SCIENCES',
  'Term Note Information',
  'MAJOR: MATHEMATICS',
  'MINOR: COMPUTER SCIENCE   HOUR LOAD STATUS   HOURS:   15.0',
  'CLASS: 04   DEANS LIST   BASE HOUR CREDITS ON TRK:   12.0',
  'UPPER HOUR LIMIT   PT REQ:   18.0',
  'AI FOUNDATIONS   01   198   440   01   4.0   A   UPPR HOUR CREDITS TOWARDS LIMIT ON REC:   18.0',
  'CRYPTOGRAPHY TOPICS   01   640   448   01   3.0   A   LOWR HOUR CREDITS TOWARDS DEGREE   ON REC:   120.0',
  'SAS NOTES: HONORS, MATHS, INTERNATIONAL',
  '.',
  'TOPOLOGY I   01   640   441   01   3.0   A',
  'COMP VISION BASICS   01   198   461   01   4.0   A',
  '*** NOT IN ATTENDANCE ***',
  'TOTAL SEMESTER CREDITS:   14.0',
  'DEGREE CREDITS EARNED: 124.0   TERM GPA: 4.000   CUMULATIVE GPA: 3.910',
  '.',
  'Spring 2022 SCHOOL OF ARTS AND SCIENCES',
  'MAJOR: MATHEMATICS',
  'MINOR: COMPUTER SCIENCE',
  'CLASS: 04   DEANS LIST',
  'LOGIC & COMPUTING   01   198   205   01   4.0   A',
  'GAME THEORY BASICS   01   640   410   01   3.0   A',
  'CODING THEORY   01   640   451   01   3.0   A',
  'APPLIED REGRESSION ANALYSIS   01   960   463   01   3.0   A',
  'TOTAL SEMESTER CREDITS:   13.0',
  'DEGREE CREDITS EARNED: 137.0   TERM GPA: 4.000   CUMULATIVE GPA: 3.920',
  '.',
  'DEGREE: BACHELOR OF ARTS   MAY   2022',
  'MAJOR: MATHEMATICS',
  'MINOR: COMPUTER SCIENCE',
  'HONORS/AWARDS EARNED: SUMMA CUM LAUDE',
  '.',
  '',
];

describe('title first, then a three-number code (Rutgers’ undergraduate layout, 2026-10-14)', () => {
  const p = parseExternalTranscript(TITLE_FIRST_NUMERIC);
  it('reads every course of the record’s own terms, with its code, credits, grade and term', () => {
    assert.equal(p.courses.length, 29);
    assert.ok(p.courses.every((c) => /^01:\d{3}:\d{3}$/.test(c.courseId) && c.credits !== undefined && c.grade !== undefined), JSON.stringify(p.courses.map((c) => c.courseId)));
    const os = p.courses.find((c) => c.courseId === '01:198:416');
    assert.deepEqual(os && [os.title, os.credits, os.grade, os.season, os.year], ['OPERATING SYSTEMS', 4, 'A', 'fall', 2019]);
    // The section ("H1", "AB") and the flag after the grade ("QQ") are not read.
    const na = p.courses.find((c) => c.courseId === '01:640:373');
    assert.deepEqual(na && [na.title, na.credits, na.grade], ['NUMERICAL ANALYSIS I', 3, 'A']);
    assert.equal(p.courses.find((c) => c.courseId === '01:198:211')?.grade, 'B+');
    // A summary box's text merged onto a row's line is left unread.
    const merged = p.courses.find((c) => c.courseId === '01:640:448');
    assert.deepEqual(merged && [merged.title, merged.credits, merged.grade, merged.season, merged.year], ['CRYPTOGRAPHY TOPICS', 3, 'A', 'fall', 2021]);
    assert.equal(p.courses.filter((c) => c.year === 2022 && c.season === 'spring').length, 4);
  });
  it('skips the other university’s transferred courses — both shapes — and never names it as the transcript’s university', () => {
    assert.equal(p.transferRowsSkipped, 12);
    assert.ok(!p.courses.some((c) => (c.year ?? 0) < 2019), 'no row from the transfer block');
    assert.equal(p.university, undefined, 'the issuer is named only in an image: the student types it');
  });
  it('the heading’s words do not matter: the block is known by its shape', () => {
    for (const heading of ['TRANSFER CREDITS', 'TRANSFER SUMMARY', 'EXTERNAL CREDITS', 'ADVANCED STANDING']) {
      const q = parseExternalTranscript(TITLE_FIRST_NUMERIC.map((l) => (l === 'TRANSFER COURSES' ? heading : l)));
      assert.deepEqual([q.courses.length, q.transferRowsSkipped, q.university], [29, 12, undefined], heading);
    }
  });
  // The review of the fix (2026-10-14), each case read as the reader read it before.
  it('a “Transfer Credit” block over a school’s name still ends at the record’s next term (PeopleSoft’s own block)', () => {
    const header = ['SAMPLE STATE UNIVERSITY', 'Unofficial Transcript', 'Name: Jo Doe   Student ID: 0000000', 'This transcript lists the courses taken at the university and the credit it accepted from other schools.'];
    const ucf = parseExternalTranscript([...header, 'TRANSFER CREDIT', 'Valencia College', 'ENC 1101   Freshman Composition I   3.00   T', 'MAC 2311   Calculus with Analytic Geometry I   4.00   T', 'Fall 2019', 'COP 3502   Computer Science I   3.00   A', 'COT 3100   Discrete Structures   3.00   B+', 'Spring 2020', 'COP 3503   Computer Science II   3.00   A-', 'CDA 3103   Computer Logic and Organization   3.00   B']);
    assert.deepEqual([ucf.courses.map((c) => c.courseId), ucf.transferRowsSkipped], [['COP 3502', 'COT 3100', 'COP 3503', 'CDA 3103'], 2]);
    const mid = parseExternalTranscript([...header, 'Fall 2019', 'COP 3502   Computer Science I   3.00   A', 'Transfer Credit', 'Purdue University', 'MA 26100   Multivariate Calculus   4.00   T', 'Fall 2020', 'COP 4600   Operating Systems   3.00   A', 'Spring 2021', 'COP 4020   Programming Languages   3.00   B']);
    assert.deepEqual(mid.courses.map((c) => c.courseId), ['COP 3502', 'COP 4600', 'COP 4020']);
    // A heading of another wording on a code-first record opens nothing: read as before, no row lost.
    const miami = parseExternalTranscript([...header, 'TRANSFER COURSES', 'Miami Dade College', 'Fall 2017', 'ENC 1101   Composition I   3.00', 'Fall 2019', 'COP 3502   Computer Science I   3.00   P', 'COT 3100   Discrete Structures   3.00   S']);
    assert.deepEqual(miami.courses.map((c) => c.courseId), ['ENC 1101', 'COP 3502', 'COT 3100']);
    // "Transfer Totals:" alone closes the block, as before.
    const totals = parseExternalTranscript([...header, 'Transfer Credits', 'MATH 1200   Calculus I   4.00   T', 'Transfer Totals:', '4.00   4.00', 'Fall 2021', 'CS 1400   Computer Science I   3.00   A', 'CS 1410   Discrete Mathematics   3.00   B+']);
    assert.deepEqual(totals.courses.map((c) => c.courseId), ['CS 1400', 'CS 1410']);
  });
  it('the row’s own cells: a title ending in a code-like word, a colon, a pass grade, a flag, a totals line', () => {
    const at = TITLE_FIRST_NUMERIC.indexOf('CLASS: 03   DEANS LIST');
    const rows = ['TOPICS IN CS   01   198   351   01   3.0   B+', 'LATIN AMER: AN INTRO   01   590   101   01   3.0   A', 'RESEARCH SEMINAR   01   640   491   01   1.0   PA', 'PHYSICS LAB A   01   750   229   01   1.0', 'NATURE OF SCIENCE   01   090   101   01   3.0   NS', 'TERM TOTALS   07   007   025   3.57'];
    const q = parseExternalTranscript([...TITLE_FIRST_NUMERIC.slice(0, at + 1), ...rows, ...TITLE_FIRST_NUMERIC.slice(at + 1)]);
    const read = (id: string) => { const c = q.courses.find((x) => x.courseId === id); return c && [c.title, c.credits, c.grade ?? c.rawGrade]; };
    assert.deepEqual(read('01:198:351'), ['TOPICS IN CS', 3, 'B+']);
    assert.deepEqual(read('01:590:101'), ['LATIN AMER: AN INTRO', 3, 'A']);
    assert.deepEqual(read('01:640:491'), ['RESEARCH SEMINAR', 1, 'S']);
    assert.deepEqual(read('01:750:229'), ['PHYSICS LAB A', 1, undefined]);
    assert.deepEqual(read('01:090:101'), ['NATURE OF SCIENCE', 3, undefined], 'a flag is not a grade');
    assert.ok(!q.courses.some((c) => /^07:/.test(c.courseId)), 'a totals line is no course');
    assert.equal(q.transferRowsSkipped, 12, '…nor a transferred row (review of the fix, 2026-10-15)');
  });
  it('a year in a summary box merged after the grade is not the row’s term', () => {
    const q = parseExternalTranscript(TITLE_FIRST_NUMERIC.map((l) => (l.startsWith('AI FOUNDATIONS') ? 'AI FOUNDATIONS   01   198   440   01   4.0   A   EXPECTED GRADUATION:   MAY 2022' : l)));
    const ai = q.courses.find((c) => c.courseId === '01:198:440');
    assert.deepEqual(ai && [ai.season, ai.year], ['fall', 2021]);
  });
  it('the university guess never takes a course title or a second source school', () => {
    const swap = (from: string, to: string[]) => TITLE_FIRST_NUMERIC.flatMap((l) => (l === from ? to : [l]));
    const physics = parseExternalTranscript(swap('CALCULUS I   01   640   151   4.0', ['UNIVERSITY PHYSICS   01   750   203   4.0']));
    assert.equal(physics.university, undefined);
    const second = parseExternalTranscript(swap('Spring   2019', ['PEKING UNIVERSITY', 'Spring   2019']));
    assert.equal(second.university, undefined);
    assert.equal(second.courses.length, 29);
    // …nor a course of the record's own terms, outside any transfer block.
    const own = parseExternalTranscript(swap('INTRO TO REAL ANALYSIS   01   640   311   01   4.0   A   QQ', ['UNIVERSITY WRITING   01   355   201   01   3.0   B']));
    assert.equal(own.university, undefined);
    assert.ok(own.courses.some((c) => c.courseId === '01:355:201'));
  });
  it('the issuer’s name printed below the transferred rows is still read (re-review of the fix)', () => {
    const q = parseExternalTranscript(['RECORD OF: DOE   JO', 'STUDENT NUMBER: 000000000', 'This transcript lists the courses taken at the university and the credit it accepted from other schools.', 'TRANSFER COURSES', 'Miami Dade College', 'Fall   2017', 'CALCULUS I   01   640   151   4.0', 'Fall 2019', 'COP 3503   Computer Science II   3.00   A', 'COP 3530   Data Structures   3.00   B+', 'Sample State University', '']);
    assert.equal(q.university, 'Sample State University');
  });
  it('“Transfer Totals” over a school’s name opens nothing', () => {
    const header = ['SAMPLE STATE UNIVERSITY', 'Unofficial Transcript', 'Name: Jo Doe   Student ID: 0000000', 'This transcript lists the courses taken at the university and the credit it accepted from other schools.'];
    const q = parseExternalTranscript([...header, 'Transfer Totals:', 'Hudson County College', 'Fall 2021', 'CS 1400   Computer Science I   3.00   P', 'CS 1410   Discrete Mathematics   3.00   P']);
    assert.deepEqual(q.courses.map((c) => c.courseId), ['CS 1400', 'CS 1410']);
  });
  it('a short title is never read as a subject with the school number as its course number', () => {
    // "LAB II   01 …" read as course "LAB II 01" before (the DGS's file: two such rows were all it read).
    const at = TITLE_FIRST_NUMERIC.indexOf('CLASS: 03   DEANS LIST');
    const q = parseExternalTranscript([...TITLE_FIRST_NUMERIC.slice(0, at + 1), 'LAB II   01   750   228   01   1.0   A', 'CALCULUS   01   640   151   02   4.0   B', ...TITLE_FIRST_NUMERIC.slice(at + 1)]);
    assert.deepEqual(q.courses.slice(0, 2).map((c) => [c.courseId, c.title, c.credits, c.grade]), [['01:750:228', 'LAB II', 1, 'A'], ['01:640:151', 'CALCULUS', 4, 'B']]);
    assert.ok(!q.courses.some((c) => /^LAB/.test(c.courseId)));
  });

  // The same record refused in the DGS's browser as "still in progress"
  // (2026-10-15): "the degree and the conferral month year in the end" —
  // "Those courses without grades are the transferred courses."
  const asUndergraduate = (r: ReturnType<typeof parseExternalTranscript>) => undergraduateInProgress('bachelors', r.courses.map((c) => previewRowOf(c, 'bachelors')), r.bachelorsConferred === true);
  it('the degree and its month and year closing the record are its conferral: never refused as in progress', () => {
    assert.deepEqual([p.bachelorsConferred, p.bachelorsConferredOn], [true, '2022-05-15']);
    assert.equal(asUndergraduate(p), false);
    // …even with a row read without a grade, which the student then sees in the preview.
    const open = parseExternalTranscript(TITLE_FIRST_NUMERIC.map((l) => (l.startsWith('CODING THEORY') ? 'CODING THEORY   01   640   451   01   3.0' : l)));
    assert.equal(asUndergraduate(open), false);
    assert.equal(asUndergraduate({ ...open, bachelorsConferred: undefined }), true, 'without the degree line, refused as before');
  });
  it('the transferred rows are skipped, and their school never named as the university, even where the block naming it is not found', () => {
    const school = 'JIAO TONG UNIVERSITY-SHANGHAI';
    const at = TITLE_FIRST_NUMERIC.indexOf(school);
    const variants = {
      'school line missing': TITLE_FIRST_NUMERIC.filter((l) => l !== school),
      'school line merged with a number': TITLE_FIRST_NUMERIC.map((l) => (l === school ? `${school}   1` : l)),
      'its first term merged with a word': TITLE_FIRST_NUMERIC.map((l, i) => (i === at + 1 ? 'Fall   2017   TRANSFER' : l)),
      'the school and its first term on one line': TITLE_FIRST_NUMERIC.flatMap((l, i) => (i === at ? [`${school}   Fall   2017`] : i === at + 1 ? [] : [l])),
      'a column header between the school and its term': TITLE_FIRST_NUMERIC.flatMap((l, i) => (i === at ? [l, 'TITLE   SCH   DEPT NUM   SEC CRD   GRDE'] : [l])),
    };
    for (const [name, lines] of Object.entries(variants)) {
      const q = parseExternalTranscript(lines);
      assert.deepEqual([q.courses.length, q.transferRowsSkipped, q.university], [29, 12, undefined], name);
      assert.ok(q.courses.every((c) => c.grade !== undefined), name);
      assert.equal(asUndergraduate({ ...q, bachelorsConferred: undefined }), false, name);
    }
    // …while an issuer the text does name is still read — also when the
    // record's own first row comes right under it.
    assert.equal(parseExternalTranscript(['RUTGERS, THE STATE UNIVERSITY OF NEW JERSEY', ...variants['school line merged with a number']]).university, 'RUTGERS, THE STATE UNIVERSITY OF NEW JERSEY');
    const own = TITLE_FIRST_NUMERIC.indexOf('INTRO TO REAL ANALYSIS   01   640   311   01   4.0   A   QQ');
    const issuerAbove = [...TITLE_FIRST_NUMERIC.slice(0, own), 'SAMPLE STATE UNIVERSITY', TITLE_FIRST_NUMERIC[own]!, 'CALCULUS III   01   640   251   4.0', ...TITLE_FIRST_NUMERIC.slice(own + 1)].filter((l) => l !== school);
    assert.equal(parseExternalTranscript(issuerAbove).university, 'SAMPLE STATE UNIVERSITY');
  });
  // Re-review of the fix (2026-10-15).
  it('…whatever words the school’s name uses, and wherever on its line it stands', () => {
    const school = 'JIAO TONG UNIVERSITY-SHANGHAI';
    const at = TITLE_FIRST_NUMERIC.indexOf(school);
    const swap = (lines: string[]) => TITLE_FIRST_NUMERIC.flatMap((l, i) => (i === at ? lines : i === at + 1 ? [] : [l]));
    const variants: Record<string, string[]> = {
      'Universidad': TITLE_FIRST_NUMERIC.map((l) => (l === school ? 'UNIVERSIDAD DE PUERTO RICO' : l)),
      'Politecnico': TITLE_FIRST_NUMERIC.map((l) => (l === school ? 'POLITECNICO DI MILANO' : l)),
      'term first on its line': swap(['Fall   2017   JIAO TONG UNIVERSITY-SHANGHAI']),
      'the heading on its line': TITLE_FIRST_NUMERIC.flatMap((l) => (l === 'TRANSFER COURSES' ? [] : l === school ? [`TRANSFER COURSES   ${school}`] : [l])),
      'its city and a column header between': TITLE_FIRST_NUMERIC.flatMap((l) => (l === school ? [l, 'SHANGHAI   CHINA', 'TITLE   SCH   DEPT NUM   SEC CRD   GRDE'] : [l])),
    };
    for (const [name, lines] of Object.entries(variants)) {
      const q = parseExternalTranscript(lines);
      assert.deepEqual([q.courses.length, q.university], [29, undefined], name);
    }
  });
  it('…but the issuer printed well above the transferred rows, or above a transfer heading, keeps its name', () => {
    const own = TITLE_FIRST_NUMERIC.slice(TITLE_FIRST_NUMERIC.indexOf('Fall   2019 SCHOOL OF ARTS AND SCIENCES'));
    const far = ['SAMPLE STATE UNIVERSITY', 'RECORD OF: DOE   JO', 'STUDENT NUMBER: 000000000', 'ISSUED DATE: 10/14/26   PAGE:   1', 'PRINTED: 10/14/26', 'Fall   2017', 'CALCULUS I   01   640   151   4.0', 'GENERAL CHEMISTRY   01   160   161   4.0', ...own];
    assert.equal(parseExternalTranscript(far).university, 'SAMPLE STATE UNIVERSITY');
    const school = 'JIAO TONG UNIVERSITY-SHANGHAI';
    for (const heading of ['TRANSFER COURSES', 'ADVANCED PLACEMENT']) {
      const lines = TITLE_FIRST_NUMERIC.filter((l) => l !== school).flatMap((l) => (l === 'TRANSFER COURSES' ? ['RUTGERS, THE STATE UNIVERSITY OF NEW JERSEY', heading] : [l]));
      assert.equal(parseExternalTranscript(lines).university, 'RUTGERS, THE STATE UNIVERSITY OF NEW JERSEY', heading);
    }
  });
  it('a totals line inside the block keeps it open for the guess, as before', () => {
    // Its own rows without sections: the block found by its shape alone.
    const unsectioned = TITLE_FIRST_NUMERIC.map((l) => l.replace(/^(.+?   \d{2}   \d{3}   \d{3})   [A-Z0-9]{1,2}(   \d{1,2}\.\d{1,2}   )/, '$1$2')).flatMap((l) =>
      l.startsWith('GENERAL CHEMISTRY') ? [l, 'TERM TOTALS   07   007   025   8.0'] : l === 'Spring   2018' ? ['PEKING UNIVERSITY', l, 'ELECTIVE STUDIES   TR   T01   EL3   3.0'] : [l],
    );
    assert.equal(parseExternalTranscript(unsectioned).university, undefined);
  });
  it('…only on a record whose own rows print a section, and a coded row with a grade is not one of them', () => {
    const transferred = ['TRANSFER COURSES', 'Fall   2017', 'CALCULUS I   01   640   151   4.0', 'ACADEMIC WRITING   TR   T01   EL1   2.0'];
    const own = ['OPERATING SYSTEMS   01   198   416   01   4.0   A', 'COMPLEX VARIABLES   01   640   403   01   3.0   A', 'MATHEMATICAL LOGIC   01   640   461   01   3.0   A'];
    const record = (rows: string[], extra: string[] = []) => parseExternalTranscript([...head(1), ...transferred, 'Fall   2019 SCHOOL OF ARTS AND SCIENCES', ...rows, ...extra, 'TOTAL CREDITS ATTEMPTED:   10.0', '']);
    const three = record(own);
    assert.deepEqual([three.courses.map((c) => c.courseId), three.transferRowsSkipped], [['01:198:416', '01:640:403', '01:640:461'], 2]);
    const two = record(own.slice(0, 2));
    assert.ok(two.courses.some((c) => c.courseId === '01:640:151' && c.grade === undefined), 'two sectioned rows are not yet such a record: the row is read as before');
    const graded = record(own, ['PROBABILITY THEORY   TR   T01   EL   3.0   B']);
    assert.equal(graded.transferRowsSkipped, 2, 'a coded row with a grade is not counted as transferred');
  });
});
