// The dated line under each page's title, and how the rules get their date:
// rules_effective_date row (override) → the snapshot-based date from
// src/data/rules-date.ts ("were last updated on <sheet's last change>" when the
// live sheet still matches the committed snapshot, "were updated after <copy date>"
// when it is newer) → "are those in effect for <term>"; always followed by ", and
// are up-to-date as of <the day the page read the sheet>".
// rules_effective_date is a display-only key: missing is silent at the Parameters
// level, present is not "unknown", and the engine never reads it.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CsvTexts } from '../src/data/assemble.ts';
import { makeParameters } from '../src/data/params.ts';
import { changedTabs, formatDateLong, sameCsvContent } from '../src/data/rules-date.ts';
import { dateLiveRules, snapshotMetaOf } from '../src/data/snapshot-meta.ts';
import type { RulesDate, SheetIssue } from '../src/data/types.ts';
import { KNOWN_PARAMETER_KEYS } from '../src/data/types.ts';
import { rulesDateLine } from '../src/ui/handbook.ts';

function rawWith(extra: Record<string, string>): Map<string, { value: string; section: string; row: number }> {
  const raw = new Map<string, { value: string; section: string; row: number }>();
  let row = 2;
  for (const key of KNOWN_PARAMETER_KEYS) raw.set(key, { value: '1', section: '§', row: row++ });
  for (const [k, v] of Object.entries(extra)) raw.set(k, { value: v, section: '', row: row++ });
  return raw;
}

const rulesWith = (
  extra: Record<string, string>,
  rulesDate?: RulesDate,
  source: 'live' | 'snapshot' = 'live',
  syncedAt = '2026-11-03T14:00:00Z',
) => ({ parameters: { raw: rawWith(extra) }, rulesDate, source, syncedAt });

const TODAY = '2026-11-03';

const csv = (courses: string, parameters = 'key,value\r\nx,1\r\n', categories = 'core_area\r\nos\r\n'): CsvTexts => ({
  courses,
  parameters,
  categories,
});

describe('display-only parameters', () => {
  it('a missing rules_effective_date is not an issue at all at the Parameters level', () => {
    const issues: SheetIssue[] = [];
    makeParameters(rawWith({}), issues);
    assert.equal(issues.filter((i) => i.message.includes('rules_effective_date')).length, 0);
    assert.equal(issues.filter((i) => i.severity === 'error').length, 0);
  });

  it('a present rules_effective_date is not reported as an unknown key', () => {
    const issues: SheetIssue[] = [];
    const params = makeParameters(rawWith({ rules_effective_date: '2026-09-01' }), issues);
    assert.equal(issues.filter((i) => i.message.includes('rules_effective_date')).length, 0);
    assert.equal(params.raw.get('rules_effective_date')?.value, '2026-09-01');
  });
});

describe('the dated line under the title', () => {
  const TAIL = ', and are up-to-date as of November 3, 2026.'; // TODAY, as a calendar date

  it('prefers the DGS override, rendering ISO as prose and passing other text through', () => {
    assert.equal(
      rulesDateLine(rulesWith({ rules_effective_date: '2026-09-01' }, { kind: 'known', at: '2026-10-05T12:00:00Z' }), 'Fall 2026', TODAY),
      `The course rules here are effective as of September 1, 2026${TAIL}`,
    );
    assert.equal(
      rulesDateLine(rulesWith({ rules_effective_date: 'Fall 2026' }), 'Fall 2026', TODAY),
      `The course rules here are effective as of Fall 2026${TAIL}`,
    );
  });

  it("dates the rules by the sheet's last change when the rules shown are the snapshot content", () => {
    const line = rulesDateLine(rulesWith({}, { kind: 'known', at: '2026-09-01T18:30:00Z' }), 'Fall 2026', TODAY);
    assert.match(line, /^The course rules here were last updated on (August 31|September 1|September 2), 2026, and are up-to-date as of November 3, 2026\.$/); // local time zone
  });

  it('says "updated after" while the live sheet is newer than the snapshot', () => {
    const line = rulesDateLine(rulesWith({}, { kind: 'after', at: '2026-09-01T18:30:00Z' }), 'Fall 2026', TODAY);
    assert.match(line, /^The course rules here were updated after (August 31|September 1|September 2), 2026, and are up-to-date as of November 3, 2026\.$/);
  });

  it('when the fallback copy is shown, "up-to-date as of" is the day that copy was saved', () => {
    const line = rulesDateLine(rulesWith({}, { kind: 'known', at: '2026-09-01T18:30:00Z' }, 'snapshot', '2026-09-01T18:30:00Z'), 'Fall 2026', TODAY);
    assert.match(line, /^The course rules here were last updated on (\w+ \d+, 2026), and are up-to-date as of \1\.$/);
  });

  it('falls back to the current term when nothing is dated (blank override included)', () => {
    const fallback = `The course rules here are those in effect for Fall 2026${TAIL}`;
    assert.equal(rulesDateLine(rulesWith({ rules_effective_date: '  ' }), 'Fall 2026', TODAY), fallback);
    assert.equal(rulesDateLine(rulesWith({}), 'Fall 2026', TODAY), fallback);
    assert.equal(rulesDateLine(rulesWith({}, { kind: 'known', at: 'garbage' }), 'Fall 2026', TODAY), fallback);
  });

  it('never prints a broken date: a bad "today" just drops the second half', () => {
    assert.equal(
      rulesDateLine(rulesWith({}, { kind: 'known', at: '2026-09-01T18:30:00Z' }), 'Fall 2026', 'not-a-date'),
      rulesDateLine(rulesWith({}, { kind: 'known', at: '2026-09-01T18:30:00Z' }), 'Fall 2026', TODAY).replace(/, and are up-to-date as of November 3, 2026\.$/, '.'),
    );
  });
});

describe('dating the live rules against the committed snapshot', () => {
  const snapshot = { syncedAt: '2026-09-01T09:17:00Z', csv: csv('course_id,title\r\nCSE 60001,Alpha\r\n') };
  // The page compares the saved copy's per-tab fingerprints (W1, 2026-10-22),
  // not its text — the same answers, over the same normalized text.
  const meta = snapshotMetaOf(snapshot);

  it('identical content → the rules last changed when the snapshot captured them', () => {
    assert.deepEqual(dateLiveRules(csv('course_id,title\r\nCSE 60001,Alpha\r\n'), meta), { kind: 'known', at: snapshot.syncedAt });
    // Line endings are not content, for the fingerprints as for the text.
    assert.deepEqual(dateLiveRules(csv('course_id,title\nCSE 60001,Alpha\n\n'), meta), { kind: 'known', at: snapshot.syncedAt });
  });

  it('an optional tab that failed to load counts as matching; one that appeared or vanished does not', () => {
    const withExternal = snapshotMetaOf({ ...snapshot, csv: { ...snapshot.csv, external: 'university,course_id\r\nX,Y\r\n' } });
    // Live has no `external` (it failed) — named as such, it matches.
    assert.deepEqual(dateLiveRules(csv('course_id,title\r\nCSE 60001,Alpha\r\n'), withExternal, ['external']), { kind: 'known', at: snapshot.syncedAt });
    // Not named — it vanished, which is a change.
    assert.equal(dateLiveRules(csv('course_id,title\r\nCSE 60001,Alpha\r\n'), withExternal).kind, 'after');
    // The snapshot has none and the live sheet has one — a change too.
    assert.equal(dateLiveRules({ ...csv('course_id,title\r\nCSE 60001,Alpha\r\n'), external: 'university,course_id\r\nX,Y\r\n' }, meta).kind, 'after');
  });

  it('ignores line-ending and trailing-whitespace differences (never a real edit)', () => {
    assert.equal(sameCsvContent(csv('course_id,title\nCSE 60001,Alpha\n\n'), snapshot.csv), true);
    assert.equal(sameCsvContent(csv('course_id,title\r\nCSE 60001,Alpha'), snapshot.csv), true);
  });

  it('a real edit in any tab → "after", naming the tab', () => {
    assert.deepEqual(dateLiveRules(csv('course_id,title\r\nCSE 60001,Alpha\r\nCSE 60002,Beta\r\n'), meta), {
      kind: 'after',
      at: snapshot.syncedAt,
    });
    assert.deepEqual(changedTabs(snapshot.csv, csv('course_id,title\r\nCSE 60001,Alpha\r\n', 'key,value\r\nx,2\r\n')), ['parameters']);
    assert.deepEqual(changedTabs(snapshot.csv, csv('x', 'y', 'z')), ['courses', 'parameters', 'categories']);
    assert.deepEqual(changedTabs(snapshot.csv, snapshot.csv), []);
  });
});

describe('date formatting', () => {
  it('formats dates for humans and rejects bad input', () => {
    assert.match(formatDateLong('2026-09-01T12:00:00Z') ?? '', /2026$/);
    assert.equal(formatDateLong('not a date'), undefined);
    assert.equal(formatDateLong(undefined), undefined);
  });
});

// One date rather than the same date twice, and only while the LIVE sheet is
// showing (trim review P-13, 2026-09-18). The saved-copy case above keeps both
// dates on purpose: there they are different facts.
describe('the dated line does not print one date twice', () => {
  const params = { raw: new Map<string, { value: string }>() };
  it('live, sheet last changed today: one date', () => {
    const line = rulesDateLine({ parameters: params, rulesDate: { kind: 'known', at: '2026-09-18T04:00:00Z' }, source: 'live', syncedAt: '2026-09-18T04:00:00Z' }, 'Fall 2026', '2026-09-18');
    assert.equal(line, 'The course rules here were last updated on September 18, 2026.');
  });
  it('live, sheet last changed earlier: both dates', () => {
    const line = rulesDateLine({ parameters: params, rulesDate: { kind: 'known', at: '2026-09-16T04:00:00Z' }, source: 'live', syncedAt: '2026-09-16T04:00:00Z' }, 'Fall 2026', '2026-09-18');
    assert.equal(line, 'The course rules here were last updated on September 16, 2026, and are up-to-date as of September 18, 2026.');
  });
});
