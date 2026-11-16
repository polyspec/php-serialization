// The writer of the release values: each edit changes the one value it names, keeps the layout, and refuses what it
// cannot change exactly (T2.40).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { addChangelogSection, bindingAsset, setBindingTag, setTomlString, versionManifests } from './release-manifests.mts';

const cargo = `[package]
name = "polyspec-php-serialization"
version = "0.0.13" # the release
edition = "2024"

[dependencies]
version = "keep"
`;

test('a TOML string value changes in its table alone, with its comment', () => {
  assert.equal(setTomlString(cargo, 'package', 'version', '0.0.14'), cargo.replace('version = "0.0.13" # the release', 'version = "0.0.14" # the release'));
});

test('a TOML key that its table lacks, or holds twice, is refused', () => {
  assert.throws(() => setTomlString(cargo, 'project', 'version', '0.0.14'), /no table \[project\]/);
  assert.throws(() => setTomlString('[package]\nname = "x"\n', 'package', 'version', '1'), /0 string values of version/);
  assert.throws(() => setTomlString('[package]\nversion = "1"\nversion = "2"\n', 'package', 'version', '3'), /2 string values/);
});

test('the binding tag changes in every dependency line on the git source of binding, and nowhere else', () => {
  const text = [
    'polyspec-binding-core = { git = "https://github.com/polyspec/binding.git", tag = "v0.0.13" }',
    'polyspec-binding-core = { git = "https://github.com/polyspec/binding.git", tag = "v0.0.13", features = ["construct"] }',
    'fault-test = ["polyspec-binding-core/fault-test"]',
    'other = { git = "https://github.com/polyspec/other.git", tag = "v0.0.13" }',
  ].join('\n');
  const result = setBindingTag(text, 'v0.0.15');
  assert.equal(result.count, 2);
  assert.equal(result.text, text.replaceAll('binding.git", tag = "v0.0.13"', 'binding.git", tag = "v0.0.15"'));
});

test('the asset of a release of binding is named by its tag', () => {
  assert.equal(bindingAsset('v0.0.15'), 'https://github.com/polyspec/binding/releases/download/v0.0.15/polyspec-binding-0.0.15.tgz');
});

test('a changelog section takes the entries of Unreleased, and an empty Unreleased or a second section is refused', () => {
  const text = '# Changelog\n\n## Unreleased\n\n- a fix\n\n## 0.0.13\n\n- older\n';
  assert.equal(addChangelogSection(text, '0.0.14'), '# Changelog\n\n## Unreleased\n\n## 0.0.14\n\n- a fix\n\n## 0.0.13\n\n- older\n');
  assert.throws(() => addChangelogSection('## Unreleased\n\n## 0.0.13\n\n- older\n', '0.0.14'), /holds no entry/);
  assert.throws(() => addChangelogSection(text, '0.0.13'), /already holds the section 0\.0\.13/);
});

test('the manifests of a version are those that config/release.json gives the kind version or git-tag', () => {
  const files = versionManifests(process.cwd());
  assert.ok(files.includes('package.json') && files.includes('packages/rust/Cargo.toml') && files.includes('packages/python/pyproject.toml'), files.join(' '));
  assert.ok(!files.includes('packages/php-ext/composer.json'), 'composer.json, of the kind archive, carries no version');
});
