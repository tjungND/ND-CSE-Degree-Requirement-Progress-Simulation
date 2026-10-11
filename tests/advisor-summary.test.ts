// The "Send summary to advisor" email (src/ui/advisor-summary.ts), in the
// shape the DGS asked for on 2026-09-06: the requirements in handbook order,
// one section per group, each row coloured by status (green met / amber in
// progress or needs review / red not yet), with its why and deadline; then
// what the student, the advisor and the DGS each need to do. advisorSummary
// is pure string building over an AuditReport, so hand-made reports are
// enough; no rules or DOM needed.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AuditReport, RequirementResult } from '../src/engine/types.ts';
import { actionItems, advisorSummary, approvalItems, whyFor } from '../src/ui/advisor-summary.ts';
import { BADGE_STYLE, htmlRequirementBlock } from '../src/ui/email-html.ts';
import { audit } from '../src/engine/audit.ts';
import { buildRules } from './helpers.ts';
import { ndCourse, phdStudent } from './helpers/student.ts';

function req(id: string, title: string, status: RequirementResult['status'], detail = '', group = 'Coursework — §4.2', section = '§4.2'): RequirementResult {
  return { id, group, title, status, detail, citation: { section, quote: 'quote' } };
}

const report: AuditReport = {
  program: 'phd',
  requirements: [
    req('shared.gpa', 'Cumulative GPA of at least 3.0', 'met', 'Cumulative GPA 3.50 meets the 3.0 minimum.', 'Basic requirements — §2.2–2.3', '§2.2'),
    req('phd.credits.total', '60 total credits of courses & research', 'unmet', '14 of 60 credits complete. 9 in progress.'),
    // The courses a credit row counts ride into the Why column (DGS 2026-09-22).
    { ...req('phd.credits.regular', '24 credit hours of regular courses', 'in_progress', '12 of 24 credits complete. 3 in progress.'), contributions: [{ courseId: 'CSE 60641', credits: 3 }, { courseId: 'CSE 60111', credits: 3 }, { courseId: 'CSE 60321', credits: 3, pending: true as const }] },
    req('phd.cap.noncse', 'At most 9 credits at 6xxxx from outside CSE', 'needs_dgs_review', 'needs approval: MATH 60610.'),
    req('phd.transfer', 'Transfer credit from prior graduate study', 'not_applicable', 'No prior M.S.'),
    {
      ...req('shared.approvals', 'Courses still to be approved or processed', 'needs_dgs_review', '', 'Approvals', '§3.2/§4.2/§5.2'),
      informational: true,
      detailParts: [{ lead: 'Your advisor and the DGS must both approve these — send the review request', items: ['MATH 60610 (non-CSE course — needs advisor + DGS approval (§3.2/§4.2))'] }],
    },
  ],
  courseLines: [{ courseId: 'CSE 60641', term: { season: 'fall', year: 2026 }, text: 'counts toward regular courses (3 cr)', mark: 'counts', counts: [] }],
  summary: { met: 1, conditional: 0, scored: 4 },
  warnings: [], tracks: [],
};

const opts = { todayIso: '2026-09-04', entryTerm: 'Fall 2026', priorStudy: 'No prior graduate degree', gpa: 3.5 };

describe('advisor summary: sections in handbook order, rows coloured by status', () => {
  const { text, html } = advisorSummary(report, opts);

  it('subject line and standing paragraph carry the headline facts', () => {
    assert.match(text, /^Subject: Degree self-check — Ph\.D\., entered Fall 2026 — 2 requirements in progress\n/);
    assert.match(text, /\nHere is my current standing from the CSE degree self-check tool, as of September 4, 2026\.\n/);
    assert.match(text, /\nPh\.D\. \(Handbook §4\); entered Fall 2026; no prior graduate degree; cumulative GPA 3\.50\.\n/);
    assert.match(text, /\n1 of 4 requirements met · 2 in progress · 1 conditionally met\.\n/);
    assert.doesNotMatch(text, /2026-09-04/, 'no ISO date anywhere');
  });

  it('text: one section per group in report order; every row tagged with the page status word', () => {
    const basic = text.indexOf('\nBASIC REQUIREMENTS — §2.2–2.3\n');
    const coursework = text.indexOf('\nCOURSEWORK — §4.2\n');
    assert.ok(basic >= 0 && coursework > basic, 'sections in handbook order');
    assert.match(text, /\n  \[MET\] Cumulative GPA of at least 3\.0 \(§2\.2\)\n      Why: Cumulative GPA 3\.50 meets the 3\.0 minimum\.\n/, 'met rows carry their Why (DGS 2026-09-22)');
    assert.match(text, /\n  \[IN PROGRESS\] 60 total credits of courses & research \(§4\.2\)\n      Why: 14 of 60 credits complete\. 9 in progress\.\n/);
    assert.match(text, /\n  \[IN PROGRESS\] 24 credit hours of regular courses \(§4\.2\)\n      Why: 12 of 24 credits complete\. 3 in progress\.\n/, 'no course list — the summary is enough (DGS 2026-09-23)');
    assert.match(text, /\n  \[CONDITIONALLY MET\] At most 9 credits at 6xxxx from outside CSE \(§4\.2\)\n      Why: Needs approval: MATH 60610\.\n/);
    assert.doesNotMatch(text, /Transfer credit from prior graduate study/, '"does not apply" rows are left out');
    assert.doesNotMatch(text, /\nAPPROVALS\n|Courses still to be approved or processed/, 'the sign-off list feeds the to-do lists, not a section');
    assert.doesNotMatch(text, /Courses counted|COURSES COUNTED/, 'no course list (DGS 2026-09-23)');
  });

  it('HTML: stacked rows, not a five-column table (DGS 2026-09-28) — the badge and the title on one line, the why beneath', () => {
    // One bordered block per requirement (DGS 2026-09-28, evening: "hard to
    // see which text is for which requirement"): the why lives INSIDE the block.
    assert.ok(html.includes(`<p><strong>Basic requirements — §2.2–2.3</strong></p>${htmlRequirementBlock({ word: 'Met', color: 'green', title: 'Cumulative GPA of at least 3.0', section: '§2.2', lines: ['Cumulative GPA 3.50 meets the 3.0 minimum.'] })}`), html);
    assert.ok(html.includes(htmlRequirementBlock({ word: 'In progress', color: 'amber', title: '60 total credits of courses & research', section: '§4.2', lines: ['14 of 60 credits complete. 9 in progress.'] })));
    assert.ok(html.includes(htmlRequirementBlock({ word: 'In progress', color: 'amber', title: '24 credit hours of regular courses', section: '§4.2', lines: ['12 of 24 credits complete. 3 in progress.'] })), html);
    assert.match(html, /border-left:4px solid #10693f;background:#f7f8fa/, 'the block’s left rule is the row’s colour, as on the page');
    assert.doesNotMatch(html, /<table/, 'no tables in the advisor summary any more');
    assert.match(BADGE_STYLE.green, /^background:#e4f2ea;color:#10693f$/, 'the page’s met pill');
    // A met row lists its courses too — the Why cell is otherwise empty for it.
    const metWithCourses = advisorSummary({ ...report, requirements: [{ ...report.requirements[0]!, id: 'phd.credits.nd', title: 'Nine at ND', contributions: [{ courseId: 'CSE 60770', credits: 3 }] }] }, opts);
    assert.match(metWithCourses.text, /\[MET\] Nine at ND \(§2\.2\)\n      Why: Cumulative GPA 3\.50 meets the 3\.0 minimum\.\n/, 'contributions are not listed');
    assert.match(advisorSummary(report, { ...opts, advisors: ['Prof. X', 'Prof. Y'] }).text, /\nDear Prof\. X and Prof\. Y,\n[\s\S]*\nACTION REQUESTED — WHAT I NEED FROM YOU, MY ADVISORS\n/);
    assert.match(advisorSummary(report, { ...opts, advisors: ['Prof. X'] }).text, /\nDear Prof\. X,\n[\s\S]*\nACTION REQUESTED — WHAT I NEED FROM YOU, MY ADVISOR\n/);
    assert.match(advisorSummary(report, { ...opts, advisors: ['Prof. X', 'Prof. Y'] }).html, /<p>Dear Prof\. X and Prof\. Y,<\/p>/);
    // A name typed without a title gets "Prof."; an existing title is kept (DGS 2026-09-23).
    assert.match(advisorSummary(report, { ...opts, advisors: ['Matthew Morrison', 'Dr. Sharon Hu'] }).text, /\nDear Prof\. Matthew Morrison and Dr\. Sharon Hu,\n/);
    assert.match(advisorSummary(report, { ...opts, advisors: ['Professor Hu'] }).text, /\nDear Professor Hu,\n/);
    assert.match(text, /\nDear Advisor,\n/, 'no name entered → the generic salutation');
    // A seminar already taken is dropped (DGS 2026-09-23); the open one stays.
    // Two open course statements in a row become bullets; one does not.
    const seminar = advisorSummary({ ...report, requirements: [{ ...report.requirements[0]!, id: 'phd.seminar', title: 'Seminar', detail: 'CSE 63801: done (Fall 2026). CSE 63802: in progress (Spring 2027).' }] }, opts).text;
    assert.match(seminar, /\[MET\] Seminar \(§2\.2\)\n      Why: CSE 63802: in progress \(Spring 2027\)\.\n/);
    const twoOpen = advisorSummary({ ...report, requirements: [{ ...report.requirements[0]!, id: 'phd.seminar', title: 'Seminar', detail: 'CSE 63801: not yet. CSE 63802: in progress (Spring 2027).' }] }, opts).text;
    assert.match(twoOpen, /\[MET\] Seminar \(§2\.2\)\n      Why: CSE 63801: not yet\. CSE 63802: in progress \(Spring 2027\)\.\n/, 'no bullets (DGS 2026-09-23)');
    // The categories row names the groups satisfied, not the courses (DGS 2026-09-23).
    const cats = advisorSummary({ ...report, requirements: [{ ...report.requirements[0]!, id: 'phd.qualifier.categories', title: 'Categories', detail: '', detailParts: [{ lead: '3 qualifying courses covering 2 distinct groups', items: ['CSE 60641 Graduate Operating Systems → Systems and Software', 'CSE 60321 Advanced Computer Architecture → Architecture', 'CSE 60876 Research Methods → Architecture (flexible course — your assignment)'] }] }] }, opts).text;
    assert.match(cats, /\[MET\] Categories \(§2\.2\)\n      Why: 3 qualifying courses covering 2 distinct groups: Systems and Software, Architecture\.\n/);
    // Conditionally met is blue, as on the page (the Grad Admin request's colour, 2026-09-28; amber before).
    assert.ok(html.includes(htmlRequirementBlock({ word: 'Conditionally met', color: 'blue', title: 'At most 9 credits at 6xxxx from outside CSE', section: '§4.2', lines: ['Needs approval: MATH 60610.'] })));
    assert.doesNotMatch(html, /Transfer credit from prior graduate study/);
  });

  it('the advisor’s own actions come FIRST (DGS 2026-09-28), the standing list next, my to-dos and the other parties’ after it, the notices last', () => {
    const order = ['ACTION REQUESTED — WHAT I NEED FROM YOU, MY ADVISOR', 'MY STANDING, REQUIREMENT BY REQUIREMENT', 'COURSEWORK — §4.2', 'WHAT I NEED TO DO', 'WHAT THE DGS NEEDS TO DO', 'Nothing is pending with the Grad Admin.', 'Alpha version under testing.'].map((h) => text.indexOf(`\n${h}`));
    assert.ok(order.every((i) => i >= 0), `all present: ${order}`);
    assert.deepEqual([...order].sort((a, b) => a - b), order);
    assert.match(text, /\n\nDear Advisor,\n\nStudent: \[your name, netID and NDID\]\n\nHere is my current standing/, 'the student line (DGS 2026-09-28)');
    assert.match(text, /\nWHAT I NEED TO DO\n- Complete 46 more credits toward the total-credit requirement \(9 of them in progress\) \(§4\.2\)\.\n- Complete 12 more credits of regular courses \(3 of them in progress\) \(§4\.2\)\.\n- Send the DGS the review request for MATH 60610\.\n/);
    // Each list in its reader's words (DGS 2026-09-28): the advisor approves
    // a non-CSE course for the plan of study; the DGS approves it for the student.
    assert.match(text, /\nACTION REQUESTED — WHAT I NEED FROM YOU, MY ADVISOR\n1\. Approve MATH 60610 — a course from outside CSE, for my coursework \(§3\.2\/§4\.2\)\.\n\nMY STANDING/);
    assert.match(text, /\nWHAT THE DGS NEEDS TO DO\n- Approve MATH 60610 for me — a course from outside CSE \(§3\.2\/§4\.2\)\.\n/);
    assert.match(html, /<p><strong>Action requested — what I need from you, my advisor<\/strong><\/p><ol><li>Approve MATH 60610 — a course from outside CSE, for my coursework/);
    assert.match(html, /<p><strong>What I need to do<\/strong><\/p><ul><li>Complete 46 more credits/);
    assert.match(html, /<p><strong>What the DGS needs to do<\/strong><\/p><ul><li>Approve MATH 60610 for me/);
  });

  it('closes with the alpha/no-warranty notice and the handbook edition; no deadline footnote without deadlines', () => {
    assert.match(text, /\nThank you!\n\nAlpha version under testing\. Informational only, no warranty — not an official degree audit; every final decision rests with the DGS\. For the MSCSE along the way, this self-check is the DGS’s own review of the award \(§3\.1\)\. Checked against the CSE Graduate Studies Handbook \(https:\/\/[^)]+\), together with the Graduate School’s Academic Code, DGS Handbook and 4\+1 guidance\.\n$/);
    assert.doesNotMatch(text, /transcript-PDF|Not all cases are covered|Deadlines are counted from/);
  });
});

describe('advisor summary: the 2026-09-28 format items', () => {
  it('three met core-knowledge rows collapse into one line with the areas and their courses', () => {
    const core = (area: string, id: string, course: string) => req(`phd.qualifier.core.${id}`, `Core knowledge: ${area}`, 'met', `Satisfied by ${course}.`, 'Qualifying examination — §4.4', '§4.4.1');
    const r = advisorSummary({ ...report, requirements: [...report.requirements, core('Operating Systems', 'os', 'CSE 60641'), core('Algorithms', 'algorithms', 'CSE 60111'), core('Computer Architecture', 'architecture', 'CSE 60321')] }, opts);
    assert.match(r.text, /\nQUALIFYING EXAMINATION — §4\.4\n  \[MET\] Core knowledge: all three areas \(§4\.4\.1\)\n      Why: Operating Systems: CSE 60641; Algorithms: CSE 60111; Computer Architecture: CSE 60321\.\n\n/);
    assert.equal((r.text.match(/Core knowledge/g) ?? []).length, 1, 'one line, not three');
    // One of them open: nothing collapses.
    const open = advisorSummary({ ...report, requirements: [...report.requirements, core('Operating Systems', 'os', 'CSE 60641'), core('Algorithms', 'algorithms', 'CSE 60111'), { ...core('Computer Architecture', 'architecture', ''), status: 'unmet', detail: 'Not yet.' }] }, opts);
    assert.equal((open.text.match(/Core knowledge/g) ?? []).length, 3);
  });

  it('an allowance is a meter, as on the page (DGS 2026-09-28): "3 of 9 used" in grey, its first sentence not repeated', () => {
    const cap = { ...req('phd.cap.nonCse', 'At most 9 credits at 6xxxx from outside CSE', 'needs_dgs_review', '3 of the 9 non-CSE allowance credits used. Needs approval: MATH 60610.', 'Allowances — §4.2', '§4.2'), allowance: true as const, progress: { have: 3, need: 9, unit: 'credits' } };
    const r = advisorSummary({ ...report, requirements: [...report.requirements.filter((x) => x.id !== 'phd.cap.nonCse'), cap] }, opts);
    assert.match(r.text, /\n  \[3 OF 9 USED\] At most 9 credits at 6xxxx from outside CSE \(§4\.2\)\n      Why: Needs approval: MATH 60610\.\n/);
    assert.ok(r.html.includes(htmlRequirementBlock({ word: '3 of 9 used', color: 'grey', title: 'At most 9 credits at 6xxxx from outside CSE', section: '§4.2', lines: ['Needs approval: MATH 60610.'] })), r.html);
    const unused = advisorSummary({ ...report, requirements: [{ ...cap, status: 'not_applicable' as const, statusLabel: 'Not used yet', progress: undefined, detail: '' }] }, opts);
    assert.doesNotMatch(unused.text, /At most 9 credits/, '"does not apply" rows stay out, meter or not');
  });

  it('the Notre Dame programs in the subject and the standing (DGS 2026-09-28)', () => {
    const r = advisorSummary(report, { ...opts, history: { compact: 'Ph.D., entered Fall 2026; MSCSE at Notre Dame, Fall 2024–Spring 2026', earlier: 'Earlier Notre Dame programs: MSCSE at Notre Dame, Fall 2024–Spring 2026.' } });
    assert.equal(r.subject, 'Degree self-check — Ph.D., entered Fall 2026; MSCSE at Notre Dame, Fall 2024–Spring 2026 — 2 requirements in progress');
    assert.match(r.text, /cumulative GPA 3\.50\.\nEarlier Notre Dame programs: MSCSE at Notre Dame, Fall 2024–Spring 2026\.\n1 of 4 requirements met/);
  });

  it('approvalItems: the page’s reasons, re-voiced for each reader (the 2026-09-28 bug: "send the review request" reached the advisor and the DGS)', () => {
    const unlisted = approvalItems('MATH 60610', 'not in the course rules yet — send the review request so the DGS can enter it; a course from outside CSE also needs your advisor’s approval (§4.2)', 'phd');
    assert.deepEqual(unlisted, { advisor: 'Approve MATH 60610 — a course from outside CSE, for my coursework (§4.2).', dgs: 'Enter MATH 60610 in the course rules — it is not listed yet; a course from outside CSE also needs my advisor’s approval (§4.2).' });
    assert.deepEqual(approvalItems('STAT 51200', 'listed as case by case — needs the DGS’s approval for you (§5.2)', 'phd'), { dgs: 'Decide on STAT 51200 for me — the course rules say case by case (§5.2).' });
    assert.deepEqual(approvalItems('CSE 40567', 'needs advisor + DGS approval per the course rules', 'phd'), { advisor: 'Approve CSE 40567 — a course below the 60000 level, for my coursework (§4.2).', dgs: 'Approve CSE 40567 for me — a course below the 60000 level (§4.2).' });
    assert.deepEqual(approvalItems('CS 50300', 'transfer credit needs a DGS recommendation (§5.2)', 'phd'), { dgs: 'Recommend the transfer credit for CS 50300 (§5.2).' });
    for (const item of Object.values({ ...unlisted, ...approvalItems('CSE 40567', 'needs advisor + DGS approval per the course rules', 'mscse') })) assert.doesNotMatch(item, /send the review request|your advisor/);
  });
});

describe('advisor summary: deadlines on the rows that have them', () => {
  const withDeadlines: AuditReport = {
    ...report,
    requirements: [
      ...report.requirements,
      {
        ...req('phd.qualifier.research', 'Research component: a significant research contribution', 'unmet', 'Overdue — talk to your advisor and the DGS.', 'Qualifying examination — §4.4', '§4.4.3'),
        deadline: { date: '2028-02-15', approx: true, state: 'overdue', label: 'Overdue' },
      },
      {
        ...req('phd.candidacy', 'Oral Candidacy Exam (OCE) passed', 'in_progress', '', 'Oral Candidacy Exam (OCE) — §4.5', '§4.5'),
        deadline: { date: '2030-05-31', approx: true, state: 'upcoming', label: 'Due by the end of Spring 2030 — semester 8 (2030-05-31) (approximate)' },
      },
      {
        ...req('done', 'Something already done', 'met', 'Done.', 'Oral Candidacy Exam (OCE) — §4.5', '§4.5'),
        deadline: { date: '2027-01-01', approx: true, state: 'done', label: 'Complete' },
      },
    ],
    summary: { met: 2, conditional: 0, scored: 6 },
  };
  const { text, html } = advisorSummary(withDeadlines, opts);

  it('subject line adds the passed deadline; the deadline is a line of its own under the row, "!!" when passed (the Grad Admin request’s style, 2026-09-28); semesters, never dates', () => {
    assert.match(text, /^Subject: Degree self-check — Ph\.D\., entered Fall 2026 — 4 requirements in progress, 1 deadline passed\n/);
    assert.match(text, /\nQUALIFYING EXAMINATION — §4\.4\n  \[OVERDUE\] Research component: a significant research contribution \(§4\.4\.3\)\n      !! DEADLINE PASSED: was due during Spring 2028\n/);
    // The next open deadline is named up top (DGS 2026-09-28) — the passed one is not "next".
    assert.match(text, /\nNext deadline: Oral Candidacy Exam \(OCE\) passed \(§4\.5\) — Due by the end of Spring 2030\.\n\nACTION REQUESTED/);
    assert.match(text, /\nOCE — §4\.5\n  \[IN PROGRESS\] OCE passed \(§4\.5\)\n      Deadline: Due by the end of Spring 2030\n  \[MET\] Something already done \(§4\.5\)\n      Why: Done\.\n/, 'a far deadline is stated without the alert; the full OCE name went to the next-deadline line');
    for (const dueLine of text.split('\n').filter((l: string) => /\bdue\b/i.test(l))) {
      assert.doesNotMatch(dueLine, /\d{4}-\d{2}-\d{2}/, `no ISO date in a deadline line: ${dueLine}`);
    }
    assert.doesNotMatch(text, /\(approximate\)/, 'said once in the footnote');
    assert.match(text, /^Deadlines are counted from Fall 2026 and given by semester; they are approximate — the Graduate School calendar sets the exact dates\.$/m);
  });

  it('a transfer from the unfinished MSCSE: the footer names the term the qualifying exam counts from (policy review round 3, P3-text-ui-8)', () => {
    const t = advisorSummary(withDeadlines, { ...opts, entryTerm: 'Fall 2023', qualifierFrom: 'Fall 2025' }).text;
    assert.match(t, /^Deadlines are counted from Fall 2023 — the qualifying exam’s and the first-year seminars’ from Fall 2025, when I transferred into the Ph\.D\. — and given by semester; they are approximate — the Graduate School calendar sets the exact dates\.$/m);
  });

  it('HTML: the deadline box inside the row’s block — red when passed, plain when far off', () => {
    assert.ok(html.includes(htmlRequirementBlock({ word: 'Overdue', color: 'red', title: 'Research component: a significant research contribution', section: '§4.4.3', deadline: { text: 'was due during Spring 2028', alert: 'passed' } })), html);
    assert.ok(html.includes(htmlRequirementBlock({ word: 'In progress', color: 'amber', title: 'OCE passed', section: '§4.5', deadline: { text: 'Due by the end of Spring 2030', alert: undefined } })), html);
    assert.ok(html.includes('<p style="margin:6px 0 0"><strong>Deadline:</strong> Due by the end of Spring 2030</p></div>'));
  });

  it('a deadline in the next semester: the "!!" line, the orange box, and a count in the headline (DGS 2026-09-28)', () => {
    const soon: AuditReport = {
      ...report,
      requirements: [
        ...report.requirements,
        {
          ...req('phd.qualifier', 'Qualifying examination — all components', 'in_progress', '3 of 5 parts done.', 'Qualifying examination — §4.4', '§4.4'),
          deadline: { date: '2027-05-31', approx: true, state: 'due_soon', horizon: 'next', label: 'Due by the end of Spring 2027 (approximate)' },
        },
      ],
    };
    const r = advisorSummary(soon, opts);
    assert.match(r.text, /\n1 of 4 requirements met · 3 in progress · 1 conditionally met · 1 deadline in this semester or the next\.\n/);
    assert.match(r.text, /\n  \[IN PROGRESS\] Qualifying examination — all components \(§4\.4\)\n      !! DEADLINE NEXT SEMESTER: Due by the end of Spring 2027\n      Why: 3 of 5 parts done\.\n/);
    assert.ok(r.html.includes(htmlRequirementBlock({ word: 'In progress', color: 'amber', title: 'Qualifying examination — all components', section: '§4.4', lines: ['3 of 5 parts done.'], deadline: { text: 'Due by the end of Spring 2027', alert: 'next' } })), r.html);
    assert.ok(r.html.includes(' (§4.4)</p><p style="margin:6px 0 0;padding:4px 8px;background:#ffe3c9;color:#8a3a00;border-left:4px solid #e0863a"><strong>Deadline next semester:</strong> Due by the end of Spring 2027</p><p style="margin:4px 0 0">3 of 5 parts done.</p></div>'), 'the box sits right under the title, the why after it, all inside the block');
    assert.match(r.text, /\nNext deadline: Qualifying examination — all components \(§4\.4\) — Due by the end of Spring 2027 \(next semester\)\.\n/);
    assert.doesNotMatch(r.text, /\(approximate\)/, 'said once in the footnote');
  });

  it('to-dos: the passed research deadline asks the advisor to decide and the DGS to rule on an extension', () => {
    const todo = actionItems(withDeadlines);
    assert.ok(todo.student.includes('Pass the research component of the qualifier — the deadline (Spring 2028) has passed (§4.4.3).'));
    assert.ok(todo.student.includes('Take the Oral Candidacy Exam (OCE) by the end of Spring 2030 (§4.5).'));
    assert.ok(todo.advisor.includes('Determine whether I have passed the research component and file the Research-Qualifier form (§4.4.3).'));
    assert.ok(todo.dgs.includes('Decide whether to extend the research-component deadline (§4.4.3).'));
  });
});

describe('actionItems: the rest of the rules', () => {
  it('basic rows, residency, seminar, categories below the floor, missing parameters, plan of study', () => {
    const r: AuditReport = {
      program: 'phd',
      requirements: [
        req('shared.gpa', 'Cumulative GPA of at least 3.0', 'cannot_evaluate', 'Enter your cumulative GPA from your transcript (transferred grades are not part of it, §5.2).', 'Basic requirements — §2.2–2.3', '§2.2'),
        req('shared.advisor', 'Under continuous advisor supervision', 'unmet', 'No advisor entered — was expected by your first semester. Talk to the DGS.', 'Basic requirements — §2.2–2.3', '§2.3'),
        req('phd.seminar', '2 credits of Research Seminar in year one', 'in_progress', 'CSE 63801: done. CSE 63802: not yet.'),
        req('phd.residency', 'Four consecutive full-time semesters of residence', 'in_progress', 'Longest consecutive full-time run so far: 1 of 4 semesters.', 'Residence and time — §4.3', '§4.3'),
        req('phd.timeLimit', 'All requirements complete within 8 years', 'cannot_evaluate', "Cannot evaluate — the rules sheet is missing 'phd_time_limit_years'. Ask the DGS to add it to the Parameters tab", 'Residence and time — §4.3', '§4.3'),
        {
          ...req('phd.qualifier.categories', 'Three specialization courses from three distinct groups, each B or higher', 'in_progress', '', 'Qualifying examination — §4.4', '§4.4.2'),
          detailParts: ['2 of 3 groups covered (3 courses passed); the 1 in progress would complete it', 'CSE 60111 (B-) is below the B floor — retake it or take another course (§4.4.2)'],
        },
        req('phd.qualifier.core.os', 'Core knowledge: Operating Systems', 'needs_dgs_review', 'CS 50300 (Purdue) — not yet reviewed by the DGS.', 'Qualifying examination — §4.4', '§4.4.1'),
        req('phd.qualifier.core.algorithms', 'Core knowledge: Algorithms', 'unmet', 'No course yet.', 'Qualifying examination — §4.4', '§4.4.1'),
        req('phd.candidacy', 'Oral Candidacy Exam (OCE) passed', 'met', 'Oral Candidacy Exam (OCE) passed 2029-04-01.', 'Oral Candidacy Exam (OCE) — §4.5', '§4.5'),
        req('phd.dissertation.defense', 'Dissertation defense passed', 'unmet', 'Not yet.', 'Dissertation and defense — §4.7', '§4.7'),
        {
          ...req('shared.approvals', 'Courses still to be approved or processed', 'needs_dgs_review', '', 'Approvals', '§3.2/§4.2/§5.2'),
          informational: true,
          detailParts: [
            { lead: 'The DGS has still to decide these — send the review request', items: ['CS 51000 (transfer — not yet reviewed by the DGS; needs DGS + Graduate School approval (§5.2))', 'CSE 60999 (not in the course rules — counted provisionally; needs DGS review)'] },
            'Confirm your advisor approved your coursework (§3.2/§4.2) and tick the box below the milestones',
            'Once approved, tick the box under “Approvals you already have”',
          ],
        },
      ],
      courseLines: [],
      summary: { met: 1, conditional: 0, scored: 10 },
      warnings: [], tracks: [],
    };
    const todo = actionItems(r);
    assert.deepEqual(todo.student, [
      'Report my cumulative GPA (§2.2).',
      // The Ph.D.'s §2.3 wording, not the M.S.'s (policy review round 3, P3-cse-1-2-3).
      'Identify my faculty advisor — the Ph.D. requires continuous advisor supervision (§2.3).',
      'Take CSE 63802 — the research seminar (§4.2).',
      'Register full-time for 3 more consecutive semesters (§4.3).',
      'Pass a course that covers Algorithms — core knowledge (§4.4.1).',
      'Retake or replace CSE 60111 (B-) — a specialization course below the grade floor (§4.4.2).',
      'Defend the dissertation (§4.7).',
      'Send the DGS the review request for CS 51000, CSE 60999.',
    ]);
    assert.deepEqual(todo.advisor, ['Approve my coursework (§4.2).']); // the degree's own section only (2026-09-11)
    assert.deepEqual(todo.dgs, [
      'Confirm the Operating Systems core-knowledge course named in the review request (§4.4.1).',
      // In the DGS's own words (2026-09-28): a §5.2 recommendation, a row to enter.
      'Recommend the transfer credit for CS 51000 (§5.2).',
      'Enter CSE 60999 in the course rules — it is not listed yet (§4.2).',
      "Add the missing parameter 'phd_time_limit_years' to the rules sheet so all requirements complete within 8 years can be checked.",
    ]);
    assert.deepEqual(todo.gradAdmin, []);
    // The MSCSE keeps §2.3's M.S. wording.
    assert.ok(actionItems({ ...r, program: 'mscse' }).student.includes('Identify a thesis or project advisor (§2.3).'));
    // Dissertation items appear only because candidacy is met here.
    const early = { ...r, requirements: r.requirements.map((x) => (x.id === 'phd.candidacy' ? { ...x, status: 'in_progress' as const, detail: '' } : x)) };
    assert.ok(!actionItems(early).student.some((s) => /dissertation/i.test(s)));
    // Empty lists say so in the email.
    const { text } = advisorSummary({ program: 'mscse', requirements: [req('shared.gpa', 'Cumulative GPA of at least 3.0', 'met', 'ok', 'Basic requirements — §2.2–2.3', '§2.2')], courseLines: [], summary: { met: 1, conditional: 0, scored: 1 }, warnings: [], tracks: [] }, opts);
    assert.match(text, /\nACTION REQUESTED — WHAT I NEED FROM YOU, MY ADVISOR\nNothing at the moment\.\n\nMY STANDING[\s\S]*\nWHAT I NEED TO DO\n- Nothing at the moment\.\n\nNothing is pending with the ADGS or the Grad Admin\.\n\nThank you!\n/);
    assert.match(text, /^Subject: Degree self-check — M\.S\. in CSE, entered Fall 2026 — all checked requirements met\n/);
  });

  it('M.S. rows: project report (student + advisor), thesis defense, one full-time semester', () => {
    const r: AuditReport = {
      program: 'mscse',
      requirements: [
        req('ms.credits.regular', '24 credit hours of regular courses', 'in_progress', '18 of 24 credits complete.', 'Coursework — §3.2', '§3.2'),
        req('ms.residency', 'One full-time semester of residence', 'unmet', 'No full-time term yet — a term counts once its entered credits reach 9 (§2.1.2), or mark a research-heavy term as full-time.', 'Residence and time — §3.3', '§3.3'),
        req('ms.project.report', 'Project report accepted and approved by the advisor', 'unmet', 'Not yet: the written project report and deliverables must be accepted and approved by your advisor (§3.4).', 'M.S. project or thesis — §3.4', '§3.4'),
        req('ms.thesis.defense', 'Thesis defense passed', 'unmet', 'Not yet passed.', 'M.S. project or thesis — §3.4', '§3.4'),
      ],
      courseLines: [],
      summary: { met: 0, conditional: 0, scored: 4 },
      warnings: [], tracks: [],
    };
    const todo = actionItems(r);
    assert.deepEqual(todo.student, [
      'Complete 6 more credits of regular courses (§3.2).',
      'Register full-time for one semester (or one summer session) (§3.3).',
      'Defend the thesis (§3.4).',
      'Complete the project report and deliverables (§3.4).',
    ]);
    assert.deepEqual(todo.advisor, ['Accept and approve the project report and deliverables (§3.4).']);
    assert.deepEqual(todo.dgs, []);
    assert.deepEqual(todo.gradAdmin, []);
  });
});

// The engine's details address the student at the page; the email re-voices
// them (statements about the page dropped, "Overdue —" left to the deadline
// phrase, you/your → I/my) and keeps what is left as short sentences.
describe('whyFor re-voices the engine detail for the advisor', () => {
  it('drops page instructions and "Talk to the DGS", keeps the facts as sentences', () => {
    const r: RequirementResult = {
      ...req('shared.approvals', 'Courses still to be approved or processed', 'needs_dgs_review'),
      detailParts: [
        { lead: 'Your advisor and the DGS must both approve these — send the review request', items: ['MATH 60610 (non-CSE course — needs advisor + DGS approval (§3.2/§4.2))'] },
        'Confirm your advisor approved your coursework (§3.2/§4.2) and tick the box below the milestones',
        'Once approved, tick the box under “Approvals you already have”',
      ],
    };
    assert.equal(
      whyFor(r),
      'My advisor and the DGS must both approve these — send the review request: MATH 60610 (non-CSE course — needs advisor + DGS approval (§3.2/§4.2)). Advisor approval of my coursework (§3.2/§4.2) is not yet recorded.',
    );
    assert.equal(whyFor(req('x', 'x', 'in_progress', 'No advisor entered — was expected by your first semester. Talk to the DGS.')), 'No advisor entered — was expected by my first semester.');
    assert.equal(whyFor(req('x', 'x', 'cannot_evaluate', "Cannot evaluate — the rules sheet is missing 'ms_regular_credits_min'. Ask the DGS to add it to the Parameters tab")), "Cannot evaluate — the rules sheet is missing 'ms_regular_credits_min'.");
  });

  it('"Overdue —" statements go only when the row has a passed deadline; you/your become I/my', () => {
    const overdue: RequirementResult = { ...req('x', 'x', 'unmet', 'Overdue — the 8-year limit passed at the start of Fall 2034 (approximate). Talk to the DGS.'), deadline: { date: '2034-08-15', approx: true, state: 'overdue', label: 'Overdue' } };
    assert.equal(whyFor(overdue), '');
    assert.equal(whyFor(req('x', 'x', 'unmet', 'Overdue — the 8-year limit passed at the start of Fall 2034 (approximate). Talk to the DGS.')), 'Overdue — the 8-year limit passed at the start of Fall 2034 (approximate).');
    const spec: RequirementResult = {
      ...req('x', 'x', 'in_progress'),
      detailParts: ['2 of 3 groups covered (3 courses passed); the 1 in progress would complete it', 'CSE 60111 (B-) is below the B floor — retake it or take another course (§4.4.2)'],
    };
    const why = whyFor(spec);
    assert.ok(why.includes('2 of 3 groups covered (3 courses passed); the 1 in progress would complete it.'), why);
    assert.ok(why.includes('Below the B floor (§4.4.2): CSE 60111 (B-).'), why);
    assert.equal(whyFor(spec, true), '2 of 3 groups covered (3 courses passed); the 1 in progress would complete it.');
    assert.equal(whyFor(req('x', 'x', 'unmet', 'Cumulative GPA 2.80 is below the 3.0 minimum — you cannot receive a degree or defend until it recovers (§2.2).')), 'Cumulative GPA 2.80 is below the 3.0 minimum — I cannot receive a degree or defend until it recovers (§2.2).');
    assert.equal(whyFor(req('x', 'x', 'in_progress', '§4.2 expects these during the first year — you are in semester 2.')), '§4.2 expects these during the first year — I am in semester 2.');
  });

  it('splits prose at sentence ends but not inside M.S. / Ph.D. / e.g.', () => {
    assert.equal(whyFor(req('x', 'x', 'in_progress', 'Courses from a prior M.S. may transfer (§5.2). The Ph.D. cap is 24 credits, e.g. eight courses.')), 'Courses from a prior M.S. may transfer (§5.2). The Ph.D. cap is 24 credits, e.g. eight courses.');
    assert.equal(whyFor(req('x', 'x', 'in_progress', 'Courses from a prior M.S. may transfer (§5.2). The Ph.D. cap is 24 credits, e.g. eight courses.'), true), 'Courses from a prior M.S. may transfer (§5.2).');
  });
});

// Two people, two jobs (DGS 2026-09-06 evening): the DGS list holds eligibility
// decisions only; processing goes to a fourth list for the Grad Admin.
describe('to-dos: the Grad Admin list (2026-09-06 evening)', () => {
  const req = (id: string, title: string, status: RequirementResult['status'], detail: string, group: string, section: string): RequirementResult => ({
    id,
    title,
    status,
    detail,
    group,
    citation: { section, quote: '' },
  });
  it('a pre-approved transfer is the Grad Admin’s to process, not the DGS’s to decide; the MSCSE and the qualifier form are processing too', () => {
    const r: AuditReport = {
      program: 'phd',
      requirements: [
        { ...req('phd.qualifier', 'Qualifying examination — all components', 'met', 'Three components complete. Remember to file the qualifier completion form with the Grad Admin (§4.4)', 'Qualifying examination — §4.4', '§4.4'), qualifierCourseComponentsDone: true },
        { ...req('phd.msAlongTheWay', 'MSCSE awarded along the way', 'met', 'OCE passed 2029-04-01, with 24 regular course credits and 6 research credits completed at Notre Dame.', 'Oral Candidacy Exam (OCE) — §4.5', '§4.5'), informational: true },
        {
          ...req('shared.approvals', 'Courses still to be approved or processed', 'needs_dgs_review', '', 'Approvals', '§3.2/§4.2/§5.2'),
          detailParts: [
            {
              lead: 'Courses pending approval',
              items: [
                'CS 77777 (transfer — not yet reviewed by the DGS; needs DGS + Graduate School approval (§5.2))',
              ],
            },
          ],
        },
      ],
      courseLines: [],
      summary: { met: 2, conditional: 0, scored: 3 },
      warnings: [], tracks: [],
    };
    // The transfer the processing request carries (P3-emails-1, 2026-10-06):
    // passed in, as the page passes processingItems(...).transfers.
    const todo = actionItems(r, { courses: ['CS 50300'], recorded: false, firstSemesterDone: true });
    assert.deepEqual(todo.gradAdmin, [
      'Process the MSCSE awarded along the way (§3.1, §4.5).',
      'Record the completed qualifier once my form arrives (§4.4).',
      'Submit the Transfer of Credits request to the Graduate School for CS 50300 — recommended by the DGS (§5.2).',
    ]);
    assert.deepEqual(todo.dgs, ['Recommend the transfer credit for CS 77777 (§5.2).']);
    assert.ok(todo.student.includes('Send the Grad Admin the processing request for the MSCSE along the way (§3.1, §4.5).'));
    assert.ok(todo.student.includes('File the qualifier completion form with the Grad Admin (§4.4).'));
    assert.ok(todo.student.includes('Send the Grad Admin the processing request for CS 50300 (§5.2) — before the semester my degree is conferred.'), JSON.stringify(todo.student));
    assert.ok(todo.student.includes('Send the DGS the review request for CS 77777.'));
    const { text, html, subject } = advisorSummary(r, { todayIso: '2029-05-01', entryTerm: 'Fall 2026', priorStudy: 'Completed prior M.S. or Ph.D.', gpa: 3.5 });
    assert.equal(subject, 'Degree self-check — Ph.D., entered Fall 2026 — 2 of 3 met, 1 conditionally met');
    assert.match(text, /\nWHAT THE GRAD ADMIN NEEDS TO DO\n- Process the MSCSE awarded along the way \(§3\.1, §4\.5\)\.\n/);
    assert.match(html, /<p><strong>What the Grad Admin needs to do<\/strong><\/p><ul><li>Process the MSCSE awarded along the way/);
  });
});

// A lapsed Incomplete is confirmed, not decided — the Graduate School extends
// one (Academic Code §4.4) — and a second question on the course keeps its
// line (policy review round 3, P3-emails-7).
describe('a lapsed Incomplete in the advisor email (P3-emails-7)', () => {
  const lapsedOn = (courseId: string) => {
    const s = phdStudent({ entryTerm: { season: 'fall', year: 2025 }, gpa: 3.5, courses: [ndCourse(courseId, { term: { season: 'fall', year: 2025 }, grade: 'I' })] });
    return actionItems(audit(s, buildRules(), '2026-10-07'));
  };
  it('a graduate course: one confirmation, the review request’s words', () => {
    const todo = lapsedOn('CSE 60641');
    assert.ok(todo.dgs.includes('Confirm whether the Graduate School extended my Incomplete in CSE 60641, or the grade was posted (Academic Code §4.4).'), JSON.stringify(todo.dgs));
    assert.ok(!todo.dgs.some((d) => /^Decide on CSE 60641/.test(d)), JSON.stringify(todo.dgs));
  });
  it('a 40000-level course: the Incomplete and the approval, both', () => {
    const todo = lapsedOn('CSE 40567');
    assert.ok(todo.dgs.includes('Confirm whether the Graduate School extended my Incomplete in CSE 40567, or the grade was posted (Academic Code §4.4).'), JSON.stringify(todo.dgs));
    assert.ok(todo.dgs.some((d) => /^Approve CSE 40567 for me — a course below the 60000 level/.test(d)), JSON.stringify(todo.dgs));
    assert.ok(todo.advisor.some((d) => /^Approve CSE 40567 — a course below the 60000 level/.test(d)), JSON.stringify(todo.advisor));
  });
  it('the reading itself', () => {
    assert.deepEqual(approvalItems('CSE 60641', 'Incomplete (I) past its deadline (about 2026-02-01) — it became an F unless the Graduate School extended it (Academic Code §4.4); the DGS confirms', 'phd'), {
      incomplete: 'Confirm whether the Graduate School extended my Incomplete in CSE 60641, or the grade was posted (Academic Code §4.4).',
    });
  });
});
