<!-- doc-id: checklist-rust-core -->
<!-- source-sha256: e6debc34cd6e0d8c1c05d86076635f8a0137f5fc137fcf5334aac3fc91c4663f -->
# Rust 코어 체크리스트

| ID | Task | Deliverables | Verification | State |
|---|---|---|---|---|
| T2.1 | 형식을 PHP 값의 자기 타입 위의 Rust crate polyspec-php-serialization로 RQ-010의 kind와 함께 쓰고 packages/rust/interface.json 초안을 쓴다 | `docs/spec/php-serialize.md`, `contracts/php-serialize.json`, `scripts/contracts.mts`, `scripts/fuzz.mts`, `packages/rust`, `packages/rust/interface.json` | `make contracts-check`, `make test-rust`, `make lint-rust`, `make fuzz` | [ ] |
| T2.2 | 그 언어의 바인딩이 contract, 패키지 시험, fuzz를 통과하면 `legacy/packages/js`와 `legacy/packages/python`을 각각 그것만의 변경으로 없앤다(계획 V-6 (5)) | `legacy/packages/js`, `legacy/packages/python` | `make fuzz`, `make bindings-check` | [ ] |
| T2.3 | contract case가 담지 않은 legacy 패키지의 시험을 legacy 시험의 기대값으로 바인딩에서 실행한다: legacy/packages/js/tests/api.test.mjs의 만든 값, 거부되는 속성 이름, 표현할 수 없는 값, 큰 record는 Node와 WASM 바인딩에서, legacy/packages/python/tests/test_api.py의 그것은 Python 바인딩에서 실행한다. 거부는 그 category의 class와 kind다(RQ-010). legacy 시험의 group forms, deep, rejected, stricter, cases는 contract case다. binding이 class unit php_float, std_class, reference를 생성하면 실행된다 | `packages/ts/tests/api.mjs`, `packages/ts/tests/api.test.mjs`, `packages/ts/tests/api.wasm.test.mjs`, `packages/python/tests/test_api.py`, `Makefile` | `make test-python-binding`, `make test-node`, `make test-wasm` | [ ] |
| T2.4 | 추적되는 문서는 이 저장소나 다른 저장소의 Git commit을 적지 않는다. `make commit-names-check`는 추적되는 `*.md` 파일에서 숫자와 글자를 가진 16진수 7~40자리 낱말을 실패시키고, 규칙은 `AGENTS.md`에 있으며, 변경 기록의 항목은 commit 이름 없이 사실을 남긴다. Red 먼저 | `scripts/check-commit-names.mts`, `scripts/commit-names.test.mts`, `Makefile`, `AGENTS.md`, `CHANGELOG.md` | `make commit-names-check`, `make commit-names-test` | [ ] |
