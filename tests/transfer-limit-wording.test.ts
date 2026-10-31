// Where no document states a transfer limit, the number is the page's
// working limit and says so (policy review round 3, P3-cse-5-6-1; DGS
// 2026-10-06: "apply the suggested handling"). CSE §5.2 and Academic Code
// §4.6 state a limit only after an unfinished master's (6) or a completed
// degree (9 / 24). The transfer row called the 6 "§5.2's allowance for a
// student with no prior graduate degree" and, in the same sentence, said no
// document states it; the 2026-10-03 fix had left the prefix. The wording now
// follows the courses held for having no earlier program, so a student who
// finished the Notre Dame MSCSE (priorMs 'none' too) is not told they have no
// earlier graduate program.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { audit } from '../src/engine/audit.ts';
import type { Student } from '../src/engine/types.ts';
import { buildRules } from './helpers.ts';
import { phdStudent, transferCourse } from './helpers/student.ts';

const rules = buildRules();
const transferRow = (s: Student) => audit(s, rules, '2026-10-06').requirements.find((r) => r.id === 'phd.transfer')!;
const UMASS = transferCourse('COMPSCI 589', 'Machine Learning', { term: { season: 'fall', year: 2024 }, institution: 'University of Massachusetts Amherst', degreeLevel: 'masters' });

describe('the transfer row names a working limit as one (P3-cse-5-6-1)', () => {
  it('no earlier graduate program: the page’s working limit, the DGS decides', () => {
    const r = transferRow(phdStudent({ entryTerm: { season: 'fall', year: 2025 }, bachelorsAwarded: { season: 'spring', year: 2024 }, priorMs: 'none', courses: [UMASS] }));
    assert.match(r.detail, /The 6 is this page’s working limit: no document states a transfer allowance for a student with no earlier graduate program, so the DGS decides each course/);
    assert.doesNotMatch(r.detail, /§5\.2’s allowance/);
  });
  it('a finished Notre Dame MSCSE is an earlier program: not told it has none', () => {
    const r = transferRow(
      phdStudent({ entryTerm: { season: 'fall', year: 2025 }, bachelorsAwarded: { season: 'spring', year: 2022 }, priorMs: 'none', ndMasters: { term: { season: 'spring', year: 2024 } }, phdAdmittedTerm: { season: 'spring', year: 2025 }, courses: [UMASS] }),
    );
    assert.doesNotMatch(r.detail, /no earlier graduate program|§5\.2’s allowance/);
    // Since 2026-10-07 (P3-prior-programs-6 (a)) the course waits for the DGS — taken in no program at that university.
    // Taken before the Ph.D. admission letter (Spring 2025), it needed no approval in advance (DGS 2026-10-30).
    assert.match(r.detail, /^Waiting for the DGS: COMPSCI 589/);
    assert.match(r.detail, /The 6 is this page’s working limit: your earlier program is the Notre Dame MSCSE, one program with the Ph\.D\., and no document states a transfer allowance for a course taken outside a program elsewhere, so the DGS decides each course/);
  });
  it('a completed prior degree keeps §5.2’s allowance', () => {
    const r = transferRow(phdStudent({ entryTerm: { season: 'fall', year: 2025 }, bachelorsAwarded: { season: 'spring', year: 2021 }, priorMs: 'completed', courses: [UMASS] }));
    assert.match(r.detail, /The 24 is §5\.2’s allowance for a completed prior degree/);
  });
});
