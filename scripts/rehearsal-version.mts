#!/usr/bin/env node
// Prints the tag that the rehearsal of the Go module names (release-go-module-rehearsal): v followed by the version of the
// release, read from CHANGELOG.md, the record of the repository itself. The rule is the one that the tag of release-run
// follows: the first ## heading is X.Y.Z, or the first ## heading is Unreleased and the next ## heading is X.Y.Z. Any other
// shape fails with its reason, so that no other version is rehearsed (T2.54).
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const EXACT_VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;

export function rehearsalVersion(text: string): string {
  const titles: string[] = [];
  for (const line of text.split('\n')) {
    const title = /^## (.*)$/.exec(line)?.[1];
    if (title !== undefined) titles.push(title);
  }
  const unreleased = titles[0] === 'Unreleased';
  const heading: string | undefined = unreleased ? titles[1] : titles[0];
  if (heading === undefined) {
    throw new Error(unreleased ? 'CHANGELOG.md has ## Unreleased and no ## heading after it' : 'CHANGELOG.md has no ## heading');
  }
  if (!EXACT_VERSION.test(heading)) throw new Error(`the first version heading of CHANGELOG.md is "## ${heading}", which is not X.Y.Z`);
  return `v${heading}`;
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  try {
    process.stdout.write(`${rehearsalVersion(readFileSync('CHANGELOG.md', 'utf8'))}\n`);
  } catch (error) {
    console.error(`rehearsal-version: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
