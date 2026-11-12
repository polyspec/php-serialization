<!-- doc-id: overview -->
<!-- source-sha256: 894fab87ba099c62859ea53502e74e6b77279ba5abfd7da8387c4e7986c38b00 -->
# php-serialize

[English](README.md)

다른 언어의 서버가 PHP의 데이터를 byte 단위까지 같게 읽고 쓰도록 하는 PHP serialize 형식 구현입니다. 패키지는 PHP 소스의 `ext/standard/var.c`와 `ext/standard/var_unserializer.re`를 포팅했습니다. 기준은 PHP입니다. PHP와 다르면 결함이며, 일부러 거부하는 소수의 입력은 [명세](docs/spec/php-serialize.ko.md)에 적혀 있습니다.

| 패키지 | 설치 이름 | Import |
| --- | --- | --- |
| [Node.js](legacy/packages/js/README.ko.md) (legacy, 배포하지 않음) | `@polyspec/php-serialize` | `@polyspec/php-serialize` |
| [Python](legacy/packages/python/README.ko.md) (legacy, 배포하지 않음) | `polyspec-php-serialize` | `polyspec.php_serialize` |
| [Rust](packages/rust/README.ko.md) | `polyspec-php-serialize` (crate, 배포하지 않음) | `polyspec_php_serialize` |

Node.js와 Python 패키지는 [이행](docs/spec/php-serialize.ko.md#transition)의 legacy 패키지이며, bindgen이 `packages/python`, `packages/ts`, `packages/php-ext`에 생성하는 바인딩이 그것을 대체합니다.

<a id="proof"></a>
## 검증

실제 PHP가 [`contracts/php-serialize.json`](contracts/php-serialize.json)을 쓰고, CI가 다시 생성해 비교합니다(`make contracts-check`). `make test-rust`는 contract의 모든 항목을 Rust crate에 실행합니다. `make fuzz`는 고정된 seed로 입력을 깨뜨리거나 생성하고 PHP가 무작위 PHP 값에 대해 serialize한 bytes를 더해 PHP, Rust crate, 각 패키지에 똑같이 줍니다. 각 패키지는 PHP가 거부하는 것을 거부하고, 같은 값을 읽고, 같은 bytes를 다시 써야 합니다.

<a id="license"></a>
## 라이선스

BSD-3-Clause이며, PHP의 저작권 고지를 [LICENSE](LICENSE)에 유지합니다.
