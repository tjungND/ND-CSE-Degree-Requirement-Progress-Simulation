// Simulation mode: a planned course the course rules say may not run (DGS
// 2026-10-11, item 19). A plan that counts a course the department no longer
// offers, or puts a fall-only course in a spring, reads as complete and is
// not. The rules sheet already holds three facts about that, and the page
// says what they say — never a guess:
//   `active` = no         the course is retired (README § A4);
//   `last_offered`        the last term it actually ran, when that is more
//                         than two academic years before this semester;
//   `offered_next` = no   explicitly not on next semester's schedule, read
//                         exactly as the course-rules page reads it (only
//                         while the row's `last_offered` is this semester);
//   `typically_offered`   fall / spring / both — a pattern from past years,
//                         said as a hint when the planned season is not in it
//                         (`varies` and a blank cell say nothing).
// Only a Notre Dame course, in a semester that has not started in REAL time
// (the plan's future, whatever semester the simulation pretends it is), and
// only in simulation mode (app.ts). Nothing here changes a requirement.
import { resolveRuleRow } from '../data/assemble.ts';
import type { Rules } from '../data/types.ts';
import { compareTerm, semesterSeq, termLabel } from '../engine/term.ts';
import type { CourseEntry, Term } from '../engine/types.ts';
import { rowSchedule, scheduleTerms, teachingTermOf } from './schedule-terms.ts';

/** More than this many fall/spring semesters since a course last ran, and the
 * note names its last offering: two academic years, so a course taught every
 * other year is never flagged. A display threshold, not a policy number. */
export const LAST_OFFERED_RECENT_SEMESTERS = 4;

export function planNotes(c: CourseEntry, rules: Rules, realTerm: Term): string[] {
  if (c.origin !== 'nd' || compareTerm(c.term, realTerm) <= 0) return [];
  const row = resolveRuleRow(rules, c.courseId, c.term);
  // Not in the course rules at all: the review request already asks about it.
  if (!row) return [];
  const notes: string[] = [];
  if (!row.active) notes.push('retired in the course rules — ask the DGS whether it will run again');
  else if (row.lastOffered && semesterSeq(teachingTermOf(realTerm)) - semesterSeq(teachingTermOf(row.lastOffered)) > LAST_OFFERED_RECENT_SEMESTERS) {
    notes.push(`last offered in ${termLabel(row.lastOffered)} — check that it will run in ${termLabel(c.term)}`);
  }
  const { nextTerm } = scheduleTerms(realTerm);
  if (rowSchedule(realTerm, row).next === false && compareTerm(c.term, nextTerm) === 0) notes.push(`not on the ${termLabel(nextTerm)} schedule in the course rules`);
  const typical = row.typicallyOffered;
  const seasons = typical === 'fall' ? ['fall'] : typical === 'spring' ? ['spring'] : typical === 'both' ? ['fall', 'spring'] : undefined;
  if (seasons && !seasons.includes(c.term.season)) notes.push(`typically offered in ${typical === 'both' ? 'fall and spring' : typical}; planned for ${termLabel(c.term)}`);
  return notes;
}
