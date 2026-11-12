<!-- doc-id: checklist-rust-core -->
<!-- source-sha256: ad5ac0ad901387754ea8b670154c170986bb61ccf6b4d4ca95a748fdf0715bbf -->
# Rust 코어 체크리스트

| ID | Task | Deliverables | Verification | State |
|---|---|---|---|---|
| T2.1 | 형식을 PHP 값의 자기 타입 위의 Rust crate polyspec-php-serialize로 RQ-010의 kind와 함께 쓰고 contracts/interface.json 초안을 쓴다 | `docs/spec/php-serialize.md`, `contracts/php-serialize.json`, `scripts/contracts.mts`, `scripts/fuzz.mts`, `packages/rust`, `contracts/interface.json` | `make contracts-check`, `make test-rust`, `make lint-rust`, `make fuzz` | [ ] |
