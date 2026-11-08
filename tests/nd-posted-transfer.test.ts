// Transfer credit the Notre Dame record already shows as accepted (policy
// review round 3, P3-import-1; DGS 2026-10-05: "I want to apply (a), (b), and
// (c), with Option 1", with the three conditions that make "only approved
// credit" true). The Notre Dame transcript's "Transfer credit accepted" block
// lists credit the Graduate School has approved and recorded, dated by the
// term it was recorded.
//   Option 1 — graduate credit there counts, inside §5.2's allowance, at the
//     hours Notre Dame recorded, with no review or processing request.
//   (a) — the block's date is not the term the course was taken: no
//     "taken after admission" hold.
//   (b) / condition 1 — the record it sits on is kept: undergraduate credit
//     (AP, College Board) is never graduate transfer credit; a level the
//     transcript does not show waits for the DGS.
//   (c) / condition 2 — the block and the other university's own transcript
//     list one course once, whichever came first, and the acceptance stays.
//   condition 3 — credit recorded before this program began waits for the DGS
//     (it may have been accepted for an earlier program); the course's tick
//     records the DGS's answer.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { audit } from '../src/engine/audit.ts';
import { coursesNeedingDgsReview } from '../src/engine/review.ts';
import { sameUniversity } from '../src/engine/nd-posting.ts';
import type { CourseEntry, Student } from '../src/engine/types.ts';
import { parseTranscript } from '../src/transcript/parse.ts';
import { approvalItems } from '../src/ui/advisor-summary.ts';
import { processingItems } from '../src/ui/grad-admin-request.ts';
import { absorbBlockRow, blockRowBack, postingOf, stripNdPostings, twinOfBlockRow } from '../src/ui/nd-posted.ts';
import { validateStudent } from '../src/ui/state.ts';
import { buildRules } from './helpers.ts';
import { ndCourse, phdStudent, transferCourse } from './helpers/student.ts';

const rules = buildRules();
const fall = (year: number) => ({ season: 'fall' as const, year });
const spring = (year: number) => ({ season: 'spring' as const, year });
const TODAY = '2026-10-05';

/** A row the Notre Dame import adds from the block (no grade printed: IP). */
const block = (courseId: string, term: { season: 'fall' | 'spring'; year: number }, level?: 'graduate' | 'undergraduate', over: Partial<CourseEntry> = {}): CourseEntry => ({
  ...transferCourse(courseId, 'Graduate course', { term, grade: 'IP', institution: 'Purdue University' }),
  fromNdTranscript: true,
  ...(level !== undefined ? { registeredLevel: level } : {}),
  ...(level === 'undergraduate' ? { degreeLevel: 'bachelors' as const } : {}),
  ndPosted: { term, credits: 3, ...(level !== undefined ? { level } : {}), institution: 'Purdue University' },
  ...over,
});
const student = (courses: CourseEntry[], over: Partial<Student> = {}): Student =>
  phdStudent({
    entryTerm: fall(2024),
    priorMs: 'completed',
    bachelorsAwarded: spring(2022),
    gpa: 3.7,
    courses: [...courses, ...['CSE 60641', 'CSE 60111', 'CSE 60321'].map((id) => ndCourse(id, { term: fall(2024) }))],
    milestones: { advisorName: 'Prof. Example', advisorTtt: 'yes' },
    ...over,
  });
const run = (s: Student) => audit(s, rules, TODAY);
const lineOf = (s: Student, id: string, year?: number) => run(s).courseLines.find((l) => l.courseId === id && (year === undefined || l.term.year === year))!;
const transferRowOf = (s: Student) => run(s).requirements.find((r) => r.id === 'phd.transfer')!;

describe('the transcript reader keeps the level of each transfer-block row (b)', () => {
  it('official PDF: the undergraduate record’s block is undergraduate, the graduate record’s graduate', () => {
    const p = parseTranscript([
      'University of Notre Dame', 'Degree Awarded: Bachelor of Science', 'Date Conferred: May 19, 2024',
      'Course Level: Undergraduate',
      'TRANSFER CREDIT ACCEPTED BY THE UNIVERSITY:', 'Fall 2020   College Board', 'MATH 10550   Calculus I   4.000',
      'UNIVERSITY OF NOTRE DAME CREDIT:', 'Fall Semester 2020', 'CSE 10001   Principles of Computing   3.000 A   12.000',
      'Course Level: Graduate',
      'TRANSFER CREDIT ACCEPTED BY THE UNIVERSITY:', 'Spring 2025   Purdue University', 'CS 50100   Graduate Operating Systems   3.000',
      'UNIVERSITY OF NOTRE DAME CREDIT:', 'Fall Semester 2024', 'CSE 60111   Complexity and Algorithms   3.000 B+   9.999',
    ]);
    const ap = p.courses.find((c) => c.courseId === 'MATH 10550')!;
    const cs = p.courses.find((c) => c.courseId === 'CS 50100')!;
    assert.equal(ap.origin, 'transfer');
    assert.equal(ap.level, 'undergraduate');
    assert.equal(cs.origin, 'transfer');
    assert.equal(cs.level, 'graduate');
    assert.deepEqual(cs.term, spring(2025));
  });
  it('web transcript: the row’s own UG/GR column decides; with no level shown, it stays unknown', () => {
    const web = parseTranscript(['University of Notre Dame', 'Unofficial Academic Transcript', 'TRANSFER CREDIT ACCEPTED BY INSTITUTION', '202420: Purdue University', 'CS 50100 GR Graduate Operating Systems A 3.000 12.000']);
    assert.equal(web.courses[0]!.level, 'graduate');
    const bare = parseTranscript(['University of Notre Dame', 'Unofficial Academic Transcript', 'TRANSFER CREDIT ACCEPTED BY INSTITUTION', '202420: Purdue University', 'CS 50100 Graduate Operating Systems A 3.000 12.000']);
    assert.equal(bare.courses[0]!.level, undefined);
  });
});

describe('Option 1: graduate credit on the record counts as posted', () => {
  const s = student([block('CS 50100', spring(2025), 'graduate'), block('CS 52600', spring(2025), 'graduate')]);
  it('each course counts toward regular courses, with no “taken after admission” hold (a)', () => {
    const line = lineOf(s, 'CS 50100');
    assert.equal(line.mark, 'counts');
    assert.match(line.text, /^counts toward regular courses \(3 cr\); transfer credit on your Notre Dame record \(posted Spring 2025\) — accepted by the Graduate School; nothing to send \(Academic Code §4\.6\)/);
    assert.doesNotMatch(line.text, /after you entered|approval in advance/);
    assert.equal(line.approvable, undefined, 'no tick: nothing for the DGS to decide');
  });
  it('the transfer card is Met without the “Graduate School approved my transfer credit” tick, and says why', () => {
    const row = transferRowOf(s);
    assert.equal(row.status, 'met');
    assert.match(row.detail, /6 of the 24 credits you may transfer are counted/);
    assert.match(row.detail, /On your Notre Dame record as accepted transfer credit: CS 50100, CS 52600/);
  });
  it('nothing goes to the review request or the Grad Admin’s processing request', () => {
    assert.deepEqual(coursesNeedingDgsReview(s, rules, TODAY), []);
    const items = processingItems(run(s), s, rules);
    assert.equal(items.transfers.length, 0);
    // A title that suggests a §4.4.1 core area still raises that question, and only that.
    const os = student([block('CS 50100', spring(2025), 'graduate', { title: 'Graduate Operating Systems' })]);
    const asks = coursesNeedingDgsReview(os, rules, TODAY);
    assert.deepEqual(asks.map((a) => a.ask.decide), [['core area (§4.4.1), if any']]);
  });
  it('a grade the transcript did not print does not make it “in progress” for a confirmed core area', () => {
    const withRow = buildRules({ external: [{ university: 'Purdue University', course_id: 'CS 50100', course_title: '', satisfies_core_area: 'OS', transferable_PhD: '', transferable_MSCSE: '', credit_system: 'semester', is_cse: 'yes' }] });
    const os = audit(student([block('CS 50100', spring(2025), 'graduate')], { courses: [block('CS 50100', spring(2025), 'graduate')] }), withRow, TODAY).requirements.find((r) => r.id === 'phd.qualifier.core.os')!;
    assert.equal(os.status, 'met', os.detail);
  });
  it('a merged quarter-system row counts the hours Notre Dame recorded', () => {
    const merged = transferCourse('CS 50100', 'Graduate Operating Systems', { term: fall(2022), credits: 4, institution: 'Purdue University', degreeLevel: 'masters', creditSystem: 'quarter', ndPosted: { term: spring(2025), credits: 2.67, level: 'graduate' } });
    const line = lineOf(student([merged]), 'CS 50100');
    assert.match(line.text, /counts toward regular courses \(2\.67 cr\)/);
    assert.match(line.text, /counted as 2\.67 ND credits, as your Notre Dame record shows them \(the Purdue University transcript shows 4\)/);
  });
});

describe('what still waits for the DGS — and the tick that records the answer', () => {
  it('condition 3: credit recorded before this program began waits; the tick settles it', () => {
    const before = student([block('CS 50100', fall(2023), 'graduate')]);
    const line = lineOf(before, 'CS 50100');
    assert.equal(line.mark, 'pending');
    assert.equal(line.approvable, true);
    assert.match(line.text, /it was posted before you entered this program, so it may have been accepted for an earlier program — the DGS confirms it counts toward this degree/);
    assert.equal(transferRowOf(before).status, 'needs_dgs_review');
    const ask = coursesNeedingDgsReview(before, rules, TODAY)[0]!.ask;
    assert.deepEqual([ask.needsRow, ask.replyNeeded], [false, true]);
    assert.match(ask.decide[0]!, /^confirm this credit, already accepted on my Notre Dame record, counts toward this degree/);
    const ticked = student([block('CS 50100', fall(2023), 'graduate', { dgsApproved: true })]);
    assert.equal(lineOf(ticked, 'CS 50100').mark, 'counts');
    assert.match(lineOf(ticked, 'CS 50100').text, /the DGS confirmed it counts toward this degree, as you ticked on the course/);
    assert.equal(transferRowOf(ticked).status, 'met');
  });
  it('condition 1: a level the transcript does not show waits — and so does a row imported before the mark existed', () => {
    const unknown = lineOf(student([block('CS 50100', spring(2025))]), 'CS 50100');
    assert.equal(unknown.mark, 'pending');
    assert.match(unknown.text, /the transcript does not show whether it is graduate credit/);
    const legacy = { ...transferCourse('CS 50100', 'Graduate course', { term: spring(2025), grade: 'IP', institution: 'Purdue University' }), fromNdTranscript: true as const };
    const legacyLine = lineOf(student([legacy]), 'CS 50100');
    assert.equal(legacyLine.mark, 'pending');
    assert.match(legacyLine.text, /transfer credit on your Notre Dame record \(posted Spring 2025\), but the transcript does not show whether it is graduate credit/);
    assert.doesNotMatch(legacyLine.text, /after you entered/, '(a) holds for it too');
  });
  it('the advisor email asks the DGS to confirm, not to recommend', () => {
    const reason = 'transfer credit on your Notre Dame record (posted Fall 2023), but it was posted before you entered this program, so it may have been accepted for an earlier program — the DGS confirms it counts toward this degree';
    assert.equal(approvalItems('CS 50100', reason, 'phd').dgs, 'Confirm that CS 50100, already accepted as transfer credit on my Notre Dame record, counts toward this degree (§5.2).');
  });
});

describe('(b): undergraduate credit on the record is never graduate transfer credit', () => {
  it('AP credit is refused with its reason and stays off the transfer card', () => {
    const ap = { ...block('MATH 10550', fall(2020), 'undergraduate'), institution: 'College Board', credits: 4 };
    const s = student([ap]);
    const line = lineOf(s, 'MATH 10550');
    assert.equal(line.mark, 'excluded');
    assert.match(line.text, /^not counted — undergraduate credit on your Notre Dame bachelor’s record, accepted for the bachelor’s degree, not as graduate transfer credit \(§5\.2\)/);
    assert.equal(transferRowOf(s).status, 'not_applicable');
    assert.equal(coursesNeedingDgsReview(s, rules, TODAY).length, 0);
  });
});

describe('(c) and condition 2: one course, whichever transcript came first', () => {
  const purdue = () => transferCourse('CS 50100', 'Graduate Operating Systems', { term: fall(2022), institution: 'Purdue University', degreeLevel: 'masters' });
  it('a school is the same however the two transcripts spell it', () => {
    assert.equal(sameUniversity('PURDUE UNIVERSITY-WEST LAFAYETTE', 'Purdue University'), true);
    assert.equal(sameUniversity('The Ohio State University', 'Ohio State University'), true);
    assert.equal(sameUniversity('University of California, Davis', 'University of California, Berkeley'), false);
  });
  it('Notre Dame transcript second: the block row is “already entered”, and the existing row takes the acceptance', () => {
    const s = student([purdue()]);
    const parsedBlock = { courseId: 'CS 50100', institution: 'PURDUE UNIVERSITY-WEST LAFAYETTE', origin: 'transfer' as const, term: spring(2025), credits: 3, level: 'graduate' as const };
    const twin = twinOfBlockRow(s, parsedBlock);
    assert.equal(twin?.term.year, 2022);
    twin!.ndPosted = postingOf(parsedBlock);
    assert.equal(lineOf(s, 'CS 50100').mark, 'counts');
    assert.equal(transferRowOf(s).status, 'met');
    // Removing the Notre Dame import takes the mark back off, and Undo puts it back.
    const stripped = stripNdPostings(s);
    assert.equal(stripped.length, 1);
    assert.equal(s.courses[stripped[0]!.index]!.ndPosted, undefined);
  });
  it('the other transcript second: its row absorbs the block row, and removing that transcript gives the block row back', () => {
    const printed = 'PURDUE UNIVERSITY-WEST LAFAYETTE';
    const s = student([block('CS 50100', spring(2025), 'graduate', { institution: printed, ndPosted: { term: spring(2025), credits: 3, level: 'graduate', institution: printed } })]);
    const row = purdue();
    s.courses.push(row);
    const absorbed = absorbBlockRow(s, row);
    assert.ok(absorbed);
    assert.equal(s.courses.filter((c) => c.courseId === 'CS 50100').length, 1);
    assert.deepEqual(row.ndPosted?.term, spring(2025));
    assert.equal(lineOf(s, 'CS 50100').mark, 'counts');
    const back = blockRowBack(row)!;
    assert.equal(back.fromNdTranscript, true);
    assert.deepEqual(back.term, spring(2025));
    assert.equal(back.institution, 'PURDUE UNIVERSITY-WEST LAFAYETTE');
  });
  it('a record saved with both rows counts the course once, on the other transcript’s row', () => {
    const s = student([purdue(), block('CS 50100', spring(2025), 'graduate', { institution: 'PURDUE UNIVERSITY-WEST LAFAYETTE' })]);
    const r = run(s);
    const lines = r.courseLines.filter((l) => l.courseId === 'CS 50100');
    assert.deepEqual(lines.map((l) => [l.term.year, l.mark]), [[2022, 'counts'], [2025, 'excluded']]);
    assert.match(lines[1]!.text, /the same course as CS 50100 from your Purdue University transcript/);
    assert.match(r.requirements.find((x) => x.id === 'phd.transfer')!.detail, /^3 of the 24 credits you may transfer are counted/);
  });
});

describe('a saved file keeps a well-formed acceptance and drops a malformed one', () => {
  it('validateStudent', () => {
    const good = validateStudent(student([block('CS 50100', spring(2025), 'graduate')]), []);
    assert.deepEqual(good.courses[0]!.ndPosted, { term: spring(2025), credits: 3, level: 'graduate', institution: 'Purdue University' });
    const bad = validateStudent(student([block('CS 50100', spring(2025), 'graduate', { ndPosted: { term: { season: 'winter', year: 2025 }, credits: 3 } as never })]), []);
    assert.equal(bad.courses[0]!.ndPosted, undefined);
  });
});
