// Repro: a non-CSE course whose refused credit spills to the total (F1) and is
// then cut by the semester maximum (#3) has excluded > 0 and boundCaps
// [noncse, term:…]; the non-CSE card lists the semester maximum's refusal as
// "not counted — beyond the allowance" (batch 8: an allowance card lists only
// what its own cap refused) and omits the 2 credits that spilled.
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { audit } from '../src/engine/audit.ts';
import { buildRules } from './helpers.ts';
import { ndCourse, phdStudent } from './helpers/student.ts';

it('the non-CSE card does not claim the semester maximum’s refusal', () => {
  const f26 = { term: { season: 'fall' as const, year: 2026 } };
  const f27 = { term: { season: 'fall' as const, year: 2027 } };
  const student = phdStudent({
    courses: [
      ndCourse('MATH 60300', f26), ndCourse('MATH 60400', f26), ndCourse('MATH 60500', f26),
      ndCourse('CSE 60111', f27), ndCourse('CSE 60321', f27), ndCourse('CSE 60427', f27), ndCourse('CSE 60535', f27),
      ndCourse('CSE 63801', { ...f27, credits: 1 }),
      ndCourse('MATH 60100', { ...f27, dgsApproved: true }),
    ],
  });
  const report = audit(student, buildRules(), '2028-01-15');
  const card = report.requirements.find((r) => r.id === 'phd.cap.noncse')!;
  const line = report.courseLines.find((l) => l.courseId === 'MATH 60100')!;
  assert.doesNotMatch(card.detail ?? '', /MATH 60100: 1 credit not counted — beyond the allowance/);
});
