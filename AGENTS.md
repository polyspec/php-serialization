<!-- doc-id: development -->
# Development procedure

[한국어](AGENTS.ko.md)

The working principles of every polyspec repository are in [PRINCIPLES.md](https://github.com/polyspec/kit/blob/main/PRINCIPLES.md) of kit. This document states the rules of this repository only.

<a id="reference"></a>
## Reference

- Own: PHP is the reference of the format. A difference from PHP is a defect of the package; a deliberate refusal is listed in [the specification](docs/spec/php-serialize.md#refused) and in the entries `stricter` and `refused_values` of the contract.
  Enforced by: `make contracts-check`, `make fuzz`
- Own: Records name PHP as the only source of the format and describe this repository only.
  Enforced by: none, the wording of records is a judgement.
- Own: The contract holds data that real PHP writes and no shape of a language, so a new runtime is a new package under `packages/`.
  Enforced by: none, a guided rule: kit does not check how implementations relate; each repository runs its own tests (K1129)

<a id="tools"></a>
## Tools

- Own: The recipes are this repository's own: the `Makefile` runs the utilities of the npm package `@polyspec/kit`, pinned to its release asset, with explicit arguments, and each tool reads its settings from its own file (`.npmrc`, `mise.toml`, `ruff.toml`, `.oxlintrc.json`, `knip.json`). kit includes no recipe and writes no file here.
  Enforced by: none, which utility a recipe runs is the choice of this repository.
- Own: Development runs the Red and Green unit tests that own a change; CI runs the full suite on every push to `main`.
  Enforced by: none, a local run is not observed by a tool.
