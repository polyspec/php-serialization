<!-- doc-id: execution-checklist -->
<!-- source-sha256: 8db123af827aebdd1c3f26617bddf33ca9bad8874adc666ae5d70a750e7f7f1d -->
# 실행 checklist

## Wave 1 — 첫 release

| ID | Task | Deliverables | Verification | State |
| --- | --- | --- | --- | --- |
| T1.1 | PHP serialize 형식을 Node.js와 Python으로 포팅하고 kit으로 repository 구성 | `packages/js`, `packages/python`, `contracts/php-serialize.json`, `scripts/fuzz.mts`, kit 설정 | `make contracts-check`, `make fuzz`, 해당 commit의 CI run | [o] |
| T1.2 | 0.0.1 release | version commit과 release asset | `make release-coverage`와 version commit의 CI run에서 만들어진 release | [o] |
| T1.3 | P1: 강제 종료된 fuzz 실행의 디렉터리가 영구히 남지 않는다. 원인: scripts/fuzz.mts는 약 216 MB의 디렉터리를 finally에서 지우는데, 강제 종료된 process는 이를 실행하지 않으므로 강제 종료마다 임시 디렉터리에 하나씩 남는다. 인수 조건: 디렉터리 이름에 그 실행의 process id가 있고, 실행은 process가 사라진 실행의 디렉터리를 지운다. | scripts/fuzz.mts, scripts/fuzz-temp.mts, scripts/fuzz-temp.test.mts, Makefile, config/owner-checks.json, config/rebuild.json, CHANGELOG.md, CHANGELOG.ko.md | `make fuzz-temp-test` | [o] |
| T1.4 | kit 0.0.98 지원: repository가 자기 recipe를 소유한다(kit docs/spec/utilities-and-recipes.md). 인수 조건: Makefile은 kit의 recipe를 include하지 않고 설치된 kit의 utility를 명시적 인자로 실행한다. kit이 정하던 설정은 각 도구의 native file(.npmrc, mise.toml의 [settings]와 [env], ruff.toml, package의 [tool.vulture], .oxlintrc.json, knip.json)로 옮긴다. kit이 쓰던 사본 중 이 repository가 쓰지 않는 것은 없애고, CI가 쓰는 것은 자기 file로 둔다. CI workflow는 이 Makefile의 target만 실행한다. | Makefile, .npmrc, mise.toml, ruff.toml, .oxlintrc.json, knip.json, packages/python/pyproject.toml, .github/workflows/ci.yml, .github/workflows/release.yml, .github/actions/bootstrap/action.yml, config/layout.kit.yml, config/layout.yml, config/owner-checks.json, config/checklist.json, config/rebuild.json, AGENTS.md, AGENTS.ko.md, CHANGELOG.md, CHANGELOG.ko.md | `make text-absent FILE=Makefile TEXT=kit-bootstrap.mk`, `make rules-check`, `make owner-validate`, `make kit-check`, `make layout-check`, `make lint-ts`, `make lint-python` and the CI run of the commit | [o] |
| T1.5 | 0.0.2 release | The version commit and the release assets | `make release-coverage` and the release of the CI run of the version commit | [ ] |
