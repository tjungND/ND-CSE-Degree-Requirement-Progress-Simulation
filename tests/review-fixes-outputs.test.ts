// Review of the credit-transfer fixes, 2026-10-29: what a candidate's line,
// the §5.2 card, the advisor email and Next steps say once part of the
// record is ticked as recorded, a cap refused a course, or the graduation
// semester has begun.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { audit } from '../src/engine/audit.ts';
import { transferKey } from '../src/engine/transfer-recorded.ts';
import type { CourseEntry, Student } from '../src/engine/types.ts';
import { labelCitations } from '../src/ui/citations.ts';
import { absorbBlockRow, pairBlockRows } from '../src/ui/nd-posted.ts';
import { advisorTransferList, gradAdminRequest, processingItems } from '../src/ui/grad-admin-request.ts';
import { nextSteps } from '../src/ui/next-steps.ts';
import { buildRules } from './helpers.ts';
import { ndCourse, phdStudent, transferCourse } from './helpers/student.ts';

const TODAY = '2026-10-29';
const fall = (year: number) => ({ season: 'fall' as const, year });
const spring = (year: number) => ({ season: 'spring' as const, year });
const elsewhere = { bachelors: 'elsewhere' as const, graduate: 'elsewhere' as const, samePlace: false, finished: true };
const ext = (university: string, course_id: string, v: string) => ({ university, course_id, course_title: course_id, transferable_PhD: v, transferable_MSCSE: v === 'dgs_approval' ? 'adgs_approval' : v, is_cse: 'yes', credit_system: 'semester' });
const lineOf = (s: Student, rules: ReturnType<typeof buildRules>, id: string): string => audit(s, rules, TODAY).courseLines.find((l) => l.courseId === id)!.text;

describe('a candidate’s line names every hold on it', () => {
  it('two earlier programs, neither course in the course rules', () => {
    const s = phdStudent({
      entryTerm: fall(2026), priorMs: 'completed', bachelorsAwarded: spring(2019), background: elsewhere,
      courses: [transferCourse('CS 52500', 'Parallel', { degreeLevel: 'masters', term: fall(2023) }), transferCourse('EECS 545', 'ML', { degreeLevel: 'masters', institution: 'University of Michigan', term: spring(2025) })],
    });
    for (const id of ['CS 52500', 'EECS 545']) assert.match(lineOf(s, buildRules({ external: [] }), id), /from one of two earlier graduate programs on your record/);
  });
  it('an outside Incomplete taken after admission names both', () => {
    const s = phdStudent({ entryTerm: fall(2025), priorMs: 'completed', bachelorsAwarded: spring(2019), background: elsewhere, courses: [transferCourse('CS 52500', 'Parallel', { degreeLevel: 'masters', term: spring(2026), grade: 'I' })] });
    const line = lineOf(s, buildRules({ external: [] }), 'CS 52500');
    assert.match(line, /graded I \(Incomplete\)/);
    assert.match(line, /after you entered/);
  });
  it('an earlier Notre Dame program’s course with a lapsed Incomplete', () => {
    const s = phdStudent({
      entryTerm: fall(2026), priorMs: 'completed', bachelorsAwarded: spring(2019), background: { bachelors: 'elsewhere', graduate: 'nd-other', finished: true } as never,
      courses: [transferCourse('CSE 60641', 'Graduate Operating Systems', { institution: 'University of Notre Dame', degreeLevel: 'masters', term: spring(2025), grade: 'I' })],
    });
    assert.match(lineOf(s, buildRules(), 'CSE 60641'), /it became an F unless the Graduate School extended it/);
  });
});

describe('the recorded tick, course by course, on the card and in the advisor email', () => {
  const rules = buildRules({ external: [ext('PURDUE UNIVERSITY', 'CS 52500', 'yes'), ext('PURDUE UNIVERSITY', 'CS 58000', 'dgs_approval')] });
  const s = phdStudent({
    entryTerm: fall(2025), priorMs: 'completed', bachelorsAwarded: spring(2019), background: elsewhere,
    attestations: { transferRecorded: true, transferRecordedCourses: [transferKey({ courseId: 'CS 52500', institution: 'Purdue University', term: fall(2023) })] },
    courses: [transferCourse('CS 52500', 'CS 52500', { term: fall(2023), degreeLevel: 'masters' }), transferCourse('CS 58000', 'CS 58000', { term: fall(2023), degreeLevel: 'masters', dgsApproved: true })],
  });
  const report = audit(s, rules, TODAY);
  it('the email lists only the course still to submit', () => {
    assert.deepEqual(advisorTransferList(processingItems(report, s, rules)), { courses: ['CS 58000'], recorded: false });
  });
  it('the card says which course is recorded', () => {
    const detail = report.requirements.find((r) => r.id === 'phd.transfer')!.detail;
    assert.match(detail, /Approved by the DGS in the course rules: CS 52500 \(recorded by the Grad Admin, as you ticked\)/);
    assert.match(detail, /Approved by the DGS for you, as you ticked: CS 58000/);
  });
  it('nothing to submit once both are recorded', () => {
    const both = { ...s, attestations: { transferRecorded: true, transferRecordedCourses: ['CS 52500', 'CS 58000'].map((courseId) => transferKey({ courseId, institution: 'Purdue University', term: fall(2023) })) } };
    assert.deepEqual(advisorTransferList(processingItems(audit(both, rules, TODAY), both, rules)), { courses: [], recorded: true });
  });
});

describe('a course over the cap, once the rest is ticked as recorded', () => {
  // The MSCSE's nine after a finished master's: CS 50400 is over it, so the
  // request never submits it and the tick never covers it.
  const rules = buildRules({ external: ['CS 50100', 'CS 50200', 'CS 50300', 'CS 50400'].map((id) => ext('PURDUE UNIVERSITY', id, 'yes')) });
  const s = phdStudent({
    program: 'mscse', msOption: 'project', entryTerm: fall(2025), priorMs: 'completed', bachelorsAwarded: spring(2022), background: elsewhere, graduationTerm: fall(2026),
    attestations: { transferRecorded: true, transferRecordedCourses: ['CS 50100', 'CS 50200', 'CS 50300'].map((courseId) => transferKey({ courseId, institution: 'Purdue University', term: fall(2023) })) },
    courses: ['CS 50100', 'CS 50200', 'CS 50300', 'CS 50400'].map((id) => transferCourse(id, id, { term: fall(2023), degreeLevel: 'masters' })),
  });
  const report = audit(s, rules, TODAY);
  it('the §5.2 card reads met, and no window warning asks about it', () => {
    assert.equal(report.requirements.find((r) => r.id === 'ms.transfer')!.status, 'met');
    assert.equal(report.transferRequestWindowClosed, undefined);
  });
  it('the processing step asks nothing about a transfer the request does not carry', () => {
    const ga = gradAdminRequest(report, s, rules, { todayIso: TODAY, entryTerm: 'Fall 2025', priorStudy: 'x' });
    const step = nextSteps({ report, student: s, review: { unlisted: 0, caseByCase: 0 }, processingCount: ga.items.count, processingTransfers: ga.items.transfers.filter((t) => t.recorded !== true).length, transferWindowClosed: fall(2026) }).find((x) => x.key === 'processing.send');
    assert.doesNotMatch(step?.text ?? '', /whether your transfer request went/);
  });
});

describe('the waiting step once the graduation semester has begun', () => {
  const s = phdStudent({ entryTerm: fall(2022), priorMs: 'completed', bachelorsAwarded: spring(2019), background: elsewhere, graduationTerm: fall(2026), courses: [transferCourse('CS 51000', 'CS 51000', { term: fall(2021), degreeLevel: 'masters' })] });
  const rules = buildRules({ external: [ext('PURDUE UNIVERSITY', 'CS 51000', 'dgs_approval')] });
  const report = audit(s, rules, TODAY);
  const wait = (transfers: number) => nextSteps({ report, student: s, review: { unlisted: 0, caseByCase: 1, transfers }, processingCount: 0, transferWindowClosed: fall(2026) }).find((x) => x.key === 'review.wait')!.text;
  it('a transfer the DGS is deciding: the request will ask whether it went in time', () => {
    assert.match(wait(1), /then send the processing request — it asks the Grad Admin whether your transfer request went to the Graduate School before Fall 2026; if it did not, ask the DGS\.$/);
  });
  it('no transfer among them: as before', () => {
    assert.match(wait(0), /then send the processing request, and the Grad Admin records it\.$/);
  });
});

describe('each cap a line names is cited, in its own document', () => {
  it('a candidate the nine limits cites §4.2 beside §5.2', () => {
    const row = (id: string, v: string) => ({ ...ext('NORTHEASTERN UNIVERSITY', id, v), is_cse: 'no' });
    const rules = buildRules({ external: [row('INFO 5100', 'yes'), row('INFO 6150', 'yes'), row('INFO 7375', 'dgs_approval')] });
    const neu = (id: string, term: { season: 'fall' | 'spring'; year: number }) => transferCourse(id, id, { credits: 4, term, degreeLevel: 'masters', institution: 'Northeastern University' });
    const s = phdStudent({ entryTerm: fall(2025), priorMs: 'completed', bachelorsAwarded: spring(2023), background: elsewhere, courses: [neu('INFO 5100', fall(2024)), neu('INFO 6150', fall(2024)), neu('INFO 7375', spring(2025))] });
    assert.match(lineOf(s, rules, 'INFO 7375'), /\(the 9-credit non-CSE cap limits the rest\) \(§4\.2; §5\.2\)/);
  });
  it('a course the non-degree twelve and the nine cut together names the CSE handbook after the Code', () => {
    const renames = [['CSE 60876', 'MATH 60850'], ['CSE 60770', 'EE 60770'], ['CSE 60762', 'PHYS 60762'], ['CSE 60535', 'ACMS 60535'], ['CSE 60427', 'PSY 60427']].map(([from, to]) => ({ course_id: from!, set: { course_id: to!, title: to! } }));
    const nonDeg = (id: string, term: { season: 'fall' | 'spring'; year: number }): CourseEntry => ({ ...transferCourse(id, undefined, { term, institution: 'University of Notre Dame', degreeLevel: 'masters' }), registeredLevel: 'graduate', dgsApproved: true, dgsHoldApproved: true });
    const s = phdStudent({
      entryTerm: fall(2026), priorMs: 'none', bachelorsAwarded: spring(2024), ndNonDegree: true,
      courses: [nonDeg('MATH 60850', fall(2024)), nonDeg('EE 60770', fall(2024)), nonDeg('PHYS 60762', spring(2025)), nonDeg('ACMS 60535', spring(2025)), nonDeg('PSY 60427', fall(2025)), ndCourse('CSE 60111', { term: fall(2026) })],
    });
    const both = audit(s, buildRules({ courses: renames }), TODAY).courseLines.map((l) => l.text).find((t) => t.includes('non-degree coursework and 9-credit non-CSE cap'));
    assert.ok(both !== undefined, 'a line names both caps');
    assert.match(both, /\(Academic Code §2\.3; CSE §4\.2\)/);
    assert.match(labelCitations(both), /\(Academic Code §2\.3; CSE §4\.2\)/);
  });
});

describe('two postings of one course number, whichever transcript comes first', () => {
  const topics = (title: string, term: { season: 'fall' | 'spring'; year: number }): CourseEntry => transferCourse('CS 59000', title, { term, degreeLevel: 'masters' });
  const posting = (title: string, term: { season: 'fall' | 'spring'; year: number }) => ({ courseId: 'CS 59000', title, institution: 'PURDUE UNIVERSITY-WEST LAFAYETTE', origin: 'transfer' as const, term, credits: 3, grade: 'IP' as const, level: 'graduate' as const });
  it('each posting goes to its own row, by title', () => {
    const security = topics('Topics: Security', fall(2023));
    const blockchain = topics('Topics: Blockchain', spring(2024));
    const pairs = pairBlockRows([security, blockchain], [posting('TOPICS: BLOCKCHAIN', spring(2026)), posting('TOPICS: SECURITY', spring(2026))]);
    assert.deepEqual([...pairs.values()].map((r) => r.title), ['Topics: Blockchain', 'Topics: Security']);
  });
  it('a posting with no row left keeps its block row', () => {
    assert.equal(pairBlockRows([topics('Topics: Security', fall(2023))], [posting('A', spring(2026)), posting('B', spring(2026))]).size, 1);
  });
  it('one posting and a retake: the attempt the Graduate School could accept (#22)', () => {
    const bMinus = { ...topics('Topics', fall(2023)), grade: 'B-' as const };
    const a = topics('Topics', spring(2024));
    for (const rows of [[bMinus, a], [a, bMinus]]) assert.equal([...pairBlockRows(rows, [posting('Topics', spring(2026))]).values()][0], a);
  });
  it('the Notre Dame transcript first, then the other: both block rows go', () => {
    const block = (title: string): CourseEntry => ({ courseId: 'CS 59000', title, credits: 3, term: spring(2026), grade: 'IP', origin: 'transfer', institution: 'PURDUE UNIVERSITY-WEST LAFAYETTE', registeredLevel: 'graduate', fromNdTranscript: true, ndPosted: { term: spring(2026), credits: 3, level: 'graduate', institution: 'PURDUE UNIVERSITY-WEST LAFAYETTE' } });
    const s = phdStudent({ entryTerm: fall(2025), priorMs: 'completed', bachelorsAwarded: spring(2019), background: elsewhere, courses: [block('TOPICS: SECURITY'), block('TOPICS: BLOCKCHAIN')] });
    const added = [topics('Topics: Security', fall(2023)), topics('Topics: Blockchain', spring(2024))];
    s.courses.push(...added);
    const blocks = s.courses.filter((c) => c.fromNdTranscript === true);
    for (const [b, row] of pairBlockRows(added, blocks)) absorbBlockRow(s, row, b);
    assert.equal(s.courses.filter((c) => c.fromNdTranscript === true).length, 0);
    assert.ok(added.every((r) => r.ndPosted !== undefined));
    const report = audit(s, buildRules(), TODAY);
    assert.ok(!report.warnings.some((w) => /CS 59000 from Purdue University is entered 2 times/.test(w)), report.warnings.join(' | '));
  });
});

describe('each registration counts toward its own rows', () => {
  // A Purdue course numbered like a Notre Dame one, beside the Notre Dame one.
  const rules = buildRules({ external: [{ university: 'PURDUE UNIVERSITY', course_id: 'CSE 60641', course_title: 'Operating Systems', transferable_PhD: 'yes', transferable_MSCSE: 'yes', is_cse: 'yes' }] });
  const s = phdStudent({
    entryTerm: fall(2026), bachelorsAwarded: spring(2024), priorMs: 'unfinished', background: { bachelors: 'elsewhere', graduate: 'elsewhere', samePlace: false, finished: false },
    courses: [transferCourse('CSE 60641', 'Operating Systems', { term: spring(2026), degreeLevel: 'masters' }), ndCourse('CSE 60641', { term: fall(2026), grade: 'A' }), ndCourse('CSE 60111', { term: fall(2026) })],
  });
  const report = audit(s, rules, '2027-01-20');
  it('only the Notre Dame registration counts toward the nine at Notre Dame', () => {
    const feeds = (i: number) => (report.courseLines.find((l) => l.entryIndex === i)!.counts ?? []).map((x) => x.id);
    assert.ok(!feeds(0).includes('phd.credits.nd'), feeds(0).join());
    assert.ok(feeds(1).includes('phd.credits.nd'), feeds(1).join());
  });
  it('the request tables the Notre Dame row under it', () => {
    const { items } = gradAdminRequest(report, s, rules, { todayIso: '2027-01-20', entryTerm: 'Fall 2026', priorStudy: 'x' });
    const nine = items.standing.find((t) => t.heading.startsWith('At least 9 credits of regular courses taken at Notre Dame'))!;
    assert.deepEqual(nine.courseEntries.map((c) => `${c.courseId} ${c.origin}`).sort(), ['CSE 60111 nd', 'CSE 60641 nd']);
  });
});

describe('the request’s table says how much of a course a row takes', () => {
  it('a Notre Dame course the nine sends partly to the 60 alone', () => {
    const renamed = [['CSE 60876', 'MATH 60850', '3'], ['CSE 60770', 'EE 60770', '3'], ['CSE 60535', 'ACMS 60535', '4']].map(([from, to, max]) => ({ course_id: from!, set: { course_id: to!, title: to!, credit_max: max!, credits_default: max!, category_group: '', core_area: '' } }));
    const rules = buildRules({ courses: renamed });
    const s = phdStudent({ entryTerm: fall(2025), courses: [ndCourse('MATH 60850', { term: fall(2025) }), ndCourse('EE 60770', { term: fall(2025) }), ndCourse('ACMS 60535', { term: spring(2026), credits: 4 })] });
    const { text } = gradAdminRequest(audit(s, rules, '2026-10-28'), s, rules, { todayIso: '2026-10-28', entryTerm: 'Fall 2025', priorStudy: 'x' });
    const row = text.split('\n').find((l) => l.startsWith('ACMS 60535\t'))!;
    assert.match(row, /\t60 total credits; 24 regular-course credits: 3 of the 4; 9 regular credits at ND: 3 of the 4\t/);
  });
});
