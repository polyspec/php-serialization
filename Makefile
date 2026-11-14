# The recipes of php-serialization. Each target runs a utility of the installed @polyspec/kit (node_modules/@polyspec/kit/dist,
# the built package, also when the folder is a link to a kit checkout) with the arguments that this repository gives it; kit
# includes no recipe here and sets no setting of a tool (kit docs/spec/utilities-and-recipes.md). The tools read their settings
# from their own files: npm from .npmrc, mise and uv from mise.toml, ruff from ruff.toml, vulture from the [tool.vulture] of
# legacy/packages/python/pyproject.toml, oxlint from .oxlintrc.json and knip from knip.json.
KIT := node_modules/@polyspec/kit/dist

# The tools of every run are the releases that the tracked declaration files name: npm in devEngines.packageManager of
# package.json, PHP in .php-version, and Node.js, Python and the other tools in mise.toml at the digests of mise.lock. They live
# in the checkout's own var/tools; the shims of mise find its installs and mise.toml through the MISE_* folders below. A recipe
# starts a tool by its absolute path: GNU make execs a recipe line without shell metacharacters directly, so a bare name would
# resolve through the PATH that make read at start.
VAR_TOOLS := $(CURDIR)/var/tools
NODE := $(VAR_TOOLS)/bin/node
NPM := $(VAR_TOOLS)/bin/npm
MISE := $(VAR_TOOLS)/bin/mise
UV := $(VAR_TOOLS)/mise/shims/uv
ALINT := $(VAR_TOOLS)/mise/shims/alint
export MISE_DATA_DIR := $(VAR_TOOLS)/mise
export MISE_CACHE_DIR := $(VAR_TOOLS)/mise/cache
export MISE_STATE_DIR := $(VAR_TOOLS)/mise/state
export MISE_CONFIG_DIR := $(VAR_TOOLS)/mise/config
export MISE_GLOBAL_CONFIG_FILE := $(CURDIR)/mise.toml
export MISE_GLOBAL_CONFIG_ROOT := $(CURDIR)
MISE_ENVIRONMENT := MISE_DATA_DIR MISE_CACHE_DIR MISE_STATE_DIR MISE_CONFIG_DIR MISE_GLOBAL_CONFIG_FILE MISE_GLOBAL_CONFIG_ROOT
# kit 0.0.98's run-tests dropped NODE_TEST_CONTEXT, so a node --test that a recipe starts from inside a node test runs as
# its own run, not as a child of that test (kit K1094); no recipe passes it on.
unexport NODE_TEST_CONTEXT
export PATH := $(VAR_TOOLS)/bin:$(VAR_TOOLS)/mise/shims:$(PATH)

# A check reads no network: make install downloads what the checks read, and every other recipe runs npm offline.
export npm_config_offline := true
ONLINE := env -u npm_config_offline

# The targets of each CI job (.github/workflows/ci.yml), which ci-targets of kit runs past failures into CI_REPORT; make check
# runs all of them once.
CI_SHARED := workflows-test layout-check docs-check rules-check owner-validate rebuild-check language-check duplication-check suppression-check commit-names-check commit-names-test link-check release-coverage release-test typecheck contracts-check binding-features-test
CI_FUZZ := fuzz
CI_TS := lint-ts test-js
CI_PYTHON := lint-python test-python
CI_RUST := lint-rust test-rust bindings-check
# The targets of the binding tests, which no job of ci.yml runs yet (row T2.9): no run has shown that the generated code
# of the pinned binding passes clippy with clippy.toml and the tests of the five targets, so a job of them could fail ci-passed
# for a defect of binding. Their job installs every tool of mise.toml (make install-tools), PHPUnit and the crates and
# binding of make php-serialization-install-rust, and runs make ci-bindings.
CI_BINDINGS := lint-bindings check-declarations test-python-binding test-node test-wasm test-php test-go
CI_REPORT ?= var/report/ci-targets

.PHONY: bootstrap install install-tools install-packages toolchain-lock php-serialization-install-python link unlink link-check \
	php-serialization-install-rust build build-js build-python build-rust test test-js test-python test-rust lint lint-ts lint-python lint-rust typecheck bindings $(BINDING_PHONY) bindings-check \
	test-bindings lint-bindings check-declarations test-python-binding node-package test-node test-wasm test-php test-go \
	contracts contracts-check fuzz fuzz-temp-test binding-features-test commit-names-check commit-names-test workflows-test ci-passed release-checkout release-zip \
	layout-check docs-check rules-check owner-check owner-validate rebuild-check language-check \
	duplication-check suppression-check \
	check ci-shared ci-fuzz ci-ts ci-python ci-rust ci-bindings \
	plan-new plan-split item-new item-edit item-state item-test commit documents-stamp text-absent hooks twin-merge \
	worktree-setup land \
	release-tag release-tools release-tools-path release-assets release-publish release-undraft release-coverage release-test release-go-static release-wheel release-php-ext release-npm-platform release-npm release-go-module release-candidate-assets

# ---- Install ----------------------------------------------------------------------------------------------------------------
# The npm that devEngines of package.json names installs the lock, @polyspec/kit included, before the tools of the checkout
# exist, since install-tools TOOLS=npm runs the bootstrap of the installed kit. It runs outside the checkout with --prefix,
# since an npm of another release refuses a folder whose devEngines names npm 12.2.0 (EBADDEVENGINES); npm reads
# allow-remote of the .npmrc of the checkout. A fresh checkout runs make bootstrap, then make install.
BOOTSTRAP_NPM := $(abspath $(shell command -v npm))
bootstrap: ## Install package-lock.json with the npm of devEngines before the tools of the checkout exist; ONLINE
	root="$$PWD"; version="$$(node -p 'require("./package.json").devEngines.packageManager.version')"; \
	cd "$${TMPDIR:-/tmp}" && $(ONLINE) npm_config_cache="$$root/var/bootstrap/npm-cache" "$(BOOTSTRAP_NPM)" exec --yes --package="npm@$$version" -- npm --prefix "$$root" ci --ignore-scripts

# install: the mise, node and npm of mise.toml (the bootstrap, which runs on the Node.js of the machine and imports only its
# built-ins), the packages of package-lock.json, the other tools of mise.toml, then the Python package and the links.
install: ## Install the tools, the packages, the Python package and the links of the checkout; ONLINE
	$(MAKE) --no-print-directory install-tools TOOLS=npm
	$(MAKE) --no-print-directory install-packages
	$(MAKE) --no-print-directory install-tools
	$(MAKE) --no-print-directory php-serialization-install-python
	$(MAKE) --no-print-directory php-serialization-install-rust

# The home and the cache of the Composer that install-tools and install-symbols run, the folders of var/tools that kit 0.0.98
# set (kit K1095).
COMPOSER_TOOL_ENV = COMPOSER_HOME=$(CURDIR)/var/tools/composer/home COMPOSER_CACHE_DIR=$(CURDIR)/var/tools/composer/cache
install-tools: ## Install all locked tools of mise.toml, or the selectors of TOOLS; TOOLS=npm runs the bootstrap; ONLINE
ifeq ($(TOOLS),npm)
	$(ONLINE) node $(KIT)/bootstrap/bootstrap.mjs
else
	$(COMPOSER_TOOL_ENV) $(ONLINE) $(NODE) $(KIT)/install-tools.mjs --no-self-update $(TOOLS)
endif

install-packages: ## Install the packages of package-lock.json with the npm of var/tools, which reads .npmrc; ONLINE
	$(ONLINE) $(NPM) ci

# mise locks a pypi: tool with uv and the Python of PATH, so it first locks and installs uv and python, then locks every tool
# with that Python as UV_PYTHON, for each platform that has their archive.
TOOLCHAIN_LOCK_PLATFORMS := linux-x64,linux-arm64,macos-arm64,macos-x64,windows-x64,windows-arm64
toolchain-lock: ## Write mise.lock with mise lock for the platforms of TOOLCHAIN_LOCK_PLATFORMS; ONLINE
	$(ONLINE) $(MISE) lock uv python --global --platform $(TOOLCHAIN_LOCK_PLATFORMS)
	$(ONLINE) $(MISE) install --locked uv python
	python="$$($(MISE) which python3)" && UV_PYTHON="$$python" $(ONLINE) $(MISE) lock --global --platform $(TOOLCHAIN_LOCK_PLATFORMS)

# php-serialization-install-python makes legacy/packages/python/.venv from the Python of mise.toml and installs the package into it,
# non-editable, since the python extractor of kit reads the file list of the installed distribution; link then makes the
# installed package folder a link to the sources of the checkout when .links names one.
php-serialization-install-python: ## Make legacy/packages/python/.venv and install the package into it, then link; ONLINE
	$(NODE) $(KIT)/python-venv.mjs legacy/packages/python/.venv
	$(ONLINE) $(UV) pip install --python legacy/packages/python/.venv/bin/python --link-mode copy --no-deps legacy/packages/python
	$(MAKE) --no-print-directory link

# php-serialization-install-rust installs the toolchain of rust-toolchain.toml with rustup, fetches the crates of the root
# Cargo.lock and installs binding at the commit of Cargo.lock into var/binding (scripts/binding.mts), so that every Rust
# recipe and every binding recipe runs with --locked and offline.
php-serialization-install-rust: ## Install the Rust toolchain of rust-toolchain.toml, fetch the locked crates and install binding at the commit of Cargo.lock; ONLINE
	$(ONLINE) rustup toolchain install --no-self-update
	$(ONLINE) cargo fetch --locked
	$(ONLINE) $(NODE) scripts/binding.mts install

# The local links of 0.0.x development: the git-ignored .links of the main checkout names the checkouts that provide packages.
link: ## Link the packages to the checkouts of .links; offline
	$(NODE) $(KIT)/link.mjs link

unlink: ## Remove the links; make install restores the locked installs; offline
	$(NODE) $(KIT)/link.mjs unlink

link-check: ## Fail while the links differ from .links; offline
	$(NODE) $(KIT)/link-check.mjs

# ---- Build, test, lint ------------------------------------------------------------------------------------------------------
build: build-js build-python build-rust
test: test-js test-python test-rust
lint: lint-ts lint-python lint-rust

# The build of the package of a runtime with the build of its ecosystem; the JavaScript package has none (kit K1106).
build-js: ## The JavaScript package has no build step; offline
build-python: ## Build the Python package with uv build; offline
	$(NODE) $(KIT)/runtime-targets.mjs build --roots legacy/packages/python -- $(UV) build

# The Rust recipes of the core name its package (-p): the binding crates of the workspace include the sources that make
# bindings generates, so they build only after it (binding design L-2).
CORE := polyspec-php-serialization

build-rust: ## Build the Rust crate with cargo; offline
	cargo build -p $(CORE) --locked --offline

# The unit tests of a runtime with CASES=<pattern>; without CASES, every unit test, which the runner of kit runs only in CI. The
# runner arguments are those that kit 0.0.98 passed (kit K1094, K1106): one test at a time and the 30 s test timeout of node.
test-js: ## Run the unit tests of the JavaScript package with the name filter CASES=<pattern>; offline
	$(NODE) $(KIT)/runtime-targets.mjs test --runner node --roots legacy/packages/js -- --test-timeout=30000 --test-concurrency=1
test-python: ## Run the unit tests of the Python package with the name filter CASES=<pattern>; offline
	PYTHONUNBUFFERED=1 NO_COLOR=1 PYTHON_COLORS=0 $(NODE) $(KIT)/runtime-targets.mjs test --runner python --roots legacy/packages/python --venv .venv

test-rust: ## Run the contract and the unit tests of the Rust crate with cargo test, with the name filter CASES=<pattern>; offline
	cargo test -p $(CORE) --locked --offline $(CASES)

lint-ts: ## Lint the TypeScript and JavaScript with oxlint (.oxlintrc.json) and knip (knip.json); offline
	$(NODE) $(KIT)/lint-ts.mjs

lint-python: ## Lint the Python with ruff (ruff.toml) and vulture ([tool.vulture] of the package); offline
	$(NODE) $(KIT)/lint-python.mjs

# R-1: clippy with the [workspace.lints] of Cargo.toml and the disallowed methods of clippy.toml, every warning an error, and
# rustfmt.
lint-rust: ## Lint the Rust crate with cargo clippy ([workspace.lints] of Cargo.toml and clippy.toml) and rustfmt; offline
	cargo clippy -p $(CORE) --locked --offline --all-targets -- -D warnings
	cargo fmt -p $(CORE) --check

# ---- Bindings -----------------------------------------------------------------------------------------------------------------
# binding runs at the commit of polyspec-binding-core that Cargo.lock pins (scripts/binding.mts).
BINDING := $(NODE) scripts/binding.mts

# bindings generates the five targets, each in its own target bindings-<target>, so that a target that binding does not
# generate yet fails with its name (binding GN-1c) and the targets that build on another target still run.
BINDING_TARGETS := php python node wasm go
BINDING_PHONY = $(foreach target,$(BINDING_TARGETS),bindings-$(target))
bindings: $(BINDING_PHONY) ## Write the generated sources of the five targets with binding: the generated folders and the Go files zz_generated_*.go, none of them tracked (binding GN-3, GN-15g); offline
$(BINDING_PHONY):
	$(BINDING) generate --root . --target $(@:bindings-%=%)

bindings-check: ## Check the interface contract and that the binding packages are what binding scaffold writes; offline
	$(BINDING) check packages/rust/interface.json

# The tools of the binding tests: the Go of the go directive of packages/go/go.mod, the wasm-bindgen CLI of the release
# of the wasm-bindgen crate of packages/ts/wasm/Cargo.toml (binding GN-15, GN-18) and maturin, from mise.toml; PHP of
# .php-version, whose headers the extension is built against (PHP_CONFIG) and which loads it, and PHPUnit. test-go and
# node-package compare the releases of Go and wasm-bindgen before they use them.
GO ?= $(VAR_TOOLS)/mise/shims/go
GOFMT ?= $(VAR_TOOLS)/mise/shims/gofmt
WASM_BINDGEN ?= $(VAR_TOOLS)/mise/shims/wasm-bindgen
MATURIN ?= $(VAR_TOOLS)/mise/shims/maturin
PHP ?= $(VAR_TOOLS)/bin/php
PHP_CONFIG ?= $(VAR_TOOLS)/bin/php-config
PHPUNIT ?= $(VAR_TOOLS)/bin/phpunit
# The file name extension of a library that Cargo builds as a cdylib: dylib on macOS, so on Linux.
CDYLIB := $(if $(filter Darwin,$(shell uname -s)),dylib,so)
CARGO_TARGET := $(CURDIR)/target
BINDINGS_VAR := $(CURDIR)/var/bindings
# The case runners read contracts/php-serialize.json and contracts/host-values.json from this folder.
CONTRACTS_ENV := PHP_SERIALIZATION_CONTRACTS=$(CURDIR)/contracts

# The test features of a binding crate are the features of its manifest, which binding scaffold writes (binding GN-5):
# panic-test; fault-test, which turns on the fault injection points of the core, since a point is live only in a crate
# whose own feature fault-test is on (the generated tests and the case a_broken_invariant_is_internal arm the point
# php_serialization.internal); codec-test, the in function of php_value alone (U-7); and case-test, the values of the
# cases that PHP has no form of (GN-13). A list of the names that its manifest gives is the features of a crate, and
# their union is the features of the lint of the workspace.
features_of = $(subst $(space),$(comma),$(strip $(shell sed -n '/^\[features\]$$/,/^\[/s/^\([a-z][a-z0-9-]*\) = .*/\1/p' $(1))))
comma := ,
space := $(subst ,, )
PYTHON_FEATURES = $(call features_of,packages/python/Cargo.toml)
NODE_FEATURES = $(call features_of,packages/ts/Cargo.toml)
WASM_FEATURES = $(call features_of,packages/ts/wasm/Cargo.toml)
PHP_FEATURES = $(call features_of,packages/php-ext/Cargo.toml)
GO_FEATURES = $(call features_of,packages/go/internal/ffi/Cargo.toml)
TEST_FEATURES = $(subst $(space),$(comma),$(sort $(subst $(comma),$(space),$(PYTHON_FEATURES),$(NODE_FEATURES),$(WASM_FEATURES),$(PHP_FEATURES),$(GO_FEATURES))))

# test-bindings runs every binding test of the five targets; none of them is a target of make check, since each needs
# the generated sources of the binding of Cargo.lock.
test-bindings: lint-bindings check-declarations test-python-binding test-node test-wasm test-php test-go ## Run the lint and the tests of the bindings of the five targets; offline

# binding-features-test reads the dry run of the recipes of the bindings: each crate is built with every feature of its
# manifest, and the workspace linted with their union.
binding-features-test: ## Run the test of the features of the binding recipes; offline
	$(NODE) $(KIT)/run-tests.mjs node -- --test-concurrency=1 scripts/binding-features.test.mts

lint-bindings: bindings ## Run clippy on the binding crates with every warning an error, after make bindings; offline
	cargo clippy --workspace --locked --offline --all-targets --features $(TEST_FEATURES) -- -D warnings

check-declarations: bindings-node bindings-wasm ## Check the generated declarations of the Node and WASM bindings with tsc; offline
	$(NODE) node_modules/typescript/bin/tsc --noEmit --strict packages/ts/generated/index.d.ts
	$(NODE) node_modules/typescript/bin/tsc --noEmit --strict packages/ts/wasm/generated/index.d.ts

# The wheel, installed into a virtual environment of the Python of mise.toml; the generated tests (binding G-5) and the
# contract cases of packages/python/tests. test-python runs the tests of the legacy package until it is removed.
test-python-binding: bindings-python ## Build the wheel, install it into var/bindings/venv and run the generated tests and the contract cases; offline
	rm -rf $(BINDINGS_VAR)/wheels
	cd packages/python && $(MATURIN) build --locked --offline --features $(PYTHON_FEATURES) --out $(BINDINGS_VAR)/wheels
	$(NODE) $(KIT)/python-venv.mjs var/bindings/venv
	$(UV) pip install --offline --python $(BINDINGS_VAR)/venv/bin/python --no-deps --reinstall $(BINDINGS_VAR)/wheels/*.whl
	cd $(BINDINGS_VAR) && venv/bin/python -m unittest discover -s $(CURDIR)/packages/python/generated/tests -t $(CURDIR)/packages/python/generated/tests
	cd $(BINDINGS_VAR) && $(CONTRACTS_ENV) venv/bin/python -m unittest discover -s $(CURDIR)/packages/python/tests -t $(CURDIR)/packages/python/tests

# The package and the platform package of the addon, packed and installed into var/bindings/node. The addon is the npm
# package of this machine's platform, which the package names in optionalDependencies (binding T-2); the recipe packs
# it as a release does and installs both tarballs, without the other platforms' packages. The package also holds the
# WASM module and its glue, which wasm-bindgen writes into packages/ts/wasm/generated before the package is packed
# (binding GN-18, P-5).
NODE_PLATFORM := $(shell uname -s | tr A-Z a-z)-$(subst x86_64,x64,$(subst aarch64,arm64,$(shell uname -m)))$(if $(filter Linux,$(shell uname -s)),-gnu)
NODE_ADDON := php-serialization.$(NODE_PLATFORM).node
NODE_VERSION := $(shell sed -n 's/^  "version": "\(.*\)",$$/\1/p' packages/ts/package.json)
WASM_BINDGEN_RELEASE := $(shell sed -n 's/^wasm-bindgen = "=\(.*\)"$$/\1/p' packages/ts/wasm/Cargo.toml)
node-package: bindings-node bindings-wasm ## Build the WASM module and the Node addon, then pack and install the npm package into var/bindings/node; offline
	test "$$($(WASM_BINDGEN) --version)" = "wasm-bindgen $(WASM_BINDGEN_RELEASE)"
	cargo build --locked --offline -p $(CORE)-wasm --target wasm32-unknown-unknown --features $(WASM_FEATURES)
	$(WASM_BINDGEN) --target web --out-dir packages/ts/wasm/generated --out-name php_serialization_wasm \
		$(CARGO_TARGET)/wasm32-unknown-unknown/debug/polyspec_php_serialization_wasm.wasm
	cargo build --locked --offline -p $(CORE)-node --features $(NODE_FEATURES)
	rm -rf $(BINDINGS_VAR)/node $(BINDINGS_VAR)/node-platform && mkdir -p $(BINDINGS_VAR)/node $(BINDINGS_VAR)/node-platform
	cp $(CARGO_TARGET)/debug/libpolyspec_php_serialization_node.$(CDYLIB) $(BINDINGS_VAR)/node-platform/$(NODE_ADDON)
	$(NODE) -e 'require("fs").writeFileSync("$(BINDINGS_VAR)/node-platform/package.json", JSON.stringify({ name: "@polyspec/php-serialization-$(NODE_PLATFORM)", version: "$(NODE_VERSION)", os: [process.platform], cpu: [process.arch], main: "$(NODE_ADDON)", files: ["$(NODE_ADDON)"] }, null, 2) + "\n")'
	cd $(BINDINGS_VAR)/node-platform && $(NPM) pack --pack-destination $(BINDINGS_VAR)/node
	cd packages/ts && $(NPM) pack --pack-destination $(BINDINGS_VAR)/node
	echo '{ "private": true }' > $(BINDINGS_VAR)/node/package.json
	cd $(BINDINGS_VAR)/node && $(NPM) install --offline --no-audit --no-fund --omit=optional ./polyspec-php-serialization-$(NODE_VERSION).tgz ./polyspec-php-serialization-$(NODE_PLATFORM)-$(NODE_VERSION).tgz

# The generated tests and the contract cases of the Node binding on node --test, against the installed package.
test-node: node-package ## Run the generated tests and the contract cases of the Node binding on node --test; offline
	cp packages/ts/generated/tests/generated.test.mjs packages/ts/tests/cases.mjs packages/ts/tests/cases.test.mjs packages/ts/tests/api.mjs packages/ts/tests/api.test.mjs $(BINDINGS_VAR)/node/
	cd $(BINDINGS_VAR)/node && $(CONTRACTS_ENV) $(NODE) --test generated.test.mjs cases.test.mjs api.test.mjs

# The generated tests and the contract cases of the WASM binding through the subpath ./wasm of the installed package
# (binding P-5); --expose-gc serves the generated tests that collect instances (binding GN-18a).
test-wasm: node-package ## Run the generated tests and the contract cases of the WASM binding on node --test; offline
	cp packages/ts/wasm/generated/tests/generated.test.mjs $(BINDINGS_VAR)/node/generated.wasm.test.mjs
	cp packages/ts/tests/cases.mjs packages/ts/tests/cases.wasm.test.mjs packages/ts/tests/api.mjs packages/ts/tests/api.wasm.test.mjs $(BINDINGS_VAR)/node/
	cd $(BINDINGS_VAR)/node && $(CONTRACTS_ENV) $(NODE) --expose-gc --test generated.wasm.test.mjs cases.wasm.test.mjs api.wasm.test.mjs

# The extension built against PHP_CONFIG and loaded into PHP; the stub is linted, then the generated tests and the
# contract cases run on PHPUnit. ext-php-rs reads PHP and PHP_CONFIG when it builds the extension.
test-php: export PHP := $(PHP)
test-php: export PHP_CONFIG := $(PHP_CONFIG)
test-php: bindings-php ## Build the extension, lint its stub and run the generated tests and the contract cases on PHPUnit; offline
	cargo build --locked --offline -p $(CORE)-php-ext --features $(PHP_FEATURES)
	$(PHP) -l packages/php-ext/generated/polyspec_php_serialization.stub.php
	$(PHP) -d extension=$(CARGO_TARGET)/debug/libpolyspec_php_serialization.$(CDYLIB) $(PHPUNIT) packages/php-ext/generated/tests
	$(CONTRACTS_ENV) $(PHP) -d extension=$(CARGO_TARGET)/debug/libpolyspec_php_serialization.$(CDYLIB) $(PHPUNIT) packages/php-ext/tests

# The static library with the test features (binding GN-13b), which Go links through CGO_LDFLAGS; gofmt and go vet,
# then the generated tests on go test. GOTOOLCHAIN=local: a go of another release than the go directive fails instead
# of fetching that release.
GO_RELEASE := $(shell sed -n 's/^go \(.*\)$$/\1/p' packages/go/go.mod)
GO_ENV := GOTOOLCHAIN=local CGO_LDFLAGS=-L$(CARGO_TARGET)/debug GOFLAGS=-tags=polyspec_panic_test,polyspec_codec_test
test-go: bindings-go ## Build the static library of the Go binding, run gofmt and go vet, then the generated tests on go test; offline
	test "$$($(GO_ENV) $(GO) env GOVERSION)" = "go$(GO_RELEASE)"
	cargo build --locked --offline -p $(CORE)-go --features $(GO_FEATURES)
	test -z "$$(cd packages/go && $(GOFMT) -l .)"
	cd packages/go && $(GO_ENV) $(GO) vet ./...
	cd packages/go && $(GO_ENV) $(CONTRACTS_ENV) $(GO) test -count=1 -v ./...

typecheck: ## Check the TypeScript of scripts/ with tsc; offline
	$(NODE) node_modules/typescript/bin/tsc -p tsconfig.json

# ---- The checks of the format -----------------------------------------------------------------------------------------------
# contracts writes contracts/php-serialize.json from real PHP; contracts-check fails when PHP writes anything else.
contracts: ## Write contracts/php-serialize.json from real PHP; offline
	$(NODE) scripts/contracts.mts

contracts-check: ## Fail when real PHP writes another contracts/php-serialize.json; offline
	$(NODE) scripts/contracts.mts --check

# fuzz gives corrupted and generated input and the bytes of random values of PHP, with a fixed seed, to real PHP, to the Rust
# crate, whose probe it builds first, and to the Node.js and Python packages (scripts/fuzz.mts).
fuzz: fuzz-temp-test ## Compare the Rust crate and both ports with real PHP on corrupted and generated input; offline
	cargo build -p $(CORE) --locked --offline --release --example probe
	$(NODE) scripts/fuzz.mts

# fuzz-temp-test checks that a run removes the directory that a killed run left.
fuzz-temp-test: ## Run the test of the fuzz directories; offline
	$(NODE) $(KIT)/run-tests.mjs node -- --test-concurrency=1 scripts/fuzz-temp.test.mts

# ---- The checks of the repository -------------------------------------------------------------------------------------------
# alint checks the tree against config/layout.yml, which extends config/layout.kit.yml with the map of this repository.
layout-check: ## Check the folder layout, that Git ignores each install directory and that no tracked file is generated; offline
	$(ALINT) check --config config/layout.yml --color never --compact .
	$(NODE) $(KIT)/generated-files.mjs installs var package.json=node_modules pyproject.toml=.venv composer.json=vendor
	$(NODE) $(KIT)/generated-files.mjs tracked --binary ELF --binary Mach-O --binary PE

docs-check: ## Check the documents of config/documents.json and the checklists of config/checklist.json; offline
	$(NODE) $(KIT)/check-documents.mjs --checklist-place --private-path /Users/ --private-path /home/ --kit-rows

# The rules of the GitHub workflows (AGENTS.md, "CI and release"), on the installed test runner of kit.
workflows-test: ## Run the test of the rules of the GitHub workflows; offline
	$(NODE) $(KIT)/run-tests.mjs node -- --test-concurrency=1 scripts/workflows.test.mts

# No tracked document names a Git commit (AGENTS.md, "Tools"); commit-names-test tests the checker.
commit-names-check: ## Fail while a tracked document names a Git commit; offline
	$(NODE) scripts/check-commit-names.mts

commit-names-test: ## Run the test of the checker of commit names; offline
	$(NODE) $(KIT)/run-tests.mjs node -- --test-concurrency=1 scripts/commit-names.test.mts

rules-check: ## Check that every rule of AGENTS.md names a check that CI runs; offline
	$(NODE) $(KIT)/check-rules.mjs AGENTS.md

owner-check: ## Run the checks that own the changed paths (config/owner-checks.json); PATHS="a b" or BASE=<revision>
	$(NODE) $(KIT)/owner-check.mjs --every-path $(if $(PATHS),--paths "$(PATHS)") $(if $(BASE),--base $(BASE))

owner-validate: ## Check that config/owner-checks.json owns every tracked path and names only existing targets; offline
	$(NODE) $(KIT)/owner-check.mjs --every-path --validate

# The tool sources of rebuild-check, the values that kit 0.0.98 fixed (kit K1080): the scripts and generators, each glob quoted.
REBUILD_SOURCES := --source 'scripts/**/*.{mts,mjs,cjs,js,ts,py,php,sh,mk}' --source 'packages/*/{scripts,tools,bin}/**/*.{mts,mjs,cjs,js,ts,py,php,sh,mk}' --source 'packages/*/*/{scripts,tools,bin}/**/*.{mts,mjs,cjs,js,ts,py,php,sh,mk}' --source '**/*_generate.go' --source '**/*.generate.{mts,mjs,cjs,js,ts,py,php,sh,mk}' --source 'benchmarks/**/*.{mts,mjs,cjs,js,ts,py,php,sh,mk}' --source 'examples/**/*.{mts,mjs,cjs,js,ts,py,php,sh,mk}' --source 'tests/fixtures/*/generate.*'
# The files among the sources that are no tool source (kit K1080): the .d.ts declarations and the tests.
REBUILD_EXCLUDES := --exclude '**/*.d.ts' --exclude '*/**/{test,tests}/**' --exclude 'test/**' --exclude 'tests/**/{*_generate.go,*.generate.*}' --exclude '**/*.{test,spec}.{js,jsx,ts,tsx,cjs,cts,mjs,mts}' --exclude '**/{*_test.go,test_*.py,*_test.py,*Test.php}'
rebuild-check: ## Check that every tool of config/rebuild.json has its class; offline
	$(NODE) $(KIT)/rebuild-check.mjs $(REBUILD_SOURCES) $(REBUILD_EXCLUDES)

language-check: ## Fail on Hangul in the code; offline
	$(NODE) $(KIT)/language-check.mjs --forbid '\p{Script=Hangul}'

duplication-check: ## Fail on a piece of 6 lines or more of code that exists twice (config/duplication.json); offline
	$(NODE) $(KIT)/duplication-check.mjs

suppression-check: ## Fail on a suppression of a lint finding without its reason; offline
	$(NODE) $(KIT)/suppression-check.mjs

# ---- CI -----------------------------------------------------------------------------------------------------------------------
ci-shared: ## Run the targets of the shared CI job past failures into CI_REPORT
	$(NODE) $(KIT)/ci-targets.mjs -k $(CI_REPORT) $(CI_SHARED)

ci-passed: ## Fail unless every job of RESULTS, the JSON of toJSON(needs), has the result success; FAIL_SKIPPED=1 fails a skipped job
	$(NODE) $(KIT)/ci-passed.mjs

ci-fuzz: ## Run the targets of the fuzz CI job past failures into CI_REPORT
	$(NODE) $(KIT)/ci-targets.mjs -k $(CI_REPORT) $(CI_FUZZ)

ci-ts: ## Run the targets of the TypeScript CI job past failures into CI_REPORT
	$(NODE) $(KIT)/ci-targets.mjs -k $(CI_REPORT) $(CI_TS)

ci-python: ## Run the targets of the Python CI job past failures into CI_REPORT
	$(NODE) $(KIT)/ci-targets.mjs -k $(CI_REPORT) $(CI_PYTHON)

ci-rust: ## Run the targets of the Rust CI job past failures into CI_REPORT
	$(NODE) $(KIT)/ci-targets.mjs -k $(CI_REPORT) $(CI_RUST)

ci-bindings: ## Run the targets of the binding tests past failures into CI_REPORT, the job that waits for row T2.9
	$(NODE) $(KIT)/ci-targets.mjs -k $(CI_REPORT) $(CI_BINDINGS)

check: ## Run the targets of every CI job once into var/report/full-run
	$(NODE) $(KIT)/ci-targets.mjs -k var/report/full-run $(CI_SHARED) $(CI_FUZZ) $(CI_TS) $(CI_PYTHON) $(CI_RUST)

# ---- Plans, rows and commits --------------------------------------------------------------------------------------------------
# The plan utility reads its values from the environment, where make puts its command-line variables. The texts of a row reach
# it unexpanded: each text that is set is passed in the recipe as its raw value, in single quotes, and an unset one stays unset.
raw_text = $(foreach v,$(1),$(if $(filter undefined,$(origin $(v))),,$(v)='$(subst ','\'',$(value $(v)))'))

plan-new: ## Write the plan NAME=<slug> with TITLE and TITLE_KO into docs/plans/<slug>/; offline
	NAME_PATTERN='^[a-z][a-z0-9-]*$$' $(NODE) $(KIT)/plan.mjs plan-new

plan-split: ## Move the items IDS from the plan FROM to the plan TO; offline
	$(NODE) $(KIT)/plan.mjs plan-split

item-new: ## Add the item ID to the checklist of PLAN with TASK, TASK_KO, DELIVERABLES and VERIFICATION; offline
	$(call raw_text,TASK TASK_KO DELIVERABLES VERIFICATION) $(NODE) $(KIT)/plan.mjs item-new

item-edit: ## Replace the cells of the item ID with TASK, TASK_KO, DELIVERABLES, VERIFICATION, CAUSE, RETRY, CAUSE_KO or RETRY_KO; offline
	$(call raw_text,TASK TASK_KO DELIVERABLES VERIFICATION CAUSE RETRY CAUSE_KO RETRY_KO) DONE_STAYS=1 $(NODE) $(KIT)/plan.mjs item-edit

item-state: ## Move the item ID to STATE in both languages; offline
	$(NODE) $(KIT)/plan.mjs item-state

item-test: ## Run the commands of the Verification cell of the item ID in order; offline
	$(NODE) $(KIT)/plan.mjs item-test

commit: ## Commit the index for the item ID as TYPE(SCOPE): SUBJECT (#ID) with the body of BODY_FILE; offline
	$(NODE) $(KIT)/plan.mjs commit

documents-stamp: ## Write the source-sha256 of each English document into the Korean twins that PATHS names; offline
	$(NODE) $(KIT)/documents-stamp.mjs $(PATHS)

# FILE and TEXT reach the tool through its environment, unexpanded: make exports a variable of its command line expanded, so
# TEXT is not exported.
unexport TEXT
text-absent: export KIT_TEXT_ABSENT_FILE = $(value FILE)
text-absent: export KIT_TEXT_ABSENT_TEXT = $(value TEXT)
text-absent: ## Fail while the tracked file FILE holds the stale text TEXT: the Red of a row whose change is text; offline
	$(NODE) $(KIT)/text-absent.mjs

# The declaration of make hooks (kit K1099): no hook,
# the merges of the changelogs and checklists (kit K354) and their drivers, which run twin-merge of this checkout.
TWIN_MERGE_DRIVER := make --no-print-directory twin-merge MERGE="%O %A %B %P"
HOOK_DECLARATION := --merge 'CHANGELOG.md=kit-changelog' --merge 'CHANGELOG.ko.md=kit-twin' \
	--merge 'docs/plans/*/checklist.md=kit-checklist' --merge 'docs/plans/*/checklist.ko.md=kit-twin' \
	--driver 'kit-twin=$(TWIN_MERGE_DRIVER)' --driver 'kit-changelog=$(TWIN_MERGE_DRIVER)' --driver 'kit-checklist=$(TWIN_MERGE_DRIVER)'
# hooks declares the merge drivers of the changelogs and the checklists, which git runs as make twin-merge.
hooks: ## Declare the merge drivers of the changelogs and the checklists; offline
	$(NODE) $(KIT)/git-hooks.mjs install $(HOOK_DECLARATION)

twin-merge: ## The merge driver of a changelog or checklist; git runs it with MERGE="<base> <ours> <theirs> <path>"; offline
	@$(NODE) $(KIT)/twin-merge.mjs $(MERGE)

# The worktree of a row (kit K1107), as kit 0.0.98 made it: ../<main checkout>-<NAME>-<ID> on <TYPE or fix>/<NAME>-<ID> from main;
# a worktree without node_modules first gets npm ci of the npm of var/tools, then make install and make link-check run in it. The
# worktree runs its own tools in a make of its own (kit K858): the recipe drops the flags of this make and this var/tools from PATH.
WORKTREE_MAIN = $(patsubst %/.git,%,$(shell git rev-parse --path-format=absolute --git-common-dir))
WORKTREE_DECLARATION = --folder $(WORKTREE_MAIN)-$(NAME)-$(ID) --branch $(or $(TYPE),fix)/$(NAME)-$(ID) --base main --prepare 'test -d node_modules || PATH="$(KIT_TOOLS)/bin:$$PATH" $(NPM) ci --ignore-scripts' --make install --make link-check
WORKTREE_ENVIRONMENT = env -u MAKEFLAGS -u MFLAGS -u MAKELEVEL PATH="$$(printf '%s' "$$PATH" | awk -v RS=: -v ORS=: -v tools='$(KIT_TOOLS)' 'index($$0, tools) != 1' | sed 's/:$$//')"
worktree-setup: ## Create or reuse the row worktree NAME for ID and TYPE from main and run make install in it; ONLINE
	$(ONLINE) $(WORKTREE_ENVIRONMENT) $(NODE) $(KIT)/worktree-setup.mjs $(WORKTREE_DECLARATION)

land: ## Land the branch BRANCH on main fast-forward and remove its worktree; offline
	$(NODE) $(KIT)/land.mjs $(BRANCH) main

# ---- Release (.github/workflows/release.yml) ----------------------------------------------------------------------------------
release-tag: ## Tag the commit of the successful CI run RUN of ci.yml on main with the newest version of its change log; AUTO for workflow_run
	@test -n "$$RUN" || { echo "release-tag: RUN is required, for example make release-tag RUN=123"; exit 1; }
	RELEASE_MAIN=origin/main $(NODE) $(KIT)/release-run.mjs tag "$$RUN"$(if $(AUTO), --auto)

release-zip: ## Fail unless zip, which Composer needs for the release archives, is on PATH
	@command -v zip >/dev/null || { echo 'release-zip: Info-ZIP is required for Composer release archives; install the zip package on the Ubuntu runner'; exit 1; }

release-checkout: ## Check out the tag TAG, so that the release builds the tagged commit with its own kit
	@test -n "$$TAG" || { echo "release-checkout: TAG is required, for example make release-checkout TAG=v0.0.1"; exit 1; }
	git checkout --quiet "$$TAG"

release-tools: ## Install the tools that config/release.json needs for the release; ONLINE
	$(ONLINE) $(NODE) $(KIT)/release-tools.mjs

release-tools-path: ## Append var/tools/bin and the shims of mise to GITHUB_PATH and the MISE_* folders to GITHUB_ENV
	@test -n "$$GITHUB_PATH" || { echo 'release-tools-path: GITHUB_PATH is not set; run it in the release workflow'; exit 1; }
	@test -n "$$GITHUB_ENV" || { echo 'release-tools-path: GITHUB_ENV is not set; run it in the release workflow'; exit 1; }
	@echo "$(VAR_TOOLS)/mise/shims" >> "$$GITHUB_PATH"
	@echo "$(VAR_TOOLS)/bin" >> "$$GITHUB_PATH"
	@for name in $(MISE_ENVIRONMENT); do echo "$$name=$$(printenv $$name)"; done >> "$$GITHUB_ENV"

release-assets: ## Build the archive of every package of TAG into var/release/assets; ONLINE
	@test -n "$$TAG" || { echo "release-assets: TAG is required, for example make release-assets TAG=v0.0.1"; exit 1; }
	RELEASE_ASSETS=var/release/assets $(ONLINE) $(NODE) $(KIT)/release.mjs assets "$$TAG"

# release-candidate-assets builds the same archives from the committed HEAD at VERSION, without a tag, so that a change of
# config/release.json is proved before a release.
release-candidate-assets: ## Build the archive of every package of HEAD at VERSION into RELEASE_ASSETS without a tag; ONLINE
	@test -n "$$VERSION" || { echo "release-candidate-assets: VERSION is required, for example make release-candidate-assets VERSION=0.0.1"; exit 1; }
	RELEASE_ASSETS=$(RELEASE_ASSETS) $(ONLINE) $(NODE) $(KIT)/release.mjs candidate-assets "$$VERSION"

release-publish: ## Create the GitHub Release of TAG as a draft with its notes and the files of release-assets
	@test -n "$$TAG" || { echo "release-publish: TAG is required, for example make release-publish TAG=v0.0.1"; exit 1; }
	RELEASE_ASSETS=var/release/assets RELEASE_RECORDS=var/release $(NODE) $(KIT)/release.mjs publish "$$TAG"

release-undraft: ## Make the draft release of TAG public
	@test -n "$$TAG" || { echo "release-undraft: TAG is required, for example make release-undraft TAG=v0.0.1"; exit 1; }
	RELEASE_RECORDS=var/release $(NODE) $(KIT)/release.mjs undraft "$$TAG"

release-coverage: ## Require every package file of the checkout to be classified in config/release.json; offline
	$(NODE) $(KIT)/release.mjs coverage

# ---- The per-platform assets of the bindings (binding GN-19 to GN-19g; row T2.7) -----------------------------------------
# kit builds no per-platform asset, so the recipes of this repository build them. A recipe builds the asset of the platform
# of its host, because no tool of the release compiles for another platform: it reads the host from rustc of the pinned
# toolchain and writes into RELEASE_ASSETS, building with CARGO_TARGET_DIR set to RELEASE_TARGET, so that an asset holds
# nothing of a development build. Each step is a line that starts a standard tool (GN-19).
RELEASE_ASSETS ?= var/release/assets
RELEASE_TARGET ?= var/release/target
# release_host sets host to the Rust triple of the toolchain, platform to the name of its platform, which names its npm
# platform package, go to the directory of the Go module of its platform and pie to the part of the name of a PHP
# extension archive that names its platform (GN-19a), and ends the recipe $(1) with 2 on a host that is no platform of the
# release.
release_host = host=$$(rustc --print host-tuple) || exit 1; \
	case "$$host" in \
	x86_64-unknown-linux-gnu) platform=linux-x64-gnu go=linux_amd64 pie=x86_64-linux-glibc ;; \
	aarch64-unknown-linux-gnu) platform=linux-arm64-gnu go=linux_arm64 pie=arm64-linux-glibc ;; \
	aarch64-apple-darwin) platform=darwin-arm64 go=darwin_arm64 pie=arm64-darwin-bsdlibc ;; \
	*) echo "$(1): the host $$host is no platform of the release: x86_64-unknown-linux-gnu, aarch64-unknown-linux-gnu, aarch64-apple-darwin" >&2; exit 2 ;; \
	esac

# release-go-static builds the static library of the Go module (GN-19b) and strips the debug sections of a copy in
# RELEASE_TARGET with the llvm-strip of the component llvm-tools of the toolchain (rust-toolchain.toml), never the strip of
# PATH, which differs by machine. The stripped copy enters the assets under another name and is renamed there, so the
# assets never hold a library that is half written or not stripped.
release-go-static: ## Build and strip the static library of the Go module of the platform of the host into RELEASE_ASSETS/go
	@$(call release_host,release-go-static); \
	set -ex; \
	CARGO_TARGET_DIR=$(RELEASE_TARGET) cargo build --release --locked -p $(CORE)-go; \
	copy=$(RELEASE_TARGET)/stripped/$$go; \
	mkdir -p "$$copy"; \
	cp $(RELEASE_TARGET)/release/libpolyspec_php_serialization_go.a "$$copy/libpolyspec_php_serialization_go.a"; \
	"$$(rustc --print sysroot)/lib/rustlib/$$host/bin/llvm-strip" --strip-debug "$$copy/libpolyspec_php_serialization_go.a"; \
	out=$(RELEASE_ASSETS)/go/$$go; \
	mkdir -p "$$out"; \
	cp "$$copy/libpolyspec_php_serialization_go.a" "$$out/.libpolyspec_php_serialization_go.a.part"; \
	mv "$$out/.libpolyspec_php_serialization_go.a.part" "$$out/libpolyspec_php_serialization_go.a"

# release-wheel builds the abi3 wheel of the platform of the host (GN-19c) from the generated Python binding, with the uv
# of the checkout: maturin builds with --locked, and the time of the commit of HEAD dates the files of the wheel. One
# wheel of a platform serves every supported Python.
release-wheel: bindings-python ## Build the abi3 wheel of the platform of the host into RELEASE_ASSETS/wheel
	@$(call release_host,release-wheel); \
	set -ex; \
	CARGO_TARGET_DIR=$(RELEASE_TARGET) MATURIN_PEP517_ARGS=--locked SOURCE_DATE_EPOCH=$$(git log -1 --format=%ct HEAD) $(UV) build --wheel --python python3 --out-dir $(RELEASE_ASSETS)/wheel packages/python

# release-php-ext builds the PHP extension of the platform of the host for the minor of the PHP that PHP names (GN-19d)
# from the generated PHP binding, with the php-config of PHP_CONFIG when the command line gives it, otherwise the one
# beside that PHP. The recipe resolves both on PATH to absolute paths, because the build script of ext-php-rs refuses a
# PHP that it cannot find by the path that PHP names. The cdylib is copied as polyspec_php_serialization.so into a
# directory of RELEASE_TARGET for that PHP build, which must load it without a php.ini before it is packed, and the
# archive takes the name by which PIE finds a pre-packaged binary: the version of the crate, the minor, the platform, and
# debug and zts as that PHP reports them. An archive that an earlier run left is removed first, because zip adds to an
# archive that exists. The archive enters the assets under another name and is renamed there.
RELEASE_PHP_CONFIG = $(if $(filter command line,$(origin PHP_CONFIG)),$(PHP_CONFIG),$(PHP)-config)
release-php-ext: bindings-php ## Build, load and pack the PHP extension of the platform of the host for the PHP of PHP into RELEASE_ASSETS/php-ext
	@$(call release_host,release-php-ext); \
	php=$$(command -v '$(PHP)') || { echo 'release-php-ext: no PHP $(PHP) on PATH' >&2; exit 2; }; \
	case "$$php" in /*) ;; *) php=$(CURDIR)/$$php ;; esac; \
	config=$$(command -v '$(RELEASE_PHP_CONFIG)') || { echo 'release-php-ext: no php-config $(RELEASE_PHP_CONFIG) on PATH' >&2; exit 2; }; \
	case "$$config" in /*) ;; *) config=$(CURDIR)/$$config ;; esac; \
	set -ex; \
	PHP="$$php" PHP_CONFIG="$$config" CARGO_TARGET_DIR=$(RELEASE_TARGET) cargo build --release --locked -p $(CORE)-php-ext; \
	version=$$(cargo pkgid -p $(CORE)-php-ext); version=$${version##*@}; \
	minor=$$("$$php" -n -r 'echo PHP_MAJOR_VERSION, ".", PHP_MINOR_VERSION;'); \
	build=$$("$$php" -n -r 'echo PHP_DEBUG ? "-debug" : "", "-", PHP_ZTS ? "zts" : "nts";'); \
	copy=$(abspath $(RELEASE_TARGET))/php-ext/php$$minor$$build; \
	mkdir -p "$$copy"; \
	cp $(RELEASE_TARGET)/release/libpolyspec_php_serialization.$(CDYLIB) "$$copy/polyspec_php_serialization.so"; \
	"$$php" -n -d extension="$$copy/polyspec_php_serialization.so" -r 'exit(extension_loaded("polyspec_php_serialization") ? 0 : 1);'; \
	name=php_polyspec_php_serialization-v$${version}_php$$minor-$$pie$$build.zip; \
	rm -f "$$copy/$$name"; \
	(cd "$$copy" && zip -q -9 -X "$$name" polyspec_php_serialization.so); \
	out=$(RELEASE_ASSETS)/php-ext; \
	mkdir -p "$$out"; \
	cp "$$copy/$$name" "$$out/.$$name.part"; \
	mv "$$out/.$$name.part" "$$out/$$name"

# The platforms of the npm package, by the names of their platform packages (GN-19a), and the napi CLI of the devDependency
# @napi-rs/cli of the root package.json, by its bin link.
RELEASE_NPM_PLATFORMS := linux-x64-gnu linux-arm64-gnu darwin-arm64
NAPI := $(CURDIR)/node_modules/.bin/napi
# release_pack packs the npm package of the folder $(1) with npm pack --ignore-scripts into the fresh folder $(2), and
# renames each archive into RELEASE_ASSETS/npm from a copy of another name, so the assets never hold a half written archive.
release_pack = (cd $(1) && $(NPM) pack --ignore-scripts --pack-destination $(2)); \
	mkdir -p $(RELEASE_ASSETS)/npm; \
	for file in $(2)/*.tgz; do \
	name=$$(basename "$$file"); \
	cp "$$file" "$(RELEASE_ASSETS)/npm/.$$name.part"; \
	mv "$(RELEASE_ASSETS)/npm/.$$name.part" "$(RELEASE_ASSETS)/npm/$$name"; \
	done

# release-npm-platform builds the Node addon of the platform of the host and packs its npm platform package (GN-19e) with
# the napi CLI: napi build writes the addon, and create-npm-dirs and artifacts write the package of the platform with a
# configuration of the run that names the triple of the host alone, because napi artifacts fails for a configured platform
# whose addon another runner builds.
release-npm-platform: bindings-node ## Build the Node addon of the platform of the host and pack its npm platform package into RELEASE_ASSETS/npm
	@$(call release_host,release-npm-platform); \
	work=$(abspath $(RELEASE_TARGET))/npm/$$platform; \
	set -ex; \
	rm -rf "$$work"; \
	mkdir -p "$$work/pack"; \
	printf '{"targets":["%s"]}\n' "$$host" > "$$work/napi.json"; \
	$(NAPI) build --platform --release --no-js --manifest-path packages/ts/Cargo.toml --package-json-path packages/ts/package.json --target-dir $(RELEASE_TARGET) --output-dir "$$work/addons" --target "$$host" -- --locked; \
	$(NAPI) create-npm-dirs --package-json-path packages/ts/package.json --config-path "$$work/napi.json" --npm-dir "$$work/npm"; \
	$(NAPI) artifacts --package-json-path packages/ts/package.json --config-path "$$work/napi.json" --output-dir "$$work/addons" --npm-dir "$$work/npm"; \
	$(call release_pack,"$$work/npm/$$platform","$$work/pack")

# release-npm packs @polyspec/php-serialization itself (GN-19e, GN-3c) from a copy of the files that its package.json
# names: the generated Node loader, and the WASM binding that cargo builds for release and the wasm-bindgen of
# WASM_BINDGEN binds, which must be the release of the wasm-bindgen crate (GN-18). The manifest of the copy names the
# platform package of each platform of the release at the version of the package in optionalDependencies; the tracked
# manifest names none.
release-npm: bindings-node bindings-wasm ## Pack the npm package with its WASM binding and its platform packages in optionalDependencies into RELEASE_ASSETS/npm
	test "$$($(WASM_BINDGEN) --version)" = "wasm-bindgen $(WASM_BINDGEN_RELEASE)"
	@work=$(abspath $(RELEASE_TARGET))/npm/package; \
	set -ex; \
	rm -rf "$$work"; \
	mkdir -p "$$work/package/generated" "$$work/package/wasm/generated" "$$work/pack"; \
	cp packages/ts/generated/index.cjs packages/ts/generated/index.mjs packages/ts/generated/index.d.ts "$$work/package/generated/"; \
	cp packages/ts/wasm/generated/*.mjs packages/ts/wasm/generated/*.d.ts "$$work/package/wasm/generated/"; \
	CARGO_TARGET_DIR=$(RELEASE_TARGET) cargo build --release --locked -p $(CORE)-wasm --target wasm32-unknown-unknown; \
	$(WASM_BINDGEN) --target web --out-dir "$$work/package/wasm/generated" --out-name php_serialization_wasm $(RELEASE_TARGET)/wasm32-unknown-unknown/release/polyspec_php_serialization_wasm.wasm; \
	$(NODE) -e 'const fs = require("fs"); const [from, to, ...platforms] = process.argv.slice(1); const p = JSON.parse(fs.readFileSync(from, "utf8")); p.optionalDependencies = Object.fromEntries(platforms.map(platform => [`$${p.name}-$${platform}`, p.version])); fs.writeFileSync(to, JSON.stringify(p, null, 2) + "\n");' packages/ts/package.json "$$work/package/package.json" $(RELEASE_NPM_PLATFORMS); \
	$(call release_pack,"$$work/package","$$work/pack")

# release-go-module carries the Go module of the release TAG (GN-19f): on the checkout of that tag, after the generation of
# the Go binding, binding release-go-module checks the library of each platform in RELEASE_ASSETS/go (GN-19b), proves a
# commit that adds the generated files and the libraries to the tree of the tag with a consumer, and creates the annotated
# tag packages/go/<TAG> at it, keeping its index, its repositories and the caches of Go in a folder of the run. The
# command pushes nothing: the recipe pushes the reference that it prints, and nothing when it prints none, because the
# remote holds that tag already. The folder of the run is made writable before it is removed, since Go writes its module
# cache read-only.
release-go-module: bindings-go ## Make, prove and push the commit and the tag packages/go/TAG of the Go module with the libraries of RELEASE_ASSETS/go
	@test -n "$$TAG" || { echo 'release-go-module: TAG is required, for example make release-go-module TAG=v0.0.1' >&2; exit 2; }
	@work=$(abspath $(RELEASE_TARGET))/go-module; \
	set -e; \
	if [ -d "$$work" ]; then chmod -R u+w "$$work"; rm -rf "$$work"; fi; \
	mkdir -p "$$work"; \
	echo "$(BINDING) release-go-module --root $(CURDIR) --tag $$TAG --libraries $(abspath $(RELEASE_ASSETS))/go --work $$work"; \
	ref=$$($(BINDING) release-go-module --root $(CURDIR) --tag "$$TAG" --libraries $(abspath $(RELEASE_ASSETS))/go --work "$$work"); \
	case "$$ref" in \
	'') echo "release-go-module: the remote holds the tag packages/go/$$TAG already" ;; \
	"refs/tags/packages/go/$$TAG") set -x; git push origin "$$ref" ;; \
	*) echo "release-go-module: binding printed $$ref, not refs/tags/packages/go/$$TAG" >&2; exit 1 ;; \
	esac

# release-test runs the tests of the recipes of the per-platform assets (scripts/release.test.mts) against stand-ins of the
# tools that they start; it reads the node and npm of var/tools.
release-test: ## Run the tests of the recipes of the per-platform assets of the release; offline
	$(NODE) $(KIT)/run-tests.mjs node -- --test-concurrency=1 scripts/release.test.mts
