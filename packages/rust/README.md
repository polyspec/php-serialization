<!-- doc-id: rust-overview -->
# php-serialize for Rust

[한국어](README.ko.md)

The crate `polyspec-php-serialize` holds the rules of the format (RQ-011): the value of PHP, unserialize and serialize, byte for byte as PHP. The bindings of the other runtimes are generated from the interface contract `interface.json` of this crate (`packages/rust/interface.json`, in the crate package) and call this crate.

```rust
use polyspec_php_serialize::{serialize, unserialize};

let value = unserialize(b"a:1:{s:1:\"a\";d:1;}")?;
assert_eq!(serialize(&value)?, b"a:1:{s:1:\"a\";d:1;}");
# Ok::<(), polyspec_php_serialize::Error>(())
```

| PHP | Rust |
| --- | --- |
| null, bool, int, float | `Node::Null`, `Node::Bool`, `Node::Int(i64)`, `Node::Float(f64)` |
| string | `Node::String(Vec<u8>)`: the bytes |
| array | `Node::Array(ArrayId)`, a `PhpArray` of `Key` and `Node`, which one position holds |
| `stdClass` | `Node::Object(ObjectId)`, a `StdClass` that every position of the object shares |
| reference | `Node::Reference(ReferenceId)` at each position that shares it |

A `PhpValue` holds its top value and its arrays, objects and references in flat tables, so neither reading, writing nor dropping a value recurses ([RQ-006](../../docs/spec/php-serialize.md#requirements)). Every failure is an `Error` whose `kind()` is one of [the table of kinds](../../docs/spec/php-serialize.md#kinds); an error of unserialize has its `offset()` in the input. `PhpFloat` holds a float for the binding of a language whose number does not tell a float whose value is an integer from the integer (RQ-008). `DEPTH_LIMIT` is a `u64`. `from_host` reads a value of a language that a binding describes as `HostValue`s and answers for through `HostValues` (RQ-012).
