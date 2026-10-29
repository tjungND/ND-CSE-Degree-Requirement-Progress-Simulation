// Credit-transfer review 2026-10-28, batch 7: what an approval tick covers.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { audit } from '../src/engine/audit.ts';
import { coursesNeedingDgsReview } from '../src/engine/review.ts';
import { markPosted } from '../src/ui/nd-posted.ts';
import { validateStudent } from '../src/ui/state.ts';
import { transferKey } from '../src/engine/transfer-recorded.ts';
import { buildRules } from './helpers.ts';
import { phdStudent, transferCourse } from './helpers/student.ts';

const fall = (year: number) => ({ season: 'fall' as const, year });
const spring = (year: number) => ({ season: 'spring' as const, year });

describe('#10: a saved file’s old approval boxes tick only what they covered', () => {
  const saved = (courses: Record<string, unknown>[], attestations: Record<string, unknown>) =>
    validateStudent({ schemaVersion: 1, program: 'phd', entryTerm: fall(2026), priorMs: 'completed', courses, milestones: {}, attestations });
  it('the non-CSE box never ticks another university’s course, nor an undergraduate row', () => {
    const s = saved(
      [
        { courseId: 'STAT 51200', credits: 3, term: fall(2024), grade: 'A', origin: 'transfer', institution: 'Purdue University', degreeLevel: 'masters' },
        { courseId: 'MATH 60850', credits: 3, term: fall(2025), grade: 'A', origin: 'transfer', institution: 'University of Notre Dame', degreeLevel: 'bachelors', registeredLevel: 'undergraduate' },
        { courseId: 'MATH 60850', credits: 3, term: fall(2026), grade: 'A', origin: 'nd' },
      ],
      { dgsApprovedNonCse: true },
    );
    assert.deepEqual(s.courses.map((c) => c.dgsApproved === true), [false, false, true]);
  });
  it('the transfer box ticks another university’s graduate course, not Notre Dame coursework', () => {
    const s = saved(
      [
        { courseId: 'CS 52500', credits: 3, term: fall(2024), grade: 'A', origin: 'transfer', institution: 'Purdue University', degreeLevel: 'masters' },
        { courseId: 'CSE 60535', credits: 3, term: fall(2025), grade: 'A', origin: 'transfer', institution: 'University of Notre Dame', degreeLevel: 'masters' },
      ],
      { transferApproved: true },
    );
    assert.deepEqual(s.courses.map((c) => c.dgsApproved === true), [true, false]);
  });
  it('the 40000-level box reads every spelling of Notre Dame and of CSE', () => {
    const s = saved([{ courseId: 'cse 40567', credits: 3, term: fall(2025), grade: 'A', origin: 'transfer', institution: 'University of Notre-Dame', degreeLevel: 'bachelors' }], { dgsApproved4xxxx: true });
    assert.equal(s.courses[0]!.dgsApproved, true);
  });
});

describe('#29: a case-by-case tick given before the posting does not answer the posting’s question', () => {
  it('held posting (before this program): the old tick goes; a posting after entry keeps it', () => {
    const before = transferCourse('CS 58000', 'CS 58000', { term: fall(2023), degreeLevel: 'masters', dgsApproved: true });
    markPosted(before, { term: spring(2024), credits: 3, level: 'graduate' }, fall(2025));
    assert.equal(before.dgsApproved, undefined);
    const after = transferCourse('CS 58000', 'CS 58000', { term: fall(2023), degreeLevel: 'masters', dgsApproved: true });
    markPosted(after, { term: spring(2026), credits: 3, level: 'graduate' }, fall(2025));
    assert.equal(after.dgsApproved, true);
  });
});

describe('#26: a blank Courses-tab verdict is asked as the sheet’s question', () => {
  it('earlier Notre Dame coursework, row blank — not “the course rules say case by case”', () => {
    const s = phdStudent({
      entryTerm: fall(2025), ndMasters: { term: spring(2025) }, bachelorsAwarded: spring(2023),
      background: { bachelors: 'elsewhere', graduate: 'nd-mscse', finished: true } as never,
      courses: [{ courseId: 'CSE 60999', title: 'Topics', credits: 3, term: fall(2023), grade: 'A', origin: 'transfer', institution: 'University of Notre Dame', degreeLevel: 'masters', registeredLevel: 'graduate' }],
    });
    const asks = coursesNeedingDgsReview(s, buildRules(), '2026-10-28').flatMap((p) => p.ask?.decide ?? []);
    assert.ok(asks.some((a) => /the row is blank/.test(a)), asks.join(' | '));
    assert.ok(!asks.some((a) => /course rules say case by case/.test(a)), asks.join(' | '));
  });
});

describe('#31: the recorded tick covers the transfers it was given for', () => {
  it('a transfer decided after the tick is still to submit', () => {
    const rules = buildRules({ external: [{ university: 'PURDUE UNIVERSITY', course_id: 'CS 52500', course_title: 'CS 52500', transferable_PhD: 'yes', transferable_MSCSE: 'yes', is_cse: 'yes' }, { university: 'PURDUE UNIVERSITY', course_id: 'CS 58000', course_title: 'CS 58000', transferable_PhD: 'dgs_approval', transferable_MSCSE: 'dgs_approval', is_cse: 'yes' }] });
    const s = phdStudent({
      entryTerm: fall(2025), priorMs: 'completed', bachelorsAwarded: spring(2019), background: { bachelors: 'elsewhere', graduate: 'elsewhere', samePlace: false, finished: true },
      attestations: { transferRecorded: true, transferRecordedCourses: [transferKey({ courseId: 'CS 52500', institution: 'Purdue University', term: fall(2023) })] },
      courses: [transferCourse('CS 52500', 'CS 52500', { term: fall(2023), degreeLevel: 'masters' }), transferCourse('CS 58000', 'CS 58000', { term: fall(2023), degreeLevel: 'masters', dgsApproved: true })],
    });
    const r = audit(s, rules, '2026-10-29');
    const lines = r.courseLines.filter((l) => /^CS /.test(l.courseId)).map((l) => [l.courseId, /recorded by the Grad Admin/.test(l.text)]);
    assert.deepEqual(lines, [['CS 52500', true], ['CS 58000', false]]);
    assert.equal(r.requirements.find((x) => x.id === 'phd.transfer')!.status, 'in_progress');
  });
});
