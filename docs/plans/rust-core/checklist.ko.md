<!-- doc-id: checklist-rust-core -->
<!-- source-sha256: 2e5038e1f2a9726aa18217d6b52e309df16ff5cbdf3b81e77e1f5d4ff59186be -->
# Rust 코어 체크리스트

| ID | Task | Deliverables | Verification | State |
|---|---|---|---|---|
| T2.1 | 형식을 PHP 값의 자기 타입 위의 Rust crate polyspec-php-serialization로 RQ-010의 kind와 함께 쓰고 packages/rust/interface.json 초안을 쓴다 | `docs/spec/php-serialize.md`, `contracts/php-serialize.json`, `scripts/contracts.mts`, `scripts/fuzz.mts`, `packages/rust`, `packages/rust/interface.json` | `make contracts-check`, `make test-rust`, `make lint-rust`, `make fuzz` | [ ] |
| T2.2 | 그 언어의 바인딩이 contract, 패키지 시험, fuzz를 통과하면 `legacy/packages/js`와 `legacy/packages/python`을 각각 그것만의 변경으로 없앤다(계획 V-6 (5)) | `legacy/packages/js`, `legacy/packages/python` | `make fuzz`, `make bindings-check` | [ ] |
