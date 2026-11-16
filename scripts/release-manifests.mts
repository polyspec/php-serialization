#!/usr/bin/env node
// Writes the release values into the manifests of the checkout and verifies them by reading the manifests back as data
// (T2.40), so that a release and a pin of binding change the value that each manifest means and nothing else:
//
//   node scripts/release-manifests.mts version X.Y.Z    the version of every manifest that config/release.json names
//                                                        with the kind version or git-tag
//   node scripts/release-manifests.mts binding vX.Y.Z   the tag of every polyspec-binding-core dependency on the git
//                                                        source of binding, and the release asset of @polyspec/binding
//                                                        in package.json
//   node scripts/release-manifests.mts changelog X.Y.Z  the section X.Y.Z of both changelogs, which takes the entries
//                                                        of Unreleased
//
// A manifest is written by the tool of its ecosystem where the checkout pins one that writes the value (T2.44,
// docs/rebuild/release-manifests.md): npm pkg set for package.json and uv version for pyproject.toml, the npm and the uv
// that make names in NPM and UV. Cargo has no command that writes [package] version or the tag of a git dependency of
// all the manifests at once, so a Cargo.toml changes in the one line of the value, and its comments and layout stay.
// Every value is verified as data: cargo metadata (Cargo.toml), tomllib (pyproject.toml) and JSON.parse (package.json).
// The locks are not written here: make release-version and make binding-pin run cargo and npm for them.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const BINDING_GIT = 'https://github.com/polyspec/binding.git';
export const BINDING_CRATE = 'polyspec-binding-core';
export const BINDING_PACKAGE = '@polyspec/binding';
const VERSION = /^\d+\.\d+\.\d+$/;
const TAG = /^v\d+\.\d+\.\d+$/;

export const bindingAsset = (tag: string): string =>
  `https://github.com/polyspec/binding/releases/download/${tag}/polyspec-binding-${tag.slice(1)}.tgz`;

/** `text` with the string value of `key` in the table `[table]` set to `value`; the key is in the table exactly once. */
export function setTomlString(text: string, table: string, key: string, value: string): string {
  const lines = text.split('\n');
  const header = lines.findIndex(line => line.trim() === `[${table}]`);
  if (header < 0) throw new Error(`no table [${table}]`);
  let end = lines.findIndex((line, index) => index > header && /^\s*\[/.test(line));
  if (end < 0) end = lines.length;
  const pattern = new RegExp(`^(${key.replaceAll('-', '\\-')}\\s*=\\s*)"[^"]*"(\\s*(#.*)?)$`);
  const found = lines.map((line, index) => ({ line, index })).filter(({ line, index }) => index > header && index < end && pattern.test(line));
  const [only, ...more] = found;
  if (only === undefined || more.length > 0) throw new Error(`[${table}] holds ${found.length} string values of ${key}, not one`);
  lines[only.index] = only.line.replace(pattern, `$1"${value}"$2`);
  return lines.join('\n');
}

/** `text` with the tag of every dependency line on polyspec-binding-core of the git source of binding set to `tag`. */
export function setBindingTag(text: string, tag: string): { text: string; count: number } {
  const pattern = new RegExp(`^(${BINDING_CRATE}\\s*=\\s*\\{\\s*git\\s*=\\s*"${BINDING_GIT.replaceAll('.', '\\.')}"\\s*,\\s*tag\\s*=\\s*)"v[^"]*"`);
  let count = 0;
  const lines = text.split('\n').map((line) => {
    if (!pattern.test(line)) return line;
    count += 1;
    return line.replace(pattern, `$1"${tag}"`);
  });
  return { text: lines.join('\n'), count };
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const parseObject = (text: string, what: string): Json => {
  const data: unknown = JSON.parse(text);
  if (!isObject(data)) throw new Error(`${what} is no JSON object`);
  return data;
};
const field = (data: Json, key: string, what: string): unknown => {
  if (!(key in data)) throw new Error(`${what} has no field ${key}`);
  return data[key];
};
const asString = (value: unknown, what: string): string => {
  if (typeof value !== 'string') throw new Error(`${what} is no string`);
  return value;
};

/** The command of the checkout that make names in the variable `name` of the environment. */
function tool(name: string): string {
  const command = process.env[name];
  if (command === undefined || command === '') throw new Error(`${name} names no command; make names the ${name.toLowerCase()} of the checkout`);
  return command;
}

/** `text`, a changelog, with the section `## version` placed under `## Unreleased`, which then holds no entry. */
export function addChangelogSection(text: string, version: string): string {
  if (text.includes(`\n## ${version}\n`)) throw new Error(`the changelog already holds the section ${version}`);
  const unreleased = '## Unreleased\n\n';
  const start = text.indexOf(unreleased);
  if (start < 0) throw new Error('the changelog holds no section Unreleased');
  const body = text.slice(start + unreleased.length);
  if (!body.startsWith('- ')) throw new Error('the section Unreleased holds no entry, so there is nothing to release');
  return `${text.slice(0, start)}${unreleased}## ${version}\n\n${body}`;
}

/** The manifests that carry the version: those of config/release.json with the kind version or git-tag. */
export function versionManifests(root: string): string[] {
  const manifests = field(parseObject(readFileSync(join(root, 'config/release.json'), 'utf8'), 'config/release.json'), 'manifests', 'config/release.json');
  if (!isObject(manifests)) throw new Error('config/release.json: manifests is no object');
  return Object.entries(manifests).filter(([, kind]) => kind === 'version' || kind === 'git-tag').map(([file]) => file).sort();
}

interface CargoPackage { version: string; manifest: string; binding: (string | null)[] }
/** The packages of the workspace as cargo reads them: the version, the manifest and the source of each binding dependency. */
function cargoPackages(root: string): CargoPackage[] {
  const packages = field(parseObject(execFileSync('cargo', ['metadata', '--no-deps', '--offline', '--format-version', '1'], { cwd: root, encoding: 'utf8' }), 'cargo metadata'), 'packages', 'cargo metadata');
  if (!Array.isArray(packages)) throw new Error('cargo metadata: packages is no array');
  return packages.map((item: unknown) => {
    if (!isObject(item)) throw new Error('cargo metadata: a package is no object');
    const dependencies = field(item, 'dependencies', 'a package');
    if (!Array.isArray(dependencies)) throw new Error('cargo metadata: dependencies is no array');
    const binding = dependencies.filter((entry: unknown) => isObject(entry) && entry.name === BINDING_CRATE).map((entry: Json) => (entry.source === null ? null : asString(entry.source, 'a source')));
    return { version: asString(field(item, 'version', 'a package'), 'a version'), manifest: asString(field(item, 'manifest_path', 'a package'), 'a manifest path'), binding };
  });
}
/** A value of a TOML file as the Python of the checkout (PYTHON, which make names) reads it with tomllib. */
function tomlValue(root: string, file: string, table: string, key: string): unknown {
  const python = process.env.PYTHON;
  if (python === undefined || python === '') throw new Error('PYTHON names no Python, which reads pyproject.toml with tomllib; make names it');
  return JSON.parse(execFileSync(python, ['-I', '-c', 'import json,sys,tomllib;d=tomllib.load(open(sys.argv[1],"rb"))\nfor k in sys.argv[2].split("."): d=d[k]\nprint(json.dumps(d[sys.argv[3]]))', join(root, file), table, key], { encoding: 'utf8' }));
}

function setVersion(root: string, version: string): void {
  for (const file of versionManifests(root)) {
    const path = join(root, file);
    const text = readFileSync(path, 'utf8');
    if (file.endsWith('Cargo.toml')) writeFileSync(path, setTomlString(text, 'package', 'version', version));
    else if (file.endsWith('pyproject.toml')) execFileSync(tool('UV'), ['version', version, '--frozen'], { cwd: dirname(path), stdio: ['ignore', 'ignore', 'inherit'] });
    else if (file.endsWith('package.json')) execFileSync(tool('NPM'), ['pkg', 'set', `version=${version}`], { cwd: dirname(path), stdio: ['ignore', 'ignore', 'inherit'] });
    else throw new Error(`${file}: no reader for the version of this manifest`);
  }
  // The values as data: cargo, tomllib and JSON.parse read every manifest back.
  for (const file of versionManifests(root)) {
    const read = file.endsWith('Cargo.toml') ? cargoPackages(root).find(item => item.manifest === join(root, file))?.version
      : file.endsWith('pyproject.toml') ? tomlValue(root, file, 'project', 'version')
        : field(parseObject(readFileSync(join(root, file), 'utf8'), file), 'version', file);
    if (read !== version) throw new Error(`${file} declares the version ${String(read)}, not ${version}`);
  }
}

function setBinding(root: string, tag: string): void {
  const declared = cargoPackages(root).flatMap(item => item.binding.map(() => item.manifest));
  let written = 0;
  for (const manifest of new Set(declared)) {
    const result = setBindingTag(readFileSync(manifest, 'utf8'), tag);
    written += result.count;
    writeFileSync(manifest, result.text);
  }
  if (written !== declared.length) throw new Error(`${declared.length} dependencies on ${BINDING_CRATE}, but ${written} lines name the git source of binding with a tag`);
  const source = `git+${BINDING_GIT}?tag=${tag}`;
  for (const item of cargoPackages(root)) {
    for (const found of item.binding) {
      if (found !== source) throw new Error(`${item.manifest} depends on ${BINDING_CRATE} at ${String(found)}, not ${source}`);
    }
  }
  const devDependencies = (): Json => {
    const dev = field(parseObject(readFileSync(join(root, 'package.json'), 'utf8'), 'package.json'), 'devDependencies', 'package.json');
    if (!isObject(dev) || !(BINDING_PACKAGE in dev)) throw new Error(`package.json declares no devDependency ${BINDING_PACKAGE}`);
    return dev;
  };
  devDependencies();
  execFileSync(tool('NPM'), ['pkg', 'set', `devDependencies.${BINDING_PACKAGE}=${bindingAsset(tag)}`], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
  if (devDependencies()[BINDING_PACKAGE] !== bindingAsset(tag)) throw new Error(`package.json does not declare ${BINDING_PACKAGE} at ${bindingAsset(tag)}`);
}

function main(args: string[]): void {
  const [command, value] = args;
  const root = process.cwd();
  if (command === 'version' && value !== undefined && VERSION.test(value)) setVersion(root, value);
  else if (command === 'binding' && value !== undefined && TAG.test(value)) setBinding(root, value);
  else if (command === 'changelog' && value !== undefined && VERSION.test(value)) {
    for (const file of ['CHANGELOG.md', 'CHANGELOG.ko.md']) writeFileSync(join(root, file), addChangelogSection(readFileSync(join(root, file), 'utf8'), value));
  } else throw new Error('usage: release-manifests.mts version X.Y.Z | binding vX.Y.Z | changelog X.Y.Z');
}

if (import.meta.main) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); }
}
