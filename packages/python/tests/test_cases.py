"""The contract cases of php-serialization run against the installed Python package.

PHP_SERIALIZATION_CONTRACTS is the path of contracts/, which make test-python-binding sets. A value of the cases is
{"kind", "value"} (binding G-5, docs/spec/php-serialize.md). The runner compares a value in one canonical form on both
sides: a key is ("int", <decimal>) or ("hex", <bytes>), an integer its decimal text, a float its repr with -0.0 kept,
bytes and texts their hex, and a reference (id, value) numbered by its first place. A case that arms fault injection
points runs in the generated tests (binding GN-13, B-4), which hold the arming entry points; this runner counts it and
runs the others.
"""

import base64
import datetime
import json
import math
import os
import unittest
from pathlib import Path

import polyspec.php_serialization as lib

CONTRACTS = Path(os.environ["PHP_SERIALIZATION_CONTRACTS"])


def read(name: str) -> dict:
    with (CONTRACTS / name).open(encoding="utf-8") as file:
        return json.load(file)


def float_text(value) -> str:
    if isinstance(value, dict):
        return value["float"]
    if math.isnan(value):
        return "nan"
    if math.isinf(value):
        return "inf" if value > 0 else "-inf"
    return repr(float(value))


def case_key(key) -> tuple:
    if isinstance(key, str):
        return ("hex", key.encode().hex())
    if "int" in key:
        return ("int", str(int(key["int"])))
    return ("hex", key["hex"])


def canonical_case(value: dict, ids: dict | None = None):
    ids = {} if ids is None else ids
    kind = value["kind"]
    if kind == "null":
        return ("null",)
    if kind == "bool":
        return ("bool", value["value"])
    if kind == "int":
        return ("int", str(int(value["value"])))
    if kind == "float":
        return ("float", float_text(value["value"]))
    if kind == "bytes":
        return ("bytes", value["value"]["hex"])
    if kind == "text":
        return ("bytes", value["value"].encode().hex())
    if kind in ("map", "object"):
        return (
            kind,
            [
                (case_key(key), canonical_case(item, ids))
                for key, item in value["value"]
            ],
        )
    if kind == "reference":
        seen = value["value"]["id"] in ids
        if not seen:
            ids[value["value"]["id"]] = len(ids)
        number = ids[value["value"]["id"]]
        return (
            ("reference", number)
            if seen
            else ("reference", number, canonical_case(value["value"]["value"], ids))
        )
    raise ValueError(f"a value of the kind {kind} has no form in the cases")


def host_key(key) -> tuple:
    if isinstance(key, int):
        return ("int", str(key))
    if isinstance(key, str):
        return ("hex", key.encode().hex())
    return ("hex", bytes(key).hex())


def canonical_host(value, ids: dict | None = None):
    ids = {} if ids is None else ids
    if value is None:
        return ("null",)
    if isinstance(value, bool):
        return ("bool", value)
    if isinstance(value, int):
        return ("int", str(value))
    if isinstance(value, float):
        return ("float", float_text(value))
    if isinstance(value, str):
        return ("bytes", value.encode().hex())
    if isinstance(value, bytes):
        return ("bytes", value.hex())
    if isinstance(value, list):
        return (
            "map",
            [
                (("int", str(i)), canonical_host(item, ids))
                for i, item in enumerate(value)
            ],
        )
    if isinstance(value, dict):
        return (
            "map",
            [(host_key(key), canonical_host(item, ids)) for key, item in value.items()],
        )
    if isinstance(value, lib.StdClass):
        return (
            "object",
            [
                (host_key(key), canonical_host(item, ids))
                for key, item in value.properties.items()
            ],
        )
    if isinstance(value, lib.Reference):
        seen = id(value) in ids
        if not seen:
            ids[id(value)] = len(ids)
        number = ids[id(value)]
        return (
            ("reference", number)
            if seen
            else ("reference", number, canonical_host(value.value, ids))
        )
    raise TypeError(f"the binding gave a value that is no form of php_value: {value!r}")


def key_of(key):
    if isinstance(key, str):
        return key
    if "int" in key:
        return int(key["int"])
    raw = bytes.fromhex(key["hex"])
    try:
        return raw.decode()
    except UnicodeDecodeError:
        return raw


class Other:
    pass


OTHERS = {
    "callable": lambda: lambda: None,
    "date": lambda: datetime.date(1970, 1, 1),
    "object": Other,
}


def from_case(value: dict, references: dict | None = None):
    references = {} if references is None else references
    if "host" in value:
        return OTHERS[value["host"]]()
    kind = value["kind"]
    if kind == "null":
        return None
    if kind == "bool":
        return value["value"]
    if kind == "int":
        return int(value["value"])
    if kind == "float":
        raw = value["value"]
        return (
            {"nan": math.nan, "inf": math.inf, "-inf": -math.inf}[raw["float"]]
            if isinstance(raw, dict)
            else float(raw)
        )
    if kind == "bytes":
        return bytes.fromhex(value["value"]["hex"])
    if kind == "text":
        return value["value"]
    if kind == "map":
        return {
            key_of(key): from_case(item, references) for key, item in value["value"]
        }
    if kind == "object":
        return lib.StdClass(
            {key_of(key): from_case(item, references) for key, item in value["value"]}
        )
    if kind == "reference":
        number = value["value"]["id"]
        if number not in references:
            references[number] = lib.Reference(
                from_case(value["value"]["value"], references)
            )
        return references[number]
    raise ValueError(f"a value of the kind {kind} has no form in the cases")


class ContractCaseTest(unittest.TestCase):
    php = read("php-serialize.json")
    host = read("host-values.json")

    def check_raises(self, case: dict, call) -> None:
        raises = case["raises"]
        with self.assertRaises(Exception) as caught:
            call()
        error = caught.exception
        self.assertIs(
            type(error),
            getattr(lib, f"PHPSerialization{raises['category'].capitalize()}Error"),
        )
        self.assertEqual(error.kind, raises["kind"])
        self.assertEqual(error.status, raises["status"])
        if raises["message"] is not None:
            self.assertEqual(str(error), raises["message"])

    def test_unserialize(self) -> None:
        count = 0
        for group in ("cases", "forms", "deep", "rejected", "stricter"):
            self.assertGreater(len(self.php[group]), 0, group)
            for case in self.php[group]:
                count += 1
                with self.subTest(case=case["id"]):
                    data = bytes.fromhex(case["data"]["hex"])
                    if "raises" in case:
                        self.check_raises(case, lambda data=data: lib.unserialize(data))
                        continue
                    result = lib.unserialize(data)
                    if "value" in case:
                        self.assertEqual(
                            canonical_host(result), canonical_case(case["value"])
                        )
                    written = case.get("written", case["bytes"])
                    self.assertEqual(
                        base64.b64encode(lib.serialize(result)).decode(), written
                    )
        self.assertGreater(count, 0)

    def test_serialize(self) -> None:
        count = 0
        armed = 0
        group = (
            self.php["cases"]
            + self.php["forms"]
            + self.php["refused_values"]
            + self.host["serialize"]
            + self.host["php_value"]
        )
        for case in group:
            if "value" not in case:
                continue
            if "faults" in case:
                armed += 1
                continue
            count += 1
            with self.subTest(case=case["id"]):
                if "raises" in case:
                    self.check_raises(
                        case, lambda case=case: lib.serialize(from_case(case["value"]))
                    )
                    continue
                written = lib.serialize(from_case(case["value"]))
                expected = case.get("written", case.get("bytes"))
                if expected is not None:
                    self.assertEqual(base64.b64encode(written).decode(), expected)
                self.assertEqual(
                    canonical_host(lib.unserialize(written)),
                    canonical_case(case["value"]),
                )
        self.assertGreater(count, 0)
        self.assertEqual(
            armed, len([case for case in self.host["serialize"] if "faults" in case])
        )

    def test_std_class(self) -> None:
        group = self.host["std_class.constructor"] + self.host["std_class.properties"]
        self.assertGreater(len(group), 0)
        for case in group:
            with self.subTest(case=case["id"]):
                value = {"kind": "object", "value": case["properties"]}
                if "raises" in case:
                    self.check_raises(case, lambda value=value: from_case(value))
                    continue
                self.assertEqual(
                    canonical_host(from_case(value)), canonical_case(value)
                )

    def test_reference(self) -> None:
        group = self.host["reference.constructor"] + self.host["reference.value"]
        self.assertGreater(len(group), 0)
        for case in group:
            with self.subTest(case=case["id"]):
                if "raises" in case:
                    self.check_raises(
                        case, lambda case=case: lib.Reference(from_case(case["value"]))
                    )
                    continue
                self.assertEqual(
                    canonical_host(lib.Reference(from_case(case["value"])).value),
                    canonical_case(case["value"]),
                )


if __name__ == "__main__":
    unittest.main()
