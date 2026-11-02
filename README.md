<!-- doc-id: overview -->
# php-serialize

[한국어](README.ko.md)

The serialize format of PHP for other languages, so that a server in another language reads and writes the data of PHP byte for byte. The packages are ported from the source of PHP, `ext/standard/var.c` and `ext/standard/var_unserializer.re`. PHP is the reference: a difference from PHP is a defect, and the [specification](docs/spec/php-serialize.md) lists the few inputs that are refused on purpose.

| Package | Install name | Import |
| --- | --- | --- |
| [Node.js](packages/js/README.md) | `@polyspec/php-serialize` | `@polyspec/php-serialize` |
| [Python](packages/python/README.md) | `polyspec-php-serialize` | `polyspec.php_serialize` |

<a id="proof"></a>
## Proof

Real PHP writes [`contracts/php-serialize.json`](contracts/php-serialize.json), and CI regenerates it and compares (`make contracts-check`). `make fuzz` corrupts and generates input with a fixed seed and gives every input to PHP and to each package: each must refuse what PHP refuses, read the same value and write back the same bytes.

<a id="license"></a>
## License

BSD-3-Clause, with the copyright notice of PHP kept in [LICENSE](LICENSE).
