// The MSCSE has no qualifying examination: §4.4.1 core knowledge and §4.4.2
// category specialization belong to §4.4, which is the Ph.D.'s alone. The DGS,
// 2026-09-11: "Core knowledge requirement and Specialization category
// requirement are not relevant to MSCSE. Anything related to them should not be
// shown to current MSCSE students who are in the MSCSE tab."
//
// The page itself is checked by scripts/e2e/drive-transcript.mjs step 11 (the
// whole rendered page, and an external transcript's preview). This file covers
// what the engine and the two e-mails say, which the e2e never renders.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { audit } from '../src/engine/audit.ts';
import { coursesNeedingDgsReview } from '../src/engine/review.ts';
import { advisorSummary } from '../src/ui/advisor-summary.ts';
import { gradAdminRequest } from '../src/ui/grad-admin-request.ts';
import { buildCombinedReviewRequest, reviewRequestCourses } from '../src/ui/review-request.ts';
import type { CourseEntry, Student } from '../src/engine/types.ts';
import { DECIDER_DGS } from '../src/engine/decider.ts';
import { buildRules } from './helpers.ts';
import { phdStudent } from './helpers/student.ts';

// Widened 2026-09-11: nothing on the MSCSE tab may cite ANY part of §4 — the
// approvals row was citing §3.2/§4.2/§5.2 to a master's student.
const FORBIDDEN = /§4(\.\d)*\b|core.knowledge|core area|core-area|core keyword|specialization|qualifying examination|qualifier/i;

const rules = buildRules();
const opts = { todayIso: '2027-06-01', entryTerm: 'Fall 2026', priorStudy: 'No prior graduate degree', gpa: 3.7 };

/** Every kind of course that has ever carried a core-knowledge note. */
const courses: CourseEntry[] = [
  // Notre Dame program coursework whose Courses-tab row names a core area.
  { courseId: 'CSE 60641', title: 'Graduate Operating Systems', credits: 3, term: { season: 'fall', year: 2026 }, grade: 'A', origin: 'nd' },
  // A course listed under several §4.4.2 groups — the group picker's case.
  { courseId: 'CSE 60876', title: 'Research Methods', credits: 3, term: { season: 'fall', year: 2026 }, grade: 'A', origin: 'nd' },
  // Notre Dame undergraduate coursework, core-tagged and not.
  { courseId: 'CSE 40113', title: 'Design/Analysis of Algorithms', credits: 3, term: { season: 'spring', year: 2026 }, grade: 'A', origin: 'transfer', institution: 'University of Notre Dame', degreeLevel: 'bachelors', registeredLevel: 'undergraduate', countedToward: 'bs' },
  { courseId: 'CSE 30321', title: 'Computer Architecture', credits: 3, term: { season: 'fall', year: 2025 }, grade: 'A', origin: 'transfer', institution: 'University of Notre Dame', degreeLevel: 'bachelors', registeredLevel: 'undergraduate' },
  // Another university: an undergraduate course with a core-sounding title,
  // and a graduate one the DGS has not ruled on.
  { courseId: 'CS 25100', title: 'Operating Systems', credits: 3, term: { season: 'fall', year: 2024 }, grade: 'A', origin: 'transfer', institution: 'Purdue University', degreeLevel: 'bachelors' },
  { courseId: 'CS 58000', title: 'Algorithm Design', credits: 3, term: { season: 'fall', year: 2025 }, grade: 'A', origin: 'transfer', institution: 'Purdue University', degreeLevel: 'masters' },
  // A non-CSE course, and one missing from the sheet.
  { courseId: 'MATH 60610', title: 'Basic Real Analysis', credits: 3, term: { season: 'spring', year: 2027 }, grade: 'A', origin: 'nd' },
  { courseId: 'CSE 69999', title: 'Unknown Seminar', credits: 3, term: { season: 'spring', year: 2027 }, grade: 'IP', origin: 'nd' },
  // A failed course: its line cites the DGS's own dated ruling, which keeps
  // the DGS's name on the MSCSE tab (policy review round 3, P3-text-engine-4).
  { courseId: 'CSE 60321', title: 'Advanced Computer Architecture', credits: 3, term: { season: 'spring', year: 2027 }, grade: 'F', origin: 'nd' },
];

const student = (program: Student['program']): Student =>
  phdStudent({ program, bachelorsAwarded: { season: 'spring', year: 2026 }, priorMs: 'completed', gpa: 3.7, courses });

// A Graduate School citation (“Academic Code §4.1”, “DGS Handbook §4…”) is not the CSE handbook's §4 (2026-10-03).
const cseOnly = (t: string): string => t.replace(/(?:Academic Code|DGS Handbook) §\d+(?:\.\d+)*/g, '');
const offending = (strings: string[]): string[] => strings.filter((t) => FORBIDDEN.test(cseOnly(t)));

// DGS 2026-09-11: "the ADGS will make decisions in the approval chain of MSCSE
// students … ADGS decides them for MSCSE students, and DGS decides them for
// PhD students." So an MSCSE student is never sent to "the DGS".
describe('the MSCSE is sent to the ADGS, never the DGS', () => {
  // "DGS Handbook" is the Graduate School's document, not the decider
  // (2026-10-03); a dated ruling is the DGS's own (P3-text-engine-4).
  const DGS_ALONE = DECIDER_DGS;
  const ms = student('mscse');
  const report = audit(ms, rules, '2027-06-01');
  it('no requirement detail, course line, warning, track note or review reason says "DGS"', () => {
    const texts = [
      ...report.requirements.flatMap((r) => [r.title, r.detail, ...(r.detailParts ?? []).map((d) => JSON.stringify(d))]),
      ...report.courseLines.map((l) => l.text),
      ...(report.warnings ?? []),
      ...(report.tracks ?? []).map((t) => t.text),
      ...coursesNeedingDgsReview(ms, rules).map((p) => p.reason),
    ];
    assert.deepEqual(texts.filter((t) => DGS_ALONE.test(t)), []);
    // The DGS's dated ruling keeps the DGS's name (P3-text-engine-4).
    assert.ok(report.courseLines.some((l) => l.courseId === 'CSE 60321' && /failed — earns no credit \(DGS decision 2026-08-31\)/.test(l.text)), JSON.stringify(report.courseLines.find((l) => l.courseId === 'CSE 60321')));
    assert.ok(texts.some((t) => /ADGS/.test(t)), 'the ADGS must actually be named somewhere for this record');
  });
  it('neither e-mail says "DGS"', () => {
    const advisor = advisorSummary(report, opts);
    const admin = gradAdminRequest(report, ms, rules, opts);
    assert.deepEqual([advisor.subject, advisor.text, admin.subject, admin.text, ...admin.items.lines].filter((t) => DGS_ALONE.test(t)), []);
  });
  // The review request opened "Dear DGS," on every tab (policy review round 3,
  // P3-emails-5): its greeting names the decider, and nothing else in it is
  // rewritten again.
  it('the review request is addressed to the ADGS and says "DGS" nowhere', () => {
    const { nd, external } = reviewRequestCourses(coursesNeedingDgsReview(ms, rules, '2027-06-01'), () => 'Master’s');
    assert.ok(nd.length + external.length > 0, 'this record has courses to review');
    const built = buildCombinedReviewRequest({ priorStudy: opts.priorStudy, nd, external, decider: 'ADGS' });
    assert.match(built.text, /^Dear ADGS,$/m);
    assert.match(built.html, /Dear ADGS,/);
    assert.deepEqual([built.subject, ...built.text.split('\n'), ...built.html.split(/<[^>]+>/)].filter((t) => DGS_ALONE.test(t)), []);
    // The Ph.D.'s still opens "Dear DGS,".
    assert.match(buildCombinedReviewRequest({ priorStudy: opts.priorStudy, nd, external, decider: 'DGS' }).text, /^Dear DGS,$/m);
  });
  it('the Ph.D. still says "DGS", and never "ADGS"', () => {
    const phd = audit(student('phd'), rules, '2027-06-01');
    const texts = [...phd.requirements.map((r) => r.detail), ...phd.courseLines.map((l) => l.text)];
    assert.ok(texts.some((t) => DGS_ALONE.test(t)));
    assert.deepEqual(texts.filter((t) => /ADGS/.test(t)), []);
  });
});

describe('the MSCSE never hears about the Ph.D. qualifying examination', () => {
  const ms = student('mscse');
  const report = audit(ms, rules, '2027-06-01');

  it('no requirement row, course line, warning or track note names it', () => {
    assert.deepEqual(offending(report.requirements.flatMap((r) => [
        r.group,
        r.title,
        r.shortTitle ?? '',
        r.detail,
        r.citation.section,
        r.citation.quote,
        ...(r.detailParts ?? []).map((d) => JSON.stringify(d)),
        ...(r.shortDetailParts ?? []).map((d) => JSON.stringify(d)),
      ])), []);
    assert.deepEqual(offending(report.courseLines.map((l) => l.text)), []);
    assert.deepEqual(offending(report.warnings ?? []), []);
    assert.deepEqual(offending((report.tracks ?? []).map((t) => `${t.title} ${t.text}`)), []);
  });

  it('no line of the DGS review request names it', () => {
    assert.deepEqual(offending(coursesNeedingDgsReview(ms, rules).map((p) => p.reason)), []);
  });

  it('neither e-mail names it', () => {
    const advisor = advisorSummary(report, opts);
    assert.deepEqual(offending([advisor.subject, advisor.text, advisor.html]), []);
    const admin = gradAdminRequest(report, ms, rules, opts);
    assert.deepEqual(offending([admin.subject, admin.text, admin.html, ...admin.items.lines]), []);
  });

  it('and the Ph.D. still hears all of it — the guard is not vacuous', () => {
    const phd = student('phd');
    const phdReport = audit(phd, rules, '2027-06-01');
    assert.ok(offending(phdReport.requirements.map((r) => r.title)).length >= 3, 'the Ph.D. report must still carry the qualifier rows');
    assert.ok(offending(phdReport.courseLines.map((l) => l.text)).length > 0, 'a Ph.D. course line must still name its core area');
    assert.ok(offending(coursesNeedingDgsReview(phd, rules).map((p) => p.reason)).length > 0, 'the Ph.D. review request must still ask about core areas');
  });
});
