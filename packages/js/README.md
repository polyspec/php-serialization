<!-- doc-id: js-overview -->
# php-serialize for Node.js

[한국어](README.ko.md)

The serialize format of PHP, ported from the source of PHP. Node.js >= 26.12.

```js
import { serialize, unserialize } from '@polyspec/php-serialize';

const value = unserialize(new TextEncoder().encode('a:1:{s:1:"a";d:1;}'));
serialize(value); // the same bytes
```

| PHP | JavaScript |
| --- | --- |
| null, bool | `null`, boolean |
| int | number when safe, otherwise bigint |
| float | number, or `PhpFloat` when the value is an integer |
| string | string, or `Uint8Array` when the bytes are not UTF-8 |
| array | `Array` when the keys are 0 to n-1 in order, otherwise `Map` |
| `stdClass` | `StdClass` |
| reference | `Reference` at each position |

Unserializing throws `UnserializeError` for what PHP refuses and for the inputs that [the specification](https://github.com/polyspec/php-serialize/blob/main/docs/spec/php-serialize.md#refused) refuses on purpose.
