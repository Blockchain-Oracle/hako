"""Every connector package under here registers its endpoints on import; `load()` imports them all."""

import importlib
import pkgutil
from functools import lru_cache

import structlog

log = structlog.get_logger(__name__)


@lru_cache(maxsize=1)
def load() -> int:
    """Import every module below this package once; returns how many endpoints are registered.

    One broken connector (a bad example, a typo) is logged and skipped: it must never take the catalog down.
    """
    from hako_tools.framework.endpoint import REGISTRY

    for module in pkgutil.walk_packages(__path__, prefix=f"{__name__}."):
        try:
            importlib.import_module(module.name)
        except Exception:
            log.exception("connector_import_failed", module=module.name)
    return len(REGISTRY)
