// "Courses counted" behind every credit row (DGS 2026-09-22).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { audit } from '../src/engine/audit.ts';
import { buildRules } from './helpers.ts';
import { ndCourse, phdStudent } from './helpers/student.ts';

describe('course contributions on credit rows (DGS 2026-09-22)', () => {
  const student = phdStudent({
    courses: [
      ndCourse('CSE 60641', { credits: 3, grade: 'A' }),
      ndCourse('CSE 63801', { credits: 1, grade: 'S' }),
      ndCourse('CSE 60111', { credits: 3, grade: 'IP' }),
    ],
  });
  const report = audit(student, buildRules(), '2026-09-22');
  const row = (id: string) => report.requirements.find((r) => r.id === id)!;
  const byId = (list: { courseId: string }[] | undefined) => [...(list ?? [])].sort((a, b) => a.courseId.localeCompare(b.courseId));
  it('the total-credit row names every counted course with its credits, and the in-progress one as pending', () => {
    assert.deepEqual(byId(row('phd.credits.total').contributions), [
      { courseId: 'CSE 60111', entryIndex: 2, credits: 3, pending: true, kind: 'in_progress' },
      { courseId: 'CSE 60641', entryIndex: 0, credits: 3 },
      { courseId: 'CSE 63801', entryIndex: 1, credits: 1 },
    ]);
  });
  it('the regular-course row leaves the seminar out', () => {
    assert.deepEqual(byId(row('phd.credits.regular').contributions).map((c) => c.courseId), ['CSE 60111', 'CSE 60641']);
  });
  it('an unused cap has no list', () => {
    assert.equal(row('phd.cap.fourk').contributions, undefined);
  });
});
