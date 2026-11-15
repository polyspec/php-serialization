// The rules of the GitHub workflows of this repository (AGENTS.md, "CI and release"), checked on the tracked files of
// .github and on the Makefile:
//
//   - every job runs on ubuntu-26.04-arm, except the job platform of assets.yml, which runs on the runner of each platform
//     of the release, ubuntu-26.04, ubuntu-26.04-arm or macos-15, because the asset of a platform is linked and loaded only
//     on that platform: no tool of the release compiles for another platform (binding GN-19a);
//   - the workflows ci and release call assets.yml, which builds the assets of each platform (binding GN-19i);
//   - every action is a local action of .github/actions or is pinned by its full commit, and a comment of the file names
//     its release, `# <owner>/<repository> <release>`;
//   - no job and no step sets timeout-minutes;
//   - every run step is one make target that the Makefile or the release recipes that it includes (packages/release.mk,
//     which binding release-recipes writes) define, with arguments NAME=value or one expression alone,
//     so that the settings and the checks of the Makefile apply to every command of CI;
//   - the workflow ci starts on a push of main and on workflow_dispatch alone;
//   - the last job of the workflow ci is ci-passed, which runs after every other job, also after a failed one
//     (`if: ${{ always() }}`), needs each of them and runs `make ci-passed FAIL_SKIPPED=1 RESULTS='${{ toJSON(needs) }}'`,
//     the JSON of its needs, so that it passes only when every other job succeeded;
//   - every job of the workflows ci, release and assets, which both call, has one run step, `make ci-<job>`,
//     `make ci-release-<job>` or `make ci-assets-<job>`, with make variables alone, a matrix value as
//     NAME=${{ matrix.<key> }}, an input of the called workflow as NAME=${{ inputs.<key> }}, an output of a needed job as
//     NAME=${{ needs.<job>.outputs.<key> }} and a quoted expression of the event as NAME="${{ ... }}"; its other steps are
//     uses steps, only a uses step has a condition, no step sets env and a job sets GH_TOKEN alone, so that the recipe
//     holds the order and the conditions of the job and a local run is the call that the workflow makes.
//
// The test reads the files as text, line by line: the workflows hold one key on a line, and a run step whose command
// continues on a later line is a finding.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const RUNNER = 'ubuntu-26.04-arm';
const CI = '.github/workflows/ci.yml';
const RELEASE = '.github/workflows/release.yml';
const ASSETS = '.github/workflows/assets.yml';
// The runner of each platform of the release, on which the job platform of assets.yml builds the assets of that platform
// (binding GN-19a).
const PLATFORM_RUNNERS: Record<string, string> = { 'linux-x64-gnu': 'ubuntu-26.04', 'linux-arm64-gnu': 'ubuntu-26.04-arm', 'darwin-arm64': 'macos-15' };
const MATRIX_RUNNER = '${{ matrix.runner }}';
const LAST = 'ci-passed';

// A run step: make, one target, then arguments NAME=value, NAME="words" for a list such as the tools of a job, or
// expressions ${{ ... }}, bare or quoted.
const RUN = /^make ([a-z][a-z0-9-]*)((?: (?:[A-Z][A-Z0-9_]*=(?:[A-Za-z0-9_.-]+|"[A-Za-z0-9_. -]+"|\$\{\{[^}]*\}\}|'\$\{\{[^}]*\}\}'|"\$\{\{[^}"]*\}\}")|\$\{\{[^}]*\}\}))*)$/;
// An argument of the run step of a job: NAME=value, NAME="words", a matrix value or an input of the called workflow,
// NAME=${{ matrix.<key> }} or NAME=${{ inputs.<key> }}, an output of a job that the job needs, NAME=${{ needs.<job>.outputs.<key> }},
// or a quoted expression of the event, NAME="${{ ... }}", such as the run id and the AUTO of the job tag of release.yml.
const JOB_ARGUMENT = /^[A-Z][A-Z0-9_]*=(?:[A-Za-z0-9_.-]+|"[A-Za-z0-9_. -]+"|\$\{\{ (?:matrix|inputs)\.[a-z][a-z0-9_-]* \}\}|\$\{\{ needs\.[a-z][a-z0-9_-]*\.outputs\.[a-z][a-z0-9_-]* \}\}|"\$\{\{ [^"}]* \}\}")$/;
// The one environment that a job may set: the token of the run, which the release targets read with gh.
const JOB_ENV = ['    env:', '      GH_TOKEN: ${{ github.token }}'];
// The run step of the judgement job ci-passed, which reads the results of the other jobs.
const LAST_RUN = `make ${LAST} FAIL_SKIPPED=1 RESULTS='\${{ toJSON(needs) }}'`;
const PINNED = /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)@[0-9a-f]{40}$/;

/** The targets that the text of a Makefile defines with a rule. */
function makeTargets(makefile: string): Set<string> {
  const targets = new Set<string>();
  for (const line of makefile.split('\n')) {
    const names = /^([a-z][A-Za-z0-9_.-]*(?: +[a-z][A-Za-z0-9_.-]*)*) *:(?!=)/.exec(line)?.[1];
    if (names !== undefined) for (const name of names.split(/ +/)) targets.add(name);
  }
  return targets;
}

/** The value of the key `key` of a line, `key: value` or `- key: value`, without its quotes; undefined for another line. */
function valueOf(line: string, key: string): string | undefined {
  const found = new RegExp(`^ *(?:- )?${key}: *(.*)$`).exec(line)?.[1];
  return found?.trim();
}

/**
 * The findings of the workflow or action `file` with the text `text`, each `<file>:<line>: <finding>`. `targets` are the
 * targets of the Makefile and `actions` the local actions, `./.github/actions/<name>`.
 */
function findings(file: string, text: string, targets: Set<string>, actions: Set<string>): string[] {
  const found: string[] = [];
  const lines = text.split('\n');
  const comments = lines.filter((line) => line.trim().startsWith('#'));
  let runners = 0;
  lines.forEach((line, index) => {
    if (line.trim().startsWith('#')) return;
    const at = `${file}:${String(index + 1)}`;
    if (/^ *(?:- )?timeout-minutes:/.test(line)) found.push(`${at}: sets timeout-minutes`);
    const runner = valueOf(line, 'runs-on');
    if (runner !== undefined) {
      runners += 1;
      // The runner of the matrix is judged by platformFindings, in the job platform of assets.yml alone.
      if (runner !== RUNNER && !(file === ASSETS && runner === MATRIX_RUNNER)) found.push(`${at}: runs on ${runner}, not on ${RUNNER}`);
    }
    const uses = valueOf(line, 'uses');
    if (uses !== undefined) {
      if (uses.startsWith('./')) {
        if (!actions.has(uses)) found.push(`${at}: uses ${uses}, which is no tracked action`);
      } else {
        const name = PINNED.exec(uses)?.[1];
        if (name === undefined) found.push(`${at}: uses ${uses}, which is not pinned by a full commit`);
        else if (!comments.some((comment) => new RegExp(`# ${name.replaceAll('.', '\\.')} v?[0-9]+\\.[0-9]+\\.[0-9]+\\b`).test(comment)))
          found.push(`${at}: no comment names the release of ${name}`);
      }
    }
    const run = valueOf(line, 'run');
    const next = lines.slice(index + 1).find((later) => later.trim() !== '' && !later.trim().startsWith('#'));
    const deeper = next !== undefined && next.search(/\S/) > line.indexOf('run:');
    // A key `run:` with no value whose deeper lines are keys is a mapping of that name, such as the input `run` of a
    // dispatch, and no run step.
    if (run !== undefined && !(run === '' && deeper && /^ *[A-Za-z_-]+:(?: |$)/.test(next))) {
      const target = RUN.exec(run)?.[1];
      if (target === undefined) found.push(`${at}: the run step is not one make target: ${run}`);
      else if (!targets.has(target)) found.push(`${at}: the Makefile defines no target ${target}`);
      if (deeper) found.push(`${at}: the run step continues on a later line`);
    }
  });
  // A workflow whose every job calls another workflow names no runner of its own.
  const calls = lines.some((line) => /^ {4}uses: \.\/\.github\/workflows\//.test(line));
  if (file.includes('/workflows/') && runners === 0 && !calls) found.push(`${file}: names no runner`);
  return found;
}

/**
 * The findings of the top-level keys of a workflow: the keys at the start of a line are name, on and jobs, and permissions
 * when it has them, and nothing else, and no line before jobs: is indented as a job, so that GitHub reads the file as a
 * workflow. A workflow that GitHub cannot read fails every run of every event without running a job.
 */
function topLevelFindings(file: string, text: string): string[] {
  const lines = text.split('\n');
  const keys = lines.filter((line) => /^[A-Za-z_-]+:/.test(line)).map((line) => line.replace(/:.*$/, ''));
  const found: string[] = [];
  for (const key of ['name', 'on', 'jobs']) if (!keys.includes(key)) found.push(`${file}: has no top-level key ${key}`);
  for (const key of keys) if (!['name', 'on', 'permissions', 'concurrency', 'env', 'jobs'].includes(key)) found.push(`${file}: has the top-level key ${key}, which a workflow does not take`);
  const jobs = lines.indexOf('jobs:');
  const before = (jobs < 0 ? lines : lines.slice(0, jobs)).findIndex((line, index) => /^ {2}[A-Za-z0-9_-]+: *$/.test(line) && !lines.slice(0, index).some((earlier) => /^[A-Za-z_-]+:/.test(earlier)));
  if (before >= 0) found.push(`${file}:${String(before + 1)}: a job comes before the top-level keys`);
  return found;
}

/** The findings of the triggers of the workflow ci: the keys of its block `on:` are push, of main alone, and workflow_dispatch. */
function triggerFindings(file: string, text: string): string[] {
  const lines = text.split('\n');
  const start = lines.indexOf('on:');
  if (start < 0) return [`${file}: has no block on:`];
  const block: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line) && !line.startsWith('#')) break;
    if (line.trim() !== '' && !line.trim().startsWith('#')) block.push(line);
  }
  const indent = Math.min(...block.map((line) => line.search(/\S/)));
  const keys = block.filter((line) => line.search(/\S/) === indent).map((line) => line.trim().replace(/:.*$/, '')).sort();
  const found: string[] = [];
  if (keys.join(' ') !== 'push workflow_dispatch') found.push(`${file}: starts on ${keys.join(', ') || 'nothing'}, not on push and workflow_dispatch alone`);
  if (block.filter((line) => /^ *branches:/.test(line)).map((line) => line.trim()).join(' ') !== 'branches: [main]') found.push(`${file}: the push is not of main alone`);
  return found;
}

/** The jobs of a workflow in their order: the keys of its block `jobs:`, each with the lines of its mapping. */
function jobsOf(text: string): Map<string, string[]> {
  const lines = text.split('\n');
  const jobs = new Map<string, string[]>();
  let current: string[] | undefined;
  for (const line of lines.slice(lines.indexOf('jobs:') + 1)) {
    if (/^\S/.test(line) && !line.startsWith('#')) break;
    const name = /^ {2}([A-Za-z0-9_-]+): *$/.exec(line)?.[1];
    if (name !== undefined) {
      current = [];
      jobs.set(name, current);
    } else if (current !== undefined && !line.trim().startsWith('#')) current.push(line);
  }
  return jobs;
}

/**
 * The findings of the last job of the workflow ci: it is ci-passed, runs after a failed job, needs every other job and
 * judges the results of its needs with `make ci-passed FAIL_SKIPPED=1`.
 */
function lastJobFindings(file: string, text: string): string[] {
  const jobs = jobsOf(text);
  const names = [...jobs.keys()];
  const last = names.at(-1);
  if (last === undefined) return [`${file}: has no job`];
  if (last !== LAST) return [`${file}: the last job is ${last}, not ${LAST}`];
  const lines = jobs.get(LAST) ?? [];
  const value = (key: string): string | undefined => lines.map((line) => valueOf(line, key)).find((found) => found !== undefined);
  const found: string[] = [];
  const condition = value('if');
  if (condition !== '${{ always() }}') found.push(`${file}: the job ${LAST} has the condition ${condition ?? 'none'}, not \${{ always() }}`);
  const needs = /^\[(.*)\]$/.exec(value('needs') ?? '')?.[1]?.split(',').map((name) => name.trim()).filter((name) => name !== '') ?? [];
  const others = names.filter((name) => name !== LAST);
  if ([...needs].sort().join(' ') !== [...others].sort().join(' '))
    found.push(`${file}: the job ${LAST} needs ${needs.join(', ') || 'no job'}, not every other job: ${others.join(', ') || 'none'}`);
  if (!lines.some((line) => valueOf(line, 'run') === LAST_RUN)) found.push(`${file}: the job ${LAST} does not run ${LAST_RUN}`);
  return found;
}

/** The steps of the lines of a job: each step its lines, from its line `      - ` to the next. */
function stepsOf(lines: string[]): string[][] {
  const steps: string[][] = [];
  const start = lines.indexOf('    steps:');
  if (start < 0) return steps;
  for (const line of lines.slice(start + 1)) {
    if (/^ {0,4}\S/.test(line)) break;
    if (line.startsWith('      - ')) steps.push([]);
    steps.at(-1)?.push(line);
  }
  return steps;
}

/** The recipe lines of the target `target` of the text of a Makefile, without their tab; empty when no rule names it. */
function recipeOf(makefile: string, target: string): string[] {
  const lines = makefile.split('\n');
  const at = lines.findIndex((line) => new RegExp(`^${target.replaceAll('.', '\\.')} *:(?!=)(?! *[A-Za-z_][A-Za-z0-9_]* *[:?+]?=)`).test(line));
  if (at < 0) return [];
  const recipe: string[] = [];
  for (const line of lines.slice(at + 1)) {
    if (!line.startsWith('\t')) break;
    recipe.push(line.slice(1));
  }
  return recipe;
}

/**
 * The recipe of the job `job` of the workflow `file`: ci-<job> for a job of ci.yml, and ci-<workflow>-<job> for a job of a
 * workflow that ci.yml calls, assets.yml, whose job assets / <job> has the recipe ci-assets-<job>.
 */
function recipeName(file: string, job: string): string {
  return file === CI ? `ci-${job}` : `ci-${basename(file, '.yml')}-${job}`;
}

/**
 * The findings of the steps of the jobs of a workflow that CI runs: each job that has steps runs one make target, recipeName,
 * or for ci-passed its judgement LAST_RUN, with arguments of JOB_ARGUMENT alone; every other step is a uses step, a
 * condition stands on a uses step alone, and no job or step sets env but a job that sets GH_TOKEN alone (JOB_ENV). A job
 * that calls a workflow has no steps of its own.
 */
function jobStepFindings(file: string, text: string): string[] {
  const found: string[] = [];
  for (const [name, lines] of jobsOf(text)) {
    if (lines.some((line) => /^ {4}uses: /.test(line))) continue;
    const at = `${file}: the job ${name}`;
    const env = lines.indexOf(JOB_ENV[0] ?? '');
    const rest = env < 0 ? lines : [...lines.slice(0, env), ...lines.slice(env + 1).filter((line, index) => index !== 0 || line !== JOB_ENV[1])];
    if (env >= 0 && (lines[env + 1] !== JOB_ENV[1] || /^ {6}\S/.test(lines[env + 2] ?? ''))) found.push(`${at} sets env other than GH_TOKEN`);
    if (rest.some((line) => /^ +(?:- )?env:/.test(line))) found.push(`${at} sets env`);
    const steps = stepsOf(lines);
    const runs = steps.map((step) => step.map((line) => valueOf(line, 'run')).find((run) => run !== undefined)).filter((run) => run !== undefined);
    if (runs.length !== 1) found.push(`${at} has ${String(runs.length)} run steps, not one`);
    const [run] = runs;
    if (run !== undefined) {
      if (name === LAST) {
        if (run !== LAST_RUN) found.push(`${at} runs ${run}, not ${LAST_RUN}`);
      } else {
        const [make, target, ...rest] = run.match(/(?:"[^"]*"|\$\{\{[^}]*\}\}|[^\s"])+/g) ?? [];
        if (make !== 'make' || target !== recipeName(file, name)) found.push(`${at} runs ${run}, not make ${recipeName(file, name)}`);
        for (const argument of rest) if (!JOB_ARGUMENT.test(argument)) found.push(`${at} passes ${argument}, which is no make variable of a value, a matrix value or an input`);
      }
    }
    for (const step of steps) {
      const uses = step.some((line) => valueOf(line, 'uses') !== undefined);
      if (!uses && step.some((line) => /^ {6}(?:- | {2})if:/.test(line))) found.push(`${at} has a condition on a run step`);
    }
  }
  return found;
}

/** Accept only the tracked include-list convention, whose keys cannot alter native expansion. */
function includeMatrix(lines: string[], php: boolean): boolean {
  const matrixAt = lines.findIndex((line) => line.startsWith('      matrix:'));
  const matrixEnd = lines.findIndex((line, index) => index > matrixAt && /^ {0,6}\S/.test(line));
  const matrix = lines.slice(matrixAt, matrixEnd < 0 ? undefined : matrixEnd).filter((line) => line.trim() !== '' && !line.trim().startsWith('#')).join('\n');
  const includeOnly = php
    ? /^      matrix:\n        include:\n(?:          - platform: [a-z0-9-]+\n            runner: [a-z0-9.-]+\n            php: '[0-9]+\.[0-9]+'(?:\n|$))+$/
    : /^      matrix:\n        include:\n(?:          - platform: [a-z0-9-]+\n            runner: [a-z0-9.-]+(?:\n|$))+$/;
  return lines.filter((line) => line.startsWith('      matrix:')).length === 1 && includeOnly.test(matrix);
}

/**
 * The findings of the runners of assets.yml: the job platform runs on the runner of its matrix, whose entries are the
 * platforms of the release, each with its runner, and only the separate PHP job may also run on a runner of the matrix.
 */
function platformFindings(file: string, text: string): string[] {
  const found: string[] = [];
  const jobs = jobsOf(text);
  for (const [name, lines] of jobs) {
    if (name !== 'platform' && name !== 'php' && lines.some((line) => valueOf(line, 'runs-on') === MATRIX_RUNNER)) found.push(`${file}: the job ${name} runs on the runner of a matrix`);
  }
  const lines = jobs.get('platform');
  if (lines === undefined) return [...found, `${file}: has no job platform`];
  if (!lines.some((line) => valueOf(line, 'runs-on') === MATRIX_RUNNER)) found.push(`${file}: the job platform does not run on ${MATRIX_RUNNER}`);
  if (!includeMatrix(lines, false)) found.push(`${file}: the job platform matrix must be one explicit include list with only platform and runner`);
  const entries: Record<string, string> = {};
  let platform: string | undefined;
  let count = 0;
  for (const line of lines) {
    const named = valueOf(line, 'platform');
    if (named !== undefined && line.trim().startsWith('- ')) platform = named;
    const runner = valueOf(line, 'runner');
    if (runner !== undefined && platform !== undefined) {
      count += 1;
      entries[platform] = runner;
      platform = undefined;
    }
  }
  const byPlatform = (left: [string, string], right: [string, string]): number => left[0].localeCompare(right[0]);
  if (JSON.stringify(Object.entries(entries).sort(byPlatform)) !== JSON.stringify(Object.entries(PLATFORM_RUNNERS).sort(byPlatform)))
    found.push(`${file}: the job platform runs on ${JSON.stringify(entries)}, not on ${JSON.stringify(PLATFORM_RUNNERS)}`);
  if (count !== Object.keys(entries).length) found.push(`${file}: the job platform repeats a platform`);
  return found;
}

// The run step of the job php and the one line of its recipe ci-assets-php that builds the extension of the minor of the job.
const PHP_RUN = 'make ci-assets-php EXPECTED_PHP_MINOR=${{ matrix.php }} RELEASE=${{ inputs.release }}';
// install-llvm-action also appends DYLD_LIBRARY_PATH and LD_LIBRARY_PATH with /usr/lib first to GITHUB_ENV, which makes
// the PHP of the job load the system libsqlite3 instead of its own and abort; the recipe ci-assets-php empties both with
// target-specific variables and takes the LLVM from LLVM_PATH alone.
const LLVM_ENV_CLEARED = ['ci-assets-php: DYLD_LIBRARY_PATH :=', 'ci-assets-php: LD_LIBRARY_PATH :='];
const PHP_BUILD = '$(MAKE) --no-print-directory release-php-ext PHP=php EXPECTED_PHP_MINOR=$(EXPECTED_PHP_MINOR) $(if $(LLVM_PATH),LLVM_ROOT=$(LLVM_PATH))';
// The native assets of the job platform, which its recipe ci-assets-platform builds once each.
const NON_PHP = ['release-go-static', 'release-wheel', 'release-npm-platform'];

/** The count of the times that the recipe lines of `recipe` name the target `target` as a word. */
function naming(recipe: string[], target: string): number {
  return recipe.reduce((count, line) => count + (line.match(new RegExp(`(?<=^| )${target}(?= |$)`, 'g')) ?? []).length, 0);
}

/**
 * The PHP job isolates every platform and declared minor in a fresh runner: its one PHP setup owns the minor of the matrix
 * and precedes its run step, PHP_RUN, whose recipe ci-assets-php of `makefile` builds the extension once, with PHP_BUILD.
 */
function phpMinorFindings(file: string, text: string, minors: string[], makefile: string): string[] {
  const jobs = jobsOf(text);
  const lines = jobs.get('php');
  if (lines === undefined) return [`${file}: has no job php`];
  const found: string[] = [];
  const fail = (message: string): void => { found.push(`${file}: ${message}`); };
  if (!includeMatrix(lines, true)) fail('the job php matrix must be one explicit include list with only platform, runner and php');
  const entries: { platform: string; runner?: string; php?: string }[] = [];
  for (const line of lines) {
    const platform = valueOf(line, 'platform');
    if (platform !== undefined && line.trim().startsWith('- ')) entries.push({ platform });
    const current = entries.at(-1);
    const runner = valueOf(line, 'runner');
    const php = valueOf(line, 'php')?.replace(/^'|'$/g, '');
    if (current !== undefined && runner !== undefined) current.runner = runner;
    if (current !== undefined && php !== undefined) current.php = php;
  }
  const expected = Object.entries(PLATFORM_RUNNERS).flatMap(([platform, runner]) => minors.map((php) => ({ platform, runner, php })));
  const canonical = (values: typeof entries): string => values.map((entry) => JSON.stringify(entry)).sort().join(' ');
  if (canonical(entries) !== canonical(expected)) fail('the job php does not have the exact platform, runner and PHP minor product');
  if (lines.filter((line) => valueOf(line, 'runs-on') === MATRIX_RUNNER).length !== 1) fail('the job php must run on matrix.runner');
  const setups = lines.filter((line) => valueOf(line, 'uses')?.startsWith('shivammathur/setup-php@') === true);
  const versions = lines.map((line) => valueOf(line, 'php-version')).filter((value) => value !== undefined);
  if (setups.length !== 1 || versions.length !== 1 || versions[0] !== '${{ matrix.php }}') fail('the job php must set up exactly matrix.php once');
  const steps = stepsOf(lines);
  const setupAt = steps.findIndex((step) => step.some((line) => valueOf(line, 'uses')?.startsWith('shivammathur/setup-php@') === true));
  const buildAt = steps.findIndex((step) => step.some((line) => valueOf(line, 'run') !== undefined));
  const setup = steps[setupAt] ?? [];
  if (!setup.includes('        with:') || !setup.includes('          php-version: ${{ matrix.php }}') || setupAt >= buildAt) fail('the PHP setup step must own its minor input and precede the build');
  const runs = lines.map((line) => valueOf(line, 'run')).filter((value) => value !== undefined);
  if (runs.length !== 1 || runs[0] !== PHP_RUN) fail(`the job php must run ${PHP_RUN} once`);
  const upload = lines.findIndex((line) => valueOf(line, 'uses')?.startsWith('actions/upload-artifact@') === true);
  if (upload < 0 || !lines.slice(upload).some((line) => valueOf(line, 'name') === 'assets-php-${{ matrix.platform }}-${{ matrix.php }}')) fail('the job php must publish its unique platform and minor artifact');
  const recipe = (name: string): string[] => recipeOf(makefile, recipeName(file, name));
  const php = recipe('php');
  if (naming(php, 'release-php-ext') !== 1 || !php.includes(PHP_BUILD)) fail(`the recipe ci-assets-php must build once with ${PHP_BUILD}`);
  for (const [name, other] of jobs) {
    if (name === 'php' || name === 'platform') continue;
    if (other.some((line) => valueOf(line, 'uses')?.startsWith('shivammathur/setup-php@') === true || valueOf(line, 'php-version') !== undefined) || ['release-php-ext', ...NON_PHP].some((target) => naming(recipe(name), target) > 0)) fail(`the job ${name} repeats a native asset setup or build`);
  }
  if (NON_PHP.some((target) => naming(php, target) > 0)) fail('the job php must not repeat non-PHP assets');
  const platform = jobs.get('platform') ?? [];
  if (platform.some((line) => valueOf(line, 'php-version') !== undefined) || naming(recipe('platform'), 'release-php-ext') > 0) fail('the job platform must not install or build PHP');
  for (const target of NON_PHP) {
    if (naming(recipe('platform'), target) !== 1) fail(`the job platform must build ${target} once`);
  }
  return found;
}

// The targets of the binding tests that the job bindings of the workflow ci runs through make ci-bindings: the lint and the
// declarations of the bindings, and the tests of each of the five targets of the contract (binding BD-27).
const BINDING_TESTS = ['lint-bindings', 'check-declarations', 'test-python-binding', 'test-node', 'test-wasm', 'test-php', 'test-go'];

/**
 * The findings of the binding tests of the workflow ci: a job bindings runs `make ci-bindings`, ci-passed needs it, and
 * CI_BINDINGS of the Makefile names the targets of BINDING_TESTS, so that no binding goes out as an asset untested.
 */
function bindingJobFindings(file: string, text: string, makefile: string): string[] {
  const jobs = jobsOf(text);
  const found: string[] = [];
  const job = jobs.get('bindings');
  if (job === undefined) found.push(`${file}: has no job bindings`);
  else if (!job.some((line) => valueOf(line, 'run') === 'make ci-bindings')) found.push(`${file}: the job bindings does not run make ci-bindings`);
  const needs = (jobs.get(LAST) ?? []).map((line) => valueOf(line, 'needs')).find((value) => value !== undefined) ?? '';
  if (!/^\[(.*)\]$/.exec(needs)?.[1]?.split(',').map((name) => name.trim()).includes('bindings')) found.push(`${file}: the job ${LAST} does not need the job bindings`);
  const listed = /^CI_BINDINGS := (.*)$/m.exec(makefile)?.[1]?.split(/ +/) ?? [];
  if ([...listed].sort().join(' ') !== [...BINDING_TESTS].sort().join(' ')) found.push(`Makefile: CI_BINDINGS is ${listed.join(' ') || 'empty'}, not ${BINDING_TESTS.join(' ')}`);
  return found;
}

/** The findings of a workflow that must call assets.yml: one of its jobs uses it (binding GN-19i). */
function callFindings(file: string, text: string): string[] {
  const calls = [...jobsOf(text).values()].some((lines) => lines.some((line) => /^ {4}uses: \.\/\.github\/workflows\/assets\.yml$/.test(line)));
  return calls ? [] : [`${file}: no job calls ./${ASSETS}`];
}

const TARGETS = new Set(['docs-check', 'release-tag', 'ci-passed']);
const ACTIONS = new Set(['./.github/actions/bootstrap']);
const GOOD = `# actions/checkout v7.0.1: the checkout.
name: ci
on:
  push:
    branches: [main]
  workflow_dispatch:
jobs:
  shared:
    runs-on: ubuntu-26.04-arm
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1
        with:
          fetch-depth: 0
      - uses: ./.github/actions/bootstrap
      - name: documents
        run: make docs-check
      - run: make release-tag RUN=1 \${{ github.event_name == 'workflow_run' && 'AUTO=1' || '' }}
`;

test('a workflow that keeps every rule has no finding', () => {
  assert.deepEqual(findings(CI, GOOD, TARGETS, ACTIONS), []);
  assert.deepEqual(triggerFindings(CI, GOOD), []);
  // The input `run` of a dispatch is a mapping, no run step.
  assert.deepEqual(findings(CI, GOOD.replace('  workflow_dispatch:\n', '  workflow_dispatch:\n    inputs:\n      run:\n        required: true\n'), TARGETS, ACTIONS), []);
});

test('each broken rule of a workflow is a finding', () => {
  const broken = (from: string, to: string): string[] => {
    assert.ok(GOOD.includes(from), `the sample holds no ${from}`);
    return findings(CI, GOOD.replace(from, to), TARGETS, ACTIONS);
  };
  assert.deepEqual(broken('runs-on: ubuntu-26.04-arm', 'runs-on: ubuntu-24.04'), [`${CI}:9: runs on ubuntu-24.04, not on ${RUNNER}`]);
  assert.deepEqual(broken('    runs-on: ubuntu-26.04-arm\n', ''), [`${CI}: names no runner`]);
  assert.deepEqual(broken('    steps:', '    timeout-minutes: 10\n    steps:'), [`${CI}:10: sets timeout-minutes`]);
  assert.deepEqual(broken('@3d3c42e5aac5ba805825da76410c181273ba90b1', '@v7'), [`${CI}:11: uses actions/checkout@v7, which is not pinned by a full commit`]);
  assert.deepEqual(broken('@3d3c42e5aac5ba805825da76410c181273ba90b1', '@3d3c42e'), [`${CI}:11: uses actions/checkout@3d3c42e, which is not pinned by a full commit`]);
  assert.deepEqual(broken('# actions/checkout v7.0.1: the checkout.', '# The checkout.'), [`${CI}:11: no comment names the release of actions/checkout`]);
  assert.deepEqual(broken('./.github/actions/bootstrap', './.github/actions/other'), [`${CI}:14: uses ./.github/actions/other, which is no tracked action`]);
  assert.deepEqual(broken('run: make docs-check', 'run: node scripts/check.mts'), [`${CI}:16: the run step is not one make target: node scripts/check.mts`]);
  assert.deepEqual(broken('run: make docs-check', 'run: make docs-check && make release-tag'), [`${CI}:16: the run step is not one make target: make docs-check && make release-tag`]);
  assert.deepEqual(broken('run: make docs-check', 'run: make docs-check release-tag'), [`${CI}:16: the run step is not one make target: make docs-check release-tag`]);
  assert.deepEqual(broken('run: make docs-check', 'run: make test'), [`${CI}:16: the Makefile defines no target test`]);
  assert.deepEqual(broken('run: make docs-check', 'run: make docs-check TOOLS="alint php python"'), []);
  assert.deepEqual(broken('run: make docs-check', 'run: make docs-check TOOLS="a; b"'), [`${CI}:16: the run step is not one make target: make docs-check TOOLS="a; b"`]);
  assert.deepEqual(broken('run: make docs-check', 'run: |\n          make docs-check'), [`${CI}:16: the run step is not one make target: |`, `${CI}:16: the run step continues on a later line`]);
  assert.deepEqual(broken('run: make docs-check', 'run:\n          make docs-check && make release-tag'), [`${CI}:16: the run step is not one make target: `, `${CI}:16: the run step continues on a later line`]);
  assert.deepEqual(broken('run: make docs-check', 'run: make docs-check\n          make release-tag'), [`${CI}:16: the run step continues on a later line`]);
});

test('a workflow without its top-level keys is a finding', () => {
  assert.deepEqual(topLevelFindings(CI, GOOD), []);
  const cut = `# The checkout.\n  shared:\n    runs-on: ubuntu-26.04-arm\n`;
  assert.deepEqual(topLevelFindings(RELEASE, cut), [`${RELEASE}: has no top-level key name`, `${RELEASE}: has no top-level key on`, `${RELEASE}: has no top-level key jobs`, `${RELEASE}:2: a job comes before the top-level keys`]);
  assert.deepEqual(topLevelFindings(CI, GOOD.replace('jobs:\n', 'job:\n')), [`${CI}: has no top-level key jobs`, `${CI}: has the top-level key job, which a workflow does not take`]);
});

test('each trigger of the workflow ci other than a push of main and workflow_dispatch is a finding', () => {
  assert.deepEqual(triggerFindings(CI, GOOD.replace('on:\n', 'on:\n  pull_request:\n')), [`${CI}: starts on pull_request, push, workflow_dispatch, not on push and workflow_dispatch alone`]);
  assert.deepEqual(triggerFindings(CI, GOOD.replace('  workflow_dispatch:\n', '')), [`${CI}: starts on push, not on push and workflow_dispatch alone`]);
  assert.deepEqual(triggerFindings(CI, GOOD.replace('branches: [main]', 'branches: [main, next]')), [`${CI}: the push is not of main alone`]);
  assert.deepEqual(triggerFindings(CI, GOOD.replace('    branches: [main]\n', '')), [`${CI}: the push is not of main alone`]);
  assert.deepEqual(triggerFindings(CI, GOOD.replace('on:\n', 'on: [push]\n')), [`${CI}: has no block on:`]);
});

const LAST_JOB = `  rust:
    runs-on: ubuntu-26.04-arm
    steps:
      - run: make docs-check
  ci-passed:
    if: \${{ always() }}
    needs: [shared, rust]
    runs-on: ubuntu-26.04-arm
    steps:
      - uses: ./.github/actions/bootstrap
      - name: every job passed
        run: make ci-passed FAIL_SKIPPED=1 RESULTS='\${{ toJSON(needs) }}'
`;

test('the last job of the workflow ci is ci-passed, which needs every other job and judges their results', () => {
  const good = GOOD + LAST_JOB;
  assert.deepEqual(findings(CI, good, TARGETS, ACTIONS), []);
  assert.deepEqual(lastJobFindings(CI, good), []);
  const broken = (from: string, to: string): string[] => {
    assert.ok(good.includes(from), `the sample holds no ${from}`);
    return lastJobFindings(CI, good.replace(from, to));
  };
  assert.deepEqual(lastJobFindings(CI, GOOD), [`${CI}: the last job is shared, not ci-passed`]);
  assert.deepEqual(lastJobFindings(CI, `${good}  later:\n    runs-on: ubuntu-26.04-arm\n`), [`${CI}: the last job is later, not ci-passed`]);
  assert.deepEqual(lastJobFindings(CI, 'name: ci\njobs:\n'), [`${CI}: has no job`]);
  assert.deepEqual(broken('    if: ${{ always() }}\n', ''), [`${CI}: the job ci-passed has the condition none, not \${{ always() }}`]);
  assert.deepEqual(broken('if: ${{ always() }}', 'if: ${{ success() }}'), [`${CI}: the job ci-passed has the condition \${{ success() }}, not \${{ always() }}`]);
  assert.deepEqual(broken('needs: [shared, rust]', 'needs: [shared]'), [`${CI}: the job ci-passed needs shared, not every other job: shared, rust`]);
  assert.deepEqual(broken('    needs: [shared, rust]\n', ''), [`${CI}: the job ci-passed needs no job, not every other job: shared, rust`]);
  assert.deepEqual(broken('needs: [shared, rust]', 'needs: [shared, rust, other]'), [`${CI}: the job ci-passed needs shared, rust, other, not every other job: shared, rust`]);
  assert.deepEqual(broken(" RESULTS='${{ toJSON(needs) }}'", ''), [`${CI}: the job ci-passed does not run ${LAST_RUN}`]);
  assert.deepEqual(broken('run: make ci-passed FAIL_SKIPPED=1', 'run: make ci-passed'), [`${CI}: the job ci-passed does not run ${LAST_RUN}`]);
});

test('the Makefile rules name their targets', () => {
  assert.deepEqual([...makeTargets('A := b\n.PHONY: x\nx y: z\n\trun: it\nbindings-%: w\ntest-php: export PHP := php\n')].sort(), ['test-php', 'x', 'y']);
});

const PLATFORM = `name: assets
jobs:
  platform:
    strategy:
      matrix:
        include:
          - platform: linux-x64-gnu
            runner: ubuntu-26.04
          - platform: linux-arm64-gnu
            runner: ubuntu-26.04-arm
          - platform: darwin-arm64
            runner: macos-15
    runs-on: \${{ matrix.runner }}
    steps:
      - run: make docs-check
  npm:
    runs-on: ubuntu-26.04-arm
    steps:
      - run: make docs-check
`;

test('the job platform of assets.yml alone runs on the runner of each platform of the release', () => {
  assert.deepEqual(findings(ASSETS, PLATFORM, TARGETS, ACTIONS), []);
  assert.deepEqual(platformFindings(ASSETS, PLATFORM), []);
  const broken = (from: string, to: string): string[] => {
    assert.ok(PLATFORM.includes(from), `the sample holds no ${from}`);
    const text = PLATFORM.replace(from, to);
    return [...findings(ASSETS, text, TARGETS, ACTIONS), ...platformFindings(ASSETS, text)];
  };
  // The runner of a matrix in another workflow is a runner that is not ubuntu-26.04-arm.
  assert.deepEqual(findings(CI, PLATFORM, TARGETS, ACTIONS), [`${CI}:13: runs on \${{ matrix.runner }}, not on ${RUNNER}`]);
  assert.deepEqual(broken('runner: ubuntu-26.04\n', 'runner: ubuntu-24.04\n'), [`${ASSETS}: the job platform runs on {"linux-x64-gnu":"ubuntu-24.04","linux-arm64-gnu":"ubuntu-26.04-arm","darwin-arm64":"macos-15"}, not on ${JSON.stringify(PLATFORM_RUNNERS)}`]);
  assert.deepEqual(broken('          - platform: darwin-arm64\n            runner: macos-15\n', ''), [`${ASSETS}: the job platform runs on {"linux-x64-gnu":"ubuntu-26.04","linux-arm64-gnu":"ubuntu-26.04-arm"}, not on ${JSON.stringify(PLATFORM_RUNNERS)}`]);
  assert.deepEqual(broken('    runs-on: ${{ matrix.runner }}', '    runs-on: macos-15'), [`${ASSETS}:13: runs on macos-15, not on ${RUNNER}`, `${ASSETS}: the job platform does not run on ${MATRIX_RUNNER}`]);
  assert.deepEqual(broken('  npm:\n    runs-on: ubuntu-26.04-arm', '  npm:\n    runs-on: ${{ matrix.runner }}'), [`${ASSETS}: the job npm runs on the runner of a matrix`]);
  assert.deepEqual(platformFindings(ASSETS, PLATFORM.replace('  platform:', '  build:')), [`${ASSETS}: the job build runs on the runner of a matrix`, `${ASSETS}: has no job platform`]);
});

test('a workflow that calls assets.yml has no finding of the call, and one that does not is a finding', () => {
  const calling = `${GOOD}  assets:\n    uses: ./.github/workflows/assets.yml\n`;
  assert.deepEqual(callFindings(CI, calling), []);
  assert.deepEqual(findings(CI, calling, TARGETS, new Set([...ACTIONS, `./${ASSETS}`])), []);
  assert.deepEqual(callFindings(CI, GOOD), [`${CI}: no job calls ./${ASSETS}`]);
});

const PHP_SAMPLE = `jobs:
  platform:
    runs-on: \${{ matrix.runner }}
    steps:
      - run: make ci-assets-platform RELEASE=\${{ inputs.release }}
  php:
    strategy:
      matrix:
        include:
${Object.entries(PLATFORM_RUNNERS).flatMap(([platform, runner]) => ['8.4', '8.5'].map((php) => `          - platform: ${platform}\n            runner: ${runner}\n            php: '${php}'`)).join('\n')}
    runs-on: \${{ matrix.runner }}
    steps:
      - uses: shivammathur/setup-php@eb7c497e18156a6bbabfef1d3a82760b9eda3962
        with:
          php-version: \${{ matrix.php }}
      - run: make ci-assets-php EXPECTED_PHP_MINOR=\${{ matrix.php }} RELEASE=\${{ inputs.release }}
      - uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a
        with:
          name: assets-php-\${{ matrix.platform }}-\${{ matrix.php }}
`;
const PHP_MAKEFILE = `ci-assets-platform: ## The assets of the platform
	$(MAKE) --no-print-directory release-recipes
	$(NODE) $(KIT)/ci-targets.mjs -k $(CI_REPORT) release-go-static release-wheel release-npm-platform
ci-assets-php: ## The PHP extension of EXPECTED_PHP_MINOR
	$(MAKE) --no-print-directory release-recipes
	${PHP_BUILD}
ci-assets-other: ## Another job
	$(MAKE) --no-print-directory release-recipes
`;

test('PHP asset jobs isolate the exact platform and minor product (T2.22)', () => {
  assert.deepEqual(phpMinorFindings(ASSETS, PHP_SAMPLE, ['8.4', '8.5'], PHP_MAKEFILE), []);
  const mutations = [
    PHP_SAMPLE.replace("            php: '8.4'", "            php: '8.5'"),
    PHP_SAMPLE.replace(/          - platform: linux-x64-gnu\n            runner: ubuntu-26.04\n            php: '8.4'\n/, ''),
    PHP_SAMPLE.replaceAll('    runs-on: ${{ matrix.runner }}\n    steps:', "          - platform: linux-x64-gnu\n            runner: ubuntu-26.04\n            php: '8.4'\n    runs-on: ${{ matrix.runner }}\n    steps:"),
    PHP_SAMPLE.replace('            runner: ubuntu-26.04', '            runner: macos-15'),
    PHP_SAMPLE.replace("            php: '8.4'", "            php: '8.6'"),
    PHP_SAMPLE.replaceAll('    runs-on: ${{ matrix.runner }}\n    steps:', '    runs-on: macos-15\n    steps:'),
    PHP_SAMPLE.replace('php-version: ${{ matrix.php }}', "php-version: '8.4'"),
    PHP_SAMPLE.replace('      - run: make ci-assets-php', '      - uses: shivammathur/setup-php@duplicate\n      - run: make ci-assets-php'),
    PHP_SAMPLE.replace(' EXPECTED_PHP_MINOR=${{ matrix.php }}', ''),
    PHP_SAMPLE.replace('      - run: make ci-assets-php', '      - run: make ci-assets-php PHP=php\n      - run: make ci-assets-php'),
    PHP_SAMPLE.replace('assets-php-${{ matrix.platform }}-${{ matrix.php }}', 'assets-${{ matrix.platform }}'),
  ];
  for (const [index, mutation] of mutations.entries()) assert.notDeepEqual(phpMinorFindings(ASSETS, mutation, ['8.4', '8.5'], PHP_MAKEFILE), [], `mutation ${index}`);
  const recipes = [
    PHP_MAKEFILE.replace(' release-wheel ', ' '),
    PHP_MAKEFILE.replace(' release-wheel ', ' release-wheel release-wheel '),
    PHP_MAKEFILE.replace('ci-assets-platform: ## The assets of the platform\n', `ci-assets-platform: ## The assets of the platform\n\t${PHP_BUILD}\n`),
    PHP_MAKEFILE.replace(' EXPECTED_PHP_MINOR=$(EXPECTED_PHP_MINOR)', ''),
    PHP_MAKEFILE.replace(PHP_BUILD, `${PHP_BUILD}\n\t${PHP_BUILD}`),
    PHP_MAKEFILE.replace(PHP_BUILD, `${PHP_BUILD}\n\t$(MAKE) release-wheel`),
  ];
  for (const [index, recipe] of recipes.entries()) assert.notDeepEqual(phpMinorFindings(ASSETS, PHP_SAMPLE, ['8.4', '8.5'], recipe), [], `recipe mutation ${index}`);
  assert.notDeepEqual(phpMinorFindings(ASSETS, PHP_SAMPLE, ['8.4', '8.5', '8.6'], PHP_MAKEFILE), []);
});

test('PHP jobs reject matrix shape changes and detached or late setup (T2.22)', () => {
  const build = `      - run: ${PHP_RUN}\n`;
  const version = '          php-version: ${{ matrix.php }}\n';
  const mutations = [
    PHP_SAMPLE.replace('      matrix:\n', '      matrix:\n        extra: [one, two]\n'),
    PHP_SAMPLE.replace('      matrix:\n', '      matrix:\n        exclude: [{platform: linux-x64-gnu}]\n'),
    PHP_SAMPLE.replace('      matrix:\n', '      matrix: {extra: [one, two]}\n'),
    PHP_SAMPLE.replace('        include:\n', '        include: []\n'),
    PHP_SAMPLE.replace('        include:\n', '        include:\n        include:\n'),
    PHP_SAMPLE.replace("            php: '8.4'", "            php: '8.4'\n            extra: one"),
    PHP_SAMPLE.replace(build, '').replace('      - uses: shivammathur/setup-php@', build + '      - uses: shivammathur/setup-php@'),
    PHP_SAMPLE.replace(version, '').replace(build, build + '        with:\n' + version),
  ];
  for (const [index, mutation] of mutations.entries()) assert.notDeepEqual(phpMinorFindings(ASSETS, mutation, ['8.4', '8.5'], PHP_MAKEFILE), [], `shape/setup mutation ${index}`);
});

test('asset ownership rejects non-PHP matrix axes and builds in other jobs (T2.22)', () => {
  for (const extra of ['        extra: [one, two]\n', '        exclude: [{platform: linux-x64-gnu}]\n']) {
    assert.notDeepEqual(platformFindings(ASSETS, PLATFORM.replace('      matrix:\n', '      matrix:\n' + extra)), []);
  }
  const other = PHP_SAMPLE + '  other:\n    runs-on: ubuntu-26.04-arm\n    steps:\n      - run: make ci-assets-other\n';
  assert.deepEqual(phpMinorFindings(ASSETS, other, ['8.4', '8.5'], PHP_MAKEFILE), []);
  assert.notDeepEqual(phpMinorFindings(ASSETS, other.replace('      - run: make ci-assets-other', '      - uses: shivammathur/setup-php@duplicate\n      - run: make ci-assets-other'), ['8.4', '8.5'], PHP_MAKEFILE), []);
  for (const target of ['release-php-ext PHP=php', 'release-go-static', 'release-wheel', 'release-npm-platform']) {
    assert.notDeepEqual(phpMinorFindings(ASSETS, other, ['8.4', '8.5'], `${PHP_MAKEFILE}\t$(MAKE) ${target}\n`), [], target);
  }
});

const JOBS = `jobs:
  shared:
    runs-on: ubuntu-26.04-arm
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1
      - uses: ./.github/actions/bootstrap
      - name: shared checks
        run: make ci-shared
      - name: report
        if: \${{ !cancelled() }}
        uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a
  php:
    runs-on: \${{ matrix.runner }}
    steps:
      - run: make ci-php EXPECTED_PHP_MINOR=\${{ matrix.php }} RELEASE=\${{ inputs.release }} TOOLS="uv python"
  assets:
    uses: ./.github/workflows/assets.yml
${LAST_JOB.replace(/^ {2}rust:\n(?: {4}.*\n)*/, '')}`;

test('every job of CI runs its recipe ci-<job> in one run step, and its other steps are uses steps', () => {
  assert.deepEqual(jobStepFindings(CI, JOBS), []);
  assert.deepEqual(jobStepFindings(ASSETS, JOBS.replace('make ci-php ', 'make ci-assets-php ').replace(/^ {2}(?:shared|assets|ci-passed):\n(?: {4}.*\n)*/gm, '')), []);
  assert.deepEqual(jobStepFindings(ASSETS, JOBS.replace(/^ {2}(?:shared|assets|ci-passed):\n(?: {4}.*\n)*/gm, '')), [`${ASSETS}: the job php runs make ci-php EXPECTED_PHP_MINOR=\${{ matrix.php }} RELEASE=\${{ inputs.release }} TOOLS="uv python", not make ci-assets-php`]);
  const broken = (from: string, to: string): string[] => {
    assert.ok(JOBS.includes(from), `the sample holds no ${from}`);
    return jobStepFindings(CI, JOBS.replace(from, to));
  };
  assert.deepEqual(broken('        run: make ci-shared\n', ''), [`${CI}: the job shared has 0 run steps, not one`]);
  assert.deepEqual(broken('        run: make ci-shared\n', '        run: make ci-shared\n      - run: make install-tools\n'), [`${CI}: the job shared has 2 run steps, not one`]);
  assert.deepEqual(broken('run: make ci-shared', 'run: make shared-checks'), [`${CI}: the job shared runs make shared-checks, not make ci-shared`]);
  assert.deepEqual(broken('run: make ci-shared', 'run: make ci-shared CI_REPORT=${{ runner.temp }}'), [`${CI}: the job shared passes CI_REPORT=\${{ runner.temp }}, which is no make variable of a value, a matrix value or an input`]);
  assert.deepEqual(broken('run: make ci-shared', 'run: make ci-shared ${{ matrix.php }}'), [`${CI}: the job shared passes \${{ matrix.php }}, which is no make variable of a value, a matrix value or an input`]);
  assert.deepEqual(broken('      - name: shared checks\n', '      - name: shared checks\n        if: ${{ !cancelled() }}\n'), [`${CI}: the job shared has a condition on a run step`]);
  assert.deepEqual(broken('      - name: shared checks\n', '      - name: shared checks\n        env:\n          TOOLS: alint\n'), [`${CI}: the job shared sets env`]);
  assert.deepEqual(broken("RESULTS='${{ toJSON(needs) }}'", 'RESULTS=${{ toJSON(needs) }}'), [`${CI}: the job ci-passed runs make ci-passed FAIL_SKIPPED=1 RESULTS=\${{ toJSON(needs) }}, not ${LAST_RUN}`]);
  // The jobs of release.yml run ci-release-<job>, with the outputs of the job tag and quoted expressions of the event, and
  // set the token of the run alone.
  const release = `jobs:
  tag:
    runs-on: ubuntu-26.04-arm
    env:
      GH_TOKEN: \${{ github.token }}
    steps:
      - id: tag
        run: make ci-release-tag RUN="\${{ inputs.run || github.event.workflow_run.id }}" AUTO="\${{ github.event_name == 'workflow_run' && '1' || '' }}"
  release:
    runs-on: ubuntu-26.04-arm
    env:
      GH_TOKEN: \${{ github.token }}
    steps:
      - uses: ./.github/actions/bootstrap
      - run: make ci-release-release TAG=\${{ needs.tag.outputs.tag }} VERSION=\${{ needs.tag.outputs.version }}
`;
  assert.deepEqual(jobStepFindings(RELEASE, release), []);
  assert.deepEqual(jobStepFindings(RELEASE, release.replace('make ci-release-tag', 'make release-tag')), [`${RELEASE}: the job tag runs make release-tag RUN="\${{ inputs.run || github.event.workflow_run.id }}" AUTO="\${{ github.event_name == 'workflow_run' && '1' || '' }}", not make ci-release-tag`]);
  assert.deepEqual(jobStepFindings(RELEASE, release.replace('      GH_TOKEN: ${{ github.token }}\n    steps:\n      - id', '      GH_TOKEN: ${{ github.token }}\n      TAG: v1\n    steps:\n      - id')), [`${RELEASE}: the job tag sets env other than GH_TOKEN`]);
  assert.deepEqual(jobStepFindings(RELEASE, release.replace('      GH_TOKEN: ${{ github.token }}\n    steps:\n      - id', '      TAG: v1\n    steps:\n      - id')), [`${RELEASE}: the job tag sets env other than GH_TOKEN`]);
  assert.deepEqual(jobStepFindings(RELEASE, release.replace('      - run: make ci-release-release', '      - run: make release-tools\n      - run: make ci-release-release')), [`${RELEASE}: the job release has 2 run steps, not one`, `${RELEASE}: the job release runs make release-tools, not make ci-release-release`]);
  assert.deepEqual(jobStepFindings(RELEASE, release.replace('      - run: make ci-release-release', '      - env:\n          GIT_AUTHOR_NAME: x\n        run: make ci-release-release')), [`${RELEASE}: the job release sets env`]);
});

test('the workflow ci runs the binding tests of the five targets in a job that ci-passed needs', () => {
  const makefile = `CI_BINDINGS := ${BINDING_TESTS.join(' ')}\n`;
  const good = `${GOOD}  bindings:\n    runs-on: ubuntu-26.04-arm\n    steps:\n      - run: make ci-bindings\n${LAST_JOB.replace('needs: [shared, rust]', 'needs: [shared, rust, bindings]')}`;
  assert.deepEqual(bindingJobFindings(CI, good, makefile), []);
  assert.deepEqual(bindingJobFindings(CI, GOOD + LAST_JOB, makefile), [`${CI}: has no job bindings`, `${CI}: the job ${LAST} does not need the job bindings`]);
  assert.deepEqual(bindingJobFindings(CI, good.replace('run: make ci-bindings', 'run: make docs-check'), makefile), [`${CI}: the job bindings does not run make ci-bindings`]);
  assert.deepEqual(bindingJobFindings(CI, good, makefile.replace(' test-go', '')), [`Makefile: CI_BINDINGS is ${BINDING_TESTS.filter((name) => name !== 'test-go').join(' ')}, not ${BINDING_TESTS.join(' ')}`]);
});

/**
 * The findings of the recipes of the jobs: every target that a recipe ci-<job> makes with $(MAKE) is a target of the
 * Makefile or of the release recipes that it includes, so that a job does not stop at a target that the pinned binding
 * no longer writes (binding 0.0.7 writes no install-llvm).
 */
function recipeTargetFindings(makefile: string, targets: Set<string>): string[] {
  const found: string[] = [];
  for (const job of new Set([...makefile.matchAll(/^(ci-[a-z0-9-]+) *:(?!=)/gm)].map((match) => match[1] ?? ''))) {
    for (const line of recipeOf(makefile, job)) {
      for (const match of line.matchAll(/\$\(MAKE\)(?: --no-print-directory)? ([a-z][a-z0-9-]*)/g)) {
        if (!targets.has(match[1] ?? '')) found.push(`Makefile: the recipe ${job} makes ${match[1] ?? ''}, which neither the Makefile nor the release recipes define`);
      }
    }
  }
  return found;
}

/** The LLVM step of the job php: KyleMayes/install-llvm-action, pinned by its commit (GN-19i). */
const LLVM_ACTION = /^ {6}- uses: KyleMayes\/install-llvm-action@[0-9a-f]{40}$/;
/** The tail of the build line of ci-assets-php that builds with the LLVM that the step installed. */
const LLVM_ROOT_ARGUMENT = '$(if $(LLVM_PATH),LLVM_ROOT=$(LLVM_PATH))';

/**
 * The findings of the LLVM of the job php of assets.yml (binding GN-19i): the job provisions the LLVM of
 * config/toolchain.json before its run step on a runner whose image holds none, macOS, with one uses step of
 * install-llvm-action of a release of that major, and its recipe passes the LLVM_PATH of that step as LLVM_ROOT. The
 * ubuntu-26.04 images hold the LLVM at /usr/lib/llvm-<major>, the default LLVM_ROOT of the release recipes.
 */
function llvmFindings(file: string, text: string, major: string, makefile: string): string[] {
  const steps = stepsOf(jobsOf(text).get('php') ?? []);
  const found: string[] = [];
  const llvm = steps.filter((step) => LLVM_ACTION.test(step[0] ?? ''));
  const run = steps.findIndex((step) => step.some((line) => valueOf(line, 'run') !== undefined));
  if (llvm.length !== 1) return [`${file}: the job php provisions LLVM in ${String(llvm.length)} uses steps of install-llvm-action pinned by a commit, not one`];
  const step = llvm[0] ?? [];
  if (!step.includes("        if: runner.os == 'macOS'")) found.push(`${file}: the LLVM step of the job php does not run on macOS alone`);
  if (!step.some((line) => new RegExp(`^ {10}version: '${major}\\.[0-9]+\\.[0-9]+'$`).test(line))) found.push(`${file}: the LLVM step of the job php installs no LLVM ${major} of config/toolchain.json`);
  if (steps.indexOf(step) > run) found.push(`${file}: the LLVM step of the job php comes after its run step`);
  if (LLVM_ENV_CLEARED.some((line) => !makefile.split('\n').includes(line))) found.push(`Makefile: the build of ci-assets-php keeps the DYLD_LIBRARY_PATH and LD_LIBRARY_PATH of install-llvm-action`);
  if (!recipeOf(makefile, 'ci-assets-php').some((line) => /\brelease-php-ext\b/.test(line) && line.endsWith(` ${LLVM_ROOT_ARGUMENT}`))) found.push(`Makefile: the build of ci-assets-php does not pass ${LLVM_ROOT_ARGUMENT}`);
  return found;
}

/** The line of ci-release-release that carries the downloaded platform assets, with their folders, into the release assets. */
const CARRY_ASSETS = 'mkdir -p var/release/assets && cp -R var/release/downloaded/. var/release/assets/';

/**
 * The findings of the carry of the platform assets: the jobs of assets.yml upload the folders go, npm, php-ext and wheel
 * that the release recipes write, and release-platform-assets reads them there, so the release job copies the folder
 * var/release/downloaded with its subfolders; a copy of its top files alone stops at the first folder.
 */
function carryFindings(makefile: string): string[] {
  return recipeOf(makefile, 'ci-release-release').includes(CARRY_ASSETS) ? [] : [`Makefile: the recipe ci-release-release does not carry the downloaded assets with ${CARRY_ASSETS}`];
}

test('the release job carries the downloaded platform assets with their folders', () => {
  const makefile = `ci-release-release:\n\t${CARRY_ASSETS}\n`;
  assert.deepEqual(carryFindings(makefile), []);
  assert.deepEqual(carryFindings(makefile.replace('cp -R var/release/downloaded/.', 'cp var/release/downloaded/*')), [`Makefile: the recipe ci-release-release does not carry the downloaded assets with ${CARRY_ASSETS}`]);
});

/** The major release of LLVM that config/toolchain.json pins (llvm.version). */
function llvmMajor(): string {
  const toolchain: unknown = JSON.parse(readFileSync(join(root, 'config/toolchain.json'), 'utf8'));
  const llvm: unknown = typeof toolchain === 'object' && toolchain !== null && 'llvm' in toolchain ? toolchain.llvm : undefined;
  const version: unknown = typeof llvm === 'object' && llvm !== null && 'version' in llvm ? llvm.version : undefined;
  assert.ok(typeof version === 'string' && /^[0-9]+$/.test(version), 'config/toolchain.json pins no major release of LLVM (llvm.version)');
  return version;
}

test('a recipe of a job makes only defined targets, and the job php provisions LLVM on macOS before its run step', () => {
  const makefile = `${LLVM_ENV_CLEARED.join('\n')}\n` + 'ci-assets-php:\n\t$(MAKE) --no-print-directory release-recipes\n\t$(MAKE) --no-print-directory release-php-ext PHP=php EXPECTED_PHP_MINOR=$(EXPECTED_PHP_MINOR) $(if $(LLVM_PATH),LLVM_ROOT=$(LLVM_PATH))\n';
  const targets = new Set(['ci-assets-php', 'release-recipes', 'release-php-ext']);
  assert.deepEqual(recipeTargetFindings(makefile, targets), []);
  assert.deepEqual(recipeTargetFindings(makefile.replace('release-recipes', 'install-llvm'), targets), ['Makefile: the recipe ci-assets-php makes install-llvm, which neither the Makefile nor the release recipes define']);
  const job = `jobs:\n  php:\n    runs-on: \${{ matrix.runner }}\n    steps:\n      - uses: ./.github/actions/bootstrap\n      - uses: KyleMayes/install-llvm-action@ebc0426251bc40c7cd31162802432c68818ab8f0\n        if: runner.os == 'macOS'\n        with:\n          version: '21.1.8'\n      - run: make ci-assets-php\n`;
  assert.deepEqual(llvmFindings(ASSETS, job, '21', makefile), []);
  assert.deepEqual(llvmFindings(ASSETS, job.replace("        if: runner.os == 'macOS'\n", ''), '21', makefile), [`${ASSETS}: the LLVM step of the job php does not run on macOS alone`]);
  assert.deepEqual(llvmFindings(ASSETS, job, '22', makefile), [`${ASSETS}: the LLVM step of the job php installs no LLVM 22 of config/toolchain.json`]);
  assert.deepEqual(llvmFindings(ASSETS, job.replace('@ebc0426251bc40c7cd31162802432c68818ab8f0', '@v2'), '21', makefile), [`${ASSETS}: the job php provisions LLVM in 0 uses steps of install-llvm-action pinned by a commit, not one`]);
  for (const line of LLVM_ENV_CLEARED) {
    assert.deepEqual(llvmFindings(ASSETS, job, '21', makefile.replace(`${line}\n`, '')), ['Makefile: the build of ci-assets-php keeps the DYLD_LIBRARY_PATH and LD_LIBRARY_PATH of install-llvm-action']);
  }
  assert.deepEqual(llvmFindings(ASSETS, job, '21', makefile.replace(` ${LLVM_ROOT_ARGUMENT}`, '')), [`Makefile: the build of ci-assets-php does not pass ${LLVM_ROOT_ARGUMENT}`]);
});

/** The PHP minors of the extension that config/toolchain.json names (phpExtension.minors). */
function phpMinors(): string[] {
  const toolchain: unknown = JSON.parse(readFileSync(join(root, 'config/toolchain.json'), 'utf8'));
  const extension: unknown = typeof toolchain === 'object' && toolchain !== null && 'phpExtension' in toolchain ? toolchain.phpExtension : undefined;
  const minors: unknown = typeof extension === 'object' && extension !== null && 'minors' in extension ? extension.minors : undefined;
  const named: unknown[] = Array.isArray(minors) ? minors : [];
  const valid = named.filter((minor): minor is string => typeof minor === 'string' && /^[0-9]+\.[0-9]+$/.test(minor));
  assert.ok(valid.length > 0 && valid.length === named.length, 'config/toolchain.json names no PHP minors of the extension (phpExtension.minors)');
  return valid;
}

/**
 * The targets of the release recipes that binding release-recipes writes for the contract, which the Makefile includes
 * (binding GN-19h). The file is generated and not tracked, so the test writes it into a folder of its own with the binding
 * of package.json and reads the targets from there.
 */
function releaseRecipeTargets(t: { after: (fn: () => void) => void }): Set<string> {
  const out = mkdtempSync(join(tmpdir(), 'php-serialization-recipes-'));
  t.after(() => { rmSync(out, { recursive: true, force: true }); });
  execFileSync(join(root, 'node_modules/.bin/binding'), ['release-recipes', '--root', root, '--out', out], { stdio: ['ignore', 'ignore', 'inherit'] });
  return makeTargets(readFileSync(join(out, 'packages/release.mk'), 'utf8'));
}

test('the workflows and the actions of the repository keep the rules', (t) => {
  const tracked = execFileSync('git', ['-C', root, 'ls-files', '-z', '--', '.github'], { encoding: 'utf8' }).split('\0').filter((file) => file !== '');
  const workflows = tracked.filter((file) => /^\.github\/workflows\/[^/]+\.yml$/.test(file));
  const actionFiles = tracked.filter((file) => /^\.github\/actions\/[^/]+\/action\.yml$/.test(file));
  assert.deepEqual(tracked.filter((file) => !workflows.includes(file) && !actionFiles.includes(file)), [], 'a tracked file of .github is no workflow and no action');
  for (const file of [CI, RELEASE, ASSETS]) assert.ok(workflows.includes(file), `${file} is not tracked`);
  const recipes = releaseRecipeTargets(t);
  assert.ok(recipes.has('release-go-static'), `the release recipes define no target release-go-static: ${[...recipes].join(', ')}`);
  const targets = new Set([...makeTargets(readFileSync(join(root, 'Makefile'), 'utf8')), ...recipes]);
  const actions = new Set([...actionFiles.map((file) => `./${dirname(file)}`), `./${ASSETS}`]);
  const found = [...workflows, ...actionFiles].flatMap((file) => findings(file, readFileSync(join(root, file), 'utf8'), targets, actions));
  for (const file of workflows) found.push(...topLevelFindings(file, readFileSync(join(root, file), 'utf8')));
  found.push(...triggerFindings(CI, readFileSync(join(root, CI), 'utf8')));
  found.push(...lastJobFindings(CI, readFileSync(join(root, CI), 'utf8')));
  found.push(...platformFindings(ASSETS, readFileSync(join(root, ASSETS), 'utf8')));
  found.push(...phpMinorFindings(ASSETS, readFileSync(join(root, ASSETS), 'utf8'), phpMinors(), readFileSync(join(root, 'Makefile'), 'utf8')));
  for (const file of [CI, ASSETS, RELEASE]) found.push(...jobStepFindings(file, readFileSync(join(root, file), 'utf8')));
  for (const file of [CI, RELEASE]) found.push(...callFindings(file, readFileSync(join(root, file), 'utf8')));
  found.push(...bindingJobFindings(CI, readFileSync(join(root, CI), 'utf8'), readFileSync(join(root, 'Makefile'), 'utf8')));
  found.push(...recipeTargetFindings(readFileSync(join(root, 'Makefile'), 'utf8'), targets));
  found.push(...carryFindings(readFileSync(join(root, 'Makefile'), 'utf8')));
  found.push(...llvmFindings(ASSETS, readFileSync(join(root, ASSETS), 'utf8'), llvmMajor(), readFileSync(join(root, 'Makefile'), 'utf8')));
  assert.deepEqual(found, []);
});
