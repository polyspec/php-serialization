"""Checks the package against contracts/php-serialize.json, which real PHP writes (make contracts), for RQ-001, RQ-002, RQ-003,
RQ-004, RQ-005 and RQ-006.

Each case is the test method test_<id>, a case of the suite unit `contract` of config/parity.json.
"""

from __future__ import annotations

import base64
import json
import unittest
from pathlib import Path

from polyspec.php_serialize import serialize, unserialize

from .tree import b64, new_state, tree

CONTRACT = json.loads(
    (
        Path(__file__).resolve().parents[3] / "contracts" / "php-serialize.json"
    ).read_text("utf-8")
)


class ContractTest(unittest.TestCase):
    """The cases of the contract, one method each."""


def _case_test(entry: dict):
    def test(self: ContractTest) -> None:
        value = unserialize(base64.b64decode(entry["bytes"]))
        self.assertEqual(tree(value, new_state()), entry["tree"])
        self.assertEqual(b64(serialize(value)), entry["bytes"])

    return test


for _entry in CONTRACT["cases"]:
    setattr(ContractTest, f"test_{_entry['id']}", _case_test(_entry))
