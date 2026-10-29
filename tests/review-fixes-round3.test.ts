// The last check of the review's fixes, 2026-10-29: three faults the
// previous round brought in, and what it left. Each case is a reproduction
// from that check.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { audit } from '../src/engine/audit.ts';
import { classify } from '../src/engine/allocate.ts';
import { oneSchool } from '../src/engine/nd-posting.ts';
import { coursesNeedingDgsReview } from '../src/engine/review.ts';
import { transferKey } from '../src/engine/transfer-recorded.ts';
import type { CourseEntry, Student } from '../src/engine/types.ts';
import { transferRuleText } from '../src/ui/coursework-text.ts';
import { pairBlockRows } from '../src/ui/nd-posted.ts';
import { buildRules } from './helpers.ts';
import { ndCourse, phdStudent, transferCourse } from './helpers/student.ts';

const TODAY = '2026-10-29';
const fall = (year: number) => ({ season: 'fall' as const, year });
const spring = (year: number) => ({ season: 'spring' as const, year });
const ND = 'University of Notre Dame';
const elsewhere = { bachelors: 'elsewhere' as const, graduate: 'elsewhere' as const, samePlace: false, finished: true };
const regular = (s: Student, rules = buildRules(), today = TODAY) => audit(s, rules, today).requirements.find((r) => r.id === 'phd.credits.regular')!.progress!.have;

describe('a duplicate group counts the row this degree can count, in any order', () => {
  const row = (toward: 'both' | 'neither', extra: Partial<CourseEntry> = {}): CourseEntry => ({ courseId: 'CSE 60111', credits: 3, term: fall(2023), grade: 'A', origin: 'transfer', institution: ND, degreeLevel: 'bachelors', registeredLevel: 'graduate', countedToward: toward, ...extra });
  const record = (courses: CourseEntry[]): Student => phdStudent({ entryTerm: fall(2025), bachelorsAwarded: spring(2024), ndMasters: { term: spring(2025) }, integratedBsMs: true, background: { bachelors: 'nd-cse', ndIntegrated: true, graduate: 'nd-4plus1' } as never, courses });
  it('a ticked row answered “both” and its twin answered “neither”', () => {
    assert.equal(regular(record([row('both', { dgsApproved: true }), row('neither')])), 3);
    assert.equal(regular(record([row('neither'), row('both', { dgsApproved: true })])), 3);
  });
  it('a hold ruling ticked on one of two identical rows', () => {
    const r = (extra: Partial<CourseEntry>): CourseEntry => ({ ...ndCourse('CSE 60111', { term: fall(2022) }), ...extra });
    const s = (courses: CourseEntry[]) => phdStudent({ entryTerm: fall(2022), readmittedTerm: fall(2025), courses: [...courses, ndCourse('CSE 60321', { term: fall(2025) })] });
    assert.equal(regular(s([r({ dgsHoldApproved: true }), r({})])), regular(s([r({}), r({ dgsHoldApproved: true })])));
  });
});

describe('a blank bachelor’s award term keeps the MSCSE’s holds', () => {
  it('a separation of five years or more still holds a senior-year course counted toward the MSCSE', () => {
    const s = phdStudent({ entryTerm: fall(2022), ndMasters: {} as never, integratedBsMs: true, courses: [{ courseId: 'CSE 60770', credits: 3, term: spring(2014), grade: 'A', origin: 'transfer', institution: ND, degreeLevel: 'bachelors', registeredLevel: 'graduate', countedToward: 'mscse' }, { courseId: 'CSE 60111', credits: 3, term: spring(2015), grade: 'A', origin: 'transfer', institution: ND }] });
    assert.equal(regular(s), 0);
    assert.match(audit(s, buildRules(), TODAY).courseLines.find((l) => l.courseId === 'CSE 60770')!.text, /five years or more before you entered the Ph\.D\./);
  });
  it('a course taken elsewhere during the MSCSE still waits for the DGS', () => {
    const rules = buildRules({ external: [{ university: 'UNIVERSITY OF SOUTHERN CALIFORNIA', course_id: 'CSCI 570', course_title: 'Algorithms', transferable_PhD: 'yes', transferable_MSCSE: 'yes', is_cse: 'yes' }] });
    const s = phdStudent({ entryTerm: fall(2021), priorMs: 'completed', ndMasters: { term: spring(2020) }, background: { bachelors: 'nd-cse', graduate: 'nd-mscse' } as never, courses: [{ courseId: 'CSE 60111', credits: 3, term: fall(2019), grade: 'A', origin: 'transfer', institution: ND }, { courseId: 'CSCI 570', credits: 3, term: spring(2020), grade: 'A', origin: 'transfer', institution: 'University of Southern California' }] });
    assert.equal(audit(s, rules, TODAY).courseLines.find((l) => l.courseId === 'CSCI 570')!.mark, 'pending');
  });
  it('a row answered “counted toward the MSCSE” is placed by the answer', () => {
    const s = phdStudent({ entryTerm: fall(2026), priorMs: 'none', ndMasters: { term: spring(2026) }, integratedBsMs: true, background: { bachelors: 'nd-cse', ndIntegrated: true, graduate: 'nd-4plus1' } as never, courses: [{ courseId: 'CSE 60641', credits: 3, term: fall(2024), grade: 'A', origin: 'transfer', institution: ND, degreeLevel: 'masters', registeredLevel: 'graduate', countedToward: 'mscse' }] });
    assert.doesNotMatch(audit(s, buildRules(), TODAY).courseLines.find((l) => l.courseId === 'CSE 60641')!.text, /set the semester your bachelor’s degree was awarded/);
  });
});

describe('postings and rows', () => {
  const topics = (title: string, term: { season: 'fall' | 'spring'; year: number }, grade: CourseEntry['grade'] = 'A'): CourseEntry => transferCourse('CS 59000', title, { term, degreeLevel: 'masters', grade });
  const posting = (title: string) => ({ courseId: 'CS 59000', title, credits: 3, origin: 'transfer', institution: 'PURDUE UNIVERSITY-WEST LAFAYETTE' });
  it('two topics courses, one graded B-: each posting keeps its own title', () => {
    const security = topics('Topics: Security', fall(2023), 'B-');
    const blockchain = topics('Topics: Blockchain', spring(2024));
    const pairs = pairBlockRows([security, blockchain], [posting('TOPICS: SECURITY'), posting('TOPICS: BLOCKCHAIN')]);
    assert.equal(pairs.get([...pairs.keys()].find((b) => b.title === 'TOPICS: SECURITY')!), security);
  });
  it('a posting whose own row is missing does not take another title’s row', () => {
    const blockchain = topics('Topics: Blockchain', spring(2024));
    const blocks = [posting('TOPICS: SECURITY'), posting('TOPICS: BLOCKCHAIN')];
    const pairs = pairBlockRows([blockchain], blocks);
    assert.equal(pairs.get(blocks[1]!), blockchain);
    assert.equal(pairs.has(blocks[0]!), false);
  });
});

describe('the two passes refuse the same course for a semester’s maximum', () => {
  it('transfers spend the nine: the course and the award read the same, and the nine keeps its regular credit', () => {
    const nd = (id: string, term: { season: 'fall' | 'spring'; year: number }, extra: Partial<CourseEntry> = {}): CourseEntry => ({ courseId: id, credits: 3, term, grade: 'A', origin: 'nd', ...extra });
    const xf = (id: string): CourseEntry => ({ courseId: id, title: 'Statistics', credits: 3, term: fall(2022), grade: 'A', origin: 'transfer', institution: 'Purdue University', degreeLevel: 'masters' });
    const rules = buildRules({
      courses: [{ course_id: 'CSE 60427', set: { course_id: 'ACMS 60427', title: 'ACMS Course', category_group: '', core_area: '' } }],
      external: ['STAT 701', 'STAT 702', 'STAT 703'].map((id) => ({ university: 'PURDUE UNIVERSITY', course_id: id, course_title: 'Statistics', transferable_PhD: 'yes', transferable_MSCSE: 'yes', is_cse: 'no', credit_system: 'semester' })),
    });
    const s = phdStudent({
      entryTerm: fall(2025), priorMs: 'completed', bachelorsAwarded: spring(2021), gpa: 3.8, background: elsewhere, milestones: { candidacyPassed: '2027-04-15' }, attestations: { wantsMsAlongTheWay: true },
      courses: [xf('STAT 701'), xf('STAT 702'), xf('STAT 703'), nd('CSE 60770', fall(2025)), nd('CSE 60762', fall(2025)), nd('CSE 63801', fall(2025), { credits: 1 }), nd('CSE 60876', spring(2026)), nd('CSE 60535', spring(2026)), nd('CSE 63802', spring(2026), { credits: 1 }), nd('CSE 98900', spring(2026), { grade: 'S' }), nd('CSE 60111', fall(2026)), nd('CSE 60641', fall(2026)), nd('CSE 60321', fall(2026)), nd('CSE 60868', fall(2026)), nd('ACMS 60427', fall(2026)), nd('CSE 98900', fall(2026), { grade: 'S' })],
    } as never);
    const r = audit(s, rules, '2027-06-01');
    // ACMS 60427 is regular credit at Notre Dame (the nine has room there), so
    // the semester's maximum keeps it in both passes, and the research course
    // reads cut on its line as in the award (the question of which the
    // maximum should keep is the DGS's — DECISIONS, the last check's row).
    assert.match(r.requirements.find((x) => x.id === 'phd.msAlongTheWay')!.detail, /3 of 6 research credits/);
    assert.match(r.courseLines.filter((l) => l.courseId === 'CSE 98900').map((l) => l.text).join(' | '), /not counted — over the 15-credit semester maximum for Fall 2026/);
    assert.match(r.courseLines.find((l) => l.courseId === 'ACMS 60427')!.text, /still counts toward the regular-course credits taken at Notre Dame/);
  });
});

describe('rows keyed by course number go to their own registration', () => {
  it('a transfer “CSE 60111” beside the Notre Dame CSE 60111: the Notre Dame line is not transfer credit, the transfer takes no core area', () => {
    const rules = buildRules({ external: [{ university: 'PURDUE UNIVERSITY', course_id: 'CSE 60111', course_title: 'Algorithms', transferable_PhD: 'yes', transferable_MSCSE: 'yes', is_cse: 'yes' }] });
    const s = phdStudent({ entryTerm: fall(2025), priorMs: 'completed', bachelorsAwarded: spring(2020), background: elsewhere, courses: [transferCourse('CSE 60111', 'Algorithms', { term: fall(2024), degreeLevel: 'masters' }), ndCourse('CSE 60111', { term: fall(2026), grade: 'A' })] });
    const lines = audit(s, rules, '2027-01-20').courseLines;
    const ids = (i: number) => (lines.find((l) => l.entryIndex === i)!.counts ?? []).map((x) => `${x.id}:${x.when}`);
    assert.ok(!ids(1).includes('phd.transfer:now'), ids(1).join());
    assert.ok(!ids(0).includes('phd.qualifier.core.algorithms:now'), ids(0).join());
  });
});

describe('the §5.2 paragraph and an MSCSE that ended before the Ph.D.’s window, dated', () => {
  it('names the MSCSE’s end and the Ph.D.’s own window', () => {
    const s = phdStudent({ entryTerm: fall(2026), priorMs: 'completed', ndMasters: { term: spring(2012) }, bachelorsAwarded: spring(2010), background: { bachelors: 'elsewhere', graduate: 'nd-mscse', alsoElsewhere: true, finished: true } as never, courses: [{ courseId: 'CSE 60111', credits: 3, term: fall(2010), grade: 'A', origin: 'transfer', institution: ND, degreeLevel: 'masters' }] });
    assert.match(transferRuleText(s, buildRules(), TODAY, false), /\(Fall 2005 or later\) and no later than its end \(Spring 2012\), or within 5 years before you entered the Ph\.D\. \(Fall 2021 or later\)/);
  });
});

describe('one school, header words and a campus together', () => {
  it('“PURDUE UNIVERSITY OFFICIAL TRANSCRIPT” and “PURDUE UNIVERSITY-WEST LAFAYETTE”', () => {
    assert.equal(oneSchool('PURDUE UNIVERSITY OFFICIAL TRANSCRIPT', 'PURDUE UNIVERSITY-WEST LAFAYETTE'), true);
    assert.equal(oneSchool('Northeastern University, Office of the Registrar', 'Northeastern University'), true);
    assert.equal(oneSchool('Purdue University Official Transcript', 'Purdue University Fort Wayne'), false);
  });
});

describe('a seminar refused beside one never taken', () => {
  it('the card names both remedies', () => {
    const nd = (id: string, term: { season: 'fall' | 'spring' | 'summer'; year: number }, credits = 3, grade: CourseEntry['grade'] = 'A'): CourseEntry => ({ courseId: id, credits, term, grade, origin: 'nd' });
    const s = phdStudent({ entryTerm: fall(2025), bachelorsAwarded: spring(2025), gpa: 3.8, courses: [nd('CSE 60111', { season: 'summer', year: 2026 }), nd('CSE 60641', { season: 'summer', year: 2026 }), nd('CSE 60321', { season: 'summer', year: 2026 }), nd('CSE 63801', { season: 'summer', year: 2026 }, 1, 'S'), nd('CSE 60535', { season: 'summer', year: 2026 })] });
    const detail = audit(s, buildRules(), '2027-06-01').requirements.find((r) => r.id === 'phd.seminar')!.detail;
    assert.match(detail, /talk to the DGS about taking the missing one; CSE 63801 was taken but not counted — if a credit overload was approved for you in Summer 2026/);
  });
});

describe('the six spent, an unlisted course the bachelor’s used', () => {
  it('is asked for its core area and group, nothing else', () => {
    const ug = (id: string, toward: 'both' | 'bs', title?: string): CourseEntry => ({ courseId: id, ...(title ? { title } : {}), credits: 3, term: fall(2023), grade: 'A', origin: 'transfer', institution: ND, degreeLevel: 'bachelors', registeredLevel: 'graduate', countedToward: toward });
    const s = phdStudent({ entryTerm: fall(2025), bachelorsAwarded: spring(2024), ndMasters: { term: spring(2025) }, background: { bachelors: 'nd-cse', graduate: 'nd-mscse', finished: true } as never, courses: [ug('CSE 60111', 'both'), ug('CSE 60321', 'both'), ug('CSE 60998', 'bs', 'Topics in Mobile Human-Computer Interaction')] });
    const ask = coursesNeedingDgsReview(s, buildRules(), TODAY).find((p) => p.course.entry.courseId === 'CSE 60998');
    assert.deepEqual(ask?.ask.decide, ['core area (§4.4.1), if any', 'specialization group (§4.4.2), if any']);
  });
});

describe('held lines', () => {
  it('a held MSCSE course with a lapsed Incomplete never says “counts in full”', () => {
    const s = phdStudent({ entryTerm: fall(2019), bachelorsAwarded: spring(2016), integratedBsMs: true, ndMasters: { term: spring(2018) }, background: { bachelors: 'nd-cse', ndIntegrated: true, graduate: 'nd-4plus1' } as never, courses: [{ courseId: 'CSE 60535', credits: 3, term: fall(2017), grade: 'I', origin: 'transfer', institution: ND, degreeLevel: 'bachelors', registeredLevel: 'graduate', countedToward: 'mscse' }, ndCourse('CSE 60427', { term: fall(2019) })] });
    assert.doesNotMatch(audit(s, buildRules(), TODAY).courseLines.find((l) => l.courseId === 'CSE 60535')!.text, /counts in full/);
  });
  it('a 4+1 senior-year course counted toward the MSCSE is held by a shorter readmission', () => {
    const s = phdStudent({ entryTerm: fall(2019), bachelorsAwarded: spring(2018), integratedBsMs: true, ndMasters: { term: spring(2019) }, background: { bachelors: 'nd-cse', ndIntegrated: true, graduate: 'nd-4plus1' } as never, readmittedTerm: fall(2022), courses: [{ ...ndCourse('CSE 60535', { term: fall(2017) }), origin: 'transfer', institution: ND, countedToward: 'mscse' }, { courseId: 'CSE 60641', credits: 3, term: fall(2018), grade: 'A', origin: 'transfer', institution: ND, degreeLevel: 'masters', registeredLevel: 'graduate' }, ndCourse('CSE 60427', { term: fall(2019) }), ndCourse('CSE 60321', { term: spring(2020) }), ndCourse('CSE 60770', { term: fall(2022) })] });
    assert.equal(classify(s, buildRules(), TODAY).classified.find((c) => c.entry.courseId === 'CSE 60535')!.beforeReadmission, true);
  });
  it('a transfer ticked as recorded and held says it is recorded, on its line and to the DGS', () => {
    const rules = buildRules({ external: [{ university: 'NORTHEASTERN UNIVERSITY', course_id: 'CS 5800', course_title: 'Algorithms', transferable_PhD: 'yes', transferable_MSCSE: 'yes', is_cse: 'yes', credit_system: 'semester' }] });
    const course = transferCourse('CS 5800', 'Algorithms', { term: spring(2017), degreeLevel: 'masters', institution: 'Northeastern University' });
    const s = phdStudent({ entryTerm: fall(2018), priorMs: 'completed', bachelorsAwarded: spring(2015), background: elsewhere, readmittedTerm: fall(2025), attestations: { transferRecorded: true, transferRecordedCourses: [transferKey(course)] }, courses: [course, ndCourse('CSE 60321', { term: fall(2018) }), ndCourse('CSE 60535', { term: fall(2025) })] });
    const r = audit(s, rules, TODAY);
    assert.match(r.courseLines.find((l) => l.courseId === 'CS 5800')!.text, /recorded by the Grad Admin, as you ticked under Approvals/);
    assert.match(coursesNeedingDgsReview(s, rules, TODAY).find((p) => p.course.entry.courseId === 'CS 5800')!.ask.decide.join(' | '), /the Grad Admin has already recorded it, as I ticked/);
  });
});

describe('wording the earlier rounds added', () => {
  it('a course elsewhere during the Notre Dame MSCSE says so', () => {
    const rules = buildRules({ external: [{ university: 'PURDUE UNIVERSITY', course_id: 'CS 50300', course_title: 'Operating Systems', transferable_PhD: 'yes', transferable_MSCSE: 'yes', is_cse: 'yes' }] });
    const ms = (id: string, term: { season: 'fall' | 'spring'; year: number }): CourseEntry => ({ courseId: id, credits: 3, term, grade: 'A', origin: 'transfer', institution: ND, degreeLevel: 'masters', registeredLevel: 'graduate' });
    const s = phdStudent({ entryTerm: fall(2025), priorMs: 'completed', bachelorsAwarded: spring(2021), ndMasters: { term: spring(2023) }, background: { bachelors: 'elsewhere', graduate: 'nd-mscse', alsoElsewhere: true, finished: true } as never, courses: [ms('CSE 60111', fall(2021)), ms('CSE 60641', spring(2023)), transferCourse('CS 50300', 'Operating Systems', { term: spring(2022), degreeLevel: 'masters' })] });
    assert.match(audit(s, rules, TODAY).courseLines.find((l) => l.courseId === 'CS 50300')!.text, /taken Spring 2022, while you were enrolled in your Notre Dame MSCSE/);
  });
  it('a `yes` transfer with no final grade, once the graduation semester has begun', () => {
    const rules = buildRules({ external: [{ university: 'PURDUE UNIVERSITY', course_id: 'CS 52500', course_title: 'CS 52500', transferable_PhD: 'yes', transferable_MSCSE: 'yes', is_cse: 'yes' }] });
    const s = phdStudent({ entryTerm: fall(2022), priorMs: 'completed', bachelorsAwarded: spring(2019), background: elsewhere, graduationTerm: fall(2026), courses: [transferCourse('CS 52500', 'CS 52500', { term: fall(2021), degreeLevel: 'masters', grade: 'IP' })] });
    assert.match(audit(s, rules, TODAY).courseLines.find((l) => l.courseId === 'CS 52500')!.text, /no final grade yet \(§5\.2 needs a B or better\); you plan to graduate in Fall 2026/);
  });
  it('seminars refused by two semesters’ maximums: both semesters named', () => {
    const nd = (id: string, term: { season: 'fall' | 'spring' | 'summer'; year: number }, credits = 3, grade: CourseEntry['grade'] = 'A'): CourseEntry => ({ courseId: id, credits, term, grade, origin: 'nd' });
    const su = { season: 'summer' as const, year: 2026 };
    const fa = fall(2026);
    const s = phdStudent({ entryTerm: fall(2025), bachelorsAwarded: spring(2025), gpa: 3.8, courses: [nd('CSE 60111', su), nd('CSE 60641', su), nd('CSE 60321', su), nd('CSE 63801', su, 1, 'S'), nd('CSE 60535', su), nd('CSE 60770', fa), nd('CSE 60762', fa), nd('CSE 60876', fa), nd('CSE 60868', fa), nd('CSE 60427', fa), nd('CSE 63802', fa, 1, 'S')] });
    const detail = audit(s, buildRules(), '2027-06-01').requirements.find((r) => r.id === 'phd.seminar')!.detail;
    if (/CSE 63801 and CSE 63802 were taken but not counted/.test(detail)) assert.match(detail, /in Summer 2026 and Fall 2026, tick it under Approvals you already have; otherwise check those semesters/);
    else assert.fail(`both seminars were not refused: ${detail}`);
  });
});
