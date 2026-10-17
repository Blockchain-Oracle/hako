"""Keep a run's output under MAX_OUTPUT_BYTES: trim long strings first, then long lists, and say so."""

from typing import Any

import orjson

from hako_tools.constants import (
    MAX_OUTPUT_BYTES,
    MAX_SHRINK_PASSES,
    MAX_TEXT_CHARS,
    MIN_TEXT_CHARS,
    SHRINK_FACTOR,
    TRUNCATION_MARK,
)

_LIST_KEEP_MIN = 1


def _size(data: Any) -> int:
    return len(orjson.dumps(data))


def _trim_strings(data: Any, limit: int) -> Any:
    if isinstance(data, str):
        return data if len(data) <= limit else data[:limit] + TRUNCATION_MARK
    if isinstance(data, list):
        return [_trim_strings(v, limit) for v in data]
    if isinstance(data, dict):
        return {k: _trim_strings(v, limit) for k, v in data.items()}
    return data


def _halve_lists(data: Any) -> Any:
    if isinstance(data, list):
        keep = max(_LIST_KEEP_MIN, len(data) // 2)
        return [_halve_lists(v) for v in data[:keep]]
    if isinstance(data, dict):
        return {k: _halve_lists(v) for k, v in data.items()}
    return data


def fit(data: Any) -> tuple[Any, bool]:
    """Return (data that fits, whether anything was cut)."""
    trimmed = _trim_strings(data, MAX_TEXT_CHARS)
    cut = trimmed != data
    limit = MAX_TEXT_CHARS
    for _ in range(MAX_SHRINK_PASSES):
        if _size(trimmed) <= MAX_OUTPUT_BYTES:
            return trimmed, cut
        cut = True
        if limit > MIN_TEXT_CHARS:
            limit = max(MIN_TEXT_CHARS, int(limit * SHRINK_FACTOR))
            trimmed = _trim_strings(trimmed, limit)
        else:
            trimmed = _halve_lists(trimmed)
    return trimmed, cut
