#!/usr/bin/env node
// Prints the tag that the rehearsal of the Go module names (release-go-module-rehearsal): v followed by the version of the
// release, read from CHANGELOG.md, the record of the repository itself. The rule is the one that the tag of release-run
// follows: the first ## heading is X.Y.Z, or the first ## heading is Unreleased and the next ## heading is X.Y.Z. Any other
// shape fails with its reason, so that no other version is rehearsed (T2.54).
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const EXACT_VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;

export function rehearsalVersion(text) {
  const titles = [];
  for (const line of text.split('\n')) {
    const match = /^## (.*)$/.exec(line);
    if (match) titles.push(match[1]);
  }
  let first = titles[0];
  if (first === undefined) throw new Error('CHANGELOG.md has no ## heading');
  if (first === 'Unreleased') {
    first = titles[1];
    if (first === undefined) throw new Error('CHANGELOG.md has ## Unreleased and no ## heading after it');
  }
  if (!EXACT_VERSION.test(first)) throw new Error(`the first version heading of CHANGELOG.md is "## ${first}", which is not X.Y.Z`);
  return `v${first}`;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(`${rehearsalVersion(readFileSync('CHANGELOG.md', 'utf8'))}\n`);
  } catch (error) {
    console.error(`rehearsal-version: ${error.message}`);
    process.exit(1);
  }
}
