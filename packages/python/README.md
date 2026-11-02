<!-- doc-id: python-overview -->
# php-serialize for Python

[한국어](README.ko.md)

The serialize format of PHP, ported from the source of PHP. Python >= 3.14.

```python
from polyspec.php_serialize import serialize, unserialize

value = unserialize(b'a:1:{s:1:"a";d:1;}')
serialize(value)  # the same bytes
```

| PHP | Python |
| --- | --- |
| null, bool, int, float | `None`, `bool`, `int`, `float` |
| string | `str`, or `bytes` when the bytes are not UTF-8 |
| array | `list` when the keys are 0 to n-1 in order, otherwise `dict` |
| `stdClass` | `StdClass` |
| reference | `Reference` at each position |

`unserialize` raises `UnserializeError` for what PHP refuses and for the inputs that [the specification](https://github.com/polyspec/php-serialize/blob/main/docs/spec/php-serialize.md#refused) refuses on purpose.
