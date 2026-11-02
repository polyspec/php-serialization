<!-- doc-id: execution-checklist -->
# Execution checklist

## Wave 1 — First release

| ID | Task | Deliverables | Verification | State |
| --- | --- | --- | --- | --- |
| T1.1 | Port the serialize format of PHP to Node.js and Python and set up the repository with kit | `packages/js`, `packages/python`, `contracts/php-serialize.json`, `scripts/fuzz.mts`, the configuration of kit | `make contracts-check`, `make fuzz` and the CI run of the commit | [o] |
| T1.2 | Release 0.0.1 | The version commit and the release assets | `make release-coverage` and the release of the CI run of the version commit | [o] |
