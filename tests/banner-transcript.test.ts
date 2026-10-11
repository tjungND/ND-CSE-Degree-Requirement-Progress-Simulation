// Banner-style official transcripts (2026-09-05): what `pdfToLines` yields for
// tests/fixtures/banner-transcript.pdf after column splitting — the invented
// two-column layout copied from a real registrar PDF (see
// make-transcript-pdfs.mjs). Locks the parser behaviour that PDF surfaced:
// split SUBJ / NO. cells, the points column, the transfer-credit block, zero
// credits, "&" in titles, the institution named only on the legend page, and
// — the bug that started it — an nd.edu e-mail that is NOT a Notre Dame marker.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseExternalTranscript } from '../src/transcript/external.ts';
import { looksLikeNotreDameTranscript } from '../src/transcript/nd-markers.ts';
import { parseTranscript } from '../src/transcript/parse.ts';

export const BANNER_LINES = [
  'SSN: ***-**-0000 CWID 00000000 Date of Birth: 01-JAN Date Issued: 01-SEP-2026',
  'OFFI Official Transcript',
  'Record of: Jane Q. Student',
  'Issued To: Jane Q. Student',
  'STUDENT@ND.EDU',
  'Course Level: Graduate',
  'Matriculated: Fall 2019',
  'Program : Doctor of Philosophy',
  'College : College of Science',
  'Major : Computer Science',
  'Degree Awarded Doctor of Philosophy 15-MAY-2024',
  'SUBJ NO.   COURSE TITLE   CRED GRD   PTS R',
  '_____________________________________________________________',
  'TRANSFER CREDIT ACCEPTED BY THE INSTITUTION:',
  '. CS Dept Pre-Req Equivlnts',
  'CS   401   Intro to Advanced Studies I   0.00   TR',
  'CS   450   Operating Systems   0.00   TR',
  'Ehrs: 0.00 GPA-Hrs: 0.00 QPts: 0.00 GPA: 0.00',
  'INSTITUTION CREDIT:',
  'Fall 2019',
  'College of Science',
  'Computer Science',
  'CS   430   Introduction Algorithms   3.00   A   12.00',
  'CS   536   Science of Programming   3.00   A   12.00',
  'HUM   601   TA Seminar   0.00   S   0.00',
  'Ehrs: 6.00 GPA-Hrs: 6.00 QPts: 24.00 GPA: 4.00',
  'Good Standing',
  'Spring 2020',
  'College of Science',
  'Computer Science',
  'CS   535   Dsgn and Anlys of Algorithms   3.00   A   12.00',
  'CS   550   Advnc Operating Syst   3.00   B+   9.99',
  'Ehrs: 6.00 GPA-Hrs: 6.00 QPts: 21.99 GPA: 3.67',
  'Good Standing',
  '******************** CONTINUED ON NEXT COLUMN *******************',
  'Institution Information continued:',
  'Fall 2020',
  'College of Science',
  'Computer Science',
  'CS   553   Cloud Computing   3.00   A   12.00',
  'CS   597   Reading and Special Problems   3.00   A   12.00',
  'Ehrs: 6.00 GPA-Hrs: 6.00 QPts: 24.00 GPA: 4.00',
  'Good Standing',
  'Spring 2021',
  'College of Science',
  'Computer Science',
  'CS   595   Econ & Priv Issues in Big Data   3.00   A   12.00',
  'CS   691   Research and Thesis Ph.D.   4.00   S   0.00',
  'Ehrs: 7.00 GPA-Hrs: 3.00 QPts: 12.00 GPA: 4.00',
  'Good Standing',
  'Summer 2021',
  'College of Science',
  'Computer Science',
  'INTR   010   Summer Internship   0.00   NG   0.00',
  'Ehrs: 0.00 GPA-Hrs: 0.00 QPts: 0.00 GPA: 0.00',
  'Good Standing',
  '********************** TRANSCRIPT TOTALS ***********************',
  'TOTAL INSTITUTION 25.00 21.00 81.99 3.90',
  '********************** END OF TRANSCRIPT ***********************',
  '',
  'Example Institute of Technology   This record is intended only for the specified',
  'Office of the Registrar   recipient and may not be released to any third party.',
  'Springfield, IL 60000',
  'registrar@example.edu',
  'HISTORY',
  'Example Institute of Technology, also known as Example Tech, is a private, non-profit, Ph.D. granting research university founded in 1890.',
  'UNIT OF CREDIT: All courses are taught in English and academic credit is recorded as semester hours, as defined by the standard Carnegie Unit.',
  '',
];

describe('Banner two-column official transcript (external parser)', () => {
  const r = parseExternalTranscript(BANNER_LINES);

  it('is not mistaken for a Notre Dame transcript because of an nd.edu e-mail', () => {
    assert.equal(r.looksLikeNotreDame, false);
    assert.equal(r.hasTextLayer, true);
  });

  it('reads every institution-credit row, with split SUBJ / NO. cells joined into the code', () => {
    assert.deepEqual(
      r.courses.map((c) => c.courseId),
      ['CS 430', 'CS 536', 'HUM 601', 'CS 535', 'CS 550', 'CS 553', 'CS 597', 'CS 595', 'CS 691', 'INTR 010'],
    );
  });

  it('takes credits from the CRED column and the grade from GRD — never the points column', () => {
    const byId = new Map(r.courses.map((c) => [c.courseId, c]));
    assert.equal(byId.get('CS 430')?.credits, 3);
    assert.equal(byId.get('CS 430')?.grade, 'A');
    assert.equal(byId.get('CS 430')?.rawGrade, undefined);
    assert.equal(byId.get('CS 550')?.grade, 'B+');
    assert.equal(byId.get('CS 691')?.credits, 4);
    assert.equal(byId.get('CS 691')?.grade, 'S');
  });

  it('keeps zero-credit rows (seminars, internships) with credits 0, unmapped grades raw', () => {
    const byId = new Map(r.courses.map((c) => [c.courseId, c]));
    assert.equal(byId.get('HUM 601')?.credits, 0);
    assert.equal(byId.get('HUM 601')?.grade, 'S');
    assert.equal(byId.get('INTR 010')?.credits, 0);
    assert.equal(byId.get('INTR 010')?.grade, undefined);
    assert.equal(byId.get('INTR 010')?.rawGrade, 'NG');
  });

  it('skips and counts the "TRANSFER CREDIT ACCEPTED BY THE INSTITUTION" block', () => {
    assert.equal(r.transferRowsSkipped, 2);
    assert.ok(!r.courses.some((c) => c.courseId === 'CS 401' || c.courseId === 'CS 450'));
  });

  it('assigns each row the year AND season of its own column\'s term header', () => {
    assert.deepEqual(
      r.courses.map((c) => c.year),
      [2019, 2019, 2019, 2020, 2020, 2020, 2020, 2021, 2021, 2021],
    );
    assert.deepEqual(
      r.courses.map((c) => c.season),
      ['fall', 'fall', 'fall', 'spring', 'spring', 'fall', 'fall', 'spring', 'spring', 'summer'],
    );
  });

  it('keeps "&" inside a title', () => {
    assert.equal(r.courses.find((c) => c.courseId === 'CS 595')?.title, 'Econ & Priv Issues in Big Data');
  });

  it('names the institution from the legend page, not the "College :" field', () => {
    assert.equal(r.university, 'Example Institute of Technology');
    assert.equal(r.degreeConferred, true);
  });
});

describe('Notre Dame markers (shared by both parsers)', () => {
  it('an nd.edu e-mail address is not a marker; a "Notre Dame, IN" address is not either', () => {
    assert.equal(looksLikeNotreDameTranscript('Record of: Jane Q. Student\nJSTUDENT@ND.EDU\nIllinois Institute of Technology'), false);
    assert.equal(looksLikeNotreDameTranscript('Jane Q. Student\n123 Main St\nNotre Dame, IN 46556\nPurdue University'), false);
  });

  it('the university name, the running-totals label and an insideND URL are markers', () => {
    assert.equal(looksLikeNotreDameTranscript('University of Notre Dame\nUnofficial Academic Transcript'), true);
    assert.equal(looksLikeNotreDameTranscript('NOTRE DAME Ehrs: 72.000 QPts: 106.000'), true);
    assert.equal(looksLikeNotreDameTranscript('https://inside.nd.edu/task/all/academic-transcript'), true);
    assert.equal(looksLikeNotreDameTranscript('University of Notre Dame, Notre Dame, IN 46556'), true);
  });

  it('a Notre Dame named after the first course line, or in a transfer-credit block, is not a marker (review of Option 1, item 14; DGS 2026-10-08: option (b))', () => {
    assert.equal(looksLikeNotreDameTranscript('Purdue University\nOfficial Transcript\nCS 18000 Problem Solving A 4.00\nTransfer Credit from University of Notre Dame\nCSE 30151 Theory of Computing B 3.00'), false, 'after the first course line');
    assert.equal(looksLikeNotreDameTranscript('Purdue University\nTRANSFER CREDIT ACCEPTED BY THE INSTITUTION\nUniversity of Notre Dame\nCSE 30151 Theory of Computing TA 3.00\nCS 18000 Problem Solving A 4.00'), false, 'under a transfer heading in the header');
    assert.equal(looksLikeNotreDameTranscript('University of Notre Dame\nUnofficial Academic Transcript\nCSE 60641 Operating Systems A 3.00'), true, 'the issuer, in the header');
  });

  it('the ND parser rejects another university\'s transcript that carries an nd.edu e-mail', () => {
    assert.equal(parseTranscript(BANNER_LINES).isNotreDame, false);
  });
});
