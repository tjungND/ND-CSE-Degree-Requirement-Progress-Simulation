// Policy review 2026-10-04 (DGS: "Apply the suggested fix"):
// P2-ac-1-3-6, P2-ac-4-10 — the audit grade V: on the record, earning nothing,
//   not a registration toward full-time status (Academic Code §2.4, §4.3; DGS
//   Handbook §3.12); the import keeps V/AU rows as V.
// P2-dh-3.21-3.24-2, -4, P2-dh-front-1-2-2 — the Application for Admission to
//   Master's Degree Candidacy (Academic Code §6.1.6; DGS Handbook §3.21.1): an
//   uncounted step once its conditions are in hand, a milestone date, an item
//   in the processing request and a next step.
// P2-dh-3.21-3.24-24 — the semester of graduation: registered for at least one
//   credit hour in it (a zero-credit course in a summer) — DGS Handbook §3.23.1.
// P2-ac-6.2-app-7, P2-dh-3.14-3.20-27, P2-dh-10-10 — a Graduate School
//   extension of the time limit, through the end of a term the student enters.
// P2-fourplusone-1 — the 4+1 admission term: beyond the six shared credits, a
//   course taken as an undergraduate counts only for a student admitted before
//   the bachelor's, and only from the admission term on.
// P2-dh-front-1-2-6 — a Notre Dame course entered as program coursework but
//   dated before the entry term is said, not silently counted.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { audit } from '../src/engine/audit.ts';
import { coursesNeedingDgsReview } from '../src/engine/review.ts';
import type { CourseEntry, Student, Term } from '../src/engine/types.ts';
import { parseTranscript } from '../src/transcript/parse.ts';
import { applyBackground, completeBackground } from '../src/ui/background.ts';
import { gradAdminRequest, processingItems } from '../src/ui/grad-admin-request.ts';
import { nextSteps } from '../src/ui/next-steps.ts';
import { validateStudent } from '../src/ui/state.ts';
import { buildRules } from './helpers.ts';
import { ndCourse, phdStudent } from './helpers/student.ts';

const rules = buildRules();
const fall = (year: number): Term => ({ season: 'fall', year });
const spring = (year: number): Term => ({ season: 'spring', year });
const summer = (year: number): Term => ({ season: 'summer', year });
const REGULAR = ['CSE 60641', 'CSE 60111', 'CSE 60321', 'CSE 60427', 'CSE 60535', 'CSE 60762', 'CSE 60770', 'CSE 60876'];
const ms = (over: Partial<Student> = {}): Student => ({
  schemaVersion: 1,
  program: 'mscse',
  msOption: 'project',
  entryTerm: fall(2025),
  priorMs: 'none',
  gpa: 3.5,
  courses: [],
  milestones: { advisorIdentified: '2025-10-01', advisorName: 'Prof. Example' },
  attestations: {},
  ...over,
});
const row = (s: Student, id: string, today = '2027-03-01') => audit(s, rules, today).requirements.find((r) => r.id === id);
const line = (s: Student, id: string, today = '2027-03-01') => audit(s, rules, today).courseLines.find((l) => l.courseId === id)!.text;

describe('the audit grade V (Academic Code §2.4, §4.3; DGS Handbook §3.12)', () => {
  it('earns nothing, is said on its line, and is no registration toward full-time status', () => {
    const s = ms({ courses: [ndCourse('CSE 60641', { term: fall(2025) }), ndCourse('CSE 60111', { term: fall(2025) }), ndCourse('CSE 60321', { term: fall(2025), grade: 'V' })] });
    assert.match(line(s, 'CSE 60321'), /audited \(V\) — earns no credit and does not count toward the semester’s full-time status \(Academic Code §2\.4, §4\.3; DGS Handbook §3\.12\)/);
    assert.match(row(s, 'ms.credits.total')!.detail, /^6 of 30/);
    assert.equal(row(s, 'ms.residency')!.status, 'in_progress'); // 6 registered credits, not 9
  });
  it('the import keeps an audit row (V, or another registrar’s AU) as V', () => {
    const lines = ['University of Notre Dame', 'INSTITUTION CREDIT', 'Fall Semester 2026', 'CSE 60641 GR Graduate Operating Systems V 3.000', 'CSE 60111 GR Complexity and Algorithms AU 3.000', 'CSE 60321 GR Advanced Computer Architecture A 3.000 12.000'];
    const parsed = parseTranscript(lines);
    assert.equal(parsed.courses.find((c) => c.courseId === 'CSE 60641')?.grade, 'V');
    assert.equal(parsed.courses.find((c) => c.courseId === 'CSE 60111')?.grade, 'V');
    assert.equal(parsed.courses.find((c) => c.courseId === 'CSE 60641')?.title, 'Graduate Operating Systems');
  });
  it('a saved file’s V loads', () => {
    const s = validateStudent(ms({ courses: [ndCourse('CSE 60641', { grade: 'V' })] }), []);
    assert.equal(s.courses[0]!.grade, 'V');
  });
});

describe('the Application for Admission to Master’s Degree Candidacy (Academic Code §6.1.6)', () => {
  // 24 credits graded, 6 of CSE 68902 in progress: the semester of graduation.
  const ready = (milestones: Student['milestones'] = {}) =>
    ms({
      courses: [...REGULAR.map((id, i) => ndCourse(id, { term: [fall(2025), spring(2026), fall(2026), spring(2026)][i % 4]! })), ndCourse('CSE 68902', { term: spring(2027), credits: 6, grade: 'IP' })],
      milestones: { advisorIdentified: '2025-10-01', advisorName: 'Prof. Example', ...milestones },
    });
  it('appears once a 3.0 GPA and 30 credits, counting this semester’s, are in hand — uncounted, open, in the processing request and the next steps', () => {
    const s = ready();
    const r = row(s, 'shared.msCandidacy')!;
    assert.equal(r.status, 'unmet');
    assert.equal(r.unscored, true);
    assert.match(r.detail, /^Not submitted yet\. Your GPA and credits are in hand — a cumulative GPA of 3\.0 or better and 30 credits, counting this semester’s \(DGS Handbook §3\.21\.1\): the Grad Admin submits the Graduate School’s Application for Admission to Master’s Degree Candidacy/);
    const report = audit(s, rules, '2027-03-01');
    const items = processingItems(report, s, rules);
    assert.equal(items.msCandidacyDue, true);
    assert.equal(items.count, 1, 'the application is a major event (DGS 2026-10-15)');
    assert.ok(items.lines.some((l) => l.startsWith('Application for Admission to Master’s Degree Candidacy')));
    assert.ok(items.actions.some((a) => a.startsWith('Initiate my Application for Admission to Master’s Degree Candidacy')));
    // The 30 credits are DGS Handbook §3.21.1's, the application Academic Code
    // §6.1.6's — the code sets the GPA and the thesis, no credit count (policy
    // review round 4, P4-text-2; DGS 2026-10-12).
    const action = items.actions.find((a) => a.startsWith('Initiate my Application for Admission to Master’s Degree Candidacy'))!;
    assert.match(action, /^Initiate my Application for Admission to Master’s Degree Candidacy \(Academic Code §6\.1\.6\) — the self-check shows a 3\.0 GPA and 30 credits, counting this semester’s \(DGS Handbook §3\.21\.1\)/);
    const steps = nextSteps({ report, student: s, review: { unlisted: 0, caseByCase: 0 }, processingCount: items.count });
    assert.ok(steps.some((st) => st.text.startsWith('Ask the Grad Admin to submit your Application for Admission to Master’s Degree Candidacy')));
  });
  it('dated: done, and recorded in the processing request instead', () => {
    const s = ready({ msCandidacyApplied: '2027-02-20' });
    assert.equal(row(s, 'shared.msCandidacy')!.status, 'met');
    assert.match(row(s, 'shared.msCandidacy')!.detail, /^Submitted 2027-02-20/);
    const items = processingItems(audit(s, rules, '2027-03-01'), s, rules);
    assert.equal(items.msCandidacyDue, false);
    // A milestone date goes along for the record, never as an action (DGS 2026-10-15).
    assert.ok(!items.actions.some((a) => a.startsWith('Record the milestone')));
    assert.equal(items.count, 0);
    const text = gradAdminRequest(audit(s, rules, '2027-03-01'), s, rules, { todayIso: '2027-03-01', entryTerm: 'Fall 2025', priorStudy: 'None' }).text;
    assert.match(text, /\nMILESTONE DATES, FOR THE RECORD\n(?:- [^\n]*\n)*- Application for Admission to Master’s Degree Candidacy submitted: 2027-02-20, as I entered it \(Academic Code §6\.1\.6\)\n/);
  });
  it('not before its conditions: short of 30 credits, or below a 3.0 GPA', () => {
    assert.equal(row(ms({ courses: REGULAR.slice(0, 4).map((id) => ndCourse(id, { term: fall(2025) })) }), 'shared.msCandidacy'), undefined);
    assert.equal(row({ ...ready(), gpa: 2.9 }, 'shared.msCandidacy'), undefined);
  });
  it('a Ph.D. student’s MSCSE along the way needs it too', () => {
    const s = phdStudent({
      entryTerm: fall(2024),
      gpa: 3.6,
      courses: [...REGULAR.map((id, i) => ndCourse(id, { term: i < 4 ? fall(2024) : spring(2025) })), ndCourse('CSE 98900', { term: fall(2025), credits: 6 })],
      milestones: { advisorName: 'Prof. Example', advisorTtt: 'yes', candidacyPassed: '2026-04-20' },
      // The student asked for the master's (DGS 2026-10-11, question 3a: option (b)).
      attestations: { wantsMsAlongTheWay: true },
    });
    assert.equal(row(s, 'phd.msAlongTheWay')!.status, 'met');
    // P3-cse-3-2 (DGS 2026-10-07): "This app's checking is equivalent to the
    // DGS review" (§3.1) — met goes straight to the Grad Admin.
    assert.match(row(s, 'phd.msAlongTheWay')!.detail, /This self-check is the DGS’s review of the award \(§3\.1\), so with every requirement met the Grad Admin processes it with no further DGS step; it is in the processing request \(§4\.5\)/);
    const { text } = gradAdminRequest(audit(s, rules, '2026-10-04'), s, rules, { todayIso: '2026-10-04', entryTerm: 'Fall 2024', priorStudy: 'None', gpa: 3.6 });
    assert.match(text, /Process the MSCSE along the way — the self-check, which is the DGS’s review of the award \(§3\.1\), shows its requirements met \(§4\.5\)\./);
    const r = row(s, 'shared.msCandidacy')!;
    assert.equal(r.status, 'unmet');
    assert.match(r.title, /MSCSE along the way/);
    assert.match(r.detail, /A Ph\.D\. student receiving a master’s degree applies for master’s degree candidacy too \(DGS Handbook §3\.21\.1\)/);
    // Before the award's requirements are met: no step.
    assert.equal(row({ ...s, milestones: { advisorName: 'Prof. Example', advisorTtt: 'yes' } }, 'shared.msCandidacy'), undefined);
  });
});

describe('the semester of graduation (DGS Handbook §3.23.1; Academic Code §3.7)', () => {
  const grad = (term: Term, courses: CourseEntry[]) => ms({ graduationTerm: term, courses });
  it('no course entered for it: a step at once, and a warning once the term has begun', () => {
    const s = grad(spring(2027), [ndCourse('CSE 60641', { term: fall(2025) })]);
    const early = audit(s, rules, '2026-11-01');
    assert.deepEqual(early.graduation, { term: spring(2027), registeredCredits: 0, registered: false });
    assert.ok(!early.warnings.some((w) => w.startsWith('You plan to graduate in Spring 2027')));
    const steps = nextSteps({ report: early, student: s, review: { unlisted: 0, caseByCase: 0 }, processingCount: 0 });
    assert.ok(steps.some((st) => st.text === 'Register for at least one credit hour in Spring 2027 and complete ND Roll Call — the Graduate School confers your degree only then (Academic Code §3.7; DGS Handbook §3.23.1).'));
    const late = audit(s, rules, '2027-02-01');
    assert.ok(late.warnings.some((w) => w.startsWith('You plan to graduate in Spring 2027, but no Notre Dame course of at least one credit is entered for it')));
  });
  it('a course of one credit or more: registered; a withdrawn or audited one is not', () => {
    assert.equal(audit(grad(spring(2027), [ndCourse('CSE 98900', { term: spring(2027), credits: 1, grade: 'IP' })]), rules, '2027-02-01').graduation?.registered, true);
    assert.equal(audit(grad(spring(2027), [ndCourse('CSE 60641', { term: spring(2027), grade: 'W' })]), rules, '2027-02-01').graduation?.registered, false);
    assert.equal(audit(grad(spring(2027), [ndCourse('CSE 60641', { term: spring(2027), grade: 'V' })]), rules, '2027-02-01').graduation?.registered, false);
  });
  it('a summer: a zero-credit course is enough', () => {
    assert.equal(audit(grad(summer(2027), [ndCourse('CSE 67890', { term: summer(2027), credits: 0, grade: 'IP' })]), rules, '2027-06-15').graduation?.registered, true);
  });
  it('a saved file keeps a well-formed term only', () => {
    assert.deepEqual(validateStudent({ ...ms(), graduationTerm: spring(2027) }, []).graduationTerm, spring(2027));
    assert.equal(validateStudent({ ...ms(), graduationTerm: { season: 'winter', year: 2027 } }, []).graduationTerm, undefined);
  });
});

describe('a Graduate School extension of the time limit', () => {
  // Entered Fall 2020 (after the Spring 2020 cohort): eight years end at the start of Fall 2028.
  const phd = (extension?: Term, milestones: Student['milestones'] = {}) =>
    phdStudent({ entryTerm: fall(2020), gpa: 3.5, milestones: { advisorName: 'Prof. Example', advisorTtt: 'yes', ...milestones }, attestations: extension ? { timeLimitExtendedThrough: extension } : {} });
  it('inside it: In progress against the extended date, said, with what dissertation completion status is', () => {
    const r = row(phd(spring(2029)), 'phd.timeLimit', '2029-03-01')!;
    assert.equal(r.status, 'in_progress');
    assert.match(r.deadline!.label, /^Due by the end of Spring 2029 — extended by the Graduate School \(approximate\)/);
    assert.match(r.detail, /extended by the Graduate School through the end of Spring 2029/);
    assert.match(r.detail, /Dissertation completion status lasts up to two semesters \(Academic Code §6\.2\.6\.1\)/);
  });
  it('a defense inside it is not late', () => {
    const r = row(phd(spring(2029), { candidacyPassed: '2024-04-01', candidacyAdmitted: '2024-05-01', defensePassed: '2029-04-01' }), 'phd.dissertation.defense', '2029-05-01')!;
    assert.notEqual(r.statusLabel, 'Eligibility at risk');
  });
  it('after it ends: Overdue', () => {
    const r = row(phd(spring(2029)), 'phd.timeLimit', '2029-09-01')!;
    assert.equal(r.status, 'unmet');
    assert.equal(r.deadline?.state, 'overdue');
  });
  it('without one: Overdue after the eight years, as before', () => {
    assert.equal(row(phd(), 'phd.timeLimit', '2029-03-01')!.status, 'unmet');
  });
  it('longer than the Graduate School grants: noted, and the review request asks the DGS', () => {
    const s = phd(spring(2031));
    assert.match(row(s, 'phd.timeLimit', '2029-03-01')!.detail, /longer than the Graduate School grants/);
    assert.ok(audit(s, rules, '2029-03-01').reviewFlags!.some((f) => f.startsWith('Time limit: I entered a Graduate School extension through the end of Spring 2031')));
  });
  it('one that ends before the limit changes nothing, and says so', () => {
    const r = row(phdStudent({ entryTerm: fall(2024), attestations: { timeLimitExtendedThrough: spring(2026) } }), 'phd.timeLimit', '2026-03-01')!;
    assert.match(r.detail, /ends before your 8-year limit, so it changes nothing/);
  });
  it('the MSCSE: an eligibility extension', () => {
    const r = row(ms({ entryTerm: fall(2020), attestations: { timeLimitExtendedThrough: spring(2026) } }), 'ms.timeLimit', '2026-03-01')!;
    assert.equal(r.status, 'in_progress');
    assert.match(r.detail, /An eligibility extension from the Graduate School \(DGS Handbook §10\.3\.5\)/);
  });
  it('a saved file drops a malformed term', () => {
    assert.equal(validateStudent({ ...ms(), attestations: { timeLimitExtendedThrough: { season: 'fall', year: 'soon' } } }, []).attestations.timeLimitExtendedThrough, undefined);
  });
});

describe('the 4+1 admission term (Graduate School 4+1 guidance)', () => {
  const ug = (courseId: string, term: Term): CourseEntry => ({ courseId, credits: 3, term, grade: 'A', origin: 'transfer', institution: 'University of Notre Dame', degreeLevel: 'bachelors', registeredLevel: 'graduate' });
  // Two 40000-level courses fill the six shared credits; CSE 60641 is extra.
  const fourPlusOne = (admitted?: Term, courseTerm: Term = fall(2025)) =>
    ms({
      entryTerm: fall(2026),
      bachelorsAwarded: spring(2026),
      integratedBsMs: true,
      ...(admitted ? { integratedAdmitted: admitted } : {}),
      courses: [ug('CSE 40113', fall(2025)), ug('CSE 40243', fall(2025)), ug('CSE 60641', courseTerm)],
      attestations: { dgsApproved4xxxx: true },
    });
  // DGS 2026-10-07 (P3-fourplusone-1): a 4+1's graduate course the bachelor's
  // did not use counts toward the MSCSE whenever it was taken — before the
  // admission term too, and with no term entered.
  it('unanswered: the extra course counts — the admission term no longer decides it', () => {
    assert.match(line(fourPlusOne(), 'CSE 60641', '2026-10-04'), /^counts toward regular courses/);
  });
  it('admitted before the bachelor’s, the course from then on: counts', () => {
    assert.match(line(fourPlusOne(fall(2025)), 'CSE 60641', '2026-10-04'), /^counts toward regular courses/);
  });
  it('admitted after the bachelor’s, a row not registered GR: only the six shared credits', () => {
    const asUg = (admitted: Term): Student => {
      const s = fourPlusOne(admitted);
      return { ...s, courses: s.courses.map((c) => (c.courseId === 'CSE 60641' ? { ...c, registeredLevel: 'undergraduate' as const } : c)) };
    };
    assert.match(line(asUg(fall(2026)), 'CSE 60641', '2026-10-04'), /^not counted — you were admitted to the Integrated program for Fall 2026, after your bachelor’s degree \(Spring 2026\)/);
    assert.match(line(asUg(fall(2026)), 'CSE 40113', '2026-10-04'), /will apply to both your bachelor’s degree and your MSCSE/);
    const noLevel = fourPlusOne(fall(2026));
    const typed = { ...noLevel, courses: noLevel.courses.map((c) => (c.courseId === 'CSE 60641' ? (({ registeredLevel: _r, ...rest }) => rest)(c) : c)) };
    assert.match(line(typed, 'CSE 60641', '2026-10-04'), /^not counted — you were admitted to the Integrated program for Fall 2026/);
  });
  // P3-fourplusone-2 (DGS 2026-10-07: option (2)): the GR registration says
  // the course was moved before the bachelor's; the answer says the admission
  // came after it. Neither wins silently.
  it('admitted after the bachelor’s, a row registered GR: held for the DGS, and the student rechecks the term', () => {
    const s = fourPlusOne(fall(2026));
    const r = audit(s, rules, '2026-10-04');
    const l = r.courseLines.find((x) => x.courseId === 'CSE 60641')!.text;
    assert.doesNotMatch(l, /^not counted/);
    assert.match(l, /your Notre Dame transcript registers it at the graduate level \(moved from UG to GR\), but the Integrated-program admission you gave, Fall 2026, is after your bachelor’s degree \(Spring 2026\) — check that term under Your standing; the ADGS confirms/);
    assert.ok(r.warnings.includes('CSE 60641 is registered at the graduate level on your Notre Dame transcript — moved from undergraduate (UG) to graduate (GR) registration, which the Graduate School approves only before the bachelor’s degree is awarded — but the Integrated-program admission you gave, Fall 2026, is after your bachelor’s degree (Spring 2026). Check that term under Your standing. Until the two agree, the course counts only provisionally, and the ADGS confirms it.'));
    const ask = coursesNeedingDgsReview(s, rules, '2026-10-04').find((p) => p.course.entry.courseId === 'CSE 60641');
    assert.ok(ask, 'the course is in the review request');
    assert.match(JSON.stringify(ask), /confirm this course counts — my Notre Dame transcript registers it at the graduate level \(moved from UG to GR\), but the Integrated-program admission I entered is after my bachelor’s degree/);
    // Correcting the term settles it: no warning, no ask.
    const fixed = audit(fourPlusOne(fall(2025)), rules, '2026-10-04');
    assert.ok(!fixed.warnings.some((w) => /is registered at the graduate level on your Notre Dame transcript/.test(w)));
    assert.match(fixed.courseLines.find((x) => x.courseId === 'CSE 60641')!.text, /^counts toward regular courses/);
  });
  it('a course from before the admission term: counts (DGS 2026-10-07)', () => {
    assert.match(line(fourPlusOne(spring(2026), fall(2025)), 'CSE 60641', '2026-10-04'), /^counts toward regular courses/);
  });
  // DGS 2026-10-07 (P3-fourplusone-1): a course the bachelor's did not use
  // counts from any undergraduate term ("Any undergraduate term"); §3.5's
  // window limits only the courses shared with the bachelor's, and the
  // junior-spring ADGS approval is dropped ("Drop it").
  it('an unshared graduate course from the junior fall or the sophomore year counts', () => {
    assert.match(line(fourPlusOne(undefined, fall(2024)), 'CSE 60641', '2026-10-04'), /^counts toward regular courses/);
    assert.match(line(fourPlusOne(undefined, fall(2023)), 'CSE 60641', '2026-10-04'), /^counts toward regular courses/);
  });
  it('an unshared junior-spring course counts outright — no approval step', () => {
    const l = line(fourPlusOne(undefined, spring(2025)), 'CSE 60641', '2026-10-04');
    assert.match(l, /^counts toward regular courses/);
    assert.doesNotMatch(l, /only if the DGS approves it|only if the ADGS approves it/);
  });
  it('the window still limits the courses shared with the bachelor’s: an early one stays the MSCSE’s alone', () => {
    // No 40000-level course: the app shares 60000-level courses — only inside the window.
    const s = ms({
      entryTerm: fall(2026), bachelorsAwarded: spring(2026), integratedBsMs: true,
      courses: [ug('CSE 60641', fall(2023)), ug('CSE 60111', fall(2025))],
    });
    assert.match(line(s, 'CSE 60111', '2026-10-04'), /will apply to both your bachelor’s degree and your MSCSE/);
    const early = line(s, 'CSE 60641', '2026-10-04');
    assert.match(early, /^counts toward regular courses/);
    assert.match(early, /will apply to your MSCSE only/);
  });
  it('no award term: a course the app would share waits for it; one it would not share counts', () => {
    // No 40000-level course, so the six shared credits come from the two
    // earliest 60000-level courses — whose year the page cannot place yet.
    const s = ms({
      entryTerm: fall(2026), integratedBsMs: true,
      courses: [ug('CSE 60641', fall(2023)), ug('CSE 60535', fall(2024)), ug('CSE 60111', fall(2025))],
    });
    assert.match(line(s, 'CSE 60641', '2026-10-04'), /^not counted yet — set the semester your bachelor’s degree was awarded/);
    assert.match(line(s, 'CSE 60535', '2026-10-04'), /^not counted yet — set the semester your bachelor’s degree was awarded/);
    assert.match(line(s, 'CSE 60111', '2026-10-04'), /^counts toward regular courses/);
  });
  it('a non-CSE graduate course still waits for the ADGS', () => {
    const s = ms({ entryTerm: fall(2026), bachelorsAwarded: spring(2026), integratedBsMs: true, courses: [ug('CSE 40113', fall(2025)), ug('CSE 40243', fall(2025)), ug('MATH 60610', fall(2024))], attestations: { dgsApproved4xxxx: true } });
    assert.match(line(s, 'MATH 60610', '2026-10-04'), /§3\.5 names CSE courses/);
  });
  it('a 4+1 record with a graduate course from before the bachelor’s: the three-degree warning', () => {
    const w = audit(fourPlusOne(), rules, '2026-10-04').warnings.filter((x) => /No course counts toward three degrees/.test(x));
    assert.deepEqual(w, ['CSE 60641 is a graduate course you took before your bachelor’s degree was awarded. No course counts toward three degrees: if it counts toward both your bachelor’s degree and the MSCSE, it cannot also count toward a Ph.D. should you later continue to the Ph.D. at Notre Dame (the Graduate School).']);
    // Not on a non-4+1 record, and not without a graduate-level course.
    assert.ok(!audit({ ...fourPlusOne(), integratedBsMs: false }, rules, '2026-10-04').warnings.some((x) => /three degrees/.test(x)));
    const fourOnly = { ...fourPlusOne(), courses: fourPlusOne().courses.filter((c) => c.courseId !== 'CSE 60641') };
    assert.ok(!audit(fourOnly, rules, '2026-10-04').warnings.some((x) => /three degrees/.test(x)));
  });
  it('the opening questions carry the term to the record, beside a “yes” only', () => {
    // The dialog's answer keeps it (the e2e caught completeBackground dropping it).
    assert.deepEqual(completeBackground({ bachelors: 'nd-cse', ndIntegrated: true, integratedAdmittedTerm: fall(2025), graduate: 'none' }, 'mscse')?.integratedAdmittedTerm, fall(2025));
    assert.equal(completeBackground({ bachelors: 'nd-cse', ndIntegrated: false, integratedAdmittedTerm: fall(2025), graduate: 'none' }, 'mscse')?.integratedAdmittedTerm, undefined);
    const s = ms();
    applyBackground(s, { bachelors: 'nd-cse', ndIntegrated: true, integratedAdmittedTerm: fall(2025), graduate: 'none' });
    assert.deepEqual(s.integratedAdmitted, fall(2025));
    applyBackground(s, { bachelors: 'nd-cse', ndIntegrated: false, graduate: 'none' });
    assert.equal(s.integratedAdmitted, undefined);
  });
});

describe('a Notre Dame course entered as program coursework but dated before the entry term', () => {
  it('is said in the warnings', () => {
    const s = ms({ entryTerm: fall(2026), courses: [ndCourse('CSE 60641', { term: fall(2025) }), ndCourse('CSE 60111', { term: fall(2026) })] });
    const w = audit(s, rules, '2026-10-04').warnings.find((x) => x.startsWith('CSE 60641 (Fall 2025) is entered as coursework of this program but dated before your entry term (Fall 2026)'));
    assert.ok(w);
    assert.match(w!, /transfer credit \(§3\.2, §5\.2\)|transfer credit \(§5\.2\)/);
  });
});

// A readmission after a withdrawal or a missed fall or spring semester, under
// five years (policy review 2026-10-04, P2-dh-3.1-3.13-3/-4/-9): the earlier
// program courses wait for the DGS (DGS Handbook §3.3), the review request asks
// about them and about the readmission itself, and nothing is inferred from an
// empty semester.
describe('readmission after a shorter gap (DGS Handbook §3.1, §3.3)', () => {
  const readmitted = (over: Partial<Student> = {}) =>
    ms({
      entryTerm: fall(2023),
      readmittedTerm: fall(2025),
      courses: [ndCourse('CSE 60641', { term: fall(2023) }), ndCourse('CSE 60321', { term: fall(2025) })],
      ...over,
    });

  it('sends the earlier course and the readmission to the review request', () => {
    const report = audit(readmitted(), rules, '2026-03-01');
    assert.ok((report.reviewFlags ?? []).some((f) => /^Readmission: I was readmitted in Fall 2025 after a withdrawal or a fall or spring semester I was not registered for/.test(f)));
    // The MSCSE's own sections (P3-dh-3.1-3.13-4): §6.2.6 is the Ph.D.'s.
    assert.ok((report.reviewFlags ?? []).some((f) => /my five years still count from Fall 2023 \(§3\.3; Academic Code §6\.1\.4\)/.test(f)), JSON.stringify(report.reviewFlags));
    assert.ok(report.warnings.some((w) => /the courses from before your readmission wait for the DGS and are in the review request/.test(w.replace(/ADGS/g, 'DGS'))));
  });

  it('a later course counts as before; with no readmission entered, an empty year is not read as a gap', () => {
    assert.match(line(readmitted(), 'CSE 60321', '2026-03-01'), /^counts toward regular courses/);
    const noAnswer = readmitted({ readmittedTerm: undefined });
    assert.match(line(noAnswer, 'CSE 60641', '2026-03-01'), /^counts toward regular courses/);
    assert.ok(!(audit(noAnswer, rules, '2026-03-01').reviewFlags ?? []).some((f) => /^Readmission/.test(f)));
  });
});

// How the five years of Academic Code §5.5 are counted (policy review round 3,
// P3-ac-5a-2; DGS 2026-10-05): the time actually away, from the end of the
// last Notre Dame term before the readmission to the start of the readmission
// term — not the difference of the year numbers.
describe('a readmission after five years or more (Academic Code §5.5), counted as time away', () => {
  const away = (last: Term, back: Term) => {
    const s = phdStudent({ entryTerm: fall(2017), readmittedTerm: back, courses: [ndCourse('CSE 60641', { term: last }), ndCourse('CSE 60321', { term: back })] });
    return line(s, 'CSE 60641', `${back.year + 1}-03-01`);
  };
  const LONG = /taken before an interruption of five years or more \(readmitted .*\) — Academic Code §5\.5 forfeits the credit/;
  const SHORT = /taken before your readmission \(.*\) — the program may reject some or all past credits \(DGS Handbook §3\.3\)/;
  it('Fall 2018 → Spring 2023 (about four years) is a shorter gap; Spring 2019 → Fall 2024 is five years or more', () => {
    assert.match(away(fall(2018), spring(2023)), SHORT);
    assert.match(away(spring(2019), fall(2024)), LONG);
  });
  it('five years apart fall to fall, or spring to spring, is just under five years away — a shorter gap', () => {
    assert.match(away(fall(2018), fall(2023)), SHORT);
    assert.match(away(spring(2019), spring(2024)), SHORT);
    // …and the next semester is past five years.
    assert.match(away(fall(2018), spring(2024)), LONG);
  });
});

// The examinations from before an interruption of five years or more (policy
// review round 3, P3-ac-5a-3; DGS 2026-10-05: "Apply suggested handling",
// finishing P1-deadlines-c7 of 2026-10-03). Academic Code §5.5: "Credit for any
// course or examination will be forfeited if the student interrupts his or her
// program of study for five years or more." Each is routed to the DGS — never
// reset — and the review request names them.
describe('examinations from before a readmission after five years or more (Academic Code §5.5)', () => {
  const seminars = (term: Term) => [ndCourse('CSE 63801', { term, credits: 1 }), ndCourse('CSE 63802', { term, credits: 1 })];
  const phd = (over: Partial<Student> = {}, readmittedTerm: Term = fall(2024)) =>
    phdStudent({
      entryTerm: fall(2015),
      gpa: 3.7,
      readmittedTerm,
      courses: [ndCourse('CSE 60641', { term: fall(2015) }), ndCourse('CSE 60111', { term: spring(2016) }), ...seminars(spring(2016)), ndCourse('CSE 60770', { term: fall(2024), grade: 'IP' })],
      milestones: { advisorIdentified: '2015-10-01', advisorName: 'Prof. Example', advisorTtt: 'yes', researchQualifierPassed: '2017-02-01', candidacyPassed: '2018-04-20' },
      ...over,
    });
  const row = (s: Student, id: string) => audit(s, rules, '2024-10-15').requirements.find((r) => r.id === id)!;
  it('the research qualifier, the OCE, a core area, the seminars and the qualifier wait for the DGS, and the request names the examinations', () => {
    const s = phd();
    const FACT = /before an interruption of five years or more/;
    for (const id of ['phd.qualifier.research', 'phd.candidacy', 'phd.qualifier.core.os', 'phd.seminar']) {
      const r = row(s, id);
      assert.equal(r.status, 'needs_dgs_review', id);
      assert.match(r.detail, FACT, id);
      assert.match(r.detail, /Academic Code §5\.5 forfeits it unless the DGS and the Graduate School rule otherwise; the review request asks/, id);
    }
    assert.match(row(s, 'phd.qualifier.research').detail, /^Research qualifier passed 2017-02-01 — before an interruption of five years or more/);
    const flags = audit(s, rules, '2024-10-15').reviewFlags ?? [];
    assert.ok(flags.includes('My examinations from before my readmission after an interruption of five years or more: please rule on the research qualifier (passed 2017-02-01) and the Oral Candidacy Exam (passed 2018-04-20) (Academic Code §5.5).'), JSON.stringify(flags));
    assert.match(audit(s, rules, '2024-10-15').warnings.find((w) => w.startsWith('Readmitted'))!, /so those courses and examinations wait for the DGS/);
  });
  it('a shorter gap, or an examination after the readmission, is left alone', () => {
    const short = phd({}, spring(2020)); // last course Spring 2016 → Spring 2020: four years
    assert.equal(row(short, 'phd.qualifier.research').status, 'met');
    assert.ok(!(audit(short, rules, '2024-10-15').reviewFlags ?? []).some((f) => /My examinations from before my readmission/.test(f)));
    const after = phd({ milestones: { advisorIdentified: '2015-10-01', advisorName: 'Prof. Example', advisorTtt: 'yes', researchQualifierPassed: '2025-02-01' } });
    // (It is late against the 18 months, which is its own question — but not forfeited.)
    assert.doesNotMatch(row(after, 'phd.qualifier.research').detail, /before an interruption of five years or more/);
  });
  it('a qualifier passed under the earlier requirements is asked about too', () => {
    const s = phd({ attestations: { qualifierPassedUnderPriorRules: true } });
    const q = row(s, 'phd.qualifier');
    assert.equal(q.status, 'needs_dgs_review');
    assert.match(q.detail, /If you passed it before your readmission in Fall 2024, after an interruption of five years or more: Academic Code §5\.5 forfeits it/);
    assert.ok((audit(s, rules, '2024-10-15').reviewFlags ?? []).some((f) => /please rule on the qualifying examination I passed under the earlier requirements/.test(f)));
  });
  it('an MSCSE thesis defense or project report from before the gap waits for the ADGS', () => {
    const base = { entryTerm: fall(2015), readmittedTerm: fall(2024), courses: [ndCourse('CSE 60641', { term: fall(2015) }), ndCourse('CSE 60770', { term: fall(2024), grade: 'IP' })] };
    const thesis = audit(ms({ ...base, msOption: 'thesis', milestones: { thesisDefensePassed: '2017-04-01' } }), rules, '2024-10-15').requirements.find((r) => r.id === 'ms.thesis.defense')!;
    assert.equal(thesis.status, 'needs_dgs_review');
    assert.match(thesis.detail, /Thesis defense passed 2017-04-01 — before an interruption of five years or more/);
    const project = audit(ms({ ...base, msOption: 'project', milestones: { projectReportAccepted: '2017-04-01' } }), rules, '2024-10-15').requirements.find((r) => r.id === 'ms.project.report')!;
    assert.equal(project.status, 'needs_dgs_review');
    assert.match(project.detail, /Project report accepted 2017-04-01 — before an interruption of five years or more/);
  });
});

// Registered in the term of the defense (policy review 2026-10-04,
// P2-dh-6-9-5): DGS Handbook §8.2.5 and Academic Code §3.7. A pointer behind
// Relevant Policies, never a status change.
describe('registration in the semester of the defense (DGS Handbook §8.2.5)', () => {
  const NOTE = /No Notre Dame course is entered for Spring 2030, the semester of your defense: Notre Dame requires registration in the term you defend — confirm your registration with the Grad Admin \(DGS Handbook §8\.2\.5; Academic Code §3\.7\)/;
  const phdRow = (s: Student) => audit(s, rules, '2030-06-01').requirements.find((r) => r.id === 'phd.dissertation.defense')!;
  const phd = (over: Partial<Student> = {}) =>
    phdStudent({ entryTerm: fall(2025), milestones: { advisorIdentified: '2025-10-01', advisorName: 'Prof. Example', advisorTtt: 'yes', candidacyPassed: '2027-04-01', defensePassed: '2030-04-10' }, ...over });

  it('a defense in a semester with nothing entered gets the pointer; the status is the row’s own', () => {
    const plain = phdRow(phd());
    assert.match(plain.detail, NOTE);
    assert.equal(plain.status, phdRow(phd({ courses: [ndCourse('CSE 98699', { term: { season: 'spring', year: 2030 } })] })).status);
  });

  it('a course in that semester, or a full-time tick for it, is registration enough', () => {
    assert.doesNotMatch(phdRow(phd({ courses: [ndCourse('CSE 98699', { term: { season: 'spring', year: 2030 } })] })).detail, NOTE);
    assert.doesNotMatch(phdRow(phd({ fullTimeTermOverrides: [{ season: 'spring', year: 2030 }] })).detail, NOTE);
  });

  it('the MSCSE thesis defense gets the same pointer', () => {
    const s = ms({ msOption: 'thesis', entryTerm: fall(2028), milestones: { advisorIdentified: '2028-10-01', advisorName: 'Prof. Example', advisorTtt: 'yes', thesisDefensePassed: '2030-04-10' } });
    assert.match(audit(s, rules, '2030-06-01').requirements.find((r) => r.id === 'ms.thesis.defense')!.detail, NOTE);
  });
});

// The semester of graduation is asked only once graduation is in sight (DGS
// 2026-10-05: "Let's show it only when it matters").
describe('when the page asks the semester of graduation', () => {
  it('Ph.D.: once the OCE is passed', () => {
    const s = phdStudent({ entryTerm: fall(2025) });
    assert.equal(audit(s, rules, '2026-10-05').graduationInSight, undefined);
    assert.equal(audit({ ...s, milestones: { candidacyPassed: '2028-04-01' } }, rules, '2028-05-01').graduationInSight, true);
  });

  it('MSCSE: once the total credits are complete or in progress', () => {
    const terms = [fall(2025), spring(2026), fall(2026), spring(2027)];
    // 8 regular courses = 24 credits; the project's 6 make 30.
    const courses = REGULAR.map((id, i) => ndCourse(id, { term: terms[Math.floor(i / 2)]! }));
    assert.equal(audit(ms({ courses }), rules, '2027-03-01').graduationInSight, undefined);
    const withProject = [...courses, ndCourse('CSE 68902', { term: spring(2027), credits: 6, grade: 'IP' })];
    assert.equal(audit(ms({ courses: withProject }), rules, '2027-03-01').graduationInSight, true);
  });
});

// Policy review round 3, P3-ac-6.2-app-3 (c): the Spring 2020 cohort's limit is
// nine years (Appendix A.5); past it, Appendix A.6 restates completion status.
describe('a passed Ph.D. time limit names the right rule for completion status', () => {
  const limitOf = (entry: Term, today: string) => audit(phdStudent({ entryTerm: entry, gpa: 3.5, milestones: { advisorName: 'Prof. Example', advisorTtt: 'yes' } }), rules, today).requirements.find((r) => r.id === 'phd.timeLimit')!;
  it('the Spring 2020 cohort: Appendix A.6, not “after the eighth year”', () => {
    const row = limitOf({ season: 'fall', year: 2015 }, '2026-10-07');
    assert.equal(row.status, 'unmet');
    assert.match(row.detail, /After the time limit a student may apply to the Graduate School for dissertation completion status \(Academic Code Appendix A\.6\) — talk to the DGS/);
    assert.doesNotMatch(row.detail, /After the eighth year/);
  });
  it('everyone else: §6.2.6.1 after the eighth year', () => {
    const row = limitOf({ season: 'fall', year: 2021 }, '2030-09-01');
    assert.equal(row.status, 'unmet');
    assert.match(row.detail, /After the eighth year a student may apply to the Graduate School for dissertation completion status \(Academic Code §6\.2\.6\.1\) — talk to the DGS/);
  });
  it('a Ph.D. student who has not asked for the master’s: the record qualifies, nothing goes to the Grad Admin (DGS 2026-10-11, question 3a (b))', () => {
    const s = phdStudent({
      entryTerm: fall(2024),
      gpa: 3.6,
      courses: [...REGULAR.map((id, i) => ndCourse(id, { term: i < 4 ? fall(2024) : spring(2025) })), ndCourse('CSE 98900', { term: fall(2025), credits: 6 })],
      milestones: { advisorName: 'Prof. Example', advisorTtt: 'yes', candidacyPassed: '2026-04-20' },
    });
    const along = row(s, 'phd.msAlongTheWay')!;
    assert.equal(along.status, 'met');
    assert.equal(along.statusLabel, 'Qualifies');
    assert.match(along.detail, /You qualify for the MSCSE along the way, which is awarded only if you want it/);
    assert.equal(row(s, 'shared.msCandidacy'), undefined);
    const items = processingItems(audit(s, rules, '2026-10-04'), s, rules);
    assert.equal(items.msAlongTheWay, false);
    // A dated master's candidacy application says the student wants it.
    const applied = { ...s, milestones: { ...s.milestones, msCandidacyApplied: '2026-09-01' } };
    assert.notEqual(row(applied, 'phd.msAlongTheWay')!.statusLabel, 'Qualifies');
  });
});
