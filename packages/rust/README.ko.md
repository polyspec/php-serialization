<!-- doc-id: rust-overview -->
<!-- source-sha256: 57b12508fa1e90a96bf94f7bcedcb0d4c8d5b86967708ab02a318594f75c32a7 -->
# Rust용 php-serialize

[English](README.md)

crate `polyspec-php-serialize`는 형식의 규칙을 가집니다(RQ-011): PHP의 값, unserialize와 serialize를 PHP와 byte 단위로 같게. 다른 런타임의 바인딩은 이 crate의 인터페이스 계약 `interface.json`(crate 패키지에 들어가는 `packages/rust/interface.json`)에서 생성하며 이 crate를 부릅니다.

```rust
use polyspec_php_serialize::{serialize, unserialize};

let value = unserialize(b"a:1:{s:1:\"a\";d:1;}")?;
assert_eq!(serialize(&value)?, b"a:1:{s:1:\"a\";d:1;}");
# Ok::<(), polyspec_php_serialize::Error>(())
```

| PHP | Rust |
| --- | --- |
| null, bool, int, float | `Node::Null`, `Node::Bool`, `Node::Int(i64)`, `Node::Float(f64)` |
| string | `Node::String(Vec<u8>)`: bytes |
| array | `Node::Array(ArrayId)`: 한 위치가 가지는 `Key`와 `Node`의 `PhpArray` |
| `stdClass` | `Node::Object(ObjectId)`: 객체의 모든 위치가 공유하는 `StdClass` |
| reference | 그 참조를 공유하는 각 위치의 `Node::Reference(ReferenceId)` |

`PhpValue`는 최상위 값과 배열, 객체, 참조를 평평한 표에 담으므로 값을 읽고 쓰고 버리는 일이 재귀하지 않습니다([RQ-006](../../docs/spec/php-serialize.ko.md#requirements)). 모든 실패는 `kind()`가 [kind 표](../../docs/spec/php-serialize.ko.md#kinds)의 하나인 `Error`이고, unserialize의 오류는 입력의 `offset()`을 가집니다.
