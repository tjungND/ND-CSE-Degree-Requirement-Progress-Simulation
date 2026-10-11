// The rules the public-transcript research added to the external parser
// (2026-09-26), each pinned on a minimal document so a future change to one
// cannot silently undo another. The 93 fixtures in tests/public-transcripts
// cover the layouts whole; these cover the reasoning.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { isoOrEuropeanDate, parseExternalTranscript } from '../src/transcript/external.ts';

const FILLER = Array(12).fill('Record issued by the Registrar — verify with the issuing office before relying on it.');
const doc = (...lines: string[]) => parseExternalTranscript([...lines, ...FILLER]);
const row = (r: ReturnType<typeof parseExternalTranscript>, id: string) => r.courses.find((c) => c.courseId === id);

describe('public-transcript rules (2026-09-26)', () => {
  it('a numeric grade equal to the credits is a grade, not the Earned column, unless it repeats the credits’ format with a token after it', () => {
    const r = doc('Michigan State University', 'Fall 2023', 'CSE 802   Pattern Recognition and Analysis   3   3.0', 'CSE 803   Computer Vision   3.00   3.00   A   12.00');
    assert.equal(row(r, 'CSE 802')?.rawGrade, '3.0');
    assert.equal(row(r, 'CSE 803')?.grade, 'A');
    assert.equal(row(r, 'CSE 803')?.credits, 3);
  });
  it('zero earned right after the credits is that column; the grade-shaped token after it is the grade', () => {
    const r = doc('The University of Utah', 'Fall 2023', 'CS 6300   Artificial Intelligence   3.00   0.00   E   0.00', 'CS 6350   Machine Learning   3.00   0.00   W');
    assert.equal(row(r, 'CS 6300')?.rawGrade, 'E');
    assert.equal(row(r, 'CS 6350')?.rawGrade, 'W');
  });
  it('the legend decides E, N, S and NP: never a guess', () => {
    const base = ['Some University', 'Fall 2023', 'CS 500   Topics   3.00   E', 'CS 501   Seminar   1.00   N', 'CS 502   Research   3.00   S', 'CS 503   Colloquium   1.00   NP'];
    const plain = doc(...base);
    assert.equal(row(plain, 'CS 500')?.rawGrade, 'E');
    assert.equal(row(plain, 'CS 501')?.rawGrade, 'N');
    assert.equal(row(plain, 'CS 502')?.grade, 'S');
    assert.equal(row(plain, 'CS 503')?.grade, 'U');
    const keyed = doc(...base, 'TRANSCRIPT KEY: A 4.0, B 3.0, C 2.0, D 1.0, E 0.0 (failure). N Not satisfactory. S 10 Outstanding. NP No grade - pass.');
    assert.equal(row(keyed, 'CS 500')?.grade, 'F');
    assert.equal(row(keyed, 'CS 501')?.grade, 'U');
    assert.equal(row(keyed, 'CS 502')?.rawGrade, 'S');
    assert.equal(row(keyed, 'CS 503')?.grade, 'S');
    // A course row "E 0.00" is a grade and its points, not a legend entry.
    const rowOnly = doc('Some University', 'Fall 2023', 'MATH   1210   Calculus I   4.000   E   0.00');
    assert.equal(row(rowOnly, 'MATH 1210')?.rawGrade, 'E');
  });
  it('a pass/fail token beside a printed mark yields to the mark; a letter grade beats a numeric guess', () => {
    const r = doc('University of Sydney', 'Unit of Study   Title   Credit Points   Mark   Grade', 'Semester 1 2023', 'COMP 5216   Mobile Computing   6   66   CR', 'COMP 5048   Visual Analytics   6   78   DI', 'COMP 5300   Databases   6   88   A');
    assert.equal(row(r, 'COMP 5216')?.rawGrade, '66 CR'); // the band stays beside the mark (2026-09-26, the ANU sample)
    assert.equal(row(r, 'COMP 5048')?.rawGrade, '78 DI');
    assert.equal(row(r, 'COMP 5300')?.grade, 'A');
  });
  it('the column header maps a Banner Self-Service row: grade before credits, level before title', () => {
    const r = doc('University of Illinois', 'Fall 2021', 'Subject   Course   Level   Title   Grade   Credit Hours   Quality Points   R', 'CS   374   UG   Intro to Algs & Models of Comp   W   4.000   0.000', 'CS   598   GR   Special Topics: Deep Generative Models   PS   4.000   16.000');
    assert.equal(row(r, 'CS 374')?.rawGrade, 'W');
    assert.equal(row(r, 'CS 374')?.credits, 4);
    assert.equal(row(r, 'CS 374')?.level, 'undergraduate');
    assert.equal(row(r, 'CS 598')?.grade, 'S');
    assert.equal(row(r, 'CS 598')?.level, 'graduate');
  });
  it('marks columns before the grade (India) and a credit column after it', () => {
    const r = doc('JNTU Hyderabad', 'B.Tech III Year I Semester (R18) Regular Examinations, November 2021', 'Subject Code   Subject Name   Internals   Externals   Total   Grade   Credits', 'CS 501PC   Formal Languages and Automata Theory   27   63   90   A   3');
    const c = row(r, 'CS 501PC');
    assert.equal(c?.credits, 3);
    assert.equal(c?.grade, 'A');
    assert.equal(c?.season, 'fall');
    assert.equal(c?.year, 2021);
  });
  it('term headers: four-digit academic years, ordinals with a range, single-year ordinals in calendar order, Solar Hijri, a month range', () => {
    const one = (header: string) => row(doc('Some University', header, 'CS 101   Programming   3   A'), 'CS 101');
    assert.deepEqual([one('Spring 2023-2024')?.season, one('Spring 2023-2024')?.year], ['spring', 2024]);
    assert.deepEqual([one('Semester II 2022/2023')?.season, one('Semester II 2022/2023')?.year], ['spring', 2023]);
    assert.deepEqual([one('Semester 1 2023')?.season, one('Semester 1 2023')?.year], ['spring', 2023]);
    assert.deepEqual([one('Second Semester 1397-1398')?.season, one('Second Semester 1397-1398')?.year], ['spring', 2019]);
    assert.deepEqual([one('Semester: JUL-NOV 2022')?.season, one('Semester: JUL-NOV 2022')?.year], ['fall', 2022]);
    assert.deepEqual([one('Wintersemester 2022/23')?.season, one('Wintersemester 2022/23')?.year], ['fall', 2022]);
  });
  it('a header that names no season leaves it open instead of keeping the previous header’s', () => {
    const r = doc('BITS Pilani', 'Summer Term 2022', 'CS 100   Workshop   1   A', 'Term 2023', 'CS 101   Programming   3   A');
    assert.equal(row(r, 'CS 100')?.season, 'summer');
    assert.equal(row(r, 'CS 101')?.season, undefined);
  });
  it('a course title never becomes a term header', () => {
    const r = doc('Salt Lake Community College', 'Fall 2018', 'ENGL 2010   Intermediate Writing   3   A', 'MATH 1210   Calculus I   4   B');
    assert.equal(row(r, 'MATH 1210')?.year, 2018);
  });
  it('MIT’s dotted subjects, Toronto’s campus digit and a scheme-year Indian code are course codes; a year range is not', () => {
    const r = doc('Massachusetts Institute of Technology', 'Fall Term 2022-2023', '6.5840   Distributed Computer Systems Engineering   12   A', '6.THG   Graduate Thesis   24   S', 'CSC108H1   Introduction to Computer Programming   0.50   A', '18CS51   Management for IT Industry   3   B', '2019-2020 Autumn Term');
    assert.deepEqual(r.courses.map((c) => c.courseId), ['6.5840', '6.THG', 'CSC 108H1', '18CS51']);
    assert.equal(row(r, '6.5840')?.year, 2022);
  });
  it('day-first and ISO dates, and a date after the label on a two-date line', () => {
    assert.equal(isoOrEuropeanDate('Graduation Date: 30.06.2023'), '2023-06-30');
    assert.equal(isoOrEuropeanDate('25/06/2022'), '2022-06-25');
    assert.equal(isoOrEuropeanDate('2023-10-27'), '2023-10-27');
    assert.equal(isoOrEuropeanDate('18 de marzo de 2023'), '2023-03-18');
    assert.equal(isoOrEuropeanDate('05/06/2023'), undefined, 'ambiguous without a day-first hint');
    const r = doc('Middle East Technical University', 'Date of Registration:   09.09.2019   Graduation Date:   30.06.2023', 'Bachelor of Science in Computer Engineering', '2019-2020 Fall Semester', 'CENG 111   Introduction   4   AA');
    assert.equal(r.bachelorsConferredOn, '2023-06-30');
  });
  it('PeopleSoft’s transfer block is skipped like Banner’s', () => {
    const r = doc('Penn State', 'Transfer Credits', 'Transfer Credit from University of Pittsburgh', 'CS 1550   Introduction to Operating Systems   3.00   3.00   TR', 'Course Trans GPA:   0.000   Transfer Totals:   3.000   3.000', 'Fall 2024', 'CMPSC 565   Algorithm Design and Analysis   3.00   3.00   A   12.00');
    assert.deepEqual(r.courses.map((c) => c.courseId), ['CMPSC 565']);
    assert.equal(r.transferRowsSkipped, 1);
  });
  it('legend prose about quarter hours does not make a semester transcript a quarter one', () => {
    const r = doc('The University of Utah', 'Fall 2023', 'CS 6300   Artificial Intelligence   3.00   3.00   A   12.00', 'TRANSCRIPT KEY: prior transcripts show quarter hours; credits were converted from quarters to semesters in 1998.');
    assert.equal(r.quarterSystem, undefined);
  });
  it('a lone lowercase letter and a small integer stay in the title; a starred or zero-prefixed token stays as printed', () => {
    const r = doc('Universidad de los Andes', 'Periodo 2019-10', 'ISIS 1221   Introducción a la Programación   3   4.5', 'MATE 1203   Calculus 1   4   A-', 'CIS 5000   Software Foundations   1.00   I*', 'CS 310   Data Structures   4   0F');
    assert.equal(row(r, 'ISIS 1221')?.title, 'Introducción a la Programación');
    assert.equal(row(r, 'ISIS 1221')?.rawGrade, '4.5');
    assert.equal(row(r, 'ISIS 1221')?.season, 'spring');
    assert.equal(row(r, 'MATE 1203')?.title, 'Calculus 1');
    assert.equal(row(r, 'CIS 5000')?.rawGrade, 'I*');
    assert.equal(row(r, 'CS 310')?.rawGrade, '0F');
  });
  it('a level named in one cell, Confer Date, and degree abbreviations with their dots', () => {
    // The header prints the school's name, as HKUST's does: a document with one
    // course, no name and no totals is no transcript (DGS 2026-10-10, answer 4a).
    const r = doc('The Hong Kong University of Science and Technology', 'Program: MSc in Information Technology   Career: Postgraduate', 'Degree:   B.Sc. Engineering   Confer Date:   06/15/2024', 'Fall 2022', 'COMP 5211   Advanced Artificial Intelligence   3   A-');
    assert.equal(row(r, 'COMP 5211')?.level, 'graduate');
    assert.equal(r.bachelorsConferredOn, '2024-06-15');
    // "be applied toward a degree" is prose, not a B.E.
    const prose = doc('UC Berkeley Extension', 'Extension courses carry credit that may be applied toward a degree elsewhere, awarded June 2023.', 'Fall 2022', 'COMPSCI X470   Foundations of Data Science   3   A');
    assert.equal(prose.bachelorsConferredOn, undefined);
  });
  // ——— Read from the registrar PDFs themselves (2026-09-26, later the same day) ———
  it('the prose of a transcript key or regulation never starts a course row: function words, "Clause 11.", lowercase "in 2009", a program line, an e-mail, a trailing comma, a sentence', () => {
    const r = doc(
      'Some University',
      'Fall 2023',
      'CS 500   Topics   3.00   A',
      'Since 1998, a scheme of first- and second-level degree programmes (Bachelor and Master) was introduced to be offered parallel to or',
      'Clause 37.   Grading using the designations A B+ B C+ C D+ D or F shall be executed based on the',
      'in 2009 as replacement for the previous   A',
      'IN 2003   Efficient Algorithms and Data Structures   8   1,7',
      '3500   BACHELOR OF COMPUTING (HONOURS)   3   C',
      '14853, univreg@cornell.edu, Telephone: (607) 255-4232   3   A',
      'CS 601   students were admitted in a batch and there were 8 repeaters   3   A',
      'CS 602   Exampleville,   3   A',
      'B+   3.333 per credit',
      '0000-0999 Ratcliffe Hicks School of Agriculture   4.3   A',
      '199719/98 (Building B+, B   Very Good',
      '6.5840   Distributed Computer Systems Engineering   12   A',
    );
    assert.deepEqual(r.courses.map((c) => c.courseId), ['CS 500', 'IN 2003', '6.5840']);
  });
  it('a two-line row takes its numbers from the next line only when that line is numbers, not the next sentence', () => {
    const r = doc('Some University', 'Fall 2023', 'CS 502   Seminar in Computing', '1.00   A', 'CS 503   Advanced Topics in Computing', 'The document explains A process and the criteria');
    assert.equal(row(r, 'CS 502')?.grade, 'A');
    assert.equal(row(r, 'CS 502')?.credits, 1);
    assert.equal(row(r, 'CS 503'), undefined);
  });
  it('the Australian HD / D / CR / P / N bands stay raw beside their mark, and a term line with no year of its own takes the header’s', () => {
    const r = doc(
      'THE AUSTRALIAN NATIONAL UNIVERSITY',
      'BACHELOR OF UNIVERSITY',
      '200 5   FIRST SEMESTER',
      'COURSE CODE   COURSE TITLE   UNITS TAKEN   MARK   GRADE',
      'COMP 1100   Introduction to Programming   6   77   D',
      'COMP 1110   Structured Programming   6   81   HD',
      'COMP 1130   Programming Advanced   6   62   CR',
      'SECOND SEMESTER',
      'COMP 2100   Software Design   6   55   P',
      'COMP 2300   Computer Organisation   6   40   N',
      'EXAM1003   CLASS 5   1   ABN *',
    );
    assert.equal(r.university, 'THE AUSTRALIAN NATIONAL UNIVERSITY');
    assert.equal(row(r, 'COMP 1100')?.rawGrade, '77 D');
    assert.equal(row(r, 'COMP 1100')?.grade, undefined);
    assert.equal(row(r, 'COMP 1110')?.rawGrade, '81 HD');
    assert.equal(row(r, 'COMP 1130')?.rawGrade, '62 CR');
    assert.equal(row(r, 'COMP 2100')?.rawGrade, '55 P');
    assert.equal(row(r, 'COMP 2300')?.rawGrade, '40 N');
    assert.deepEqual([row(r, 'COMP 1100')?.season, row(r, 'COMP 1100')?.year], ['spring', 2005]);
    assert.deepEqual([row(r, 'COMP 2100')?.season, row(r, 'COMP 2100')?.year], ['fall', 2005]);
    // A status row with no mark: the title keeps its number, the units are the credits.
    assert.equal(row(r, 'EXAM 1003')?.title, 'CLASS 5');
    assert.equal(row(r, 'EXAM 1003')?.credits, 1);
    assert.equal(row(r, 'EXAM 1003')?.rawGrade, 'ABN');
    // Without an HD anywhere, D is the app's D and the mark is set aside.
    const us = doc('Some University', 'Fall 2023', 'CODE   TITLE   CREDITS   MARK   GRADE', 'CS 500   Topics   3   77   D');
    assert.equal(row(us, 'CS 500')?.grade, 'D');
  });
  it('a year the PDF sets apart ("200 3   FULL YEAR") is a year-only term', () => {
    const r = doc('Some University', '200 3   FULL YEAR', 'CS 500   Topics   3   A');
    assert.equal(row(r, 'CS 500')?.year, 2003);
    assert.equal(row(r, 'CS 500')?.season, undefined);
  });
});

// ——— Transcript accuracy program, Batch A (DGS 2026-10-09): parser fixes F1–F3 ———
// Each rule here was probed on docs/TRANSCRIPT-ACCURACY-PLAN.md §1 and is
// pinned with the shape that failed AND the neighbouring shape that must keep
// reading as before (the critic's tightenings, plan §2 step 4).
describe('transcript accuracy program, Batch A — F1 continuation, points and in-progress rows (2026-10-09)', () => {
  it('F1a (i): a code alone on its line takes the title and the numbers from the next line — only when that line ends in the credits and a grade token', () => {
    const r = doc(
      'Some University',
      'Fall 2023',
      'CS 500',
      'Advanced Topics   3   A',
      'CS 501',
      'Seminar in Computing   1.00   S',
      'CS 502',
      'The document explains A process and the criteria',
      'CS 503',
      '3.00   A',
    );
    assert.deepEqual([row(r, 'CS 500')?.title, row(r, 'CS 500')?.credits, row(r, 'CS 500')?.grade], ['Advanced Topics', 3, 'A']);
    assert.deepEqual([row(r, 'CS 501')?.title, row(r, 'CS 501')?.credits, row(r, 'CS 501')?.grade], ['Seminar in Computing', 1, 'S']);
    assert.equal(row(r, 'CS 502'), undefined, 'a sentence after a bare code is not its row');
    assert.equal(row(r, 'CS 503'), undefined, 'numbers alone carry no title: not the shape');
  });
  it('F1a (ii): a wrapped title whose continuation carries four or more words is taken only when that line ends in the credits and a grade token', () => {
    const r = doc(
      'Some University',
      'Fall 2023',
      'CS 500   Advanced Topics in Distributed',
      'Systems and Cloud Infrastructure Design   3   A',
      'CS 501   Advanced Topics in Distributed',
      'Systems and Cloud Infrastructure Design   3.00   3.00   A   12.00',
      'CS 502   Advanced Topics in Distributed',
      'Systems and Cloud Infrastructure Design   3   85',
      'CS 503   Advanced Topics in Computing',
      'Introductory courses carry 3 credits and are graded A',
      'CS 504   Advanced Topics in Computing',
      'The document explains A process and the criteria',
      'CS 505   Seminar in Computing',
      '1.00   A',
    );
    assert.equal(row(r, 'CS 500')?.title, 'Advanced Topics in Distributed Systems and Cloud Infrastructure Design');
    assert.deepEqual([row(r, 'CS 500')?.credits, row(r, 'CS 500')?.grade], [3, 'A']);
    assert.deepEqual([row(r, 'CS 501')?.credits, row(r, 'CS 501')?.grade], [3, 'A'], 'the Earned echo and the points may sit around the grade');
    assert.deepEqual([row(r, 'CS 502')?.credits, row(r, 'CS 502')?.rawGrade], [3, '85'], 'a numeric mark is a grade token');
    assert.equal(row(r, 'CS 503'), undefined, 'a sentence that mentions a number and a letter is not a numbers tail');
    assert.equal(row(r, 'CS 504'), undefined, 'the 2026-09-26 rule stays: the next sentence is never the numbers');
    assert.deepEqual([row(r, 'CS 505')?.credits, row(r, 'CS 505')?.grade], [1, 'A'], 'the numbers-only continuation reads as before');
  });
  it('F1b: a gradeless row’s trailing two-decimal number is its points only under a header that mapped a Points column, or in the credits/earned/points triple — a 20-point mark keeps its number', () => {
    const plain = doc('Some University', 'Fall 2023', 'CS 500   Topics   4   16.0', 'CS 501   Topics   3   12.0', 'CS 502   Topics   3.00   3.00   12.00', 'CS 503   Topics   3.00   12.00');
    assert.deepEqual([row(plain, 'CS 500')?.credits, row(plain, 'CS 500')?.rawGrade], [4, '16.0'], 'credits 4, mark 16.0: the product test alone decides nothing');
    assert.deepEqual([row(plain, 'CS 501')?.credits, row(plain, 'CS 501')?.rawGrade], [3, '12.0'], 'credits 3, mark 12.0');
    assert.deepEqual([row(plain, 'CS 502')?.credits, row(plain, 'CS 502')?.rawGrade], [3, undefined], 'the credits/earned/points triple');
    assert.deepEqual([row(plain, 'CS 503')?.credits, row(plain, 'CS 503')?.rawGrade], [3, '12.00'], 'no header: the number stays the printed grade');
    const keyed = doc('Some University', 'Course   Title   Credits   Grade   Points', 'Fall 2023', 'CS 500   Advanced Topics in Computing', '3.00   12.00', 'CS 501   Topics   4   16.00', 'CS 502   Topics   3   B+   9.00');
    assert.deepEqual([row(keyed, 'CS 500')?.credits, row(keyed, 'CS 500')?.grade, row(keyed, 'CS 500')?.rawGrade], [3, undefined, undefined], 'a Points column was mapped: the trailing number is points');
    assert.deepEqual([row(keyed, 'CS 501')?.credits, row(keyed, 'CS 501')?.rawGrade], [4, undefined]);
    assert.deepEqual([row(keyed, 'CS 502')?.credits, row(keyed, 'CS 502')?.grade], [3, 'B+'], 'a grade token on the row is still the grade');
  });
  it('F1c: the integer before a trailing decimal is the title’s only inside an in-progress block or under a header with no grade or mark column', () => {
    const ip = doc('Some University', 'Fall 2023', 'COURSES IN PROGRESS', 'MATH 1220   Calculus 2   3.0');
    assert.deepEqual([row(ip, 'MATH 1220')?.title, row(ip, 'MATH 1220')?.credits, row(ip, 'MATH 1220')?.grade], ['Calculus 2', 3, 'IP']);
    const noGrade = doc('Some University', 'Course   Title   Credits', 'Fall 2023', 'MATH 1220   Calculus 2   3.0');
    assert.deepEqual([row(noGrade, 'MATH 1220')?.title, row(noGrade, 'MATH 1220')?.credits], ['Calculus 2', 3]);
    const marks = doc('Some University', 'Course   Title   Credits   Mark', 'Fall 2023', 'CS 500   Topics 1   5.0');
    assert.deepEqual([row(marks, 'CS 500')?.title, row(marks, 'CS 500')?.credits, row(marks, 'CS 500')?.rawGrade], ['Topics', 1, '5.0'], 'under a marks header the integer is the credits and the decimal the mark');
    const plain = doc('Some University', 'Fall 2023', 'CS 500   Topics 1   5.0', 'CS 600   Master Thesis 15   8.7');
    assert.deepEqual([row(plain, 'CS 500')?.title, row(plain, 'CS 500')?.credits, row(plain, 'CS 500')?.rawGrade], ['Topics', 1, '5.0'], 'no block, no header: no bound on the integer decides it');
    assert.deepEqual([row(plain, 'CS 600')?.title, row(plain, 'CS 600')?.credits, row(plain, 'CS 600')?.rawGrade], ['Master Thesis', 15, '8.7']);
  });
});

describe('transcript accuracy program, Batch A — F2 term cells and Workday headers (2026-10-09)', () => {
  const term = (r: ReturnType<typeof parseExternalTranscript>, id: string) => [row(r, id)?.season, row(r, id)?.year];
  it('F2: compact term codes are read from the first cell before the course code or a header-mapped term cell — never from a trailing cell', () => {
    const pre = doc(
      'Some University',
      'Fall 2021',
      '2023FA   CS 101   Programming   3   A',
      '2024SP   CS 102   Data Structures   3   B',
      '2023SU   CS 103   Systems   3   A',
      '2024WI   CS 104   Networks   3   A',
      'CS 105   Security   3   A   2023FA',
    );
    assert.deepEqual(term(pre, 'CS 101'), ['fall', 2023]);
    assert.deepEqual(term(pre, 'CS 102'), ['spring', 2024]);
    assert.deepEqual(term(pre, 'CS 103'), ['summer', 2023]);
    assert.deepEqual(term(pre, 'CS 104'), ['spring', 2024], 'a winter term sits where the spring does, as a "Winter" header would');
    assert.deepEqual(term(pre, 'CS 105'), ['fall', 2021], 'a trailing cell no header mapped is not the row\'s term');
    const mapped = doc('Some University', 'Term   Course   Title   Credits   Grade', '2024SP   CS 101   Programming   3   A');
    assert.deepEqual(term(mapped, 'CS 101'), ['spring', 2024]);
    const last = doc('Some University', 'Course   Title   Credits   Grade   Term', 'CS 101   Programming   3   A   2023FA');
    assert.deepEqual(term(last, 'CS 101'), ['fall', 2023], 'Colleague prints the term as the last cell — mapped by the header');
  });
  it('F2: a six-digit Banner term code before the course code is a term cell, decoded only by the document’s own key; a six-digit course id is never re-termed', () => {
    const noKey = doc('Some University', 'Fall 2021', '202310   CS 102   Data Structures   3   B');
    assert.deepEqual([row(noKey, 'CS 102')?.title, ...term(noKey, 'CS 102')], ['Data Structures', 'fall', 2021], 'no key: the code is not the course id, and the row keeps the header\'s term');
    assert.equal(row(noKey, '202310'), undefined);
    const keyed = doc(
      'Some University',
      'Term codes on this record: 202310 is the Fall 2022 semester, 202320 is the Spring 2023 semester.',
      '202310   CS 101   Programming   3   A',
      '202320   CS 102   Data Structures   3   B',
      '202330   CS 103   Systems   3   A',
    );
    assert.deepEqual(term(keyed, 'CS 101'), ['fall', 2022]);
    assert.deepEqual(term(keyed, 'CS 102'), ['spring', 2023]);
    assert.deepEqual(term(keyed, 'CS 103'), [undefined, undefined], 'a term part the key does not name stays unread');
    const sixDigitId = doc('Some University', 'Fall 2021', '202310   Advanced Topics   3   A', 'CS 103   Programming   3   A   202320');
    assert.deepEqual([row(sixDigitId, '202310')?.title, ...term(sixDigitId, '202310')], ['Advanced Topics', 'fall', 2021], 'a six-digit course id before a title is a course id');
    assert.deepEqual(term(sixDigitId, 'CS 103'), ['fall', 2021], 'a trailing six-digit cell is never the term');
  });
  it('F2: a Workday term header’s parenthesised date range is stripped before the season and year are read', () => {
    const r = doc(
      'Some University',
      '2023 Fall Semester (09/05/2023-12/15/2023)',
      'CS 101   Programming   3   A',
      'Spring 2024 Term (01/16/2024-05/10/2024)',
      'CS 102   Data Structures   3   B',
      'Fall 2023 Term',
      'CS 103   Systems   3   A',
      'Summer 2024 Semester (05/20/2024 - 08/09/2024)',
      'CS 104   Networks   3   A',
    );
    assert.deepEqual(term(r, 'CS 101'), ['fall', 2023]);
    assert.deepEqual(term(r, 'CS 102'), ['spring', 2024]);
    assert.deepEqual(term(r, 'CS 103'), ['fall', 2023]);
    assert.deepEqual(term(r, 'CS 104'), ['summer', 2024]);
  });
});

describe('transcript accuracy program, Batch A — F3 course-code shapes (2026-10-09)', () => {
  const cells = (r: ReturnType<typeof parseExternalTranscript>, id: string) => [row(r, id)?.title, row(r, id)?.credits, row(r, id)?.grade];
  it('F3: a three-token subject with a one-letter middle is a course code when that letter is printed as a capital', () => {
    const r = doc(
      'Some University',
      'Fall 2023',
      'ENG M 612   Engineering Management   3   A',
      'MATH E 101   Calculus   4   B',
      'ENG M   613   Project Management   3   A',
      'Use a 2019 edition of the handbook   3   A',
      'SEE A 100 level course   3   A',
    );
    assert.deepEqual(r.courses.map((c) => c.courseId), ['ENG M 612', 'MATH E 101', 'ENG M 613']);
    assert.deepEqual(cells(r, 'ENG M 612'), ['Engineering Management', 3, 'A']);
    assert.deepEqual(cells(r, 'MATH E 101'), ['Calculus', 4, 'B']);
    assert.deepEqual(cells(r, 'ENG M 613'), ['Project Management', 3, 'A'], 'the subject and the number in separate cells');
  });
  it('F3: Workday’s dash after the course number and Colleague’s section cell after the code are not the title’s or the credits’', () => {
    const r = doc(
      'Some University',
      'Fall 2023',
      'CS 101 - Calculus 1   3   A',
      'CS 102 - Introduction to Programming   A   3   3   12',
      'CS-103   01   Calculus 2   3   B',
      'CS-104   01   Data Structures   3.00   A',
      'CS 105-01   Networks   3   A',
    );
    assert.deepEqual(cells(r, 'CS 101'), ['Calculus 1', 3, 'A']);
    assert.deepEqual(cells(r, 'CS 102'), ['Introduction to Programming', 3, 'A']);
    assert.deepEqual(cells(r, 'CS 103'), ['Calculus 2', 3, 'B']);
    assert.deepEqual(cells(r, 'CS 104'), ['Data Structures', 3, 'A']);
    assert.deepEqual(cells(r, 'CS 105'), ['Networks', 3, 'A'], 'a section glued to the number reads as before');
    const mapped = doc('Some University', 'Course   Section   Title   Credits   Grade', 'Fall 2023', 'CS-103   01   Calculus 2   3   B');
    assert.deepEqual(cells(mapped, 'CS 103'), ['Calculus 2', 3, 'B'], 'under a Section header the mapped path sees the same tokens');
  });
});

// ——— The 2026-10-09 review of F1–F3: the regressions and loose ends it found, each probed on HEAD and pinned here ———
describe('transcript accuracy program, Batch A — review of F1–F3 (2026-10-09)', () => {
  const term = (r: ReturnType<typeof parseExternalTranscript>, id: string) => [row(r, id)?.season, row(r, id)?.year];
  const one = (header: string) => term(doc('Some University', header, 'CS 101   Programming   3   A'), 'CS 101');
  it('review of F3: an all-capitals term heading with a Roman numeral is a term, never a one-letter-middle course code', () => {
    assert.deepEqual(one('SEMESTRE I 2019'), ['spring', 2019]);
    assert.deepEqual(one('CICLO I 2019'), ['spring', 2019]);
    assert.deepEqual(one('PERIODO I 2019'), ['spring', 2019]);
    assert.deepEqual(one('TRIMESTER I 2019'), [undefined, 2019], 'a trimester ordinal names no season (as before F3)');
    assert.deepEqual(one('SEMESTRE I 2019-2020'), ['fall', 2019]);
    assert.deepEqual(one('Semestre I 2019'), ['spring', 2019]);
    assert.deepEqual(one('SEMESTER I 2019'), ['spring', 2019]);
    assert.deepEqual(one('SEMESTRE I DE 2019'), ['spring', 2019]);
    const two = doc('Some University', 'SEMESTRE I 2019', 'CS 101   Programming   3   A', 'SEMESTRE II 2019', 'CS 102   Data Structures   3   B');
    assert.deepEqual(term(two, 'CS 101'), ['spring', 2019]);
    assert.deepEqual(term(two, 'CS 102'), ['fall', 2019], 'the second of two semesters in one calendar year, in calendar order');
    const code = doc('Some University', 'Fall 2019', 'ENG M 612   Engineering Management   3   A', 'ENG M 2019   Edition Studies   3   B');
    assert.deepEqual([row(code, 'ENG M 612')?.title, ...term(code, 'ENG M 612')], ['Engineering Management', 'fall', 2019], 'the F3 shape itself still reads');
    assert.deepEqual([row(code, 'ENG M 2019')?.title, row(code, 'ENG M 2019')?.credits], ['Edition Studies', 3], 'a year-shaped course number with a title after it is a code');
  });
  it('review of F2: a term header whose only year is inside its parenthesised date range takes the year the dates give', () => {
    assert.deepEqual(one('Fall Semester (09/05/2023-12/15/2023)'), ['fall', 2023]);
    assert.deepEqual(one('Semester 1 (27/02/2023-23/06/2023)'), ['spring', 2023]);
    assert.deepEqual(one('Semester 2 (24/07/2023-17/11/2023)'), ['fall', 2023], 'was spring 2017 before F2 — the range passed for an academic year');
    assert.deepEqual(one('Summer Session I (05/15/2023-06/30/2023)'), ['summer', 2023], 'was summer 2006 before F2');
    assert.deepEqual(one('Winter Term (12/01/2023-03/15/2024)'), ['spring', 2024], 'a winter term that starts in the December before is the later year’s');
    assert.deepEqual(one('Fall Term (09/01/2023-01/15/2024)'), ['fall', 2023], 'a fall term that ends after New Year is the earlier year’s');
    assert.deepEqual(one('2023 Fall Semester (09/05/2023-12/15/2023)'), ['fall', 2023], 'Workday’s year outside the range reads as pinned');
    assert.deepEqual(one('Fall Semester (09/05/23-12/15/23)'), [undefined, undefined], 'a two-digit year is not read: never guess');
  });
  it('review of F1a: a sentence or footnote after a bare code or a wrapped title is never the row’s numbers — the grade must be the line’s last grade cell and the added title words hold no function word', () => {
    const r = doc(
      'Some University',
      'Fall 2023',
      'CS 500   Thesis Research',
      'Credits applied toward the degree this semester 12   3.5',
      'CS 501   Independent Study',
      'Repeated course excluded from degree credit 3   A',
      'CS 502   Independent Study',
      'Approved for graduate credit by petition 3   B+',
      'CS 503   Advanced Topics',
      'Minimum passing mark in graduate courses is 3   60',
      'CS 504',
      'Transferred from partner institution with 3   CR',
      'CS 505',
      'Seminar in Computing   1.00   Pass',
      'CS 506   Advanced Topics in Distributed',
      'Systems and Cloud Infrastructure Design   3   A',
      'CS 507   Introduction to Machine',
      'Learning from Data   3   A',
    );
    for (const id of ['CS 500', 'CS 501', 'CS 502', 'CS 503', 'CS 504']) assert.equal(row(r, id), undefined, `${id}: the next line is a sentence, not its numbers`);
    const cells = (id: string) => [row(r, id)?.title, row(r, id)?.credits, row(r, id)?.grade];
    assert.deepEqual(cells('CS 505'), ['Seminar in Computing', 1, 'S'], 'a pass word IN the grade cell is the grade');
    assert.deepEqual(cells('CS 506'), ['Advanced Topics in Distributed Systems and Cloud Infrastructure Design', 3, 'A'], 'the F1a shape itself still reads');
    assert.deepEqual(cells('CS 507'), ['Introduction to Machine Learning from Data', 3, 'A'], 'three words: the 2026-09-26 numbers-only rule reads a title with "from"');
  });
  it('review of F2: the Banner key is bounded — a year off by more than one, a labelled identifier, a key on a course row, or a decode outside the document’s years is refused', () => {
    const postal = doc('Some University', 'Fall 2021', 'Student identification number and postal code: 201301, admitted for the Spring 2023 intake', '202301   CS 101   Programming   3   A');
    assert.deepEqual(term(postal, 'CS 101'), ['fall', 2021], 'a postal code beside an entry term (offset −10) is no key: the row keeps its header');
    const labelled = doc('Some University', 'Student ID 202310   Entry Term Fall 2022', 'Fall 2021', '202310   CS 101   Programming   3   A');
    assert.deepEqual(term(labelled, 'CS 101'), ['fall', 2021], 'a number the line labels as an ID is no key');
    const onRow = doc('Some University', 'Fall 2021', 'CS 101   Programming   3   A   Fall 2022 (202310)', '202310   CS 102   Data Structures   3   B');
    assert.deepEqual(term(onRow, 'CS 102'), ['fall', 2021], 'a course row never carries the key');
    const farOff = doc(
      'Some University',
      'Term codes on this record: 202310 is the Fall 2022 semester of the academic year.',
      '200010   CS 101   Programming   3   A',
      '200110   CS 102   Data Structures   3   B',
      '202310   CS 103   Systems   3   A',
    );
    assert.deepEqual(term(farOff, 'CS 101'), [undefined, undefined], 'a decode of 1999 in a document that prints only 2022 is refused');
    assert.deepEqual(term(farOff, 'CS 102'), [undefined, undefined]);
    assert.deepEqual(term(farOff, 'CS 103'), ['fall', 2022], 'the key still decodes the code it names');
    const threeOff = doc('Some University', 'Term codes on this record: 202310 is the Fall 2020 semester of the academic year.', '202310   CS 101   Programming   3   A');
    assert.deepEqual(term(threeOff, 'CS 101'), [undefined, undefined], 'a code three years off its named year is outside Banner’s convention: no key, no guess');
  });
  it('review of F2: the key is read from the whole document before the rows, so a legend printed after them decodes them too', () => {
    const r = doc(
      'Some University',
      '202310   CS 101   Programming   3   A',
      '202320   CS 102   Data Structures   3   B',
      'Term codes on this record: 202310 is the Fall 2022 semester, 202320 is the Spring 2023 semester.',
    );
    assert.deepEqual(term(r, 'CS 101'), ['fall', 2022]);
    assert.deepEqual(term(r, 'CS 102'), ['spring', 2023]);
  });
  it('review of F1b: the points evidence is the table header in force, not any header the document printed', () => {
    const r = doc(
      'Some University',
      'Course   Title   Credits   Grade   Points',
      'Fall 2022',
      'CS 400   Topics   3   A   12.00',
      'TRANSFER CREDIT',
      'Course   Title   Credits   Grade',
      'Fall 2023',
      'CS 700   Advanced Topics in Computing',
      '4   16.00',
    );
    assert.deepEqual([row(r, 'CS 700')?.credits, row(r, 'CS 700')?.rawGrade], [4, '16.00'], 'the header in force maps no Points column: the number stays the printed grade');
    const keyed = doc('Some University', 'Course   Title   Credits   Grade   Points', 'Fall 2023', 'CS 700   Advanced Topics in Computing', '4   16.00');
    assert.deepEqual([row(keyed, 'CS 700')?.credits, row(keyed, 'CS 700')?.rawGrade], [4, undefined], 'under the Points header the number is points');
  });
});

describe('transcript accuracy program, Batch A — new public specimens (2026-10-09)', () => {
  it('a vendor authentication page (Parchment) names no university and yields no course row', () => {
    // The page travels inside a Parchment-delivered transcript PDF; the pinned
    // line list is tests/fixtures/public-transcripts/pdf-parchment-authentication.json.
    const lines = JSON.parse(readFileSync(new URL('./fixtures/public-transcripts/pdf-parchment-authentication.json', import.meta.url), 'utf8')) as string[];
    const r = parseExternalTranscript(lines);
    assert.equal(r.courses.length, 0);
    assert.ok(!/parchment/i.test(r.university ?? ''), `the vendor is never the university: ${r.university}`);
    assert.equal(r.university, undefined);
  });
});

// ——— Transcript accuracy program, Batch B (DGS 2026-10-09): F6 header words ———
// Each header shape below was composed from a registrar's documentation or
// read from a public specimen (tests/fixtures/public-transcripts/sources.json)
// and pinned here on a minimal document, so the corpus fixture that depends on
// it cannot be the only thing holding the rule.
describe('transcript accuracy program, Batch B — F6 header words (2026-10-09)', () => {
  const cells = (r: ReturnType<typeof parseExternalTranscript>, id: string) => [row(r, id)?.title, row(r, id)?.credits, row(r, id)?.grade ?? row(r, id)?.rawGrade];
  const term = (r: ReturnType<typeof parseExternalTranscript>, id: string) => [row(r, id)?.season, row(r, id)?.year];
  const MINERVA = ['Subject   Number   Title   Cr. / C.E.U. Grade   Remarks Earned   Class', 'Avg.'];
  it('Minerva: a header cell holding two words of different kinds is two columns ("Cr. / C.E.U. Grade", "Remarks Earned"); the section number and the class average never reach the row', () => {
    const r = doc(
      'Some University',
      ...MINERVA,
      'Fall 2024',
      'COMP 202   001 Foundations of Programming   3   A   3   B',
      'MATH 140   001 Calculus 1   3   A-   3   B',
      'COMP 251   001 Algorithms and Data Structures   3   A   I   3   B',
      'MATH 222   001 Calculus 3   3   B   E   0   B',
      'BIOL 111   001 Principles: Organismal Biology   3   B+   EXC   0   B',
      'COMP 302   001 Programming Lang & Paradigms   3   ZZ   3',
      'COMP 303   001 Software Design   TBA   A   NaN   B',
      'MATH 133   001 Linear Algebra and Geometry   3   W   0',
    );
    assert.deepEqual(cells(r, 'COMP 202'), ['Foundations of Programming', 3, 'A']);
    assert.deepEqual(cells(r, 'MATH 140'), ['Calculus 1', 3, 'A-'], 'the title keeps its digit: a fit that reads it as the credits and the credits as a numeric grade with the letter grade left over costs more');
    assert.deepEqual(cells(r, 'COMP 251'), ['Algorithms and Data Structures', 3, 'A'], 'a Remarks cell between the grade and the earned units');
    assert.deepEqual(cells(r, 'MATH 222'), ['Calculus 3', 3, 'B']);
    assert.deepEqual(cells(r, 'BIOL 111'), ['Principles: Organismal Biology', 3, 'B+']);
    assert.deepEqual(cells(r, 'COMP 302'), ['Programming Lang & Paradigms', 3, 'ZZ']);
    assert.deepEqual(cells(r, 'COMP 303'), ['Software Design', undefined, 'A'], 'TBA credits and NaN earned units are empty cells, never a grade');
    assert.deepEqual(cells(r, 'MATH 133'), ['Linear Algebra and Geometry', 3, 'W']);
  });
  it('Minerva: a registered row with no grade under a header whose grade column has held only letters keeps its trailing digit in the title and reads the last number as the credits', () => {
    const lettered = doc('Some University', ...MINERVA, 'Fall 2025', 'ECSE 200   001 Electric Circuits 1   3   A-   3   B', 'Fall 2026', 'RW   ECSE 210   001 Electric Circuits 2   3');
    assert.deepEqual(cells(lettered, 'ECSE 210'), ['Electric Circuits 2', 3, undefined]);
    // The first row of a table carries no such evidence: the recorded rule
    // (2026-09-26, F1c) reads the integer as the credits and the number as a grade.
    const first = doc('Some University', ...MINERVA, 'Fall 2026', 'RW   ECSE 210   001 Electric Circuits 2   3');
    assert.deepEqual(cells(first, 'ECSE 210'), ['Electric Circuits', 2, '3']);
  });
  it('Alberta: a header printed on two lines is joined column by column when every joined pair is a header word, and the class statistics are skipped', () => {
    const r = doc(
      'UNIVERSITY OF ALBERTA - UNOFFICIAL RECORD',
      'Winter Term 2019   Master of Engineering (Crse)',
      'Grade   Units   Units   Grade   Class   Class',
      'Course   Description   Remark   Taken   Passed   Points   Avg   Enrl',
      'ECE   541   DIGITAL SIGNAL PROCESSING   B   3.0   3.0   9.00   3.3   19',
      'ECE   684   WIRELESS COMMUNICATION SYSTEMS   B+   3.0   3.0   9.90   3.3   16',
      'ENGG   600   ENG ETHICS AND PROFESSIONALISM   CR   0.5   0.5   0.00   XXX   170',
      'ECE   910A   DIRECTED RESEARCH PROJECT   IP   0.0   0.0   0.00   XXX   32',
      'TOTALS   9.5   9.5   27.90',
    );
    assert.deepEqual(cells(r, 'ECE 541'), ['DIGITAL SIGNAL PROCESSING', 3, 'B']);
    assert.deepEqual(cells(r, 'ECE 684'), ['WIRELESS COMMUNICATION SYSTEMS', 3, 'B+'], '"Grade Remark" is the grade column, not a marks column ("Re-mark"): a signed grade reads');
    assert.deepEqual(cells(r, 'ENGG 600'), ['ENG ETHICS AND PROFESSIONALISM', 0.5, 'S'], 'CR is a pass (the legend: "grades of CR have met the requirements")');
    assert.deepEqual(cells(r, 'ECE 910A'), ['DIRECTED RESEARCH PROJECT', 0, 'IP']);
    assert.equal(r.courses.length, 4, 'the TOTALS line is no row');
    // The upper line is not joined to a line whose pairs are not header words.
    const apart = doc('Some University', 'Fall 2023', 'Grade   Grade   Class   Class', 'Course   Title   Credits   Grade', 'CS 500   Topics   3   A');
    assert.deepEqual(cells(apart, 'CS 500'), ['Topics', 3, 'A']);
  });
  it('Workday: "Course Listing" opens the code and title column, the grade column before the units may be empty on an in-progress row, and a numeric grade stays one when the numbers after it do not fill their columns', () => {
    const r = doc(
      'Some University',
      'Fall 2024',
      'Course Listing   Grade   Units   Earned   Grade Points',
      'CPSC 540 - Machine Learning   W   3.00   0.00   0.00',
      "CPSC 549 - Master's Thesis   T   12.00   0.00   0.00",
      'CPSC 554K - Topics in Human-Computer Interaction   SD   3.00   0.00   0.00',
      'CPSC 539L - Topics in Programming Languages   3.00   0.00   0.00',
      'CPSC 500 - Fundamentals of Algorithm Design and Analysis   A   3.00   3.00   12.00',
    );
    assert.deepEqual(cells(r, 'CPSC 540'), ['Machine Learning', 3, 'W']);
    assert.deepEqual(cells(r, 'CPSC 549'), ["Master's Thesis", 12, 'T']);
    assert.deepEqual(cells(r, 'CPSC 554K'), ['Topics in Human-Computer Interaction', 3, 'SD']);
    assert.deepEqual(cells(r, 'CPSC 539L'), ['Topics in Programming Languages', 3, undefined], 'three numbers, three numeric columns after the grade: the grade is empty');
    assert.deepEqual(cells(r, 'CPSC 500'), ['Fundamentals of Algorithm Design and Analysis', 3, 'A']);
    const numeric = doc('Some University', 'Fall 2024', 'Course   Title   Grade   Units', 'CS 500   Topics   3.5   3.00', 'CS 501   Seminar   3.00');
    assert.deepEqual(cells(numeric, 'CS 500'), ['Topics', 3, '3.5'], 'two numbers for one numeric column: the first is the grade');
    assert.deepEqual(cells(numeric, 'CS 501'), ['Seminar', 3, undefined], 'one number for one numeric column: the grade is empty');
  });
  it('McMaster: "TM" is the term of the session (1 = fall of its first year, 2 = spring of its second, 3 = summer) and "MEDIAN" is a class statistic with its class size', () => {
    const r = doc(
      'McMASTER UNIVERSITY',
      'FALL/WINTER 2023-2024   Level 4',
      'COURSE   DESCRIPTION   TM   UNITS   GRADE   MEDIAN',
      'CAS 701   Logic and Discrete Mathematics in Software Engineering   1   3   A+   B+ (12)',
      'CAS 791   M.A.Sc. Thesis   2   0   IP',
      'SPRING/SUMMER 2021',
      'COURSE   DESCRIPTION   TM   UNITS   GRADE   MEDIAN',
      'CAS 702   Data Science and Machine Learning   3   3   B   C+ (62)',
      'TM: term in which the course was taken.  MEDIAN: median grade and number of students in the course.',
    );
    assert.deepEqual(cells(r, 'CAS 701'), ['Logic and Discrete Mathematics in Software Engineering', 3, 'A']);
    assert.deepEqual(term(r, 'CAS 701'), ['fall', 2023]);
    assert.deepEqual(cells(r, 'CAS 791'), ['M.A.Sc. Thesis', 0, 'IP']);
    assert.deepEqual(term(r, 'CAS 791'), ['spring', 2024]);
    assert.deepEqual(cells(r, 'CAS 702'), ['Data Science and Machine Learning', 3, 'B']);
    assert.deepEqual(term(r, 'CAS 702'), ['summer', 2021]);
    // The serial number before a code ("No.   Course Code …") is never a term ordinal.
    const serial = doc('Some University', 'Fall 2022', 'No.   Course Code   Course Title   Credits   Grade', '2   CS 500   Topics   3   A');
    assert.deepEqual(term(serial, 'CS 500'), ['fall', 2022]);
  });
  it('Sabanci: LEVEL, SU CREDIT, QUALITY POINT, ECTS CREDIT and REPEAT map — the local credits, not the ECTS, are the row’s', () => {
    const r = doc(
      'SABANCI UNIVERSITY',
      '2019-2020 FALL',
      'COURSE CODE   COURSE TITLE   LEVEL   GRADE   SU CREDIT   QUALITY POINT   ECTS CREDIT   REPEAT',
      'CS 201   Introduction to Computing   UG   A-   3.00   11.10   6.00',
      'AL 102   Academic Literacies   UG   S   0.00   0.00   3.00',
      'MATH 102   Calculus II   UG   B   3.00   9.00   6.00   R',
      'CS 502   Advanced Algorithms   GR   A   3.00   12.00   10.00',
    );
    assert.deepEqual(cells(r, 'CS 201'), ['Introduction to Computing', 3, 'A-']);
    assert.equal(row(r, 'CS 201')?.level, 'undergraduate');
    assert.deepEqual(cells(r, 'AL 102'), ['Academic Literacies', 0, 'S']);
    assert.deepEqual(cells(r, 'MATH 102'), ['Calculus II', 3, 'B']);
    assert.deepEqual(cells(r, 'CS 502'), ['Advanced Algorithms', 3, 'A']);
    assert.equal(row(r, 'CS 502')?.level, 'graduate');
  });
  it('IIT grade card: "Subno" is the code, "L-T-P" a workload cell that holds "3-1-0", "CRD" the credits and "GRD" the grade', () => {
    const r = doc('INDIAN INSTITUTE OF TECHNOLOGY KHARAGPUR', 'Semester Autumn 2022', 'Subno   Name   L-T-P   CRD   GRD', 'CS10001   Programming and Data Structures   3-1-0   4   EX', 'CS19001   Programming and Data Structures Laboratory   0-0-3   2   A');
    assert.deepEqual(cells(r, 'CS 10001'), ['Programming and Data Structures', 4, 'EX']);
    assert.deepEqual(cells(r, 'CS 19001'), ['Programming and Data Structures Laboratory', 2, 'A']);
  });
  it('HEC: "CH" is the credit hours and "GPs" the points, so a withdrawn or incomplete row keeps its credits; "CH" beside a real credits word is the workload', () => {
    const hec = doc('UNIVERSITY OF ENGINEERING AND TECHNOLOGY LAHORE', 'Semester: Spring 2020 (10-02-2020 to 26-06-2020)', 'Course Code   Course Title   CH   Grade   GPs', 'CS-202   Discrete Structures   3   W   -', 'IS-101   Islamic Studies   2   I   -', 'CS-201   Object Oriented Programming   4   B   12.00');
    assert.deepEqual(cells(hec, 'CS 202'), ['Discrete Structures', 3, 'W']);
    assert.deepEqual(cells(hec, 'IS 101'), ['Islamic Studies', 2, 'I']);
    assert.deepEqual(cells(hec, 'CS 201'), ['Object Oriented Programming', 4, 'B']);
    const hours = doc('Universidade Exemplo', 'Período Letivo 2022/1', 'Código   Disciplina   CH   Créditos   Nota', 'MAT 101   Cálculo I   60   4   8.5');
    assert.deepEqual(cells(hours, 'MAT 101'), ['Cálculo I', 4, '8.5']);
  });
  it('SNU: a "Classification" column after a grade column is a course-type cell, not a second grade', () => {
    const r = doc('SEOUL NATIONAL UNIVERSITY', '1st Semester, 2022', 'Course No.   Course Title   Credits   Grade   Classification', 'CS 501   Theory of Computation   3   A0   Major Required', 'CS 502   Research in Computer Science   1   S   Research', 'CS 503   Advanced Algorithms   3   B+   Major Elective');
    assert.deepEqual(cells(r, 'CS 501'), ['Theory of Computation', 3, 'A']);
    assert.deepEqual(cells(r, 'CS 502'), ['Research in Computer Science', 1, 'S']);
    assert.deepEqual(cells(r, 'CS 503'), ['Advanced Algorithms', 3, 'B+']);
  });
  it('Ladok: "Scope" is the credits with its "hp" unit, "Date" an ISO date that places the row, and a one-letter last title word stays in the title', () => {
    const r = doc('LUND UNIVERSITY   Official transcript of records', 'Completed courses', 'Code   Name   Scope   Grade   Date   Note', 'EDAG01   Efficient C   7.5 hp   3   2025-01-14', 'EDAN20   Language Technology   7.5 hp   4   2023-10-27', 'EDAN95   Applied Machine Learning   7.5 hp   G   2024-01-12');
    assert.deepEqual(cells(r, 'EDAG 01'), ['Efficient C', 7.5, '3']);
    assert.deepEqual(term(r, 'EDAG 01'), ['spring', 2025]);
    assert.deepEqual(cells(r, 'EDAN 20'), ['Language Technology', 7.5, '4']);
    assert.deepEqual(term(r, 'EDAN 20'), ['fall', 2023]);
    assert.deepEqual(cells(r, 'EDAN 95'), ['Applied Machine Learning', 7.5, 'G']);
  });
  it('Western: "UNTS", "GRD", "AVG" and "SIZ" map; a Roman numeral ending the title is never the grade, and a statistic is never filled while the credits stay empty', () => {
    const r = doc('THE UNIVERSITY OF WESTERN ONTARIO', 'FALL/WINTER 2019-2020   Year 1', 'COURSE   TITLE   UNTS   GRD   AVG   SIZ', 'ENGSCI 1050   Foundations of Engineering Practice   1.00   78   72   623', 'PHYSICS 1402B   Physics for Engineering Students II   0.50   WDN', 'CALCULUS 1000A   Calculus I   0.50   DEF');
    assert.deepEqual(cells(r, 'ENGSCI 1050'), ['Foundations of Engineering Practice', 1, '78']);
    assert.deepEqual(cells(r, 'PHYSICS 1402B'), ['Physics for Engineering Students II', 0.5, 'WDN']);
    assert.deepEqual(cells(r, 'CALCULUS 1000A'), ['Calculus I', 0.5, 'DEF']);
  });
  it('Marquette / Utah: "CR" after the earned units is the grade Credit, never a unit word', () => {
    const r = doc('Marquette University', 'Spring 2018', 'Course   Description   Attempted   Earned   Grade   Points', 'COSC 6560   Cloud Computing   3.00   3.00   CR   0.000');
    assert.deepEqual(cells(r, 'COSC 6560'), ['Cloud Computing', 3, 'S']);
  });
});

// ——— Transcript accuracy program, Batch B (DGS 2026-10-09): F5 the university, F3 the multi-term mark ———
describe('transcript accuracy program, Batch B — F5 the university and the blocks that never name it (2026-10-09)', () => {
  it('a transfer-credit block names other schools: Evergreen’s "TRANSFER CREDIT:" rows never become the university, and a US address after a dash is not part of the name', () => {
    const r = doc(
      'Record of Academic Achievement',
      'The Evergreen State College - Olympia, Washington 98505',
      'DEGREES CONFERRED:',
      'Bachelor of Science   Awarded 15 Dec 2006',
      'TRANSFER CREDIT:',
      'Start   End   Credits   Title',
      '09/2002   12/2002   5   University of Washington',
      '01/2003   06/2004   85   South Puget Sound Community College',
      'EVERGREEN CREDIT:',
      'Start   End   Credits   Title',
      '09/2004   06/2005   44   Introduction to Natural Science',
    );
    assert.equal(r.university, 'The Evergreen State College');
    assert.equal(r.campusSystem, undefined);
  });
  it('an eScrip-Safe cover: "Official Academic Transcript from X" names X, the receiver block is not the issuer, and the campus resolves through the header’s system name', () => {
    const lines = JSON.parse(readFileSync(new URL('./fixtures/public-transcripts/peoplesoft-escripsafe-wrapped.json', import.meta.url), 'utf8')) as string[];
    const r = parseExternalTranscript(lines);
    assert.equal(r.looksLikeNotreDame, false, 'the recipient block ("Receiver Information" / "To: University of Notre Dame") never redirects the transcript to the Notre Dame row');
    assert.equal(r.university, 'Binghamton University');
    assert.equal(r.campusSystem, 'State University of New York');
    assert.equal(r.campus, 'Binghamton');
  });
  it('a UCLA eTranscript cover: "Recipient: University of Notre Dame" is where the document goes, not who issued it', () => {
    const lines = JSON.parse(readFileSync(new URL('./fixtures/public-transcripts/ucla-etranscript.json', import.meta.url), 'utf8')) as string[];
    const r = parseExternalTranscript(lines);
    assert.equal(r.looksLikeNotreDame, false);
    assert.equal(r.university, 'University of California, Los Angeles');
    // A Notre Dame transcript is still recognised by its own labels.
    const nd = doc('University of Notre Dame', 'Unofficial Academic Transcript', 'Fall 2023', 'CSE 60641   Graduate Operating Systems   3.0   A');
    assert.equal(nd.looksLikeNotreDame, true);
    const recipientOnly = doc('Some University', 'Recipient:   University of Notre Dame   Graduate Admissions', 'Fall 2023', 'CS 500   Topics   3   A');
    assert.equal(recipientOnly.looksLikeNotreDame, false);
  });
  it('a delivery vendor (Parchment, Credentials Solutions, National Student Clearinghouse, eScrip-Safe, GlobalSign) is never the university', () => {
    const r = doc('Parchment Exchange — University Transcript Services', 'Credentials Solutions University Delivery', 'National Student Clearinghouse   Electronic Transcript', 'Fall 2023', 'CS 500   Topics   3   A');
    assert.equal(r.university, undefined);
    const nsc = doc('National Student Clearinghouse   Electronic Transcript', 'Order Number: 000000000   Sent: 10/09/2026', '', 'EXAMPLE STATE UNIVERSITY', 'Office of the Registrar', 'Fall 2023', 'CS 500   Topics   3   A');
    assert.equal(nsc.university, 'EXAMPLE STATE UNIVERSITY');
  });
  it('"From: <college> - N credits", an affiliated-college line and an academic-year label never name the university', () => {
    const r = doc('Some Institute of Technology', 'Affiliated College: Huron University College', 'Année Universitaire :   2022/2023', 'Fall 2023', 'From: Dawson College - 24 credits', 'CS 500   Topics   3   A');
    assert.equal(r.university, 'Some Institute of Technology');
    const fromOnly = doc('Office of the Registrar', 'From: Concordia University - 6 credits', 'Fall 2023', 'CS 500   Topics   3   A');
    assert.equal(fromOnly.university, undefined);
  });
  it('Minerva’s Credits/Exemptions block: its bare rows are skipped and counted like transfer rows, and the first full course row ends it', () => {
    const r = doc(
      'Some University',
      'Subject   Number   Title   Cr. / C.E.U. Grade   Remarks Earned   Class',
      'Avg.',
      'Fall 2024',
      'Credits/Exemptions',
      'From: Dawson College - 24 credits',
      'COMP   202   EXC',
      'MATH   133   EXC',
      'From: Advanced Placement - 7 credits',
      'MATH   140   3',
      'ECON   2XX   3',
      'COMP 250   001 Intro to Computer Science   3   A-   3   B',
      'MATH 141   001 Calculus 2   4   B+   4   B',
      'Winter 2025',
      'Credits/Exemptions',
      'From: Concordia University - 6 credits',
      'TRNS   XXX   6',
      'PHYS   131   EXC',
      'COMP 251   001 Algorithms and Data Structures   3   B   3   B',
    );
    assert.deepEqual(r.courses.map((c) => c.courseId), ['COMP 250', 'MATH 141', 'COMP 251']);
    assert.equal(r.transferRowsSkipped, 4, 'COMP 202, MATH 133, MATH 140, PHYS 131 (TRNS XXX and ECON 2XX are no code)');
    assert.equal(r.university, 'Some University');
  });
  it('F3: Minerva’s multi-term mark after the course number — a private-use diamond or a superscript ² — is dropped before the section number', () => {
    const r = doc('Some University', 'Subject   Number   Title   Cr. / C.E.U. Grade   Remarks Earned   Class', 'Avg.', 'Fall 2025', 'ECSE 458D1    001 Capstone Design Project   3   A   3   B', 'MATH 470J1 ²   001 Honours Research Project   1   A-   1   B', 'RW   FACC 400N1    001 Engineering Professional Practice   1');
    assert.deepEqual(r.courses.map((c) => [c.courseId, c.title, c.credits, c.grade]), [['ECSE 458D1', 'Capstone Design Project', 3, 'A'], ['MATH 470J1', 'Honours Research Project', 1, 'A-'], ['FACC 400N1', 'Engineering Professional Practice', 1, undefined]]);
    // A symbol that is not a mark ("&" is a title connector) leaves the row readable as before.
    const amp = doc('Some University', 'Fall 2025', 'CS 500   & Advanced Topics   3   A');
    assert.deepEqual([row(amp, 'CS 500')?.credits, row(amp, 'CS 500')?.grade], [3, 'A']);
  });

});

// ——— The 2026-10-09 review of F4–F6: the two external.ts findings (the two
// layout.ts findings are pinned in tests/layout.test.ts) ———
describe('transcript accuracy program, Batch B — review of F4–F6 (2026-10-09)', () => {
  const cells = (r: ReturnType<typeof parseExternalTranscript>, id: string) => [row(r, id)?.title, row(r, id)?.credits, row(r, id)?.grade ?? row(r, id)?.rawGrade];
  const term = (r: ReturnType<typeof parseExternalTranscript>, id: string) => [row(r, id)?.season, row(r, id)?.year];
  it('review: a bare number in a term column is McMaster’s ordinal only under "TM"; under "Semester" or "Year" it is consumed and the row keeps its header’s term', () => {
    // TM: the ordinal places the row by McMaster's legend, by design.
    const tm = doc('McMASTER UNIVERSITY', 'FALL/WINTER 2023-2024', 'COURSE   DESCRIPTION   TM   UNITS   GRADE   MEDIAN', 'CAS 701   Logic and Discrete Mathematics   2   3   A+   B+ (12)');
    assert.deepEqual(term(tm, 'CAS 701'), ['spring', 2024]);
    assert.deepEqual(cells(tm, 'CAS 701'), ['Logic and Discrete Mathematics', 3, 'A']); // A+ maps to the app's A, as the McMaster case above pins
    // A continuously numbered Semester column (Nepal, HEC): 1–4 are the
    // document's own numbering, whose calendar it does not give — before the
    // review 2 read spring 2023, 3 summer 2023 and 4 swallowed the title.
    const sem = doc('Some University', 'Academic Year 2022-2023', 'Course Code   Course Title   Credits   Grade   Semester', 'CS 101   Programming   3   A   1', 'CS 102   Data Structures   3   B+   2', 'CS 201   Algorithms   4   A-   3', 'CS 202   Databases   4   B   4');
    for (const id of ['CS 101', 'CS 102', 'CS 201', 'CS 202']) assert.deepEqual(term(sem, id), ['fall', 2022], `${id} keeps the header's term`);
    assert.deepEqual(cells(sem, 'CS 201'), ['Algorithms', 4, 'A-']);
    assert.deepEqual(cells(sem, 'CS 202'), ['Databases', 4, 'B'], 'the trailing 4 is the semester cell, not the title’s');
    // A year-of-study column: the same.
    const year = doc('Some University', 'Session 2022-2023', 'Course Code   Course Title   Credits   Grade   Year', 'CS 1001   Programming   3   A   1', 'CS 2001   Data Structures   3   B+   2', 'CS 3001   Algorithms   4   A-   3');
    for (const id of ['CS 1001', 'CS 2001', 'CS 3001']) assert.deepEqual(term(year, id), ['fall', 2022], `${id} keeps the header's term`);
    assert.deepEqual(cells(year, 'CS 3001'), ['Algorithms', 4, 'A-']);
  });
  it('review: "CH" beside a Portuguese or Spanish header word is the carga horária (hours, never the credits); under an English header a CH value above the credit-hour range is consumed but not read as credits', () => {
    // A histórico that prints only CH and no Créditos column: before the
    // review its 60 and 90 hours read as the credits.
    const hours = doc('Universidade Exemplo', 'Período Letivo 2022/1', 'Código   Disciplina   CH   Nota   Situação', 'DCC 001   Programação de Computadores   60   85   AP', 'MAT 001   Cálculo I   90   72   AP');
    assert.deepEqual(cells(hours, 'DCC 001'), ['Programação de Computadores', undefined, '85']);
    assert.deepEqual(cells(hours, 'MAT 001'), ['Cálculo I', undefined, '72']);
    const conceito = doc('Universidade Exemplo', '1º Semestre 2022', 'Código   Disciplina   CH   Conceito   Situação', 'DCC 001   Programação de Computadores   60   A   AP');
    assert.deepEqual(cells(conceito, 'DCC 001'), ['Programação de Computadores', undefined, 'A']);
    assert.deepEqual(term(conceito, 'DCC 001'), ['spring', 2022]);
    // HEC's English header keeps CH as the credit hours (pinned above); a 45
    // under it is no credit count — the row reads, its credits blank.
    const hec = doc('UNIVERSITY OF ENGINEERING AND TECHNOLOGY LAHORE', 'Semester: Spring 2020 (10-02-2020 to 26-06-2020)', 'Course Code   Course Title   CH   Grade   GPs', 'CS-201   Object Oriented Programming   4   B   12.00', 'CS-301   Software Engineering   45   B   12.00');
    assert.deepEqual(cells(hec, 'CS 201'), ['Object Oriented Programming', 4, 'B']);
    assert.deepEqual(cells(hec, 'CS 301'), ['Software Engineering', undefined, 'B']);
  });
});

// ——— Batch C (DGS 2026-10-09): the text-side answers ———
describe('transcript accuracy program, Batch C — CC15 code-less rows (2026-10-09)', () => {
  const titled = (r: ReturnType<typeof parseExternalTranscript>, title: string) => r.courses.find((c) => c.title === title);
  const read = (r: ReturnType<typeof parseExternalTranscript>, title: string) => {
    const c = titled(r, title);
    return c ? [c.courseId, c.codeMissing, c.credits, c.grade ?? c.rawGrade, c.season, c.year] : undefined;
  };
  it('under a header with a title column and no code column, a line whose cells line up with it is a course with an EMPTY id', () => {
    const r = doc('NANKAI UNIVERSITY', 'COURSE NAME   CREDIT   RESULT   COURSE TYPE', '2021-2022 Academic Year   First Semester', 'Machine Learning   3   88   Elective', 'Dialectics of Nature   1   PASSED   Compulsory', '2021-2022 Academic Year   Second Semester', 'Data Mining   3   B   Degree Course');
    assert.deepEqual(read(r, 'Machine Learning'), ['', true, 3, '88', 'fall', 2021]);
    assert.deepEqual(read(r, 'Dialectics of Nature'), ['', true, 1, 'S', 'fall', 2021]);
    assert.deepEqual(read(r, 'Data Mining'), ['', true, 3, 'B', 'spring', 2022]);
    assert.equal(r.courses.length, 3);
  });
  it('a line that does not line up with the header one cell for one is no row: totals, label/value lines, fewer cells, a title that is a label', () => {
    const r = doc('NANKAI UNIVERSITY', 'COURSE NAME   CREDIT   RESULT   COURSE TYPE', '2021-2022 Academic Year   First Semester', 'Machine Learning   3   88   Elective', 'TOTAL CREDITS: 18   AVERAGE SCORE: 88.75', 'Semester Totals   15   3.50   Compulsory', 'Data Structures and Algorithms   79', 'Weighted Average Score   86   88   Overall', 'Bachelor Degree Tests');
    assert.deepEqual(r.courses.map((c) => c.title), ['Machine Learning']);
  });
  it('a code-less line is never read without a header naming a title and no code column', () => {
    assert.equal(doc('NANKAI UNIVERSITY', '2021-2022 Academic Year   First Semester', 'Machine Learning   3   88   Elective').courses.length, 0);
    // A header WITH a code column: the code-less line is not a course.
    assert.equal(doc('Some University', 'Fall 2023', 'Course Code   Course Title   Credits   Grade', 'Machine Learning   3   A   Elective').courses.length, 0);
  });
  it('a document that prints a course number on any row keeps no code-less row', () => {
    const r = doc('Some University', 'Course Title   Credits   Grade', 'Fall 2023', 'CS 500   Advanced Topics   3   A', 'Graduate Seminar   1   S');
    assert.deepEqual(r.courses.map((c) => c.courseId), ['CS 500']);
  });
  it('the CHESICC report: an academic year and its semester number before the title place the row (1 → fall, 2 → spring of the second year)', () => {
    const r = doc('Institution:   Zhejiang University', 'Academic Year   Semester   Course Name   Credit   Score   Course Type', '2018-2019   1   Advanced Mathematics I   5.0   92   Compulsory', '2018-2019   2   Data Structures   4.0   Pass   Compulsory', '2021-2022   2   Graduation Project   8.0   Good   Compulsory', '2019-2020   3   Summer Practice   2.0   85   Elective');
    assert.deepEqual(read(r, 'Advanced Mathematics I'), ['', true, 5, '92', 'fall', 2018]);
    assert.deepEqual(read(r, 'Data Structures'), ['', true, 4, 'S', 'spring', 2019]);
    assert.deepEqual(read(r, 'Graduation Project'), ['', true, 8, 'Good', 'spring', 2022]);
    // A third number names no term the parser can place: the row is read, its term left blank.
    assert.deepEqual(read(r, 'Summer Practice'), ['', true, 2, '85', undefined, undefined]);
  });
  it('Cairo: under a "Full Mark" column the grade word is the result, not the marks obtained; a legend that bands "Pass 60-64%" leaves Pass and Fail raw', () => {
    const base = ['CAIRO UNIVERSITY', 'Academic Year 2019/2020   First Year', 'Subject   Full Mark   Marks Obtained   Grade', 'Data Structures and Algorithms   150   118   Very Good', 'Logic Design   100   64   Pass', 'Electronics   100   55   Fail', 'Total   1000   705   Good'];
    const banded = doc(...base, 'Grades: Excellent 85-100%, Very Good 75-84%, Good 65-74%, Pass 60-64%, Fail below 60%.');
    assert.deepEqual(read(banded, 'Data Structures and Algorithms'), ['', true, undefined, 'Very Good', 'fall', 2019]);
    assert.deepEqual(read(banded, 'Logic Design'), ['', true, undefined, 'Pass', 'fall', 2019]);
    assert.deepEqual(read(banded, 'Electronics'), ['', true, undefined, 'Fail', 'fall', 2019]);
    assert.equal(titled(banded, 'Total'), undefined);
    // Without the banded legend a pass is the app's S, a fail its U.
    const plain = doc(...base);
    assert.equal(titled(plain, 'Logic Design')?.grade, 'S');
    assert.equal(titled(plain, 'Electronics')?.grade, 'U');
    // A coded row under the same header reads its grade word too (the
    // full-mark rule is the header's, not the code-less reader's).
    const coded = doc('CAIRO UNIVERSITY', 'Academic Year 2019/2020', 'Code   Subject   Full Mark   Marks Obtained   Grade', 'CMP 201   Data Structures   150   118   Very Good');
    assert.equal(row(coded, 'CMP 201')?.rawGrade, 'Very Good');
  });
  it('Evergreen: the lines under a program line are its courses only when their credits add up to the program’s', () => {
    const lines = ['Record of Academic Achievement', 'The Evergreen State College - Olympia, Washington 98505', 'EVERGREEN CREDIT:', 'Start   End   Credits   Title', '09/2004   06/2005   20   Introduction to Natural Science', '13 - General Chemistry with Laboratory', '*4 - Precalculus', '3 - History and Philosophy of Science'];
    const r = doc(...lines);
    assert.deepEqual(r.courses.map((c) => [c.courseId, c.codeMissing, c.title, c.credits, c.grade ?? c.rawGrade, c.season, c.year]), [
      ['', true, 'General Chemistry with Laboratory', 13, undefined, 'fall', 2004],
      ['', true, 'Precalculus', 4, undefined, 'fall', 2004],
      ['', true, 'History and Philosophy of Science', 3, undefined, 'fall', 2004],
    ]);
    // 13 + 4 + 2 is not 20: nothing says these lines are the program's breakdown.
    assert.equal(doc(...lines.slice(0, -1), '2 - History and Philosophy of Science').courses.length, 0);
  });
  it('code-less rows under a transfer heading are skipped and counted; the institution’s own CREDIT heading ends the block', () => {
    const r = doc('Record of Academic Achievement', 'The Evergreen State College - Olympia, Washington 98505', 'TRANSFER CREDIT:', '09/2002   12/2002   5   Transfer Studies', '3 - Composition', '2 - Speech', 'EVERGREEN CREDIT:', '09/2004   06/2005   4   Precalculus Program', '4 - Precalculus');
    assert.deepEqual(r.courses.map((c) => c.title), ['Precalculus']);
    assert.equal(r.transferRowsSkipped, 2);
  });
});

describe('transcript accuracy program, Batch C — CC16 side-by-side semesters (2026-10-09)', () => {
  const terms = (r: ReturnType<typeof parseExternalTranscript>) => r.courses.map((c) => `${c.title} | ${c.credits} | ${c.grade ?? c.rawGrade} | ${c.season ?? ''} ${c.year ?? ''}`);
  it('a header printing one group twice splits each row at the second group: the left half under the first semester, the right under the second', () => {
    const r = doc('SOME UNIVERSITY', '2018-2019 Academic Year', 'First Semester   Second Semester', 'Course   Credits   Score   Course   Credits   Score', 'College English   4   86   Data Structures and Algorithms   4   90', 'Discrete Mathematics   3   79   Computer Network   4   86');
    assert.deepEqual(terms(r), ['College English | 4 | 86 | fall 2018', 'Data Structures and Algorithms | 4 | 90 | spring 2019', 'Discrete Mathematics | 3 | 79 | fall 2018', 'Computer Network | 4 | 86 | spring 2019']);
    for (const c of r.courses) assert.equal(c.codeMissing, true);
  });
  it('a line with ONE group’s cells is a course of either column — the text cannot say which — so its term is left blank', () => {
    const r = doc('SOME UNIVERSITY', '2018-2019 Academic Year', 'First Semester   Second Semester', 'Course   Credits   Score   Course   Credits   Score', 'College English   4   86   Data Structures and Algorithms   4   90', 'PC Software   3   85');
    assert.deepEqual(terms(r), ['College English | 4 | 86 | fall 2018', 'Data Structures and Algorithms | 4 | 90 | spring 2019', 'PC Software | 3 | 85 |  ']);
  });
  it('semesters the parser cannot place leave both halves’ terms blank: no semester line, or a single-year academic year with no calendar for it', () => {
    const none = doc('SOME UNIVERSITY', 'Course   Credits   Score   Course   Credits   Score', 'College English   4   86   Data Structures and Algorithms   4   90');
    assert.deepEqual(terms(none), ['College English | 4 | 86 |  ', 'Data Structures and Algorithms | 4 | 90 |  ']);
    // "2001 Academic Year   1st Semester" is the fall in China and the
    // spring in Korea and Japan: without a country calendar, nothing places it.
    const single = doc('SOME UNIVERSITY', '2001 Academic Year', '1st Semester   2nd Semester', 'Course   Credits   Score   Course   Credits   Score', 'College English   4   86   Data Structures and Algorithms   4   90');
    assert.deepEqual(terms(single), ['College English | 4 | 86 |  ', 'Data Structures and Algorithms | 4 | 90 |  ']);
  });
  it('a header whose two halves differ is one table, read as before: one row per line', () => {
    const r = doc('SOME UNIVERSITY', '2018-2019 Academic Year', 'Course   Credits   Score   Remarks   Hours   Grade', 'College English   4   86   Data Structures   4   90');
    assert.deepEqual(r.courses.map((c) => c.title), ['College English']);
  });
});

describe('transcript accuracy program, Batch C — TH02 country calendars (2026-10-09)', () => {
  const termOf = (r: ReturnType<typeof parseExternalTranscript>, id: string) => [row(r, id)?.season, row(r, id)?.year];
  const thai = ['CHULALONGKORN UNIVERSITY', 'OFFICE OF THE REGISTRAR   Bangkok, Thailand', 'TRANSCRIPT OF RECORDS'];
  const terms = ['First Semester 2022', 'Course No.   Course Title   Credits   Grade', '2110501   Computer Architecture   3   A', 'Second Semester 2022', '2110521   Machine Learning   3   A', 'First Semester 2023', '2110620   Special Topics   3   W'];
  it('Thailand: "First Semester 2022" is August–December (the fall), the second semester the spring of the next year', () => {
    const r = doc(...thai, ...terms);
    assert.deepEqual(termOf(r, '2110501'), ['fall', 2022]);
    assert.deepEqual(termOf(r, '2110521'), ['spring', 2023]);
    assert.deepEqual(termOf(r, '2110620'), ['fall', 2023]);
  });
  it('without the country named in a header cell the calendar-order rule stands; a course title naming it is no evidence', () => {
    const plain = doc('CHULALONGKORN UNIVERSITY', 'TRANSCRIPT OF RECORDS', ...terms);
    assert.deepEqual(termOf(plain, '2110501'), ['spring', 2022]);
    assert.deepEqual(termOf(plain, '2110521'), ['fall', 2022]);
    const title = doc('SOME UNIVERSITY', 'TRANSCRIPT OF RECORDS', 'Course No.   Course Title   Credits   Grade', 'First Semester 2022', 'HIST 101   History of Thailand   3   A');
    assert.deepEqual(termOf(title, 'HIST 101'), ['spring', 2022]);
  });
  it('a transcript that prints a term’s month range is read by its own months, never by the table', () => {
    const r = doc(...thai, 'First Semester 2022 (Jun - Oct 2022)', 'Course No.   Course Title   Credits   Grade', '2110501   Computer Architecture   3   A', 'Second Semester 2022', '2110521   Machine Learning   3   A');
    assert.deepEqual(termOf(r, '2110501'), ['fall', 2022]);
    assert.deepEqual(termOf(r, '2110521'), ['fall', 2022], 'the calendar-order rule, not the table');
  });
  it('review fix 2026-10-10: the country must be the INSTITUTION’s — a student’s nationality or address is no evidence', () => {
    // SNU prints "Seoul 08826, Republic of Korea" under its name; a Thai
    // student's nationality below it must not move Korea's semesters.
    const snu = JSON.parse(readFileSync(new URL('./fixtures/public-transcripts/snu-english-transcript.json', import.meta.url), 'utf8')) as string[];
    const placed = (lines: string[]) => parseExternalTranscript(lines).courses.map((c) => `${c.courseId} ${c.season} ${c.year}`);
    assert.deepEqual(placed([...snu.slice(0, 4), 'Nationality   Thailand', ...snu.slice(4)]), placed(snu));
    const korea = ['KOREA UNIVERSITY', 'Seoul 02841, Republic of Korea', 'ACADEMIC TRANSCRIPT', 'Name:   SAMPLE STUDENT   Student ID:   0000'];
    const rows = ['2022 1st Semester', 'Course No.   Course Title   Credits   Grade', 'COSE 501   Advanced Algorithms   3   A', '2022 2nd Semester', 'COSE 502   Machine Learning   3   A'];
    const korean = (...extra: string[]) => [termOf(doc(...korea, ...extra, ...rows), 'COSE 501'), termOf(doc(...korea, ...extra, ...rows), 'COSE 502')];
    const calendarOrder = [['spring', 2022], ['fall', 2022]];
    assert.deepEqual(korean(), calendarOrder);
    assert.deepEqual(korean('Nationality   Thailand'), calendarOrder);
    assert.deepEqual(korean('Address   99 Sukhumvit Road   Bangkok, Thailand'), calendarOrder);
    assert.deepEqual(korean('Citizenship:   Thailand'), calendarOrder);
    // A person's field right under the institution's name ends its heading there.
    const under = doc('KOREA UNIVERSITY', 'Nationality   Thailand', 'Seoul 02841, Republic of Korea', ...rows);
    assert.deepEqual([termOf(under, 'COSE 501'), termOf(under, 'COSE 502')], calendarOrder);
    // A mailing block printed ABOVE the institution's name is never its heading.
    const mailing = doc('SAMPLE STUDENT', '99 Sukhumvit Road', 'Bangkok 10110, Thailand', 'KOREA UNIVERSITY', 'Seoul 02841, Republic of Korea', ...rows);
    assert.deepEqual([termOf(mailing, 'COSE 501'), termOf(mailing, 'COSE 502')], calendarOrder);
    // The institution's own heading still names it: on the line under the name, or on its own line.
    assert.deepEqual(termOf(doc('MAHIDOL UNIVERSITY', 'Nakhon Pathom 73170', 'THAILAND', 'TRANSCRIPT OF RECORDS', 'First Semester 2022', 'Course No.   Course Title   Credits   Grade', 'EGCO 503   Data Mining   3   A'), 'EGCO 503'), ['fall', 2022]);
    assert.deepEqual(termOf(doc('MAHIDOL UNIVERSITY', 'TRANSCRIPT OF RECORDS', 'Name:   SAMPLE STUDENT', 'THAILAND', 'First Semester 2022', 'Course No.   Course Title   Credits   Grade', 'EGCO 503   Data Mining   3   A'), 'EGCO 503'), ['spring', 2022], 'a country after a field line is not the heading');
  });
  it('a single-year academic year is placed by the country calendar: side-by-side columns and a lone semester line', () => {
    const cols = doc(...thai, '2022 Academic Year', '1st Semester   2nd Semester', 'Course   Credits   Score   Course   Credits   Score', 'Computer Architecture   3   A   Machine Learning   3   B+');
    assert.deepEqual(cols.courses.map((c) => [c.title, c.season, c.year]), [['Computer Architecture', 'fall', 2022], ['Machine Learning', 'spring', 2023]]);
    const lone = doc(...thai, '2022 Academic Year', '1st Semester', 'Course   Credits   Score', 'Computer Architecture   3   A');
    assert.deepEqual(lone.courses.map((c) => [c.title, c.season, c.year]), [['Computer Architecture', 'fall', 2022]]);
  });
});

describe('transcript accuracy program, Batch C — adjacent-line graduate conferral (2026-10-09)', () => {
  const head = ['CHULALONGKORN UNIVERSITY', 'OFFICE OF THE REGISTRAR   Bangkok, Thailand', 'TRANSCRIPT OF RECORDS'];
  const rows = ['First Semester 2022', 'Course No.   Course Title   Credits   Grade', '2110501   Computer Architecture   3   A'];
  const conferred = (...lines: string[]) => doc(...head, ...lines, ...rows).degreeConferred ?? null;
  it('"Degree: Master of …" with "Date of Graduation: <date>" on the next line — or the line above — is a graduate conferral', () => {
    assert.equal(conferred('Degree: Master of Engineering', 'Date of Admission: August 2022   Date of Graduation: 30 June 2024'), true);
    assert.equal(conferred('Date of Graduation:   30 June 2024', 'Degree:   Master of Engineering'), true);
    assert.equal(conferred('Degree: M.Eng. in Computer Engineering', 'Date of Graduation: June 2024'), true);
  });
  it('both labels are required, on ADJACENT lines, with a date that reads; a bachelor’s or a forecast is none', () => {
    assert.equal(conferred('Program: Master of Engineering', 'Date of Graduation: 30 June 2024'), null, 'no "Degree:" label');
    assert.equal(conferred('Degree: Master of Engineering', 'Date of Admission: August 2022'), null, 'no "Date of Graduation:" label');
    assert.equal(conferred('Degree: Master of Engineering', 'Faculty: Engineering', 'Date of Graduation: 30 June 2024'), null, 'two lines apart');
    assert.equal(conferred('Degree: Master of Engineering', 'Date of Graduation: —'), null, 'no date');
    assert.equal(conferred('Degree: Master of Engineering', 'Expected Date of Graduation: 30 June 2027'), null, 'a forecast');
    assert.equal(conferred('Degree: Bachelor of Engineering', 'Date of Graduation: 30 June 2024'), null, 'a bachelor’s is not a graduate conferral');
    assert.equal(conferred('Degree: Master of Engineering (in progress)', 'Date of Graduation: 30 June 2024'), null, 'a status that says not yet');
  });
  it('review fix 2026-10-10: an EMPTY "Date of Graduation:" never borrows the next label’s date, and a status before a date is no conferral', () => {
    const degree = 'Degree:   Master of Science in Engineering';
    assert.equal(conferred('Date of Graduation:   Date of Issue: 15 March 2024', degree), null, 'the issue date');
    assert.equal(conferred('Date of Graduation:   Date of Admission: 2 March 2022', degree), null, 'the admission date');
    assert.equal(conferred(degree, 'Date of Graduation:   Date of Issue:   15 March 2024'), null, 'the label alone in its cell, the issue label after it');
    assert.equal(conferred('Date of Graduation:   Withdrawn 2023-06-30', degree), null, 'a withdrawal');
    assert.equal(conferred('Date of Graduation:   Expected February 2025', degree), null);
    assert.equal(conferred('Date of Graduation:   Pending (2025-02-26)', degree), null);
    // The date in the next cell, or in the label's own, still reads.
    assert.equal(conferred('Date of Graduation:   2024-02-26', degree), true);
    assert.equal(conferred(degree, 'Date of Graduation:   February 26, 2024'), true);
    assert.equal(conferred(degree, 'Date of Graduation: 30 June 2024'), true);
  });
});

describe('item 14 follow-up — one-digit course numbers on a scan (item 13’s full-ladder check, 2026-10-11)', () => {
  const ucla = JSON.parse(readFileSync(new URL('./fixtures/public-transcripts/ucla-etranscript.json', import.meta.url), 'utf8')) as string[];
  const sure = (lines: string[]) => lines.map(() => 95);

  it('UCLA’s one-digit rows read on a text layer and on a scan alike — each has its credits and a grade', () => {
    const text = parseExternalTranscript(ucla).courses.map((c) => c.courseId);
    const scan = parseExternalTranscript(ucla, sure(ucla)).courses.map((c) => c.courseId);
    for (const id of ['PHYSICS 1A', 'ENGCOMP 3']) {
      assert.ok(text.includes(id), `text layer: ${id}`);
      assert.ok(scan.includes(id), `scan: ${id}`);
    }
  });

  it('on a scan, a one-digit code without its credits and a grade is no row (a grade key, a legend line)', () => {
    const doc = [
      'Example State University',
      'Office of the Registrar',
      'Official Transcript',
      'Fall 2023',
      'CS 50100   Advanced Algorithms   3.0   A',
      'LP 2S   Low Pass   D',
      'RE 1   Course Delivery Code Lecture Seminar Experiment   9',
      'This document lists the courses taken by the student at the university and is issued by the registrar.',
    ];
    assert.deepEqual(parseExternalTranscript(doc, sure(doc)).courses.map((c) => c.courseId), ['CS 50100']);
  });
});
