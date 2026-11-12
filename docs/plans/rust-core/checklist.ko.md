<!-- doc-id: checklist-rust-core -->
<!-- source-sha256: d74a1b374faa286c587d38d9c9e06b7a0ce11c4c00332f0ff83998fa0e0789cc -->
# Rust 코어 체크리스트

| ID | Task | Deliverables | Verification | State |
|---|---|---|---|---|
| T2.1 | 형식을 PHP 값의 자기 타입 위의 Rust crate polyspec-php-serialize로 RQ-010의 kind와 함께 쓰고 packages/rust/interface.json 초안을 쓴다 | `docs/spec/php-serialize.md`, `contracts/php-serialize.json`, `scripts/contracts.mts`, `scripts/fuzz.mts`, `packages/rust`, `packages/rust/interface.json` | `make contracts-check`, `make test-rust`, `make lint-rust`, `make fuzz` | [ ] |
