"""Measures the Python binding on one array of many entries, the shape of test_large_record of
packages/python/tests/test_api.py: for each size, the time to build the dict in Python, to serialize it, to unserialize
the bytes and to serialize the value that came back. It prints one line per size and fails only when the bytes written
back differ; a time is a measurement, not a limit (row T2.49). Usage: python benchmarks/large_array.py SIZE..."""

from __future__ import annotations

import sys
import time

import polyspec.php_serialization as lib


def entry(index: int) -> object:
    if index % 3 == 0:
        return index
    return float(index) if index % 3 == 1 else f"값-{index}"


def measure(keys: int) -> str:
    started = time.perf_counter()
    record: dict = {f"key-{index}": entry(index) for index in range(keys)}
    built = time.perf_counter()
    data = lib.serialize(record)
    written = time.perf_counter()
    value = lib.unserialize(data)
    read = time.perf_counter()
    again = lib.serialize(value)
    rewritten = time.perf_counter()
    if again != data:
        raise SystemExit(f"keys={keys}: the bytes written back differ")
    return (
        f"keys={keys} bytes={len(data)} build={built - started:.3f}s "
        f"serialize={written - built:.3f}s unserialize={read - written:.3f}s "
        f"serialize_again={rewritten - read:.3f}s"
    )


def main() -> None:
    for size in sys.argv[1:]:
        print(measure(int(size)), flush=True)


main()
