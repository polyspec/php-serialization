<!-- doc-id: rebuild-release-manifests -->
# Rebuild record: release manifests

[한국어](release-manifests.ko.md)

Verdict: **the tools of the checkout write the JSON and the Python manifests; none writes the Cargo values or the
changelog sections**, so `scripts/release-manifests.mts` writes those itself (T2.44). Measured on 2026-11-16 on a
`git archive` copy of the checkout, with the tools that the checkout pins and no new tool.

## Covers

- `scripts/release-manifests.mts`

## Requirement

`make release-version VERSION=X.Y.Z` and `make binding-pin BINDING_TAG=vX.Y.Z` (T2.40) write one value per manifest and
change nothing else in it:

| Item | Requirement |
|---|---|
| R1 | the version of `package.json` and `packages/ts/package.json` |
| R2 | the version of `packages/python/pyproject.toml` |
| R3 | `[package] version` of the six `Cargo.toml` that `config/release.json` names with the kind version or git-tag |
| R4 | the tag of the seven dependency lines on `polyspec-binding-core` of the git source of binding, in six `Cargo.toml` |
| R5 | the release asset of `@polyspec/binding` in the devDependencies of `package.json` |
| R6 | the section `## X.Y.Z` of `CHANGELOG.md` and `CHANGELOG.ko.md`, which takes the entries of `## Unreleased` |

## Tools evaluated

| Tool | State | Item | Result |
|---|---|---|---|
| `npm pkg set version=9.9.9` | npm 12.2.0 of `var/tools` | R1 | exit 0; the diff is the one line `"version"` of each file, the 2-space layout stays |
| `npm pkg set devDependencies.@polyspec/binding=<asset>` | npm 12.2.0 | R5 | exit 0; the diff is the one line of `@polyspec/binding` |
| `uv version 9.9.9 --frozen` in `packages/python` | uv 0.12.24 of `mise.toml` | R2 | `polyspec-php-serialization 0.0.13 => 9.9.9`; the diff is the one line `version`. With `--no-sync` it refused: `the argument '--no-sync' cannot be used with '--frozen'` |
| `cargo set-version` | cargo 1.99.0 of `rust-toolchain.toml` | R3 | `error: no such command: 'set-version'`; it is the command of cargo-edit, which the checkout does not pin |
| `cargo add polyspec-binding-core --git <binding> --tag v0.0.12 -p polyspec-php-serialization` | cargo 1.99.0, online | R4 | it rewrote the line to `{ git = "...", tag = "v0.0.12", version = "0.0.12" }`, adding a field, and then failed: `Dependency 'polyspec-binding-core' has different source paths depending on the build target. Each dependency must have a single canonical source path irrespective of build target.`; the same for `--dev` and for `-p polyspec-php-serialization-php-ext` |
| the same, `--offline` with a tag that is not cached | cargo 1.99.0 | R4 | `failed to find tag 'v0.0.15'`, so it cannot run before the tag is fetched |
| `scripts/kit/changelog.mts` of kit | kit 0.0.116 | R6 | reads the sections and judges their format; it writes none |
| kit | kit 0.0.116 | R1–R6 | no writer of release values: `release.mts` reads and checks the versions of `config/release.json` and writes only release assets and notes |

## Why the rest is written here

R1, R2 and R5 are written by `npm pkg set` and `uv version --frozen`, the npm and the uv that make names in `NPM` and `UV`.
Cargo pins no command that writes `[package] version` (R3). `cargo add` writes one manifest at a time and resolves the
workspace after each, so the first changed line names another source of `polyspec-binding-core` than the six that are
still at the old tag, and the resolve fails before the others change; it also adds a `version` field to the line (R4). No
tool writes a section of the changelog of polyspec, which is written by hand per item (R6). The script changes the one
line of each of R3 and R4 and moves the entries of R6, and reads every value back as data: cargo metadata, tomllib and
JSON.parse.

## Retry condition

Revisit when the checkout pins a cargo command that writes `[package] version` (cargo-edit, or a `cargo set-version` of
cargo itself), or one that writes the tag of a git dependency in every manifest of the workspace at once.
