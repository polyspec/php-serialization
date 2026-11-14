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

<a id="layout"></a>
## Layout

- Own: S6 exception of the transition: `legacy/packages/js` and `legacy/packages/python` hold the Node.js and Python packages that the generated bindings replace. They are no release target and stay until each is removed by a change of its own, once the binding of its language passes the contract, the package tests and the fuzz ([transition](docs/spec/php-serialize.md#transition), plan V-6 (5)).
  Enforced by: `make layout-check`, `make release-coverage`
- Own: The binding packages of the five targets that every contract names (binding BD-27), `packages/python`, `packages/ts`, `packages/ts/wasm`, `packages/php-ext` and `packages/go` with its C ABI crate `packages/go/internal/ffi`, are what `binding scaffold` writes from `packages/rust/interface.json`, and their `generated/` is not tracked. The root Cargo workspace holds them with the core crate, and the Rust recipes of the core name its package.
  Enforced by: `make bindings-check`

<a id="bindings"></a>
## Bindings

- Own: `make bindings` generates the five targets, each in its own target `make bindings-<target>` (`binding generate --target <target>`), and every make target that builds or tests a binding runs the generation of the targets it uses first, so that a target that binding refuses fails with its name and does not stop the others (binding GN-1c). The binding crates build with the features `panic-test` and `fault-test`, because a fault injection point of the core is live only with the feature `fault-test` of the core (binding GN-5); the tests of the core depend on the core itself with it (`[dev-dependencies]` of `packages/rust/Cargo.toml`). `make test-bindings` runs clippy on the whole workspace, `make check-declarations`, then `make test-python-binding`, `make test-node`, `make test-wasm`, `make test-php` and `make test-go`, one for each of the five targets of the contract, each of which runs the tests that binding generates and the contract cases of the binding on the standard runner of its language: unittest, node --test (Node and WASM, the WASM binding through the subpath `./wasm` of the same installed package), PHPUnit and go test. The contract cases are `packages/python/tests`, `packages/ts/tests/cases.test.mjs` and `packages/ts/tests/cases.wasm.test.mjs`, which share `packages/ts/tests/cases.mjs`, and `packages/php-ext/tests`; each compares the result of every case that does not raise with its `value` and its bytes, and the class, kind and status of every case that raises. Beside them, `packages/python/tests/test_api.py` and `packages/ts/tests/api.mjs` (run by `api.test.mjs` and `api.wasm.test.mjs`) hold the tests of the legacy packages that the contract cases do not hold, with the bytes of the legacy tests (T2.3). Go has no contract cases yet, because binding has no Go form of `php_value` and refuses the class units for Go (binding GN-1, T-5), so a runner would name types that do not exist. A target that the generator cannot take stays a failing target with its cause; no target is left out or skipped (binding BD-27). `make test-python` runs the tests of the legacy Python package until it is removed.
  Enforced by: none, `make test-bindings` is no target of CI until a run shows that the generated code of the pinned binding passes clippy with `clippy.toml` and the tests of the five targets (row T2.9); `make ci-bindings` runs its targets past failures into the CI report, and its job enters `.github/workflows/ci.yml` with that row.
- Own: Only `make php-serialization-install-rust` downloads binding: it fetches the crates of `Cargo.lock` and runs `scripts/binding.mts install`, which clones binding at the commit of `Cargo.lock` into `var/binding/<commit>` and installs the packages of its tool with the npm of `var/tools`. Every other command of `scripts/binding.mts` reads the crates with `cargo metadata --offline` and fails while binding is not installed, and the binding recipes install their packages with `npm install --offline` and `uv pip install --offline`, because no check depends on the network.
  Enforced by: `make binding-features-test`
- Own: In the Go module binding owns the files `zz_generated_*.go` (binding GN-3), which `make bindings` writes. They are not tracked, and neither is a static library of `packages/go/internal/ffi/lib/<platform>`: a release adds both in the commit of its Go tag, because Go fetches a module as the source of a tag (binding GN-15g, CK-19), and a tracked copy would differ from what the pinned binding writes after every change of the pin. `packages/ts/wasm/generated` and `packages/go/internal/ffi/generated` are not tracked; wasm-bindgen writes the module and its glue into the first.
  Enforced by: `make layout-check`
- Own: The variables `GO`, `GOFMT`, `WASM_BINDGEN`, `MATURIN`, `PHP`, `PHP_CONFIG` and `PHPUNIT` name the tools of the binding tests; by default they are the tools of the checkout that `mise.toml` and `.php-version` pin. `make test-go` fails a Go of another release than the go directive of `packages/go/go.mod` and runs it with `GOTOOLCHAIN=local`, so that it fetches no toolchain, and `make node-package`, which `make test-node` and `make test-wasm` share, fails a wasm-bindgen CLI of another release than the `wasm-bindgen` crate of `packages/ts/wasm/Cargo.toml`, because the CLI reads only a module of its own release (binding GN-18).
  Enforced by: none, the recipes of `make test-go` and `make node-package` compare the releases when they run.

<a id="tools"></a>
## Tools

- Own: The recipes are this repository's own: the `Makefile` runs the utilities of the npm package `@polyspec/kit`, pinned to its release asset, with explicit arguments, and each tool reads its settings from its own file (`.npmrc`, `mise.toml`, `ruff.toml`, `.oxlintrc.json`, `knip.json`). kit includes no recipe and writes no file here.
  Enforced by: none, which utility a recipe runs is the choice of this repository.
- Own: Development runs the Red and Green unit tests that own a change; CI runs the full suite on every push to `main`.
  Enforced by: none, a local run is not observed by a tool.
- Own: No tracked file names a Git commit, of this repository or of another. A release and a lock pin the name of a commit, and a name written in a document is a wrong value once the history changes; a record states the fact instead: the input, the behavior, the expected behavior and the count of the tests.
  Enforced by: `make commit-names-check`, which reads the tracked Markdown files; a commit named in another tracked file is found by review.

<a id="ci"></a>
## CI and release

- Own: Every job of a GitHub workflow runs on `ubuntu-26.04-arm`. Every action is a local action of `.github/actions` or is pinned by its full commit, and a comment of the file names its release; an action pin is the one Git commit that a tracked file names. No job and no step sets `timeout-minutes`. Every `run` step is one make target that the `Makefile` defines, so that the settings of the Makefile apply to every command of CI. The workflow `ci` starts on a push of `main` and on `workflow_dispatch` alone, and its last job `ci-passed` runs after every other job, needs each of them and passes only when each succeeded (`make ci-passed FAIL_SKIPPED=1`), so that one job states the result of the run.
  Enforced by: `make workflows-test`
- Own: kit builds no per-platform asset, so the recipes of this repository build the assets of the bindings, each for the platform of its host (`linux-x64-gnu`, `linux-arm64-gnu`, `darwin-arm64`; binding GN-19a), because no tool of the release compiles for another platform: `make release-go-static` the stripped static library of the Go module, `make release-wheel` the abi3 wheel `make release-php-ext PHP=<php>` the PHP extension under the name by which PIE finds it, and `make release-npm-platform` the npm platform package with the napi CLI of the devDependency `@napi-rs/cli`, while `make release-npm` packs `@polyspec/php-serialization` with its WASM binding and names the platform packages in `optionalDependencies` of a copy of its manifest, never of the tracked one (binding GN-19b to GN-19e, GN-3c). `make release-go-module TAG=vX.Y.Z` runs `binding release-go-module` with the libraries of every platform, which makes and proves the commit of the Go module and its tag `packages/go/vX.Y.Z`, and pushes the reference that the command prints (binding GN-19f). Each runs one standard tool per line with `CARGO_TARGET_DIR` set to `RELEASE_TARGET` and renames a finished file into `RELEASE_ASSETS`, so that an asset holds nothing of a development build and the assets never hold a file that is half written; the Go library is stripped with the `llvm-strip` of the component `llvm-tools` of `rust-toolchain.toml`, because the `strip` of `PATH` differs by machine.
  Enforced by: `make release-test`
