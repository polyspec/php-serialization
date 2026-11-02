<!-- doc-id: execution-checklist -->
<!-- source-sha256: e3793f5e1082c46d36ea06fd70f94544c485aa3b02a7bd4334da80a866faacf3 -->
# 실행 checklist

## Wave 1 — 첫 release

| ID | Task | Deliverables | Verification | State |
| --- | --- | --- | --- | --- |
| T1.1 | PHP serialize 형식을 Node.js와 Python으로 포팅하고 kit으로 repository 구성 | `packages/js`, `packages/python`, `contracts/php-serialize.json`, `scripts/fuzz.mts`, kit 설정 | `make contracts-check`, `make fuzz`, 해당 commit의 CI run | [o] |
| T1.2 | 0.0.1 release | version commit과 release asset | `make release-coverage`와 version commit의 CI run에서 만들어진 release | [o] |
