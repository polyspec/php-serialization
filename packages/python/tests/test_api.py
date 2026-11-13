"""The tests of the legacy Python package (legacy/packages/python/tests/test_api.py) that the contract cases do not hold,
run against the installed Python package.

The groups forms, deep, rejected and stricter of the legacy tests are the groups of contracts/php-serialize.json, which
test_cases.py runs; this module holds the values that a Python program builds (RQ-004, RQ-009, RQ-012), the values that
the format refuses (RQ-003, RQ-006, RQ-009, RQ-012) and a large record, with the bytes of the legacy tests. A refusal
is the class of its category and its kind (RQ-010): every kind of php-serialization is of the category value, so its
class is PHPSerializationValueError, a ValueError (binding E-2).
"""

import unittest

import polyspec.php_serialization as lib


class ApiTest(unittest.TestCase):
    def refuses(self, call, kind: str) -> None:
        with self.assertRaises(lib.PHPSerializationValueError) as caught:
            call()
        self.assertIsInstance(caught.exception, ValueError)
        self.assertEqual(caught.exception.kind, kind)

    def test_refused_property_names(self) -> None:
        for name in ("\0a", "\0*\0c", b"\0\xff"):
            with self.subTest(repr(name)):
                self.refuses(
                    lambda name=name: lib.serialize(lib.StdClass({name: 1})),
                    "property_name",
                )
        self.assertEqual(
            lib.serialize(lib.StdClass({"": 1})), b'O:8:"stdClass":1:{s:0:"";i:1;}'
        )

    def test_built_values(self) -> None:
        self.assertEqual(lib.serialize(1), b"i:1;")
        self.assertEqual(lib.serialize(1.0), b"d:1;")
        self.assertEqual(lib.serialize(-0.0), b"d:-0;")
        self.assertEqual(
            lib.serialize({"5": "a", "05": "b"}), b'a:2:{i:5;s:1:"a";s:2:"05";s:1:"b";}'
        )
        self.assertEqual(lib.serialize([]), b"a:0:{}")
        self.assertEqual(lib.serialize({}), b"a:0:{}")
        self.assertEqual(lib.serialize({b"a": 1, "a": 2}), b'a:1:{s:1:"a";i:2;}')
        self.assertEqual(lib.serialize({b"5": "a"}), b'a:1:{i:5;s:1:"a";}')
        self.assertEqual(
            lib.serialize(lib.StdClass({5: "a"})),
            b'O:8:"stdClass":1:{s:1:"5";s:1:"a";}',
        )
        self.assertEqual(
            lib.serialize(lib.StdClass({5: "a", "5": "b"})),
            b'O:8:"stdClass":1:{s:1:"5";s:1:"b";}',
        )
        self.assertEqual(
            lib.serialize(lib.StdClass({b"a": 1, "a": 2})),
            b'O:8:"stdClass":1:{s:1:"a";i:2;}',
        )
        self.assertEqual(
            lib.serialize({"1" * 5000: 1}),
            b's:5000:"'.join((b"a:1:{", b"1" * 5000 + b'";i:1;}')),
        )

        class Shown(float):
            def __repr__(self) -> str:
                return "shown"

        self.assertEqual(lib.serialize(Shown(1.5)), b"d:1.5;")

    def test_unrepresentable(self) -> None:
        self.refuses(lambda: lib.serialize("\ud800"), "invalid_text")
        self.refuses(lambda: lib.serialize(object()), "unsupported_value")
        self.refuses(lambda: lib.serialize(2**63), "int_range")
        cycle: list = []
        cycle.append(cycle)
        self.refuses(lambda: lib.serialize(cycle), "unsupported_value")
        deepest: object = lib.StdClass({})
        for _ in range(4096):
            deepest = [deepest]
        self.refuses(lambda: lib.serialize(deepest), "depth")

    def test_large_record(self) -> None:
        record: dict = {
            f"key-{index}": index
            if index % 3 == 0
            else float(index)
            if index % 3 == 1
            else f"값-{index}"
            for index in range(200_000)
        }
        record["blob"] = "x" * (32 * 1024 * 1024)
        data = lib.serialize(record)
        self.assertEqual(lib.serialize(lib.unserialize(data)), data)


if __name__ == "__main__":
    unittest.main()
