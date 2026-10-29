// A final check of the review's fixes, 2026-10-29: each confirmed problem's
// reproduction re-run against the fixed code, and an independent review of
// the change. What it found, pinned.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { audit } from '../src/engine/audit.ts';
import { classify } from '../src/engine/allocate.ts';
import { oneSchool } from '../src/engine/nd-posting.ts';
import { coursesNeedingDgsReviewFor } from '../src/engine/review.ts';
import type { CourseEntry, Student } from '../src/engine/types.ts';
import { advisorSummary } from '../src/ui/advisor-summary.ts';
import { transferRuleText } from '../src/ui/coursework-text.ts';
import { pairBlockRows } from '../src/ui/nd-posted.ts';
import { buildRules } from './helpers.ts';
import { ndCourse, phdStudent, transferCourse } from './helpers/student.ts';

const TODAY = '2026-10-29';
const fall = (year: number) => ({ season: 'fall' as const, year });
const spring = (year: number) => ({ season: 'spring' as const, year });
const elsewhere = { bachelors: 'elsewhere' as const, graduate: 'elsewhere' as const, samePlace: false, finished: true };
const row = (id: string, t: { report: ReturnType<typeof audit> }) => t.report.requirements.find((r) => r.id === id)!;

describe('one school, as its transcripts name it', () => {
  it('Georgia Tech’s sheet name, header words and all, is the same school as its plain name', () => {
    assert.equal(oneSchool('GEORGIA INSTITUTE OF TECHNOLOGY OFFICIAL DOCUMENT INFORMATION', 'Georgia Institute of Technology'), true);
    assert.equal(oneSchool('University of Washington', 'University of Washington Tacoma'), false);
    assert.equal(oneSchool('Indiana University', 'Indiana University of Pennsylvania'), false);
    assert.equal(oneSchool('Purdue University', 'PURDUE UNIVERSITY-WEST LAFAYETTE'), true);
  });
  it('…so its courses are one earlier program, not two', () => {
    const LONG = 'GEORGIA INSTITUTE OF TECHNOLOGY OFFICIAL DOCUMENT INFORMATION';
    const ext = (id: string) => ({ university: LONG, course_id: id, course_title: id, transferable_PhD: 'yes', transferable_MSCSE: 'yes', is_cse: 'yes' });
    const s = phdStudent({
      entryTerm: fall(2024), priorMs: 'completed', bachelorsAwarded: spring(2022), background: elsewhere,
      courses: [transferCourse('CS 6505', 'Computability', { term: fall(2023), degreeLevel: 'masters', institution: LONG }), transferCourse('CS 6290', 'Architecture', { term: spring(2024), degreeLevel: 'masters', institution: 'Georgia Institute of Technology' })],
    });
    const { classified } = classify(s, buildRules({ external: [ext('CS 6505'), ext('CS 6290')] }), TODAY);
    assert.equal(classified.some((c) => c.twoPrograms), false);
  });
});

describe('the Notre Dame posting goes on an attempt the Graduate School could have accepted', () => {
  it('whatever title the other attempt shares with the posting', () => {
    const failed = transferCourse('CS 58000', 'Algorithm Design, Analysis, and Implementation', { term: fall(2022), degreeLevel: 'masters', grade: 'C' });
    const passed = transferCourse('CS 58000', 'Algorithm Design Analysis & Implementation', { term: spring(2023), degreeLevel: 'masters', grade: 'A' });
    const block = { courseId: 'CS 58000', title: 'ALGORITHM DESIGN, ANALYSIS, AND IMPLEMENTATION', credits: 3, origin: 'transfer', institution: 'PURDUE UNIVERSITY-WEST LAFAYETTE' };
    assert.equal([...pairBlockRows([failed, passed], [block]).values()][0], passed);
  });
});

describe('Next steps’ waiting step asks the late-request question only for a transfer the request will submit', () => {
  const transfers = (s: Student) => coursesNeedingDgsReviewFor(classify(s, buildRules(), TODAY).classified, s).filter((p) => p.decidesTransfer === true).length;
  it('not for an undergraduate course asked only for its core area', () => {
    const s = phdStudent({ entryTerm: fall(2022), bachelorsAwarded: spring(2022), background: { bachelors: 'elsewhere', graduate: 'none' } as never, graduationTerm: fall(2026), courses: [transferCourse('CS 3510', 'Design and Analysis of Algorithms', { term: fall(2020), degreeLevel: 'bachelors', institution: 'Georgia Institute of Technology' }), ndCourse('CSE 60111', { term: fall(2022) })] });
    assert.equal(transfers(s), 0);
  });
  it('for a transfer candidate from an earlier Notre Dame program', () => {
    const s = phdStudent({ entryTerm: fall(2022), priorMs: 'completed', bachelorsAwarded: spring(2019), background: { bachelors: 'elsewhere', graduate: 'nd-other', finished: true } as never, graduationTerm: fall(2026), courses: [transferCourse('CSE 60641', 'Graduate Operating Systems', { term: fall(2020), degreeLevel: 'masters', institution: 'University of Notre Dame' }), ndCourse('CSE 60111', { term: fall(2022) })] });
    assert.equal(transfers(s), 1);
  });
});

describe('a waiting course reads “Counts toward” only its own core area', () => {
  it('not the area a Notre Dame course of the same number satisfies', () => {
    const rules = buildRules({ external: [{ university: 'PURDUE UNIVERSITY', course_id: 'CSE 60641', course_title: 'Distributed Systems', transferable_PhD: 'dgs_approval', transferable_MSCSE: 'adgs_approval', is_cse: 'yes', satisfies_core_area: 'none' }] });
    const s = phdStudent({ entryTerm: fall(2025), priorMs: 'completed', bachelorsAwarded: spring(2020), background: elsewhere, courses: [transferCourse('CSE 60641', 'Distributed Systems', { term: spring(2025), degreeLevel: 'masters' }), ndCourse('CSE 60641', { term: fall(2026), grade: 'A' })] });
    const line = audit(s, rules, '2027-01-20').courseLines.find((l) => l.entryIndex === 0)!;
    assert.ok(!(line.counts ?? []).some((x) => x.id.startsWith('phd.qualifier.core.') && x.when === 'now'), JSON.stringify(line.counts));
  });
});

describe('a seminar a cap refused', () => {
  const nd = (id: string, term: { season: 'fall' | 'spring'; year: number }, credits = 3): CourseEntry => ({ courseId: id, credits, term, grade: id.startsWith('CSE 638') ? 'S' : 'A', origin: 'transfer', institution: 'University of Notre Dame', degreeLevel: 'masters', registeredLevel: 'graduate', dgsApproved: true, dgsHoldApproved: true });
  it('by the non-degree twelve: no overload remedy, the DGS instead', () => {
    const s = phdStudent({ entryTerm: fall(2026), gpa: 3.6, ndNonDegree: true, bachelorsAwarded: spring(2024), courses: [nd('CSE 60111', spring(2025)), nd('CSE 60321', spring(2025)), nd('CSE 60427', fall(2025)), nd('CSE 60535', fall(2025)), nd('CSE 60641', spring(2026)), nd('CSE 63801', spring(2026), 1), ndCourse('CSE 63802', { term: spring(2027), credits: 1, grade: 'S' })] });
    const report = audit(s, buildRules(), '2027-06-01');
    const seminar = report.requirements.find((r) => r.id === 'phd.seminar')!.detail;
    assert.match(seminar, /CSE 63801: taken Spring 2026, not counted — over the 12-credit/);
    assert.doesNotMatch(seminar, /credit overload/);
    const email = advisorSummary(report, { todayIso: '2027-06-01', entryTerm: 'Fall 2026', priorStudy: 'x', advisors: [] }).text;
    assert.doesNotMatch(email, /Tick the credit overload/);
    assert.match(email, /Ask the DGS about CSE 63801 \(taken Spring 2026\)/);
  });
});

describe('a 4+1 course from the bachelor’s years passed below C', () => {
  it('is not sent to the DGS, so the approvals card can clear', () => {
    const s = phdStudent({ integratedBsMs: true, integratedAdmitted: spring(2025), bachelorsAwarded: spring(2025), gpa: 3.8, courses: [{ courseId: 'CSE 60641', credits: 3, term: fall(2024), grade: 'C-', origin: 'transfer', institution: 'University of Notre Dame', degreeLevel: 'bachelors', registeredLevel: 'undergraduate', countedToward: 'neither' }] } as never);
    const rules = buildRules();
    assert.equal(coursesNeedingDgsReviewFor(classify(s, rules, '2027-06-01').classified, s).length, 0);
    assert.notEqual(audit(s, rules, '2027-06-01').requirements.find((r) => r.id === 'shared.approvals')!.status, 'needs_dgs_review');
  });
});

describe('the six spent on the bachelor’s and the MSCSE', () => {
  it('a course the bachelor’s used waits for nobody: no box, no request, no “waits for the DGS’s confirmation”', () => {
    const ug = (id: string, toward: 'both' | 'bs'): CourseEntry => ({ courseId: id, credits: 3, term: fall(2023), grade: 'A', origin: 'transfer', institution: 'University of Notre Dame', degreeLevel: 'bachelors', registeredLevel: 'graduate', countedToward: toward });
    const s = phdStudent({ entryTerm: fall(2025), bachelorsAwarded: spring(2024), ndMasters: { term: spring(2025) }, background: { bachelors: 'nd-cse', graduate: 'nd-mscse', finished: true } as never, courses: [ug('CSE 60111', 'both'), ug('CSE 60641', 'both'), ug('CSE 60321', 'bs')] });
    const report = audit(s, buildRules(), '2026-10-28');
    assert.equal(report.requirements.find((r) => r.id === 'shared.approvals')!.status, 'in_progress');
    assert.equal(report.courseLines.find((l) => l.courseId === 'CSE 60321')!.approvable, undefined);
    assert.doesNotMatch(report.requirements.find((r) => r.id === 'phd.cap.sharedbs')!.detail, /waits for the DGS’s confirmation/);
  });
});

describe('an overloaded semester', () => {
  it('cuts a non-CSE course that adds to the 60 alone before the research the MSCSE along the way counts', () => {
    const renames = [['CSE 60876', 'MATH 60850'], ['CSE 60770', 'EE 60770'], ['CSE 60762', 'PHYS 60762'], ['CSE 60427', 'ACMS 60427']].map(([from, to]) => ({ course_id: from!, set: { course_id: to!, title: to!, category_group: '', core_area: '' } }));
    const nd = (id: string, term: { season: 'fall' | 'spring'; year: number }, extra: Partial<CourseEntry> = {}): CourseEntry => ({ courseId: id, credits: 3, term, grade: 'A', origin: 'nd', ...extra });
    const s = phdStudent({
      entryTerm: fall(2025), bachelorsAwarded: spring(2025), gpa: 3.8, milestones: { candidacyPassed: '2027-04-15' }, attestations: { wantsMsAlongTheWay: true },
      courses: [
        nd('MATH 60850', fall(2025)), nd('EE 60770', fall(2025)), nd('PHYS 60762', spring(2026)), nd('CSE 63801', fall(2025), { credits: 1, grade: 'S' }), nd('CSE 63802', spring(2026), { credits: 1, grade: 'S' }), nd('CSE 98900', spring(2026), { grade: 'S' }),
        nd('CSE 60111', fall(2026)), nd('CSE 60641', fall(2026)), nd('CSE 60321', fall(2026)), nd('CSE 60868', fall(2026)), nd('ACMS 60427', fall(2026)), nd('CSE 98900', fall(2026), { grade: 'S' }),
      ],
    } as never);
    const report = audit(s, buildRules({ courses: renames }), '2027-06-01');
    assert.match(report.requirements.find((r) => r.id === 'phd.msAlongTheWay')!.detail, /and 6 research credits/);
    assert.match(report.courseLines.find((l) => l.courseId === 'ACMS 60427')!.text, /^not counted — over the 9-credit non-CSE cap and 15-credit semester maximum for Fall 2026/);
  });
});

describe('the same record gives the same verdict whatever the row order', () => {
  it('two identical rows of a case-by-case course, one ticked', () => {
    const rows = [ndCourse('CSE 40437', { term: fall(2025), dgsApproved: true }), ndCourse('CSE 40437', { term: fall(2025) }), ndCourse('CSE 60111', { term: fall(2025) })];
    const regular = (courses: CourseEntry[]) => audit(phdStudent({ entryTerm: fall(2025), courses }), buildRules(), '2026-10-28').requirements.find((r) => r.id === 'phd.credits.regular')!.detail;
    assert.equal(regular(rows), regular([rows[1]!, rows[0]!, rows[2]!]));
  });
});

describe('a course from another university held by a readmission', () => {
  it('has the box the DGS’s ruling is recorded in', () => {
    const rules = buildRules({ external: [{ university: 'NORTHEASTERN UNIVERSITY', course_id: 'CS 5001', course_title: 'CS 5001', transferable_PhD: 'yes', transferable_MSCSE: 'yes', is_cse: 'yes', credit_system: 'semester' }] });
    const s = phdStudent({ entryTerm: fall(2018), priorMs: 'completed', bachelorsAwarded: spring(2015), gpa: 3.7, background: elsewhere, readmittedTerm: fall(2025), courses: [transferCourse('CS 5001', 'CS 5001', { term: spring(2017), degreeLevel: 'masters', institution: 'Northeastern University' }), ndCourse('CSE 60641', { term: fall(2018) }), ndCourse('CSE 60321', { term: fall(2025) })] });
    const line = audit(s, rules, TODAY).courseLines.find((l) => l.courseId === 'CS 5001')!;
    assert.equal(line.approvable, true);
    assert.equal(line.holdRuling, true);
  });
});

describe('the §5.2 paragraph and an MSCSE that ended before the Ph.D.’s window', () => {
  it('says a course after the MSCSE and outside that window does not count, as its line says', () => {
    const s = phdStudent({ entryTerm: fall(2026), priorMs: 'completed', ndMasters: { term: spring(2014) }, bachelorsAwarded: spring(2012), background: { bachelors: 'elsewhere', graduate: 'nd-mscse', alsoElsewhere: true, finished: true } as never });
    assert.match(transferRuleText(s, buildRules(), TODAY, false), /goes to the DGS if it is from Spring 2014 or earlier, and does not count if it is later/);
  });
});

describe('a duplicate group with mixed answers gets one accurate warning', () => {
  it('bs + mscse + mscse in one term', () => {
    const ug = (toward: 'bs' | 'mscse'): CourseEntry => ({ courseId: 'CSE 60111', credits: 3, term: fall(2024), grade: 'A', origin: 'transfer', institution: 'University of Notre Dame', degreeLevel: 'masters', registeredLevel: 'graduate', countedToward: toward });
    const s = phdStudent({ entryTerm: fall(2025), bachelorsAwarded: spring(2025), ndMasters: { term: spring(2025) }, integratedBsMs: true, background: { bachelors: 'nd-cse', graduate: 'nd-mscse', finished: true } as never, courses: [ug('bs'), ug('mscse'), ug('mscse')] });
    const warnings = audit(s, buildRules(), TODAY).warnings.filter((w) => /CSE 60111 is entered 3 times/.test(w));
    assert.deepEqual(warnings, ['CSE 60111 is entered 3 times for Fall 2024, with different answers about which degrees it counted toward — if it is one registration, remove the duplicates.']);
  });
});

describe('a core area satisfied before an interruption of five years or more, elsewhere', () => {
  it('waits for the DGS’s ruling, as a Notre Dame course’s does', () => {
    const rules = buildRules({ external: [{ university: 'NORTHEASTERN UNIVERSITY', course_id: 'CS 5600', course_title: 'Computer Systems', transferable_PhD: 'yes', transferable_MSCSE: 'yes', is_cse: 'yes', satisfies_core_area: 'os', credit_system: 'semester' }] });
    const s = phdStudent({ entryTerm: fall(2018), priorMs: 'completed', bachelorsAwarded: spring(2015), background: elsewhere, readmittedTerm: fall(2025), courses: [transferCourse('CS 5600', 'Computer Systems', { term: spring(2017), degreeLevel: 'masters', institution: 'Northeastern University' }), ndCourse('CSE 60321', { term: fall(2018) }), ndCourse('CSE 60535', { term: fall(2025) })] });
    assert.equal(audit(s, rules, TODAY).requirements.find((r) => r.id === 'phd.qualifier.core.os')!.status, 'needs_dgs_review');
  });
});
void row;
