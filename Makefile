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
# Every recipe runs cargo through the cargo of kit's link (T2.41): with the checkouts that .links names it patches their git
# sources and resolves against a copy of the lock, and with none it runs cargo as given (kit docs/operations/local-links.md).
CARGO := $(NODE) $(KIT)/link.mjs cargo $(CURDIR)
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
CI_SHARED := workflows-test layout-check docs-check rules-check owner-validate rebuild-check language-check duplication-check suppression-check commit-names-check commit-names-test link-check release-coverage typecheck contracts-check binding-features-test release-manifests-test cargo-link-test
CI_FUZZ := fuzz
CI_TS := lint-ts test-js
CI_PYTHON := lint-python test-python
CI_RUST := lint-rust test-rust bindings-check
# The targets of the binding tests, which the job bindings of ci.yml runs with make ci-bindings (row T2.9): the release
# ships the bindings of the five targets as assets, so ci-passed requires their lint and their tests. The job installs every
# tool of mise.toml (make install-tools), the crates of make php-serialization-install-rust and the PHPUnit of
# make install-php-tools.
CI_BINDINGS := lint-bindings check-declarations test-python-binding test-node test-wasm test-php test-go
CI_REPORT ?= var/report/ci-targets

.PHONY: ci-release-tag ci-release-release bootstrap install install-tools install-packages install-php-tools php-tools-lock toolchain-lock php-serialization-install-python link unlink link-check \
	php-serialization-install-rust build build-js build-python build-rust test test-js test-python test-rust lint lint-ts lint-python lint-rust typecheck bindings $(BINDING_PHONY) bindings-check \
	test-bindings lint-bindings check-declarations test-python-binding node-package test-node test-wasm test-php test-go \
	contracts contracts-check fuzz fuzz-temp-test binding-features-test release-manifests-test release-version binding-pin cargo-link-test commit-names-check commit-names-test workflows-test ci-passed release-checkout release-zip \
	layout-check docs-check rules-check owner-check owner-validate rebuild-check language-check \
	duplication-check suppression-check \
	check ci-shared ci-fuzz ci-ts ci-python ci-rust ci-bindings ci-assets-platform ci-assets-php ci-assets-npm \
	plan-new plan-split item-new item-edit item-state item-test commit documents-stamp text-absent hooks twin-merge \
	worktree-setup land \
	release-tag release-tools release-tools-path release-assets release-publish release-undraft release-coverage release-candidate-assets release-recipes release-tag-output

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
	$(MAKE) --no-print-directory install-php-tools

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

# The PHPUnit of composer.lock, which make test-php runs (PHPUNIT): the root composer.json is the development project of the
# repository and declares nothing else, and its platform is the lowest PHP minor of the extension, so that the lock installs
# on every PHP that the extension supports. install-php-tools installs it into vendor; php-tools-lock writes the lock again.
COMPOSER := $(VAR_TOOLS)/mise/shims/composer
install-php-tools: ## Install the PHPUnit of composer.lock into vendor; ONLINE
	$(COMPOSER_TOOL_ENV) $(ONLINE) $(COMPOSER) install --no-interaction --no-progress

php-tools-lock: ## Write composer.lock for the require-dev of composer.json without installing; ONLINE
	$(COMPOSER_TOOL_ENV) $(ONLINE) $(COMPOSER) update --no-interaction --no-progress --no-install

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

# php-serialization-install-rust installs the toolchain of rust-toolchain.toml with rustup and fetches the crates of the root
# Cargo.lock, so that every Rust recipe and every binding recipe runs with --locked and offline. The tool binding is the npm
# package of package.json, which make install-packages installs.
php-serialization-install-rust: ## Install the Rust toolchain of rust-toolchain.toml and fetch the locked crates; ONLINE
	$(ONLINE) rustup toolchain install --no-self-update
	$(ONLINE) $(CARGO) fetch --locked

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
	$(CARGO) build -p $(CORE) --locked --offline

# The unit tests of a runtime with CASES=<pattern>; without CASES, every unit test, which the runner of kit runs only in CI. The
# runner arguments are those that kit 0.0.98 passed (kit K1094, K1106): one test at a time and the 30 s test timeout of node.
test-js: ## Run the unit tests of the JavaScript package with the name filter CASES=<pattern>; offline
	$(NODE) $(KIT)/runtime-targets.mjs test --runner node --roots legacy/packages/js -- --test-timeout=30000 --test-concurrency=1
test-python: ## Run the unit tests of the Python package with the name filter CASES=<pattern>; offline
	PYTHONUNBUFFERED=1 NO_COLOR=1 PYTHON_COLORS=0 $(NODE) $(KIT)/runtime-targets.mjs test --runner python --roots legacy/packages/python --venv .venv

test-rust: ## Run the contract and the unit tests of the Rust crate with cargo test, with the name filter CASES=<pattern>; offline
	$(CARGO) test -p $(CORE) --locked --offline $(CASES)

lint-ts: ## Lint the TypeScript and JavaScript with oxlint (.oxlintrc.json) and knip (knip.json); offline
	$(NODE) $(KIT)/lint-ts.mjs

lint-python: ## Lint the Python with ruff (ruff.toml) and vulture ([tool.vulture] of the package); offline
	$(NODE) $(KIT)/lint-python.mjs

# R-1: clippy with the [workspace.lints] of Cargo.toml and the disallowed methods of clippy.toml, every warning an error, and
# rustfmt.
lint-rust: ## Lint the Rust crate with cargo clippy ([workspace.lints] of Cargo.toml and clippy.toml) and rustfmt; offline
	$(CARGO) clippy -p $(CORE) --locked --offline --all-targets -- -D warnings
	$(CARGO) fmt -p $(CORE) --check

# ---- Bindings -----------------------------------------------------------------------------------------------------------------
# binding is the npm package @polyspec/binding of package.json, the asset of the GitHub Release of the tag that every
# dependency line on polyspec-binding-core names, so that the tool and the crate are one release (binding CK-20, CK-70).
BINDING := $(CURDIR)/node_modules/.bin/binding

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
PHPUNIT ?= $(CURDIR)/vendor/bin/phpunit
# The file name extension of a library that Cargo builds as a cdylib: dylib on macOS, so on Linux.
CDYLIB := $(if $(filter Darwin,$(shell uname -s)),dylib,so)
# The folder that cargo builds into: the CARGO_TARGET_DIR of the environment when it names one, so that a run can build on
# another volume, and the target folder of the workspace otherwise.
CARGO_TARGET := $(or $(CARGO_TARGET_DIR),$(CURDIR)/target)
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
	$(CARGO) clippy --workspace --locked --offline --all-targets --features $(TEST_FEATURES) -- -D warnings

# check-declarations checks each generated declaration file alone with --ignoreConfig: TypeScript 7 refuses files on the
# command line beside the tsconfig.json of the root (TS5112), and the declarations are checked without its settings.
check-declarations: bindings-node bindings-wasm ## Check the generated declarations of the Node and WASM bindings with tsc; offline
	$(NODE) node_modules/typescript/bin/tsc --ignoreConfig --noEmit --strict packages/ts/generated/index.d.ts
	$(NODE) node_modules/typescript/bin/tsc --ignoreConfig --noEmit --strict packages/ts/wasm/generated/index.d.ts

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
	$(CARGO) build --locked --offline -p $(CORE)-wasm --target wasm32-unknown-unknown --features $(WASM_FEATURES)
	$(WASM_BINDGEN) --target web --out-dir packages/ts/wasm/generated --out-name php_serialization_wasm \
		$(CARGO_TARGET)/wasm32-unknown-unknown/debug/polyspec_php_serialization_wasm.wasm
	$(CARGO) build --locked --offline -p $(CORE)-node --features $(NODE_FEATURES)
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
	$(CARGO) build --locked --offline -p $(CORE)-php-ext --features $(PHP_FEATURES)
	$(PHP) -l packages/php-ext/generated/polyspec_php_serialization.stub.php
	$(PHP) -d extension=$(CARGO_TARGET)/debug/libpolyspec_php_serialization.$(CDYLIB) $(PHPUNIT) packages/php-ext/generated/tests
	$(CONTRACTS_ENV) $(PHP) -d extension=$(CARGO_TARGET)/debug/libpolyspec_php_serialization.$(CDYLIB) $(PHPUNIT) packages/php-ext/tests

# The static library with the test features (binding GN-13b), which Go links through CGO_LDFLAGS; gofmt and go vet,
# then the generated tests and the contract cases of packages/go/tests on go test. go test builds with the tag
# polyspec_<library>_<feature> of each test feature of the crate (binding GN-13e), the library php-serialization of the
# contract in snake_case, so the tests that arm faults (polyspec_php_serialization_fault_test) run with the others.
# GOTOOLCHAIN=local: a go of another release than the go directive fails instead of fetching that release.
GO_RELEASE := $(shell sed -n 's/^go \(.*\)$$/\1/p' packages/go/go.mod)
GO_TAG_PREFIX := polyspec_$(subst -,_,$(patsubst polyspec-%,%,$(CORE)))_
GO_TAGS = $(subst $(space),$(comma),$(addprefix $(GO_TAG_PREFIX),$(subst -,_,$(subst $(comma),$(space),$(GO_FEATURES)))))
GO_ENV = GOTOOLCHAIN=local CGO_LDFLAGS=-L$(CARGO_TARGET)/debug GOFLAGS=-tags=$(GO_TAGS)
test-go: bindings-go ## Build the static library of the Go binding, run gofmt and go vet, then the generated tests and the contract cases on go test; offline
	test "$$($(GO_ENV) $(GO) env GOVERSION)" = "go$(GO_RELEASE)"
	$(CARGO) build --locked --offline -p $(CORE)-go --features $(GO_FEATURES)
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
	$(CARGO) build -p $(CORE) --locked --offline --release --example probe
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
# Each job of .github/workflows/ci.yml and assets.yml runs one recipe ci-<job>, with the values of its matrix and of the
# inputs of assets.yml as make variables, so that a local run is the call that CI makes: make ci-<job> NAME=value. A recipe
# runs the installs and the prerequisites of its job first, which stop at a failure, then the checks or the builds of the
# job with ci-targets past failures into CI_REPORT; its status is that of the checks. The other steps of a job only provision
# the runner (checkout, setup-php, the bootstrap action) or carry a result (upload-artifact).
ci-shared: ## The job shared: install alint, PHP and Python, then run CI_SHARED past failures into CI_REPORT; ONLINE
	$(MAKE) --no-print-directory install-tools TOOLS="alint php python"
	$(NODE) $(KIT)/ci-targets.mjs -k $(CI_REPORT) $(CI_SHARED)

ci-passed: ## Fail unless every job of RESULTS, the JSON of toJSON(needs), has the result success; FAIL_SKIPPED=1 fails a skipped job
	$(NODE) $(KIT)/ci-passed.mjs

ci-fuzz: ## The job fuzz: install PHP, Python, uv, the Python package and the Rust toolchain, then run CI_FUZZ past failures; ONLINE
	$(MAKE) --no-print-directory install-tools TOOLS="php python uv"
	$(MAKE) --no-print-directory php-serialization-install-python
	$(MAKE) --no-print-directory php-serialization-install-rust
	$(NODE) $(KIT)/ci-targets.mjs -k $(CI_REPORT) $(CI_FUZZ)

ci-ts: ## The job ts: build the JavaScript package, then run CI_TS past failures into CI_REPORT
	$(MAKE) --no-print-directory build-js
	$(NODE) $(KIT)/ci-targets.mjs -k $(CI_REPORT) $(CI_TS)

ci-python: ## The job python: install the Python tools and the package and build it, then run CI_PYTHON past failures; ONLINE
	$(MAKE) --no-print-directory install-tools TOOLS="python uv ruff vulture"
	$(MAKE) --no-print-directory php-serialization-install-python
	$(MAKE) --no-print-directory build-python
	$(NODE) $(KIT)/ci-targets.mjs -k $(CI_REPORT) $(CI_PYTHON)

ci-rust: ## The job rust: install the Rust toolchain and the locked crates, then run CI_RUST past failures; ONLINE
	$(MAKE) --no-print-directory php-serialization-install-rust
	$(NODE) $(KIT)/ci-targets.mjs -k $(CI_REPORT) $(CI_RUST)

ci-bindings: ## The job bindings: install every tool, the Rust toolchain and PHPUnit, then run CI_BINDINGS past failures; ONLINE
	$(MAKE) --no-print-directory install-tools
	$(MAKE) --no-print-directory php-serialization-install-rust
	$(MAKE) --no-print-directory install-php-tools
	$(NODE) $(KIT)/ci-targets.mjs -k $(CI_REPORT) $(CI_BINDINGS)

# The jobs of assets.yml. Each writes the release recipes, and with RELEASE=true, the input release of assets.yml that the
# workflow release passes, runs the release check of binding before it builds.
release_check = $(if $(filter true,$(RELEASE)),$(MAKE) --no-print-directory release-binding-check)

ci-assets-platform: ## The job platform of assets.yml: the Go static library, the wheel and the npm platform package of this host; RELEASE=true; ONLINE
	$(MAKE) --no-print-directory php-serialization-install-rust
	$(MAKE) --no-print-directory install-tools TOOLS="uv python"
	$(MAKE) --no-print-directory release-recipes
	$(release_check)
	$(NODE) $(KIT)/ci-targets.mjs -k $(CI_REPORT) release-go-static release-wheel release-npm-platform

# The job php provisions the LLVM of config/toolchain.json before ci-assets-php (binding GN-19i): the ubuntu-26.04 images
# hold it at /usr/lib/llvm-<major>, the default LLVM_ROOT of packages/release.mk, and on macOS install-llvm-action installs
# it and sets LLVM_PATH, which the build takes as LLVM_ROOT. The action also appends DYLD_LIBRARY_PATH and LD_LIBRARY_PATH
# with /usr/lib first, which make the PHP of the job load the system libsqlite3 and abort, so the recipe empties both.
ci-assets-php: DYLD_LIBRARY_PATH :=
ci-assets-php: LD_LIBRARY_PATH :=
ci-assets-php: ## The job php of assets.yml: the PHP extension for the PHP on PATH, whose minor is EXPECTED_PHP_MINOR; RELEASE=true; ONLINE
	@test -n "$(EXPECTED_PHP_MINOR)" || { echo 'ci-assets-php needs EXPECTED_PHP_MINOR, the PHP minor of the job, for example make ci-assets-php EXPECTED_PHP_MINOR=8.4' >&2; exit 2; }
	$(MAKE) --no-print-directory php-serialization-install-rust
	$(MAKE) --no-print-directory release-recipes
	$(release_check)
	$(MAKE) --no-print-directory release-php-ext PHP=php EXPECTED_PHP_MINOR=$(EXPECTED_PHP_MINOR) $(if $(LLVM_PATH),LLVM_ROOT=$(LLVM_PATH))

ci-assets-npm: ## The job npm of assets.yml: pack the npm package with the wasm-bindgen of mise.toml; RELEASE=true; ONLINE
	$(MAKE) --no-print-directory php-serialization-install-rust
	$(MAKE) --no-print-directory release-recipes
	$(MAKE) --no-print-directory install-wasm-bindgen
	$(release_check)
	$(MAKE) --no-print-directory release-npm

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

# A version and a pin of binding (T2.40): scripts/release-manifests.mts writes the value that each manifest means and reads
# it back as data, cargo and npm write the locks, and then the checks and the tests of the jobs shared, rust and bindings of
# CI run past failures, so that the commit that follows is one that CI passes. Neither target commits.
RELEASE_CHECKS = $(CI_SHARED) $(CI_RUST) $(CI_BINDINGS)
release-version: ## Write VERSION into the versioned manifests, the locks and the changelogs, then run the checks of CI; offline
	@test -n "$(VERSION)" || { echo "release-version: VERSION is required, for example make release-version VERSION=0.0.14"; exit 1; }
	PYTHON="$$($(MISE) which python3)" $(NODE) scripts/release-manifests.mts version $(VERSION)
	$(CARGO) update --workspace --offline
	$(NPM) install --package-lock-only --ignore-scripts
	$(NODE) scripts/release-manifests.mts changelog $(VERSION)
	$(MAKE) --no-print-directory documents-stamp PATHS=CHANGELOG.ko.md
	$(NODE) $(KIT)/ci-targets.mjs -k $(CI_REPORT) $(RELEASE_CHECKS)

binding-pin: ## Pin the binding of BINDING_TAG in the manifests and the locks, install it, then run the checks of CI; ONLINE
	@test -n "$(BINDING_TAG)" || { echo "binding-pin: BINDING_TAG is required, for example make binding-pin BINDING_TAG=v0.0.15"; exit 1; }
	$(NODE) scripts/release-manifests.mts binding $(BINDING_TAG)
	$(ONLINE) $(CARGO) update -p polyspec-binding-core
	$(ONLINE) $(NPM) install --package-lock-only --ignore-scripts
	$(MAKE) --no-print-directory install-packages
	$(NODE) $(KIT)/ci-targets.mjs -k $(CI_REPORT) $(RELEASE_CHECKS)

cargo-link-test: ## Fail while a recipe runs cargo or maturin without the cargo of kit's link (T2.41); offline
	$(NODE) $(KIT)/run-tests.mjs node -- --test-concurrency=1 scripts/cargo-link.test.mts

release-manifests-test: ## Run the test of the writer of the release values; offline
	$(NODE) $(KIT)/run-tests.mjs node -- --test-concurrency=1 scripts/release-manifests.test.mts

# ---- The per-platform assets of the bindings (binding GN-19 to GN-19i) ------------------------------------------------------
# binding writes the release recipes of the contract into packages/release.mk (binding release-recipes, GN-19h), which is
# generated and not tracked, so that every repository runs the same recipes of the binding that it pins and keeps no copy
# (CK-94): release-go-static, release-wheel, release-php-ext, release-npm-platform, release-npm, release-go-module,
# release-binding-check, release-platform-assets and install-wasm-bindgen. The recipes read the variables below,
# which the Makefile defines before it includes the file. The include is optional, because a checkout holds no file until
# make release-recipes writes it, and a run of a recipe of the file without it fails with no rule of the target.
BINDING_RUN := $(BINDING)
BINDING_DEP :=
RELEASE_ASSETS ?= var/release/assets
release-recipes: ## Write packages/release.mk, the release recipes of the contract, with the binding of package.json; offline
	$(BINDING) release-recipes --root $(CURDIR)

-include packages/release.mk

# release-tag-output gives the later jobs of the release workflow the tag and the version that release-tag wrote into the
# environment of its job (TAG, VERSION), through the outputs of the step (GITHUB_OUTPUT); both are empty when the run
# releases nothing.
release-tag-output: ## Write TAG and VERSION into GITHUB_OUTPUT for the later jobs of the release workflow
	@test -n "$$GITHUB_OUTPUT" || { echo 'release-tag-output: GITHUB_OUTPUT is not set; run it in the release workflow' >&2; exit 2; }
	printf 'tag=%s\nversion=%s\n' "$$TAG" "$$VERSION" >> "$$GITHUB_OUTPUT"

# The jobs of release.yml, each one recipe that its one run step runs (T2.23). ci-release-tag tags the commit of the CI run
# RUN and gives the later jobs the TAG and VERSION that release-tag appended to GITHUB_ENV, which a later line of the same
# step does not receive in its environment. ci-release-release builds and publishes the release of TAG: the tools of
# release-tools join PATH for its later lines (RELEASE_PATH, in the order that release-tools-path gives them), the
# artifacts of the job assets, which the workflow downloads into var/release/downloaded before this step, join
# var/release/assets with their folders (go, npm, php-ext, wheel, which release-platform-assets reads) after release-assets, and the commit of the Go module carries the identity of GITHUB_ACTOR, the
# actor of the run.
RELEASE_PATH = PATH="$(VAR_TOOLS)/bin:$(VAR_TOOLS)/mise/shims:$$PATH"
RELEASE_IDENTITY = GIT_AUTHOR_NAME="$${GITHUB_ACTOR:?}" GIT_AUTHOR_EMAIL="$${GITHUB_ACTOR:?}@users.noreply.github.com" \
	GIT_COMMITTER_NAME="$${GITHUB_ACTOR:?}" GIT_COMMITTER_EMAIL="$${GITHUB_ACTOR:?}@users.noreply.github.com"
ci-release-tag: ## The job tag of release.yml: tag the commit of the CI run RUN, then write TAG and VERSION into GITHUB_OUTPUT; AUTO for workflow_run
	@test -n "$$GITHUB_ENV" || { echo 'ci-release-tag: GITHUB_ENV is not set; run it in the release workflow' >&2; exit 2; }
	$(MAKE) --no-print-directory release-tag
	$(MAKE) --no-print-directory release-tag-output TAG="$$(sed -n 's/^TAG=//p' "$$GITHUB_ENV" | tail -n 1)" VERSION="$$(sed -n 's/^VERSION=//p' "$$GITHUB_ENV" | tail -n 1)"

ci-release-release: ## The job release of release.yml: build, carry and publish the release of TAG with the downloaded platform assets; ONLINE
	@test -n "$(TAG)" || { echo 'ci-release-release: TAG is required, for example make ci-release-release TAG=v0.0.1' >&2; exit 2; }
	$(MAKE) --no-print-directory release-zip
	$(MAKE) --no-print-directory release-tools
	$(RELEASE_PATH) $(MAKE) --no-print-directory release-assets
	mkdir -p var/release/assets && cp -R var/release/downloaded/. var/release/assets/
	$(RELEASE_PATH) $(MAKE) --no-print-directory php-serialization-install-rust
	$(RELEASE_PATH) $(MAKE) --no-print-directory install-tools TOOLS=go
	$(RELEASE_PATH) $(MAKE) --no-print-directory release-recipes
	$(RELEASE_IDENTITY) $(RELEASE_PATH) $(MAKE) --no-print-directory release-go-module
	$(RELEASE_PATH) $(MAKE) --no-print-directory release-publish
	$(RELEASE_PATH) $(MAKE) --no-print-directory release-platform-assets
	$(RELEASE_PATH) $(MAKE) --no-print-directory release-undraft
