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
CI_SHARED := layout-check docs-check rules-check owner-validate rebuild-check language-check duplication-check suppression-check link-check release-coverage typecheck contracts-check
CI_FUZZ := fuzz
CI_TS := lint-ts test-js
CI_PYTHON := lint-python test-python
CI_RUST := lint-rust test-rust bindings-check
CI_REPORT ?= var/report/ci-targets

.PHONY: install install-tools install-packages toolchain-lock php-serialization-install-python link unlink link-check \
	php-serialization-install-rust build build-js build-python build-rust test test-js test-python test-rust lint lint-ts lint-python lint-rust typecheck bindings bindings-check \
	contracts contracts-check fuzz fuzz-temp-test \
	layout-check docs-check rules-check owner-check owner-validate rebuild-check language-check \
	duplication-check suppression-check \
	check ci-shared ci-fuzz ci-ts ci-python ci-rust \
	plan-new plan-split item-new item-edit item-state item-test commit documents-stamp text-absent hooks twin-merge \
	worktree-setup land \
	release-tag release-tools release-tools-path release-assets release-publish release-undraft release-coverage

# ---- Install ----------------------------------------------------------------------------------------------------------------
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

# php-serialization-install-rust installs the toolchain of rust-toolchain.toml with rustup and fetches the crates of the root
# Cargo.lock, so that every Rust recipe runs with --locked and offline.
php-serialization-install-rust: ## Install the Rust toolchain of rust-toolchain.toml and fetch the locked crates; ONLINE
	$(ONLINE) rustup toolchain install --no-self-update
	$(ONLINE) cargo fetch --locked

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

bindings: ## Write the generated sources of packages/{php-ext,python,ts}/generated, which are not tracked, with binding; offline
	$(BINDING) generate --root .

bindings-check: ## Check the interface contract and that the binding packages are what binding scaffold writes; offline
	$(BINDING) check packages/rust/interface.json

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

ci-fuzz: ## Run the targets of the fuzz CI job past failures into CI_REPORT
	$(NODE) $(KIT)/ci-targets.mjs -k $(CI_REPORT) $(CI_FUZZ)

ci-ts: ## Run the targets of the TypeScript CI job past failures into CI_REPORT
	$(NODE) $(KIT)/ci-targets.mjs -k $(CI_REPORT) $(CI_TS)

ci-python: ## Run the targets of the Python CI job past failures into CI_REPORT
	$(NODE) $(KIT)/ci-targets.mjs -k $(CI_REPORT) $(CI_PYTHON)

ci-rust: ## Run the targets of the Rust CI job past failures into CI_REPORT
	$(NODE) $(KIT)/ci-targets.mjs -k $(CI_REPORT) $(CI_RUST)

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

release-publish: ## Create the GitHub Release of TAG as a draft with its notes and the files of release-assets
	@test -n "$$TAG" || { echo "release-publish: TAG is required, for example make release-publish TAG=v0.0.1"; exit 1; }
	RELEASE_ASSETS=var/release/assets RELEASE_RECORDS=var/release $(NODE) $(KIT)/release.mjs publish "$$TAG"

release-undraft: ## Make the draft release of TAG public
	@test -n "$$TAG" || { echo "release-undraft: TAG is required, for example make release-undraft TAG=v0.0.1"; exit 1; }
	RELEASE_RECORDS=var/release $(NODE) $(KIT)/release.mjs undraft "$$TAG"

release-coverage: ## Require every package file of the checkout to be classified in config/release.json; offline
	$(NODE) $(KIT)/release.mjs coverage
