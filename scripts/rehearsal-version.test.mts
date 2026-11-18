// The version of the rehearsal (rehearsal-version.mts) on the input shapes of the change log that release-run tags: the
// version first, Unreleased first and then the version, a heading with a tail, no version, and a leading zero.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rehearsalVersion } from './rehearsal-version.mts';

test('the rehearsal names the first version heading of the change log', () => {
  assert.equal(rehearsalVersion('# Changelog\n\n## 0.0.16\n\n## 0.0.15\n'), 'v0.0.16');
});

test('the rehearsal skips an Unreleased heading that comes first', () => {
  assert.equal(rehearsalVersion('# Changelog\n\n## Unreleased\n\n## 0.0.16\n\n## 0.0.15\n'), 'v0.0.16');
});

test('the rehearsal refuses a version heading with a tail', () => {
  assert.throws(() => rehearsalVersion('## 0.0.16 (2026-01-01)\n\n## 0.0.15\n'), /is not X\.Y\.Z/);
});

test('the rehearsal refuses a change log with no version after Unreleased', () => {
  assert.throws(() => rehearsalVersion('## Unreleased\n'), /no ## heading after it/);
});

test('the rehearsal refuses a change log with no ## heading', () => {
  assert.throws(() => rehearsalVersion('# Changelog\n'), /has no ## heading/);
});

test('the rehearsal refuses a version with a leading zero', () => {
  assert.throws(() => rehearsalVersion('## 01.0.0\n'), /is not X\.Y\.Z/);
});
