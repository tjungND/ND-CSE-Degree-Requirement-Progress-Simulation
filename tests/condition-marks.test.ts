// Marks on a card's conditions (DGS 2026-10-06: "In the progress result cards,
// it's hard to see what are met and what are not met. Can you make them
// visible more easily?"). The engine gives each condition of the candidacy
// card a mark — met, in progress, waiting for the DGS, not yet — which the page
// draws in the bullet's place with the course table's ✓ ◐ ● ✕. The words stay
// in the text, so the emails and the plain detail are unchanged.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { audit } from '../src/engine/audit.ts';
import type { ConditionMark, DetailPart, Milestones, Student, Term } from '../src/engine/types.ts';
import { buildRules } from './helpers.ts';
import { ndCourse, phdStudent } from './helpers/student.ts';

const rules = buildRules();
const fall = (year: number): Term => ({ season: 'fall', year });
const spring = (year: number): Term => ({ season: 'spring', year });
const REGULAR = ['CSE 60641', 'CSE 60111', 'CSE 60321', 'CSE 60427', 'CSE 60535', 'CSE 60762', 'CSE 60770', 'CSE 60876'];
const student = (courses: number, milestones: Milestones = {}): Student => {
  const terms = [fall(2024), spring(2025), fall(2025), spring(2026)];
  return phdStudent({
    entryTerm: fall(2024),
    bachelorsAwarded: spring(2024),
    gpa: 3.6,
    courses: REGULAR.slice(0, courses).map((id, i) => ndCourse(id, { term: terms[Math.floor(i / 2)]! })),
    fullTimeTermOverrides: terms,
    milestones: { advisorIdentified: '2024-10-01', advisorName: 'Prof. Example', advisorTtt: 'yes', ...milestones },
  });
};
const card = (s: Student) => audit(s, rules, '2026-10-06').requirements.find((r) => r.id === 'phd.candidacyAdmission')!;
const checks = (parts: DetailPart[] | undefined) =>
  (parts ?? []).filter((p): p is { check: string; mark: ConditionMark } => typeof p === 'object' && 'check' in p).map((p) => [p.check.replace(/:.*$/, ''), p.mark]);

describe('the candidacy card marks each condition (DGS 2026-10-06)', () => {
  it('In progress: met, and not yet, per condition; the registration line is information, not marked', () => {
    const c = card(student(8));
    assert.equal(c.status, 'in_progress');
    assert.deepEqual(checks(c.detailParts), [
      ['Oral Candidacy Exam (OCE)', 'not_yet'],
      ['4 consecutive full-time semesters', 'met'],
      ['Coursework', 'met'],
      ['Cumulative GPA of 3.0 or better', 'met'],
      ['Responsible Conduct of Research and ethics training', 'not_yet'],
      ['Tenured or tenure-track dissertation advisor', 'met'],
    ]);
    assert.ok((c.detailParts ?? []).some((p) => typeof p === 'string' && p.startsWith('Registered this semester')));
    assert.match(c.detail, /Oral Candidacy Exam \(OCE\): not yet\. 4 consecutive full-time semesters: done/, 'the words are unchanged');
  });
  it('Not started: the lead’s items carry parallel marks — in progress and not yet are told apart', () => {
    const s = student(6);
    s.courses.push(ndCourse('CSE 60770', { term: fall(2026), grade: 'IP' }));
    const c = card(s);
    assert.match(c.detail, /^Not started\./);
    const lead = (c.detailParts ?? []).find((p): p is { lead: string; items: string[]; marks?: ConditionMark[] } => typeof p === 'object' && 'lead' in p)!;
    assert.equal(lead.marks?.length, lead.items.length);
    const byLabel = Object.fromEntries(lead.items.map((t, i) => [t.replace(/:.*$/, ''), lead.marks![i]]));
    assert.equal(byLabel['Regular-course credits'], 'not_yet');
    assert.equal(byLabel['Core knowledge'], 'met'); // the three areas are one line (DGS 2026-10-27)
    assert.equal(byLabel['Tenured or tenure-track advisor'], 'met');
  });
  it('waiting for the DGS: an advisor answered “Not sure”', () => {
    const c = card(student(8, { advisorTtt: 'unsure' }));
    const lead = (c.detailParts ?? []).find((p): p is { lead: string; items: string[]; marks?: ConditionMark[] } => typeof p === 'object' && 'lead' in p)!;
    const i = lead.items.findIndex((t) => t.startsWith('Tenured or tenure-track advisor'));
    assert.equal(lead.marks![i], 'waiting');
  });
});

// §4.4.1's three areas are one line on the candidacy card, as the
// specialization is (DGS 2026-10-27: "fold these … into one core knowledge
// requirement, just like the specialization"), marked by the area furthest behind.
describe('core knowledge is one condition on the candidacy card (DGS 2026-10-27)', () => {
  const leadOf = (s: Student) => {
    const lead = (card(s).detailParts ?? []).find((p): p is { lead: string; items: string[]; marks?: ConditionMark[] } => typeof p === 'object' && 'lead' in p)!;
    const i = lead.items.findIndex((t) => t.startsWith('Core knowledge'));
    return { items: lead.items.filter((t) => t.startsWith('Core knowledge')), text: lead.items[i], mark: lead.marks![i] };
  };
  it('one area done, one in progress, one with no course: one line, marked not yet, naming the two open areas', () => {
    const s = { ...student(0), entryTerm: fall(2025) }; // the qualifier's four semesters still running
    s.courses = [ndCourse('CSE 60641', { term: spring(2026) }), ndCourse('CSE 60111', { term: fall(2026), grade: 'IP' })];
    const c = leadOf(s);
    assert.equal(c.items.length, 1);
    assert.equal(c.text, 'Core knowledge: 1 of 3 areas done — Algorithms: in progress (CSE 60111, Fall 2026), Computer Architecture: no course yet');
    assert.equal(c.mark, 'not_yet');
  });
  it('every area done: "Core knowledge: done", marked met', () => {
    const c = leadOf(student(6));
    assert.deepEqual([c.items.length, c.text, c.mark], [1, 'Core knowledge: done', 'met']);
  });
  it('the last open area in progress: marked in progress', () => {
    const s = { ...student(0), entryTerm: fall(2025) };
    s.courses = [ndCourse('CSE 60641', { term: spring(2026) }), ndCourse('CSE 60321', { term: spring(2026) }), ndCourse('CSE 60111', { term: fall(2026), grade: 'IP' })];
    const c = leadOf(s);
    assert.equal(c.text, 'Core knowledge: 2 of 3 areas done — Algorithms: in progress (CSE 60111, Fall 2026)');
    assert.equal(c.mark, 'in_progress');
  });
  it('past the qualifier deadline, a course in progress is late, not "no course yet"', () => {
    const s = student(0); // entered Fall 2024: the four semesters ended with Spring 2026
    s.courses = [ndCourse('CSE 60641', { term: spring(2026) }), ndCourse('CSE 60321', { term: spring(2026) }), ndCourse('CSE 60111', { term: fall(2026), grade: 'IP' })];
    const c = leadOf(s);
    assert.equal(c.text, 'Core knowledge: 2 of 3 areas done — Algorithms: in progress (CSE 60111, Fall 2026) after the qualifier deadline');
    assert.equal(c.mark, 'not_yet');
  });
});
