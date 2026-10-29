// CSE §5.2 considers a transfer request only "before the semester in which the
// graduate degree is conferred" (policy review round 3, P3-import-4; DGS
// 2026-10-07: option (b), "Term-aware wording"). With a graduation semester on
// file, the lines name it; once it has begun with a counted transfer not yet
// recorded, the lines, the §5.2 card and a warning say the window has closed,
// and the processing request asks whether the request went in time. No count
// or status changes.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { audit } from '../src/engine/audit.ts';
import type { Student } from '../src/engine/types.ts';
import { actionItems, advisorSummary } from '../src/ui/advisor-summary.ts';
import { gradAdminRequest } from '../src/ui/grad-admin-request.ts';
import { buildRules } from './helpers.ts';
import { ndCourse, phdStudent, transferCourse } from './helpers/student.ts';

const rules = buildRules({ external: [{ university: 'UNIVERSITY OF MASSACHUSETTS AMHERST', course_id: 'COMPSCI 589', course_title: 'Machine Learning', transferable_PhD: 'yes', transferable_MSCSE: 'yes', is_cse: 'yes', credit_system: 'semester' }] });
/** An MSCSE student (Fall 2025) with a UMass M.S. course the DGS approved, planning to graduate in Fall 2026. */
const student = (over: Partial<Student> = {}): Student =>
  phdStudent({
    program: 'mscse',
    msOption: 'project',
    entryTerm: { season: 'fall', year: 2025 },
    bachelorsAwarded: { season: 'spring', year: 2023 },
    priorMs: 'completed',
    graduationTerm: { season: 'fall', year: 2026 },
    courses: [transferCourse('COMPSCI 589', 'Machine Learning', { term: { season: 'fall', year: 2024 }, institution: 'University of Massachusetts Amherst', degreeLevel: 'masters' }), ndCourse('CSE 60641', { term: { season: 'fall', year: 2025 } })],
    ...over,
  });
const lineOf = (s: Student, today: string) => audit(s, rules, today).courseLines.find((l) => l.courseId === 'COMPSCI 589')!.text;

describe('the §5.2 request window, by the semester you graduate in (P3-import-4 (b))', () => {
  it('before that semester: the line names it', () => {
    assert.match(lineOf(student(), '2026-03-01'), /send the Grad Admin the processing request to have it recorded — before Fall 2026, the semester you plan to graduate in \(§5\.2\)/);
    assert.equal(audit(student(), rules, '2026-03-01').transferRequestWindowClosed, undefined);
  });
  it('once it has begun: the line, the card and a warning say so; the count stands', () => {
    const r = audit(student(), rules, '2026-10-05');
    assert.match(lineOf(student(), '2026-10-05'), /you plan to graduate in Fall 2026, and §5\.2 considers a transfer request only before that semester — if yours was not sent before then, ask the ADGS/);
    assert.ok(r.warnings.includes('You plan to graduate in Fall 2026; §5.2 considers a transfer request only before that semester — if yours was not sent before then, ask the ADGS.'), JSON.stringify(r.warnings)); // the MSCSE's decider
    assert.deepEqual(r.transferRequestWindowClosed, { season: 'fall', year: 2026 });
    assert.match(lineOf(student(), '2026-10-05'), /^counts toward regular courses/, 'still counted');
    const { text } = gradAdminRequest(r, student(), rules, { todayIso: '2026-10-05', entryTerm: 'Fall 2025', priorStudy: 'Completed prior M.S. or Ph.D.', gpa: 3.6 });
    assert.match(text, /\d\. Check whether the Transfer of Credits request was sent before Fall 2026, the semester I plan to graduate in, for COMPSCI 589 Machine Learning/);
  });
  it('recorded, as ticked: nothing to say', () => {
    const s = student({ attestations: { transferRecorded: true } });
    assert.equal(audit(s, rules, '2026-10-05').transferRequestWindowClosed, undefined);
  });
  it('no graduation semester on file: the rule as before', () => {
    assert.match(lineOf(student({ graduationTerm: undefined }), '2026-10-05'), /— before the semester your degree is conferred \(§5\.2\)/);
  });
});

// The advisor email and the processing request's heading and card line follow
// the window too (policy review round 4, P4-transfer-1; DGS 2026-10-12): once
// the semester has begun nothing asks to "submit" — they ask whether it was
// sent in time — and before it the email names the semester.
describe('the advisor email and the request heading, by the same window (P4-transfer-1)', () => {
  const transfers = { courses: ['COMPSCI 589'], recorded: false, firstSemesterDone: true };
  it('before that semester: the email names it', () => {
    const todo = actionItems(audit(student(), rules, '2026-03-01'), transfers);
    assert.ok(todo.student.includes('Send the Grad Admin the processing request for COMPSCI 589 (§5.2) — before Fall 2026, the semester I plan to graduate in.'), JSON.stringify(todo.student));
    assert.ok(todo.gradAdmin.includes('Submit the Transfer of Credits request to the Graduate School for COMPSCI 589 — recommended by the DGS (§5.2).'), JSON.stringify(todo.gradAdmin));
  });
  it('once it has begun: the email asks whether it was sent in time, and nothing says “submit”', () => {
    const r = audit(student(), rules, '2026-10-05');
    const todo = actionItems(r, transfers);
    assert.ok(todo.student.includes('§5.2 considered a transfer request for COMPSCI 589 only before Fall 2026, the semester I plan to graduate in — if mine was not sent before then, I will ask the DGS.'), JSON.stringify(todo.student));
    assert.ok(todo.gradAdmin.includes('Check whether the Transfer of Credits request for COMPSCI 589 was sent before Fall 2026, the semester I plan to graduate in (§5.2).'), JSON.stringify(todo.gradAdmin));
    assert.ok(!todo.gradAdmin.some((t) => /^Submit the Transfer of Credits request/.test(t)));
    // The MSCSE's decider in the email itself (decisionWording).
    const email = advisorSummary(r, { todayIso: '2026-10-05', entryTerm: 'Fall 2025', priorStudy: 'Completed prior M.S. or Ph.D.', transfers }).text;
    assert.match(email, /if mine was not sent before then, I will ask the ADGS\./);
    const { text, items } = gradAdminRequest(r, student(), rules, { todayIso: '2026-10-05', entryTerm: 'Fall 2025', priorStudy: 'Completed prior M.S. or Ph.D.', gpa: 3.6 });
    // The text flavour upper-cases section headings.
    assert.doesNotMatch(text, /Transfer credit to submit to the Graduate School/i);
    // No handbook sections in the request (DGS 2026-10-28).
    assert.match(text, /\nTransfer credit — was the request sent to the Graduate School before Fall 2026, the semester I plan to graduate in\? — recommended by the (A)?DGS in the course rules\n/i);
    // …and the action says how many credits (DGS 2026-10-28).
    assert.match(text, /\n1\. Check whether the Transfer of Credits request was sent before Fall 2026, the semester I plan to graduate in, for COMPSCI 589 Machine Learning \(University of Massachusetts Amherst, Fall 2024\) — transfer 3 credits; recommended by the (A)?DGS in the course rules\.\n/);
    // The card's line keeps its section.
    assert.ok(items.lines.some((l) => /^COMPSCI 589 \(University of Massachusetts Amherst\) — transfer 3 credits, recommended by the (A)?DGS in the course rules — was the request sent before Fall 2026, the semester I plan to graduate in\? \(§5\.2\)$/.test(l)), JSON.stringify(items.lines));
  });
});
