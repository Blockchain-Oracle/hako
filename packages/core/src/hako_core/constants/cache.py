"""Cache conventions (specs/backend.md §2.6)."""

from typing import Final

CACHE_KEY_PREFIX: Final = "hako"
CACHE_SCHEMA_VERSION: Final = 1
CACHE_COMPRESS_MIN_BYTES: Final = 4_096  # zstd only above this size
CACHE_ZSTD_LEVEL: Final = 3
CACHE_LONG_ID_THRESHOLD: Final = 96  # ids longer than this are hashed
CACHE_HASH_DIGEST_BYTES: Final = 16  # blake2b-16
REDIS_SOCKET_CONNECT_TIMEOUT_S: Final = 0.2
INDEX_RELOAD_CHECK_S: Final = 60
SQLITE_CACHE_KIB: Final = 16_000
