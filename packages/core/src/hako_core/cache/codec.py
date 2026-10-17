"""Bytes codec: orjson, zstd above a size threshold. No pickle, so api and worker can share entries."""

from typing import Any

import orjson
import zstandard

from hako_core.constants.cache import CACHE_COMPRESS_MIN_BYTES, CACHE_ZSTD_LEVEL

_RAW = b"j"
_ZSTD = b"z"
_compressor = zstandard.ZstdCompressor(level=CACHE_ZSTD_LEVEL)
_decompressor = zstandard.ZstdDecompressor()


def encode(value: Any) -> bytes:
    raw = orjson.dumps(value)
    if len(raw) >= CACHE_COMPRESS_MIN_BYTES:
        return _ZSTD + _compressor.compress(raw)
    return _RAW + raw


def decode(blob: bytes) -> Any:
    tag, payload = blob[:1], blob[1:]
    if tag == _ZSTD:
        payload = _decompressor.decompress(payload)
    return orjson.loads(payload)
