<!-- doc-id: php-serialize-contract -->
<!-- source-sha256: da8d74b748eff144c69a883253d46dcce9b5d4156c9417de48365345250599c6 -->
# PHP serialize 계약

[English](php-serialize.md)

이 명세는 모든 패키지의 동작을 정의합니다. 실행 케이스는 [`contracts/php-serialize.json`](../../contracts/php-serialize.json)에 있으며, 실제 PHP가 `serialize_precision=-1`과 `unserialize_max_depth=4096`으로 씁니다. `cases`, `forms`, `deep`은 PHP가 읽는 bytes와 그 값의 typed tree를, `rejected`는 PHP가 거부하는 bytes를, `stricter`는 PHP는 읽지만 모든 패키지가 거부하는 bytes를([일부러 거부하는 입력](#refused)), `refused_values`는 PHP는 담지만 이 형식의 값이 거부하는 값(RQ-008, RQ-009)을 PHP가 그 값에 대해 쓰는 bytes와 함께 담습니다. `rejected`, `stricter`, `refused_values`의 각 항목은 `raises`에 오류를 적습니다(RQ-010).

<a id="requirements"></a>
## 요구사항

- **RQ-001**: PHP가 받는 bytes를 unserialize한 결과를 serialize하면 PHP가 그 값에 대해 쓰는 bytes와 같습니다.
- **RQ-002**: float는 정확한 값과 종류를 유지합니다. `d:1;`은 `i:1;`과 구분되는 float로 남고, `-0`, `INF`, `-INF`, `NAN`도 그대로 유지됩니다. 문자열 표현은 `php_gcvt` 배치의 최단 자릿수입니다.
- **RQ-003**: 문자열은 입력의 bytes입니다. UTF-8이 아닌 bytes는 값과 key 모두에서 bytes로 남습니다. 언어가 변경 없이 encode할 수 없는 문자열은 거부하며 치환하지 않습니다.
- **RQ-004**: 배열 key는 PHP를 따릅니다. 64-bit 정수의 정규형 문자열은 그 정수이고, 반복되는 key는 첫 위치를 유지하고 마지막 값을 가집니다. 속성 이름은 항상 문자열입니다.
- **RQ-005**: slot은 `php_var_unserialize`처럼 위치를 가리킵니다. `R:`과 `r:`은 PHP의 slot 번호를 따르고, `R:`은 위치 사이에 값을 공유하며, `r:`은 객체만 가리킵니다. 위치 하나만 잡고 있는 참조는 일반 값입니다.
- **RQ-006**: PHP가 거부하는 모든 입력을 거부합니다. depth 제한은 PHP와 같은 4096이며 언어의 stack 제한을 바꿀 필요가 없습니다. 양방향 모두 재귀하지 않습니다.
- **RQ-007**: 입력과 값은 크기로 제한됩니다. 남은 bytes보다 큰 count는 할당 전에 거부하고, 제한보다 깊거나 참조 없이 자신을 담은 값은 그 bytes를 하나도 돌려주기 전에 거부합니다.
- **RQ-008**: 형식의 값은 PHP의 값이며 그 밖의 것이 아닙니다: null, boolean, 64-bit 정수, 64-bit float(`-0`, `INF`, `-INF`, `NAN` 포함), bytes의 문자열, 배열, `stdClass` 객체, 참조.
  - 배열은 key가 정수와 bytes 문자열인 순서 있는 map입니다. 64-bit 정수의 정규형인 문자열 key를 설정하면 그 정수를 설정하고(RQ-004), 배열이 가진 key를 설정하면 PHP의 대입처럼 그 위치의 값을 바꿉니다. 배열은 값이므로 한 위치가 가집니다. 다른 위치가 가진 배열을 또 다른 위치에 두는 것은 값을 만들 때 거부합니다.
  - `stdClass` 객체는 정체성을 가집니다. 한 객체를 가진 위치들은 같은 객체를 가지며, serialize는 첫 위치 뒤에서 그 객체를 `r:`로 씁니다. 속성은 bytes 이름에서 값으로 가는 순서 있는 map이며, 입력의 정수 key는 그 십진 숫자의 이름입니다(RQ-004).
  - 참조도 정체성을 가집니다. 한 참조를 가진 위치들은 그 값을 공유하며, serialize는 첫 위치 뒤에서 그 참조를 `R:`로 씁니다. PHP에서 `serialize`의 인자와 `unserialize`의 결과는 값이므로, 참조는 참조를 담지 않고 최상위 값은 참조가 아닙니다. 둘 다 값을 만들 때 거부합니다.
  - 언어에서 값의 형태(bytes가 UTF-8인 문자열은 텍스트, key가 0부터 n-1인 배열은 list, 언어가 정수와 구별하지 못하는 정수 값 float는 자기 class)는 `packages/rust/interface.json`의 값 표가 정하며, 바인딩이 내보내는 모든 형태는 다시 읽으면 같은 값입니다. 다른 값 모델(JSON, 템플릿 데이터 모델)로의 변환은 이 형식의 규칙이 아니며, 변환을 가진 라이브러리가 정합니다.
- **RQ-009**: U+0000으로 시작하는 속성 이름은 거부합니다. unserialize는 그 bytes를 거부하며 반복된 key가 나중에 그 객체를 덮어써도 거부하고, 값은 그 이름을 만들 때 거부하므로 serialize는 그 이름을 쓰지 않습니다. PHP는 그런 이름을 모두 경고 없이 `stdClass` 객체로 읽습니다: `\0Class\0name`과 `\0*\0name` 형태는 `stdClass`가 선언하지 않는 private 또는 protected 속성이 되고, 다른 형태(`\0a`, `\0`)는 `foreach`와 `print_r`가 notice `Illegal member variable name`으로 알리는 속성이 됩니다. 두 경우 모두 객체 밖의 코드는 이름으로 읽지 못하며(`Cannot access property starting with "\0"`), `json_encode`는 그 속성을 버리고, 다른 언어에는 `stdClass`의 private·protected 속성이 없습니다. 다른 byte로 시작하는 이름은 빈 이름을 포함해 읽고 씁니다.
- **RQ-010**: 모든 실패는 [kind 표](#kinds)의 kind를 가진 오류이며 HTTP 상태가 없습니다. 모든 kind의 category는 `value`이고, `internal`만 category `internal`입니다. unserialize의 오류는 입력의 0부터 센 byte 위치 offset을 가집니다: 문법을 깨는 첫 byte(입력이 일찍 끝나면 입력의 길이), 남은 bytes보다 큰 length나 count의 첫 숫자(RQ-007), 추가 bytes는 값 뒤의 첫 byte, 통째로 거부하는 token(너무 깊은 값, 참조, class, 정수, key)은 그 token의 첫 byte입니다. 메시지는 규칙이 아니며, 호출자는 kind로 실패를 구별합니다.
- **RQ-011**: 규칙은 구현 하나, `packages/rust`의 Rust crate `polyspec-php-serialize`에 있습니다. 런타임의 바인딩은 `packages/rust/interface.json`에서 생성하며 규칙을 갖지 않습니다. crate 패키지가 그 계약을 담으므로, `php_value`를 받거나 내는 라이브러리는 Cargo가 해석한 패키지에서 값 표를 읽습니다. Node.js와 Python 패키지는 생성된 바인딩이 contract, 패키지 시험, fuzz를 통과할 때까지 남으며, 그때까지 [차이 표](#differences)가 crate와 다르게 동작하는 곳을 적습니다.
- **RQ-012**: 언어의 값은 crate의 `from_host`로 들어옵니다. 바인딩은 값을 한 단계씩 설명하고(bindgen의 `HostValue`) handle의 자식에 대한 crate의 질문에 답하며(bindgen의 `HostValues`), 값을 스스로 판정하지 않습니다. null, boolean, 정수는 그대로이고, 64-bit 밖의 정수(Python `int`)는 `int_range`로 거부합니다. 정수 타입과 따로 float 타입을 가진 언어(PHP, Python)의 float는 float입니다. 바인딩이 타입 없는 수로 설명하는 JavaScript의 number는 안전 정수이고 `-0`이 아니면 정수, 그 밖에는 float이며, 그래서 값이 정수인 PHP float는 JavaScript에 값과 관계없이 float인 `PhpFloat`로 갑니다. 텍스트는 그 UTF-8이고 bytes는 bytes이며, 짝 없는 surrogate를 가진 텍스트는 `invalid_text`로 거부합니다(RQ-003). list는 key가 0부터 n-1인 배열이고, map과 PHP 배열은 key가 정수나 문자열인 배열입니다. 정수의 정규형인 문자열은 그 정수이고(RQ-004) 정수인 JavaScript number도 그 정수이며, 다른 key는 `unsupported_value`로 거부합니다. 배열은 값이므로 두 위치의 list나 map은 배열 둘이 되고, 자기를 담는 것은 `unsupported_value`로 거부합니다. `stdClass` 객체(PHP `stdClass`나 바인딩의 `StdClass`)는 모든 위치에서 한 객체이며 속성보다 먼저 만들어지므로 자기를 담을 수 있고, 속성 이름은 문자열입니다(RQ-009). PHP 참조와 바인딩의 `Reference`는 정체성 하나에 참조 하나이고 첫 위치의 값을 가집니다. 참조를 담는 참조와 최상위 값인 참조는 거부합니다(RQ-008). 그 밖의 언어 값(JavaScript `undefined`, plain object, `Date`, 함수, 다른 class의 instance)은 `unsupported_value`로 거부합니다. 순회는 자기 stack을 쓰고 RQ-006의 깊이 제한을 지킵니다. 언어가 답하다 던진 예외는 바뀌지 않고 호출자에게 갑니다. 바인딩의 `StdClass`와 `Reference` 생성자는 받는 것을 같은 규칙으로 판정하고, 그 객체는 받은 것을 그대로 가집니다.

<a id="refused"></a>
## 일부러 거부하는 입력

PHP는 읽지만 모든 패키지가 거부합니다. contract의 `stricter` 항목이 이 입력을 담습니다.

| 입력 | Kind | 이유 |
| --- | --- | --- |
| 값 뒤의 추가 bytes | `trailing_data` | 손상된 레코드를 뜻하며 PHP는 경고만 합니다 |
| `stdClass` 외 class의 객체, `C:`, `E:` | `class` | 다른 언어는 그 class를 가질 수 없습니다 |
| 64-bit 밖의 정수 | `int_range` | PHP가 값을 바꿉니다 |
| 최상위 배열을 가리키는 `R:` | `top_array_reference` | PHP의 serialize는 이것을 쓰지 않으며, PHP가 다시 쓰는 결과도 이 bytes가 아닙니다. 배열을 펼치거나 그 자리에 null을 넣습니다 |
| U+0000으로 시작하는 속성 이름 | `property_name` | PHP는 경고 없이 `stdClass`의 private·protected 속성이나 `foreach`의 notice만 이름을 알리는 속성으로 읽습니다. 객체 밖의 코드는 읽지 못하고 다른 언어는 담지 못합니다(RQ-009) |

<a id="kinds"></a>
## 오류 kind

| Kind | 실패 | 규칙 |
| --- | --- | --- |
| `syntax` | bytes가 형식의 문법을 깨거나, length나 count가 남은 bytes보다 크거나, 입력이 일찍 끝남 | RQ-006, RQ-007 |
| `depth` | 입력이나 쓸 값에서 값이 4096보다 깊음 | RQ-006, RQ-007 |
| `reference` | `R:`이나 `r:`이 slot을 가리키지 않거나, `R:`이 자기 위치를 가리키거나, `r:`이 객체를 가리키지 않음 | RQ-005 |
| `int_range` | 입력이나 언어 값의 정수가 64-bit 밖임 | [일부러 거부](#refused), RQ-012 |
| `trailing_data` | 값 뒤에 bytes가 있음 | [일부러 거부](#refused) |
| `class` | `stdClass` 외 class의 객체, 또는 `C:`, `E:` | [일부러 거부](#refused) |
| `top_array_reference` | `R:`이 최상위 배열을 가리킴 | [일부러 거부](#refused) |
| `property_name` | 입력이나 만드는 값에서 속성 이름이 U+0000으로 시작함 | RQ-009 |
| `array_held` | 만드는 값이 한 위치가 가진 배열을 다른 위치에 둠 | RQ-008 |
| `nested_reference` | 만드는 값이 참조에 참조를 둠 | RQ-008 |
| `top_reference` | 만드는 값이 참조를 최상위 값으로 받음 | RQ-008 |
| `unknown_id` | 만드는 값이 자기가 갖지 않은 배열, 객체, 참조의 정체성을 받음 | RQ-008 |
| `unsupported_value` | 언어 값이 PHP 값이 아님, key가 정수도 문자열도 아님, 속성 이름이 문자열이 아님, 배열이 자기를 담음 | RQ-012 |
| `invalid_text` | 언어의 텍스트가 짝 없는 surrogate를 가짐 | RQ-003, RQ-012 |
| `internal` | 구현의 불변식이 깨짐. 결함입니다 | RQ-010 |

<a id="limits"></a>
## Runtime의 한계

runtime이 담을 수 없는 값은 변경하지 않고 unserialize의 오류로 거부합니다. Node.js에서는 2^24개를 넘는 배열이나 객체, 약 2^29자를 넘는 문자열입니다. crate는 프로세스 메모리에 들어가는 모든 값을 담으며, RQ-007이 할당을 입력의 크기 안에 둡니다.

<a id="differences"></a>
## Node.js와 Python 패키지의 차이

생성된 바인딩이 대체할 때까지(RQ-011) Node.js와 Python 패키지는 다음에서 crate와 다릅니다. 각 행은 판정했으며 crate가 옳고 바인딩은 crate의 동작을 따릅니다.

| 동작 | Node.js와 Python | Crate | 판정 |
| --- | --- | --- | --- |
| 실패 | unserialize는 kind 없이 `offset`을 가진 `UnserializeError`를 던지고, serialize는 `TypeError`나 `RangeError`(Node.js), `TypeError`, `OverflowError`, `ValueError`(Python)를 던짐 | 모든 실패가 [표](#kinds)의 kind를 가짐 | RQ-010: 호출자는 일부러 거부한 입력, 손상된 레코드, 너무 깊은 값을 kind로만 구별합니다. 메시지는 인터페이스가 아닙니다 |
| serialize의 최상위 값인 참조 | 참조의 값을 씀 | `top_reference`로 거부 | RQ-008: PHP에는 최상위 참조가 없으며, 그 값을 쓰면 PHP가 담을 수 없는 값을 다른 값으로 바꿉니다 |
| 정수의 정규형인 문자열 key와 반복된 key | serialize가 배열을 쓸 때 정규화 | key를 설정할 때 정규화 | RQ-008: 값은 PHP 배열이 담을 수 없는 key를 갖지 않습니다. bytes는 같습니다 |

<a id="transition"></a>
## 이행

Node.js와 Python 패키지는 `legacy/packages/js`와 `legacy/packages/python`에 있고, bindgen이 `packages/rust/interface.json`에서 생성하는 바인딩이 `packages/python`, `packages/ts`, `packages/php-ext`를 차지합니다(RQ-011). legacy 패키지는 API와 자기 구현을 지키고, 배포 대상이 아니며, 바인딩과 비교하는 기준으로 새 경로에서 시험과 fuzz를 실행합니다. 각 패키지는 그 언어의 바인딩이 contract, 패키지 시험, fuzz를 통과하면 그것만의 변경으로 없앱니다(계획 V-6 (5)). 그때까지 [위 표](#differences)가 crate와 다른 곳을 적습니다.
