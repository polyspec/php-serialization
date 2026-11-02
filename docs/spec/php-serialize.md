<!-- doc-id: php-serialize-contract -->
# PHP serialize contract

[한국어](php-serialize.ko.md)

This specification defines the behavior of every package. The executable cases are in [`contracts/php-serialize.json`](../../contracts/php-serialize.json), which real PHP writes with `serialize_precision=-1` and `unserialize_max_depth=4096`.

<a id="requirements"></a>
## Requirements

- **RQ-001**: Unserializing bytes that PHP accepts and serializing the result gives the bytes that PHP writes for that value.
- **RQ-002**: A float keeps its exact value and its kind: `d:1;` stays a float apart from `i:1;`, and `-0`, `INF`, `-INF` and `NAN` stay what they are. Its text is the shortest digits in the layout of `php_gcvt`.
- **RQ-003**: A string is the bytes of the input. Bytes that are not UTF-8 stay bytes, in a value and in a key; a string that a language cannot encode without a change is refused, never replaced.
- **RQ-004**: An array key follows PHP: a string in the canonical form of a 64-bit integer is that integer, and a key that repeats keeps its first position and takes the last value. A property name is always a string.
- **RQ-005**: A slot names a position, as in `php_var_unserialize`: `R:` and `r:` follow the slot numbering of PHP, `R:` shares the value between the positions, and `r:` names only an object. A reference that one position alone holds is a plain value.
- **RQ-006**: Every input that PHP refuses is refused. The depth limit is 4096, as in PHP, and it needs no change of a stack limit of the language: neither direction recurses.
- **RQ-007**: The input and the value are bounded by their size: a count larger than the remaining bytes is refused before it allocates, and a value nested deeper than the limit or holding itself without a reference is refused when it is written.

<a id="refused"></a>
## Inputs refused on purpose

PHP reads these and every package refuses them; the entries `stricter` of the contract hold them.

| Input | Reason |
| --- | --- |
| Extra bytes after the value | They mean a corrupt record; PHP only warns |
| An object of a class other than `stdClass`, `C:` and `E:` | No other language holds the class |
| An integer outside 64 bits | PHP changes the value |
| `R:` naming a top array | No serialize of PHP writes it, and what PHP writes back is not these bytes: the array unrolled or null in its place |

<a id="limits"></a>
## Limits of a runtime

A value that a runtime cannot hold is refused with the error of unserialize, never changed: in Node.js an array or an object of more than 2^24 elements and a string of more than about 2^29 characters.
