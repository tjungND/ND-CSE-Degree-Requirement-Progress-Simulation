// The deadline alert (DGS 2026-09-28): "When a deadline is approaching soon,
// 1 semester before, students need to see the alert." "Due soon" is one
// semester's notice — the deadline falls in this semester or the next — not
// the 120-day count it was. src/engine/term.ts deadlineHorizon, status.ts
// openDeadline, and the pill / Grad Admin wording that carries it.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { audit } from '../src/engine/audit.ts';
import { openDeadline } from '../src/engine/status.ts';
import { deadlineHorizon } from '../src/engine/term.ts';
import type { RequirementResult } from '../src/engine/types.ts';
import { gradAdminRequest } from '../src/ui/grad-admin-request.ts';
import { dueWording, isDueSoon, pillLabel } from '../src/ui/report.ts';
import { buildRules } from './helpers.ts';
import { phdStudent } from './helpers/student.ts';

const rules = buildRules();

describe('deadlineHorizon', () => {
  it('this semester, next semester, or nothing — counted on fall/spring slots', () => {
    assert.equal(deadlineHorizon('2027-05-15', '2026-09-28'), 'next', 'Fall 2026 → end of Spring 2027');
    assert.equal(deadlineHorizon('2027-05-15', '2027-02-01'), 'this', 'Spring 2027 → end of Spring 2027');
    assert.equal(deadlineHorizon('2027-05-15', '2026-02-01'), undefined, 'Spring 2026 → Spring 2027 is two semesters off');
    assert.equal(deadlineHorizon('2026-08-15', '2026-05-01'), 'next', 'Spring 2026 → the start of Fall 2026');
    assert.equal(deadlineHorizon('2026-08-15', '2026-07-01'), 'next', 'summer belongs to the spring before it, so the fall is still "next"');
    assert.equal(deadlineHorizon('2026-12-31', '2026-07-01'), 'next', 'summer → the end of the coming fall');
    assert.equal(deadlineHorizon('2027-12-31', '2026-09-28'), undefined, 'Fall 2026 → end of Fall 2027');
  });

  it('a deadline many days off but in the next semester is due soon; the 120-day count is gone', () => {
    // 2026-09-01 → 2027-05-15 is 256 days: "upcoming" under the old rule.
    const d = openDeadline('2027-05-15', '2026-09-01', 'Due by the end of Spring 2027 (approximate)');
    assert.equal(d.state, 'due_soon');
    assert.equal(d.horizon, 'next');
    assert.equal(d.label, 'Due by the end of Spring 2027 (approximate)');
    const far = openDeadline('2027-12-31', '2026-09-01', 'Due by the end of Fall 2027');
    assert.equal(far.state, 'upcoming');
    assert.equal(far.horizon, undefined);
  });
});

describe('the alert on the page and in the Grad Admin request', () => {
  const entered = (today: string) => audit(phdStudent({ entryTerm: { season: 'fall', year: 2025 }, milestones: { advisorIdentified: '2025-09-01', advisorName: 'Prof. Example' } }), rules, today);
  const qualifier = (today: string): RequirementResult => entered(today).requirements.find((r) => r.id === 'phd.qualifier')!;

  it('the qualifier’s four semesters: next semester in the third, this semester in the fourth, nothing in the second', () => {
    const third = qualifier('2026-09-28');
    assert.equal(third.deadline?.state, 'due_soon');
    assert.equal(third.deadline?.horizon, 'next');
    assert.equal(pillLabel(third), 'In progress · due next semester');
    assert.equal(dueWording(third), 'due next semester');
    const fourth = qualifier('2027-02-01');
    assert.equal(fourth.deadline?.horizon, 'this');
    assert.equal(pillLabel(fourth), 'In progress · due this semester');
    const second = qualifier('2026-02-01');
    assert.equal(second.deadline?.state, 'upcoming');
    assert.equal(pillLabel(second), 'In progress');
    assert.equal(isDueSoon(second), false);
  });

  it('every component of the qualifier is under the umbrella’s deadline (DGS 2026-09-29: a core area read "In progress" beside an overdue umbrella)', () => {
    const rows = (today: string) => entered(today).requirements;
    // Fall 2025 entry, no courses: after the end of Spring 2027 the umbrella AND each open core row and the specialization row read Overdue.
    const late = rows('2027-08-20');
    for (const id of ['phd.qualifier', 'phd.qualifier.core.os', 'phd.qualifier.core.algorithms', 'phd.qualifier.core.architecture', 'phd.qualifier.categories']) {
      const r = late.find((x) => x.id === id)!;
      assert.equal(r.status, 'unmet', id);
      assert.equal(r.deadline?.state, 'overdue', id);
      assert.equal(pillLabel(r), 'Overdue', id);
      assert.equal(r.deadline?.label, 'Overdue — was due by the end of Spring 2027 (approximate)', id);
    }
    // Before the deadline the components carry the same open chip — and the same alert.
    const third = rows('2026-09-28').find((x) => x.id === 'phd.qualifier.core.os')!;
    assert.equal(third.deadline?.state, 'due_soon');
    assert.equal(pillLabel(third), 'In progress · due next semester');
    // The research component keeps its own, earlier, §4.4.3 deadline.
    const research = rows('2026-09-28').find((x) => x.id === 'phd.qualifier.research')!;
    assert.match(research.deadline?.label ?? '', /18 months after entry/);
    // A met component has no chip; the DGS's one-semester extension moves the components' deadline with the umbrella's.
    const withOs = audit(phdStudent({ entryTerm: { season: 'fall', year: 2025 }, attestations: { qualifierExtensionGranted: true }, courses: [{ courseId: 'CSE 60641', credits: 3, term: { season: 'fall', year: 2025 }, grade: 'A', origin: 'nd' }] }), rules, '2027-08-20').requirements;
    assert.equal(withOs.find((x) => x.id === 'phd.qualifier.core.os')!.status, 'met');
    assert.equal(withOs.find((x) => x.id === 'phd.qualifier.core.os')!.deadline, undefined);
    const arch = withOs.find((x) => x.id === 'phd.qualifier.core.architecture')!;
    assert.notEqual(arch.status, 'met', 'still open');
    assert.equal(arch.deadline?.state, 'due_soon', 'the extension runs to the end of Fall 2027 — this semester');
    assert.equal(pillLabel(arch), 'In progress · due this semester');
  });

  it('a passed deadline reads Overdue, never "due this semester"', () => {
    const late = qualifier('2027-08-20');
    assert.equal(late.deadline?.state, 'overdue');
    assert.equal(pillLabel(late), 'Overdue');
    assert.equal(isDueSoon(late), false);
  });

  it('the Grad Admin request highlights the deadline in plain text and in HTML, and counts it', () => {
    const today = '2026-09-28';
    const s = phdStudent({ entryTerm: { season: 'fall', year: 2025 }, milestones: { advisorIdentified: '2025-09-01', advisorName: 'Prof. Example' } });
    const built = gradAdminRequest(audit(s, rules, today), s, rules, { todayIso: today, entryTerm: 'Fall 2025', priorStudy: 'No prior graduate study', gpa: s.gpa });
    assert.equal(built.items.tally.dueSoon, 1, 'the qualifier umbrella; its parts are unscored');
    assert.match(built.text, /\n- 1 deadline in this semester or the next — highlighted below\.\n/);
    // The heading is the title alone — no handbook sections (DGS 2026-10-28).
    assert.match(built.text, /\n\[IN PROGRESS\] Qualifying examination — all components\n    !! DEADLINE NEXT SEMESTER: Due by the end of Spring 2027 \(approximate\)\n/);
    assert.match(built.html, /<p style="[^"]*background:#ffe3c9;color:#8a3a00;border-left:4px solid #e0863a"><strong>Deadline next semester:<\/strong> Due by the end of Spring 2027 \(approximate\)<\/p>/);
    // A row whose deadline is further off states it without the highlight.
    // The OCE is shown inside the admission card since 2026-10-04 (DGS: "Can
    // they be merged into one card?"), so the admission line carries the date;
    // Not started until the qualifier is due to be complete (DGS 2026-10-04).
    assert.match(built.text, /\n\[NOT STARTED\] Admitted to doctoral candidacy\n    Deadline: Due by the end of Spring 2029 — semester 8 \(approximate\)\n/);
    assert.doesNotMatch(built.text, /!! DEADLINE [A-Z]+ SEMESTER: Due by the end of Spring 2029/);
  });
});
