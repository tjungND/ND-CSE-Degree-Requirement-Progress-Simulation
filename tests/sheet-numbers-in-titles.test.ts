// A card title reads the number its row reads (policy review round 4,
// P4-data-5; DGS 2026-10-12: "apply the suggested handling"). README § A5
// tells the next DGS to change a handbook number by editing its Parameters
// row, and § A5b lets a Graduate School limit be tightened; before this the
// title kept the handbook's number, so one card stated two requirements
// ("Cumulative GPA of at least 3.0" over "… below the 3.2 minimum").
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { audit } from '../src/engine/audit.ts';
import { buildRules } from './helpers.ts';
import { ndCourse, phdStudent } from './helpers/student.ts';

const titles = (report: ReturnType<typeof audit>) => new Map(report.requirements.map((r) => [r.id, r.title]));
const shortTitles = (report: ReturnType<typeof audit>) => new Map(report.requirements.map((r) => [r.id, r.shortTitle]));

describe('card titles follow the Parameters tab (P4-data-5)', () => {
  const phd = phdStudent({ entryTerm: { season: 'fall', year: 2026 }, gpa: 3.1, courses: [ndCourse('CSE 60641', { term: { season: 'fall', year: 2026 } })] });
  const ms = phdStudent({ program: 'mscse', msOption: 'project', entryTerm: { season: 'fall', year: 2026 }, gpa: 3.1, courses: [ndCourse('CSE 60641', { term: { season: 'fall', year: 2026 } })] });

  it('the fixture sheet: the handbook’s numbers, as before', () => {
    const t = titles(audit(phd, buildRules(), '2026-10-12'));
    assert.equal(t.get('shared.gpa'), 'Cumulative GPA of at least 3.0');
    assert.equal(t.get('phd.credits.total'), '60 total credits of courses and research');
    assert.equal(t.get('phd.credits.regular'), 'At least 24 credits of regular courses at the 60000 level or higher');
    assert.equal(t.get('phd.credits.nd'), 'At least 9 credits of regular courses taken at Notre Dame');
    assert.equal(t.get('phd.residency'), 'Four consecutive full-time semesters of residence');
    assert.equal(t.get('phd.timeLimit'), 'All requirements complete within 8 years');
    const m = titles(audit(ms, buildRules(), '2026-10-12'));
    assert.equal(m.get('ms.credits.total'), '30 total credits of courses and research');
    assert.equal(m.get('ms.credits.regular'), '24 credit hours of regular courses');
    assert.equal(m.get('ms.timeLimit'), 'All requirements complete within 5 years');
  });

  it('tightened or changed numbers reach the titles, and the row’s own sentence agrees', () => {
    const patch = {
      parameters: {
        gpa_min: '3.2',
        phd_regular_credits_min: '27',
        phd_nd_credits_min: '12',
        phd_residency_semesters: '5',
        phd_time_limit_years: '7',
        phd_4xxxx_cse_credits_max: '3',
        phd_noncse_6xxxx_credits_max: '6',
        ms_regular_credits_min: '27',
        ms_project_credits_min: '9',
        ms_time_limit_years: '4',
        ms_noncse_credits_max: '6',
        ms_4xxxx_credits_max: '3',
      },
    };
    const r = audit(phd, buildRules(patch), '2026-10-12');
    const t = titles(r);
    assert.equal(t.get('shared.gpa'), 'Cumulative GPA of at least 3.2');
    assert.match(r.requirements.find((x) => x.id === 'shared.gpa')!.detail, /below the 3\.2 minimum/);
    assert.equal(t.get('phd.credits.regular'), 'At least 27 credits of regular courses at the 60000 level or higher');
    assert.equal(shortTitles(r).get('phd.credits.regular'), '27 regular-course credits');
    assert.equal(t.get('phd.credits.nd'), 'At least 12 credits of regular courses taken at Notre Dame');
    assert.equal(t.get('phd.residency'), 'Five consecutive full-time semesters of residence');
    assert.equal(t.get('phd.timeLimit'), 'All requirements complete within 7 years');
    const m = audit(ms, buildRules(patch), '2026-10-12');
    const mt = titles(m);
    assert.equal(mt.get('ms.credits.regular'), '27 credit hours of regular courses');
    assert.match(m.requirements.find((x) => x.id === 'ms.credits.regular')!.detail, /of 27 /);
    assert.equal(mt.get('ms.credits.project'), '9 credit hours of M.S. project or thesis direction');
    assert.equal(shortTitles(m).get('ms.credits.project'), 'Project/thesis (9 cr)');
    assert.equal(mt.get('ms.timeLimit'), 'All requirements complete within 4 years');
  });

  it('a loosened Graduate School limit is held, and so is its title', () => {
    const r = audit(phd, buildRules({ parameters: { gpa_min: '2.5', phd_time_limit_years: '10' } }), '2026-10-12');
    const t = titles(r);
    assert.equal(t.get('shared.gpa'), 'Cumulative GPA of at least 3.0');
    assert.equal(t.get('phd.timeLimit'), 'All requirements complete within 8 years');
  });

  it('a missing key keeps the handbook’s title; the row reads Cannot evaluate', () => {
    const r = audit(phd, buildRules({ parameters: { gpa_min: null, phd_regular_credits_min: null } }), '2026-10-12');
    const row = (id: string) => r.requirements.find((x) => x.id === id)!;
    assert.equal(row('shared.gpa').title, 'Cumulative GPA of at least 3.0');
    assert.equal(row('shared.gpa').status, 'cannot_evaluate');
    assert.equal(row('phd.credits.regular').title, 'At least 24 credits of regular courses at the 60000 level or higher');
    assert.equal(row('phd.credits.regular').status, 'cannot_evaluate');
  });
});
