# PYTHON and UV are those of mise.toml, by the absolute paths of their shims: GNU make execs a recipe line without shell
# metacharacters directly, so a bare name would resolve through the PATH that make read at start.
PYTHON := $(CURDIR)/var/tools/mise/shims/python3
UV := $(CURDIR)/var/tools/mise/shims/uv

# The tools of every run are the releases that the tracked declaration files name: npm in devEngines.packageManager of
# package.json, PHP in .php-version, and Node.js, Python and the other tools in mise.toml at the digests of mise.lock.
export PATH := $(CURDIR)/var/tools/bin:$(PATH)
# A check reads no network: make install downloads what the checks read, and every other recipe runs npm offline.
export npm_config_offline := true
ONLINE := env -u npm_config_offline

# Shared targets come from the installed kit package; CI bootstraps the locked package before Make reads this include.
include node_modules/@polyspec/kit/scripts/kit/kit-bootstrap.mk

# The targets of the full suite that make check runs through ci-targets of @polyspec/kit with FINAL_RUN and that the jobs of
# .github/workflows run with make ci-targets (a target is in one job).
CHECK_TARGETS := kit-check suppression-check bypass-check divergence-check link-check rules-check rebuild-check language-check test-markers-check duplication-check layout-check hooks-check owner-validate release-coverage parity-declarations-check docs-check contracts-check fuzz parity-check lint-python typecheck lint-ts test-js test-python

.PHONY: check install php-serialize-install php-serialize-install-python deps-node deps-python contracts contracts-check fuzz typecheck

# check runs the full suite on a clean committed tree: ci-targets with FINAL_RUN=1 refuses any other tree.
check:
	FINAL_RUN=1 $(MAKE) --no-print-directory ci-targets CI_REPORT=var/report/full-run TARGETS="$(CHECK_TARGETS)"

# install makes every download that the checks read after make install-packages.
install: php-serialize-install
php-serialize-install: install-kit php-serialize-install-python

deps-node:
	$(MAKE) --no-print-directory install-packages
deps-python: php-serialize-install-python

# php-serialize-install-python makes packages/python/.venv from the Python of mise.toml and installs the package into it,
# non-editable, since the python extractor of kit reads the file list of the installed distribution; install-link then makes
# the installed package folder a link to the sources of the checkout.
php-serialize-install-python:
	$(MAKE) --no-print-directory python-venv DIR=packages/python/.venv
	$(ONLINE) $(UV) pip install --python packages/python/.venv/bin/python --link-mode copy --no-deps packages/python
	$(MAKE) --no-print-directory install-link

# contracts writes contracts/php-serialize.json from real PHP; contracts-check fails when PHP writes anything else.
contracts:
	$(NODE) scripts/contracts.mts

contracts-check:
	$(NODE) scripts/contracts.mts --check

# fuzz gives corrupted and generated input with a fixed seed to real PHP and to both ports (scripts/fuzz.mts).
fuzz:
	$(NODE) scripts/fuzz.mts

typecheck:
	$(NODE) node_modules/typescript/bin/tsc -p tsconfig.json
