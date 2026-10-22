// Every result is stamped (DGS 2026-10-11, item 8): the rules' fingerprint,
// live or saved copy and date, the handbook's edition, the app's build — on
// the footers, the print header, the three emails and the saved file — and
// `npm run reproduce` re-runs a saved file against the matching snapshot.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { rulesFromCsvTexts, type CsvTexts } from '../src/data/assemble.ts';
import { rulesFingerprint } from '../src/data/fingerprint.ts';
import { sameCsvContent } from '../src/data/rules-date.ts';
import { audit } from '../src/engine/audit.ts';
import { advisorSummary } from '../src/ui/advisor-summary.ts';
import { gradAdminRequest } from '../src/ui/grad-admin-request.ts';
import { checkedWithLine, resultStamp, savedStamp, stampLine } from '../src/ui/stamp.ts';
import { validateStudent } from '../src/ui/state.ts';
import { buildCombinedReviewRequest } from '../src/ui/review-request.ts';
import { allScenarios, buildRules } from './helpers.ts';

const snapshot = JSON.parse(readFileSync(new URL('../data/snapshot.json', import.meta.url), 'utf8')) as { syncedAt: string; csv: CsvTexts };
const APP = { commit: 'abc1234', date: '2026-10-11', modified: false };

describe('the rules fingerprint', () => {
  it('is eight hexadecimal characters, the same for the same content', () => {
    const fp = rulesFingerprint(snapshot.csv);
    assert.match(fp, /^[0-9a-f]{8}$/);
    // Line endings and trailing whitespace are not content (sameCsvContent agrees).
    const lf = snapshot.csv.courses.replace(/\r\n?/g, '\n');
    const crlf: CsvTexts = { ...snapshot.csv, courses: lf.replace(/\n/g, '\r\n') + '  \r\n\r\n' };
    assert.notEqual(crlf.courses, snapshot.csv.courses);
    assert.ok(sameCsvContent(crlf, snapshot.csv));
    assert.equal(rulesFingerprint(crlf), fp);
  });
  it('changes with one cell, and with text moved between tabs', () => {
    const fp = rulesFingerprint(snapshot.csv);
    assert.ok(snapshot.csv.courses.includes('CSE 60111'));
    assert.notEqual(rulesFingerprint({ ...snapshot.csv, courses: snapshot.csv.courses.replace('CSE 60111', 'CSE 60112') }), fp);
    assert.notEqual(rulesFingerprint({ ...snapshot.csv, courses: snapshot.csv.courses + snapshot.csv.parameters, parameters: '' }), fp);
    // An optional tab the app could not read is left out — a different fingerprint.
    const { external: _e, ...noExternal } = snapshot.csv;
    assert.notEqual(rulesFingerprint(noExternal), fp);
  });
  it('is on every Rules object, live or saved', () => {
    const live = rulesFromCsvTexts(snapshot.csv, { source: 'live', syncedAt: '2026-10-11T00:00:00Z' });
    const saved = rulesFromCsvTexts(snapshot.csv, { source: 'snapshot', syncedAt: snapshot.syncedAt });
    assert.equal(live.fingerprint, saved.fingerprint);
    assert.equal(live.fingerprint, rulesFingerprint(snapshot.csv));
  });
});

describe('the stamp line', () => {
  const rules = buildRules();
  it('names the rules, live or saved and dated, the handbook edition and the build', () => {
    const live = stampLine(resultStamp({ fingerprint: '3f9a2c1b', source: 'live', rulesDate: { kind: 'known', at: '2026-10-09T16:00:00Z' } }, APP));
    assert.equal(live, 'course rules 3f9a2c1b (read live, last updated on October 9, 2026) · CSE Graduate Studies Handbook (Updated September 2026) · app version abc1234 of October 11, 2026');
    const after = stampLine(resultStamp({ fingerprint: '3f9a2c1b', source: 'live', rulesDate: { kind: 'after', at: '2026-10-09T16:00:00Z' } }, APP));
    assert.match(after, /\(read live, updated after October 9, 2026\)/);
    const saved = stampLine(resultStamp({ fingerprint: '3f9a2c1b', source: 'snapshot', rulesDate: { kind: 'known', at: '2026-10-09T16:00:00Z' } }, { commit: 'abc1234', date: '', modified: true }));
    assert.match(saved, /\(the copy saved in the app, last updated on October 9, 2026\)/);
    assert.match(saved, /app version abc1234 with local changes$/);
    // Tests run without Vite: the build reads "dev".
    assert.match(checkedWithLine(resultStamp(rules)), /^Checked with: course rules [0-9a-f]{8} \(the copy saved in the app\) · CSE Graduate Studies Handbook \(Updated September 2026\) · app version dev\.$/);
  });

  it('ends all three emails', () => {
    const sc = allScenarios().find((s) => s.name === 'life-phd-ms-along-the-way')!;
    const r = buildRules(sc.rules.patch);
    const report = audit(sc.student, r, sc.today);
    const line = checkedWithLine(resultStamp(r, APP));
    const ga = gradAdminRequest(report, sc.student, r, { todayIso: sc.today, entryTerm: 'Fall 2021', priorStudy: 'None', stamp: line });
    const adv = advisorSummary(report, { todayIso: sc.today, entryTerm: 'Fall 2021', priorStudy: 'None', stamp: line });
    const rev = buildCombinedReviewRequest({ priorStudy: 'None', nd: [], external: [], stamp: line });
    for (const [name, email] of [['processing request', ga], ['advisor summary', adv], ['review request', rev]] as const) {
      assert.ok(email.text.trimEnd().endsWith(line), `${name} (text) must end with the stamp`);
      assert.ok(email.html.includes(line.replace(/&/g, '&amp;')), `${name} (html) must carry the stamp`);
    }
  });
});

describe('the saved file and npm run reproduce', () => {
  it('a saved file carries the stamp and loads as before', () => {
    const sc = allScenarios().find((s) => s.name === 'life-phd-finished')!;
    const r = buildRules(sc.rules.patch);
    const stamp = savedStamp(resultStamp(r, APP), sc.today, audit(sc.student, r, sc.today).requirements);
    const file = JSON.parse(JSON.stringify({ savedAt: '2026-06-01T15:00:00.000Z', stamp, student: sc.student }));
    assert.equal(file.stamp.verdicts['phd.dissertation.defense'], 'met');
    assert.equal(file.stamp.auditDate, sc.today);
    assert.deepEqual(validateStudent(file).courses.length, sc.student.courses.length);
  });

  it('re-runs a saved file against the snapshot with the same fingerprint, and lists a row that reads differently', () => {
    const sc = allScenarios().find((s) => s.name === 'life-phd-finished')!;
    const rules = rulesFromCsvTexts(snapshot.csv, { source: 'live', syncedAt: '2026-10-11T00:00:00Z', rulesDate: { kind: 'known', at: snapshot.syncedAt } });
    const report = audit(sc.student, rules, sc.today);
    const stamp = savedStamp(resultStamp(rules, APP), sc.today, report.requirements);
    const dir = mkdtempSync(join(tmpdir(), 'reproduce-'));
    try {
      const run = (payload: unknown): { code: number; out: string } => {
        const file = join(dir, 'saved.json');
        writeFileSync(file, JSON.stringify(payload));
        try {
          return { code: 0, out: execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/dev/reproduce.mts', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
        } catch (e) {
          const err = e as { status: number; stdout: string };
          return { code: err.status, out: err.stdout };
        }
      };
      const same = run({ savedAt: '2026-06-01T15:00:00.000Z', stamp, student: sc.student });
      assert.equal(same.code, 0, same.out);
      assert.match(same.out, new RegExp(`fingerprint ${rules.fingerprint} matches (the snapshot commit [0-9a-f]{7}|data/snapshot\\.json \\(this checkout, not committed yet\\))`));
      assert.match(same.out, /Every row reads as the page showed it when the file was saved/);
      // The page had shown the defense as not passed: the re-run lists it.
      const tampered = { ...stamp, verdicts: { ...stamp.verdicts, 'phd.dissertation.defense': 'unmet' } };
      const diff = run({ savedAt: '2026-06-01T15:00:00.000Z', stamp: tampered, student: sc.student });
      assert.equal(diff.code, 1, diff.out);
      assert.match(diff.out, /1 row\(s\) read differently[^\n]*\n {2}phd\.dissertation\.defense: unmet → met/);
      // Rules no snapshot holds: said, and the nearest snapshot used.
      const unknown = run({ savedAt: '2026-06-01T15:00:00.000Z', stamp: { ...stamp, rules: { ...stamp.rules, fingerprint: '00000000' } }, student: sc.student });
      assert.match(unknown.out, /NO snapshot has fingerprint 00000000/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
