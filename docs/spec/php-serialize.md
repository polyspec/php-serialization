<!-- doc-id: php-serialize-contract -->
# PHP serialize contract

[한국어](php-serialize.ko.md)

This specification defines the behavior of every package. The executable cases are in [`contracts/php-serialize.json`](../../contracts/php-serialize.json), which real PHP writes with `serialize_precision=-1` and `unserialize_max_depth=4096`: `cases`, `forms` and `deep` hold bytes that PHP reads with the typed tree of the value, `rejected` the bytes that PHP refuses, `stricter` the bytes that PHP reads and every package refuses ([refused](#refused)), and `refused_values` the values that PHP holds and a value of this format refuses (RQ-008, RQ-009), with the bytes that PHP writes for them. Each entry of `rejected`, `stricter` and `refused_values` names the error in `raises` (RQ-010). Each entry also gives the argument of `unserialize` (`data`) and of `serialize` (`value`, unless the value holds an object or a reference twice) in the case convention of binding (G-5), which the generated tests of the bindings read. [`contracts/host-values.json`](../../contracts/host-values.json) holds the values of a language that no PHP writes: those that a value of this format refuses or takes from a language (RQ-008, RQ-009, RQ-012) and the cases of the classes of `php_value`, one group per member.

<a id="requirements"></a>
## Requirements

- **RQ-001**: Unserializing bytes that PHP accepts and serializing the result gives the bytes that PHP writes for that value.
- **RQ-002**: A float keeps its exact value and its kind: `d:1;` stays a float apart from `i:1;`, and `-0`, `INF`, `-INF` and `NAN` stay what they are. Its text is the shortest digits in the layout of `php_gcvt`.
- **RQ-003**: A string is the bytes of the input. Bytes that are not UTF-8 stay bytes, in a value and in a key; a string that a language cannot encode without a change is refused, never replaced.
- **RQ-004**: An array key follows PHP: a string in the canonical form of a 64-bit integer is that integer, and a key that repeats keeps its first position and takes the last value. A property name is always a string.
- **RQ-005**: A slot names a position, as in `php_var_unserialize`: `R:` and `r:` follow the slot numbering of PHP, `R:` shares the value between the positions, and `r:` names only an object. A reference that one position alone holds is a plain value.
- **RQ-006**: Every input that PHP refuses is refused. The depth limit is 4096, as in PHP, and it needs no change of a stack limit of the language: neither direction recurses.
- **RQ-007**: The input and the value are bounded by their size: a count larger than the remaining bytes is refused before it allocates, and a value nested deeper than the limit or holding itself without a reference is refused before a byte of it is returned.
- **RQ-008**: The value of the format is a value of PHP and nothing else: null, a boolean, a 64-bit integer, a float of 64 bits (`-0`, `INF`, `-INF` and `NAN` included), a string of bytes, an array, an object of `stdClass` and a reference.
  - An array is an ordered map whose keys are integers and strings of bytes: setting a string key in the canonical form of a 64-bit integer sets that integer (RQ-004), and setting a key that the array holds replaces the value in its position, as an assignment of PHP does. An array is a value, so one position holds it; a position that would hold an array that another position holds is refused when the value is built.
  - An object of `stdClass` has an identity: the positions that hold one object hold the same object, which serialize writes as `r:` after its first position. Its properties are an ordered map from names of bytes to values; an integer key of the input is the name of its decimal digits (RQ-004).
  - A reference has an identity too: the positions that hold one reference share its value, which serialize writes as `R:` after its first position. A reference holds no reference, and the top value is no reference, because the argument of `serialize` and the result of `unserialize` in PHP are values; both are refused when the value is built.
  - The shape of the value in a language (a text for a string whose bytes are UTF-8, a list for an array whose keys are 0 to n-1, a class of its own for a float whose value is an integer where the language does not tell it from the integer) is the value table of `packages/rust/interface.json`, and every shape that a binding gives out reads back as the same value. The conversion to another model of values (JSON, the data model of a template) is no rule of this format: the library that owns the conversion states it.
- **RQ-009**: A property name that starts with U+0000 is refused. unserialize refuses the bytes, also when a repeated key overwrites the object later, and a value refuses the name when it is built, so serialize never writes it. PHP reads every such name into an object of `stdClass` without a warning: the forms `\0Class\0name` and `\0*\0name` become a private or a protected property, which `stdClass` never declares, and the other forms (`\0a`, `\0`) a property that `foreach` and `print_r` report with the notice `Illegal member variable name`. In both cases no code outside the object reads it by name (`Cannot access property starting with "\0"`), `json_encode` drops it, and no other language has a private or protected property of a `stdClass`. A name that starts with another byte, the empty name included, is read and written.
- **RQ-010**: Every failure is an error with a kind of [the table of kinds](#kinds) and without an HTTP status; the category of every kind is `value`, apart from `internal`, whose category is `internal`. An error of unserialize carries its offset, counted in bytes from 0 of the input: the first byte that breaks the grammar (the length of the input when the input ends early), the first digit of a length or a count larger than the bytes that remain (RQ-007), the first byte after the value for extra bytes, and the first byte of the token for a token refused as a whole (a value too deep, a reference, a class, an integer, a key). The message is no rule: a caller tells failures apart by the kind.
- **RQ-011**: The rules live in one implementation, the Rust crate `polyspec-php-serialization` in `packages/rust`; a binding of a runtime is generated from `packages/rust/interface.json` and holds no rule. The crate package holds that contract, so that a library that takes or gives a `php_value` reads its value table from the package that Cargo resolved. The Node.js and Python packages stay until the generated bindings pass the contract, the package tests and the fuzz; until then [the table of differences](#differences) lists where they behave otherwise than the crate.
- **RQ-012**: A value of a language enters through `from_host` of the crate: the binding describes the value one level at a time (the `HostValue` of binding) and answers the questions of the crate about the children of a handle (`HostValues` of binding), and it judges no value itself. null, a boolean and an integer are themselves; an integer outside 64 bits (a Python `int`) is refused with `int_range`. A float of a language that has a float type apart from its integer type (PHP, Python) is a float; a number of JavaScript, which the binding describes as an untyped number, is an integer when it is a safe integer and not `-0`, and a float otherwise, which is why a float of PHP whose value is an integer goes to JavaScript as a `PhpFloat`, a float whatever its value. A text is its UTF-8 and bytes are bytes; a text with an unpaired surrogate is refused with `invalid_text` (RQ-003). A list is an array with the keys 0 to n-1, and a map or a PHP array is an array whose keys are integers or strings: a string in the canonical form of an integer is that integer (RQ-004), and so is a number of JavaScript that is an integer; another key is refused with `unsupported_value`. An array is a value, so a list or a map at two positions gives two arrays, and one that holds itself is refused with `unsupported_value`. An object of `stdClass` (a PHP `stdClass` or a `StdClass` of a binding) is one object at every position, made before its properties, so it may hold itself; its property names are strings (RQ-009). A PHP reference and a `Reference` of a binding are one reference for one identity, holding the value of its first position; a reference that holds a reference and a reference as the top value are refused (RQ-008). Every other value of a language (JavaScript `undefined`, a plain object, a `Date`, a function, an instance of another class) is refused with `unsupported_value`. The walk keeps its own stack and the depth limit of RQ-006. An exception that the language raises while it answers goes back to the caller unchanged. The constructors of `StdClass` and `Reference` of the bindings judge what they take by the same rules, and their objects keep what they were given.
- **RQ-013**: A value of PHP leaves for a language through `to_host` of the crate, the one description of it (P-1): the top value as an `OutValue` of binding and the children of its handles through `OutValues`, which borrow the value. null, a boolean, an integer and a float are themselves (an integer as the kind `int`, a float as the kind `float`, whose predicates the binding reads), and a string is bytes (`bytes`, whose predicate says whether they are UTF-8). An array is a map whose entries keep their order; its keys are integers or bytes, and the map says whether its keys are 0 to n-1 in order. An object of `stdClass` is an `object` whose property names are bytes, and the same object has the same handle at every position. A reference is a `reference` with the value it holds, and every position of one reference has the same handle. `to_host` of a value that `from_host` made describes that value again: a value goes to a language and back unchanged (U-1). The `value` of each entry of the contract is what `to_host` gives for the value of its bytes, a reference numbered by its first position.

<a id="refused"></a>
## Inputs refused on purpose

PHP reads these and every package refuses them; the entries `stricter` of the contract hold them.

| Input | Kind | Reason |
| --- | --- | --- |
| Extra bytes after the value | `trailing_data` | They mean a corrupt record; PHP only warns |
| An object of a class other than `stdClass`, `C:` and `E:` | `class` | No other language holds the class |
| An integer outside 64 bits | `int_range` | PHP changes the value |
| `R:` naming a top array | `top_array_reference` | No serialize of PHP writes it, and what PHP writes back is not these bytes: the array unrolled or null in its place |
| A property name that starts with U+0000 | `property_name` | PHP reads it without a warning into a private or protected property of `stdClass`, or into a property that only a notice of `foreach` names; no code outside the object reads it and no other language holds it (RQ-009) |

<a id="kinds"></a>
## Kinds of errors

| Kind | Failure | Rule |
| --- | --- | --- |
| `syntax` | The bytes break the grammar of the format, a length or a count is larger than the bytes that remain, or the input ends early | RQ-006, RQ-007 |
| `depth` | A value is nested deeper than 4096, in the input or in a value to write | RQ-006, RQ-007 |
| `reference` | `R:` or `r:` names no slot, `R:` names its own position, or `r:` names no object | RQ-005 |
| `int_range` | An integer of the input or of a value of a language is outside 64 bits | [refused](#refused), RQ-012 |
| `trailing_data` | Bytes follow the value | [refused](#refused) |
| `class` | An object of a class other than `stdClass`, or `C:` or `E:` | [refused](#refused) |
| `top_array_reference` | `R:` names the top array | [refused](#refused) |
| `property_name` | A property name starts with U+0000, in the input or in a value being built | RQ-009 |
| `array_held` | A value being built puts an array that a position holds into another position | RQ-008 |
| `nested_reference` | A value being built puts a reference into a reference | RQ-008 |
| `top_reference` | A value being built takes a reference as its top value | RQ-008 |
| `unknown_id` | A value being built is given the identity of an array, an object or a reference that it does not hold | RQ-008 |
| `unsupported_value` | A value of a language is no value of PHP, a key is neither an integer nor a string, a property name is no string, or an array holds itself | RQ-012 |
| `invalid_text` | A text of a language has an unpaired surrogate | RQ-003, RQ-012 |
| `internal` | An invariant of the implementation fails; it is a defect | RQ-010 |

<a id="limits"></a>
## Limits of a runtime

A value that a runtime cannot hold is refused with the error of unserialize, never changed: in Node.js an array or an object of more than 2^24 elements and a string of more than about 2^29 characters. The crate holds every value that fits in the memory of the process; RQ-007 keeps an allocation within the size of the input.

<a id="differences"></a>
## Differences of the Node.js and Python packages

Until the generated bindings replace them (RQ-011), the Node.js and Python packages differ from the crate here. Each row is judged: the crate is right, and the bindings take its behaviour.

| Behaviour | Node.js and Python | Crate | Judgement |
| --- | --- | --- | --- |
| Failures | unserialize throws `UnserializeError` with `offset` and without a kind; serialize throws `TypeError` or `RangeError` (Node.js), `TypeError`, `OverflowError` or `ValueError` (Python) | Every failure has a kind of [the table](#kinds) | RQ-010: a caller tells a refusal on purpose from a corrupt record or a value too deep only by a kind; a message is no interface |
| A reference as the top value of serialize | Writes the value of the reference | Refuses it with `top_reference` | RQ-008: PHP has no top reference; writing its value would turn a value that PHP cannot hold into another value |
| A string key in the canonical form of an integer, and a repeated key | Normalized while serialize writes the array | Normalized when the key is set | RQ-008: the value never holds a key that a PHP array cannot hold; the bytes are the same |

<a id="transition"></a>
## Transition

The Node.js and Python packages are in `legacy/packages/js` and `legacy/packages/python`, and the bindings that binding generates from `packages/rust/interface.json` take `packages/python`, `packages/ts` and `packages/php-ext` (RQ-011). The legacy packages keep their API and their own implementation, are no release target, and run their tests and the fuzz from their new paths, as the reference of the comparison with the bindings. Each is removed by a change of its own once the binding of its language passes the contract, the package tests and the fuzz (plan V-6 (5)); until then [the table above](#differences) lists where they differ from the crate.
