// The recipes of the per-platform assets of the release of the bindings (binding GN-19 to GN-19g; row T2.7): each builds
// the asset of the platform of its host with a standard tool. A case runs the recipe on a copy of the Makefile in a
// directory of its own, with stand-ins of rustc, cargo, the llvm-strip of the toolchain, PHP, zip and uv that the case
// writes, so it builds nothing: the stand-ins record their arguments and write the files that the real tools write.
// The copy reads the node and npm of var/tools of the checkout, which make install-tools installs.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** The value of `key` of the JSON object of the text `text`, or undefined when the text holds no object. */
function field(text: string, key: string): unknown {
  const json: unknown = JSON.parse(text);
  return typeof json === 'object' && json !== null ? Object.entries(json).find(([name]) => name === key)?.[1] : undefined;
}

// The version of the npm package, which its platform packages share.
const VERSION = String(field(readFileSync(path.join(ROOT, 'packages/ts/package.json'), 'utf8'), 'version'));

// The platforms of a release (GN-19a): the Rust triple of the host, the directory of the Go module that holds its
// library, the part of the name of a PHP extension archive that names the platform, and for a Linux host the musl triple
// of its arch, whose Go library the same runner builds (GN-19b).
const PLATFORMS = [
  { triple: 'x86_64-unknown-linux-gnu', platform: 'linux-x64-gnu', go: 'linux_amd64', pie: 'x86_64-linux-glibc', musl: 'x86_64-unknown-linux-musl' },
  { triple: 'aarch64-unknown-linux-gnu', platform: 'linux-arm64-gnu', go: 'linux_arm64', pie: 'arm64-linux-glibc', musl: 'aarch64-unknown-linux-musl' },
  { triple: 'aarch64-apple-darwin', platform: 'darwin-arm64', go: 'darwin_arm64', pie: 'arm64-darwin-bsdlibc', musl: undefined },
] as const;

/** The PHP of a case: its minor, whether it is a thread-safe or a debug build, and whether the extension fails to load. */
interface Php {
  minor: string;
  zts?: boolean;
  debug?: boolean;
  loadFails?: boolean;
}

// The commit time of HEAD in a sandbox and its seconds since the epoch.
const COMMIT_DATE = '2026-01-02T03:04:05Z';
const COMMIT_EPOCH = String(Date.parse(COMMIT_DATE) / 1000);

/** A copy of the Makefile with the stand-ins of one case. */
interface Sandbox {
  dir: string;
  /** The folder of the stand-ins of the case, which PATH names. */
  bin: string;
  env: NodeJS.ProcessEnv;
  /** The commands that the stand-ins received, each as its words, the first the name of the program. */
  calls: () => string[][];
}

/** Writes an executable shell script `file` with the lines `text`, after the PATH of the system. */
function program(file: string, text: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `#!/bin/sh\nPATH=/usr/bin:/bin\n${text}`);
  chmodSync(file, 0o755);
}

/** The environment of a make run, with no inherited make flags. */
function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.MAKEFLAGS;
  delete env.MAKELEVEL;
  delete env.MFLAGS;
  return env;
}

/**
 * Makes the sandbox of a case whose host is the Rust triple `host`. rustc prints that host and the sysroot of the case;
 * cargo writes the library of the crate into the target directory that CARGO_TARGET_DIR names; the llvm-strip of the
 * sysroot replaces the file that it strips with the word stripped, or fails when `stripFails`; a strip on PATH records
 * its call.
 */
function sandbox(t: TestContext, host: string, stripFails = false, php: Php = { minor: '8.4' }): Sandbox {
  const tmp = mkdtempSync(path.join(tmpdir(), 'php-serialization-release-'));
  t.after(() => { rmSync(tmp, { recursive: true, force: true }); });
  const dir = path.join(tmp, 'repo');
  mkdirSync(dir, { recursive: true });
  copyFileSync(path.join(ROOT, 'Makefile'), path.join(dir, 'Makefile'));
  // The node and npm of the checkout, and no other tool of it, so that PATH finds the stand-ins of the case.
  mkdirSync(path.join(dir, 'var/tools/bin'), { recursive: true });
  for (const tool of ['node', 'npm']) symlinkSync(path.join(ROOT, 'var/tools/bin', tool), path.join(dir, 'var/tools/bin', tool));
  // The manifests whose versions the Makefile reads when it starts.
  for (const file of ['packages/ts/package.json', 'packages/go/go.mod']) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    copyFileSync(path.join(ROOT, file), path.join(dir, file));
  }
  mkdirSync(path.join(dir, 'packages/ts/wasm'), { recursive: true });
  writeFileSync(path.join(dir, 'packages/ts/wasm/Cargo.toml'), '[dependencies]\nwasm-bindgen = "=0.2.999"\n');
  const bin = path.join(tmp, 'bin');
  const sysroot = path.join(tmp, 'sysroot');
  const calls = path.join(tmp, 'calls');
  const record = `line=$(basename "$0"); for word in "$@"; do line="$line\t$word"; done; printf '%s\\n' "$line" >> '${calls}'\n`;
  program(path.join(bin, 'rustc'), `${record}case "$*" in
'--print host-tuple') echo '${host}' ;;
'--print sysroot') echo '${sysroot}' ;;
*) exit 9 ;;
esac
`);
  // cargo pkgid prints the package id of the PHP extension at the version of a release; cargo build writes the library
  // of the crate that -p names, the cdylib of the extension under the name of either platform.
  program(path.join(bin, 'cargo'), `${record}case "$1" in
pkgid) echo 'path+file:///checkout/packages/php-ext#polyspec-php-serialization-php-ext@1.2.3'; exit 0 ;;
esac
printf 'cargo\\tCARGO_TARGET_DIR=%s\\tPHP=%s\\tPHP_CONFIG=%s\\n' "$CARGO_TARGET_DIR" "$PHP" "$PHP_CONFIG" >> '${calls}'
mkdir -p "$CARGO_TARGET_DIR/release"
case "$*" in
*polyspec-php-serialization-go*--target*) triple=$(for word in "$@"; do [ "$previous" = --target ] && echo "$word"; previous=$word; done); mkdir -p "$CARGO_TARGET_DIR/$triple/release" && printf 'musl library with debug sections\\n' > "$CARGO_TARGET_DIR/$triple/release/libpolyspec_php_serialization_go.a" ;;
*polyspec-php-serialization-go*) printf 'library with debug sections\\n' > "$CARGO_TARGET_DIR/release/libpolyspec_php_serialization_go.a" ;;
*polyspec-php-serialization-php-ext*) for ext in so dylib; do printf 'extension\\n' > "$CARGO_TARGET_DIR/release/libpolyspec_php_serialization.$ext"; done ;;
*polyspec-php-serialization-wasm*) mkdir -p "$CARGO_TARGET_DIR/wasm32-unknown-unknown/release" && printf 'wasm\\n' > "$CARGO_TARGET_DIR/wasm32-unknown-unknown/release/polyspec_php_serialization_wasm.wasm" ;;
esac
`);
  // The PHP of the case answers the code of -r: its minor, its build, and the load check, which reads the extension of -d.
  program(path.join(bin, 'php'), `${record}for code in "$@"; do :; done
case "$code" in
*PHP_MINOR_VERSION*) if [ -f '${path.join(tmp, 'minor')}' ]; then cat '${path.join(tmp, 'minor')}'; else printf '%s' '${php.minor}'; fi ;;
*PHP_ZTS*) printf '%s' '${php.debug === true ? '-debug' : ''}-${php.zts === true ? 'zts' : 'nts'}' ;;
*extension_loaded*) ${php.loadFails === true ? 'exit 1' : 'case "$3" in extension=/*) test "$(cat "${3#extension=}")" = extension ;; *) exit 1 ;; esac'} ;;
*) exit 9 ;;
esac
`);
  program(path.join(bin, 'php-config'), record);
  // zip records its directory and writes the archive that it names.
  program(path.join(bin, 'zip'), `${record}printf 'zip\\tPWD=%s\\n' "$PWD" >> '${calls}'
printf 'zip of %s\\n' "$5" > "$4"
`);
  program(path.join(bin, 'strip'), record);
  program(path.join(bin, 'gh'), record);
  program(path.join(sysroot, 'lib/rustlib', host, 'bin/llvm-strip'), `${record}${stripFails ? 'exit 1\n' : `for last in "$@"; do :; done; printf 'stripped\\n' > "$last"\n`}`);
  // The uv of the checkout, which the Makefile starts by its path in var/tools: it records the environment of maturin
  // and writes a wheel into the directory of --out-dir.
  program(path.join(dir, 'var/tools/mise/shims/uv'), `${record}printf 'uv\\tCARGO_TARGET_DIR=%s\\tMATURIN_PEP517_ARGS=%s\\tSOURCE_DATE_EPOCH=%s\\n' "$CARGO_TARGET_DIR" "$MATURIN_PEP517_ARGS" "$SOURCE_DATE_EPOCH" >> '${calls}'
while [ "$1" != --out-dir ]; do shift; done
mkdir -p "$2" && printf 'wheel\\n' > "$2/polyspec_php_serialization-1.2.3-cp314-abi3-platform.whl"
`);
  // The napi CLI of the root package.json, by its bin link: build writes the addon of the platform of --target into
  // --output-dir, create-npm-dirs writes the package of each platform of the configuration into --npm-dir, and artifacts
  // copies the addon into it. Each records the configuration that --config-path names.
  program(path.join(dir, 'node_modules/.bin/napi'), `${record}option() { while [ $# -gt 1 ] && [ "$1" != "$name" ]; do shift; done; [ "$1" = "$name" ] && printf '%s' "$2"; }
platform() { case "$1" in
x86_64-unknown-linux-gnu) echo linux-x64-gnu ;; aarch64-unknown-linux-gnu) echo linux-arm64-gnu ;; aarch64-apple-darwin) echo darwin-arm64 ;; esac; }
command=$1
name=--config-path; config=$(option "$@")
[ -n "$config" ] && printf 'napi-config\\t%s\\n' "$(cat "$config")" >> '${calls}'
name=--output-dir; addons=$(option "$@")
name=--npm-dir; npm=$(option "$@")
case "$command" in
build) name=--target; triple=$(option "$@"); mkdir -p "$addons" && printf 'addon\\n' > "$addons/php-serialization.$(platform "$triple").node" ;;
create-npm-dirs) for triple in $(sed 's/.*\\[//; s/\\].*//; s/[",]/ /g' "$config"); do p=$(platform "$triple"); mkdir -p "$npm/$p"; printf '{"name":"@polyspec/php-serialization-%s","version":"${VERSION}","main":"php-serialization.%s.node","files":["php-serialization.%s.node"]}\\n' "$p" "$p" "$p" > "$npm/$p/package.json"; done ;;
artifacts) for folder in "$npm"/*; do cp "$addons/php-serialization.$(basename "$folder").node" "$folder/"; done ;;
*) exit 9 ;;
esac
`);
  // The wasm-bindgen of WASM_BINDGEN: it prints the release of packages/ts/wasm/Cargo.toml of the copy and writes the
  // files of the binding.
  program(path.join(bin, 'wasm-bindgen'), `${record}case "$1" in --version) echo 'wasm-bindgen 0.2.999'; exit 0 ;; esac
while [ "$1" != --out-dir ]; do shift; done
mkdir -p "$2" && for file in php_serialization_wasm.js php_serialization_wasm.d.ts php_serialization_wasm_bg.wasm; do printf 'bound\\n' > "$2/$file"; done
`);
  // The generated files of the npm package, which the generation of the Node and the WASM binding write.
  for (const file of ['generated/index.cjs', 'generated/index.mjs', 'generated/index.d.ts', 'wasm/generated/index.mjs', 'wasm/generated/index.d.ts', 'wasm/generated/state.mjs', 'wasm/generated/lib.rs']) {
    mkdirSync(path.dirname(path.join(dir, 'packages/ts', file)), { recursive: true });
    writeFileSync(path.join(dir, 'packages/ts', file), `${file}\n`);
  }
  // The git of PATH records a push and runs the git of the system for every other command.
  program(path.join(bin, 'git'), `case "$1" in push) ${record}exit 0 ;; esac\nexec /usr/bin/git "$@"\n`);
  // A stand-in of binding: it records its arguments and the folders of the libraries, prints the reference that the case
  // names in the file ref and fails when the case wrote the file fails.
  writeFileSync(path.join(tmp, 'binding.mjs'), `import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(calls)}, ['binding', ...args].join('\\t') + '\\n');
const libraries = args[args.indexOf('--libraries') + 1];
appendFileSync(${JSON.stringify(calls)}, ['libraries', ...(existsSync(libraries) ? readdirSync(libraries).sort() : [])].join('\\t') + '\\n');
const ref = ${JSON.stringify(path.join(tmp, 'ref'))};
if (existsSync(ref)) process.stdout.write(readFileSync(ref, 'utf8'));
process.exit(existsSync(${JSON.stringify(path.join(tmp, 'fails'))}) ? 1 : 0);
`);
  // The commit of HEAD, whose time is the SOURCE_DATE_EPOCH of a wheel.
  const gitEnv = { ...cleanEnv(), GIT_AUTHOR_DATE: COMMIT_DATE, GIT_COMMITTER_DATE: COMMIT_DATE, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' };
  execFileSync('git', ['init', '-q', dir], { env: gitEnv });
  execFileSync('git', ['-C', dir, 'commit', '-q', '--allow-empty', '-m', 'release'], { env: gitEnv });
  return {
    dir,
    bin,
    env: { ...cleanEnv(), PATH: `${bin}:/usr/bin:/bin` },
    calls: () => (existsSync(calls) ? readFileSync(calls, 'utf8').split('\n').filter((line) => line !== '').map((line) => line.split('\t')) : []),
  };
}

/** Runs make with `args` in the sandbox. */
function make(box: Sandbox, args: string[]): SpawnSyncReturns<string> {
  return spawnSync('make', ['--no-print-directory', ...args], { cwd: box.dir, encoding: 'utf8', env: box.env });
}

/** The entries of the folder `dir`, one per line. */
function entries(dir: string): string {
  return spawnSync('ls', ['-A', dir], { encoding: 'utf8' }).stdout;
}

/** Requires the dry run of `target` to print the generation of `binding` before the line that `build` matches. */
function generatesFirst(t: TestContext, target: string, binding: string, build: (line: string) => boolean, args: string[] = []): void {
  const box = sandbox(t, 'x86_64-unknown-linux-gnu');
  const ran = make(box, ['-n', target, ...args]);
  assert.equal(ran.status, 0, `${ran.stdout}${ran.stderr}`);
  const lines = ran.stdout.split('\n');
  const generate = lines.findIndex((line) => new RegExp(` generate --root \\S+ --target ${binding}$`).test(line));
  const built = lines.findIndex(build);
  assert.ok(generate >= 0 && built > generate, ran.stdout);
}

// ---- release-go-static (GN-19b) ------------------------------------------------------------------------------------

test('release-go-static builds the Go library of the platform of the host and strips a copy with the llvm-strip of the toolchain', async (t) => {
  for (const { triple, go, musl } of PLATFORMS) {
    await t.test(triple, (t2) => {
      const box = sandbox(t2, triple);
      const ran = make(box, ['release-go-static']);
      assert.equal(ran.status, 0, `${ran.stdout}${ran.stderr}`);
      const asset = path.join(box.dir, 'var/release/assets/go', go, 'libpolyspec_php_serialization_go.a');
      assert.equal(readFileSync(asset, 'utf8'), 'stripped\n');
      // The library that cargo built stays as it was: the strip runs on a copy.
      assert.equal(readFileSync(path.join(box.dir, 'var/release/target/release/libpolyspec_php_serialization_go.a'), 'utf8'), 'library with debug sections\n');
      const calls = box.calls();
      const builds = [
        ['cargo', 'build', '--release', '--locked', '-p', 'polyspec-php-serialization-go'],
        ['cargo', 'CARGO_TARGET_DIR=var/release/target', 'PHP=', 'PHP_CONFIG='],
      ];
      // A Linux host also builds the library of the musl target of its arch (GN-19b).
      if (musl !== undefined) builds.push(['cargo', 'build', '--release', '--locked', '-p', 'polyspec-php-serialization-go', '--target', musl], ['cargo', 'CARGO_TARGET_DIR=var/release/target', 'PHP=', 'PHP_CONFIG=']);
      assert.deepEqual(calls.filter((call) => call[0] === 'cargo'), builds);
      const stripped = calls.filter((call) => call[0] === 'llvm-strip');
      assert.equal(stripped.length, musl === undefined ? 1 : 2, JSON.stringify(calls));
      for (const call of stripped) assert.equal(call[1], '--strip-debug');
      // No strip of PATH, which differs by machine.
      assert.deepEqual(calls.filter((call) => call[0] === 'strip'), []);
      // Only the assets are left: the copies were renamed.
      assert.equal(entries(path.join(box.dir, 'var/release/assets/go')), musl === undefined ? `${go}\n` : `${go}\n${go}_musl\n`);
      assert.equal(entries(path.dirname(asset)), 'libpolyspec_php_serialization_go.a\n');
      if (musl !== undefined) {
        assert.equal(readFileSync(path.join(box.dir, 'var/release/assets/go', `${go}_musl`, 'libpolyspec_php_serialization_go.a'), 'utf8'), 'stripped\n');
        assert.equal(readFileSync(path.join(box.dir, 'var/release/target', musl, 'release/libpolyspec_php_serialization_go.a'), 'utf8'), 'musl library with debug sections\n');
      }
    });
  }
});

test('release-go-static writes into RELEASE_ASSETS and builds into RELEASE_TARGET', (t) => {
  const box = sandbox(t, 'aarch64-apple-darwin');
  const ran = make(box, ['release-go-static', 'RELEASE_ASSETS=out/assets', 'RELEASE_TARGET=out/target']);
  assert.equal(ran.status, 0, `${ran.stdout}${ran.stderr}`);
  assert.equal(readFileSync(path.join(box.dir, 'out/assets/go/darwin_arm64/libpolyspec_php_serialization_go.a'), 'utf8'), 'stripped\n');
  assert.ok(box.calls().some((call) => call[0] === 'cargo' && call[1] === 'CARGO_TARGET_DIR=out/target'), JSON.stringify(box.calls()));
});

test('release-go-static fails with 2 on a host that is no platform of the release, and builds nothing', (t) => {
  const box = sandbox(t, 'x86_64-pc-windows-msvc');
  const ran = make(box, ['release-go-static']);
  assert.equal(ran.status, 2, `${ran.stdout}${ran.stderr}`);
  assert.match(ran.stderr, /release-go-static: the host x86_64-pc-windows-msvc is no platform of the release: x86_64-unknown-linux-gnu, aarch64-unknown-linux-gnu, aarch64-apple-darwin/);
  assert.deepEqual(box.calls().filter((call) => call[0] !== 'rustc'), []);
});

test('a strip that fails leaves no library in the assets', (t) => {
  const box = sandbox(t, 'aarch64-unknown-linux-gnu', true);
  const ran = make(box, ['release-go-static']);
  assert.notEqual(ran.status, 0, `${ran.stdout}${ran.stderr}`);
  assert.equal(existsSync(path.join(box.dir, 'var/release/assets/go/linux_arm64/libpolyspec_php_serialization_go.a')), false);
});

// ---- release-wheel (GN-19c) ----------------------------------------------------------------------------------------

test('release-wheel builds the abi3 wheel of the host with uv, maturin locked and the commit time of HEAD', (t) => {
  const box = sandbox(t, 'x86_64-unknown-linux-gnu');
  // The generation of the Python binding is a prerequisite; the case marks it as done, so make runs the recipe alone.
  const ran = make(box, ['-o', 'bindings-python', 'release-wheel']);
  assert.equal(ran.status, 0, `${ran.stdout}${ran.stderr}`);
  assert.deepEqual(box.calls().filter((call) => call[0] === 'uv'), [
    ['uv', 'build', '--wheel', '--python', 'python3', '--out-dir', 'var/release/assets/wheel', 'packages/python'],
    ['uv', 'CARGO_TARGET_DIR=var/release/target', 'MATURIN_PEP517_ARGS=--locked', `SOURCE_DATE_EPOCH=${COMMIT_EPOCH}`],
  ]);
  assert.equal(readFileSync(path.join(box.dir, 'var/release/assets/wheel/polyspec_php_serialization-1.2.3-cp314-abi3-platform.whl'), 'utf8'), 'wheel\n');
});

test('release-wheel generates the Python binding first', (t) => {
  generatesFirst(t, 'release-wheel', 'python', (line) => line.includes(' build --wheel '));
});

test('release-wheel fails with 2 on a host that is no platform of the release, and builds nothing', (t) => {
  const box = sandbox(t, 'riscv64gc-unknown-linux-gnu');
  const ran = make(box, ['-o', 'bindings-python', 'release-wheel']);
  assert.equal(ran.status, 2, `${ran.stdout}${ran.stderr}`);
  assert.match(ran.stderr, /release-wheel: the host riscv64gc-unknown-linux-gnu is no platform of the release/);
  assert.deepEqual(box.calls().filter((call) => call[0] === 'uv'), []);
});

// ---- release-php-ext (GN-19d) --------------------------------------------------------------------------------------

// The generation of the PHP binding is a prerequisite of the extension; a case marks it as done, so make runs the recipe
// alone.
const GENERATED_PHP = ['-o', 'bindings-php'];

test('release-php-ext builds, loads and packs the PHP extension under the name by which PIE finds it', async (t) => {
  for (const { triple, pie } of PLATFORMS) {
    for (const php of [{ minor: '8.4' }, { minor: '8.5', zts: true }, { minor: '8.3', debug: true, zts: true }] as Php[]) {
      const build = `${php.debug === true ? '-debug' : ''}-${php.zts === true ? 'zts' : 'nts'}`;
      await t.test(`${triple} php${php.minor}${build}`, (t2) => {
        const box = sandbox(t2, triple, false, php);
        const phpPath = path.join(box.bin, 'php');
        const ran = make(box, [...GENERATED_PHP, 'release-php-ext', `PHP=${phpPath}`]);
        assert.equal(ran.status, 0, `${ran.stdout}${ran.stderr}`);
        const name = `php_polyspec_php_serialization-v1.2.3_php${php.minor}-${pie}${build}.zip`;
        const assets = path.join(box.dir, 'var/release/assets/php-ext');
        assert.equal(readFileSync(path.join(assets, name), 'utf8'), 'zip of polyspec_php_serialization.so\n');
        // Only the archive is left in the assets: the copy was renamed.
        assert.equal(entries(assets), `${name}\n`);
        const calls = box.calls();
        assert.deepEqual(calls.filter((call) => call[0] === 'cargo' && call[1] !== 'pkgid'), [
          ['cargo', 'build', '--release', '--locked', '-p', 'polyspec-php-serialization-php-ext'],
          ['cargo', `CARGO_TARGET_DIR=var/release/target/php${php.minor}${build}`, `PHP=${phpPath}`, `PHP_CONFIG=${phpPath}-config`],
        ]);
        // The load check runs on the copy that is packed, by its absolute path, without a php.ini; make names it under
        // the real path of its directory.
        const copy = path.join(realpathSync(box.dir), 'var/release/target/php-ext', `php${php.minor}${build}`);
        const load = calls.find((call) => call[0] === 'php' && call.some((word) => word.includes('extension_loaded')));
        assert.deepEqual(load, ['php', '-n', '-d', `extension=${copy}/polyspec_php_serialization.so`, '-r', 'exit(extension_loaded("polyspec_php_serialization") ? 0 : 1);']);
        assert.deepEqual(calls.filter((call) => call[0] === 'zip'), [['zip', '-q', '-9', '-X', name, 'polyspec_php_serialization.so'], ['zip', `PWD=${copy}`]]);
      });
    }
  }
});

test('release-php-ext builds each PHP minor in its own target folder, so that one job packs the extension of 8.4 and 8.5', (t) => {
  const box = sandbox(t, 'x86_64-unknown-linux-gnu');
  const php = path.join(box.bin, 'php');
  const first = make(box, [...GENERATED_PHP, 'release-php-ext', `PHP=${php}`]);
  assert.equal(first.status, 0, `${first.stdout}${first.stderr}`);
  // The PHP of the same path now reports the next minor, as the PHP of a runner does after setup-php switches it.
  writeFileSync(path.join(path.dirname(box.dir), 'minor'), '8.5');
  const second = make(box, [...GENERATED_PHP, 'release-php-ext', `PHP=${php}`]);
  assert.equal(second.status, 0, `${second.stdout}${second.stderr}`);
  assert.equal(entries(path.join(box.dir, 'var/release/assets/php-ext')), 'php_polyspec_php_serialization-v1.2.3_php8.4-x86_64-linux-glibc-nts.zip\nphp_polyspec_php_serialization-v1.2.3_php8.5-x86_64-linux-glibc-nts.zip\n');
  assert.deepEqual(box.calls().filter((call) => call[0] === 'cargo' && call[1]?.startsWith('CARGO_TARGET_DIR=') === true).map((call) => call[1]), ['CARGO_TARGET_DIR=var/release/target/php8.4-nts', 'CARGO_TARGET_DIR=var/release/target/php8.5-nts']);
});

test('release-php-ext passes PHP_CONFIG and writes into RELEASE_ASSETS', (t) => {
  const box = sandbox(t, 'aarch64-apple-darwin');
  const config = path.join(path.dirname(box.dir), 'other/php-config');
  program(config, '');
  const ran = make(box, [...GENERATED_PHP, 'release-php-ext', `PHP=${path.join(box.bin, 'php')}`, `PHP_CONFIG=${config}`, 'RELEASE_ASSETS=out/assets']);
  assert.equal(ran.status, 0, `${ran.stdout}${ran.stderr}`);
  assert.ok(existsSync(path.join(box.dir, 'out/assets/php-ext/php_polyspec_php_serialization-v1.2.3_php8.4-arm64-darwin-bsdlibc-nts.zip')));
  assert.ok(box.calls().some((call) => call[0] === 'cargo' && call[3] === `PHP_CONFIG=${config}`), JSON.stringify(box.calls()));
});

test('release-php-ext gives cargo the absolute paths of a PHP and a php-config that are named relative to the checkout or on PATH', async (t) => {
  // The build script of ext-php-rs refuses a PHP that it cannot find by the path that PHP names.
  await t.test('relative', (t2) => {
    const box = sandbox(t2, 'x86_64-unknown-linux-gnu');
    const ran = make(box, [...GENERATED_PHP, 'release-php-ext', 'PHP=../bin/php']);
    assert.equal(ran.status, 0, `${ran.stdout}${ran.stderr}`);
    const real = realpathSync(box.dir);
    assert.ok(box.calls().some((call) => call[0] === 'cargo' && call[2] === `PHP=${real}/../bin/php` && call[3] === `PHP_CONFIG=${real}/../bin/php-config`), JSON.stringify(box.calls()));
  });
  await t.test('on PATH', (t2) => {
    const box = sandbox(t2, 'x86_64-unknown-linux-gnu');
    const ran = make(box, [...GENERATED_PHP, 'release-php-ext', 'PHP=php']);
    assert.equal(ran.status, 0, `${ran.stdout}${ran.stderr}`);
    assert.ok(box.calls().some((call) => call[0] === 'cargo' && call[2] === `PHP=${box.bin}/php` && call[3] === `PHP_CONFIG=${box.bin}/php-config`), JSON.stringify(box.calls()));
  });
});

test('release-php-ext generates the PHP binding first, so that a checkout without generated files builds', (t) => {
  generatesFirst(t, 'release-php-ext', 'php', (line) => line.includes('cargo build --release --locked -p polyspec-php-serialization-php-ext'), ['PHP=php']);
});

test('release-php-ext packs nothing when the extension does not load', (t) => {
  const box = sandbox(t, 'x86_64-unknown-linux-gnu', false, { minor: '8.4', loadFails: true });
  const ran = make(box, [...GENERATED_PHP, 'release-php-ext', `PHP=${path.join(box.bin, 'php')}`]);
  assert.notEqual(ran.status, 0, `${ran.stdout}${ran.stderr}`);
  assert.deepEqual(box.calls().filter((call) => call[0] === 'zip'), []);
  assert.equal(existsSync(path.join(box.dir, 'var/release/assets/php-ext')), false);
});

test('release-php-ext fails with 2 when PHP names no program, and builds nothing', (t) => {
  const box = sandbox(t, 'x86_64-unknown-linux-gnu');
  // The default PHP is the PHP of the checkout, which the copy of the Makefile does not hold.
  const ran = make(box, [...GENERATED_PHP, 'release-php-ext']);
  assert.equal(ran.status, 2, `${ran.stdout}${ran.stderr}`);
  assert.match(ran.stderr, /release-php-ext: no PHP \S+ on PATH/);
  assert.deepEqual(box.calls().filter((call) => call[0] !== 'rustc'), []);
});

test('release-php-ext fails with 2 on a host that is no platform of the release, and builds nothing', (t) => {
  const box = sandbox(t, 'x86_64-apple-darwin');
  const ran = make(box, [...GENERATED_PHP, 'release-php-ext', `PHP=${path.join(box.bin, 'php')}`]);
  assert.equal(ran.status, 2, `${ran.stdout}${ran.stderr}`);
  assert.match(ran.stderr, /release-php-ext: the host x86_64-apple-darwin is no platform of the release/);
  assert.deepEqual(box.calls().filter((call) => call[0] !== 'rustc'), []);
});

// ---- release-npm-platform and release-npm (GN-19e, GN-3c) ----------------------------------------------------------

// The generation of the Node and the WASM binding are prerequisites; a case marks them as done, so make runs the recipe
// alone.
const GENERATED_NODE = ['-o', 'bindings-node', '-o', 'bindings-wasm'];

/** The files of the npm archive `file` and the text of its package.json. */
function archive(file: string): { files: string[]; manifest: string } {
  const files = spawnSync('tar', ['-tzf', file], { encoding: 'utf8' }).stdout.split('\n').filter((line) => line !== '').sort();
  return { files, manifest: spawnSync('tar', ['-xzOf', file, 'package/package.json'], { encoding: 'utf8' }).stdout };
}

test('release-npm-platform builds the addon of the host with the napi CLI and packs its platform package', async (t) => {
  for (const { triple, platform } of PLATFORMS) {
    await t.test(triple, (t2) => {
      const box = sandbox(t2, triple);
      const ran = make(box, [...GENERATED_NODE, 'release-npm-platform']);
      assert.equal(ran.status, 0, `${ran.stdout}${ran.stderr}`);
      const assets = path.join(box.dir, 'var/release/assets/npm');
      assert.equal(entries(assets), `polyspec-php-serialization-${platform}-${VERSION}.tgz\n`);
      const { files, manifest } = archive(path.join(assets, `polyspec-php-serialization-${platform}-${VERSION}.tgz`));
      assert.deepEqual(files, [`package/package.json`, `package/php-serialization.${platform}.node`]);
      assert.equal(field(manifest, 'name'), `@polyspec/php-serialization-${platform}`);
      const work = path.join(realpathSync(box.dir), 'var/release/target/npm', platform);
      assert.deepEqual(box.calls().filter((call) => call[0] === 'napi'), [
        ['napi', 'build', '--platform', '--release', '--no-js', '--manifest-path', 'packages/ts/Cargo.toml', '--package-json-path', 'packages/ts/package.json', '--target-dir', 'var/release/target', '--output-dir', `${work}/addons`, '--target', triple, '--', '--locked'],
        ['napi', 'create-npm-dirs', '--package-json-path', 'packages/ts/package.json', '--config-path', `${work}/napi.json`, '--npm-dir', `${work}/npm`],
        ['napi', 'artifacts', '--package-json-path', 'packages/ts/package.json', '--config-path', `${work}/napi.json`, '--output-dir', `${work}/addons`, '--npm-dir', `${work}/npm`],
      ]);
      // The configuration of the run names the triple of the host alone.
      assert.deepEqual(box.calls().filter((call) => call[0] === 'napi-config'), [['napi-config', `{"targets":["${triple}"]}`], ['napi-config', `{"targets":["${triple}"]}`]]);
    });
  }
});

test('release-npm-platform fails with 2 on a host that is no platform of the release, and builds nothing', (t) => {
  const box = sandbox(t, 'x86_64-unknown-freebsd');
  const ran = make(box, [...GENERATED_NODE, 'release-npm-platform']);
  assert.equal(ran.status, 2, `${ran.stdout}${ran.stderr}`);
  assert.match(ran.stderr, /release-npm-platform: the host x86_64-unknown-freebsd is no platform of the release/);
  assert.deepEqual(box.calls().filter((call) => call[0] !== 'rustc'), []);
});

test('release-npm packs @polyspec/php-serialization with the platform packages in optionalDependencies of a copy of its manifest', (t) => {
  const box = sandbox(t, 'x86_64-unknown-linux-gnu');
  const ran = make(box, [...GENERATED_NODE, 'release-npm', `WASM_BINDGEN=${path.join(box.bin, 'wasm-bindgen')}`]);
  assert.equal(ran.status, 0, `${ran.stdout}${ran.stderr}`);
  const assets = path.join(box.dir, 'var/release/assets/npm');
  assert.equal(entries(assets), `polyspec-php-serialization-${VERSION}.tgz\n`);
  const { files, manifest } = archive(path.join(assets, `polyspec-php-serialization-${VERSION}.tgz`));
  assert.deepEqual(files, [
    'package/generated/index.cjs', 'package/generated/index.d.ts', 'package/generated/index.mjs', 'package/package.json',
    'package/wasm/generated/index.d.ts', 'package/wasm/generated/index.mjs',
    'package/wasm/generated/php_serialization_wasm.d.ts', 'package/wasm/generated/php_serialization_wasm.js', 'package/wasm/generated/php_serialization_wasm_bg.wasm',
    'package/wasm/generated/state.mjs',
  ]);
  assert.deepEqual(field(manifest, 'optionalDependencies'), {
    '@polyspec/php-serialization-linux-x64-gnu': VERSION, '@polyspec/php-serialization-linux-arm64-gnu': VERSION, '@polyspec/php-serialization-darwin-arm64': VERSION,
  });
  // The tracked manifest names no platform package.
  assert.equal(field(readFileSync(path.join(box.dir, 'packages/ts/package.json'), 'utf8'), 'optionalDependencies'), undefined);
  assert.deepEqual(box.calls().filter((call) => call[0] === 'cargo'), [
    ['cargo', 'build', '--release', '--locked', '-p', 'polyspec-php-serialization-wasm', '--target', 'wasm32-unknown-unknown'],
    ['cargo', 'CARGO_TARGET_DIR=var/release/target', 'PHP=', 'PHP_CONFIG='],
  ]);
});

test('release-npm fails on a wasm-bindgen of another release than the crate, and builds nothing', (t) => {
  const box = sandbox(t, 'x86_64-unknown-linux-gnu');
  writeFileSync(path.join(box.dir, 'packages/ts/wasm/Cargo.toml'), '[dependencies]\nwasm-bindgen = "=0.2.1"\n');
  const ran = make(box, [...GENERATED_NODE, 'release-npm', `WASM_BINDGEN=${path.join(box.bin, 'wasm-bindgen')}`]);
  assert.notEqual(ran.status, 0, `${ran.stdout}${ran.stderr}`);
  assert.deepEqual(box.calls().filter((call) => call[0] === 'cargo'), []);
});

test('release-npm-platform and release-npm generate the Node and the WASM binding first', async (t) => {
  await t.test('release-npm-platform', (t2) => {
    generatesFirst(t2, 'release-npm-platform', 'node', (line) => line.includes(' build --platform --release '));
  });
  await t.test('release-npm', (t2) => {
    generatesFirst(t2, 'release-npm', 'wasm', (line) => line.includes('cargo build --release --locked -p polyspec-php-serialization-wasm'));
  });
});

// ---- release-go-module (GN-19f) ------------------------------------------------------------------------------------

/** Runs release-go-module in the sandbox with the stand-in of binding, which prints `ref` and fails when `fails`. */
function releaseGoModule(box: Sandbox, args: string[], ref: string | undefined, fails = false): SpawnSyncReturns<string> {
  const tmp = path.dirname(box.dir);
  if (ref !== undefined) writeFileSync(path.join(tmp, 'ref'), ref);
  if (fails) writeFileSync(path.join(tmp, 'fails'), '');
  for (const { go } of PLATFORMS) mkdirSync(path.join(box.dir, 'var/release/assets/go', go), { recursive: true });
  return make(box, ['-o', 'bindings-go', 'release-go-module', `BINDING=${process.execPath} ${path.join(tmp, 'binding.mjs')}`, ...args]);
}

test('release-go-module makes the commit and the tag of the Go module with binding and pushes the reference that it prints', (t) => {
  const box = sandbox(t, 'aarch64-apple-darwin');
  const ran = releaseGoModule(box, ['TAG=v1.2.3'], 'refs/tags/packages/go/v1.2.3\n');
  assert.equal(ran.status, 0, `${ran.stdout}${ran.stderr}`);
  const real = realpathSync(box.dir);
  assert.deepEqual(box.calls().filter((call) => call[0] === 'binding' || call[0] === 'libraries' || call[0] === 'git'), [
    ['binding', 'release-go-module', '--root', real, '--tag', 'v1.2.3', '--libraries', `${real}/var/release/assets/go`, '--work', `${real}/var/release/target/go-module`],
    ['libraries', 'darwin_arm64', 'linux_amd64', 'linux_arm64'],
    ['git', 'push', 'origin', 'refs/tags/packages/go/v1.2.3'],
  ]);
});

test('release-go-module pushes nothing when the remote holds the tag already', (t) => {
  const box = sandbox(t, 'aarch64-apple-darwin');
  const ran = releaseGoModule(box, ['TAG=v1.2.3'], '');
  assert.equal(ran.status, 0, `${ran.stdout}${ran.stderr}`);
  assert.match(ran.stdout, /release-go-module: the remote holds the tag packages\/go\/v1\.2\.3 already/);
  assert.deepEqual(box.calls().filter((call) => call[0] === 'git'), []);
});

test('release-go-module pushes nothing when binding fails', (t) => {
  const box = sandbox(t, 'aarch64-apple-darwin');
  const ran = releaseGoModule(box, ['TAG=v1.2.3'], 'refs/tags/packages/go/v1.2.3\n', true);
  assert.notEqual(ran.status, 0, `${ran.stdout}${ran.stderr}`);
  assert.deepEqual(box.calls().filter((call) => call[0] === 'git'), []);
});

test('release-go-module refuses an output that is not the reference of the tag, and pushes nothing', (t) => {
  const box = sandbox(t, 'aarch64-apple-darwin');
  const ran = releaseGoModule(box, ['TAG=v1.2.3'], 'refs/heads/main\n');
  assert.notEqual(ran.status, 0, `${ran.stdout}${ran.stderr}`);
  assert.match(ran.stderr, /release-go-module: binding printed refs\/heads\/main, not refs\/tags\/packages\/go\/v1\.2\.3/);
  assert.deepEqual(box.calls().filter((call) => call[0] === 'git'), []);
});

test('release-go-module fails with 2 without TAG, and runs nothing', (t) => {
  const box = sandbox(t, 'aarch64-apple-darwin');
  const ran = releaseGoModule(box, [], 'refs/tags/packages/go/v1.2.3\n');
  assert.equal(ran.status, 2, `${ran.stdout}${ran.stderr}`);
  assert.match(ran.stderr, /release-go-module: TAG is required, for example make release-go-module TAG=v0\.0\.1/);
  assert.deepEqual(box.calls(), []);
});

test('release-go-module generates the Go binding first', (t) => {
  generatesFirst(t, 'release-go-module', 'go', (line) => line.includes(' release-go-module --root '), ['TAG=v1.2.3']);
});

// ---- The steps of the release workflow (GN-19g) --------------------------------------------------------------------

/** Writes the assets of a release of `version` with the PHP minors `minors` into the sandbox, leaving out `without`. */
function assets(box: Sandbox, version: string, minors: string[], without: string[] = []): string[] {
  const files = [
    `wheel/polyspec_php_serialization-${version}-cp314-abi3-manylinux_2_39_x86_64.whl`,
    `wheel/polyspec_php_serialization-${version}-cp314-abi3-manylinux_2_39_aarch64.whl`,
    `wheel/polyspec_php_serialization-${version}-cp314-abi3-macosx_11_0_arm64.whl`,
    `npm/polyspec-php-serialization-${version}.tgz`,
    ...PLATFORMS.map(({ platform }) => `npm/polyspec-php-serialization-${platform}-${version}.tgz`),
    ...minors.flatMap((minor) => PLATFORMS.map(({ pie }) => `php-ext/php_polyspec_php_serialization-v${version}_php${minor}-${pie}-nts.zip`)),
  ].filter((file) => !without.includes(file));
  for (const file of files) {
    mkdirSync(path.dirname(path.join(box.dir, 'var/release/assets', file)), { recursive: true });
    writeFileSync(path.join(box.dir, 'var/release/assets', file), file);
  }
  return files;
}

test('release-platform-assets uploads the assets of each platform to the release of TAG under their labels', (t) => {
  const box = sandbox(t, 'x86_64-unknown-linux-gnu');
  assets(box, '1.2.3', ['8.4', '8.5']);
  const ran = make(box, ['release-platform-assets', 'TAG=v1.2.3']);
  assert.equal(ran.status, 0, `${ran.stdout}${ran.stderr}`);
  const a = 'var/release/assets';
  const p = 'polyspec-php-serialization';
  assert.deepEqual(box.calls().filter((call) => call[0] === 'gh'), [[
    'gh', 'release', 'upload', 'v1.2.3',
    `${a}/wheel/polyspec_php_serialization-1.2.3-cp314-abi3-macosx_11_0_arm64.whl#${p}-python-1.2.3-darwin-arm64`,
    `${a}/wheel/polyspec_php_serialization-1.2.3-cp314-abi3-manylinux_2_39_aarch64.whl#${p}-python-1.2.3-linux-arm64-gnu`,
    `${a}/wheel/polyspec_php_serialization-1.2.3-cp314-abi3-manylinux_2_39_x86_64.whl#${p}-python-1.2.3-linux-x64-gnu`,
    `${a}/npm/${p}-1.2.3.tgz#${p}-ts-1.2.3`,
    `${a}/npm/${p}-darwin-arm64-1.2.3.tgz#${p}-ts-1.2.3-darwin-arm64`,
    `${a}/npm/${p}-linux-arm64-gnu-1.2.3.tgz#${p}-ts-1.2.3-linux-arm64-gnu`,
    `${a}/npm/${p}-linux-x64-gnu-1.2.3.tgz#${p}-ts-1.2.3-linux-x64-gnu`,
    `${a}/php-ext/php_polyspec_php_serialization-v1.2.3_php8.4-arm64-darwin-bsdlibc-nts.zip#${p}-php-ext-1.2.3-php8.4-darwin-arm64`,
    `${a}/php-ext/php_polyspec_php_serialization-v1.2.3_php8.4-arm64-linux-glibc-nts.zip#${p}-php-ext-1.2.3-php8.4-linux-arm64-gnu`,
    `${a}/php-ext/php_polyspec_php_serialization-v1.2.3_php8.4-x86_64-linux-glibc-nts.zip#${p}-php-ext-1.2.3-php8.4-linux-x64-gnu`,
    `${a}/php-ext/php_polyspec_php_serialization-v1.2.3_php8.5-arm64-darwin-bsdlibc-nts.zip#${p}-php-ext-1.2.3-php8.5-darwin-arm64`,
    `${a}/php-ext/php_polyspec_php_serialization-v1.2.3_php8.5-arm64-linux-glibc-nts.zip#${p}-php-ext-1.2.3-php8.5-linux-arm64-gnu`,
    `${a}/php-ext/php_polyspec_php_serialization-v1.2.3_php8.5-x86_64-linux-glibc-nts.zip#${p}-php-ext-1.2.3-php8.5-linux-x64-gnu`,
  ]]);
});

test('release-platform-assets uploads nothing when an asset of a platform is missing or names no platform of the release', async (t) => {
  const cases: [string, (box: Sandbox) => void, RegExp][] = [
    ['a missing wheel', (box) => assets(box, '1.2.3', ['8.5'], ['wheel/polyspec_php_serialization-1.2.3-cp314-abi3-macosx_11_0_arm64.whl']), /var\/release\/assets\/wheel holds 2 wheels, not one of each of the 3 platforms/],
    ['a missing platform package', (box) => assets(box, '1.2.3', ['8.5'], ['npm/polyspec-php-serialization-darwin-arm64-1.2.3.tgz']), /var\/release\/assets\/npm holds 3 packages/],
    ['a missing PHP extension', (box) => assets(box, '1.2.3', ['8.5'], ['php-ext/php_polyspec_php_serialization-v1.2.3_php8.5-x86_64-linux-glibc-nts.zip']), /var\/release\/assets\/php-ext holds 2 extensions/],
    ['no PHP extension', (box) => assets(box, '1.2.3', []), /php-ext\/\*\.zip is no PHP extension of the release 1\.2\.3/],
    ['a wheel of another platform', (box) => { assets(box, '1.2.3', ['8.5']); writeFileSync(path.join(box.dir, 'var/release/assets/wheel/polyspec_php_serialization-1.2.3-cp314-abi3-win_amd64.whl'), ''); }, /win_amd64\.whl is no wheel of a platform of the release/],
    ['a package of another version', (box) => { assets(box, '1.2.3', ['8.5']); writeFileSync(path.join(box.dir, 'var/release/assets/npm/polyspec-php-serialization-1.2.2.tgz'), ''); }, /polyspec-php-serialization-1\.2\.2\.tgz is no npm package of the release 1\.2\.3/],
  ];
  for (const [name, write, message] of cases) {
    await t.test(name, (t2) => {
      const box = sandbox(t2, 'x86_64-unknown-linux-gnu');
      write(box);
      const ran = make(box, ['release-platform-assets', 'TAG=v1.2.3']);
      assert.notEqual(ran.status, 0, `${ran.stdout}${ran.stderr}`);
      assert.match(ran.stderr, message);
      assert.deepEqual(box.calls().filter((call) => call[0] === 'gh'), []);
    });
  }
});

test('release-platform-assets fails with 2 without TAG', (t) => {
  const box = sandbox(t, 'x86_64-unknown-linux-gnu');
  const ran = make(box, ['release-platform-assets']);
  assert.equal(ran.status, 2, `${ran.stdout}${ran.stderr}`);
  assert.match(ran.stderr, /release-platform-assets: TAG is required/);
});

test('release-tag-output writes the tag and the version of the environment into the outputs of the step', (t) => {
  const box = sandbox(t, 'x86_64-unknown-linux-gnu');
  const output = path.join(path.dirname(box.dir), 'output');
  writeFileSync(output, 'earlier=1\n');
  const ran = spawnSync('make', ['--no-print-directory', 'release-tag-output'], { cwd: box.dir, encoding: 'utf8', env: { ...box.env, GITHUB_OUTPUT: output, TAG: 'v1.2.3', VERSION: '1.2.3' } });
  assert.equal(ran.status, 0, `${ran.stdout}${ran.stderr}`);
  assert.equal(readFileSync(output, 'utf8'), 'earlier=1\ntag=v1.2.3\nversion=1.2.3\n');
  const none = make(box, ['release-tag-output']);
  assert.equal(none.status, 2, `${none.stdout}${none.stderr}`);
  assert.match(none.stderr, /release-tag-output: GITHUB_OUTPUT is not set/);
});

test('release-binding-check runs the release check of binding on the contract', (t) => {
  const box = sandbox(t, 'x86_64-unknown-linux-gnu');
  const ran = make(box, ['release-binding-check', `BINDING=${process.execPath} ${path.join(path.dirname(box.dir), 'binding.mjs')}`]);
  assert.equal(ran.status, 0, `${ran.stdout}${ran.stderr}`);
  assert.deepEqual(box.calls().filter((call) => call[0] === 'binding'), [['binding', 'check', `${realpathSync(box.dir)}/packages/rust/interface.json`, '--release']]);
});

test('install-wasm-bindgen installs the wasm-bindgen CLI of mise.toml alone with the mise of the checkout', (t) => {
  const box = sandbox(t, 'x86_64-unknown-linux-gnu');
  const ran = make(box, ['-n', 'install-wasm-bindgen']);
  assert.equal(ran.status, 0, `${ran.stdout}${ran.stderr}`);
  assert.match(ran.stdout, /var\/tools\/bin\/mise install --locked github:wasm-bindgen\/wasm-bindgen$/m);
});
