<!-- doc-id: overview -->
# php-serialization

[한국어](README.ko.md)

The serialize format of PHP for other languages, so that a server in another language reads and writes the data of PHP byte for byte. The packages are ported from the source of PHP, `ext/standard/var.c` and `ext/standard/var_unserializer.re`. PHP is the reference: a difference from PHP is a defect, and the [specification](docs/spec/php-serialize.md) lists the few inputs that are refused on purpose.

| Package | Install name | Import |
| --- | --- | --- |
| [Node.js](legacy/packages/js/README.md) (legacy, not released) | `@polyspec/php-serialize` | `@polyspec/php-serialize` |
| [Python](legacy/packages/python/README.md) (legacy, not released) | `polyspec-php-serialize` | `polyspec.php_serialize` |
| [Rust](packages/rust/README.md) | `polyspec-php-serialization` (crate, not published) | `polyspec_php_serialization` |

The Node.js and Python packages are the legacy packages of the [transition](docs/spec/php-serialize.md#transition): the bindings that bindgen generates into `packages/python`, `packages/ts` and `packages/php-ext` replace them.

<a id="proof"></a>
## Proof

Real PHP writes [`contracts/php-serialize.json`](contracts/php-serialize.json), and CI regenerates it and compares (`make contracts-check`). `make test-rust` runs every entry of the contract against the Rust crate. `make fuzz` corrupts and generates input with a fixed seed, adds the bytes that PHP serializes for random values of PHP, and gives every input to PHP, to the Rust crate and to each package: each must refuse what PHP refuses, read the same value and write back the same bytes.

<a id="license"></a>
## License

BSD-3-Clause, with the copyright notice of PHP kept in [LICENSE](LICENSE).
