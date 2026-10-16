// A previous-undergraduate transcript is refused while the degree is in
// progress (DGS 2026-09-11) — but not when the transcript itself says the
// degree was conferred and a row merely has no readable grade (DGS
// 2026-09-16: a false rejection).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { undergraduateInProgress } from '../src/ui/external-upload.ts';

describe('is the undergraduate transcript still in progress?', () => {
  const rows = [{ grade: 'A' }, { grade: '' }, { grade: 'IP' }];
  it('ungraded rows mean in progress only while no conferral is stated', () => {
    assert.equal(undergraduateInProgress('bachelors', rows), true);
    assert.equal(undergraduateInProgress('bachelors', rows, true), false, 'the transcript says the degree was conferred');
    assert.equal(undergraduateInProgress('bachelors', [{ grade: 'A' }, { grade: 'B+' }]), false);
  });
  // CC15 (2026-10-09) let a printed raw result count as final; the review fix
  // of 2026-10-10 limits that to what CC15 was decided for — a mark or a band
  // word. A status code the app cannot read is no final result.
  it('a raw MARK or BAND WORD is a final result; a raw status code is not (review fix 2026-10-10)', () => {
    const lastRow = (rawGrade: string) => undergraduateInProgress('bachelors', [{ grade: 'A' }, { grade: '', rawGrade }]);
    for (const code of ['NR', 'NG', 'R', 'Z', 'PEND', 'CUR', 'REG', 'X', 'DEF', 'DE', 'I', 'NA', 'Incomplete', 'Registered', 'In Progress', 'Pending']) {
      assert.equal(lastRow(code), true, code);
    }
    for (const result of ['92', '14,50', '16/20', '128', '85%', '61 CR', '47 FA', '30 e lode', 'Excellent', 'Very Good', 'Good', 'Pass', 'Fail', 'very  good']) {
      assert.equal(lastRow(result), false, result);
    }
    assert.equal(undergraduateInProgress('bachelors', [{ grade: '', rawGrade: 'REG' }], true), false, 'a stated conferral still wins');
  });
  // DGS 2026-10-16: an official Rutgers record of a finished degree, its own
  // rows all graded but one withdrawal, was refused as still in progress.
  it('a withdrawal or an audit is a final result; an incomplete is not', () => {
    const lastRow = (rawGrade: string) => undergraduateInProgress('bachelors', [{ grade: 'A' }, { grade: '', rawGrade }]);
    for (const code of ['W', 'WD', 'WF', 'WP', 'WU', 'WX', 'AU', 'w']) assert.equal(lastRow(code), false, code);
    for (const code of ['I', 'IN', 'INC', 'NR', 'WW', 'AUD?']) assert.equal(lastRow(code), true, code);
  });
  it('never applies to a master\'s or Ph.D. slot', () => {
    assert.equal(undergraduateInProgress('masters', rows), false);
    assert.equal(undergraduateInProgress('phd', rows), false);
  });
});
