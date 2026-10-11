// Simulation mode: the course rules' word on a planned course (DGS 2026-10-11,
// item 19) — retired, last offered long ago, explicitly off next semester's
// schedule, or outside its usual season. Facts from the sheet, never a guess:
// a blank or `varies` cell says nothing.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CourseEntry } from '../src/engine/types.ts';
import { planNotes } from '../src/ui/plan-notes.ts';
import { buildRules } from './helpers.ts';

const FALL_2026 = { season: 'fall' as const, year: 2026 }; // the real semester
const planned = (courseId: string, season: 'fall' | 'spring' | 'summer', year: number): CourseEntry => ({ courseId, credits: 3, term: { season, year }, grade: 'IP', origin: 'nd' });

describe('notes on a planned course', () => {
  it('says nothing about a course the rules expect to run', () => {
    // CSE 60641: active, fall, last offered Fall 2026 — planned for Fall 2027.
    assert.deepEqual(planNotes(planned('CSE 60641', 'fall', 2027), buildRules(), FALL_2026), []);
  });

  it('says nothing about a course already taken or in the real current semester', () => {
    const rules = buildRules({ courses: [{ course_id: 'CSE 60641', set: { active: 'no' } }] });
    assert.deepEqual(planNotes(planned('CSE 60641', 'fall', 2026), rules, FALL_2026), []);
    assert.deepEqual(planNotes(planned('CSE 60641', 'spring', 2025), rules, FALL_2026), []);
    // …nor about another university's course, nor one not in the rules at all.
    assert.deepEqual(planNotes({ ...planned('CS 50300', 'fall', 2027), origin: 'transfer', institution: 'Purdue University' }, rules, FALL_2026), []);
    assert.deepEqual(planNotes(planned('MATH 99999', 'fall', 2027), rules, FALL_2026), []);
  });

  it('a retired course', () => {
    const rules = buildRules({ courses: [{ course_id: 'CSE 60641', set: { active: 'no' } }] });
    assert.deepEqual(planNotes(planned('CSE 60641', 'fall', 2027), rules, FALL_2026), ['retired in the course rules — ask the DGS whether it will run again']);
  });

  it('a course last offered more than two academic years ago — and not one taught every other year', () => {
    const old = buildRules({ courses: [{ course_id: 'CSE 60641', set: { last_offered: 'Fall 2023' } }] });
    assert.deepEqual(planNotes(planned('CSE 60641', 'fall', 2027), old, FALL_2026), ['last offered in Fall 2023 — check that it will run in Fall 2027']);
    const biennial = buildRules({ courses: [{ course_id: 'CSE 60641', set: { last_offered: 'Fall 2024' } }] });
    assert.deepEqual(planNotes(planned('CSE 60641', 'fall', 2027), biennial, FALL_2026), []);
  });

  it('explicitly off next semester’s schedule, read as the course-rules page reads it', () => {
    // CSE 60111: offered_next = no, last offered Spring 2026 — dated LAST
    // semester, so in Fall 2026 its schedule cells say nothing.
    assert.deepEqual(planNotes(planned('CSE 60111', 'spring', 2027), buildRules(), FALL_2026), []);
    const current = buildRules({ courses: [{ course_id: 'CSE 60111', set: { last_offered: 'Fall 2026', offered_now: 'yes', offered_next: 'no' } }] });
    assert.deepEqual(planNotes(planned('CSE 60111', 'spring', 2027), current, FALL_2026), ['not on the Spring 2027 schedule in the course rules']);
    // Only the next semester: a later spring is not what the column describes.
    assert.deepEqual(planNotes(planned('CSE 60111', 'spring', 2028), current, FALL_2026), []);
  });

  it('outside its usual season — fall, spring or both; varies and blank say nothing', () => {
    assert.deepEqual(planNotes(planned('CSE 60641', 'spring', 2027), buildRules(), FALL_2026), ['typically offered in fall; planned for Spring 2027']);
    const both = buildRules({ courses: [{ course_id: 'CSE 60641', set: { typically_offered: 'both' } }] });
    assert.deepEqual(planNotes(planned('CSE 60641', 'summer', 2027), both, FALL_2026), ['typically offered in fall and spring; planned for Summer 2027']);
    assert.deepEqual(planNotes(planned('CSE 60641', 'spring', 2027), both, FALL_2026), []);
    for (const typically_offered of ['varies', '']) {
      const r = buildRules({ courses: [{ course_id: 'CSE 60641', set: { typically_offered } }] });
      assert.deepEqual(planNotes(planned('CSE 60641', 'spring', 2027), r, FALL_2026), [], typically_offered || 'blank');
    }
  });
});
