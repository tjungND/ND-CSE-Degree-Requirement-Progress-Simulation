// The Grad Admin request is active only for MAJOR events (DGS 2026-10-15:
// "Can you determine major events so that only when those happen, students
// need to submit…" — superseding 2026-09-06, when any met requirement made it
// active): transfer credit to submit, the qualifier completion form, the
// MSCSE along the way and the two candidacy applications. A milestone date,
// the standing and transfer credit already recorded go along with a request,
// never start one — and no date is lost from the request.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { audit } from '../src/engine/audit.ts';
import type { Milestones, Student } from '../src/engine/types.ts';
import { MILESTONE_FIELDS, gradAdminRequest } from '../src/ui/grad-admin-request.ts';
import { nextSteps } from '../src/ui/next-steps.ts';
import { buildRules } from './helpers.ts';
import { ndCourse, phdStudent } from './helpers/student.ts';

const rules = buildRules();
const today = '2027-03-01';
const opts = { todayIso: today, entryTerm: 'Fall 2026', priorStudy: 'None', gpa: 3.6 };
const courses = ['CSE 60641', 'CSE 60111'].map((id) => ndCourse(id, { term: { season: 'fall', year: 2026 } }));
const build = (s: Student) => gradAdminRequest(audit(s, rules, today), s, rules, opts);

describe('the Grad Admin request, major events only (DGS 2026-10-15)', () => {
  it('“Advisor identified” alone — the DGS’s example — does not make it active', () => {
    const s = phdStudent({ entryTerm: { season: 'fall', year: 2026 }, gpa: 3.6, courses, milestones: { advisorIdentified: '2026-10-01', advisorName: 'Prof. Example', advisorTtt: 'yes' } });
    const { items, text } = build(s);
    assert.equal(items.count, 0);
    assert.deepEqual(items.lines, []);
    assert.deepEqual(items.actions, []);
    assert.match(items.forTheRecord!, /^Also in the request, for the record: 1 milestone date and your standing — /);
    // Sent along with a later request, the date is there, for the record.
    assert.match(text, /\nMILESTONE DATES, FOR THE RECORD\n- Advisor identified: 2026-10-01, as I entered it \(§2\.3\)\n/);
    assert.doesNotMatch(text, /Record the milestone|Keep my standing/);
    const steps = nextSteps({ report: audit(s, rules, today), student: s, review: { unlisted: 0, caseByCase: 0 }, processingCount: items.count });
    assert.ok(!steps.some((st) => /^Send the processing request/.test(st.text)), 'no “send the processing request” step');
  });

  it('every milestone date, of either program, is minor — and every one is listed in the request', () => {
    for (const program of ['phd', 'mscse'] as const) {
      const dated: Milestones = {};
      MILESTONE_FIELDS.filter((f) => f.program === 'both' || f.program === program).forEach((f, i) => {
        (dated as Record<string, string>)[f.key] = `2027-01-${String(10 + i).padStart(2, '0')}`;
      });
      const s = phdStudent({ program, ...(program === 'mscse' ? { msOption: 'thesis' as const } : {}), entryTerm: { season: 'fall', year: 2026 }, gpa: 3.6, courses, milestones: { ...dated, advisorName: 'Prof. Example', advisorTtt: 'yes' } });
      const { items, text } = build(s);
      assert.equal(items.count, 0, program);
      assert.deepEqual(items.actions, [], program);
      for (const m of items.milestones) assert.ok(text.includes(`: ${m.date}, as I entered it (${m.section})`), `${program}: ${m.label}`);
      assert.equal(items.milestones.length, Object.keys(dated).length, program);
    }
  });
});
