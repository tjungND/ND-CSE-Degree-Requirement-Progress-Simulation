// Direct unit tests for the engine's tricky corners: order independence, the
// cap allocator, group matching, the status algebra, and term arithmetic.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { allocate, priorNdUndergraduateCanCount, type CapSpec, type ClassifiedCourse } from '../src/engine/allocate.ts';
import { audit } from '../src/engine/audit.ts';
import { matchDistinctGroups } from '../src/engine/matching.ts';
import { coursesNeedingDgsReview } from '../src/engine/review.ts';
import { isCseCourse, subjectCode } from '../src/data/external.ts';
import { resolveRuleRow } from '../src/data/assemble.ts';
import { specialTracks } from '../src/engine/tracks.ts';
import { classify } from '../src/engine/allocate.ts';
import { combineAll, deadlineStatus, thresholdStatus } from '../src/engine/status.ts';
import {
  maxConsecutiveFullTime,
  normalizeEntryTerm,
  nthSemester,
  semesterNumber,
  termOfDate,
} from '../src/engine/term.ts';
import type { CourseEntry, Status, Student } from '../src/engine/types.ts';
import { buildRules, loadScenario as scenario } from './helpers.ts';
import { phdStudent } from './helpers/student.ts';

describe('order independence', () => {
  // The prototype's biggest bug: entry order changed the verdict. Permuting the
  // course list must never change any requirement status or counted totals.
  const rules = buildRules();
  for (const name of ['phd-4xxxx-overuse', 'mscse-noncse-ten', 'phd-transfer-prior-ms']) {
    it(name, () => {
      const sc = scenario(name);
      const base = audit(sc.student, rules, sc.today);
      const courses = sc.student.courses;
      for (let shift = 1; shift < courses.length; shift++) {
        const rotated = [...courses.slice(shift), ...courses.slice(0, shift)].reverse();
        const permuted: Student = { ...sc.student, courses: rotated };
        const report = audit(permuted, rules, sc.today);
        assert.deepEqual(
          report.requirements.map((r) => [r.id, r.status]),
          base.requirements.map((r) => [r.id, r.status]),
          `statuses changed under permutation ${shift}`,
        );
        assert.deepEqual(report.summary, base.summary);
      }
    });
  }
});

describe('allocator', () => {
  const mk = (
    courseId: string,
    credits: number,
    caps: ClassifiedCourse['caps'],
  ): ClassifiedCourse => ({
    entry: {
      courseId,
      credits,
      term: { season: 'fall', year: 2026 },
      grade: 'A',
      origin: 'nd',
    },
    pool: 'regular',
    caps,
    tier: 'definite',
  });
  const caps: CapSpec[] = [
    { id: 'fourk', limit: 3, label: '3-credit A cap', section: '§t' },
    { id: 'noncse', limit: 3, label: '3-credit B cap', section: '§t' },
  ];

  it('multi-cap courses never displace single-cap credits (exact, not greedy)', () => {
    // X consumes both caps; entry-order greedy would count X first and lose 3.
    const X = mk('CSE 10001', 3, ['fourk', 'noncse']);
    const Y = mk('CSE 10002', 3, ['fourk']);
    const Z = mk('CSE 10003', 3, ['noncse']);
    const r = allocate([X, Y, Z], caps);
    assert.equal(r.regular.definite, 6, 'optimal picks Y and Z, not X');
    const forX = r.perCourse.find((p) => p.course === X)!;
    assert.equal(forX.countedRegular, 0);
  });

  it('caps allocate at credit granularity (partial counting)', () => {
    const A = mk('CSE 10001', 4, ['fourk']); // 4 credits against a 3-credit cap
    const r = allocate([A], caps);
    const line = r.perCourse[0]!;
    assert.equal(line.countedRegular, 3);
    assert.equal(line.excluded, 1);
    assert.ok(line.explanation.includes('3 of 4'), line.explanation);
  });

  it('definite credits consume caps before in-progress credits', () => {
    const done = mk('CSE 10002', 3, ['fourk']);
    const ip: ClassifiedCourse = {
      ...mk('CSE 10001', 3, ['fourk']),
      tier: 'in_progress',
    };
    const r = allocate([ip, done], caps); // ip listed first on purpose
    assert.equal(r.regular.definite, 3);
    assert.equal(r.regular.in_progress, 0);
  });
});

describe('distinct-group matching', () => {
  const groups = ['alg', 'hcc', 'arch', 'dsai', 'sys'];
  it("an 'any' course fills the missing group", () => {
    const r = matchDistinctGroups(
      [
        { courseId: 'A', title: '', groups: ['alg'], sortKey: '1' },
        { courseId: 'B', title: '', groups: ['alg'], sortKey: '2' },
        { courseId: 'RM', title: 'Research Methods', groups, sortKey: '3' },
      ],
      groups,
    );
    assert.equal(r.distinctCount, 2);
    assert.equal(r.assignment.get('RM') !== 'alg', true, 'RM must not waste itself on alg');
  });

  it('a suboptimal pin is set aside for the assignment that covers more (F2, 2026-09-12)', () => {
    const r = matchDistinctGroups(
      [
        { courseId: 'A', title: '', groups: ['alg'], sortKey: '1' },
        { courseId: 'RM', title: '', groups, pinned: 'alg', sortKey: '2' },
      ],
      groups,
    );
    assert.equal(r.distinctCount, 2, 'the pin is a preference — the matcher covers two groups');
    assert.equal(r.pinsIgnored, true);
    assert.notEqual(r.bestAssignment.get('RM'), 'alg');
    assert.ok(r.suggestions.length > 0);
  });
});

describe('status algebra', () => {
  it('threshold ladder: worst credit actually needed', () => {
    const s = (definite: number, in_progress: number, provisional: number) => ({
      definite,
      in_progress,
      provisional,
    });
    assert.equal(thresholdStatus(s(24, 0, 0), 24), 'met');
    assert.equal(thresholdStatus(s(21, 3, 0), 24), 'in_progress');
    assert.equal(thresholdStatus(s(21, 0, 3), 24), 'needs_dgs_review');
    assert.equal(thresholdStatus(s(21, 2, 1), 24), 'needs_dgs_review');
    assert.equal(thresholdStatus(s(21, 0, 0), 24), 'unmet');
    assert.equal(thresholdStatus(s(999, 0, 0), undefined), 'cannot_evaluate');
  });

  it('combineAll is worst-first and ignores n/a', () => {
    const c = (...xs: Status[]) => combineAll(xs);
    assert.equal(c('met', 'met'), 'met');
    assert.equal(c('met', 'in_progress'), 'in_progress');
    assert.equal(c('in_progress', 'needs_dgs_review'), 'needs_dgs_review');
    assert.equal(c('needs_dgs_review', 'cannot_evaluate'), 'cannot_evaluate');
    assert.equal(c('cannot_evaluate', 'unmet'), 'unmet');
    assert.equal(c('met', 'not_applicable'), 'met');
    assert.equal(c('not_applicable'), 'not_applicable');
  });

  it('a milestone completed after its deadline needs DGS review (Q22)', () => {
    const r = deadlineStatus({
      doneOn: '2030-09-01',
      deadline: { date: '2030-05-31', approx: true },
      today: '2030-10-01',
      deadlineLabel: 'the end of Spring 2030',
    });
    assert.equal(r.status, 'needs_dgs_review');
    const ext = deadlineStatus({
      doneOn: '2030-09-01',
      deadline: { date: '2030-05-31', approx: true },
      today: '2030-10-01',
      deadlineLabel: 'the end of Spring 2030',
      extension: { date: '2030-12-31', label: 'the end of Fall 2030' },
    });
    assert.equal(ext.status, 'met');
  });

  // The DGS grants a qualifier extension ONE SEMESTER at a time (2026-09-13).
  // The old boolean forgave any lateness forever, so a milestone five years
  // overdue still read "due soon" and a pass years late read as on-time.
  describe('an extension is one additional semester, not a blanket waiver', () => {
    const base = {
      deadline: { date: '2030-05-31', approx: true },
      deadlineLabel: 'the end of Spring 2030',
      extension: { date: '2030-12-31', label: 'the end of Fall 2030' },
    };

    it('not done, inside the extension: in progress, and the chip names the new date', () => {
      const r = deadlineStatus({ ...base, today: '2030-10-01' });
      assert.equal(r.status, 'in_progress');
      assert.equal(r.deadline.date, '2030-12-31');
      assert.match(r.deadline.label, /one-semester extension/);
    });

    it('not done, PAST the extension: overdue again — the extension ran out', () => {
      const r = deadlineStatus({ ...base, today: '2031-06-01' });
      assert.equal(r.status, 'unmet');
      assert.equal(r.deadline.state, 'overdue');
      assert.match(r.deadline.label, /ran out/);
      // Years later it still reads overdue, not a stale "due soon".
      const muchLater = deadlineStatus({ ...base, today: '2035-01-01' });
      assert.equal(muchLater.status, 'unmet');
      assert.equal(muchLater.deadline.state, 'overdue');
    });

    it('done inside the extension: met, and the record keeps how late it was', () => {
      const r = deadlineStatus({ ...base, doneOn: '2030-11-01', today: '2031-01-15' });
      assert.equal(r.status, 'met');
      assert.match(r.lateNote ?? '', /within the one-semester extension/);
      assert.match(r.deadline.label, /within the DGS’s one-semester extension/);
    });

    it('done past the extension: back to needs DGS review', () => {
      const r = deadlineStatus({ ...base, doneOn: '2031-09-01', today: '2031-10-01' });
      assert.equal(r.status, 'needs_dgs_review');
      assert.match(r.lateNote ?? '', /later than the one-semester extension allows/);
    });

    it('done on time is plain met, extension or no extension', () => {
      const r = deadlineStatus({ ...base, doneOn: '2030-02-01', today: '2030-06-01' });
      assert.equal(r.status, 'met');
      assert.equal(r.lateNote, undefined);
      assert.equal(r.deadline.label, 'Done 2030-02-01');
    });
  });
});

describe('term arithmetic', () => {
  it('termOfDate boundaries: June–mid-August are summer (prototype counted them as spring)', () => {
    assert.deepEqual(termOfDate('2027-05-31'), { season: 'spring', year: 2027 });
    assert.deepEqual(termOfDate('2027-06-15'), { season: 'summer', year: 2027 });
    assert.deepEqual(termOfDate('2027-07-31'), { season: 'summer', year: 2027 });
    assert.deepEqual(termOfDate('2027-08-14'), { season: 'summer', year: 2027 });
    assert.deepEqual(termOfDate('2027-08-15'), { season: 'fall', year: 2027 });
  });

  it('semester numbering counts fall/spring only', () => {
    const entry = { season: 'fall', year: 2026 } as const;
    assert.equal(semesterNumber(entry, { season: 'fall', year: 2026 }), 1);
    assert.equal(semesterNumber(entry, { season: 'spring', year: 2027 }), 2);
    assert.equal(semesterNumber(entry, { season: 'summer', year: 2027 }), 2); // summer ≙ preceding semester
    assert.equal(semesterNumber(entry, { season: 'spring', year: 2028 }), 4);
    assert.deepEqual(nthSemester(entry, 8), { season: 'spring', year: 2030 });
  });

  it('summer entry normalizes to the following fall (Q17c)', () => {
    const n = normalizeEntryTerm({ season: 'summer', year: 2026 });
    assert.deepEqual(n.term, { season: 'fall', year: 2026 });
    assert.equal(n.normalized, true);
  });

  it('consecutive full-time runs skip summers but break on a missed semester', () => {
    const t = (season: 'fall' | 'spring' | 'summer', year: number, fullTime = true) => ({
      term: { season, year },
      fullTime,
    });
    // fall26, spring27, [no summer], fall27, spring28 → run of 4
    assert.equal(
      maxConsecutiveFullTime([t('fall', 2026), t('spring', 2027), t('fall', 2027), t('spring', 2028)]),
      4,
    );
    // gap in fall27 breaks the run
    assert.equal(
      maxConsecutiveFullTime([t('fall', 2026), t('spring', 2027), t('spring', 2028)]),
      2,
    );
    // summer terms never contribute or break
    assert.equal(
      maxConsecutiveFullTime([t('fall', 2026), t('summer', 2027), t('spring', 2027)]),
      2,
    );
  });
});

// Residence counts only from the entry term (2026-09-05): a combined Notre Dame
// transcript's undergraduate semesters are not Ph.D. residence (§4.3).
describe('residency from the entry term (2026-09-05)', () => {
  it('ignores Notre Dame terms and overrides dated before the entry term', async () => {
    const { fullTimeTermRecords } = await import('../src/engine/requirements/residency.ts');
    const rules = buildRules();
    // Distinct ids: the same course four times would be a retake chain, and
    // residency now reads the classified list, where superseded rows are not
    // registrations (2026-09-11).
    const ids = ['CSE 60641', 'CSE 60111', 'CSE 60321', 'CSE 60535'];
    const nd = (season: 'fall' | 'spring', year: number): CourseEntry => ({ courseId: ids.shift()!, credits: 9, term: { season, year }, grade: 'A', origin: 'nd' });
    const student: Student = phdStudent({
      entryTerm: { season: 'fall', year: 2024 },
      courses: [nd('fall', 2020), nd('spring', 2021), nd('fall', 2024), nd('spring', 2025)],
      fullTimeTermOverrides: [{ season: 'fall', year: 2023 }, { season: 'fall', year: 2025 }],
    });
    const { classify } = await import('../src/engine/allocate.ts');
    const ctx = { student, rules, params: rules.parameters, classified: classify(student, rules).classified } as unknown as Parameters<typeof fullTimeTermRecords>[0];
    const records = fullTimeTermRecords(ctx);
    assert.deepEqual(
      records.map((r) => `${r.term.season} ${r.term.year}${r.fullTime ? ' ft' : ''}`),
      ['fall 2024 ft', 'spring 2025 ft', 'fall 2025 ft'],
    );
    assert.equal(maxConsecutiveFullTime(records), 3);
  });
});

// Deadline chips name SEMESTERS, never dates (DGS request 2026-09-05). The
// engine keeps the ISO date underneath for ordering and comparisons.
describe('deadline chips read as semesters (2026-09-05)', () => {
  it('a fresh Fall 2026 Ph.D. student sees terms on every deadline chip', () => {
    const sc = scenario('phd-fresh');
    const report = audit(sc.student, buildRules(), sc.today);
    const label = (id: string) => report.requirements.find((r) => r.id === id)?.deadline?.label;
    assert.equal(label('phd.timeLimit'), 'Due before Fall 2034 — 8 years after entry (approximate)');
    assert.equal(label('phd.qualifier.research'), 'Due by mid-Spring 2028 — 18 months after entry (approximate)');
    assert.equal(label('phd.qualifier'), 'Due by the end of Spring 2028 (approximate)');
    assert.equal(label('phd.candidacy'), 'Due by the end of Spring 2030 — semester 8 (approximate)');
    for (const r of report.requirements) {
      if (r.deadline) assert.doesNotMatch(r.deadline.label, /\d{4}-\d{2}-\d{2}/, `${r.id}: ${r.deadline.label}`);
      assert.doesNotMatch(r.detail, /\d{4}-\d{2}-\d{2}/, `${r.id} detail: ${r.detail}`);
    }
    assert.equal(report.requirements.find((r) => r.id === 'phd.timeLimit')?.deadline?.date, '2034-08-15', 'the ISO date is still carried underneath');
  });

  it('an overdue chip names the semester too', () => {
    const sc = scenario('phd-past-candidacy-deadline');
    const report = audit(sc.student, buildRules(), sc.today);
    const cand = report.requirements.find((r) => r.id === 'phd.candidacy');
    assert.equal(cand?.deadline?.state, 'overdue');
    assert.match(cand?.deadline?.label ?? '', /^Overdue — the deadline was the end of (Spring|Fall) \d{4} — semester 8 \(approximate\)$/);
  });
});

// Non-CSE courses for a Ph.D. student (§4.2: "Up to nine (9) credits at the
// 6xxxx level taken from a department other than CSE may be used to satisfy
// the course requirement, subject to approval of the student's advisor and
// DGS."). Three defects found on 2026-09-09 while checking that path.
describe('non-CSE courses', () => {
  const nonCseStudent = (courses: CourseEntry[], attestations: Student['attestations'] = {}): Student =>
    phdStudent({ bachelorsAwarded: { season: 'spring', year: 2026 }, gpa: 3.6, courses, attestations });
  const course = (courseId: string, title: string, credits = 3): CourseEntry => ({
    courseId,
    title,
    credits,
    term: { season: 'fall', year: 2026 },
    grade: 'A',
    origin: 'nd',
  });

  // §4.4.1 puts no department limit on a core course ("an Operating Systems
  // course, an Algorithms course, and a Computer Architecture course, either
  // at Notre Dame or at their previous institution"), and Notre Dame's own
  // architecture course may well be EE's. The core row keys its "pending
  // review" path off `unknown`, which the non-CSE branch never set — so the
  // student was told "No Computer Architecture course yet" while holding one.
  it('an unlisted non-CSE course with a core-area title reaches §4.4.1', () => {
    const report = audit(nonCseStudent([course('EE 60566', 'Advanced Computer Architecture')]), buildRules(), '2027-06-01');
    const row = report.requirements.find((r) => r.id === 'phd.qualifier.core.architecture');
    assert.equal(row?.status, 'needs_dgs_review');
    assert.match(row!.detail, /Pending review: EE 60566/);
    assert.match(row!.detail, /Computer Architecture/);
  });

  it('the same course is in the review request, named as both unlisted and needing approval', () => {
    const s = nonCseStudent([course('EE 60566', 'Advanced Computer Architecture')]);
    const pending = coursesNeedingDgsReview(s, buildRules());
    assert.equal(pending.length, 1);
    assert.equal(pending[0]!.unlisted, true, 'it needs a new Courses-tab row');
    assert.match(pending[0]!.reason, /not in the course rules yet/);
    assert.match(pending[0]!.reason, /outside CSE|non-CSE course/);
  });

  // CLAUDE.md: "A missing parameter renders 'cannot evaluate', never a
  // default." The allocator's room was `limit ?? 0`, so a cap the sheet does
  // not give read as ZERO: the cap row said "cannot evaluate" while every
  // non-CSE course was painted red "over the ?-credit non-CSE cap".
  it('a cap the Parameters tab is missing is unknown, not zero', () => {
    const rules = buildRules({ parameters: { phd_noncse_6xxxx_credits_max: null } });
    const report = audit(nonCseStudent([course('MATH 60610', 'Applied Mathematics')], { dgsApprovedNonCse: true }), rules, '2027-06-01');
    assert.equal(report.requirements.find((r) => r.id === 'phd.cap.noncse')?.status, 'cannot_evaluate');
    const line = report.courseLines.find((l) => l.courseId === 'MATH 60610');
    assert.equal(line?.mark, 'pending', 'amber, not a red "over the cap"');
    assert.doesNotMatch(line!.text, /over the/);
    assert.match(line!.text, /does not say what the non-CSE cap is/);
    assert.match(line!.text, /ask the DGS/);
  });

  // "counts" is third-person; only "would count" / "will count" take the bare
  // verb. A passed course partly over a cap read "count 1 of 4 credits".
  it('a course partly over the cap keeps its verb (an unlisted non-CSE course is provisional since 2026-09-27 — no tick settles it)', () => {
    const courses = [course('MATH 60610', 'A', 4), course('ACMS 60842', 'B', 4), course('EE 60566', 'C', 4)];
    const report = audit(nonCseStudent(courses), buildRules(), '2027-06-01');
    const partial = report.courseLines.find((l) => /of 4 credits/.test(l.text));
    assert.ok(partial, 'one course should be partly over the 9-credit cap');
    assert.match(partial!.text, /^waiting for the DGS — would count 1 of 4 credits toward regular courses and 3 toward the total-credit requirement only/);
    assert.match(partial!.text, /over the 9-credit non-CSE cap \(§4\.2\) — the allowance limits regular-course credit, not the total/);
  });
});

// Which transferred courses are CSE (DGS 2026-09-09). §4.2 caps credits "taken
// from a department other than CSE" at nine, and another university's
// transcript names the department every way there is — CS, CompSci, CSCI,
// CSYE, ECE, CE — several of which mean CSE at one school and not at another.
describe('is a transferred course a CSE course?', () => {
  const rule = (isCse?: boolean) => ({ university: 'X', universityKey: 'x', courseId: 'ECE 60146', title: '', sheetRow: 2, ...(isCse === undefined ? {} : { isCse }) });
  const codes = ['CS', 'CSCI', 'COMPSCI', 'CSYE'];

  it('reads the subject code however it is punctuated or cased', () => {
    assert.equal(subjectCode('CompSci 537'), 'COMPSCI');
    assert.equal(subjectCode('CS-503'), 'CS');
    assert.equal(subjectCode('csye 6200'), 'CSYE');
    assert.equal(subjectCode('60610'), '');
  });

  // Rutgers numbers its courses school:subject:course, and its subject is a
  // number — 198 is Computer Science (DGS 2026-10-16), which the list names
  // as "198".
  it('a school:subject:course code (Rutgers) has its middle number for a subject', () => {
    assert.equal(subjectCode('01:198:344'), '198');
    assert.equal(subjectCode('16:198:507'), '198');
    assert.equal(subjectCode(' 14 : 332 : 345 '), '332');
    for (const digitsOnly of ['60610', '30240233', '198:344', '01:198:3440', '198']) assert.equal(subjectCode(digitsOnly), '', digitsOnly);
    const withRutgers = [...codes, '198'];
    assert.equal(isCseCourse('16:198:507', undefined, withRutgers), true);
    assert.equal(isCseCourse('01:198:344', undefined, withRutgers), true);
    assert.equal(isCseCourse('16:640:501', undefined, withRutgers), false, 'Mathematics is not on the list');
    assert.equal(isCseCourse('16:198:507', undefined, codes), false, 'without 198 on the list, outside CSE as before');
    assert.equal(isCseCourse('16:198:507', rule(false), withRutgers), false, 'is_cse still wins');
    // The sheet's cell reads a number like any code.
    assert.deepEqual(buildRules({ parameters: { cse_subject_codes: 'CS; ECE; 198;' } }).parameters.codeList('cse_subject_codes'), ['CS', 'ECE', '198']);
  });

  it('the sheet\u2019s code list decides, and a code it does not name is outside CSE', () => {
    assert.equal(isCseCourse('CS 50300', undefined, codes), true);
    assert.equal(isCseCourse('CompSci 537', undefined, codes), true);
    assert.equal(isCseCourse('ECE 60146', undefined, codes), false);
    assert.equal(isCseCourse('MENG 50100', undefined, codes), false);
  });

  it('a per-course is_cse ruling wins over the list, both ways', () => {
    assert.equal(isCseCourse('ECE 60146', rule(true), codes), true, 'this ECE department teaches computing');
    assert.equal(isCseCourse('CS 59000', rule(false), codes), false, 'and a CS-coded course need not be one');
  });

  // Without the list the app knows nothing about departments elsewhere, and
  // says so by leaving the allowance off the course — never by guessing.
  it('no list in the sheet means no answer at all', () => {
    assert.equal(isCseCourse('ECE 60146', undefined, undefined), undefined);
    assert.equal(isCseCourse('ECE 60146', rule(true), undefined), true, 'a ruling still stands on its own');
  });

  // A blank cell must not read as "no code means CSE" — that would put every
  // transferred course inside the nine-credit allowance on an empty cell.
  it('a blank cse_subject_codes cell reads as no answer, not as an empty list', () => {
    const rules = buildRules({ parameters: { cse_subject_codes: '' } });
    assert.equal(rules.parameters.codeList('cse_subject_codes'), undefined);
    assert.equal(rules.parameters.codeList('nope'), undefined);
    // The fixture carries the live sheet's own list (DGS 2026-09-18: the live
    // sheet always wins) — ECE joined it when the DGS ruled it a computing
    // department code, and Rutgers' 198 (Computer Science) on 2026-10-16.
    assert.deepEqual(buildRules().parameters.codeList('cse_subject_codes'), ['CS', 'CSCI', 'COMPSCI', 'CSE', 'CMSC', 'EECS', 'CSYE', 'ECE', '198']);
  });
});

// Transition to Computing bridge courses for a Ph.D. student (§3.6). The
// handbook writes §3.6 for the MSCSE — "CSE 50xxx courses are preparatory and
// do not count toward the MSCSE degree requirements in §3.1-3.5" — and says
// nothing about a Ph.D. student required to take them; the sheet decides,
// course by course (DGS 2026-09-03 for CSE 50502). The block runs on that
// live row itself — dgs_approval for the Ph.D., no for the MSCSE — so the
// two sides below are the sheet's own cells, not an invented pair.
describe('50000-level bridge courses', () => {
  // §3.6.1's own guard (DGS 2026-10-03, P1-levels-grades-credits-4): on the
  // MSCSE tab a CSE 5xxxx course is refused whatever the sheet's cell says, so
  // a future sheet edit cannot contradict the handbook. The Ph.D. side still
  // follows the cell.
  it('the MSCSE refuses a 50000-level CSE course even when the sheet says yes (§3.6.1)', () => {
    const rules = buildRules({ courses: [{ course_id: 'CSE 50502', set: { counts_toward_mscse: 'yes' } }] });
    const ms: Student = { ...phdStudent({ bachelorsAwarded: { season: 'spring', year: 2026 }, gpa: 3.5, courses: [{ courseId: 'CSE 50502', credits: 3, term: { season: 'fall', year: 2026 }, grade: 'A', origin: 'nd' }] }), program: 'mscse' };
    const line = audit(ms, rules, '2027-06-01').courseLines.find((l) => l.courseId === 'CSE 50502')!;
    assert.equal(line.mark, 'excluded');
    assert.match(line.text, /^not counted — a 50000-level CSE course is preparatory and does not count toward the MSCSE, whatever the course rules say \(§3\.6\.1\)/);
    assert.equal(audit(ms, rules, '2027-06-01').requirements.find((r) => r.id === 'ms.credits.regular')?.detail.startsWith('0 of 24'), true);
    // The Ph.D. is untouched: dgs_approval on the live row, cleared by the tick.
    const phd = phdStudent({ bachelorsAwarded: { season: 'spring', year: 2026 }, gpa: 3.5, courses: [{ courseId: 'CSE 50502', credits: 3, term: { season: 'fall', year: 2026 }, grade: 'A', origin: 'nd', dgsApproved: true }] });
    assert.match(audit(phd, rules, '2027-06-01').courseLines.find((l) => l.courseId === 'CSE 50502')!.text, /^counts toward regular courses \(3 cr\)/);
  });
  const bridgeStudent = (attestations: Student['attestations'] = {}): Student => phdStudent({
    bachelorsAwarded: { season: 'spring', year: 2026 },
    gpa: 3.5,
    courses: [{ courseId: 'CSE 50502', credits: 3, term: { season: 'fall', year: 2026 }, grade: 'A', origin: 'nd' }],
    attestations,
  });

  // The checkbox was renamed to "courses below the 60000 level" when the DGS
  // put both levels under one cap (2026-09-09), but it still only cleared
  // level 4 — so the one bridge course the sheet permits could never be
  // approved, and stayed amber and in the review request for good.
  it('the tick on a 50000-level course the sheet decides case by case clears it (per course since 2026-09-27)', () => {
    const before = audit(bridgeStudent(), buildRules(), '2027-06-01');
    assert.equal(before.requirements.find((r) => r.id === 'phd.credits.regular')?.status, 'unmet');
    assert.match(before.courseLines.find((l) => l.courseId === 'CSE 50502')!.text, /needs advisor \+ DGS approval/);
    assert.equal(before.courseLines.find((l) => l.courseId === 'CSE 50502')!.approvable, true, 'the row offers the tick');

    const ticked = bridgeStudent();
    ticked.courses[0]!.dgsApproved = true;
    const after = audit(ticked, buildRules(), '2027-06-01');
    const line = after.courseLines.find((l) => l.courseId === 'CSE 50502');
    assert.equal(line?.mark, 'counts');
    assert.equal(line?.approved, true);
    assert.match(line!.text, /^counts toward regular courses \(3 cr\)/);
    assert.match(after.requirements.find((r) => r.id === 'phd.credits.regular')!.detail, /3 of 24/);
    assert.equal(coursesNeedingDgsReview(ticked, buildRules()).length, 0);
    // The old record-level box no longer settles anything.
    assert.equal(audit(bridgeStudent({ dgsApproved4xxxx: true }), buildRules(), '2027-06-01').courseLines.find((l) => l.courseId === 'CSE 50502')?.mark, 'pending');
  });

  // The line names the course's OWN level: the cap covers both, and a bridge
  // course was telling the student it used "the 40000-level allowance".
  it('the allowance line names the level the course is at', () => {
    const after = audit(bridgeStudent({ dgsApproved4xxxx: true }), buildRules(), '2027-06-01');
    assert.match(after.courseLines.find((l) => l.courseId === 'CSE 50502')!.text, /uses the 50000-level allowance \(6 credits, §4\.2\)/);
  });

  // §3.6.1 for the MSCSE, straight from the sheet's counts_toward_mscse = no.
  it('the same course counts nothing toward the MSCSE', () => {
    const ms = audit({ ...bridgeStudent({ dgsApproved4xxxx: true }), program: 'mscse' }, buildRules(), '2027-06-01');
    assert.match(ms.courseLines.find((l) => l.courseId === 'CSE 50502')!.text, /does not count toward the MSCSE/);
    assert.match(ms.requirements.find((r) => r.id === 'ms.credits.total')!.detail, /0 of 30/);
  });

  // §4.3 residence counts REGISTERED credits, not credits that count toward
  // the degree — a bridge semester is still a full-time semester.
  it('a bridge semester still counts toward residence', () => {
    const s = bridgeStudent();
    s.courses = ['CSE 50502', 'CSE 60641', 'CSE 60111'].map((courseId) => ({
      courseId, credits: 3, term: { season: 'fall', year: 2026 }, grade: 'A', origin: 'nd' as const,
    }));
    assert.match(audit(s, buildRules(), '2027-06-01').requirements.find((r) => r.id === 'phd.residency')!.detail, /1 of 4 semesters/);
  });
});

// The two tracks this audit does not model (§3.5, §3.6). Promised 2026-08-31
// ("students on those tracks see a clearly-worded 'talk to the DGS' note"),
// built 2026-09-10. Recognised from the coursework, never asked for.
describe('§3.5 / §3.6 track notes', () => {
  const rules = buildRules();
  const student = (courses: CourseEntry[], over: Partial<Student> = {}): Student =>
    phdStudent({ bachelorsAwarded: { season: 'spring', year: 2026 }, gpa: 3.5, courses, ...over });
  const course = (courseId: string, year = 2026, season: 'fall' | 'spring' = 'fall'): CourseEntry => ({
    courseId, credits: 3, term: { season, year }, grade: 'A', origin: 'nd',
  });
  const tracksOf = (s: Student) => specialTracks(s, classify(s, rules).classified);

  it('a bridge course raises the §3.6 note, and says something different to each program', () => {
    const phd = tracksOf(student([course('CSE 50502')]));
    assert.deepEqual(phd.map((t) => t.id), ['transition']);
    assert.match(phd[0]!.text, /ask them/i);
    const ms = tracksOf(student([course('CSE 50502')], { program: 'mscse' }));
    assert.match(ms[0]!.text, /do not count toward the MSCSE degree requirements/);
  });

  it('an unlisted 50000-level CSE course raises it too — the sheet need not know the course', () => {
    assert.deepEqual(tracksOf(student([course('CSE 59999')])).map((t) => t.id), ['transition']);
  });

  it('ordinary coursework raises nothing', () => {
    assert.deepEqual(tracksOf(student([course('CSE 60641'), course('CSE 40113')])), []);
  });

  it('a graduate course taken before the bachelor’s degree raises the §3.5 note', () => {
    const s = student([course('CSE 60641', 2026, 'spring')]); // awarded Spring 2026
    assert.deepEqual(tracksOf(s).map((t) => t.id), ['integrated']);
    // A year later, after the degree, it is ordinary coursework.
    assert.deepEqual(tracksOf(student([course('CSE 60641', 2027, 'spring')])), []);
    // And with no award term recorded the app says nothing rather than guessing.
    assert.deepEqual(tracksOf(student([course('CSE 60641', 2026, 'spring')], { bachelorsAwarded: undefined })), []);
  });

  it('both at once — a 4+1 who then needs bridge courses', () => {
    const s = student([course('CSE 60641', 2026, 'spring'), course('CSE 50502')]);
    assert.deepEqual(tracksOf(s).map((t) => t.id), ['transition', 'integrated']);
    assert.deepEqual(audit(s, rules, '2027-06-01').tracks.map((t) => t.section), ['§3.6', '§3.5']);
  });
});

// Notre Dame coursework taken as an UNDERGRADUATE, under the Graduate School's
// answer (through the DGS, 2026-09-10 evening): 60000-level and above counts
// toward the Ph.D. in full — "even those above and beyond the usual 24 allowed
// for transfer" — below it inside §4.2's six credits, and no course may count
// toward three degrees.
describe('undergraduate Notre Dame coursework', () => {
  const rules = buildRules();
  const student = (courses: CourseEntry[], over: Partial<Student> = {}): Student => phdStudent({
    integratedBsMs: true, // a 4+1 unless a test says otherwise (DGS 2026-09-12)
    integratedAdmitted: { season: 'spring', year: 2025 }, // before the bachelor's — the extras may count (2026-10-04)
    bachelorsAwarded: { season: 'spring', year: 2025 },
    gpa: 3.8,
    courses,
    ...over,
  });
  // Registered GR: the transcript's evidence that a 4+1's extra graduate course
  // was moved from UG to GR before the bachelor's was conferred (Graduate
  // School 4+1 guidance; policy review 2026-10-03) — the clean path these
  // tests exercise. A UG-registered row waits for the DGS (its own test below).
  const ug = (courseId: string, countedToward?: CourseEntry['countedToward'], institution = 'University of Notre Dame'): CourseEntry => ({
    courseId, credits: 3, term: { season: 'fall', year: 2024 }, grade: 'A', origin: 'transfer',
    institution, degreeLevel: 'bachelors', registeredLevel: 'graduate', countedToward,
  });
  const held = { ndMasters: { term: { season: 'spring' as const, year: 2026 } }, priorMs: 'completed' as const };
  const report = (s: Student) => audit(s, rules, '2027-06-01');
  const lineFor = (s: Student, id: string) => report(s).courseLines.find((l) => l.courseId === id)!.text;
  const detail = (s: Student, id: string) => report(s).requirements.find((r) => r.id === id)!.detail;

  it('a 60000-level course counts in full, and outside the §5.2 cap', () => {
    const s = student([ug('CSE 60641', 'neither'), ug('CSE 60111', 'neither')]);
    assert.match(lineFor(s, 'CSE 60641'), /^counts toward regular courses \(3 cr\)/);
    assert.match(detail(s, 'phd.credits.regular'), /6 of 24/);
    assert.match(detail(s, 'phd.credits.total'), /6 of 60/);
    assert.match(detail(s, 'phd.transfer'), /No transfer courses entered/, 'this is not transfer credit');
  });

  // The UG→GR move (Graduate School 4+1 guidance: the extras "must be … moved
  // from undergraduate level (UG) to graduate level (GR)" and transferred
  // "before the students' bachelor's degree is awarded"): a row the transcript
  // still registers UG is counted provisionally and sent to the DGS (2026-10-03).
  it('a 60000-level course the transcript still registers UG waits for the DGS — the UG→GR move is not shown', () => {
    const s = student([{ ...ug('CSE 60641', 'neither'), registeredLevel: 'undergraduate' }]);
    assert.match(lineFor(s, 'CSE 60641'), /^waiting for the DGS — would count toward regular courses \(3 cr\) once approved; .*moved from undergraduate \(UG\) to graduate \(GR\) registration/);
    assert.match(detail(s, 'phd.credits.regular'), /0 of 24 credits complete\. 3 pending review\/approval/);
    assert.ok(coursesNeedingDgsReview(s, rules).some((p) => p.course.entry.courseId === 'CSE 60641' && p.ask.decide.some((d) => /UG to GR/.test(d))), 'in the review request');
  });

  it('a regular bachelor’s (not a 4+1) is routed to the DGS for the same course on the Ph.D. tab — the Academic Code (§4.6) allows it with the program’s advance approval (2026-10-03); it still serves §4.4.1 and §4.4.2', () => {
    const s = student([ug('CSE 60641', 'neither'), ug('CSE 60111', 'neither')], { integratedBsMs: undefined });
    assert.match(lineFor(s, 'CSE 60641'), /^waiting for the DGS — would count toward regular courses \(3 cr\) once approved; not used by an earlier degree; taken as an undergraduate outside the Integrated 4\+1 program — the Academic Code \(§4\.6\) lets it meet Ph\.D\. requirements only with the program’s advance approval; the DGS decides\. If you were in the 4\+1, say so in the earlier-degrees questions in the Transcripts card/);
    assert.match(detail(s, 'phd.credits.regular'), /0 of 24 credits complete\. 6 pending review\/approval/);
    assert.match(detail(s, 'phd.qualifier.core.os'), /Satisfied by CSE 60641 \(Notre Dame, before entering the program\)/);
    assert.match(detail(s, 'phd.qualifier.categories'), /2 qualifying courses covering 2 distinct groups/);
    const answeredNo = student([ug('CSE 60641', 'neither')], { integratedBsMs: false });
    assert.doesNotMatch(lineFor(answeredNo, 'CSE 60641'), /say so in the earlier-degrees questions/, 'an answered "No" is not nagged');
    // The MSCSE keeps the refusal: §3.5 grants the benefit to integrated students only.
    const ms = student([ug('CSE 60641')], { program: 'mscse', integratedBsMs: undefined, bachelorsAwarded: { season: 'spring', year: 2025 } });
    assert.match(lineFor(ms, 'CSE 60641'), /^not counted — a 60000-level course taken as an undergraduate earns MSCSE credit only for a student who was in the Integrated B\.S\. \+ M\.S\. \(4\+1\) program \(§3\.5\)/);
  });

  it('below the 60000 level it draws on §4.2’s six credits; below 40000 it counts nothing', () => {
    const s = student([ug('CSE 40113', 'neither'), ug('CSE 40567', 'neither'), ug('CSE 40243', 'neither'), ug('CSE 20110')]);
    assert.match(detail(s, 'phd.cap.fourk'), /6 of the 6 credits below the 60000 level used/);
    assert.match(lineFor(s, 'CSE 20110'), /not eligible for degree credit at the 20000-level — only CSE 40000-level courses/, 'a course that cannot count at any answer says why: its level (DGS 2026-09-22)');
  });

  // The Graduate School, through the DGS (2026-09-22): "Only up to 6 credits
  // may double-count towards two degrees. If 6 credits have double-counted to
  // BS & MS, no more credits can double-count to BS & PhD later when the
  // student pursues PhD." Until then a student with no Notre Dame master's was
  // never asked — nothing of theirs could have counted twice.
  it('a student with no Notre Dame master’s is asked whether the bachelor’s degree used the course; “bs” draws the six credits, “neither” counts in full', () => {
    const asked = student([ug('CSE 60641')]);
    assert.match(lineFor(asked, 'CSE 60641'), /^not counted yet — say, next to the course, whether your bachelor’s degree used this course(?:$|;)/);
    assert.equal(report(asked).courseLines.find((l) => l.courseId === 'CSE 60641')?.mark, 'pending');
    assert.match(lineFor(student([ug('CSE 60641', 'neither')]), 'CSE 60641'), /^counts toward regular courses \(3 cr\); counted on the course rules’ yes, which is the program’s advance approval for graduate coursework taken as an undergraduate \(Academic Code §4\.6\); not used by an earlier degree — counts in full/);
    const three = student([ug('CSE 60641', 'bs'), ug('CSE 60111', 'bs'), ug('CSE 60321', 'bs')]);
    // Same term, same grade: the allocator fills in course-id order, so the
    // highest-numbered of the three is the one over the allowance. A course
    // the bachelor's used counts PROVISIONALLY since 2026-10-03: the Academic
    // Code's §4.6 writes the six-credit exception for an integrated
    // bachelor's/master's program, and the BS + Ph.D. six rests on the
    // Graduate School's 2026-09-22 answer — so the DGS confirms each.
    assert.match(lineFor(three, 'CSE 60111'), /^waiting for the DGS — would count toward regular courses \(3 cr\) once approved; counts toward both your bachelor’s degree and the Ph\.D\. — inside the 6 credits that may count toward two degrees \(Graduate School\); the Graduate School’s 2026-09-22 answer to the department allows the sharing, but the Academic Code does not yet state it/);
    assert.match(lineFor(three, 'CSE 60641'), /^not counted — over the 6-credit allowance for coursework counted toward two degrees \(Graduate School\)/);
    assert.match(detail(three, 'phd.cap.sharedbs'), /6 of the 6 credits that may still count toward both your bachelor’s degree and the Ph\.D\. used/);
    assert.equal(report(three).requirements.find((r) => r.id === 'phd.cap.sharedbs')?.status, 'needs_dgs_review');
    assert.match(detail(three, 'phd.credits.regular'), /0 of 24 credits complete\. 6 pending review\/approval/);
    // No course draws on the allowance → no row.
    assert.equal(report(student([ug('CSE 60641', 'neither')])).requirements.find((r) => r.id === 'phd.cap.sharedbs'), undefined);
  });

  it('a 4+1 whose bachelor’s-and-MSCSE courses used the six credits has none left for a bachelor’s-only course', () => {
    const s = student([ug('CSE 60641', 'both'), ug('CSE 60111', 'both'), ug('CSE 60321', 'bs'), ug('CSE 60770', 'mscse')], held);
    assert.match(lineFor(s, 'CSE 60321'), /^not counted — over the allowance for coursework counted toward two degrees — 6 of its 6 credits already used by the courses counted toward your bachelor’s degree and your MSCSE \(Graduate School\)/);
    // MSCSE coursework is Ph.D. coursework (DGS 2026-10-03: one graduate program).
    assert.match(lineFor(s, 'CSE 60770'), /counted toward your MSCSE — counts in full as Ph\.D\. coursework/);
    assert.match(detail(s, 'phd.cap.sharedbs'), /0 of the 0 credits that may still count toward both your bachelor’s degree and the Ph\.D\. used/);
    assert.match(detail(s, 'phd.cap.sharedbs'), /All 6 shared credits were used by the courses you said counted toward both your bachelor’s degree and your MSCSE/);
    // One 'both' course (3 credits) leaves three: the 'bs' course fits — provisionally (2026-10-03).
    const half = student([ug('CSE 60641', 'both'), ug('CSE 60321', 'bs')], held);
    assert.match(lineFor(half, 'CSE 60321'), /^waiting for the DGS — would count toward regular courses \(3 cr\) once approved; counts toward both your bachelor’s degree and the Ph\.D\./);
    assert.match(detail(half, 'phd.cap.sharedbs'), /3 of the 3 credits that may still count toward both your bachelor’s degree and the Ph\.D\. used/);
  });

  it('a student who HOLDS the MSCSE is asked, and nothing counts until they answer', () => {
    const s = student([ug('CSE 60641')], held);
    assert.match(lineFor(s, 'CSE 60641'), /^not counted yet — say which degrees/);
    assert.equal(report(s).courseLines.find((l) => l.courseId === 'CSE 60641')?.mark, 'pending', 'amber: it waits on them, not on us');
    assert.match(detail(s, 'phd.credits.regular'), /0 of 24/);
  });

  it('“both” is the one answer that stops it — no course counts toward three degrees', () => {
    const both = student([ug('CSE 60641', 'both')], held);
    assert.match(lineFor(both, 'CSE 60641'), /already counted toward your bachelor’s degree AND your master’s/);
    assert.match(detail(both, 'phd.credits.regular'), /0 of 24/);
    for (const answer of ['mscse', 'neither'] as const) {
      const s = student([ug('CSE 60641', answer)], held);
      assert.match(lineFor(s, 'CSE 60641'), /^counts toward regular courses/, `answer ${answer} should count`);
    }
    // 'bs' counts too, provisionally — the BS + Ph.D. double count waits for the DGS (2026-10-03).
    assert.match(lineFor(student([ug('CSE 60641', 'bs')], held), 'CSE 60641'), /^waiting for the DGS — would count toward regular courses/);
  });

  it('§4.4.1 and §4.4.2 come with the credit', () => {
    const s = student([ug('CSE 60641', 'neither'), ug('CSE 60111', 'neither'), ug('CSE 60321', 'neither')]);
    assert.equal(report(s).requirements.find((r) => r.id === 'phd.qualifier.core.os')?.status, 'met');
    assert.match(detail(s, 'phd.qualifier.categories'), /3 distinct groups/);
  });

  it('a course from ANOTHER university taken before the degree is untouched by any of this', () => {
    const s = student([ug('CS 50300', undefined, 'Purdue University')]);
    assert.match(lineFor(s, 'CS 50300'), /^not counted — taken as an undergraduate \(§5\.2\)/);
  });

  // The MSCSE side of the same transcript (DGS 2026-09-11). The question a
  // student in the MSCSE can actually answer is about two degrees, not three,
  // and a 40000-level course of theirs MAY count — listed for the DGS, never
  // counted silently, and citing §3.2 rather than the Ph.D.'s §4.2.
  describe('an MSCSE student’s own undergraduate transcript', () => {
    const ms = (courses: CourseEntry[], over: Partial<Student> = {}) =>
      student(courses, { program: 'mscse', bachelorsAwarded: { season: 'spring', year: 2026 }, ...over });
    // DGS 2026-09-11: the student is never asked; the app applies the top two
    // 40000-level CSE courses to both degrees, saves 60000-level coursework for
    // the MSCSE, and says on each line what it WILL apply to.
    it('never asks — the Ph.D. holder of an ND master’s still is', () => {
      assert.doesNotMatch(lineFor(ms([ug('CSE 40113')]), 'CSE 40113'), /not counted yet/);
      assert.match(lineFor(student([ug('CSE 40113')], held), 'CSE 40113'), /^not counted yet — say which degrees this course has already counted toward/);
    });
    it('the two best 40000-level courses apply to both degrees; a third, and every 60000-level course, to the MSCSE only', () => {
      const senior = { season: 'fall' as const, year: 2025 };
      const s = ms([{ ...ug('CSE 40113'), grade: 'A' }, { ...ug('CSE 40567'), grade: 'B' }, { ...ug('CSE 40243'), grade: 'A-' }, { ...ug('CSE 60641'), term: senior }, { ...ug('CSE 60111'), term: senior }], { attestations: { dgsApproved4xxxx: true } });
      assert.match(lineFor(s, 'CSE 40113'), /will apply to both your bachelor’s degree and your MSCSE/);
      assert.match(lineFor(s, 'CSE 40243'), /will apply to both your bachelor’s degree and your MSCSE/); // A- beats B
      assert.match(lineFor(s, 'CSE 40567'), /^not counted — over the 6-credit cap on courses below the 60000 level \(§3\.2\)/); // the B: third 40xxx, over §3.2's six
      assert.match(lineFor(s, 'CSE 60641'), /^counts toward regular courses \(3 cr\); counted on the course rules’ yes, which is the program’s advance approval for graduate coursework taken as an undergraduate \(Academic Code §4\.6\); will apply to your MSCSE only$/);
      assert.match(detail(s, 'ms.cap.sharedbs'), /6 of the 6 credits shared with your bachelor’s degree used/);
    });
    it('with no 40000-level course the shared credits come from 60000-level coursework, earliest first', () => {
      const s = ms([{ ...ug('CSE 60641'), term: { season: 'fall', year: 2025 } }, { ...ug('CSE 60111'), term: { season: 'spring', year: 2026 } }, { ...ug('CSE 60321'), term: { season: 'spring', year: 2026 } }]);
      assert.match(lineFor(s, 'CSE 60641'), /will apply to both/);
      assert.match(lineFor(s, 'CSE 60111'), /will apply to both/);
      assert.match(lineFor(s, 'CSE 60321'), /will apply to your MSCSE only/);
    });
    // CSE 40437 is the fixture's 40000-level row that says adgs_approval for
    // the MSCSE; CSE 40113 used to play this part, but the live sheet says
    // plain yes for it, and a yes needs no one's approval (DGS 2026-09-18).
    it('a 40000-level course the sheet gates on approval is provisional until its own box is ticked (per course since 2026-09-27)', () => {
      const s = ms([ug('CSE 40437')]);
      assert.match(lineFor(s, 'CSE 40437'), /^waiting for the ADGS — would count toward regular courses \(3 cr\) once approved; uses the 40000-level allowance \(6 credits, §3\.2\); will apply to both/); // the ADGS decides for the MSCSE (2026-09-11)
      assert.match(lineFor(ms([{ ...ug('CSE 40437'), dgsApproved: true as const }]), 'CSE 40437'), /^counts toward regular courses \(3 cr\); uses the 40000-level allowance \(6 credits, §3\.2\); approved by the ADGS for you, as you ticked on the course \(the course rules say case by case; the ADGS office holds the record\); will apply to both/);
    });
  });

  // The three places that decide whether a row is worth showing — the preview,
  // the coursework table and the report — ask the engine, not their own copy
  // of the level rules (2026-09-11).
  describe('priorNdUndergraduateCanCount', () => {
    const can = (courseId: string, program: Student['program'] = 'mscse') =>
      priorNdUndergraduateCanCount(ug(courseId), resolveRuleRow(rules, courseId, { season: 'fall', year: 2024 }), program);
    it('a CSE course at or above the 40000 level can; a lower one cannot', () => {
      assert.equal(can('CSE 40113'), true);
      assert.equal(can('CSE 60641'), true);
      assert.equal(can('CSE 20110'), false);
      assert.equal(can('MATH 10550'), false);
    });
    it('the sheet’s "no" is final, per program', () => {
      assert.equal(can('CSE 40600'), false); // no for both degrees — the role CSE 40437 held until the live sheet turned it into an approval (2026-09-18)
      assert.equal(can('CSE 50502', 'mscse'), false); // no for the MSCSE
      assert.equal(can('CSE 50502', 'phd'), true); // dgs_approval for the Ph.D.
    });
    it('a course missing from the sheet can still count, provisionally', () => {
      assert.equal(can('CSE 69999'), true);
      assert.equal(can('MATH 60610'), true);
    });
  });
});

// Red-team F8 (DGS 2026-09-12): no course below the 40000 level earns graduate
// credit, and a 4+1 with many undergraduate graduate-level courses is flagged
// for the DGS rather than asked.
describe('below the 40000 level, and the 4+1 flag (F8, 2026-09-12)', () => {
  const rules = buildRules();
  const base = (courses: CourseEntry[], over: Partial<Student> = {}): Student =>
    phdStudent({ bachelorsAwarded: { season: 'spring', year: 2026 }, gpa: 3.8, courses, ...over });
  it('an unlisted CSE 30124 or CSE 10101 typed as program coursework is refused, not counted provisionally', () => {
    const r = audit(base([{ courseId: 'CSE 30124', credits: 3, term: { season: 'fall', year: 2026 }, grade: 'A', origin: 'nd' }, { courseId: 'CSE 10101', credits: 3, term: { season: 'fall', year: 2026 }, grade: 'A', origin: 'nd' }]), rules, '2027-06-01');
    for (const id of ['CSE 30124', 'CSE 10101']) {
      const l = r.courseLines.find((c) => c.courseId === id)!;
      // Academic Code §4.1, like the listed-row refusals (second reconciliation pass, 2026-10-03).
      assert.match(l.text, /^not counted — below the 40000 level; no course under 40000 earns graduate credit \(Academic Code §4\.1\)/, id);
    }
    assert.match(r.requirements.find((q) => q.id === 'phd.credits.regular')!.detail, /0 of 24/);
  });
  it('a Ph.D. 4+1 with undergraduate 6xxxx courses is not flagged (the flag is the MSCSE’s, P3-text-engine-3)', () => {
    const ug = (id: string, season: 'fall' | 'spring', year: number): CourseEntry => ({ courseId: id, credits: 3, term: { season, year }, grade: 'A', origin: 'transfer', institution: 'University of Notre Dame', degreeLevel: 'bachelors', registeredLevel: 'graduate', countedToward: 'neither' });
    const two = audit(base([ug('CSE 60641', 'fall', 2025), ug('CSE 60111', 'spring', 2026)], { integratedBsMs: true }), rules, '2027-06-01');
    assert.deepEqual(two.reviewFlags ?? [], []);
    // A Ph.D. record is not flagged since policy review round 3 (P3-text-engine-3):
    // the student answers per course, and the six-credit cap line says what counts.
    const three = audit(base([ug('CSE 60641', 'fall', 2025), ug('CSE 60111', 'spring', 2026), ug('CSE 60321', 'spring', 2026)], { integratedBsMs: true }), rules, '2027-06-01');
    assert.deepEqual(three.reviewFlags ?? [], []);
    // A regular bachelor's counts none of them, so nothing is flagged.
    const plain = audit(base([ug('CSE 60641', 'fall', 2025), ug('CSE 60111', 'spring', 2026), ug('CSE 60321', 'spring', 2026)]), rules, '2027-06-01');
    assert.deepEqual(plain.reviewFlags ?? [], []);
  });
});

// Two entries the app counts as given but will not stay silent about (DGS
// 2026-09-13, answering a red-team pass): the same course twice in one term
// from different origins, and a final grade for a semester still in the future.
describe('suspect course entries the report warns about', () => {
  const rules = buildRules();
  const base = (courses: CourseEntry[]): Student => phdStudent({
    priorMs: 'completed',
    bachelorsAwarded: { season: 'spring', year: 2022 },
    gpa: 3.5,
    courses,
    attestations: { transferApproved: true },
  });

  it('the same course id in one term from two origins is flagged, and both rows still count', () => {
    const report = audit(
      base([
        { courseId: 'CSE 60641', credits: 3, term: { season: 'fall', year: 2026 }, grade: 'A', origin: 'nd' },
        {
          courseId: 'CSE 60641', credits: 3, term: { season: 'fall', year: 2026 }, grade: 'A',
          origin: 'transfer', institution: 'Purdue University', degreeLevel: 'masters',
        },
      ]),
      rules,
      '2027-06-01',
    );
    assert.ok(
      report.warnings.some((w) => /entered 2 times for Fall 2026, under different origins/.test(w)),
      JSON.stringify(report.warnings),
    );
    // Credit is NOT de-duplicated across origins (2026-08-31) — the warning is
    // the whole change. The Notre Dame row counts now; the unreviewed transfer
    // row is pending the DGS, and both are there.
    assert.match(
      report.requirements.find((r) => r.id === 'phd.credits.regular')!.detail,
      /3 of 24 credits complete\. 3 pending/,
    );
  });

  it('two Notre Dame rows in one term keep the retake wording, without the new origins line', () => {
    const report = audit(
      base([
        { courseId: 'CSE 60641', credits: 3, term: { season: 'fall', year: 2026 }, grade: 'A', origin: 'nd' },
        { courseId: 'CSE 60641', credits: 3, term: { season: 'fall', year: 2026 }, grade: 'A', origin: 'nd' },
      ]),
      rules,
      '2027-06-01',
    );
    assert.ok(report.warnings.some((w) => /its credits count once/.test(w)), JSON.stringify(report.warnings));
    assert.ok(!report.warnings.some((w) => /different origins/.test(w)), JSON.stringify(report.warnings));
  });

  it('a final grade dated after today is counted, and says to check the term', () => {
    const report = audit(
      base([{ courseId: 'CSE 60641', credits: 3, term: { season: 'fall', year: 2030 }, grade: 'A', origin: 'nd' }]),
      rules,
      '2027-06-01',
    );
    assert.ok(
      report.warnings.some((w) => /dated Fall 2030, which is after Summer 2027/.test(w)),
      JSON.stringify(report.warnings),
    );
    assert.match(report.requirements.find((r) => r.id === 'phd.credits.regular')!.detail, /3 of 24/);
  });

  it('an in-progress course in a future term is normal registration, not a warning', () => {
    const report = audit(
      base([{ courseId: 'CSE 60641', credits: 3, term: { season: 'fall', year: 2027 }, grade: 'IP', origin: 'nd' }]),
      rules,
      '2027-06-01',
    );
    assert.ok(!report.warnings.some((w) => /check the term/.test(w)), JSON.stringify(report.warnings));
  });
});

// Two advisors (DGS 2026-09-22): one supervision, both named.
describe('two advisors', () => {
  const rules = buildRules();
  it('the §2.3 row names both, joined with "and"', () => {
    const s = phdStudent({ milestones: { advisorName: 'Prof. A', advisorName2: 'Prof. B', advisorTtt: 'yes' } });
    const row = audit(s, rules, '2027-06-01').requirements.find((r) => r.id === 'shared.advisor')!;
    assert.equal(row.status, 'met');
    assert.equal(row.detail, 'Advisors: Prof. A and Prof. B.');
    const one = audit(phdStudent({ milestones: { advisorName: 'Prof. A', advisorTtt: 'yes' } }), rules, '2027-06-01').requirements.find((r) => r.id === 'shared.advisor')!;
    assert.equal(one.detail, 'Advisor: Prof. A.');
  });
});

describe('a 4+1 MSCSE course before entry, the bachelor’s term not set (UI review 2026-10-08, P3-fourplusone-1)', () => {
  const rules = buildRules();
  it('waits for the bachelor’s term instead of pointing at the entry term', () => {
    const s: Student = {
      ...phdStudent(),
      program: 'mscse',
      entryTerm: { season: 'fall', year: 2025 },
      integratedBsMs: true,
      courses: [{ courseId: 'CSE 60111', credits: 3, term: { season: 'fall', year: 2024 }, grade: 'A', origin: 'transfer', institution: 'University of Notre Dame', degreeLevel: 'masters', registeredLevel: 'graduate' }],
    };
    const line = audit(s, rules, '2026-10-08').courseLines.find((l) => l.courseId === 'CSE 60111')!;
    assert.match(line.text, /^not counted yet — set the semester your bachelor’s degree was awarded/);
    assert.equal(line.mark, 'pending', 'waiting on an input, like the other “not counted yet” lines — it counts for nothing until then');
  });
});

// "The DGS approved this course for me" on Notre Dame coursework taken as an
// undergraduate (DGS 2026-10-08): offered where an approval the DGS gives for
// this student is pending, and settling it.
describe('the approval tick on undergraduate Notre Dame coursework (DGS 2026-10-08)', () => {
  const rules = buildRules();
  const student = (courses: CourseEntry[], over: Partial<Student> = {}): Student =>
    phdStudent({ integratedBsMs: true, integratedAdmitted: { season: 'spring', year: 2025 }, bachelorsAwarded: { season: 'spring', year: 2025 }, gpa: 3.8, courses, ...over });
  const ug = (courseId: string, extra: Partial<CourseEntry> = {}): CourseEntry => ({
    courseId, credits: 3, term: { season: 'fall', year: 2024 }, grade: 'A', origin: 'transfer', institution: 'University of Notre Dame', degreeLevel: 'bachelors', registeredLevel: 'graduate', countedToward: 'neither', ...extra,
  });
  const report = (s: Student) => audit(s, rules, '2027-06-01');
  const lineOf = (s: Student, id: string) => report(s).courseLines.find((l) => l.courseId === id)!;
  it('a UG-registered 60000-level course offers the tick; ticked, it counts and leaves the review request', () => {
    const waiting = student([ug('CSE 60641', { registeredLevel: 'undergraduate' })]);
    const before = lineOf(waiting, 'CSE 60641');
    assert.equal(before.approvable, true, 'the tick is offered');
    assert.equal(before.mark, 'pending');
    const ticked = student([ug('CSE 60641', { registeredLevel: 'undergraduate', dgsApproved: true })]);
    const after = lineOf(ticked, 'CSE 60641');
    assert.equal(after.approved, true);
    assert.equal(after.mark, 'counts');
    assert.match(after.text, /^counts toward regular courses \(3 cr\)/);
    assert.match(after.text, /approved by the DGS for you, as you ticked on the course \(the DGS office holds the record\)/);
    assert.ok(!coursesNeedingDgsReview(ticked, rules).some((p) => p.course.entry.courseId === 'CSE 60641'), 'out of the review request');
    assert.match(report(ticked).requirements.find((r) => r.id === 'phd.credits.regular')!.detail, /^3 of 24 credits complete/);
  });
  it('a regular bachelor’s (not a 4+1) course needing the Code’s advance approval: the tick gives it', () => {
    const s = student([ug('CSE 60641')], { integratedBsMs: false });
    assert.equal(lineOf(s, 'CSE 60641').approvable, true);
    const ticked = student([ug('CSE 60641', { dgsApproved: true })], { integratedBsMs: false });
    assert.match(lineOf(ticked, 'CSE 60641').text, /^counts toward regular courses \(3 cr\)/);
  });
  it('a course the bachelor’s used (“bs”): the tick confirms the BS + Ph.D. double count, inside the six', () => {
    const s = student([ug('CSE 60641', { countedToward: 'bs' })], { ndMasters: { term: { season: 'spring', year: 2026 } }, priorMs: 'completed' });
    assert.equal(lineOf(s, 'CSE 60641').approvable, true);
    assert.ok(coursesNeedingDgsReview(s, rules).some((p) => p.course.entry.courseId === 'CSE 60641' && p.ask.decide.some((d) => /count toward both my bachelor’s degree and the Ph\.D\./.test(d))));
    const ticked = student([ug('CSE 60641', { countedToward: 'bs', dgsApproved: true })], { ndMasters: { term: { season: 'spring', year: 2026 } }, priorMs: 'completed' });
    const line = lineOf(ticked, 'CSE 60641').text;
    assert.match(line, /^counts toward regular courses \(3 cr\)/);
    assert.match(line, /approved by the DGS for you, as you ticked on the course/);
    assert.match(line, /counts toward both your bachelor’s degree and the Ph\.D\. — inside the 6 credits/);
    assert.ok(!coursesNeedingDgsReview(ticked, rules).some((p) => p.course.entry.courseId === 'CSE 60641'));
  });
  it('a course the course rules do not list, or list with a blank verdict, offers no tick: the DGS enters the row first', () => {
    // CSE 60997 is in no fixture; CSE 60999 is the fixture's blank-verdict row.
    for (const id of ['CSE 60997', 'CSE 60999']) {
      const s = student([ug(id, { registeredLevel: 'undergraduate' })]);
      assert.equal(lineOf(s, id).approvable, undefined, id);
      assert.equal(lineOf(s, id).mark, 'pending', id);
      const ticked = student([ug(id, { registeredLevel: 'undergraduate', dgsApproved: true })]);
      assert.equal(lineOf(ticked, id).mark, 'pending', `${id} stays pending whatever a stale record ticked`);
    }
  });
});
