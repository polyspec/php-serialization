// The rehearsal target of the Go module needs the release recipes that `make release-recipes` writes into packages/release.mk
// (T2.56): its recipe runs rehearse-go-module, which only that file defines. A new checkout has no such file, so the target
// must run release-recipes first. The test copies the tracked files of the repository, which holds no packages/release.mk,
// and reads the dry run of the target: the first command that make prints is the release-recipes of the binding.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('the rehearsal target of the Go module runs release-recipes before rehearse-go-module (T2.56)', (t) => {
  const copy = mkdtempSync(join(tmpdir(), 'php-serialization-release-recipes-'));
  t.after(() => { rmSync(copy, { recursive: true, force: true }); });
  const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter((path) => path !== '');
  for (const path of tracked) {
    mkdirSync(join(copy, dirname(path)), { recursive: true });
    cpSync(join(root, path), join(copy, path));
  }
  let stdout: string;
  try {
    stdout = execFileSync('make', ['--dry-run', '--no-print-directory', 'release-go-module-rehearsal'], { cwd: copy, encoding: 'utf8', env: { ...process.env, MAKEFLAGS: '', MAKELEVEL: '' }, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (error) {
    // The dry run of the recipe that runs rehearse-go-module fails while packages/release.mk is absent; the output before it counts.
    stdout = (error as { stdout?: string }).stdout ?? '';
  }
  const first = stdout.split('\n').find((line) => line.trim() !== '') ?? '';
  if (!/release-recipes --root/.test(first)) {
    throw new Error(`the first command of the rehearsal target is not release-recipes, but: ${first || '(none; make stopped before printing a command)'}`);
  }
});
