"""The only place cache keys are built: hako:{svc}:{source}:{kind}:v{schema}:{id}."""

import hashlib

from hako_core.constants.cache import (
    CACHE_HASH_DIGEST_BYTES,
    CACHE_KEY_PREFIX,
    CACHE_LONG_ID_THRESHOLD,
    CACHE_SCHEMA_VERSION,
)


def _safe_id(raw: str) -> str:
    if len(raw) <= CACHE_LONG_ID_THRESHOLD and ":" not in raw:
        return raw
    return hashlib.blake2b(raw.encode(), digest_size=CACHE_HASH_DIGEST_BYTES).hexdigest()


def cache_key(svc: str, source: str, kind: str, ident: str) -> str:
    return f"{CACHE_KEY_PREFIX}:{svc}:{source}:{kind}:v{CACHE_SCHEMA_VERSION}:{_safe_id(ident)}"
