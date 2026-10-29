// Two earlier graduate programs (policy review round 3, P3-prior-programs-3;
// DGS 2026-10-07: option (3), "Detect the case and send it to the DGS"): the
// documents do not say how their §5.2 allowances combine, so every course
// drawing on the allowance waits for the DGS. Scenario phd-two-earlier-programs
// has the finding's student; these pin the edges.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { audit } from '../src/engine/audit.ts';
import { classify } from '../src/engine/allocate.ts';
import { coursesNeedingDgsReview } from '../src/engine/review.ts';
import type { CourseEntry, Student } from '../src/engine/types.ts';
import { buildRules } from './helpers.ts';
import { ndCourse, phdStudent } from './helpers/student.ts';

const fall = (year: number) => ({ season: 'fall' as const, year });
const ext = (university: string, course_id: string) => ({ university, course_id, course_title: 'X', transferable_PhD: 'yes', transferable_MSCSE: 'yes', is_cse: 'yes', credit_system: 'semester' });
const rules = buildRules({ external: [ext('NORTHEASTERN UNIVERSITY', 'CS 5004'), ext('NORTHEASTERN UNIVERSITY', 'CS 5008'), ext('UNIVERSITY OF SOUTHERN CALIFORNIA', 'CSCI 567')] });
const tr = (courseId: string, institution: string, year: number): CourseEntry => ({ courseId, credits: 3, term: fall(year), grade: 'A', origin: 'transfer', institution, degreeLevel: 'masters' });
const record = (courses: CourseEntry[]): Student =>
  phdStudent({ entryTerm: fall(2025), bachelorsAwarded: { season: 'spring', year: 2019 }, priorMs: 'completed', background: { bachelors: 'elsewhere', graduate: 'elsewhere', samePlace: false, finished: true }, courses: [...courses, ndCourse('CSE 60641', { term: fall(2025) })] });

describe('two earlier graduate programs (P3-prior-programs-3)', () => {
  it('one program: counted as before', () => {
    const { classified } = classify(record([tr('CS 5004', 'Northeastern University', 2020), tr('CS 5008', 'NORTHEASTERN UNIV.', 2021)]), rules, '2026-10-07');
    assert.equal(classified.some((c) => c.twoPrograms), false, 'one university, however it is spelled');
  });
  it('two programs: every course waits, and the review request asks once per course', () => {
    const s = record([tr('CS 5004', 'Northeastern University', 2020), tr('CSCI 567', 'University of Southern California', 2022)]);
    const { classified } = classify(s, rules, '2026-10-07');
    assert.deepEqual(classified.filter((c) => c.twoPrograms).map((c) => c.entry.courseId).sort(), ['CS 5004', 'CSCI 567']);
    assert.ok(classified.filter((c) => c.twoPrograms).every((c) => c.tier === 'provisional' && c.approvedNote === undefined));
    const asks = coursesNeedingDgsReview(s, rules, '2026-10-07').filter((p) => /decide how the transfer allowances of my earlier graduate programs combine/.test(JSON.stringify(p)));
    assert.equal(asks.length, 2);
    assert.equal(audit(s, rules, '2026-10-07').requirements.find((r) => r.id === 'phd.transfer')!.status, 'needs_dgs_review');
  });
  it('a refused course does not make a second program', () => {
    const { classified } = classify(record([tr('CS 5004', 'Northeastern University', 2020), { ...tr('CSCI 567', 'University of Southern California', 2010), term: fall(2010) }]), rules, '2026-10-07');
    assert.equal(classified.some((c) => c.twoPrograms), false, 'the USC course is outside the five-year window');
  });
});
