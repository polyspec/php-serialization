<!-- doc-id: checklist-rust-core -->
# Rust core checklist

| ID | Task | Deliverables | Verification | State |
|---|---|---|---|---|
| T2.1 | Write the format as the Rust crate polyspec-php-serialize over its own value type of PHP, with the kinds of RQ-010, and draft packages/rust/interface.json | `docs/spec/php-serialize.md`, `contracts/php-serialize.json`, `scripts/contracts.mts`, `scripts/fuzz.mts`, `packages/rust`, `packages/rust/interface.json` | `make contracts-check`, `make test-rust`, `make lint-rust`, `make fuzz` | [ ] |
| T2.2 | Remove `legacy/packages/js` and `legacy/packages/python`, each by a change of its own, once the binding of its language passes the contract, the package tests and the fuzz (plan V-6 (5)) | `legacy/packages/js`, `legacy/packages/python` | `make fuzz`, `make bindings-check` | [ ] |
