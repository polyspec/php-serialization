// Two facts of the new checkout that the rehearsal of the Go module needs, checked on a copy of the tracked files, which holds
// no packages/release.mk (T2.56, T2.57). The rehearsal target runs rehearse-go-module, which only that file, written by
// `make release-recipes`, defines, so the target must run release-recipes first. The shared job runs `make ci-shared`, whose
// targets need go, so its install of the tools must name go.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// A copy of the tracked files, removed after the test, and the dry run of a target in it: the output of make, whether or not
// make stops with an error, since the rehearsal stops while packages/release.mk is absent.
function dryRunOfTracked(t: { after: (fn: () => void) => void }, prefix: string, target: string): string {
  const copy = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => { rmSync(copy, { recursive: true, force: true }); });
  const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter((path) => path !== '');
  for (const path of tracked) {
    mkdirSync(join(copy, dirname(path)), { recursive: true });
    cpSync(join(root, path), join(copy, path));
  }
  try {
    return execFileSync('make', ['--dry-run', '--no-print-directory', target], { cwd: copy, encoding: 'utf8', env: { ...process.env, MAKEFLAGS: '', MAKELEVEL: '' }, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (error) {
    return (error as { stdout?: string }).stdout ?? '';
  }
}

test('the rehearsal target of the Go module runs release-recipes before rehearse-go-module (T2.56)', (t) => {
  const stdout = dryRunOfTracked(t, 'php-serialization-release-recipes-', 'release-go-module-rehearsal');
  const first = stdout.split('\n').find((line) => line.trim() !== '') ?? '';
  if (!/release-recipes --root/.test(first)) {
    throw new Error(`the first command of the rehearsal target is not release-recipes, but: ${first || '(none; make stopped before printing a command)'}`);
  }
});

test('the shared job installs the go tool that the rehearsal of the Go module of CI_SHARED needs (T2.57)', (t) => {
  const dryRun = dryRunOfTracked(t, 'php-serialization-shared-tools-', 'ci-shared');
  const line = /install-tools TOOLS="([^"]*)"/.exec(dryRun);
  assert.ok(line, 'the dry run of ci-shared installs no tools with a TOOLS list');
  const tools = (line[1] ?? '').split(' ');
  assert.ok(tools.includes('go'), `the tools of the shared job are "${tools.join(' ')}", without go, which the rehearsal of the Go module needs`);
});
