// Where each course came from (DGS 2026-10-11, item 6: "make the MSCSE-along-
// the-way request safe to act on"): the processing request and the advisor
// summary label every course — from the Notre Dame transcript, typed by the
// student, or imported and then changed — and say that milestone dates and
// approval ticks are the student's own; the alpha notice and the processing
// request no longer call the along-the-way result "informational only" while
// it is the DGS's own review (P3-cse-3-2).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { audit } from '../src/engine/audit.ts';
import type { CourseEntry, Student } from '../src/engine/types.ts';
import { advisorSummary } from '../src/ui/advisor-summary.ts';
import { changedFields, courseEntryOf } from '../src/ui/external-upload.ts';
import { gradAdminRequest } from '../src/ui/grad-admin-request.ts';
import { ALONG_THE_WAY_NOTICE, BETA_NOTICE, betaNotice } from '../src/ui/handbook.ts';
import { sourceOf, sourcesLine } from '../src/ui/provenance.ts';
import { validateStudent } from '../src/ui/state.ts';
import { allScenarios, buildRules } from './helpers.ts';

const base = (over: Partial<CourseEntry>): CourseEntry => ({ courseId: 'CSE 60111', credits: 3, term: { season: 'fall', year: 2025 }, grade: 'A', origin: 'nd', ...over });
const ON = { on: '2026-10-11', app: 'abc1234' };

describe('each course’s source', () => {
  it('reads the record’s marks, in the student’s voice', () => {
    assert.equal(sourceOf(base({ fromNdTranscript: true, imported: { transcript: 'nd', ...ON } })).text, 'imported from my Notre Dame transcript');
    // A Notre Dame import saved before the labels: still known.
    assert.equal(sourceOf(base({ fromNdTranscript: true })).text, 'imported from my Notre Dame transcript');
    assert.equal(sourceOf(base({ origin: 'transfer', imported: { transcript: 'masters', ...ON } })).text, 'imported from my master’s transcript');
    assert.equal(sourceOf(base({ origin: 'transfer', imported: { transcript: 'bachelors', ...ON }, changedOnImport: ['grade', 'credits'] })).text, 'imported from my bachelor’s transcript, then changed by me (grade, credits)');
    assert.equal(sourceOf(base({ typedByStudent: true })).text, 'typed by me');
    // Saved before 2026-10-11 and not a Notre Dame import: said, not guessed.
    assert.equal(sourceOf(base({})).text, 'source not recorded (entered before October 11, 2026)');
  });

  it('the preview’s Add records what the student changed, and a typed row as typed', () => {
    const read = { course: 'CS 50300', title: 'Operating Systems', credits: 3, season: 'fall' as const, year: 2024, grade: 'B' as const, level: 'graduate' as const };
    const row = { courseId: 'CS 50300', title: 'Operating Systems', credits: 3, season: 'fall' as const, year: 2024, grade: 'B' as const, level: 'graduate' as const, read };
    assert.deepEqual(changedFields(row), []);
    // Spacing and case in a course number are not a change (canonicalCourseId).
    assert.deepEqual(changedFields({ ...row, courseId: 'cs50300' }), []);
    assert.deepEqual(changedFields({ ...row, grade: 'A', year: 2023 }), ['term', 'grade']);
    const p = { slot: 'masters' as const, unofficial: undefined, creditSystem: undefined, creditSystemRead: undefined };
    type Row = Parameters<typeof courseEntryOf>[0];
    const added = courseEntryOf({ ...row, grade: 'A' } as unknown as Row, p, 'Purdue University', ON);
    assert.deepEqual(added.imported, { transcript: 'masters', on: '2026-10-11', app: 'abc1234' });
    assert.deepEqual(added.changedOnImport, ['grade']);
    const untouched = courseEntryOf(row as unknown as Row, p, 'Purdue University', ON);
    assert.equal(untouched.changedOnImport, undefined);
    const typed = courseEntryOf({ ...row, manual: true, read: undefined } as unknown as Row, p, 'Purdue University', ON);
    assert.equal(typed.typedByStudent, true);
    assert.equal(typed.imported, undefined);
  });

  it('survives a saved file, and a malformed mark is dropped rather than refusing the file', () => {
    const sc = allScenarios().find((s) => s.name === 'life-phd-finished')!;
    const marked: Student = {
      ...sc.student,
      courses: [
        { ...sc.student.courses[0]!, imported: { transcript: 'nd', ...ON } },
        { ...sc.student.courses[1]!, typedByStudent: true },
        { ...sc.student.courses[2]!, imported: { transcript: 'masters', ...ON }, changedOnImport: ['grade'] },
        { ...sc.student.courses[3]!, imported: { transcript: 'bogus', on: 'yesterday', app: 1 } as never, changedOnImport: ['colour'] as never },
      ],
    };
    const back = validateStudent(JSON.parse(JSON.stringify({ student: marked })));
    assert.deepEqual(back.courses[0]!.imported, { transcript: 'nd', ...ON });
    assert.equal(back.courses[1]!.typedByStudent, true);
    assert.deepEqual(back.courses[2]!.changedOnImport, ['grade']);
    assert.equal(back.courses[3]!.imported, undefined);
    assert.equal(back.courses[3]!.changedOnImport, undefined);
  });
});

describe('the emails', () => {
  const sc = allScenarios().find((s) => s.name === 'life-phd-ms-along-the-way')!;
  const rules = buildRules(sc.rules.patch);
  const student: Student = {
    ...sc.student,
    courses: sc.student.courses.map((c, i) =>
      i === 0 ? { ...c, typedByStudent: true } : i === 1 ? { ...c, fromNdTranscript: true, imported: { transcript: 'nd', ...ON }, changedOnImport: undefined } : { ...c, fromNdTranscript: true, imported: { transcript: 'nd', ...ON } },
    ),
  };
  const report = audit(student, rules, sc.today);
  const ga = gradAdminRequest(report, student, rules, { todayIso: sc.today, entryTerm: 'Fall 2021', priorStudy: 'None' });

  it('the processing request labels each course and says the dates and ticks are the student’s own', () => {
    const n = student.courses.length;
    assert.ok(ga.text.includes(`\nMy courses: 1 typed by me; ${n - 1} imported from my Notre Dame transcript. The milestone dates and the approvals I ticked are my own entries.\n`), ga.text.slice(0, 900));
    assert.match(ga.text, /\nCourse\tTitle\tCredits\tGrade\tTerm\tWhere\tCounts toward\tSource\n/);
    assert.match(ga.text, /\ttyped by me\n/);
    assert.match(ga.text, /\timported from my Notre Dame transcript\n/);
    // The date goes along under its requirement, as the student entered it (DGS 2026-10-15: not an action).
    assert.match(ga.text, /\nMILESTONE DATES, FOR THE RECORD\n(?:- [^\n]*\n)*- (?:Oral Candidacy Exam \(OCE\)|OCE) passed: 2023-11-15, as I entered it \(§4\.5\)\n/);
    assert.doesNotMatch(ga.text, /Record the milestone/);
  });

  it('“informational only” is not said of the MSCSE along the way', () => {
    assert.ok(ga.items.msAlongTheWay, 'the scenario’s award is met');
    // The one major event on this record (DGS 2026-10-15): its milestones are dated, its applications made.
    assert.equal(ga.items.count, 1);
    assert.deepEqual(ga.items.actions.map((a) => a.slice(0, 40)), ['Process the MSCSE along the way — the se']);
    assert.match(ga.text, /informational only — every decision rests with the DGS — except the MSCSE along the way above, for which this self-check is the DGS’s own review, §3\.1\)\.\n/);
    // Without the award in the request, the closing is the sentence as before
    // (the ADGS's on the MSCSE tab — the page's own DGS→ADGS rewrite).
    const msc = allScenarios().find((s) => s.name === 'life-mscse-thesis-finished')!;
    const r2 = buildRules(msc.rules.patch);
    const ga2 = gradAdminRequest(audit(msc.student, r2, msc.today), msc.student, r2, { todayIso: msc.today, entryTerm: 'Fall 2024', priorStudy: 'None' });
    assert.match(ga2.text, /\(alpha version under testing; informational only — every decision rests with the ADGS\)\.\n/);
    // Thesis direction taken in two semesters is two rows of the course table, each with its term (2026-10-11).
    assert.equal(ga2.items.courses.filter((c) => c.courseId === 'CSE 68901').map((c) => c.term).join(' | '), 'Fall 2025 | Spring 2026');
    // The alpha notice: the DGS's sentence word for word, and on the Ph.D. tab the exception after it.
    assert.equal(betaNotice('mscse'), BETA_NOTICE);
    assert.equal(betaNotice('phd'), `${BETA_NOTICE} ${ALONG_THE_WAY_NOTICE}`);
    const adv = advisorSummary(report, { todayIso: sc.today, entryTerm: 'Fall 2021', priorStudy: 'None', sources: sourcesLine(student) });
    assert.ok(adv.text.includes(ALONG_THE_WAY_NOTICE));
    assert.ok(adv.text.includes('My courses: 1 typed by me;'));
  });
});
