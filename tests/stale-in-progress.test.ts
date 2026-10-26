// Past-semester courses still "In progress" (blue-team review 2026-10-17,
// U21): the engine compared a course's semester with today only to catch a
// FINAL grade dated in the future, never the reverse, so a record imported
// mid-semester and never updated kept its courses "in progress" for ever —
// the dial counted them so, and a deadline row they would satisfy could read
// Overdue for a course the student had passed. Now: ONE warning per ended
// semester naming the courses and both fix paths, the same as a step in the
// Next steps list, placed so next-step.ts can ring "Import again".
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classify, staleInProgressSentence, staleInProgressTerms } from '../src/engine/allocate.ts';
import { audit } from '../src/engine/audit.ts';
import type { CourseEntry, Student } from '../src/engine/types.ts';
import { ORDER } from '../src/ui/next-step.ts';
import { nextSteps, STEP_KEYS } from '../src/ui/next-steps.ts';
import { simulationWarnings } from '../src/ui/simulation.ts';
import { buildRules, loadScenario } from './helpers.ts';

const rules = buildRules();
const sc = loadScenario('phd-in-progress-past-term');
const WARNING = 'Fall 2026 has ended and CSE 60770, CSE 60876 still read In progress — import your updated Notre Dame transcript (Import again) or set each course’s grade.';

describe('courses still In progress after their semester ended (U21)', () => {
  it('the scenario gets ONE warning for the ended semester, none for the current one', () => {
    const report = audit(sc.student, rules, sc.today);
    const stale = report.warnings.filter((w) => /has ended and/.test(w));
    assert.deepEqual(stale, [WARNING]);
    assert.deepEqual(report.staleInProgress, [{ term: { season: 'fall', year: 2026 }, courseIds: ['CSE 60770', 'CSE 60876'], nd: true }]);
    // The same record a semester earlier, inside Fall 2026: nothing has ended.
    const earlier = audit(sc.student, rules, '2026-11-01');
    assert.equal(earlier.warnings.some((w) => /has ended and/.test(w)), false);
    assert.equal(earlier.staleInProgress, undefined);
  });
  it('an I keeps its own lapse rule; a final grade is never "still In progress"; no today, no warning', () => {
    const courses: CourseEntry[] = [
      { courseId: 'CSE 60641', credits: 3, term: { season: 'fall', year: 2026 }, grade: 'I', origin: 'nd' },
      { courseId: 'CSE 60111', credits: 3, term: { season: 'fall', year: 2026 }, grade: 'A', origin: 'nd' },
    ];
    assert.deepEqual(staleInProgressTerms(courses, '2027-03-01'), []);
    assert.deepEqual(staleInProgressTerms(sc.student.courses, undefined), []);
    assert.equal(classify(sc.student, rules).warnings.some((w) => /has ended and/.test(w)), false);
  });
  it('one sentence per ended semester, earliest first, the courses in table order and each once', () => {
    const ip = (courseId: string, season: 'fall' | 'spring', year: number, origin: 'nd' | 'transfer' = 'nd'): CourseEntry =>
      ({ courseId, credits: 3, term: { season, year }, grade: 'IP', origin, ...(origin === 'transfer' ? { institution: 'Example Institute of Technology' } : {}) }) as CourseEntry;
    const groups = staleInProgressTerms([ip('CSE 60876', 'fall', 2026), ip('CSE 60770', 'fall', 2026), ip('CSE 60770', 'fall', 2026), ip('CSE 60321', 'spring', 2026)], '2027-03-01');
    assert.deepEqual(groups.map((g) => staleInProgressSentence(g)), [
      'Spring 2026 has ended and CSE 60321 still reads In progress — import your updated Notre Dame transcript (Import again) or set its grade.',
      WARNING,
    ]);
    // Courses from another university have no transcript to import again.
    assert.equal(
      staleInProgressSentence(staleInProgressTerms([ip('CS 53000', 'fall', 2026, 'transfer'), ip('CS 54000', 'fall', 2026, 'transfer')], '2027-03-01')[0]!),
      'Fall 2026 has ended and CS 53000, CS 54000 still read In progress — set each course’s grade.',
    );
    // A Notre Dame course in the group brings the import path back for it.
    assert.match(staleInProgressSentence(staleInProgressTerms([ip('CS 53000', 'fall', 2026, 'transfer'), ip('CSE 60770', 'fall', 2026)], '2027-03-01')[0]!), /^Fall 2026 has ended and CS 53000, CSE 60770 still read In progress — import your updated/);
  });
  it('in simulation mode the warning drops "Import again" and speaks of the plan (DGS 2026-10-25)', () => {
    const report = audit(sc.student, rules, sc.today);
    const sim = simulationWarnings(report);
    assert.deepEqual(
      sim.warnings.filter((w) => /has ended and/.test(w)),
      ['In this simulation, Fall 2026 has ended and CSE 60770, CSE 60876 still read In progress — give each course the grade you expect under Coursework.'],
    );
    // Every other warning is the engine's own, in its place; the report itself is not mutated.
    assert.deepEqual(sim.warnings.filter((w) => !/has ended and/.test(w)), report.warnings.filter((w) => !/has ended and/.test(w)));
    assert.equal(sim.warnings.indexOf(sim.warnings.find((w) => /has ended and/.test(w))!), report.warnings.indexOf(WARNING));
    assert.ok(report.warnings.includes(WARNING));
    assert.equal(sim.requirements, report.requirements);
    // One course; a group with no Notre Dame course reads the same in the mode.
    const one = staleInProgressTerms([{ courseId: 'CS 53000', credits: 3, term: { season: 'spring', year: 2026 }, grade: 'IP', origin: 'transfer', institution: 'Example Institute of Technology' } as CourseEntry], '2027-03-01')[0]!;
    assert.equal(staleInProgressSentence(one, true), 'In this simulation, Spring 2026 has ended and CS 53000 still reads In progress — give it the grade you expect under Coursework.');
    // No stale course: the very same report object back.
    const fresh = audit(sc.student, rules, '2026-11-01');
    assert.equal(simulationWarnings(fresh), fresh);
  });
  it('the Next steps list carries the step, right after "Check what your transcript set", linked to the Transcripts card', () => {
    assert.equal(STEP_KEYS.indexOf('grades.update'), STEP_KEYS.indexOf('standing.check') + 1);
    assert.ok(ORDER.includes('step:grades.update'));
    // After the transcripts and what they set (next-step.ts ORDER), before the rest of the list.
    assert.ok(ORDER.indexOf('step:grades.update') > ORDER.indexOf('import:phd') && ORDER.indexOf('step:grades.update') < ORDER.indexOf('step:coursework.degrees'));
    const report = audit(sc.student, rules, sc.today);
    const steps = nextSteps({ report, student: sc.student, review: { unlisted: 0, caseByCase: 0 }, processingCount: 0 });
    const step = steps.find((s) => s.key === 'grades.update');
    assert.deepEqual(step, {
      key: 'grades.update',
      text: 'Fall 2026 has ended and CSE 60770, CSE 60876 still read In progress — import your updated Notre Dame transcript (Import again, in the Transcripts card) or set each course’s grade under Coursework.',
      href: '#transcripts',
    });
    assert.equal(steps[0]?.key, 'grades.update', 'nothing to confirm from a typed record, so the step leads');
    // In simulation mode the imports are inert (DGS 2026-10-09): the grade path alone, at Coursework.
    const sim = nextSteps({ report, student: sc.student, review: { unlisted: 0, caseByCase: 0 }, processingCount: 0, simulation: true }).find((s) => s.key === 'grades.update');
    assert.deepEqual(sim, { key: 'grades.update', text: 'Fall 2026 has ended and CSE 60770, CSE 60876 still read In progress — set each course’s grade under Coursework.', href: '#coursework' });
    // Two ended semesters: one step naming both.
    const two: Student = { ...sc.student, courses: [...sc.student.courses, { courseId: 'CSE 60321', credits: 3, term: { season: 'spring', year: 2026 }, grade: 'IP', origin: 'nd' }] };
    const both = nextSteps({ report: audit(two, rules, sc.today), student: two, review: { unlisted: 0, caseByCase: 0 }, processingCount: 0 }).find((s) => s.key === 'grades.update');
    assert.match(both?.text ?? '', /^Spring 2026 and Fall 2026 have ended and CSE 60321, CSE 60770, CSE 60876 still read In progress — import/);
    // No stale course, no step.
    assert.equal(nextSteps({ report: audit(sc.student, rules, '2026-11-01'), student: sc.student, review: { unlisted: 0, caseByCase: 0 }, processingCount: 0 }).some((s) => s.key === 'grades.update'), false);
  });
});
