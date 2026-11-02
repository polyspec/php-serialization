<!-- doc-id: python-overview -->
<!-- source-sha256: d22f666b9b492319f441b6a0ad0a99fee7583f258d08415f48ffa3e232eafab1 -->
# Python용 php-serialize

[English](README.md)

PHP 소스에서 포팅한 PHP serialize 형식입니다. Python >= 3.14.

```python
from polyspec.php_serialize import serialize, unserialize

value = unserialize(b'a:1:{s:1:"a";d:1;}')
serialize(value)  # 같은 bytes
```

| PHP | Python |
| --- | --- |
| null, bool, int, float | `None`, `bool`, `int`, `float` |
| string | `str`, bytes가 UTF-8이 아니면 `bytes` |
| array | key가 순서대로 0부터 n-1이면 `list`, 아니면 `dict` |
| `stdClass` | `StdClass` |
| reference | 각 위치의 `Reference` |

`unserialize`는 PHP가 거부하는 입력과 [명세](https://github.com/polyspec/php-serialize/blob/main/docs/spec/php-serialize.ko.md#refused)가 일부러 거부하는 입력에 `UnserializeError`를 발생시킵니다.
