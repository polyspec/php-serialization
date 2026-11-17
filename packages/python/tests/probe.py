"""The probe of make fuzz for the Python binding: reads one base64 input per line from the file of its argument and
writes one JSON line per input to the file of its second argument: {"refused":true} when the binding refuses the input
as a value error of the library, or the typed tree and the bytes that the binding writes back. Every other failure, of
reading or of writing back, is a crash, the finding that the fuzz reports."""

from __future__ import annotations

import base64
import json
import sys
from pathlib import Path

from polyspec.php_serialization import PHPSerializationValueError, serialize, unserialize

from tree import b64, new_state, tree


def reply(line: str) -> str:
    try:
        value = unserialize(base64.b64decode(line))
    except PHPSerializationValueError:
        return '{"refused":true}'
    # A failure of any other kind is a crash of the binding.
    except Exception as error:  # noqa: BLE001 - every kind of crash is reported, none is the expected one.
        return json.dumps({"crash": repr(error)})
    try:
        return json.dumps(
            {"tree": tree(value, new_state()), "written": b64(serialize(value))},
            separators=(",", ":"),
        )
    except Exception as error:  # noqa: BLE001 - every kind of crash is reported, none is the expected one.
        return json.dumps({"crash": repr(error)})


def main() -> None:
    lines: list[str] = []
    for line in Path(sys.argv[1]).read_text("ascii").split("\n"):
        if line == "" and lines:
            continue
        lines.append(reply(line))
    Path(sys.argv[2]).write_text("\n".join(lines) + "\n", "ascii")


main()
