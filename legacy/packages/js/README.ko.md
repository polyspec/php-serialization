<!-- doc-id: js-overview -->
<!-- source-sha256: 69d08aada6c5376f474d5a2998d8373efe8cc8cd47c850582857f420b5154312 -->
# Node.js용 php-serialize

[English](README.md)

PHP 소스에서 포팅한 PHP serialize 형식입니다. Node.js >= 26.12.

```js
import { serialize, unserialize } from '@polyspec/php-serialize';

const value = unserialize(new TextEncoder().encode('a:1:{s:1:"a";d:1;}'));
serialize(value); // 같은 bytes
```

| PHP | JavaScript |
| --- | --- |
| null, bool | `null`, boolean |
| int | 안전한 정수면 number, 아니면 bigint |
| float | number, 값이 정수면 `PhpFloat` |
| string | string, bytes가 UTF-8이 아니면 `Uint8Array` |
| array | key가 순서대로 0부터 n-1이면 `Array`, 아니면 `Map` |
| `stdClass` | `StdClass` |
| reference | 각 위치의 `Reference` |

unserialize는 PHP가 거부하는 입력과 [명세](https://github.com/polyspec/php-serialize/blob/main/docs/spec/php-serialize.ko.md#refused)가 일부러 거부하는 입력에 `UnserializeError`를 던집니다.
