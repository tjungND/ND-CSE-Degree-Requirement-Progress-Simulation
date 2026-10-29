// Printing credit counts once they can be fractional (DGS 2026-09-08).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatCredits } from '../src/engine/credits.ts';

describe('formatCredits', () => {
  it('whole numbers stay plain', () => {
    assert.equal(formatCredits(3), '3');
    assert.equal(formatCredits(0), '0');
    assert.equal(formatCredits(24), '24');
  });

  it('a converted quarter course reads as a number, not a float', () => {
    assert.equal(formatCredits(4 * (2 / 3)), '2.67');
    assert.equal(formatCredits(2 * (2 / 3)), '1.33');
    assert.equal(formatCredits(9 * (2 / 3)), '6', 'nine quarter hours are exactly six');
  });

  it('halves keep one decimal, not a trailing zero', () => {
    assert.equal(formatCredits(2.5), '2.5');
    assert.equal(formatCredits(1.5), '1.5');
  });
});

// Credit-transfer review 2026-10-28 (#0, #52): sums of decimal credits on a
// six-decimal grid, so exactly 24 is 24 and a remainder prints as 1.44.
import { exactCredits } from '../src/engine/credits.ts';
import { thresholdStatus } from '../src/engine/status.ts';
import { actionItems } from '../src/ui/advisor-summary.ts';
import { audit } from '../src/engine/audit.ts';
import { buildRules } from './helpers.ts';
import { ndCourse, phdStudent, transferCourse } from './helpers/student.ts';

describe('decimal credits add up exactly (credit-transfer review 2026-10-28)', () => {
  it('exactCredits removes floating-point noise and keeps real decimals', () => {
    assert.equal(exactCredits(3 * 0.66), 1.98);
    assert.equal(exactCredits(9 - (1.98 + 2.64 + 2.64)), 1.74);
    assert.equal(exactCredits(23.999999999999996), 24);
    assert.equal(exactCredits(3.3), 3.3);
  });
  it('a sum within a millionth of the minimum reaches it', () => {
    assert.equal(thresholdStatus({ definite: 23.999999999999996, in_progress: 0, provisional: 0 }, 24), 'met');
    assert.equal(thresholdStatus({ definite: 23.99, in_progress: 0, provisional: 0 }, 24), 'unmet');
  });
  it('the advisor email prints the credits still needed as the page does ("1.44", not "1.4399999999999977")', () => {
    const UCSD = 'UNIVERSITY OF CALIFORNIA, SAN DIEGO';
    const rules = buildRules({
      external: ['CSE 202', 'CSE 221', 'CSE 222A', 'CSE 224'].map((id) => ({ university: UCSD, course_id: id, course_title: id, transferable_PhD: 'yes', transferable_MSCSE: 'yes', is_cse: 'yes' })),
      universities: [{ university: UCSD, credit_system: 'quarter' }],
    });
    // 4 × 2.64 = 10.56 transferred + 12 Notre Dame = 22.56 regular credits.
    const s = phdStudent({
      entryTerm: { season: 'fall', year: 2025 },
      priorMs: 'completed',
      bachelorsAwarded: { season: 'spring', year: 2023 },
      background: { bachelors: 'elsewhere', graduate: 'elsewhere', samePlace: false, finished: true },
      courses: [
        ...['CSE 202', 'CSE 221', 'CSE 222A', 'CSE 224'].map((id) => transferCourse(id, id, { credits: 4, degreeLevel: 'masters', institution: 'University of California, San Diego' })),
        ...['CSE 60111', 'CSE 60321', 'CSE 60641', 'CSE 60535'].map((id) => ndCourse(id, { term: { season: 'fall', year: 2025 } })),
      ],
    });
    const items = actionItems(audit(s, rules, '2026-10-28')).student;
    assert.ok(items.includes('Complete 1.44 more credits of regular courses (§4.2).'), items.join(' | '));
    assert.ok(!items.some((i) => /\d\.\d{3,}/.test(i)), items.join(' | '));
  });
});
