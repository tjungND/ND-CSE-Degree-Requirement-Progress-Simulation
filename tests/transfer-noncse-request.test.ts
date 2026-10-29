// The DGS's case (2026-10-27): a Ph.D. student with a finished master's from
// another university, whose approved transfer courses outside CSE run past
// §4.2's nine. "Only 17 credits can be transferred now, but in the texts
// copied for Grad Admin, it says full 24 credits … If credits cannot be
// transferred because of the non-CSE limit or others, only those credits
// should be transferred." What the allowance refuses is not transferred: it
// counts toward nothing (not the 60 either), and the Grad Admin request
// submits only the part that transfers.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { audit } from '../src/engine/audit.ts';
import { gradAdminRequest } from '../src/ui/grad-admin-request.ts';
import { buildRules } from './helpers.ts';
import { ndCourse, phdStudent, transferCourse } from './helpers/student.ts';

const fall = (year: number) => ({ season: 'fall' as const, year });
const spring = (year: number) => ({ season: 'spring' as const, year });
const UNI = 'Northeastern University';
const row = (id: string, transferable: string, isCse: 'yes' | 'no') => ({ university: 'NORTHEASTERN UNIVERSITY', course_id: id, course_title: id, transferable_PhD: transferable, transferable_MSCSE: transferable, is_cse: isCse, credit_system: 'semester' });
const EXTERNAL = [
  row('INFO 5100', 'yes', 'no'),
  row('INFO 6150', 'yes', 'no'),
  row('INFO 6205', 'yes', 'no'),
  row('TELE 5600', 'yes', 'no'),
  row('CSYE 6230', 'yes', 'yes'),
  row('CSYE 7270', 'yes', 'yes'),
  row('CSYE 7280', 'dgs_approval', 'yes'),
  row('INFO 7375', 'dgs_approval', 'no'),
  row('ENCP 6000', 'no', 'no'),
];
const rules = buildRules({ external: EXTERNAL });
const ne = (id: string, term: { season: 'fall' | 'spring'; year: number }) => transferCourse(id, id, { credits: 4, term, degreeLevel: 'masters', institution: UNI });
const student = phdStudent({
  entryTerm: fall(2026),
  priorMs: 'completed',
  bachelorsAwarded: spring(2024),
  background: { bachelors: 'elsewhere', graduate: 'elsewhere', samePlace: false, finished: true },
  courses: [
    ne('INFO 5100', fall(2024)),
    ne('INFO 6150', fall(2024)),
    ne('ENCP 6000', fall(2024)),
    ne('INFO 6205', spring(2025)),
    ne('CSYE 7280', spring(2025)),
    ne('CSYE 6230', fall(2025)),
    ne('CSYE 7270', fall(2025)),
    ne('TELE 5600', spring(2026)),
    ne('INFO 7375', spring(2026)),
    ndCourse('CSE 60641', { term: fall(2026), grade: 'IP' }),
  ],
});
const TODAY = '2026-10-28';
const report = audit(student, rules, TODAY);
const find = (id: string) => report.requirements.find((r) => r.id === id)!;

describe('transfer credit past the non-CSE nine is not transferred (DGS 2026-10-27)', () => {
  it('the §5.2 row counts 17 of the 24, and names the two courses the allowance cut', () => {
    const t = find('phd.transfer').detail;
    assert.match(t, /17 of the 24 credits you may transfer are counted; 4 more pending review/);
    assert.match(t, /INFO 6205: 3 of its 4 credits over the 9-credit non-CSE cap \(§4\.2\)/);
    assert.match(t, /TELE 5600: over the 9-credit non-CSE cap \(§4\.2\)/);
    // The card's list of courses to send matches what the request submits.
    assert.match(t, /Approved by the DGS in the course rules: INFO 5100, INFO 6150, INFO 6205, CSYE 6230, CSYE 7270\./);
  });

  it('the non-CSE row: what the allowance refuses counts toward nothing, not the total', () => {
    const n = find('phd.cap.noncse').detail;
    assert.match(n, /INFO 6205: 3 credits not counted — beyond the allowance/);
    assert.match(n, /TELE 5600: 4 credits not counted — beyond the allowance/);
    assert.doesNotMatch(n, /(INFO 6205|TELE 5600)[^.]*total-credit requirement only/);
  });

  it('the 60-credit row counts the 17 transferred credits, not 24', () => {
    assert.match(find('phd.credits.total').detail, /^17 of 60 credits complete/);
  });

  it('the Grad Admin request submits 17 credits: INFO 6205 in part, TELE 5600 not at all', () => {
    const items = gradAdminRequest(report, student, rules, { todayIso: TODAY, entryTerm: 'Fall 2026', priorStudy: 'x' }).items;
    const submitted = items.transfers.map((t) => [t.courseId, t.cappedCredits ?? t.credits]);
    assert.deepEqual(submitted, [
      ['INFO 5100', 4],
      ['INFO 6150', 4],
      ['INFO 6205', 1],
      ['CSYE 6230', 4],
      ['CSYE 7270', 4],
    ]);
    assert.equal(submitted.reduce((sum, [, c]) => sum + (c as number), 0), 17);
    const info = items.actions.find((a) => a.includes('INFO 6205')) ?? '';
    // The credits to transfer said outright (DGS 2026-10-28: "explicitly state
    // how many credits need to be transferred"); the cap that cut the rest is
    // named in the course table.
    assert.match(info, /\(Northeastern University, Spring 2025\) — transfer 1 of its 4 credits; recommended by the DGS in the course rules \(§5\.2\)\.$/);
    // Every action says its credits — the 17, not the full 24.
    assert.deepEqual(items.actions.map((a) => / — transfer (\d+)(?: of its \d+)? credits?; /.exec(a)?.[1]), ['4', '4', '1', '4', '4']);
    assert.ok(!items.actions.some((a) => a.includes('TELE 5600')));
    assert.deepEqual(items.transfersOverCap.map((t) => [t.courseId, t.cutBy]), [['TELE 5600', 'over the 9-credit non-CSE cap (§4.2)']]);
  });

  it('the request prints a "Not submitted" section for TELE 5600 under the cap that cut it', () => {
    const { text } = gradAdminRequest(report, student, rules, { todayIso: TODAY, entryTerm: 'Fall 2026', priorStudy: 'x' });
    // The cap named, without its section (DGS 2026-10-28).
    assert.match(text, /^NOT SUBMITTED — OVER THE 9-CREDIT NON-CSE CAP$/m);
    assert.match(text, /TELE 5600 \(Northeastern University, Spring 2026\) — which courses fill it is the self-check’s choice, not a ruling; the DGS may choose\./);
    assert.doesNotMatch(text, /NOT SUBMITTED — OVER THE \d+-CREDIT TRANSFER CAP/);
  });
});

// From the review of the change (2026-10-28): what stays as it was.
describe('around the change: credit already posted, a missing limit', () => {
  // Three Notre Dame courses outside CSE fill the nine (fixture CSE rows renamed).
  const ndNonCse = [
    { course_id: 'CSE 60876', set: { course_id: 'MATH 60850', title: 'Math Methods' } },
    { course_id: 'CSE 60770', set: { course_id: 'EE 60770', title: 'EE Thing' } },
    { course_id: 'CSE 60762', set: { course_id: 'PHYS 60762', title: 'Physics Thing' } },
  ];
  const nd = [ndCourse('MATH 60850', { term: fall(2025) }), ndCourse('EE 60770', { term: fall(2025) }), ndCourse('PHYS 60762', { term: spring(2026) })];
  const base = { entryTerm: fall(2025), priorMs: 'completed' as const, bachelorsAwarded: spring(2022), background: { bachelors: 'elsewhere' as const, graduate: 'elsewhere' as const, samePlace: false, finished: true } };

  it('transfer credit the Graduate School already posted keeps counting toward the 60, and the request’s table says so', () => {
    const r = buildRules({ courses: ndNonCse });
    const posted = { ...transferCourse('STAT 61000', 'Stat Theory', { credits: 3, term: fall(2024), degreeLevel: 'masters', institution: 'Purdue University' }), ndPosted: { term: spring(2026), credits: 3, level: 'graduate' as const } };
    const s = phdStudent({ ...base, courses: [...nd, posted] });
    const rep = audit(s, r, TODAY);
    assert.match(rep.requirements.find((x) => x.id === 'phd.credits.total')!.detail, /^12 of 60 credits complete/);
    const cell = gradAdminRequest(rep, s, r, { todayIso: TODAY, entryTerm: 'Fall 2025', priorStudy: 'x' }).items.courses.find((c) => c.courseId === 'STAT 61000')?.credits;
    assert.equal(cell, '3');
  });

  it('a limit missing from the sheet: not submitted, "cannot be checked yet", not "over" anything', () => {
    const r = buildRules({
      parameters: { phd_noncse_6xxxx_credits_max: null },
      external: [{ university: 'PURDUE UNIVERSITY', course_id: 'STAT 60200', course_title: 'Stat', transferable_PhD: 'yes', transferable_MSCSE: 'yes', is_cse: 'no', credit_system: 'semester' }],
    });
    const s = phdStudent({ ...base, courses: [transferCourse('STAT 60200', 'Stat', { credits: 3, term: fall(2024), degreeLevel: 'masters', institution: 'Purdue University' })] });
    const req = gradAdminRequest(audit(s, r, TODAY), s, r, { todayIso: TODAY, entryTerm: 'Fall 2025', priorStudy: 'x' });
    assert.deepEqual(req.items.transfersOverCap.map((t) => [t.courseId, t.cutUnknown]), [['STAT 60200', true]]);
    assert.match(req.text, /^NOT SUBMITTED — CANNOT BE CHECKED YET$/m);
    // No handbook section in the request (DGS 2026-10-28).
    assert.match(req.text, /\n- STAT 60200 \(Purdue University, Fall 2024\) — the rules sheet does not say what the .+ is, so this course cannot be counted yet — ask the DGS to fill it in\.\n/);
    assert.doesNotMatch(req.text, /the DGS may choose/);
  });
});

// DGS 2026-10-28: "Fill the transfer courses first." A Notre Dame course
// outside CSE no longer takes the nine before the transfer courses: its
// overflow still counts toward the 60, theirs would count toward nothing.
describe('transfer courses fill the non-CSE nine first (DGS 2026-10-28)', () => {
  const r = buildRules({
    courses: [{ course_id: 'CSE 60876', set: { course_id: 'MATH 60850', title: 'Math Methods' } }],
    external: EXTERNAL,
  });
  for (const [label, grade] of [['in progress', 'IP'], ['graded', 'A']] as const) {
    it(`a Notre Dame MATH course ${label}: 17 credits still transfer, and it counts toward the 60`, () => {
      const s = { ...student, courses: [...student.courses, ndCourse('MATH 60850', { term: fall(2026), grade })] };
      const rep = audit(s, r, TODAY);
      assert.match(rep.requirements.find((x) => x.id === 'phd.transfer')!.detail, /17 of the 24 credits you may transfer are counted/);
      assert.match(rep.requirements.find((x) => x.id === 'phd.credits.total')!.detail, grade === 'A' ? /^20 of 60 credits complete/ : /^17 of 60 credits complete/);
      const items = gradAdminRequest(rep, s, r, { todayIso: TODAY, entryTerm: 'Fall 2026', priorStudy: 'x' }).items;
      assert.equal(items.transfers.reduce((sum, t) => sum + (t.cappedCredits ?? t.credits), 0), 17);
    });
  }
});
