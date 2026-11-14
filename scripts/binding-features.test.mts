// The recipes of the bindings build each binding crate with every feature of its manifest, which binding scaffold
// writes (binding GN-5): a crate built without one has no entry point that the generated tests call (case-test,
// codec-test). The test reads what make would run, a dry run of the recipes on a copy of the Makefile and the manifests
// (HR-83, HR-85), so no recipe runs.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Each binding crate: its manifest and the line of the dry run that builds it.
const CRATES = [
  { manifest: 'packages/python/Cargo.toml', target: 'test-python-binding', build: /\bmaturin build .*--features (\S+)/ },
  { manifest: 'packages/ts/Cargo.toml', target: 'node-package', build: /^cargo build .*-p polyspec-php-serialization-node .*--features (\S+)/ },
  { manifest: 'packages/ts/wasm/Cargo.toml', target: 'node-package', build: /^cargo build .*-p polyspec-php-serialization-wasm .*--features (\S+)/ },
  { manifest: 'packages/php-ext/Cargo.toml', target: 'test-php', build: /^cargo build .*-p polyspec-php-serialization-php-ext .*--features (\S+)/ },
  { manifest: 'packages/go/internal/ffi/Cargo.toml', target: 'test-go', build: /^cargo build .*-p polyspec-php-serialization-go .*--features (\S+)/ },
] as const;

// The names of the [features] table of a manifest, without default.
function features(text: string): string[] {
  const table = /\n\[features\]\n([\s\S]*?)(?:\n\[|$)/.exec(text)?.[1] ?? '';
  return [...table.matchAll(/^([a-z][a-z0-9-]*) = /gm)].map((m) => m[1] ?? '').filter((name) => name !== 'default').sort();
}

// A copy of the Makefile and the manifests that the recipes read, removed after the test, and the dry run of targets in it
// with the variables `env` added to the environment.
function dryRunOfCopy(t: { after: (fn: () => void) => void }, prefix: string, env: NodeJS.ProcessEnv = {}): (...targets: string[]) => string[] {
  const copy = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => { rmSync(copy, { recursive: true, force: true }); });
  for (const path of ['Makefile', 'packages/ts/package.json', 'packages/go/go.mod', ...CRATES.map((c) => c.manifest)]) {
    mkdirSync(join(copy, dirname(path)), { recursive: true });
    cpSync(join(root, path), join(copy, path));
  }
  return (...targets) => execFileSync('make', ['--dry-run', '--no-print-directory', ...targets], { cwd: copy, encoding: 'utf8', env: { ...process.env, MAKEFLAGS: '', MAKELEVEL: '', ...env }, stdio: ['ignore', 'pipe', 'ignore'] }).split('\n');
}

test('each binding crate is built, and the workspace linted, with every feature of the manifests (binding GN-5)', (t) => {
  const dryRun = dryRunOfCopy(t, 'php-serialization-features-');
  const lines = dryRun(...new Set(CRATES.map((c) => c.target)), 'lint-bindings');
  const union = new Set<string>();
  for (const crate of CRATES) {
    const declared = features(readFileSync(join(root, crate.manifest), 'utf8'));
    for (const name of declared) union.add(name);
    assert.ok(declared.includes('panic-test'), `${crate.manifest} declares no feature panic-test`);
    const built = lines.map((line) => crate.build.exec(line)?.[1]).filter((found) => found !== undefined);
    assert.equal(built.length, 1, `make ${crate.target} builds ${crate.manifest} once, not ${String(built.length)} times:\n${lines.join('\n')}`);
    assert.deepEqual(built[0]?.split(',').sort(), declared, `make ${crate.target} builds ${crate.manifest} with the features ${built[0] ?? ''}, its manifest declares ${declared.join(',')}`);
  }
  const lint = lines.map((line) => /^cargo clippy --workspace .*--features (\S+)/.exec(line)?.[1]).filter((found) => found !== undefined);
  assert.equal(lint.length, 1, `make lint-bindings runs clippy once:\n${lines.join('\n')}`);
  assert.deepEqual(lint[0]?.split(',').sort(), [...union].sort(), `make lint-bindings lints with ${lint[0] ?? ''}, the manifests declare ${[...union].sort().join(',')}`);
});

test('only php-serialization-install-rust installs binding, and the binding recipes install packages offline (HR-89)', (t) => {
  const dryRun = dryRunOfCopy(t, 'php-serialization-offline-');
  const install = dryRun('php-serialization-install-rust');
  assert.ok(install.some((line) => line.endsWith('scripts/binding.mts install')), `make php-serialization-install-rust does not install binding:\n${install.join('\n')}`);
  const recipes = dryRun('test-python-binding', 'node-package', 'test-php', 'test-go', 'lint-bindings', 'check-declarations');
  const online = recipes.filter((line) => /\bnpm (?:install|ci)\b/.test(line) && !line.includes('--offline'));
  assert.deepEqual(online, [], 'a binding recipe installs npm packages without --offline');
  const index = recipes.filter((line) => /\bpip install\b/.test(line) && !line.includes('--no-index') && !line.includes('--offline'));
  assert.deepEqual(index, [], 'a binding recipe installs Python packages from an index');
});

test('the binding recipes read the libraries that cargo builds from the CARGO_TARGET_DIR of the environment', (t) => {
  const target = join(tmpdir(), 'php-serialization-cargo-target');
  const dryRun = dryRunOfCopy(t, 'php-serialization-target-', { CARGO_TARGET_DIR: target });
  const lines = dryRun('node-package', 'test-php', 'test-go');
  for (const library of [`${target}/debug/libpolyspec_php_serialization_node.`, `extension=${target}/debug/libpolyspec_php_serialization.`, `CGO_LDFLAGS=-L${target}/debug `]) {
    assert.ok(lines.some((line) => line.includes(library)), `no recipe reads ${library}:\n${lines.join('\n')}`);
  }
});
