<!-- doc-id: plan-rust-core -->
# Rust core

[한국어](plan.ko.md)

The format has one set of rules but two implementations, one per language, so each rule is written, tested and fixed twice and a third runtime would add a third copy. T2.1 writes the rules once, as the Rust crate `polyspec-php-serialize` in `packages/rust`, over its own value type of PHP (RQ-008) and with an error kind for every failure (RQ-010). Real PHP stays the oracle: the crate passes every case of the contract and the fuzz against PHP. The bindings of each runtime are generated from `contracts/interface.json` and are not part of T2.1; the Node.js and Python packages stay until the bindings replace them (RQ-011).
