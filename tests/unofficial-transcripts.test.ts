// The unofficial-transcript warning in the three generated emails (DGS
// 2026-10-03, P1-transfer-eligibility-16): §5.2 adds transfer credit only on an
// official transcript, so when an imported external transcript was marked
// "unofficial" the review request (DGS/ADGS), the advisor summary and the Grad
// Admin request all say which transcripts — bachelor's, master's, prior Ph.D. —
// were unofficial copies. The flag lives on the imported rows
// (`fromUnofficialTranscript`), so removing a transcript removes its warning.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { audit } from '../src/engine/audit.ts';
import type { CourseEntry, Student } from '../src/engine/types.ts';
import { buildCombinedReviewRequest } from '../src/ui/review-request.ts';
import { advisorSummary } from '../src/ui/advisor-summary.ts';
import { unofficialTranscriptNote, unofficialTranscriptSlots } from '../src/ui/email-html.ts';
import { unofficialSlotNote, unofficialWarning } from '../src/ui/external-upload.ts';
import { gradAdminRequest } from '../src/ui/grad-admin-request.ts';
import { buildRules } from './helpers.ts';

const row = (courseId: string, degreeLevel: CourseEntry['degreeLevel'], unofficial: boolean): CourseEntry => ({
  courseId,
  credits: 3,
  term: { season: 'fall', year: 2024 },
  grade: 'A',
  origin: 'transfer',
  institution: 'Purdue University',
  degreeLevel,
  ...(unofficial ? { fromUnofficialTranscript: true as const } : {}),
});

describe('unofficialTranscriptNote — worded for its reader (DGS 2026-10-16)', () => {
  it('is empty when no imported row was flagged', () => {
    for (const audience of ['review', 'gradAdmin', 'advisor'] as const) {
      assert.equal(unofficialTranscriptNote([row('CS 50300', 'masters', false)], audience), '');
      assert.equal(unofficialTranscriptNote([], audience), '');
    }
  });
  // “An unofficial transcript will not be accepted for official processing. It
  // will be accepted for informal review only (by ADGS or DGS).”
  it('the DGS or ADGS: for an informal review; the Grad Admin: not for official processing; the advisor: both', () => {
    const one = [row('CS 50300', 'masters', true), row('CS 24000', 'bachelors', false)];
    assert.equal(
      unofficialTranscriptNote(one, 'review'),
      'Note: the master’s transcript I imported into the self-check is an unofficial copy, for your informal review — I understand it will not be accepted for official processing; the university’s registrar will send the official transcript directly to the Graduate School.',
    );
    assert.equal(
      unofficialTranscriptNote(one, 'gradAdmin'),
      'Note: the master’s transcript I imported into the self-check is an unofficial copy — not for official processing; the transfer credit from it can be processed only once the university’s registrar has sent the official transcript directly to the Graduate School (§5.2).',
    );
    assert.equal(
      unofficialTranscriptNote(one, 'advisor'),
      'Note: the master’s transcript I imported into the self-check is an unofficial copy — accepted for the DGS’s informal review only, not for official processing, until the university’s registrar sends the official transcript directly to the Graduate School (§5.2).',
    );
    assert.match(unofficialTranscriptNote(one, 'advisor', 'ADGS'), /accepted for the ADGS’s informal review only/);
    // The 2026-10-03 note asked for an official transcript before any review.
    for (const audience of ['review', 'gradAdmin', 'advisor'] as const) assert.doesNotMatch(unofficialTranscriptNote(one, audience), /required before|can be reviewed/);
  });
  it('lists several, in bachelor’s / master’s / prior Ph.D. order', () => {
    const several = [row('CS 59000', 'phd', true), row('CS 24000', 'bachelors', true), row('CS 50300', 'masters', true)];
    assert.match(unofficialTranscriptNote(several, 'review'), /^Note: the bachelor’s, master’s and prior Ph\.D\. transcripts I imported into the self-check are unofficial copies, for your informal review — I understand they will not be accepted for official processing; each university’s registrar will send/);
    assert.match(unofficialTranscriptNote(several, 'gradAdmin'), /the transfer credit from them can be processed only once each university’s registrar has sent/);
    assert.deepEqual(unofficialTranscriptSlots(several), { list: 'bachelor’s, master’s and prior Ph.D.', one: false });
  });
  it('a hand-entered transfer row (no degree level) counts as the master’s transcript', () => {
    assert.match(unofficialTranscriptNote([{ ...row('CS 50300', undefined, true) }], 'review'), /^Note: the master’s transcript/);
  });
});

describe('the page’s own warnings (DGS 2026-10-16)', () => {
  it('the preview: check and simulate, an informal review by the DGS or ADGS, never official processing', () => {
    assert.equal(
      unofficialWarning('phd'),
      'This transcript is marked “unofficial”. You can use it here to check your requirements and to simulate, and the DGS can review it informally, but it will not be accepted for official processing — transfer credit is processed only on the official transcript, which that university’s registrar sends directly to the Graduate School.',
    );
    assert.match(unofficialWarning('mscse'), /and the ADGS can review it informally/);
  });
  it('the Transcripts card row, after Add', () => {
    assert.equal(unofficialSlotNote('phd'), 'Unofficial copy — for the DGS’s informal review only; it will not be accepted for official processing until the registrar sends the official transcript to the Graduate School.');
    assert.match(unofficialSlotNote('mscse'), /^Unofficial copy — for the ADGS’s informal review only/);
  });
});

describe('the three emails carry the warning', () => {
  const rules = buildRules({
    external: [{ university: 'PURDUE UNIVERSITY', course_id: 'CS 50300', course_title: 'Operating Systems', transferable_PhD: 'yes', transferable_MSCSE: 'yes' }],
  });
  const student: Student = {
    schemaVersion: 1,
    program: 'phd',
    entryTerm: { season: 'fall', year: 2026 },
    bachelorsAwarded: { season: 'spring', year: 2022 },
    priorMs: 'completed',
    gpa: 3.6,
    milestones: {},
    attestations: {},
    courses: [row('CS 50300', 'masters', true), row('CS 24000', 'bachelors', true)],
  };
  const report = audit(student, rules, '2027-06-01');
  const opts = { todayIso: '2027-06-01', entryTerm: 'Fall 2026', priorStudy: 'Completed prior M.S. or Ph.D.', gpa: 3.6 };
  const note = unofficialTranscriptNote(student.courses, 'gradAdmin');
  assert.match(note, /bachelor’s and master’s transcripts/);

  it('Grad Admin request: after the "Attached:" line, in text and HTML', () => {
    const built = gradAdminRequest(report, student, rules, opts);
    // Bullets since DGS 2026-10-28: the note is the one after "Attached:", its
    // closing "(§5.2)." dropped with every handbook section.
    const attached = 'Attached: copies of my transcripts (PDF); the official transcripts go directly from each university’s registrar to the Graduate School';
    const bullet = note.replace(/ \(§5\.2\)\.$/, '');
    assert.notEqual(bullet, note, 'the note ends with its section');
    assert.ok(built.text.includes(`\n- ${attached}\n- ${bullet}\n`), built.text.slice(0, 900));
    assert.ok(built.html.includes(`<li><strong>${attached}</strong></li><li><strong>${bullet}</strong></li>`), 'HTML carries the note, bold, after the Attached bullet');
  });
  it('Grad Admin request: the transfer from the unofficial copy is marked (DGS 2026-10-16)', () => {
    const built = gradAdminRequest(report, student, rules, opts);
    assert.deepEqual(built.items.transfers.map((t) => [t.courseId, t.unofficial]), [['CS 50300', true]]);
  });
  it('advisor summary: in the standing paragraph when the app passes the note', () => {
    const advisorNote = unofficialTranscriptNote(student.courses, 'advisor');
    const built = advisorSummary(report, { ...opts, unofficialNote: advisorNote });
    assert.ok(built.text.includes(`\n${advisorNote}\n`), built.text.slice(0, 900));
    assert.ok(built.html.includes(advisorNote.replace(/&/g, '&amp;')));
    assert.ok(!advisorSummary(report, opts).text.includes('unofficial copy'), 'nothing without the note');
  });
  it('review request: among the context lines after "My transcripts are attached."', () => {
    const reviewNote = unofficialTranscriptNote(student.courses, 'review');
    const built = buildCombinedReviewRequest({ priorStudy: opts.priorStudy, nd: [], external: [], unofficial: reviewNote });
    assert.ok(built.text.includes('My transcripts are attached.'), built.text.slice(0, 600));
    assert.ok(built.text.indexOf(reviewNote) > built.text.indexOf('My transcripts are attached.'), built.text.slice(0, 900));
    assert.ok(built.html.includes(reviewNote.replace(/&/g, '&amp;')));
    assert.match(reviewNote, /for your informal review/);
  });
});
