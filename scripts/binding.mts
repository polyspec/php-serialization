// Runs binding at the commit that Cargo.lock pins: node scripts/binding.mts <check|scaffold|generate> [arguments]
//
// Before its first release binding is a Git dependency (binding design L-2), and only its crate polyspec-binding-core
// is a Cargo package; the command-line tool is the TypeScript package packages/ts of the same repository, which no
// package registry holds yet. So the tool comes from the checkout that Cargo made of the pinned commit: that checkout
// is cloned into var/binding/<commit>, where npm installs the dependencies that the tool's package-lock.json pins. The
// clone is a Git checkout of binding at that commit, which is how binding check knows its own commit and compares it
// with the commit of Cargo.lock (CK-20); a copy of the files alone has no commit, and the check fails it. The commit
// is that of Cargo.lock, so the generator and binding_core are one version (G-6). This is not the usual way to install
// a tool; it ends when binding is released.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
// The metadata is read as unknown JSON and narrowed by checks (K157, K158).
const metadata: unknown = JSON.parse(
  execFileSync('cargo', ['metadata', '--format-version', '1', '--locked', '--manifest-path', join(root, 'Cargo.toml')], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    // The metadata of a workspace with the binding crates passes the default buffer of one megabyte.
    maxBuffer: 1 << 28,
  }),
);
const packages: unknown = typeof metadata === 'object' && metadata !== null && 'packages' in metadata ? metadata.packages : undefined;
if (!Array.isArray(packages)) throw new Error('cargo metadata gave no list of packages');
const core: unknown = packages.find((p: unknown) => typeof p === 'object' && p !== null && 'name' in p && p.name === 'polyspec-binding-core');
const source: unknown = typeof core === 'object' && core !== null && 'source' in core ? core.source : undefined;
const manifestPath: unknown = typeof core === 'object' && core !== null && 'manifest_path' in core ? core.manifest_path : undefined;
if (typeof source !== 'string' || typeof manifestPath !== 'string') throw new Error('Cargo.lock has no Git dependency polyspec-binding-core');
const commit = /#([0-9a-f]{40})$/.exec(source)?.[1];
if (commit === undefined) throw new Error(`polyspec-binding-core has no pinned commit: ${source}`);

// The crate is packages/core/rust of the binding repository; the tool is packages/ts beside it.
const checkout = resolve(dirname(manifestPath), '../../..');
const tool = join(root, 'var/binding', commit);
const packageDir = join(tool, 'packages/ts');
if (!existsSync(join(packageDir, 'node_modules'))) {
  rmSync(tool, { recursive: true, force: true });
  execFileSync('git', ['clone', '--quiet', '--no-checkout', checkout, tool], { stdio: 'inherit' });
  execFileSync('git', ['-C', tool, '-c', 'advice.detachedHead=false', 'checkout', '--quiet', '--detach', commit], { stdio: 'inherit' });
  execFileSync('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--omit=dev'], { cwd: packageDir, stdio: 'inherit' });
}

const result = spawnSync(process.execPath, [join(packageDir, 'src/cli.ts'), ...process.argv.slice(2)], { cwd: root, stdio: 'inherit' });
process.exit(result.status ?? 1);
