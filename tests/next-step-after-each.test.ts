// The next step after every step the student finishes (DGS 2026-10-17:
// "after student completes each step, highlight the next things to do. Just
// like how transcript upload was highlighted after clicking 'Done'"), and
// the example student's removal (the same day: "remove 'Load example' button
// and the function"; its rows on a saved record: "Remove automatically").
// The page itself is driven by the e2e (scripts/e2e/drive-a11y.mjs); these
// pin the parts without a DOM: the order the steps are taken in, which step
// is next, and what opening a record takes out of it.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AuditReport, RequirementResult, Student } from '../src/engine/types.ts';
import { finishedBetween, importsAsked, nextOrder, ORDER } from '../src/ui/next-step.ts';
import { nextSteps, STEP_KEYS } from '../src/ui/next-steps.ts';
import { dropExampleRows, exampleRowsRemovedNote, validateStudent, type LoadCleanup } from '../src/ui/state.ts';
import { ndCourse, phdStudent } from './helpers/student.ts';

const row = (id: string, status: RequirementResult['status']): RequirementResult =>
  ({ id, group: 'g', title: id, status, detail: '', citation: { section: '§', quote: '' } }) as RequirementResult;
const report = (requirements: RequirementResult[]): AuditReport =>
  ({ program: 'phd', requirements, courseLines: [], summary: { met: 0, conditional: 0, scored: 0 }, warnings: [], tracks: [], reviewFlags: [] }) as unknown as AuditReport;

describe('the order the steps are taken in', () => {
  it('every Next steps item has its place, after the transcripts and what they set', () => {
    for (const key of STEP_KEYS) assert.ok(ORDER.includes(`step:${key}`), key);
    assert.deepEqual(ORDER.slice(0, 8), ['import.nd', 'step:standing.entry', 'step:standing.check', 'step:earlier-degrees', 'earlier.done', 'import:bachelors', 'import:masters', 'import:phd']);
  });
  it('the list itself comes in that order', () => {
    const s: Student = { ...phdStudent(), courses: [ndCourse('CSE 60641')] };
    s.entryTermInferred = { how: 'the admit-term line on your transcript' };
    const steps = nextSteps({ report: report([row('shared.advisor', 'unmet'), row('shared.approvals', 'needs_dgs_review')]), student: s, needsAnswer: ['CSE 40113'], review: { unlisted: 1, caseByCase: 0 }, processingCount: 2 });
    const keys = steps.map((x) => x.key);
    assert.deepEqual(keys, ['standing.check', 'earlier-degrees', 'coursework.degrees', 'review.send', 'advisor.name', 'advisor.approved', 'review.wait', 'processing.send', 'advisor-summary']);
    assert.deepEqual([...keys].sort((a, b) => STEP_KEYS.indexOf(a) - STEP_KEYS.indexOf(b)), keys);
  });
  it('a step that waits on someone else says so', () => {
    const s: Student = { ...phdStudent(), background: { bachelors: 'elsewhere', graduate: 'none' }, courses: [ndCourse('CSE 60641')] };
    const steps = nextSteps({ report: report([row('shared.advisor', 'met'), row('shared.approvals', 'needs_dgs_review')]), student: s, review: { unlisted: 1, caseByCase: 0 }, processingCount: 0 });
    assert.deepEqual(steps.filter((x) => x.waiting).map((x) => x.key), ['review.wait']);
  });
});

describe('which step is next', () => {
  it('a step is finished when the page no longer asks for it', () => {
    assert.deepEqual(finishedBetween(new Set(['import.nd', 'step:standing.check']), new Set(['step:standing.check', 'step:earlier-degrees'])), ['import.nd']);
    assert.deepEqual(finishedBetween(new Set(['step:standing.check']), new Set(['step:standing.check', 'step:advisor.name'])), [], 'a new item is not a finished one');
  });
  it('the next is the first still asked for after the finished one, then from the start', () => {
    // The Notre Dame import added: what it set is next.
    assert.deepEqual(nextOrder(['import.nd'], new Set(['step:advisor.name', 'step:standing.check', 'step:earlier-degrees'])), ['step:standing.check', 'step:earlier-degrees', 'step:advisor.name']);
    // The earlier degrees answered: their Done, then the rows they opened.
    assert.deepEqual(nextOrder(['step:earlier-degrees'], new Set(['import:masters', 'earlier.done', 'step:standing.check'])), ['earlier.done', 'import:masters', 'step:standing.check']);
    // The advisor named: the faculty question below it, not back to the top.
    assert.deepEqual(nextOrder(['step:advisor.name'], new Set(['step:standing.check', 'step:advisor.tenure', 'step:advisor.approved']))[0], 'step:advisor.tenure');
    // Nothing after it left: the first still open.
    assert.deepEqual(nextOrder(['step:advisor.approved'], new Set(['step:standing.check'])), ['step:standing.check']);
    // Two finished at once: from the earlier of them.
    assert.deepEqual(nextOrder(['earlier.done', 'step:earlier-degrees'], new Set(['import:bachelors', 'step:coursework.degrees']))[0], 'import:bachelors');
  });
});

describe('the earlier transcripts follow the earlier-degrees answer (DGS 2026-10-27)', () => {
  it('one graduate transcript: once the Master’s or the Ph.D. row holds courses, the other is not asked for', () => {
    assert.deepEqual(importsAsked(['bachelors', 'masters', 'phd'], []), ['bachelors', 'masters', 'phd']);
    assert.deepEqual(importsAsked(['bachelors', 'phd'], ['masters']), ['bachelors']);
    assert.deepEqual(importsAsked(['bachelors', 'masters'], ['phd']), ['bachelors']);
    assert.deepEqual(importsAsked(['masters', 'phd'], ['bachelors']), ['masters', 'phd'], 'the bachelor’s transcript settles no graduate row');
  });
  it('a Master’s transcript imported first: the Undergraduate row is next, not the Ph.D. row or the Next steps list', () => {
    const finished = finishedBetween(new Set(['import:bachelors', 'import:masters', 'import:phd', 'step:advisor.name']), new Set(['import:bachelors', 'step:coursework.degrees', 'step:advisor.name']));
    assert.deepEqual(finished, ['import:masters', 'import:phd']);
    assert.equal(nextOrder(finished, new Set(['import:bachelors', 'step:coursework.degrees', 'step:advisor.name']))[0], 'import:bachelors');
  });
  it('the Undergraduate transcript imported first: the graduate row is next', () => {
    assert.equal(nextOrder(['import:bachelors'], new Set(['import:masters', 'import:phd', 'step:coursework.degrees']))[0], 'import:masters');
  });
  it('a step after the transcripts does not send the student back to a row they skipped', () => {
    assert.equal(nextOrder(['step:advisor.name'], new Set(['import:bachelors', 'step:advisor.tenure']))[0], 'step:advisor.tenure');
  });
});

describe('the example student, gone (DGS 2026-10-17)', () => {
  const saved = (extra: Partial<Student> = {}, rows: object[] = []): Record<string, unknown> =>
    JSON.parse(JSON.stringify({ student: { ...phdStudent(), ...extra, courses: rows } })) as Record<string, unknown>;
  const exampleRow = (courseId: string) => ({ ...ndCourse(courseId), fromExample: true });
  it('opening a record takes out the rows "Load example" put there, and says how many', () => {
    const cleanup: LoadCleanup = {};
    const s = validateStudent(saved({ milestones: { advisorIdentified: '2026-09-10', advisorName: 'Prof. Example', advisorTtt: 'yes' }, attestations: { advisorApprovedPlan: true } }, [exampleRow('CSE 60641'), exampleRow('CSE 60111'), ndCourse('CSE 60321')]), [], cleanup);
    assert.deepEqual(s.courses.map((c) => c.courseId), ['CSE 60321']);
    assert.equal(cleanup.exampleRowsRemoved, 2);
    // The example's advisor and tick went with its rows…
    assert.deepEqual([s.milestones.advisorName, s.milestones.advisorIdentified, s.milestones.advisorTtt, s.attestations.advisorApprovedPlan], [undefined, undefined, undefined, undefined]);
    // …and no flag is left on what stays.
    assert.ok(s.courses.every((c) => !('fromExample' in c)));
    assert.equal(exampleRowsRemovedNote(2), '2 example course rows were removed from this record: the example student is no longer part of the app.');
    assert.equal(exampleRowsRemovedNote(1), '1 example course row was removed from this record: the example student is no longer part of the app.');
  });
  it('what the student changed stays theirs; a record without example rows is untouched', () => {
    const cleanup: LoadCleanup = {};
    const s = validateStudent(saved({ milestones: { advisorIdentified: '2026-09-10', advisorName: 'Prof. Ada Lovelace', advisorTtt: 'yes' } }, [exampleRow('CSE 60641'), ndCourse('CSE 60321')]), [], cleanup);
    assert.equal(s.milestones.advisorName, 'Prof. Ada Lovelace');
    assert.equal(cleanup.exampleRowsRemoved, 1);
    const none: LoadCleanup = {};
    const own = validateStudent(saved({ milestones: { advisorName: 'Prof. Example', advisorTtt: 'yes' }, attestations: { advisorApprovedPlan: true } }, [ndCourse('CSE 60321')]), [], none);
    assert.deepEqual([own.milestones.advisorName, own.attestations.advisorApprovedPlan, none.exampleRowsRemoved], ['Prof. Example', true, undefined]);
  });
  it('the whole-record marker of an older save is dropped too', () => {
    const s = { ...phdStudent(), isExample: true } as Student & { isExample?: true };
    assert.equal(dropExampleRows(s), 0);
    assert.equal('isExample' in s, false);
  });
});
