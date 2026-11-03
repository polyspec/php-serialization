<!-- doc-id: execution-checklist -->
# Execution checklist

## Wave 1 — First release

| ID | Task | Deliverables | Verification | State |
| --- | --- | --- | --- | --- |
| T1.1 | Port the serialize format of PHP to Node.js and Python and set up the repository with kit | `packages/js`, `packages/python`, `contracts/php-serialize.json`, `scripts/fuzz.mts`, the configuration of kit | `make contracts-check`, `make fuzz` and the CI run of the commit | [o] |
| T1.2 | Release 0.0.1 | The version commit and the release assets | `make release-coverage` and the release of the CI run of the version commit | [o] |
| T1.3 | P1: A killed fuzz run leaves no directory behind for good. Cause: scripts/fuzz.mts removes its directory of about 216 MB in finally, which a killed process does not run, so each killed run leaves one in the temporary directory. Acceptance: the name of the directory holds the process id of its run, and a run removes the directories of the runs whose process is gone. | scripts/fuzz.mts, scripts/fuzz-temp.mts, scripts/fuzz-temp.test.mts, Makefile, config/owner-checks.json, config/rebuild.json, CHANGELOG.md, CHANGELOG.ko.md | `make fuzz-temp-test` | [v] |
