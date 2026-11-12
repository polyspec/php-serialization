<!-- doc-id: changelog -->
# Changelog

[한국어](CHANGELOG.ko.md)

<a id="unreleased"></a>
## Unreleased

- The specification defines the value of the format (RQ-008), refuses a property name that starts with U+0000 when it reads and when a value is built (RQ-009), names the kind and the offset of every failure (RQ-010) and places the rules in the Rust crate `polyspec-php-serialize`, with the differences of the Node.js and Python packages judged (RQ-011) (T2.1).
- The contract names the kind of every refusal in `raises`, holds property names that start with U+0000 in `stricter` and the new group `refused_values`, and the Node.js and Python packages refuse such a name when they read and when they write (RQ-009) (T2.1).
- The Rust crate `polyspec-php-serialize` in `packages/rust` reads and writes the format over its own value of PHP with the kinds of RQ-010 and passes the contract (`make test-rust`, `make lint-rust`); `make fuzz` gives its input and the bytes of random values of PHP to the crate too, and CI runs a Rust job (T2.1).
- `contracts/interface.json` drafts the interface contract of the bindings: the functions, the error class with its offset, the value table of `php_value` and the changes from the Node.js and Python packages; the parts that its format cannot state yet are marked `todo` (T2.1).
- The interface contract moves to `packages/rust/interface.json` and into the `include` of the crate, so that a library that takes or gives a `php_value` reads the value table from the package that Cargo resolved. It follows the schema of bindgen: the category error classes are `PhpSerialize<Category>Error` in every language (`PhpSerializeValueError` and so on), and `php_value` is an alias whose value table makes a PHP array a map with int and bytes keys, keeps `stdClass` and references as PHP objects and references, and reads the built-in types of each language itself. The parts that the format or the core cannot state yet stay `todo` (T2.1).

## 0.0.6

- The repository adopts kit 0.0.105, which removed the time limits of run-tests (kit K1175), and passes no `--timeout` to run-tests (T1.14).

## 0.0.5

- The repository adopts kit 0.0.103, which keeps the output, errors and failures that kit used to drop silently (kit K1136–K1165) (T1.12).

## 0.0.4

- The repository runs kit 0.0.102, whose uv-install puts back the provider links when its install fails (T1.10, T1.11).
- php-serialize adopts kit 0.0.102, whose uv-install puts back the provider links when its install fails; no recipe line changes (T1.10).

## 0.0.3

- The repository runs kit 0.0.101 without parity: config/parity.json and its targets are gone with kit 0.0.100 (T1.7, T1.8).
- The repository runs kit 0.0.99 and passes it every value that kit 0.0.98 fixed, so each target runs the same commands and tests; make kit-check is gone with kit 0.0.99 (T1.6).

## 0.0.2

- The Makefile holds the recipes of the repository and runs the utilities of the installed kit; the settings of npm, mise, uv, ruff, vulture, oxlint and knip live in their own files, and the copies that kit wrote are the repository's own files or gone (T1.4).
- A fuzz run removes the directories of the runs whose process is gone, so a killed run no longer leaves about 216 MB in the temporary directory for good (T1.3).

## 0.0.1

- php-serialize 0.0.1 is the first release: the serialize format of PHP for Node.js and Python (T1.2).
- T1.1: the serialize format of PHP for Node.js and Python, ported from php-src, with a contract that real PHP writes and a fuzz with PHP as the reference (T1.1).
