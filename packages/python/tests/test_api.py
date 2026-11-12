"""For RQ-001, RQ-002, RQ-003, RQ-004, RQ-006, RQ-007 and RQ-009: the forms, the depth and
the refusals of the contract, built values and large input."""

from __future__ import annotations

import base64
import json
import unittest
from pathlib import Path

from polyspec.php_serialize import StdClass, UnserializeError, serialize, unserialize

from .tree import b64, new_state, tree

CONTRACT = json.loads(
    (
        Path(__file__).resolve().parents[3] / "contracts" / "php-serialize.json"
    ).read_text("utf-8")
)


class ApiTest(unittest.TestCase):
    def test_forms(self) -> None:
        for entry in CONTRACT["forms"]:
            with self.subTest(entry["id"]):
                value = unserialize(base64.b64decode(entry["bytes"]))
                self.assertEqual(tree(value, new_state()), entry["tree"])
                self.assertEqual(b64(serialize(value)), entry["written"])

    def test_deep(self) -> None:
        for entry in CONTRACT["deep"]:
            with self.subTest(entry["id"]):
                self.assertEqual(
                    b64(serialize(unserialize(base64.b64decode(entry["bytes"])))),
                    entry["bytes"],
                )

    def test_refused(self) -> None:
        for entry in CONTRACT["rejected"] + CONTRACT["stricter"]:
            with self.subTest(entry["id"]), self.assertRaises(UnserializeError):
                unserialize(base64.b64decode(entry["bytes"]))

    def test_refused_property_names(self) -> None:
        for name in ("\0a", "\0*\0c", b"\0\xff"):
            with self.subTest(repr(name)), self.assertRaises(ValueError):
                serialize(StdClass({name: 1}))
        self.assertEqual(
            serialize(StdClass({"": 1})), b'O:8:"stdClass":1:{s:0:"";i:1;}'
        )

    def test_built_values(self) -> None:
        self.assertEqual(serialize(1), b"i:1;")
        self.assertEqual(serialize(1.0), b"d:1;")
        self.assertEqual(serialize(-0.0), b"d:-0;")
        self.assertEqual(
            serialize({"5": "a", "05": "b"}), b'a:2:{i:5;s:1:"a";s:2:"05";s:1:"b";}'
        )
        self.assertEqual(serialize([]), b"a:0:{}")
        self.assertEqual(serialize({}), b"a:0:{}")
        self.assertEqual(serialize({b"a": 1, "a": 2}), b'a:1:{s:1:"a";i:2;}')
        self.assertEqual(serialize({b"5": "a"}), b'a:1:{i:5;s:1:"a";}')
        self.assertEqual(
            serialize(StdClass({5: "a"})), b'O:8:"stdClass":1:{s:1:"5";s:1:"a";}'
        )
        self.assertEqual(
            serialize(StdClass({5: "a", "5": "b"})),
            b'O:8:"stdClass":1:{s:1:"5";s:1:"b";}',
        )
        self.assertEqual(
            serialize(StdClass({b"a": 1, "a": 2})), b'O:8:"stdClass":1:{s:1:"a";i:2;}'
        )
        self.assertEqual(
            serialize({"1" * 5000: 1}),
            b's:5000:"'.join((b"a:1:{", b"1" * 5000 + b'";i:1;}')),
        )

        class Shown(float):
            def __repr__(self) -> str:
                return "shown"

        self.assertEqual(serialize(Shown(1.5)), b"d:1.5;")

    def test_unrepresentable(self) -> None:
        with self.assertRaises(UnicodeEncodeError):
            serialize("\ud800")
        with self.assertRaises(TypeError):
            serialize(object())
        with self.assertRaises(OverflowError):
            serialize(2**63)
        cycle: list = []
        cycle.append(cycle)
        with self.assertRaises(ValueError):
            serialize(cycle)
        deepest: object = StdClass()
        for _ in range(4096):
            deepest = [deepest]
        with self.assertRaises(ValueError):
            serialize(deepest)

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
        data = serialize(record)
        self.assertEqual(serialize(unserialize(data)), data)
