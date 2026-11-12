// A killed fuzz run skips its finally, so the next run removes what it left, and only that.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test } from 'node:test';

import { runDirectory } from './fuzz-temp.mts';

test('a run removes the directories of gone runs and keeps those of live runs and other names', { timeout: 30_000 }, (t) => {
  const root = mkdtempSync(join(tmpdir(), 'php-serialization-fuzz-test-'));
  t.after(() => { rmSync(root, { recursive: true, force: true }); });
  const gone = spawnSync(process.execPath, ['-e', '']).pid;
  const left = join(root, `php-serialization-fuzz-${String(gone)}-abc`);
  const live = join(root, `php-serialization-fuzz-${String(process.pid)}-abc`);
  const other = join(root, 'php-serialization-fuzz-abc');
  for (const directory of [left, live, other]) mkdirSync(directory);

  const own = runDirectory(root);

  assert.equal(existsSync(left), false);
  assert.equal(existsSync(live), true);
  assert.equal(existsSync(other), true);
  assert.equal(existsSync(own), true);
  assert.ok(basename(own).startsWith(`php-serialization-fuzz-${String(process.pid)}-`));
});
