// Parameters rows that carry the Graduate School's own minimum, with no code
// constant behind them (policy review round 3, P3-ac-5b-6.1-4; DGS 2026-10-07:
// "apply the suggested handling"). The Academic Code's figures are "minimum
// standards … Individual programs may require higher standards": a row set
// looser is warned about in the diagnostics, and since 2026-10-07 (DGS:
// option (a), "hold the Graduate School's floor") the app uses the floor.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildRules } from './helpers.ts';

const looser: [string, string, RegExp][] = [
  ['ms_time_limit_years', '6', /at most 5 years \(Academic Code §6\.1\.4/],
  ['ms_total_credits_min', '27', /at least 30 credits \(Academic Code §6\.1\.1/],
  ['gpa_min', '2.8', /at least 3\.0 \(Academic Code §4\.5/],
  ['fulltime_credits_min', '6', /at least 9 credits \(Academic Code §3\.3/],
  ['summer_fulltime_credits_min', '3', /at least 6 credits \(DGS Handbook §10\.3\.2/],
  ['phd_time_limit_years', '9', /at most 8 years \(Academic Code §6\.2\.6/],
];

describe('a Graduate School floor set looser on the sheet (P3-ac-5b-6.1-4)', () => {
  it('today’s sheet: no warning', () => {
    assert.deepEqual(buildRules().issues.filter((i) => /looser than the Graduate School allows/.test(i.message)), []);
  });
  for (const [key, value, says] of looser) {
    it(`${key} = ${value}: a warning that quotes the Graduate School`, () => {
      const issues = buildRules({ parameters: { [key]: value } }).issues.filter((i) => i.message.includes(`'${key}' is ${value}, looser than the Graduate School allows`));
      assert.equal(issues.length, 1, key);
      assert.equal(issues[0]!.severity, 'warning');
      assert.match(issues[0]!.message, says);
      assert.match(issues[0]!.message, /The app uses the Graduate School’s \d+ instead/);
    });
    it(`${key} = ${value}: the app reads the Graduate School’s value`, () => {
      const floor = { ms_time_limit_years: 5, ms_total_credits_min: 30, gpa_min: 3, fulltime_credits_min: 9, summer_fulltime_credits_min: 6, phd_time_limit_years: 8 }[key];
      assert.equal(buildRules({ parameters: { [key]: value } }).parameters.number(key), floor);
    });
  }
  it('tighter is fine: a program may require more', () => {
    for (const [key, value] of [['ms_time_limit_years', '4'], ['gpa_min', '3.3'], ['ms_total_credits_min', '33'], ['fulltime_credits_min', '12'], ['summer_fulltime_credits_min', '9'], ['phd_time_limit_years', '7']] as const) {
      assert.deepEqual(buildRules({ parameters: { [key]: value } }).issues.filter((i) => /looser than the Graduate School allows/.test(i.message)), [], key);
      assert.equal(buildRules({ parameters: { [key]: value } }).parameters.number(key), Number(value), `${key}: a stricter row is followed`);
    }
  });
});

// Nine more rows (policy review round 4, P4-data-1; DGS 2026-10-11: option (a)).
const moreLooser: [string, string, number, RegExp][] = [
  ['transfer_unfinished_ms_credits_max', '9', 6, /at most 6 credits \(Academic Code §4\.6/],
  ['ms_transfer_completed_ms_credits_max', '12', 9, /at most 9 credits \(Academic Code §4\.6/],
  ['phd_transfer_completed_ms_credits_max', '30', 24, /at most 24 credits \(Academic Code §4\.6/],
  ['ms_transfer_window_years', '7', 5, /at most 5 years \(Academic Code §4\.6/],
  ['phd_transfer_window_years', '8', 5, /at most 5 years \(Academic Code §4\.6/],
  ['ms_4xxxx_credits_max', '9', 6, /at most 6 credits \(Academic Code §4\.1/],
  ['phd_4xxxx_cse_credits_max', '9', 6, /at most 6 credits \(Academic Code §4\.1/],
];

describe('nine more Graduate School limits held (policy review round 4, P4-data-1)', () => {
  for (const [key, value, floor, says] of moreLooser) {
    it(`${key} = ${value}: warned about, and read as ${floor}`, () => {
      const rules = buildRules({ parameters: { [key]: value } });
      const issues = rules.issues.filter((i) => i.message.includes(`'${key}' is ${value}, looser than the Graduate School allows`));
      assert.equal(issues.length, 1, key);
      assert.match(issues[0]!.message, says);
      assert.equal(rules.parameters.number(key), floor);
    });
  }
  it('stricter values are followed', () => {
    for (const [key, value] of [['transfer_unfinished_ms_credits_max', '3'], ['phd_transfer_completed_ms_credits_max', '18'], ['phd_transfer_window_years', '4'], ['ms_4xxxx_credits_max', '3']] as const) {
      const rules = buildRules({ parameters: { [key]: value } });
      assert.equal(rules.parameters.number(key), Number(value), key);
      assert.deepEqual(rules.issues.filter((i) => /looser than the Graduate School allows/.test(i.message)), [], key);
    }
  });
  it('transfer_min_grade below B: warned about, and read as B; B+ is followed', () => {
    const rules = buildRules({ parameters: { transfer_min_grade: 'C' } });
    assert.equal(rules.parameters.gradeLetter('transfer_min_grade'), 'B');
    assert.ok(rules.issues.some((i) => /'transfer_min_grade' is C, looser than the Graduate School allows — B or better \(Academic Code §4\.6/.test(i.message)));
    assert.equal(buildRules({ parameters: { transfer_min_grade: 'B+' } }).parameters.gradeLetter('transfer_min_grade'), 'B+');
  });
  it('phd_total_credits_min below sixty: warned about; held at 60 without an earlier master’s, followed with one', async () => {
    const { audit } = await import('../src/engine/audit.ts');
    const { phdStudent } = await import('./helpers/student.ts');
    const rules = buildRules({ parameters: { phd_total_credits_min: '50' } });
    assert.ok(rules.issues.some((i) => /'phd_total_credits_min' is 50, below the Graduate School's sixty — Academic Code §6\.2\.1/.test(i.message)));
    const need = (s: Parameters<typeof audit>[0]) => audit(s, rules, '2026-10-11').requirements.find((r) => r.id === 'phd.credits.total')!.progress?.need;
    assert.equal(need(phdStudent({ priorMs: 'none' })), 60);
    assert.equal(need(phdStudent({ priorMs: 'completed' })), 50);
  });
});
