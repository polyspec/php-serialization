"""The probe of make fuzz: reads one base64 input per line from the file of its argument and writes one JSON line per input
to the file of its second argument: {"refused":true}, or the typed tree and the bytes that the package writes back."""

from __future__ import annotations

import base64
import json
import sys
from pathlib import Path

from polyspec.php_serialize import UnserializeError, serialize, unserialize

from .tree import b64, new_state, tree


def main() -> None:
    lines = []
    for line in Path(sys.argv[1]).read_text("ascii").split("\n"):
        if line == "" and lines:
            continue
        try:
            value = unserialize(base64.b64decode(line))
            lines.append(
                json.dumps(
                    {
                        "tree": tree(value, new_state()),
                        "written": b64(serialize(value)),
                    },
                    separators=(",", ":"),
                )
            )
        except UnserializeError:
            lines.append('{"refused":true}')
        # A failure of any other kind is a crash of the package, the finding that the fuzz reports.
        except Exception as error:  # noqa: BLE001 - every kind of crash is reported, none is the expected one.
            lines.append(json.dumps({"crash": repr(error)}))
    Path(sys.argv[2]).write_text("\n".join(lines) + "\n", "ascii")


main()
