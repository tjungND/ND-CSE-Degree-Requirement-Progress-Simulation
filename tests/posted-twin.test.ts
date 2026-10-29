// Credit-transfer review 2026-10-28 (#22): a course the other university lists
// twice (a retake) and the Notre Dame record posts once — the acceptance goes
// on the attempt the Graduate School could have accepted, whatever the order.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { preferredTwin } from '../src/engine/nd-posting.ts';
import { twinOfBlockRow } from '../src/ui/nd-posted.ts';
import { transferCourse } from './helpers/student.ts';

const bMinus = transferCourse('CS 50100', 'Algorithms', { term: { season: 'fall', year: 2023 }, grade: 'B-', degreeLevel: 'masters' });
const a = transferCourse('CS 50100', 'Algorithms', { term: { season: 'spring', year: 2024 }, grade: 'A', degreeLevel: 'masters' });
const block = { courseId: 'CS 50100', institution: 'Purdue University', origin: 'transfer' as const };

describe('the posting goes on the attempt that could carry §5.2 credit', () => {
  it('the A retake, in either order', () => {
    assert.equal(twinOfBlockRow({ courses: [bMinus, a] }, block), a);
    assert.equal(twinOfBlockRow({ courses: [a, bMinus] }, block), a);
  });
  it('B or better first, then S, then the latest', () => {
    const s = transferCourse('CS 50100', 'Algorithms', { term: { season: 'fall', year: 2024 }, grade: 'S', degreeLevel: 'masters' });
    const b = transferCourse('CS 50100', 'Algorithms', { term: { season: 'fall', year: 2022 }, grade: 'B', degreeLevel: 'masters' });
    assert.equal(preferredTwin([s, bMinus, b]), b);
    assert.equal(preferredTwin([s, bMinus]), s);
    assert.equal(preferredTwin([bMinus]), bMinus);
    assert.equal(preferredTwin([]), undefined);
  });
});
