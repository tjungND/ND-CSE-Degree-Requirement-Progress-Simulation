// The ExternalCourses tab (courses at other universities, decisions 2026-09-01):
// parsing + diagnostics, forgiving matching, and how a DGS ruling changes the
// engine — core knowledge confirmed outright (§4.4.1), transferability
// pre-approved / denied / undecided (§5.2), pro-rata nd_credits, and the
// Bachelor's-level rule (core knowledge yes, transfer credit never).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { QUARTER_CREDIT_FACTOR, TRIMESTER_CREDIT_FACTOR, findExternalRule, normalizeCourseId, normalizeUniversity, universityCreditSystem } from '../src/data/external.ts';
import { knownUniversities } from '../src/ui/university-name.ts';
import { buildCombinedReviewRequest } from '../src/ui/review-request.ts';
import { parseExternalTab, parseUniversitiesTab } from '../src/data/parse.ts';
import type { SheetIssue } from '../src/data/types.ts';
import { audit } from '../src/engine/audit.ts';
import { classify } from '../src/engine/allocate.ts';
import { signOffActors } from '../src/engine/requirements/shared.ts';
import { actionItems, advisorSummary } from '../src/ui/advisor-summary.ts';
import type { CourseEntry, Student } from '../src/engine/types.ts';
import { buildRules } from './helpers.ts';
import { phdStudent, transferCourse } from './helpers/student.ts';

const CORE = [
  { code: 'os', name: 'Operating Systems' },
  { code: 'algorithms', name: 'Algorithms' },
  { code: 'architecture', name: 'Computer Architecture' },
];

const student = (courses: Partial<CourseEntry>[], priorMs: Student['priorMs'] = 'completed'): Student =>
  phdStudent({ priorMs, courses: courses.map((c) => transferCourse('CS 50300', undefined, c)) });

const rules = buildRules(); // fixture ExternalCourses tab included

describe('ExternalCourses parsing', () => {
  it('reads the fixture rows and skips the prose note row', () => {
    assert.equal(rules.external.length, 7); // incl. the `none` row (2026-09-06), the quarter-system row and the `dgs_approval` row (2026-09-08)
    assert.equal(rules.issues.filter((i) => i.tab === 'ExternalCourses').length, 0);
  });

  it('reports bad values in plain English and keeps the rest of the row', () => {
    const issues: SheetIssue[] = [];
    const rows = parseExternalTab(
      'university,course_id,course_title,satisfies_core_area,transferable_PhD,nd_credits\n' +
        'Purdue University,CS 1,Good,os,yes,3\n' +
        'Purdue University,CS 2,Bad core,networking,yes,\n' +
        'Purdue University,CS 3,Bad transferable,os,maybe,\n' +
        'Purdue University,CS 4,Bad credits,os,yes,lots\n' +
        ',CS 5,No university,,,\n',
      CORE,
      issues,
    );
    assert.equal(rows.length, 4); // the university-less row is skipped entirely
    assert.equal(rows[1]?.satisfiesCoreArea, undefined);
    assert.equal(rows[2]?.transferablePhd, undefined);
    assert.equal(rows[3]?.ndCredits, undefined);
    assert.equal(issues.length, 4);
    for (const i of issues) assert.match(i.message, /ExternalCourses row \d/);
    assert.match(issues[0]!.message, /not one of the Categories tab/);
    assert.match(issues[1]!.message, /'yes', 'no', 'dgs_approval', 'adgs_approval' or blank/);
    assert.match(issues[2]!.message, /not a number/);
  });

  it('warns on duplicate (university, course) pairs — the last row wins (DGS 2026-09-06)', () => {
    const issues: SheetIssue[] = [];
    const rows = parseExternalTab(
      'university,course_id,transferable_PhD\nPURDUE UNIVERSITY,CS 1,yes\nPurdue-University,CS-1,no\n',
      CORE,
      issues,
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.transferablePhd, 'no', 'the later row (transferable = no) replaces the earlier one');
    assert.equal(rows[0]?.sheetRow, 3);
    assert.match(issues[0]?.message ?? '', /the last row wins: row 3 replaces row 2/);
  });

  it('a leftover university_aliases column is ignored, with one gentle warning', () => {
    const issues: SheetIssue[] = [];
    const rows = parseExternalTab(
      'university,university_aliases,course_id,transferable_PhD\nPURDUE UNIVERSITY,Purdue;PU,CS 1,yes\n',
      CORE,
      issues,
    );
    assert.equal(rows.length, 1);
    assert.equal(findExternalRule(rows, 'Purdue', 'CS 1'), undefined); // the alias no longer matches
    assert.ok(findExternalRule(rows, 'purdue university', 'CS 1'));
    assert.equal(issues.length, 1);
    assert.match(issues[0]!.message, /no longer used/);
    assert.match(issues[0]!.message, /can be deleted/);
  });
});

describe('matching is forgiving about spelling, never about identity', () => {
  it('normalizes case, punctuation, diacritics and spacing', () => {
    assert.equal(normalizeUniversity('  Université  de Montréal! '), 'universite de montreal');
    assert.equal(normalizeCourseId('cs-50300'), 'CS50300');
    assert.equal(normalizeCourseId('CS 503 00'), 'CS50300');
  });

  it('finds rules via the transcript-printed name — forgiving spelling, no aliases', () => {
    for (const uni of ['PURDUE UNIVERSITY', 'Purdue University', ' purdue-university ']) {
      assert.ok(findExternalRule(rules.external, uni, 'cs 50300'), uni);
    }
    assert.ok(findExternalRule(rules.external, 'Université de Montréal', 'IFT 2125')); // diacritics stripped both ways
    assert.ok(findExternalRule(rules.external, 'Tsinghua University', '30240233'));
    assert.equal(findExternalRule(rules.external, 'Purdue', 'CS 50300'), undefined); // abbreviations no longer match
    assert.equal(findExternalRule(rules.external, '清华大学', '30240233'), undefined); // native script retired with aliases
    assert.equal(findExternalRule(rules.external, 'Purdue University', 'CS 99999'), undefined);
    assert.equal(findExternalRule(rules.external, 'Indiana University', 'CS 50300'), undefined);
    assert.equal(findExternalRule(rules.external, '', 'CS 50300'), undefined);
  });
});

describe('the combined review request (one email for everything, 2026-09-03)', () => {
  const built = buildCombinedReviewRequest({
    priorStudy: 'Completed prior M.S. or Ph.D.',
    nd: [
      { courseId: 'MATH 60610', title: 'Real Analysis I', credits: 3, grade: 'A', termText: 'Fall 2026', reason: 'not in the course rules yet', unlisted: true },
      { courseId: 'CSE 40567', credits: 3, grade: 'B', termText: 'Fall 2026', reason: 'needs advisor + DGS approval per the course rules', unlisted: false },
    ],
    external: [
      { institution: 'Purdue University', courseId: 'CS 50300', title: 'Operating Systems', credits: 3, grade: 'A', termText: 'Fall 2023', slotLabel: 'Previous Master\u2019s Transcript', reason: 'not yet reviewed by the DGS', unlisted: true },
      { institution: 'Purdue University', courseId: 'CS 51400', title: 'Data & "Structures" <II>', credits: 1, grade: 'B+', termText: 'Fall 2024', slotLabel: 'Previous Master\u2019s Transcript', reason: 'transferability not yet decided', unlisted: false },
    ],
  });

  // A student may take the same course several times — a master's project or
  // thesis credit — and every attempt used to become its own paste-ready row,
  // which is how the sheet collected duplicates that shadow each other (DGS
  // 2026-09-09, seeing eight duplicated pairs in the live tab).
  it('the paste-ready rows are one per course, while the details keep every attempt', () => {
    const twice = buildCombinedReviewRequest({
      priorStudy: 'Completed prior M.S. or Ph.D.',
      nd: [
        { courseId: 'CSE 63900', title: 'Master Project', credits: 3, grade: 'S', termText: 'Fall 2026', reason: 'not in the course rules yet', unlisted: true },
        { courseId: 'CSE 63900', title: 'Master Project', credits: 3, grade: 'S', termText: 'Spring 2027', reason: 'not in the course rules yet', unlisted: true },
      ],
      external: [
        // The sheet matches ids without spaces and hyphens, so these are one
        // course and must not become two rows.
        { institution: 'Purdue University', courseId: 'CS 59800', title: 'Thesis', credits: 3, grade: 'A', termText: 'Fall 2023', reason: 'not yet reviewed by the DGS', unlisted: true },
        { institution: 'PURDUE UNIVERSITY', courseId: 'CS-59800', title: 'Thesis', credits: 3, grade: 'A', termText: 'Spring 2024', reason: 'not yet reviewed by the DGS', unlisted: true },
      ],
    });
    // Between one table's heading and the next: the paste-ready rows alone.
    const between = (from: string, to: string): string => twice.text.slice(twice.text.indexOf(from) + from.length, twice.text.indexOf(to));
    const coursesTab = between('rules sheet — Courses tab:', 'rules sheet — ExternalCourses tab:');
    const externalTab = between('rules sheet — ExternalCourses tab:', 'Course details:');
    assert.equal((coursesTab.match(/CSE 63900/g) ?? []).length, 1, 'one Courses-tab row for the repeated course: ' + coursesTab);
    assert.equal((externalTab.match(/CS[- ]59800/g) ?? []).length, 1, 'one ExternalCourses row, whichever way the id is spaced: ' + externalTab);
    assert.match(twice.text, /one row per course — a course taken more than once is listed once here/);
    // The details are the evidence: both terms are still there.
    assert.match(twice.text, /Fall 2026/);
    assert.match(twice.text, /Spring 2027/);
    assert.match(twice.text, /Fall 2023/);
    assert.match(twice.text, /Spring 2024/);
  });

  it('says nothing about repeats when there are none', () => {
    assert.doesNotMatch(built.text, /one row per course/);
  });

  it('is one email to the DGS (2026-09-06: not the Grad Admin), says self-check (not audit), and carries prior graduate study', () => {
    assert.match(built.text, /^Subject: Course review request/);
    assert.match(built.text, /Dear DGS,\n/);
    assert.doesNotMatch(built.text, /Grad Admin/);
    assert.match(built.text, /Prior graduate study: Completed prior M\.S\. or Ph\.D\./);
    assert.match(built.text, /\nMy transcripts are attached\.\n/);
    assert.ok(!built.text.includes('audit'), 'the request says self-check, never audit');
    // The human half (sign-off included) sits ABOVE one line; everything
    // machine-readable is below it, marked exactly once.
    assert.equal(built.text.match(/DO NOT MODIFY/g)?.length, 1);
    // The student's half is marked editable right above the divider (2026-09-06).
    assert.match(built.text, /Thank you!\n\n\(You may edit anything above this line\)\n-{10,}\n\(DO NOT MODIFY ANYTHING BELOW THIS LINE\)/);
    assert.ok(built.text.indexOf('(DO NOT MODIFY') < built.text.indexOf('Courses tab'), 'the line precedes the tables');
  });

  it('text flavor: one table per sheet tab, rows only for unlisted courses', () => {
    const { text } = built;
    assert.match(text, /Rows for the rules sheet \u2014 Courses tab:/u);
    assert.match(text, /Rows for the rules sheet \u2014 ExternalCourses tab:/u);
    assert.ok(text.includes('MATH 60610\tReal Analysis I'), 'Courses-tab row');
    assert.ok(text.includes('Purdue University\tCS 50300\tOperating Systems'), 'ExternalCourses-tab row, university as the record spells it (2026-09-06, late evening: no upper-casing)');
    assert.ok(!text.includes('CSE 40567\t'), 'sheet-listed ND course gets no new row');
    assert.ok(!text.includes('\tCS 51400'), 'ruled-but-undecided external course gets no new row');
  });

  it('details: one table per transcript in HTML (2026-09-06); in plain text one block per course (DGS 2026-10-30)', () => {
    const { text } = built;
    assert.match(text, /Course details:/);
    // A plain-text email keeps this flavour: "a | b | c" rows wrapped into one
    // unreadable run, so each course is a block — its facts on one line, each
    // long cell on its own. A caller that passes no `ask` has no decide line.
    assert.match(text, /Notre Dame:\n- MATH 60610 Real Analysis I\n {3}Credits: 3 · Grade: A · Term: Fall 2026\n {3}Why: not in the course rules yet\n/);
    assert.match(text, /Previous Master’s Transcript — Purdue University:\n- CS 50300 Operating Systems\n {3}Credits: 3 · Grade: A · Term: Fall 2023\n {3}Why: not yet reviewed by the DGS/u);
    assert.match(text, /- CSE 40567\n {3}Credits: 3 · Grade: B · Term: Fall 2026\n {3}Why: needs advisor \+ DGS approval/u);
    assert.match(text, /- CS 51400 .*\n {3}Credits: 1 · Grade: B\+ · Term: Fall 2024\n {3}Why: transferability not yet decided/u);
    assert.doesNotMatch(text, / \| /, 'no pipe rows');
  });

  it('html flavor: real tables (tabs do not survive HTML email), entities escaped, one details table per transcript', () => {
    const { html } = built;
    assert.equal((html.match(/<table/g) ?? []).length, 4, 'one table per sheet tab + one per transcript in the details');
    assert.ok(html.includes('<p><strong>(You may edit anything above this line)</strong></p><hr><p><strong>(DO NOT MODIFY ANYTHING BELOW THIS LINE)</strong></p>'), 'both markers around the line in HTML');
    assert.ok(html.includes('<tr><td>MATH 60610</td><td>Real Analysis I</td></tr>'));
    assert.ok(html.includes('<tr><td>Purdue University</td><td>CS 50300</td><td>Operating Systems</td></tr>'));
    assert.ok(html.includes('<p><strong>Notre Dame:</strong></p><table'));
    assert.ok(html.includes('<tr><th>Course</th><th>Title</th><th>Credits</th><th>Grade</th><th>Term</th><th>Please decide</th><th>Why</th></tr>'));
    assert.ok(html.includes('<tr><td>CSE 40567</td><td></td><td>3</td><td>B</td><td>Fall 2026</td><td></td><td>needs advisor + DGS approval per the course rules</td></tr>'));
    assert.ok(html.includes('Data &amp; &quot;Structures&quot; &lt;II&gt;'), 'titles are HTML-escaped');
    assert.ok(!html.includes('<II>'), 'no raw markup leaks from titles');
  });

  it('the same skeleton as the other emails (DGS 2026-09-28): the student line, the programs in the subject, and a numbered action list split by whether a reply is needed', () => {
    const r = buildCombinedReviewRequest({
      priorStudy: 'No prior graduate degree',
      history: { compact: 'Ph.D. (transferred Spring 2025 from the Notre Dame MSCSE, entered Fall 2023)', earlier: '' },
      nd: [
        { courseId: 'MATH 60610', title: 'Real Analysis I', credits: 3, grade: 'A', termText: 'Fall 2026', reason: 'not in the course rules yet; a course from outside CSE also needs your advisor’s approval (§4.2)', unlisted: true, ask: { needsRow: true, replyNeeded: false, decide: ['counts toward the Ph.D.: yes / no / case by case', 'core area (§4.4.1), if any'] } },
        { courseId: 'CSE 40567', credits: 3, grade: 'B', termText: 'Fall 2026', reason: 'needs advisor + DGS approval per the course rules', unlisted: false, ask: { needsRow: false, replyNeeded: true, decide: ['approve it for me (the allowance for courses below the 60000 level)'] } },
      ],
      external: [
        { institution: 'Purdue University', courseId: 'STAT 51200', title: 'Applied Regression Analysis', credits: 3, grade: 'A', termText: 'Fall 2023', slotLabel: 'Previous Master’s', reason: 'listed as case by case — needs the DGS’s approval for you (§5.2)', unlisted: false, ask: { needsRow: false, replyNeeded: true, decide: ['approve the transfer for me — the course rules say case by case (§5.2)'] } },
        { institution: 'Purdue University', courseId: 'CS 51400', title: 'Data Structures II', credits: 1, grade: 'B+', termText: 'Fall 2024', slotLabel: 'Previous Master’s', reason: 'listed in the course rules, decision still open (§5.2)', unlisted: false, ask: { needsRow: false, replyNeeded: false, decide: ['transferable to the Ph.D. (§5.2): yes / no / case by case — the row is blank'] } },
      ],
    });
    assert.equal(r.subject, 'Course review request (degree self-check) — Ph.D. (transferred Spring 2025 from the Notre Dame MSCSE, entered Fall 2023)');
    assert.match(r.text, /^Subject: [^\n]+\n\nDear DGS,\n\nStudent: \[your name, netID and NDID\]\n\nCould you review/);
    assert.match(
      r.text,
      /\nACTION REQUESTED\nA\. Please enter or complete these in the course rules — no reply needed; the self-check reads the rules the next time I open it:\n1\. MATH 60610 Real Analysis I \(Notre Dame, Fall 2026\) — new row: counts toward the Ph\.D\.: yes \/ no \/ case by case; core area \(§4\.4\.1\), if any\n2\. CS 51400 Data Structures II \(Purdue University, Fall 2024\) — complete the row: transferable to the Ph\.D\. \(§5\.2\): yes \/ no \/ case by case — the row is blank\nB\. Please decide these for me — a reply is needed:\n3\. CSE 40567 \(Notre Dame, Fall 2026\) — approve it for me \(the allowance for courses below the 60000 level\)\n4\. STAT 51200 Applied Regression Analysis \(Purdue University, Fall 2023\) — approve the transfer for me — the course rules say case by case \(§5\.2\)\n\nThank you!\n/,
    );
    // The student is writing: the engine's "your advisor" reads "my advisor" here.
    assert.match(r.text, /\n {3}Why: not in the course rules yet; a course from outside CSE also needs my advisor’s approval \(§4\.2\)\n/);
    assert.doesNotMatch(r.text, /your advisor/);
    assert.match(r.html, /<p>Dear DGS,<\/p><p>Student: <strong>\[your name, netID and NDID\]<\/strong><\/p>/);
    assert.match(r.html, /<p><strong>Action requested<\/strong><\/p><p>A\. Please enter or complete[^<]*<\/p><ol start="1"><li>MATH 60610 Real Analysis I/);
    assert.match(r.html, /<p>B\. Please decide these for me — a reply is needed:<\/p><ol start="3"><li>CSE 40567/);
    // The earlier programs, when there are any, sit in the standing lines.
    const withEarlier = buildCombinedReviewRequest({ priorStudy: 'No prior graduate degree', nd: [], external: [], history: { compact: 'Ph.D., entered Fall 2025; B.S. at Notre Dame CSE, awarded Spring 2025', earlier: 'Earlier Notre Dame programs: B.S. at Notre Dame CSE, awarded Spring 2025.' } });
    assert.match(withEarlier.text, /\nEarlier Notre Dame programs: B\.S\. at Notre Dame CSE, awarded Spring 2025\.\nPrior graduate study: No prior graduate degree\.\n/);
    assert.doesNotMatch(withEarlier.text, /ACTION REQUESTED/, 'no items, no list');
  });

  it('a section with no unlisted rows disappears entirely', () => {
    const only = buildCombinedReviewRequest({
      priorStudy: 'No prior graduate degree',
      nd: [{ courseId: 'CSE 40567', credits: 3, grade: 'B', termText: 'Fall 2026', reason: 'needs advisor + DGS approval per the course rules', unlisted: false }],
      external: [],
    });
    assert.equal((only.html.match(/<table/g) ?? []).length, 1, 'only the details table remains');
    assert.ok(!only.text.includes('rules sheet \u2014 Courses tab'));
    assert.ok(!only.text.includes('rules sheet \u2014 ExternalCourses tab'));
  });
});

describe('what a DGS ruling changes in the engine', () => {
  it('confirmed core area → the §4.4.1 row is MET, not needs-review', () => {
    const report = audit(student([{ courseId: 'CS 50300' }]), rules, '2026-09-01');
    const os = report.requirements.find((r) => r.id === 'phd.qualifier.core.os');
    assert.equal(os?.status, 'met');
    assert.match(os?.detail ?? '', /confirmed in the DGS’s course rules/);
  });

  it("a Bachelor's-level course earns no credit but still satisfies core knowledge", () => {
    const report = audit(student([{ courseId: 'CS 50300', degreeLevel: 'bachelors' }]), rules, '2026-09-01');
    const os = report.requirements.find((r) => r.id === 'phd.qualifier.core.os');
    const transfer = report.requirements.find((r) => r.id === 'phd.transfer');
    assert.equal(os?.status, 'met');
    // Undergraduate courses are invisible to the transfer card (2026-09-04) —
    // with nothing else entered it reads as if no transfer courses exist.
    assert.equal(transfer?.status, 'not_applicable');
    assert.match(transfer?.detail ?? '', /No transfer courses entered/);
    // The per-course line (DGS 2026-09-29): a red credit line — no transfer
    // credit, with its reason (the student's status, not the course's level,
    // DGS 2026-09-07) — and the core area the DGS confirmed on the qualifier
    // line alone, green. Until then the core clause led a green credit line
    // and, since 2026-09-28, showed a second time on the qualifier line.
    const line = report.courseLines.find((l) => l.courseId === 'CS 50300');
    assert.equal(line?.text, 'not counted — taken as an undergraduate (§5.2)');
    assert.equal(line?.mark, 'excluded');
    assert.equal(line?.qualifier?.text, 'satisfies the Operating Systems core-knowledge requirement (§4.4.1) — confirmed by the DGS');
    assert.equal(line?.qualifier?.mark, 'counts');
  });

  it('transferable=no → not counted, with the DGS ruling named', () => {
    const { classified } = classify(student([{ courseId: 'CS 59000' }]), rules);
    // The message quotes the university as the sheet spells it (capital English).
    assert.match(classified[0]?.ineligibleReason ?? '', /decided this Purdue University course does not transfer/);
  });

  it('transferable=yes → counted outright, with the processing note on its line; no tick and never "pending DGS review" (DGS 2026-09-27; until then provisional until processed)', () => {
    const { classified } = classify(student([{ courseId: 'CS 50300' }]), rules);
    assert.equal(classified[0]?.tier, 'definite');
    assert.equal(classified[0]?.approvalPending, undefined);
    assert.match(classified[0]?.approvedNote ?? '', /^approved by the DGS in the course rules/);
    const l = audit(student([{ courseId: 'CS 50300' }]), rules, '2026-09-01').courseLines.find((c) => c.courseId === 'CS 50300')!;
    // Since 2026-10-03 the line also says WHEN the Graduate School takes the request (§5.2: after the first semester, before the conferral semester).
    assert.ok(l.text.startsWith('counts toward regular courses (3 cr); approved by the DGS in the course rules — send the Grad Admin the processing request '), l.text);
    assert.match(l.text, /\(§5\.2\)/);
    // The core area is the line's second, qualifier line since 2026-09-27.
    assert.equal(l.qualifier?.text, 'satisfies the Operating Systems core-knowledge requirement (§4.4.1) — confirmed by the DGS', 'the fixture row also confirms a core area');
    assert.equal(l.qualifier?.mark, 'counts');
    assert.doesNotMatch(l.text, /pending DGS review|once approved|transfer credit \(§5\.2\);/);
    assert.equal(l.mark, 'counts', 'green: the sheet’s yes needs no tick (2026-09-27)');
    const report = audit(student([{ courseId: 'CS 50300' }]), rules, '2026-09-01');
    const transfer = report.requirements.find((r) => r.id === 'phd.transfer');
    // Since 2026-10-03 the row is final only once the Graduate School has approved
    // the transfer and the Grad Admin recorded it (§5.2, criterion 5) — until then
    // "Graduate School approval pending", with nothing left for the DGS to decide.
    assert.equal(transfer?.status, 'in_progress', 'a yes counts outright (2026-09-27); the Graduate School’s approval is what is still open (2026-10-03)');
    assert.equal(transfer?.statusLabel, 'Graduate School approval pending');
    // The course list is the fact; the processing instruction is a note behind the card's Details (2026-10-03).
    assert.match(transfer?.detail ?? '', /Approved by the DGS in the course rules: CS 50300\. Send the Grad Admin the processing request/);
    const recorded = audit({ ...student([{ courseId: 'CS 50300' }]), attestations: { transferRecorded: true } }, rules, '2026-09-01');
    assert.equal(recorded.requirements.find((r) => r.id === 'phd.transfer')?.status, 'met', 'ticked “the Graduate School approved my transfer credit” → met');
    assert.doesNotMatch(transfer?.detail ?? '', /Not yet reviewed/);
    // An unreviewed course alongside keeps the card on "Needs DGS review".
    const mixed = audit(student([{ courseId: 'CS 50300' }, { courseId: 'CS 59900', title: 'Special Topics', term: { season: 'spring', year: 2025 } }]), rules, '2026-09-01');
    assert.equal(mixed.requirements.find((r) => r.id === 'phd.transfer')?.status, 'needs_dgs_review');
  });

  // The DGS's third value (2026-09-08): a course outside the usual CSE ground
  // that can still transfer when it serves the student's dissertation. It is a
  // decision about the COURSE and an open question about the STUDENT, so it
  // behaves like a candidate everywhere — never pre-approved, never processed
  // by the Grad Admin without the DGS's ruling — but says why.
  it('transferable=dgs_approval → a candidate, stated plainly and never explained at the student', () => {
    const one = [{ courseId: 'STAT 51200', title: 'Applied Regression Analysis', term: { season: 'fall' as const, year: 2024 } }];
    const { classified } = classify(student(one), rules);
    assert.equal(classified[0]?.tier, 'provisional');
    assert.match(classified[0]?.approvalPending ?? '', /^waiting for the DGS — this course needs the DGS’s approval, decided case by case \(§5\.2\)/);
    // The rule is EXPLAINED once, in the review card (DGS 2026-09-08); every
    // other surface states the fact and stops. No second person here either:
    // this string is copied verbatim into the advisor e-mail, which re-voices
    // only the requirement details. And no claim about the course's subject —
    // a case-by-case course may have a confirmed §4.4.1 core area beside it.
    assert.doesNotMatch(classified[0]?.approvalPending ?? '', /\byour\b|research|outside the usual CSE ground/i);
    assert.doesNotMatch(classified[0]?.approvalPending ?? '', /^approved by the DGS/);
    assert.equal(classified[0]?.ineligibleReason, undefined, 'it is not ruled out — it can still transfer');

    const report = audit(student(one), rules, '2026-09-01');
    const line = report.courseLines.find((c) => c.courseId === 'STAT 51200')!;
    assert.ok(line.text.startsWith('waiting for the DGS — would count'), line.text);
    assert.doesNotMatch(line.text, /case by case|research/, 'the course line is not where the rule is explained: ' + line.text);
    assert.equal(line.mark, 'pending');

    const transfer = report.requirements.find((r) => r.id === 'phd.transfer');
    assert.equal(transfer?.status, 'needs_dgs_review', 'the DGS still has this student’s case to decide');
    assert.match(transfer?.detail ?? '', /Waiting for the DGS’s approval, decided case by case: STAT 51200\./);
    assert.doesNotMatch(transfer?.detail ?? '', /research/, 'nor the transfer card');
    assert.doesNotMatch(transfer?.detail ?? '', /Pre-approved by the DGS/);
    assert.doesNotMatch(transfer?.detail ?? '', /Waiting for the DGS: /, 'the DGS HAS reviewed the course — what is open is the student’s case');

    // Who is asked to act. The advisor summary routes by the WORDING of the
    // pending reason, not by the sheet value, so a reworded string could
    // silently send this course to the Grad Admin — it must not.
    // Nothing anywhere asks the student to make the case for the course: that
    // is between the advisor and the DGS (2026-09-08).
    for (const text of [line.text, transfer?.detail ?? '', classified[0]?.approvalPending ?? '']) {
      assert.doesNotMatch(text, /research|say how/i, text);
    }
    const todo = actionItems(report);
    assert.ok(todo.dgs.some((t) => t.includes('STAT 51200')), JSON.stringify(todo.dgs));
    assert.ok(!todo.gradAdmin.some((t) => t.includes('STAT 51200')), JSON.stringify(todo.gradAdmin));
    assert.ok(todo.student.some((t) => /Send the DGS the review request/.test(t) && t.includes('STAT 51200')), JSON.stringify(todo.student));
    // And the approvals row files it under the DGS, not the Grad Admin.
    const approvals = report.requirements.find((r) => r.id === 'shared.approvals');
    assert.equal(approvals?.status, 'needs_dgs_review');
    const lead = (approvals?.detailParts ?? []).find(
      (pt) => typeof pt !== 'string' && 'items' in pt && pt.items.some((i) => i.startsWith('STAT 51200')),
    );
    assert.match(typeof lead === 'object' && 'lead' in lead ? lead.lead : '', /The DGS has still to decide these/);
  });

  it('transferable undecided vs not reviewed at all — different pending messages', () => {
    const undecided = classify(student([{ courseId: 'IFT-2125', institution: 'Université de Montréal', term: { season: 'fall', year: 2024 } }]), rules);
    assert.match(undecided.classified[0]?.approvalPending ?? '', /decision still open/);
    // The transfer card names all four kinds of pending course; a listed row
    // with a blank cell used to be the one it left silent (2026-09-08).
    const listed = audit(student([{ courseId: 'IFT-2125', institution: 'Université de Montréal', term: { season: 'fall', year: 2024 } }]), rules, '2026-09-01');
    assert.match(
      listed.requirements.find((r) => r.id === 'phd.transfer')?.detail ?? '',
      /Listed in the course rules, decision still open: IFT-2125\./,
    );
    const unreviewed = classify(student([{ courseId: 'CS 77777' }]), rules);
    assert.match(unreviewed.classified[0]?.approvalPending ?? '', /not in the course rules yet/);
    const report = audit(student([{ courseId: 'CS 77777' }]), rules, '2026-09-01');
    const transfer = report.requirements.find((r) => r.id === 'phd.transfer');
    assert.match(transfer?.detail ?? '', /Waiting for the DGS: CS 77777/);
  });

  it('nd_credits (pro-rata, §5.2) is what counts — not the transcript credits', () => {
    const s = student([{ courseId: '30240233', institution: 'Tsinghua University', credits: 4 }]);
    s.attestations.transferApproved = true;
    const report = audit(s, rules, '2026-09-01');
    const transfer = report.requirements.find((r) => r.id === 'phd.transfer');
    assert.match(transfer?.detail ?? '', /2\.5 of the 24 credits you may transfer are counted/);
    const line = report.courseLines.find((l) => l.courseId === '30240233');
    assert.match(line?.text ?? '', /counted as 2\.5 ND credits/);
  });

  it('the app still runs with no ExternalCourses tab at all — everything degrades to unreviewed', () => {
    const bare = buildRules({ external: [] });
    assert.equal(bare.external.length, 0);
    const report = audit(student([{ courseId: 'CS 50300' }]), bare, '2026-09-01');
    const os = report.requirements.find((r) => r.id === 'phd.qualifier.core.os');
    assert.equal(os?.status, 'unmet'); // nothing claimed, nothing confirmed
  });
});

// §5.2 criterion 2 — "the student had graduate student status when they took
// these courses" (DGS 2026-09-06: graduate-level courses taken before the
// bachelor's degree do not count). The award term is Student.bachelorsAwarded.
describe('graduate student status — §5.2 criterion 2 (DGS 2026-09-06)', () => {
  const withBachelors = (courses: Partial<CourseEntry>[], awarded: Student['bachelorsAwarded'] = { season: 'spring', year: 2024 }): Student => ({
    ...student(courses),
    bachelorsAwarded: awarded,
  });
  const line = (s: Student, courseId: string) => audit(s, rules, '2026-09-01').courseLines.find((l) => l.courseId === courseId);

  it('a course dated in or before the award term earns no transfer credit; an unknown award term changes nothing', () => {
    const before = classify(withBachelors([{ courseId: 'CS 51000', title: 'Algorithms', term: { season: 'fall', year: 2023 } }]), rules).classified[0]!;
    assert.equal(before.pool, 'none');
    assert.match(before.ineligibleReason ?? '', /^not counted — taken before your bachelor’s degree was awarded \(Spring 2024\), so not as a graduate student \(§5\.2\); may still satisfy the Algorithms/);
    const inTerm = classify(withBachelors([{ courseId: 'CS 52300', title: 'Compilers', term: { season: 'spring', year: 2024 } }]), rules).classified[0]!;
    assert.match(inTerm.ineligibleReason ?? '', /taken in the term your bachelor’s degree was awarded/);
    const after = classify(withBachelors([{ courseId: 'CS 52300', title: 'Compilers', term: { season: 'summer', year: 2024 } }]), rules).classified[0]!;
    assert.equal(after.pool, 'regular');
    const unknown = classify(student([{ courseId: 'CS 51000', title: 'Algorithms', term: { season: 'fall', year: 2023 } }]), rules).classified[0]!;
    assert.equal(unknown.pool, 'regular', 'no award term → degreeLevel decides, as before');
  });

  it('the award term is absolute: a transferable=yes ruling does not restore a pre-bachelor’s course (DGS, later 2026-09-06), its core note stays', () => {
    const ruled = classify(withBachelors([{ courseId: 'CS 50300', title: 'Operating Systems', term: { season: 'fall', year: 2023 } }]), rules).classified[0]!;
    assert.equal(ruled.pool, 'none');
    assert.match(ruled.ineligibleReason ?? '', /^not counted — taken before your bachelor’s degree was awarded \(Spring 2024\)/);
    assert.match(ruled.ineligibleReason ?? '', /satisfies the Operating Systems core-knowledge requirement \(§4\.4\.1\) — confirmed by the DGS/);
    const after = classify(withBachelors([{ courseId: 'CS 50300', title: 'Operating Systems', term: { season: 'fall', year: 2024 } }]), rules).classified[0]!;
    assert.equal(after.pool, 'regular', 'after the award the ruling applies as before');
    assert.equal(after.approvalPending, undefined, 'a yes counts outright (2026-09-27)');
    assert.match(after.approvedNote ?? '', /^approved by the DGS/);
  });

  // 2026-09-11: a line that says "not counted" is never green, whatever core
  // area it also earns — that fact has its own §4.4.1 row. Keyword titles stay
  // amber (a review could still confirm them).
  it('a Notre Dame course taken in the program gets its qualifier line from the rows it feeds (DGS 2026-09-28)', () => {
    const s = student([]);
    s.courses = [{ courseId: 'CSE 60321', title: 'Advanced Computer Architecture', credits: 3, term: { season: 'fall', year: 2026 }, grade: 'A', origin: 'nd' }, { courseId: 'CSE 60641', title: 'Graduate Operating Systems', credits: 3, term: { season: 'fall', year: 2026 }, grade: 'IP', origin: 'nd' }];
    const report = audit(s, rules, '2026-11-01');
    const arch = report.courseLines.find((l) => l.courseId === 'CSE 60321')!;
    assert.equal(arch.text, 'counts toward regular courses (3 cr)');
    assert.equal(arch.qualifier?.mark, 'counts');
    assert.match(arch.qualifier?.text ?? '', /^Computer Architecture core knowledge \(§4\.4\.1\)/);
    const os = report.courseLines.find((l) => l.courseId === 'CSE 60641')!;
    assert.equal(os.qualifier?.mark, 'in_progress', 'blue while the course is in progress');
    assert.match(os.qualifier?.text ?? '', /Operating Systems core knowledge/);
  });
  it('an undergraduate course from another university: the credit line is the cross, the core area the qualifier line — once (DGS 2026-09-29)', () => {
    const s = student([{ courseId: 'CS 50300', title: 'Operating Systems', degreeLevel: 'bachelors', term: { season: 'spring', year: 2023 } }]);
    const rep = audit(s, rules, '2026-09-01');
    const l = rep.courseLines.find((c) => c.courseId === 'CS 50300')!;
    assert.equal(l.text, 'not counted — taken as an undergraduate (§5.2)');
    assert.equal(l.mark, 'excluded');
    assert.equal(l.qualifier?.text, 'satisfies the Operating Systems core-knowledge requirement (§4.4.1) — confirmed by the DGS');
    assert.equal(l.qualifier?.mark, 'counts');
    assert.equal((`${l.text} ${l.qualifier?.text}`.match(/core-knowledge/g) ?? []).length, 1, 'the core area is said once');
    assert.equal(rep.requirements.find((r) => r.id === 'phd.qualifier.core.os')?.status, 'met', 'the §4.4.1 card still reads Met from it');
    // A keyword title with no ruling yet: the cross stays, the qualifier line is amber and asks for the review.
    const kw = audit(student([{ courseId: 'CS 25100', title: 'Algorithms', degreeLevel: 'bachelors', term: { season: 'spring', year: 2023 } }]), rules, '2026-09-01').courseLines.find((c) => c.courseId === 'CS 25100')!;
    assert.equal(kw.text, 'not counted — taken as an undergraduate (§5.2)');
    assert.equal(kw.mark, 'excluded');
    assert.equal(kw.qualifier?.text, 'may still satisfy the Algorithms core-knowledge requirement (§4.4.1) once the DGS reviews it');
    assert.equal(kw.qualifier?.mark, 'pending');
    // No core-sounding title, no ruling: one red line that says so.
    const plain = audit(student([{ courseId: 'CS 18000', title: 'Problem Solving', degreeLevel: 'bachelors', term: { season: 'spring', year: 2023 } }]), rules, '2026-09-01').courseLines.find((c) => c.courseId === 'CS 18000')!;
    assert.equal(plain.text, 'not counted — taken as an undergraduate (§5.2); not relevant to the core knowledge requirement (§4.4.1)');
    assert.equal(plain.mark, 'excluded');
    assert.equal(plain.qualifier, undefined);
  });

  it('marks: a "not counted" credit line is red; the core area is a qualifier line with its own mark — green when confirmed, amber for a keyword title (DGS 2026-09-27)', () => {
    const confirmed = line(withBachelors([{ courseId: 'IFT-2125', title: 'Introduction à l’algorithmique', institution: 'Université de Montréal', term: { season: 'fall', year: 2023 } }]), 'IFT-2125')!;
    assert.match(confirmed.text, /^not counted — taken before/);
    assert.doesNotMatch(confirmed.text, /core-knowledge/);
    assert.equal(confirmed.mark, 'excluded');
    assert.match(confirmed.qualifier?.text ?? '', /^satisfies the Algorithms core-knowledge requirement \(§4\.4\.1\) — confirmed by the DGS$/);
    assert.equal(confirmed.qualifier?.mark, 'counts');
    const keyword = line(withBachelors([{ courseId: 'CS 51000', title: 'Algorithms', term: { season: 'fall', year: 2023 } }]), 'CS 51000')!;
    assert.equal(keyword.mark, 'excluded');
    assert.match(keyword.qualifier?.text ?? '', /^may still satisfy the Algorithms core-knowledge requirement \(§4\.4\.1\) after DGS review$/);
    assert.equal(keyword.qualifier?.mark, 'pending');
    const plain = line(withBachelors([{ courseId: 'CS 52300', title: 'Compilers', term: { season: 'fall', year: 2023 } }]), 'CS 52300')!;
    assert.equal(plain.mark, 'excluded');
    assert.equal(plain.qualifier, undefined);
  });

  it('an award term that is not before the entry term is warned about', () => {
    const report = audit(withBachelors([], { season: 'fall', year: 2026 }), rules, '2026-09-01');
    assert.ok(report.warnings.some((w) => /not before your entry term \(Fall 2026\)/.test(w)), JSON.stringify(report.warnings));
  });
});

// Who still has to act (DGS 2026-09-07). The row used to say "Needs DGS
// review" whenever anything was outstanding — even when every course was
// pre-approved and only the Grad Admin had work left, or when the only gap
// was the advisor's plan-of-study approval.
describe('the sign-off row names who must act (2026-09-07)', () => {
  const withPlanApproved = (courses: Partial<CourseEntry>[]): Student => {
    const s = student(courses);
    s.attestations.advisorApprovedPlan = true; // isolate the course routing
    return s;
  };
  const approvals = (s: Student) => audit(s, rules, '2026-09-01').requirements.find((r) => r.id === 'shared.approvals')!;

  it('routes every reason string allocate.ts writes', () => {
    // A decided transfer carries no pending reason (P3-emails-1): no Grad Admin route here.
    assert.deepEqual(signOffActors('also counts toward your other degree — the Graduate School must approve your dual-degree plan of study (DGS Handbook §2.9)'), ['graduateSchool']);
    assert.deepEqual(signOffActors('transfer — not yet reviewed by the DGS; needs DGS + Graduate School approval (§5.2)'), ['dgs']);
    assert.deepEqual(signOffActors('waiting for the DGS — listed in the course rules, decision still open (§5.2)'), ['dgs']);
    assert.deepEqual(signOffActors('not in the course rules — counted provisionally; needs DGS review'), ['dgs']);
    assert.deepEqual(signOffActors('the course rules do not say whether it counts — needs DGS review'), ['dgs']);
    // Both people, so the course is listed under both.
    assert.deepEqual(signOffActors('non-CSE course — needs advisor + DGS approval (§3.2/§4.2)'), ['advisor', 'dgs']);
    assert.deepEqual(signOffActors('needs advisor + DGS approval per the course rules'), ['advisor', 'dgs']);
    assert.deepEqual(signOffActors('wording nobody anticipated'), ['dgs'], 'an unrecognised reason falls back to the DGS');
  });

  it('a course the sheet says yes to waits on no one here (2026-09-27) — the processing request carries it to the Grad Admin', () => {
    const row = approvals(withPlanApproved([{ courseId: 'CS 50300' }]));
    assert.equal(row.title, 'Courses still to be approved or processed');
    assert.equal(row.status, 'not_applicable', 'nothing is left for the DGS to decide, and nothing waits on an approval');
    assert.doesNotMatch(row.detail ?? '', /The DGS has still to decide/);
  });

  it('one unreviewed course puts the DGS back in the picture, under its own heading', () => {
    const row = approvals(withPlanApproved([{ courseId: 'CS 50300' }, { courseId: 'CS 59900', title: 'Special Topics', term: { season: 'spring', year: 2025 } }]));
    assert.equal(row.status, 'needs_dgs_review');
    assert.match(row.detail ?? '', /The DGS has still to decide these — send the review request: CS 59900/);
    assert.doesNotMatch(row.detail ?? '', /CS 50300/, 'the yes course is settled (2026-09-27)');
  });

  it('an unticked plan of study alone is the advisor’s, not a DGS review', () => {
    const s = student([{ courseId: 'CS 50300' }]); // the course itself is settled by the sheet's yes (2026-09-27)
    const row = approvals(s);
    assert.equal(row.status, 'in_progress');
    assert.match(row.detail ?? '', /advisor approved your coursework/);
    assert.doesNotMatch(row.detail ?? '', /The DGS has still to decide/);
  });

  // Regression (2026-09-07): splitting the row into per-actor groups made a
  // course that needs BOTH the advisor and the DGS appear in two groups, and
  // the summary the student emails named it twice in one sentence.
  it('a course needing two people is named once — on screen and in the emailed summary', () => {
    const s: Student = {
      ...student([]),
      courses: [{ courseId: 'MATH 60610', title: 'Real Analysis I', credits: 3, term: { season: 'fall', year: 2026 }, grade: 'A', origin: 'nd' } as CourseEntry],
    };
    const report = audit(s, rules, '2027-03-01');
    const row = report.requirements.find((r) => r.id === 'shared.approvals')!;
    assert.match(row.detail ?? '', /Your advisor and the DGS must both approve these — send the review request/);
    assert.equal((row.detail ?? '').split('MATH 60610').length - 1, 1, 'listed once on screen');
    assert.equal(row.status, 'needs_dgs_review', 'the DGS is one of the two');

    const built = advisorSummary(report, { todayIso: '2027-03-01', entryTerm: 'Fall 2026', priorStudy: 'Completed prior M.S. or Ph.D.', gpa: 3.5 });
    const line = built.text.split('\n').find((l) => /review request for/.test(l)) ?? '';
    assert.equal(line.split('MATH 60610').length - 1, 1, `named once in the emailed summary, got: ${line}`);
  });

  // A DGS ruling can answer §5.2 and leave §4.4.1 blank: the transfer is the
  // Grad Admin's to process, but the review request still asks about the core
  // area, so the row must not claim the DGS is finished (2026-09-07).
  it('a pre-approved transfer whose core area is undecided belongs to the DGS as well', () => {
    const half = buildRules({ external: [{ university: 'PURDUE UNIVERSITY', course_id: 'CS 51400', course_title: 'Numerical Algorithms', satisfies_core_area: '', transferable: 'yes' }] });
    const s = student([{ courseId: 'CS 51400', title: 'Numerical Algorithms', degreeLevel: 'masters' }]);
    s.attestations.advisorApprovedPlan = true;
    const row = audit(s, half, '2027-03-01').requirements.find((r) => r.id === 'shared.approvals')!;
    assert.equal(row.status, 'needs_dgs_review', 'the DGS still has the core area to record');
    // The transfer itself is settled by the sheet's yes (2026-09-27); what is left is the DGS's.
    assert.match(row.detail ?? '', /The DGS has still to decide these — send the review request: CS 51400 \(the DGS has still to record its core-knowledge area \(§4\.4\.1\)\)/);
    assert.equal((row.detail ?? '').split('CS 51400').length - 1, 1, 'listed once');
  });

  it('nothing outstanding: the row does not apply', () => {
    const s = student([{ courseId: 'CS 50300' }]);
    s.attestations.advisorApprovedPlan = true;
    const row = approvals(s);
    assert.equal(row.status, 'not_applicable');
    assert.equal(row.detail, 'No entered course that counts toward the degree is waiting on anyone.');
  });
});

// Quarter-system universities (DGS 2026-09-08). nd_credits can only hold one
// fixed number, which is useless for a course worth 2 credits one term and 4
// the next; credit_system converts whatever the student's transcript prints.
describe('credit_system: quarter hours become Notre Dame hours', () => {
  const usc = (courseId: string, credits: number): Student =>
    student([{ courseId, title: 'Analysis of Algorithms', credits, institution: 'University of Southern California', term: { season: 'fall', year: 2024 } }]);

  it('is set once per university in the Universities tab (DGS 2026-10-10), and rejects anything but quarter/trimester/semester/blank', () => {
    assert.equal(universityCreditSystem(rules.universityCreditSystems, 'University of Southern California'), 'quarter', 'matched as ExternalCourses matches names');
    assert.equal(universityCreditSystem(rules.universityCreditSystems, 'Purdue University'), undefined, 'not in the tab: the sheet has not said');
    assert.deepEqual(rules.issues.filter((i) => i.tab === 'Universities'), []);
    // `trimester` is a value since 2026-09-12 (red-team F6).
    assert.equal(parseUniversitiesTab('university,credit_system\nX UNIVERSITY,trimester\n', [])[0]?.creditSystem, 'trimester');
    const issues: SheetIssue[] = [];
    const parsed = parseUniversitiesTab('university,credit_system,notes\nX UNIVERSITY,fortnight,\n,quarter,\nY UNIVERSITY,,listed, system not decided\n', issues);
    assert.equal(parsed.length, 2, 'the row without a university is skipped; the others are kept');
    assert.equal(parsed[0]?.creditSystem, undefined, 'a bad value is ignored, the row is kept');
    assert.equal(parsed[1]?.creditSystem, undefined, 'blank = not said');
    assert.match(issues[0]?.message ?? '', /Universities row 2 \(X UNIVERSITY\): credit_system must be 'quarter', 'trimester', 'semester' or blank — got 'fortnight'/);
    assert.match(issues[1]?.message ?? '', /Universities row 3 has no university/);
  });

  it('a renamed or missing column is an error, an empty tab a warning, and a note row at the foot is skipped', () => {
    const renamed: SheetIssue[] = [];
    assert.deepEqual(parseUniversitiesTab('University,Credit System,Notes\nX UNIVERSITY,quarter,\n', renamed), []);
    assert.equal(renamed[0]?.severity, 'error');
    assert.match(renamed[0]?.message ?? '', /The Universities tab has no 'credit_system' column \(the header row names: university, credit system, notes\)\. No university's credit system can be read/);
    for (const text of ['', 'university,credit_system,notes\n']) {
      const issues: SheetIssue[] = [];
      parseUniversitiesTab(text, issues);
      assert.ok(issues.some((i) => /The Universities tab (has no rows|has no 'university' column)/.test(i.message)), JSON.stringify(issues));
    }
    const noted: SheetIssue[] = [];
    const rows = parseUniversitiesTab(readFileSync(new URL('../data/universities.sample.csv', import.meta.url), 'utf8'), noted);
    assert.deepEqual(rows.map((r) => r.university), ['PURDUE UNIVERSITY', 'UNIVERSITY OF CALIFORNIA SAN DIEGO'], 'the sample’s closing sentence is a note, not a university');
    assert.deepEqual(noted, []);
    assert.equal(parseUniversitiesTab('university,credit_system\nSt. John’s University,\n', [])[0]?.university, 'St. John’s University', 'a listed university with no system yet is kept');
  });

  it('two rows for one university: the last wins, with a warning (the ExternalCourses rule)', () => {
    const issues: SheetIssue[] = [];
    const parsed = parseUniversitiesTab('university,credit_system\nX UNIVERSITY,semester\nx university,quarter\n', issues);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0]?.creditSystem, 'quarter');
    assert.match(issues[0]?.message ?? '', /Universities row 3 repeats x university \(already in row 2\) — the last row wins/);
    // …and the web pages show it (DGS 2026-10-12: "Let the last row win but
    // show a warning on the web pages").
    assert.equal(issues[0]?.severity, 'warning');
    assert.equal(issues[0]?.onPage, true);
  });

  it('with the Universities tab, the old ExternalCourses credit_system column is not read — and the sheet check says so', () => {
    const r = buildRules({
      external: [{ university: 'UNIVERSITY OF SOUTHERN CALIFORNIA', course_id: 'CSCI 570', transferable_PhD: 'yes', credit_system: 'semester' }],
      universities: [{ university: 'UNIVERSITY OF SOUTHERN CALIFORNIA', credit_system: 'quarter' }],
    });
    assert.equal(universityCreditSystem(r.universityCreditSystems, 'UNIVERSITY OF SOUTHERN CALIFORNIA'), 'quarter', 'the tab decides');
    const w = r.issues.find((i) => i.tab === 'ExternalCourses' && i.column === 'credit_system')!;
    assert.equal(w.severity, 'warning');
    assert.match(w.message, /The ExternalCourses credit_system column is no longer read \(DGS 2026-10-10\)/);
    assert.match(w.message, /1 row still has a value there — delete the column\. For UNIVERSITY OF SOUTHERN CALIFORNIA the column says something the Universities tab does not/);
  });

  it('a sheet or saved copy from before the Universities tab still converts from the old column', () => {
    const old = buildRules({
      external: [{ university: 'UNIVERSITY OF SOUTHERN CALIFORNIA', course_id: 'CSCI 570', transferable_PhD: 'yes', credit_system: 'quarter' }],
      universities: null,
    });
    assert.deepEqual(old.universities, []);
    assert.equal(universityCreditSystem(old.universityCreditSystems, 'University of Southern California'), 'quarter');
    assert.ok(Math.abs((classify(usc('CSCI 570', 4), old).classified[0]?.effectiveCredits ?? 0) - 4 * 0.66) < 1e-9);
    assert.deepEqual(old.issues.filter((i) => i.column === 'credit_system'), [], 'nothing to report: the column is still the source');
    // A bad old value is still reported on its row.
    const issues: SheetIssue[] = [];
    parseExternalTab('university,course_id,transferable,credit_system\nX UNIVERSITY,CS 1,yes,fortnight\n', CORE, issues);
    assert.match(issues[0]?.message ?? '', /credit_system must be 'quarter', 'trimester', 'semester' or blank/);
  });

  it('a university the sheet has set but not ruled on yet is still converted, and offered in the University boxes', () => {
    const r = buildRules({ universities: [{ university: 'UNIVERSITY OF CALIFORNIA, SAN DIEGO', credit_system: 'quarter' }] });
    const ucsd = student([{ courseId: 'CSE 250A', credits: 4, institution: 'University of California, San Diego', term: { season: 'fall', year: 2024 } }]);
    assert.ok(Math.abs((classify(ucsd, r).classified[0]?.effectiveCredits ?? 0) - 4 * 0.66) < 1e-9);
    assert.ok(knownUniversities(r.external, r.universities).includes('University of California, San Diego'));
  });

  it('converts the credits the transcript prints — the exact value, whatever the course is worth', () => {
    const four = classify(usc('CSCI 570', 4), rules).classified[0]!;
    // The factor is the Graduate School's — the DGS Handbook's §3.14 pro-rata
    // table, 0.66 — in code since 2026-10-04 (it was a sheet row from 2026-09-12).
    assert.ok(Math.abs((four.effectiveCredits ?? 0) - 4 * 0.66) < 1e-9);
    assert.equal(four.creditsConverted, true);
    assert.equal(four.conversionFactor, 0.66);
    // The same course at 2 credits in another term converts on its own terms —
    // the thing a fixed nd_credits could never do.
    assert.ok(Math.abs((classify(usc('CSCI 570', 2), rules).classified[0]?.effectiveCredits ?? 0) - 2 * 0.66) < 1e-9);
  });

  it('applies to every course from that university, listed in the tab or not', () => {
    const unlisted = classify(usc('CSCI 999', 4), rules).classified[0]!;
    assert.ok(Math.abs((unlisted.effectiveCredits ?? 0) - 4 * 0.66) < 1e-9, 'the university, not the row, carries the system');
  });

  it('a fixed nd_credits still wins over the conversion', () => {
    const tsinghua = student([{ courseId: '30240233', credits: 4, institution: 'Tsinghua University', term: { season: 'fall', year: 2024 } }]);
    const c = classify(tsinghua, rules).classified[0]!;
    assert.equal(c.effectiveCredits, 2.5, 'the DGS’s own figure for that course');
    assert.equal(c.creditsConverted, undefined);
  });

  it('a semester university is left alone', () => {
    const purdue = classify(student([{ courseId: 'CS 50300', credits: 3 }]), rules).classified[0]!;
    assert.equal(purdue.effectiveCredits, undefined, 'credits count as printed');
  });

  it('the student’s line says the credits were converted, and reads as a number', () => {
    const l = audit(usc('CSCI 570', 4), rules, '2026-09-01').courseLines.find((c) => c.courseId === 'CSCI 570')!;
    assert.match(l.text, /counted as 2\.64 ND credits converted from the quarter system at 0\.66 \(transcript shows 4; §5\.2\)/);
    assert.doesNotMatch(l.text, /2\.66666/);
  });

  it('the factors are the Graduate School’s, in code: a sheet row neither sets nor removes them (DGS 2026-10-04)', () => {
    assert.equal(QUARTER_CREDIT_FACTOR, 0.66);
    assert.equal(TRIMESTER_CREDIT_FACTOR, 0.88);
    // An old sheet that still carries the row, with another value: ignored, and the sheet check says why.
    const oldSheet = buildRules({ parameters: { quarter_credit_factor: '0.5' } });
    assert.ok(Math.abs((classify(usc('CSCI 570', 4), oldSheet).classified[0]?.effectiveCredits ?? 0) - 4 * 0.66) < 1e-9);
    const issue = oldSheet.issues.find((i) => /quarter_credit_factor/.test(i.message))!;
    assert.equal(issue.severity, 'warning');
    assert.match(issue.message, /'quarter_credit_factor' is no longer read — the quarter factor \(0\.66\) is the Graduate School’s — the DGS Handbook’s §3\.14 pro-rata table — and has lived in the code since 2026-10-04 \(README § A5b\)\. Changing the row changes nothing; delete it\./);
    // The current sheet has no row, and nothing is missing.
    assert.deepEqual(buildRules().issues.filter((i) => /credit_factor/.test(i.message)), []);
  });
});

// The review request asks for a university's credit system once, when the
// university first arrives (DGS 2026-10-10: the Universities tab).
describe('review request: a Universities-tab row for a university the sheet does not give a system for', () => {
  const course = (institution: string, courseId: string, creditSystem?: 'quarter' | 'trimester', chosen = false) => ({
    institution,
    courseId,
    title: 'Some Course',
    credits: 4,
    grade: 'A',
    termText: 'Fall 2024',
    slotLabel: 'Previous Master’s Transcript',
    reason: 'not in the course rules yet',
    unlisted: true,
    ...(creditSystem ? { creditSystem, ...(chosen ? { creditSystemChosen: true as const } : {}) } : {}),
  });
  const known = new Set(['UNIVERSITY OF SOUTHERN CALIFORNIA']);
  const listedBlank = new Set(['PRINCETON UNIVERSITY']);
  const build = (withCallback: boolean) =>
    buildCombinedReviewRequest({
      priorStudy: 'Master’s elsewhere',
      nd: [],
      external: [
        course('University of California, San Diego', 'CSE 250A', 'quarter'),
        course('University of California, San Diego', 'CSE 256'),
        course('Rice University', 'COMP 540'),
        course('UNIVERSITY OF SOUTHERN CALIFORNIA', 'CSCI 999'),
        course('UNIVERSITY OF NOTRE DAME', 'CSE 60641'),
        course('Princeton University', 'COS 521', 'trimester', true),
      ],
      ...(withCallback ? { universityRow: (u: string) => (known.has(u.toUpperCase()) ? ('set' as const) : listedBlank.has(u.toUpperCase()) ? ('blank' as const) : ('absent' as const)) } : {}),
    });

  it('one row per such university, prefilled with what the transcript reads; none for a known one or for Notre Dame', () => {
    const { text, html } = build(true);
    assert.match(text, /Rows for the rules sheet — Universities tab \(university, credit_system\):\n\nUniversity of California, San Diego\tquarter\nRice University\t\n/);
    assert.doesNotMatch(text.split('Universities tab')[1] ?? '', /SOUTHERN CALIFORNIA|NOTRE DAME/);
    assert.match(text, /University of California, San Diego — new row in the Universities tab: its credit system \(quarter, trimester or semester\); my transcript reads as quarter hours/);
    assert.match(text, /Rice University — new row in the Universities tab: its credit system \(quarter, trimester or semester\)\n/);
    assert.match(html, /<p>Rows for the rules sheet — Universities tab \(university, credit_system\):<\/p><table/);
  });

  it('a university listed with a blank system is asked to be completed, not added again; a system the student chose says so', () => {
    const { text } = build(true);
    assert.match(text, /Princeton University — complete its row in the Universities tab: credit_system \(quarter, trimester or semester\); I chose trimester hours when importing/);
    const table = (text.split('Universities tab (university, credit_system):')[1] ?? '').split('Course details:')[0] ?? '';
    assert.doesNotMatch(table, /Princeton/, 'no second row to paste');
  });

  it('an older caller without the check gets no Universities rows', () => {
    assert.doesNotMatch(build(false).text, /Universities tab/);
  });
});
