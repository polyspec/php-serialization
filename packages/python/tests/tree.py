"""The typed tree of a value, which the contract and the fuzz compare with the tree that PHP writes."""

from __future__ import annotations

import base64
import math
import struct

from polyspec.php_serialize import Reference, StdClass


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def key_tree(key) -> list:
    if isinstance(key, int):
        return ["int", str(key)]
    return ["string", b64(key.encode("utf-8") if isinstance(key, str) else key)]


def tree(value, state: dict) -> list:
    """The typed tree that the PHP generator writes, with references and objects numbered by first appearance."""
    if isinstance(value, Reference):
        known = state["references"].get(id(value))
        if known is not None:
            return ["ref", known]
        ordinal = len(state["references"])
        state["references"][id(value)] = ordinal
        return ["ref", ordinal, tree(value.value, state)]
    if value is None:
        return ["null"]
    if isinstance(value, bool):
        return ["bool", value]
    if isinstance(value, int):
        return ["int", str(value)]
    if isinstance(value, float):
        return ["float", "nan" if math.isnan(value) else struct.pack(">d", value).hex()]
    if isinstance(value, str):
        return ["string", b64(value.encode("utf-8"))]
    if isinstance(value, bytes):
        return ["string", b64(value)]
    if isinstance(value, StdClass):
        known = state["objects"].get(id(value))
        if known is not None:
            return ["object", known]
        ordinal = len(state["objects"])
        state["objects"][id(value)] = ordinal
        pairs = [
            [key_tree(key)[1], tree(item, state)]
            for key, item in value.properties.items()
        ]
        return ["object", ordinal, "stdClass", pairs]
    entries = enumerate(value) if isinstance(value, list) else value.items()
    return ["array", [[key_tree(key), tree(item, state)] for key, item in entries]]


def new_state() -> dict:
    return {"objects": {}, "references": {}}
