// A core area waiting for the DGS keeps the OCE gate closed (DGS 2026-10-06,
// answering the question raised with P3-chg-phd-1: "Treat both as not done").
// The gate (oceReadiness, phd.ts) used to count a core area met only by a
// course the DGS has still to rule on as done, while regular credits awaiting
// a DGS decision were not; the 2026-10-05 rule reads "every core area and the
// specialization row is met or In progress". Now both wait for the decision,
// and the card names the decision, not a course to take.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { audit } from '../src/engine/audit.ts';
import type { Student } from '../src/engine/types.ts';
import { buildRules, loadScenario } from './helpers.ts';
import { ndCourse, phdStudent, transferCourse } from './helpers/student.ts';

const fall = (year: number) => ({ season: 'fall' as const, year });
const spring = (year: number) => ({ season: 'spring' as const, year });
const TODAY = '2026-10-06';
const PURDUE_ALGORITHMS = { university: 'Purdue University', course_id: 'CS 58000', course_title: 'Design and Analysis of Algorithms', transferable_PhD: 'yes', transferable_MSCSE: 'yes', credit_system: 'semester', is_cse: 'yes', satisfies_core_area: 'algorithms' };

/** Every OCE condition met at Notre Dame except the Algorithms core area, which only CS 58000 from Purdue can satisfy — not yet ruled on. */
const recordA = (): Student => {
  const ids = ['CSE 60641', 'CSE 60321', 'CSE 60876', 'CSE 60427', 'CSE 60535', 'CSE 60762', 'CSE 60770', 'CSE 60868'];
  const terms = [fall(2024), fall(2024), spring(2025), spring(2025), fall(2025), fall(2025), spring(2026), spring(2026)];
  return phdStudent({
    entryTerm: fall(2024),
    bachelorsAwarded: spring(2022),
    priorMs: 'completed',
    gpa: 3.7,
    courses: [...ids.map((id, i) => ndCourse(id, { term: terms[i]! })), transferCourse('CS 58000', 'Design and Analysis of Algorithms', { term: fall(2023), degreeLevel: 'masters' })],
    fullTimeTermOverrides: [fall(2024), spring(2025), fall(2025), spring(2026)],
    milestones: { advisorIdentified: '2024-10-01', advisorName: 'Prof. Example', advisorTtt: 'yes', rcrTrainingCompleted: '2025-09-15' },
  });
};
const card = (s: Student, rules = buildRules()) => audit(s, rules, TODAY).requirements.find((r) => r.id === 'phd.candidacyAdmission')!;

describe('the OCE gate waits for the DGS on a core area too (DGS 2026-10-06)', () => {
  it('a core area waiting for the DGS: Not started, naming the decision', () => {
    const c = card(recordA());
    assert.match(c.detail, /^Not started\./);
    assert.match(c.detail, /Regular-course credits: 24 of 24 complete/);
    assert.match(c.detail, /Core knowledge, Algorithms: waiting for the DGS \(CS 58000\)/);
    assert.match(c.detail, /still needed: the DGS’s decision on CS 58000\./);
    assert.match(c.detail, /A course waiting for the DGS’s decision counts once the DGS approves it/);
  });
  it('once the DGS confirms it in the course rules, the gate opens', () => {
    const c = card(recordA(), buildRules({ external: [PURDUE_ALGORITHMS] }));
    assert.equal(c.status, 'in_progress');
    assert.doesNotMatch(c.detail, /^Not started/);
  });
});

// The candidacy card names regular credits waiting for the DGS (policy review
// round 3, P3-chg-phd-1): it said "3 more needed" and "still needed: 3 more
// regular-course credits" while the Coursework card called the same credits
// "pending review/approval". The gate stays closed (2026-10-05); the card now
// names the decision first, and the shortfall is still counted without them.
describe('regular credits waiting for the DGS are named, not asked for again (P3-chg-phd-1)', () => {
  /** Record B: 21 graded regular credits, every other OCE condition met, and CSE 40567 (dgs_approval in the rules) not yet approved. */
  const recordB = (extra: ReturnType<typeof ndCourse>[] = []): Student => {
    const ids = ['CSE 60641', 'CSE 60321', 'CSE 60111', 'CSE 60427', 'CSE 60535', 'CSE 60762', 'CSE 60770'];
    const terms = [fall(2024), fall(2024), spring(2025), spring(2025), fall(2025), fall(2025), spring(2026)];
    return phdStudent({
      entryTerm: fall(2024),
      bachelorsAwarded: spring(2024),
      gpa: 3.7,
      courses: [...ids.map((id, i) => ndCourse(id, { term: terms[i]! })), ndCourse('CSE 40567', { term: spring(2026) }), ...extra],
      fullTimeTermOverrides: [fall(2024), spring(2025), fall(2025), spring(2026)],
      milestones: { advisorIdentified: '2024-10-01', advisorName: 'Prof. Example', advisorTtt: 'yes', rcrTrainingCompleted: '2025-09-15' },
    });
  };
  it('enough pending to close the gap: the decision first, then the courses it would spare', () => {
    const c = card(recordB());
    assert.match(c.detail, /^Not started\./);
    assert.match(c.detail, /Regular-course credits: 21 of 24 complete, 3 waiting for a DGS decision \(CSE 40567\) — 3 more needed unless the DGS approves them \(transferred regular-course credits count\)/);
    // The total first, then what the decision would cover (P4-phd-10, DGS 2026-10-12).
    assert.match(c.detail, /still needed: 3 more regular-course credits \(all of them can be satisfied by CSE 40567 if the DGS approves it\)\./);
  });
  it('not enough pending: what is needed either way, and what the decision would spare', () => {
    const s = recordB();
    s.courses = s.courses.filter((c) => c.courseId !== 'CSE 60770');
    const c = card(s);
    assert.match(c.detail, /Regular-course credits: 18 of 24 complete, 3 waiting for a DGS decision \(CSE 40567\) — 6 more needed, 3 if the DGS approves them/);
    assert.match(c.detail, /still needed: 6 more regular-course credits \(3 of them can be satisfied by CSE 40567 if the DGS approves it\)\./);
  });
  it('one course both pending as credit and for a core area: the decision is named once', () => {
    const s = recordA();
    s.courses = s.courses.filter((c) => c.courseId !== 'CSE 60868');
    const c = card(s);
    assert.match(c.detail, /3 waiting for a DGS decision \(CS 58000\)/);
    assert.match(c.detail, /Core knowledge, Algorithms: waiting for the DGS \(CS 58000\)/);
    assert.match(c.detail, /still needed: 3 more regular-course credits \(all of them can be satisfied by CS 58000 if the DGS approves it\)\./);
    assert.equal((/still needed: [^.]*\./.exec(c.detail)?.[0] ?? '').split('CS 58000').length, 2, 'named once in what is still needed');
  });
});

// A student who already passed the OCE while credits wait for the DGS (policy
// review round 3, P3-hidden-inputs-1; DGS 2026-10-07: option (3), "Keep as
// is"): the gate stays closed until the DGS decides, so the form shows no OCE
// date box, and the card names the decision; the review request is how the
// rows reach the sheet. A record that already carries the date (a saved file)
// goes to the DGS, as 2026-09-12 (seventh) F8 item 4 has it.
describe('an OCE passed while credits wait for the DGS (P3-hidden-inputs-1, option (3))', () => {
  /** Entered Fall 2023, a tenure-track advisor, 15 CSE regular credits covering the core areas and the specialization, and 9 prior-master's credits the ExternalCourses tab does not list. */
  const recordC = (candidacyPassed?: string): Student => {
    const ids = ['CSE 60641', 'CSE 60321', 'CSE 60111', 'CSE 60876', 'CSE 60427'];
    const terms = [fall(2023), fall(2023), spring(2024), spring(2024), fall(2024)];
    return phdStudent({
      entryTerm: fall(2023),
      bachelorsAwarded: spring(2021),
      priorMs: 'completed',
      gpa: 3.7,
      courses: [
        ...ids.map((id, i) => ndCourse(id, { term: terms[i]! })),
        ...['ECE 53800', 'ECE 62700', 'ECE 63700'].map((id) => transferCourse(id, undefined, { term: fall(2021), degreeLevel: 'masters', institution: 'Example State University' })),
      ],
      fullTimeTermOverrides: [fall(2023), spring(2024), fall(2024), spring(2025)],
      milestones: { advisorIdentified: '2023-10-01', advisorName: 'Prof. Example', advisorTtt: 'yes', rcrTrainingCompleted: '2025-09-15', ...(candidacyPassed ? { candidacyPassed } : {}) },
    });
  };
  const oce = (s: Student) => audit(s, buildRules(), '2026-10-05').requirements.find((r) => r.id === 'phd.candidacy')!;
  it('undated: Not started, naming the credits waiting for the DGS rather than asking for more', () => {
    const c = card(recordC());
    assert.equal(c.status, 'unmet');
    assert.match(c.detail, /^Not started\./);
    assert.match(c.detail, /Regular-course credits: 15 of 24 complete, 9 waiting for a DGS decision \(ECE 53800, ECE 62700, ECE 63700\) — 9 more needed unless the DGS approves them/);
    assert.match(c.detail, /still needed: 9 more regular-course credits \(all of them can be satisfied by ECE 53800, ECE 62700 and ECE 63700 if the DGS approves them\)\./);
    assert.match(oce(recordC()).detail, /^Not started\./);
  });
  it('dated on a saved record: Needs DGS review, with the coursework at the exam', () => {
    const c = oce(recordC('2026-04-20'));
    assert.equal(c.status, 'needs_dgs_review');
    assert.match(c.detail, /At the exam \(Spring 2026\) you show 15 of 24 regular-course credits \(9 more waiting for a DGS decision\)/);
  });
});

// "Still needed" names the total first, then what the waiting courses could
// cover of it (policy review round 4, P4-phd-10; DGS 2026-10-12: "make it
// clear how many total credits are needed … something like '21 more credits
// are needed; 6 of them can be satisfied by two courses XXX YYY if DGS
// approve'"). It read "15 more regular-course credits, and the DGS's decision
// on CSE 60641, CSE 60111 or 6 more and an advisor who is …", whose "or" ran
// into the advisor item.
describe('the total first, then what a decision would cover (P4-phd-10)', () => {
  it('the readmitted student of the finding: 21 needed, 6 of them by the two held courses', () => {
    const sc = loadScenario('phd-readmitted-candidacy-calendar');
    const c = audit(sc.student, buildRules(sc.rules.patch), '2025-10-05').requirements.find((r) => r.id === 'phd.candidacy')!;
    assert.match(c.detail, /still needed: 21 more regular-course credits \(6 of them can be satisfied by CSE 60641 and CSE 60111 if the DGS approves them\) and an advisor who is tenured or tenure-track CSE faculty \(§4\.5\)\./);
  });
  it('a course waiting for the DGS and one waiting for the Graduate School’s plan approval: each named with its approver', () => {
    const ids = ['CSE 60641', 'CSE 60321', 'CSE 60111', 'CSE 60427', 'CSE 60535'];
    const terms = [fall(2024), fall(2024), spring(2025), spring(2025), fall(2025)];
    const s = phdStudent({
      entryTerm: fall(2024),
      bachelorsAwarded: spring(2024),
      gpa: 3.7,
      concurrentDegree: true,
      courses: [...ids.map((id, i) => ndCourse(id, { term: terms[i]! })), ndCourse('CSE 40567', { term: spring(2026) }), ndCourse('CSE 60876', { term: spring(2026), sharedWithOtherDegree: true })],
      fullTimeTermOverrides: [fall(2024), spring(2025), fall(2025), spring(2026)],
      milestones: { advisorIdentified: '2024-10-01', advisorName: 'Prof. Example', advisorTtt: 'yes', rcrTrainingCompleted: '2025-09-15' },
    });
    const c = card(s);
    assert.match(c.detail, /still needed: 9 more regular-course credits \(3 of them can be satisfied by CSE 40567 if the DGS approves it, and 3 by CSE 60876 if the Graduate School approves your dual-degree plan of study\)\./);
  });
});
