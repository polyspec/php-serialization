// Runs binding at the commit that Cargo.lock pins: node scripts/binding.mts <check|scaffold|generate> [arguments]
//
// Before its first release binding is a Git dependency (binding design L-2), and only its crate polyspec-binding-core
// is a Cargo package; the command-line tool is the TypeScript package packages/ts of the same repository, which no
// package registry holds yet. So the tool comes from the checkout that Cargo made of the pinned commit: its
// packages/ts, without node_modules, is copied into var/binding/<commit>, where npm installs the dependencies that the
// tool's package-lock.json pins. The commit is that of Cargo.lock, so the generator and binding_core are one version
// (G-6). This is not the usual way to install a tool (AGENTS.md, "Bindings"); it ends when binding is released.

import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const metadata = JSON.parse(
  execFileSync('cargo', ['metadata', '--format-version', '1', '--locked', '--manifest-path', join(root, 'Cargo.toml')], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  }),
) as { packages: { name: string; source: string | null; manifest_path: string }[] };
const core = metadata.packages.find((p) => p.name === 'polyspec-binding-core');
if (core === undefined || core.source === null) throw new Error('Cargo.lock has no Git dependency polyspec-binding-core');
const commit = /#([0-9a-f]{40})$/.exec(core.source)?.[1];
if (commit === undefined) throw new Error(`polyspec-binding-core has no pinned commit: ${core.source}`);

// The crate is packages/core/rust of the binding repository; the tool is packages/ts beside it.
const checkout = resolve(dirname(core.manifest_path), '../../..');
const tool = join(root, 'var/binding', commit);
if (!existsSync(join(tool, 'node_modules'))) {
  rmSync(tool, { recursive: true, force: true });
  cpSync(join(checkout, 'packages/ts'), tool, { recursive: true, filter: (from) => !from.includes('/node_modules') });
  execFileSync('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--omit=dev'], { cwd: tool, stdio: 'inherit' });
}

const result = spawnSync(process.execPath, [join(tool, 'src/cli.ts'), ...process.argv.slice(2)], { cwd: root, stdio: 'inherit' });
process.exit(result.status ?? 1);
