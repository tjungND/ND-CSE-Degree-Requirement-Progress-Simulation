// The saved copy's meta (data/snapshot-meta.json, W1 2026-10-22): the build
// writes it from data/snapshot.json, the page dates the live rules by it.
// These tests pin that the meta of the committed snapshot is what the build
// will emit, that each reader refuses a file of the wrong shape, and that a
// tab's fingerprint ignores exactly what `sameCsvContent` ignores.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { rulesFingerprint, tabFingerprint } from '../src/data/fingerprint.ts';
import { sameCsvContent } from '../src/data/rules-date.ts';
import { dateLiveRules, readRulesSnapshot, readSnapshotMeta, snapshotMetaOf, SNAPSHOT_TABS } from '../src/data/snapshot-meta.ts';

const raw = JSON.parse(readFileSync(new URL('../data/snapshot.json', import.meta.url), 'utf8')) as unknown;

describe('the saved copy’s meta (data/snapshot-meta.json)', () => {
  it('the committed snapshot reads as one, and its meta has a fingerprint per tab it holds', () => {
    const snapshot = readRulesSnapshot(raw);
    assert.ok(snapshot, 'data/snapshot.json must be a rules snapshot');
    const meta = snapshotMetaOf(snapshot);
    assert.equal(meta.syncedAt, snapshot.syncedAt);
    for (const tab of SNAPSHOT_TABS) {
      if (snapshot.csv[tab] === undefined) assert.equal(meta.tabs[tab], undefined, tab);
      else assert.match(meta.tabs[tab]!, /^[0-9a-f]{8}$/, tab);
    }
    // The JSON the build emits round-trips through the page's reader.
    assert.deepEqual(readSnapshotMeta(JSON.parse(JSON.stringify(meta))), meta);
    // Small: this is what every visit fetches instead of the 97 KB snapshot.
    assert.ok(JSON.stringify(meta).length < 400, JSON.stringify(meta));
    // The live rules, identical to the copy, are dated `known` by the meta.
    assert.deepEqual(dateLiveRules(snapshot.csv, meta), { kind: 'known', at: snapshot.syncedAt });
  });

  it('a tab’s fingerprint ignores what sameCsvContent ignores, and nothing else', () => {
    const a = 'course_id,title\r\nCSE 60001,Alpha\r\n';
    const b = 'course_id,title\nCSE 60001,Alpha\n\n';
    const c = 'course_id,title\nCSE 60001,Alpha\nCSE 60002,Beta\n';
    assert.equal(tabFingerprint(a), tabFingerprint(b));
    assert.equal(sameCsvContent({ courses: a, parameters: '', categories: '' }, { courses: b, parameters: '', categories: '' }), true);
    assert.notEqual(tabFingerprint(a), tabFingerprint(c));
    // The whole-rules fingerprint (the stamp) is unchanged by the refactor
    // that gave the per-tab one: a known input, a known answer.
    assert.equal(rulesFingerprint({ courses: a, parameters: 'key,value\r\nx,1\r\n', categories: 'g\r\n' }), rulesFingerprint({ courses: b, parameters: 'key,value\nx,1', categories: 'g' }));
  });

  it('refuses files of the wrong shape rather than guessing', () => {
    assert.equal(readSnapshotMeta(undefined), undefined);
    assert.equal(readSnapshotMeta('<!doctype html>'), undefined);
    assert.equal(readSnapshotMeta({ syncedAt: 'x' }), undefined);
    assert.equal(readSnapshotMeta({ syncedAt: 'x', tabs: { courses: 'a', parameters: 'b' } }), undefined, 'a required tab missing');
    assert.equal(readSnapshotMeta({ syncedAt: 'x', tabs: { courses: 1, parameters: 'b', categories: 'c' } }), undefined, 'a non-string fingerprint');
    assert.deepEqual(readSnapshotMeta({ syncedAt: 'x', tabs: { courses: 'a', parameters: 'b', categories: 'c', extra: 'ignored' } }), { syncedAt: 'x', tabs: { courses: 'a', parameters: 'b', categories: 'c' } });
    assert.equal(readRulesSnapshot(undefined), undefined);
    assert.equal(readRulesSnapshot({ syncedAt: 'x', csv: { courses: 'a', parameters: 'b' } }), undefined, 'a required tab missing');
    assert.equal(readRulesSnapshot({ syncedAt: 'x', csv: { courses: 'a', parameters: 'b', categories: 'c', external: 5 } }), undefined, 'an optional tab that is not text');
    assert.deepEqual(readRulesSnapshot({ syncedAt: 'x', csv: { courses: 'a', parameters: 'b', categories: 'c' } }), { syncedAt: 'x', csv: { courses: 'a', parameters: 'b', categories: 'c' } });
  });
});
