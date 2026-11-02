<!-- doc-id: php-serialize-contract -->
<!-- source-sha256: c9c363dc5e1eeb3082c715302512b4e154aa94f84940b19e785b34f4c2d6f61d -->
# PHP serialize 계약

[English](php-serialize.md)

이 명세는 모든 패키지의 동작을 정의합니다. 실행 케이스는 [`contracts/php-serialize.json`](../../contracts/php-serialize.json)에 있으며, 실제 PHP가 `serialize_precision=-1`과 `unserialize_max_depth=4096`으로 씁니다.

<a id="requirements"></a>
## 요구사항

- **RQ-001**: PHP가 받는 bytes를 unserialize한 결과를 serialize하면 PHP가 그 값에 대해 쓰는 bytes와 같습니다.
- **RQ-002**: float는 정확한 값과 종류를 유지합니다. `d:1;`은 `i:1;`과 구분되는 float로 남고, `-0`, `INF`, `-INF`, `NAN`도 그대로 유지됩니다. 문자열 표현은 `php_gcvt` 배치의 최단 자릿수입니다.
- **RQ-003**: 문자열은 입력의 bytes입니다. UTF-8이 아닌 bytes는 값과 key 모두에서 bytes로 남습니다. 언어가 변경 없이 encode할 수 없는 문자열은 거부하며 치환하지 않습니다.
- **RQ-004**: 배열 key는 PHP를 따릅니다. 64-bit 정수의 정규형 문자열은 그 정수이고, 반복되는 key는 첫 위치를 유지하고 마지막 값을 가집니다. 속성 이름은 항상 문자열입니다.
- **RQ-005**: slot은 `php_var_unserialize`처럼 위치를 가리킵니다. `R:`과 `r:`은 PHP의 slot 번호를 따르고, `R:`은 위치 사이에 값을 공유하며, `r:`은 객체만 가리킵니다. 위치 하나만 잡고 있는 참조는 일반 값입니다.
- **RQ-006**: PHP가 거부하는 모든 입력을 거부합니다. depth 제한은 PHP와 같은 4096이며 언어의 stack 제한을 바꿀 필요가 없습니다. 양방향 모두 재귀하지 않습니다.
- **RQ-007**: 입력과 값은 크기로 제한됩니다. 남은 bytes보다 큰 count는 할당 전에 거부하고, 제한보다 깊거나 참조 없이 자신을 담은 값은 쓸 때 거부합니다.

<a id="refused"></a>
## 일부러 거부하는 입력

PHP는 읽지만 모든 패키지가 거부합니다. contract의 `stricter` 항목이 이 입력을 담습니다.

| 입력 | 이유 |
| --- | --- |
| 값 뒤의 추가 bytes | 손상된 레코드를 뜻하며 PHP는 경고만 합니다 |
| `stdClass` 외 class의 객체, `C:`, `E:` | 다른 언어는 그 class를 가질 수 없습니다 |
| 64-bit 밖의 정수 | PHP가 값을 바꿉니다 |
| 최상위 배열을 가리키는 `R:` | PHP의 serialize는 이것을 쓰지 않으며, PHP가 다시 쓰는 결과도 이 bytes가 아닙니다. 배열을 펼치거나 그 자리에 null을 넣습니다 |

<a id="limits"></a>
## Runtime의 한계

runtime이 담을 수 없는 값은 변경하지 않고 unserialize의 오류로 거부합니다. Node.js에서는 2^24개를 넘는 배열이나 객체, 약 2^29자를 넘는 문자열입니다.
