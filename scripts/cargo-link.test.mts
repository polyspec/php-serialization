// Every recipe of the Makefile runs cargo through the cargo of kit's link (T2.41), $(CARGO) = `link.mjs cargo <dir> <args>`,
// which patches the git sources of the checkouts that .links names and runs cargo as given when it names none (kit
// docs/operations/local-links.md). A recipe that runs cargo, or maturin, which runs cargo itself, builds the tag of the lock
// while the links name another checkout.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/** A recipe line that runs cargo or maturin as a command, not as the subcommand of kit's `link.mjs`. */
export const UNLINKED = /^\t(?:.*[\s;&|(])?(?<!link\.mjs )(?:cargo|maturin|\$\(MATURIN\)) /;

test('a recipe that runs cargo or maturin is found, and $(CARGO) is not', () => {
  for (const line of ['\tcargo build', '\t$(ONLINE) cargo fetch --locked', '\tcd x && $(MATURIN) build', '\tA=1 cargo test']) assert.match(line, UNLINKED);
  for (const line of ['\t$(CARGO) build', '\t$(ONLINE) $(CARGO) fetch --locked', 'CARGO := $(NODE) $(KIT)/link.mjs cargo $(CURDIR)', '# cargo build', '\tMATURIN=$(MATURIN) $(NODE) $(KIT)/link.mjs maturin $(CURDIR)/x build']) assert.doesNotMatch(line, UNLINKED);
});

test('no recipe of the Makefile runs cargo or maturin without $(CARGO)', () => {
  const makefile = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'Makefile'), 'utf8');
  const findings = makefile.split('\n').flatMap((line, index) => (UNLINKED.test(line) ? [`Makefile:${String(index + 1)}: ${line.trim()}`] : []));
  assert.deepEqual(findings, [], `recipes that run cargo without $(CARGO):\n${findings.join('\n')}`);
});
