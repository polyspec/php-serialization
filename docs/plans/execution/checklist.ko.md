<!-- doc-id: execution-checklist -->
<!-- source-sha256: 98d3e4638b31f6bd5bbf3dd530c94ffbe24fe65043285a2c42b3d4cbbdc29d03 -->
# 실행 checklist

## Wave 1 — 첫 release

| ID | Task | Deliverables | Verification | State |
| --- | --- | --- | --- | --- |
| T1.1 | PHP serialize 형식을 Node.js와 Python으로 포팅하고 kit으로 repository 구성 | `packages/js`, `packages/python`, `contracts/php-serialize.json`, `scripts/fuzz.mts`, kit 설정 | `make contracts-check`, `make fuzz`, 해당 commit의 CI run | [o] |
| T1.2 | 0.0.1 release | version commit과 release asset | `make release-coverage`와 version commit의 CI run에서 만들어진 release | [o] |
| T1.3 | P1: 강제 종료된 fuzz 실행의 디렉터리가 영구히 남지 않는다. 원인: scripts/fuzz.mts는 약 216 MB의 디렉터리를 finally에서 지우는데, 강제 종료된 process는 이를 실행하지 않으므로 강제 종료마다 임시 디렉터리에 하나씩 남는다. 인수 조건: 디렉터리 이름에 그 실행의 process id가 있고, 실행은 process가 사라진 실행의 디렉터리를 지운다. | scripts/fuzz.mts, scripts/fuzz-temp.mts, scripts/fuzz-temp.test.mts, Makefile, config/owner-checks.json, config/rebuild.json, CHANGELOG.md, CHANGELOG.ko.md | `make fuzz-temp-test` | [v] |
