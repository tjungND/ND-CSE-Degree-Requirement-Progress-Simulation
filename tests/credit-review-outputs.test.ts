// Credit-transfer review 2026-10-28, batch 8: what the requests, the email
// and Next steps say.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { audit } from '../src/engine/audit.ts';
import { coursesNeedingDgsReview } from '../src/engine/review.ts';
import { approvalItems } from '../src/ui/advisor-summary.ts';
import { gradAdminRequest } from '../src/ui/grad-admin-request.ts';
import { nextSteps } from '../src/ui/next-steps.ts';
import { buildRules } from './helpers.ts';
import { ndCourse, phdStudent, transferCourse } from './helpers/student.ts';

const fall = (year: number) => ({ season: 'fall' as const, year });
const spring = (year: number) => ({ season: 'spring' as const, year });
const elsewhere = { bachelors: 'elsewhere' as const, graduate: 'elsewhere' as const, samePlace: false, finished: true };

describe('#16: the advisor email says why a case-by-case course needs approval', () => {
  it('a 60000-level course outside CSE is not "below the 60000 level"', () => {
    const items = approvalItems('EE 67062', 'needs advisor + ADGS approval per the course rules', 'mscse');
    assert.equal(items.advisor, 'Approve EE 67062 — a course from outside CSE, for my coursework (§3.2).');
    assert.equal(items.dgs, 'Decide on EE 67062 for me — the course rules say case by case (§3.2).');
  });
  it('a 60000-level CSE course carries no level claim; a 40000-level one keeps it', () => {
    assert.equal(approvalItems('CSE 60901', 'needs advisor + DGS approval per the course rules', 'phd').advisor, 'Approve CSE 60901 for my coursework (§4.2).');
    assert.equal(approvalItems('CSE 40567', 'needs advisor + DGS approval per the course rules', 'phd').advisor, 'Approve CSE 40567 — a course below the 60000 level, for my coursework (§4.2).');
  });
});

describe('#36: the request’s course table prints the part a cap admitted of a Notre Dame course', () => {
  it('a 4-credit 40000-level course of which the six admit 3', () => {
    const rules = buildRules({ courses: [{ course_id: 'CSE 40567', set: { counts_toward_phd: 'yes', credits_default: '4', credit_max: '4' } }, { course_id: 'CSE 40113', set: { counts_toward_phd: 'yes' } }] });
    const s = phdStudent({ entryTerm: fall(2025), courses: [ndCourse('CSE 40113', { term: fall(2025) }), ndCourse('CSE 40567', { term: fall(2025), credits: 4 })] });
    const { text } = gradAdminRequest(audit(s, rules, '2026-10-28'), s, rules, { todayIso: '2026-10-28', entryTerm: 'Fall 2025', priorStudy: 'x' });
    assert.match(text, /CSE 40567\t[^\t]*\t3 of 4 \(the rest over the 6-credit cap on courses below the 60000 level\)\t/);
  });
});

describe('#44: no double-count question once the six are spent on the bachelor’s and the MSCSE', () => {
  it('the review request does not ask what no ruling can grant', () => {
    const ug = (id: string, toward: 'both' | 'bs') => ({ courseId: id, credits: 3, term: fall(2023), grade: 'A' as const, origin: 'transfer' as const, institution: 'University of Notre Dame', degreeLevel: 'bachelors' as const, registeredLevel: 'graduate' as const, countedToward: toward });
    const s = phdStudent({ entryTerm: fall(2025), bachelorsAwarded: spring(2024), ndMasters: { term: spring(2025) }, background: { bachelors: 'nd-cse', graduate: 'nd-mscse', finished: true } as never, courses: [ug('CSE 60111', 'both'), ug('CSE 60641', 'both'), ug('CSE 60321', 'bs')] });
    const asks = coursesNeedingDgsReview(s, buildRules(), '2026-10-28').flatMap((p) => p.ask?.decide ?? []);
    assert.ok(!asks.some((a) => /count toward both my bachelor’s degree and the Ph\.D\./.test(a)), asks.join(' | '));
  });
});

describe('#65: posted credit with no ExternalCourses row is asked for its row', () => {
  it('needsRow, so the request carries a paste-ready row', () => {
    const s = phdStudent({
      entryTerm: fall(2025), priorMs: 'completed', bachelorsAwarded: spring(2022), background: elsewhere,
      courses: [{ ...transferCourse('STAT 51000', 'Posted Stats', { term: fall(2023), degreeLevel: 'masters' }), ndPosted: { term: spring(2026), credits: 3, level: 'graduate' as const } }],
    });
    const p = coursesNeedingDgsReview(s, buildRules({ parameters: { cse_subject_codes: null } }), '2026-10-28').find((x) => x.course.entry.courseId === 'STAT 51000');
    assert.equal(p?.ask?.needsRow, true);
  });
});

describe('#73: Next steps once the graduation semester has begun', () => {
  it('the processing step asks whether the transfer request went in time', () => {
    const rules = buildRules({ external: [{ university: 'PURDUE UNIVERSITY', course_id: 'CS 52500', course_title: 'CS 52500', transferable_PhD: 'yes', transferable_MSCSE: 'yes', is_cse: 'yes' }] });
    const s = phdStudent({ entryTerm: fall(2022), priorMs: 'completed', bachelorsAwarded: spring(2020), background: elsewhere, graduationTerm: fall(2026), courses: [transferCourse('CS 52500', 'CS 52500', { term: fall(2021), degreeLevel: 'masters' })] });
    const report = audit(s, rules, '2026-10-28');
    const step = nextSteps({ report, student: s, review: { unlisted: 0, caseByCase: 0 }, processingCount: 1, processingTransfers: 1 }).find((x) => x.key === 'processing.send');
    assert.match(step?.text ?? '', /whether your transfer request went to the Graduate School before Fall 2026; if it did not, ask the DGS/);
  });
});

describe('#57, #58, #64: the MSCSE names its own decider and its own nine', () => {
  it('a course the sheet cannot place cites §3.2, and staff checks say the ADGS', () => {
    const s = phdStudent({ program: 'mscse', msOption: 'project', entryTerm: fall(2025), priorMs: 'completed', bachelorsAwarded: spring(2022), background: elsewhere, courses: [transferCourse('MA 52000', 'MA 52000', { term: fall(2023), degreeLevel: 'masters' })] });
    const r = audit(s, buildRules({ parameters: { cse_subject_codes: null } }), '2026-10-28');
    const line = r.courseLines.find((l) => l.courseId === 'MA 52000')!.text;
    assert.match(line, /§3\.2’s nine-credit non-CSE allowance/);
    assert.doesNotMatch(line, /§4\.2/);
    for (const c of r.staffChecks ?? []) assert.doesNotMatch(c, /\bthe DGS decides\b/);
  });
});
