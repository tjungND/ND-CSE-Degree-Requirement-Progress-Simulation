// Policy review round 5 (code and blue-team review, 2026-10-14; DGS: "Apply
// 1-28, 33-36, 29 b, 30 b, 31 a, 32 yes"): one block per item, each failing
// without its fix.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { audit } from '../src/engine/audit.ts';
import type { Student } from '../src/engine/types.ts';
import { buildRules, loadScenario } from './helpers.ts';
import { ndCourse, phdStudent, transferCourse } from './helpers/student.ts';

const rules = buildRules();
const fall = (year: number) => ({ season: 'fall' as const, year });
const spring = (year: number) => ({ season: 'spring' as const, year });

// 1. The examinations tick releases a qualifier passed under the earlier
// rules, and the page offers it only for an examination (report field).
describe('1: the examinations tick and the prior-rules qualifier', () => {
  const returning = (tick: boolean, milestones: Student['milestones'] = { advisorIdentified: '2015-10-01', advisorName: 'Prof. Example', advisorTtt: 'yes' }): Student =>
    phdStudent({
      entryTerm: fall(2015),
      gpa: 3.7,
      readmittedTerm: fall(2024),
      bachelorsAwarded: spring(2015),
      // A Notre Dame course before the gap dates the interruption.
      courses: [ndCourse('CSE 60111', { term: fall(2015) }), ndCourse('CSE 60641', { term: fall(2024) })],
      milestones,
      attestations: { qualifierPassedUnderPriorRules: true, ...(tick ? { examsBeforeInterruptionStand: true } : {}) },
    });
  it('without the tick the qualifier waits and the request asks; with it, it stands', () => {
    const held = audit(returning(false), rules, '2024-10-15');
    assert.equal(held.requirements.find((r) => r.id === 'phd.qualifier')!.status, 'needs_dgs_review');
    assert.ok((held.reviewFlags ?? []).some((f) => /the qualifying examination I passed under the earlier requirements/.test(f)));
    const ruled = audit(returning(true), rules, '2024-10-15');
    const q = ruled.requirements.find((r) => r.id === 'phd.qualifier')!;
    assert.equal(q.status, 'met', q.detail);
    assert.equal(q.forfeitReview, undefined);
    assert.match(q.detail, /ruled that your examinations from before your readmission in Fall 2024 stand, as you ticked under Approvals/);
    assert.ok(!(ruled.reviewFlags ?? []).some((f) => /qualifying examination I passed under the earlier requirements/.test(f)));
  });
  it('the page offers the tick for an examination, not for the advisor’s date alone', () => {
    // The prior-rules qualifier is an examination.
    assert.deepEqual(audit(returning(false), rules, '2024-10-15').examsBeforeInterruption, ['the qualifying examination I passed under the earlier requirements']);
    // Only the advisor's date before the gap: nothing to release.
    const advisorOnly = { ...returning(false), attestations: {} };
    assert.equal(audit(advisorOnly, rules, '2024-10-15').examsBeforeInterruption, undefined);
    // Still listed once ticked, so the box stays on the page.
    assert.equal(audit(returning(true), rules, '2024-10-15').examsBeforeInterruption?.length, 1);
  });
  // Verification, docs-tests-5: the page's own decision.
  it('the page’s rule: examsTickOffered', async () => {
    const { examsTickOffered } = await import('../src/ui/page-decisions.ts');
    assert.equal(examsTickOffered(audit(returning(false), rules, '2024-10-15'), returning(false)), true);
    const advisorOnly = { ...returning(false), attestations: {} };
    assert.equal(examsTickOffered(audit(advisorOnly, rules, '2024-10-15'), advisorOnly), false);
    assert.equal(examsTickOffered(audit(returning(true), rules, '2024-10-15'), returning(true)), true);
  });
});

// 3 and 12: the §5.2 paragraph above another university's courses.
describe('3, 12: the §5.2 paragraph', async () => {
  const { transferRuleText } = await import('../src/ui/coursework-text.ts');
  const umass = buildRules({ external: [{ university: 'UNIVERSITY OF MASSACHUSETTS AMHERST', course_id: 'COMPSCI 589', course_title: 'Machine Learning', transferable_PhD: 'yes', transferable_MSCSE: 'yes', is_cse: 'yes', credit_system: 'semester' }] });
  const ms = (over: Partial<Student> = {}): Student =>
    phdStudent({ program: 'mscse', msOption: 'project', entryTerm: fall(2025), bachelorsAwarded: spring(2023), priorMs: 'completed', courses: [transferCourse('COMPSCI 589', 'Machine Learning', { term: fall(2024), institution: 'University of Massachusetts Amherst', degreeLevel: 'masters' })], ...over });
  it('3: before the graduation semester it names it; once it has begun, the window is closed — never “now”', () => {
    const g = { graduationTerm: fall(2026) };
    assert.match(transferRuleText(ms(g), umass, '2026-03-01', false), /goes to the Grad Admin now, before Fall 2026, the semester you plan to graduate in\.$/);
    const closed = transferRuleText(ms(g), umass, '2026-10-05', false);
    assert.match(closed, /you plan to graduate in Fall 2026, and §5\.2 considers a transfer request only before that semester — if yours was not sent before then, ask the DGS\.$/);
    assert.doesNotMatch(closed, /goes to the Grad Admin now/);
    assert.match(transferRuleText(ms({ ...g, attestations: { transferRecorded: true } }), umass, '2026-10-05', false), /the Grad Admin recorded your transfer credit, as you ticked under Approvals \(§5\.2\)\.$/);
    assert.match(transferRuleText(ms(), umass, '2026-03-01', false), /before the semester your degree is conferred\.$/);
  });
  it('12: the Notre Dame MSCSE held but undated — no fixed cutoff', () => {
    const s = phdStudent({ entryTerm: fall(2026), priorMs: 'completed', ndMasters: { term: spring(2024) }, background: { bachelors: 'elsewhere', graduate: 'nd-mscse', alsoElsewhere: true, finished: true } });
    const t = transferRuleText(s, umass, '2026-10-05', false);
    assert.match(t, /within 5 years before your admission to the Notre Dame MSCSE — this record does not date it, so a course from before Fall 2021 goes to the DGS/);
    assert.doesNotMatch(t, /\(Fall 2021 or later\)/);
  });
});

// 4: posted non-CSE credit past the nine (spilled into the total) is not
// counted twice against the §5.2 meter — it read "-3 of the 6".
describe('4: the §5.2 meter never goes below zero', () => {
  it('four posted non-CSE courses on a record with no earlier program', () => {
    const sc = loadScenario('phd-posted-credit-no-earlier-program');
    const s = structuredClone(sc.student);
    const posted = (id: string) => ({
      courseId: id, title: `Numerical Analysis ${id}`, credits: 3, term: spring(2025), grade: 'IP' as const, origin: 'transfer' as const,
      institution: 'Purdue University', registeredLevel: 'graduate' as const, fromNdTranscript: true as const,
      ndPosted: { term: spring(2025), credits: 3, level: 'graduate' as const, institution: 'Purdue University' },
    });
    s.courses = [...s.courses.filter((c) => c.origin === 'nd'), posted('MATH 51400'), posted('MATH 52300'), posted('MATH 54400'), posted('MATH 56200')];
    const row = audit(s, buildRules(sc.rules.patch), sc.today).requirements.find((r) => r.id === 'phd.transfer')!;
    assert.doesNotMatch(row.detail, /(^|\s)-\d/, row.detail);
    assert.match(row.detail, /^0 of the 6 credits you may transfer are counted, besides 9 on your Notre Dame record, counted in full/);
  });
});

// 5: the readmission warning says only what still waits.
describe('5: the readmission warning after the DGS’s ticks', () => {
  it('every earlier course ticked (five years or more): the §5.5 text, and that the DGS ruled', () => {
    const sc = loadScenario('phd-readmitted-courses-ticked');
    const w = audit(sc.student, buildRules(sc.rules.patch), sc.today).warnings.find((x) => x.startsWith('Readmitted'))!;
    assert.match(w, /after an interruption of five years or more: the Academic Code forfeits credit for every course and examination from before it \(Academic Code §5\.5\) unless the DGS and the Graduate School rule otherwise — they ruled on what you entered from before it, as you ticked;/);
    assert.doesNotMatch(w, /wait for the DGS|DGS Handbook §3\.3/);
  });
  it('the same record unticked: the courses wait', () => {
    const sc = loadScenario('phd-readmitted-courses-ticked');
    const s = structuredClone(sc.student);
    s.courses = s.courses.map((c) => ({ ...c, dgsApproved: undefined, dgsHoldApproved: undefined }));
    const w = audit(s, buildRules(sc.rules.patch), sc.today).warnings.find((x) => x.startsWith('Readmitted'))!;
    assert.match(w, /, so those courses wait for the DGS and are in the review request;/);
  });
});

// 29 (b): the hold's ruling is its own field. A course the DGS approved case
// by case, which a later readmission holds, waits until the hold is ruled on.
describe('29 (b): a case-by-case tick does not release a later hold', () => {
  const s = (entry: Partial<Student['courses'][number]>): Student =>
    phdStudent({
      entryTerm: fall(2022),
      gpa: 3.6,
      readmittedTerm: fall(2025),
      courses: [ndCourse('CSE 40567', { term: spring(2023), ...entry }), ndCourse('CSE 60641', { term: fall(2025) })],
      milestones: { advisorIdentified: '2022-10-01', advisorName: 'Prof. Example', advisorTtt: 'yes' },
    });
  it('the old case-by-case tick: still held, and the box reads unticked', () => {
    const line = audit(s({ dgsApproved: true }), rules, '2025-10-15').courseLines.find((l) => l.courseId === 'CSE 40567')!;
    assert.equal(line.mark, 'pending', line.text);
    assert.match(line.text, /taken before your readmission \(Fall 2025\)/);
    assert.doesNotMatch(line.text, /the DGS confirmed it still counts/);
    assert.equal(line.holdRuling, true);
    assert.equal(line.approved, undefined);
  });
  it('the box ticked on the held course (both fields): released', () => {
    const line = audit(s({ dgsApproved: true, dgsHoldApproved: true }), rules, '2025-10-15').courseLines.find((l) => l.courseId === 'CSE 40567')!;
    assert.notEqual(line.mark, 'pending', line.text);
    assert.match(line.text, /the DGS confirmed it still counts, as you ticked on the course/);
    assert.equal(line.approved, true);
  });
});

// 6: a ticked non-degree course still in progress is not completed credit.
describe('6: a ticked course in progress stays in progress', () => {
  it('non-degree, ticked, grade IP, seen during its semester', () => {
    const sc = loadScenario('phd-nd-non-degree-ticked');
    const s = structuredClone(sc.student);
    s.courses = s.courses.filter((c) => c.courseId === 'CSE 60641').map((c) => ({ ...c, grade: 'IP' as const }));
    const r = audit(s, buildRules(sc.rules.patch), '2026-04-01');
    assert.match(r.requirements.find((x) => x.id === 'phd.credits.regular')!.detail, /^0 of 24 credits complete\. 3 in progress/);
    assert.equal(r.courseLines.find((l) => l.courseId === 'CSE 60641')!.mark, 'in_progress');
  });
});

// 7: §5.7's two semesters count both kinds of leave.
describe('7: §5.7 counts the approved leave for another reason too', () => {
  const s = (leaveSemesters: number, otherLeaveSemesters: number): Student =>
    phdStudent({ entryTerm: fall(2022), gpa: 3.6, leaveSemesters, otherLeaveSemesters, courses: [ndCourse('CSE 60641', { term: fall(2022) })] });
  for (const [med, other, word] of [[0, 3, 'of leave'], [1, 2, 'of leave'], [3, 0, 'on medical leave']] as const) {
    it(`${med} medical + ${other} other`, () => {
      const w = audit(s(med, other), rules, '2026-10-05').warnings;
      assert.ok(w.some((x) => x.startsWith(`3 semesters ${word}: a leave of absence lasts at most two consecutive semesters (§5.7)`)), JSON.stringify(w));
    });
  }
  it('two in all: no §5.7 warning', () => {
    assert.ok(!audit(s(1, 1), rules, '2026-10-05').warnings.some((x) => /§5\.7/.test(x)));
  });
});

// 8, 9, 10: credit on the Notre Dame record.
describe('8, 9, 10: posted credit', () => {
  const posted = (id: string, title: string, term: { season: 'fall' | 'spring'; year: number }, extra: Record<string, unknown> = {}) => ({
    courseId: id, title, credits: 3, term, grade: 'IP' as const, origin: 'transfer' as const,
    institution: 'Purdue University', fromNdTranscript: true as const,
    ndPosted: { term, credits: 3, level: 'graduate' as const, institution: 'Purdue University' }, ...extra,
  });
  it('8: posted credit outside the working limit is on the §5.2 card’s list', () => {
    const sc = loadScenario('phd-posted-credit-no-earlier-program');
    const r = audit(sc.student, buildRules(sc.rules.patch), sc.today);
    const posted5 = sc.student.courses.filter((c) => c.ndPosted !== undefined).map((c) => c.courseId);
    assert.ok(posted5.length > 0);
    for (const id of posted5) assert.ok(r.requirements.find((x) => x.id === 'phd.transfer')!.satisfiedBy?.includes(id), id);
  });
  it('9: a ticked held posted course says it once', () => {
    const s = phdStudent({ entryTerm: fall(2024), priorMs: 'none', courses: [posted('CS 52600', 'Compilers', spring(2024), { dgsApproved: true })] });
    const line = audit(s, rules, '2025-03-01').courseLines.find((l) => l.courseId === 'CS 52600')!;
    assert.match(line.text, /the DGS confirmed it counts toward this degree, as you ticked on the course/);
    assert.doesNotMatch(line.text, /the course rules say case by case/);
  });
  it('10: a held posted thesis says why it counts toward the total only', () => {
    const thesis = { ...posted('CS 69800', 'MS Thesis Research', spring(2025)), ndPosted: { term: spring(2025), credits: 3, institution: 'Purdue University' } };
    const s = phdStudent({ entryTerm: fall(2024), priorMs: 'none', courses: [thesis] });
    const line = audit(s, rules, '2025-09-01').courseLines.find((l) => l.courseId === 'CS 69800')!;
    assert.equal(line.mark, 'pending');
    assert.match(line.text, /not a regular course — its title reads as research, independent study or a seminar/);
  });
  // Verification, transfer-2: the review request says the reason once — in
  // the staff check — not again as the course's reason.
  it('10: the review request names a held posted thesis’s reason once', async () => {
    const { coursesNeedingDgsReview } = await import('../src/engine/review.ts');
    const thesis = { ...posted('CS 69800', 'MS Thesis Research', spring(2025)), ndPosted: { term: spring(2025), credits: 3, institution: 'Purdue University' } };
    const s = phdStudent({ entryTerm: fall(2024), priorMs: 'none', courses: [thesis] });
    const report = audit(s, rules, '2025-09-01');
    const reasons = coursesNeedingDgsReview(s, rules, '2025-09-01').filter((p) => p.course.entry.courseId === 'CS 69800').map((p) => p.reason);
    assert.equal(reasons.length, 1);
    const said = [...reasons, ...(report.reviewFlags ?? []), ...(report.staffChecks ?? [])].join('\n').match(/reads as research, independent study or a seminar/g) ?? [];
    assert.equal(said.length, 1, [...reasons, ...(report.staffChecks ?? [])].join('\n'));
  });
});

// 11: the request's course table prints what the §5.2 cap counts.
describe('11: a course the §5.2 cap counts in part', () => {
  it('two 4-credit Purdue courses against an unfinished master’s six', async () => {
    const { gradAdminRequest } = await import('../src/ui/grad-admin-request.ts');
    const r = buildRules({
      external: ['CS 50300', 'CS 58000'].map((id) => ({ university: 'PURDUE UNIVERSITY', course_id: id, course_title: id, transferable_PhD: 'yes', transferable_MSCSE: 'yes', is_cse: 'yes', credit_system: 'semester' })),
    });
    const s = phdStudent({
      entryTerm: fall(2024), priorMs: 'unfinished', gpa: 3.6, bachelorsAwarded: spring(2021),
      background: { bachelors: 'elsewhere', graduate: 'elsewhere', finished: false },
      courses: [
        transferCourse('CS 50300', 'OS', { credits: 4, term: fall(2022), degreeLevel: 'masters', institution: 'Purdue University' }),
        transferCourse('CS 58000', 'Algorithms', { credits: 4, term: spring(2023), degreeLevel: 'masters', institution: 'Purdue University' }),
        ndCourse('CSE 60641', { term: fall(2024) }),
      ],
    });
    const report = audit(s, r, '2025-03-01');
    const rows = gradAdminRequest(report, s, r, { todayIso: '2025-03-01', entryTerm: 'Fall 2024', priorStudy: 'x' }).items.courses;
    assert.equal(rows.find((c) => c.courseId === 'CS 50300')?.credits, '4');
    assert.equal(rows.find((c) => c.courseId === 'CS 58000')?.credits, '2 of 4 (the rest over the 6-credit transfer cap)');
    // The action says the part and why (DGS 2026-10-28).
    const actions = gradAdminRequest(report, s, r, { todayIso: '2025-03-01', entryTerm: 'Fall 2024', priorStudy: 'x' }).items.actions;
    assert.ok(actions.some((a) => a.includes('CS 58000') && a.includes('— transfer 2 of its 4 credits (the rest over the 6-credit transfer cap);')), JSON.stringify(actions));
  });
  // Verification, transfer-1: a cap other than §5.2's that cuts the course is
  // the one the table names, and the request does not call it over §5.2's.
  // Since DGS 2026-10-27 only the part that cap admits is submitted.
  it('a course the non-CSE allowance cuts names that allowance, not §5.2, and only its admitted part is submitted', async () => {
    const { gradAdminRequest } = await import('../src/ui/grad-admin-request.ts');
    const r = buildRules({
      parameters: { ms_noncse_credits_max: '3' },
      external: ['MA 51100', 'MA 52000'].map((id) => ({ university: 'PURDUE UNIVERSITY', course_id: id, course_title: id, transferable_PhD: 'yes', transferable_MSCSE: 'yes', is_cse: 'no', credit_system: 'semester' })),
    });
    const s = phdStudent({
      program: 'mscse', msOption: 'project', entryTerm: fall(2024), priorMs: 'completed', gpa: 3.6, bachelorsAwarded: spring(2021),
      background: { bachelors: 'elsewhere', graduate: 'elsewhere', finished: true },
      courses: [
        transferCourse('MA 51100', 'Linear Algebra', { credits: 2, term: fall(2022), degreeLevel: 'masters', institution: 'Purdue University' }),
        transferCourse('MA 52000', 'Analysis', { credits: 3, term: spring(2023), degreeLevel: 'masters', institution: 'Purdue University' }),
        ndCourse('CSE 60641', { term: fall(2024) }),
      ],
    });
    const report = audit(s, r, '2025-03-01');
    const entry = report.transferCredits?.find((x) => x.courseId === 'MA 52000');
    assert.equal(entry?.counted, 1);
    assert.match(entry?.restOver ?? '', /non-CSE cap \(§3\.2\)/);
    const req = gradAdminRequest(report, s, r, { todayIso: '2025-03-01', entryTerm: 'Fall 2024', priorStudy: 'x' });
    const cell = req.items.courses.find((c) => c.courseId === 'MA 52000')?.credits ?? '';
    assert.match(cell, /^1 of 3 \(the rest over the 3-credit non-CSE cap \(§3\.2\)\)$/);
    assert.doesNotMatch(cell, /§5\.2/);
    // Only the credit the allowance admits transfers (DGS 2026-10-27: "If
    // credits cannot be transferred because of the non-CSE limit or others,
    // only those credits should be transferred"), the rest named by its cap.
    assert.ok(!req.items.transfersOverCap.some((t) => t.courseId === 'MA 52000'));
    const ma = req.items.transfers.find((t) => t.courseId === 'MA 52000');
    assert.equal(ma?.cappedCredits, 1);
    assert.match(ma?.cutBy ?? '', /^over the 3-credit non-CSE cap \(§3\.2\)$/);
    const action = req.items.actions.find((a) => a.includes('MA 52000')) ?? '';
    // The credits to transfer said outright (DGS 2026-10-28: "explicitly state
    // how many credits need to be transferred"); the cap that cut the rest is
    // named in the course table, without its section in the request.
    assert.match(action, /^Submit the Transfer of Credits request to the Graduate School for MA 52000 Analysis \(Purdue University, Spring 2023\) — transfer 1 of its 3 credits \(the rest over the 3-credit non-CSE cap\); recommended by the DGS in the course rules \(§5\.2\)\.$/);
    assert.match(req.text, /\nPurdue University\tMA 52000\tAnalysis\t3\t1 \(the rest over the 3-credit non-CSE cap\)\tA\tSpring 2023\t/, 'ND credits: the 1 to transfer, and why');
    assert.match(req.text, /\nMA 52000\tAnalysis\t1 of 3 \(the rest over the 3-credit non-CSE cap\)\tA\tSpring 2023\t/);
    assert.doesNotMatch(req.text, /§5\.2/);
  });
});

// 14: the GPA minimum printed as the check uses it.
describe('14: a two-decimal gpa_min is not rounded', () => {
  it('3.25 reads 3.25 in the title and the sentence; 3 still reads 3.0', () => {
    const s = phdStudent({ gpa: 3.27, courses: [ndCourse('CSE 60641')] });
    const row = audit(s, buildRules({ parameters: { gpa_min: '3.25' } }), '2026-10-14').requirements.find((r) => r.id === 'shared.gpa')!;
    assert.equal(row.title, 'Cumulative GPA of at least 3.25');
    assert.match(row.detail, /Cumulative GPA 3\.27 meets the 3\.25 minimum/);
    assert.equal(audit(s, rules, '2026-10-14').requirements.find((r) => r.id === 'shared.gpa')!.title, 'Cumulative GPA of at least 3.0');
  });
});

// 15: the coursework key's total is the card's (held at sixty).
describe('15: the Ph.D. total the key states', () => {
  it('a row set to 50: sixty without an earlier master’s, 50 with one', async () => {
    const { phdTotalFor } = await import('../src/engine/requirements/phd.ts');
    const r = buildRules({ parameters: { phd_total_credits_min: '50' } });
    assert.equal(phdTotalFor(r.parameters, phdStudent({ priorMs: 'none' })), 60);
    assert.equal(phdTotalFor(r.parameters, phdStudent({ priorMs: 'completed' })), 50);
  });
  // Verification, sheet-pages-6: the key's own word.
  it('the coursework key’s word: totalCreditsWord', async () => {
    const { totalCreditsWord } = await import('../src/ui/coursework-text.ts');
    const r = buildRules({ parameters: { phd_total_credits_min: '50' } });
    assert.equal(totalCreditsWord(phdStudent({ priorMs: 'none' }), r), '60');
    assert.equal(totalCreditsWord(phdStudent({ priorMs: 'completed' }), r), '50');
    assert.equal(totalCreditsWord(phdStudent({ program: 'mscse', msOption: 'project' }), r), String(r.parameters.number('ms_total_credits_min')));
    assert.equal(totalCreditsWord(phdStudent({ program: 'mscse', msOption: 'project' }), buildRules({ parameters: { ms_total_credits_min: null } })), 'required');
  });
});

// 19, 21: a scanned course number with a digit look-alike.
describe('19, 21: the code suggestion', async () => {
  const { parseExternalTranscript } = await import('../src/transcript/external.ts');
  const { SCANNER_LAYER_CONFIDENCE } = await import('../src/transcript/scanner-layer.ts');
  const table = (code: string) => ['Western State University', 'Office of the Registrar', 'Official Academic Transcript', 'Fall 2023', 'Course   Title   Credits   Grade', `${code}   Calculus Two   3   A`, 'CS 504   Operating Systems   3   A', '', 'This document lists the courses taken by the student at the university and is issued by the registrar.'];
  it('19: a small “l” printed for 1 is suggested too', () => {
    const l = table('MATH 2l0');
    const row = parseExternalTranscript(l, l.map(() => SCANNER_LAYER_CONFIDENCE), { scannerLayer: true }).courses.find((c) => /^MATH 2/.test(c.courseId));
    assert.equal(row?.codeSuggestion, 'MATH 210', JSON.stringify(row));
  });
  it('21: a confidently read OCR line is flagged for its code, not as poorly read', () => {
    const l = table('PHYS 1O1');
    const rows = parseExternalTranscript(l, l.map(() => 96)).courses;
    const row = rows.find((c) => c.courseId === 'PHYS 1O1')!;
    assert.equal(row.lowConfidence, true);
    assert.equal(row.evidence, 'code');
    assert.equal(rows.find((c) => c.courseId === 'CS 504')!.lowConfidence, undefined);
  });
  // Verification, reader-5: a small “i” printed for 1 keeps its suggestion.
  it('19: a small “i” printed for 1 is still suggested', () => {
    const l = table('PHYS 1i1');
    const row = parseExternalTranscript(l, l.map(() => 96)).courses.find((c) => /^PHYS 1/.test(c.courseId))!;
    assert.equal(row.codeSuggestion, 'PHYS 111', JSON.stringify(row));
    assert.equal(row.lowConfidence, true);
    assert.equal(row.evidence, 'code');
  });
  // Verification, reader-6: item 31 (a) keeps McMaster's real O and I numbers
  // suggested on a scan; a code with other letters is not.
  it('31 (a): McMaster’s numbers with an O or an I are offered, never applied', async () => {
    const { readFileSync } = await import('node:fs');
    const { codeLookalikeSuggestion } = await import('../src/transcript/external.ts');
    const mosaic = JSON.parse(readFileSync(new URL('./fixtures/public-transcripts/mcmaster-mosaic.json', import.meta.url), 'utf8')) as string[];
    const at = mosaic.findIndex((x) => /^COMPSCI 1MD3\b/.test(x));
    assert.ok(at >= 0);
    const lines = [...mosaic.slice(0, at + 1), 'SFWRENG 3O03   Linear Optimization   1   3   B-', ...mosaic.slice(at + 1)];
    const rows = parseExternalTranscript(lines, lines.map(() => SCANNER_LAYER_CONFIDENCE), { scannerLayer: true }).courses;
    const o = rows.find((c) => /^SFWRENG 3O03$/.test(c.courseId))!;
    assert.equal(o.codeSuggestion, 'SFWRENG 3003');
    assert.equal(o.lowConfidence, true);
    assert.equal(rows.find((c) => c.courseId === 'COMPSCI 1MD3')?.codeSuggestion, undefined);
    assert.equal(codeLookalikeSuggestion('ENGPHYS 4I03'), 'ENGPHYS 4103');
  });
});

// 20: a Cyrillic transcript with no course read says what to do.
describe('20: Cyrillic text and no course read', () => {
  it('the message', async () => {
    const { nonLatinNoRowsMessage } = await import('../src/ui/external-upload.ts');
    assert.match(nonLatinNoRowsMessage('diploma.pdf'), /^No course could be read from “diploma\.pdf”: it has Cyrillic text, and the reader reads Latin-letter course codes only\. Add each course by hand in the Coursework card/);
  });
  // Verification, reader-2 to reader-4: the routing, not just the string.
  it('the routing: Cyrillic course codes, not a Cyrillic letterhead; a scanner’s layer keeps OCR', async () => {
    const { readFileSync } = await import('node:fs');
    const { noRowsRoute } = await import('../src/ui/external-upload.ts');
    const { parseExternalTranscript } = await import('../src/transcript/external.ts');
    const ua = JSON.parse(readFileSync(new URL('./fixtures/public-transcripts/ukraine-supplement.json', import.meta.url), 'utf8')) as string[];
    const codes = parseExternalTranscript(ua);
    assert.equal(codes.cyrillicCodes, true);
    assert.equal(noRowsRoute(codes, false), 'cyrillic-codes');
    assert.equal(noRowsRoute(codes, true), 'offer-ocr');
    // An English transcript with a bilingual letterhead and its rows on a page image.
    const letterhead = parseExternalTranscript([
      'Example State University / Приклад',
      'Office of the Registrar',
      'Official Transcript',
      'Program: Master of Science, Computer Science',
      'Course listing continues on the attached page image.',
      'This official transcript is issued by the Office of the Registrar and is valid only when it bears the registrar signature and the embossed seal of the university.',
      'The grading scale, credit definitions and academic standing codes are described in the legend printed on the reverse of this page.',
    ]);
    assert.equal(letterhead.courses.length, 0);
    assert.equal(letterhead.nonLatinScript, true);
    assert.equal(letterhead.cyrillicCodes, undefined);
    assert.equal(noRowsRoute(letterhead, false), 'offer-ocr');
  });
});

// 22: one credit short reads "it", not "all of them".
describe('22: the one-credit gap', () => {
  it('21 of 22 with a 3-credit course waiting', () => {
    const ids = ['CSE 60641', 'CSE 60321', 'CSE 60111', 'CSE 60427', 'CSE 60535', 'CSE 60762', 'CSE 60770'];
    const s = phdStudent({
      entryTerm: fall(2024), bachelorsAwarded: spring(2024), gpa: 3.7,
      courses: [...ids.map((id, i) => ndCourse(id, { term: [fall(2024), fall(2024), spring(2025), spring(2025), fall(2025), fall(2025), spring(2026)][i]! })), ndCourse('CSE 40567', { term: spring(2026) })],
      fullTimeTermOverrides: [fall(2024), spring(2025), fall(2025), spring(2026)],
      milestones: { advisorIdentified: '2024-10-01', advisorName: 'Prof. Example', advisorTtt: 'yes', rcrTrainingCompleted: '2025-09-15' },
    });
    const c = audit(s, buildRules({ parameters: { phd_regular_credits_min: '22' } }), '2026-04-01').requirements.find((r) => r.id === 'phd.candidacyAdmission')!;
    assert.match(c.detail, /still needed: 1 more regular-course credit \(it can be satisfied by CSE 40567 if the DGS approves it\)/);
  });
});

// 23, 32: the advisor email's time-limit item.
describe('23, 32: the time limit in the advisor email', async () => {
  const { actionItems } = await import('../src/ui/advisor-summary.ts');
  it('23: past the eight years, finished in time, only the research date blank — no extension asked of the DGS', () => {
    const sc = loadScenario('phd-defense-dated-without-research-date');
    const s = structuredClone(sc.student);
    s.milestones = { ...s.milestones, defensePassed: '2029-04-15', dissertationSubmitted: '2029-04-30' };
    const report = audit(s, buildRules(sc.rules.patch), '2029-09-15');
    assert.equal(report.requirements.find((r) => r.id === 'phd.timeLimit')!.status, 'cannot_evaluate');
    const todo = actionItems(report);
    assert.ok(!todo.dgs.some((d) => /eligibility extension|dissertation completion status/.test(d)), JSON.stringify(todo.dgs));
    assert.ok(!todo.student.some((d) => /^Ask the DGS about the time limit/.test(d)), JSON.stringify(todo.student));
    assert.ok(todo.student.includes('Enter the missing date or value the cards name, so the time limit can be checked (§4.3).'), JSON.stringify(todo.student));
  });
  // Verification, emails-1: held only by another row's missing sheet number.
  it('23: a limit held only by a missing sheet number asks nothing of the student', () => {
    const sc = loadScenario('phd-cannot-evaluate-survives-a-passed-deadline');
    const report = audit(sc.student, buildRules(sc.rules.patch), sc.today);
    assert.equal(report.requirements.find((r) => r.id === 'phd.timeLimit')!.status, 'cannot_evaluate');
    const todo = actionItems(report);
    assert.ok(!todo.student.some((d) => /^Enter the missing date or value/.test(d)), JSON.stringify(todo.student));
    assert.ok(todo.dgs.some((d) => /^Add the missing parameter/.test(d)), JSON.stringify(todo.dgs));
  });
  // Verification, emails-4: a heading that names the Ph.D. keeps its period.
  it('24: a flag heading mid-list keeps “Ph.D.”', () => {
    const sc = loadScenario('phd-nd-mscse-five-years-before');
    const s = structuredClone(sc.student);
    s.leaveSemesters = 1;
    const report = audit(s, buildRules(sc.rules.patch), sc.today);
    const item = actionItems(report).dgs.find((d) => /^Answer my review request’s \d+ items/.test(d)) ?? '';
    assert.match(item, /before I entered the Ph\.D\. in Fall 2026; /, item);
    assert.doesNotMatch(item, /Ph\.D;/);
  });
  // Verification, emails-5: one item per §5.5 question.
  it('24: the examinations item is the one §5.5 question on the exams', () => {
    const sc = loadScenario('phd-readmitted-exams-before-gap');
    const dgs = actionItems(audit(sc.student, buildRules(sc.rules.patch), sc.today)).dgs;
    assert.ok(dgs.some((d) => /My examinations from before my readmission/.test(d)), JSON.stringify(dgs));
    assert.ok(!dgs.some((d) => /^Rule on my Oral Candidacy Exam|^Confirm the late research-component result/.test(d)), JSON.stringify(dgs));
  });
  it('32: an MSCSE past the limit with the candidacy application open says “every counted requirement”', () => {
    const sc = loadScenario('mscse-last-course-after-the-limit');
    const todo = actionItems(audit(sc.student, buildRules(sc.rules.patch), sc.today));
    assert.ok(todo.student.some((d) => /^Confirm with the DGS whether the Graduate School extended my time limit — every counted requirement is complete, but the last one came after the limit/.test(d)), JSON.stringify(todo.student));
  });
});

// 24: the review request's other items reach the DGS's list.
describe('24: “Nothing is pending” never beside a review-request item', async () => {
  const { actionItems, advisorSummary } = await import('../src/ui/advisor-summary.ts');
  for (const [name, head] of [['mscse-thesis-readers-not-ttt', 'Thesis readers'], ['mscse-semester-below-graduate-level', 'Fewer than 3 credits at the 60000 level or higher in a full-time semester'], ['mscse-summer-session-only-time-limit', 'Time limit']] as const) {
    it(name, () => {
      const sc = loadScenario(name);
      const report = audit(sc.student, buildRules(sc.rules.patch), sc.today);
      const todo = actionItems(report);
      assert.ok(todo.dgs.some((d) => d.startsWith('Answer my review request’s item besides the courses:') && d.includes(head)), JSON.stringify(todo.dgs));
      assert.ok(todo.student.some((d) => /^Send the DGS the review request/.test(d)), JSON.stringify(todo.student));
      const text = advisorSummary(report, { todayIso: sc.today, entryTerm: 'Fall 2024', priorStudy: 'x' }).text;
      assert.doesNotMatch(text, /Nothing is pending with the A?DGS/);
    });
  }
});

// 25, 26, 27: the emails and Next steps.
describe('25, 26, 27: emails and Next steps', async () => {
  const { msLimitPassedClause, advisorSummary } = await import('../src/ui/advisor-summary.ts');
  const { nextSteps } = await import('../src/ui/next-steps.ts');
  it('25: no “time limit passed” clause while the time limit cannot be evaluated', () => {
    const sc = loadScenario('life-mscse-thesis-finished');
    const s = structuredClone(sc.student);
    delete s.milestones.msCandidacyApplied;
    delete s.milestones.advisorTtt;
    const report = audit(s, buildRules(sc.rules.patch), '2030-01-15');
    assert.equal(report.requirements.find((r) => r.id === 'ms.timeLimit')!.status, 'cannot_evaluate');
    assert.equal(msLimitPassedClause(report), '');
  });
  it('26: a “no” advisor answer does not skip the earlier-degrees wait', () => {
    const s = phdStudent({ courses: [transferCourse('CS 59999', 'Unlisted', { term: fall(2024), degreeLevel: 'masters' })], milestones: { advisorIdentified: '2026-09-01', advisorName: 'Prof. X', advisorTtt: 'no' } });
    const report = audit(s, rules, '2026-10-14');
    const steps = nextSteps({ report, student: s, review: { unlisted: 1, caseByCase: 0, earlierOnly: true }, processingCount: 0 }).map((x) => x.text);
    assert.ok(!steps.some((t) => /^Send the review request/.test(t)), JSON.stringify(steps));
    assert.ok(steps.some((t) => /^Your advisor is not tenured or tenure-track CSE faculty/.test(t)), JSON.stringify(steps));
  });
  it('27: no “I were” or “for I” in any test student’s advisor email', async () => {
    const { allScenarios } = await import('./helpers.ts');
    for (const sc of allScenarios()) {
      const t = advisorSummary(audit(sc.student, buildRules(sc.rules.patch), sc.today), { todayIso: sc.today, entryTerm: 'Fall 2024', priorStudy: 'x' }).text;
      assert.doesNotMatch(t, /\bI were\b|\b(?:for|to|with|by|of|from|on|about) I\b|\bI and my advisor\b/, sc.name);
    }
  });
});

// 36: the test gaps the review found — each fails if its behaviour regresses.
describe('36: test gaps', async () => {
  const { actionItems } = await import('../src/ui/advisor-summary.ts');
  it('on-page sheet warnings: the box shows them alone, and every issue once there is an error', async () => {
    const { diagnosticsContent, onPageWarnings, sheetWarningText } = await import('../src/ui/sheet-warnings.ts');
    const dup = { severity: 'warning' as const, tab: 'Universities', row: 13, message: 'Universities row 13 repeats X (already in row 2) — the last row wins', onPage: true as const };
    const quiet = { severity: 'warning' as const, tab: 'ExternalCourses', message: 'an old column still holds values' };
    const err = { severity: 'error' as const, tab: 'Parameters', message: "missing 'gpa_min'" };
    assert.equal(diagnosticsContent([quiet]), null);
    assert.deepEqual(diagnosticsContent([quiet, dup]), { issues: [dup], summary: 'Rules-sheet warning — for the DGS' });
    assert.equal(diagnosticsContent([quiet, dup, err])!.issues.length, 3);
    assert.deepEqual(onPageWarnings([quiet, dup, err]), [dup]);
    assert.equal(sheetWarningText(dup), 'Rules sheet — for the DGS: Universities row 13 repeats X (already in row 2) — the last row wins');
    // The live duplicate rules mark it.
    const rr = buildRules({ universities: [{ university: 'X UNIVERSITY', credit_system: 'semester' }, { university: 'x university', credit_system: 'quarter' }] });
    assert.equal(onPageWarnings(rr.issues).length, 1);
  });
  it('P4-transfer-2: posted credit for an unfinished Ph.D. counts in full', () => {
    const sc = loadScenario('phd-posted-credit-no-earlier-program');
    const s = { ...structuredClone(sc.student), priorMs: 'unfinished' as const, background: { bachelors: 'elsewhere' as const, graduate: 'elsewhere' as const, finished: false } };
    s.courses = [...s.courses, transferCourse('CS 59500', 'Seminar', { term: fall(2022), degreeLevel: 'phd', institution: 'Purdue University' })];
    const row = audit(s, buildRules(sc.rules.patch), sc.today).requirements.find((r) => r.id === 'phd.transfer')!;
    assert.match(row.detail, /besides \d+ on your Notre Dame record, counted in full/, row.detail);
  });
  it('P4-transfer-3: a course taken elsewhere after admission, on a record with no earlier program, keeps its own hold', () => {
    const s = phdStudent({ entryTerm: fall(2024), priorMs: 'none', courses: [transferCourse('CS 50300', 'OS', { term: { season: 'summer', year: 2025 }, degreeLevel: 'masters', institution: 'Purdue University' })] });
    const line = audit(s, rules, '2025-10-01').courseLines.find((l) => l.courseId === 'CS 50300')!;
    assert.match(line.text, /after you entered — a course taken elsewhere after admission needs the department’s and the Graduate School’s approval in advance/);
    assert.doesNotMatch(line.text, /taken outside any degree program/);
  });
  it('P4-transfer-4, -7: the page’s sentences', async () => {
    const { notFinishedSentence, ndUndergraduateClause } = await import('../src/ui/coursework-text.ts');
    const phdElsewhere = phdStudent({ priorMs: 'unfinished', courses: [transferCourse('CS 50300', undefined, { degreeLevel: 'phd' })] });
    assert.match(notFinishedSentence(phdElsewhere, 'Your earlier graduate program', '6', '24'), /^Your earlier graduate program — a Ph\.D\. — was not finished; no document states a transfer limit for an unfinished Ph\.D\./);
    const msElsewhere = phdStudent({ priorMs: 'unfinished', courses: [transferCourse('CS 50300', undefined, { degreeLevel: 'masters' })] });
    assert.match(notFinishedSentence(msElsewhere, 'Your earlier graduate program', '6', '24'), /^Your earlier graduate program was not finished, so up to 6 credits from it may transfer \(§5\.2\)/);
    const after = phdStudent({ program: 'mscse', integratedBsMs: true, integratedAdmitted: fall(2026), bachelorsAwarded: spring(2026) });
    assert.match(ndUndergraduateClause(after), /admitted to the Integrated program after your bachelor’s degree, so a 60000-level course counts only among the shared 6/);
    assert.match(ndUndergraduateClause({ ...after, integratedAdmitted: fall(2025) }), /^60000-level courses your bachelor’s degree did not use, whenever you took them/);
    assert.match(ndUndergraduateClause({ ...after, integratedBsMs: false }), /60000-level courses you took as an undergraduate do not count/);
  });
  it('P4-transfer-5: a dated Notre Dame MSCSE start dates the window', async () => {
    const { transferRuleText } = await import('../src/ui/coursework-text.ts');
    const sc = loadScenario('phd-nd-mscse-and-masters-elsewhere-window');
    assert.match(transferRuleText(sc.student, buildRules(sc.rules.patch), sc.today, false), /within 5 years before your admission to the Notre Dame MSCSE \(Fall 2016 or later\)/);
  });
  it('P4-phd-7: overdue with only the research left', () => {
    const s = phdStudent({ entryTerm: fall(2024), gpa: 3.8, courses: [ndCourse('CSE 60641', { term: fall(2024) }), ndCourse('CSE 60111', { term: spring(2025) }), ndCourse('CSE 60321', { term: spring(2025) })], milestones: { advisorName: 'Prof. X', advisorTtt: 'yes' } });
    const report = audit(s, rules, '2026-10-11');
    assert.equal(report.requirements.find((r) => r.id === 'phd.qualifier')!.qualifierCourseComponentsDone, true);
    const todo = actionItems(report);
    assert.ok(todo.student.some((t) => /^Complete the research component of the qualifier — the deadline \(the end of Spring 2026\) has passed; ask the DGS about an extension \(§4\.4\)\.$/.test(t)), JSON.stringify(todo.student));
    assert.ok(!todo.student.some((t) => /remaining qualifier components|all three qualifier components/.test(t)));
  });
  it('P4-mscse-3: the research credits finished after the five years hold the award too', () => {
    const term = (season: 'fall' | 'spring', year: number) => ({ season, year });
    const regular = [['CSE 60641', term('fall', 2020)], ['CSE 60111', term('fall', 2020)], ['CSE 60321', term('spring', 2021)], ['CSE 60535', term('spring', 2021)], ['CSE 60427', term('fall', 2021)], ['CSE 60762', term('fall', 2021)], ['CSE 60770', term('spring', 2022)], ['CSE 60876', term('spring', 2022)]] as const;
    const s = phdStudent({
      entryTerm: fall(2020), gpa: 3.7,
      courses: [...regular.map(([id, t]) => ndCourse(id, { term: t })), ndCourse('CSE 98900', { term: spring(2026), credits: 6, grade: 'S' })],
      milestones: { advisorIdentified: '2020-10-01', advisorName: 'Prof. Example', advisorTtt: 'yes', candidacyPassed: '2023-04-15' },
      attestations: { wantsMsAlongTheWay: true, oceConfirmedByDgs: true },
    });
    const row = audit(s, rules, '2026-06-01').requirements.find((r) => r.id === 'phd.msAlongTheWay')!;
    assert.equal(row.status, 'needs_dgs_review', row.detail);
    assert.match(row.detail, /The 6 research credits at Notre Dame were completed in Spring 2026/);
  });
  it('3(a): a record that only qualifies keeps the award out of the email; asked for, it is in', () => {
    const sc = loadScenario('life-phd-finished');
    const r = buildRules(sc.rules.patch);
    const quiet = actionItems(audit(sc.student, r, sc.today));
    assert.ok(![...quiet.student, ...quiet.gradAdmin].some((t) => /along the way/.test(t)), JSON.stringify(quiet));
    const asked = { ...sc.student, attestations: { ...sc.student.attestations, wantsMsAlongTheWay: true } };
    const loud = actionItems(audit(asked, r, sc.today));
    assert.ok(loud.gradAdmin.some((t) => /^Process the MSCSE awarded along the way/.test(t)), JSON.stringify(loud.gradAdmin));
  });
  it('P4-transfer-4: the label for the Notre Dame MSCSE and an unfinished Ph.D. elsewhere', async () => {
    const { priorStudyLabel } = await import('../src/ui/program-history.ts');
    const s = phdStudent({ priorMs: 'unfinished', ndMasters: { term: spring(2022) }, background: { bachelors: 'elsewhere', graduate: 'nd-mscse', alsoElsewhere: true, finished: false }, courses: [transferCourse('CS 50300', undefined, { degreeLevel: 'phd' })] });
    assert.equal(priorStudyLabel(s), 'MSCSE at Notre Dame (one graduate program with the Ph.D.); an unfinished Ph.D. elsewhere');
  });
  it('the code suggestion reaches the preview and never the record', async () => {
    const { parseExternalTranscript } = await import('../src/transcript/external.ts');
    const { SCANNER_LAYER_CONFIDENCE } = await import('../src/transcript/scanner-layer.ts');
    const { previewRowOf, courseEntryOf } = await import('../src/ui/external-upload.ts');
    const t = ['Western State University', 'Office of the Registrar', 'Official Academic Transcript', 'Fall 2023', 'Course   Title   Credits   Grade', 'PHYS 1O1   Classical Mechanics   3   A', 'CS 504   Operating Systems   3   A', '', 'This document lists the courses taken by the student at the university and is issued by the registrar.'];
    const rows = parseExternalTranscript(t, t.map(() => SCANNER_LAYER_CONFIDENCE), { scannerLayer: true }).courses;
    const row = previewRowOf(rows.find((c) => c.courseId === 'PHYS 1O1')!, 'masters');
    assert.equal(row.codeSuggestion, 'PHYS 101');
    assert.equal(previewRowOf(rows.find((c) => c.courseId === 'CS 504')!, 'masters').codeSuggestion, undefined);
    const entry = courseEntryOf({ ...row, courseId: row.codeSuggestion!, year: 2023 }, { slot: 'masters', unofficial: false } as never, 'Western State University');
    assert.equal(entry.courseId, 'PHYS 101');
    assert.ok(!('codeSuggestion' in entry));
  });
  it('P4-ac-3: an approved leave for another reason moves no clock', () => {
    const sc = loadScenario('phd-transcript-gap-covered-by-other-leave');
    const r = buildRules(sc.rules.patch);
    const dates = (s: Student) => {
      const rep = audit(s, r, sc.today);
      return ['phd.timeLimit', 'phd.candidacy', 'phd.candidacyAdmission'].map((id) => rep.requirements.find((x) => x.id === id)?.deadline?.date);
    };
    assert.deepEqual(dates(sc.student), dates({ ...sc.student, otherLeaveSemesters: 0 }));
    assert.ok((sc.student.otherLeaveSemesters ?? 0) > 0);
  });
  it('a saved file: the new fields are validated', async () => {
    const { validateStudent } = await import('../src/ui/state.ts');
    const load = (extra: Record<string, unknown>) => validateStudent(JSON.parse(JSON.stringify({ ...phdStudent(), ...extra })), []);
    assert.equal(load({ otherLeaveSemesters: 2 }).otherLeaveSemesters, 2);
    for (const bad of ['2', -1, 2.5, 21, null]) assert.equal(load({ otherLeaveSemesters: bad }).otherLeaveSemesters, undefined, String(bad));
    for (const k of ['examsBeforeInterruptionStand', 'oceConfirmedByDgs', 'wantsMsAlongTheWay']) {
      for (const ok of [true, false]) assert.equal((load({ attestations: { [k]: ok } }).attestations as Record<string, unknown>)[k], ok, `${k} ${ok}`);
      for (const bad of ['yes', 1, null]) assert.equal((load({ attestations: { [k]: bad } }).attestations as Record<string, unknown>)[k], undefined, `${k} ${String(bad)}`);
    }
    const kept = load({ courses: [{ ...ndCourse('CSE 60641'), dgsHoldApproved: true }, { ...ndCourse('CSE 60111'), dgsHoldApproved: 'yes' }] }).courses;
    assert.equal(kept[0]!.dgsHoldApproved, true);
    assert.equal(kept[1]!.dgsHoldApproved, undefined);
  });
});

// The verification of the round-5 fixes (2026-10-14): one test per follow-up,
// each failing without its fix.
describe('round 5 verification follow-ups', () => {
  it('transfer-3: the import toast reads the record, not the slot', async () => {
    const { unfinishedPriorLabel } = await import('../src/ui/program-history.ts');
    const phdRow = transferCourse('CS 70000', 'Topics', { degreeLevel: 'phd', institution: 'Purdue University' });
    assert.equal(unfinishedPriorLabel(phdStudent({ priorMs: 'unfinished', courses: [phdRow] })), 'Prior Ph.D., not completed');
    // A Ph.D.-slot transcript whose rows were re-filed as Notre Dame master's rows.
    assert.equal(unfinishedPriorLabel(phdStudent({ priorMs: 'unfinished', courses: [{ ...phdRow, degreeLevel: 'masters' }] })), 'Prior M.S., not completed');
  });
  it('17: the course-rules page’s warnings — under the date, or at the head of the notices when embedded', async () => {
    const { coursesPageWarnings } = await import('../src/ui/sheet-warnings.ts');
    const dup = { severity: 'warning' as const, tab: 'Courses', row: 9, message: 'Courses row 9 repeats CSE 60111 — the last row wins', onPage: true as const };
    const quiet = { severity: 'warning' as const, tab: 'Parameters', row: 3, message: 'a note' };
    assert.deepEqual(coursesPageWarnings([dup, quiet], false), { masthead: [dup], notices: [] });
    assert.deepEqual(coursesPageWarnings([dup, quiet], true), { masthead: [], notices: [dup] });
  });
  it('28, sheet-pages-2: the along-the-way box', async () => {
    const { alongTheWayBox } = await import('../src/ui/page-decisions.ts');
    const box = (name: string, edit: (s: Student) => void = () => {}) => {
      const sc = loadScenario(name);
      const s = structuredClone(sc.student);
      edit(s);
      return alongTheWayBox(audit(s, buildRules(sc.rules.patch), sc.today), s);
    };
    // Qualifies and not asked: shown, unticked.
    assert.deepEqual(box('life-phd-finished'), { checked: false });
    // Asked by the dated application alone: ticked, with the way to withdraw.
    assert.deepEqual(box('life-phd-ms-along-the-way'), { checked: true, hint: 'Your dated Application for Admission to Master’s Degree Candidacy already asks for it — clear that date to withdraw.' });
    // Ticked: no hint.
    assert.deepEqual(box('phd-ms-along-the-way-4xxxx'), { checked: true });
    // A Ph.D. student who holds the Notre Dame MSCSE, with a date kept from the MSCSE record: no row, no box.
    assert.equal(box('life-phd-after-nd-mscse-finished', (s) => (s.milestones.msCandidacyApplied = '2024-02-10')), undefined);
  });
  // Verification, holds-3 and docs-tests-4: the halves the first tests missed.
  it('5: a short readmission with every earlier course ruled says so, not “wait for the DGS”', () => {
    const sc = loadScenario('phd-readmitted-after-four-years');
    const s = structuredClone(sc.student);
    const r = buildRules(sc.rules.patch);
    for (const l of audit(s, r, sc.today).courseLines.filter((x) => x.holdRuling)) Object.assign(s.courses.find((c) => c.courseId === l.courseId)!, { dgsApproved: true, dgsHoldApproved: true });
    const w = audit(s, r, sc.today).warnings?.find((x) => /^Readmitted/.test(x)) ?? '';
    assert.match(w, /; the DGS ruled on the courses from before your readmission, as you ticked on each\.$/, w);
    assert.doesNotMatch(w, /wait for the DGS/);
  });
  it('6: a ticked Notre Dame course from before admission, in progress, is in progress', () => {
    const sc = loadScenario('phd-nd-courses-before-admission-master-elsewhere');
    const s = structuredClone(sc.student);
    s.courses[0] = { ...s.courses[0]!, term: spring(2024), grade: 'IP', dgsApproved: true, dgsHoldApproved: true };
    const report = audit(s, buildRules(sc.rules.patch), '2024-04-01');
    assert.equal(report.courseLines.find((l) => l.courseId === 'CSE 60641')!.mark, 'in_progress');
    assert.match(report.requirements.find((x) => x.id === 'phd.credits.regular')!.detail, /^0 of 24 credits complete\. 3 in progress/);
  });
  it('29 (b): an old case-by-case tick alone releases no non-degree or before-admission hold', () => {
    const nd = loadScenario('phd-nd-non-degree-ticked');
    const s = structuredClone(nd.student);
    delete s.courses[0]!.dgsHoldApproved;
    const line = audit(s, buildRules(nd.rules.patch), nd.today).courseLines.find((l) => l.courseId === 'CSE 60641')!;
    assert.equal(line.mark, 'pending', line.text);
    assert.equal(line.approved, undefined);
    const ba = loadScenario('phd-nd-courses-before-admission-master-elsewhere');
    const s2 = structuredClone(ba.student);
    s2.courses[0]!.dgsApproved = true;
    const line2 = audit(s2, buildRules(ba.rules.patch), ba.today).courseLines.find((l) => l.courseId === 'CSE 60641')!;
    assert.equal(line2.mark, 'pending', line2.text);
    assert.equal(line2.approved, undefined);
  });
  it('29 (b): what the course box records', async () => {
    const { applyCourseTick } = await import('../src/ui/page-decisions.ts');
    const held = ndCourse('CSE 40567');
    applyCourseTick(held, { holdRuling: true }, true);
    assert.equal(held.dgsApproved, true);
    assert.equal(held.dgsHoldApproved, true);
    const plain = ndCourse('CSE 60111');
    applyCourseTick(plain, {}, true);
    assert.equal(plain.dgsApproved, true);
    assert.equal(plain.dgsHoldApproved, undefined);
    applyCourseTick(held, { holdRuling: true }, false);
    assert.equal(held.dgsApproved, undefined);
    assert.equal(held.dgsHoldApproved, undefined);
  });
});
