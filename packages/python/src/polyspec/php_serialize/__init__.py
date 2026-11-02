"""The PHP serialize format, ported from ext/standard/var.c and ext/standard/var_unserializer.re of php-src at commit
39fa31b98ae25243ebf24779762bb285bc3085e4. Copyright © The PHP Group and Contributors. BSD-3-Clause; see LICENSE.

A value of PHP maps to Python as follows: null to None, a boolean to bool, an integer to int, a float to float, a string
to str or, when its bytes are not UTF-8, to bytes, an array whose keys are 0 to n-1 in order to list, another array to
dict, an object of stdClass to StdClass, and a PHP reference to Reference at each of its positions. Unserializing bytes
that PHP wrote and serializing the result gives the same bytes. Neither direction recurses, so the depth that PHP reads
needs no change of the recursion limit of the interpreter.
"""

from __future__ import annotations

import math
import re
from collections.abc import Iterator
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Union

_MAX_DEPTH = 4096
_INT_MIN = -(2**63)
_INT_MAX = 2**63 - 1

_UINT = re.compile(rb"[0-9]+")
_INT = re.compile(rb"[+-]?[0-9]+")
# The count of an object, which php_var_unserialize reads with parse_iv2 and without the grammar: an empty count is 0.
_OBJECT_COUNT = re.compile(rb"[+-]?[0-9]*")
_FLOAT = re.compile(
    rb"(?:NAN|-?INF|[+-]?(?:[0-9]*\.[0-9]+|[0-9]+\.[0-9]*|[0-9]+)(?:[eE][+-]?[0-9]+)?)"
)
_HEX_PAIR = re.compile(rb"[0-9a-fA-F]{2}")
# The form of an array key that PHP stores as an integer (ZEND_HANDLE_NUMERIC_STR).
_NUMERIC_KEY = re.compile(r"(?:0|-?[1-9][0-9]*)\Z")


class UnserializeError(ValueError):
    """The input is no serialized value; `offset` is the byte where reading stopped."""

    def __init__(self, message: str, offset: int):
        super().__init__(f"{message} at offset {offset}")
        self.offset = offset


@dataclass(eq=False)
class StdClass:
    """An object of the class stdClass."""

    properties: dict = field(default_factory=dict)


@dataclass(eq=False)
class Reference:
    """A PHP reference: the positions that hold one Reference hold one value, which serialize writes once and then as R:."""

    value: Any = None


Value = Union[None, bool, int, float, str, bytes, list, dict, StdClass, Reference]


def _decoded(key: Any) -> Any:
    """Returns a key of bytes as its text when the bytes are UTF-8: PHP has one string type, so both name one key."""
    if isinstance(key, bytes):
        try:
            return key.decode("utf-8")
        except UnicodeDecodeError:
            return key
    return key


def _array_key(key: Union[int, str, bytes]) -> Union[int, str, bytes]:
    """Returns the key that a PHP array stores: a string in the canonical form of a 64-bit integer becomes that integer."""
    key = _decoded(key)
    # 20 characters hold every 64-bit integer with its sign; the check keeps int() within the digit limit of Python.
    if isinstance(key, str) and len(key) <= 20 and _NUMERIC_KEY.match(key) is not None:
        number = int(key)
        if _INT_MIN <= number <= _INT_MAX:
            return number
    return key


def _property_name(key: Any) -> Union[str, bytes]:
    """Returns the name of an object property, which is always a string in PHP."""
    if isinstance(key, bool):
        raise TypeError("a property name is an int, a str or bytes, not bool")
    return str(key) if isinstance(key, int) else _decoded(key)


def _float_text(value: float) -> str:
    """Returns the text of a float at serialize_precision -1: the shortest digits in the layout of php_gcvt."""
    if math.isnan(value):
        return "NAN"
    if math.isinf(value):
        return "INF" if value > 0 else "-INF"
    if value == 0:
        return "-0" if math.copysign(1, value) < 0 else "0"
    sign, digits, exponent = Decimal(float.__repr__(value)).as_tuple()
    text = "".join(map(str, digits)).rstrip("0")
    # The position of the decimal point after the first digits, as zend_dtoa returns it.
    point = len(digits) + exponent
    prefix = "-" if sign else ""
    if point < -3 or point > 17:
        power = point - 1
        mantissa = text[0] + "." + (text[1:] or "0")
        return f"{prefix}{mantissa}E{'+' if power >= 0 else '-'}{abs(power)}"
    if point <= 0:
        return f"{prefix}0.{'0' * -point}{text}"
    if len(text) <= point:
        return f"{prefix}{text}{'0' * (point - len(text))}"
    return f"{prefix}{text[:point]}.{text[point:]}"


def _write_string(data: bytes, out: bytearray) -> None:
    out += b's:%d:"' % len(data)
    out += data
    out += b'";'


def _write_key(key: Any, out: bytearray) -> None:
    if isinstance(key, bool):
        raise TypeError("an array key is an int, a str or bytes, not bool")
    if isinstance(key, int):
        if not _INT_MIN <= key <= _INT_MAX:
            raise OverflowError(f"the key {key} is outside the integers of PHP")
        out += b"i:%d;" % key
    elif isinstance(key, str):
        _write_string(key.encode("utf-8"), out)
    elif isinstance(key, bytes):
        _write_string(key, out)
    else:
        raise TypeError(
            f"an array key is an int, a str or bytes, not {type(key).__name__}"
        )


def serialize(value: Value) -> bytes:
    """Returns the bytes of php_var_serialize for a value. An object that appears again is written as r:<slot>;, a Reference
    that appears again as R:<slot>;, and a value nested deeper than unserialize reads, a cycle among them, raises ValueError."""
    out = bytearray()
    objects: dict[int, int] = {}
    references: dict[int, int] = {}
    counter = 0
    stack: list[Iterator] = []

    def write(item: Any) -> None:
        nonlocal counter
        is_reference = isinstance(item, Reference)
        target = item.value if is_reference else item
        # A reference to an object counts as the object, as php_add_var_hash treats it.
        table, key = (
            (objects, id(target))
            if isinstance(target, StdClass)
            else (references, id(item))
        )
        if is_reference or isinstance(target, StdClass):
            known = table.get(key)
            if known is not None:
                if is_reference:
                    out.extend(b"R:%d;" % known)
                else:
                    counter += 1
                    out.extend(b"r:%d;" % known)
                return
            table[key] = counter + 1
        counter += 1
        item = target
        if item is None:
            out.extend(b"N;")
        elif isinstance(item, bool):
            out.extend(b"b:1;" if item else b"b:0;")
        elif isinstance(item, int):
            if not _INT_MIN <= item <= _INT_MAX:
                raise OverflowError(f"{item} is outside the integers of PHP")
            out.extend(b"i:%d;" % item)
        elif isinstance(item, float):
            out.extend(b"d:%s;" % _float_text(item).encode("ascii"))
        elif isinstance(item, str):
            _write_string(item.encode("utf-8"), out)
        elif isinstance(item, bytes):
            _write_string(item, out)
        elif isinstance(item, list):
            out.extend(b"a:%d:{" % len(item))
            push(enumerate(item), len(item))
        elif isinstance(item, dict):
            normal = {_array_key(key): element for key, element in item.items()}
            out.extend(b"a:%d:{" % len(normal))
            push(iter(normal.items()), len(normal))
        elif isinstance(item, StdClass):
            properties = {
                _property_name(key): element for key, element in item.properties.items()
            }
            out.extend(b'O:8:"stdClass":%d:{' % len(properties))
            push(iter(properties.items()), len(properties), True)
        else:
            raise TypeError(f"{type(item).__name__} has no serialized form")

    def push(pairs: Iterator, size: int, is_object: bool = False) -> None:
        # unserialize checks the depth of every object, but only of an array that holds elements.
        if (size > 0 or is_object) and len(stack) >= _MAX_DEPTH:
            raise ValueError("the value is nested deeper than unserialize reads")
        if size == 0:
            out.extend(b"}")
            return
        stack.append(pairs)

    write(value)
    while stack:
        pair = next(stack[-1], None)
        if pair is None:
            stack.pop()
            out.extend(b"}")
            continue
        _write_key(pair[0], out)
        write(pair[1])
    return bytes(out)


class _Frame:
    """An array or an object that is being read; `key` is the position that the next value takes in `items`."""

    __slots__ = ("is_object", "items", "key", "remaining")

    def __init__(self, items: dict, remaining: int, is_object: bool):
        self.items = items
        self.remaining = remaining
        self.is_object = is_object
        self.key: Any = None


class _Reader:
    """Reads as php_var_unserialize does: a slot names a position (an array and a key), not a value, so a key that repeats
    gives its earlier slot the new value, and R: makes the value at the position a Reference that both positions hold. Every
    array is a dict while reading; _finish turns those that are lists into lists."""

    def __init__(self, data: bytes):
        self.data = data
        self.at = 0
        self.slots: list[tuple[dict, Any]] = []
        self.stack: list[_Frame] = []
        self.top: dict = {}

    def fail(self, message: str) -> UnserializeError:
        return UnserializeError(message, self.at)

    def expect(self, text: bytes) -> None:
        if not self.data.startswith(text, self.at):
            raise self.fail(f"expected {text.decode('ascii')}")
        self.at += len(text)

    def match(self, pattern: re.Pattern) -> bytes:
        found = pattern.match(self.data, self.at)
        if found is None:
            raise self.fail("expected a number")
        self.at = found.end()
        return found.group()

    def wrapped(self) -> int:
        """Reads a length or a slot as parse_uiv does, which wraps at 64 bits; pieces keep int() within the digit limit of Python."""
        digits = self.match(_UINT)
        number = 0
        for start in range(0, len(digits), 4000):
            piece = digits[start : start + 4000]
            number = (number * 10 ** len(piece) + int(piece)) % 2**64
        return number

    def raw_string(self) -> bytes:
        length = self.wrapped()
        self.expect(b':"')
        end = self.at + length
        if end > len(self.data):
            raise self.fail("the string exceeds the input")
        text = self.data[self.at : end]
        self.at = end
        self.expect(b'"')
        return text

    def escaped_string(self) -> bytes:
        """Reads the bytes of S:, where \\xx is the byte of two hexadecimal digits."""
        length = self.wrapped()
        self.expect(b':"')
        if length > len(self.data) - self.at:
            raise self.fail("the string exceeds the input")
        text = bytearray()
        for _ in range(length):
            if self.at >= len(self.data):
                raise self.fail("the string exceeds the input")
            byte = self.data[self.at]
            if byte == 0x5C:
                if _HEX_PAIR.fullmatch(self.data, self.at + 1, self.at + 3) is None:
                    raise self.fail("expected two hexadecimal digits")
                text.append(int(self.data[self.at + 1 : self.at + 3], 16))
                self.at += 3
            else:
                text.append(byte)
                self.at += 1
        self.expect(b'"')
        return bytes(text)

    @staticmethod
    def text(data: bytes) -> str | bytes:
        try:
            return data.decode("utf-8")
        except UnicodeDecodeError:
            return data

    def integer(self) -> int:
        return self.bounded(self.match(_INT))

    def bounded(self, text: bytes) -> int:
        """Returns a number of 64 bits, with any count of leading zeros; a longer one never reaches int()."""
        sign = text[:1] if text[:1] in (b"+", b"-") else b""
        digits = text[len(sign) :].lstrip(b"0")
        if len(digits) > 19:
            raise self.fail("the integer is out of range")
        number = int(sign + (digits or b"0"))
        if not _INT_MIN <= number <= _INT_MAX:
            raise self.fail("the integer is out of range")
        return number

    def key(self) -> int | str | bytes:
        kind = self.data[self.at : self.at + 2]
        if kind == b"i:":
            self.at += 2
            number = self.integer()
            self.expect(b";")
            return number
        if kind == b"s:":
            self.at += 2
            text = self.raw_string()
        elif kind == b"S:":
            self.at += 2
            text = self.escaped_string()
        else:
            raise self.fail("an array key is an integer or a string")
        self.expect(b";")
        return self.text(text)

    def open(self, items: dict, is_object: bool) -> None:
        """Reads the count and the brace; PHP refuses more elements than bytes remain, and checks the depth of every object
        but only of an array that holds elements."""
        text = self.match(_OBJECT_COUNT if is_object else _UINT)
        count = self.bounded(text) if text.strip(b"+-") else 0
        if count < 0 or count > len(self.data) - self.at:
            raise self.fail("the count exceeds the remaining input")
        self.expect(b":{")
        if (count > 0 or is_object) and len(self.stack) >= _MAX_DEPTH:
            raise self.fail("the maximum depth is exceeded")
        self.stack.append(_Frame(items, count, is_object))

    def named_slot(self, at: int) -> tuple[dict, Any]:
        self.at += 2
        number = self.wrapped()
        self.expect(b";")
        if number < 1 or number > len(self.slots):
            self.at = at
            raise self.fail("the reference names no value")
        return self.slots[number - 1]

    def read_value(self, frame: _Frame) -> None:
        """Reads one value into the position of the frame, and opens a new frame for an array or an object."""
        at = self.at
        items = frame.items
        key = frame.key
        kind = self.data[at : at + 2]
        if kind == b"R:":
            holder, position = self.named_slot(at)
            if holder is items and position == key:
                self.at = at
                raise self.fail("the reference names its own position")
            found = holder[position]
            if holder is self.top and isinstance(
                found if not isinstance(found, Reference) else found.value, dict
            ):
                # PHP reads this, but its serialize never writes it, and what it writes back is not these bytes: the array
                # unrolled or null in its place. Refusing keeps the data from changing silently.
                self.at = at
                raise self.fail("the reference names the top array")
            if not isinstance(found, Reference):
                found = Reference(found)
                holder[position] = found
            items[key] = found
            return
        self.slots.append((items, key))
        if kind == b"r:":
            holder, position = self.named_slot(at)
            found = holder[position]
            if isinstance(found, Reference):
                found = found.value
            if not isinstance(found, StdClass):
                self.at = at
                raise self.fail("r: names no object")
            items[key] = found
        elif kind == b"N;":
            self.at += 2
            items[key] = None
        elif self.data.startswith((b"b:0;", b"b:1;"), at):
            items[key] = self.data[at + 2] == 0x31
            self.at += 4
        elif kind == b"i:":
            self.at += 2
            number = self.integer()
            self.expect(b";")
            items[key] = number
        elif kind == b"d:":
            self.at += 2
            text = self.match(_FLOAT)
            self.expect(b";")
            items[key] = float(
                text.decode("ascii").replace("NAN", "nan").replace("INF", "inf")
            )
        elif kind == b"s:" or kind == b"S:":
            self.at += 2
            data = self.raw_string() if kind == b"s:" else self.escaped_string()
            self.expect(b";")
            items[key] = self.text(data)
        elif kind == b"a:":
            self.at += 2
            array: dict = {}
            items[key] = array
            self.open(array, False)
        elif kind == b"O:":
            self.at += 2
            name = self.raw_string()
            if name.lower() != b"stdclass":
                self.at = at
                raise self.fail("only objects of stdClass are read")
            self.expect(b":")
            target = StdClass({})
            items[key] = target
            self.open(target.properties, True)
        else:
            self.at = at
            raise self.fail("no serialized value")

    def read(self) -> Any:
        root = _Frame({None: None}, 0, False)
        self.top = root.items
        self.read_value(root)
        while self.stack:
            frame = self.stack[-1]
            if frame.remaining == 0:
                self.expect(b"}")
                self.stack.pop()
                continue
            frame.remaining -= 1
            key = self.key()
            if frame.is_object:
                # A property name is always a string: PHP converts an integer key of an object.
                frame.key = str(key) if isinstance(key, int) else key
            else:
                frame.key = _array_key(key)
            # A key that repeats keeps its first position and starts empty.
            frame.items[frame.key] = None
            self.read_value(frame)
        return root.items[None]


def _finish(root: Any) -> Any:
    """Turns the arrays whose keys are 0 to n-1 into lists, and a Reference that one position alone still holds into its
    value, as PHP holds it. The top value is never a reference: unserialize returns the value itself."""
    if isinstance(root, Reference):
        root = root.value
    holders: dict[int, int] = {}
    references: list[Reference] = []
    containers: dict[int, dict | StdClass] = {}
    pending = [root]
    while pending:
        item = pending.pop()
        if isinstance(item, Reference):
            count = holders.get(id(item), 0)
            holders[id(item)] = count + 1
            if count == 0:
                references.append(item)
                pending.append(item.value)
        elif isinstance(item, (dict, StdClass)) and id(item) not in containers:
            containers[id(item)] = item
            pending.extend(
                (item.properties if isinstance(item, StdClass) else item).values()
            )

    lists: dict[int, list] = {}
    for item in containers.values():
        if isinstance(item, dict) and all(
            key == index and type(key) is int for index, key in enumerate(item)
        ):
            lists[id(item)] = []

    def final(value: Any) -> Any:
        if isinstance(value, Reference):
            if holders[id(value)] == 1:
                value = value.value
            else:
                return value
        return lists.get(id(value), value) if isinstance(value, dict) else value

    for reference in references:
        if holders[id(reference)] > 1:
            reference.value = final(reference.value)
    for item in containers.values():
        items = item.properties if isinstance(item, StdClass) else item
        target = lists.get(id(item))
        if target is not None:
            target.extend(map(final, items.values()))
        else:
            for key, value in items.items():
                items[key] = final(value)
    return final(root)


def unserialize(data: bytes) -> Value:
    """Returns the value of the bytes that php_var_unserialize reads, and raises UnserializeError for other bytes, for
    extra bytes after the value and for an object of a class other than stdClass."""
    reader = _Reader(data)
    result = reader.read()
    if reader.at != len(data):
        raise reader.fail("extra data after the value")
    return _finish(result)
